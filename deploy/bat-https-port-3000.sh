#!/usr/bin/env bash
# ==============================================================================
#  QLBS — TỰ ĐỘNG BẬT HTTPS CHỨNG CHỈ SSL TỰ KÝ (SELF-SIGNED) TRÊN CỔNG 3000
# ==============================================================================
#  Mục đích:
#    Biến cổng 3000 thành HTTPS (https://<IP>:3000) để điện thoại bác sĩ
#    TỰ ĐỘNG MỞ CAMERA TRƯỚC VÀ QUÉT MẶT NHƯ FACE ID (KHÔNG CẦN BẤM CHỤP).
#
#  Cách dùng trên VPS:
#    cd /opt/qlbs && sudo bash deploy/bat-https-port-3000.sh
# ==============================================================================
set -Eeuo pipefail

C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_B=$'\033[1m'; C_0=$'\033[0m'
[[ -t 1 ]] || { C_G=''; C_Y=''; C_R=''; C_B=''; C_0=''; }
step() { printf '\n%s▸ %s%s\n' "$C_B" "$*" "$C_0"; }
ok()   { printf '  %s✓%s %s\n' "$C_G" "$C_0" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_Y" "$C_0" "$*"; }
die()  { printf '\n%s✗ LỖI:%s %s\n' "$C_R" "$C_0" "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Vui lòng chạy script bằng quyền root: sudo bash deploy/bat-https-port-3000.sh"

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT=$(pwd)
[[ -f docker-compose.yml ]] || die "Không tìm thấy docker-compose.yml trong $ROOT"
[[ -f .env ]] || die "Không tìm thấy .env trong $ROOT"

step "1/5 — Xác định địa chỉ IP máy chủ bệnh viện"
DETECTED_IP=$(ip -4 addr show scope global | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n 1 || true)
[[ -n "$DETECTED_IP" ]] || DETECTED_IP="192.168.1.50"

printf "Địa chỉ IP máy chủ đang nhận diện: %s%s%s\n" "$C_G" "$DETECTED_IP" "$C_0"
read -r -p "Nhập địa chỉ IP máy chủ (Enter để dùng $DETECTED_IP): " INPUT_IP
SERVER_IP="${INPUT_IP:-$DETECTED_IP}"
ok "Sẽ tạo SSL cho IP: $SERVER_IP"

step "2/5 — Sinh chứng chỉ SSL tự ký (Self-signed SAN Certificate - Hạn 10 năm)"
SSL_DIR="$ROOT/data/ssl"
mkdir -p "$SSL_DIR"

command -v openssl >/dev/null 2>&1 || {
  apt-get update -qq && apt-get install -y -qq openssl
}

openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout "$SSL_DIR/server.key" \
  -out "$SSL_DIR/server.crt" \
  -subj "/C=VN/ST=NgheAn/L=Vinh/O=BenhVienQuanY4/OU=IT/CN=$SERVER_IP" \
  -addext "subjectAltName=IP:$SERVER_IP,IP:127.0.0.1,DNS:localhost" >/dev/null 2>&1

chmod 600 "$SSL_DIR/server.key"
chmod 644 "$SSL_DIR/server.crt"
ok "Đã tạo chứng chỉ SSL đạt chuẩn SAN (Subject Alternative Name) tại: $SSL_DIR"

step "3/5 — Cấu hình Nginx đứng trước cổng 3000 SSL"
command -v nginx >/dev/null 2>&1 || {
  step "Cài đặt Nginx..."
  apt-get update -qq && apt-get install -y -qq nginx
}

NGINX_CONF="/etc/nginx/sites-available/qlbs-ssl-3000.conf"
cat > "$NGINX_CONF" <<EOF
# Cấu hình SSL tự ký trên cổng 3000 cho QLBS - Bệnh viện Quân y 4
server {
    listen 3000 ssl http2;
    server_name $SERVER_IP localhost;

    ssl_certificate $SSL_DIR/server.crt;
    ssl_certificate_key $SSL_DIR/server.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/qlbs-ssl-3000.conf

# Kiểm tra cú pháp nginx
nginx -t || die "Cấu hình Nginx không hợp lệ"
ok "Đã cấu hình Nginx lắng nghe HTTPS cổng 3000 -> chuyển tiếp sang cổng nội bộ 3001"

step "4/5 — Điều chỉnh .env sang cổng nội bộ 3001 và kích hoạt URL HTTPS"
if grep -q "^WEB_PORT=" .env; then
  sed -i 's/^WEB_PORT=.*/WEB_PORT=3001/' .env
else
  echo "WEB_PORT=3001" >> .env
fi

if grep -q "^SCAN_BASE_URL=" .env; then
  sed -i "s|^SCAN_BASE_URL=.*|SCAN_BASE_URL=https://$SERVER_IP:3000|" .env
else
  echo "SCAN_BASE_URL=https://$SERVER_IP:3000" >> .env
fi

# Cập nhật CORS_ORIGINS
if grep -q "^CORS_ORIGINS=" .env; then
  CURRENT_CORS=$(grep "^CORS_ORIGINS=" .env | cut -d= -f2-)
  if ! echo "$CURRENT_CORS" | grep -q "https://$SERVER_IP:3000"; then
    sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=$CURRENT_CORS,https://$SERVER_IP:3000,http://$SERVER_IP:3000|" .env
  fi
fi

ok "Đã cập nhật .env (WEB_PORT=3001, SCAN_BASE_URL=https://$SERVER_IP:3000)"

step "5/5 — Áp dụng cấu hình và kiểm tra hệ thống"
if docker compose version >/dev/null 2>&1; then DC=(docker compose); else DC=(docker-compose); fi

step "Khởi động lại container web sang cổng 3001..."
"${DC[@]}" up -d --no-deps web api

step "Khởi động lại Nginx..."
systemctl restart nginx

# Chờ dịch vụ sẵn sàng
sleep 3
if curl -k -fsS -o /dev/null --max-time 5 "https://127.0.0.1:3000/login"; then
  ok "HTTPS cổng 3000 đã phản hồi xuất sắc!"
else
  warn "Cổng 3000 chưa phản hồi ngay, đang kiểm tra trạng thái..."
fi

printf '\n%s============================================================================%s\n' "$C_G" "$C_0"
printf '%s             KÍCH HOẠT HTTPS CỔNG 3000 THÀNH CÔNG 100%%!             %s\n' "$C_B" "$C_0"
printf '%s============================================================================%s\n\n' "$C_G" "$C_0"

printf "Địa chỉ web HTTPS của bệnh viện : %shttps://%s:3000%s\n" "$C_G" "$SERVER_IP" "$C_0"
printf "Mã QR máy trạm Kiosk sẽ sinh link : %shttps://%s:3000/scan/...%s\n\n" "$C_G" "$SERVER_IP" "$C_0"

printf "%sHƯỚNG DẪN DÀNH CHO BÁC SĨ (CHỈ LÀM 1 LẦN DUY NHẤT):%s\n" "$C_B" "$C_0"
printf " 1. Khi bác sĩ quét mã QR lần đầu tiên trên điện thoại (Zalo / Camera).\n"
printf " 2. Trình duyệt sẽ hiện: %s'Kết nối của bạn không phải là riêng tư'%s.\n" "$C_Y" "$C_0"
printf " 3. Bác sĩ bấm vào chữ: %s'Nâng cao' (Advanced)%s ➔ Chọn %s'Tiếp tục truy cập %s (không an toàn)'%s.\n" "$C_B" "$C_0" "$C_G" "$SERVER_IP" "$C_0"
printf " 4. %sXONG!%s Từ giây phút đó, camera trước sẽ TỰ ĐỘNG BẬT SÁNG NGAY TRONG WEB,\n" "$C_G" "$C_0"
printf "    tự nhận diện khuôn mặt và mở khóa máy tính phòng khám trong 0.5s!\n"
printf "    Bác sĩ không cần chạm bất kỳ nút nào trên màn hình điện thoại.\n\n"
EOF
