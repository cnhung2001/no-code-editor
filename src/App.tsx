// ── App root: gate đăng nhập → Browser → Preview → Builder + modals ────────
import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Sidebar } from './components/Sidebar';
import { Browser } from './components/Browser';
import { ImageModal } from './components/modals/ImageModal';
import { Loader } from './components/Loader';

// Editor nặng → tách chunk, chỉ tải khi vào Preview/Builder
const LayoutPreview = lazy(() => import('./components/LayoutPreview').then((m) => ({ default: m.LayoutPreview })));
const Builder = lazy(() => import('./components/Builder').then((m) => ({ default: m.Builder })));
import { HtmlModal } from './components/modals/HtmlModal';
import { PushModal } from './components/modals/PushModal';
import { s3, IS_MOCK } from './s3';
import { AuthProvider, useAuth, usePerms } from './auth/AuthContext';
import { LoginScreen } from './auth/LoginScreen';
import { buildUrl, parseUrl } from './lib/route';
import type { ProjectInfo, S3Item, LayoutMeta } from './types';

type View = 'browser' | 'preview' | 'builder';

export default function App() {
    return (
        <AuthProvider>
            <AuthGate />
        </AuthProvider>
    );
}

/** Chặn toàn bộ app sau đăng nhập. Quyền chi tiết gate ở từng nút bên trong. */
function AuthGate() {
    const { status, error, reload } = useAuth();

    if (status === 'loading') {
        return <Loader label="Đang kiểm tra đăng nhập…" />;
    }
    if (status === 'anonymous') {
        return <LoginScreen />;
    }
    if (status === 'error') {
        return (
            <div className="login">
                <div className="login-card">
                    <div className="login-error">Không đọc được thông tin đăng nhập: {error}</div>
                    <button className="btn primary login-btn" onClick={reload}>Thử lại</button>
                </div>
            </div>
        );
    }
    return <Shell />;
}

function Shell() {
    const perms = usePerms();
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

    // ── URL ↔ state ───────────────────────────────────────────────────────
    // Bật khi đang khôi phục state TỪ url (mount / nút Back). Effect đẩy URL đọc
    // cờ này để không ghi đè ngược lại mục history vừa được điều hướng tới.
    const restoringRef = useRef(false);
    // Lần đồng bộ đầu dùng replaceState để chuẩn hoá URL (bỏ "/" thừa) mà không
    // sinh thêm một mục history — nếu không, Back đầu tiên sẽ như không làm gì.
    const firstSyncRef = useRef(true);

    useEffect(() => {
        let alive = true;

        /** Khôi phục state từ pathname. Segment cuối là file hay thư mục thì phải hỏi S3. */
        async function applyRoute(pathname: string) {
            const { segments, isNew: wantNew } = parseUrl(pathname);
            console.log('[route] applyRoute', pathname, segments);
            restoringRef.current = true;

            // Đóng mọi modal trước: URL mới quyết định cái nào được mở lại.
            setImageFile(null);
            setHtmlFile(null);

            // Tạo layout mới cần có project — "/new" trần thì bỏ qua cờ.
            if (wantNew && segments.length) {
                setPath(segments);
                setActiveFile(null);
                setIsNew(true);
                setView('builder');
                return;
            }

            setIsNew(false);

            if (!segments.length) {
                setPath([]);
                setActiveFile(null);
                setView('browser');
                return;
            }

            // Thử coi segment cuối là file: list thư mục cha rồi tìm đúng tên.
            const parent = segments.slice(0, -1);
            const last = segments[segments.length - 1];
            const prefix = parent.length ? parent.join('/') + '/' : '';

            let hit: S3Item | undefined;
            try {
                const items = await s3.listPath(prefix);
                hit = items.find((it) => it.name === last && it.type !== 'folder');
            } catch {
                // Không list được (mất mạng, thiếu quyền) → coi như thư mục,
                // Browser sẽ tự hiện lỗi/rỗng thay vì cả app đứng im.
            }
            if (!alive) return;

            if (hit) {
                setPath(parent);
                if (hit.type === 'image') {
                    setActiveFile(null);
                    setView('browser');
                    setImageFile(hit);
                } else if (hit.type === 'html') {
                    setActiveFile(null);
                    setView('browser');
                    setHtmlFile(hit);
                } else if (hit.type === 'json') {
                    setActiveFile(hit);
                    setView('preview');
                } else {
                    // URL trỏ vào một asset (video, animation): không có editor
                    // cho nó, nên mở thư mục chứa thay vì một editor rỗng.
                    setActiveFile(null);
                    setView('browser');
                }
            } else {
                setPath(segments);
                setActiveFile(null);
                setView('browser');
            }
        }

        applyRoute(window.location.pathname);
        const onPop = () => applyRoute(window.location.pathname);
        window.addEventListener('popstate', onPop);
        return () => {
            alive = false;
            window.removeEventListener('popstate', onPop);
        };
    }, []);

    // State → URL. Chạy sau mỗi lần đổi vị trí; bỏ qua khi đang khôi phục từ URL.
    useEffect(() => {
        const fileName =
            view === 'preview' && activeFile
                ? activeFile.name
                : imageFile
                  ? imageFile.name
                  : htmlFile
                    ? htmlFile.name
                    : null;
        const url = buildUrl({ path, fileName, isNew: view === 'builder' && isNew });

        console.log('[route] sync', {
            url,
            now: window.location.pathname,
            restoring: restoringRef.current,
            first: firstSyncRef.current,
            path: path.join('/'),
            view
        });

        if (restoringRef.current) {
            restoringRef.current = false;
            // URL gốc có thể chưa chuẩn (thừa "/"); ghi đè tại chỗ cho khớp state.
            if (url !== window.location.pathname) window.history.replaceState(null, '', url);
            firstSyncRef.current = false;
            return;
        }
        if (url === window.location.pathname) return;

        if (firstSyncRef.current) {
            firstSyncRef.current = false;
            window.history.replaceState(null, '', url);
        } else {
            window.history.pushState(null, '', url);
        }
    }, [path, view, activeFile, imageFile, htmlFile, isNew]);

    const activeProject = path[0] || null;

    // Mọi hàm điều hướng đều tắt `isNew`: bỏ sót thì URL kẹt ở "/<project>/new"
    // sau khi rời Builder, và Back sẽ quay về đúng chỗ đó.
    function openItem(it: S3Item) {
        setIsNew(false);
        if (it.type === 'folder') {
            setPath([...path, it.name]);
            setView('browser');
        } else if (it.type === 'image') setImageFile(it);
        else if (it.type === 'html') setHtmlFile(it);
        else if (it.type === 'json') {
            setActiveFile(it);
            setView('preview');
        }
        // Còn lại là asset (video, HLS, animation Lottie): editor layout không mở
        // được chúng — trước đây nhánh else nuốt hết và mở editor rỗng.
    }
    function gotoProject(name: string) {
        setPath([name]);
        setView('browser');
        setActiveFile(null);
        setIsNew(false);
    }
    function gotoRoot() {
        setPath([]);
        setView('browser');
        setActiveFile(null);
        setIsNew(false);
    }
    function gotoCrumb(i: number) {
        setPath(i < 0 ? [] : path.slice(0, i + 1));
        setView('browser');
        setActiveFile(null);
        setIsNew(false);
    }
    function newLayout() {
        setActiveFile(null);
        setIsNew(true);
        setView('builder');
    }

    // Badge phản ánh quyền THẬT, không phải cờ build-time như trước.
    const capabilityNotice = !perms.update
        ? 'Chế độ chỉ xem · không ghi S3'
        : !perms.publish
          ? 'Sửa & lưu draft được · không có quyền publish'
          : null;

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
            {capabilityNotice && <div className="readonly-badge">{capabilityNotice}</div>}

            {view === 'browser' && (
                <Browser path={path} onOpen={openItem} onCrumb={gotoCrumb} onNewLayout={newLayout} />
            )}

            {view === 'preview' && activeFile && (
                <Suspense fallback={<Loader label="Đang tải editor…" />}>
                    <LayoutPreview
                        path={path}
                        file={activeFile}
                        onBack={() => setView('browser')}
                        onPush={(raw, meta) => activeFile.key && setPushTarget({ key: activeFile.key, body: raw, meta })}
                    />
                </Suspense>
            )}

            {view === 'builder' && (
                <Suspense fallback={<Loader label="Đang tải editor…" />}>
                    <Builder
                        path={path}
                        file={activeFile}
                        isNew={isNew}
                        onBack={() => {
                            setIsNew(false);
                            setView(activeFile ? 'preview' : 'browser');
                        }}
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
                        setIsNew(false);
                        setView('browser');
                    }}
                />
            )}
        </div>
    );
}
