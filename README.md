# NoCode Preview — S3 DivKit Layout Manager

Web quản lý remote layout: duyệt bucket S3 → preview/sửa layout bằng **DivKit Visual Editor thật** (`DivProEditor`) → push ngược lên S3 (kèm version + invalidate CDN). Không cần release lại app.

## Kiến trúc

```
nocode-preview/
  src/
    App.tsx              gate đăng nhập → Browser → Preview → Builder + modals
    auth/                AuthContext (danh tính + quyền), LoginScreen, UserMenu, session
    s3/                  adapter S3 (api gọi backend | mock) + selector
    editor/              DivEditor.tsx (wrap DivProEditor), config, wrapper, resolveAssets
    components/          Sidebar, Browser, LayoutPreview, Builder, modals/
    lib/                 icons, format
    styles/app.css
  server/                gateway: giữ AWS credentials + authz API key
    env.mjs              nạp server/.env bất kể cwd
    authz.mjs            AuthzClient + SessionManager + cookie + middleware quyền
    auth-routes.mjs      /auth/login, /auth/callback, /auth/logout, /api/me
    index.mjs            S3 proxy + guard /api/* + serve frontend
```

- **Shell**: React 18 + Vite + TS — giữ nguyên UI/logic prototype cũ.
- **Editor**: `@divkitframework/visual-editor` (Svelte, build sẵn) nhúng vào 1 DOM node.
  - Preview = layout `['preview']` + `readOnly`.
  - Builder = layout đầy đủ (tree + preview + props/code), palette, undo/redo.
- **S3**: frontend → backend proxy (`/api/*`) → AWS S3. Credentials chỉ nằm ở backend.
- **Auth**: [`sl-authenz`](https://authz.begamob.com) là Authorization Server duy nhất.
  App là Resource Server: không tự chạy Google OAuth, không verify JWT bằng shared
  secret, không lưu role. Một origin duy nhất (`:8080`) serve cả frontend, `/api` và `/auth`.

## Chuẩn bị thư viện editor

Editor là bản **vendor nằm trong repo** (`visual-editor/`) — không còn ở `../divkit/visual-editor`
như trước. `package.json` trỏ `"@divkitframework/visual-editor": "file:./visual-editor"`.

```sh
cd visual-editor
npm install
npm run build-lib        # sinh dist/divkit-editor.js + .css
```

`dist/` đã gitignore → máy mới BẮT BUỘC build lại, không có thì Vite không resolve được package.

### ⚠ build-lib cần bộ schema DivKit — thiếu là màn trắng

`src/lib/data/schema.ts` nạp schema bằng `import.meta.glob('../../../../schema//*.json')`, tính từ
`visual-editor/src/lib/data/` là **`<repo-root>/schema/`**. Trong monorepo divkit gốc, package nằm ở
`divkit/visual-editor` nên path đó là `divkit/schema/` — ngang cấp, KHÔNG nằm trong package. Vendor
package vào đây mà không mang theo `schema/` thì glob match 0 file, build vẫn **thành công**, nhưng
registry schema rỗng → `lib.js` throw ngay lúc load module:

```
TypeError: Cannot read properties of undefined (reading 'default')   // qc['div'].default
```

React không có error boundary nên cả cây unmount → **trắng tinh** ở cả Builder (New layout) và
Preview. Lấy schema đúng version (`devDependencies["@divkitframework/divkit"]`, hiện `32.40.0`):

```sh
git clone --filter=blob:none --no-checkout --depth 1 --branch 32.40.0 \
    https://github.com/divkit/divkit /tmp/divkit
cd /tmp/divkit && git sparse-checkout set --no-cone schema && git checkout
cp -R /tmp/divkit/schema <repo-root>/schema     # 187 file JSON, ~1 MB
```

Kiểm tra nhanh sau khi build: `grep -c 'div-container.json' visual-editor/dist/lib.js` — ra `0` là
schema rỗng (build lỗi im lặng), ra `>0` là ổn. Docker đã có sẵn check này trong stage `editor`.

## Chạy

Registry `@ikameglobal` là GitLab private → cần `.npmrc` (đã gitignore) trước khi cài:

```
@ikameglobal:registry=https://repository.ikameglobal.com/api/v4/projects/3/packages/npm/
//repository.ikameglobal.com/api/v4/projects/3/packages/npm/:_authToken=<PULL_TOKEN>
```

Đặt file này ở **cả** repo root và `server/` — npm không đi ngược lên cây để tìm
project `.npmrc`, nên `npm i` trong `server/` chỉ đọc `server/.npmrc`.

```sh
# 1. Backend + authz
cp .env.example server/.env   # điền AUTHZ_SYSTEM_CODE, AUTHZ_API_KEY, AUTHZ_REDIRECT_URI
cd server && npm install && cd ..

# 2. Frontend
cp .env.example .env          # giữ các dòng VITE_*
npm install

# 3. Chạy cả hai
npm run dev:all
```

Rồi mở **http://localhost:8080** — KHÔNG phải `:5173`. Vite dev server vẫn chạy ở
5173 nhưng không còn là cửa vào: gateway Express ở 8080 serve `/api` + `/auth` và
proxy phần còn lại (kèm HMR websocket) xuống Vite. Mở thẳng 5173 sẽ hỏng `/api`
và HMR — cố ý, để không ai chạy sai origin mà không nhận ra, vì redirect URI của
authz khớp tuyệt đối đúng một origin.

Prod: `npm run build` rồi chạy `server/` với `NODE_ENV=production` — cùng process
serve `dist/` luôn, không cần web server riêng.

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

## Đăng nhập & phân quyền

Chi tiết mô hình: `authz/docs/guides/integrate-login-and-authz.md`. Phần dưới là
những gì riêng repo này đã chốt.

### Ba loại credential — đừng lẫn

| Credential | Ai giữ | Dùng để |
|---|---|---|
| Access token (user) | Cookie httpOnly `auth_token` | Định danh user |
| API key `ikame-authz-…` | **Chỉ `server/.env`** | Exchange code, enforce, đọc role |
| Admin token | User có quyền trên system `authz` | API quản trị (`listRoles`, `listPolicies`, …) |

Frontend **không bao giờ** thấy API key. Nó chỉ gọi `GET /api/me`; backend mới hỏi authz.

### Resource & action

Resource: `slaio:layout`. Bốn action, map thẳng sang nút trên UI:

| Role | read | update | publish | delete |
|---|:-:|:-:|:-:|:-:|
| viewer | ✓ | | | |
| editor | ✓ | ✓ | | |
| admin | ✓ | ✓ | ✓ | ✓ |
| owner | ✓ | ✓ | ✓ | ✓ |

- `read` — browse bucket, mở layout, xem asset, download, dịch
- `update` — Save draft, New layout, upload asset
- `publish` — Push to S3 (đi live tới user thật, nên tách khỏi `update`)
- `delete` — xoá file khỏi S3

Không có `create`: backend không phân biệt được `PUT /api/object` tạo mới vs ghi
đè nếu không thêm một `HeadObject` cho mọi lần save, và không role nào cần
create-mà-không-update.

Enforce ở domain `*` (system-wide). Bucket có sẵn project (`ai-note`, `printer`, …)
trông đúng như authz project — muốn phân quyền theo từng project thì đổi `DOMAIN`
trong `server/authz.mjs` sang `projectDomain(slug)`, nhưng cần xác nhận slug S3
khớp slug authz trước.

### Enforce ở đâu

Quyền chặn ở **backend**, UI chỉ ẩn nút cho gọn — không phải cơ chế bảo vệ:

```
app.use(authRouter)                          // /auth/*, /api/me
app.use('/api', authenticate, apiActionGuard) // mọi /api/* còn lại
```

`apiActionGuard` map method+path → action. GET/HEAD mặc định `read`; mọi method
ghi **phải** có trong bảng `API_WRITE_ACTIONS`, thiếu thì trả 403 — thêm endpoint
mới mà quên khai báo sẽ fail closed chứ không lặng lẽ mở quyền.

`authenticate` cũng chặn tài khoản `isActive === false` / `isApproved === false`
(403) dù token vẫn còn hợp lệ.

### Nghiệm thu

| Test | Mong đợi |
|---|:-:|
| Không token | `401` |
| Token hợp lệ, thiếu quyền | `403` |
| Token hợp lệ + đủ quyền | `200` |

Chẩn đoán khi lệch:

- Body lỗi có chứa `authz.begamob.com` → thiếu error mapping. `sendAuthzError`
  trong `authz.mjs` đã dùng `mapAuthzErrorToHttp`, đừng bỏ qua nó.
- **Mọi người** đều 403, kể cả owner → role/policy chưa seed. Ca phổ biến nhất.
  Owner global vẫn vào được vì authz cho owner `true` trên mọi system, nên "owner
  vào được" KHÔNG chứng minh policy đã seed.
- User vừa login bị 403, F5 thì hết → casbin sync race. `/auth/callback` đã gọi
  `fetchRoleSignals` (retry [150,400]ms) để làm nóng cache; đừng bỏ.

### Ba chỗ SDK lệch với doc — đã xử lý, đừng "sửa lại"

1. `asCookieWriter(res)` **không** dùng được với Express: SDK gọi
   `writer.set(name, value, opts)` còn Express `res.set` là set *header*, và
   `res.delete` không tồn tại. Dùng `cookieWriter(res)` trong `authz.mjs`.
2. SDK trả `maxAge` theo **giây**, `res.cookie` nhận **milli**. Truyền thẳng thì
   cookie 30 ngày co lại còn ~43 phút. `cookieWriter` đã nhân 1000.
3. `getUserSystemRoles(userId)` nhận **string vị trí**, không phải
   `{ userId, systemCode }` như bảng HTTP trong guide.

Ngoài ra `AuthzConfig` không có field `baseUrl` — SDK hardcode
`https://authz.begamob.com`, nên không có authz local/staging để test.

## API backend

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/projects` | List project (common prefix) |
| GET | `/api/list?prefix=` | List file/folder trong prefix |
| GET | `/api/object?key=` | Nội dung JSON |
| GET | `/api/presign?key=` | Presigned GET cho ảnh |
| PUT | `/api/object` | Lưu draft `{key, body, status}` |
| DELETE | `/api/object?key=` | Xoá 1 object |
| POST | `/api/upload` | Upload asset (multipart) |
| POST | `/api/publish` | Publish + version + invalidate CDN |
| POST | `/api/translate` | Dịch 1 chuỗi sang nhiều locale |

### Auth

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/auth/login?next=` | 302 sang authz (nhớ `next` trong cookie ngắn hạn) |
| GET | `/auth/callback?code=` | Đổi code lấy token (API key), set cookie httpOnly, 302 về `next` |
| POST | `/auth/logout` | Revoke phía authz (best-effort) + clear cookie |
| GET | `/api/me` | `{ user, roles, resource, perms }` — nguồn duy nhất frontend biết quyền |
