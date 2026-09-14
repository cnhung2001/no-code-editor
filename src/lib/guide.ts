// ── Hướng dẫn dựng UI (tài liệu tiếng Việt cho người không code) ──────────
// File tĩnh trong public/, nên dev (proxy sang Vite) và prod (express.static
// trên dist/) đều phục vụ nó mà không cần thêm route nào.
//
// Mở TAB MỚI, không phải modal: người đang dựng layout cần đọc CẠNH editor chứ
// không phải thay cho editor — nhét vào modal là bắt họ đóng tài liệu mỗi lần
// muốn thử một bước.

// Trỏ THẲNG vào index.html, không phải '/huong-dan/'. Dev server của Vite có
// history fallback: một đường dẫn thư mục sẽ trả về index.html của SPA chứ
// không phải file trong public/ — prod thì đúng, dev thì sai, và sai âm thầm.
const GUIDE_URL = '/huong-dan/index.html';

/**
 * Mục trong hướng dẫn, dùng làm neo khi mở từ một màn cụ thể. Giá trị phải
 * khớp id trong public/huong-dan/index.html.
 */
export type GuideAnchor =
    | 'nocode'      // ★ NoCode Preview — duyệt & xuất bản layout trên S3
    | 'giao-dien'   // 2. Làm quen giao diện Builder
    | 'layout'      // 5. Layout
    | 'styling'     // 6. Styling
    | 'variable'    // 7. Variable & đa ngôn ngữ
    | 'quy-trinh'   // 13. Quy trình dựng 1 màn hình
    | 'luu';        // 14. Lưu, xem trước & xuất bản

export function openGuide(anchor?: GuideAnchor): void {
    // noopener: tab mới không được giữ tham chiếu ngược tới window của app.
    window.open(anchor ? `${GUIDE_URL}#${anchor}` : GUIDE_URL, '_blank', 'noopener');
}
