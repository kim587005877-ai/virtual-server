# Máy chủ Linux ảo + thuê Hetzner / AWS / Google Cloud

1. `cp .env.example .env`, điền APP_PASSWORD và thông tin nhà cung cấp bạn dùng (bỏ trống nhà cung cấp không dùng).
2. `npm install && npm run dev` (Node 20.6+; trên Render dùng `npm start`), mở http://localhost:3000
3. Tab "Thuê cloud": bỏ chọn "Chế độ thử", nhập mật khẩu ứng dụng, chọn nhà cung cấp, dán khóa công khai SSH, thuê.

## SSH key
Tạo trên máy bạn: `ssh-keygen -t ed25519`, rồi dán nội dung file `.pub` vào form. Khóa riêng (không có .pub) không bao giờ được gửi đi.
Kết nối: Hetzner `ssh root@IP`, AWS và GCP `ssh ubuntu@IP` (giao diện ghi user vào config.ssh_user).

## Quyền tối thiểu
- Hetzner: API token Read & Write.
- AWS: IAM user có ec2:RunInstances, DescribeInstances, TerminateInstances, DescribeImages, DescribeSecurityGroups, CreateSecurityGroup, AuthorizeSecurityGroupIngress, CreateTags.
  Cần VPC mặc định trong vùng. Cổng 22 mở cho SSH_CIDR (nên giới hạn về IP của bạn).
- GCP: service account vai trò Compute Instance Admin (v1), tải file JSON làm gcp-key.json, bật Compute Engine API.
  Mạng "default" cần còn rule default-allow-ssh.

## An toàn
Ứng dụng chỉ xem/xóa máy chủ do chính nó tạo (nhãn managed-by=virtual-server), và giới hạn MAX_SERVERS.
Không commit .env hay gcp-key.json. Phải chạy sau HTTPS khi đưa lên mạng.
Giá AWS/GCP không có qua API nên giao diện không hiển thị; hãy xem trang giá của nhà cung cấp.

## SSH thật trong trình duyệt
Tab "SSH thật": dán khóa riêng (private key), bấm Kết nối. Backend lấy IP từ API nhà cung cấp (không nhận IP từ trình duyệt)
và chỉ cho vào máy do ứng dụng tạo. Khóa riêng không được lưu hay ghi log. Giới hạn 2 phiên cùng lúc, tự ngắt sau 15 phút không thao tác.
Máy mới tạo cần 1-2 phút mới nhận khóa SSH.
