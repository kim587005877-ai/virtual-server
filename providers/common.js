exports.TAG="virtual-server";
exports.NAME=/^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;
// Chỉ giữ "kiểu khóa + dữ liệu", bỏ phần chú thích để tránh chèn ký tự lạ
exports.cleanKey=k=>{const m=/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) ([A-Za-z0-9+\/=]{20,})/.exec(String(k||"").trim());return m?m[1]+" "+m[2]:null};
exports.cloudInit=k=>"#cloud-config\nssh_authorized_keys:\n  - "+k+"\n";
exports.fail=(msg,status=400)=>Object.assign(new Error(msg),{status});
