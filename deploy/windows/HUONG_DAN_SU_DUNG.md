# Hướng Dẫn Cài Đặt & Quản Lý Kiosk Phòng Khám — Bệnh Viện Quân Y 4

Thư mục này đã được tinh giản tối đa thành đúng **2 file kịch bản tự động hóa**:
1. 👉 **`cai_dat_kiosk.bat`**: Cài đặt trọn gói từ A đến Z cho máy tính phòng khám.
2. 👉 **`go_bo_kiosk.bat`**: Gỡ bỏ triệt để và khôi phục máy tính về Windows mặc định (dành cho IT).

---

## 1. Hướng Dẫn Cài Đặt Mới (`cai_dat_kiosk.bat`)
Thực hiện một lần duy nhất trên mỗi máy tính phòng khám:

1. Copy thư mục `windows/` (hoặc 2 file `.bat`) vào máy tính phòng khám (hoặc cắm USB).
2. Nhấp chuột phải vào file **`cai_dat_kiosk.bat`** ➔ Chọn **Run as administrator** (Bắt buộc).
3. Cửa sổ cài đặt hiện lên:
   - Nhập **IP Máy chủ QLBV** (vd: `192.168.1.50` - nhấn `Enter` để lấy mặc định).
   - Nhập **Cổng dịch vụ** (mặc định: `3000`).
   - Nhập **Mã phòng khám** của máy này (vd: `PK01`, `PK02`, `PK03`...).
4. Quá trình tự động thực hiện hoàn toàn trong 5 giây:
   - ✅ Tự động phát hiện Microsoft Edge hoặc Google Chrome.
   - ✅ Tạo thư mục bảo mật `C:\ProgramData\QLBS_Kiosk`.
   - ✅ Phân quyền NTFS (`icacls`): Chống người dùng thông thường xóa hoặc sửa tệp Kiosk vĩnh viễn.
   - ✅ Khóa toàn diện bàn phím (`Win + D`, `Win + R`, `Ctrl + Shift + Esc`, Task Manager, phím Shift 5 lần, cử chỉ vuốt mép màn hình cảm ứng).
   - ✅ Đăng ký khởi động ngầm cùng máy tính (Task Scheduler + HKLM Run).
   - ✅ Kích hoạt Kiosk toàn màn hình che taskbar ngay lập tức.

---

## 2. Cơ Chế Hoạt Động Thông Minh Trong Ca Trực
- **Khi máy đang khóa:** Kiosk phủ kín 100% màn hình, hiển thị mã QR động để bác sĩ quét mặt. Toàn bộ phím tắt Windows bị khóa để chống can thiệp.
- **Khi Bác sĩ quét mặt thành công:** Kiosk tự động thu nhỏ xuống thanh Taskbar, **giải phóng 100% màn hình Desktop** (không hiện bất kỳ màn hình xanh nào che khuất), bác sĩ sử dụng mượt mà các ứng dụng Windows (HIS, PACS, Word, v.v.).
- **Tự động khóa máy khi qua ca:** Khi ca trực của bác sĩ kết thúc và **quá thời gian ân hạn sau ca trực** (`kiosk.lateCheckoutMinutes`, ví dụ: 30 phút), hệ thống tự động khóa lại toàn màn hình và nạp mã QR mới cho bác sĩ ca tiếp theo (phòng ngừa bác sĩ ca trước quên bấm nút khóa).

---

## 3. Hướng Dẫn Gỡ Bỏ Triệt Để Khi Cần Bảo Trì (`go_bo_kiosk.bat`)
Khi bộ phận IT cần chuyển đổi mục đích sử dụng máy tính hoặc cài lại phần mềm:

1. Nhấp chuột phải vào file **`go_bo_kiosk.bat`** ➔ Chọn **Run as administrator**.
2. Kịch bản sẽ tự động:
   - 🛑 Dừng toàn bộ tiến trình Kiosk và đóng trình duyệt.
   - 🗑️ Xóa sạch tác vụ Task Scheduler và khóa Registry Run.
   - 🔓 Khôi phục toàn bộ bàn phím, mở lại `Win + D`, mở lại Task Manager (`Ctrl + Shift + Esc`).
   - 🧹 Mở quyền NTFS và xóa sạch thư mục `C:\ProgramData\QLBS_Kiosk`.
   - 🔄 Nạp lại Windows Explorer để máy tính trở về trạng thái nguyên bản 100%.
