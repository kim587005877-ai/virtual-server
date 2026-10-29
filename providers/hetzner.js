const {cloudInit,TAG,fail}=require("./common"),T=process.env.HCLOUD_TOKEN;
exports.enabled=!!T;
async function hc(method,p,body){
  const r=await fetch("https://api.hetzner.cloud/v1"+p,{method,headers:{Authorization:"Bearer "+T,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw fail(d.error?.message||"Lỗi Hetzner",r.status);
  return d;
}
const map=x=>({id:String(x.id),name:x.name,status:x.status,ip:x.public_net?.ipv4?.ip||"",plan:x.server_type.name,vcpu:x.server_type.cores,ram_gb:x.server_type.memory,disk_gb:x.server_type.disk,
  region:x.datacenter.location.city+" ("+x.datacenter.location.name+")",os:x.image?.description||x.image?.name||"",
  price:x.server_type.prices?.find(p=>p.location===x.datacenter.location.name)?.price_monthly.gross??null,provider:"Hetzner Cloud",provider_id:"hetzner",ssh_user:"root"});
async function mine(id){const s=(await hc("GET","/servers/"+id)).server;if(s.labels?.["managed-by"]!==TAG)throw fail("Máy chủ không do ứng dụng này tạo",403);return s}
exports.options=async()=>{
  const [t,l,i]=await Promise.all([hc("GET","/server_types?per_page=50"),hc("GET","/locations"),hc("GET","/images?type=system&architecture=x86&per_page=50")]);
  return{plans:t.server_types.filter(x=>!x.deprecated).map(x=>({name:x.name,cores:x.cores,memory:x.memory,disk:x.disk,price:x.prices.map(p=>({location:p.location,monthly:p.price_monthly.gross}))})),
    locations:l.locations.map(x=>({name:x.name,label:x.city+", "+x.country})),
    images:i.images.filter(x=>!x.deprecated&&x.name).map(x=>({name:x.name,label:x.description}))};
};
exports.count=async()=>(await hc("GET","/servers?per_page=50&label_selector=managed-by%3D"+TAG)).servers.length;
exports.create=async p=>({server:map((await hc("POST","/servers",{name:p.name,server_type:p.plan,location:p.location,image:p.image,start_after_create:true,labels:{"managed-by":TAG},user_data:cloudInit(p.key)})).server)});
exports.get=async id=>map(await mine(id));
exports.remove=async id=>{await mine(id);await hc("DELETE","/servers/"+id)};
