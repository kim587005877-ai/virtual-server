// Tải GitHub CLI (gh) vào thư mục bin/ khi build trên Linux (Render). Lỗi chỉ cảnh báo, không làm hỏng deploy.
const {execFileSync}=require("child_process"),fs=require("fs"),path=require("path");
(async()=>{
  try{
    if(process.platform!=="linux")return;
    const arch=process.arch==="arm64"?"arm64":"amd64",base={"User-Agent":"virtual-server"};
    const get=async h=>(await fetch("https://api.github.com/repos/cli/cli/releases/latest",{headers:h})).json();
    let rel=process.env.GITHUB_TOKEN?await get({...base,Authorization:"Bearer "+process.env.GITHUB_TOKEN}):{};
    if(!rel.assets)rel=await get(base);
    const a=rel.assets?.find(x=>x.name.endsWith("linux_"+arch+".tar.gz"));
    if(!a)throw new Error("không thấy bản gh phù hợp");
    const dir=path.join(__dirname,"..","bin");fs.mkdirSync(dir,{recursive:true});
    const tgz=path.join(dir,"gh.tgz");
    fs.writeFileSync(tgz,Buffer.from(await(await fetch(a.browser_download_url)).arrayBuffer()));
    execFileSync("tar",["-xzf",tgz,"-C",dir,"--strip-components=2","--wildcards","*/bin/gh"]);
    fs.rmSync(tgz);fs.chmodSync(path.join(dir,"gh"),0o755);
    console.log("Đã cài gh:",rel.tag_name);
  }catch(e){console.warn("Bỏ qua cài gh:",e.message)}
})();
