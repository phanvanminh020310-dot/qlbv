# QLBS Kiosk 2.0.3 — phạm vi thay đổi và nghiệm thu bắt buộc

## Chính sách đã chốt

- Kiosk chạy từ mục Run toàn máy nhưng **chỉ phủ/khoá Desktop của tài khoản Windows thường**. Tài khoản có SID nhóm built-in **Administrators** (`S-1-5-32-544`) kết thúc trước khi nạp cấu hình, tạo hook bàn phím, gọi mạng hoặc mở cửa sổ. Nhận diện bằng group SID, không theo tên tài khoản; token UAC bị lọc (deny-only) vẫn được coi là Administrator.
- Cài đặt/gỡ vẫn bắt buộc UAC Administrator. Không thêm PIN offline/local, không tạo browser/WebView, không thay certificate pin hay cấu hình URL/phòng P2.
- Đây là thay đổi chính sách so với bản 2.0.2 all-account. Chỉ IT được ủy quyền mới được cấp Administrator; bác sĩ sử dụng User thường. Nếu NIC của PC lỗi, IT đăng nhập Administrator để sửa rồi đăng xuất về User/Kiosk.
- PIN IT trực tuyến, QR/face, roster, terminal binding, keyboard hook của User, chặn shortcut thoát và hành vi desktop sau xác thực giữ nguyên.

## Bằng chứng tự động bắt buộc

1. `tests/test_pin_scope.py` kiểm tra phiên bản 2.0.3, SID Administrators chính xác, xử lý TOKEN_GROUPS deny-only, bypass trước mutex/config/hook/network và không dùng tên đăng nhập.
2. Native self-test kiểm tra TOKEN_GROUPS mô phỏng cho User thường và Administrator deny-only; Windows CI biên dịch C# 5/.NET Framework, chạy self-test, QR fixture và SendInput cho nút IT/hotkey.
3. CI không thay thế nghiệm thu tại viện: thử User thường bị khoá; thử Administrator (cả UAC filtered) không hiện Kiosk; thử sửa adapter mạng rồi đăng xuất Administrator về User để Kiosk chạy lại.

Các release 2.0.0, 2.0.1 và 2.0.2 là tài sản lịch sử bất biến; không ghi đè hay dùng CI của chúng thay cho bản 2.0.3.
