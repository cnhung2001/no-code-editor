// ── Adapter MOCK: chạy thử không cần AWS (VITE_USE_MOCK=true) ──────────────
// Dữ liệu mô phỏng bucket ik-nocode-paywall, port từ prototype data.jsx.

import type {
    S3Adapter,
    S3Item,
    ProjectInfo,
    PublishOptions
} from '../types';

const LAYOUT_WELCOME = {
    card: {
        log_id: 'paywall_main',
        states: [
            {
                state_id: 0,
                div: {
                    type: 'container',
                    orientation: 'vertical',
                    background: [{ type: 'solid', color: '#040C06' }],
                    height: { type: 'match_parent' },
                    items: [
                        { type: 'text', text: 'UNLOCK FULL ACCESS', font_size: 26, font_weight: 'bold', text_color: '#F1F1F1' },
                        { type: 'text', text: 'Unlimited generations · No watermark · 4K export', font_size: 14, text_color: '#9B9E9B', margins: { top: 8 } },
                        { type: 'text', text: 'Start Free Trial', font_size: 16, font_weight: 'bold', text_color: '#040C06', background: [{ type: 'solid', color: '#22E345' }], paddings: { top: 16, bottom: 16, left: 24, right: 24 }, margins: { top: 24 }, alignment_horizontal: 'center' }
                    ]
                }
            }
        ]
    },
    templates: {}
};

const LAYOUT_ONBOARD = {
    card: {
        log_id: 'onboarding_complete',
        states: [
            {
                state_id: 0,
                div: {
                    type: 'container',
                    orientation: 'vertical',
                    background: [{ type: 'solid', color: '#040C06' }],
                    height: { type: 'match_parent' },
                    items: [
                        { type: 'text', text: "You're all set", font_size: 28, font_weight: 'bold', text_color: '#F1F1F1' },
                        { type: 'text', text: 'Pick a clear photo of one person or pet to start.', font_size: 15, text_color: '#9B9E9B', margins: { top: 10 } }
                    ]
                }
            }
        ]
    },
    templates: {}
};

const PROJECT_NAMES = ['ai-note', 'ios_remote3', 'printer', 'roku-org-2', 'submanager', 'wordoffice'];

function projectFiles(name: string): S3Item[] {
    return [
        { name: 'paywall_main.json', type: 'json', key: `${name}/paywall_main.json`, size: 4300, modified: '2026-06-14T09:32:00Z', version: 'v3', status: 'live' },
        { name: 'trial_offer.json', type: 'json', key: `${name}/trial_offer.json`, size: 3800, modified: '2026-06-11T15:20:00Z', version: 'v2', status: 'draft' },
        { name: 'onboarding.json', type: 'json', key: `${name}/onboarding.json`, size: 2900, modified: '2026-06-13T08:10:00Z', version: 'v4', status: 'live' },
        { name: 'assets', type: 'folder', prefix: `${name}/assets/` },
        { name: 'config.json', type: 'json', key: `${name}/config.json`, size: 1100, modified: '2026-06-10T09:00:00Z', version: 'v1', status: 'live', config: true }
    ];
}

const ASSET_FILES: Record<string, S3Item[]> = {};
PROJECT_NAMES.forEach((n) => {
    ASSET_FILES[`${n}/assets/`] = [
        { name: 'hero.png', type: 'image', key: `${n}/assets/hero.png`, size: 812000, modified: '2026-06-08T12:00:00Z' },
        { name: 'background.jpg', type: 'image', key: `${n}/assets/background.jpg`, size: 640000, modified: '2026-06-08T12:00:00Z' }
    ];
});

const LAYOUTS: Record<string, unknown> = {};
PROJECT_NAMES.forEach((n) => {
    LAYOUTS[`${n}/paywall_main.json`] = { ...LAYOUT_WELCOME, card: { ...LAYOUT_WELCOME.card, log_id: `${n}_paywall` } };
    LAYOUTS[`${n}/trial_offer.json`] = { ...LAYOUT_WELCOME, card: { ...LAYOUT_WELCOME.card, log_id: `${n}_trial` } };
    LAYOUTS[`${n}/onboarding.json`] = { ...LAYOUT_ONBOARD, card: { ...LAYOUT_ONBOARD.card, log_id: `${n}_onboard` } };
    LAYOUTS[`${n}/config.json`] = LAYOUT_WELCOME;
});

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms));

export const mockAdapter: S3Adapter = {
    async listProjects(): Promise<ProjectInfo[]> {
        await delay();
        return PROJECT_NAMES.map((name) => ({ name, prefix: `${name}/`, layoutCount: 3 }));
    },
    async listPath(prefix: string, opts?: { recursive?: boolean; signal?: AbortSignal }) {
        await delay();
        if (!prefix) return PROJECT_NAMES.map((n) => ({ name: n, type: 'folder' as const, prefix: `${n}/` }));
        // Mock không có cây lồng nhau, nên recursive trả đúng asset của prefix đó.
        if (opts?.recursive) return ASSET_FILES[prefix] || [];
        if (ASSET_FILES[prefix]) return ASSET_FILES[prefix];
        const proj = prefix.replace(/\/$/, '');
        return projectFiles(proj);
    },
    async getObjectText(key: string, _signal?: AbortSignal) {
        await delay();
        return JSON.stringify(LAYOUTS[key] || LAYOUT_WELCOME, null, 2);
    },
    async getAssetUrl() {
        // ảnh placeholder
        return 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="300"><rect width="100%" height="100%" fill="#191a21"/><text x="50%" y="50%" fill="#67EE50" font-family="monospace" font-size="14" text-anchor="middle">asset</text></svg>');
    },
    async putObject(key: string, body: string) {
        await delay();
        try { LAYOUTS[key] = JSON.parse(body); } catch { /* ignore */ }
    },
    async deleteObject(key: string) {
        await delay();
        delete LAYOUTS[key];
    },
    async uploadAsset(project: string, file: File) {
        await delay();
        return `mock://${project}/assets/${file.name}`;
    },
    async publish(key: string, body: string, _opts: PublishOptions) {
        await delay();
        const isNew = !(key in LAYOUTS);
        try { LAYOUTS[key] = JSON.parse(body); } catch { /* ignore */ }
        return { version: 'v1', purgeId: isNew ? null : 'mock-purge' };
    },
    async purgeStatus() {
        await delay();
        return { state: 'done' as const };
    }
};
