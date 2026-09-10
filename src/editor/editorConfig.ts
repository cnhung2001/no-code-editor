// ── Cấu hình dùng chung cho DivProEditor ──────────────────────────────────

// Bố cục panel cho màn Preview (chỉ xem, read-only)
export const PREVIEW_LAYOUT = [
    { items: ['preview'], weight: 1 }
];

// Bố cục panel cho màn Builder đầy đủ.
// LeftBar/LeftPanel của editor đã hiển thị palette + component-tree, nên KHÔNG
// thêm cột ['new-component','component-tree'] nữa (sẽ bị lặp panel "Basic components").
export const BUILDER_LAYOUT = [
    { items: ['preview'], weight: 3 },
    { items: ['component-props:code'], minWidth: 360 }
];

// Kích thước LOGICAL (point trên iOS, dp trên Android) — không phải pixel vật
// lý: iPhone X là DPR 3 nên 375x812 pt = 1125x2436 px thật.
//
// Phần tử ĐẦU TIÊN là default của cả editor và Preview. Editor chọn theo
// `viewportList.includes('360x640') ? '360x640' : viewportList[0]`
// (visual-editor Canvas.svelte), mà list này không có 360x640 nên nó rơi về
// phần tử đầu. Hai hệ quả: đừng đảo 375x812 khỏi vị trí đầu, và đừng thêm
// 360x640 — thêm là nó lặng lẽ chiếm quyền default.
export const VIEWPORT_LIST = [
    // ── iOS ───────────────────────────────────────────────────────────────
    '375x812', // iPhone X · XS · 11 Pro · 12 mini · 13 mini  ← default
    '375x667', // iPhone SE 2/3 · 8 — màn THẤP NHẤT, chỗ nút CTA bị đẩy khỏi
               //   mép dưới trước tiên; paywall vừa khít 812 vẫn có thể vỡ ở đây
    '390x844', // iPhone 12 · 12 Pro · 13 · 13 Pro · 14
    '393x852', // iPhone 14 Pro · 15 · 15 Pro · 16
    '414x896', // iPhone XR · 11 · XS Max · 11 Pro Max
    '430x932', // iPhone 14 Pro Max · 15 Plus · 15 Pro Max · 16 Plus
    // ── Android ───────────────────────────────────────────────────────────
    '360x800'  // Mốc dp phổ biến nhất (Galaxy S/A và phần lớn máy tầm trung)
];

// Action tuỳ biến cho paywall (hiện trong dropdown action của editor)
export const CUSTOM_ACTIONS = [
    { baseUrl: 'div-action://close', text: { en: 'Close', ru: 'Close' } },
    { baseUrl: 'div-action://purchase', text: { en: 'Purchase', ru: 'Purchase' }, args: [{ type: 'string', name: 'product_id', text: { en: 'Product ID', ru: 'Product ID' } }] },
    { baseUrl: 'div-action://restore', text: { en: 'Restore', ru: 'Restore' } },
    { baseUrl: 'div-action://open_url', text: { en: 'Open URL', ru: 'Open URL' }, args: [{ type: 'string', name: 'url', text: { en: 'URL', ru: 'URL' } }] }
];

export const FILE_LIMITS = {
    image: { warn: 500_000, error: 4_000_000 },
    preview: { warn: 500_000, error: 4_000_000 },
    upload: { error: 8_000_000 }
};
