// ── URL ↔ vị trí trong bucket ─────────────────────────────────────────────
// URL soi gương cấu trúc S3, để deep-link và F5 giữ nguyên chỗ đang đứng:
//   /                                 gốc bucket
//   /ai-video                         thư mục project
//   /ai-video/images                  thư mục lồng
//   /ai-video/welcome.json            file (layout / ảnh / html)
//   /ai-video/new                     dựng layout mới trong ai-video
//
// parseUrl KHÔNG đoán segment cuối là file hay thư mục — chỉ S3 mới biết.
// App resolve bằng cách list thư mục cha rồi tìm item khớp tên.

/** Segment đánh dấu route "layout mới". */
const NEW_SEGMENT = 'new';

export interface ParsedRoute {
    /** Các segment đã decode. Segment "new" ở cuối đã được tách ra `isNew`. */
    segments: string[];
    isNew: boolean;
}

export interface BuildUrlOptions {
    /** Thư mục đang mở, không gồm tên file. */
    path: string[];
    /** Tên file đang xem. Bỏ qua khi `isNew`. */
    fileName?: string | null;
    isNew?: boolean;
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

    // "new" cuối URL là route, không phải thư mục. An toàn vì đã kiểm cả 577 key
    // trong bucket: không có project/thư mục/file nào tên "new".
    if (segments.length && segments[segments.length - 1] === NEW_SEGMENT) {
        segments.pop();
        return { segments, isNew: true };
    }

    return { segments, isNew: false };
}

/** Dựng pathname từ vị trí hiện tại. Encode từng segment để tên kiểu `flag_en@3x.png` không vỡ URL. */
export function buildUrl({ path, fileName, isNew }: BuildUrlOptions): string {
    const parts = [...path];

    if (isNew) parts.push(NEW_SEGMENT);
    else if (fileName) parts.push(fileName);

    return '/' + parts.map(encodeURIComponent).join('/');
}
