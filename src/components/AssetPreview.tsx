// ── Preview cho asset: ảnh và frame đầu của video ─────────────────────────

import { useEffect, useState, type ReactNode } from 'react';
import { s3 } from '../s3';
import type { S3Item } from '../types';

/** Video mà <video src> phát được trực tiếp. */
const PLAYABLE_VIDEO_RE = /\.(mp4|m4v|mov|webm|ogv)$/i;
/** HLS là video, chỉ là được đóng gói thành playlist + segment. */
export function isVideoAsset(item: S3Item): boolean {
    return item.type === 'hls' ||
        (item.type === 'other' && PLAYABLE_VIDEO_RE.test(item.name));
}

/**
 * Asset dựng được preview. Tách khỏi [isVideoAsset] vì hai câu hỏi khác nhau:
 * HLS *là* video, nhưng một <video src> trần không decode được nên không có
 * frame để lấy — nó nhận icon như .zip.
 */
export function isPreviewableAsset(item: S3Item): boolean {
    return Boolean(item.key) &&
        (item.type === 'image' || (item.type === 'other' && PLAYABLE_VIDEO_RE.test(item.name)));
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
    if (PLAYABLE_VIDEO_RE.test(item.name)) {
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
