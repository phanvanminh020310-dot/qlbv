# QLBS Kiosk 2.0.6 — phạm vi thay đổi và nghiệm thu bắt buộc

## Chính sách đã chốt

- Kiosk chạy qua HKLM Run cho **mọi** tài khoản Windows tương tác, gồm Administrator cục bộ/domain và token UAC filtered. Không có bypass theo SID, tên tài khoản hoặc nhóm Administrators.
- Một khóa chỉ được hiện khi API đang truy cập được và đối soát lịch đã công bố/chốt xác nhận phòng có người được phân công trong **khung giờ ca đang diễn ra**.
- Không dùng ca sắp tới, early check-in, grace sau ca, lease giữa hai ca hay lịch cache để khóa. Không có ca hiện tại hoặc không thể đối soát mạng/server thì Desktop phải được giải phóng ngay.
- QR chỉ tồn tại trong lúc ca hiện tại cần khóa. PIN IT/hotkey vẫn online-only và cũng bị giới hạn trong ca hiện tại; không có PIN local/offline hoặc mã mặc định trong EXE.
- Kiosk vẫn là WinForms native; keyboard hook chỉ hoạt động khi trạng thái online đã xác nhận cần khóa. Bỏ dòng “Không cần camera máy tính · Không yêu cầu GPS” dưới QR.

## Bằng chứng tự động

1. `tests/test_pin_scope.py` kiểm tra version 2.0.6, không còn `AccountPolicy`/token-SID bypass, trạng thái `kioskRequired`, desktop release khi không có ca và khi offline, QR subtitle đã bỏ; đồng thời kiểm tra gói cài một lần pin SHA-256 public certificate, chỉ trust qua LocalMachine Root, không tải certificate từ LAN và không bỏ TLS validation.
2. Native self-test kiểm tra JSON nghiêm ngặt, terminal isolation, QR scan overlay, chuyển trạng thái ca hiện tại → mở Desktop, offline release, bàn phím và ma trận QR v1–v40.
3. Backend regression kiểm tra roster published/exact time, không QR khi không có ca, hết ca, lỗi đối soát, PIN IT chỉ trong ca, và QR/face không vượt hết ca.
4. Frontend typecheck/build kiểm tra debounce tìm người trực và phân trang độc lập danh sách kỳ lịch / ô trực.

## Nghiệm thu vật lý tại viện

CI không thay thế kiểm thử máy thật. Trên ít nhất hai PC (có một tài khoản Administrator), xác nhận:

- [ ] Có ca đang diễn ra và mạng tốt: Kiosk khóa, QR/face đúng máy trạm mới mở được.
- [ ] Trước giờ ca, sau giờ ca, ca nháp, bác sĩ nghỉ phép và phòng không có ca: Desktop luôn mở, không có QR.
- [ ] Ca kết thúc lúc 17:00 không có ca đang diễn ra tiếp theo: Desktop mở; khi ca mới thực sự bắt đầu và API đối soát được thì khóa lại.
- [ ] Rút/cắm LAN, dừng API, DNS/TLS lỗi, restart API, boot chưa mạng, sleep/resume: Kiosk giải phóng Desktop ngay; PIN IT không thể bypass offline.
- [ ] Đăng nhập Administrator: nhận đúng cùng chính sách, không cần đổi sang User thường.
- [ ] Kiểm tra hotkey/PIN rate-limit, DPI, nhiều màn hình, QR TTL/buffer, AI/PAD thật và giả, cài/gỡ/cập nhật giữ config/terminal ID.

Các release cũ là tài sản lịch sử; phát hành thay đổi chính sách này bằng tag/asset mới `kiosk-v2.0.6`, không ghi đè release cũ.
