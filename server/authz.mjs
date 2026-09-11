// ── authz (sl-authenz) wiring ─────────────────────────────────────────────
// AUTHZ_API_KEY chỉ tồn tại ở tiến trình này. Frontend không bao giờ thấy nó:
// browser hỏi quyền qua GET /api/me, backend mới gọi authz.

import { AuthzClient } from '@ikameglobal/authz-sdk';
import {
    asCookieWriter,
    createAuthCookieHelpers,
    createDirectTransport,
    createSessionManager,
    enforceActionAcrossProjects,
    extractTokenFromCookieHeader,
    extractTokenFromHeaders,
    isAdminRole,
    mapAuthzErrorToHttp,
    pickHighestRole
} from '@ikameglobal/authz-sdk/common';
import { resolveBucketPrefix } from './project-scope.mjs';
import { slugsForPrefix } from './projects-repo.mjs';
import { DB_ENABLED } from './db.mjs';
import { record } from './audit.mjs';

const {
    AUTHZ_SYSTEM_CODE,
    AUTHZ_API_KEY,
    AUTHZ_REDIRECT_URI,
    APP_BASE_URL = 'http://localhost:8080',
    NODE_ENV,
    AUTHZ_PROJECT_SCOPE = 'off'
} = process.env;

if (!AUTHZ_SYSTEM_CODE || !AUTHZ_API_KEY) {
    throw new Error('Thiếu AUTHZ_SYSTEM_CODE / AUTHZ_API_KEY trong server/.env');
}

export const BASE_URL = APP_BASE_URL.replace(/\/$/, '');

// Redirect URI phải khớp TỪNG BYTE với entry trong allowlist của system
// (authz match tuyệt đối: không wildcard, không prefix, dấu / cuối cũng tính).
export const REDIRECT_URI = AUTHZ_REDIRECT_URI || `${BASE_URL}/auth/callback`;

export const RESOURCE = `${AUTHZ_SYSTEM_CODE}:layout`;

// Resource này authz đã seed sẵn (admin + owner có 'read') — dùng lại để gate
// màn audit thay vì bịa quyền mới.
export const AUDIT_RESOURCE = `${AUTHZ_SYSTEM_CODE}:audit-log`;

// Không có "create": backend không phân biệt được PUT tạo mới vs ghi đè nếu
// không thêm một HeadObject cho mọi lần save, và không role nào cần
// create-mà-không-update. "New layout" dùng chung quyền `update`.
export const ACTIONS = ['read', 'update', 'publish', 'delete'];

// Casbin domain cho quyền cấp system. Role gán ở domain này match MỌI domain
// (matcher của authz có nhánh `g(r.sub, p.sub, "*")`), nên đây chính là cơ chế
// "admin/owner thấy tất cả project" — và cũng là lý do gán role project thấp hơn
// KHÔNG hạ được quyền của người đang giữ role system.
export const SYSTEM_DOMAIN = '*';

/**
 * Mức phân quyền theo project:
 *   off    — quyết định ở domain '*' (hành vi cũ). Mặc định.
 *   shadow — vẫn quyết định ở domain '*', nhưng tính song song kết quả
 *            project-scoped và ghi chênh lệch vào audit_logs. Dùng để biết bật
 *            'on' sẽ MỞ KHOÁ cho ai.
 *   on     — quyết định theo domain project:<slug>, CỘNG domain '*'.
 *
 * 'on' là tập cha của 'off' — bật lên không lấy đi quyền của ai. Nếu authz chưa
 * có p-rule cho `project:*` trên RESOURCE thì 'on' cũng chưa có tác dụng gì:
 * enforce ở domain project luôn false, quyết định rơi về domain '*'.
 */
const SCOPE_MODE = ['off', 'shadow', 'on'].includes(AUTHZ_PROJECT_SCOPE)
    ? AUTHZ_PROJECT_SCOPE
    : 'off';

// Không có DB thì không có mapping folder↔slug, mà không có mapping thì mọi
// folder đều "chưa khai báo" ⇒ deny sạch. Tự hạ về 'off' thay vì khoá cả tool.
export const PROJECT_SCOPE = DB_ENABLED ? SCOPE_MODE : 'off';

if (SCOPE_MODE !== 'off' && !DB_ENABLED) {
    console.warn(`[authz] AUTHZ_PROJECT_SCOPE=${SCOPE_MODE} nhưng thiếu Postgres → hạ về 'off'`);
}

// Tên cookie default mà middleware/guard của SDK tự đọc — giữ nguyên để không
// phải tự forward thành Bearer header.
export const ACCESS_COOKIE = 'auth_token';
export const REFRESH_COOKIE = 'refresh_token';

export const authz = new AuthzClient({
    apiKey: AUTHZ_API_KEY,
    systemCode: AUTHZ_SYSTEM_CODE,
    // Giữ nguyên AuthzError để route tự map; không set thì lỗi thô từ
    // authz.begamob.com lọt vào response của mình.
    onError: (err) => err
});

export const session = createSessionManager({
    transport: createDirectTransport(authz),
    cacheTtlMs: 60_000,
    // Bật retry khi roles/projectSlugs cùng rỗng — casbin chưa propagate ngay
    // sau login, coi rỗng là kết quả cuối sẽ gây loop re-login.
    roleSignalsRetry: {}
});

export const cookies = createAuthCookieHelpers({
    accessTokenName: ACCESS_COOKIE,
    refreshTokenName: REFRESH_COOKIE,
    secure: NODE_ENV === 'production'
});

/**
 * Adapter Express cho CookieWriter của SDK.
 *
 * Hai chỗ không thể dùng `asCookieWriter(res)` trực tiếp như doc gợi ý:
 *  1. SDK gọi `writer.set(name, value, opts)`, nhưng Express `res.set` là SET
 *     HEADER → sẽ tạo header tên "auth_token" chứ không phải cookie; và
 *     `res.delete` không tồn tại.
 *  2. SDK trả `maxAge` theo GIÂY, `res.cookie` nhận MILLI → truyền thẳng thì
 *     cookie 30 ngày co lại còn ~43 phút.
 */
export function cookieWriter(res) {
    return asCookieWriter({
        set(name, value, opts) {
            const { maxAge, ...rest } = opts;
            res.cookie(name, value, { ...rest, maxAge: maxAge * 1000 });
        },
        delete(name, opts) {
            res.clearCookie(name, opts);
        }
    });
}

export function readAccessToken(req) {
    return (
        extractTokenFromHeaders(req.headers) ||
        extractTokenFromCookieHeader(req.headers.cookie, ACCESS_COOKIE)
    );
}

export function readRefreshToken(req) {
    return extractTokenFromCookieHeader(req.headers.cookie, REFRESH_COOKIE);
}

/** Gửi lỗi authz ra HTTP đúng chuẩn (401/403/503/502/500) + Retry-After. */
export function sendAuthzError(res, err) {
    const { statusCode, message, retryAfterSec } = mapAuthzErrorToHttp(err);
    if (retryAfterSec) res.set('Retry-After', String(retryAfterSec));
    res.status(statusCode).json({ error: message });
}

/**
 * Xác thực: token → req.authzUser. Tự rotate token khi sắp hết hạn
 * (refreshIfNeeded có single-flight theo refresh token nên gọi song song an toàn).
 */
export async function authenticate(req, res, next) {
    const token = readAccessToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Chưa đăng nhập' });
    }

    try {
        let active = token;
        const refresh = readRefreshToken(req);
        if (refresh) {
            const rotated = await session.refreshIfNeeded(token, refresh);
            if (rotated) {
                cookies.setSession(cookieWriter(res), rotated);
                active = rotated.accessToken;
            }
        }

        const user = await session.verify(active);

        // isActive/isApproved là trạng thái tài khoản, không phải quyền — token
        // vẫn hợp lệ nhưng user đã bị vô hiệu/chưa duyệt thì không cho vào.
        if (!user.isActive || !user.isApproved) {
            return res.status(403).json({
                error: user.isActive ? 'Tài khoản chưa được duyệt' : 'Tài khoản đã bị vô hiệu hoá'
            });
        }

        req.authzUser = user;
        req.authzToken = active;
        next();
    } catch (err) {
        sendAuthzError(res, err);
    }
}

/** Quyền cấp system (domain '*') — cách hỏi cũ, vẫn dùng cho scope không thuộc project. */
function enforceSystem(userId, action) {
    return session.enforce({ userId, resource: RESOURCE, action, domain: SYSTEM_DOMAIN });
}

/**
 * Quyền trong một folder bucket. OR trên mọi authz slug đã map với folder đó;
 * `enforceActionAcrossProjects` tự thêm domain '*' nên role system vẫn đi lọt.
 *
 * Folder chưa map slug nào → chỉ role system qua được. Fail closed: onboard
 * thiếu bước map thì folder khoá, chứ không mở toang.
 */
export async function enforceInProject(userId, action, bucketPrefix) {
    const projectSlugs = await slugsForPrefix(bucketPrefix);
    return enforceActionAcrossProjects({
        session,
        userId,
        resource: RESOURCE,
        action,
        projectSlugs
    });
}

/**
 * Quyết định cho một request đã biết action.
 * Trả `{ allowed, prefix }`; ở chế độ shadow còn ghi lại chênh lệch.
 */
async function decide(req, action) {
    const { prefix, invalid } = resolveBucketPrefix(req);
    if (invalid) return { allowed: false, prefix: null, reason: 'Đường dẫn không hợp lệ' };

    const userId = req.authzUser.id;

    // Ngoài phạm vi project (file lẻ ở gốc bucket, request không mang vị trí)
    // → hỏi như cũ ở domain '*'.
    if (PROJECT_SCOPE === 'off' || prefix === null) {
        return { allowed: await enforceSystem(userId, action), prefix };
    }

    if (PROJECT_SCOPE === 'on') {
        return { allowed: await enforceInProject(userId, action, prefix), prefix };
    }

    // shadow: quyết định vẫn theo system, ghi lại chênh lệch với chế độ 'on'.
    //
    // Chênh lệch chỉ có thể theo MỘT chiều. `enforceActionAcrossProjects` dò
    // các domain `project:<slug>` VÀ domain '*', nên tập quyền của 'on' là tập
    // cha của 'off' — bật 'on' không bao giờ lấy đi quyền của ai (đã kiểm
    // trên hệ thống thật: folder chưa map, scope 'on', admin vẫn read được).
    //
    // Thứ đáng ghi vì thế là chiều ngược lại: ai đang BỊ CHẶN mà bật 'on' sẽ
    // vào được — tức thành viên project đang bị khoá oan.
    const [systemAllowed, projectAllowed] = await Promise.all([
        enforceSystem(userId, action),
        enforceInProject(userId, action, prefix)
    ]);
    if (!systemAllowed && projectAllowed) {
        record({
            userId,
            userEmail: req.authzUser.email,
            action,
            outcome: 'shadow-allow',
            bucketPrefix: prefix,
            objectKey: req.query?.key || req.body?.key || null,
            method: req.method,
            path: req.path,
            detail: { note: 'bật AUTHZ_PROJECT_SCOPE=on sẽ CHO PHÉP request này' }
        });
    }
    return { allowed: systemAllowed, prefix };
}

/** Yêu cầu 1 action trên RESOURCE, scope theo project của request. Dùng sau `authenticate`. */
export function requireAction(action) {
    return async (req, res, next) => {
        // Gán sớm để middleware audit ghi được cả những request bị chặn ngay dưới đây.
        req.authzAction = action;
        try {
            const { allowed, prefix, reason } = await decide(req, action);
            req.bucketPrefix = prefix;
            if (!allowed) {
                return res.status(403).json({
                    error:
                        reason ||
                        (prefix
                            ? `Không có quyền "${action}" trong project "${prefix}"`
                            : `Không có quyền "${action}" trên ${RESOURCE}`)
                });
            }
            next();
        } catch (err) {
            sendAuthzError(res, err);
        }
    };
}

/**
 * "Là admin/owner cấp system?" — hỏi bằng ROLE, không bằng quyền trên
 * RESOURCE.
 *
 * Không dùng `enforce(update, dom='*')` làm proxy: ở system này
 * `no-code-editor:admin` chỉ có `read` trên `:layout` (thiếu p-rule), nên proxy
 * đó chặn đúng người đáng lẽ được quản trị. Role mới là thứ đang được hỏi.
 */
export async function isSystemAdmin(userId) {
    // getRoles → /auth/user-system-roles, đã lọc theo systemCode và chỉ trả role
    // ở domain '*'. Role project (`project:editor` ở domain `project:<slug>`)
    // KHÔNG lọt vào đây — đã kiểm bằng cách gọi thật cả hai endpoint.
    //
    // Đừng lọc danh sách này qua filterOutProjectScopedRoles: role system của
    // system này tên đúng là 'admin'/'owner'/'editor'/'viewer', trùng tên pool
    // project, lọc là xoá sạch cả role thật.
    const roles = await session.getRoles(userId).catch(() => []);
    return isAdminRole(pickHighestRole(roles));
}

/** Chặn route chỉ dành cho admin/owner cấp system (quản lý mapping). */
export function requireSystemAdmin(req, res, next) {
    req.authzAction = req.authzAction || 'read';
    isSystemAdmin(req.authzUser.id)
        .then((ok) =>
            ok
                ? next()
                : res.status(403).json({ error: 'Chỉ admin/owner cấp system dùng được mục này' })
        )
        .catch((err) => sendAuthzError(res, err));
}

/** Chặn route xem audit log — dùng resource audit-log có sẵn của authz. */
export function requireAuditRead(req, res, next) {
    req.authzAction = 'read';
    session
        .enforce({
            userId: req.authzUser.id,
            resource: AUDIT_RESOURCE,
            action: 'read',
            domain: SYSTEM_DOMAIN
        })
        .then((ok) => (ok ? next() : res.status(403).json({ error: 'Không có quyền xem audit log' })))
        .catch((err) => sendAuthzError(res, err));
}
