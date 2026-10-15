# Cài QLBS Kiosk 2.0.0 — WinForms mới

**Đây là bản native một `QLBS_Kiosk.exe`. Không dùng Edge Kiosk, WebView hay `QLBS_Kiosk_Agent.exe` cũ.**

## Tải đúng bộ cài

- **[Tải QLBS_Kiosk_2.0.0.zip](https://github.com/pvminh94/qlbv/releases/download/kiosk-v2.0.0/QLBS_Kiosk_2.0.0.zip)**
- [Trang phát hành và checksum](https://github.com/pvminh94/qlbv/releases/tag/kiosk-v2.0.0)
- **[Hướng dẫn chi tiết từ đầu đến cuối](HUONG_DAN_SU_DUNG.md)**
- [Kết quả kiểm thử Windows và các mục còn phải nghiệm thu](KIEM_THU_V2.md)

> Trong trang Releases, chọn tài sản **`QLBS_Kiosk_2.0.0.zip`** ở mục **Assets**. Không chọn **Source code (zip)** nếu cần EXE có sẵn. `Code → Download ZIP` chỉ tải mã nguồn; các file EXE/ZIP phát hành không được commit vào thư mục này.
>
> Artifacts trong Actions là đầu ra kiểm thử có thời hạn lưu. Releases là nơi tải bộ cài chính thức. Nếu tải gói chỉ chứa `.cs` và hai BAT, đó là gói nguồn; BAT vẫn biên dịch được nhưng không phải cách tải EXE khuyến nghị.

## Cài nhanh một phòng — làm đúng thứ tự

### 1. Cập nhật máy chủ QLBV trên VPS 1

Trong thư mục repository QLBV đang vận hành, sau khi kiểm tra sao lưu theo quy trình viện:

```bash
sudo bash deploy/update.sh
```

**Phải cập nhật API v2 trước khi cài EXE mới.** VPS 2 tiếp tục chạy AI hiện có; kiểm tra `AI_SERVICE_URL` của VPS 1 trỏ đúng VPS 2.

### 2. Chuẩn bị trên web QLBV

- Vào **Quản trị → Cấu hình hệ thống → Kiosk**, đặt **PIN IT riêng**; không dùng lại mã mặc định cũ.
- QR mặc định **15 giây**; thời gian xác thực sau quét mặc định **60 giây**; kiểm tra thời gian ân hạn hết ca.
- Có mã phòng đang hoạt động, ví dụ `PK01`, và lịch đã công bố/chốt cho đúng bác sĩ.
- Bác sĩ đã đăng ký khuôn mặt. Người có quyền có thể đăng ký trong **Quản trị → Người dùng → nút đăng ký sinh trắc học**.

### 3. Tải, giải nén và kiểm tra gói trên PC

Giải nén ZIP vào một thư mục cục bộ. Trong gói phải có:

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

Mở PowerShell tại thư mục đó:

```powershell
Get-FileHash .\QLBS_Kiosk.exe -Algorithm SHA256
```

Đối chiếu dòng `QLBS_Kiosk.exe` trong `SHA256SUMS.txt`. EXE được build trên Windows nhưng **chưa ký Authenticode**. Không tắt Defender/SmartScreen toàn hệ thống; nếu chính sách doanh nghiệp chặn, IT kiểm tra checksum và áp dụng phê duyệt/ký mã theo quy định.

### 4. Mở EXE và nhập đúng hai thông tin

Nhấp đúp **`QLBS_Kiosk.exe`** → trình thiết lập:

| Ô | Nhập |
|---|---|
| Địa chỉ máy chủ QLBV | **Địa chỉ web gốc** đang dùng, ví dụ `https://qlbv.benhvien.vn` |
| Mã phòng khám | Mã trong danh mục, ví dụ `PK01` |

Nếu web chạy HTTPS cổng 3000, phải nhập cả cổng: **`https://qlbv.benhvien.vn:3000`**. Đây là ví dụ; thay bằng địa chỉ thực của viện.

**Không nhập** `/login`, `/kiosk/PK01`, `/api`, cổng backend `4000`, cổng AI `8001` hay `localhost`.

Bấm **Kiểm tra kết nối** → khi hợp lệ bấm **Cài đặt máy trạm** → chấp nhận **UAC/Administrator**. Không cần tự tạo Task Scheduler hay file Startup. Cài xong ứng dụng tự chạy; lần đăng nhập Windows sau cũng tự chạy.

### 5. Thử bằng điện thoại của bác sĩ

1. Điện thoại truy cập được cùng địa chỉ QLBV trong mạng bệnh viện; HTTPS phải có chứng chỉ tin cậy.
2. Dùng **Camera mặc định** quét QR trên PC; không quét trong Zalo/Messenger/ứng dụng scanner. iPhone khuyến nghị mở liên kết bằng Safari.
3. Cho phép camera trước trên trang xác thực, nhìn thẳng camera điện thoại.
4. PC che trắng QR, đếm lùi xác thực; thành công thì **ẩn toàn bộ Kiosk, trả Desktop**, không tự mở HIS.
5. Hết ca + ân hạn, ứng dụng tự khoá lại và đối soát ca tiếp theo.

### 6. CNTT mở hỗ trợ / gỡ

- Nút **Hỗ trợ CNTT** hoặc **Ctrl + Alt + Shift + F12** → nhập PIN đã đặt trên máy chủ.
- Mất mạng/server thì PIN trực tuyến không dùng được. IT có quyền Administrator dùng **`go_bo_kiosk.bat`**; xem cách truy cập cứu hộ trong hướng dẫn chi tiết.
- Gỡ mặc định giữ cấu hình/ID máy. `/purge` xoá cấu hình và sẽ tạo ID mới khi cài lại.

## Cài nhiều PC

Chạy CMD đã có quyền Administrator, đổi `PK01` theo từng máy:

```bat
QLBS_Kiosk.exe /install /server https://qlbv.benhvien.vn /room PK01 /quiet /no-start
```

Với HTTPS cổng 3000:

```bat
QLBS_Kiosk.exe /install /server https://qlbv.benhvien.vn:3000 /room PK02 /quiet /no-start
```

Ứng dụng sẽ chạy ở lần đăng nhập tiếp theo. **Không clone `config.ini` giữa các PC.** Cùng một EXE dùng cho mọi phòng; mỗi PC tự sinh ID riêng. Không cần sửa mã nguồn theo từng phòng.

## Cần đọc trước triển khai hàng loạt

- CI đã chạy Windows compiler/self-test, đối chiếu 40 phiên bản QR, backend 56 test và build hai ứng dụng. [Xem chứng cứ](KIEM_THU_V2.md).
- Cài-gỡ/UAC/ACL/hook, Desktop thực, DPI/nhiều màn hình, điện thoại và AI/PAD thật vẫn phải nghiệm thu tại viện.
- `WH_KEYBOARD_LL` là hook user-mode, **không chặn được `Ctrl+Alt+Del`** và không thay thế bảo mật OS.
- Toàn bộ quy trình, lỗi thường gặp, chuyển từ Agent cũ và checklist nằm trong **[HUONG_DAN_SU_DUNG.md](HUONG_DAN_SU_DUNG.md)**.

## Dành cho người phát hành phiên bản

Trong **Actions → Kiosk standalone quality gate → Run workflow**, chọn nhánh **main**, bật **publish_release**, nhập tag đúng phiên bản gói, ví dụ `kiosk-v2.0.0`.

Workflow phải chạy đạt backend, frontend và Windows trước; sau đó kiểm tra checksum/commit nguồn của artifact, tạo draft Release, tải đủ ZIP/EXE và checksum lên rồi mới công bố. Dùng `GITHUB_TOKEN` ngắn hạn của Actions, không lưu PAT cá nhân trong source. Nếu Release đã tồn tại, workflow từ chối thay thế asset; phiên bản mới phải có version/tag riêng.
