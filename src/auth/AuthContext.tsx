// ── Danh tính + quyền, lấy từ backend ─────────────────────────────────────
// Token KHÔNG chứa role; quyền resolve live từ casbin qua GET /api/me. Frontend
// không bao giờ giữ API key — mọi câu hỏi về quyền đều đi qua backend.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

const BASE = import.meta.env.VITE_API_BASE || '/api';

export interface AuthUser {
    id: string;
    email: string;
    name?: string;
    avatar?: string;
    /** Display-only. Không bao giờ dùng để quyết định quyền. */
    positionCode: string | null;
}

export interface Me {
    user: AuthUser;
    roles: string[];
    resource: string;
    perms: Record<string, boolean>;
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
    perms: Perms;
    error: string | null;
    reload(): void;
    logout(): Promise<void>;
}

const NO_PERMS: Perms = { read: false, update: false, publish: false, delete: false };

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

    const perms: Perms = me
        ? {
              read: !!me.perms.read,
              update: !!me.perms.update,
              publish: !!me.perms.publish,
              delete: !!me.perms.delete
          }
        : NO_PERMS;

    return (
        <AuthCtx.Provider
            value={{
                status,
                user: me?.user ?? null,
                roles: me?.roles ?? [],
                perms,
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

/** Shortcut cho component chỉ cần biết được làm gì. */
export function usePerms(): Perms {
    return useAuth().perms;
}
