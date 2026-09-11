// ── Suy ra "request này đụng vào project nào" ─────────────────────────────
// "Project" của app = folder cấp 1 trong bucket (`ai-video/welcome.json` →
// `ai-video`). Guard cần biết folder nào để chọn đúng Casbin domain.
//
// Thuần hàm, không đụng express/S3/authz → test được bằng node trần.

/** Vị trí trong bucket lấy từ đâu, theo thứ tự ưu tiên. */
const SOURCES = ['key', 'prefix', 'project'];

/**
 * Tách một chuỗi vị trí thành các segment đã làm sạch.
 * Trả `null` khi chuỗi chứa segment nguy hiểm ('.' hoặc '..').
 */
function splitLocation(value) {
    const segments = String(value).split('/').filter(Boolean);
    // S3 KHÔNG chuẩn hoá key, nên `a/../b` là một key hợp lệ trỏ đúng vào chuỗi
    // đó. Nhưng CDN/CloudFront ở giữa thì có chuẩn hoá — nghĩa là segment đầu mà
    // guard nhìn thấy ('a') có thể khác folder mà file thực sự nằm ('b'). Chặn
    // thẳng thay vì đoán bên nào normalize.
    if (segments.some((s) => s === '.' || s === '..')) return null;
    return segments;
}

/**
 * Đọc vị trí trong bucket từ request.
 *
 * Kết quả:
 *  - `{ prefix: 'ai-video' }`   — thao tác nằm trong một folder project
 *  - `{ prefix: null }`         — gốc bucket (file lẻ như `nocode.html`) hoặc
 *                                 request không mang vị trí nào (vd `/translate`
 *                                 không kèm project) → guard xử như scope system
 *  - `{ invalid: true }`        — vị trí chứa `..` → deny
 *
 * @param {{ query?: object, body?: object }} req
 */
export function resolveBucketPrefix(req) {
    const bag = { ...(req.query || {}), ...(req.body || {}) };

    for (const source of SOURCES) {
        const raw = bag[source];
        // Query lặp (`?key=a&key=b`) khiến express trả mảng. Không đoán ý, chặn.
        if (Array.isArray(raw)) return { invalid: true, source };
        if (raw === undefined || raw === null) continue;

        const value = String(raw);
        // `prefix=''` là "liệt kê gốc bucket" — có mặt nhưng không trỏ project nào.
        if (value === '') return { prefix: null, source };

        const segments = splitLocation(value);
        if (segments === null) return { invalid: true, source };
        if (!segments.length) return { prefix: null, source };

        // `key=nocode.html` → 1 segment, là file ở gốc bucket, không thuộc project.
        // `prefix=ai-video/` → 1 segment nhưng LÀ folder ⇒ chính là project.
        if (segments.length === 1 && source === 'key') return { prefix: null, source };

        return { prefix: segments[0], source };
    }

    return { prefix: null, source: null };
}

/**
 * Những folder mà user được thấy, tính từ mapping và danh sách slug của họ.
 *
 * @param {Array<{ bucketPrefix: string, authzSlugs: string[] }>} mappings
 * @param {readonly string[]} userSlugs slug project user là member trực tiếp
 * @returns {Set<string>} bucket prefix
 */
export function accessiblePrefixes(mappings, userSlugs) {
    const owned = new Set(userSlugs);
    const out = new Set();
    for (const m of mappings) {
        // Folder chưa map slug nào ⇒ không ai ngoài role system thấy được. Fail
        // closed: onboard thiếu bước map thì folder ẩn, chứ không mở cho tất cả.
        if (m.authzSlugs.some((slug) => owned.has(slug))) out.add(m.bucketPrefix);
    }
    return out;
}
