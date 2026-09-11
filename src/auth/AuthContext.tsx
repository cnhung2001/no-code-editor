// ── Danh tính + quyền, lấy từ backend ─────────────────────────────────────
// Token KHÔNG chứa role; quyền resolve live từ casbin qua GET /api/me. Frontend
// không bao giờ giữ API key — mọi câu hỏi về quyền đều đi qua backend.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const BASE = import.meta.env.VITE_API_BASE || '/api';

export interface AuthUser {
    id: string;
    email: string;
    name?: string;
    avatar?: string;
    /** Display-only. Không bao giờ dùng để quyết định quyền. */
    positionCode: string | null;
}

/** off = quyết định theo quyền system; on = theo từng project; shadow = như off nhưng có log. */
export type ProjectScope = 'off' | 'shadow' | 'on';

export interface Me {
    user: AuthUser;
    roles: string[];
    resource: string;
    /** Quyền CẤP SYSTEM. Quyền trong từng project lấy qua useProjectPerms(). */
    perms: Record<string, boolean>;
    projectScope?: ProjectScope;
    isSystemAdmin?: boolean;
}

export interface Perms {
    read: boolean;
    update: boolean;
    publish: boolean;
    delete: boolean;
}

type Status = 'loading' | 'anonymous' | 'ready' | 'error';

interface AuthState {
    status: Status;
    user: AuthUser | null;
    roles: string[];
    /** Quyền cấp system. Component thao tác trên file phải dùng useProjectPerms(). */
    perms: Perms;
    projectScope: ProjectScope;
    /** admin/owner cấp system — chỉ dùng để ẩn/hiện mục Admin. */
    isSystemAdmin: boolean;
    error: string | null;
    reload(): void;
    logout(): Promise<void>;
}

const NO_PERMS: Perms = { read: false, update: false, publish: false, delete: false };

function toPerms(raw: Record<string, boolean> | undefined | null): Perms {
    if (!raw) return NO_PERMS;
    return {
        read: !!raw.read,
        update: !!raw.update,
        publish: !!raw.publish,
        delete: !!raw.delete
    };
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<Status>('loading');
    const [me, setMe] = useState<Me | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setStatus('loading');
        setError(null);
        try {
            const res = await fetch(`${BASE}/me`, { credentials: 'same-origin' });
            if (res.status === 401) {
                setMe(null);
                setStatus('anonymous');
                return;
            }
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error || `/me trả ${res.status}`);
            }
            setMe((await res.json()) as Me);
            setStatus('ready');
        } catch (e) {
            setError(String((e as Error).message || e));
            setStatus('error');
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const logout = useCallback(async () => {
        try {
            await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
        } finally {
            // Reload cả trang: xoá sạch state layout/editor đang giữ trong memory.
            window.location.href = '/';
        }
    }, []);

    // PHẢI memo theo `me`: useProjectPerms có `systemPerms` trong dependency của
    // useEffect. Tạo object mới mỗi render → effect chạy lại → setPerms → render
    // → object mới… vòng lặp vô hạn.
    const perms = useMemo(() => toPerms(me?.perms), [me]);

    return (
        <AuthCtx.Provider
            value={{
                status,
                user: me?.user ?? null,
                roles: me?.roles ?? [],
                perms,
                projectScope: me?.projectScope ?? 'off',
                isSystemAdmin: me?.isSystemAdmin ?? false,
                error,
                reload: load,
                logout
            }}
        >
            {children}
        </AuthCtx.Provider>
    );
}

export function useAuth(): AuthState {
    const ctx = useContext(AuthCtx);
    if (!ctx) throw new Error('useAuth phải nằm trong <AuthProvider>');
    return ctx;
}

/** Quyền CẤP SYSTEM. Đừng dùng để gate nút thao tác trên file — xem useProjectPerms. */
export function usePerms(): Perms {
    return useAuth().perms;
}

// Quyền theo project đổi rất hiếm nhưng bị hỏi lại mỗi lần điều hướng giữa các
// màn. Cache ở module để chuyển Browser → Preview → Builder trong cùng project
// không bắn thêm request nào.
const projectPermsCache = new Map<string, Perms>();

/** Xoá cache sau khi phân quyền đổi (vd admin vừa sửa mapping). */
export function clearProjectPermsCache() {
    projectPermsCache.clear();
}

/**
 * Quyền của user trong đúng một folder bucket.
 *
 * Trả về quyền cấp system khi chưa bật scope hoặc khi không ở trong project nào
 * (`prefix` rỗng) — backend quyết định điều đó, frontend không tự suy.
 */
export function useProjectPerms(prefix: string | null | undefined): Perms {
    const { perms: systemPerms, projectScope } = useAuth();
    const scoped = projectScope === 'on' && Boolean(prefix);
    const [perms, setPerms] = useState<Perms>(() =>
        scoped ? projectPermsCache.get(prefix as string) ?? NO_PERMS : systemPerms
    );

    useEffect(() => {
        if (!scoped) {
            setPerms(systemPerms);
            return;
        }
        const key = prefix as string;
        const cached = projectPermsCache.get(key);
        if (cached) {
            setPerms(cached);
            return;
        }

        let alive = true;
        // Mặc định KHÔNG quyền trong lúc chờ: hiện nút Save rồi mới ẩn đi sẽ cho
        // người dùng bấm vào thứ chắc chắn 403.
        setPerms(NO_PERMS);
        fetch(`${BASE}/me/perms?project=${encodeURIComponent(key)}`, { credentials: 'same-origin' })
            .then((res) => (res.ok ? res.json() : null))
            .then((data: { perms?: Record<string, boolean> } | null) => {
                if (!alive || !data) return;
                const next = toPerms(data.perms);
                projectPermsCache.set(key, next);
                setPerms(next);
            })
            .catch(() => {
                /* giữ NO_PERMS — thà ẩn nút còn hơn cho bấm rồi 403 */
            });
        return () => {
            alive = false;
        };
    }, [prefix, scoped, systemPerms]);

    return perms;
}
