// ── Màn đăng nhập ─────────────────────────────────────────────────────────
// Không có form: toàn bộ OAuth do authz lo, app chỉ điều hướng ra /auth/login.

import { Icon } from '../lib/icons';

// Mã lỗi do /auth/callback nhét vào query khi exchange thất bại.
const ERROR_TEXT: Record<string, string> = {
    unauthorized: 'Token bị từ chối. Đăng nhập lại.',
    forbidden: 'Tài khoản không được phép vào hệ thống này.',
    service_unavailable: 'authz đang quá tải hoặc lỗi. Thử lại sau ít phút.',
    exchange_failed: 'Đổi mã đăng nhập thất bại. Thử lại.',
    missing_code: 'Thiếu mã đăng nhập trong callback. Thử lại.'
};

export function LoginScreen({ notice }: { notice?: string | null }) {
    const code = new URLSearchParams(window.location.search).get('auth_error');
    const message = notice || (code ? ERROR_TEXT[code] || `Đăng nhập lỗi (${code})` : null);

    return (
        <div className="login">
            <div className="login-card">
                <div className="login-brand">
                    <span className="brand-mark">&lt;/&gt;</span>
                    <div>
                        <div className="brand-name">NoCode Editor</div>
                        <div className="brand-sub">iKame NoCode · Remote Config</div>
                    </div>
                </div>

                <p className="login-lead">
                    Đăng nhập bằng tài khoản iKame để quản lý remote layout trên S3.
                </p>

                {message && <div className="login-error">{message}</div>}

                <a className="btn primary login-btn" href="/auth/login">
                    {Icon.external} Đăng nhập với iKame SSO
                </a>

                <div className="login-foot">
                    Quyền do <code>authz.begamob.com</code> cấp. Không thấy dữ liệu sau khi đăng nhập
                    nghĩa là tài khoản chưa được gán role trên hệ thống này.
                </div>
            </div>
        </div>
    );
}
