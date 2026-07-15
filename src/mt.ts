// ── Machine translation client → backend /api/translate ──────────────────
// Engine dịch (stub / rc-admin) nằm ở server; frontend chỉ gọi qua đây.
// Dùng cho tính năng Localize: dịch 1 chuỗi nguồn sang nhiều locale.

const BASE = import.meta.env.VITE_API_BASE || '/api';

export interface TranslateOpts {
    tone?: 'neutral' | 'formal' | 'friendly';
    maxLength?: number;
}

/** Dịch `text` (ngôn ngữ `from`) sang danh sách `targets`. Trả { locale: text }. */
export async function translate(
    text: string,
    from: string,
    targets: string[],
    opts?: TranslateOpts
): Promise<Record<string, string>> {
    const res = await fetch(`${BASE}/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, from, targets, ...opts })
    });
    if (!res.ok) {
        const t = await res.text().catch(() => res.statusText);
        throw new Error(`translate ${res.status}: ${t}`);
    }
    const data = (await res.json()) as { translations?: Record<string, string> };
    return data.translations || {};
}
