// ── Icon thin-line (24px grid) — port từ prototype views.jsx ──────────────
import type { ReactNode } from 'react';

const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const Icon: Record<string, ReactNode> = {
    folder: <svg viewBox="0 0 24 24" width="18" height="18" {...s}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>,
    json: <svg viewBox="0 0 24 24" width="18" height="18" {...s}><path d="M14 3v5h5" /><path d="M9 13s-1 0-1 1.5S9 16 9 16s1 0 1 1.5S9 19 9 19M15 13s1 0 1 1.5S15 16 15 16s1 0 1 1.5S15 19 15 19" /><path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /></svg>,
    image: <svg viewBox="0 0 24 24" width="18" height="18" {...s}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="m21 16-5-5L5 20" /></svg>,
    html: <svg viewBox="0 0 24 24" width="18" height="18" {...s}><path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M14 3v5h5" /><path d="m9.5 12-2 2 2 2M14.5 12l2 2-2 2" /></svg>,
    search: <svg viewBox="0 0 24 24" width="16" height="16" {...s}><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>,
    chevron: <svg viewBox="0 0 24 24" width="14" height="14" {...s} strokeWidth={2}><path d="m9 6 6 6-6 6" /></svg>,
    refresh: <svg viewBox="0 0 24 24" width="16" height="16" {...s}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>,
    upload: <svg viewBox="0 0 24 24" width="16" height="16" {...s}><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>,
    edit: <svg viewBox="0 0 24 24" width="16" height="16" {...s}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>,
    download: <svg viewBox="0 0 24 24" width="16" height="16" {...s}><path d="M12 4v12m0 0 5-5m-5 5-5-5" /><path d="M4 19h16" /></svg>,
    close: <svg viewBox="0 0 24 24" width="18" height="18" {...s} strokeWidth={2}><path d="M18 6 6 18M6 6l12 12" /></svg>,
    cloud: <svg viewBox="0 0 24 24" width="16" height="16" {...s}><path d="M17 18a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9a4.5 4.5 0 0 0-.5 9z" /></svg>,
    external: <svg viewBox="0 0 24 24" width="16" height="16" {...s}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></svg>,
    save: <svg viewBox="0 0 24 24" width="16" height="16" {...s}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>,
    check: <svg viewBox="0 0 24 24" width="16" height="16" {...s} strokeWidth={2}><path d="M20 6 9 17l-5-5" /></svg>,
    plus: <svg viewBox="0 0 24 24" width="16" height="16" {...s} strokeWidth={2}><path d="M12 5v14M5 12h14" /></svg>,
    back: <svg viewBox="0 0 24 24" width="16" height="16" {...s}><path d="m15 18-6-6 6-6" /></svg>,
    trash: <svg viewBox="0 0 24 24" width="16" height="16" {...s}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>,
    media: <svg viewBox="0 0 24 24" width="18" height="18" {...s}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M10 9.5v5l4-2.5z" /></svg>,
    copy: <svg viewBox="0 0 24 24" width="16" height="16" {...s}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>,
    info: <svg viewBox="0 0 24 24" width="16" height="16" {...s}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.6h.01" strokeWidth={2.4} /></svg>,
    eye: <svg viewBox="0 0 24 24" width="16" height="16" {...s}><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.6" /></svg>
    info: <svg viewBox="0 0 24 24" width="16" height="16" {...s}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.6h.01" strokeWidth={2.4} /></svg>,
    // Khiên: mục Admin (phân quyền + audit), không phải "cài đặt" chung chung.
    settings: <svg viewBox="0 0 24 24" width="18" height="18" {...s}><path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" /><path d="m9.5 12 1.8 1.8 3.4-3.6" /></svg>
};
