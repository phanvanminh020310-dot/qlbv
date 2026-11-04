# HTTPS hostname tin cậy cho QR Kiosk trong LAN

Tài liệu này bổ sung hostname CA-trusted cho điện thoại nhưng **không thay thế** triển khai Kiosk IP cũ.

| Đường dẫn | Trạng thái sau cập nhật |
|---|---|
| `https://172.16.13.75:3000` | Giữ nguyên Nginx self-signed hiện có, `data/ssl/server.{crt,key}`, port 3000 và các Windows Kiosk cũ. Không redirect. |
| `https://qlbv.bvqy4.io.vn` | Nginx vhost mới trên port 443, Let’s Encrypt DNS-01, proxy nội bộ tới cùng `WEB_PORT` (thường là `3001` khi port 3000 self-signed đang hoạt động). QR mới dùng hostname này sau khi cập nhật thành công. |

Lưu lượng ứng dụng, ảnh liveness và face verification trong Wi-Fi bệnh viện vẫn đi thẳng từ điện thoại tới IP LAN `172.16.13.75`; Cloudflare chỉ quản lý DNS và TXT `_acme-challenge` phục vụ cấp/gia hạn certificate. Không bật Cloudflare Proxy, Tunnel, CDN hoặc WAF cho record này.

## Điều kiện trước khi chạy

1. Zone `bvqy4.io.vn` đã **Active** trên Cloudflare.
2. Record `A` `qlbv` là `172.16.13.75`, để **DNS only** (mây xám). Không đổi record đó sang proxied.
3. Có Cloudflare API Token giới hạn đúng zone `bvqy4.io.vn`, chỉ cần:
   - `Zone / DNS / Edit`
   - `Zone / Zone / Read`
4. Có email kỹ thuật nhận thông báo hết hạn certificate.
5. Máy chủ còn dùng Nginx/HTTPS IP cũ bình thường. Port 443 không được ứng dụng khác chiếm.

> Không dán token vào Git, `.env`, trình duyệt, ảnh chụp màn hình hoặc chat. Token được nhập ẩn trực tiếp ở terminal và sau đó nằm tại `/etc/qlbs/secrets/cloudflare-dns.ini` với quyền root-only `0600`.

## Lần chạy đầu: một lệnh duy nhất

Trên server production, chạy đúng một lệnh:

```bash
cd /opt/qlbs && sudo bash deploy/update.sh --backup
```

Script tự sao lưu `.env`, Compose, `data/ssl` cũ và PostgreSQL trước pull/build. Khi chưa có `HTTPS_DOMAIN` trong `.env`, script sẽ lần lượt hỏi:

1. hostname: `qlbv.bvqy4.io.vn`;
2. email Let’s Encrypt;
3. Cloudflare API token (nhập ẩn, không hiện lại trên terminal).

Không cần chạy lệnh Certbot, Nginx, Cloudflare hay cấu hình CORS riêng lẻ. Script sẽ:

- cấp hoặc giữ certificate Let’s Encrypt bằng DNS-01;
- xác minh SAN của certificate đúng hostname;
- tạo một Nginx vhost **riêng** trên `443`, proxy về `127.0.0.1:$WEB_PORT`;
- kiểm tra `nginx -t`, reload Nginx và xác minh HTTPS bằng SNI trên đúng IP LAN legacy với CA validation;
- tạo lịch gia hạn `/etc/cron.d/qlbs-letsencrypt-renew` lúc 03:17 hằng ngày, reload Nginx chỉ sau lần gia hạn thành công;
- ở lần thiết lập/gia hạn script đầu tiên, chạy thử gia hạn DNS-01 trên Let’s Encrypt staging; các lần cập nhật code sau dùng cron đã được kiểm tra, không lặp staging renewal không cần thiết;
- thêm hostname vào `CORS_ORIGINS`, đồng thời đặt `SCAN_BASE_URL` và `PUBLIC_URL` thành `https://qlbv.bvqy4.io.vn`, rồi recreate API để QR mới sử dụng hostname;
- kiểm tra lại API, Web, hostname `443`, và URL legacy `https://172.16.13.75:3000`.

Nếu certificate production, kiểm SAN/hạn certificate, Nginx validation/reload hoặc probe hostname thất bại trước bước áp dụng runtime, script dừng và trả Nginx hostname về cấu hình trước đó. Port 3000 và certificate cũ không bị ghi đè hay xóa. Nếu chỉ **Let’s Encrypt staging** không truy cập được nhưng certificate production vừa cấp đã hợp lệ và probe hostname đạt, script báo cảnh báo rõ ràng nhưng giữ hostname hoạt động; cron vẫn gia hạn với endpoint production. CNTT cần theo dõi `/var/log/letsencrypt/letsencrypt.log` và xử lý egress staging trước khi certificate hết hạn.

## Nghiệm thu bắt buộc sau khi script báo thành công

Trên **Wi-Fi bệnh viện** (không phải 4G/5G), kiểm tra thật với ít nhất một Android và một iPhone:

1. Mở `https://qlbv.bvqy4.io.vn` trên mỗi máy: không được có cảnh báo self-signed/certificate.
2. Để Kiosk tạo QR mới, quét bằng Camera iPhone và Android. Xác nhận URL bắt đầu bằng hostname, liveness + face scan hoạt động, và Kiosk đúng phòng được mở.
3. Kiểm tra một Windows Kiosk cũ/cấu hình cũ vẫn truy cập `https://172.16.13.75:3000` và hoạt động như trước.
4. Nếu điện thoại không mở hostname trong LAN dù DNS public trả IP đúng, kiểm tra DNS rebinding protection/DNS riêng trên Wi-Fi bệnh viện. Không bật Cloudflare Proxy để “sửa” việc này.

Chỉ sau khi bốn bước trên đạt mới coi việc chuyển QR mới sang hostname là hoàn tất. URL IP legacy phải tiếp tục được giữ cho đến khi bệnh viện chủ động có kế hoạch thay thế toàn bộ Kiosk cũ.
