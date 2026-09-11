// ── Bản nháp nằm ở đâu trong bucket ───────────────────────────────────────
// Save draft KHÔNG được ghi đè key mà app đang đọc — nếu đè thì "nháp" chỉ là
// tên gọi, nội dung chưa duyệt ra production ngay lúc bấm nút.
//
//   <project>/<đường dẫn>  →  <project>/.drafts/<đường dẫn>
//
// Nhét SAU segment project chứ không phải trước: guard quyền lấy segment đầu
// làm project (project-scope.mjs), để `.drafts` lên đầu là nháp của mọi project
// rơi chung vào một "project" tên .drafts, ai có quyền ở đó đọc được nháp của
// người khác.
//
// Thuần hàm, không đụng express/S3 → test được bằng node trần.

export const DRAFT_SEGMENT = '.drafts';

/**
 * Key nháp tương ứng của một key thật.
 * Trả `null` khi key không nằm trong project nào (file lẻ ở gốc bucket) — chỗ
 * đó không có folder project để nhét `.drafts` vào.
 * Key vốn đã là key nháp thì trả về chính nó (đã chuẩn hoá dấu `/`).
 */
export function draftKey(key) {
    const segments = String(key || '').split('/').filter(Boolean);
    if (segments.length < 2) return null;
    if (segments[1] === DRAFT_SEGMENT) return segments.join('/');
    return [segments[0], DRAFT_SEGMENT, ...segments.slice(1)].join('/');
}

/**
 * Prefix nháp tương ứng của một prefix đang liệt kê, luôn kết thúc bằng '/'.
 * Trả `null` cho gốc bucket (không project nào) và cho chính kho nháp.
 */
export function draftPrefix(prefix) {
    const segments = String(prefix || '').split('/').filter(Boolean);
    if (!segments.length || segments[0] === DRAFT_SEGMENT) return null;
    if (segments[1] === DRAFT_SEGMENT) return `${segments.join('/')}/`;
    return `${[segments[0], DRAFT_SEGMENT, ...segments.slice(1)].join('/')}/`;
}
