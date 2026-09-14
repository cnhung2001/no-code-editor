# Deploy NoCode Editor lên Lightsail

Một image duy nhất: Express serve SPA (`dist/`) + `/api` + `/auth` cùng một origin.
Không tách frontend — `AUTHZ_REDIRECT_URI` khớp tuyệt đối một origin và cookie phiên
là httpOnly same-site.

Dùng chung host, network `bmik_net` và container `bmik-proxy` với bmik-api;
có `active-color` và fragment Caddy riêng nên hai app deploy độc lập nhau.

```
Browser ──HTTPS──> Cloudflare (Flexible) ──HTTP:80──> Caddy (bmik-proxy)
                                                        ├─ tools.ikame-solution.com  → bmik-api-<color>:80
                                                        └─ nocode.ikame-solution.com → nocode-app-<color>:8080
```

Tất cả ở `ap-southeast-1`: ECR (`ik-nocode-editor`), S3 (`ik-nocode-paywall`), CloudFront, host Lightsail.
Scripts vẫn tách `ECR_REGION` khỏi `AWS_REGION` để sau này đổi một bên không đụng bên kia.

---

## Bước 0 — Chuẩn bị (làm song song, đều mất thời gian chờ)

**0.1 Xin DNS.** Nhắn người quản Cloudflare:

> Em cần thêm DNS record cho tool NoCode Editor:
> - Zone `ikame-solution.com`, record `A`: `nocode` → `<STATIC_IP_LIGHTSAIL>`
> - Proxy status: **Proxied** (đám mây cam), giống `tools.ikame-solution.com`
>
> Zone đang SSL mode Flexible nên origin nhận HTTP:80, em không cần cert ở server.

⚠ Để **DNS only** (xám) là hỏng: không có HTTPS → cookie `secure` bị trình duyệt vứt
→ login xoay vòng vô tận, log không báo gì.

**0.2 Xin authz đăng ký redirect URI.** Nhắn team authz:

> Em cần đăng ký thêm redirect URI cho system `slaio` (NoCode Editor):
> - `https://nocode.ikame-solution.com/auth/callback`
>
> Giữ nguyên entry `http://localhost:8080/auth/callback` để em dev.
> URI phải khớp từng byte, không có `/` ở cuối.

**0.3 Static IP.** Lightsail console → Networking → gán static IP nếu chưa có.
IP động đổi sau mỗi restart, làm chết cả DNS lẫn redirect URI.

**0.4 Kiểm quyền ECR.** Creds trên host đã pull được `bmik_tool` nên gần như chắc chắn
pull được repo mới cùng region, nhưng policy có thể liệt kê repo theo tên. Kiểm trên host
sau khi bước 3 đã push:

```bash
aws ecr describe-images --repository-name ik-nocode-editor --region ap-southeast-1
```

403 ⇒ xin thêm `ik-nocode-editor` vào policy ECR của creds đó, nếu không `deploy.sh` pull fail.

---

## Bước 1 — Sửa 2 file của bmik trên host (làm 1 lần)

Mục tiêu: cho Caddy nạp thêm các fragment trong `~/project/sites/`, để mỗi app tự quản
site block của mình. `bmik-api` không đổi hành vi gì.

⚠ Bước 1.5 **recreate container proxy** → `tools.ikame-solution.com` gián đoạn vài giây.
Làm ngoài giờ cao điểm.

### 1.1 Backup + tạo thư mục sites

```bash
ssh <host>
cd ~/project
cp Caddyfile.tmpl Caddyfile.tmpl.bak
cp docker-compose.proxy.yml docker-compose.proxy.yml.bak
mkdir -p sites
```

⚠ `mkdir` PHẢI chạy trước, với user `ec2-user`. Nếu để Docker tự tạo lúc mount, thư mục
sẽ thuộc `root` → `deploy.sh` chạy bằng `ec2-user` không ghi được `sites/no-code.caddy`.

Kiểm: `ls -ld sites` phải thấy owner `ec2-user`.

### 1.2 Thêm `import` vào `Caddyfile.tmpl`

Dòng `import` phải ở **top-level** — ngoài mọi `{ }` block. Đặt ngay trước site block đầu tiên:

```
# ...phần comment sẵn có...

import /etc/caddy/sites/*.caddy          ← THÊM DÒNG NÀY

http://tools.ikame-solution.com, http://solution-tools.begamob.com {
        encode zstd gzip
        ...
```

Lệnh idempotent (chạy lại nhiều lần không nhân đôi):

```bash
grep -q '^import /etc/caddy/sites/' Caddyfile.tmpl \
  || sed -i '0,/^http:\/\//s|^http://|import /etc/caddy/sites/*.caddy\n\nhttp://|' Caddyfile.tmpl

head -20 Caddyfile.tmpl        # mắt thường xác nhận vị trí
```

### 1.3 Thêm mount vào `docker-compose.proxy.yml`

```yaml
  proxy:
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./sites:/etc/caddy/sites:ro        ← THÊM DÒNG NÀY
      - caddy_data:/data
      - caddy_config:/config
```

```bash
grep -q './sites:/etc/caddy/sites' docker-compose.proxy.yml \
  || sed -i 's|^      - ./Caddyfile:/etc/caddy/Caddyfile:ro$|      - ./Caddyfile:/etc/caddy/Caddyfile:ro\n      - ./sites:/etc/caddy/sites:ro|' docker-compose.proxy.yml

docker compose -p bmik-proxy -f docker-compose.proxy.yml config | grep -A6 'volumes:'
```

### 1.4 Validate TRƯỚC khi đụng vào proxy đang chạy

Render ra file tạm rồi validate bằng container Caddy riêng — proxy thật vẫn chạy nguyên:

```bash
sed "s/__COLOR__/$(cat active-color)/g" Caddyfile.tmpl > /tmp/Caddyfile.new
docker run --rm \
  -v /tmp/Caddyfile.new:/etc/caddy/Caddyfile:ro \
  -v ~/project/sites:/etc/caddy/sites:ro \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Phải thấy `Valid configuration`. Thư mục `sites/` rỗng không gây lỗi (đã kiểm).
Nếu lỗi → sửa `Caddyfile.tmpl`, làm lại 1.4. **Chưa được đi tiếp.**

### 1.5 Áp dụng

```bash
cp /tmp/Caddyfile.new Caddyfile
docker compose -p bmik-proxy -f docker-compose.proxy.yml up -d
```

Compose chỉ recreate `proxy` (volumes đổi); `redis` giữ nguyên, không mất dữ liệu.

### 1.6 Verify bmik-api không hề hấn

```bash
docker inspect bmik-proxy --format '{{range .Mounts}}{{.Source}} → {{.Destination}}{{"\n"}}{{end}}'
docker exec bmik-proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
curl -sI -H 'Host: tools.ikame-solution.com' http://127.0.0.1/ | head -1
curl -sI https://tools.ikame-solution.com/ | head -1
```

Mount phải có dòng `~/project/sites → /etc/caddy/sites`. Hai lệnh `curl` phải trả
`HTTP/1.1 200` (hoặc `302` về login, tùy app) — **không** phải `502`.

### Rollback nếu hỏng

```bash
cd ~/project
cp Caddyfile.tmpl.bak Caddyfile.tmpl
cp docker-compose.proxy.yml.bak docker-compose.proxy.yml
sed "s/__COLOR__/$(cat active-color)/g" Caddyfile.tmpl > Caddyfile
docker compose -p bmik-proxy -f docker-compose.proxy.yml up -d --force-recreate
```

---

## Bước 2 — Đưa bộ deploy lên host

```bash
scp -r deploy/ <host>:~/project/no-code/
ssh <host> 'cd ~/project/no-code && cp .env.example .env && chmod 600 .env'
ssh <host> 'nano ~/project/no-code/.env'    # điền hết __FILL__
```

Cần điền: `AUTHZ_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `POSTGRES_PASSWORD`.
`NOCODE_IMAGE` để nguyên `…/ik-nocode-editor:prod` — tag di động, đặt một lần rồi
không đụng lại ở các lần deploy sau (xem bước 3).

---

## Bước 3 — Build + push (chạy ở MÁY DEV, không trên host)

Lightsail nhỏ build vite/svelte là OOM.

```bash
git add -A && git commit -m "..."     # tag = git SHA nên phải commit trước
./deploy/build-push.sh
```

Script tự: tạo repo ECR nếu chưa có → login ap-southeast-1 → `buildx --platform linux/amd64`
→ push **hai tag cùng một image**: `:<git-sha>` (bất biến) và `:prod` (di động).

Host pin `:prod` nên **không phải sửa `.env` mỗi lần deploy** — `deploy.sh` chạy
`up -d --pull always` nên luôn kéo đúng bản `:prod` vừa push. Tag SHA vẫn phải có:
`:prod` luôn trỏ bản mới nhất, không có "bản trước" để quay về, nên rollback chỉ
làm được qua tag SHA.

Có thêm môi trường thì đặt tag riêng: `MOVING_TAG=staging ./deploy/build-push.sh`. Tắt hẳn (chỉ push SHA,
quay lại lối cũ phải sửa `.env`): `MOVING_TAG= ./deploy/build-push.sh`.

⚠ Đánh đổi của tag di động: nhìn `.env` không còn biết code nào đang chạy. Bù lại,
image được gắn label `org.opencontainers.image.revision=<sha>` và `deploy.sh` in
`git rev` + `digest` ngay trước bước health-check — đó là chỗ tra khi cần biết
production đang ở commit nào. Trên host cũng xem được:

```bash
docker inspect nocode-app-$(cat ~/project/no-code/active-color) \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

⚠ Repo ECR phải để `imageTagMutability=MUTABLE` (hiện đang đúng), không thì push đè
`:prod` sẽ bị từ chối.

Khác gì với hướng dẫn mặc định của AWS console:

| Console bảo | Ở đây | Vì sao |
|---|---|---|
| `docker build` | `docker buildx build --platform linux/amd64` | Mac ARM build ra image host không chạy được (`exec format error`) |
| — | `--secret id=npmrc,src=.npmrc` | `@ikameglobal/authz-sdk` ở registry riêng; `COPY .npmrc` là lộ token vĩnh viễn trong layer |
| — | `--build-arg VITE_*` | `VITE_*` nướng vào bundle lúc build, đặt ở env container vô tác dụng |
| tag `:latest` | tag `:<git-sha>` **+** `:prod` | SHA để rollback; `:prod` để host khỏi sửa `.env` mỗi lần. `--pull always` nên không dính cache tag |

---

## Postgres — `deploy.sh` tự lo

**Không có bước tay nào.** `deploy.sh` chạy `docker compose -p nocode-db -f docker-compose.db.yml
up -d` ở **mỗi** lần deploy (bước `[0/5]`), chờ container healthy rồi mới đụng tới app.
`up -d` là idempotent: DB đang chạy thì lệnh không làm gì.

Cố ý làm ở mỗi lần deploy chứ không phải một bước tay làm-một-lần: quên bước tay đó thì app
tự hạ về `db=off`, phân quyền theo project ngừng hoạt động **mà không báo gì** — đúng kiểu
lỗi im lặng khó truy nhất.

Điều kiện kích hoạt: `.env` có dòng `POSTGRES_HOST=`. Không có thì `deploy.sh` bỏ qua DB và
app chạy như cũ (không phân quyền project, không audit).

Có một chốt chặn: `.env` khai `AUTHZ_PROJECT_SCOPE=shadow|on` nhưng **thiếu** `POSTGRES_HOST`
thì `deploy.sh` **dừng ngay**, không deploy — vì tổ hợp đó là bật phân quyền rồi để nó âm
thầm không chạy. Postgres không healthy trong 60s cũng dừng, app màu cũ giữ nguyên.

### Vì sao là compose project riêng (`-p nocode-db`)

DB nằm ngoài vòng blue-green: `deploy.sh` hạ container app màu cũ sau mỗi lần deploy, và lúc
chuyển màu có hai app cùng chạy — DB phải sống độc lập với cả hai.

Không gộp vào `docker-compose.proxy.yml` của bmik (nơi `redis` đang ở) dù file đó cũng là
"shared stateful stack": ai đó chạy `docker compose -p bmik-proxy ... down` để bảo trì proxy
sẽ kéo theo DB của NoCode. Khác với `redis` — thứ nhiều app dùng chung thật — Postgres này là
kho dữ liệu riêng của một app. Project riêng giữ đúng tinh thần "hai app deploy độc lập nhau".

### Thao tác tay khi cần

```bash
docker exec -it nocode-db psql -U nocode nocode_editor    # vào psql
docker compose -p nocode-db -f docker-compose.db.yml logs -f
docker compose -p nocode-db -f docker-compose.db.yml down  # KHÔNG kèm -v
```

Không map port ra host — chỉ container trên `bmik_net` nói chuyện được.

**Schema tự sync lúc app boot** — không có file migration. App chạy `CREATE TABLE IF NOT
EXISTS` trong `pg_advisory_lock` mỗi lần khởi động. Thêm bảng/cột thì tự động; **đổi tên
hoặc xoá cột vẫn phải làm tay** trên DB.

⚠ Volume `nocode_pgdata` giữ toàn bộ audit log và **không có backup tự động**. `down` không
xoá nó, `down -v` thì có — đừng bao giờ dùng cờ `-v` ở đây.

Kiểm nhanh app đã thấy DB chưa: dòng log khởi động có `db=on|off` và `projectScope=...`.

---

## Bước 4 — Deploy

```bash
ssh <host> 'bash ~/project/no-code/deploy.sh'
```

Flow: dựng/kiểm Postgres → login ECR → up màu idle (`--pull always`) → chờ `/healthz`
healthy → render `../sites/no-code.caddy` → `caddy reload` → ghi `active-color` → tắt màu cũ.

Health fail ⇒ tự rollback: hạ màu mới, giữ màu cũ đang serve, in healthcheck log + 50 dòng app log.
Postgres không lên được cũng dừng ngay ở bước `[0/5]`, chưa đụng gì tới app đang chạy.

**Rollback thủ công**: sửa `NOCODE_IMAGE` trong `.env` từ `:prod` sang tag SHA cũ
(`aws ecr describe-images --repository-name ik-nocode-editor --region ap-southeast-1`
để liệt kê) → chạy lại `deploy.sh`. Nhớ trả về `:prod` sau khi đã fix xong, không thì
lần deploy sau vẫn dựng lại bản cũ đó.

---

## Bước 5 — Verify

```bash
# trên host — app tự nó sống chưa
docker ps --filter name=nocode-app
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: nocode.ikame-solution.com' http://127.0.0.1/healthz   # 200
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: nocode.ikame-solution.com' http://127.0.0.1/api/me     # 401

# từ máy bạn — qua Cloudflare
curl -sI https://nocode.ikame-solution.com/healthz | head -1        # 200
curl -sI https://nocode.ikame-solution.com/ | grep -i '^cf-'        # có header cf- ⇒ đang Proxied

# bmik-api KHÔNG bị ảnh hưởng
curl -sI https://tools.ikame-solution.com/ | head -1
```

Rồi mở `https://nocode.ikame-solution.com` trên trình duyệt, đăng nhập, kiểm:
list layout hiện ra (S3 key đúng), sửa + lưu được (quyền authz đúng),
nút Localize trả tiếng thật chứ không phải `[vi] text` (MT đúng).

---

## Bẫy đã biết

| Triệu chứng | Nguyên nhân |
|---|---|
| Login xoay vòng vô tận, log sạch trơn | DNS record để **DNS only** (xám) → không HTTPS → cookie `secure` bị vứt |
| `exec format error` khi start container | build quên `--platform linux/amd64` |
| Nút Localize trả 503 | thiếu `GEMINI_API_KEY` (log boot có dòng `[mt]`) |
| Nút Localize trả `[vi] text` | đang để `MT_PROVIDER=stub` |
| Nhãn một từ dịch sai nghĩa (`Play` → `Phát`) | thiếu `MT_CONTEXT` → model không biết đây là app game |
| Lưu layout mất `variables`/`screen_id` | build thiếu `--build-arg VITE_SAVE_FORMAT=wrapper` (mặc định code là `plain`) |
| Đổi `VITE_CDN_BASE` trong `.env` không ăn | `VITE_*` là build-time, phải build lại image |
| `docker pull` 403 khi deploy | policy ECR của creds host chưa liệt kê repo `ik-nocode-editor` (xem 0.4) |
| Deploy xong vẫn ra code cũ | `.env` còn pin tag SHA từ lần rollback trước, chưa trả về `:prod` |
| Push `:prod` bị `tag invalid: immutable` | repo ECR bị đổi sang `IMMUTABLE` |
| `/api/list` trả 500 | thiếu/sai `AWS_ACCESS_KEY_ID` — Lightsail không có IAM instance role |
| Caddy reload fail, config giữ nguyên cũ | fragment sai cú pháp; `docker exec bmik-proxy caddy validate ...` để xem lỗi |

Đổi tên miền ⇒ phải sửa **3 chỗ**: `Caddyfile.tmpl`, và `APP_BASE_URL` + `AUTHZ_REDIRECT_URI` trong `.env`.
Sót một chỗ là auth gãy.

---

## Phân quyền theo project

`AUTHZ_PROJECT_SCOPE` trong `./.env` nhận ba giá trị:

| Giá trị | Hành vi |
|---|---|
| `off` | Quyết định ở Casbin domain `*` — hành vi cũ. **Mặc định.** |
| `shadow` | Vẫn quyết định như `off`, nhưng ghi vào `audit_logs` (`outcome='shadow-allow'`) những request **đang bị chặn** mà bật `on` sẽ cho qua. |
| `on` | Quyết định theo domain `project:<slug>`. |

### Bật `on` không lấy đi quyền của ai

`enforceActionAcrossProjects` dò các domain `project:<slug>` **và** domain `*`, nên tập quyền
ở `on` là tập cha của tập quyền ở `off`. Đã kiểm trên hệ thống thật: folder `printer` chưa map,
scope `on`, tài khoản role `admin` vẫn `read:true`. Cái `on` thêm vào là **đường vào cho thành
viên project**; nó không thu hẹp quyền của ai.

Muốn thực sự giới hạn một người theo project thì phải **gỡ role system của họ** bên authz —
cờ này không làm thay được.

### Điều kiện trước khi bật `on` cho có ích

**1. authz phải có p-rule cho role project trên `no-code-editor:layout`.** Kiểm:

```sql
select v0 as sub, v3 as act from casbin_rule
 where ptype='p' and v2='no-code-editor:layout' and v0 like 'project:%';
```

Rỗng ⇒ bật `on` **không có tác dụng gì**: `enforce` ở domain project luôn `false`, mọi quyết
định rơi về domain `*` y như `off`. Không hỏng, chỉ vô ích. Cần authz thêm:

```
p, project:owner,  *, no-code-editor:layout, read | update | publish | delete
p, project:admin,  *, no-code-editor:layout, read | update | publish | delete
p, project:editor, *, no-code-editor:layout, read | update | publish
p, project:viewer, *, no-code-editor:layout, read
```

**2. Mọi folder trong bucket đã được map** ở màn Admin → tab "Phân quyền project".
Folder chưa map thì thành viên project không có đường vào; người có role cấp system vẫn vào
bình thường.

### Vì sao role cấp system đè lên role project

Matcher của authz có nhánh `g(r.sub, p.sub, "*")`, nên role gán ở domain `*` khớp **mọi**
domain project. Hệ quả: gán cho ai đó `project:viewer` trên một project **không** hạ được
quyền của họ nếu họ đang giữ `no-code-editor:editor` ở domain `*`. Muốn giới hạn theo
project thì phải **gỡ role system của họ** bên authz — không làm được từ phía app này.

### Quy trình bật an toàn

1. Nhờ authz thêm p-rule (mục 1 ở trên) và map hết folder (mục 2).
2. Đặt `AUTHZ_PROJECT_SCOPE=shadow`, deploy, chạy vài ngày.
3. Xem Admin → Audit log, tìm dòng `shadow-allow` — đó là những thành viên project đang bị
   chặn oan mà bật `on` sẽ mở khoá. Không có dòng nào ⇒ hoặc p-rule chưa có, hoặc mapping
   còn thiếu, hoặc thật sự chưa ai cần.
4. Đổi sang `on`, deploy lại.
