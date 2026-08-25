// ── Auth routes: login → authz → callback → cookie ────────────────────────
// App không bao giờ thấy Google. authz lo toàn bộ OAuth; ta chỉ redirect ra và
// nhận `code` về, rồi đổi code lấy token bằng API key (bắt buộc server-side).

import { Router } from 'express';
import {
    fetchRoleSignals,
    formatErrorCodeForRedirect,
    normalizeRedirectTarget,
    performLogout
} from '@ikameglobal/authz-sdk/common';
import {
    ACTIONS,
    DOMAIN,
    REDIRECT_URI,
    RESOURCE,
    authenticate,
    authz,
    cookies,
    cookieWriter,
    readAccessToken,
    sendAuthzError,
    session
} from './authz.mjs';

// Nhớ trang user đang đứng trước khi bị bật ra login. Ngắn hạn, httpOnly.
const NEXT_COOKIE = 'auth_next';
const NEXT_MAX_AGE_MS = 5 * 60 * 1000;

export const authRouter = Router();

// ── GET /auth/login ──
authRouter.get('/auth/login', (req, res) => {
    // normalizeRedirectTarget chặn open-redirect (//evil.com, URL tuyệt đối, backslash)
    const next = normalizeRedirectTarget(req.query.next, '/');
    res.cookie(NEXT_COOKIE, next, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: NEXT_MAX_AGE_MS,
        secure: process.env.NODE_ENV === 'production'
    });
    res.redirect(authz.getConnectUrl({ redirectUri: REDIRECT_URI }));
});

// ── GET /auth/callback?code= ──
authRouter.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    const next = normalizeRedirectTarget(req.cookies?.[NEXT_COOKIE], '/');
    res.clearCookie(NEXT_COOKIE, { path: '/' });

    if (!code) {
        return res.redirect(`/?auth_error=missing_code`);
    }

    try {
        // Auth code sống 60s và dùng một lần.
        const tokens = await authz.exchangeCode(String(code));
        cookies.setSession(cookieWriter(res), tokens);

        const user = await session.verify(tokens.accessToken);

        // Đọc role ngay sau login có thể ra rỗng vì casbin chưa propagate.
        // fetchRoleSignals retry [150,400]ms và làm nóng cache của SessionManager
        // → request /api/me ngay sau redirect không bị "admin trông như viewer".
        await fetchRoleSignals(session, user.id);

        res.redirect(next);
    } catch (err) {
        res.redirect(`/?auth_error=${formatErrorCodeForRedirect(err)}`);
    }
});

// ── POST /auth/logout ──
// POST (không GET) để link/prefetch/<img> không đăng xuất được hộ user.
authRouter.post('/auth/logout', async (req, res) => {
    const accessToken = readAccessToken(req);
    await performLogout({
        accessToken,
        revoke: (at) => authz.logout(at),
        sessionManager: session,
        cookieHelpers: cookies,
        cookieWriter: cookieWriter(res),
        // Revoke là best-effort: authz không phản hồi thì vẫn phải clear cookie.
        onError: (err) => console.warn('[authz] revoke thất bại:', err?.message || err)
    });
    res.json({ ok: true });
});

// ── GET /api/me ──
// Endpoint duy nhất frontend dùng để biết "tôi là ai" và "tôi được làm gì".
// Quyền resolve live từ casbin mỗi lần gọi — token KHÔNG chứa role.
authRouter.get('/api/me', authenticate, async (req, res) => {
    try {
        const user = req.authzUser;
        const [perms, roles] = await Promise.all([
            session.resolveContentPermissions({
                userId: user.id,
                resource: RESOURCE,
                domain: DOMAIN,
                actions: ACTIONS
            }),
            session.getRoles(user.id).catch(() => [])
        ]);

        res.json({
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                avatar: user.avatar,
                // positionCode là display-only, tuyệt đối không branch quyền theo nó.
                positionCode: user.positionCode ?? null
            },
            roles,
            resource: RESOURCE,
            perms
        });
    } catch (err) {
        sendAuthzError(res, err);
    }
});
