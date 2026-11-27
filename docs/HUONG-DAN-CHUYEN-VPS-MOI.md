# Chuyển QLBV + AI Engine sang VPS mới và trỏ tên miền `qlbv.bvqy4.io.vn`

Tài liệu này hướng dẫn cách dựng một VPS mới, ví dụ `172.16.13.76`, chạy **song song** với VPS đang dùng `172.16.13.75`. Khi VPS mới ổn định, ta chuyển dữ liệu sang và đổi tên miền `qlbv.bvqy4.io.vn` trỏ tới VPS mới.

Tài liệu này bổ sung cho [`HUONG-DAN-HTTPS-HOSTNAME-LAN.md`](HUONG-DAN-HTTPS-HOSTNAME-LAN.md), là tài liệu thiết lập Let's Encrypt và Cloudflare DNS-01 ban đầu.

> Thay `172.16.13.76` bằng IP thật của VPS mới ở mọi chỗ trong tài liệu.
> Lệnh nào có `sudo docker compose` thì phải chạy trong thư mục `/opt/qlbs`.

---

## 0. Hiểu nhanh trước khi làm

| Thành phần | Nằm ở đâu | Khi đổi VPS |
|---|---|---|
| Bản ghi DNS `A qlbv` | Cloudflare, chế độ **DNS only** (mây xám) | Sửa IP `.75` → `.76`. Đây là bước **cuối cùng**. |
| Chứng chỉ Let's Encrypt cho tên miền | Trên từng VPS: `/etc/letsencrypt` | VPS mới **tự xin chứng chỉ riêng** bằng DNS-01. Việc này chỉ tạo bản ghi TXT, không cần đổi bản ghi A trước. Hai VPS cùng có chứng chỉ cho một tên miền cũng không sao. |
| Token Cloudflare | `/etc/qlbs/secrets/cloudflare-dns.ini` (root, 600) | Chép từ VPS cũ sang, hoặc tạo token mới. |
| HTTPS tự ký `https://IP:3000` | `data/ssl/` + Nginx `qlbs-ssl-3000.conf` | VPS mới sinh chứng chỉ mới cho IP `.76`. |
| Dữ liệu (CSDL, ảnh, tệp) | `data/postgres`, `data/uploads`, `data/backups` | Chuyển **một lần** lúc đổi máy (mục 4). |
| AI Engine (`qlbs-attendance-web`) | `/opt/qlbs-ai-engine`, cổng 8001 | Cài lại. Không có dữ liệu riêng (stateless). |

**Nguyên tắc chính:**

- Hai VPS chạy song song chỉ để **thử nghiệm**. Dữ liệu thật vẫn nhập ở VPS cũ.
- Lúc chuyển: dừng VPS cũ, chép dữ liệu sang VPS mới, đổi DNS, rồi **không bật lại ứng dụng ở VPS cũ**. Nếu cả hai cùng chạy với cùng dữ liệu, sẽ có ba vấn đề:
  - Bot Telegram bị xung đột.
  - Thông báo và báo cáo tổng hợp bị gửi hai lần.
  - Dữ liệu tách đôi giữa hai máy.

---

## 1. Chuẩn bị VPS mới

1. Cài Ubuntu Server. Đặt **IP tĩnh** `172.16.13.76`, cùng lớp mạng, gateway và DNS như VPS cũ.
2. Kiểm tra:
   ```bash
   ip -4 addr        # phải thấy 172.16.13.76
   ping -c 3 172.16.13.75
   ping -c 3 github.com
   ```
3. Nếu VPS cũ có dùng tường lửa (`sudo ufw status`), mở cùng các cổng đó ở VPS mới:
   ```bash
   sudo ufw allow 22/tcp; sudo ufw allow 443/tcp; sudo ufw allow 3000/tcp
   ```
   Chỉ mở cổng `8001` (AI Engine) cho máy cần gọi tới nó, không mở ra toàn mạng.
4. Nếu VPS cũ có Tailscale để truy cập từ xa, cài Tailscale ở VPS mới như cũ.

---

## 2. Cài hai phần mềm lên VPS mới (chạy thử, dữ liệu trống)

### 2.1 AI Engine (`qlbs-attendance-web`)

```bash
sudo apt-get update && sudo apt-get install -y git curl
curl -fsSL https://get.docker.com | sudo sh          # bỏ qua nếu đã có Docker
sudo git clone https://github.com/phanvanminh020310-dot/qlbs-attendance-web.git /opt/qlbs-ai-engine
cd /opt/qlbs-ai-engine
sudo cp .env.example .env
sudo docker compose up -d --build
curl -fsS http://127.0.0.1:8001/health                # phải trả "online"
```

> Hãy clone đúng tài khoản `phanvanminh020310-dot` như lệnh trên. Lệnh cài một dòng trong README đang trỏ tới tài khoản cũ `pvminh94`, nay không còn tồn tại.

### 2.2 QLBV

```bash
sudo git clone https://github.com/phanvanminh020310-dot/qlbv.git /opt/qlbs
cd /opt/qlbs
sudo bash deploy/install.sh
```

`install.sh` tự cài Docker, tự sinh `.env` với mật khẩu ngẫu nhiên, dựng CSDL, API, Web và tự kiểm tra. Cuối cùng script in ra **tài khoản admin**; hãy ghi lại để đăng nhập thử.

### 2.3 Trỏ QLBV tới AI Engine của chính VPS mới

Trên **VPS cũ**, xem giá trị đang dùng:
```bash
grep '^AI_SERVICE_URL' /opt/qlbs/.env
```

Trên **VPS mới**, đặt giá trị tương ứng. AI Engine chạy cùng máy, nên trỏ vào IP của chính VPS mới (hoặc `host.docker.internal`):
```bash
cd /opt/qlbs || exit 1
sudo sed -i '/AI_SERVICE_URL=/d' .env                 # xóa mọi dòng cũ có AI_SERVICE_URL
sudo sed -i -e '$a\' .env                            # bảo đảm cuối tệp có xuống dòng, tránh dính vào dòng trước
echo 'AI_SERVICE_URL=http://172.16.13.76:8001' | sudo tee -a .env
sudo grep -n 'AI_SERVICE_URL' .env                    # phải thấy đúng 1 dòng, đứng riêng
sudo docker compose up -d api
sudo docker compose exec api printenv AI_SERVICE_URL  # container phải in ra http://172.16.13.76:8001
```

> Tệp `.env` thuộc root và đang ẩn (tên bắt đầu bằng dấu chấm). Hãy mở bằng `sudo nano /opt/qlbs/.env`, rồi bấm Ctrl+W để tìm. Nếu mở bằng WinSCP/MobaXterm với user thường, bạn có thể đang xem nhầm tệp `/opt/qlbs-ai-engine/.env` hoặc một bản cũ.

> **Không** để VPS mới trỏ tới `172.16.13.75:8001`. Nếu để vậy, máy mới vẫn chạy được lúc đầu, nhưng sẽ hỏng ngay khi tắt VPS cũ.

### 2.4 HTTPS tự ký cổng 3000 cho IP mới (làm **trước** bước tên miền)

```bash
cd /opt/qlbs && sudo bash deploy/bat-https-port-3000.sh
```

Khi script hỏi IP, nhập `172.16.13.76`. Script sẽ làm các việc sau:
- tạo chứng chỉ tự ký cho `.76`;
- dựng Nginx lắng nghe `3000` → web nội bộ `3001`;
- ghi `SCAN_BASE_URL=https://172.16.13.76:3000`.

> Bắt buộc làm bước này trước mục 2.5. Script tên miền dựa vào `https://<IP>:3000` để biết phải gắn Nginx `:443` vào IP nào. Nếu bỏ qua, Nginx tên miền chỉ nghe ở `127.0.0.1`, và các máy khác trong mạng không truy cập được.

### 2.5 Chứng chỉ Let's Encrypt cho tên miền trên VPS mới (DNS vẫn trỏ `.75`)

Có hai cách lấy token Cloudflare. **Cách A** là chép token từ VPS cũ (đơn giản nhất). Thay `bvqy4` bằng user SSH thật của VPS mới.

Trên **VPS cũ**:
```bash
sudo install -o "$USER" -m 600 /etc/qlbs/secrets/cloudflare-dns.ini /tmp/cf.ini
scp /tmp/cf.ini bvqy4@172.16.13.76:/tmp/cf.ini && rm -f /tmp/cf.ini
```

Trên **VPS mới**:
```bash
sudo install -D -o root -g root -m 600 /tmp/cf.ini /etc/qlbs/secrets/cloudflare-dns.ini && rm -f /tmp/cf.ini
```

**Cách B** là tạo token mới. Vào Cloudflare → *My Profile* → *API Tokens* → *Create Token* → mẫu **Edit zone DNS**. Ở phần *Zone Resources*, chọn `Include – Specific zone – bvqy4.io.vn` và thêm quyền `Zone / Zone / Read`. Script sẽ hỏi token này (nhập ẩn).

Sau đó chạy:
```bash
cd /opt/qlbs && sudo bash deploy/update.sh
```

Script sẽ hỏi:
1. Hostname: `qlbv.bvqy4.io.vn`.
2. Email Let's Encrypt.
3. Token Cloudflare, nếu chọn cách B.

Tiếp theo script sẽ:
- xin chứng chỉ qua DNS-01;
- dựng Nginx `172.16.13.76:443`;
- đặt `SCAN_BASE_URL` và `PUBLIC_URL` thành `https://qlbv.bvqy4.io.vn`;
- giữ `https://172.16.13.76:3000` trong `CORS_ORIGINS`;
- tạo lịch tự gia hạn lúc 03:17 hằng ngày.

Script tự kiểm tra tên miền **trực tiếp trên IP `.76`**, nên không cần đổi DNS trước. Dòng cuối phải báo ✓ cho `HTTPS qlbv.bvqy4.io.vn` qua `172.16.13.76`.

> **Không** chép nguyên tệp `.env` của VPS cũ sang VPS mới. Tệp đó chứa `https://172.16.13.75:3000`, nên Nginx ở VPS mới sẽ cố gắn vào IP `.75` mà máy mới không có, rồi báo lỗi `cannot assign requested address`. Chỉ chép vài dòng bí mật theo mục 4.4.

---

## 3. Thử nghiệm VPS mới khi DNS vẫn trỏ VPS cũ

Trên **một máy tính thử nghiệm** (không phải mọi máy), thêm một dòng vào tệp hosts để riêng máy này tìm tên miền ở VPS mới:

- Windows: mở Notepad bằng *Run as administrator*, mở `C:\Windows\System32\drivers\etc\hosts` rồi thêm dòng:
  ```
  172.16.13.76  qlbv.bvqy4.io.vn
  ```
- Chạy `ipconfig /flushdns`, rồi mở `https://qlbv.bvqy4.io.vn`. Trình duyệt phải hiện **ổ khóa hợp lệ**, không có cảnh báo chứng chỉ.

Kiểm tra trên VPS mới:
```bash
cd /opt/qlbs
sudo docker compose ps                               # tất cả Up / healthy
curl -fsS http://127.0.0.1:3001/health
curl -fsS --resolve qlbv.bvqy4.io.vn:443:172.16.13.76 https://qlbv.bvqy4.io.vn/health
curl -kfsS https://172.16.13.76:3000/health
sudo certbot certificates                            # có qlbv.bvqy4.io.vn, còn hạn
```

Trong giai đoạn này, hãy thử đăng nhập, xem các màn hình và xuất Excel/PDF. Dữ liệu ở đây là dữ liệu trống hoặc thử nghiệm. Thử xong thì **xóa dòng vừa thêm trong tệp hosts**.

> Không thử quét QR bằng điện thoại ở VPS mới trong giai đoạn này. QR dùng tên miền, mà DNS công khai vẫn đưa điện thoại về VPS cũ. Việc thử QR làm ở bước nghiệm thu (mục 6).

---

## 4. Ngày chuyển: dời dữ liệu từ VPS cũ sang VPS mới

Cần khoảng 15–45 phút ngừng dịch vụ, tùy dung lượng dữ liệu. Hãy báo trước cho người dùng.

### 4.1 Một ngày trước: hạ TTL bản ghi DNS

Vào Cloudflare → `bvqy4.io.vn` → **DNS → Records** → bản ghi `A` `qlbv` → **Edit**. Đặt **TTL = 1 min**, giữ **DNS only** (mây xám), rồi bấm **Save**. Nhờ vậy, đến ngày chuyển, các máy sẽ nhận IP mới nhanh hơn.

### 4.2 Cho hai máy chạy cùng phiên bản mã

Chạy trên **cả hai** VPS:
```bash
cd /opt/qlbs && sudo bash deploy/update.sh
git -C /opt/qlbs log -1 --format=%h                 # hai máy phải ra cùng một mã commit
```

### 4.3 Dừng VPS cũ và sao lưu

Chạy trên **VPS cũ (.75)**:
```bash
cd /opt/qlbs
sudo docker compose stop web api                     # ngừng ghi dữ liệu, CSDL vẫn chạy
sudo docker compose exec -T postgres pg_dump -U qlbs -d qlbs -Fc > /tmp/qlbs.dump
sudo docker compose exec -T postgres pg_restore --list < /tmp/qlbs.dump > /dev/null && echo "DUMP OK"
sudo tar czf /tmp/qlbs-files.tgz -C /opt/qlbs/data uploads backups
ls -lh /tmp/qlbs.dump /tmp/qlbs-files.tgz
```

### 4.4 Chép sang VPS mới

Chạy trên **VPS cũ**, thay `bvqy4` bằng user SSH thật của VPS mới:
```bash
scp /tmp/qlbs.dump /tmp/qlbs-files.tgz bvqy4@172.16.13.76:/tmp/
grep -E '^(JWT_SECRET|JWT_REFRESH_SECRET|IT_MASTER_PIN|BIOMETRIC_SECRET)=' /opt/qlbs/.env
```

Mở `/opt/qlbs/.env` trên **VPS mới**. Với mỗi dòng in ra ở lệnh trên, sửa dòng cùng tên cho đúng giá trị như VPS cũ. Dòng nào chưa có thì thêm vào.

- Lý do: người dùng giữ được phiên đăng nhập, và mã PIN quản trị của Kiosk giữ nguyên.
- **Không** chép `POSTGRES_PASSWORD`, `CORS_ORIGINS`, `SCAN_BASE_URL`, `PUBLIC_URL` hay `WEB_PORT`.

### 4.5 Nạp dữ liệu vào VPS mới

Chạy trên **VPS mới (.76)**:
```bash
cd /opt/qlbs
sudo docker compose stop web api
sudo docker compose exec -T postgres dropdb  -U qlbs --force qlbs
sudo docker compose exec -T postgres createdb -U qlbs -O qlbs qlbs
sudo docker compose exec -T postgres pg_restore -U qlbs -d qlbs --no-owner --exit-on-error < /tmp/qlbs.dump && echo "RESTORE OK"
sudo tar xzf /tmp/qlbs-files.tgz -C /opt/qlbs/data
sudo chown -R 1000:1000 /opt/qlbs/data/uploads /opt/qlbs/data/backups
sudo docker compose up -d
sudo docker compose logs --tail=60 api               # không có lỗi migration
curl -fsS http://127.0.0.1:3001/health
```

Đăng nhập bằng **tài khoản thật của VPS cũ** (tài khoản admin sinh lúc cài thử đã bị dữ liệu thật thay thế). Kiểm tra vài số liệu, ví dụ bảng chấm công tháng này hay danh sách nhân viên, xem có khớp VPS cũ không.

---

## 5. Đổi tên miền sang VPS mới

1. Vào Cloudflare → `bvqy4.io.vn` → **DNS → Records** → bản ghi `A` `qlbv` → **Edit**.
2. Đổi **IPv4 address** từ `172.16.13.75` thành `172.16.13.76`.
3. **Proxy status** giữ **DNS only** (mây xám). **Không bật mây cam**, vì IP `172.16.x.x` là IP nội bộ, Cloudflare Proxy không tới được.
4. Bấm **Save**.

Kiểm tra từ một máy trong mạng bệnh viện:
```bat
nslookup qlbv.bvqy4.io.vn 1.1.1.1
nslookup qlbv.bvqy4.io.vn
```
Cả hai lệnh phải trả về `172.16.13.76`. Nếu lệnh thứ hai (DNS nội bộ) vẫn ra `.75`, hãy chờ vài phút hoặc xóa cache DNS của router/DNS bệnh viện. Trên máy tính, chạy `ipconfig /flushdns`. Trên điện thoại, tắt rồi bật lại Wi-Fi.

---

## 6. Nghiệm thu sau khi đổi

Kiểm tra trên **Wi-Fi bệnh viện** (không dùng 4G):

1. Mở `https://qlbv.bvqy4.io.vn` trên máy tính, Android và iPhone. Trình duyệt phải hiện ổ khóa hợp lệ, đăng nhập được và dữ liệu đúng.
2. Cho Kiosk tạo QR mới, rồi quét bằng camera của Android và iPhone. Kiểm tra:
   - liveness và nhận diện khuôn mặt chạy được (tức là AI Engine `.76:8001` hoạt động);
   - Kiosk đúng phòng được mở.
3. Nếu có dùng Telegram, gửi thử một thông báo, ví dụ giao một việc cho chính mình.
4. Trên VPS mới, xem log để chắc không có lỗi:
   ```bash
   sudo docker compose logs --tail=100 api | grep -iE "error|telegram" || true
   ```

---

## 7. Máy Kiosk Windows cũ dùng `https://172.16.13.75:3000`

Bộ cài Kiosk P2 được **ghim** theo URL `https://172.16.13.75:3000` và mã băm (SHA-256) của chứng chỉ tự ký trên VPS cũ. Sau khi chuyển, VPS mới có IP và chứng chỉ khác, nên **các Kiosk này sẽ không kết nối được** cho tới khi được cấu hình lại.

**Phương án 1 (đúng thiết kế):** tạo hồ sơ Kiosk mới theo mục 4 của [`deploy/NANG_CAP_VPS_CU_VA_HTTPS.md`](../deploy/NANG_CAP_VPS_CU_VA_HTTPS.md). Gửi URL `https://172.16.13.76:3000`, mã phòng và mã băm lấy bằng lệnh:
```bash
sha256sum /opt/qlbs/data/ssl/server.crt
```

**Phương án 2 (không phải động vào Kiosk):** sau khi VPS mới chạy ổn, **đổi IP của VPS mới thành `172.16.13.75`** và tắt hoặc đổi IP của VPS cũ. Sau đó chép `data/ssl/server.crt` và `server.key` của VPS cũ sang, rồi chạy lại `update.sh` để Nginx gắn vào IP `.75`. Với phương án này thì **không cần sửa DNS**. Làm theo phương án 1 nếu không chắc chắn.

---

## 8. Sau khi chuyển: xử lý VPS cũ

Chạy trên **VPS cũ**:
```bash
cd /opt/qlbs
sudo docker compose stop                              # dừng hẳn; restart=unless-stopped nên khởi động lại máy cũng không tự chạy
sudo rm -f /etc/cron.d/qlbs-letsencrypt-renew         # ngừng gia hạn chứng chỉ ở máy cũ (không bắt buộc)
cd /opt/qlbs-ai-engine 2>/dev/null && sudo docker compose stop
```

- Giữ VPS cũ ở trạng thái tắt **1–2 tuần** để làm bản dự phòng, rồi mới xóa.
- **Không bật lại** ứng dụng ở VPS cũ khi DNS đã trỏ VPS mới.
- Nếu dùng cách B (token Cloudflare mới) và định bỏ hẳn VPS cũ, hãy vào Cloudflare → *API Tokens* để **thu hồi token cũ**.

---

## 9. Quay lại VPS cũ nếu có sự cố (rollback)

Chỉ nên làm trong vài giờ đầu sau khi chuyển.

1. Trên VPS mới: `cd /opt/qlbs && sudo docker compose stop web api`.
2. Trên VPS cũ: `cd /opt/qlbs && sudo docker compose up -d`.
3. Trên Cloudflare: đổi bản ghi `A qlbv` về `172.16.13.75` (DNS only).

> Dữ liệu nhập trên VPS mới **sau** giờ chuyển sẽ không có trên VPS cũ. Nếu đã chạy lâu trên VPS mới, đừng quay lại kiểu này. Thay vào đó, làm lại mục 4 theo chiều ngược: sao lưu VPS mới rồi nạp vào VPS cũ.

---

## 10. Lỗi hay gặp

| Hiện tượng | Nguyên nhân và cách xử lý |
|---|---|
| `nginx: [emerg] bind() to 172.16.13.75:443 failed (99: Cannot assign requested address)` trên VPS mới | `.env` còn IP cũ. Sửa `CORS_ORIGINS` và `SCAN_BASE_URL` sang `.76` (hoặc chạy lại mục 2.4), rồi chạy `sudo bash deploy/update.sh`. |
| Tên miền chỉ chạy ở chính VPS, máy khác không vào được | Nginx tên miền đang nghe `127.0.0.1:443` do bỏ qua mục 2.4. Kiểm tra bằng `sudo ss -ltnp 'sport = :443'`. Chạy mục 2.4 rồi chạy lại `update.sh`. |
| Trình duyệt vẫn vào VPS cũ sau khi đổi DNS | Do cache DNS. Chạy `ipconfig /flushdns`, chờ hết TTL, kiểm tra DNS nội bộ/router, và kiểm tra máy đó còn dòng tên miền trong tệp hosts từ mục 3 không. |
| Điện thoại trên Wi-Fi không phân giải được tên miền | Router hoặc DNS bệnh viện chặn tên miền công khai trỏ về IP nội bộ (DNS rebinding protection). Thêm ngoại lệ cho `bvqy4.io.vn` trên router/DNS. **Không** bật Cloudflare Proxy. |
| Quét mặt báo lỗi AI | `AI_SERVICE_URL` trên VPS mới sai, hoặc AI Engine chưa chạy. Kiểm tra bằng `curl http://172.16.13.76:8001/health` và `cd /opt/qlbs-ai-engine && sudo docker compose ps`. |
| Telegram báo `409 Conflict` | Còn một máy khác đang chạy cùng bot. Hãy dừng ứng dụng ở VPS cũ (mục 8). |
| `certbot` báo lỗi khi xin chứng chỉ ở mục 2.5 | Token Cloudflare sai hoặc thiếu quyền `Zone/DNS/Edit` và `Zone/Zone/Read`, hoặc VPS mới không ra được Internet tới `acme-v02.api.letsencrypt.org`. |
