set -euo pipefail
cd "$(dirname "$0")/.."

ECR_REGION="${ECR_REGION:-ap-southeast-1}"
ECR_REGISTRY="${ECR_REGISTRY:-762871078113.dkr.ecr.ap-southeast-1.amazonaws.com}"
ECR_REPO="${ECR_REPO:-ik-nocode-editor}"

VITE_CDN_BASE="${VITE_CDN_BASE:-https://no-code-assests.begamob.com}"
VITE_SAVE_FORMAT="${VITE_SAVE_FORMAT:-wrapper}"

if [ -n "$(git status --porcelain)" ]; then
  echo "⚠ Working tree bẩn — tag sẽ không khớp code thật đang build."
  read -rp "Vẫn tiếp tục? [y/N] " a; [ "$a" = "y" ] || exit 1
fi

TAG="${TAG:-$(git rev-parse --short HEAD)}"
IMAGE="${ECR_REGISTRY}/${ECR_REPO}:${TAG}"

MOVING_TAG="${MOVING_TAG:-prod}"
if [ -n "$MOVING_TAG" ]; then
  MOVING_IMAGE="${ECR_REGISTRY}/${ECR_REPO}:${MOVING_TAG}"
  TAG_ARGS=(-t "$IMAGE" -t "$MOVING_IMAGE")
else
  MOVING_IMAGE=""
  TAG_ARGS=(-t "$IMAGE")
fi

[ -f .npmrc ] || { echo "ERROR: thiếu ./.npmrc (token registry @ikameglobal)"; exit 1; }

aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$ECR_REGION" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$ECR_REPO" --region "$ECR_REGION" >/dev/null

aws ecr get-login-password --region "$ECR_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

echo "Building ${IMAGE}${MOVING_IMAGE:+ + :$MOVING_TAG} (linux/amd64)..."
docker buildx build \
  --platform linux/amd64 \
  --secret id=npmrc,src=.npmrc \
  --build-arg "VITE_CDN_BASE=${VITE_CDN_BASE}" \
  --build-arg "VITE_SAVE_FORMAT=${VITE_SAVE_FORMAT}" \
  --build-arg VITE_API_BASE=/api \
  --build-arg VITE_ASSET_PROXY=false \
  --label "org.opencontainers.image.revision=${TAG}" \
  "${TAG_ARGS[@]}" --push .

echo ""
if [ -n "$MOVING_IMAGE" ]; then
  echo "Xong. Host đã pin :${MOVING_TAG} nên KHÔNG cần sửa .env — chỉ cần:"
  echo "  ssh <host> 'bash ~/project/no-code/deploy.sh'"
  echo ""
  echo "(deploy.sh 'up --pull always' nên luôn kéo bản :${MOVING_TAG} vừa push.)"
  echo "Rollback: đặt NOCODE_IMAGE=${IMAGE} (hoặc tag SHA cũ) trong .env rồi chạy lại deploy.sh."
else
  echo "Xong. Trên host, sửa ~/project/no-code/.env:"
  echo "  NOCODE_IMAGE=${IMAGE}"
  echo "rồi: ssh <host> 'bash ~/project/no-code/deploy.sh'"
fi
