# Phân quyền theo project + Audit log

Ngày: 2026-09-02 · Trạng thái: đã duyệt, đang triển khai

## Mục tiêu

1. Quyền trên bucket `ik-nocode-paywall` phân theo **từng folder cấp 1** thay vì một quyền chung cho cả bucket.
2. Ghi lại **ai đã làm gì, sửa gì, xoá gì, ở project nào**.

Hai mục tiêu dùng chung một hạ tầng mới: một Postgres riêng của app.

---

## 1. Bối cảnh — những gì đã xác minh trên hệ thống thật

Các kết luận dưới đây lấy từ source của authz (SDK 3.5.0) và từ truy vấn read-only vào DB `sl_authz`, không phải từ tài liệu.

### 1.1 Casbin matcher quyết định toàn bộ thiết kế

```
m = (g(r.sub, p.sub, r.dom) || g(r.sub, p.sub, "*"))
    && (r.dom == p.dom || p.dom == "*")
    && (r.obj == p.obj || p.obj == "*")
    && (r.act == p.act || p.act == "*")
```

Ba hệ quả:

- **Member project** có g-rule `(userId, project:<role>, project:<slug>)`. Để `enforce` ở domain `project:<slug>` pass, phải tồn tại p-rule với `p.dom = '*'` và `p.sub = project:<role>`.
- **Role cấp system** (g-rule ở domain `*`) match **mọi** domain nhờ nhánh `g(r.sub, p.sub, "*")`. Nên role system = quyền trên tất cả project.
- Do đó **gán role project thấp hơn không hạ được quyền của người có role system**. Đã kiểm chứng: tài khoản `hungcn@ikameglobal.com` có role project `viewer` trên `revenue-cow`, nhưng `enforce(delete, dom='project:revenue-cow')` vẫn trả `true` vì có `no-code-editor:owner` ở domain `*`.

**Hệ quả vận hành:** muốn giới hạn ai đó theo project thì phải **gỡ role system của họ** bên authz. Không có cách nào làm điều đó từ phía app này.

### 1.2 Trạng thái p-rule hiện tại trên `no-code-editor:layout`

App chỉ enforce trên đúng resource này. Toàn bộ p-rule đang tồn tại:

| Role system | read | update | publish | delete |
|---|---|---|---|---|
| `no-code-editor:owner` | ✓ | ✓ | ✓ | ✓ |
| `no-code-editor:admin` | ✓ | ✗ | ✗ | ✗ |
| `no-code-editor:editor` | ✗ | ✗ | ✗ | ✗ |
| `no-code-editor:viewer` | ✓ | ✗ | ✗ | ✗ |

Role `editor` có p-rule trên 9 resource khác (`app`, `page`, `component`, `template`, `asset`, `datasource`, `deployment`, `member`, `dashboard`) nhưng không có dòng nào trên `:layout`. Vì `apiActionGuard` đòi `read` cho mọi GET, tài khoản mang role `editor` hiện **bị chặn toàn bộ `/api`**.

Không tồn tại p-rule nào cho `project:owner|admin|editor|viewer` trên `no-code-editor:layout` — chúng chỉ có trên hai resource `project` và `project-docs`.

### 1.3 Việc cần làm bên authz (ngoài phạm vi repo này) — ĐÃ XONG 2026-09-04

```
-- Sửa lỗi sẵn có
p, no-code-editor:admin,  *, no-code-editor:layout, update
p, no-code-editor:admin,  *, no-code-editor:layout, publish
p, no-code-editor:admin,  *, no-code-editor:layout, delete

-- Mới: cho role project thao tác được trên layout
p, project:owner,  *, no-code-editor:layout, read | update | publish | delete
p, project:admin,  *, no-code-editor:layout, read | update | publish | delete
p, project:editor, *, no-code-editor:layout, read | update | publish
p, project:viewer, *, no-code-editor:layout, read

-- Dọn rác: resource id=102 'no-code-editor-layout' (dấu '-', trùng với id=103 dấu ':')
```

Cố ý **không** thêm p-rule `no-code-editor:editor` trên `:layout`: role system nằm ở domain `*` nên sẽ đè lên mọi project, làm vô hiệu hoá phân quyền theo project. Hướng đúng là gỡ role system `editor` và thêm người đó vào từng project với `project:editor`.

**Trạng thái: đã áp dụng xong trên production ngày 2026-09-04.** Role system do team sửa; 12 dòng `project:*` insert trực tiếp vào `casbin_rule` (trigger `casbin_rule_notify_trg` tự làm authz reload, không cần restart).

Đã kiểm nghiêm bằng 4 tài khoản thật không có role system, mỗi role một đại diện — trong project của mình đúng quyền theo role, trong project không phải member thì trắng hoàn toàn:

| Role project | Trong project của mình | Project khác |
|---|---|---|
| `owner` / `admin` | read, update, publish, delete | không có quyền nào |
| `editor` | read, update, publish | không có quyền nào |
| `viewer` | read | không có quyền nào |

### 1.4 Folder bucket và slug authz không trùng nhau

17 folder cấp 1 trong bucket, 86 project bên authz, **0 cặp trùng tên tuyệt đối**. Quan hệ thực tế là nhiều-nhiều: một folder bucket thường tương ứng nhiều project authz (prod + debug + iOS + Android tách riêng).

```
wordoffice                        → word-office-android, word-office-ios-debug
ai-video                          → ai-video-hubx, ai-video-ios-native,
                                    ai-video-ios-native-debug, debug-ai-video-hubx
ikapp-bu2-product-bloodpressure   → blood-pressure-android, blood-pressure-ios,
                                    debug-bu2-bloodpressure-android
```

Bốn folder chưa xác định được project tương ứng — phải chỉ định tay: `ios_remote3`, `ios-heart-rate-4`, `ikapp-ios-cate-heart-health-monitor`, `ikapp-bu2-product-recipe`.

Vì vậy mapping là **dữ liệu do người vận hành nhập**, không phải quy ước suy ra từ tên.

---

## 2. Postgres

Container riêng, **nằm ngoài vòng blue-green**: lúc `deploy.sh` chuyển màu có hai container app cùng chạy vài giây, DB phải sống độc lập với cả hai.

- `deploy/docker-compose.db.yml` — dựng một lần, named volume `nocode_pgdata`, chỉ nối vào network `bmik_net`, không map port ra host.
- Server dùng `pg` trực tiếp, không ORM — giữ đúng phong cách `.mjs` hiện có.

### Schema tự sync, không có file migration

Lúc boot, `ensureSchema()` chạy các câu lệnh idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) từ định nghĩa nằm trong code, bọc trong `pg_advisory_lock` để hai container blue/green cùng khởi động không chạy chồng nhau.

**Giới hạn phải biết:** cách này thêm bảng/cột an toàn nhưng **không tự đổi tên hay xoá cột**. Thay đổi phá huỷ vẫn phải làm tay trên DB.

### Bảng

```sql
projects (
  id            serial primary key,
  bucket_prefix text not null unique,   -- 'ai-video' (không có dấu '/')
  display_name  text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
)

project_authz_links (
  project_id  integer not null references projects(id) on delete cascade,
  authz_slug  text not null,
  primary key (project_id, authz_slug)
)
-- index trên authz_slug: tra ngược từ slug của user → folder được thấy

audit_logs (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  user_id       text,
  user_email    text,
  action        text not null,        -- read|update|publish|delete|upload|login|logout|admin-update
  outcome       text not null,        -- allow|deny|error|shadow-allow
  bucket_prefix text,                 -- null khi thao tác ở gốc bucket
  object_key    text,
  method        text,
  path          text,
  status_code   integer,
  s3_version_id text,
  detail        jsonb,
  ip            text,
  user_agent    text
)
-- index: (at desc), (bucket_prefix, at desc), (user_id, at desc)
```

Mapping được cache trong bộ nhớ tiến trình, TTL 60s, và invalidate ngay khi ghi qua API admin.

---

## 3. Phân quyền

### 3.1 Suy ra project từ request

`resolveBucketPrefix(req)` lấy segment đầu của, theo thứ tự: `req.query.key` → `req.body.key` → `req.query.prefix` → `req.body.project` → `req.query.project`.

- Không suy ra được (file lẻ ở gốc bucket như `nocode.html`, hoặc `/api/translate`) → coi là **scope system**, enforce ở domain `*` như hiện tại.
- Suy ra được nhưng prefix chưa có trong bảng `projects` → không có slug nào để dò, `enforceActionAcrossProjects` chỉ còn domain `*`. Nghĩa là **thành viên project không vào được, người có role cấp system vẫn vào bình thường**. Đã kiểm trên hệ thống thật: folder `printer` chưa map, scope `on`, tài khoản role `admin` vẫn `read:true`.

### 3.2 Enforce

Thay hằng `DOMAIN = '*'` trong `server/authz.mjs` bằng:

```js
enforceActionAcrossProjects({
  session, userId, resource: RESOURCE, action,
  projectSlugs: linkedSlugs,   // các authz_slug đã map với folder
})
```

Helper OR trên các domain `project:<slug>` và tự thêm domain `*`, nên người có role system vẫn đi lọt (đúng ngữ nghĩa kế thừa của authz).

**Hệ quả quan trọng: bật `on` là thao tác CỘNG THÊM, không lấy đi quyền của ai.** Vì domain `*` vẫn nằm trong tập domain được dò, tập quyền ở chế độ `on` là tập cha của tập quyền ở `off`. Ai đang dùng được thì vẫn dùng được; cái `on` thêm vào là đường vào cho thành viên project.

Muốn thực sự **giới hạn** một người theo project thì phải gỡ role system của họ bên authz (§1.1) — không có cách nào làm từ phía app này, và cờ `AUTHZ_PROJECT_SCOPE` không làm thay được.

### 3.3 Liệt kê project

`/api/projects` không thể enforce 17+ lần mỗi lần load. Dùng 2 lời gọi authz:

1. `enforce({ resource, action: 'read', domain: '*' })` → pass thì trả toàn bộ folder.
2. Không thì `session.getProjectSlugs(userId)` rồi giao với `project_authz_links`.

Đây đúng là ngữ nghĩa của `filterAccessibleLocalProjects` trong SDK: admin bypass do caller tự xử lý, phần lọc theo slug giao cho helper.

### 3.4 Perms cho UI

- `GET /api/me` — giữ nguyên hình dạng response, `perms` là quyền **cấp system** (domain `*`).
- `GET /api/me/perms?project=<prefix>` — quyền trong đúng folder đó, tính bằng `enforceActionAcrossProjects` cho từng action trong `ACTIONS`.

Frontend: `AuthContext` giữ perms system; thêm hook `useProjectPerms(prefix)` có cache theo prefix. `Browser.tsx`, `LayoutPreview.tsx`, `Builder.tsx` đổi từ `usePerms()` sang perms của project đang mở (cả ba đã sẵn có `project = path[0]`).

---

## 4. Audit log

Middleware chạy **sau** guard, ghi ở `res.on('finish')` để có status code thật. Ghi fire-and-forget: DB lỗi thì `console.warn`, không bao giờ làm hỏng request của người dùng.

**Ghi:**
- Mọi thao tác ghi: `update`, `publish`, `delete`, `upload`.
- Mọi lần bị từ chối (403), kể cả GET — đây là tín hiệu bảo mật.
- Sự kiện auth: login, logout.

**Không ghi:** `/api/asset`, `/api/presign`. Duyệt một folder ảnh sinh vài chục dòng rác mỗi lần.

**"Sửa gì":** bucket đã bật `USE_S3_VERSIONING=true`, nên lưu `s3_version_id` mà `PutObject` trả về (kèm version trước đó trong `detail`) thay vì nhét cả body JSON vào DB. Truy được nội dung trước/sau qua S3 mà không làm phình DB. Xem diff thật giữa hai version là việc giai đoạn sau; dữ liệu đã đủ để làm.

---

## 5. Màn hình admin

| Endpoint | Gate |
|---|---|
| `GET/POST/PATCH/DELETE /api/admin/projects` | role admin/owner cấp system |
| `GET /api/admin/audit` | `no-code-editor:audit-log` action `read` |

Resource `no-code-editor:audit-log` đã tồn tại sẵn bên authz với `read` cấp cho admin + owner — dùng lại, không bịa quyền mới.

Trong SPA: một tab Admin gồm màn quản lý mapping (folder ↔ slug) và màn xem audit lọc theo project / user / action / khoảng thời gian.

---

## 6. Rollout

`AUTHZ_PROJECT_SCOPE` nhận ba giá trị:

- `off` — hành vi như hiện tại, enforce ở domain `*`. **Mặc định**, an toàn khi p-rule bên authz chưa có.
- `shadow` — vẫn quyết định theo domain `*`, nhưng tính song song kết quả project-scoped và ghi chênh lệch vào `audit_logs` với `outcome='shadow-allow'`.

  Chênh lệch chỉ có thể theo **một chiều**: vì `on` là tập cha của `off`, trường hợp "đang cho phép mà `on` sẽ chặn" là bất khả. Thứ đáng ghi là chiều ngược lại — ai **đang bị chặn** mà bật `on` sẽ vào được, tức thành viên project đang bị khoá oan. Chạy `shadow` vài ngày là biết bật `on` sẽ mở khoá cho đúng những ai.
- `on` — enforce theo project.

Bật `on` trước khi §1.3 hoàn tất thì đơn giản là **không có tác dụng gì**: chưa có p-rule nên `enforce` ở domain project luôn `false`, mọi quyết định rơi về domain `*` y như `off`. Không hỏng, chỉ vô ích.

---

## 7. Kiểm thử

Repo chạy test bằng `node --experimental-strip-types`, không có test runner. Giữ nguyên kiểu đó.

- `server/project-scope.test.mjs` — `resolveBucketPrefix` trên mọi hình dạng request (key, prefix, body.project, gốc bucket, key rỗng, path traversal `../`).
- `server/mapping.test.mjs` — giao slug người dùng với mapping, gồm ca folder map nhiều slug và folder chưa map.
- `src/lib/route.test.ts` — giữ nguyên.

Phần chạm authz và S3 không unit-test; xác minh bằng chạy thật ở chế độ `shadow`.

---

## 8. Biến môi trường mới

```env
# server/.env và deploy/.env
POSTGRES_HOST=nocode-db
POSTGRES_PORT=5432
POSTGRES_USER=nocode
POSTGRES_PASSWORD=__FILL__
POSTGRES_DATABASE=nocode_editor

# off | shadow | on
AUTHZ_PROJECT_SCOPE=off
```
