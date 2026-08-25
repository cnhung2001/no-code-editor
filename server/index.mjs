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
import { authenticate, requireAction } from './authz.mjs';

const {
    PORT = 8080,
    AWS_REGION = 'ap-southeast-1',
    S3_BUCKET = 'ik-nocode-paywall',
    PRESIGN_TTL = '900',
    CLOUDFRONT_DISTRIBUTION_ID = '',
    USE_S3_VERSIONING = 'true',
    // Sau khi gộp về một origin (§A), browser không còn gọi cross-origin nên
    // CORS mặc định TẮT. Chỉ bật khi thực sự cần client khác origin gọi vào —
    // để mặc định mở kèm cookie credentials là tự tạo lỗ.
    CORS_ORIGIN = '',
    NODE_ENV = 'development',
    // Vite dev server mà gateway proxy tới khi chạy local.
    VITE_DEV_URL = 'http://localhost:5173',
    // ── Machine translation (i18n auto-translate) ──
    // 'stub'     → trả "[locale] text" (mặc định, không gọi API ngoài)
    // 'rc-admin' → gọi service MT của rc-admin (bulk-suggest)
    MT_PROVIDER = 'stub',
    RC_ADMIN_BASE_URL = '',
    RC_ADMIN_TOKEN = '',
    RC_ADMIN_PROJECT_ID = ''
} = process.env;

const s3 = new S3Client({ region: AWS_REGION });
const cf = CLOUDFRONT_DISTRIBUTION_ID ? new CloudFrontClient({ region: AWS_REGION }) : null;

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

function apiActionGuard(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD') {
        return requireAction('read')(req, res, next);
    }
    const hit = API_WRITE_ACTIONS.find(([m, re]) => m === req.method && re.test(req.path));
    if (!hit) {
        return res.status(403).json({ error: `Endpoint ${req.method} ${req.path} chưa khai báo action` });
    }
    return requireAction(hit[2])(req, res, next);
}

// Mọi /api/* còn lại: phải đăng nhập, rồi phải đủ quyền.
app.use('/api', authenticate, apiActionGuard);

const IMG_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const kind = (key) => {
    if (key.endsWith('.json')) return 'json';
    if (key.endsWith('.html')) return 'html';
    if (IMG_RE.test(key)) return 'image';
    return 'other';
};

async function streamToString(stream) {
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks).toString('utf-8');
}

// ── List project (common prefixes ở root, bỏ qua file lẻ) ──────────────────
app.get('/api/projects', async (_req, res) => {
    try {
        const out = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Delimiter: '/' }));
        const projects = await Promise.all(
            (out.CommonPrefixes || []).map(async (p) => {
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
app.get('/api/list', async (req, res) => {
    const prefix = req.query.prefix || '';
    try {
        const out = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix, Delimiter: '/' }));
        const folders = (out.CommonPrefixes || []).map((p) => ({
            name: p.Prefix.replace(prefix, '').replace(/\/$/, ''),
            type: 'folder',
            prefix: p.Prefix
        }));
        const files = await Promise.all(
            (out.Contents || [])
                .filter((o) => o.Key !== prefix) // bỏ marker folder
                .map(async (o) => {
                    const name = o.Key.replace(prefix, '');
                    const t = kind(o.Key);
                    let version, status;
                    if (t === 'json') {
                        try {
                            const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: o.Key }));
                            version = head.Metadata?.version;
                            status = head.Metadata?.status;
                        } catch { /* ignore */ }
                    }
                    return {
                        name,
                        type: t,
                        key: o.Key,
                        size: o.Size,
                        modified: o.LastModified?.toISOString(),
                        version,
                        status,
                        config: name === 'config.json'
                    };
                })
        );
        res.json([...folders, ...files]);
    } catch (e) {
        res.status(500).send(String(e.message || e));
    }
});

// ── Lấy nội dung text (JSON) ───────────────────────────────────────────────
app.get('/api/object', async (req, res) => {
    try {
        const out = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: req.query.key }));
        res.type('application/json').send(await streamToString(out.Body));
    } catch (e) {
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
    try {
        await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: body,
            ContentType: 'application/json',
            Metadata: buildMeta(status ? { status } : {}, meta)
        }));
        res.json({ ok: true });
    } catch (e) {
        res.status(500).send(String(e.message || e));
    }
});

// ── Xoá object (1 file) ────────────────────────────────────────────────────
app.delete('/api/object', async (req, res) => {
    const key = req.query.key;
    if (!key) return res.status(400).send('thiếu key');
    try {
        await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
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
        await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype
        }));
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

        // 2. Tính version mới
        let nextVersion = 'v1';
        if (bumpVersion) {
            try {
                const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
                const cur = parseInt((head.Metadata?.version || 'v0').replace(/\D/g, ''), 10) || 0;
                nextVersion = `v${cur + 1}`;
            } catch { /* file mới */ }
        }

        // 3. Ghi bản publish (status=live)
        await s3.send(new PutObjectCommand({
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

        res.json({ ok: true, version: nextVersion });
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

// google: endpoint dịch free (không cần key). 1 target/lần → chạy song song có giới hạn.
// Một số mã ngôn ngữ cần map cho Google.
const GOOGLE_LANG_MAP = { zh: 'zh-CN', he: 'iw', nb: 'no', vn: 'vi' };
async function translateOneGoogle(text, from, to) {
    const tl = GOOGLE_LANG_MAP[to] || to;
    const sl = GOOGLE_LANG_MAP[from] || from;
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`google ${r.status}`);
    const data = await r.json();
    // data[0] = mảng segment [ [đã_dịch, gốc, …], … ] → nối lại.
    return (data[0] || []).map((seg) => seg[0]).filter(Boolean).join('');
}
async function translateGoogle(text, from, targets) {
    const out = {};
    const CONCURRENCY = 6;
    let idx = 0;
    async function worker() {
        while (idx < targets.length) {
            const to = targets[idx++];
            try {
                out[to] = await translateOneGoogle(text, from, to);
            } catch {
                // bỏ qua ngôn ngữ lỗi → để trống, không chặn cả batch
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    return out;
}

// rc-admin: gọi POST /v1/projects/:pid/i18n/bulk-suggest.
// ⚠ Payload/response dưới đây là DỰ KIẾN — chỉnh lại đúng DTO khi có mt.controller.ts.
async function translateRcAdmin(text, from, targets, opts) {
    const base = RC_ADMIN_BASE_URL.replace(/\/$/, '');
    const url = `${base}/v1/projects/${RC_ADMIN_PROJECT_ID}/i18n/bulk-suggest`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(RC_ADMIN_TOKEN ? { Authorization: `Bearer ${RC_ADMIN_TOKEN}` } : {})
        },
        // TODO(schema): map đúng field khi có DTO của bulk-suggest.
        body: JSON.stringify({
            sourceLocale: from,
            targetLocales: targets,
            items: [{ key: 'inline', source: text }],
            tone: opts?.tone,
            maxLength: opts?.maxLength
        })
    });
    if (!resp.ok) throw new Error(`rc-admin ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    // TODO(schema): trích đúng theo response thật. Dạng dự kiến:
    //   { results: [{ key, translations: { <locale>: <text> } }] }
    const translations = data?.results?.[0]?.translations || data?.translations || {};
    return translations;
}

app.post('/api/translate', async (req, res) => {
    const { text, from = 'en', targets, tone, maxLength } = req.body || {};
    if (!text || !Array.isArray(targets) || !targets.length) {
        return res.status(400).send('thiếu text hoặc targets[]');
    }
    // Không dịch về chính ngôn ngữ nguồn.
    const tgts = targets.filter((l) => l && l !== from);
    try {
        let translations;
        // Fallback về stub nếu chọn rc-admin nhưng chưa cấu hình (mirror pattern của rc-admin).
        if (MT_PROVIDER === 'rc-admin' && RC_ADMIN_BASE_URL && RC_ADMIN_PROJECT_ID) {
            translations = await translateRcAdmin(text, from, tgts, { tone, maxLength });
        } else if (MT_PROVIDER === 'google') {
            translations = await translateGoogle(text, from, tgts);
        } else {
            translations = translateStub(text, tgts);
        }
        res.json({ translations });
    } catch (e) {
        res.status(502).send(String(e.message || e));
    }
});

// Thông tin provider MT hiện tại (để UI hiển thị/nhận biết stub vs thật).
app.get('/api/translate/info', (_req, res) => {
    let provider = 'stub';
    if (MT_PROVIDER === 'rc-admin' && RC_ADMIN_BASE_URL && RC_ADMIN_PROJECT_ID) provider = 'rc-admin';
    else if (MT_PROVIDER === 'google') provider = 'google';
    res.json({ provider });
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

const server = app.listen(Number(PORT), () => {
    console.log(
        `NoCode Preview → http://localhost:${PORT}  ` +
        `(bucket: ${S3_BUCKET}, region: ${AWS_REGION}) · MT=${MT_PROVIDER} · ` +
        `authz=${process.env.AUTHZ_SYSTEM_CODE} · ${IS_DEV ? `dev proxy → ${VITE_DEV_URL}` : `static ← ${DIST_DIR}`}`
    );
});

// ws:true chỉ tự đăng ký upgrade sau request HTTP đầu tiên; wire tay để HMR
// không chết khi browser mở websocket trước.
if (devProxy?.upgrade) {
    server.on('upgrade', devProxy.upgrade);
}
