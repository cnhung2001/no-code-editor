// ── Đổi đường dẫn asset tương đối → URL S3/CDN tuyệt đối ───────────────────
// DivKit JSON chứa "image_url": "assets/hero.png" (tương đối theo project).
// Editor cần URL render được, nên ta resolve trước khi nạp vào editor.

import { s3 } from '../s3';

const URL_KEYS = ['image_url', 'gif_url', 'preview', 'lottie_url']; // các field chứa URL ảnh

const API_BASE = import.meta.env.VITE_API_BASE || '/api';
const CDN_BASE = (import.meta.env.VITE_CDN_BASE || 'https://d29yoaro2sdwp8.cloudfront.net').replace(/\/$/, '');

// Regex bắt URL bucket gốc (S3 mọi region) — để chuẩn hoá host.
const S3_HOST_RE = /https:\/\/ik-nocode-paywall\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com\//g;
const CDN_HOST_RE = /https:\/\/d29yoaro2sdwp8\.cloudfront\.net\//g;

// Bật proxy CORS (/api/asset) thay vì hiển thị URL CDN đầy đủ.
//   false (mặc định) → editor hiển thị URL CDN đầy đủ (https://…cloudfront.net/…).
//                       Ảnh/video render trực tiếp bằng <img>/<video> (không cần CORS).
//   true             → đổi mọi URL sang proxy cùng origin; cần cho lottie/file-size
//                       (fetch) khi CDN/S3 thiếu header CORS.
const USE_ASSET_PROXY = (import.meta.env.VITE_ASSET_PROXY || 'false') === 'true';

// Chuẩn hoá URL asset cho editor.
//  - proxy mode: S3 + CDN → /api/asset?key=… (tránh CORS khi fetch).
//  - direct mode: S3 → CDN (hiển thị URL CDN đầy đủ), CDN giữ nguyên.
function rewriteBucketUrls(json: string): string {
    if (USE_ASSET_PROXY) {
        return json
            .replace(S3_HOST_RE, `${API_BASE}/asset?key=`)
            .replace(CDN_HOST_RE, `${API_BASE}/asset?key=`);
    }
    // direct mode: S3 → CDN, đồng thời dọn URL proxy còn sót lại trong file cũ → CDN.
    return restoreAssetUrls(json.replace(S3_HOST_RE, `${CDN_BASE}/`));
}

// URL công khai để khôi phục asset khi LƯU. Mặc định = CDN (khớp với URL hiển thị
// ở direct mode); đổi qua VITE_ASSET_PUBLIC_BASE nếu client cần host khác (vd S3).
const ASSET_PUBLIC_BASE = (import.meta.env.VITE_ASSET_PUBLIC_BASE || CDN_BASE).replace(/\/$/, '');

/**
 * Đảo ngược proxy CORS trước khi ghi lên S3:
 *   /api/asset?key=<KEY>  →  <ASSET_PUBLIC_BASE>/<KEY>
 * Áp dụng ở mức chuỗi nên bắt được URL ở mọi nơi (image_url, variables, ...).
 * Nếu không làm, URL proxy chỉ chạy được trong dev sẽ bị đẩy lên S3 → SDK pull về lỗi.
 */
export function restoreAssetUrls(json: string): string {
    const esc = API_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${esc}/asset\\?key=([^"'\\s]+)`, 'g');
    return json.replace(re, (_m, raw) => {
        let key = raw;
        try {
            key = decodeURIComponent(raw); // bắt cả dạng key đã URL-encode
        } catch {
            /* giữ nguyên nếu decode lỗi */
        }
        return `${ASSET_PUBLIC_BASE}/${key}`;
    });
}

function collectRelativeUrls(node: unknown, out: Set<string>) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        node.forEach((n) => collectRelativeUrls(n, out));
        return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (URL_KEYS.includes(k) && typeof v === 'string' && isRelative(v)) {
            out.add(v);
        } else {
            collectRelativeUrls(v, out);
        }
    }
}

// Ảnh base64 (vd trường "preview" của video/image) KHÔNG có prefix "data:" khi lưu
// trong DivKit — chuỗi bắt đầu bằng magic của JPEG/PNG/GIF/WEBP/BMP/SVG. Nếu coi là
// đường dẫn tương đối sẽ bị ghép thành URL CDN rác (vd .../ai-video/9j//gAQ…).
function looksLikeBase64Image(s: string): boolean {
    if (/^(\/9j\/|iVBORw0KGgo|R0lGOD|UklGR|Qk|PHN2Zy|PD94bWw)/.test(s)) return true;
    // Phòng hờ: chuỗi rất dài chỉ gồm ký tự base64 (đường dẫn file thật có "." hoặc "-").
    return s.length > 100 && /^[A-Za-z0-9+/=]+$/.test(s);
}

function isRelative(url: string): boolean {
    // Biểu thức DivKit (vd "@{url_icon_close}") KHÔNG phải đường dẫn file —
    // không được resolve, nếu không sẽ tạo URL rác làm vỡ render.
    if (url.includes('@{')) return false;
    if (looksLikeBase64Image(url)) return false;
    return !/^(https?:|data:|blob:|\/\/)/.test(url);
}

function replaceUrls(node: unknown, map: Map<string, string>): unknown {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n) => replaceUrls(n, map));
    const obj = node as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (URL_KEYS.includes(k) && typeof v === 'string' && map.has(v)) {
            next[k] = map.get(v);
        } else {
            next[k] = replaceUrls(v, map);
        }
    }
    return next;
}

/**
 * Trả về JSON string đã resolve asset. `project` là prefix project (vd "ai-note").
 */
export async function resolveAssets(jsonString: string, project: string): Promise<string> {
    let json: unknown;
    try {
        json = JSON.parse(jsonString);
    } catch {
        return rewriteBucketUrls(jsonString);
    }
    const rel = new Set<string>();
    collectRelativeUrls(json, rel);
    if (rel.size === 0) return rewriteBucketUrls(jsonString);

    const map = new Map<string, string>();
    await Promise.all(
        [...rel].map(async (r) => {
            const key = `${project}/${r.replace(/^\.?\//, '')}`;
            try {
                map.set(r, await s3.getAssetUrl(key));
            } catch {
                /* để nguyên nếu không resolve được */
            }
        })
    );
    return rewriteBucketUrls(JSON.stringify(replaceUrls(json, map)));
}
