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

export const VIEWPORT_LIST = ['375x812', '390x844', '414x896', '360x800'];

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
