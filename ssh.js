// Cầu nối WebSocket -> SSH. Chỉ cho phép vào máy chủ do chính ứng dụng này tạo.
const {WebSocketServer}=require("ws"),{Client}=require("ssh2"),crypto=require("crypto"),{StringDecoder}=require("string_decoder");
const MAX_SESSIONS=2,IDLE_MS=15*60*1000,sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clamp=(n,d)=>Math.min(Math.max(parseInt(n)||d,10),300);

module.exports=(server,{prov,password})=>{
  const wss=new WebSocketServer({server,path:"/ws/ssh",maxPayload:64*1024});
  let active=0;
  wss.on("connection",(ws,req)=>{
    const send=o=>ws.readyState===1&&ws.send(JSON.stringify(o));
    // Chặn trang web lạ mở WebSocket tới backend của bạn
    try{if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return ws.close(1008)}catch{return ws.close(1008)}
    let ssh,stream,started=false,counted=false,idle;
    const dec=new StringDecoder("utf8");
    const bump=()=>{clearTimeout(idle);idle=setTimeout(()=>{send({type:"error",m:"Hết thời gian chờ (15 phút không thao tác)"});ws.close()},IDLE_MS)};
    ws.on("error",()=>{});
    ws.on("close",()=>{clearTimeout(idle);if(ssh)ssh.end();if(counted){counted=false;active--}});
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
        const key=String(m.privateKey||"").replace(/\r/g,"").trim()+"\n";
        if(key.length<80||key.length>16000||!key.includes("PRIVATE KEY"))throw new Error("Khóa riêng không hợp lệ");
        if(active>=MAX_SESSIONS)throw new Error("Quá nhiều phiên SSH đang mở");
        // IP lấy từ API nhà cung cấp, không nhận từ client: chống truy cập tới địa chỉ tùy ý
        const s=await p.get(String(m.id));
        if(s.status!=="running"||!s.ip)throw new Error("Máy chủ chưa sẵn sàng (đang khởi động?)");
        active++;counted=true;
        ssh=new Client();
        ssh.on("ready",()=>ssh.shell({term:"xterm-256color",cols:clamp(m.cols,80),rows:clamp(m.rows,24)},(err,st)=>{
          if(err){send({type:"error",m:err.message});return ws.close()}
          stream=st;send({type:"status",m:"Đã kết nối "+s.ssh_user+"@"+s.ip});
          st.on("data",d=>send({type:"data",d:dec.write(d)}));
          st.stderr.on("data",d=>send({type:"data",d:dec.write(d)}));
          st.on("close",()=>ws.close());
        }));
        ssh.on("error",e=>{
          const hint=/authentication/i.test(e.message)?" (máy mới tạo có thể cần chờ 1-2 phút để nhận khóa; hãy kiểm tra khóa riêng khớp khóa công khai đã dán)":"";
          send({type:"error",m:e.message+hint});ws.close();
        });
        ssh.connect({host:s.ip,port:22,username:s.ssh_user,privateKey:key,passphrase:m.passphrase?String(m.passphrase):undefined,readyTimeout:20000,keepaliveInterval:15000});
      }catch(e){send({type:"error",m:e.message});ws.close()}
    });
  });
};
