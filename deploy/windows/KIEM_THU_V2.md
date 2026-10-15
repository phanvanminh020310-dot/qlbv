# QLBS Kiosk 2.0.0 — Kết quả kiểm thử và bàn giao

**Ngày kiểm tra: 15/10/2026 · Nền mã trước thay đổi: `5848d1a`**

## Kết luận

Mã nguồn ứng dụng WinForms độc lập, API v2, trang điện thoại, hai bộ cài/cứu hộ và tài liệu đã được triển khai. Các kiểm tra tự động bên dưới đã chạy thành công trên Linux. **Chưa có kết quả nghiệm thu trên Windows thật, điện thoại thật hoặc AI thật trong phiên này.** Không coi báo cáo này là chứng nhận an toàn Windows hoặc giấy phép triển khai lâm sàng không cần nghiệm thu.

Gói được tạo tại phiên này dùng EXE .NET biên dịch bằng **Mono C# 5 trên Linux**, không phải EXE đã qua build/kiểm thử Windows. Workflow Windows đã được chuẩn bị và kiểm tra cú pháp; chỉ log của lần workflow chạy thành công mới xác nhận compiler .NET Framework Windows và các bước CI tương ứng.

## 1. Kiểm tra đã chạy

| Hạng mục | Kết quả | Giới hạn |
|---|---|---|
| Backend `npm run typecheck` | Đạt | Kiểm tra kiểu TypeScript |
| Backend `npm test` | **56/56 đạt**, không bỏ qua | Bao gồm bài test cũ và test Kiosk mới |
| Backend `npm run build` | Đạt | NestJS production build; không phải nghiệm thu VPS đang vận hành |
| Frontend `npm run typecheck` | Đạt | Chạy riêng, không dựa vào cấu hình Next bỏ qua typecheck khi build |
| Frontend `npm run build` | Đạt | Next.js production build, 43 trang tĩnh và các route động |
| Native `mcs -langversion:5 -warnaserror+` | Đạt, không cảnh báo | Mono, không phải compiler Windows |
| Native `/self-test` | Đạt | Cấu hình, JSON, server clock, SSE, state scan/lease, terminal, chính sách PIN |
| Đối chiếu QR độc lập | **40/40 phiên bản đạt** | ECC M, byte UTF-8, dùng mask do native chọn; so sánh từng module với `node-qrcode` |
| Giải mã bằng OpenCV | Đạt 4 URL mẫu và QR trong ảnh WinForms thật | Không thay thế quét bằng camera điện thoại thật |
| Ảnh WinForms trạng thái đã quét | Không còn QR giải mã được; nền trắng đục | Render off-screen bằng Mono/Xvfb, 1366×768 |
| PowerShell parser | Đạt script cứu hộ nhúng, 3 lệnh BAT và lệnh xoá chậm native | PowerShell 7.6.7/Linux; không thực thi registry/UAC Windows |
| Hàng rào xoá chậm sau uninstall | Đạt: có dấu thì xoá, dấu đã huỷ thì giữ bản mới | Chạy đúng lệnh native với thư mục fixture Linux ngẫu nhiên; không phải toàn bộ uninstaller Windows |
| Workflow GitHub Actions | `actionlint` 1.7.12 đạt | **Workflow chưa chạy trong phiên này** |
| `git diff --check` | Đạt | Kiểm tra whitespace và lỗi bản vá |

Build được chạy lại tuần tự với giới hạn bộ nhớ sau khi lần chạy song song đầu tiên gây thiếu RAM trên sandbox 2 GB. Kết quả build cuối cùng backend/frontend đều trả mã **0**.

### Tích hợp PostgreSQL/Drizzle

`backend/test/kiosk-postgres.test.ts` chạy PostgreSQL nhúng **PGlite**, áp dụng migration sản xuất và dùng Drizzle cùng `IntegrationDutyService` thật. Năm tình huống tích hợp đều đạt:

1. Chỉ lấy đúng phòng, đúng lịch đã công bố/chốt; `PK01` không khớp `PK010`, phòng lạ không nhận QR.
2. Hai yêu cầu xác thực đồng thời chỉ ghi một lượt điểm danh, gắn đúng ô lịch/phòng và mở đúng terminal phát QR.
3. Thêm nghỉ phép thu hồi lease đã mở; ca đêm xét cả ngày kết thúc.
4. Kết quả AI về sau thời hạn không ghi điểm danh, không mở Desktop.
5. Xoá phân công được phản ánh mà không restart máy trạm/backend.

**AI được giả lập trong các bài này.** PGlite dùng engine PostgreSQL, nhưng không thay thế kiểm thử kết nối/TLS/pool/migration trên PostgreSQL VPS thật.

### Hồi quy an toàn đáng chú ý

- Terminal trống của browser cũ không trở thành wildcard cho các PC native.
- Không broadcast sự kiện mở khoá khi terminal đích đang offline.
- Tải lại/reconnect không cấp thêm thời gian xác thực và không làm lộ QR đang che.
- Hai điện thoại tranh cùng QR không cùng được dùng phiên; thiếu claim token bị từ chối.
- Xoá/sửa lịch hoặc hết ca + grace thu hồi lease đúng đích.
- Không còn mật khẩu IT dự phòng cố định trong luồng xác minh mới; chỉ dùng PIN được cấu hình.
- Thử PIN sai bị giới hạn; CNTT nhập đúng ở nhiều máy sau một IP bệnh viện không bị khoá nhầm sau năm lần hỗ trợ hợp lệ.
- Toggle cho phép tự đổi ảnh xử lý cả boolean và các giá trị chuỗi cũ.

## 2. Phần đã triển khai nhưng còn cần Windows nghiệm thu

- Cài/UAC, ACL/owner Program Files và ProgramData, tự chạy HKLM bằng tài khoản người dùng.
- Đổi EXE/cấu hình, rollback, giữ terminal ID khi cài lại cùng phòng, chuyển từ Agent cũ.
- Khoá liên tiến trình chung cho cài/gỡ; dấu nhận diện ngăn tác vụ gỡ cũ xoá nhầm bản mới.
- Hook `WH_KEYBOARD_LL`, nhập PIN, hotkey, key-up của phím được giữ qua thời điểm khoá/mở.
- Ẩn mọi cửa sổ khi lease hợp lệ, không tray/taskbar/dock/badge, không tự bật HIS.
- Startup chưa có LAN, reconnect, sleep/resume, DPI, nhiều màn hình và cắm/rút màn hình.
- Hai BAT trên `cmd.exe`/Windows PowerShell 5.1, đường dẫn có dấu/khoảng trắng, cài từ USB chỉ đọc.
- Gỡ mặc định, `/purge`, chạy lại cứu hộ hai lần và cài lại ngay sau gỡ.

Checklist chi tiết nằm trong [HUONG_DAN_SU_DUNG.md](HUONG_DAN_SU_DUNG.md), mục 9. Nên nghiệm thu ít nhất hai PC và hai điện thoại trước khi triển khai nhiều phòng.

## 3. Điều kiện triển khai bắt buộc

1. **Cập nhật API v2 trên VPS 1 trước** khi dùng EXE mới. Không chạy chỉ bộ cài máy trạm với backend cũ; bộ cài sẽ từ chối giao thức không phù hợp.
2. Đặt PIN riêng; kiểm tra QR TTL, buffer và grace theo quy định viện.
3. PC/điện thoại cùng origin web QLBV; cấu hình HTTPS hợp lệ và mạng/firewall/VLAN bệnh viện. Không công khai API Kiosk ra Internet.
4. Giữ **một tiến trình API phục vụ trạng thái Kiosk**. Chưa có state/lease/SSE dùng chung để scale nhiều replica. API restart làm khoá lại để xác thực mới.
5. VPS 2 tiếp tục chạy dịch vụ AI hiện có; phải nghiệm thu PAD, nhận diện và tải đồng thời bằng thiết bị/model thật.
6. EXE tại phiên này **chưa ký Authenticode**. Đối chiếu SHA-256; dùng chứng thư của đơn vị để ký trước phân phối nếu chính sách yêu cầu. Không tắt Defender/SmartScreen toàn hệ thống.

## 4. Không cam kết vượt khả năng kỹ thuật

`WH_KEYBOARD_LL` là hook **user-mode**, không phải driver. Không thể chặn `Ctrl+Alt+Del`, quản trị viên, Safe Mode hoặc thay thế Windows secure desktop bằng WinForms. HKLM Run không bảo đảm không có khoảng hở sau đăng nhập hoặc khi tiến trình hỏng. Các chính sách OS và tài khoản tiêu chuẩn phải do CNTT quản trị riêng.

Phát hiện WebView/ứng dụng quét chỉ là heuristic, không chứng minh mật mã rằng QR do Camera mặc định quét trực tiếp. Việc dùng PAD không tự đồng nghĩa có chứng nhận ISO 30107 từ phòng kiểm định.
