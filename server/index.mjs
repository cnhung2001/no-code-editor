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
    CORS_ORIGIN = 'http://localhost:5173'
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

app.listen(Number(PORT), () => {
    console.log(`NoCode Preview S3 proxy → http://localhost:${PORT} (bucket: ${S3_BUCKET}, region: ${AWS_REGION})`);
});
