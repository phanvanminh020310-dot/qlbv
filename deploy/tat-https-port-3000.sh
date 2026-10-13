#!/usr/bin/env bash
# ==============================================================================
#  QLBS — TẮT HTTPS VÀ QUAY VỀ HTTP TRUYỀN THỐNG CỔNG 3000
# ==============================================================================
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo "Vui lòng chạy bằng sudo: sudo bash deploy/tat-https-port-3000.sh"; exit 1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT=$(pwd)

echo "Đang khôi phục hệ thống về HTTP thuần trên cổng 3000..."

# Xóa cấu hình Nginx cổng 3000
rm -f /etc/nginx/sites-enabled/qlbs-ssl-3000.conf /etc/nginx/sites-available/qlbs-ssl-3000.conf
systemctl reload nginx 2>/dev/null || true

# Khôi phục .env
if grep -q "^WEB_PORT=" .env; then
  sed -i 's/^WEB_PORT=.*/WEB_PORT=3000/' .env
fi
sed -i '/^SCAN_BASE_URL=/d' .env

if docker compose version >/dev/null 2>&1; then DC=(docker compose); else DC=(docker-compose); fi
"${DC[@]}" up -d --no-deps web api

echo "[OK] Đã chuyển lại container Web về cổng 3000 HTTP thuần."
