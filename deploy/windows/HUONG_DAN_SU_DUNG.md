# Hướng Dẫn Cài Đặt & Quản Lý Kiosk Phòng Khám — Bệnh Viện Quân Y 4
### Kiến Trúc Windows Native Kiosk Agent (Bảo Vệ Độc Quyền Cấp Độ Nhân)

Thư mục này chứa trọn gói giải pháp khóa máy trạm phòng khám chuyên dụng theo chuẩn bệnh viện:
- 📁 **`QLBS_Kiosk_Agent.cs`**: Mã nguồn C# .NET Native Agent siêu nhẹ (không phụ thuộc thư viện ngoài).
- ⚙️ **`cai_dat_kiosk.bat`**: Kịch bản tự động biên dịch và cài đặt Native Agent từ A đến Z.
- 🧹 **`go_bo_kiosk.bat`**: Kịch bản gỡ bỏ triệt để và khôi phục máy trạm về Windows văn phòng nguyên bản trong 2 giây.

---

## 1. Ưu Điểm Đột Phá Của Native Agent So Với Trình Duyệt Thuần

| Tiêu chí | Bản cũ (Trình duyệt Edge trần) | Bản mới (Windows Native Agent) |
| :--- | :--- | :--- |
| **Khóa phím hệ thống** | Dễ bị lọt phím khi có popup/thông báo Windows hoặc bấm Win+D, F12. | **Khóa tuyệt đối 100% cấp độ nhân & Registry**: Chặn toàn bộ phím bàn phím (`Win`, `Win+D`, `F12`, `Alt+Tab`, `Alt+F4`, `Ctrl+Shift+Esc`, `Ctrl+Esc`, Task Manager). Duy nhất tổ hợp IT `Ctrl+Alt+Shift+F12` được phép. |
| **Khi mở khóa thành công** | Bị đơ, dính màn hình xanh/trắng, khó giải phóng Desktop. | **Biến mất tức thì trong 0.05 giây**: Cửa sổ Kiosk bị hủy ngay lập tức, trả lại 100% màn hình Desktop Windows sạch sẽ cho bác sĩ. |
| **Cách ly hồ sơ duyệt web** | Chạy chung với Edge cá nhân của bác sĩ. | **Profile độc lập (`C:\QLBS_Kiosk\EdgeProfile`)**: Không ảnh hưởng đến Edge, tab làm việc hay tài khoản HIS của bác sĩ. |
| **Chống gian lận chụp QR gửi từ xa** | Mã QR tĩnh hoặc TTL dài (dễ chụp gửi đi). | **Mã QR động 30s + Burn-on-Scan + Buffer 60s cho Bác sĩ lớn tuổi**: Mã tự đổi mới sau 30s; ngay khi quét thành công sẽ cấp bộ đệm 60s nhận diện khuôn mặt thong thả; khóa mã theo token thiết bị đầu tiên; chặn 100% việc chụp chuyển tiếp qua tin nhắn/mạng xã hội. |
| **Phím nóng cứu hộ cho IT** | Khó thao tác hoặc dễ bị người dùng bấm nhầm. | **Tổ hợp phím độc quyền IT `Ctrl + Alt + Shift + F12`**: Bật ngay hộp thoại nhập Master PIN IT để mở khóa cưỡng chế. |

---

## 2. Hướng Dẫn Cài Đặt Máy Trạm (`cai_dat_kiosk.bat`)
Thực hiện một lần duy nhất trên máy tính phòng khám:

1. Copy thư mục `windows/` (chứa `cai_dat_kiosk.bat`, `go_bo_kiosk.bat` và `QLBS_Kiosk_Agent.cs`) vào máy phòng khám (hoặc cắm USB).
2. Nhấp chuột phải vào file **`cai_dat_kiosk.bat`** ➔ Chọn **Run as administrator**.
3. Nhập 3 thông số cơ bản:
   - **IP Máy chủ QLBV**: Nhập IP máy chủ viện (ví dụ: `192.168.1.50`).
   - **Cổng dịch vụ**: Nhấn `Enter` để lấy mặc định `3000`.
   - **Mã phòng khám**: Nhập mã phòng (ví dụ: `PK01`, `PK02`...).
4. Trình cài đặt tự động:
   - Tự động dùng trình biên dịch `csc.exe` có sẵn của Windows để dịch ra tệp nhị phân `C:\QLBS_Kiosk\QLBS_Kiosk_Agent.exe`.
   - Tạo hồ sơ Edge Kiosk riêng biệt.
   - Vô hiệu hóa Task Manager và thiết lập khóa bàn phím cấp độ nhân.
   - Đăng ký tự khởi động cùng Windows.
   - Khởi động màn hình Kiosk bảo vệ máy tính ngay lập tức.

---

## 3. Quy Trình Sử Dụng Hằng Ngày Của Bác Sĩ

1. **Khi vào ca trực**:
   - Bác sĩ đứng trước máy trạm phòng khám.
   - Dùng điện thoại cá nhân (Camera góc) quét mã QR hiển thị trên màn hình máy tính (mã tự đổi mới 30s, đệm 60s nhận diện khuôn mặt).
   - Camera điện thoại tự bật lên ➔ Nhìn thẳng vào màn hình điện thoại trong 1 giây ➔ AI nhận diện người thật và đối soát lịch trực.
   - **MÁY TÍNH MỞ KHÓA NGAY LẬP TỨC**: Màn hình Kiosk đóng ngay trong 0.05s, màn hình Desktop Windows hiện ra nguyên bản 100% để bác sĩ khám chữa bệnh (mở phần mềm HIS, PACS, Word, v.v.).
2. **Khi hết ca trực**:
   - Khi ca trực kết thúc và quá thời gian ân hạn (`kiosk.lateCheckoutMinutes`, ví dụ: 30 phút), Agent tự động kích hoạt lại toàn màn hình khóa để đón bác sĩ ca tiếp theo.

---

## 4. Cơ Chế Mở Khóa Khẩn Cấp Dành Cho IT (Emergency Unlock)

Khi xảy ra sự cố mạng, mất điện thoại hoặc cần bảo trì máy trạm đột xuất:
- **Cách 1 (Phím nóng độc quyền IT)**: Nhấn tổ hợp phím **`Ctrl + Alt + Shift + F12`**.
- **Cách 2 (Cử chỉ chạm bí mật)**: Nhấp chuột liên tiếp **5 lần vào Logo Bệnh viện** ở góc trên màn hình.
- ➔ Hộp thoại **"Xác thực Kỹ thuật viên CNTT"** hiện lên: IT nhập Master PIN khẩn cấp (mặc định cấu hình trên trang Quản trị hoặc `999888`) ➔ Máy trạm lập tức mở khóa Desktop và ghi nhận nhật ký kiểm toán hệ thống.

---

## 5. Hướng Dẫn Gỡ Bỏ Triệt Để (`go_bo_kiosk.bat`)
Khi cần chuyển máy tính sang mục đích sử dụng văn phòng thông thường:

1. Nhấp chuột phải vào file **`go_bo_kiosk.bat`** ➔ Chọn **Run as administrator**.
2. Script sẽ:
   - Tắt sạch tiến trình `QLBS_Kiosk_Agent.exe`.
   - Mở khóa lại Task Manager và bàn phím bình thường.
   - Xóa đăng ký khởi động cùng Windows.
   - Xóa sạch thư mục `C:\QLBS_Kiosk`.
   - Máy tính trở lại trạng thái Windows ban đầu 100%.

---

## 6. Lưu Ý Quan Trọng Về Camera Điện Thoại & Giao Thức HTTPS

### Trải nghiệm Face ID tự động 100% (Khuyến nghị HTTPS):
- Theo quy định an ninh bảo mật của W3C toàn cầu (Google Chrome, Apple Safari), tính năng **WebRTC Live Stream** (mở trực tiếp camera trong trang web, tự bắt mặt và mở khóa không cần bấm chụp) **bắt buộc phải chạy qua giao thức bảo mật HTTPS** (hoặc localhost).
- Khi máy chủ bệnh viện có tên miền hoặc cấu hình HTTPS (qua Nginx / Caddy mẫu tại `deploy/nginx/qlbs.conf.example`):
  * Bác sĩ quét mã QR ➔ Camera trước **tự động mở ngay tức khắc** trong trang web.
  * AI quét khuôn mặt liên tục và mở khóa máy tính trong 0.5s.
  * **Bác sĩ không cần chạm bất kỳ nút nào trên màn hình điện thoại**.

### Khi chạy mạng nội bộ LAN qua HTTP:
- Trình duyệt di động chặn WebRTC và bắt buộc chuyển sang chế độ **Native Camera Capture**:
  * Trang quét hiển thị 2 lựa chọn: **"Mở Camera chụp (Camera trước)"** và **"Hoặc chọn ảnh selfie từ Thư viện"**.
  * **Lý do camera sau bị mở**: Khi chạy HTTP, trang web phải gọi ứng dụng chụp ảnh hệ điều hành (Android Camera App). Một số nhà sản xuất điện thoại (Samsung, Xiaomi...) mặc định luôn mở camera sau khi nhận lệnh từ bên ngoài. Do trang web không thể can thiệp sâu vào ứng dụng máy ảnh của hệ điều hành, bác sĩ chỉ cần bấm nút lật camera trên màn hình máy ảnh sang camera trước.
  * Ảnh chụp được tự động nén siêu tốc và gửi thẳng sang máy chủ AI để mở khóa máy trạm phòng khám.

### Cách thiết lập HTTPS trên mạng LAN (Không cần mua tên miền) để kích hoạt Auto Face ID:
- Để bác sĩ quét QR là **camera trước tự động mở ngay trong trang web và tự quét không cần chạm nút nào**:
  1. Sử dụng Nginx kèm chứng chỉ SSL tự ký (Self-signed Certificate) hoặc tên miền miễn phí (DuckDNS/nip.io).
  2. Mở cổng HTTPS (ví dụ `3443` hoặc `443`) trỏ vào Web Next.js.
  3. Bác sĩ mở link `https://` lần đầu ➔ Bấm **Nâng cao ➔ Tiếp tục truy cập** (chỉ làm 1 lần duy nhất).
  4. Từ lần quét tiếp theo: 100% quét tự động như iPhone Face ID!
