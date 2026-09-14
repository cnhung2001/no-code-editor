// ── URL ↔ vị trí trong bucket ─────────────────────────────────────────────
// URL soi gương cấu trúc S3, để deep-link và F5 giữ nguyên chỗ đang đứng:
//   /                                 gốc bucket
//   /ai-video                         thư mục project
//   /ai-video/images                  thư mục lồng
//   /ai-video/welcome.json            file (layout / ảnh / html)
//   /ai-video/new                     dựng layout mới trong ai-video
//   /admin                            màn Admin (không phải vị trí trong bucket)
//
// parseUrl KHÔNG đoán segment cuối là file hay thư mục — chỉ S3 mới biết.
// App resolve bằng cách list thư mục cha rồi tìm item khớp tên.

/** Segment đánh dấu route "layout mới". */
const NEW_SEGMENT = 'new';

/**
 * Segment của màn Admin. Chỉ nhận ở GỐC (`/admin`), không nhận lồng
 * (`/ai-video/admin` vẫn là thư mục tên "admin" trong project).
 *
 * Chiếm một tên ở gốc là chiếm mất khả năng có project trùng tên, nên đã kiểm
 * bucket trước: `list-objects-v2 --prefix admin` không trả về key nào. Giới hạn
 * ở gốc để thư mục "admin" nằm sâu trong project nào đó không bị nuốt.
 */
const ADMIN_SEGMENT = 'admin';

export interface ParsedRoute {
    /** Các segment đã decode. Segment "new" ở cuối đã được tách ra `isNew`. */
    segments: string[];
    isNew: boolean;
    /** URL trỏ màn Admin. Khi true thì `segments` rỗng và `isNew` false. */
    isAdmin: boolean;
}

export interface BuildUrlOptions {
    /** Thư mục đang mở, không gồm tên file. */
    path: string[];
    /** Tên file đang xem. Bỏ qua khi `isNew`. */
    fileName?: string | null;
    isNew?: boolean;
    /** Đang ở màn Admin — thắng mọi option còn lại, URL ra đúng `/admin`. */
    isAdmin?: boolean;
}

/** decodeURIComponent an toàn: URL gõ tay có thể chứa '%' lẻ làm hàm gốc ném lỗi. */
function decodeSegment(s: string): string {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

/**
 * Đọc `location.pathname` thành vị trí trong bucket.
 * Dấu "/" thừa hoặc lặp bị loại — nếu không state sẽ dính segment rỗng và
 * breadcrumb hiện ra ô trống.
 */
export function parseUrl(pathname: string): ParsedRoute {
    const segments = pathname.split('/').filter(Boolean).map(decodeSegment);

    // Admin kiểm TRƯỚC "new": nó chiếm trọn URL nên không có gì để parse thêm.
    if (segments.length === 1 && segments[0] === ADMIN_SEGMENT) {
        return { segments: [], isNew: false, isAdmin: true };
    }

    // "new" cuối URL là route, không phải thư mục. An toàn vì đã kiểm cả 577 key
    // trong bucket: không có project/thư mục/file nào tên "new".
    if (segments.length && segments[segments.length - 1] === NEW_SEGMENT) {
        segments.pop();
        return { segments, isNew: true, isAdmin: false };
    }

    return { segments, isNew: false, isAdmin: false };
}

/** Dựng pathname từ vị trí hiện tại. Encode từng segment để tên kiểu `flag_en@3x.png` không vỡ URL. */
export function buildUrl({ path, fileName, isNew, isAdmin }: BuildUrlOptions): string {
    // Admin không phải vị trí trong bucket: `path` lúc này vẫn giữ chỗ cũ để
    // đóng Admin là quay về đúng đó, nên phải chặn trước khi ghép segment.
    if (isAdmin) return '/' + ADMIN_SEGMENT;

    const parts = [...path];

    if (isNew) parts.push(NEW_SEGMENT);
    else if (fileName) parts.push(fileName);

    return '/' + parts.map(encodeURIComponent).join('/');
}
