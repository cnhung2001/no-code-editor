// ── Adapter S3 THẬT: gọi backend proxy (server/index.mjs) ─────────────────
// Backend giữ AWS credentials; frontend không bao giờ chạm trực tiếp tới creds.

import type {
    S3Adapter,
    S3Item,
    ProjectInfo,
    LayoutStatus,
    LayoutMeta,
    PublishOptions
} from '../types';

const BASE = import.meta.env.VITE_API_BASE || '/api';

async function j<T>(res: Response): Promise<T> {
    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`S3 API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
}

export const apiAdapter: S3Adapter = {
    async listProjects() {
        return j<ProjectInfo[]>(await fetch(`${BASE}/projects`));
    },

    async listPath(prefix: string) {
        const q = new URLSearchParams({ prefix });
        return j<S3Item[]>(await fetch(`${BASE}/list?${q}`));
    },

    async getObjectText(key: string) {
        const q = new URLSearchParams({ key });
        const res = await fetch(`${BASE}/object?${q}`);
        if (!res.ok) throw new Error(`getObject ${res.status}`);
        return res.text();
    },

    async getAssetUrl(key: string) {
        // Ưu tiên CDN công khai nếu cấu hình; ngược lại stream qua backend proxy
        // (cùng origin → editor fetch() ảnh/lottie không bị S3 CORS chặn).
        const cdn = import.meta.env.VITE_CDN_BASE;
        if (cdn) return `${cdn.replace(/\/$/, '')}/${key}`;
        return `${BASE}/asset?${new URLSearchParams({ key })}`;
    },

    async putObject(key: string, body: string, status?: LayoutStatus, meta?: LayoutMeta) {
        await j(
            await fetch(`${BASE}/object`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ key, body, status, meta })
            })
        );
    },

    async deleteObject(key: string) {
        const q = new URLSearchParams({ key });
        await j(await fetch(`${BASE}/object?${q}`, { method: 'DELETE' }));
    },

    async uploadAsset(project: string, file: File) {
        const form = new FormData();
        form.append('project', project);
        form.append('file', file, file.name);
        const { url } = await j<{ url: string }>(
            await fetch(`${BASE}/upload`, { method: 'POST', body: form })
        );
        return url;
    },

    async publish(key: string, body: string, opts: PublishOptions) {
        await j(
            await fetch(`${BASE}/publish`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ key, body, ...opts })
            })
        );
    }
};
