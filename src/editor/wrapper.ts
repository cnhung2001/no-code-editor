// ── Cầu nối định dạng JSON giữa Editor và S3 ──────────────────────────────
// Editor.getValue() trả wrapper: { screen_id?, label?, remote_layout: {card,templates}, variables? }
// File trên S3 (client native đang đọc) ở dạng DivKit THUẦN: { card, templates }.
//
// VITE_SAVE_FORMAT:
//   "plain"   → lưu remote_layout (DivKit thuần) — tương thích client cũ (mặc định)
//   "wrapper" → lưu nguyên wrapper

import { restoreAssetUrls } from './resolveAssets';

const SAVE_FORMAT = (import.meta.env.VITE_SAVE_FORMAT || 'plain') as 'plain' | 'wrapper';

interface Wrapper {
    screen_id?: string;
    label?: string;
    remote_layout?: unknown;
    variables?: unknown;
    card?: unknown;
}

/** Chuẩn hoá giá trị editor về định dạng sẽ ghi lên S3. */
export function toSaveFormat(editorValue: string): string {
    // Đảo proxy CORS (/api/asset?key=…) về URL công khai TRƯỚC khi lưu lên S3.
    const value = restoreAssetUrls(editorValue);
    if (SAVE_FORMAT === 'wrapper') return value;
    let obj: Wrapper;
    try {
        obj = JSON.parse(value);
    } catch {
        return value;
    }
    // Nếu là wrapper → gỡ remote_layout về DivKit thuần
    if (obj && typeof obj === 'object' && obj.remote_layout) {
        return JSON.stringify(obj.remote_layout, null, 2);
    }
    return JSON.stringify(obj, null, 2);
}

/**
 * Trích metadata cấp file (screen_id, label) từ giá trị editor.
 * Ở định dạng "plain", body lưu lên S3 là DivKit thuần nên 2 field này bị gỡ khỏi body
 * → trả riêng để lưu vào S3 object metadata, tránh mất khi push.
 */
export function extractMeta(editorValue: string): { screen_id?: string; label?: string } {
    try {
        const o = JSON.parse(editorValue) as Wrapper;
        const meta: { screen_id?: string; label?: string } = {};
        if (typeof o.screen_id === 'string' && o.screen_id) meta.screen_id = o.screen_id;
        if (typeof o.label === 'string' && o.label) meta.label = o.label;
        return meta;
    } catch {
        return {};
    }
}

/** Editor.setDivJson chấp nhận cả 2 dạng → load truyền thẳng, chỉ cần đảm bảo chuỗi hợp lệ. */
export function toEditorValue(s3Json: string): string {
    return s3Json;
}

/** Trích log_id để hiển thị metadata, chấp nhận cả 2 dạng. */
export function extractLogId(json: string): string {
    try {
        const o = JSON.parse(json) as Wrapper;
        const card = (o.remote_layout as { card?: { log_id?: string } })?.card ?? (o.card as { log_id?: string });
        return card?.log_id || '—';
    } catch {
        return '—';
    }
}
