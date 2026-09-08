// ── Preview cho asset: ảnh và frame đầu của video ─────────────────────────

import { useEffect, useState, type ReactNode } from 'react';
import { s3 } from '../s3';
import type { S3Item } from '../types';

/** Video <video> phát được trực tiếp. .m3u8 cần hls.js nên không tính. */
const VIDEO_RE = /\.(mp4|m4v|mov|webm|ogv)$/i;
export function isVideoAsset(item: S3Item): boolean {
    return item.type === 'other' && VIDEO_RE.test(item.name);
}

/** Asset dựng được preview; phần còn lại (.m3u8, .zip…) chỉ có icon. */
export function isPreviewableAsset(item: S3Item): boolean {
    return Boolean(item.key) && (item.type === 'image' || isVideoAsset(item));
}

function useAssetUrl(item: S3Item): string | null {
    const [url, setUrl] = useState<string | null>(null);
    const key = item.key;

    useEffect(() => {
        let alive = true;
        if (key) {
            s3.getAssetUrl(key).then((u) => alive && setUrl(u)).catch(() => {});
        }
        return () => {
            alive = false;
        };
    }, [key]);

    return url;
}

/**
 * Một asset. Video hiện frame đầu thay cho icon chung: cả folder toàn
 * `Paywall1.mp4`, `Paywall2.mp4`… thì icon không phân biệt được cái nào.
 *
 * `#t=0.1` là cách bắt browser decode một frame mà không phát: preload
 * metadata thôi thì nhiều browser để khung đen.
 */
export function AssetMedia({ item, fallback }: { item: S3Item; fallback: ReactNode }) {
    const url = useAssetUrl(item);

    if (!url) {
        return <span className="thumb-big">{fallback}</span>;
    }
    if (isVideoAsset(item)) {
        return (
            <video
                src={`${url}#t=0.1`}
                preload="metadata"
                muted
                playsInline
                // Không controls, không autoplay: đây là ảnh đại diện, không phải player.
                tabIndex={-1}
            />
        );
    }
    return <img src={url} alt={item.name} />;
}
