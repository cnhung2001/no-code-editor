// ── App root: định tuyến Browser → Preview → Builder + modals ─────────────
import { useEffect, useState, lazy, Suspense } from 'react';
import { Sidebar } from './components/Sidebar';
import { Browser } from './components/Browser';
import { ImageModal } from './components/modals/ImageModal';

// Editor nặng → tách chunk, chỉ tải khi vào Preview/Builder
const LayoutPreview = lazy(() => import('./components/LayoutPreview').then((m) => ({ default: m.LayoutPreview })));
const Builder = lazy(() => import('./components/Builder').then((m) => ({ default: m.Builder })));
import { HtmlModal } from './components/modals/HtmlModal';
import { PushModal } from './components/modals/PushModal';
import { s3, IS_MOCK } from './s3';
import { ALLOW_PUSH } from './config';
import type { ProjectInfo, S3Item, LayoutMeta } from './types';

type View = 'browser' | 'preview' | 'builder';

export default function App() {
    const [projects, setProjects] = useState<ProjectInfo[]>([]);
    const [rootFiles, setRootFiles] = useState<S3Item[]>([]);
    const [path, setPath] = useState<string[]>([]);
    const [view, setView] = useState<View>('browser');
    const [activeFile, setActiveFile] = useState<S3Item | null>(null);
    const [isNew, setIsNew] = useState(false);

    const [imageFile, setImageFile] = useState<S3Item | null>(null);
    const [htmlFile, setHtmlFile] = useState<S3Item | null>(null);
    const [pushTarget, setPushTarget] = useState<{ key: string; body: string; meta?: LayoutMeta } | null>(null);

    useEffect(() => {
        s3.listProjects().then(setProjects).catch(() => setProjects([]));
        // File lẻ ở gốc bucket (vd *.html) — /api/projects chỉ trả folder nên lấy riêng.
        s3.listPath('')
            .then((items) => setRootFiles(items.filter((it) => it.type !== 'folder')))
            .catch(() => setRootFiles([]));
    }, []);

    const activeProject = path[0] || null;

    function openItem(it: S3Item) {
        if (it.type === 'folder') {
            setPath([...path, it.name]);
            setView('browser');
        } else if (it.type === 'image') setImageFile(it);
        else if (it.type === 'html') setHtmlFile(it);
        else {
            setActiveFile(it);
            setView('preview');
        }
    }
    function gotoProject(name: string) {
        setPath([name]);
        setView('browser');
        setActiveFile(null);
    }
    function gotoRoot() {
        setPath([]);
        setView('browser');
        setActiveFile(null);
    }
    function gotoCrumb(i: number) {
        setPath(i < 0 ? [] : path.slice(0, i + 1));
        setView('browser');
        setActiveFile(null);
    }
    function newLayout() {
        setActiveFile(null);
        setIsNew(true);
        setView('builder');
    }

    return (
        <div className={'nc-app' + (view !== 'browser' ? ' nc-app--no-sidebar' : '')}>
            {view === 'browser' && (
                <Sidebar
                    projects={projects}
                    files={rootFiles}
                    activeProject={activeProject}
                    onProject={gotoProject}
                    onFile={openItem}
                    onRoot={gotoRoot}
                />
            )}

            {IS_MOCK && <div className="mock-banner">MOCK MODE · đang dùng dữ liệu giả (đặt VITE_USE_MOCK=false để nối S3 thật)</div>}
            {!ALLOW_PUSH && <div className="readonly-badge">Chế độ chỉ xem · không ghi S3</div>}

            {view === 'browser' && (
                <Browser path={path} onOpen={openItem} onCrumb={gotoCrumb} onNewLayout={newLayout} />
            )}

            {view === 'preview' && activeFile && (
                <Suspense fallback={<div className="p-loading">Đang tải editor…</div>}>
                    <LayoutPreview
                        path={path}
                        file={activeFile}
                        onBack={() => setView('browser')}
                        onPush={(raw, meta) => activeFile.key && setPushTarget({ key: activeFile.key, body: raw, meta })}
                    />
                </Suspense>
            )}

            {view === 'builder' && (
                <Suspense fallback={<div className="p-loading">Đang tải editor…</div>}>
                    <Builder
                        path={path}
                        file={activeFile}
                        isNew={isNew}
                        onBack={() => setView(activeFile ? 'preview' : 'browser')}
                        onPush={(raw, key, meta) => setPushTarget({ key, body: raw, meta })}
                    />
                </Suspense>
            )}

            {imageFile && <ImageModal file={imageFile} onClose={() => setImageFile(null)} />}
            {htmlFile && <HtmlModal file={htmlFile} onClose={() => setHtmlFile(null)} />}
            {pushTarget && (
                <PushModal
                    target={pushTarget}
                    onClose={() => setPushTarget(null)}
                    onDone={() => {
                        setPushTarget(null);
                        setView('browser');
                    }}
                />
            )}
        </div>
    );
}
