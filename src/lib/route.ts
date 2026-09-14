// ── URL ↔ vị trí trong bucket ─────────────────────────────────────────────
// URL soi gương cấu trúc S3, để deep-link và F5 giữ nguyên chỗ đang đứng:
//   /                                 gốc bucket
//   /ai-video                         thư mục project
//   /ai-video/images                  thư mục lồng
//   /ai-video/welcome.json            file (layout / ảnh / html)
//   /ai-video/new                     dựng layout mới trong ai-video
//   /admin                            màn Admin (không phải vị trí trong bucket)
//   /help                             hướng dẫn dựng UI
//   /help/quy-trinh                   hướng dẫn, mở sẵn ở một mục
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

/**
 * Segment đánh dấu route "hướng dẫn".
 *
 * Không trùng gì trong bucket — đã kiểm cả 633 key, 520 segment khác nhau.
 * Cũng KHÔNG trùng `/huong-dan/` là đường dẫn file tĩnh của chính tài liệu:
 * ở prod `express.static` sẽ phục vụ thư mục đó trước cả SPA fallback, nên lấy
 * `huong-dan` làm route của app thì F5 ra tài liệu trần, mất luôn vỏ app.
 *
 * Khác Admin ở chỗ nó NUỐT phần đuôi: `/help/quy-trinh` là một mục trong tài
 * liệu, không phải thư mục "quy-trinh" nằm trong project "help".
 */
const HELP_SEGMENT = 'help';

export interface ParsedRoute {
    /** Các segment đã decode. Segment "new" ở cuối đã được tách ra `isNew`. */
    segments: string[];
    isNew: boolean;
    /** URL trỏ màn Admin. Khi true thì `segments` rỗng và `isNew` false. */
    isAdmin: boolean;
    /**
     * Đang ở màn hướng dẫn: `''` = mở từ đầu, chuỗi khác = neo tới mục đó,
     * `null` = không phải route hướng dẫn.
     */
    help: string | null;
}

export interface BuildUrlOptions {
    /** Thư mục đang mở, không gồm tên file. */
    path: string[];
    /** Tên file đang xem. Bỏ qua khi `isNew`. */
    fileName?: string | null;
    isNew?: boolean;
    /** Đang ở màn Admin — thắng mọi option còn lại, URL ra đúng `/admin`. */
    isAdmin?: boolean;
    /** Như `ParsedRoute.help`. Có giá trị thì mọi thứ còn lại bị bỏ qua. */
    help?: string | null;
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
        return { segments: [], isNew: false, isAdmin: true, help: null };
    }

    // Hướng dẫn cũng chiếm trọn URL, nhưng segment thứ hai là MỤC trong tài
    // liệu chứ không phải thư mục con.
    if (segments[0] === HELP_SEGMENT) {
        return { segments: [], isNew: false, isAdmin: false, help: segments[1] || '' };
    }

    // "new" cuối URL là route, không phải thư mục. An toàn vì đã kiểm cả 577 key
    // trong bucket: không có project/thư mục/file nào tên "new".
    if (segments.length && segments[segments.length - 1] === NEW_SEGMENT) {
        segments.pop();
        return { segments, isNew: true, isAdmin: false, help: null };
    }

    return { segments, isNew: false, isAdmin: false, help: null };
}

/** Dựng pathname từ vị trí hiện tại. Encode từng segment để tên kiểu `flag_en@3x.png` không vỡ URL. */
export function buildUrl({ path, fileName, isNew, isAdmin, help }: BuildUrlOptions): string {
    // Admin và Hướng dẫn không phải vị trí trong bucket: `path` lúc này vẫn giữ
    // chỗ cũ để đóng màn là quay về đúng đó, nên phải chặn trước khi ghép segment.
    if (isAdmin) return '/' + ADMIN_SEGMENT;

    if (help !== null && help !== undefined) {
        return '/' + [HELP_SEGMENT, ...(help ? [help] : [])].map(encodeURIComponent).join('/');
    }

    const parts = [...path];

    if (isNew) parts.push(NEW_SEGMENT);
    else if (fileName) parts.push(fileName);

    return '/' + parts.map(encodeURIComponent).join('/');
}
