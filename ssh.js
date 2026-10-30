// Cầu nối WebSocket -> SSH. VPS: dùng khóa riêng do người dùng dán. Codespace: dùng gh tạo đường hầm.
const {WebSocketServer}=require("ws"),{Client}=require("ssh2"),crypto=require("crypto"),{StringDecoder}=require("string_decoder");
const {spawn,execFile}=require("child_process"),{promisify}=require("util"),{Duplex}=require("stream"),fs=require("fs"),os=require("os"),path=require("path");
const run=promisify(execFile);
const MAX_SESSIONS=2,IDLE_MS=15*60*1000,sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clamp=(n,d)=>Math.min(Math.max(parseInt(n)||d,10),300);
const GH=path.join(__dirname,"bin","gh"),HOME=path.join(os.tmpdir(),"vs-home");
const ghEnv=()=>({...process.env,GH_TOKEN:process.env.GITHUB_TOKEN,GH_PROMPT_DISABLED:"1",GH_NO_UPDATE_NOTIFIER:"1",HOME});

// Tạo đường hầm tới Codespace bằng gh, trả về luồng để ssh2 đi qua (giống ProxyCommand)
async function codespaceConn(name){
  if(!fs.existsSync(GH))throw new Error("Backend chưa cài gh (xem README, mục SSH vào Codespace)");
  fs.mkdirSync(path.join(HOME,".ssh"),{recursive:true,mode:0o700});
  const {stdout:cfg}=await run(GH,["cs","ssh","--config","-c",name],{env:ghEnv(),timeout:120000});
  const user=/^\s*User\s+(\S+)/m.exec(cfg)?.[1]||"codespace";
  let idf=/^\s*IdentityFile\s+(\S+)/m.exec(cfg)?.[1]||"";
  if(idf.startsWith("~"))idf=path.join(HOME,idf.slice(1));
  if(!idf||!fs.existsSync(idf))throw new Error("Không lấy được khóa SSH do gh tạo");
  const child=spawn(GH,["cs","ssh","-c",name,"--stdio"],{env:ghEnv(),stdio:["pipe","pipe","pipe"]});
  child.stderr.on("data",()=>{});child.on("error",()=>{});
  return{child,opts:{sock:Duplex.from({readable:child.stdout,writable:child.stdin}),username:user,privateKey:fs.readFileSync(idf)}};
}

module.exports=(server,{prov,password})=>{
  const wss=new WebSocketServer({server,path:"/ws/ssh",maxPayload:64*1024});
  let active=0;
  wss.on("connection",(ws,req)=>{
    const send=o=>ws.readyState===1&&ws.send(JSON.stringify(o));
    try{if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return ws.close(1008)}catch{return ws.close(1008)}
    let ssh,stream,child,started=false,counted=false,idle;
    const dec=new StringDecoder("utf8");
    const bump=()=>{clearTimeout(idle);idle=setTimeout(()=>{send({type:"error",m:"Hết thời gian chờ (15 phút không thao tác)"});ws.close()},IDLE_MS)};
    ws.on("error",()=>{});
    ws.on("close",()=>{clearTimeout(idle);if(ssh)ssh.end();if(child)child.kill();if(counted){counted=false;active--}});
    bump();
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
      started=true;
      try{
        const a=Buffer.from(String(m.password||"")),b=Buffer.from(password);
        if(!(a.length===b.length&&crypto.timingSafeEqual(a,b))){await sleep(800);throw new Error("Sai mật khẩu ứng dụng")}
        const p=Object.hasOwn(prov,m.provider)&&prov[m.provider];
        if(!p||!p.enabled)throw new Error("Nhà cung cấp chưa được cấu hình");
        if(!/^[\w:.-]{1,100}$/.test(String(m.id)))throw new Error("ID máy chủ không hợp lệ");
        if(active>=MAX_SESSIONS)throw new Error("Quá nhiều phiên SSH đang mở");
        // Máy lấy từ API nhà cung cấp, không nhận IP từ client; chỉ máy do ứng dụng tạo
        const s=await p.get(String(m.id));
        let opts,label;
        active++;counted=true;
        if(s.web_url){
          send({type:"status",m:"Đang tạo đường hầm tới Codespace (có thể mất 30-90 giây nếu máy đang dừng)..."});
          const c=await codespaceConn(s.id);child=c.child;opts=c.opts;label=opts.username+"@"+s.name;
        }else{
          const key=String(m.privateKey||"").replace(/\r/g,"").trim()+"\n";
          if(key.length<80||key.length>16000||!key.includes("PRIVATE KEY"))throw new Error("Khóa riêng không hợp lệ");
          if(s.status!=="running"||!s.ip)throw new Error("Máy chủ chưa sẵn sàng (đang khởi động?)");
          opts={host:s.ip,port:22,username:s.ssh_user,privateKey:key,passphrase:m.passphrase?String(m.passphrase):undefined};label=s.ssh_user+"@"+s.ip;
        }
        ssh=new Client();
        ssh.on("ready",()=>ssh.shell({term:"xterm-256color",cols:clamp(m.cols,80),rows:clamp(m.rows,24)},(err,st)=>{
          if(err){send({type:"error",m:err.message});return ws.close()}
          stream=st;send({type:"status",m:"Đã kết nối "+label});
          st.on("data",d=>send({type:"data",d:dec.write(d)}));
          st.stderr.on("data",d=>send({type:"data",d:dec.write(d)}));
          st.on("close",()=>ws.close());
        }));
        ssh.on("error",e=>{
          const hint=/authentication/i.test(e.message)?" (máy mới tạo có thể cần chờ 1-2 phút để nhận khóa; hãy kiểm tra khóa riêng khớp khóa công khai đã dán)":"";
          send({type:"error",m:e.message+hint});ws.close();
        });
        ssh.connect({...opts,readyTimeout:90000,keepaliveInterval:15000});
      }catch(e){send({type:"error",m:String(e.stderr||e.message).slice(0,300)});ws.close()}
    });
  });
};
