# QLBS Kiosk 2.0.2 — gói cũ chỉ sửa nhập PIN CNTT

## Phạm vi theo yêu cầu chốt lại

- Lấy **mã nguồn trong gói P2 MotLan 2.0.0 đã chấp nhận**, không lấy bản bỏ qua Administrator làm nền. Giữ khóa mọi tài khoản, cả Administrator.
- Chỉ thay phần focus/modal/modifier liên quan nhập PIN trong KioskContext, KeyboardGuard, ItDialog. Giữ nguyên phần xác minh PIN/mở khóa server, hook chặn phím thoát, mạng/lease/desktop, installer, QR, UI và toàn bộ mã khác; chỉ đổi metadata phiên bản thành 2.0.2 để không thay tài sản đã phát hành.
- `tests/test_pin_scope.py` dùng digest nguồn 2.0.0 để kiểm chứng phần không đổi, startup không có miễn trừ Administrator, logic xác minh PIN/hook/mạng/lease không bị sửa. Không phụ thuộc file riêng của viện hoặc mạng.
- Gate Windows biên dịch đúng C# 5/.NET Framework, self-test và đối chiếu 40 phiên bản QR; fixture SendInput chạy production KioskContext/modal/WH_KEYBOARD_LL qua cả nút IT và Ctrl+Alt+Shift+F12, thử số/numpad/backspace/Ctrl+A và các escape bị chặn. Fixture chỉ tắt worker mạng bằng symbol compile-time; EXE phân phối không có symbol này.
- Bằng chứng của **chính EXE 2.0.2** nằm trong CI/release-notes và commit ở BUILD_INFO. Kết quả 2.0.0/2.0.1 không được dùng thay cho kiểm thử 2.0.2.

## Nghiệm thu tại viện

1. Dùng User và Administrator: cả hai đều áp dụng Kiosk. Không coi đăng nhập Administrator là đường bỏ qua khóa.
2. Nhấn nút IT, gõ PIN bằng bàn phím thật, thử sửa/xóa/numpad; làm lại qua hotkey. PIN đúng server xác nhận mới mở Desktop; PIN sai/hủy vẫn khóa, các phím thoát vẫn bị chặn.
3. Giữ đúng quy trình cũ giải nén → một BAT → UAC → Enter. Cài/gỡ cần Administrator; có phương án cứu hộ theo hướng dẫn trước triển khai hàng loạt.
4. CI không thay thế thử UAC/ACL, bàn phím vật lý, nhiều màn hình, mạng, camera điện thoại hay AI/PAD thật. Không đổi cấu hình VPS/HTTPS chỉ để sửa PIN.

---

## Hồ sơ 2.0.0 để tham chiếu lịch sử — không phải kết quả 2.0.2

# QLBS Kiosk 2.0.0 — Kết quả kiểm thử và bàn giao

**Cập nhật: 16/10/2026 · Native WinForms 2.0.0 · Nền mã trước thay đổi: `5848d1a`**

## Kết luận hiện tại

**Đã push mã nguồn lên `main` và đã chạy thành công CI backend, frontend và Windows. EXE phát hành được biên dịch bằng compiler .NET Framework trên Windows, không phải bản Mono thử nghiệm.**

- [CI Windows đã đạt trên commit `12a2643`](https://github.com/pvminh94/qlbv/actions/runs/38819103432).
- [Trạng thái workflow mới nhất](https://github.com/pvminh94/qlbv/actions/workflows/kiosk-windows.yml).
- [Tải bộ cài từ GitHub Releases](https://github.com/pvminh94/qlbv/releases/tag/kiosk-v2.0.0).
- [Hướng dẫn cài mới từng bước](HUONG_DAN_SU_DUNG.md).

**Phân biệt:** đã kiểm thử tự động trên Windows runner không đồng nghĩa đã nghiệm thu UAC/ACL/cài-gỡ thật, hook/desktop/DPI/nhiều màn hình trên PC bệnh viện, điện thoại hay model AI/PAD thật. Các phần đó vẫn phải nghiệm thu tại viện; không coi CI là chứng nhận an toàn Windows hoặc chứng nhận ISO.

Báo cáo ngày 15/10 trước đó chỉ có kết quả Mono/Linux. Các dòng “chưa chạy Windows CI” của bản báo cáo cũ đã được thay bằng kết quả Windows thực ngày 16/10 dưới đây. Lần CI đầu dừng do đường dẫn source khi gọi `csc.exe`; đã sửa và chạy lại toàn bộ gate, không bỏ qua bước lỗi.

## 1. Kiểm tra đã chạy

| Hạng mục | Kết quả | Giới hạn |
|---|---|---|
| Backend `npm run typecheck` | Đạt | Kiểm tra kiểu TypeScript |
| Backend `npm test` | **56/56 đạt**, không bỏ qua | Bao gồm bài test cũ và test Kiosk mới |
| Backend `npm run build` | Đạt | NestJS production build; không phải nghiệm thu VPS đang vận hành |
| Frontend `npm run typecheck` | Đạt | Chạy riêng, không dựa vào cấu hình Next bỏ qua typecheck khi build |
| Frontend `npm run build` | Đạt | Next.js production build, 43 trang tĩnh và các route động |
| Native `csc.exe /langversion:5 /warnaserror+` | **Đạt trên Windows**, AnyCPU, không cảnh báo | Compiler .NET Framework đi kèm Windows runner |
| Native `/self-test` | **Đạt trên Windows** | Cấu hình, JSON, server clock, SSE, state scan/lease, terminal, chính sách PIN; chưa thay thế test hook/Desktop tương tác |
| Đối chiếu QR độc lập | **40/40 phiên bản đạt** | ECC M, byte UTF-8, dùng mask do native chọn; so sánh từng module với `node-qrcode` |
| Giải mã bằng OpenCV | Đạt 4 URL mẫu và QR trong ảnh WinForms thật | Không thay thế quét bằng camera điện thoại thật |
| Ảnh WinForms trạng thái đã quét | Không còn QR giải mã được; nền trắng đục | Render off-screen trên Windows, 1366×768; cũng đã thử Mono/Xvfb trước đó |
| PowerShell parser | Đạt script cứu hộ nhúng và lệnh xoá chậm native trên Windows CI; 3 lệnh BAT cũng đã parse trên Linux | Không thực thi gỡ registry/UAC thật |
| Hàng rào xoá chậm sau uninstall | Đạt: có dấu thì xoá, dấu đã huỷ thì giữ bản mới | Đã chạy PowerShell thật trên Windows trong thư mục fixture ngẫu nhiên, không phải toàn bộ uninstaller/cài registry thật |
| Source-only BAT | **Đạt trên Windows** | CMD biên dịch nguồn bằng compiler đi kèm Windows, cấu hình sai bị từ chối trước khi cài |
| Workflow GitHub Actions | **Cả backend, frontend, Windows đạt**; `actionlint` cũng đạt | Log CI nêu trên là chứng cứ; không phải nghiệm thu VPS/PC viện |
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

## 2. Phần còn phải nghiệm thu trên PC Windows của viện

- Cài/UAC, ACL/owner Program Files và ProgramData, tự chạy HKLM bằng tài khoản người dùng.
- Đổi EXE/cấu hình, rollback, giữ terminal ID khi cài lại cùng phòng, chuyển từ Agent cũ.
- Khoá liên tiến trình chung cho cài/gỡ; dấu nhận diện ngăn tác vụ gỡ cũ xoá nhầm bản mới.
- Hook `WH_KEYBOARD_LL`, nhập PIN, hotkey, key-up của phím được giữ qua thời điểm khoá/mở.
- Ẩn mọi cửa sổ khi lease hợp lệ, không tray/taskbar/dock/badge, không tự bật HIS.
- Startup chưa có LAN, reconnect, sleep/resume, DPI, nhiều màn hình và cắm/rút màn hình.
- Đã kiểm tra source-only BAT/fail path và parser trên Windows CI; còn cần cài/gỡ thật qua hai BAT, UAC, đường dẫn có dấu/khoảng trắng, USB chỉ đọc và chính sách Windows PowerShell tại viện.
- Gỡ mặc định, `/purge`, chạy lại cứu hộ hai lần và cài lại ngay sau gỡ.

Checklist chi tiết nằm trong [HUONG_DAN_SU_DUNG.md](HUONG_DAN_SU_DUNG.md), mục 10. Nên nghiệm thu ít nhất hai PC và hai điện thoại trước khi triển khai nhiều phòng.

## 3. Điều kiện triển khai bắt buộc

1. **Cập nhật API v2 trên VPS 1 trước** khi dùng EXE mới. Không chạy chỉ bộ cài máy trạm với backend cũ; bộ cài sẽ từ chối giao thức không phù hợp.
2. Đặt PIN riêng; kiểm tra QR TTL, buffer và grace theo quy định viện.
3. PC/điện thoại cùng origin web QLBV; cấu hình HTTPS hợp lệ và mạng/firewall/VLAN bệnh viện. Không công khai API Kiosk ra Internet.
4. Giữ **một tiến trình API phục vụ trạng thái Kiosk**. Chưa có state/lease/SSE dùng chung để scale nhiều replica. API restart làm khoá lại để xác thực mới.
5. VPS 2 tiếp tục chạy dịch vụ AI hiện có; phải nghiệm thu PAD, nhận diện và tải đồng thời bằng thiết bị/model thật.
6. EXE phát hành **chưa ký Authenticode**. Đối chiếu SHA-256; dùng chứng thư của đơn vị để ký trước phân phối nếu chính sách yêu cầu. Không tắt Defender/SmartScreen toàn hệ thống.

## 4. Không cam kết vượt khả năng kỹ thuật

`WH_KEYBOARD_LL` là hook **user-mode**, không phải driver. Không thể chặn `Ctrl+Alt+Del`, quản trị viên, Safe Mode hoặc thay thế Windows secure desktop bằng WinForms. HKLM Run không bảo đảm không có khoảng hở sau đăng nhập hoặc khi tiến trình hỏng. Các chính sách OS và tài khoản tiêu chuẩn phải do CNTT quản trị riêng.

Phát hiện WebView/ứng dụng quét chỉ là heuristic, không chứng minh mật mã rằng QR do Camera mặc định quét trực tiếp. Việc dùng PAD không tự đồng nghĩa có chứng nhận ISO 30107 từ phòng kiểm định.
