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
  CHANGED=""
else
  ok "$(git rev-list --count "$OLD..$NEW") commit mới: ${OLD:0:7} → ${NEW:0:7}"
  git --no-pager log --format='    %h %s' "$OLD..$NEW" | head -20
  CHANGED=$(git diff --name-only "$OLD" "$NEW")
fi

# uploads/backups gắn bind-mount vào container api (user node = UID 1000) — phải đúng chủ
mkdir -p data/uploads data/backups
chown -R 1000:1000 data/uploads data/backups 2>/dev/null || true

# Font Times New Roman gốc cho bản in PDF (chỉ tải lần đầu; lỗi không làm dừng cập nhật)
if [[ -f deploy/install-times-font.sh ]]; then
  bash deploy/install-times-font.sh --quiet 2>/dev/null || true
fi

BUILD=()
if [[ $FORCE_API -eq 1 ]] || grep -q '^backend/' <<<"$CHANGED"; then BUILD+=(api); fi
if [[ $FORCE_WEB -eq 1 ]] || grep -q '^frontend/' <<<"$CHANGED"; then BUILD+=(web); fi
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
