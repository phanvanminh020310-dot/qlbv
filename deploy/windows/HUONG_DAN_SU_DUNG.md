# QLBS Kiosk 2.0 — Hướng dẫn cài mới, cập nhật và vận hành

> **Bản 2.0.2 theo đúng gói cũ đã chốt:** Kiosk áp dụng cho **mọi tài khoản Windows, bao gồm Administrator**, không có nhánh bỏ qua tài khoản/nhóm quản trị viên. Không dùng hành vi chỉ khóa User của 2.0.1 trong bản này.
>
> Chỉ đưa bản sửa nhập PIN CNTT vào nền mã 2.0.0: giữ focus hộp PIN, không để cửa sổ khóa giành focus và xử lý modifier/key-up. Hook bảo vệ vẫn hoạt động; xác minh PIN/mở khóa phía server giữ nguyên. Cài/gỡ vẫn cần UAC/Administrator.
>
> Nếu API v2 của gói cũ đang hoạt động thì sửa PIN này **không yêu cầu thay cấu hình hoặc nâng backend**, không đổi URL/phòng/certificate/port và không cần sinh lại HTTPS. Bộ P2 một-lần vẫn dùng đúng hai BAT. Các bản phát hành cũ giữ nguyên để đối chiếu.


**Cập nhật: 16/10/2026 · WinForms native · Một EXE · Bệnh viện quân y 4**

> **Bản mới không chạy Edge Kiosk và không dùng Agent điều khiển browser.** Tệp chạy chính là `QLBS_Kiosk.exe`. Không làm theo hướng dẫn cũ yêu cầu cài `QLBS_Kiosk_Agent.exe`, mở cổng localhost 28199, tạo nhiều mục Startup/Task Scheduler hay đặt NoWinKeys trong registry.

## Mục lục

1. [Tải đúng bộ cài và chuẩn bị](#1-tải-đúng-bộ-cài-và-chuẩn-bị)
2. [Cập nhật VPS 1 và cấu hình trên web](#2-cập-nhật-vps-1-và-cấu-hình-trên-web)
3. [Chọn đúng địa chỉ máy chủ](#3-chọn-đúng-địa-chỉ-máy-chủ)
4. [Cài một PC bằng EXE — cách khuyến nghị](#4-cài-một-pc-bằng-exe--cách-khuyến-nghị)
5. [Kiểm thử nhận ca bằng điện thoại](#5-kiểm-thử-nhận-ca-bằng-điện-thoại)
6. [Chuyển từ Agent cũ, cập nhật và đổi phòng](#6-chuyển-từ-agent-cũ-cập-nhật-và-đổi-phòng)
7. [Cài nhiều PC / gói chỉ có mã nguồn](#7-cài-nhiều-pc--gói-chỉ-có-mã-nguồn)
8. [Hỗ trợ IT, cứu hộ và gỡ](#8-hỗ-trợ-it-cứu-hộ-và-gỡ)
9. [Vị trí tệp và xử lý lỗi](#9-vị-trí-tệp-và-xử-lý-lỗi)
10. [Checklist nghiệm thu trước triển khai hàng loạt](#10-checklist-nghiệm-thu-trước-triển-khai-hàng-loạt)
11. [Giới hạn bảo mật cần biết](#11-giới-hạn-bảo-mật-cần-biết)

## 1. Tải đúng bộ cài và chuẩn bị

### 1.1. Đường tải

- **[Tải QLBS_Kiosk_2.0.2.zip](https://github.com/pvminh94/qlbv/releases/download/kiosk-v2.0.2/QLBS_Kiosk_2.0.2.zip)**.
- [Trang GitHub Release và checksum](https://github.com/pvminh94/qlbv/releases/tag/kiosk-v2.0.2).
- [README cài nhanh ngay trong thư mục Windows](README.md).

Trong **Releases → Assets**, tải đúng **`QLBS_Kiosk_2.0.2.zip`**. Không nhầm với **Source code (zip)** mà GitHub tự tạo. `Code → Download ZIP` tải cả repository mã nguồn, không phải gói EXE đã build. Artifacts trong Actions là bản build kiểm thử có thời hạn lưu, còn Releases là nơi phân phối bộ cài.

Gói phát hành có EXE được biên dịch bằng compiler .NET Framework trên **Windows CI**, không phải bản Mono dùng trong vòng thử nghiệm Linux trước đây. Xem `BUILD_INFO.txt` để biết commit nguồn. `SHA256SUMS.txt` chứa checksum các tệp trong gói; checksum ZIP được phát hành cạnh ZIP ở Releases.

### 1.2. PC và điện thoại cần gì?

- Windows 10/11 có .NET Framework 4.x; khuyến nghị 4.8 và image Windows còn được viện hỗ trợ/cập nhật bảo mật.
- Có tài khoản Administrator để **cài, thay cấu hình hoặc gỡ**. Khi sử dụng hằng ngày, ứng dụng chạy bằng tài khoản người dùng Windows.
- Không cần webcam PC, Edge, WebView2, SDK, NuGet hay DLL bên ngoài gói.
- PC và điện thoại phải mở được **cùng địa chỉ web QLBV** trong mạng bệnh viện.
- Dùng HTTPS có chứng chỉ được **cả Windows và điện thoại tin cậy** để camera web tự mở. Không bỏ qua lỗi chứng chỉ. Được Windows tin cậy không có nghĩa điện thoại đã tin cậy chứng chỉ đó.
- Bác sĩ đã có dữ liệu khuôn mặt và phân công trong lịch **đã công bố/đã chốt**, phòng/tài khoản còn hoạt động.
- Chuẩn bị trước mã phòng cho từng PC và giữ sẵn `go_bo_kiosk.bat` ở nơi IT có thể truy cập.

**Lưu ý:** EXE chưa ký Authenticode bằng chứng thư doanh nghiệp. Nếu SmartScreen/Defender hay chính sách cơ quan chặn, IT xác minh nguồn, checksum và phê duyệt/ký mã theo quy định. Không tắt bảo vệ Windows toàn hệ thống.

## 2. Cập nhật VPS 1 và cấu hình trên web

### 2.1. Cập nhật máy chủ trước PC

Kiểm tra sao lưu và quy trình bảo trì của viện. SSH vào **VPS 1**, chuyển vào thư mục repository QLBV đang vận hành rồi chạy:

```bash
sudo bash deploy/update.sh
```

Chờ cập nhật thành công. Không cài EXE v2 với backend cũ: bộ cài cần API v2 và sẽ từ chối giao thức/phòng/URL không phù hợp. Việc tải EXE không tự cập nhật VPS.

**VPS 2 giữ kiến trúc cũ:** dịch vụ AI hiện có trên cổng 8001. Kiểm tra `AI_SERVICE_URL` trên VPS 1 trỏ đúng dịch vụ VPS 2 và truy cập được từ container backend. Không nhập URL VPS 2 vào bộ cài Windows. Gói Windows không chứa/cài mô hình AI.

### 2.2. Cấu hình Kiosk

Đăng nhập web bằng tài khoản có quyền quản trị → **Quản trị → Cấu hình hệ thống → Kiosk**:

| Cấu hình | Cần làm |
|---|---|
| Master PIN IT (`kiosk.itMasterPin`) | Đặt mã riêng của viện; đổi mã mặc định còn giữ từ bản cũ. Không có mật khẩu dự phòng cố định. |
| Hạn QR (`kiosk.qrExpiresSeconds`) | Mặc định **15 giây**; cho phép 10–600 giây. |
| Thời gian xác thực sau quét (`kiosk.faceVerifyBufferSeconds`) | Mặc định **60 giây**; cho phép 10–300 giây. |
| Cho nhận ca sớm (`kiosk.earlyCheckinMinutes`) | Đặt theo quy định viện. |
| Ân hạn hết ca (`kiosk.lateCheckoutMinutes`) | Đặt theo quy định viện. Ví dụ ca hết 11:00, ân hạn 60 phút thì mốc khoá là 12:00. |
| Cho phép tự đổi ảnh xác thực | Bật/tắt theo chính sách. Bật không cấp quyền quản trị cho bác sĩ và không bỏ các kiểm tra nghiệp vụ khác. |

Lưu cấu hình. Không đưa PIN lên hướng dẫn công khai, ảnh chụp màn hình hoặc bộ cài máy trạm.

### 2.3. Chuẩn bị phòng, bác sĩ và lịch

1. Trong danh mục lịch trực, xác nhận **mã phòng** đang hoạt động, ví dụ `PK01`. Nhập mã, không nhập tên dài như “Phòng khám Nội 01”. `PK01` và `PK010` là hai phòng khác nhau.
2. Tài khoản bác sĩ phải đang hoạt động.
3. Người có quyền vào **Quản trị → Người dùng**, tại bác sĩ bấm nút **Đăng ký sinh trắc học khuôn mặt** và hoàn tất đăng ký. Nếu chính sách cho phép tự đăng ký, bác sĩ cũng có luồng tại **Cá nhân → Sinh trắc học Kiosk**. Kiosk PC nhận ca không cần webcam.
4. Phân công đúng bác sĩ, đúng phòng, ngày và ca. **Công bố/chốt** lịch; bản nháp không được dùng để mở máy.
5. Kiểm tra nghỉ phép và giờ ca, nhất là ca đêm qua ngày. Không có ca hợp lệ thì nhận diện đúng mặt cũng không tự cấp quyền mở Desktop.

## 3. Chọn đúng địa chỉ máy chủ

### 3.1. Nhập địa chỉ web gốc, không nhập đường dẫn trang

Dùng địa chỉ mở giao diện web QLBV từ **cả PC lẫn điện thoại**. Các tên miền sau chỉ là ví dụ; thay bằng địa chỉ thực của viện.

| Web đang sử dụng | Nhập vào bộ cài |
|---|---|
| `https://qlbv.benhvien.vn/login` | `https://qlbv.benhvien.vn` |
| `https://qlbv.benhvien.vn:3000/login` | `https://qlbv.benhvien.vn:3000` |
| `http://192.168.10.100:3000/login` | `http://192.168.10.100:3000` — chỉ cho thử LAN; camera web tự động cần HTTPS |

**Không nhập:** `/login`, `/api`, `/kiosk/PK01`, cổng backend `4000`, cổng AI `8001`, `localhost` hoặc `127.0.0.1`. `localhost` trên điện thoại là chính điện thoại, không phải VPS.

Nếu viện dùng **HTTPS cổng 3000**, giữ cả `https://` và `:3000`. Đừng tự đổi sang HTTP hoặc bỏ cổng khi web thực tế không phục vụ ở cổng mặc định.

### 3.2. Biến môi trường nếu IT cố định URL quét

Trong `.env` gốc trên VPS 1, nếu sử dụng:

```dotenv
SCAN_BASE_URL=https://qlbv.benhvien.vn
PUBLIC_URL=https://qlbv.benhvien.vn
```

Hoặc với HTTPS cổng 3000:

```dotenv
SCAN_BASE_URL=https://qlbv.benhvien.vn:3000
PUBLIC_URL=https://qlbv.benhvien.vn:3000
```

Sau khi thay `.env`, áp dụng lại triển khai theo quy trình VPS. Bộ cài PC phải nhập **đúng cùng origin**: giao thức, tên miền và cổng. Có thể bỏ trống hai biến để giữ cách lấy origin từ máy trạm như các triển khai LAN trước đây, nhưng mọi PC vẫn phải nhập URL điện thoại truy cập được.

Chứng chỉ HTTPS phải khớp tên miền/IP đang nhập. Không dùng chứng chỉ của tên miền rồi thay URL thành IP nếu chứng chỉ không chứa IP đó.

## 4. Cài một PC bằng EXE — cách khuyến nghị

### Bước 1 — Tải và giải nén

Tải ZIP từ [Releases](https://github.com/pvminh94/qlbv/releases/tag/kiosk-v2.0.2), giải nén vào một thư mục cục bộ, ví dụ `C:\BoCai\QLBS_Kiosk_2.0.2`. Không mở EXE trực tiếp bên trong cửa sổ ZIP.

Trong cùng thư mục phải thấy ít nhất:

```text
QLBS_Kiosk.exe
QLBS_Kiosk.cs
cai_dat_kiosk.bat
go_bo_kiosk.bat
README.md
HUONG_DAN_SU_DUNG.md
BUILD_INFO.txt
SHA256SUMS.txt
NOTICE.md
KIEM_THU_V2.md
```

Chỉ có **hai BAT**. Các tệp tài liệu/mã nguồn không phải tiến trình chạy nền hay Agent phụ.

### Bước 2 — Kiểm tra checksum

Mở PowerShell tại thư mục vừa giải nén:

```powershell
Get-FileHash .\QLBS_Kiosk.exe -Algorithm SHA256
```

Mở `SHA256SUMS.txt`, đối chiếu hash của `QLBS_Kiosk.exe`. Có thể kiểm tra ZIP với file `QLBS_Kiosk_2.0.2.zip.sha256` tải cạnh ZIP trên Releases. Nếu khác hash, dừng cài và tải/kiểm tra lại.

### Bước 3 — Mở trình thiết lập

Nhấp đúp **`QLBS_Kiosk.exe`** trong thư mục bộ cài. EXE bên ngoài thư mục đã cài sẽ mở màn thiết lập; nếu cần gọi rõ ràng:

```bat
QLBS_Kiosk.exe /setup
```

Không cần tạo shortcut Startup/Task Scheduler thủ công. Không cần mở trang web Kiosk trong Edge.

### Bước 4 — Điền hai ô

- **Địa chỉ máy chủ QLBV:** URL gốc đã xác định ở mục 3.
- **Mã phòng khám:** ví dụ `PK01`.

Không tự tạo/nhập terminal ID. Ứng dụng quản lý ID riêng cho PC.

### Bước 5 — Kiểm tra kết nối

Bấm **Kiểm tra kết nối**. Bộ cài kiểm tra:

- API đúng phiên bản v2, phòng tồn tại/đang hoạt động.
- Đồng hồ máy chủ và trạng thái của đúng terminal.
- URL quét đúng origin và trang điện thoại mở được.
- Chứng chỉ HTTPS được Windows tin cậy.

Phải có thông báo kết nối hợp lệ/đúng tên phòng mới tiếp tục. “PC có Internet” chưa đủ chứng minh kết nối với QLBV hợp lệ. Nếu lỗi, xem mục 9; không sửa mã nguồn để bỏ qua preflight/chứng chỉ.

### Bước 6 — Cài và chấp nhận UAC

Bấm **Cài đặt máy trạm**, xác nhận quyền **Administrator** khi Windows hỏi. Không cấp UAC hoặc preflight thất bại thì cấu hình đang chạy không bị thay thế.

Bộ cài chép EXE vào Program Files, lưu cấu hình có ACL bảo vệ và đăng ký **một** mục tự chạy HKLM. Cài tương tác sẽ khởi động ứng dụng qua Explorer; khi vận hành, mọi tài khoản đăng nhập đều bị áp dụng Kiosk, kể cả Administrator.

Nếu Explorer không khởi chạy được ngay, cấu hình đã lưu; đăng xuất/đăng nhập Windows để mục tự chạy hoạt động. Không tạo thêm mục Startup để “sửa” bằng cách chạy trùng.

### Bước 7 — Kiểm tra khởi động lại

Sau khi kiểm thử an toàn và có phương án IT cứu hộ, đăng xuất/đăng nhập hoặc khởi động lại PC. Cả User và Administrator đều phải tự chạy Kiosk khi cấu hình đã cài; ứng dụng tự kết nối máy chủ, hiện trạng thái khoá/QR hoặc khôi phục lease còn hợp lệ do server xác nhận. Nếu chưa có mạng, hiển thị đang đồng bộ và tự phục hồi khi mạng có lại; không dùng QR giả hoặc dữ liệu lịch cache như lịch hiện tại.

## 5. Kiểm thử nhận ca bằng điện thoại

1. Dùng bác sĩ đã có sinh trắc học và ca hợp lệ; điện thoại ở mạng bệnh viện, mở được cùng URL QLBV.
2. PC hiển thị đúng phòng, bác sĩ/ca và giờ máy chủ. QR tự đổi theo thời hạn, mặc định 15 giây.
3. Dùng **Camera mặc định của điện thoại** quét trực tiếp QR trên PC. Không quét trong Zalo, Messenger, browser nhúng hoặc ứng dụng scanner. iPhone khuyến nghị mở bằng Safari; nếu Camera mở sang browser bị từ chối, chuyển liên kết sang Safari.
4. Trình duyệt lần đầu hỏi quyền camera: chọn **Cho phép**. Nhìn thẳng **camera trước điện thoại**, đủ ánh sáng. Không cần PIN bốn số, GPS, chớp mắt hay quay đầu.
5. Khi server ghi nhận quét, PC bỏ nét QR và che bằng nền trắng đục; hiển thị đếm lùi xác thực, mặc định 60 giây. Reload/reconnect không kéo dài thời hạn này.
6. Nhận diện/PAD và lịch hợp lệ: **mọi cửa sổ Kiosk ẩn, trả hoàn toàn Desktop**. Không taskbar/tray/dock/badge/màn trắng và không tự mở/giành focus HIS. Bác sĩ tự dùng phần mềm làm việc.
7. Hết ca + ân hạn: tự khoá và đồng bộ ca tiếp theo. Ví dụ ca hết 11:00, grace 60 phút thì mốc khoá là 12:00.

Ứng dụng tiếp tục giám sát kín trong cùng tiến trình. Đồng hồ/thời hạn dùng **giờ server + bộ đếm monotonic**, không lấy giờ Windows người dùng chỉnh. Thay/xoá lịch, nghỉ phép hoặc giờ ca được đối soát lại; SSE là kênh chính, polling khoảng 3 giây là dự phòng cả khi đã mở Desktop.

Mất kết nối xác minh được thì giữ/đưa máy về khoá; có mạng lại thì đối soát, chỉ khôi phục lease hợp lệ của đúng PC. Sau sleep/hibernate, khoá và kiểm tra lại. HTTPS vẫn không bỏ qua quyết định cấp quyền camera của hệ điều hành/trình duyệt.

## 6. Chuyển từ Agent cũ, cập nhật và đổi phòng

### 6.1. Máy đang chạy Agent + Edge cũ

1. Cập nhật VPS 1 trước.
2. Chuẩn bị phiên bảo trì, quyền Administrator và `go_bo_kiosk.bat`; ghi nhận URL/mã phòng hiện tại.
3. Tải bản v2, giải nén, chạy `QLBS_Kiosk.exe` từ thư mục bộ cài, nhập cùng URL/phòng, kiểm tra rồi cài.
4. Bộ cài dừng đúng Agent, dọn tự chạy cũ và chỉ đóng Edge/Chrome dùng **profile Kiosk cũ**. Không dừng HIS hay đóng tất cả tab browser thông thường.
5. ID Agent cũ được nhận lại nếu cấu hình hợp lệ và cùng phòng. Không chép `config.ini` từ PC khác để ép giữ ID.
6. Nếu còn NoWinKeys của bộ cài cũ, Explorer của phiên tương tác có thể được khởi động lại để nạp lại phím. Chạy bằng SYSTEM hoặc HKCU/GPO thuộc tài khoản khác có thể cần người dùng đăng xuất/đăng nhập và IT kiểm tra chính sách còn lại.
7. Nghiệm thu mở Desktop/phím Windows/HIS, rồi mới áp dụng các phòng khác.

Máy cài mới không bị thêm các chính sách NoWinKeys/Task Manager/DevTools dai dẳng. Không tự xoá GPO doanh nghiệp đại trà.

### 6.2. Cập nhật phiên bản EXE sau này

Tải bộ cài mới ở thư mục riêng, chạy EXE `/setup` hoặc `cai_dat_kiosk.bat`, giữ cùng URL/phòng. Bộ cài preflight, ghi tạm, thay EXE/cấu hình và cố gắng rollback phần cài chính nếu lỗi. Cùng phòng thì giữ ID v2. Không ghi đè EXE đang chạy bằng cách copy thủ công, không gỡ `/purge` khi chỉ cập nhật thông thường.

Không có cơ chế tự tải/chạy cập nhật không kiểm soát. IT chủ động phân phối. Cài/cập nhật/gỡ dùng chung mutex; tác vụ xoá chậm của bản gỡ cũ có dấu nhận diện được huỷ khi cài mới để tránh xoá nhầm bản vừa cài lại.

### 6.3. Đổi PC sang phòng khác

Chạy lại `/setup`, nhập mã phòng mới và cài. Đổi phòng sẽ sinh terminal ID mới. Nếu tái sử dụng/thu hồi thiết bị và cần xoá cấu hình hoàn toàn, dùng gỡ `/purge` theo mục 8, sau đó cài lại. Không clone cấu hình/golden image đã có terminal ID sang PC khác.

## 7. Cài nhiều PC / gói chỉ có mã nguồn

### 7.1. Cài im lặng bằng EXE

Dùng cùng một EXE cho mọi phòng. Mở **CMD đã có quyền Administrator**; ví dụ cho PC phòng `PK01`:

```bat
QLBS_Kiosk.exe /install /server https://qlbv.benhvien.vn /room PK01 /quiet /no-start
```

Với HTTPS cổng 3000 và phòng `PK02`:

```bat
QLBS_Kiosk.exe /install /server https://qlbv.benhvien.vn:3000 /room PK02 /quiet /no-start
```

- Thay URL/mã phòng thực. `/quiet` không hỏi UAC, phải có quyền trước; `/no-start` không mở giao diện sau cài.
- Dùng tài khoản Administrator/SYSTEM qua công cụ quản trị máy sẵn có của viện. Không mở GUI trong session 0.
- Ứng dụng sẽ tự chạy ở lần đăng nhập tiếp theo. Không cần sửa source theo từng phòng hay tạo ID thủ công.
- Mã trả về: **0** thành công, **1** lỗi, **2** huỷ xác nhận gỡ.

Trong PowerShell, dùng `Start-Process -Wait` để lấy đúng mã trả về của ứng dụng GUI:

```powershell
$p = Start-Process '.\QLBS_Kiosk.exe' -ArgumentList @(
  '/install', '/server', 'https://qlbv.benhvien.vn:3000',
  '/room', 'PK01', '/quiet', '/no-start'
) -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Cài Kiosk thất bại: $($p.ExitCode)" }
```

**Không clone `config.ini`**. Nếu hai PC có cùng ID, chúng không còn là hai đích độc lập. Cài Kiosk sau khi clone Windows/golden image để mỗi máy tự tạo GUID.

### 7.2. Chỉ có mã nguồn, chưa có EXE

Đặt `QLBS_Kiosk.cs` và `cai_dat_kiosk.bat` cùng thư mục, chạy BAT. Nó dùng `csc.exe` đi kèm .NET Framework Windows, không cần SDK/NuGet/Edge, rồi mở cùng trình thiết lập.

```bat
cai_dat_kiosk.bat
rem Hoac cai im lang tu nguon, chay trong CMD Administrator:
cai_dat_kiosk.bat /server https://qlbv.benhvien.vn:3000 /room PK01 /quiet /no-start
```

Có EXE cùng thư mục thì BAT ưu tiên EXE đó. Muốn tự biên dịch lại, đổi tên/xoá **EXE trong thư mục bộ cài**, không xoá bản đang chạy trong Program Files. Mã nguồn/BAT trên USB chỉ đọc vẫn biên dịch vào `%TEMP%`.

## 8. Hỗ trợ IT, cứu hộ và gỡ

### 8.1. Mở hỗ trợ khi server còn hoạt động

Bấm **Hỗ trợ CNTT**, nhấp logo 5 lần hoặc **Ctrl + Alt + Shift + F12**, nhập Master PIN đã đặt trong cấu hình QLBV. Cho phép gõ PIN/backspace, vẫn chặn tổ hợp thoát hệ thống trong phiên khoá.

Xác minh **online** trên server; không lưu PIN trong PC, không có mã bí mật dự phòng. Sai PIN bị giới hạn 5 lần/10 phút theo IP và đích, có audit. IT unlock có thời hạn và bị ràng buộc roster: trong ca, mốc khoá là **đầu ca kế tiếp** nếu ca mới bắt đầu trước khi hết grace; thay bác sĩ/phân công, sửa giờ/ca, hoặc không đối soát được lịch sẽ khoá ngay. Ngoài ca, phiên không quá 4 giờ và không vượt giờ bắt đầu ca tiếp theo đã có lịch. Sau khi cập nhật API, phiên PIN IT cũ không có ràng buộc roster bị khoá an toàn và cần nhập lại PIN.

### 8.2. Mất mạng, server lỗi hoặc quên PIN

PIN online không hoạt động khi server không xác minh được. **Chỉ IT có quyền Administrator** thực hiện cứu hộ bằng `go_bo_kiosk.bat` đã giữ sẵn.

Vì bàn phím đang bị hook, không hứa rằng có thể gõ Win+R ngay trên màn khoá. IT dùng kênh quản trị hợp lệ của đơn vị, tài khoản Administrator hoặc secure-attention/Task Manager khi chính sách Windows cho phép để chạy bộ cứu hộ. `Ctrl+Alt+Del` thuộc Windows, không bị hook WinForms chặn. Nếu GPO/Task Manager/RDP bị hạn chế, quản trị miền xử lý theo quy trình viện; không cài PIN offline để vòng qua kiểm tra server.

### 8.3. Gỡ bình thường và gỡ sạch

Chạy `go_bo_kiosk.bat` bằng Administrator; script độc lập với EXE/cấu hình, dừng đúng Kiosk theo đường dẫn, xoá tự chạy, không dừng HIS/browser thông thường.

```bat
go_bo_kiosk.bat
rem Im lang, da co quyen Administrator:
go_bo_kiosk.bat /quiet
rem Xoa ca cau hinh terminal va du lieu kiosk cu da nhan dien:
go_bo_kiosk.bat /quiet /purge
```

Mặc định **giữ cấu hình/terminal ID** để cài lại cùng phòng. `/purge` xoá cấu hình; lần cài sau sinh ID mới. Chỉ dùng `/purge` khi thật sự cần thu hồi/chuyển giao thiết bị, không dùng cho cập nhật thường lệ.

Có thể gỡ trong **Windows → Apps → QLBS Kiosk**, hoặc từ CMD Administrator:

```bat
"%ProgramFiles%\QLBS Kiosk\QLBS_Kiosk.exe" /uninstall
```

Không xoá EXE/cấu hình thủ công thay cho uninstall và không `taskkill` toàn bộ Edge/Chrome. Máy từng dùng Agent cũ có thể cần đăng xuất/đăng nhập để nạp lại chính sách Explorer đã dọn.

## 9. Vị trí tệp và xử lý lỗi

### 9.1. Sau cài

| Nội dung | Vị trí |
|---|---|
| Ứng dụng | `%ProgramFiles%\QLBS Kiosk\QLBS_Kiosk.exe` |
| Cấu hình đúng PC | `%ProgramData%\QLBS\Kiosk\config.ini` |
| Nhật ký từng người dùng | `%LOCALAPPDATA%\QLBS\Kiosk\kiosk.log` và `kiosk.log.1` |
| Tự chạy | Một giá trị `HKLM\Software\Microsoft\Windows\CurrentVersion\Run\QLBS_Kiosk` |

Admins/SYSTEM ghi cấu hình, Users đọc. Log quay vòng khoảng 1 MB/tệp, không ghi PIN, URL QR, ảnh hay vector khuôn mặt. Không sửa ACL hoặc chép config giữa các PC để xử lý lỗi.

### 9.2. Lỗi thường gặp

| Triệu chứng | Kiểm tra / xử lý |
|---|---|
| GitHub không thấy EXE trong `deploy/windows` | Đây là thư mục mã nguồn. Tải **Assets → QLBS_Kiosk_2.0.2.zip** ở Releases, không chọn Source code ZIP. |
| Sai giao thức API / không tìm thấy trang quét | Cập nhật VPS 1; nhập URL **web gốc**, không phải backend 4000/AI 8001; kiểm tra proxy `/api` và trang `/scan`. |
| Không nhận mã phòng | Kiểm tra đúng mã phòng đang hoạt động; không nhập tên phòng; `PK01` khác `PK010`. |
| HTTPS/chứng chỉ lỗi | Kiểm tra tên miền/IP/SAN, ngày hết hạn, chuỗi chứng chỉ và trust trên PC/điện thoại. Không tắt SSL validation. |
| Camera điện thoại không tự mở | Dùng HTTPS tin cậy, cho quyền camera, thử Safari trên iOS/Chrome trên Android, không dùng browser nhúng. HTTP chỉ có luồng chụp dự phòng hiện có. |
| Zalo/ứng dụng scanner bị từ chối | Dùng Camera mặc định, mở bằng trình duyệt hệ thống phù hợp. Đây là hành vi chặn WebView chủ động. |
| Đúng khuôn mặt nhưng không mở | Kiểm tra đăng ký sinh trắc học, tài khoản hoạt động, phòng/ca/ngày, lịch công bố/chốt, nghỉ phép, thời gian early/grace và kết quả PAD của AI. |
| PC không có QR / đang đồng bộ | Kiểm tra URL, LAN/VLAN, firewall, API/AI, proxy/SSE, chứng chỉ và log. Có mạng lại tự đồng bộ; không dùng mã QR cache. |
| Bị khoá sau khi đang làm việc | Kiểm tra hết ca/grace, đổi/xoá lịch, nghỉ phép, mất kết nối, API restart hoặc sleep/resume. Không chỉnh giờ PC để kéo dài ca. |
| Không gõ được PIN | Mở đúng hộp Hỗ trợ CNTT; thả Ctrl/Alt/Win sau hotkey, gõ lại. Kiểm tra lỗi phím còn giữ qua thời điểm khoá và báo IT nếu tái hiện. |
| PIN sai/vượt lượt | Kiểm tra PIN đang cấu hình, chờ 10 phút hoặc IT cứu hộ bằng Administrator; không thử mã mặc định cũ. |
| Sau cập nhật chưa tự chạy | Đăng xuất/đăng nhập; kiểm tra một mục HKLM Run, không thêm nhiều startup trùng. |
| Không có quyền UAC/cài/gỡ | Dừng và nhờ IT; `/quiet` không tự cấp Administrator. |

## 10. Checklist nghiệm thu trước triển khai hàng loạt

[CI Windows/backend/frontend đã đạt](KIEM_THU_V2.md), nhưng không thay thế nghiệm thu trên image Windows, mạng và AI của viện. Thử ít nhất **hai PC và hai điện thoại**:

- [ ] Update VPS 1, AI VPS 2 truy cập được; HTTPS cùng origin PC/điện thoại, QR TTL/buffer/grace đúng chính sách.
- [ ] Cài bằng EXE, source-only BAT, đường dẫn có dấu/khoảng trắng; cấu hình sai/bad TLS phải bị từ chối, không phá cài cũ.
- [ ] Cài từ Agent cũ: không còn Edge Kiosk, không tắt HIS/tab browser cá nhân, phím Windows hoạt động lại sau unlock.
- [ ] Cài lại cùng phòng giữ ID; đổi phòng tạo ID mới; hai PC cùng phòng vẫn có ID/QR độc lập.
- [ ] QR 15s đổi mã; scan che trắng ngay, không lộ khi reconnect; buffer 60s hoặc cấu hình khác hết đúng hạn, không gia hạn bằng reload.
- [ ] Đúng/sai bác sĩ, không có ca, nghỉ phép, ca đêm qua ngày, sửa/xoá lịch đều đối soát đúng.
- [ ] Hai PC: chỉ PC phát QR được mở. Test AI/PAD thật/giả và nhiều bác sĩ cùng xác thực trên VPS 2 thật.
- [ ] Unlock không còn cửa sổ/badge/tray/taskbar/màn trắng; Desktop/HIS dùng bình thường, không tự giành focus HIS.
- [ ] Hết ca + grace, restart API, rút/cắm LAN, boot chưa có mạng, sleep/resume tự khoá/đồng bộ đúng.
- [ ] DPI 100/125/150%, nhiều màn hình và cắm/rút monitor.
- [ ] PIN đúng/sai, rate limit, hotkey, giữ Ctrl/Alt/Win qua lock/unlock không kẹt; cứu hộ hai lần, gỡ/cài lại ngay không lỗi.
- [ ] Toggle tự đổi ảnh đúng quyền; không cấp quyền ngoài chính sách khi bật.
- [ ] Chính sách Ctrl+Alt+Del, Task Manager, đăng xuất, accessibility, RDP, boot/USB và quản trị viên được IT kiểm tra riêng.

## 11. Giới hạn bảo mật cần biết

- `WH_KEYBOARD_LL` là **hook user-mode**, không phải driver/kernel. Không thể chặn `Ctrl+Alt+Del`, secure desktop, quản trị viên, Safe Mode, can thiệp vật lý hoặc mọi cơ chế accessibility bằng WinForms đơn thuần.
- HKLM Run chạy sau đăng nhập, không thay thế Windows logon/Assigned Access và không bảo đảm không có khe hở startup hoặc khi tiến trình hỏng. IT phải quản trị tài khoản tiêu chuẩn, quyền hệ thống và môi trường thiết bị theo edition/policy Windows thực tế.
- Cài mới không đặt NoWinKeys/Task Manager/DevTools dai dẳng; khi mở Desktop các phím phải dùng bình thường. Không vô hiệu kiểm tra SSL hay bảo vệ Windows toàn hệ thống.
- Chặn WebView/scanner dùng heuristic UA/referrer/tín hiệu trình duyệt, không chứng minh mật mã QR đến từ Camera mặc định và không ngăn mọi cách giả mạo/chuyển tiếp. Phải kết hợp QR ngắn hạn, claim, PAD, lịch, HTTPS và mạng viện. Không công khai `/api/kiosk/*` ra Internet.
- PAD phần mềm không tự đồng nghĩa có chứng nhận ISO 30107 từ phòng kiểm định. Nghiệm thu ảnh/video/mặt nạ và tải model thật trước vận hành lâm sàng.
- QR/lease/SSE hiện ở **một tiến trình API**. API restart làm mất lease, khoá lại để xác thực mới. Không scale nhiều replica phục vụ Kiosk nếu chưa thiết kế trạng thái dùng chung/sticky routing phù hợp.
- EXE chưa ký Authenticode. Đối chiếu SHA-256 hoặc ký bằng chứng thư hợp lệ của đơn vị; không hứa “không lỗi 100%” chỉ từ CI.
