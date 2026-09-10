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
    renderCardPreview, type CardPreviewInstance, type PreviewAction
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

export function PreviewModal({ value, title, onClose }: Props) {
    const stageRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState(VIEWPORT_LIST[0]);
    const [log, setLog] = useState<LogEntry[]>([]);
    const [err, setErr] = useState<string | null>(null);
    // Reset = dựng lại từ đầu. Không có cách nào "gỡ" variable về giá trị ban
    // đầu ngoài việc render lại, vì card tự sửa chúng khi người ta bấm.
    const [nonce, setNonce] = useState(0);

    const [w, h] = viewport.split('x').map(Number);

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
        const logged = new WeakSet<object>();
        let n = 0;
        const push = (action: PreviewAction) => {
            if (action && typeof action === 'object') {
                if (logged.has(action)) return;
                logged.add(action);
            }
            const at = new Date().toLocaleTimeString('vi-VN', { hour12: false });
            // Mới nhất lên đầu: log dài thì thứ vừa bấm phải thấy ngay.
            setLog(prev => [{ id: ++n, at, ...describe(action) }, ...prev].slice(0, 100));
        };

        let instance: CardPreviewInstance | null = null;
        try {
            instance = renderCardPreview({
                node,
                value,
                theme: 'light',
                onCustomAction: push,
                onStat: ({ action }) => push(action),
                onError: (e) => setErr(String(e.message || e))
            });
        } catch (e) {
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
                        <button className="btn ghost sm" onClick={() => setNonce(n => n + 1)}>
                            {Icon.refresh} Reset
                        </button>
                        <button className="icon-btn" onClick={onClose} aria-label="Đóng">{Icon.close}</button>
                    </div>
                </header>

                <div className="pv-body">
                    <div className="pv-frame-wrap">
                        {/* Khung cố định theo viewport; card có match_parent sẽ tự
                            giãn vừa nó, nên đổi viewport không cần dựng lại. */}
                        <div className="pv-frame" style={{ width: w, height: h }}>
                            <div ref={stageRef} className="pv-stage" />
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
                                    <li key={e.id}>
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
                        {log.some(e => e.raw?.includes('@{')) && (
                            <p className="pv-log-note">
                                Tham số hiện đúng như khai báo trong layout. DivKit đưa url ở dạng
                                chưa tính, nên <code>@{'{…}'}</code> không được thay giá trị ở đây —
                                trên máy thật host app nhận bản đã tính.
                            </p>
                        )}
                    </aside>
                </div>
            </div>
        </div>
    );
}
