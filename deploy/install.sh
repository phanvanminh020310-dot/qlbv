#!/usr/bin/env bash
# ==============================================================================
#  QLBS — Cài đặt MỘT LẦN lên VPS bằng Docker
# ==============================================================================
#
#  Chạy trong kho mã nguồn đã clone:
#
#      sudo bash deploy/install.sh
#
#  Hoặc dán nguyên câu lệnh này vào VPS (script tự tải mã nguồn về /opt/qlbs):
#
#      curl -fsSL https://raw.githubusercontent.com/pvminh94/qlbv/main/deploy/install.sh \
#        | sudo bash -s --
#
#  Đặc điểm:
#    • Idempotent — chạy lại bao nhiêu lần cũng an toàn (không đụng .env cũ,
#      không xóa dữ liệu đã có).
#    • Tự cài Docker Engine + Docker Compose nếu máy chưa có.
#    • Tự sinh .env với bí mật ngẫu nhiên nếu chưa có (mật khẩu chỉ dùng ký
#      tự [0-9a-f] để an toàn khi nhúng vào URL kết nối).
#    • Dựng và khởi động toàn bộ: PostgreSQL · Redis · API (NestJS) · Web (Next).
#    • Soi cổng TRƯỚC khi dựng ảnh: cổng bận sẽ báo ngay (kể cả ai đang giữ:
#      tiến trình lạ hay container khác) kèm gợi ý cổng trống + lệnh chạy lại.
#    • TỰ KIỂM TRA sau khi cài: /health (CSDL + cache), đăng nhập admin thật,
#      giao diện web, đường proxy web → API, trạng thái 4 container. Cuối script
#      có kết luận rõ ràng: OK hay chưa OK.
#
#  Tùy chọn:
#    --demo                Nạp thêm dữ liệu mẫu để xem giao diện đầy đủ
#    --web-port N          Cổng giao diện (mặc định: theo .env rồi đến 3000)
#    --api-port N          Cổng API (mặc định: theo .env rồi đến 4000)
#    --domain TÊN_MIỀN     Khai báo CORS cho https://TÊN_MIỀN (khi đã có HTTPS)
#    --admin-user TÊN      Tài khoản quản trị (mặc định: admin)
#    --admin-pass MẬT_KHẨU Mật khẩu quản trị (mặc định: sinh ngẫu nhiên)
#    --dir ĐƯỜNG_DẪN       Nơi cài khi chạy standalone (mặc định: /opt/qlbs)
#    --repo URL            Kho git cần clone (mặc định: kho chính qlbv)
#    --branch NHÁNH        Nhánh cần clone (mặc định: nhánh chủ của kho)
#    --skip-docker-install Không tự cài Docker
#    -h, --help            Hướng dẫn này
#
#  Đặt biến môi trường trước khi chạy để ghi đè giá trị sinh tự động:
#      POSTGRES_PASSWORD  REDIS_PASSWORD  JWT_SECRET  JWT_REFRESH_SECRET
#      ADMIN_USERNAME     ADMIN_PASSWORD  WEB_PORT    API_PORT
#
#  Sau khi cài xong, mọi bí mật nằm trong tệp .env (đọc kỹ .env.example).
# ==============================================================================
set -Eeuo pipefail

# ------------------------------------------------------------------ tiện ích
C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_B=$'\033[1m'; C_0=$'\033[0m'
[[ -t 1 ]] || { C_G=''; C_Y=''; C_R=''; C_B=''; C_0=''; }

log()  { printf '%s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "$C_B" "$*" "$C_0"; }
ok()   { printf '  %s✓%s %s\n' "$C_G" "$C_0" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_Y" "$C_0" "$*"; }
bad()  { printf '  %s✗%s %s\n' "$C_R" "$C_0" "$*"; }
die()  { printf '\n%s✗ LỖI:%s %s\n' "$C_R" "$C_0" "$*" >&2; exit 1; }

trap 'rc=$?; [[ $rc -ne 0 ]] && printf "\n%s✗ Cài đặt thất bại (mã %s)%s — xem lại thông báo phía trên.\n" "$C_R" "$rc" "$C_0" >&2; exit $rc' EXIT

usage() { awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}"; exit 0; }

gen_hex() { # gen_hex <số-byte>
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1";
  else head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

gen_pass() { # mật khẩu 16 ký tự chữ+số, an toàn cho JSON
  local p
  if command -v openssl >/dev/null 2>&1; then
    p=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-16)
  fi
  [[ ${#p} -ge 8 ]] || p=$(gen_hex 8)
  printf '%s' "$p"
}

json_esc() { local s=$1; s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; printf '%s' "$s"; }

set_env() { # set_env KEY VALUE — ghi vào .env (thay hoặc thêm), giữ nguyên chú thích
  local key=$1 value=$2
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

env_get() { sed -n "s/^${1}=//p" "$ENV_FILE" | tail -1 | tr -d '\r'; }

install_pkgs() { # cài gói bằng trình quản lý có sẵn
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
  elif command -v dnf >/dev/null 2>&1; then dnf install -y "$@"
  elif command -v yum >/dev/null 2>&1; then yum install -y "$@"
  elif command -v apk >/dev/null 2>&1; then apk add --no-cache "$@"
  else die "Không tìm thấy trình quản lý gói (apt/dnf/yum/apk). Hãy cài thủ công: $*"; fi
}

port_owner() { # tên container đang publish cổng (rỗng nếu không có)
  docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null \
    | awk -F'\t' -v p=":$1->" 'index($2, p) {print $1; exit}' || true
}

port_busy() { # có tiến trình nào đang nghe trên cổng localhost không
  local p=$1
  if command -v timeout >/dev/null 2>&1 \
     && timeout 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/${p}" 2>/dev/null; then
    return 0
  fi
  if command -v ss >/dev/null 2>&1 \
     && ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${p}$"; then
    return 0
  fi
  if command -v netstat >/dev/null 2>&1 \
     && netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${p}$"; then
    return 0
  fi
  return 1
}

port_free() { [[ -z "$(port_owner "$1")" ]] && ! port_busy "$1"; }

suggest_port() { # gợi ý cổng trống kế tiếp
  local p
  for ((p=$1+1; p<=$1+50 && p<=65535; p++)); do
    if port_free "$p"; then printf '%s' "$p"; return 0; fi
  done
  printf '%s' '?'
}

# ------------------------------------------------------------------- tùy chọn
REPO_URL='https://github.com/pvminh94/qlbv.git'
BRANCH=''
INSTALL_DIR='/opt/qlbs'
DOMAIN=''
WEB_PORT="${WEB_PORT:-}"
API_PORT="${API_PORT:-}"
ADMIN_USERNAME="${ADMIN_USERNAME:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
WANT_DEMO=0
SKIP_DOCKER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --demo)                WANT_DEMO=1 ;;
    --web-port)            WEB_PORT=$2; shift ;;
    --api-port)            API_PORT=$2; shift ;;
    --domain)              DOMAIN=$2; shift ;;
    --admin-user)          ADMIN_USERNAME=$2; shift ;;
    --admin-pass)          ADMIN_PASSWORD=$2; shift ;;
    --dir)                 INSTALL_DIR=$2; shift ;;
    --repo)                REPO_URL=$2; shift ;;
    --branch)              BRANCH=$2; shift ;;
    --skip-docker-install) SKIP_DOCKER=1 ;;
    -h|--help)             usage ;;
    *) die "Tùy chọn không hợp lệ: $1 (xem --help)" ;;
  esac
  shift
done

log "${C_B}════════════════════════════════════════════════════════════${C_0}"
log "${C_B}  QLBS — Cài đặt một lần lên VPS (Docker)${C_0}"
log "${C_B}════════════════════════════════════════════════════════════${C_0}"

# ------------------------------------------------- 1) Quyền root & Docker
docker_usable() {
  command -v docker >/dev/null 2>&1 \
    && docker info >/dev/null 2>&1 \
    && docker compose version >/dev/null 2>&1
}

if ! docker_usable; then
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    command -v sudo >/dev/null 2>&1 \
      || die "Docker chưa sẵn sàng và không có sudo. Hãy chạy bằng tài khoản root."
    log "→ Docker chưa dùng được với tài khoản này, chạy lại bằng sudo..."
    exec sudo -E bash "$0" "$@"
  fi
fi

step '1/6 — Docker Engine + Docker Compose'
if docker_usable; then
  ok "Đã có sẵn: $(docker --version | cut -d, -f1) · Compose $(docker compose version --short 2>/dev/null || echo v2)"
else
  [[ $SKIP_DOCKER -eq 1 ]] && die "Docker chưa dùng được mà bạn chọn --skip-docker-install."
  if ! command -v curl >/dev/null 2>&1; then install_pkgs curl ca-certificates; fi
  if ! command -v docker >/dev/null 2>&1; then
    log '  Đang cài Docker bằng tệp cài chính thức của Docker (get.docker.com)...'
    curl -fsSL https://get.docker.com | sh
  fi
  if ! docker compose version >/dev/null 2>&1; then
    log '  Đang cài thêm plugin Docker Compose v2...'
    if command -v apt-get >/dev/null 2>&1; then
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-compose-plugin \
        || true
    fi
    if ! docker compose version >/dev/null 2>&1; then
      arch=$(uname -m); case "$arch" in x86_64) arch=x86_64;; aarch64) arch=aarch64;; *) die "Kiến trúc $arch chưa hỗ trợ cài compose tự động";; esac
      mkdir -p /usr/local/lib/docker/cli-plugins
      curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${arch}" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose
      chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    fi
  fi
  # Khởi động daemon
  if ! systemctl enable --now docker >/dev/null 2>&1 \
     && ! service docker start >/dev/null 2>&1; then
    # Máy không có systemd: chạy dockerd trực tiếp
    nohup dockerd >/var/log/dockerd.log 2>&1 &
  fi
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker_usable || die "Docker cài rồi nhưng daemon chưa chạy. Xem: journalctl -u docker"
  ok "Đã cài và khởi động Docker"
  # Cho phép tài khoản thường dùng docker không cần sudo ở lần sau
  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != root ]]; then
    usermod -aG docker "$SUDO_USER" >/dev/null 2>&1 || true
  fi
fi

COMPOSE=(docker compose)

# ------------------------------------------------------- 2) Mã nguồn dự án
step '2/6 — Mã nguồn dự án'
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || true)
ROOT=''
if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/../docker-compose.yml" ]]; then
  ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
else
  if [[ ! -f "$INSTALL_DIR/docker-compose.yml" ]]; then
    command -v git >/dev/null 2>&1 || install_pkgs git
    log "  Đang clone $REPO_URL → $INSTALL_DIR ..."
    if [[ -d "$INSTALL_DIR" && ! -d "$INSTALL_DIR/.git" ]]; then
      rm -rf "$INSTALL_DIR"
    fi
    mkdir -p "$INSTALL_DIR"
    branch_args=(); [[ -n "$BRANCH" ]] && branch_args=(--branch "$BRANCH")
    if [[ ! -d "$INSTALL_DIR/.git" ]]; then
      git clone "${branch_args[@]}" "$REPO_URL" "$INSTALL_DIR"
    fi
  else
    warn "Đã có mã nguồn tại $INSTALL_DIR — dùng lại (không clone mới)"
  fi
  ROOT="$INSTALL_DIR"
fi
cd "$ROOT"

# Tự cập nhật mã nguồn về bản mới nhất (idempotent — KHÔNG bao giờ build code cũ
# một cách âm thầm). Chỉ git pull khi là kho git sạch để không đè thay đổi local.
if [[ -d .git ]] && command -v git >/dev/null 2>&1; then
  if [[ -n "$(git status --porcelain -uno 2>/dev/null)" ]]; then
    warn "Mã nguồn có thay đổi local — bỏ qua tự cập nhật (git pull)"
  elif git fetch --quiet origin 2>/dev/null; then
    if [[ -n "$BRANCH" && "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" != "$BRANCH" ]]; then
      git checkout --quiet "$BRANCH" 2>/dev/null || warn "Không chuyển được sang nhánh '$BRANCH'"
    fi
    if git pull --ff-only --quiet 2>/dev/null; then
      ok "Mã nguồn đã là bản mới nhất của nhánh '$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')'"
    else
      warn "Không tự git pull được (thiếu upstream hoặc lệch lịch sử) — dùng mã nguồn hiện có"
    fi
  else
    warn "Không fetch được origin (mạng?) — dùng mã nguồn hiện có, KHÔNG đảm bảo là bản mới"
  fi
fi
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo 'không-git')
ok "Dùng mã nguồn tại: $ROOT (commit $COMMIT)"
ENV_FILE="$ROOT/.env"
[[ -f docker-compose.yml ]] || die "Không tìm thấy docker-compose.yml trong $ROOT"
command -v curl >/dev/null 2>&1 || install_pkgs curl ca-certificates

# --------------------------------------------- 3) Tệp .env + bí mật ngẫu nhiên
step '3/6 — Cấu hình .env'
PUBLIC_IP=$(curl -fsS --max-time 4 https://ifconfig.me 2>/dev/null \
  || curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null \
  || hostname -I 2>/dev/null | awk '{print $1}' || true)
PUBLIC_IP=${PUBLIC_IP:-127.0.0.1}

if [[ ! -f "$ENV_FILE" ]]; then
  cp .env.example "$ENV_FILE"
  CREATED_ENV=1
  ok "Tạo mới $ENV_FILE từ .env.example"
else
  CREATED_ENV=0
  warn "$ENV_FILE đã có — giữ nguyên, chỉ thay giá trị ví dụ còn để nguyên"
fi

# Thay các giá trị ví dụ ("doi-...") và các biến do bạn truyền vào
is_placeholder() { [[ "$1" == doi-* || -z "$1" ]]; }

if [[ $CREATED_ENV -eq 1 ]] || is_placeholder "$(env_get POSTGRES_PASSWORD)"; then
  set_env POSTGRES_PASSWORD "${POSTGRES_PASSWORD:-$(gen_hex 24)}"
fi
if [[ $CREATED_ENV -eq 1 ]] || is_placeholder "$(env_get REDIS_PASSWORD)"; then
  set_env REDIS_PASSWORD "${REDIS_PASSWORD:-$(gen_hex 24)}"
fi
if [[ $CREATED_ENV -eq 1 ]] || is_placeholder "$(env_get JWT_SECRET)"; then
  set_env JWT_SECRET "${JWT_SECRET:-$(gen_hex 48)}"
fi
if [[ $CREATED_ENV -eq 1 ]] || is_placeholder "$(env_get JWT_REFRESH_SECRET)"; then
  set_env JWT_REFRESH_SECRET "${JWT_REFRESH_SECRET:-$(gen_hex 48)}"
fi

# Tài khoản quản trị
ADMIN_USERNAME="${ADMIN_USERNAME:-$(env_get ADMIN_USERNAME)}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
if [[ -n "$ADMIN_PASSWORD" ]]; then
  set_env ADMIN_PASSWORD "$ADMIN_PASSWORD"
else
  ADMIN_PASSWORD="$(env_get ADMIN_PASSWORD)"
  if [[ $CREATED_ENV -eq 1 || -z "$ADMIN_PASSWORD" || "$ADMIN_PASSWORD" == 'Admin@123' ]]; then
    ADMIN_PASSWORD=$(gen_pass)
    set_env ADMIN_PASSWORD "$ADMIN_PASSWORD"
  fi
fi
set_env ADMIN_USERNAME "$ADMIN_USERNAME"

# Cổng: giữ giá trị đã có trong .env khi chạy lại (không ghi đè ngầm)
OLD_WEB_PORT=$(env_get WEB_PORT)
OLD_API_PORT=$(env_get API_PORT)
WEB_PORT="${WEB_PORT:-$OLD_WEB_PORT}"
WEB_PORT="${WEB_PORT:-3000}"
API_PORT="${API_PORT:-$OLD_API_PORT}"
API_PORT="${API_PORT:-4000}"
for p in "$WEB_PORT" "$API_PORT"; do
  [[ "$p" =~ ^[0-9]+$ && "$p" -ge 1 && "$p" -le 65535 ]] \
    || die "Cổng không hợp lệ: '$p' (cần số từ 1 đến 65535)"
done
[[ "$WEB_PORT" != "$API_PORT" ]] || die "--web-port và --api-port đang trùng nhau ($WEB_PORT)"
PORTS_CHANGED=0
[[ "$WEB_PORT" != "$OLD_WEB_PORT" || "$API_PORT" != "$OLD_API_PORT" ]] && PORTS_CHANGED=1
set_env WEB_PORT "$WEB_PORT"
set_env API_PORT "$API_PORT"

# CORS: tự cập nhật khi tạo mới / có --domain / biến CORS_ORIGINS / ĐỔI CỔNG
if [[ $CREATED_ENV -eq 1 || $PORTS_CHANGED -eq 1 || -n "$DOMAIN" || -n "${CORS_ORIGINS:-}" ]]; then
  CORS="${CORS_ORIGINS:-http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT},http://${PUBLIC_IP}:${WEB_PORT},http://${PUBLIC_IP}:${API_PORT}}"
  [[ -n "$DOMAIN" ]] && CORS="https://${DOMAIN},${CORS}"
  set_env CORS_ORIGINS "$CORS"
fi

# Bí mật và tài khoản: chỉ chủ máy (SUDO_USER nếu có) được đọc
if [[ ${EUID:-$(id -u)} -eq 0 && -n "${SUDO_USER:-}" ]]; then
  chown "$SUDO_USER" "$ENV_FILE" 2>/dev/null || true
fi
chmod 600 "$ENV_FILE"

ok "Bí mật ngẫu nhiên đã ghi vào .env (mật khẩu DB/Redis/JWT chỉ dùng [0-9a-f])"
ok "Cổng: Web=${WEB_PORT} · API=${API_PORT}"

# --------------------------------------------------------- 4) Dựng & khởi động
step '4/6 — Kiểm tra cổng, dựng và khởi động hệ thống (lần đầu mất vài phút)'
# Soi cổng TRƯỚC khi dựng ảnh — bận là báo ngay kèm gợi ý, khỏi tốn công build
fail_ports=(); SUG_WEB=''; SUG_API=''
check_port() { # check_port web|api CỔNG
  local name=$1 p=$2 owner
  owner=$(port_owner "$p")
  if [[ "$owner" == qlbs-* ]]; then
    warn "Cổng $p ($name) do container $owner của QLBS giữ — sẽ được dựng lại"
    return 0
  fi
  if [[ -n "$owner" ]]; then
    fail_ports+=("• Cổng $p ($name) đang bị container \"$owner\" giữ.")
    if [[ $name == web ]]; then SUG_WEB=$(suggest_port "$p"); else SUG_API=$(suggest_port "$p"); fi
    return 0
  fi
  if port_busy "$p"; then
    fail_ports+=("• Cổng $p ($name) đang bị tiến trình khác trên máy chiếm (xem: sudo ss -ltnp | grep ':${p} ')")
    if [[ $name == web ]]; then SUG_WEB=$(suggest_port "$p"); else SUG_API=$(suggest_port "$p"); fi
    return 0
  fi
}
check_port web "$WEB_PORT"
check_port api "$API_PORT"
if [[ ${#fail_ports[@]} -gt 0 ]]; then
  SCRIPT_CMD="$0"; [[ "$0" == *install.sh ]] || SCRIPT_CMD='deploy/install.sh'
  SUG_WEB=${SUG_WEB:-$WEB_PORT}; SUG_API=${SUG_API:-$API_PORT}
  {
    printf '%s\n' "${fail_ports[@]}"
    echo
    echo 'Chọn cổng trống khác rồi chạy lại (giữ nguyên .env, ảnh build cũ vẫn dùng được):'
    echo "    sudo bash $SCRIPT_CMD --web-port ${SUG_WEB} --api-port ${SUG_API}"
  } >&2
  die 'cổng bị chiếm — dừng TRƯỚC khi dựng ảnh để không mất thời gian build.'
fi
# Tự động tạo 2GB Swap nếu máy chủ RAM thấp (< 3GB) và chưa có Swap
TOTAL_RAM_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo 0)
SWAP_MB=$(free -m 2>/dev/null | awk '/^Swap:/{print $2}' || echo 0)
if [[ ${TOTAL_RAM_MB:-0} -gt 0 && ${TOTAL_RAM_MB:-0} -lt 3000 && ${SWAP_MB:-0} -lt 1024 ]]; then
  log "  RAM khả dụng (${TOTAL_RAM_MB}MB < 3000MB) và Swap (${SWAP_MB}MB < 1024MB) — tự tạo 2GB Swapfile để chống lỗi tràn RAM (OOM Killer)..."
  if fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none; then
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null 2>&1
    swapon /swapfile >/dev/null 2>&1
    if ! grep -q '/swapfile' /etc/fstab 2>/dev/null; then
      echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    ok "Đã kích hoạt 2GB Swap bảo vệ quá trình build"
  fi
fi

mkdir -p data/postgres data/redis data/uploads data/backups
# uploads/backups được bind-mount vào container api chạy bằng user `node` (UID 1000);
# thư mục vừa tạo ở trên thuộc root → container không ghi được (EACCES mkdir /app/backups/exports)
chown -R 1000:1000 data/uploads data/backups
# Font Times New Roman gốc cho bản in PDF (lỗi không làm dừng cài đặt)
bash deploy/install-times-font.sh --quiet || true

# Dọn sạch các cache mount bị lỗi/hỏng từ lần chạy trước nếu có
docker builder prune -f --filter type=exec.cachemount >/dev/null 2>&1 || true

# Compose mới coi --progress là cờ toàn cục; bản cũ nhận ở lệnh build
BUILD_FLAGS=()
if "${COMPOSE[@]}" --progress plain version >/dev/null 2>&1; then
  BUILD_FLAGS=(--progress plain)
fi

# Dựng lần lượt từng container (không build song song cùng lúc để tránh nghẽn RAM trên VPS nhỏ)
log "  → Đang dựng API Backend (NestJS)..."
"${COMPOSE[@]}" "${BUILD_FLAGS[@]}" build api || "${COMPOSE[@]}" build api
log "  → Đang dựng Giao diện Web Kiosk (Next.js)..."
"${COMPOSE[@]}" "${BUILD_FLAGS[@]}" build web || "${COMPOSE[@]}" build web

"${COMPOSE[@]}" up -d
ok "Đã khởi động: PostgreSQL · Redis · API · Web"

# ------------------------------------------------------------- 5) Chờ khỏe
wait_http() { # wait_http URL MÔ_TẢ GIÂI_HẠN
  local url=$1 desc=$2 limit=${3:-180} start code
  start=$(date +%s)
  while true; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || true)
    code=${code:-000}
    [[ "$code" == 2* ]] && return 0
    if (( $(date +%s) - start > limit )); then
      bad "$desc không trả về HTTP 2xx sau ${limit}s (lần thử cuối: HTTP $code)"
      return 1
    fi
    sleep 3
  done
}

step '5/6 — Chờ dịch vụ sẵn sàng'
wait_http "http://127.0.0.1:${API_PORT}/health" 'API /health' 300 || {
  warn 'Log 40 dòng cuối của api:'; "${COMPOSE[@]}" logs --tail=40 api || true
  die 'API không khỏe — dừng kiểm tra tại đây.'
}
ok 'API sẵn sàng (đã chạy migration + dữ liệu nền)'
wait_http "http://127.0.0.1:${WEB_PORT}/login" 'Web /login' 180 || {
  warn 'Log 40 dòng cuối của web:'; "${COMPOSE[@]}" logs --tail=40 web || true
  die 'Web không sẵn sàng — dừng kiểm tra tại đây.'
}
ok 'Web sẵn sàng'

# ------------------------------------------------------ 6) Kiểm tra chéo
step '6/6 — Kiểm tra chéo ("ok chưa")'
PASS=0; FAIL=0
okc()  { ok "$*";  PASS=$((PASS+1)); }
badc() { bad "$*"; FAIL=$((FAIL+1)); }

# 6.1 Trạng thái container
for svc in postgres redis api web; do
  cid=$("${COMPOSE[@]}" ps -q "$svc" 2>/dev/null || true)
  st=$( [[ -n "$cid" ]] && docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo missing )
  if [[ "$st" == running ]]; then okc "Container qlbs-$svc đang chạy"
  else badc "Container qlbs-$svc không chạy (trạng thái: $st)"; fi
done

# 6.2 Health API — kiểm tra CSDL + cache thật
HEALTH=$(curl -fsS --max-time 8 "http://127.0.0.1:${API_PORT}/health" 2>/dev/null || true)
if grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"[[:space:]]*,[[:space:]]*"app"[[:space:]]*:[[:space:]]*"qlbs"' <<<"$HEALTH"; then
  okc 'GET /health → "status":"ok"'
else
  badc 'GET /health không trả về "status":"ok"'
fi
if grep -Eq '"database"[[:space:]]*:[[:space:]]*\{[^}]*"ok"[[:space:]]*:[[:space:]]*true' <<<"$HEALTH"; then
  okc 'Kiểm tra kết nối PostgreSQL: ok'
else
  badc 'Kiểm tra kết nối PostgreSQL: KHÔNG ok'
fi
if grep -Eq '"cache"[[:space:]]*:[[:space:]]*\{[^}]*"ok"[[:space:]]*:[[:space:]]*true' <<<"$HEALTH"; then
  okc 'Kiểm tra Redis (cache): ok'
else
  badc 'Kiểm tra Redis (cache): KHÔNG ok'
fi

# 6.3 Đăng nhập admin thật (qua cổng API và qua proxy của Web)
LOGIN_BODY=$(printf '{"username":"%s","password":"%s"}' \
  "$(json_esc "$ADMIN_USERNAME")" "$(json_esc "$ADMIN_PASSWORD")")
LOGIN=$(curl -fsS --max-time 8 -X POST -H 'Content-Type: application/json' \
  -d "$LOGIN_BODY" "http://127.0.0.1:${API_PORT}/api/auth/login" 2>/dev/null || true)
if grep -q '"accessToken"' <<<"$LOGIN"; then
  okc "Đăng nhập ${ADMIN_USERNAME} trực tiếp qua API: ok (có accessToken)"
else
  badc "Đăng nhập ${ADMIN_USERNAME} qua API thất bại (kiểm tra lại tài khoản trong .env)"
fi
LOGIN_WEB=$(curl -fsS --max-time 8 -X POST -H 'Content-Type: application/json' \
  -d "$LOGIN_BODY" "http://127.0.0.1:${WEB_PORT}/api/auth/login" 2>/dev/null || true)
if grep -q '"accessToken"' <<<"$LOGIN_WEB"; then
  okc 'Đăng nhập qua proxy Web → API: ok'
else
  badc 'Đăng nhập qua proxy Web → API thất bại (sai API_PROXY_TARGET?)'
fi

# 6.4 Giao diện + tài liệu API
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${WEB_PORT}/login" 2>/dev/null || true); code=${code:-000}
[[ "$code" == 2* ]] && okc "Trang đăng nhập /login trả về HTTP $code" \
                   || badc "Trang /login trả về HTTP $code (không phải 2xx)"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${WEB_PORT}/health" 2>/dev/null || true); code=${code:-000}
[[ "$code" == 2* ]] && okc 'Proxy Web /health → API: ok' \
                   || badc 'Proxy Web /health → API không hoạt động (HTTP $code)'
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${API_PORT}/api/docs" 2>/dev/null || true); code=${code:-000}
[[ "$code" == 2* ]] && okc "Swagger /api/docs: HTTP $code" \
                   || warn "Swagger /api/docs trả về HTTP $code (có thể đã tắt — không tính lỗi)"

# ----------------------------------------------------------- Dữ liệu mẫu
if [[ $WANT_DEMO -eq 1 && $FAIL -eq 0 ]]; then
  step 'Nạp dữ liệu mẫu (--demo)'
  "${COMPOSE[@]}" exec -T api npx tsx scripts/demo-data.ts \
    && ok 'Đã nạp dữ liệu mẫu (khtb.lan / tc.hoa / bs.minh — mật khẩu xem README)' \
    || badc 'Nạp dữ liệu mẫu thất bại'
fi

# ---------------------------------------------------------------- Tổng kết
SUMMARY_FILE="$ROOT/data/thong-tin-dang-nhap.txt"
{
  echo 'QLBS — Thông tin truy cập (tệp này chứa MẬT KHẨU, xem rồi xóa nếu không cần)'
  echo "Tạo lúc: $(date '+%F %T %z')"
  echo
  echo "Giao diện : http://${PUBLIC_IP}:${WEB_PORT}"
  echo "API       : http://${PUBLIC_IP}:${API_PORT}/api"
  echo "Swagger   : http://${PUBLIC_IP}:${API_PORT}/api/docs"
  echo
  echo "Tài khoản quản trị: ${ADMIN_USERNAME}"
  echo "Mật khẩu          : ${ADMIN_PASSWORD}"
  echo
  echo 'Các bí mật khác (DB, Redis, JWT): xem tệp .env cạnh docker-compose.yml'
} > "$SUMMARY_FILE"
chmod 600 "$SUMMARY_FILE"
if [[ ${EUID:-$(id -u)} -eq 0 && -n "${SUDO_USER:-}" ]]; then
  chown "$SUDO_USER" "$SUMMARY_FILE" 2>/dev/null || true
fi

log ''
log "${C_B}════════════════════════════════════════════════════════════${C_0}"
if [[ $FAIL -eq 0 ]]; then
  log "${C_B}  ✓ TẤT CẢ OK — hệ thống chạy tốt trên Docker${C_0}"
else
  log "${C_B}  ✗ CHƯA OK — có ${FAIL} kiểm tra thất bại (xem lại dấu ✗ phía trên)${C_0}"
fi
log "${C_B}════════════════════════════════════════════════════════════${C_0}"
log ''
log "  Giao diện : http://${PUBLIC_IP}:${WEB_PORT}"
log "  API       : http://${PUBLIC_IP}:${API_PORT}/api"
log "  Swagger   : http://${PUBLIC_IP}:${API_PORT}/api/docs"
log ''
log "  Đăng nhập : ${C_B}${ADMIN_USERNAME} / ${ADMIN_PASSWORD}${C_0}   (đã lưu trong ${SUMMARY_FILE#$ROOT/})"
log ''
log '  Lưu ý:'
log '    • Đổi mật khẩu quản trị ngay sau khi xác nhận hệ thống chạy tốt.'
log '    • Bí mật DB/Redis/JWT nằm trong .env — không đưa tệp này lên Git.'
log '    • Tên miền + HTTPS: xem docs/TRIEN-KHAI.md (mẫu Nginx: deploy/nginx/).'
log '    • Nhật ký: docker compose logs -f api   ·   trạng thái: docker compose ps'
log ''

[[ $FAIL -eq 0 ]] || exit 1
exit 0
