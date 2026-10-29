// GitHub Codespaces: không có IP công khai, truy cập qua web_url hoặc `gh codespace ssh`.
const {fail}=require("./common");
const T=process.env.GITHUB_TOKEN;
const REPOS=(process.env.GITHUB_REPOS||"").split(",").map(s=>s.trim()).filter(r=>/^[\w.-]+\/[\w.-]+$/.test(r));
exports.enabled=!!(T&&REPOS.length);
exports.needsKey=false;
// Danh sách máy chuẩn của Codespaces, dùng khi GitHub từ chối endpoint liệt kê loại máy (lỗi 403)
const G=2**30,STD=[["basicLinux32gb",2,8,32],["standardLinux32gb",4,16,32],["premiumLinux",8,32,64],["largePremiumLinux",16,64,128]].map(([name,c,m,d])=>({name,cpus:c,memory_in_bytes:m*G,storage_in_bytes:d*G}));
const GB=b=>Math.round((b||0)/2**30);
async function gh(method,p,body){
  const r=await fetch("https://api.github.com"+p,{method,headers:{Authorization:"Bearer "+T,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"virtual-server","Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw fail(d.message||"Lỗi GitHub",r.status);
  return d;
}
const map=c=>({id:c.name,name:(c.display_name||c.name).replace(/^vs-/,""),status:c.state==="Available"?"running":String(c.state).toLowerCase(),ip:"",plan:c.machine?.name||"",
  vcpu:c.machine?.cpus,ram_gb:GB(c.machine?.memory_in_bytes),disk_gb:GB(c.machine?.storage_in_bytes),region:c.repository.full_name,os:"Codespace (devcontainer mặc định)",price:null,
  provider:"GitHub Codespaces",provider_id:"github",ssh_user:"codespace",web_url:c.web_url,state:c.state,last_used:c.last_used_at});
async function mine(id){
  if(!/^[\w-]{1,100}$/.test(id))throw fail("ID không hợp lệ");
  const c=await gh("GET","/user/codespaces/"+id);
  if(!REPOS.includes(c.repository?.full_name)||!String(c.display_name||"").startsWith("vs-"))throw fail("Codespace không do ứng dụng này tạo",403);
  return c;
}
exports.options=async()=>{
  const per=await Promise.all(REPOS.map(async r=>({r,m:await gh("GET","/repos/"+r+"/codespaces/machines").then(d=>d.machines||[]).catch(e=>e.status===403?STD:Promise.reject(e))})));
  const plans={};
  for(const {r,m} of per)for(const x of m)(plans[x.name]??={name:x.name,cores:x.cpus,memory:GB(x.memory_in_bytes),disk:GB(x.storage_in_bytes),price:[]}).price.push({location:r,monthly:null});
  return{plans:Object.values(plans),locations:REPOS.map(r=>({name:r,label:r})),images:[{name:"default",label:"devcontainer mặc định"}]};
};
exports.count=async()=>(await gh("GET","/user/codespaces?per_page=100")).codespaces.filter(c=>String(c.display_name||"").startsWith("vs-")&&REPOS.includes(c.repository.full_name)).length;
exports.create=async p=>{
  if(!REPOS.includes(p.location))throw fail("Repo không nằm trong GITHUB_REPOS");
  if(p.name.length>40)throw fail("Tên tối đa 40 ký tự với Codespace");
  const body={machine:p.plan,display_name:"vs-"+p.name,idle_timeout_minutes:30,retention_period_minutes:1440};
  try{return{server:map(await gh("POST","/repos/"+p.location+"/codespaces",body))}}
  catch(e){
    if(e.status!==403)throw e;
    // Dự phòng: tạo qua endpoint của người dùng với repository_id
    const id=(await gh("GET","/repos/"+p.location)).id;
    return{server:map(await gh("POST","/user/codespaces",{...body,repository_id:id}))};
  }
};
exports.get=async id=>map(await mine(id));
exports.stop=async id=>{await mine(id);await gh("POST","/user/codespaces/"+id+"/stop")};
exports.remove=async id=>{await mine(id);await gh("DELETE","/user/codespaces/"+id)};
exports.activity=async repo=>{
  if(!REPOS.includes(repo))throw fail("Repo không được phép");
  return(await gh("GET","/repos/"+repo+"/events?per_page=30")).map(e=>{
    const n=e.payload?.commits?.length;
    const text=e.type==="PushEvent"?"push "+(n||0)+" commit"+(n?": "+String(e.payload.commits[0].message).split("\n")[0].slice(0,80):""):e.type.replace(/Event$/,"")+(e.payload?.action?" ("+e.payload.action+")":"");
    return{time:e.created_at,actor:e.actor?.login||"",type:e.type,text};
  });
};
