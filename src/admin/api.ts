// ── Client cho /api/admin/* ───────────────────────────────────────────────
// Backend gate bằng authz (requireSystemAdmin / requireAuditRead); ở đây chỉ
// gọi và dịch lỗi ra thông điệp đọc được.

import { assertAuthorized } from '../auth/session';

const BASE = import.meta.env.VITE_API_BASE || '/api';

export interface ProjectMapping {
    id: number;
    bucketPrefix: string;
    displayName: string | null;
    isActive: boolean;
    authzSlugs: string[];
}

export interface MappingsResponse {
    mappings: ProjectMapping[];
    /** Folder cấp 1 thật trong bucket — để chỉ ra folder nào chưa được map. */
    bucketPrefixes: string[];
    scope: 'off' | 'shadow' | 'on';
}

export interface AuditRow {
    id: string;
    at: string;
    user_id: string | null;
    user_email: string | null;
    action: string;
    outcome: string;
    bucket_prefix: string | null;
    object_key: string | null;
    method: string | null;
    path: string | null;
    status_code: number | null;
    s3_version_id: string | null;
    detail: Record<string, unknown> | null;
    ip: string | null;
}

async function j<T>(res: Response): Promise<T> {
    await assertAuthorized(res);
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
}

const jsonHeaders = { 'content-type': 'application/json' };

export async function listMappings(): Promise<MappingsResponse> {
    return j<MappingsResponse>(await fetch(`${BASE}/admin/projects`, { credentials: 'same-origin' }));
}

export async function saveMapping(input: {
    bucketPrefix: string;
    displayName?: string;
    authzSlugs: string[];
}): Promise<void> {
    await j(
        await fetch(`${BASE}/admin/projects`, {
            method: 'POST',
            headers: jsonHeaders,
            credentials: 'same-origin',
            body: JSON.stringify(input)
        })
    );
}

export async function updateMapping(
    id: number,
    input: { displayName?: string; isActive?: boolean; authzSlugs?: string[] }
): Promise<void> {
    await j(
        await fetch(`${BASE}/admin/projects/${id}`, {
            method: 'PATCH',
            headers: jsonHeaders,
            credentials: 'same-origin',
            body: JSON.stringify(input)
        })
    );
}

export async function removeMapping(id: number): Promise<void> {
    await j(
        await fetch(`${BASE}/admin/projects/${id}`, {
            method: 'DELETE',
            credentials: 'same-origin'
        })
    );
}

export interface AuditFilter {
    project?: string;
    user?: string;
    action?: string;
    from?: string;
    to?: string;
    limit?: number;
}

export async function listAudit(filter: AuditFilter = {}): Promise<AuditRow[]> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) {
        if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    }
    return j<AuditRow[]>(
        await fetch(`${BASE}/admin/audit?${q}`, { credentials: 'same-origin' })
    );
}
