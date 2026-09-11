// ── Audit log: ai làm gì, ở project nào ───────────────────────────────────
// Ghi fire-and-forget. DB chết thì mất log, KHÔNG được kéo theo request của
// người dùng — một tool sửa layout không nên ngừng hoạt động vì Postgres restart.

import { query, DB_ENABLED } from './db.mjs';

/**
 * Đọc IP thật. Sau Cloudflare → Caddy → container, `req.ip` là IP của proxy.
 * Cloudflare đặt CF-Connecting-IP; Caddy nối tiếp vào X-Forwarded-For.
 */
function clientIp(req) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return String(cf);
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    return req.ip || null;
}

/**
 * Ghi một dòng audit. Không bao giờ throw.
 *
 * @param {object} entry
 * @param {string} entry.action    read|update|publish|delete|upload|login|logout
 * @param {string} entry.outcome   allow|deny|error|shadow-deny
 */
export function record(entry) {
    if (!DB_ENABLED) return;

    // Không await: caller đang ở trên đường trả response.
    query(
        `insert into audit_logs
           (user_id, user_email, action, outcome, bucket_prefix, object_key,
            method, path, status_code, s3_version_id, detail, ip, user_agent)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
            entry.userId ?? null,
            entry.userEmail ?? null,
            entry.action,
            entry.outcome,
            entry.bucketPrefix ?? null,
            entry.objectKey ?? null,
            entry.method ?? null,
            entry.path ?? null,
            entry.statusCode ?? null,
            entry.s3VersionId ?? null,
            entry.detail ? JSON.stringify(entry.detail) : null,
            entry.ip ?? null,
            entry.userAgent ?? null
        ]
    ).catch((err) => console.warn('[audit] ghi hỏng:', err.message));
}

/** Thao tác ghi — luôn log. Đọc chỉ log khi bị từ chối (§audit trong spec). */
const WRITE_ACTIONS = new Set(['update', 'publish', 'delete', 'upload', 'admin-update']);

/**
 * Ồn mà vô giá trị: mở một folder ảnh bắn vài chục request asset/presign, mỗi
 * cái một dòng log. Bị từ chối thì vẫn ghi — đó là tín hiệu bảo mật.
 */
const NEVER_LOG_PATHS = new Set(['/asset', '/presign']);

/**
 * Middleware ghi audit cho một request /api đã qua guard.
 * Gắn SAU guard và đọc kết quả ở `finish` để có status code thật.
 */
export function auditMiddleware(req, res, next) {
    if (!DB_ENABLED) return next();

    res.on('finish', () => {
        // Action dùng để ENFORCE và action đáng GHI không phải lúc nào cũng trùng:
        // upload asset enforce bằng quyền 'update' nhưng log là 'upload' thì đọc
        // lại mới hiểu chuyện gì đã xảy ra. Route ghi đè qua res.locals.
        const action = res.locals?.auditAction || req.authzAction;
        // Guard chưa gán action (route bị chặn trước đó) → không đủ ngữ nghĩa để ghi.
        if (!action) return;

        const denied = res.statusCode === 401 || res.statusCode === 403;
        const failed = res.statusCode >= 500;
        const quiet = NEVER_LOG_PATHS.has(req.path);

        if (quiet && !denied) return;
        if (!WRITE_ACTIONS.has(action) && !denied && !failed) return;

        record({
            userId: req.authzUser?.id,
            userEmail: req.authzUser?.email,
            action,
            outcome: denied ? 'deny' : failed ? 'error' : 'allow',
            bucketPrefix: req.bucketPrefix,
            objectKey: req.query?.key || req.body?.key || null,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            s3VersionId: res.locals?.s3VersionId ?? null,
            detail: res.locals?.auditDetail ?? null,
            ip: clientIp(req),
            userAgent: req.headers['user-agent'] || null
        });
    });

    next();
}

/** Sự kiện auth — nằm ngoài /api nên không đi qua middleware trên. */
export function recordAuth(req, { action, outcome, user }) {
    record({
        userId: user?.id,
        userEmail: user?.email,
        action,
        outcome,
        method: req.method,
        path: req.path,
        ip: clientIp(req),
        userAgent: req.headers['user-agent'] || null
    });
}

// ── Truy vấn cho màn admin ────────────────────────────────────────────────

/**
 * Lọc audit theo project / user / action / khoảng thời gian.
 * Trả tối đa `limit` dòng, mới nhất trước.
 */
export async function search({ project, userEmail, action, from, to, limit = 100, offset = 0 } = {}) {
    const where = [];
    const params = [];
    const add = (sql, value) => {
        params.push(value);
        where.push(sql.replace('?', `$${params.length}`));
    };

    if (project) add('bucket_prefix = ?', project);
    if (userEmail) add('user_email ilike ?', `%${userEmail}%`);
    if (action) add('action = ?', action);
    if (from) add('at >= ?', from);
    if (to) add('at <= ?', to);

    // Chặn trên cứng: UI gửi limit=100000 thì cũng không kéo sập DB.
    params.push(Math.min(Number(limit) || 100, 500));
    const limitIdx = params.length;
    params.push(Math.max(Number(offset) || 0, 0));
    const offsetIdx = params.length;

    const { rows } = await query(
        `select id, at, user_id, user_email, action, outcome, bucket_prefix,
                object_key, method, path, status_code, s3_version_id, detail, ip
           from audit_logs
          ${where.length ? 'where ' + where.join(' and ') : ''}
          order by at desc
          limit $${limitIdx} offset $${offsetIdx}`,
        params
    );
    return rows;
}
