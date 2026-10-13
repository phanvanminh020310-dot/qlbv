# Hướng Dẫn Cấu Hình HTTPS Với Chứng Chỉ Tự Ký (Self-Signed) Trên Cổng 3000 Cho QLBS

Tài liệu này hướng dẫn chi tiết cách kích hoạt **HTTPS trực tiếp trên cổng 3000** (`https://<IP_MÁY_CHỦ>:3000`) cho hệ thống QLBS Bệnh viện Quân y 4.

---

## 1. Tại Sao Bắt Buộc Cần HTTPS Để Quét Camera Tự Động?

- Theo tiêu chuẩn an ninh toàn cầu của **W3C, Google (Android Chrome) và Apple (iOS Safari)**:
  Tính năng phát trực tiếp camera trong trang web (**WebRTC Live Video Stream**) chỉ được kích hoạt trong **Ngữ cảnh an toàn (Secure Context - HTTPS)**.
- **Khi chạy qua HTTP (`http://...`)**:
  Trình duyệt di động khóa hoàn toàn camera web, buộc trang phải mở ứng dụng máy ảnh gốc của điện thoại. Nhiều hãng (Samsung, Xiaomi...) tự mở camera sau, bắt bác sĩ phải lật camera trước và bấm chụp thủ công.
- **Khi chạy qua HTTPS (`https://...`)**:
  Trình duyệt cho phép mở trực tiếp camera trước ngay trong trang web.
  Bác sĩ chỉ cần giơ điện thoại quét QR ➔ **Camera trước tự bật sáng ➔ Tự quét mặt và mở khóa máy tính trong 0.5 giây (Không cần chạm nút nào)**.

---

## 2. Cách Kích Hoạt Tự Động Bằng 1 Lệnh (Khuyến Nghị)

Trên terminal của máy chủ VPS (`/opt/qlbs`), bạn chỉ cần chạy đúng 1 lệnh:

```bash
cd /opt/qlbs && sudo bash deploy/bat-https-port-3000.sh
```

Script sẽ tự động:
1. Nhận diện địa chỉ IP nội bộ của máy chủ (ví dụ `192.168.1.50`).
2. Sinh chứng chỉ SSL tự ký có thời hạn 10 năm với phần mở rộng **SAN (Subject Alternative Name)** đạt chuẩn bảo mật của Chrome & iOS Safari.
3. Chuyển cổng nội bộ của container Next.js sang `3001` và đặt Nginx đứng trước tại cổng `3000 ssl`.
4. Cấu hình biến `SCAN_BASE_URL=https://<IP>:3000` để mã QR máy trạm Kiosk tự động sinh link HTTPS.
5. Khởi động lại dịch vụ và kiểm tra kết nối.

---

## 3. Cách Cấu Hình Thủ Công Từng Bước (Nếu Muốn Tự Làm)

Nếu bạn muốn tự tay cấu hình từng bước mà không chạy script tự động:

### Bước 1: Sinh chứng chỉ SSL tự ký đạt chuẩn SAN
Tạo thư mục lưu chứng chỉ:
```bash
sudo mkdir -p /opt/qlbs/data/ssl
```

Chạy lệnh OpenSSL tạo chứng chỉ hạn 10 năm (thay `192.168.1.50` bằng IP máy chủ của bạn):
```bash
sudo openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /opt/qlbs/data/ssl/server.key \
  -out /opt/qlbs/data/ssl/server.crt \
  -subj "/C=VN/ST=NgheAn/L=Vinh/O=BenhVienQuanY4/OU=IT/CN=192.168.1.50" \
  -addext "subjectAltName=IP:192.168.1.50,IP:127.0.0.1,DNS:localhost"
```

Phân quyền an toàn:
```bash
sudo chmod 600 /opt/qlbs/data/ssl/server.key
sudo chmod 644 /opt/qlbs/data/ssl/server.crt
```

### Bước 2: Đổi cổng nội bộ của Docker trong tệp `.env`
Mở file `.env`:
```bash
nano /opt/qlbs/.env
```
Sửa hoặc thêm 2 dòng:
```env
WEB_PORT=3001
SCAN_BASE_URL=https://192.168.1.50:3000
```
*(Thay `192.168.1.50` bằng IP máy chủ thật của bạn).*

Khởi động lại container web sang cổng 3001:
```bash
cd /opt/qlbs && docker compose up -d web api
```

### Bước 3: Cài đặt và cấu hình Nginx lắng nghe HTTPS trên cổng 3000
Cài Nginx nếu chưa có:
```bash
sudo apt-get update && sudo apt-get install -y nginx
```

Tạo tệp cấu hình `/etc/nginx/sites-available/qlbs-ssl-3000.conf`:
```bash
sudo nano /etc/nginx/sites-available/qlbs-ssl-3000.conf
```
Dán nội dung sau vào:
```nginx
server {
    listen 3000 ssl http2;
    server_name 192.168.1.50 localhost;

    ssl_certificate /opt/qlbs/data/ssl/server.crt;
    ssl_certificate_key /opt/qlbs/data/ssl/server.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Kích hoạt và khởi động lại Nginx:
```bash
sudo ln -sf /etc/nginx/sites-available/qlbs-ssl-3000.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 4. Hướng Dẫn Thao Tác Cho Bác Sĩ (Chỉ Cần Làm 1 Lần Duy Nhất)

Do đây là chứng chỉ SSL nội bộ của bệnh viện (không qua nhà cấp phát thương mại công cộng):

1. Bác sĩ dùng điện thoại quét mã QR Kiosk lần đầu tiên.
2. Trình duyệt di động (Chrome / Safari) sẽ hiển thị bảng cảnh báo:
   - **Google Chrome**: Bấm vào chữ **"Nâng cao" (Advanced)** ở góc dưới ➔ Bấm vào liên kết **"Tiếp tục truy cập 192.168.1.50 (không an toàn)"**.
   - **Apple Safari (iPhone)**: Bấm vào **"Hiển thị chi tiết"** ➔ Bấm **"Truy cập trang web này"** ➔ Xác nhận bằng Face ID/Mật khẩu máy.
3. **Kể từ lần thứ 2 trở đi**:
   Trình duyệt đã lưu xác nhận tin cậy. Bác sĩ quét QR là **camera trước tự động bật sáng ngay trong trang web**, nhận diện khuôn mặt và mở khóa máy tính trong 0.5s mà **bác sĩ không cần chạm bất kỳ nút nào**!

---

## 5. Cách Quay Về HTTP Thuần (Nếu Cần)

Nếu bạn muốn tắt HTTPS và quay về chế độ HTTP cổng 3000 như cũ:
```bash
cd /opt/qlbs && sudo bash deploy/tat-https-port-3000.sh
```
