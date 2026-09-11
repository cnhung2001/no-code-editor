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
    PROJECT_SCOPE,
    REDIRECT_URI,
    RESOURCE,
    SYSTEM_DOMAIN,
    authenticate,
    authz,
    cookies,
    cookieWriter,
    enforceInProject,
    isSystemAdmin,
    readAccessToken,
    sendAuthzError,
    session
} from './authz.mjs';
import { recordAuth } from './audit.mjs';
import { resolveBucketPrefix } from './project-scope.mjs';

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

        recordAuth(req, { action: 'login', outcome: 'allow', user });
        res.redirect(next);
    } catch (err) {
        recordAuth(req, { action: 'login', outcome: 'error' });
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
    // Không có req.authzUser (route này không qua `authenticate`) — logout phải
    // chạy được cả khi token đã chết, nên chỉ ghi được sự kiện, không ghi ai.
    recordAuth(req, { action: 'logout', outcome: 'allow' });
    res.json({ ok: true });
});

// ── GET /api/me ──
// "Tôi là ai" + quyền CẤP SYSTEM. Quyền trong từng project hỏi riêng qua
// /api/me/perms — không gộp vào đây vì user có thể có quyền ở 17 folder khác
// nhau, resolve hết mỗi lần load app là 17×4 lần enforce.
// Quyền resolve live từ casbin mỗi lần gọi — token KHÔNG chứa role.
authRouter.get('/api/me', authenticate, async (req, res) => {
    try {
        const user = req.authzUser;
        const [perms, roles, systemAdmin] = await Promise.all([
            session.resolveContentPermissions({
                userId: user.id,
                resource: RESOURCE,
                domain: SYSTEM_DOMAIN,
                actions: ACTIONS
            }),
            session.getRoles(user.id).catch(() => []),
            isSystemAdmin(user.id).catch(() => false)
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
            perms,
            // Frontend cần biết đang ở chế độ nào để không hiển thị quyền project
            // khi backend vẫn quyết định theo system.
            projectScope: PROJECT_SCOPE,
            // Chỉ để ẩn/hiện mục Admin. Hỏi bằng ROLE chứ không suy từ perms:
            // `no-code-editor:admin` không có `update` trên :layout, suy từ perms
            // sẽ giấu mục Admin khỏi đúng người cần nó.
            isSystemAdmin: systemAdmin
        });
    } catch (err) {
        sendAuthzError(res, err);
    }
});

// ── GET /api/me/perms?project=<bucket prefix> ──
// Quyền của user trong đúng một folder bucket. UI gọi khi mở project để biết
// nút Save/Push/Delete có hiện hay không.
authRouter.get('/api/me/perms', authenticate, async (req, res) => {
    const { prefix, invalid } = resolveBucketPrefix(req);
    if (invalid) return res.status(400).json({ error: 'project không hợp lệ' });

    try {
        const user = req.authzUser;

        // Chưa bật scope, hoặc hỏi ở gốc bucket → quyền chính là quyền system.
        if (PROJECT_SCOPE !== 'on' || prefix === null) {
            const perms = await session.resolveContentPermissions({
                userId: user.id,
                resource: RESOURCE,
                domain: SYSTEM_DOMAIN,
                actions: ACTIONS
            });
            return res.json({ project: prefix, scoped: false, perms });
        }

        const results = await Promise.all(
            ACTIONS.map(async (action) => [action, await enforceInProject(user.id, action, prefix)])
        );
        res.json({ project: prefix, scoped: true, perms: Object.fromEntries(results) });
    } catch (err) {
        sendAuthzError(res, err);
    }
});
