// Cầu nối WebSocket -> SSH. VPS: dùng khóa riêng do người dùng dán. Codespace: dùng gh tạo đường hầm.
const {WebSocketServer}=require("ws"),{Client,utils}=require("ssh2"),crypto=require("crypto"),{StringDecoder}=require("string_decoder");
const {spawn,execFile}=require("child_process"),{promisify}=require("util"),{Duplex}=require("stream"),fs=require("fs"),os=require("os"),path=require("path");
const run=promisify(execFile);
const MAX_SESSIONS=2,IDLE_MS=15*60*1000,sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clamp=(n,d)=>Math.min(Math.max(parseInt(n)||d,10),300);
const GH=path.join(__dirname,"bin","gh"),HOME=path.join(os.tmpdir(),"vs-home");
const ghEnv=()=>({...process.env,GH_TOKEN:process.env.GITHUB_TOKEN,GH_PROMPT_DISABLED:"1",GH_NO_UPDATE_NOTIFIER:"1",HOME});

// Khóa SSH do chính backend tạo (không phụ thuộc vào cách gh tự tạo khóa)
function ensureKey(){
  const dir=path.join(HOME,".ssh"),kp=path.join(dir,"vs-key");
  if(!fs.existsSync(kp)||!fs.existsSync(kp+".pub")){
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const k=utils.generateKeyPairSync("ed25519",{comment:"virtual-server"});
    fs.writeFileSync(kp,k.private,{mode:0o600});
    fs.writeFileSync(kp+".pub",k.public.trim()+"\n",{mode:0o644});
  }
  return kp;
}
// Tên người dùng trong Codespace phụ thuộc ảnh (vscode hoặc codespace): hỏi gh, rồi thử lần lượt
async function codespaceInfo(name){
  if(!fs.existsSync(GH))throw new Error("Backend chưa cài gh (xem README, mục SSH vào Codespace)");
  const kp=ensureKey();let user="";
  try{const {stdout}=await run(GH,["cs","ssh","--config","-c",name],{env:ghEnv(),timeout:120000});user=/^\s*User\s+(\S+)/m.exec(stdout)?.[1]||""}catch{}
  return{kp,users:[...new Set([user,"vscode","codespace"].filter(Boolean))]};
}
// gh gửi khóa công khai (kp.pub) vào Codespace rồi làm đường hầm; ssh2 đi qua đường hầm đó
function tunnel(name,kp){
  const child=spawn(GH,["cs","ssh","-c",name,"--stdio","--","-i",kp],{env:ghEnv(),stdio:["pipe","pipe","pipe"]});
  child._err="";child.stderr.on("data",d=>{child._err=(child._err+d).slice(-600)});child.on("error",()=>{});
  return{child,sock:Duplex.from({readable:child.stdout,writable:child.stdin})};
}

module.exports=(server,{prov,password})=>{
  const wss=new WebSocketServer({server,path:"/ws/ssh",maxPayload:64*1024});
  let active=0;
  wss.on("connection",(ws,req)=>{
    const send=o=>ws.readyState===1&&ws.send(JSON.stringify(o));
    try{if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return ws.close(1008)}catch{return ws.close(1008)}
    let ssh,stream,child,started=false,counted=false,idle,cols=80,rows=24;
    const dec=new StringDecoder("utf8");
    const bump=()=>{clearTimeout(idle);idle=setTimeout(()=>{send({type:"error",m:"Hết thời gian chờ (15 phút không thao tác)"});ws.close()},IDLE_MS)};
    ws.on("error",()=>{});
    ws.on("close",()=>{clearTimeout(idle);if(ssh)ssh.end();if(child)child.kill();if(counted){counted=false;active--}});
    bump();

    // Mở một phiên SSH; retry() trả true nếu đã bắt đầu thử lại với cách khác
    function open(getOpts,label,retry){
      const c=new Client();ssh=c;
      c.on("ready",()=>c.shell({term:"xterm-256color",cols,rows},(err,st)=>{
        if(err){send({type:"error",m:err.message});return ws.close()}
        stream=st;send({type:"status",m:"Đã kết nối "+label});
        st.on("data",d=>send({type:"data",d:dec.write(d)}));
        st.stderr.on("data",d=>send({type:"data",d:dec.write(d)}));
        st.on("close",()=>ws.close());
      }));
      c.on("error",e=>{
        if(/authentication/i.test(e.message)&&retry&&retry()){c.end();return}
        const hint=/authentication/i.test(e.message)?" (máy mới tạo có thể cần chờ 1-2 phút để nhận khóa; với VPS hãy kiểm tra khóa riêng khớp khóa công khai đã dán)":"";
        const g=child&&child._err?" | gh: "+child._err.trim().slice(-300):"";
        send({type:"error",m:e.message+hint+g});ws.close();
      });
      c.connect({...getOpts(),readyTimeout:90000,keepaliveInterval:15000});
    }

    ws.on("message",async raw=>{
      let m;try{m=JSON.parse(raw)}catch{return}
      bump();
      if(started){
        if(!stream)return;
        if(m.type==="data"&&typeof m.d==="string")stream.write(m.d);
        else if(m.type==="resize")stream.setWindow(clamp(m.rows,24),clamp(m.cols,80),0,0);
        return;
      }
      if(m.type!=="connect")return;
      started=true;cols=clamp(m.cols,80);rows=clamp(m.rows,24);
      try{
        const a=Buffer.from(String(m.password||"")),b=Buffer.from(password);
        if(!(a.length===b.length&&crypto.timingSafeEqual(a,b))){await sleep(800);throw new Error("Sai mật khẩu ứng dụng")}
        const p=Object.hasOwn(prov,m.provider)&&prov[m.provider];
        if(!p||!p.enabled)throw new Error("Nhà cung cấp chưa được cấu hình");
        if(!/^[\w:.-]{1,100}$/.test(String(m.id)))throw new Error("ID máy chủ không hợp lệ");
        if(active>=MAX_SESSIONS)throw new Error("Quá nhiều phiên SSH đang mở");
        // Máy lấy từ API nhà cung cấp, không nhận IP từ client; chỉ máy do ứng dụng tạo
        const s=await p.get(String(m.id));
        active++;counted=true;
        if(s.web_url){
          send({type:"status",m:"Đang tạo đường hầm tới Codespace (có thể mất 30-90 giây nếu máy đang dừng)..."});
          const info=await codespaceInfo(s.id);let ui=0;
          const attempt=()=>{
            if(child)child.kill();
            const t=tunnel(s.id,info.kp);child=t.child;
            send({type:"status",m:"Đăng nhập với tên người dùng "+info.users[ui]+"..."});
            open(()=>({sock:t.sock,username:info.users[ui],privateKey:fs.readFileSync(info.kp)}),info.users[ui]+"@"+s.name,
              ()=>{if(ui<info.users.length-1){ui++;attempt();return true}return false});
          };
          attempt();
        }else{
          const key=String(m.privateKey||"").replace(/\r/g,"").trim()+"\n";
          if(key.length<80||key.length>16000||!key.includes("PRIVATE KEY"))throw new Error("Khóa riêng không hợp lệ");
          if(s.status!=="running"||!s.ip)throw new Error("Máy chủ chưa sẵn sàng (đang khởi động?)");
          open(()=>({host:s.ip,port:22,username:s.ssh_user,privateKey:key,passphrase:m.passphrase?String(m.passphrase):undefined}),s.ssh_user+"@"+s.ip,null);
        }
      }catch(e){send({type:"error",m:String(e.stderr||e.message).slice(0,300)});ws.close()}
    });
  });
};
