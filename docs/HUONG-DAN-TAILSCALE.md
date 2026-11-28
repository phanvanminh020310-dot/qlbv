# Hướng dẫn truy cập QLBV từ xa bằng Tailscale

Mục tiêu: ở ngoài bệnh viện (4G, Wi‑Fi nhà…), máy nào đã bật Tailscale vẫn mở được **đúng địa chỉ `https://qlbv.bvqy4.io.vn`**, có ổ khóa hợp lệ, không cần nhớ địa chỉ khác. Đồng thời SSH được vào VPS từ xa.

Cách làm: VPS QLBV quảng bá **duy nhất IP LAN của chính nó** (`172.16.13.76/32`) vào mạng Tailscale ("subnet router"). Tên miền vẫn trỏ về `172.16.13.76` như cũ; máy có Tailscale sẽ đi tới IP đó qua đường hầm mã hóa.

| Thông tin | Giá trị |
|---|---|
| VPS QLBV | Ubuntu Server (máy ảo Hyper‑V), IP LAN `172.16.13.76`, user `qlbv` |
| Tên miền | `qlbv.bvqy4.io.vn` → A record `172.16.13.76` (Cloudflare, **DNS only**) |
| Tài khoản Tailscale | **Dùng lại Gmail cũ** đã liên kết Tailscale (không cần tạo Gmail mới) |
| Tên máy trong Tailscale | `qlbv` (tùy chọn, chỉ là tên hiển thị) |

> Windows Server (máy chủ Hyper‑V) **không cần** cài Tailscale và không cần đăng nhập Gmail. Tailscale chạy bên trong Ubuntu.

---

## Tóm tắt

1. (Nếu có VPS cũ trong Tailscale) Remove máy cũ trên Admin console.
2. Cài Tailscale trên Ubuntu.
3. `sudo tailscale up --hostname=qlbv` → đăng nhập Gmail cũ.
4. Bật `ip_forward`, quảng bá route `172.16.13.76/32`.
5. Admin console: duyệt route + **Disable key expiry**.
6. Cài Tailscale trên laptop/điện thoại (cùng Gmail) và kiểm tra từ xa.

---

## 1. Gỡ VPS cũ khỏi Tailscale (nếu có)

Vào https://login.tailscale.com/admin/machines bằng Gmail cũ → ở máy VPS cũ bấm **⋯ → Remove**.

Nếu không gỡ, VPS mới vẫn chạy bình thường nhưng tên sẽ bị đổi thành `qlbv-1`.

Nếu VPS cũ còn bật, chạy trên VPS cũ để nó không nhảy lại vào mạng:
```bash
sudo tailscale logout
```

## 2. Cài Tailscale trên VPS mới

Nên SSH vào VPS từ máy tính để copy/dán được (console Hyper‑V không copy chữ ra ngoài):
```bat
ssh qlbv@172.16.13.76
```

Cài đặt:
```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale version
```
`tailscale version` in ra số phiên bản là cài xong.

- Báo `curl: command not found` → `sudo apt update && sudo apt install -y curl` rồi chạy lại.
- Báo `sudo: tailscale: command not found` khi chạy `tailscale up` → nghĩa là **chưa cài**, quay lại bước này.

## 3. Đăng nhập (Gmail cũ)

`--hostname=qlbv` chỉ là **tên hiển thị** của VPS trong Tailscale. Không liên quan tên miền, SSL, Cloudflare hay tên máy Ubuntu. Đặt tên khác cũng được (chữ thường, số, dấu `-`).

Chọn **một** trong ba cách:

**A. Bấm link (khuyên dùng, qua SSH)**
```bash
sudo tailscale up --hostname=qlbv
```
Lệnh in ra link `https://login.tailscale.com/a/xxxx`. Mở link trên trình duyệt **máy bất kỳ** (laptop, điện thoại…) → đăng nhập **Gmail cũ** → **Connect**. Lệnh trên VPS tự chạy xong.

**B. Quét QR bằng điện thoại (dùng được ngay trong console Hyper‑V)**
```bash
sudo tailscale up --hostname=qlbv --qr
```
Quét mã QR → đăng nhập Gmail cũ trên điện thoại → **Connect**. Nếu QR bị vỡ do cửa sổ hẹp, dùng cách A hoặc C.

**C. Auth key (không cần trình duyệt)**
1. Trên máy bất kỳ: https://login.tailscale.com/admin/settings/keys → **Generate auth key** → copy `tskey-auth-...`.
2. Trên VPS:
   ```bash
   sudo tailscale up --hostname=qlbv --authkey=tskey-auth-xxxxxxxx
   ```
   Khóa chỉ dùng một lần. **Không** lưu vào file, không gửi qua chat.

Kiểm tra:
```bash
tailscale status
tailscale ip -4        # IP Tailscale dạng 100.x.y.z
```

## 4. Quảng bá IP LAN của VPS vào Tailscale

```bash
echo 'net.ipv4.ip_forward = 1' | sudo tee /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
sudo tailscale set --advertise-routes=172.16.13.76/32
```

> **Chỉ quảng bá `172.16.13.76/32`.** Không quảng bá cả dải `172.16.13.0/24`: như vậy sẽ mở đường từ xa vào toàn bộ mạng bệnh viện.
>
> `ip_forward` thực tế đã được Docker bật sẵn; lệnh trên chỉ để giữ cố định sau khi khởi động lại.

## 5. Duyệt route và tắt hạn khóa trên Admin console

Mở https://login.tailscale.com/admin/machines (máy bất kỳ, Gmail cũ), ở máy `qlbv`:

1. **⋯ → Edit route settings** → tick `172.16.13.76/32` → **Save**.
2. **⋯ → Disable key expiry**. Mặc định Tailscale bắt đăng nhập lại sau 180 ngày; không tắt thì đến hạn VPS sẽ tự rớt khỏi mạng.

Kiểm tra trên VPS:
```bash
tailscale status --self
```

## 6. Cài Tailscale trên máy dùng từ xa

- Windows / macOS / Android / iPhone: cài ứng dụng Tailscale, đăng nhập **cùng Gmail**. Các máy này **tự nhận route**, không cần chỉnh gì.
- Máy Linux: cần thêm
  ```bash
  sudo tailscale set --accept-routes
  ```

Gói miễn phí: tối đa 3 người dùng, 100 thiết bị.

## 7. Kiểm tra từ ngoài bệnh viện

Trên laptop Windows đang ở **ngoài** mạng bệnh viện (4G/Wi‑Fi nhà), bật Tailscale, mở CMD:
```bat
ipconfig /flushdns
nslookup qlbv.bvqy4.io.vn 1.1.1.1
curl.exe -sv -o NUL https://qlbv.bvqy4.io.vn/health 2>&1 | findstr /i "Connected HTTP/"
```
Kết quả đúng:
- `nslookup` ra `172.16.13.76`.
- `curl` có dòng `Connected to qlbv.bvqy4.io.vn (172.16.13.76) port 443` và `HTTP/1.1 200`.

Rồi mở trình duyệt vào `https://qlbv.bvqy4.io.vn` → đăng nhập bình thường, có ổ khóa.

PowerShell:
```powershell
Test-NetConnection qlbv.bvqy4.io.vn -Port 443
```
`TcpTestSucceeded : True` là thông.

SSH từ xa:
```bat
ssh qlbv@172.16.13.76
ssh qlbv@100.x.y.z
```

---

## Có ảnh hưởng tên miền / SSL / Cloudflare không?

**Không.**

| Thành phần | Tailscale có động vào không? |
|---|---|
| DNS `qlbv` → `172.16.13.76` trên Cloudflare | Không. Giữ nguyên **DNS only**. |
| Chứng chỉ Let's Encrypt `/etc/letsencrypt` | Không. Từ xa vẫn mở đúng tên miền nên chứng chỉ hợp lệ. |
| Gia hạn tự động (cron 03:17, DNS‑01 qua Cloudflare) | Không. Vẫn đi Internet bình thường. |
| Nginx `172.16.13.76:443` | Không. Nginx chỉ bind IP LAN; Tailscale (nếu dùng `serve`) chỉ dùng `443` trên IP `100.x`, không tranh chấp. **Không** đổi vhost thành `listen 443` (wildcard). |
| Người dùng trong bệnh viện | Không. Vẫn truy cập như cũ, không cần cài gì. |

## An toàn

- **Bật xác minh 2 bước** cho Gmail dùng với Tailscale. Ai vào được Gmail này là vào được mạng Tailscale.
- Chỉ quảng bá `172.16.13.76/32`.
- Không mời người lạ vào tailnet. Muốn thêm người: đặt ACL trước.
- Máy mất/không dùng nữa: Admin console → **Remove**.
- Quét QR chấm công, quét khuôn mặt vẫn làm trong Wi‑Fi bệnh viện. Tailscale dành cho quản trị và truy cập từ xa.

## Lỗi hay gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `sudo: tailscale: command not found` | Chưa cài. Làm bước 2. |
| Ở ngoài, `curl` báo `Couldn't connect` / timeout | Kiểm tra: Tailscale trên laptop đang bật? Route `172.16.13.76/32` đã tick trong Admin console? `tailscale status` trên VPS có online? Máy Linux đã `--accept-routes`? Trên Windows: biểu tượng Tailscale → **Use Tailscale subnets** phải được bật. |
| `nslookup` ra IP khác `172.16.13.76` | Kiểm tra A record trên Cloudflare; xem file hosts: `findstr /i bvqy4 C:\Windows\System32\drivers\etc\hosts` (phải không in gì). |
| Ở bệnh viện mà web hơi chậm khi bật Tailscale | Máy đang đi vòng qua Tailscale. Tắt Tailscale khi ở bệnh viện, hoặc bỏ chọn **Use Tailscale subnets**. |
| Sau vài tháng VPS rớt khỏi Tailscale | Chưa **Disable key expiry**. Chạy lại `sudo tailscale up --hostname=qlbv`, đăng nhập rồi tắt key expiry. |
| Tên máy bị thành `qlbv-1` | Máy cũ cùng tên còn trong danh sách. Remove máy cũ, rồi `sudo tailscale set --hostname=qlbv`. |
| Muốn đổi tên máy | `sudo tailscale set --hostname=ten-moi` hoặc Admin console → **⋯ → Edit machine name**. |
| `tailscale up` báo phải nhắc lại các tùy chọn cũ | Dùng `tailscale set ...` để đổi từng tùy chọn thay cho `tailscale up`. |

## Gỡ bỏ

Ngừng quảng bá route (web từ xa không vào được nữa, SSH qua IP `100.x` vẫn được):
```bash
sudo tailscale set --advertise-routes=
```
rồi bỏ tick route trên Admin console.

Gỡ hẳn Tailscale:
```bash
sudo tailscale logout
sudo apt remove -y tailscale
sudo rm -f /etc/sysctl.d/99-tailscale.conf
```
Tên miền và SSL vẫn chạy bình thường như trước khi cài.
