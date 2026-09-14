// ── Hướng dẫn dựng UI, hiển thị NGAY TRONG app ────────────────────────────
// Trước đây mở bằng window.open: mỗi lần bấm là một tab mới, đọc xong quay lại
// thì lạc mất chỗ đang làm. Giờ nó là một màn như Admin — vào, đọc, Quay lại.
//
// Dùng <iframe> chứ không nhúng thẳng HTML: tài liệu mang nguyên bộ CSS của
// nó (reset `*`, style cho `body`, `a`, `h1`…) nên trộn vào DOM của app là hai
// bảng style đè lên nhau. iframe cho nó một document riêng, không ai đụng ai.

import { useMemo } from 'react';
import { Icon } from '../lib/icons';
import { GUIDE_URL, type GuideAnchor } from '../lib/guide';

interface Props {
    /** Mục cần nhảy tới; bỏ trống thì mở từ đầu tài liệu. */
    anchor?: GuideAnchor;
    onBack(): void;
}

export function HelpScreen({ anchor, onBack }: Props) {
    // Đổi src là iframe tự nhảy tới neo mới. Tính bằng useMemo để một lần
    // re-render của cha không nạp lại cả tài liệu và ném người đọc về đầu trang.
    const src = useMemo(() => (anchor ? `${GUIDE_URL}#${anchor}` : GUIDE_URL), [anchor]);

    return (
        <main className="help">
            <header className="help-head">
                <button className="link-back" onClick={onBack}>{Icon.back} Quay lại</button>
                <span className="help-title">Hướng dẫn dựng UI</span>
                {/* Vẫn để một đường mở tab riêng: đọc tài liệu CẠNH editor là nhu
                    cầu thật, chỉ là không được ép ai cũng phải làm vậy. */}
                <a className="btn ghost sm" href={src} target="_blank" rel="noopener">
                    {Icon.external} Mở tab mới
                </a>
            </header>
            <iframe className="help-frame" src={src} title="Hướng dẫn dựng UI" />
        </main>
    );
}
