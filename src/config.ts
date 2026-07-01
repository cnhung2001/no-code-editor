// ── Cấu hình build-time ───────────────────────────────────────────────────

// Cho phép ghi lên S3 (Push to S3 / Save draft / Delete / New layout).
// Đặt VITE_ALLOW_PUSH=false để build bản "chỉ xem + sửa thử" (không ghi S3).
// Mặc định true (bản đầy đủ).
export const ALLOW_PUSH = (import.meta.env.VITE_ALLOW_PUSH ?? 'true') !== 'false';
