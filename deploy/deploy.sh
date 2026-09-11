set -euo pipefail
cd "$(dirname "$0")"

NET=bmik_net
APP_FILE=docker-compose.app.yml
DB_FILE=docker-compose.db.yml
DB_PROJECT=nocode-db
DB_CONTAINER=nocode-db
CADDY_TMPL=Caddyfile.tmpl
SITES_DIR=../sites
CADDY_OUT="${SITES_DIR}/no-code.caddy"
STATE=active-color
PROXY_CONTAINER=bmik-proxy

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

if [ "$(docker inspect -f '{{.State.Running}}' "$PROXY_CONTAINER" 2>/dev/null || echo false)" != "true" ]; then
  echo "ERROR: container ${PROXY_CONTAINER} chưa chạy. Chạy deploy của bmik trước."; exit 1
fi

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

# ── Postgres (mapping project + audit log) ────────────────────────────────
# Long-lived, compose project RIÊNG (-p nocode-db) nên nằm ngoài vòng blue-green
# và không bị `docker compose -p bmik-proxy down` của bmik kéo theo.
#
# `up -d` idempotent: DB đang chạy thì không đụng gì. Chạy ở MỌI lần deploy chứ
# không phải một bước tay làm-một-lần — quên bước tay đó thì app tự hạ về
# db=off và phân quyền theo project ngừng hoạt động mà không báo gì.
DB_WANTED=$(grep -E '^POSTGRES_HOST=.+' .env >/dev/null 2>&1 && echo yes || echo no)
SCOPE=$(sed -n 's/^AUTHZ_PROJECT_SCOPE=//p' .env | tr -d '[:space:]')
SCOPE=${SCOPE:-off}

if [ "$DB_WANTED" = no ] && [ "$SCOPE" != off ]; then
  echo "ERROR: AUTHZ_PROJECT_SCOPE=${SCOPE} nhưng .env chưa có POSTGRES_HOST."
  echo "       Thiếu DB thì app tự hạ về 'off' — phân quyền project sẽ im lặng không chạy."
  exit 1
fi

if [ "$DB_WANTED" = yes ]; then
  [ -f "$DB_FILE" ] || { echo "ERROR: thiếu ${DB_FILE} — copy lại thư mục deploy/ lên host."; exit 1; }
  echo "[0/5] Postgres (${DB_CONTAINER})..."
  $COMPOSE -p "$DB_PROJECT" -f "$DB_FILE" up -d
  if ! wait_healthy "$DB_CONTAINER" 20; then
    echo "ERROR: Postgres không healthy — dừng, KHÔNG deploy app."
    $COMPOSE -p "$DB_PROJECT" -f "$DB_FILE" logs --tail=30 || true
    exit 1
  fi
fi

echo "[1/5] ECR login..."
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

echo "[2/5] Khởi động ${TARGET} (pull image)..."
COLOR=$TARGET $COMPOSE -p "nocode-${TARGET}" -f "$APP_FILE" up -d --pull always

RUNNING_IMAGE=$(docker inspect -f '{{.Config.Image}}' "nocode-app-${TARGET}" 2>/dev/null || echo "")
if [ -n "$RUNNING_IMAGE" ]; then
  REV=$(docker image inspect "$RUNNING_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || echo unknown)
  DIGEST=$(docker image inspect "$RUNNING_IMAGE" --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' 2>/dev/null || echo unknown)
  echo "    image  : ${RUNNING_IMAGE}"
  echo "    git rev: ${REV:-unknown}"
  echo "    digest : ${DIGEST:-unknown}"
fi

echo "[3/5] Chờ ${TARGET} healthy..."
if ! wait_healthy "nocode-app-${TARGET}"; then
  echo "Health FAIL → rollback: hạ ${TARGET}, giữ ${ACTIVE} đang serve."
  echo "--- healthcheck log ---"
  docker inspect --format '{{if .State.Health}}{{range .State.Health.Log}}exit={{.ExitCode}} out={{.Output}}{{end}}{{else}}no healthcheck{{end}}' "nocode-app-${TARGET}" 2>/dev/null || true
  COLOR=$TARGET $COMPOSE -p "nocode-${TARGET}" -f "$APP_FILE" logs --tail=50 || true
  COLOR=$TARGET $COMPOSE -p "nocode-${TARGET}" -f "$APP_FILE" down
  exit 1
fi

echo "[4/5] Chuyển Caddy → ${TARGET}..."

sed "s/__NOCODE_COLOR__/${TARGET}/g" "$CADDY_TMPL" > "${CADDY_OUT}.tmp"
mv -f "${CADDY_OUT}.tmp" "$CADDY_OUT"

docker exec "$PROXY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

echo "[5/5] Ghi active=${TARGET}, tắt màu cũ..."
echo "$TARGET" > "$STATE"
if [ "$ACTIVE" != "none" ] && [ "$ACTIVE" != "$TARGET" ]; then
  COLOR=$ACTIVE $COMPOSE -p "nocode-${ACTIVE}" -f "$APP_FILE" down
fi

echo ""
echo "=========================================="
echo "Deploy SUCCESS — đang serve: ${TARGET}"
echo "=========================================="
