#!/usr/bin/env bash
# ==============================================================================
#  QLBS — Cập nhật nhanh sau khi có code mới (chỉ dựng lại phần thay đổi)
# ==============================================================================
#
#      cd /opt/qlbs && sudo bash deploy/update.sh      (tự git pull — không cần pull trước)
#
#  Cách hoạt động:
#    1. git pull nhánh hiện tại.
#    2. So sánh commit cũ ↔ mới để biết thư mục nào đổi:
#         backend/  → dựng lại api        frontend/ → dựng lại web
#         chỉ docs/, *.md                 → không cần dựng lại gì
#         docker-compose.yml, .env        → khởi động lại theo cấu hình mới
#    3. Chỉ build service cần thiết (có cache npm + cache Next.js), rồi up -d.
#    4. Chờ /health và trang đăng nhập phản hồi, dọn ảnh dangling/cache build không dùng và snapshot nâng cấp quá mức giữ.
#    5. Nếu lần đầu cấu hình HTTPS hostname, hỏi tương tác hostname/email/token
#       Cloudflare (ẩn), cấp Let's Encrypt DNS-01 và giữ song song HTTPS IP cũ.
#
#  HTTPS hostname (lần đầu, vẫn chỉ chạy một lệnh update):
#    • Khi chưa có HTTPS_DOMAIN trong .env, script hỏi hostname (Enter để bỏ qua).
#    • Token Cloudflare chỉ được nhập ẩn; lưu /etc/qlbs/secrets quyền 600,
#      không ghi Git/.env/backup. Chỉ cần Zone.DNS Edit + Zone.Zone Read cho 1 zone.
#    • Không đụng /etc/nginx/sites-available/qlbs-ssl-3000.conf hoặc data/ssl cũ.
#
#  Tùy chọn:
#    --all        Dựng lại cả api và web dù không đổi
#    --api        Chỉ dựng lại api        --web   Chỉ dựng lại web
#    --no-pull    Bỏ qua git pull (dùng khi đã sửa code trực tiếp trên máy chủ)
#    --backup     Sao lưu .env, compose, SSL và CSDL trước pull/build (data/upgrade-backups/)
# ==============================================================================
set -Eeuo pipefail

C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_B=$'\033[1m'; C_0=$'\033[0m'
[[ -t 1 ]] || { C_G=''; C_Y=''; C_R=''; C_B=''; C_0=''; }
step() { printf '\n%s▸ %s%s\n' "$C_B" "$*" "$C_0"; }
ok()   { printf '  %s✓%s %s\n' "$C_G" "$C_0" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_Y" "$C_0" "$*"; }
die()  { printf '\n%s✗ LỖI:%s %s\n' "$C_R" "$C_0" "$*" >&2; exit 1; }

ORIG_ARGS=("$@")
FORCE_API=0; FORCE_WEB=0; DO_PULL=1; DO_BACKUP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) FORCE_API=1; FORCE_WEB=1 ;;
    --api) FORCE_API=1 ;;
    --web) FORCE_WEB=1 ;;
    --no-pull) DO_PULL=0 ;;
    --backup) DO_BACKUP=1 ;;
    -h|--help) awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "Tùy chọn không hợp lệ: $1 (xem --help)" ;;
  esac
  shift
done

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT=$(pwd)
[[ -f docker-compose.yml ]] || die "Không thấy docker-compose.yml trong $ROOT"
[[ -f .env ]] || die "Chưa có .env — hãy chạy deploy/install.sh lần đầu"

if docker compose version >/dev/null 2>&1; then DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then DC=(docker-compose)
else die "Không tìm thấy docker compose"; fi
export DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1

# Đọc/ghi .env mà không `source` tệp chứa các bí mật có thể có ký tự shell.
env_get() { sed -n "s/^$1=//p" .env | tail -1 | tr -d '\r"'; }
env_set() { # env_set KEY VALUE — chỉ dùng giá trị hệ thống đã kiểm tra, không echo bí mật
  local key=$1 value=$2
  if grep -qE "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}
csv_add_once() { # csv_add_once csv value
  local csv=${1:-} value=$2 item
  IFS=',' read -r -a items <<< "$csv"
  for item in "${items[@]}"; do [[ "$item" == "$value" ]] && { printf '%s' "$csv"; return; }; done
  [[ -n "$csv" ]] && printf '%s,%s' "$csv" "$value" || printf '%s' "$value"
}
is_hostname() {
  [[ "$1" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]]
}

# git có thể từ chối thư mục do root sở hữu khi chạy bằng sudo
git config --global --add safe.directory "$ROOT" >/dev/null 2>&1 || true

# Snapshot BEFORE git pull, builds and migrations. Never use an API-visible backup
# directory for .env/private keys; keep the whole upgrade snapshot owner-only.
# A failed or empty dump MUST stop the upgrade, not merely skip an && log line.
if [[ $DO_BACKUP -eq 1 && -z "${QLBS_UPDATE_BACKUP_DIR:-}" ]]; then
  step "Sao lưu cấu hình, chứng thư và CSDL trước khi cập nhật"
  umask 077
  mkdir -p data/upgrade-backups
  chmod 700 data/upgrade-backups
  SNAPSHOT=$(mktemp -d "$ROOT/data/upgrade-backups/pre-update-$(date +%F_%H%M%S)-XXXXXX")
  chmod 700 "$SNAPSHOT"
  cp -pL .env "$SNAPSHOT/.env"
  chmod 600 "$SNAPSHOT/.env"
  for config in docker-compose.yml docker-compose.yaml docker-compose.override.yml docker-compose.override.yaml compose.yml compose.yaml compose.override.yml compose.override.yaml; do
    [[ ! -f "$config" ]] || cp -pL "$config" "$SNAPSHOT/"
  done
  if [[ -d data/ssl ]]; then cp -aL data/ssl "$SNAPSHOT/ssl"; chmod -R go-rwx "$SNAPSHOT/ssl"; fi
  printf '%s\n' "${QLBS_OLD_COMMIT:-$(git rev-parse HEAD)}" > "$SNAPSHOT/source-commit.txt"
  F="$SNAPSHOT/database.dump"
  if ! "${DC[@]}" exec -T postgres sh -c 'exec pg_dump -U "${POSTGRES_USER:-qlbs}" -d "${POSTGRES_DB:-qlbs}" -Fc' > "$F.partial"; then
    rm -f "$F.partial"
    die "pg_dump thất bại. Chưa pull/build/khởi động lại. Cấu hình gốc giữ trong $SNAPSHOT"
  fi
  if [[ ! -s "$F.partial" ]] || ! "${DC[@]}" exec -T postgres pg_restore --list < "$F.partial" > /dev/null; then
    rm -f "$F.partial"
    die "Bản sao CSDL rỗng/không đọc được. Dừng cập nhật; xem $SNAPSHOT"
  fi
  mv "$F.partial" "$F"
  chmod 600 "$F"
  export QLBS_UPDATE_BACKUP_DIR="$SNAPSHOT"
  ok "Đã lưu cấu hình/SSL/CSDL trong $SNAPSHOT ($(du -h "$F" | cut -f1)); không thay đổi .env hay chứng thư"
fi
ENV_BEFORE=$(sha256sum .env | cut -d' ' -f1)
OLD="${QLBS_OLD_COMMIT:-$(git rev-parse HEAD)}"
if [[ $DO_PULL -eq 1 ]]; then
  step "Lấy code mới (git pull)"
  if ! git diff --quiet || ! git diff --cached --quiet; then
    warn "Có thay đổi cục bộ chưa commit — tạm cất (git stash) để pull"
    git stash push -m "update.sh $(date +%F_%T)" >/dev/null
    STASHED=1
  fi
  git pull --ff-only || die "git pull thất bại (nhánh bị lệch?). Kiểm tra bằng: git status"
  if [[ ${STASHED:-0} -eq 1 ]]; then
    if ! git stash pop >/dev/null 2>&1; then
      die "Xung đột khi áp lại thay đổi cục bộ. DỪNG trước build/migrate; giữ nguyên git stash, không git reset/clean. Xem git status và git stash list."
    fi
    ok "Đã áp lại thay đổi cục bộ"
  fi
fi
NEW=$(git rev-parse HEAD)
[[ "$ENV_BEFORE" == "$(sha256sum .env | cut -d' ' -f1)" ]] || die ".env đã thay đổi trong lúc pull. Dừng trước build; đối chiếu bản sao nâng cấp, không tự ghi đè cấu hình máy chủ."

# Bản thân update.sh vừa được cập nhật → chạy lại bằng bản mới (bash đang đọc bản cũ)
if [[ "$OLD" != "$NEW" && -z "${QLBS_UPDATE_REEXEC:-}" ]] && ! git diff --quiet "$OLD" "$NEW" -- deploy/update.sh; then
  ok "update.sh có phiên bản mới — chạy lại bằng bản mới"
  export QLBS_UPDATE_REEXEC=1
  export QLBS_OLD_COMMIT="$OLD"
  exec bash "$ROOT/deploy/update.sh" "${ORIG_ARGS[@]}" --no-pull
fi

if [[ "$OLD" == "$NEW" ]]; then
  ok "Không có commit mới từ git pull ($(git log -1 --format='%h %s'))"
  CHANGED=""
else
  ok "$(git rev-list --count "$OLD..$NEW") commit mới: ${OLD:0:7} → ${NEW:0:7}"
  git --no-pager log --max-count=20 --format='    %h %s' "$OLD..$NEW"
  CHANGED=$(git diff --name-only "$OLD" "$NEW")
fi

# ---------------------------------------------------------------- HTTPS hostname có certificate CA tin cậy
# Không proxy Cloudflare: DNS-01 chỉ tạo TXT public; body QR/liveness đi trực tiếp LAN.
# Cấu hình cũ https://IP:3000 và data/ssl luôn được giữ nguyên.
TLS_CHANGED=0
TLS_DOMAIN=$(env_get HTTPS_DOMAIN)
TLS_EMAIL=$(env_get LETSENCRYPT_EMAIL)
TLS_SECRET_ROOT=${QLBS_SYSTEM_ROOT:-/etc/qlbs}
TLS_SECRET_DIR="$TLS_SECRET_ROOT/secrets"
TLS_CREDENTIALS="$TLS_SECRET_DIR/cloudflare-dns.ini"
TLS_LE_ROOT=${QLBS_LE_ROOT:-/etc/letsencrypt}
TLS_NGINX_ROOT=${QLBS_NGINX_ROOT:-/etc/nginx}
TLS_NGINX_AVAILABLE="$TLS_NGINX_ROOT/sites-available/qlbs-domain-https.conf"
TLS_NGINX_ENABLED="$TLS_NGINX_ROOT/sites-enabled/qlbs-domain-https.conf"
TLS_RENEW_BIN=${QLBS_RENEW_BIN:-/usr/local/sbin/qlbs-certbot-renew}
TLS_CRON_FILE=${QLBS_CRON_FILE:-/etc/cron.d/qlbs-letsencrypt-renew}
LEGACY_SCAN_BASE=$(env_get SCAN_BASE_URL)
# Legacy self-signed deployments commonly bind Nginx only to the LAN interface.
# Probe the known LAN address rather than assuming 127.0.0.1 also has a 443 listener.
TLS_PROBE_IP=127.0.0.1
if [[ "$LEGACY_SCAN_BASE" =~ ^https://([0-9.]+):3000$ ]]; then
  TLS_PROBE_IP=${BASH_REMATCH[1]}
elif [[ "$(env_get CORS_ORIGINS)" =~ https://([0-9.]+):3000 ]]; then
  # SCAN_BASE_URL becomes the hostname after first success; CORS retains legacy IP.
  TLS_PROBE_IP=${BASH_REMATCH[1]}
fi

rollback_domain_nginx() {
  local old_conf=$1 old_enabled=$2 nginx_bin=$3
  if [[ -n "$old_conf" && -f "$old_conf" ]]; then
    mv "$old_conf" "$TLS_NGINX_AVAILABLE"
  else
    rm -f "$TLS_NGINX_AVAILABLE"
  fi
  if [[ -n "$old_enabled" ]]; then
    ln -sfn "$old_enabled" "$TLS_NGINX_ENABLED"
  else
    rm -f "$TLS_NGINX_ENABLED"
  fi
  "$nginx_bin" -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true
}

configure_domain_https() {
  local token='' current_cors web_port certbot_bin nginx_bin old_conf='' old_enabled='' fullchain privkey needs_renewal_proof=0

  if [[ -z "$TLS_DOMAIN" && -t 0 ]]; then
    printf "\nThiết lập HTTPS hostname Let's Encrypt (Enter để bỏ qua lần này):\n"
    read -r -p 'Hostname (ví dụ qlbv.example.vn): ' TLS_DOMAIN
    TLS_DOMAIN=${TLS_DOMAIN,,}
  fi
  TLS_DOMAIN=${TLS_DOMAIN,,}
  [[ -n "$TLS_DOMAIN" ]] || return 0
  [[ $EUID -eq 0 ]] || die "HTTPS hostname cần quyền root (dùng sudo bash deploy/update.sh ...)"
  is_hostname "$TLS_DOMAIN" || die "HTTPS_DOMAIN không hợp lệ: '$TLS_DOMAIN'"

  if [[ -z "$TLS_EMAIL" && -t 0 ]]; then
    read -r -p "Email nhận cảnh báo gia hạn Let's Encrypt: " TLS_EMAIL
  fi
  [[ "$TLS_EMAIL" == *'@'* && "$TLS_EMAIL" != *$'\n'* ]] || die "Cần LETSENCRYPT_EMAIL hợp lệ để cấp certificate."

  if [[ ! -f "$TLS_CREDENTIALS" ]]; then
    [[ -t 0 ]] || die "Chưa có token Cloudflare tại $TLS_CREDENTIALS; cần chạy tương tác một lần."
    printf 'Cloudflare API token (nhập ẩn, không dán vào chat): '
    read -r -s token
    printf '\n'
    [[ "$token" =~ ^[A-Za-z0-9_-]{20,}$ ]] || die "Token Cloudflare trống/không hợp lệ."
    install -d -m 700 "$TLS_SECRET_DIR"
    umask 077
    printf 'dns_cloudflare_api_token = %s\n' "$token" > "$TLS_CREDENTIALS.tmp"
    install -o root -g root -m 600 "$TLS_CREDENTIALS.tmp" "$TLS_CREDENTIALS"
    rm -f "$TLS_CREDENTIALS.tmp"
    unset token
    ok "Đã lưu Cloudflare token ngoài Git trong $TLS_CREDENTIALS (600)"
  fi
  chown root:root "$TLS_CREDENTIALS" 2>/dev/null || true
  chmod 600 "$TLS_CREDENTIALS"

  if ! command -v certbot >/dev/null 2>&1 || ! certbot plugins 2>/dev/null | grep -Eq 'dns[-_]cloudflare'; then
    step 'Cài Certbot + Cloudflare DNS plugin'
    if command -v apt-get >/dev/null 2>&1; then
      DEBIAN_FRONTEND=noninteractive apt-get update -qq
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx certbot python3-certbot-dns-cloudflare
    elif command -v dnf >/dev/null 2>&1; then
      dnf install -y nginx certbot python3-certbot-dns-cloudflare
    elif command -v yum >/dev/null 2>&1; then
      yum install -y nginx certbot python3-certbot-dns-cloudflare
    else
      die 'Thiếu certbot/cloudflare plugin và không hỗ trợ trình quản lý gói tự động.'
    fi
  fi
  command -v nginx >/dev/null 2>&1 || die 'Không có nginx sau khi cài package.'
  certbot_bin=$(command -v certbot)
  "$certbot_bin" plugins 2>/dev/null | grep -Eq 'dns[-_]cloudflare' \
    || die 'Certbot chưa có Cloudflare DNS plugin; dừng trước khi cấp certificate.'
  nginx_bin=$(command -v nginx)

  fullchain="$TLS_LE_ROOT/live/$TLS_DOMAIN/fullchain.pem"
  privkey="$TLS_LE_ROOT/live/$TLS_DOMAIN/privkey.pem"
  [[ -s "$fullchain" && -s "$privkey" && -f "$TLS_RENEW_BIN" ]] || needs_renewal_proof=1
  step "Cấp/kiểm tra Let's Encrypt cho $TLS_DOMAIN qua DNS-01"
  "$certbot_bin" certonly --non-interactive --agree-tos --keep-until-expiring \
    --email "$TLS_EMAIL" --dns-cloudflare \
    --dns-cloudflare-credentials "$TLS_CREDENTIALS" \
    --dns-cloudflare-propagation-seconds 60 -d "$TLS_DOMAIN"
  [[ -s "$fullchain" && -s "$privkey" ]] || die "Certbot không tạo đủ certificate/key cho $TLS_DOMAIN. Legacy HTTPS giữ nguyên."
  command -v openssl >/dev/null 2>&1 || die 'Không có openssl để kiểm tra certificate.'
  openssl x509 -in "$fullchain" -noout -ext subjectAltName | grep -Fq "DNS:$TLS_DOMAIN" \
    || die "Certificate không có SAN DNS:$TLS_DOMAIN. Legacy HTTPS giữ nguyên."
  openssl x509 -in "$fullchain" -checkend 0 -noout \
    || die "Certificate cho $TLS_DOMAIN đã hết hạn; legacy HTTPS giữ nguyên."
  ok "Certificate hợp lệ, còn hạn và có SAN DNS:$TLS_DOMAIN"

  web_port=$(env_get WEB_PORT); web_port=${web_port:-3000}
  [[ "$web_port" =~ ^[0-9]+$ ]] || die "WEB_PORT không hợp lệ: $web_port"
  install -d "$TLS_NGINX_ROOT/sites-available" "$TLS_NGINX_ROOT/sites-enabled"
  if [[ -e "$TLS_NGINX_AVAILABLE" || -L "$TLS_NGINX_AVAILABLE" ]]; then
    old_conf=$(mktemp)
    cp -pL "$TLS_NGINX_AVAILABLE" "$old_conf"
  fi
  if [[ -e "$TLS_NGINX_ENABLED" || -L "$TLS_NGINX_ENABLED" ]]; then
    old_enabled=$(readlink "$TLS_NGINX_ENABLED" 2>/dev/null || printf '%s' "$TLS_NGINX_AVAILABLE")
  fi

  cat > "$TLS_NGINX_AVAILABLE.tmp" <<EOF
# QLBS hostname HTTPS — managed by deploy/update.sh; legacy IP:3000 config remains separate.
server {
  # Bind only hospital LAN IP: tailscaled already owns its own :443 address.
  listen $TLS_PROBE_IP:443 ssl http2;
  server_name $TLS_DOMAIN;

  ssl_certificate     $fullchain;
  ssl_certificate_key $privkey;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_session_timeout 1d;
  ssl_session_cache shared:QLBSTLS:10m;

  client_max_body_size 50m;
  location / {
    proxy_pass http://127.0.0.1:$web_port;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$http_connection;
    proxy_buffering off;
  }
}
EOF
  mv "$TLS_NGINX_AVAILABLE.tmp" "$TLS_NGINX_AVAILABLE"
  ln -sfn "$TLS_NGINX_AVAILABLE" "$TLS_NGINX_ENABLED"
  if ! "$nginx_bin" -t; then
    rollback_domain_nginx "$old_conf" "$old_enabled" "$nginx_bin"
    die 'Nginx config hostname không hợp lệ; chưa reload, legacy HTTPS không đổi.'
  fi
  if ! systemctl reload nginx; then
    rollback_domain_nginx "$old_conf" "$old_enabled" "$nginx_bin"
    die 'Nginx reload thất bại; legacy HTTPS giữ nguyên, kiểm tra systemctl status nginx.'
  fi
  ok "Nginx HTTPS $TLS_PROBE_IP:443 → 127.0.0.1:$web_port đã nạp song song legacy IP:3000"

  install -d -m 700 "$(dirname "$TLS_RENEW_BIN")"
  install -d -m 755 "$(dirname "$TLS_CRON_FILE")"
  cat > "$TLS_RENEW_BIN" <<EOF
#!/bin/sh
exec "$certbot_bin" renew --quiet --deploy-hook '/bin/systemctl reload nginx' "\$@"
EOF
  chmod 700 "$TLS_RENEW_BIN"
  cat > "$TLS_CRON_FILE" <<EOF
# QLBS: Let's Encrypt DNS-01 renewal; certificate/key remain root-only.
17 3 * * * root $TLS_RENEW_BIN
EOF
  chmod 600 "$TLS_CRON_FILE"
  if [[ $needs_renewal_proof -eq 1 ]]; then
    step 'Kiểm tra gia hạn certificate bằng Let’s Encrypt staging (DNS-01)'
    if ! "$TLS_RENEW_BIN" --dry-run; then
      # A real production certificate was just obtained/validated above. Some hospital
      # egress filters allow the production ACME endpoint but reset/blackhole staging.
      # Do not take down a valid, locally-probed hostname merely because the optional
      # staging simulation is unreachable; leave a loud warning and keep cron renewal.
      warn 'Không kết nối được Let’s Encrypt staging để mô phỏng renewal. Certificate production đã hợp lệ; giữ HTTPS hostname, cron renewal production vẫn được cài.'
      warn 'CNTT cần theo dõi /var/log/letsencrypt/letsencrypt.log và kiểm tra lại outbound staging trước khi certificate hết hạn.'
    else
      ok 'Gia hạn DNS-01 staging và reload Nginx đã được kiểm tra'
    fi
  else
    ok 'Lịch gia hạn DNS-01 đã tồn tại; không lặp lại staging renewal trong lần cập nhật code này'
  fi

  # Test through the known LAN interface with SNI/normal CA validation, without Internet payload.
  if ! curl -fsS --max-time 12 --resolve "$TLS_DOMAIN:443:$TLS_PROBE_IP" "https://$TLS_DOMAIN/health" >/dev/null; then
    rollback_domain_nginx '' "$old_enabled" "$nginx_bin"
    die "HTTPS hostname chưa phản hồi qua Nginx tại $TLS_PROBE_IP. Legacy HTTPS IP:3000 vẫn giữ; xem nginx/error.log."
  fi
  ok "HTTPS $TLS_DOMAIN/health xác thực CA và phản hồi qua Nginx LAN $TLS_PROBE_IP"
  rm -f "$old_conf"

  current_cors=$(env_get CORS_ORIGINS)
  # Preserve the old IP origin as an allowed browser origin while adding the new hostname.
  if [[ "$LEGACY_SCAN_BASE" =~ ^https://[0-9.]+:3000$ ]]; then
    current_cors=$(csv_add_once "$current_cors" "$LEGACY_SCAN_BASE")
  fi
  current_cors=$(csv_add_once "$current_cors" "https://$TLS_DOMAIN")
  env_set HTTPS_DOMAIN "$TLS_DOMAIN"
  env_set LETSENCRYPT_EMAIL "$TLS_EMAIL"
  env_set SCAN_BASE_URL "https://$TLS_DOMAIN"
  env_set PUBLIC_URL "https://$TLS_DOMAIN"
  env_set CORS_ORIGINS "$current_cors"
  TLS_CHANGED=1
}

configure_domain_https

# uploads/backups gắn bind-mount vào container api (user node = UID 1000) — phải đúng chủ
mkdir -p data/uploads data/backups
chown -R 1000:1000 data/uploads data/backups 2>/dev/null || true

# Font Times New Roman gốc cho bản in PDF (chỉ tải lần đầu; lỗi không làm dừng cập nhật)
if [[ -f deploy/install-times-font.sh ]]; then
  bash deploy/install-times-font.sh --quiet 2>/dev/null || true
fi

BUILD=()
RECREATE=()
if [[ $FORCE_API -eq 1 ]] || grep -q '^backend/' <<<"$CHANGED"; then BUILD+=(api); fi
if [[ $FORCE_WEB -eq 1 ]] || grep -q '^frontend/' <<<"$CHANGED"; then BUILD+=(web); fi
# SCAN_BASE_URL/CORS runtime config changed: recreate API, do not need to rebuild its image.
if [[ $TLS_CHANGED -eq 1 ]]; then RECREATE+=(api); fi
COMPOSE_CHANGED=0
grep -qE '^(docker-compose\.yml|\.env\.example)$' <<<"$CHANGED" && COMPOSE_CHANGED=1

# Chỉ dọn cache build Docker không còn dùng quá 7 ngày và snapshot upgrade cũ ngoài mức giữ.
# Không đụng volume PostgreSQL, uploads, data/backups hay image/container đang dùng.
cleanup_update_artifacts() {
  local keep=${QLBS_UPDATE_BACKUP_KEEP:-7} index=0 removed=0 line snapshot
  [[ "$keep" =~ ^[1-9][0-9]*$ ]] || keep=7
  # Docker daemon/buildkit đôi khi giữ lock rất lâu khi dọn cache. Đây chỉ là dọn rác sau
  # khi dịch vụ đã khỏe, tuyệt đối không được làm lệnh cập nhật treo vô hạn.
  if command -v timeout >/dev/null 2>&1; then
    step 'Dọn cache Docker không dùng (tối đa 15 giây, không ảnh hưởng dịch vụ)'
    timeout --kill-after=3s 8s docker image prune -f >/dev/null 2>&1 || warn 'Bỏ qua dọn image Docker do quá thời gian; dịch vụ đã cập nhật xong.'
    timeout --kill-after=3s 15s docker builder prune -f --filter 'until=168h' >/dev/null 2>&1 || warn 'Bỏ qua dọn build cache Docker do quá thời gian; không ảnh hưởng dịch vụ/dữ liệu.'
  else
    warn 'Không có lệnh timeout nên bỏ qua dọn Docker cache để update.sh không bị treo.'
  fi
  [[ -d data/upgrade-backups ]] || return 0
  while IFS= read -r line; do
    snapshot=${line#* }
    ((++index))
    if (( index > keep )); then rm -rf -- "$snapshot"; ((++removed)); fi
  done < <(find data/upgrade-backups -mindepth 1 -maxdepth 1 -type d -name 'pre-update-*' -printf '%T@ %p\n' 2>/dev/null | sort -nr)
  (( removed == 0 )) || ok "Đã xoá $removed snapshot nâng cấp cũ, giữ $keep snapshot mới nhất"
}

if [[ ${#BUILD[@]} -eq 0 && ${#RECREATE[@]} -eq 0 && $COMPOSE_CHANGED -eq 0 ]]; then
  step "Không có thay đổi cần dựng lại"
  ok "Chỉ đổi tài liệu hoặc không có gì mới — hệ thống giữ nguyên"
  cleanup_update_artifacts
  "${DC[@]}" ps
  exit 0
fi

START=$(date +%s)
if [[ ${#BUILD[@]} -gt 0 ]]; then
  step "Dựng lại: ${BUILD[*]} (có cache — tuần tự để tối ưu RAM VPS)"
  for svc in "${BUILD[@]}"; do
    printf '  → đang dựng %s ...\n' "$svc"
    "${DC[@]}" build "$svc"
  done
  step "Khởi động lại: ${BUILD[*]}"
  "${DC[@]}" up -d --no-deps "${BUILD[@]}"
fi
if [[ ${#RECREATE[@]} -gt 0 ]]; then
  for svc in "${RECREATE[@]}"; do
    if [[ " ${BUILD[*]} " != *" $svc "* ]]; then
      step "Áp dụng cấu hình runtime mới: $svc"
      "${DC[@]}" up -d --no-deps "$svc"
    fi
  done
fi
if [[ $COMPOSE_CHANGED -eq 1 ]]; then
  step "docker-compose.yml thay đổi — áp dụng cấu hình mới"
  "${DC[@]}" up -d
fi

# ---------------------------------------------------------------- kiểm tra
API_PORT=$(env_get API_PORT); API_PORT=${API_PORT:-4000}
WEB_PORT=$(env_get WEB_PORT); WEB_PORT=${WEB_PORT:-3000}

step "Kiểm tra sau cập nhật"
wait_url() { # wait_url URL tên số-giây
  local i
  for ((i = 0; i < $3; i += 3)); do
    if curl -fsS -o /dev/null --max-time 3 "$1"; then ok "$2 phản hồi ($1)"; return 0; fi
    sleep 3
  done
  warn "$2 chưa phản hồi sau $3 giây — xem: ${DC[*]} logs --tail=80 ${4:-}"
  return 1
}
FAIL=0
wait_url "http://127.0.0.1:${API_PORT}/health" "API" 180 api || FAIL=1
wait_url "http://127.0.0.1:${WEB_PORT}/login" "Giao diện" 120 web || FAIL=1
wait_url "http://127.0.0.1:${WEB_PORT}/health" "Proxy web → API" 30 web || FAIL=1
if [[ -n "$TLS_DOMAIN" ]]; then
  if curl -fsS --max-time 12 --resolve "$TLS_DOMAIN:443:$TLS_PROBE_IP" "https://$TLS_DOMAIN/login" >/dev/null; then
    ok "HTTPS hostname mới phản hồi qua LAN và certificate được CA tin cậy ($TLS_DOMAIN)"
  else
    warn "HTTPS hostname mới không phản hồi qua SNI LAN $TLS_PROBE_IP ($TLS_DOMAIN)"; FAIL=1
  fi
  if [[ "$LEGACY_SCAN_BASE" =~ ^https://[0-9.]+:3000$ ]]; then
    if curl -kfsS --max-time 12 "$LEGACY_SCAN_BASE/health" >/dev/null; then
      ok "HTTPS IP legacy vẫn phản hồi ($LEGACY_SCAN_BASE)"
    else
      warn "HTTPS IP legacy không phản hồi sau cập nhật ($LEGACY_SCAN_BASE)"; FAIL=1
    fi
  fi
fi

cleanup_update_artifacts
"${DC[@]}" ps

ELAPSED=$(( $(date +%s) - START ))
if [[ $FAIL -eq 0 ]]; then
  printf '\n%s✓ Cập nhật xong sau %ss.%s Nhớ bấm Ctrl+F5 trên trình duyệt.\n' "$C_G" "$ELAPSED" "$C_0"
else
  printf '\n%s! Cập nhật xong nhưng có dịch vụ chưa sẵn sàng — xem log ở trên.%s\n' "$C_Y" "$C_0"
  exit 1
fi
