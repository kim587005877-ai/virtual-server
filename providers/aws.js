const E=require("@aws-sdk/client-ec2");
const {cloudInit,TAG,fail}=require("./common");
const REGIONS=(process.env.AWS_REGIONS||"ap-southeast-1,us-east-1,eu-central-1").split(",").map(s=>s.trim());
const TYPES={"t3.micro":[2,1],"t3.small":[2,2],"t3.medium":[2,4],"t3.large":[2,8]};
const IMG={"ubuntu-24.04":["Ubuntu 24.04 LTS","ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"],"ubuntu-22.04":["Ubuntu 22.04 LTS","ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]};
const DISK=30,cli={},ec2=r=>cli[r]||(cli[r]=new E.EC2Client({region:r}));
exports.enabled=!!process.env.AWS_ACCESS_KEY_ID;
const tag=(i,k)=>(i.Tags||[]).find(t=>t.Key===k)?.Value||"";
const map=(i,r)=>({id:r+":"+i.InstanceId,name:tag(i,"Name"),status:i.State.Name==="running"&&i.PublicIpAddress?"running":i.State.Name,ip:i.PublicIpAddress||"",plan:i.InstanceType,
  vcpu:TYPES[i.InstanceType]?.[0],ram_gb:TYPES[i.InstanceType]?.[1],disk_gb:DISK,region:r,os:tag(i,"VsOs"),price:null,provider:"AWS EC2",provider_id:"aws",ssh_user:"ubuntu"});
async function mine(id){
  const [r,iid]=String(id).split(":");if(!REGIONS.includes(r)||!/^i-[0-9a-f]+$/.test(iid||""))throw fail("ID không hợp lệ");
  const i=(await ec2(r).send(new E.DescribeInstancesCommand({InstanceIds:[iid]}))).Reservations[0]?.Instances[0];
  if(!i)throw fail("Không tìm thấy",404);if(tag(i,"ManagedBy")!==TAG)throw fail("Máy chủ không do ứng dụng này tạo",403);return{i,r,iid};
}
exports.options=async()=>({plans:Object.entries(TYPES).map(([n,[c,m]])=>({name:n,cores:c,memory:m,disk:DISK,price:REGIONS.map(l=>({location:l,monthly:null}))})),
  locations:REGIONS.map(r=>({name:r,label:"AWS "+r})),images:Object.entries(IMG).map(([n,[l]])=>({name:n,label:l}))});
exports.count=async()=>(await Promise.all(REGIONS.map(async r=>(await ec2(r).send(new E.DescribeInstancesCommand({Filters:[{Name:"tag:ManagedBy",Values:[TAG]},{Name:"instance-state-name",Values:["pending","running","stopping","stopped"]}]}))).Reservations.reduce((n,x)=>n+x.Instances.length,0)))).reduce((a,b)=>a+b,0);
exports.create=async p=>{
  const r=p.location;if(!REGIONS.includes(r)||!TYPES[p.plan]||!IMG[p.image])throw fail("Thông số không hợp lệ");
  const c=ec2(r);
  const im=await c.send(new E.DescribeImagesCommand({Owners:["099720109477"],Filters:[{Name:"name",Values:[IMG[p.image][1]]},{Name:"state",Values:["available"]}]}));
  const ami=im.Images.sort((a,b)=>b.CreationDate.localeCompare(a.CreationDate))[0]?.ImageId;if(!ami)throw fail("Không tìm thấy image",404);
  let sg=(await c.send(new E.DescribeSecurityGroupsCommand({Filters:[{Name:"group-name",Values:["vs-ssh"]}]}))).SecurityGroups[0]?.GroupId;
  if(!sg){sg=(await c.send(new E.CreateSecurityGroupCommand({GroupName:"vs-ssh",Description:"SSH for virtual-server"}))).GroupId;
    await c.send(new E.AuthorizeSecurityGroupIngressCommand({GroupId:sg,IpPermissions:[{IpProtocol:"tcp",FromPort:22,ToPort:22,IpRanges:[{CidrIp:process.env.SSH_CIDR||"0.0.0.0/0"}]}]}))}
  const d=await c.send(new E.RunInstancesCommand({ImageId:ami,InstanceType:p.plan,MinCount:1,MaxCount:1,SecurityGroupIds:[sg],UserData:Buffer.from(cloudInit(p.key)).toString("base64"),
    BlockDeviceMappings:[{DeviceName:"/dev/sda1",Ebs:{VolumeSize:DISK,VolumeType:"gp3"}}],
    TagSpecifications:[{ResourceType:"instance",Tags:[{Key:"Name",Value:p.name},{Key:"ManagedBy",Value:TAG},{Key:"VsOs",Value:IMG[p.image][0]}]}]}));
  return{server:map(d.Instances[0],r)};
};
exports.get=async id=>{const {iid,r}=await mine(id);return map((await ec2(r).send(new E.DescribeInstancesCommand({InstanceIds:[iid]}))).Reservations[0].Instances[0],r)};
exports.remove=async id=>{const {r,iid}=await mine(id);await ec2(r).send(new E.TerminateInstancesCommand({InstanceIds:[iid]}))};
