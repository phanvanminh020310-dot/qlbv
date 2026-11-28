# Chuyển QLBV + AI Engine sang VPS mới và trỏ tên miền `qlbv.bvqy4.io.vn`

Đây là quy trình gọn đã làm thực tế khi chuyển từ `172.16.13.75` sang `172.16.13.76`. Ở mọi lệnh, thay `172.16.13.76` bằng IP của VPS mới và `172.16.13.75` bằng IP của VPS đang chạy.

Tài liệu nền về Let's Encrypt và Cloudflare DNS-01: [`HUONG-DAN-HTTPS-HOSTNAME-LAN.md`](HUONG-DAN-HTTPS-HOSTNAME-LAN.md).

---

## Tóm tắt quy trình

| Giai đoạn | Việc chính | Ảnh hưởng người dùng |
|---|---|---|
| **A. Dựng VPS mới**<br>(làm lúc nào cũng được) | Cài AI Engine và QLBV, bật HTTPS cổng 3000, xin SSL cho tên miền, nạp dữ liệu thử để kiểm tra | **Không ảnh hưởng.** VPS cũ vẫn chạy, tên miền vẫn trỏ VPS cũ. |
| **B. Ngày chuyển**<br>(khoảng 15–30 phút) | Sao lưu lần cuối ở VPS cũ, phục hồi trên VPS mới, dừng VPS cũ, đổi IP trên Cloudflare | Tạm ngừng nhập liệu trong lúc chuyển |

**Không cần tắt VPS cũ ở giai đoạn A.** Bước xin SSL chỉ tạo một bản ghi TXT tạm trên Cloudflare, không động tới bản ghi A `qlbv`.

### Chuẩn bị sẵn
- **Token Cloudflare** đã lưu từ lần cài trước. Hãy cất trong trình quản lý mật khẩu, không để ở tệp text trên máy dùng chung.
  - Token phải có quyền `Zone / DNS / Edit` và `Zone / Zone / Read` cho zone `bvqy4.io.vn`.
  - Token không được bị thu hồi (Roll/Delete) trên Cloudflare.
- **Email kỹ thuật** để nhận cảnh báo gia hạn Let's Encrypt.
- **Tài khoản quản trị QLBV** có quyền Sao lưu & phục hồi trên VPS cũ.

---

## A. Dựng VPS mới (VPS cũ vẫn chạy bình thường)

### A1. Cài Ubuntu và đặt IP tĩnh
1. Đặt IP tĩnh `172.16.13.76`, cùng lớp mạng, gateway và DNS với VPS cũ.
2. Kiểm tra:
   ```bash
   ip -4 addr
   ping -c 3 github.com
   ```
3. Nếu VPS cũ có bật `ufw`, mở cùng các cổng ở VPS mới:
   ```bash
   sudo ufw allow 22/tcp
   sudo ufw allow 443/tcp
   sudo ufw allow 3000/tcp
   ```

### A2. Cài AI Engine (`qlbs-attendance-web`)
```bash
sudo apt-get update && sudo apt-get install -y git curl
curl -fsSL https://get.docker.com | sudo sh
sudo git clone https://github.com/phanvanminh020310-dot/qlbs-attendance-web.git /opt/qlbs-ai-engine
cd /opt/qlbs-ai-engine && sudo cp .env.example .env && sudo docker compose up -d --build
curl -fsS http://127.0.0.1:8001/health        # phải thấy "online"
```
> Phải clone từ tài khoản `phanvanminh020310-dot` như lệnh trên. Lệnh cài một dòng trong README vẫn trỏ tới tài khoản cũ `pvminh94`, tài khoản này không còn tồn tại.

### A3. Cài QLBV
```bash
sudo git clone https://github.com/phanvanminh020310-dot/qlbv.git /opt/qlbs
cd /opt/qlbs && sudo bash deploy/install.sh
```
Cuối quá trình cài, script in ra tài khoản admin tạm. Hãy ghi lại, tài khoản này chỉ dùng đến bước A7.

### A4. Trỏ QLBV tới AI Engine của chính VPS mới
```bash
cd /opt/qlbs || exit 1
sudo sed -i '/AI_SERVICE_URL=/d' .env
sudo sed -i -e '$a\' .env
echo 'AI_SERVICE_URL=http://172.16.13.76:8001' | sudo tee -a .env
sudo docker compose up -d api
sudo docker compose exec api printenv AI_SERVICE_URL     # phải in ra http://172.16.13.76:8001
```
Lưu ý:
- **Không** để địa chỉ này trỏ về IP của VPS cũ. Nếu để vậy, VPS mới sẽ mất AI ngay khi tắt máy cũ.
- Tệp `.env` thuộc quyền root và là tệp ẩn. Muốn xem thì mở bằng `sudo nano /opt/qlbs/.env`.

### A5. Bật HTTPS tự ký cổng 3000 cho IP mới (bắt buộc trước bước A6)
```bash
cd /opt/qlbs && sudo bash deploy/bat-https-port-3000.sh
```
Khi được hỏi IP, nhập `172.16.13.76`.

Script ở bước A6 dựa vào kết quả bước này để gắn Nginx `:443` vào đúng IP LAN. Nếu bỏ qua A5, tên miền chỉ mở được ngay trên VPS, các máy khác không vào được.

### A6. Xin SSL Let's Encrypt cho tên miền (dùng lại token cũ)
```bash
cd /opt/qlbs && sudo bash deploy/update.sh
```
Lần chạy đầu, script hỏi 3 câu:

| Script hỏi | Nhập |
|---|---|
| `Hostname (ví dụ qlbv.example.vn):` | `qlbv.bvqy4.io.vn` (không có `https://`, không có `/`, không có `:3000`; **không bấm Enter bỏ trống**) |
| `Email nhận cảnh báo gia hạn Let's Encrypt:` | Email kỹ thuật |
| `Cloudflare API token (nhập ẩn…)` | Dán token đã lưu rồi Enter. Ô nhập không hiện gì khi dán, đó là bình thường. |

Kết quả cuối phải có các dòng ✓ sau:
- `Certificate hợp lệ, còn hạn và có SAN DNS:qlbv.bvqy4.io.vn`
- `Nginx HTTPS 172.16.13.76:443 → 127.0.0.1:3001 …` (phải là IP LAN, **không** phải `127.0.0.1:443`)
- `HTTPS qlbv.bvqy4.io.vn/health xác thực CA và phản hồi qua Nginx LAN 172.16.13.76`

Những điều cần biết về chứng chỉ:
- Chứng chỉ do **Let's Encrypt** cấp miễn phí. Cloudflare (gói Free) chỉ giữ DNS.
- Hai VPS cùng có chứng chỉ cho một tên miền là hợp lệ. Mỗi máy tự gia hạn lúc 03:17 hằng ngày.
- Giới hạn của Let's Encrypt cho cùng một tên miền là 5 chứng chỉ mới mỗi 7 ngày. Chạy lại `update.sh` không xin chứng chỉ mới, nên không lo chạm giới hạn này.
- Nếu dán sai token và muốn được hỏi lại: chạy `sudo rm -f /etc/qlbs/secrets/cloudflare-dns.ini`, rồi chạy lại `update.sh`. Sau 5 lần xác minh thất bại trong 1 giờ, Let's Encrypt chặn tạm, cần chờ 1 giờ.

### A7. Nạp dữ liệu thử để kiểm tra VPS mới
1. **VPS cũ:** vào *Sao lưu & phục hồi* → **Sao lưu ngay**. Mở chi tiết bản vừa tạo → **Tải bộ đầy đủ (`.bundle.tar.gz`)**.
   - Không dùng tệp `.json.gz`, vì tệp đó chỉ có CSDL, thiếu HSBA, ảnh khuôn mặt và phông chữ.
2. **VPS mới:** mở theo IP `https://172.16.13.76:3000`, không mở theo tên miền vì tên miền vẫn trỏ VPS cũ. Đăng nhập bằng admin tạm của bước A3.
3. Bấm **Tải lên backup / bundle**, chọn tệp `.bundle.tar.gz`. Sau đó bấm **Phục hồi** ở dòng vừa tải lên và gõ chữ xác nhận.
4. Trang tự tải lại. Từ đây đăng nhập bằng **tài khoản của VPS cũ**.
5. **Tắt Telegram ngay trên VPS mới:** *Cấu hình hệ thống* → nhóm *Thông báo* → tắt **"Gửi thông báo qua Telegram Bot"** → Lưu.
   - Nếu không tắt, hai máy cùng chạy một bot: Telegram báo lỗi 409 và nhân viên nhận tin trùng.
6. Kiểm tra trên VPS mới: đăng nhập, bảng chấm công, HSBA, xuất Excel/PDF, quét mặt (AI).

Giới hạn tải lên: bộ đầy đủ tới 20 GB. Riêng phần CSDL khi giải nén phải dưới khoảng 500 MB; hiện CSDL chỉ khoảng 20 MB nén.

> Dữ liệu này chỉ là **ảnh chụp tại thời điểm sao lưu**. Những gì nhân viên nhập tiếp trên VPS cũ sẽ được chuyển ở bước B2.

Có thể dừng ở đây bao lâu cũng được, vài ngày hay vài tuần. Chứng chỉ trên VPS mới vẫn tự gia hạn bình thường.

---

## B. Ngày chuyển

### B1. Hôm trước: hạ TTL
Vào Cloudflare → `bvqy4.io.vn` → **DNS → Records** → bản ghi `A qlbv` → **Edit** → **TTL = 1 min** → **Save**. Nhờ vậy, khi đổi IP, các máy nhận địa chỉ mới nhanh hơn.

### B2. Sao lưu lần cuối và phục hồi
1. Báo mọi người **tạm ngừng nhập liệu**.
2. Cho cả hai VPS chạy cùng phiên bản bằng lệnh:
   ```bash
   cd /opt/qlbs && sudo bash deploy/update.sh
   ```
3. **VPS cũ:** **Sao lưu ngay** → **Tải bộ đầy đủ**.
4. **VPS mới** (`https://172.16.13.76:3000`): **Tải lên** → **Phục hồi** (như bước A7).
5. Sau khi phục hồi, Telegram trên VPS mới **tự bật lại theo dữ liệu cũ**. Hãy tắt nó lần nữa cho tới bước B5.

### B3. Dừng VPS cũ
```bash
cd /opt/qlbs && sudo docker compose stop
cd /opt/qlbs-ai-engine 2>/dev/null && sudo docker compose stop
```
Các container dùng `restart: unless-stopped`, nên khởi động lại máy cũ cũng không tự chạy lại.

### B4. Đổi IP trên Cloudflare
Vào Cloudflare → **DNS → Records** → bản ghi `A qlbv` → **Edit**:
- **IPv4 address:** `172.16.13.76`
- **Proxy status:** giữ **DNS only (mây xám)**. **Không bật mây cam**, vì IP nội bộ `172.16.x.x` không đi qua proxy Cloudflare được.
- Bấm **Save**.

Thường sau 1–5 phút, các máy sẽ tự vào VPS mới. Người dùng, kiosk và điện thoại không phải sửa gì.

### B5. Bật lại Telegram và kiểm tra
- **VPS mới:** bật lại "Gửi thông báo qua Telegram Bot" rồi gửi thử một thông báo.
- Kiểm tra từ máy Windows trong mạng bệnh viện (xem mục C).
- Trên Wi-Fi bệnh viện, mở `https://qlbv.bvqy4.io.vn` bằng Android và iPhone. Cho Kiosk tạo QR, quét bằng Camera và thử quét mặt.

### B6. Sau khi chuyển
- Giữ VPS cũ ở trạng thái tắt 1–2 tuần làm dự phòng. **Không bật lại ứng dụng** trên đó.
- Khi bỏ hẳn VPS cũ, ngừng lịch gia hạn chứng chỉ bên đó (không bắt buộc):
  ```bash
  sudo rm -f /etc/cron.d/qlbs-letsencrypt-renew
  ```
- Truy cập từ xa: cài Tailscale cho VPS mới theo [HUONG-DAN-TAILSCALE.md](HUONG-DAN-TAILSCALE.md) (dùng lại Gmail cũ; trên VPS cũ chạy `sudo tailscale logout` và Remove máy cũ trên Admin console).

---

## C. Kiểm tra tên miền trỏ đúng IP (Windows)

Mở **CMD**:
```bat
ipconfig /flushdns
nslookup qlbv.bvqy4.io.vn 1.1.1.1
nslookup qlbv.bvqy4.io.vn
curl.exe -sv -o NUL https://qlbv.bvqy4.io.vn/health 2>&1 | findstr /i "Connected HTTP/"
findstr /i "bvqy4" C:\Windows\System32\drivers\etc\hosts
```

| Lệnh | Kết quả đúng |
|---|---|
| `nslookup … 1.1.1.1` | `Address: 172.16.13.76`. Đây là kết quả Cloudflare công khai: nếu đúng thì bản ghi đã đổi xong. |
| `nslookup …` (không ghi máy chủ DNS) | `Address: 172.16.13.76`. Đây là DNS mà máy đang dùng. Nếu vẫn ra `.75`, chờ hết TTL hoặc xóa cache DNS của router/DNS nội bộ. |
| `curl.exe …` | Có dòng `Connected to qlbv.bvqy4.io.vn (172.16.13.76) port 443` và `HTTP/1.1 200`. Đây là bằng chứng máy đang thật sự vào VPS mới, chứng chỉ hợp lệ. |
| `findstr … hosts` | **Không in gì.** Nếu còn dòng `bvqy4` trong tệp hosts thì xóa dòng đó, vì nó ghi đè DNS. |

Nếu muốn dùng **PowerShell**:
```powershell
Clear-DnsClientCache
Resolve-DnsName qlbv.bvqy4.io.vn -Type A -Server 1.1.1.1
Test-NetConnection qlbv.bvqy4.io.vn -Port 443      # RemoteAddress = 172.16.13.76, TcpTestSucceeded = True
```

Trên **điện thoại**: tắt rồi bật lại Wi-Fi để xóa bộ nhớ DNS.

---

## D. Kiosk

| Kiosk cài theo | Sau khi đổi IP |
|---|---|
| `https://qlbv.bvqy4.io.vn` (chứng chỉ Let's Encrypt) | **Không phải sửa gì.** Tên miền tự trỏ sang VPS mới, và Windows tin cậy sẵn chứng chỉ Let's Encrypt. Nếu kiosk yêu cầu xác thực lại, dùng PIN IT như khi khởi động lại máy chủ. Nếu kiosk vẫn vào máy cũ, chạy `ipconfig /flushdns` hoặc khởi động lại PC. |
| `https://172.16.13.75:3000` (gói tự ký, ghim mã băm chứng chỉ) | **Mất kết nối.** Cần tạo gói cài mới cho `https://172.16.13.76:3000` theo [`deploy/windows/GOI_CAI_DAT_NOI_BO.md`](../deploy/windows/GOI_CAI_DAT_NOI_BO.md). |

Về PIN IT:
- PIN đặt trong *Cấu hình hệ thống* đã đi theo bản sao lưu.
- Nếu VPS cũ đặt PIN bằng dòng `IT_MASTER_PIN=` trong tệp `.env`, hãy chép đúng dòng đó sang `/opt/qlbs/.env` của VPS mới, rồi chạy `sudo docker compose up -d api`.

---

## E. Quay lại VPS cũ khi có sự cố

1. **VPS mới:** `cd /opt/qlbs && sudo docker compose stop web api`
2. **VPS cũ:** `cd /opt/qlbs && sudo docker compose up -d`. AI Engine bên đó cũng chạy lại tương tự.
3. **Cloudflare:** đổi bản ghi A `qlbv` về `172.16.13.75`.

> Những gì đã nhập trên VPS mới sau giờ chuyển sẽ không có ở VPS cũ. Nếu đã chạy lâu trên VPS mới, hãy làm bước B2 theo chiều ngược: sao lưu VPS mới, phục hồi vào VPS cũ.

---

## F. Lỗi hay gặp

| Hiện tượng | Xử lý |
|---|---|
| Bước A6 báo Nginx `127.0.0.1:443`, hoặc máy khác không mở được tên miền trên VPS mới | Chưa làm bước A5. Chạy A5, rồi chạy lại `update.sh`. Kiểm tra bằng `sudo ss -ltnp 'sport = :443'`. |
| `bind() to 172.16.13.75:443 failed (Cannot assign requested address)` | Tệp `.env` của VPS mới đang chứa IP cũ, thường do chép nguyên `.env` từ máy cũ. Sửa `CORS_ORIGINS` và `SCAN_BASE_URL` sang `.76`, hoặc chạy lại A5, rồi chạy `update.sh`. **Không chép nguyên `.env` cũ sang máy mới.** |
| `Token Cloudflare trống/không hợp lệ`, hoặc certbot báo lỗi xác thực | Token bị dán thừa ký tự, đã bị thu hồi hoặc thiếu quyền. Xóa `/etc/qlbs/secrets/cloudflare-dns.ini` rồi chạy lại `update.sh`. |
| Tải lên bản sao lưu báo 504 | VPS chưa có bản sửa lỗi tải lên (commit `0c17cc9` trở về sau). Chạy `update.sh`. |
| Máy vẫn vào VPS cũ sau khi đổi IP | Máy còn nhớ địa chỉ cũ, hoặc tệp hosts còn dòng `bvqy4`. Xem mục C. |
| Điện thoại trên Wi-Fi không phân giải được tên miền | Router hoặc DNS bệnh viện chặn tên miền công khai trỏ về IP nội bộ (chống "DNS rebinding"). Thêm ngoại lệ cho `bvqy4.io.vn`. **Không** bật Cloudflare Proxy. |
| Quét mặt báo lỗi AI | Kiểm tra `curl http://172.16.13.76:8001/health` và `sudo docker compose exec api printenv AI_SERVICE_URL`. |
| Telegram báo `409 Conflict` | Còn máy khác đang chạy cùng bot. Dừng ứng dụng ở VPS cũ (B3). |

---

## Phụ lục: chuyển dữ liệu bằng dòng lệnh (khi CSDL rất lớn)

Cách này dùng **thay cho bước B2** khi bản sao lưu quá lớn, không tải qua giao diện được.

**VPS cũ:**
```bash
cd /opt/qlbs
sudo docker compose stop web api
sudo docker compose exec -T postgres pg_dump -U qlbs -d qlbs -Fc > /tmp/qlbs.dump
sudo tar czf /tmp/qlbs-files.tgz -C /opt/qlbs/data uploads backups
scp /tmp/qlbs.dump /tmp/qlbs-files.tgz bvqy4@172.16.13.76:/tmp/
```

**VPS mới:**
```bash
cd /opt/qlbs
sudo docker compose stop web api
sudo docker compose exec -T postgres dropdb  -U qlbs --force qlbs
sudo docker compose exec -T postgres createdb -U qlbs -O qlbs qlbs
sudo docker compose exec -T postgres pg_restore -U qlbs -d qlbs --no-owner --exit-on-error < /tmp/qlbs.dump
sudo tar xzf /tmp/qlbs-files.tgz -C /opt/qlbs/data
sudo chown -R 1000:1000 /opt/qlbs/data/uploads /opt/qlbs/data/backups
sudo docker compose up -d
```
