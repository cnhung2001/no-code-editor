// ── NoCode Preview — backend proxy cho S3 (giữ AWS credentials) ───────────
// Frontend gọi /api/* qua đây; credentials không bao giờ lộ ra browser.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
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

const {
    PORT = 8787,
    AWS_REGION = 'ap-southeast-1',
    S3_BUCKET = 'ik-nocode-paywall',
    PRESIGN_TTL = '900',
    CLOUDFRONT_DISTRIBUTION_ID = '',
    USE_S3_VERSIONING = 'true',
    CORS_ORIGIN = 'http://localhost:5173',
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
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '12mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

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
const GOOGLE_LANG_MAP = { zh: 'zh-CN', he: 'iw', nb: 'no' };
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

app.listen(Number(PORT), () => {
    console.log(`NoCode Preview S3 proxy → http://localhost:${PORT} (bucket: ${S3_BUCKET}, region: ${AWS_REGION}) · MT=${MT_PROVIDER}`);
});
