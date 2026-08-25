#!/usr/bin/env bash
#
# Blue-green deploy NoCode Editor — chạy trên host, thư mục ~/project/no-code/.
# Dùng CHUNG container proxy `bmik-proxy` và network `bmik_net` với bmik-api,
# nhưng có active-color RIÊNG và fragment Caddy RIÊNG (../sites/no-code.caddy).
#
# Yêu cầu đã làm 1 lần trên host (xem README.md, mục "Sửa 2 file của bmik"):
#   - docker-compose.proxy.yml mount thêm ./sites:/etc/caddy/sites:ro
#   - Caddyfile.tmpl có dòng: import /etc/caddy/sites/*.caddy
#
set -euo pipefail
cd "$(dirname "$0")"

NET=bmik_net
APP_FILE=docker-compose.app.yml
CADDY_TMPL=Caddyfile.tmpl
SITES_DIR=../sites
CADDY_OUT="${SITES_DIR}/no-code.caddy"
STATE=active-color
PROXY_CONTAINER=bmik-proxy
# Region ECR — cùng ap-southeast-1 với host/S3. Tách biến riêng cho dễ đổi.

ECR_REGION="${ECR_REGION:-ap-southeast-1}"
ECR_REGISTRY="${ECR_REGISTRY:-762871078113.dkr.ecr.ap-southeast-1.amazonaws.com}"

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "ERROR: không tìm thấy 'docker compose' lẫn 'docker-compose'"; exit 1
fi

[ -f .env ] || { echo "ERROR: thiếu ./.env — chép từ .env.example rồi điền."; exit 1; }
if grep -q '__FILL__\|__TAG__' .env; then
  echo "ERROR: ./.env còn __FILL__ / __TAG__ chưa điền."; exit 1
fi

# Proxy phải đang chạy — nocode KHÔNG tự dựng proxy (nó của bmik, dùng chung).
if [ "$(docker inspect -f '{{.State.Running}}' "$PROXY_CONTAINER" 2>/dev/null || echo false)" != "true" ]; then
  echo "ERROR: container ${PROXY_CONTAINER} chưa chạy. Chạy deploy của bmik trước."; exit 1
fi

echo "[0/4] ECR login..."
aws ecr get-login-password --region "$ECR_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

docker network inspect "$NET" >/dev/null 2>&1 || { echo "ERROR: thiếu network $NET"; exit 1; }
mkdir -p "$SITES_DIR"

ACTIVE=$(cat "$STATE" 2>/dev/null || echo none)
if [ "$ACTIVE" = "blue" ]; then TARGET=green; else TARGET=blue; fi
echo "=========================================="
echo "NoCode blue-green: active=${ACTIVE} → target=${TARGET}"
echo "=========================================="

# Fragment phải tồn tại trước khi reload; render tạm trỏ màu đang serve.
if [ ! -f "$CADDY_OUT" ]; then
  if [ "$ACTIVE" != "none" ]; then INIT_COLOR=$ACTIVE; else INIT_COLOR=$TARGET; fi
  sed "s/__NOCODE_COLOR__/${INIT_COLOR}/g" "$CADDY_TMPL" > "${CADDY_OUT}.tmp"
  mv -f "${CADDY_OUT}.tmp" "$CADDY_OUT"
fi

echo "[1/4] Khởi động ${TARGET} (pull image)..."
COLOR=$TARGET $COMPOSE -p "nocode-${TARGET}" -f "$APP_FILE" up -d --pull always

wait_healthy() {
  local name=$1 tries=${2:-40} status=""
  for _ in $(seq 1 "$tries"); do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || echo missing)
    if [ "$status" = "healthy" ]; then echo "    $name → healthy"; return 0; fi
    sleep 3
  done
  echo "    $name → NOT healthy (cuối cùng: ${status})"
  return 1
}

echo "[2/4] Chờ ${TARGET} healthy..."
if ! wait_healthy "nocode-app-${TARGET}"; then
  echo "Health FAIL → rollback: hạ ${TARGET}, giữ ${ACTIVE} đang serve."
  echo "--- healthcheck log ---"
  docker inspect --format '{{if .State.Health}}{{range .State.Health.Log}}exit={{.ExitCode}} out={{.Output}}{{end}}{{else}}no healthcheck{{end}}' "nocode-app-${TARGET}" 2>/dev/null || true
  COLOR=$TARGET $COMPOSE -p "nocode-${TARGET}" -f "$APP_FILE" logs --tail=50 || true
  COLOR=$TARGET $COMPOSE -p "nocode-${TARGET}" -f "$APP_FILE" down
  exit 1
fi

echo "[3/4] Chuyển Caddy → ${TARGET}..."
# Ghi qua file tạm rồi mv (rename atomic) — reload không bao giờ đọc trúng file ghi dở.
sed "s/__NOCODE_COLOR__/${TARGET}/g" "$CADDY_TMPL" > "${CADDY_OUT}.tmp"
mv -f "${CADDY_OUT}.tmp" "$CADDY_OUT"
# reload nạp lại TOÀN BỘ config của proxy (gồm cả site của bmik-api) — zero-downtime,
# nhưng nghĩa là fragment sai cú pháp sẽ làm reload fail và giữ nguyên config cũ.
docker exec "$PROXY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

echo "[4/4] Ghi active=${TARGET}, tắt màu cũ..."
echo "$TARGET" > "$STATE"
if [ "$ACTIVE" != "none" ] && [ "$ACTIVE" != "$TARGET" ]; then
  COLOR=$ACTIVE $COMPOSE -p "nocode-${ACTIVE}" -f "$APP_FILE" down
fi

echo ""
echo "=========================================="
echo "Deploy SUCCESS — đang serve: ${TARGET}"
echo "=========================================="
