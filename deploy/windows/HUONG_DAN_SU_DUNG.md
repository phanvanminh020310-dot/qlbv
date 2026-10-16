# QLBS Kiosk 2.0.4 — hướng dẫn vận hành

**Cập nhật 16/10/2026 · WinForms native · Bệnh viện quân y 4**

## 1. Quy tắc vận hành

QLBS Kiosk không phân biệt User thường và Administrator khi chạy. Nó chỉ phủ Desktop khi **cả hai** điều kiện đúng:

1. Máy trạm kết nối online được tới API QLBV; và
2. API đối soát lịch đã công bố/chốt thấy phòng đã cấu hình có bác sĩ/nhân viên được phân công trong **ca đang diễn ra**.

Vì vậy, trước ca, sau ca, ca chưa công bố, không có người phân công, bác sĩ nghỉ phép, hoặc không đối soát được mạng/server, Desktop luôn được mở. Không phát QR cho các trường hợp đó. Kiosk không dùng ca sắp tới, early/grace hoặc lease kéo dài sau ca để giữ máy khóa.

Khi ca kết thúc lúc 17:00 và không có ca nào đang diễn ra, Desktop mở ngay. Nếu ca khác bắt đầu đúng lúc đó, lần đối soát online tiếp theo giữ/đưa máy về trạng thái khóa theo ca mới. Khi mất mạng hoặc API lỗi, Kiosk mở Desktop ngay; khi mạng trở lại nó chỉ khóa lại nếu xác nhận được ca hiện tại.

## 2. Chuẩn bị máy chủ

Trên VPS 1, từ repository đang vận hành:

```bash
sudo bash deploy/update.sh
```

Lệnh updater giữ PostgreSQL volume, `.env` và cấu hình hiện hữu; không thay thế chúng bằng tay. Sau cập nhật kiểm tra API bằng `docker compose logs api` nếu cần. Bảo đảm QLBV web origin/HTTPS mà PC và điện thoại dùng được proxy `/api` và `/scan`.

Trong System settings:

- đặt PIN IT riêng;
- đặt QR TTL và buffer xác thực theo quy định viện;
- kiểm tra mã phòng active, lịch đã công bố/chốt, phân công và hồ sơ sinh trắc học.

## 3. Cài hoặc cập nhật PC

1. Tải asset phát hành **`QLBS_Kiosk_2.0.4.zip`** và checksum sau khi tag `kiosk-v2.0.4` được công bố. Không dùng Source code ZIP.
2. Giải nén cục bộ, đối chiếu `Get-FileHash .\QLBS_Kiosk.exe -Algorithm SHA256` với `SHA256SUMS.txt`.
3. Chạy EXE, nhập web origin (ví dụ `https://qlbv.benhvien.vn:3000`) và mã phòng đúng (ví dụ `PK01`). Không nhập URL `/api`, port backend 4000, AI 8001 hay localhost.
4. Bấm kiểm tra kết nối, rồi cài và chấp nhận UAC.

Cài im lặng từ CMD Administrator/SYSTEM:

```bat
QLBS_Kiosk.exe /install /server https://qlbv.benhvien.vn:3000 /room PK01 /quiet /no-start
```

Không sao chép `%ProgramData%\QLBS\Kiosk\config.ini` từ PC này sang PC khác. File chứa terminal ID định danh đích nhận QR/SSE.

## 4. Xác thực trong ca

Khi API xác nhận ca hiện tại, màn hình Kiosk hiển thị QR. Bác sĩ dùng **Camera mặc định** của điện thoại, mở liên kết bằng trình duyệt hệ thống, cho phép camera trước và hoàn tất PAD/face. QR ngắn hạn, đã quét sẽ che ngay; chỉ máy trạm/terminal đã phát QR nhận được mở khóa. Mở khóa trả Desktop, không tự khởi chạy HIS.

Nếu ca đã hết trong lúc chụp/xử lý, server từ chối kết quả và Desktop được giải phóng theo chính sách ca hiện tại; không dùng ân hạn để mở sau ca.

## 5. Hỗ trợ IT

Khi Kiosk đang khóa, dùng nút **Hỗ trợ CNTT** hoặc `Ctrl+Alt+Shift+F12`. PIN được xác minh online, rate-limit/audit theo server và chỉ tạo phiên đến hết ca hiện tại. PIN không hoạt động khi không có ca hoặc server không thể đối soát. Không có PIN offline/local, mã khôi phục hay mật khẩu mặc định trong EXE.

Khi mất mạng/API, không cần chuyển sang Administrator hoặc gỡ Kiosk để sửa NIC, DNS, chứng chỉ hay cáp: Desktop đã tự mở. Sửa xong, Kiosk tự đối soát lại. Tài khoản Administrator vẫn phải có UAC để cài/gỡ nhưng chịu cùng chính sách runtime như mọi tài khoản khác.

## 6. Gỡ

```bat
go_bo_kiosk.bat
rem hoặc:
"%ProgramFiles%\QLBS Kiosk\QLBS_Kiosk.exe" /uninstall
```

`/purge` chỉ dùng khi phải hủy hẳn terminal ID/cấu hình. Cập nhật bình thường giữ cấu hình và terminal ID.

## 7. Xử lý nhanh

| Triệu chứng | Cách xử lý |
|---|---|
| Không có QR, Desktop mở | Đây là đúng nếu không có ca đang diễn ra hoặc API không đối soát được. Kiểm tra room code, publish/chốt, phân công, nghỉ phép và API/network. |
| Có ca nhưng Kiosk không khóa | Kiểm tra QLBV API, giờ ca/timezone, room/terminal và trạng thái published/locked. Không tự đặt lại giờ PC để né đối soát. |
| Mạng mất, Desktop mở | Đúng chính sách. PIN IT cũng không mở offline. Khôi phục mạng/API; chỉ ca hiện tại đã xác nhận mới đưa Kiosk trở lại. |
| QR/face bị từ chối | Kiểm tra hồ sơ khuôn mặt, phân công đúng phòng/ca, nghỉ phép, PAD và hạn QR/buffer. |
| Administrator vẫn thấy Kiosk | Đúng chính sách 2.0.4 nếu ca hiện tại được API xác nhận. Không đổi tài khoản để tránh Kiosk. |
| Cài/gỡ báo thiếu quyền | Mở bằng UAC Administrator; `/quiet` không tự nâng quyền. |

## 8. Nghiệm thu

Thực hiện checklist trong [KIEM_THU_V2.md](KIEM_THU_V2.md), đặc biệt các tình huống hết ca 17:00, rút/cắm mạng, restart API, sleep/resume, và đăng nhập bằng Administrator. Giới hạn WinForms hook vẫn giữ nguyên: nó không thay thế Windows secure desktop, `Ctrl+Alt+Del`, Safe Mode, quản trị miền hoặc biện pháp bảo mật vật lý.
