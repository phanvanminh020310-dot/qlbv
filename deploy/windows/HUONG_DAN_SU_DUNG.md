# QLBS Kiosk 2.0 — Máy trạm phòng khám

**Ứng dụng WinForms độc lập · Một EXE · Không Edge/WebView · Bệnh viện quân y 4**

## 1. Máy trạm cần gì?

- Windows 10/11 có .NET Framework 4.x; khuyến nghị 4.8 và Windows còn được hỗ trợ/cập nhật bảo mật.
- Tài khoản Administrator **chỉ để cài, thay cấu hình hoặc gỡ**. Khi đăng nhập hằng ngày, ứng dụng chạy bằng tài khoản Windows của người dùng.
- PC và điện thoại truy cập được **cùng địa chỉ web QLBV** trong mạng bệnh viện.
- Điện thoại có trình duyệt hệ thống, camera trước; bác sĩ đã đăng ký sinh trắc học và được phân công trong lịch **đã công bố/đã chốt**.
- Khuyến nghị HTTPS có chứng chỉ được **cả Windows lẫn điện thoại tin cậy**. Không bỏ qua kiểm tra chứng chỉ. Không cần webcam PC, GPS, Edge, WebView2 hay thư viện DLL riêng.

> Đây là ứng dụng khoá máy trạm ở phiên người dùng, không phải trình điều khiển bảo mật của Windows. Đọc mục 8 trước khi triển khai diện rộng.

## 2. Cập nhật máy chủ trước

Trên VPS 1, trong thư mục QLBV đang vận hành:

```bash
sudo bash deploy/update.sh
```

1. Vào **Quản trị → Cấu hình hệ thống → Kiosk**, đặt **Master PIN riêng của bệnh viện**. Đổi PIN mặc định còn tồn tại từ bản cũ; không sử dụng chung mã công khai.
2. Kiểm tra hai cấu hình:
   - `kiosk.qrExpiresSeconds`: mặc định **15 giây**, hỗ trợ 10–600 giây.
   - `kiosk.faceVerifyBufferSeconds`: mặc định **60 giây**, hỗ trợ 10–300 giây.
3. Kiểm tra `kiosk.earlyCheckinMinutes` và `kiosk.lateCheckoutMinutes` theo quy định giao/nhận ca của bệnh viện.
4. Danh mục phòng phải có đúng mã, đang hoạt động; lịch phải được công bố/chốt. Phòng `PK01` không được khớp nhầm với `PK010`.
5. Nếu cấu hình `.env` gốc:

```dotenv
SCAN_BASE_URL=https://qlbv.benhvien.vn
PUBLIC_URL=https://qlbv.benhvien.vn
```

Bộ cài PC phải nhập **đúng cùng origin** `https://qlbv.benhvien.vn` — gồm giao thức, tên máy và cổng nếu có. Địa chỉ này phải mở được trên điện thoại; không nhập IP VPS 2 hay cổng API 4000. Có thể bỏ trống hai biến để giữ cách lấy origin từ máy trạm như các triển khai LAN trước đây.

**VPS 2 không đổi kiến trúc**: giữ microservice AI hiện có trên cổng 8001; `AI_SERVICE_URL` trên VPS 1 phải trỏ đúng VPS 2. Bộ cài máy trạm không chứa/cài mô hình AI.

## 3. Cài một phòng khám

### Cách khuyến nghị: chỉ một EXE

1. Giải nén gói phát hành vào thư mục cục bộ, kiểm tra SHA-256 với `SHA256SUMS.txt`.
2. Mở `QLBS_Kiosk.exe`. Lần đầu hiện trình thiết lập.
3. Nhập **địa chỉ web QLBV** và **mã phòng**, ví dụ `https://qlbv.benhvien.vn` / `PK01`.
4. Bấm **Kiểm tra kết nối**. Bộ cài đối chiếu phiên bản API, đúng phòng, giờ máy chủ, URL quét và sự tồn tại giao diện điện thoại; không chỉ kiểm tra có mạng Internet.
5. Bấm **Cài đặt máy trạm** và chấp nhận UAC. Nếu không cấp quyền hoặc kiểm tra thất bại, cấu hình đang chạy không bị thay thế.

Ứng dụng tự tạo ID ngẫu nhiên riêng cho PC. Khi cài lại cùng phòng, ID v2 được giữ nguyên; lần chuyển đổi cũng nhận lại ID Agent cũ nếu cấu hình cũ hợp lệ. Khi đổi phòng, tạo ID mới.

### Nếu nhận gói mã nguồn, chưa có EXE

Chạy `cai_dat_kiosk.bat`. Script dùng `csc.exe` đi kèm Windows để tạo **cùng một ứng dụng**, rồi mở trình thiết lập. Không tải NuGet, không cài SDK và không kiểm tra Edge/Chrome. Có thể biên dịch từ USB/chia sẻ chỉ đọc vì tệp tạm nằm trong `%TEMP%`.

Thư mục chỉ có **hai kịch bản dành cho IT**:

| Tệp | Công dụng |
|---|---|
| `cai_dat_kiosk.bat` | Cài có giao diện hoặc cài im lặng, tự biên dịch nếu chưa có EXE |
| `go_bo_kiosk.bat` | Cứu hộ/gỡ độc lập, dùng được ngay cả khi EXE/cấu hình hỏng |

### Vị trí sau cài

| Nội dung | Vị trí |
|---|---|
| Ứng dụng | `%ProgramFiles%\QLBS Kiosk\QLBS_Kiosk.exe` |
| Cấu hình máy | `%ProgramData%\QLBS\Kiosk\config.ini` |
| Nhật ký | `%LOCALAPPDATA%\QLBS\Kiosk\kiosk.log` và `kiosk.log.1` |
| Tự chạy | Một mục `HKLM\Software\Microsoft\Windows\CurrentVersion\Run\QLBS_Kiosk` |

Cấu hình chỉ cho Administrators/SYSTEM ghi, Users đọc. Nhật ký quay vòng khoảng 1 MB/tệp; không ghi PIN, URL QR, ảnh hay vector khuôn mặt. Không đăng ký bốn lớp startup trùng nhau và không tạo tác vụ chạy quyền Administrator hằng ngày.

## 4. Triển khai nhiều phòng / cài im lặng

Dùng **cùng một EXE**, mỗi PC chỉ khác mã phòng. Chạy với quyền Administrator/SYSTEM:

```bat
QLBS_Kiosk.exe /install /server https://qlbv.benhvien.vn /room PK01 /quiet /no-start
```

Hoặc từ gói mã nguồn:

```bat
cai_dat_kiosk.bat /server https://qlbv.benhvien.vn /room PK01 /quiet /no-start
```

Trong PowerShell, đợi ứng dụng GUI kết thúc để lấy đúng mã trả về:

```powershell
$p = Start-Process '.\QLBS_Kiosk.exe' -ArgumentList @(
  '/install', '/server', 'https://qlbv.benhvien.vn',
  '/room', 'PK01', '/quiet', '/no-start'
) -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Cài Kiosk thất bại: $($p.ExitCode)" }
```

- Phân phối qua công cụ quản trị máy/GPO/Intune/SCCM sẵn có của đơn vị; mỗi máy nhận `room` riêng. Các công cụ này không phải phụ thuộc chạy của Kiosk.
- `/quiet` không hiện UAC/hộp thoại; phải có quyền trước. Không mở giao diện trong session 0. Ứng dụng tự chạy khi người dùng đăng nhập lần sau.
- Mã trả về: **0** thành công; **1** lỗi; **2** huỷ xác nhận gỡ.
- **Không sao chép `config.ini` giữa các PC**, không đóng sẵn cấu hình Kiosk trong golden image. Nếu hai máy có cùng terminal ID thì chúng không còn là hai đích độc lập. Cài sau khi clone Windows để mỗi PC tự sinh GUID.
- Cài, cập nhật và gỡ dùng chung khoá liên tiến trình. Tác vụ xoá chậm của bản gỡ cũ có dấu nhận diện riêng; bộ cài mới huỷ dấu đó để không xoá nhầm bản vừa cài lại.
- Không có cơ chế tự tải/chạy cập nhật không kiểm soát. Phát hành mới được IT phân phối và chạy lại `/install`; bộ cài kiểm tra trước, ghi tạm, thay EXE/cấu hình và hoàn nguyên khi phần cài đặt chính thất bại.

### Chuyển từ Agent + Edge cũ

Bộ cài nhận diện cài đặt cũ ở `C:\QLBS_Kiosk`, dừng đúng Agent, dọn các mục tự chạy cũ và chỉ đóng browser dùng **profile Kiosk cũ**. Không `taskkill` toàn bộ Edge/Chrome, không dừng HIS. Các chính sách Task Manager/NoWinKeys/DevTools của **bộ cài cũ** được dọn; máy cài mới không bị sửa các chính sách doanh nghiệp đó.

Nếu còn `NoWinKeys` cũ, Explorer của phiên cài tương tác được khởi động lại để nạp lại phím Windows. Nếu triển khai bằng SYSTEM hoặc chính sách cũ nằm ở tài khoản Windows khác chưa được nạp, cho người dùng đăng xuất/đăng nhập và nhờ quản trị miền kiểm tra GPO/HKCU còn lại. Không xoá chính sách của tổ chức một cách đại trà.

## 5. Bác sĩ sử dụng

1. **Quét mã QR bằng điện thoại**: dùng Camera mặc định quét mã trực tiếp trên PC. QR tự thay theo cấu hình; mã cũ không còn hiệu lực khi được thay.
2. **Nhìn thẳng camera điện thoại để xác thực**: PC bỏ toàn bộ nét QR và thay bằng nền trắng đục ngay khi nhận `SESSION_SCANNED`, hiện đếm lùi thời gian xác thực. Không có PIN bốn số, GPS hay động tác chớp mắt/quay đầu.
3. **Mở khóa màn hình thành công**: máy chủ đối soát khuôn mặt, người thật và lịch trực. **Tất cả cửa sổ Kiosk ẩn ngay**, không taskbar, tray, dock, badge hay màn trắng còn lại; không tự mở/chiếm tiêu điểm HIS. Bác sĩ trở về Desktop Windows và tự sử dụng phần mềm làm việc.

Ứng dụng vẫn giám sát kín trong cùng tiến trình để khoá lại khi hết ca + ân hạn. Giờ hiển thị và thời hạn dùng **đồng hồ máy chủ + bộ đếm monotonic**, không dựa vào giờ Windows do người dùng chỉnh.

- Tải lại trang điện thoại **không gia hạn** bộ đệm xác thực.
- Hai PC cùng phòng có QR và lease riêng; mở PC A không mở PC B.
- Sửa/xoá phân công, thêm nghỉ phép hoặc đổi thời gian ca được đối soát lại. Cập nhật qua SSE; polling 3 giây là dự phòng, kể cả khi đang mở Desktop.
- Khi mất kết nối xác minh được, giữ/đưa máy về màn khoá, không vẽ QR giả. Khi mạng trở lại, tự đồng bộ với máy chủ; chỉ khôi phục lease còn hợp lệ của đúng máy.
- Sau resume từ sleep/hibernate, khoá và đối soát lại trước khi cho tiếp tục sử dụng.
- HTTPS vẫn yêu cầu người dùng cấp quyền camera lần đầu. Hệ điều hành/trình duyệt quyết định việc cấp quyền; không hứa mở camera im lặng 100%. HTTP không có WebRTC tự động, chỉ là chế độ chụp dự phòng theo luồng di động hiện có.

## 6. Hỗ trợ CNTT

- Bấm **Hỗ trợ CNTT**, nhấp logo 5 lần, hoặc nhấn **Ctrl + Alt + Shift + F12**.
- Nhập Master PIN cấu hình trên QLBV. Cho phép nhập chữ/số/backspace trong hộp thoại, vẫn chặn tổ hợp thoát hệ thống.
- Xác minh **trên máy chủ**, không lưu PIN cục bộ, không có mã mở khoá bí mật dự phòng. Giới hạn 5 lần thử/10 phút theo IP và đích máy trạm, ghi nhật ký kiểm toán.
- IT unlock cũng có thời hạn: ca hiện tại + ân hạn; ngoài ca không quá 4 giờ và không vượt giờ bắt đầu ca tiếp theo đã có trong lịch.
- Khi server/mạng không hoạt động, PIN trực tuyến không hoạt động. IT dùng `go_bo_kiosk.bat` với Administrator; không hạ mức an toàn bằng PIN offline lưu trong máy.

Bản 2 **không mở cổng localhost 28199**, không nhận `/unlock` từ trình duyệt. Một trang web bất kỳ không thể gọi cầu nối cục bộ để mở khoá ứng dụng mới.

## 7. Gỡ / cứu hộ

Chạy `go_bo_kiosk.bat` bằng Administrator. Script độc lập với EXE và cấu hình, dừng đúng tiến trình Kiosk theo đường dẫn, xoá tự chạy và trả quyền bàn phím do hook giữ. Không đóng HIS hay browser thông thường.

```bat
go_bo_kiosk.bat /quiet
rem Xoa ca cau hinh terminal va du lieu kiosk cu (chi khi can go sach):
go_bo_kiosk.bat /quiet /purge
```

Hoặc gỡ trong **Windows → Apps → QLBS Kiosk**, dùng `/uninstall` trên EXE. Mặc định giữ cấu hình để cài lại cùng terminal; `/purge` xoá cấu hình. Khi chuyển hẳn máy sang phòng khác/tái sử dụng, nên gỡ `/purge` trước.

## 8. Phạm vi bảo vệ thực tế — bắt buộc đọc

- `WH_KEYBOARD_LL` là **hook user-mode**, không phải driver/kernel. Chặn phím Win, Alt+Tab, Alt+F4, Ctrl+Esc, Ctrl+Shift+Esc và các phím thông thường trong phiên khoá. **Không thể chặn Secure Attention Sequence `Ctrl+Alt+Del`**, đăng xuất/tắt máy, tài khoản Administrator, Safe Mode, can thiệp vật lý hoặc mọi cơ chế accessibility bằng ứng dụng WinForms đơn thuần.
- HKLM Run chạy sau đăng nhập, **không thay thế màn hình đăng nhập/secure desktop** và không bảo đảm không có khe hở startup khi Explorer khởi động. Hỏng/chết tiến trình không phải khoá OS chống phá hoại. Muốn ranh giới bảo mật OS chặt hơn: IT phải cấu hình tài khoản tiêu chuẩn, chính sách Windows theo phiên bản/edition phù hợp, quyền Task Manager/đăng xuất, accessibility, RDP, boot/USB và quyền quản trị. Nghiệm thu trên image Windows thực tế.
- Không dùng registry tắt Win/Task Manager/DevTools dai dẳng ở cài mới: khi mở khoá, Desktop thật sự dùng bình thường. Không vô hiệu hoá kiểm tra SSL và không cài chứng chỉ/driver không tin cậy.
- Nhận diện WebView/scanner dựa trên UA, referrer và tín hiệu trình duyệt; **không phải chứng thực mật mã rằng Camera mặc định đã quét**, không chặn được mọi cách giả mạo/chuyển tiếp. Cần kết hợp QR ngắn hạn, claim một thiết bị, PAD, lịch trực, HTTPS, firewall/VLAN/Wi-Fi nội bộ. Không công khai `/api/kiosk/*` ra Internet.
- AI PAD là kiểm tra phần mềm; việc tham chiếu ISO 30107 không tự đồng nghĩa đã được phòng thí nghiệm chứng nhận. Nghiệm thu mẫu thật/giả và tải đồng thời trên VPS 2 trước vận hành lâm sàng.
- QR/lease/SSE hiện được quản lý trong **một tiến trình API**. Restart API làm mất lease và khoá lại máy để xác thực lại — hướng an toàn. Không nhân bản nhiều replica API phục vụ Kiosk nếu chưa dùng kho trạng thái chung/sticky routing được thiết kế riêng.
- EXE không được ký Authenticode bằng chứng thư doanh nghiệp trong kho mã nguồn. SmartScreen có thể cảnh báo; đối chiếu SHA-256 hoặc ký bằng chứng thư hợp lệ của đơn vị trước khi phân phối. Không yêu cầu tắt Defender/SmartScreen toàn hệ thống.

## 9. Kiểm thử và nghiệm thu

Kiểm thử tự động trong workflow `Kiosk standalone quality gate`:

- Biên dịch C# 5 bằng compiler .NET Framework thật trên Windows.
- Self-test cấu hình, JSON envelope/null, đồng hồ server, SSE, state scan/lease, chính sách nhập PIN.
- So sánh **từng module của 40 phiên bản QR** với `node-qrcode` độc lập; kiểm tra ảnh giao diện off-screen.
- Kiểm thử nghiệp vụ cũ và Kiosk, cộng tích hợp PostgreSQL/Drizzle bằng PGlite chạy migration thật; AI được giả lập trong test, không thay thế nghiệm thu model thực.
- Typecheck/build backend và frontend; phân tích cú pháp script cứu hộ mà không thực thi xoá registry trên CI.

**Trước khi triển khai hàng loạt**, nghiệm thu tối thiểu hai PC và hai điện thoại thật:

- [ ] Windows 10/11 đúng image của viện; cài từ EXE và source-only BAT, đường dẫn có dấu/khoảng trắng.
- [ ] Mã phòng sai, nhầm cổng API, HTTPS sai chứng chỉ: báo lỗi, không ghi đè cấu hình cũ.
- [ ] QR 15s thay mã; ảnh QR cũ không dùng được; scan che trắng ngay, không lộ QR khi reconnect/tải lại.
- [ ] Buffer 60s/cấu hình khác hết đúng hạn, không tự kéo dài; đổi ảnh sinh trắc học theo đúng quyền/toggle hệ thống.
- [ ] Face thật/giả, sai bác sĩ, không có ca, đang nghỉ phép, nhiều bác sĩ cùng xác thực; AI VPS 2 hoạt động ổn định.
- [ ] Hai PC chung phòng: chỉ đúng PC đã phát QR mở; PC khác/SSE reconnect không bị mở nhầm.
- [ ] Mở khoá không còn cửa sổ/badge/taskbar/tray; phím Windows dùng lại, HIS đang mở không bị đóng hay tự chiếm focus.
- [ ] Hết ca + grace, đổi/xoá lịch trực, ca đêm qua ngày, sleep/resume: tự khoá đúng và hiển thị ca tiếp theo.
- [ ] Boot chưa có mạng, rút/cắm LAN, restart API, SSE qua proxy, DPI 100/125/150%, hai màn hình/cắm rút monitor.
- [ ] PIN đúng/sai, giới hạn thử, hộp thoại nhập được, hotkey; giữ Ctrl/Alt/Win qua thời điểm khoá/mở không để kẹt phím; cứu hộ/gỡ hai lần liên tiếp và cài lại ngay sau gỡ không lỗi, không đóng HIS.
- [ ] Chính sách Ctrl+Alt+Del/Task Manager/đăng xuất/accessibility/RDP được quản trị Windows nghiệm thu riêng.

Không ghi “không lỗi 100%” khi chưa chạy các ca phần cứng và chính sách Windows thực tế này.
