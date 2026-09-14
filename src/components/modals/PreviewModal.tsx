// ── Preview layout: dùng thử như một màn thật, không phải ảnh tĩnh ─────────
// Editor cho thấy layout TRÔNG như thế nào; cái nó không cho thấy là layout
// CHẠY ra sao — bấm chọn gói thì state có đổi, nút Mua có gắn action hay
// không. Đây là chỗ để bấm thử: cùng engine DivKit mà editor dùng, nhưng
// không overlay chọn phần tử, không panel, và tap đi thẳng vào card.
//
// Action thì không thể "chạy thật": máy thật có host app xử lý purchase/close,
// ở đây không có billing. Nên chúng được ghi lại thành log — bấm nút Mua mà
// log trống nghĩa là nút chưa gắn action, đó chính là loại lỗi màn này để bắt.
import { useEffect, useRef, useState } from 'react';
import {
    renderCardPreview,
    type CardPreviewInstance, type PreviewAction, type PreviewError
} from '@divkitframework/visual-editor/dist/preview.js';
import { Icon } from '../../lib/icons';
import { VIEWPORT_LIST } from '../../editor/editorConfig';

interface Props {
    /** JSON đã resolve asset — wrapper hoặc card DivKit thuần đều được. */
    value: string;
    title: string;
    onClose(): void;
}

interface LogEntry {
    id: number;
    at: string;
    /** Tên action đọc được từ url, vd `purchase`. */
    name: string;
    params: [string, string][];
    raw?: string;
    /** Có thì đây là ghi chú của engine, không phải action. */
    level?: 'error' | 'warn';
}

/**
 * Field trong `additional` KHÔNG đưa vào log.
 *
 * Cả ba đều là nguyên cây json của component, lặp lại ba lần trong cùng một
 * lỗi. Đưa vào thì mỗi dòng dài hàng nghìn ký tự và nhấn chìm đúng những thứ
 * cần đọc (`message`, `expression`, `url`). `path` đã nói chỗ nào trong card,
 * còn json thì mở editor ra là thấy.
 */
const BULKY = new Set(['json', 'origJson', 'fullpath']);

/** Giá trị trong `additional` có thể là bất cứ gì — rút về một dòng đọc được. */
function formatValue(v: unknown): string {
    if (v instanceof Error) return v.message;
    if (v === null || v === undefined) return String(v);
    if (typeof v === 'object') {
        try {
            const json = JSON.stringify(v);
            return json.length > 120 ? json.slice(0, 117) + '…' : json;
        } catch {
            return String(v);
        }
    }
    const text = String(v);
    return text.length > 200 ? text.slice(0, 197) + '…' : text;
}

/**
 * Ghi chú của engine → dòng log.
 *
 * `message` một mình gần như vô dụng: "Video playing error" không nói video
 * nào hay vì sao. Nguyên nhân nằm trong `additional` — `originalText` cho lý
 * do browser từ chối play, `url`/`id`/`path` cho biết chỗ nào trong card.
 */
function describeError(err: PreviewError): Omit<LogEntry, 'id' | 'at'> {
    const extra = err.additional || {};
    return {
        name: err.message || 'Lỗi không rõ',
        params: Object.entries(extra)
            .filter(([k]) => !BULKY.has(k))
            .map(([k, v]) => [k, formatValue(v)] as [string, string]),
        level: err.level === 'warn' ? 'warn' : 'error'
    };
}

/** `div-action://purchase?product_id=annual` → tên + tham số, để log đọc được. */
function describe(action: PreviewAction): Omit<LogEntry, 'id' | 'at'> {
    const raw = typeof action.url === 'string' ? action.url : undefined;
    if (!raw) {
        // Action không có url (typed action) — log_id là thứ duy nhất nhận dạng được.
        return { name: action.log_id || 'action', params: [], raw: undefined };
    }
    try {
        const url = new URL(raw);
        // `div-action://purchase` → host là 'purchase'; `div-action:///set_variable`
        // (ba dấu /) thì host rỗng và tên nằm ở pathname.
        const name = url.host || url.pathname.replace(/^\/+/, '') || raw;
        return { name, params: [...url.searchParams.entries()], raw };
    } catch {
        return { name: raw, params: [], raw };
    }
}

/**
 * Tỉ lệ để khung `w×h` nằm gọn trong ô `availW×availH`.
 *
 * Chặn trên ở 1: màn 414x896 trên laptop 13" thì phải thu nhỏ, nhưng modal
 * rộng hơn khung thì đừng phóng to — 1:1 mới là kích thước thật của thiết bị,
 * phóng lên chỉ làm mọi thứ to bất thường mà không thêm thông tin gì.
 */
function fitScale(w: number, h: number, availW: number, availH: number): number {
    if (!w || !h || !availW || !availH) return 1;
    return Math.min(1, availW / w, availH / h);
}

export function PreviewModal({ value, title, onClose }: Props) {
    const stageRef = useRef<HTMLDivElement>(null);
    const fitRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);
    const [viewport, setViewport] = useState(VIEWPORT_LIST[0]);
    const [log, setLog] = useState<LogEntry[]>([]);
    const [err, setErr] = useState<string | null>(null);
    // Reset = dựng lại từ đầu. Không có cách nào "gỡ" variable về giá trị ban
    // đầu ngoài việc render lại, vì card tự sửa chúng khi người ta bấm.
    const [nonce, setNonce] = useState(0);

    const [w, h] = viewport.split('x').map(Number);

    // Đo ô chứa, không đo .pv-frame-wrap: wrap có padding, còn .pv-fit lấp đúng
    // content box của nó nên clientWidth/Height là chỗ thật sự dùng được.
    useEffect(() => {
        const box = fitRef.current;
        if (!box) return;
        const observer = new ResizeObserver(() => {
            setScale(fitScale(w, h, box.clientWidth, box.clientHeight));
        });
        observer.observe(box);
        return () => observer.disconnect();
    }, [w, h]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    useEffect(() => {
        const node = stageRef.current;
        if (!node) return;

        setLog([]);
        setErr(null);
        node.innerHTML = '';

        // Action paywall (`div-action://…`) chỉ tới onStat — đã kiểm. Scheme lạ
        // (`myapp://…`) thì tới onCustomAction, và có thể tới cả hai. Dedupe theo
        // chính object đó: DivKit truyền một instance duy nhất, nên so khớp bằng
        // identity chắc hơn mọi cách đoán theo url.
        //
        // Nhưng CHỈ trong một lần tap. Object action là object trong json của
        // card, nên bấm cùng một nút lần nữa sẽ đưa lại đúng object đó — dedupe
        // vĩnh viễn thì bấm Mua mười lần chỉ ra một dòng, và không ai biết chín
        // lần sau có ăn hay không. Hai callback chạy đồng bộ trong cùng một
        // task, nên xoá ở cuối task là đủ hẹp mà vẫn đủ rộng.
        const seen = new Set<object>();
        let n = 0;
        const push = (action: PreviewAction) => {
            if (action && typeof action === 'object') {
                if (seen.has(action)) return;
                seen.add(action);
                setTimeout(() => seen.delete(action), 0);
            }
            const at = new Date().toLocaleTimeString('vi-VN', { hour12: false });
            // Mới nhất lên đầu: log dài thì thứ vừa bấm phải thấy ngay.
            setLog(prev => [{ id: ++n, at, ...describe(action) }, ...prev].slice(0, 100));
        };

        // Ghi chú của engine vào log, KHÔNG vào banner. Mỗi lần tap nút Mua,
        // DivKit báo "Unknown type of action" — đúng, vì action đó thuộc host
        // app — nên banner đỏ sẽ bật lên che đáy layout ở mỗi lần bấm.
        //
        // Chống trùng theo CẢ message VÀ context, không chỉ message: hai video
        // hỏng vì hai lý do khác nhau đều mang message "Video playing error",
        // mà gộp lại thì cái thứ hai biến mất — đúng cái mình cần thấy nhất.
        const noted = new Set<string>();
        const note = (err: PreviewError) => {
            const entry = describeError(err);
            const key = entry.name + '|' + entry.params.map(p => p.join('=')).join('|');
            if (noted.has(key)) return;
            noted.add(key);
            const at = new Date().toLocaleTimeString('vi-VN', { hour12: false });
            setLog(prev => [{ id: ++n, at, ...entry }, ...prev].slice(0, 100));
        };

        let instance: CardPreviewInstance | null = null;
        try {
            instance = renderCardPreview({
                node,
                value,
                theme: 'light',
                onCustomAction: push,
                onStat: ({ action }) => push(action),
                onError: note
            });
        } catch (e) {
            // Ném ra là không dựng được gì cả (vd sai format) — chỗ đó mới cần
            // banner, và lúc đó khung trống nên che cũng không mất gì.
            setErr(String((e as Error).message || e));
        }

        return () => {
            instance?.destroy();
            node.innerHTML = '';
        };
    }, [value, nonce]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal preview-modal" onClick={(e) => e.stopPropagation()}>
                <header className="modal-head">
                    <span>{Icon.eye} Preview · {title}</span>
                    <div className="pv-head-actions">
                        <select
                            className="pv-viewport"
                            value={viewport}
                            onChange={(e) => setViewport(e.target.value)}
                            aria-label="Kích thước màn hình"
                        >
                            {VIEWPORT_LIST.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                        {scale < 1 && (
                            <span className="pv-scale" title="Khung được thu nhỏ cho vừa cửa sổ">
                                {Math.round(scale * 100)}%
                            </span>
                        )}
                        <button className="btn ghost sm" onClick={() => setNonce(n => n + 1)}>
                            {Icon.refresh} Reset
                        </button>
                        <button className="icon-btn" onClick={onClose} aria-label="Đóng">{Icon.close}</button>
                    </div>
                </header>

                <div className="pv-body">
                    <div className="pv-frame-wrap">
                        <div ref={fitRef} className="pv-fit">
                            {/* Hộp ngoài mang kích thước ĐÃ scale nên nó là một item
                                bình thường, không tràn — canh giữa thế nào cũng đúng.
                                Khung bên trong giữ ĐÚNG số px của viewport rồi scale
                                từ góc trên-trái: card phải resolve match_parent theo
                                414x896 thật, không theo chỗ còn lại trong modal.
                                Bấm vẫn ăn, browser tự map toạ độ chuột qua transform. */}
                            <div
                                className="pv-scaled"
                                style={{ width: w * scale, height: h * scale }}
                            >
                                <div
                                    className="pv-frame"
                                    style={{ width: w, height: h, transform: `scale(${scale})` }}
                                >
                                    <div ref={stageRef} className="pv-stage" />
                                </div>
                            </div>
                        </div>
                        {err && <div className="pv-error">Lỗi render: {err}</div>}
                    </div>

                    <aside className="pv-log">
                        <header className="pv-log-head">
                            <span>Action log</span>
                            {log.length > 0 && (
                                <button className="btn ghost sm" onClick={() => setLog([])}>Xoá</button>
                            )}
                        </header>
                        {log.length === 0 ? (
                            <p className="pv-log-empty">
                                Bấm thử vào layout. Mỗi action sẽ hiện ở đây — không có dòng nào
                                nghĩa là chỗ vừa bấm chưa gắn action.
                            </p>
                        ) : (
                            <ol className="pv-log-list">
                                {log.map(e => (
                                    <li key={e.id} className={e.level && `is-${e.level}` || undefined}>
                                        <span className="pv-log-time">{e.at}</span>
                                        <span className="pv-log-name" title={e.raw}>{e.name}</span>
                                        {e.params.length > 0 && (
                                            <span className="pv-log-args">
                                                {e.params.map(([k, v]) => `${k}=${v}`).join(' · ')}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ol>
                        )}
                        {log.some(e => !e.level && e.raw?.includes('@{')) && (
                            <p className="pv-log-note">
                                Dòng action hiện url như khai báo trong layout, nên
                                <code>@{'{…}'}</code> còn nguyên — engine đưa action ở dạng chưa
                                tính. Máy thật thì host app nhận bản đã tính, và dòng lỗi bên trên
                                (nếu có <code>url=</code>) cũng là bản đã tính.
                            </p>
                        )}
                    </aside>
                </div>
            </div>
        </div>
    );
}
