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

Cần điền: `AUTHZ_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
`NOCODE_IMAGE` để bước 3 in ra rồi dán vào.

---

## Bước 3 — Build + push (chạy ở MÁY DEV, không trên host)

Lightsail nhỏ build vite/svelte là OOM.

```bash
git add -A && git commit -m "..."     # tag = git SHA nên phải commit trước
./deploy/build-push.sh
```

Script tự: tạo repo ECR nếu chưa có → login ap-southeast-1 → `buildx --platform linux/amd64`
→ push → in ra dòng `NOCODE_IMAGE=...`. Dán dòng đó vào `.env` trên host.

Khác gì với hướng dẫn mặc định của AWS console:

| Console bảo | Ở đây | Vì sao |
|---|---|---|
| `docker build` | `docker buildx build --platform linux/amd64` | Mac ARM build ra image host không chạy được (`exec format error`) |
| — | `--secret id=npmrc,src=.npmrc` | `@ikameglobal/authz-sdk` ở registry riêng; `COPY .npmrc` là lộ token vĩnh viễn trong layer |
| — | `--build-arg VITE_*` | `VITE_*` nướng vào bundle lúc build, đặt ở env container vô tác dụng |
| tag `:latest` | tag `:<git-sha>` | `latest` không rollback được, và Lightsail cache theo tag |

---

## Bước 4 — Deploy

```bash
ssh <host> 'bash ~/project/no-code/deploy.sh'
```

Flow: login ECR → up màu idle (`--pull always`) → chờ `/healthz` healthy →
render `../sites/no-code.caddy` → `caddy reload` → ghi `active-color` → tắt màu cũ.

Health fail ⇒ tự rollback: hạ màu mới, giữ màu cũ đang serve, in healthcheck log + 50 dòng app log.

**Rollback thủ công**: sửa `NOCODE_IMAGE` trong `.env` về tag cũ → chạy lại `deploy.sh`.

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
| Nút Localize trả `[vi] text` | thiếu `MT_PROVIDER=google` → rơi về stub, **không** báo lỗi |
| Lưu layout mất `variables`/`screen_id` | build thiếu `--build-arg VITE_SAVE_FORMAT=wrapper` (mặc định code là `plain`) |
| Đổi `VITE_CDN_BASE` trong `.env` không ăn | `VITE_*` là build-time, phải build lại image |
| `docker pull` 403 khi deploy | policy ECR của creds host chưa liệt kê repo `ik-nocode-editor` (xem 0.4) |
| `/api/list` trả 500 | thiếu/sai `AWS_ACCESS_KEY_ID` — Lightsail không có IAM instance role |
| Caddy reload fail, config giữ nguyên cũ | fragment sai cú pháp; `docker exec bmik-proxy caddy validate ...` để xem lỗi |

Đổi tên miền ⇒ phải sửa **3 chỗ**: `Caddyfile.tmpl`, và `APP_BASE_URL` + `AUTHZ_REDIRECT_URI` trong `.env`.
Sót một chỗ là auth gãy.
