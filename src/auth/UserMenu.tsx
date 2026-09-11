// ── Badge user + role + logout ────────────────────────────────────────────
import { useAuth } from './AuthContext';

export function UserMenu() {
    const { user, roles, logout } = useAuth();
    if (!user) return null;

    const label = user.name || user.email;
    const role = roles.length ? roles.join(', ') : 'chưa có role';

    return (
        // Xếp dọc: sidebar chỉ rộng 248px, để nút Đăng xuất cùng hàng thì tên
        // user bị cắt còn "Dev S…". Hàng riêng cho nút là đủ chỗ cho cả hai.
        <div className="user-box">
            <div className="user-menu" title={`${user.email}\nrole: ${role}`}>
                {user.avatar ? (
                    <img className="user-avatar" src={user.avatar} alt={label} />
                ) : (
                    <span className="user-avatar user-avatar--fallback">{label.slice(0, 1).toUpperCase()}</span>
                )}
                <div className="user-meta">
                    <span className="user-name">{label}</span>
                    <span className="user-role">{role}</span>
                </div>
            </div>
            <button className="btn ghost sm user-logout" onClick={logout}>Đăng xuất</button>
        </div>
    );
}
