// ── NoCode Preview — backend proxy cho S3 (giữ AWS credentials) ───────────
// Frontend gọi /api/* qua đây; credentials không bao giờ lộ ra browser.

import './env.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { createProxyMiddleware } from 'http-proxy-middleware';
import {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
    PutObjectCommand,
    HeadObjectCommand,
    CopyObjectCommand,
    DeleteObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
    CloudFrontClient,
    CreateInvalidationCommand
} from '@aws-sdk/client-cloudfront';
import { authRouter } from './auth-routes.mjs';
import {
    PROJECT_SCOPE,
    RESOURCE,
    SYSTEM_DOMAIN,
    authenticate,
    requireAction,
    requireAuditRead,
    requireSystemAdmin,
    session
} from './authz.mjs';
import { DB_ENABLED, ensureSchema } from './db.mjs';
import { auditMiddleware, search as searchAudit } from './audit.mjs';
import { accessiblePrefixes } from './project-scope.mjs';
import { DRAFT_SEGMENT, draftKey, draftPrefix } from './draft-key.mjs';
import { isGeminiConfigured, translateGemini } from './mt-gemini.mjs';
import {
    createProject,
    deleteProject,
    listMappings,
    updateProject
} from './projects-repo.mjs';

const {
    PORT = 8080,
    AWS_REGION = 'ap-southeast-1',
    S3_BUCKET = 'ik-nocode-paywall',
    PRESIGN_TTL = '900',
    CLOUDFRONT_DISTRIBUTION_ID = '',
    // Endpoint purge cache do team hạ tầng dựng (xoá cả CloudFront lẫn Cloudflare).
    // Nó xoá theo DIỆN RỘNG, không nhận key — nên chỉ gọi khi thật sự ghi đè một
    // layout đã có, xem §publish. Để trống = tắt.
    CDN_PURGE_URL = 'https://ocj5tukx8f.execute-api.ap-southeast-1.amazonaws.com/v1/delete-cache-cloudfront-cloudflare',
    CDN_PURGE_TIMEOUT_MS = '15000',
    USE_S3_VERSIONING = 'true',
    // Sau khi gộp về một origin (§A), browser không còn gọi cross-origin nên
    // CORS mặc định TẮT. Chỉ bật khi thực sự cần client khác origin gọi vào —
    // để mặc định mở kèm cookie credentials là tự tạo lỗ.
    CORS_ORIGIN = '',
    NODE_ENV = 'development',
    // Vite dev server mà gateway proxy tới khi chạy local.
    VITE_DEV_URL = 'http://localhost:5173',
    // ── Machine translation (i18n auto-translate) ──
    // Chỉ còn MỘT engine thật: Gemini qua gateway core-ai, đúng cách cms-admin
    // dịch (§mt-gemini.mjs). 'google' và 'rc-admin' đã comment lại bên dưới.
    // Giá trị duy nhất còn tác dụng là 'stub' — trả "[locale] text" để chạy UI
    // khi chưa có key. Để trống → gemini nếu có GEMINI_API_KEY, không thì route
    // /api/translate trả 503 chứ KHÔNG lặng lẽ rơi về stub.
    MT_PROVIDER = ''
    // RC_ADMIN_BASE_URL, RC_ADMIN_TOKEN, RC_ADMIN_PROJECT_ID: theo provider
    // rc-admin đã tắt.
} = process.env;

const s3 = new S3Client({ region: AWS_REGION });
const cf = CLOUDFRONT_DISTRIBUTION_ID ? new CloudFrontClient({ region: AWS_REGION }) : null;

/**
 * Gọi endpoint purge cache CDN. Trả true/false chứ KHÔNG ném: file đã nằm trên
 * S3 rồi, để purge hỏng đánh đổ cả publish thì người dùng push lại lần nữa chỉ
 * đẻ thêm một version rác mà cache vẫn bẩn. Trả về để client còn hiện cảnh báo.
 */
async function purgeCdnCache() {
    try {
        const r = await fetch(CDN_PURGE_URL, {
            signal: AbortSignal.timeout(Number(CDN_PURGE_TIMEOUT_MS) || 15000)
        });
        if (!r.ok) {
            throw new Error(`${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
        }
        return true;
    } catch (e) {
        console.error('[cdn-purge]', String(e.message || e));
        return false;
    }
}

// ── Draft: bản nháp nằm ở prefix RIÊNG, không đè key mà app đang đọc ───────
// Cách đặt key và lý do xem server/draft-key.mjs.

/** Xoá bản nháp sau khi publish/xoá file thật. Hỏng thì kệ — không đáng đánh đổ request. */
async function dropDraft(key) {
    const dk = draftKey(key);
    if (!dk || dk === key) return;
    try {
        await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: dk }));
        forgetJsonKind(dk);
    } catch { /* chưa có nháp, hoặc xoá hỏng — không chặn luồng chính */ }
}

const app = express();
if (CORS_ORIGIN) {
    app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
}
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// Health check — Lightsail/ALB gọi endpoint này, phải 200 khi CHƯA đăng nhập.
// Đặt trước authRouter và trước SPA fallback ở cuối file.
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// ── Auth ───────────────────────────────────────────────────────────────────
// Mount TRƯỚC các guard bên dưới: /auth/* phải vào được khi chưa đăng nhập,
// và /api/me tự authenticate để trả 401 đúng chỗ.
app.use(authRouter);

// Bảng method+path → action. GET/HEAD mặc định 'read'; mọi method ghi PHẢI có
// mặt ở đây, không thì bị chặn — thêm endpoint mới mà quên khai báo thì fail
// closed (403) chứ không lặng lẽ mở quyền.
const API_WRITE_ACTIONS = [
    ['PUT', /^\/object$/, 'update'],
    ['DELETE', /^\/object$/, 'delete'],
    ['POST', /^\/upload$/, 'update'],
    ['POST', /^\/publish$/, 'publish'],
    ['POST', /^\/translate$/, 'read'] // dịch không đổi gì trên S3
];

/**
 * Route "điều hướng": liệt kê gốc bucket. Không thuộc project nào, nhưng chặn
 * bằng quyền system thì user chỉ có quyền theo project sẽ không đi đâu được.
 * Chỉ cần đăng nhập; chính route tự lọc nội dung theo quyền (xem filterVisible).
 */
function isRootListing(req) {
    if (req.method !== 'GET') return false;
    return req.path === '/projects' || (req.path === '/list' && !req.query.prefix);
}

function apiActionGuard(req, res, next) {
    if (isRootListing(req)) {
        req.authzAction = 'read';
        return next();
    }
    // /admin/* không thao tác trên layout nên không đi qua bảng action bên trên;
    // mỗi route tự gate bằng requireSystemAdmin / requireAuditRead.
    if (req.path.startsWith('/admin/')) {
        req.authzAction = req.method === 'GET' ? 'admin-read' : 'admin-update';
        return next();
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
        return requireAction('read')(req, res, next);
    }
    const hit = API_WRITE_ACTIONS.find(([m, re]) => m === req.method && re.test(req.path));
    if (!hit) {
        return res.status(403).json({ error: `Endpoint ${req.method} ${req.path} chưa khai báo action` });
    }
    return requireAction(hit[2])(req, res, next);
}

// Mọi /api/* còn lại: phải đăng nhập, rồi phải đủ quyền, rồi ghi audit.
// auditMiddleware đứng SAU guard để đọc được req.authzAction và status thật.
app.use('/api', authenticate, apiActionGuard, auditMiddleware);

/**
 * Lọc danh sách folder ở gốc bucket theo quyền.
 *
 * Hai lời gọi authz, không phải một lời gọi cho mỗi folder: 17+ lần enforce mỗi
 * lần mở app là không chấp nhận được.
 *   1. có 'read' ở domain '*' (role system) → thấy tất cả
 *   2. không thì giao mapping với slug project của user
 */
async function visiblePrefixes(userId) {
    if (PROJECT_SCOPE !== 'on') return null; // null = không lọc

    const systemRead = await session
        .enforce({ userId, resource: RESOURCE, action: 'read', domain: SYSTEM_DOMAIN })
        .catch(() => false);
    if (systemRead) return null;

    const [mappings, slugs] = await Promise.all([
        listMappings(),
        session.getProjectSlugs(userId).catch(() => [])
    ]);
    return accessiblePrefixes(mappings, slugs);
}

const IMG_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const kind = (key) => {
    if (key.endsWith('.json')) return 'json';
    if (key.endsWith('.html')) return 'html';
    if (IMG_RE.test(key)) return 'image';
    return 'other';
};

// ── Phân loại .json: card DivKit hay animation Lottie ─────────────────────
// Tên file không nói gì (anim_gift.json và iap_intro.json cùng đuôi), mà client
// cần biết TRƯỚC khi vẽ lưới — Lottie là asset, card là layout, hai chỗ khác
// nhau. Nên đọc 512 byte đầu: cả hai định dạng đều khai thứ nhận dạng ở ngay
// đầu file (DivKit: screen_id/remote_layout/templates/card; Lottie: v, fr, ip).
const JSON_PEEK_BYTES = 512;
const DIVKIT_MARK = /"(remote_layout|templates|screen_id|card)"\s*:/;
const LOTTIE_MARK = /"fr"\s*:\s*[\d.]/;

// Cache theo ETag: điều hướng qua lại một project không phải peek lại, và ETag
// đổi thì entry cũ tự hết hiệu lực.
//
// ETag dùng để đối chiếu lấy từ CHÍNH kết quả ListObjectsV2 của route gọi vào —
// đó là điểm mấu chốt. Trước đây cache đối chiếu bằng ETag của ranged GET, tức
// phải gọi S3 rồi mới biết cache còn đúng: tiết kiệm 512 byte parse, không tiết
// kiệm round-trip nào. Mỗi lần đổi tab là ~32 ranged GET thừa (~400ms).
const jsonKindCache = new Map();

// Danh sách nông và danh sách đệ quy của cùng một project chạy song song và phủ
// lên nhau ở các file cấp gốc. Cache nguội thì cả hai cùng miss → gộp về một
// lượt peek thay vì hai. Key kèm ETag để hai bên kỳ vọng khác nhau (một bên
// list trước, một bên sau khi file đổi) không dùng chung kết quả.
const jsonPeekInflight = new Map();

/**
 * Trả về { type, version, status } cho một object .json.
 *
 * `etag` là ETag mà caller đã có sẵn từ ListObjectsV2. Khớp cache thì không
 * chạm S3; không khớp (hoặc caller không có) thì mới ranged GET — nó mang theo
 * cả Metadata nên vẫn không cần HeadObject riêng.
 */
async function peekJson(key, etag) {
    const cached = jsonKindCache.get(key);
    if (etag && cached && cached.etag === etag) {
        return { type: cached.type, version: cached.version, status: cached.status };
    }

    const slot = `${key}\u0000${etag || ''}`;
    let pending = jsonPeekInflight.get(slot);
    if (!pending) {
        pending = fetchJsonHead(key).finally(() => jsonPeekInflight.delete(slot));
        jsonPeekInflight.set(slot, pending);
    }
    return pending;
}

async function fetchJsonHead(key) {
    const out = await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Range: `bytes=0-${JSON_PEEK_BYTES - 1}`
    }));
    const head = await streamToString(out.Body);
    // DivKit trước: một file lạ thì mặc định là layout — client verify lại bằng
    // detectJsonKind khi render, nên đoán sai chỉ tốn một lần đổi tỉ lệ tile.
    const entry = {
        etag: out.ETag,
        type: DIVKIT_MARK.test(head) ? 'json' : (LOTTIE_MARK.test(head) ? 'lottie' : 'json'),
        version: out.Metadata?.version,
        status: out.Metadata?.status
    };
    if (entry.etag) jsonKindCache.set(key, entry);
    return { type: entry.type, version: entry.version, status: entry.status };
}

/**
 * Bỏ entry cache của một key sau khi tiến trình này ghi/xoá nó.
 *
 * Cần thiết vì ETag là MD5 của NỘI DUNG: publish một draft mà không sửa gì thì
 * body y hệt, ETag y hệt, nhưng metadata status draft→live đã đổi — chỉ so ETag
 * sẽ trả về badge cũ mãi mãi.
 */
function forgetJsonKind(key) {
    if (key) jsonKindCache.delete(key);
}

async function streamToString(stream) {
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks).toString('utf-8');
}

// ── List project (common prefixes ở root, bỏ qua file lẻ) ──────────────────
app.get('/api/projects', async (req, res) => {
    try {
        const visible = await visiblePrefixes(req.authzUser.id);
        const out = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Delimiter: '/' }));
        const allowed = (out.CommonPrefixes || []).filter(
            (p) => !visible || visible.has(p.Prefix.replace(/\/$/, ''))
        );
        const projects = await Promise.all(
            allowed.map(async (p) => {
                const name = p.Prefix.replace(/\/$/, '');
                let layoutCount = 0;
                try {
                    const ls = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: p.Prefix, Delimiter: '/' }));
                    layoutCount = (ls.Contents || []).filter((o) => o.Key.endsWith('.json') && !o.Key.endsWith('config.json')).length;
                } catch { /* ignore */ }
                return { name, prefix: p.Prefix, layoutCount };
            })
        );
        res.json(projects);
    } catch (e) {
        res.status(500).send(String(e.message || e));
    }
});

// ── List nội dung 1 prefix (folder + file) ─────────────────────────────────
// recursive=1: bỏ Delimiter để lấy mọi object dưới prefix, không trả folder, và
// không HeadObject từng file. Dùng cho danh sách asset của cả project — asset
// nằm rải trong subfolder (images/, videos/), và không có version/status để đọc.
app.get('/api/list', async (req, res) => {
    const prefix = req.query.prefix || '';
    const recursive = req.query.recursive === '1';
    try {
        if (recursive) {
            const files = [];
            let token;
            do {
                const page = await s3.send(new ListObjectsV2Command({
                    Bucket: S3_BUCKET,
                    Prefix: prefix,
                    ContinuationToken: token
                }));
                const entries = (page.Contents || [])
                    .filter((o) => o.Key !== prefix && !o.Key.endsWith('/')); // bỏ marker folder
                files.push(...await Promise.all(entries.map(async (o) => {
                    let type = kind(o.Key);
                    if (type === 'json') {
                        try {
                            ({ type } = await peekJson(o.Key, o.ETag));
                        } catch { /* ignore */ }
                    }
                    return {
                        name: o.Key.replace(prefix, ''),
                        type,
                        key: o.Key,
                        size: o.Size,
                        modified: o.LastModified?.toISOString()
                    };
                })));
                token = page.IsTruncated ? page.NextContinuationToken : undefined;
            } while (token);
            return res.json(files);
        }

        // Chỉ lọc ở GỐC bucket: vào trong project rồi thì guard đã chặn từ trước,
        // và mọi thư mục con đều thuộc cùng project đó.
        const visible = prefix ? null : await visiblePrefixes(req.authzUser.id);
        const out = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix, Delimiter: '/' }));
        const folders = (out.CommonPrefixes || [])
            .filter((p) => !visible || visible.has(p.Prefix.replace(/\/$/, '')))
            // .drafts/ là kho nháp, không phải folder của người dùng: hiện ra thì
            // ai cũng vào sửa thẳng nháp của người khác qua đường vòng.
            .filter((p) => p.Prefix.replace(prefix, '').replace(/\/$/, '') !== DRAFT_SEGMENT)
            .map((p) => ({
                name: p.Prefix.replace(prefix, '').replace(/\/$/, ''),
                type: 'folder',
                prefix: p.Prefix
            }));

        // Nháp của chính thư mục đang xem: đánh dấu file nào có nháp, và cho hiện
        // cả những layout MỚI chỉ tồn tại dưới dạng nháp — không thì bấm Save
        // draft xong là layout biến mất khỏi danh sách, không đường quay lại.
        const dPrefix = visible ? null : draftPrefix(prefix);
        const drafts = new Map();
        if (dPrefix) {
            try {
                const dOut = await s3.send(new ListObjectsV2Command({
                    Bucket: S3_BUCKET, Prefix: dPrefix, Delimiter: '/'
                }));
                for (const o of dOut.Contents || []) {
                    if (o.Key === dPrefix) continue;
                    drafts.set(o.Key.replace(dPrefix, ''), o);
                }
            } catch { /* chưa có nháp nào */ }
        }
        const files = await Promise.all(
            (out.Contents || [])
                .filter((o) => o.Key !== prefix) // bỏ marker folder
                // File lẻ ở gốc bucket không thuộc project nào; người chỉ có quyền
                // theo project không được thấy chúng.
                .filter((o) => !visible)
                .map(async (o) => {
                    const name = o.Key.replace(prefix, '');
                    let t = kind(o.Key);
                    let version, status;
                    if (t === 'json') {
                        try {
                            ({ type: t, version, status } = await peekJson(o.Key, o.ETag));
                        } catch { /* ignore — giữ 'json' */ }
                    }
                    return {
                        name,
                        type: t,
                        key: o.Key,
                        size: o.Size,
                        modified: o.LastModified?.toISOString(),
                        version,
                        status,
                        hasDraft: drafts.has(name),
                        // Trả thẳng key nháp thay vì để FE tự suy: quy tắc đặt key
                        // chỉ nên có MỘT bản (draft-key.mjs), lệch một bên là nội
                        // dung chưa duyệt nằm sai chỗ.
                        draftKey: drafts.has(name) ? `${dPrefix}${name}` : undefined,
                        config: name === 'config.json'
                    };
                })
        );

        // Layout chỉ có nháp, chưa publish lần nào: key trả về là key THẬT (nơi nó
        // sẽ nằm sau khi push), client mở bằng ?draft=1 nên vẫn ra đúng nội dung.
        const seen = new Set(files.map((f) => f.name));
        const draftOnly = [...drafts.entries()]
            .filter(([name]) => !seen.has(name))
            .map(([name, o]) => ({
                name,
                type: kind(name),
                key: `${prefix}${name}`,
                size: o.Size,
                modified: o.LastModified?.toISOString(),
                status: 'draft',
                hasDraft: true,
                draftOnly: true,
                draftKey: `${dPrefix}${name}`
            }));

        res.json([...folders, ...files, ...draftOnly]);
    } catch (e) {
        res.status(500).send(String(e.message || e));
    }
});

// ── Lấy nội dung text (JSON) ───────────────────────────────────────────────
// Có ETag + revalidate. Đây là route tốn băng thông nhất của tool: mỗi lần vào
// một project là toàn bộ layout được tải về để dựng thumbnail (1.4 MB cho một
// project cỡ trung), và F5 một cái là tải lại từ đầu.
//
// `no-cache` chứ không phải max-age: layout đổi khi có người publish, mà một
// bản cũ hiện ra sau khi publish thì tệ hơn nhiều so với một request rỗng. Với
// `no-cache` browser vẫn hỏi mọi lần, nhưng khớp ETag thì 304 và không tải body.
//
// If-None-Match được chuyển TIẾP xuống S3, không chỉ so ở đây: so ở đây thì vẫn
// phải kéo nguyên file từ S3 về mới biết là giống nhau. Đẩy xuống S3 thì chặng
// đó cũng rỗng nốt.
app.get('/api/object', async (req, res) => {
    const ifNoneMatch = req.headers['if-none-match'];
    // draft=1: mở để SỬA → lấy bản nháp nếu có. Không truyền = lấy bản live, và
    // đó là mặc định có chủ đích: diff lúc push và thumbnail phải là cái app đang
    // thấy, không phải cái người ta đang nháp dở.
    const dk = req.query.draft === '1' ? draftKey(req.query.key) : null;
    try {
        let source = 'live';
        let out = null;
        if (dk) {
            try {
                out = await s3.send(new GetObjectCommand({
                    Bucket: S3_BUCKET,
                    Key: dk,
                    ...(ifNoneMatch ? { IfNoneMatch: ifNoneMatch } : {})
                }));
                source = 'draft';
            } catch (e) {
                // 304 = nháp CÓ và không đổi; ném tiếp để nhánh catch trả 304.
                if (e.$metadata?.httpStatusCode === 304) throw e;
                // Còn lại coi như chưa có nháp → rơi về bản live bên dưới.
            }
        }
        if (!out) {
            out = await s3.send(new GetObjectCommand({
                Bucket: S3_BUCKET,
                Key: req.query.key,
                ...(ifNoneMatch ? { IfNoneMatch: ifNoneMatch } : {})
            }));
        }
        // Đặt TRƯỚC send(): express tự sinh ETag yếu từ body nếu header còn trống,
        // mà ETag của S3 mới là thứ so được với `IfNoneMatch` ở vòng sau.
        if (out.ETag) res.set('ETag', out.ETag);
        res.set('Cache-Control', 'no-cache');
        res.set('X-Nocode-Source', source);
        res.type('application/json').send(await streamToString(out.Body));
    } catch (e) {
        // S3 báo "không đổi" bằng cách ném, với http 304 trong metadata.
        if (e.$metadata?.httpStatusCode === 304) {
            res.set('ETag', ifNoneMatch);
            res.set('Cache-Control', 'no-cache');
            return res.status(304).end();
        }
        res.status(500).send(String(e.message || e));
    }
});

// ── Presigned GET cho ảnh ──────────────────────────────────────────────────
app.get('/api/presign', async (req, res) => {
    try {
        const url = await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: S3_BUCKET, Key: req.query.key }),
            { expiresIn: Number(PRESIGN_TTL) }
        );
        res.json({ url });
    } catch (e) {
        res.status(500).send(String(e.message || e));
    }
});

// ── Stream asset (ảnh / lottie .json) qua proxy → cùng origin, tránh CORS S3 ─
app.get('/api/asset', async (req, res) => {
    try {
        const out = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: req.query.key }));
        if (out.ContentType) res.type(out.ContentType);
        if (out.ContentLength != null) res.set('Content-Length', String(out.ContentLength));
        res.set('Cache-Control', 'public, max-age=300');
        out.Body.pipe(res);
    } catch (e) {
        res.status(404).send(String(e.message || e));
    }
});

// Gộp metadata cấp file (screen_id, label) — S3 chỉ nhận giá trị string.
function buildMeta(base, meta) {
    const out = { ...base };
    if (meta?.screen_id) out.screen_id = String(meta.screen_id);
    if (meta?.label) out.label = String(meta.label);
    return Object.keys(out).length ? out : undefined;
}

// ── Lưu object (draft) ─────────────────────────────────────────────────────
app.put('/api/object', async (req, res) => {
    const { key, body, status, meta } = req.body;
    // Nháp KHÔNG ghi vào key thật: đó là đúng file app đang đọc, lưu nháp mà đè
    // lên nó thì "nháp" chỉ là tên gọi. Client vẫn gửi key thật, server tự nắn.
    const isDraft = (status ?? 'draft') === 'draft';
    const targetKey = (isDraft && draftKey(key)) || key;
    try {
        const out = await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: targetKey,
            Body: body,
            ContentType: 'application/json',
            Metadata: buildMeta(status ? { status } : {}, meta)
        }));
        forgetJsonKind(targetKey);
        // Bucket bật versioning → giữ VersionId là đủ để sau này dựng lại đúng
        // nội dung trước/sau, không cần nhồi cả body layout vào DB audit.
        res.locals.s3VersionId = out.VersionId ?? null;
        res.locals.auditDetail = {
            status: status ?? 'draft',
            bytes: Buffer.byteLength(body || ''),
            key: targetKey
        };
        res.json({ ok: true, key: targetKey, draft: targetKey !== key });
    } catch (e) {
        res.status(500).send(String(e.message || e));
    }
});

// ── Xoá object (1 file) ────────────────────────────────────────────────────
app.delete('/api/object', async (req, res) => {
    const key = req.query.key;
    if (!key) return res.status(400).send('thiếu key');
    try {
        const out = await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
        forgetJsonKind(key);
        // Bỏ nháp theo cùng: để lại thì file "đã xoá" vẫn hiện trong danh sách
        // dưới dạng mục chỉ-có-nháp, không ai hiểu vì sao.
        await dropDraft(key);
        // Bucket bật versioning ⇒ đây là delete marker, bản cũ vẫn còn. VersionId
        // của marker cho phép khôi phục bằng cách xoá đúng marker đó.
        res.locals.s3VersionId = out.VersionId ?? null;
        res.locals.auditDetail = { deleteMarker: Boolean(out.DeleteMarker) };
        res.json({ ok: true });
    } catch (e) {
        res.status(500).send(String(e.message || e));
    }
});

// ── Upload asset → <project>/assets/<name> ─────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
    const project = req.body.project;
    const file = req.file;
    if (!project || !file) return res.status(400).send('thiếu project hoặc file');
    const key = `${project}/assets/${file.originalname}`;
    try {
        const out = await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype
        }));
        forgetJsonKind(key);
        // Enforce bằng quyền 'update', nhưng log là 'upload' cho dễ đọc lại.
        res.locals.auditAction = 'upload';
        res.locals.s3VersionId = out.VersionId ?? null;
        res.locals.auditDetail = { fileName: file.originalname, bytes: file.size, key };
        // Trả về URL tương đối để JSON lưu gọn (client resolve qua presign/CDN)
        res.json({ url: `assets/${file.originalname}`, key });
    } catch (e) {
        res.status(500).send(String(e.message || e));
    }
});

// ── Publish: backup + bump version + invalidate CDN ────────────────────────
app.post('/api/publish', async (req, res) => {
    const { key, body, commitMessage = '', bumpVersion = true, invalidateCdn = true, meta } = req.body;
    try {
        // 1. Backup bản hiện tại (nếu không bật S3 versioning)
        if (bumpVersion && USE_S3_VERSIONING !== 'true') {
            try {
                await s3.send(new CopyObjectCommand({
                    Bucket: S3_BUCKET,
                    CopySource: `/${S3_BUCKET}/${key}`,
                    Key: `${key}.${Date.now()}.bak`
                }));
            } catch { /* file mới, chưa có bản cũ */ }
        }

        // 2. Key đã có trên S3 chưa? Dùng cho CẢ hai việc: tính version, và quyết
        //    định có purge cache hay không ở bước 5.
        let head = null;
        try {
            head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
        } catch { /* file mới */ }

        let nextVersion = 'v1';
        if (bumpVersion && head) {
            const cur = parseInt((head.Metadata?.version || 'v0').replace(/\D/g, ''), 10) || 0;
            nextVersion = `v${cur + 1}`;
        }

        // 3. Ghi bản publish (status=live)
        const put = await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: body,
            ContentType: 'application/json',
            Metadata: buildMeta({
                status: 'live',
                version: nextVersion,
                commit: commitMessage.slice(0, 256),
                'published-at': new Date().toISOString()
            }, meta)
        }));
        forgetJsonKind(key);
        res.locals.s3VersionId = put.VersionId ?? null;
        res.locals.auditDetail = {
            version: nextVersion,
            commitMessage: commitMessage.slice(0, 256),
            bytes: Buffer.byteLength(body || '')
        };

        // 4. Invalidate CloudFront
        if (invalidateCdn && cf) {
            await cf.send(new CreateInvalidationCommand({
                DistributionId: CLOUDFRONT_DISTRIBUTION_ID,
                InvalidationBatch: {
                    CallerReference: `${Date.now()}`,
                    Paths: { Quantity: 1, Items: [`/${key}`] }
                }
            }));
        }

        // 5. Purge cache CDN. CHỈ khi ghi đè: key mới thì chưa có gì trong cache để
        //    xoá, mà endpoint này purge diện rộng — gọi thừa là bắt mọi layout khác
        //    của mọi project phải nạp lại từ origin.
        let cachePurged = null;
        if (invalidateCdn && head && CDN_PURGE_URL) {
            cachePurged = await purgeCdnCache();
        }
        res.locals.auditDetail.cachePurged = cachePurged;

        // 6. Nội dung nháp giờ đã là bản live → bỏ nháp, không thì file nào cũng
        //    đeo nhãn "có bản nháp" vĩnh viễn dù nháp y hệt bản đang chạy.
        await dropDraft(key);

        res.json({ ok: true, version: nextVersion, cachePurged });
    } catch (e) {
        res.status(500).send(String(e.message || e));
    }
});

// ── Machine translation: dịch 1 chuỗi sang nhiều locale ────────────────────
// Provider pluggable qua env MT_PROVIDER. Editor gọi để auto-điền locale_ dict.
// LƯU Ý: chỉ dùng như engine dịch (trả gợi ý); KHÔNG ghi vào DB i18n của rc-admin.

// stub: mirror 'noop' của rc-admin — trả placeholder, cho UI chạy khi chưa nối service.
function translateStub(text, targets) {
    const translations = {};
    for (const loc of targets) translations[loc] = `[${loc}] ${text}`;
    return translations;
}

// ── TẮT: google (endpoint dịch free) ─────────────────────────────────────
// Bỏ dùng vì hai lý do, không phải vì thích gemini hơn:
//  1. translate.googleapis.com/translate_a/single là endpoint nội bộ của
//     Google Translate web, không có hợp đồng gì — đo được 429 ngay.
//  2. Vòng lặp dưới NUỐT lỗi từng locale để không chặn cả batch, nên 429 đi ra
//     thành HTTP 200 với dict rỗng: nút Localize chạy xong mà ô dịch trống,
//     không một dòng lỗi. Đó chính là bug localize đang gặp.
// Giữ code lại để còn đối chiếu; muốn bật lại thì bỏ comment cả khối này,
// nhánh 'google' trong effectiveMtProvider() và case trong /api/translate.
// // google: endpoint dịch free (không cần key). 1 target/lần → chạy song song có giới hạn.
// // Một số mã ngôn ngữ cần map cho Google.
// const GOOGLE_LANG_MAP = { zh: 'zh-CN', he: 'iw', nb: 'no', vn: 'vi' };
// async function translateOneGoogle(text, from, to) {
//     const tl = GOOGLE_LANG_MAP[to] || to;
//     const sl = GOOGLE_LANG_MAP[from] || from;
//     const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
//     const r = await fetch(url);
//     if (!r.ok) throw new Error(`google ${r.status}`);
//     const data = await r.json();
//     // data[0] = mảng segment [ [đã_dịch, gốc, …], … ] → nối lại.
//     return (data[0] || []).map((seg) => seg[0]).filter(Boolean).join('');
// }
// async function translateGoogle(text, from, targets) {
//     const out = {};
//     const CONCURRENCY = 6;
//     let idx = 0;
//     async function worker() {
//         while (idx < targets.length) {
//             const to = targets[idx++];
//             try {
//                 out[to] = await translateOneGoogle(text, from, to);
//             } catch {
//                 // bỏ qua ngôn ngữ lỗi → để trống, không chặn cả batch
//             }
//         }
//     }
//     await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
//     return out;
// }

// ── TẮT: rc-admin ────────────────────────────────────────────────────────
// Chưa bao giờ chạy được: endpoint /i18n/bulk-suggest không tồn tại ở cms-admin.
// Route dịch thật bên đó là POST /api/internal/projects/:id/translations/translate
// (1 target/lượt, auth bằng cookie `auth_token`) — nhưng mình không cần đi vòng
// qua nó, thứ duy nhất cần là engine Gemini, xem mt-gemini.mjs.
// // rc-admin: gọi POST /v1/projects/:pid/i18n/bulk-suggest.
// // ⚠ Payload/response dưới đây là DỰ KIẾN — chỉnh lại đúng DTO khi có mt.controller.ts.
// async function translateRcAdmin(text, from, targets, opts) {
//     const base = RC_ADMIN_BASE_URL.replace(/\/$/, '');
//     const url = `${base}/v1/projects/${RC_ADMIN_PROJECT_ID}/i18n/bulk-suggest`;
//     const resp = await fetch(url, {
//         method: 'POST',
//         headers: {
//             'Content-Type': 'application/json',
//             ...(RC_ADMIN_TOKEN ? { Authorization: `Bearer ${RC_ADMIN_TOKEN}` } : {})
//         },
//         // TODO(schema): map đúng field khi có DTO của bulk-suggest.
//         body: JSON.stringify({
//             sourceLocale: from,
//             targetLocales: targets,
//             items: [{ key: 'inline', source: text }],
//             tone: opts?.tone,
//             maxLength: opts?.maxLength
//         })
//     });
//     if (!resp.ok) throw new Error(`rc-admin ${resp.status}: ${await resp.text()}`);
//     const data = await resp.json();
//     // TODO(schema): trích đúng theo response thật. Dạng dự kiến:
//     //   { results: [{ key, translations: { <locale>: <text> } }] }
//     const translations = data?.results?.[0]?.translations || data?.translations || {};
//     return translations;
// }

app.post('/api/translate', async (req, res) => {
    // tone/maxLength: client vẫn gửi được (xem src/mt.ts) nhưng không nhánh nào
    // dùng nữa sau khi tắt rc-admin — bỏ khỏi destructure cho khỏi hiểu nhầm.
    const { text, from = 'en', targets } = req.body || {};
    if (!text || !Array.isArray(targets) || !targets.length) {
        return res.status(400).send('thiếu text hoặc targets[]');
    }
    // Không dịch về chính ngôn ngữ nguồn.
    const tgts = targets.filter((l) => l && l !== from);
    if (!tgts.length) return res.json({ translations: {} });
    const provider = effectiveMtProvider();
    // Thiếu key thì nói thẳng. Rơi về stub ở đây là cái bẫy cũ: request 200,
    // layout đầy "[vi] Play", không ai biết là chưa cấu hình gì.
    if (provider === 'none') {
        return res.status(503).send('Chưa cấu hình dịch: thiếu GEMINI_API_KEY trong server/.env');
    }
    try {
        const translations = provider === 'gemini'
            ? await translateGemini(text, from, tgts)
            : translateStub(text, tgts);
        res.json({ translations });
    } catch (e) {
        res.status(502).send(String(e.message || e));
    }
});

// Provider MT thực tế đang chạy — chỗ nào cần hiển thị đều đi qua đây, không
// in env thô: khai 'gemini' mà thiếu key thì cái chạy thật không phải 'gemini'.
// 'none' = chưa cấu hình được gì; route dịch trả 503 thay vì im lặng.
function effectiveMtProvider() {
    if (MT_PROVIDER === 'stub') return 'stub';
    if (isGeminiConfigured()) return 'gemini';
    return 'none';
}

// ── Admin: mapping folder bucket ↔ project authz ──────────────────────────
// Tên folder không trùng slug authz nên mapping là dữ liệu nhập tay. Quan hệ
// nhiều-nhiều: một folder thường ứng với prod + debug + iOS + Android.

function requireDb(_req, res, next) {
    if (!DB_ENABLED) return res.status(503).json({ error: 'Chưa cấu hình Postgres' });
    next();
}

app.get('/api/admin/projects', requireDb, requireSystemAdmin, async (_req, res) => {
    try {
        // Trả kèm danh sách folder thật trong bucket để UI chỉ ra folder nào
        // chưa được map — đó chính là những folder sẽ bị khoá khi bật scope.
        const [mappings, out] = await Promise.all([
            listMappings(),
            s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Delimiter: '/' }))
        ]);
        const bucketPrefixes = (out.CommonPrefixes || []).map((p) => p.Prefix.replace(/\/$/, ''));
        res.json({ mappings, bucketPrefixes, scope: PROJECT_SCOPE });
    } catch (e) {
        res.status(500).json({ error: String(e.message || e) });
    }
});

app.post('/api/admin/projects', requireDb, requireSystemAdmin, async (req, res) => {
    const { bucketPrefix, displayName, authzSlugs } = req.body || {};
    if (!bucketPrefix) return res.status(400).json({ error: 'thiếu bucketPrefix' });
    try {
        const id = await createProject({
            bucketPrefix: String(bucketPrefix).replace(/\/$/, ''),
            displayName,
            authzSlugs: Array.isArray(authzSlugs) ? authzSlugs : []
        });
        res.json({ ok: true, id });
    } catch (e) {
        res.status(500).json({ error: String(e.message || e) });
    }
});

app.patch('/api/admin/projects/:id', requireDb, requireSystemAdmin, async (req, res) => {
    const { displayName, isActive, authzSlugs } = req.body || {};
    try {
        await updateProject(Number(req.params.id), {
            displayName,
            isActive,
            authzSlugs: Array.isArray(authzSlugs) ? authzSlugs : undefined
        });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: String(e.message || e) });
    }
});

app.delete('/api/admin/projects/:id', requireDb, requireSystemAdmin, async (req, res) => {
    try {
        await deleteProject(Number(req.params.id));
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: String(e.message || e) });
    }
});

// ── Admin: audit log ──────────────────────────────────────────────────────
app.get('/api/admin/audit', requireDb, requireAuditRead, async (req, res) => {
    try {
        const rows = await searchAudit({
            project: req.query.project,
            userEmail: req.query.user,
            action: req.query.action,
            from: req.query.from,
            to: req.query.to,
            limit: req.query.limit,
            offset: req.query.offset
        });
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: String(e.message || e) });
    }
});

// Thông tin provider MT hiện tại (để UI hiển thị/nhận biết stub vs thật).
app.get('/api/translate/info', (_req, res) => {
    res.json({ provider: effectiveMtProvider() });
});

// ── Gateway: frontend đi cùng origin với /api và /auth ─────────────────────
// Redirect URI của authz khớp tuyệt đối một origin duy nhất, nên browser chỉ
// được nói chuyện với cổng này. Dev: proxy sang Vite. Prod: serve dist/.
const IS_DEV = NODE_ENV !== 'production';
const DIST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

let devProxy;
if (IS_DEV) {
    devProxy = createProxyMiddleware({
        target: VITE_DEV_URL,
        changeOrigin: true,
        ws: true // HMR websocket
    });
    app.use(devProxy);
} else {
    app.use(express.static(DIST_DIR));
    // SPA fallback — mọi path không phải file tĩnh đều trả index.html.
    app.get('*', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
}

// Schema sync trước khi nhận request: guard đọc bảng mapping ngay từ request
// đầu tiên, mà /healthz thì không cần DB nên listen sớm cũng không lợi gì.
// DB hỏng KHÔNG chặn boot — authz.mjs đã tự hạ scope về 'off' khi thiếu DB.
await ensureSchema().catch((err) => {
    console.warn('[db] ensureSchema hỏng:', err.message);
});

// Kêu ngay lúc boot thay vì để người ta phát hiện qua nút Localize.
if (effectiveMtProvider() === 'none') {
    console.warn('[mt] Thiếu GEMINI_API_KEY → nút Localize sẽ trả 503. Đặt GEMINI_API_KEY trong server/.env (hoặc MT_PROVIDER=stub để chạy UI offline).');
}

const server = app.listen(Number(PORT), () => {
    console.log(
        `NoCode Preview → http://localhost:${PORT}  ` +
        `(bucket: ${S3_BUCKET}, region: ${AWS_REGION}) · MT=${effectiveMtProvider()} · ` +
        `authz=${process.env.AUTHZ_SYSTEM_CODE} · projectScope=${PROJECT_SCOPE} · ` +
        `db=${DB_ENABLED ? 'on' : 'off'} · ` +
        `${IS_DEV ? `dev proxy → ${VITE_DEV_URL}` : `static ← ${DIST_DIR}`}`
    );
});

// ws:true chỉ tự đăng ký upgrade sau request HTTP đầu tiên; wire tay để HMR
// không chết khi browser mở websocket trước.
if (devProxy?.upgrade) {
    server.on('upgrade', devProxy.upgrade);
}
