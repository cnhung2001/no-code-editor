# NoCode Preview — S3 DivKit Layout Manager

Web quản lý remote layout: duyệt bucket S3 → preview/sửa layout bằng **DivKit Visual Editor thật** (`DivProEditor`) → push ngược lên S3 (kèm version + invalidate CDN). Không cần release lại app.

## Kiến trúc

```
nocode-preview/
  src/
    App.tsx              định tuyến Browser → Preview → Builder + modals
    s3/                  adapter S3 (api gọi backend | mock) + selector
    editor/              DivEditor.tsx (wrap DivProEditor), config, wrapper, resolveAssets
    components/          Sidebar, Browser, LayoutPreview, Builder, modals/
    lib/                 icons, format
    styles/app.css
  server/                backend proxy giữ AWS credentials (Express + AWS SDK v3)
```

- **Shell**: React 18 + Vite + TS — giữ nguyên UI/logic prototype cũ.
- **Editor**: `@divkitframework/visual-editor` (Svelte, build sẵn) nhúng vào 1 DOM node.
  - Preview = layout `['preview']` + `readOnly`.
  - Builder = layout đầy đủ (tree + preview + props/code), palette, undo/redo.
- **S3**: frontend → backend proxy (`/api/*`) → AWS S3. Credentials chỉ nằm ở backend.

## Chuẩn bị thư viện editor

Editor được build từ bản nội bộ `../divkit/visual-editor`:

```sh
cd ../divkit/visual-editor
npm install
npm run build-lib        # sinh dist/divkit-editor.js + .css
```

`package.json` của project đã trỏ `"@divkitframework/visual-editor": "file:../divkit/visual-editor"`.

## Chạy

```sh
# 1. Backend proxy
cd server
cp .env.example .env      # điền AWS_REGION, S3_BUCKET, credentials, (CloudFront)
npm install
npm start                 # http://localhost:8787

# 2. Frontend
cd ..
cp .env.example .env      # VITE_USE_MOCK=false để dùng S3 thật
npm install
npm run dev               # http://localhost:5173
```

Hoặc chạy cả hai: `npm run dev:all` (cần backend đã `npm install`).

### Chạy thử không cần AWS

Đặt `VITE_USE_MOCK=true` trong `.env` → app dùng dữ liệu giả (`src/s3/mock.ts`), không gọi backend.

## Quyết định cấu hình quan trọng

- **`VITE_SAVE_FORMAT`** (`plain` | `wrapper`): `getValue()` của editor trả wrapper
  `{ screen_id, label, remote_layout, variables }`. Mặc định `plain` → gỡ `remote_layout`
  về DivKit thuần trước khi ghi S3 (tương thích client native cũ). **Cần xác nhận với team mobile.**
- **Xác thực S3**: backend dùng IAM role / shared config (`~/.aws`) hoặc biến môi trường.
- **Versioning**: `USE_S3_VERSIONING=true` dựa vào S3 bucket versioning; nếu `false`,
  backend backup ra `<key>.<timestamp>.bak` trước khi publish.
- **CDN**: đặt `CLOUDFRONT_DISTRIBUTION_ID` để bật invalidate khi publish.

## API backend

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/projects` | List project (common prefix) |
| GET | `/api/list?prefix=` | List file/folder trong prefix |
| GET | `/api/object?key=` | Nội dung JSON |
| GET | `/api/presign?key=` | Presigned GET cho ảnh |
| PUT | `/api/object` | Lưu draft `{key, body, status}` |
| POST | `/api/upload` | Upload asset (multipart) |
| POST | `/api/publish` | Publish + version + invalidate CDN |
