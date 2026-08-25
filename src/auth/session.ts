// ── Xử lý mất session ở tầng fetch ────────────────────────────────────────
// Backend đã tự rotate token khi sắp hết hạn, nên 401 nghĩa là session thật sự
// đã chết (hết hạn hẳn, bị revoke, hoặc tài khoản bị vô hiệu) → đưa về login.

/** Điều hướng ra /auth/login, nhớ lại trang đang đứng để quay về sau. */
export function redirectToLogin(): never {
    const next = window.location.pathname + window.location.search;
    window.location.href = `/auth/login?next=${encodeURIComponent(next)}`;
    // Gán location là async; throw để caller không chạy tiếp trên state đã chết.
    throw new Error('Session hết hạn — đang chuyển tới trang đăng nhập');
}

/** Gọi trước khi đọc body: 401 → bật ra login, 403 → ném lỗi có thông điệp. */
export async function assertAuthorized(res: Response): Promise<Response> {
    if (res.status === 401) redirectToLogin();
    if (res.status === 403) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Bạn không có quyền thực hiện thao tác này');
    }
    return res;
}
