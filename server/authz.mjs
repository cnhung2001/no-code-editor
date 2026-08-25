// ── authz (sl-authenz) wiring ─────────────────────────────────────────────
// AUTHZ_API_KEY chỉ tồn tại ở tiến trình này. Frontend không bao giờ thấy nó:
// browser hỏi quyền qua GET /api/me, backend mới gọi authz.

import { AuthzClient } from '@ikameglobal/authz-sdk';
import {
    asCookieWriter,
    createAuthCookieHelpers,
    createDirectTransport,
    createSessionManager,
    extractTokenFromCookieHeader,
    extractTokenFromHeaders,
    mapAuthzErrorToHttp
} from '@ikameglobal/authz-sdk/common';

const {
    AUTHZ_SYSTEM_CODE,
    AUTHZ_API_KEY,
    AUTHZ_REDIRECT_URI,
    APP_BASE_URL = 'http://localhost:8080',
    NODE_ENV
} = process.env;

if (!AUTHZ_SYSTEM_CODE || !AUTHZ_API_KEY) {
    throw new Error('Thiếu AUTHZ_SYSTEM_CODE / AUTHZ_API_KEY trong server/.env');
}

export const BASE_URL = APP_BASE_URL.replace(/\/$/, '');

// Redirect URI phải khớp TỪNG BYTE với entry trong allowlist của system
// (authz match tuyệt đối: không wildcard, không prefix, dấu / cuối cũng tính).
export const REDIRECT_URI = AUTHZ_REDIRECT_URI || `${BASE_URL}/auth/callback`;

export const RESOURCE = `${AUTHZ_SYSTEM_CODE}:layout`;

// Không có "create": backend không phân biệt được PUT tạo mới vs ghi đè nếu
// không thêm một HeadObject cho mọi lần save, và không role nào cần
// create-mà-không-update. "New layout" dùng chung quyền `update`.
export const ACTIONS = ['read', 'update', 'publish', 'delete'];

// Casbin domain. '*' = system-wide. Chuyển sang projectDomain(slug) khi bật
// phân quyền theo từng project trong bucket.
export const DOMAIN = '*';

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

/** Yêu cầu 1 action trên RESOURCE. Dùng sau `authenticate`. */
export function requireAction(action) {
    return async (req, res, next) => {
        try {
            const allowed = await session.enforce({
                userId: req.authzUser.id,
                resource: RESOURCE,
                action,
                domain: DOMAIN
            });
            if (!allowed) {
                return res.status(403).json({
                    error: `Không có quyền "${action}" trên ${RESOURCE}`
                });
            }
            next();
        } catch (err) {
            sendAuthzError(res, err);
        }
    };
}
