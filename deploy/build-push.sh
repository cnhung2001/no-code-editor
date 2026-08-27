#!/usr/bin/env bash
#
# Build image amd64 + push ECR. CHẠY Ở MÁY DEV (hoặc CI), KHÔNG chạy trên host —
# Lightsail nhỏ build vite/svelte là OOM.
#
# Mac ARM: buildx cross-build sang amd64. Docker Desktop bật Rosetta thì ~2 phút;
# không có Rosetta (QEMU thuần, hoặc CI khác) thì chậm hơn nhiều.
set -euo pipefail
cd "$(dirname "$0")/.."

# ECR cùng region với host + S3 (ap-southeast-1) — quyền IAM và pull đều gọn.
# Vẫn tách biến riêng: đổi region ECR sau này không đụng AWS_REGION của app.
ECR_REGION="${ECR_REGION:-ap-southeast-1}"
ECR_REGISTRY="${ECR_REGISTRY:-762871078113.dkr.ecr.ap-southeast-1.amazonaws.com}"
ECR_REPO="${ECR_REPO:-ik-nocode-editor}"

# ⚠ VITE_* nướng thẳng vào bundle lúc build → image KHÔNG portable giữa môi trường.
VITE_CDN_BASE="${VITE_CDN_BASE:-https://no-code-assests.begamob.com}"
VITE_SAVE_FORMAT="${VITE_SAVE_FORMAT:-wrapper}"

if [ -n "$(git status --porcelain)" ]; then
  echo "⚠ Working tree bẩn — tag sẽ không khớp code thật đang build."
  read -rp "Vẫn tiếp tục? [y/N] " a; [ "$a" = "y" ] || exit 1
fi
# Cho override để build từ working tree bẩn vẫn có tag duy nhất, truy được về thời điểm.
TAG="${TAG:-$(git rev-parse --short HEAD)}"
IMAGE="${ECR_REGISTRY}/${ECR_REPO}:${TAG}"

[ -f .npmrc ] || { echo "ERROR: thiếu ./.npmrc (token registry @ikameglobal)"; exit 1; }

aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$ECR_REGION" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$ECR_REPO" --region "$ECR_REGION" >/dev/null

aws ecr get-login-password --region "$ECR_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

echo "Building ${IMAGE} (linux/amd64)..."
docker buildx build \
  --platform linux/amd64 \
  --secret id=npmrc,src=.npmrc \
  --build-arg "VITE_CDN_BASE=${VITE_CDN_BASE}" \
  --build-arg "VITE_SAVE_FORMAT=${VITE_SAVE_FORMAT}" \
  --build-arg VITE_API_BASE=/api \
  --build-arg VITE_ASSET_PROXY=false \
  -t "$IMAGE" --push .

echo ""
echo "Xong. Trên host, sửa ~/project/no-code/.env:"
echo "  NOCODE_IMAGE=${IMAGE}"
echo "rồi: ssh <host> 'bash ~/project/no-code/deploy.sh'"
