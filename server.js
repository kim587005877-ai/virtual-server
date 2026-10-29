const express=require("express"),path=require("path"),crypto=require("crypto");
const {cleanKey,NAME,fail}=require("./providers/common");
const {APP_PASSWORD,PORT=3000}=process.env,MAX=+process.env.MAX_SERVERS||3;
if(!APP_PASSWORD){console.error("Thiếu APP_PASSWORD trong .env");process.exit(1)}
const prov={hetzner:require("./providers/hetzner"),aws:require("./providers/aws"),gcp:require("./providers/gcp"),github:require("./providers/github")};
const app=express();app.use(express.json({limit:"20kb"}));
app.use(express.static(path.join(__dirname,"public")));

// Chỉ người biết mật khẩu mới được thuê/xóa (tránh người lạ tiêu tiền của bạn)
function auth(req,res,next){
  const a=Buffer.from(req.get("x-app-password")||""),b=Buffer.from(APP_PASSWORD);
  if(a.length===b.length&&crypto.timingSafeEqual(a,b))return next();
  setTimeout(()=>res.status(401).json({error:"Sai mật khẩu ứng dụng"}),800);
}
const ID=/^[\w:.-]{1,100}$/;
const use=h=>(q,s)=>(async()=>{
  const m=Object.hasOwn(prov,q.params.p)&&prov[q.params.p];
  if(!m||!m.enabled)throw fail("Nhà cung cấp chưa được cấu hình trong .env");
  await h(m,q,s);
})().catch(e=>{const c=+e.status||e.$metadata?.httpStatusCode;console.error(q.params.p,e.message);s.status(c>=400&&c<600?c:500).json({error:e.message})});

app.get("/api/:p/options",auth,use(async(m,q,s)=>s.json(await m.options())));
app.post("/api/:p/servers",auth,use(async(m,q,s)=>{
  const {name,plan,location,image,ssh_key,confirm}=q.body||{},key=cleanKey(ssh_key);
  if(confirm!==true)throw fail("Cần xác nhận thuê");
  if(m.needsKey!==false&&!key)throw fail("Khóa công khai SSH không hợp lệ");
  if(!NAME.test(name||"")||![plan,location,image].every(v=>typeof v==="string"&&/^[\w.\/-]{1,100}$/.test(v)))throw fail("Thông số không hợp lệ");
  if(await m.count()>=MAX)throw fail("Đã đạt giới hạn "+MAX+" máy chủ",403);
  s.status(201).json(await m.create({name,plan,location,image,key}));
}));
app.get("/api/:p/servers/:id",auth,use(async(m,q,s)=>{if(!ID.test(q.params.id))throw fail("ID không hợp lệ");s.json({server:await m.get(q.params.id)})}));
app.delete("/api/:p/servers/:id",auth,use(async(m,q,s)=>{if(!ID.test(q.params.id))throw fail("ID không hợp lệ");await m.remove(q.params.id);s.json({ok:true})}));

app.get("/api/:p/activity",auth,use(async(m,q,s)=>{if(!m.activity)throw fail("Không hỗ trợ");s.json({events:await m.activity(String(q.query.repo||""))})}));
app.post("/api/:p/servers/:id/stop",auth,use(async(m,q,s)=>{if(!m.stop)throw fail("Không hỗ trợ");if(!ID.test(q.params.id))throw fail("ID không hợp lệ");await m.stop(q.params.id);s.json({ok:true})}));

const server=require("http").createServer(app);require("./ssh")(server,{prov,password:APP_PASSWORD});
server.listen(PORT,()=>console.log("Chạy tại http://localhost:"+PORT,"· nhà cung cấp bật:",Object.keys(prov).filter(k=>prov[k].enabled).join(", ")||"(chưa có)"));
