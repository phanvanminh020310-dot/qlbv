# Triển khai — QLBS

Tài liệu này hướng dẫn đưa hệ thống lên máy chủ thật (VPS/ máy chủ bệnh viện) bằng
Docker Compose, cách sao lưu và nâng cấp.

## 1. Yêu cầu

| Thành phần | Tối thiểu | Khuyến nghị |
|---|---|---|
| Máy chủ | 2 vCPU, 4 GB RAM, 40 GB đĩa | 4 vCPU, 8 GB RAM, SSD 100 GB |
| Hệ điều hành | Linux x86_64 (Ubuntu 22.04/24.04) | Ubuntu 24.04 LTS |
| Phần mềm | Docker Engine 24+, Docker Compose v2 | bản mới nhất |
| Mạng | Cổng 80/443 mở nếu dùng tên miền và HTTPS | chứng chỉ Let's Encrypt |

## 2. Cài đặt

### 2.1. Một lệnh (khuyến nghị)

Script `deploy/install.sh` cài trọn gói: tự cài Docker nếu thiếu, sinh `.env`
với bí mật ngẫu nhiên, dựng hệ thống và **tự kiểm tra** (health, đăng nhập,
proxy web → API) rồi in kết luận OK hay chưa:

```bash
# Đã clone mã nguồn:
git clone https://github.com/pvminh94/qlbv.git /opt/qlbs && cd /opt/qlbs
sudo bash deploy/install.sh

# Hoặc dán nguyên câu lệnh này vào VPS (tự tải mã nguồn về /opt/qlbs):
curl -fsSL https://raw.githubusercontent.com/pvminh94/qlbv/main/deploy/install.sh | sudo bash -s --
```

Một số tùy chọn hay dùng:

```bash
sudo bash deploy/install.sh --demo                 # thêm dữ liệu mẫu để xem giao diện
sudo bash deploy/install.sh --web-port 8080        # đổi cổng giao diện
sudo bash deploy/install.sh --domain qlbs.benhvien.vn   # khi đã có HTTPS
sudo bash deploy/install.sh --admin-pass 'MK-cua-ban'   # tự chọn mật khẩu admin
```

Tài khoản quản trị và địa chỉ truy cập được in ra cuối script (lưu sẵn trong
`data/thong-tin-dang-nhap.txt`). Script idempotent — chạy lại nhiều lần vẫn an toàn.

### 2.2. Cài thủ công từng bước

```bash
# 1) Lấy mã nguồn
git clone <địa-chỉ-kho> /opt/qlbs && cd /opt/qlbs

# 2) Tạo tệp cấu hình và ĐỔI MẬT KHẨU
cp .env.example .env
nano .env      # POSTGRES_PASSWORD, REDIS_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET, ADMIN_PASSWORD

# 3) Dựng và chạy (lần đầu sẽ biên dịch, mất vài phút)
docker compose up -d --build

# 4) Theo dõi
docker compose ps
docker compose logs -f api
```

Khi container `api` khởi động, nó tự chạy **migration + dữ liệu nền** (idempotent —
chạy lại nhiều lần vẫn an toàn) rồi mới mở cổng 4000.

| Dịch vụ | Địa chỉ mặc định | Ghi chú |
|---|---|---|
| Giao diện | `http://<máy-chủ>:3000` | đổi cổng bằng `WEB_PORT` trong `.env` |
| API | `http://<máy-chủ>:4000/api` | đổi cổng bằng `API_PORT` |
| Swagger | `http://<máy-chủ>:4000/api/docs` | tắt bằng `SWAGGER_ENABLED=false` khi chạy thật |
| PostgreSQL | trong mạng `qlbs-network` | **không** mở ra ngoài |
| Redis | trong mạng `qlbs-network` | **không** mở ra ngoài |

Đăng nhập lần đầu bằng tài khoản trong `.env` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`).

## 3. Dùng sau proxy và tên miền (HTTPS)

Nếu bệnh viện đang dùng Kiosk self-signed tại `https://IP:3000` và cần bổ sung hostname Let’s Encrypt mà không gián đoạn hệ thống cũ, dùng quy trình một lệnh trong [Hướng dẫn HTTPS hostname LAN](HUONG-DAN-HTTPS-HOSTNAME-LAN.md). Quy trình đó tạo vhost `443` riêng và **không** áp dụng mẫu generic bên dưới lên vhost IP legacy.

Mẫu cấu hình Nginx đầy đủ (gồm cả chuyển hướng 80 → 443):
[deploy/nginx/qlbs.conf.example](../deploy/nginx/qlbs.conf.example)

```nginx
server {
  listen 443 ssl http2;
  server_name qlbs.benhvien.vn;

  ssl_certificate     /etc/letsencrypt/live/qlbs.benhvien.vn/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/qlbs.benhvien.vn/privkey.pem;

  client_max_body_size 50m;          # cho phép tải tệp đính kèm

  location / {
    proxy_pass http://127.0.0.1:3000;      # web (Next.js tự chuyển tiếp /api sang api)
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Sau khi có tên miền, cập nhật `CORS_ORIGINS` trong `.env` (ví dụ
`CORS_ORIGINS=https://qlbs.benhvien.vn`) rồi `docker compose up -d`.

> Giao diện gọi API qua đường dẫn tương đối `/api/...` nên **không cần** cấu hình
> địa chỉ API trong mã nguồn frontend; Next.js chuyển tiếp sang container `api`.

## 4. Sao lưu & phục hồi

**Sao lưu CSDL**

```bash
docker compose exec -T postgres pg_dump -U qlbs -d qlbs -Fc > backup-$(date +%F).dump
```

**Phục hồi**

```bash
docker compose exec -T postgres pg_restore -U qlbs -d qlbs --clean --if-exists < backup-2026-09-25.dump
```

**Sao lưu tệp tải lên** — thư mục `UPLOAD_HOST_DIR` (mặc định `./data/uploads`).

**Sao lưu tự động trong ứng dụng** — tác vụ `BACKUP_HANG_NGAY` (*Quản trị → Tác vụ định kỳ*,
mặc định 23:30 hằng ngày, bấm ▶ để chạy ngay, xem kết quả ở *Lịch sử chạy*):

* Sao **toàn bộ** các bảng trong schema `public` (phiếu HSBA, chữ ký, nhật ký, số liệu,
  bản chốt, người dùng, cấu hình…) trong một giao dịch nhất quán, ra tệp JSON nén
  `qlbs-<thời-gian>.json.gz`.
* Tệp nằm trong `BACKUP_HOST_DIR` trên máy chủ (mặc định `./data/backups`).
* Tự giữ lại `keep` bản mới nhất — sửa trong tham số tác vụ, ví dụ `{"keep": 30}` (mặc định 14).
* Xem nhanh nội dung: `zcat data/backups/qlbs-*.json.gz | head -c 600`.

**Phục hồi trên giao diện** — *Quản trị → Sao lưu & phục hồi* (quyền `backup.view`,
`backup.create`, `backup.restore`):

* **Sao lưu ngay**, **Tải về** máy (nên tải về định kỳ, cất ngoài máy chủ), **Tải lên** một
  tệp `.json.gz` đã tải về trước đó, xem **chi tiết** số dòng từng bảng, **xoá** tệp.
* **Phục hồi**: gõ `PHUC HOI` để xác nhận. Hệ thống tự tạo bản an toàn
  `qlbs-…-truoc-phuc-hoi.json.gz` rồi thay toàn bộ dữ liệu trong **một giao dịch** —
  lỗi bất kỳ (kể cả dữ liệu vi phạm khoá ngoại) thì huỷ hết, dữ liệu hiện tại giữ nguyên.
  Phiên đăng nhập được giữ; bảng `_qlbs_migrations` không bị ghi đè.
* Bản định dạng cũ (JSON không nén, chỉ 17 bảng danh mục) bị chặn phục hồi vì sẽ làm mất dữ liệu.
* **Khi nhiều người đang dùng**: trong lúc phục hồi hệ thống vào *chế độ bảo trì* — mọi người dùng
  khác thấy thông báo "Hệ thống đang phục hồi dữ liệu" (API trả 503 `MAINTENANCE`), không bị đăng
  xuất, trang tự tải lại khi xong. Trình tự: bật bảo trì → chờ thao tác ghi dở xong (≤10 s) →
  khoá toàn bộ bảng → ghi bản an toàn **trong cùng giao dịch** (không lọt thay đổi nào) → thay dữ liệu.
* Nếu có truy vấn chạy lâu (báo cáo lớn) giữ bảng quá 10 s, phục hồi thử lại 1 lần rồi báo
  "Hệ thống đang bận — dữ liệu chưa thay đổi"; gặp deadlock thì tự thử lại tối đa 3 lần.
* Đã thử tải: 20 người dùng ảo liên tục ghi/đọc trong lúc phục hồi ~150.000 dòng (≈17 s) —
  0 thao tác đã báo thành công bị mất, 0 lỗi ngoài 503 bảo trì.
* Nên phục hồi vào lúc ít người dùng; thời gian tăng theo dung lượng dữ liệu.

> Với CSDL rất lớn (hàng GB), `pg_dump`/`pg_restore` ở trên vẫn nhanh và chắc hơn — nên đặt cả hai.

Nên đặt lịch sao lưu tự động (ví dụ cron hằng ngày 0h) và giữ tối thiểu 7 bản gần nhất.

## 5. Nâng cấp phiên bản

**Cách nhanh (khuyến nghị)** — script tự `git pull`, chỉ dựng lại phần có thay đổi
(`backend/` → api, `frontend/` → web, chỉ đổi tài liệu → không dựng gì), dùng cache
npm + cache Next.js, rồi tự kiểm tra `/health`, trang đăng nhập và proxy:

```bash
cd /opt/qlbs
sudo bash deploy/update.sh              # thêm --backup để sao lưu CSDL trước
sudo bash deploy/update.sh --web        # ép dựng lại riêng giao diện (--api, --all)
```

**Cách thủ công:**

```bash
cd /opt/qlbs
git pull
docker compose build
docker compose up -d          # api tự chạy migration khi khởi động
docker compose logs -f api    # theo dõi tới khi thấy "Nest application successfully started"
```

Trước khi nâng cấp nên sao lưu CSDL. Nếu bản mới có thay đổi cấu trúc, migration sẽ tự
áp dụng; trường hợp cần quay lại phiên bản cũ: `git checkout <tag>` rồi
`docker compose up -d --build` và phục hồi bản sao lưu tương ứng.

### Font Times New Roman cho bản in

Mọi bản in PDF mặc định dùng **Times New Roman**. Mã nguồn chỉ kèm font tương thích mã nguồn
mở (Tinos/Arimo/Cousine — giấy phép SIL OFL, cùng kích thước ký tự với Times New Roman/Arial/
Courier New). `deploy/install.sh` và `deploy/update.sh` tự chạy `deploy/install-times-font.sh`
để tải bộ *Core fonts for the Web* của Microsoft và cài **Times New Roman gốc** vào thư mục
font của bản in (`${UPLOAD_HOST_DIR:-./data/uploads}/fonts`). Máy chủ tự nhận font mới trong
vài giây, không cần khởi động lại. Nếu máy chủ không ra được Internet, quản trị có thể tải 4
tệp `times.ttf`, `timesbd.ttf`, `timesi.ttf`, `timesbi.ttf` lên tại *Quản trị → Mẫu in →
Thiết kế → Font chữ*.

## 6. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| `failed to bind host port ... address already in use` | Cổng đã bị dịch vụ/container khác giữ (thường gặp khi cài chung máy với ERPNext/Grafana…). Xem ai giữ: `sudo ss -ltnp \| grep ':<cổng> '`. Chạy lại với cổng trống: `sudo bash deploy/install.sh --web-port 3300 --api-port 4400` (script tự kiểm tra cổng trước khi build và gợi ý cổng trống) |
| `api` khởi động rồi thoát, log báo lỗi CSDL | kiểm tra `POSTGRES_PASSWORD` trong `.env` khớp với dịch vụ `postgres`; `docker compose logs postgres` |
| Giao diện báo "Không kết nối được máy chủ" | `docker compose ps` xem `api` còn chạy không; kiểm tra `API_PROXY_TARGET` của dịch vụ `web` |
| Đăng nhập báo sai tài khoản | tài khoản quản trị chỉ được tạo ở lần chạy `db:seed` đầu tiên; tạo lại bằng `docker compose exec api npx tsx scripts/create-admin.ts` |
| Bản in PDF thiếu dấu tiếng Việt | ảnh `api` đã cài `ttf-dejavu`; nếu thay font riêng, thêm tệp font vào `backend/assets/fonts` rồi dựng lại ảnh |
| Hết dung lượng đĩa | dọn `data/backups`, giảm `STORAGE_RETENTION_DAYS` (mặc định 30 ngày) |
| Tác vụ định kỳ không chạy | kiểm tra `QUEUE_DRIVER`/`QUEUE_AUTO_SCHEDULE`, xem *Quản trị → Tác vụ* và log `job_runs` |

## 7. Chạy thử nhanh khi chưa có Docker (môi trường phát triển)

```bash
cd backend
npm install
npm run dev:postgres     # PostgreSQL nhúng (PGlite) ở cổng 55432, dữ liệu trong .data/pgdata
# .env: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres
#       CACHE_DRIVER=memory  QUEUE_DRIVER=inline  QUEUE_AUTO_SCHEDULE=false
npm run db:migrate && npm run db:seed
npm run dev              # API ở cổng 4000
```

Cửa sổ khác:

```bash
cd frontend && npm install && npm run dev    # giao diện ở cổng 3000
```

Bộ dữ liệu mẫu để xem giao diện (chỉ dùng cho môi trường thử):

```bash
cd backend && npm run db:demo      # tạo người dùng theo vai trò + phiếu ở mọi trạng thái + số liệu báo cáo
```
