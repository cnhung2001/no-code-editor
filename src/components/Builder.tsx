// ── Màn Builder: DivProEditor đầy đủ + Save draft / Push to S3 ─────────────
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../lib/icons';
import { s3 } from '../s3';
import { DivEditor, type DivEditorHandle } from '../editor/DivEditor';
import { BUILDER_LAYOUT } from '../editor/editorConfig';
import { resolveAssets } from '../editor/resolveAssets';
import { toSaveFormat, extractMeta } from '../editor/wrapper';
import { usePerms } from '../auth/AuthContext';
import type { S3Item, LayoutMeta } from '../types';

const BLANK = JSON.stringify({
    card: {
        log_id: 'untitled',
        states: [
            {
                state_id: 0,
                div: {
                    type: 'container',
                    orientation: 'vertical',
                    background: [{ type: 'solid', color: '#ffffff' }],
                    height: { type: 'match_parent' },
                    items: []
                }
            }
        ]
    },
    templates: {}
});

interface Props {
    path: string[];
    file: S3Item | null;
    isNew: boolean;
    onBack(): void;
    onPush(raw: string, key: string, meta: LayoutMeta): void;
}

export function Builder({ path, file, isNew, onBack, onPush }: Props) {
    const perms = usePerms();
    const project = path[0] || '';
    const editorRef = useRef<DivEditorHandle>(null);
    const [name, setName] = useState(isNew ? 'untitled_layout' : (file?.name.replace(/\.json$/, '') || 'layout'));
    const [value, setValue] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [toast, setToast] = useState('');

    useEffect(() => {
        let alive = true;
        (async () => {
            if (isNew || !file?.key) {
                setValue(BLANK);
                return;
            }
            const text = await s3.getObjectText(file.key);
            const res = await resolveAssets(text, project);
            if (alive) setValue(res);
        })().catch(() => alive && setValue(BLANK));
        return () => {
            alive = false;
        };
    }, [file?.key, isNew, project]);

    const key = `${project}/${name}.json`;

    function flash(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(''), 2800);
    }

    async function saveDraft() {
        const v = editorRef.current?.getValue();
        if (!v) return;
        await s3.putObject(key, toSaveFormat(v), 'draft', extractMeta(v));
        setDirty(false);
        flash(`Draft saved · s3://ik-nocode-paywall/${key}`);
    }

    function push() {
        const v = editorRef.current?.getValue();
        if (v) onPush(toSaveFormat(v), key, extractMeta(v));
    }

    return (
        <main className="builder">
            <header className="bld-topbar">
                <div className="bld-left">
                    <button className="link-back" onClick={onBack}>{Icon.back} {project || 'bucket'}</button>
                    <span className="crumb-sep">{Icon.chevron}</span>
                    <div className="bld-name">
                        <input value={name} spellCheck={false} onChange={(e) => setName(e.target.value)} />
                        <span className="bld-ext">.json</span>
                    </div>
                    <span className={'bld-tag' + (isNew ? ' new' : '')}>{isNew ? 'New · Draft' : dirty ? 'Editing*' : 'Editing'}</span>
                </div>
                <div className="bld-right">
                    {perms.update && (
                        <button className="btn ghost sm" onClick={saveDraft}>{Icon.save} Save draft</button>
                    )}
                    {perms.publish && (
                        <button className="btn primary sm" onClick={push}>{Icon.upload} Push to S3</button>
                    )}
                </div>
            </header>

            <div className="bld-body">
                {value ? (
                    <DivEditor
                        ref={editorRef}
                        key={file?.key || 'new'}
                        value={value}
                        project={project}
                        layout={BUILDER_LAYOUT}
                        onChange={() => setDirty(true)}
                    />
                ) : (
                    <div className="p-loading">Đang mở builder…</div>
                )}
            </div>

            {toast && <div className="toast">{Icon.check} {toast}</div>}
        </main>
    );
}
