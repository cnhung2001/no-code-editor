// ── Thumbnail cho file .json trong bucket ─────────────────────────────────
// Không có ảnh sẵn trên S3, nên "hình ảnh preview" là một bản render thu nhỏ
// bằng chính engine mà editor dùng — thumbnail không bao giờ lệch với những
// gì mở ra sẽ thấy.
//
// `.json` trong một project có thể là card DivKit hoặc animation Lottie
// (anim_chart.json, anim_gift.json…), mà tên file thì không nói lên điều gì.
// Nên phải phân loại theo nội dung rồi mới chọn cách render và tỉ lệ tile.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
// Entry `preview`, KHÔNG phải barrel gốc: barrel kéo cả editor (Svelte,
// CodeMirror, 185 file schema) vào chunk khởi động, vì component này nằm trong
// Browser mà Browser thì App import eager — `lazy()` của LayoutPreview/Builder
// thành vô nghĩa. Chunk eager 1.85 MB → 703 KB (js+css) nhờ đổi mấy dòng này.
import {
    detectJsonKind, renderCardPreview, renderLottiePreview
} from '@divkitframework/visual-editor/dist/preview.js';
import type {
    CardPreviewInstance, JsonKind, LottiePreviewInstance
} from '@divkitframework/visual-editor/dist/preview.js';
import '@divkitframework/visual-editor/dist/preview.css';
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

/** Lỗi do chính ta huỷ request, không phải file hỏng — không đánh dấu `failed`. */
function isAbort(e: unknown): boolean {
    return e instanceof DOMException && e.name === 'AbortError';
}

/** JSON đã resolve asset, cache theo key vì quay lại folder là dựng lại cả lưới. */
function loadJson(key: string, project: string, signal: AbortSignal): Promise<string> {
    const cached = jsonCache.get(key);
    if (cached) return cached;

    const promise = s3.getObjectText(key, signal).then((text) => resolveAssets(text, project));
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
    /** Key S3 của file. */
    itemKey: string;
    project: string;
    /** Icon dùng khi chưa render xong hoặc file không dựng được. */
    fallback: ReactNode;
    /**
     * Báo lên loại json vừa nhận ra. Tỉ lệ tile do card cha quyết định (card
     * DivKit là khung điện thoại, Lottie thì vuông), mà loại thì chỉ biết được
     * sau khi tải nội dung về.
     */
    onKind?(kind: JsonKind): void;
}

export function JsonThumb({ itemKey, project, fallback, onKind }: Props) {
    const boxRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const [fit, setFit] = useState<Fit>({ scale: 0, x: 0, y: 0 });
    const [kind, setKind] = useState<JsonKind | null>(null);
    // Giữ trong ref: effect render không được phụ thuộc vào callback của cha,
    // nếu không một arrow inline sẽ khiến nó dựng lại mỗi lần cha re-render.
    const onKindRef = useRef(onKind);
    onKindRef.current = onKind;

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

        // Huỷ ở CLEANUP của effect, tức khi cả lưới bị tháo (đổi tab) — không
        // huỷ ở teardown của IntersectionObserver, vì cuộn ra rồi cuộn lại phải
        // dùng lại cache chứ không tải lại. Thumbnail là phần nặng nhất của một
        // lần đổi tab (1.4 MB / 16 file ở project trong ảnh); để chúng chạy tiếp
        // cho một tab không còn ai xem là cách chắc chắn làm tab mới phải chờ.
        const ac = new AbortController();
        let alive = true;
        // `jsonCache` chia sẻ một promise cho mọi consumer cùng key, nên promise
        // ta đang chờ có thể chết vì NGƯỜI KHÁC huỷ — StrictMode dựng effect hai
        // lần là đúng tình huống đó. Cho phép đúng một lần thử lại trên fetch
        // mới, nếu không tile kẹt trắng vĩnh viễn (abort không đặt `failed`).
        let retried = false;
        let instance: CardPreviewInstance | LottiePreviewInstance | null = null;
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
                const json = await loadJson(itemKey, project, ac.signal);
                const stage = stageRef.current;
                if (!alive || mine !== token || !stage) {
                    release();
                    return;
                }
                const kind = detectJsonKind(json);
                setKind(kind);
                onKindRef.current?.(kind);
                if (kind === 'unknown') {
                    // Json hợp lệ nhưng không phải thứ dựng được — để icon.
                    pending = false;
                    release();
                    return;
                }

                // Dọn trước khi dựng: tile cuộn ra rồi vào lại là render nhiều
                // lượt trên cùng một node.
                stage.innerHTML = '';
                instance = kind === 'lottie' ?
                    await renderLottiePreview({ node: stage, value: json }) :
                    renderCardPreview({ node: stage, value: json, theme: 'light' });
                if (!alive || mine !== token) {
                    instance.destroy();
                    instance = null;
                    release();
                    return;
                }
                pending = false;
                release();
                setReady(true);
            } catch (e) {
                pending = false;
                release();
                if (!alive || mine !== token) return;
                if (!isAbort(e)) {
                    setFailed(true);
                } else if (!ac.signal.aborted && !retried) {
                    // Signal của ta còn nguyên ⇒ người huỷ là consumer khác.
                    retried = true;
                    void mount();
                }
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
            ac.abort();
        };
    }, [itemKey, project, failed]);

    // Lottie tự fit svg vào khung chứa nên chỉ cần lấp đầy tile; card DivKit thì
    // phải dựng trong khung 375x812 rồi thu nhỏ.
    const stageStyle: CSSProperties = kind === 'lottie' ?
        { width: '100%', height: '100%', visibility: ready ? 'visible' : 'hidden' } :
        {
            width: PREVIEW_WIDTH,
            height: PREVIEW_HEIGHT,
            transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
            visibility: ready && fit.scale > 0 ? 'visible' : 'hidden'
        };

    return (
        <div ref={boxRef} className="thumb-live">
            <div ref={stageRef} className="thumb-live-stage" style={stageStyle} />
            {!ready && <span className="thumb-big">{fallback}</span>}
        </div>
    );
}
