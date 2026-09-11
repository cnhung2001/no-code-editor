// ── Link công khai của một object trong bucket ──────────────────────────────
// Cùng quy ước với s3.getAssetUrl(): CDN nếu có cấu hình. Khác một điểm: hàm
// này không bao giờ trả URL proxy /api/asset — nó dùng để HIỂN THỊ và copy ra
// ngoài editor (metadata, remote_url của SDK), nên phải là link thật.

export const S3_BUCKET = 'ik-nocode-paywall';

const CDN_BASE = (import.meta.env.VITE_CDN_BASE || '').replace(/\/$/, '');

/**
 * URL https đọc được của `key`.
 *
 * Ưu tiên CDN — đó chính là host SDK pull layout về, nên link này copy được
 * thẳng vào `remote_url` của Remote Config. Không cấu hình CDN thì trả URL
 * virtual-hosted của S3 để vẫn là một link đầy đủ thay vì scheme `s3://`.
 */
export function objectUrl(key: string): string {
    return CDN_BASE ? `${CDN_BASE}/${key}` : `https://${S3_BUCKET}.s3.amazonaws.com/${key}`;
}
