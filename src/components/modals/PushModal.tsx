// ── Hộp xác nhận Push to S3: diff + commit + version/CDN ───────────────────
import { useEffect, useState } from 'react';
import { Icon } from '../../lib/icons';
import { s3 } from '../../s3';

import type { LayoutMeta } from '../../types';

interface Props {
    target: { key: string; body: string; meta?: LayoutMeta };
    onClose(): void;
    /** `purgeId` để App theo dõi việc xoá cache CDN; null = không có gì phải xoá. */
    onDone(purgeId: string | null): void;
}

export function PushModal({ target, onClose, onDone }: Props) {
    const [current, setCurrent] = useState<string>('');
    const [commit, setCommit] = useState('');
    const [bump, setBump] = useState(true);
    const [invalidate, setInvalidate] = useState(true);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        s3.getObjectText(target.key).then(setCurrent).catch(() => setCurrent(''));
    }, [target.key]);

    const changed = current.trim() !== target.body.trim();

    async function publish() {
        setBusy(true);
        setErr(null);
        try {
            const res = await s3.publish(target.key, target.body, {
                commitMessage: commit || 'Update layout',
                bumpVersion: bump,
                invalidateCdn: invalidate,
                meta: target.meta
            });
            // Không chờ purge: nó mất ~25s và chạy tiếp dù modal đóng. Kết quả
            // hiện ở tầng App (CachePurgeToast) để chỗ này trả tay lại ngay.
            onDone(res.purgeId);
        } catch (e) {
            setErr(String((e as Error).message || e));
            setBusy(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal push-modal" onClick={(e) => e.stopPropagation()}>
                <header className="modal-head">
                    <span>Push to S3</span>
                    <button className="icon-btn" onClick={onClose}>{Icon.close}</button>
                </header>
                <div className="push-body">
                    <div className="push-target">
                        <span className="push-label">Target</span>
                        <code>s3://ik-nocode-paywall/{target.key}</code>
                    </div>

                    {(target.meta?.screen_id || target.meta?.label) && (
                        <div className="push-target">
                            <span className="push-label">Metadata (lưu vào S3 object metadata)</span>
                            <code>
                                {target.meta?.screen_id && `screen_id=${target.meta.screen_id}`}
                                {target.meta?.screen_id && target.meta?.label && '  ·  '}
                                {target.meta?.label && `label=${target.meta.label}`}
                            </code>
                        </div>
                    )}

                    <div className="push-diff">
                        <span className="push-label">Thay đổi (body) {changed ? '' : '· (không có khác biệt — metadata vẫn được ghi)'}</span>
                        <div className="diff-cols">
                            <pre className="diff old">{current || '(file mới)'}</pre>
                            <pre className="diff new">{target.body}</pre>
                        </div>
                    </div>

                    <label className="push-field">
                        <span className="push-label">Commit message</span>
                        <input value={commit} onChange={(e) => setCommit(e.target.value)} placeholder="vd: tăng giá yearly, đổi hero" />
                    </label>

                    <label className="push-check">
                        <input type="checkbox" checked={bump} onChange={(e) => setBump(e.target.checked)} />
                        Bump version &amp; giữ bản cũ để rollback
                    </label>
                    <label className="push-check">
                        <input type="checkbox" checked={invalidate} onChange={(e) => setInvalidate(e.target.checked)} />
                        Xoá cache CDN sau khi publish (layout mới thì bỏ qua — chưa có gì để xoá)
                    </label>

                    {err && <div className="push-err">Lỗi: {err}</div>}
                </div>
                <footer className="modal-foot">
                    <button className="btn ghost sm" onClick={onClose}>Huỷ</button>
                    <button className="btn primary sm" disabled={busy} onClick={publish}>
                        {Icon.upload} {busy ? 'Đang publish…' : 'Publish'}
                    </button>
                </footer>
            </div>
        </div>
    );
}
