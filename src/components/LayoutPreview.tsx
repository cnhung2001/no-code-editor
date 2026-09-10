// ── Màn Preview = vừa xem vừa SỬA layout bằng DivProEditor (editable) ──────
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../lib/icons';
import { fmtSize, fmtDate } from '../lib/format';
import { s3 } from '../s3';
import { objectUrl } from '../s3/publicUrl';
import { copyText } from '../lib/clipboard';
import { DivEditor, type DivEditorHandle } from '../editor/DivEditor';
import { BUILDER_LAYOUT } from '../editor/editorConfig';
import { resolveAssets } from '../editor/resolveAssets';
import { toSaveFormat, extractLogId, extractMeta } from '../editor/wrapper';
import { usePerms } from '../auth/AuthContext';
import type { S3Item, LayoutMeta } from '../types';
import { Loader } from './Loader';
import { PreviewModal } from './modals/PreviewModal';

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
    // Giá trị đem đi preview được CHỐT lúc bấm, không đọc lại mỗi lần render:
    // người ta sửa tiếp trong editor thì bản đang dùng thử phải đứng yên.
    const [previewValue, setPreviewValue] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const copyTimer = useRef(0);

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

    useEffect(() => () => window.clearTimeout(copyTimer.current), []);

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

    async function copyPath() {
        if (!file.key) return;
        try {
            await copyText(objectUrl(file.key));
            setCopied(true);
            window.clearTimeout(copyTimer.current);
            copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
        } catch {
            flash('Không copy được — hãy chọn và copy tay từ ô S3 path');
        }
    }

    // Preview bản ĐANG SỬA, không phải bản trên S3: sửa xong bấm thử ngay là
    // lý do màn này tồn tại. Chưa dựng được editor thì lấy bản vừa tải về.
    function openPreview() {
        setPreviewValue(editorRef.current?.getValue() || resolved || '');
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
                    <button className="btn ghost sm" onClick={openPreview} disabled={!resolved}>
                        {Icon.eye} Preview
                    </button>
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
                    {!resolved && !err && <Loader label="Đang dựng editor…" />}
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
                                <dt>S3 path</dt>
                                <dd className="meta-copy">
                                    <span>{file.key ? objectUrl(file.key) : '—'}</span>
                                    {file.key && (
                                        <button
                                            className={`icon-btn${copied ? ' copied' : ''}`}
                                            title="Copy S3 path"
                                            aria-label="Copy S3 path"
                                            onClick={copyPath}
                                        >
                                            {copied ? Icon.check : Icon.copy}
                                        </button>
                                    )}
                                </dd>
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

            {previewValue !== null && (
                <PreviewModal
                    value={previewValue}
                    title={file.name}
                    onClose={() => setPreviewValue(null)}
                />
            )}

            {toast && <div className="toast">{Icon.check} {toast}</div>}
        </main>
    );
}
