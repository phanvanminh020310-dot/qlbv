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
#    4. Chờ /health và trang đăng nhập phản hồi, dọn ảnh cũ treo (dangling).
#
#  Tùy chọn:
#    --all        Dựng lại cả api và web dù không đổi
#    --api        Chỉ dựng lại api        --web   Chỉ dựng lại web
#    --no-pull    Bỏ qua git pull (dùng khi đã sửa code trực tiếp trên máy chủ)
#    --backup     Sao lưu CSDL trước khi cập nhật (data/backups/pre-update-*.dump)
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

# git có thể từ chối thư mục do root sở hữu khi chạy bằng sudo
git config --global --add safe.directory "$ROOT" >/dev/null 2>&1 || true

OLD=$(git rev-parse HEAD)
if [[ $DO_PULL -eq 1 ]]; then
  step "Lấy code mới (git pull)"
  if ! git diff --quiet || ! git diff --cached --quiet; then
    warn "Có thay đổi cục bộ chưa commit — tạm cất (git stash) để pull"
    git stash push -m "update.sh $(date +%F_%T)" >/dev/null
    STASHED=1
  fi
  git pull --ff-only || die "git pull thất bại (nhánh bị lệch?). Kiểm tra bằng: git status"
  if [[ ${STASHED:-0} -eq 1 ]]; then
    git stash pop >/dev/null 2>&1 && ok "Đã áp lại thay đổi cục bộ" || warn "Không áp lại được thay đổi cục bộ — xem: git stash list"
  fi
fi
NEW=$(git rev-parse HEAD)
# Bản thân update.sh vừa được cập nhật → chạy lại bằng bản mới (bash đang đọc bản cũ)
if [[ "$OLD" != "$NEW" && -z "${QLBS_UPDATE_REEXEC:-}" ]] && git diff --name-only "$OLD" "$NEW" | grep -qx 'deploy/update.sh'; then
  ok "update.sh có phiên bản mới — chạy lại bằng bản mới"
  export QLBS_UPDATE_REEXEC=1
  exec bash "$ROOT/deploy/update.sh" "${ORIG_ARGS[@]}" --no-pull
fi

if [[ "$OLD" == "$NEW" ]]; then
  ok "Không có commit mới từ git pull ($(git log -1 --format='%h %s'))"
else
  ok "$(git rev-list --count "$OLD..$NEW") commit mới: ${OLD:0:7} → ${NEW:0:7}"
  git --no-pager log --format='    %h %s' "$OLD..$NEW" | head -20
fi

# So với commit ĐANG CHẠY của từng service (lưu ở data/.deployed-<svc>), không phải
# commit trước lần pull này — nếu đã tự `git pull` trước khi chạy script, hoặc lần
# dựng trước thất bại, thì vẫn biết cần dựng lại.
STATE_DIR="$ROOT/data"; mkdir -p "$STATE_DIR"
# uploads/backups gắn bind-mount vào container api (user node = UID 1000) — phải đúng chủ
mkdir -p data/uploads data/backups
chown -R 1000:1000 data/uploads data/backups
needs_build() { # needs_build <svc> <thư-mục>
  local f="$STATE_DIR/.deployed-$1" dep
  [[ -s "$f" ]] || { warn "$1: chưa rõ bản đang chạy → dựng lại"; return 0; }
  dep=$(cat "$f")
  git cat-file -e "$dep^{commit}" 2>/dev/null || { warn "$1: không tìm thấy commit $dep → dựng lại"; return 0; }
  [[ "$dep" == "$NEW" ]] && return 1
  git diff --quiet "$dep" "$NEW" -- "$2" "$3" 2>/dev/null && return 1
  ok "$1: có thay đổi từ ${dep:0:7} → ${NEW:0:7}"
  return 0
}

BUILD=()
if [[ $FORCE_API -eq 1 ]] || needs_build api backend/ docker-compose.yml; then BUILD+=(api); fi
if [[ $FORCE_WEB -eq 1 ]] || needs_build web frontend/ docker-compose.yml; then BUILD+=(web); fi
DEPLOYED_BEFORE=$(cat "$STATE_DIR/.deployed-api" 2>/dev/null || echo "$OLD")
# Font Times New Roman gốc cho bản in PDF (chỉ tải lần đầu; lỗi không làm dừng cập nhật)
if [[ -f deploy/install-times-font.sh ]]; then
  bash deploy/install-times-font.sh --quiet || warn "Chưa cài được Times New Roman gốc — bản in dùng Tinos (tương thích Times New Roman)"
fi

CHANGED=$(git diff --name-only "$DEPLOYED_BEFORE" "$NEW" 2>/dev/null || true)
COMPOSE_CHANGED=0
grep -qE '^(docker-compose\.yml|\.env\.example)$' <<<"$CHANGED" && COMPOSE_CHANGED=1

if [[ ${#BUILD[@]} -eq 0 && $COMPOSE_CHANGED -eq 0 ]]; then
  step "Không có thay đổi cần dựng lại"
  ok "Chỉ đổi tài liệu hoặc không có gì mới — hệ thống giữ nguyên"
  "${DC[@]}" ps
  exit 0
fi

if [[ $DO_BACKUP -eq 1 ]]; then
  step "Sao lưu CSDL trước khi cập nhật"
  mkdir -p data/backups
  F="data/backups/pre-update-$(date +%F_%H%M%S).dump"
  "${DC[@]}" exec -T postgres pg_dump -U qlbs -d qlbs -Fc > "$F" && ok "Đã lưu $F ($(du -h "$F" | cut -f1))"
fi

# ---------------------------------------------------------------- dựng ảnh
# Compose mới coi --progress là cờ toàn cục; bản cũ chỉ nhận ở lệnh build
if "${DC[@]}" --progress plain version >/dev/null 2>&1; then BUILD_CMD=("${DC[@]}" --progress plain build)
else BUILD_CMD=("${DC[@]}" build --progress=plain); fi

# Lỗi thoáng qua (mạng, BuildKit sập) → thử lại; lỗi code/thiếu RAM → dừng ngay
TRANSIENT_RE='grpc server closed unexpectedly|frontend grpc|rpc error|connection reset|i/o timeout|TLS handshake timeout|failed to resolve|failed to fetch|temporary failure in name resolution|unexpected EOF|context deadline exceeded|ECONNRESET|ETIMEDOUT|EAI_AGAIN|503 Service Unavailable|toomanyrequests|failed to do request'
build_service() { # build_service tên log
  local svc=$1 log=$2 try
  for try in 1 2 3; do
    if [[ $try -eq 1 ]]; then printf '  → đang dựng %s (tiến trình trực tiếp) ...\n' "$svc"
    else printf '  ↻ thử lại lần %s (lỗi tạm thời: mạng/BuildKit) ...\n' "$try"; fi
    if "${BUILD_CMD[@]}" "$svc" 2>&1 | tee "$log"; then return 0; fi
    grep -qiE "$TRANSIENT_RE" "$log" || return 1
    cp "$log" "$log.lan$try" 2>/dev/null || true
    sleep $((try * 5))
  done
  return 1
}
build_hint() { # gợi ý theo nội dung log lỗi
  if grep -qiE 'exit code: 137|killed|out of memory|heap out of memory|cannot allocate memory' "$1"; then
    warn "Có dấu hiệu thiếu RAM khi dựng. Tạo 2GB swap rồi chạy lại:"
    echo "    sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"
    echo "    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
  elif grep -qiE "$TRANSIENT_RE" "$1"; then
    warn "Lỗi mạng/BuildKit lặp lại 3 lần. Thử: sudo systemctl restart docker && sudo bash deploy/update.sh --no-pull"
  fi
}
MEM_FREE_MB=$(awk '/MemAvailable|SwapFree/{s+=$2} END{print int(s/1024)}' /proc/meminfo 2>/dev/null || echo 0)
if [[ ${#BUILD[@]} -gt 0 && ${MEM_FREE_MB:-0} -gt 0 && ${MEM_FREE_MB:-0} -lt 1500 ]]; then
  warn "RAM + swap còn trống ~${MEM_FREE_MB}MB — dựng giao diện cần ~1,5GB, nên thêm swap nếu dựng lỗi"
fi

START=$(date +%s)
if [[ ${#BUILD[@]} -gt 0 ]]; then
  step "Dựng lại: ${BUILD[*]} (có cache — lần sau nhanh hơn)"
  # Dựng lần lượt (không song song): đỡ tốn RAM trên VPS nhỏ và log lỗi rõ ràng
  for svc in "${BUILD[@]}"; do
    LOG="/tmp/qlbs-build-$svc.log"
    build_service "$svc" "$LOG" || {
      printf '\n%s✗ Dựng %s thất bại — 40 dòng log cuối:%s\n' "$C_R" "$svc" "$C_0"
      grep -vE 'npm warn deprecated' "$LOG" | tail -40
      build_hint "$LOG"
      die "Log đầy đủ: $LOG (gửi file này nếu cần hỗ trợ)"
    }
    ok "Đã dựng $svc ($(grep -cE '^#[0-9]+ CACHED' "$LOG" || true) bước dùng cache)"
  done
  step "Khởi động lại: ${BUILD[*]}"
  "${DC[@]}" up -d --no-deps "${BUILD[@]}"
  for svc in "${BUILD[@]}"; do echo "$NEW" > "$STATE_DIR/.deployed-$svc"; done
fi
if [[ $COMPOSE_CHANGED -eq 1 ]]; then
  step "docker-compose.yml thay đổi — áp dụng cấu hình mới"
  "${DC[@]}" up -d
fi

# ---------------------------------------------------------------- kiểm tra
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '"'"'" ; }
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

docker image prune -f >/dev/null 2>&1 || true
"${DC[@]}" ps

ELAPSED=$(( $(date +%s) - START ))
if [[ $FAIL -eq 0 ]]; then
  printf '\n%s✓ Cập nhật xong sau %ss.%s Nhớ bấm Ctrl+F5 trên trình duyệt.\n' "$C_G" "$ELAPSED" "$C_0"
else
  printf '\n%s! Cập nhật xong nhưng có dịch vụ chưa sẵn sàng — xem log ở trên.%s\n' "$C_Y" "$C_0"
  exit 1
fi
