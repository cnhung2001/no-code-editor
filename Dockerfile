# syntax=docker/dockerfile:1.7
# ── NoCode Editor — một image, một origin ─────────────────────────────────
# SPA (React + visual editor) và backend (/api, /auth) BẮT BUỘC cùng origin:
# authz khớp redirectUri tuyệt đối và cookie phiên là httpOnly same-site.
# Vì vậy không tách frontend ra S3/CloudFront — Express serve luôn dist/.

# ── 1. Build visual-editor lib (dist/ không nằm trong git) ────────────────
# Layout trong image PHẢI giống repo: schema/ ngang cấp visual-editor/. schema.ts
# glob '../../../../schema/*.json' — trỏ RA NGOÀI package, nên WORKDIR nông hơn
# (vd /ve) sẽ làm glob match 0 file → build vẫn pass, runtime trắng màn hình.
FROM node:22-alpine AS editor
WORKDIR /src/visual-editor
COPY visual-editor/package.json visual-editor/package-lock.json ./
RUN npm ci
COPY visual-editor/ ./
COPY schema /src/schema
RUN npm run build-lib
# Fail fast: thiếu schema thì build vẫn pass nhưng bundle không chứa tên schema nào.
RUN grep -q 'div-container.json' dist/lib.js \
    || { echo 'BUILD BROKEN: schema registry rỗng — kiểm tra /src/schema'; exit 1; }

# ── 2. Build SPA ─────────────────────────────────────────────────────────
FROM node:22-alpine AS web
WORKDIR /app
# `file:./visual-editor` → npm cần package.json + dist đã build sẵn lúc install.
COPY visual-editor/package.json ./visual-editor/package.json
COPY --from=editor /src/visual-editor/dist ./visual-editor/dist
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
# VITE_* là BUILD-TIME: đổi giá trị = phải build lại image, không phải đổi env container.
ARG VITE_API_BASE=/api
ARG VITE_CDN_BASE=
ARG VITE_SAVE_FORMAT=wrapper
ARG VITE_USE_MOCK=false
ARG VITE_ASSET_PROXY=false
ARG VITE_ASSET_PUBLIC_BASE=
RUN npm run build
# Fail fast: registry schema (988 KB, chỉ editor cần) KHÔNG được nằm trong chunk
# khởi động. Nó lọt vào khi có ai import '@divkitframework/visual-editor' (barrel
# → App.svelte → schema.ts) từ code eager — xem visual-editor/src/preview.ts.
# Lỗi này không làm build fail và không hỏng gì thấy được, chỉ làm web tải chậm
# gấp ba, nên phải chặn ở đây chứ không trông vào ai đó soi bundle.
RUN ! grep -q 'div-container.json' dist/assets/index-*.js \
    || { echo 'BUILD BROKEN: schema DivKit lọt vào chunk eager — import từ dist/preview.js, đừng import barrel'; exit 1; }

# ── 3. Deps của server (cần token registry @ikameglobal) ─────────────────
FROM node:22-alpine AS server-deps
WORKDIR /srv
COPY server/package.json server/package-lock.json ./
# Token KHÔNG được COPY vào layer. BuildKit secret: mount lúc chạy rồi biến mất.
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci --omit=dev

# ── 4. Runtime ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /srv
COPY --from=server-deps /srv/node_modules ./server/node_modules
COPY server/package.json ./server/package.json
COPY server/*.mjs ./server/
# DIST_DIR = <server>/../dist (server/index.mjs:425)
COPY --from=web /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "server/index.mjs"]
