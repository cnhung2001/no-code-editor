// ── Thumbnail của layout: render card thật rồi thu nhỏ ────────────────────
// Card DivKit không có ảnh sẵn trên S3, nên "hình ảnh preview" ở đây là một
// bản render thu nhỏ bằng chính engine mà editor dùng — thumbnail không bao
// giờ lệch với những gì mở ra sẽ thấy.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { renderCardPreview } from '@divkitframework/visual-editor';
import type { CardPreviewInstance } from '@divkitframework/visual-editor';
import '@divkitframework/visual-editor/dist/divkit-editor.css';
import { s3 } from '../s3';
import { resolveAssets } from '../editor/resolveAssets';

/** Khung render = viewport mặc định của editor; tile chỉ scale nó xuống. */
const PREVIEW_WIDTH = 375;
const PREVIEW_HEIGHT = 812;

/**
 * Mỗi thumbnail là một card DivKit SỐNG (có timer, ảnh, animation), nên số
 * lượng phải bị chặn hai lớp: chỉ tile gần viewport được dựng, và mỗi lúc chỉ
 * vài cái được dựng song song để không giành CPU với cuộn trang.
 */
const MAX_CONCURRENT = 3;
/** Dựng trước khi tile lọt vào khung nhìn, để cuộn không thấy ô trống. */
const PRERENDER_MARGIN = '300px';
const CACHE_LIMIT = 60;

const jsonCache = new Map<string, Promise<string>>();

/** JSON đã resolve asset, cache theo key vì quay lại folder là dựng lại cả lưới. */
function loadJson(key: string, project: string): Promise<string> {
    const cached = jsonCache.get(key);
    if (cached) return cached;

    const promise = s3.getObjectText(key).then((text) => resolveAssets(text, project));
    // Lỗi thì không giữ trong cache: lần mở sau phải được thử lại.
    promise.catch(() => jsonCache.delete(key));

    if (jsonCache.size >= CACHE_LIMIT) {
        const oldest = jsonCache.keys().next().value;
        if (oldest) jsonCache.delete(oldest);
    }
    jsonCache.set(key, promise);
    return promise;
}

let active = 0;
const waiting: (() => void)[] = [];

function acquireSlot(): Promise<void> {
    if (active < MAX_CONCURRENT) {
        ++active;
        return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
}

/** Nhường slot cho người đang chờ; không có ai chờ thì trả về pool. */
function releaseSlot(): void {
    const next = waiting.shift();
    if (next) {
        next();
        return;
    }
    active = Math.max(active - 1, 0);
}

interface Fit {
    scale: number;
    /** Lệch trái/trên để căn giữa, tính bằng px của tile. */
    x: number;
    y: number;
}

/**
 * Fit trọn khung 375x812 vào tile: lấy chiều bị bó hẹp hơn nên không crop gì,
 * rồi căn giữa bằng translate.
 *
 * Cố tình không nhờ CSS căn: khung render to hơn tile, mà `margin: auto` trên
 * một box absolute rộng hơn khung chứa thì spec cho margin về 0 — box dồn về
 * mép trái và bị cắt bên phải, chứ không căn giữa.
 *
 * translate trước scale, với transform-origin ở góc trên-trái: box được đặt
 * đúng chỗ rồi mới thu nhỏ quanh chính điểm đó.
 */
function fitInside(width: number, height: number): Fit {
    const scale = Math.min(width / PREVIEW_WIDTH, height / PREVIEW_HEIGHT);
    return {
        scale,
        x: (width - PREVIEW_WIDTH * scale) / 2,
        y: (height - PREVIEW_HEIGHT * scale) / 2
    };
}

interface Props {
    /** Key S3 của file layout. */
    itemKey: string;
    project: string;
    /** Icon dùng khi chưa render xong hoặc layout không dựng được. */
    fallback: ReactNode;
}

export function LayoutThumb({ itemKey, project, fallback }: Props) {
    const boxRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const [fit, setFit] = useState<Fit>({ scale: 0, x: 0, y: 0 });

    useEffect(() => {
        const box = boxRef.current;
        if (!box) return;
        // Card nằm trong một <button>, nên nội dung render không được nhận
        // click hay tab-focus — pointer-events lo phần chuột, inert lo phần
        // bàn phím và a11y tree.
        stageRef.current?.setAttribute('inert', '');

        const observer = new ResizeObserver(() => {
            const width = box.clientWidth;
            const height = box.clientHeight;
            if (!width || !height) return; // chưa layout xong
            setFit(fitInside(width, height));
        });
        observer.observe(box);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const box = boxRef.current;
        if (!box || failed) return;

        let alive = true;
        let instance: CardPreviewInstance | null = null;
        let holdsSlot = false;
        let pending = false;
        // Mỗi lần trạng thái đổi (dựng mới / bỏ đi) là một token mới. Một lượt
        // mount đang await phải tự dừng nếu token đã đổi, nếu không tile cuộn
        // ra rồi cuộn lại sẽ dựng chồng lên nhau.
        let token = 0;

        function release() {
            if (holdsSlot) {
                holdsSlot = false;
                releaseSlot();
            }
        }

        function teardown() {
            ++token;
            pending = false;
            instance?.destroy();
            instance = null;
            release();
            setReady(false);
        }

        async function mount() {
            const mine = ++token;
            pending = true;
            await acquireSlot();
            holdsSlot = true;

            if (!alive || mine !== token) {
                release();
                return;
            }
            try {
                const json = await loadJson(itemKey, project);
                const stage = stageRef.current;
                if (!alive || mine !== token || !stage) {
                    release();
                    return;
                }
                // Dọn trước khi dựng: tile cuộn ra rồi vào lại là render nhiều
                // lượt trên cùng một node.
                stage.innerHTML = '';
                instance = renderCardPreview({ node: stage, value: json, theme: 'light' });
                pending = false;
                release();
                setReady(true);
            } catch {
                pending = false;
                release();
                if (alive && mine === token) setFailed(true);
            }
        }

        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries.some((entry) => entry.isIntersecting);
                if (visible && !instance && !pending) {
                    void mount();
                } else if (!visible && (instance || pending)) {
                    teardown();
                }
            },
            { rootMargin: PRERENDER_MARGIN }
        );
        observer.observe(box);

        return () => {
            alive = false;
            observer.disconnect();
            teardown();
        };
    }, [itemKey, project, failed]);

    return (
        <div ref={boxRef} className="thumb-live">
            <div
                ref={stageRef}
                className="thumb-live-stage"
                style={{
                    width: PREVIEW_WIDTH,
                    height: PREVIEW_HEIGHT,
                    transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
                    visibility: ready && fit.scale > 0 ? 'visible' : 'hidden'
                }}
            />
            {!ready && <span className="thumb-big">{fallback}</span>}
        </div>
    );
}
