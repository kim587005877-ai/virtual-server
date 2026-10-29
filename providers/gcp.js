const compute=require("@google-cloud/compute");
const {TAG,fail}=require("./common"),P=process.env.GCP_PROJECT;
const ZONES=(process.env.GCP_ZONES||"asia-southeast1-b,us-central1-a,europe-west3-a").split(",").map(s=>s.trim());
const TYPES={"e2-micro":[2,1],"e2-small":[2,2],"e2-medium":[2,4],"e2-standard-2":[2,8]};
const IMG={"ubuntu-24.04":["Ubuntu 24.04 LTS","projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64"],"debian-12":["Debian 12","projects/debian-cloud/global/images/family/debian-12"]};
const DISK=30;let ic;const I=()=>ic||(ic=new compute.InstancesClient());
exports.enabled=!!(P&&process.env.GOOGLE_APPLICATION_CREDENTIALS);
const map=(i,z)=>{const k=Object.keys(IMG).find(k=>k.replace(/\./g,"-")===i.labels?.["vs-image"]),pl=i.machineType.split("/").pop();
  return{id:z+":"+i.name,name:i.name,status:i.status==="RUNNING"?"running":String(i.status).toLowerCase(),ip:i.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP||"",plan:pl,
  vcpu:TYPES[pl]?.[0],ram_gb:TYPES[pl]?.[1],disk_gb:DISK,region:z,os:k?IMG[k][0]:"",price:null,provider:"Google Cloud",provider_id:"gcp",ssh_user:"ubuntu"}};
function parse(id){const [zone,name]=String(id).split(":");if(!ZONES.includes(zone)||!/^[a-z][a-z0-9-]{0,61}$/.test(name||""))throw fail("ID không hợp lệ");return{zone,name}}
async function mine(id){const {zone,name}=parse(id),[i]=await I().get({project:P,zone,instance:name});
  if(i.labels?.["managed-by"]!==TAG)throw fail("Máy chủ không do ứng dụng này tạo",403);return{i,zone,name}}
exports.options=async()=>({plans:Object.entries(TYPES).map(([n,[c,m]])=>({name:n,cores:c,memory:m,disk:DISK,price:ZONES.map(l=>({location:l,monthly:null}))})),
  locations:ZONES.map(z=>({name:z,label:"GCP "+z})),images:Object.entries(IMG).map(([n,[l]])=>({name:n,label:l}))});
exports.count=async()=>(await Promise.all(ZONES.map(async zone=>(await I().list({project:P,zone,filter:'labels.managed-by="'+TAG+'"'}))[0].length))).reduce((a,b)=>a+b,0);
exports.create=async p=>{
  const zone=p.location;if(!ZONES.includes(zone)||!TYPES[p.plan]||!IMG[p.image])throw fail("Thông số không hợp lệ");
  let [res]=await I().insert({project:P,zone,instanceResource:{name:p.name,machineType:`zones/${zone}/machineTypes/${p.plan}`,
    labels:{"managed-by":TAG,"vs-image":p.image.replace(/\./g,"-")},
    disks:[{boot:true,autoDelete:true,initializeParams:{sourceImage:IMG[p.image][1],diskSizeGb:String(DISK)}}],
    networkInterfaces:[{network:"global/networks/default",accessConfigs:[{name:"External NAT",type:"ONE_TO_ONE_NAT"}]}],
    metadata:{items:[{key:"ssh-keys",value:"ubuntu:"+p.key+" ubuntu"}]}}});
  let op=res.latestResponse;const oc=new compute.ZoneOperationsClient();
  while(op.status!=="DONE")[op]=await oc.wait({operation:op.name,project:P,zone});
  if(op.error)throw fail(op.error.errors?.[0]?.message||"Lỗi GCP",500);
  const [i]=await I().get({project:P,zone,instance:p.name});return{server:map(i,zone)};
};
exports.get=async id=>{const {i,zone}=await mine(id);return map(i,zone)};
exports.remove=async id=>{const {zone,name}=await mine(id);await I().delete({project:P,zone,instance:name})};
