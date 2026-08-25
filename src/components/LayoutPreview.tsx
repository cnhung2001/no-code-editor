// ── Màn Preview = vừa xem vừa SỬA layout bằng DivProEditor (editable) ──────
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../lib/icons';
import { fmtSize, fmtDate } from '../lib/format';
import { s3 } from '../s3';
import { DivEditor, type DivEditorHandle } from '../editor/DivEditor';
import { BUILDER_LAYOUT } from '../editor/editorConfig';
import { resolveAssets } from '../editor/resolveAssets';
import { toSaveFormat, extractLogId, extractMeta } from '../editor/wrapper';
import { usePerms } from '../auth/AuthContext';
import type { S3Item, LayoutMeta } from '../types';

interface Props {
    path: string[];
    file: S3Item;
    onBack(): void;
    onPush(raw: string, meta: LayoutMeta): void;
}

export function LayoutPreview({ path, file, onBack, onPush }: Props) {
    const perms = usePerms();
    const project = path[0] || '';
    const editorRef = useRef<DivEditorHandle>(null);
    const [raw, setRaw] = useState<string>('');
    const [resolved, setResolved] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [toast, setToast] = useState('');
    const [showMeta, setShowMeta] = useState(false);

    useEffect(() => {
        let alive = true;
        if (!file.key) return;
        s3.getObjectText(file.key)
            .then(async (text) => {
                if (!alive) return;
                setRaw(text);
                setResolved(await resolveAssets(text, project));
            })
            .catch((e) => alive && setErr(String(e.message || e)));
        return () => {
            alive = false;
        };
    }, [file.key, project]);

    function flash(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(''), 2800);
    }

    function download() {
        const blob = new Blob([raw], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    async function saveDraft() {
        const v = editorRef.current?.getValue();
        if (!v || !file.key) return;
        await s3.putObject(file.key, toSaveFormat(v), 'draft', extractMeta(v));
        setDirty(false);
        flash(`Draft saved · s3://ik-nocode-paywall/${file.key}`);
    }

    function push() {
        const v = editorRef.current?.getValue();
        if (v && file.key) onPush(toSaveFormat(v), extractMeta(v));
    }

    return (
        <main className="preview">
            <header className="p-topbar">
                <button className="link-back" onClick={onBack}>{Icon.back} {project || 'bucket'}</button>
                <span className="p-title">{file.name}{dirty && '*'}</span>
                <div className="p-actions">
                    <button className="btn ghost sm" onClick={() => setShowMeta(true)}>{Icon.info} Metadata</button>
                    <button className="btn ghost sm" onClick={download}>{Icon.download} Download</button>
                    {perms.update && (
                        <button className="btn ghost sm" onClick={saveDraft}>{Icon.save} Save draft</button>
                    )}
                    {perms.publish && (
                        <button className="btn primary sm" onClick={push}>{Icon.upload} Push to S3</button>
                    )}
                </div>
            </header>

            <div className="p-body">
                <div className="p-stage">
                    {err && <div className="p-error">Lỗi tải: {err}</div>}
                    {resolved && !err && (
                        <DivEditor
                            ref={editorRef}
                            key={file.key}
                            value={resolved}
                            project={project}
                            layout={BUILDER_LAYOUT}
                            onChange={() => setDirty(true)}
                        />
                    )}
                    {!resolved && !err && <div className="p-loading">Đang dựng editor…</div>}
                </div>
            </div>

            {showMeta && (
                <div className="modal-overlay" onClick={() => setShowMeta(false)}>
                    <div className="modal meta-modal" onClick={(e) => e.stopPropagation()}>
                        <header className="modal-head">
                            <span>Metadata</span>
                            <button className="icon-btn" onClick={() => setShowMeta(false)}>{Icon.close}</button>
                        </header>
                        <div className="meta-modal-body">
                            <dl>
                                <dt>S3 path</dt><dd>s3://ik-nocode-paywall/{file.key}</dd>
                                <dt>log_id</dt><dd>{raw ? extractLogId(raw) : '—'}</dd>
                                <dt>Version</dt><dd>{file.version || '—'}</dd>
                                <dt>Status</dt><dd>{file.status || '—'}</dd>
                                <dt>Size</dt><dd>{fmtSize(file.size)}</dd>
                                <dt>Modified</dt><dd>{fmtDate(file.modified)}</dd>
                            </dl>
                        </div>
                    </div>
                </div>
            )}

            {toast && <div className="toast">{Icon.check} {toast}</div>}
        </main>
    );
}
