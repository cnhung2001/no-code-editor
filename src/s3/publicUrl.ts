// ── Link công khai của một object trong bucket ──────────────────────────────
// Cùng quy ước với s3.getAssetUrl(): CDN nếu có cấu hình. Khác một điểm: hàm
// này không bao giờ trả URL proxy /api/asset — nó dùng để HIỂN THỊ và copy ra
// ngoài editor (metadata, remote_url của SDK), nên phải là link thật.

export const S3_BUCKET = 'ik-nocode-paywall';

// Cùng region với server (AWS_REGION, mặc định ap-southeast-1). Phải có region
// trong host: dạng không region chỉ đúng cho us-east-1, bucket ở region khác thì
// S3 trả 301/307 — link vẫn "chạy" nhờ redirect nhưng hỏng ở mọi client không
// tự follow redirect.
const S3_REGION = import.meta.env.VITE_S3_REGION || 'ap-southeast-1';

const CDN_BASE = (import.meta.env.VITE_CDN_BASE || '').replace(/\/$/, '');

/**
 * URL S3 TRỰC TIẾP, không qua CDN.
 *
 * Dùng cho bản nháp: nháp được ghi đè liên tục và không có ai purge cache sau
 * mỗi lần lưu, nên link CDN của nháp là cái bẫy — mở ra trúng bản cũ mà tưởng
 * mình vừa lưu hỏng. Đường thẳng tới S3 thì luôn là bản vừa ghi.
 */
export function s3DirectUrl(key: string): string {
    return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
}

/**
 * URL https đọc được của `key`.
 *
 * Ưu tiên CDN — đó chính là host SDK pull layout về, nên link này copy được
 * thẳng vào `remote_url` của Remote Config. Không cấu hình CDN thì trả URL
 * virtual-hosted của S3 để vẫn là một link đầy đủ thay vì scheme `s3://`.
 */
export function objectUrl(key: string): string {
    return CDN_BASE ? `${CDN_BASE}/${key}` : s3DirectUrl(key);
}
