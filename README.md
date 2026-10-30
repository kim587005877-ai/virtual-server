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

## GitHub Codespaces
Tạo token cổ điển tại github.com/settings/tokens với quyền `codespace`, đặt GITHUB_TOKEN và GITHUB_REPOS trên Render.
Codespace không có IP công khai nên tab SSH thật không dùng được; mở bằng liên kết web hoặc `gh codespace ssh`.
Tab "Hoạt động" hiện trạng thái Codespace và sự kiện của repo; tab "API GitHub" là bảng tham khảo.
Ứng dụng tạo Codespace với tên bắt đầu bằng vs-, tự dừng sau 30 phút không dùng, tự xóa sau 1 ngày; chỉ quản lý các Codespace như vậy.

## Dùng Codespace từ terminal của bạn
Cài gh trên máy bạn (Termux: `pkg install gh openssh`), rồi `gh auth login`, `gh auth refresh -h github.com -s codespace`,
`gh codespace list`, `gh codespace ssh -c TÊN`. Tab "Hoạt động" hiện sẵn các lệnh với tên Codespace của bạn.
Thư mục .devcontainer cài sẵn gdb, radare2, strace, gcc và Node cho Codespace MỚI tạo.

## SSH vào Codespace ngay trong ứng dụng (thử nghiệm)
Khi `npm install` chạy trên Render (Linux), script scripts/install-gh.js tải gh vào thư mục bin/. Backend dùng GITHUB_TOKEN để chạy
`gh cs ssh --config` (tạo khóa) rồi `gh cs ssh --stdio` làm đường hầm cho ssh2, nên tab "SSH thật" vào được Codespace mà không cần dán khóa riêng.
Nếu log Render có dòng "Bỏ qua cài gh", gh chưa được cài và tính năng này không chạy.

## Lưu cơ sở dữ liệu trên Neon
Đặt DATABASE_URL (chuỗi kết nối Postgres của Neon, có sslmode=require) trên Render. Ứng dụng tự tạo bảng app_state.
Tab "Cơ sở dữ liệu" có nút Tải từ Neon / Lưu lên Neon và ô tự lưu. Chỉ lưu thông số cloud/config, không lưu token hay khóa riêng.
Ghi đè kiểu "bản ghi sau thắng": nếu hai thiết bị cùng sửa, bản lưu sau cùng sẽ thay bản trước.
