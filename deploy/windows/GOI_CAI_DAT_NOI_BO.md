# Gói cài đặt QLBS Kiosk một lần cho mạng nội bộ

Tài liệu này dùng khi QLBV chạy bằng HTTPS trên IP nội bộ với certificate tự ký, ví dụ `https://172.16.13.75:3000`.

Mục tiêu: CNTT tạo **một gói riêng đã kiểm tra certificate** cho từng phòng/server; tại mỗi PC chỉ cần giải nén và chạy `cai_dat_kiosk.bat`. Gói không tải certificate từ mạng, không tắt kiểm tra TLS của Windows và không chứa private key.

## 1. Lấy đúng public certificate từ server

Trên server QLBV, lấy **chỉ** public certificate:

```bash
cd /opt/qlbs
sudo install -m 0644 data/ssl/server.crt /tmp/QLBS_Server_Trust.cer
sudo openssl x509 -in data/ssl/server.crt -noout -fingerprint -sha256 -subject -issuer -dates -ext subjectAltName
```

Chép `/tmp/QLBS_Server_Trust.cer` sang PC CNTT qua kênh đã xác thực (USB CNTT, share nội bộ được bảo vệ...). Đối chiếu SHA-256 trước khi dùng.

**Không chép, không gửi, không đóng gói** `data/ssl/server.key` hoặc bất kỳ PFX có private key nào.

Certificate phải còn hạn và SAN phải chứa đúng IP/hostname sẽ nhập cho Kiosk, ví dụ `IP:172.16.13.75`.

## 2. Tạo gói riêng cho phòng

1. Tải đúng asset `QLBS_Kiosk_2.0.5.zip`, kiểm tra checksum rồi giải nén trên một PC CNTT tin cậy.
2. Mở PowerShell tại thư mục vừa giải nén và chạy, thay URL/phòng/đường dẫn certificate đúng thực tế:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tao_goi_cai_dat_kiosk.ps1 `
  -Server https://172.16.13.75:3000 `
  -Room P2 `
  -Certificate C:\CNTT\QLBS_Server_Trust.cer
```

Script tạo `QLBS_Kiosk_P2_MotLan.zip`. Bên trong gồm EXE, script cài đặt, public certificate, SHA-256 pin và cấu hình phòng. Không chứa private key.

Nếu server/origin dùng certificate khác hoặc đổi IP, tạo gói mới; không sửa tay certificate hay file INI của gói đã tạo.

## 3. Cài ở mỗi máy trạm

1. Chép ZIP qua kênh CNTT tin cậy, giải nén cục bộ.
2. Có thể đối chiếu `SHA256SUMS.txt` trong gói.
3. Nhấp phải `cai_dat_kiosk.bat` → **Run as administrator**; chấp nhận UAC.
4. Script kiểm tra hash, hạn và SAN certificate; cài public certificate vào `Local Computer → Trusted Root Certification Authorities`; sau đó QLBS Kiosk tự preflight server/phòng trước khi thay đổi cấu hình máy trạm.
5. Nếu preflight thất bại, Kiosk không thay đổi cấu hình startup/terminal hiện hữu. Kiểm tra đúng mạng, URL HTTPS, port và room code.

Mỗi PC tạo terminal ID riêng. Không sao chép `%ProgramData%\QLBS\Kiosk\config.ini` giữa các máy.

## 4. Phạm vi và an toàn

- Cách này làm Windows Kiosk tin certificate tự ký đã được CNTT đối chiếu. Nó **không** làm Safari/iPhone tự tin certificate; iPhone vẫn cần CA tin cậy hoặc hostname có SSL công khai.
- Không dùng certificate tải trực tiếp qua URL khi certificate chưa được tin cậy: cách đó có thể bị giả mạo trên LAN.
- Không dùng `-k`, callback chấp nhận mọi certificate, hoặc HTTP để lách lỗi TLS.
- Khi chuyển sang hostname có Let’s Encrypt/CA tin cậy, tạo gói mới với origin/certificate mới; Kiosk vẫn dùng kiểm tra TLS chuẩn.
