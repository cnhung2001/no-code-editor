// ── Trình duyệt S3: breadcrumb + tìm kiếm + lưới card ─────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../lib/icons';
import { fmtSize, fmtDate } from '../lib/format';
import { s3 } from '../s3';
import { usePerms } from '../auth/AuthContext';
import type { JsonKind } from '@divkitframework/visual-editor';
import type { S3Item } from '../types';
import { Dots, SkeletonCards } from './Loader';
import { JsonThumb } from './JsonThumb';
import { AssetMedia, isPreviewableAsset } from './AssetPreview';

function StatusBadge({ status }: { status?: S3Item['status'] }) {
    const map: Record<string, [string, string]> = {
        live: ['var(--green)', 'Live'],
        draft: ['var(--amber)', 'Draft'],
        archived: ['#888', 'Archived']
    };
    const [c, label] = map[status || ''] || map.draft;
    return (
        <span className="status">
            <span className="status-dot" style={{ background: c }} /> {label}
        </span>
    );
}

interface Props {
    path: string[];
    onOpen(item: S3Item): void;
    onCrumb(index: number): void;
    onNewLayout(): void;
}

export function Browser({ path, onOpen, onCrumb, onNewLayout }: Props) {
    const perms = usePerms();
    const prefix = path.length ? path.join('/') + '/' : '';
    const [items, setItems] = useState<S3Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [q, setQ] = useState('');
    const [deleting, setDeleting] = useState<string | null>(null);
    // Assets của CẢ project, không riêng prefix đang mở: ảnh/video hay nằm rải
    // trong subfolder (images/, videos/), nên gom theo từng thư mục thì mỗi chỗ
    // thấy một phần. Mở bằng nút trên thanh search.
    const [assetsOpen, setAssetsOpen] = useState(false);
    const [projectAssets, setProjectAssets] = useState<S3Item[]>([]);
    // Loại của từng .json, do JsonThumb báo lên sau khi tải nội dung: tên file
    // không phân biệt được card DivKit với animation Lottie.
    const [kinds, setKinds] = useState<Record<string, JsonKind>>({});
    const noteKind = useCallback(
        (key: string, kind: JsonKind) => setKinds((prev) => (prev[key] === kind ? prev : { ...prev, [key]: kind })),
        []
    );

    useEffect(() => {
        let alive = true;
        setLoading(true);
        setErr(null);
        setAssetsOpen(false);
        s3.listPath(prefix)
            .then((res) => alive && setItems(res))
            .catch((e) => alive && setErr(String(e.message || e)))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [prefix]);

    const project = path[0] || '';

    useEffect(() => {
        let alive = true;
        setProjectAssets([]);
        if (!project) return;
        s3.listPath(`${project}/`, { recursive: true })
            .then((res) => alive && setProjectAssets(res.filter(isAsset)))
            .catch(() => {
                /* asset chỉ là phần phụ của lưới — lỗi ở đây không nên chặn view */
            });
        return () => {
            alive = false;
        };
    }, [project]);

    const filtered = useMemo(() => filterByName(items, q), [items, q]);

    const inProject = path.length >= 1;
    const searching = q.trim().length > 0;
    const nonAssets = useMemo(() => filtered.filter((it) => !isAsset(it)), [filtered]);
    // Chỉ gom khi đang trong project và không tìm kiếm (tìm kiếm → phẳng để tìm cả asset).
    const grouped = inProject && !searching;
    const assetsView = grouped && assetsOpen;
    const visible = assetsView ? filterByName(projectAssets, q) : (grouped ? nonAssets : filtered);
    const shownCount = visible.length;

    function closeAssets() {
        setAssetsOpen(false);
    }

    async function handleDelete(it: S3Item) {
        if (!it.key) return;
        const ok = window.confirm(
            `Xoá "${it.name}" khỏi S3?\n\ns3://ik-nocode-paywall/${it.key}\n\nThao tác này không thể hoàn tác.`
        );
        if (!ok) return;
        setDeleting(it.key);
        setErr(null);
        try {
            await s3.deleteObject(it.key);
            setItems((prev) => prev.filter((x) => x.key !== it.key));
            setProjectAssets((prev) => prev.filter((x) => x.key !== it.key));
        } catch (e) {
            setErr(String((e as Error).message || e));
        } finally {
            setDeleting(null);
        }
    }

    return (
        <main className="browser">
            <header className="b-head">
                <div className="crumbs">
                    <button className="crumb" onClick={() => { closeAssets(); onCrumb(-1); }}>{BUCKET_LABEL}</button>
                    {/* Assets là của cả project, nên khi mở view đó breadcrumb dừng ở
                        tên project — kéo theo folder đang mở sẽ nói sai phạm vi. */}
                    {(assetsView ? path.slice(0, 1) : path).map((seg, i) => (
                        <span key={i} className="crumb-wrap">
                            <span className="crumb-sep">{Icon.chevron}</span>
                            <button className="crumb" onClick={() => { closeAssets(); onCrumb(i); }}>{seg}</button>
                        </span>
                    ))}
                    {assetsView && (
                        <span className="crumb-wrap">
                            <span className="crumb-sep">{Icon.chevron}</span>
                            <button className="crumb" onClick={closeAssets}>Assets</button>
                        </span>
                    )}
                </div>
                <div className="b-head-actions">
                    <div className="search">
                        <span className="search-ic">{Icon.search}</span>
                        <input placeholder="Tìm kiếm…" value={q} onChange={(e) => setQ(e.target.value)} />
                    </div>
                    {inProject && (
                        <button
                            className={'btn ghost sm' + (assetsOpen ? ' active' : '')}
                            title="Ảnh, video và media của cả project"
                            onClick={() => setAssetsOpen(!assetsOpen)}
                        >
                            {Icon.image} Assets
                            {projectAssets.length > 0 && (
                                <span className="btn-count">{projectAssets.length}</span>
                            )}
                        </button>
                    )}
                    {inProject && perms.update && (
                        <button className="btn primary sm" onClick={onNewLayout}>
                            {Icon.plus} New layout
                        </button>
                    )}
                </div>
            </header>

            <div className="b-meta">
                {loading ? <Dots label="Đang tải" /> : `${shownCount} mục`}
                {err && <span className="b-err"> · Lỗi: {err}</span>}
            </div>

            <div className="cards">
                {loading && visible.length === 0 && <SkeletonCards n={8} />}
                {visible.map((it) => (
                    <div key={it.name} className="card-wrap">
                        <button className="card" onClick={() => onOpen(it)}>
                            <div className={'card-thumb ' + it.type + thumbShape(it, kinds)}>
                                <CardThumb item={it} project={path[0] || ''} onKind={noteKind} />
                            </div>
                            <div className="card-body">
                                <div className="card-name">
                                    <span className="card-ic">{thumbIcon(it.type)}</span>
                                    {it.name}
                                </div>
                                <div className="card-sub">
                                    {it.type === 'folder'
                                        ? 'Folder'
                                        : `${fmtSize(it.size)} · ${fmtDate(it.modified)}`}
                                </div>
                                {/* Chỉ layout được push qua tool mới có metadata này; một
                                    animation Lottie hay ảnh thì không, nên đừng dán nhãn
                                    "Draft" cho thứ vốn không có vòng đời draft/live. */}
                                {(it.status || it.version) && (
                                    <div className="card-foot">
                                        {it.status && <StatusBadge status={it.status} />}
                                        {it.version && <span className="ver">{it.version}</span>}
                                    </div>
                                )}
                            </div>
                        </button>
                        {it.type !== 'folder' && it.key && perms.delete && (
                            <button
                                className="card-del"
                                title="Xoá file khỏi S3"
                                disabled={deleting === it.key}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(it);
                                }}
                            >
                                {Icon.trash}
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </main>
    );
}

const BUCKET_LABEL = 'ik-nocode-paywall';

function filterByName(items: S3Item[], q: string): S3Item[] {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => it.name.toLowerCase().includes(needle));
}

// Asset = ảnh + file media/khác (mp4…). JSON layout, config, html, folder giữ nguyên.
function isAsset(it: S3Item): boolean {
    return it.type === 'image' || it.type === 'other';
}

// config.json không phải card DivKit nên không dựng được preview.
function hasPreview(it: S3Item): boolean {
    return it.type === 'json' && !it.config && Boolean(it.key);
}

function thumbIcon(type: S3Item['type']) {
    if (type === 'folder') return Icon.folder;
    if (type === 'image') return Icon.image;
    if (type === 'html') return Icon.html;
    return Icon.json;
}

/**
 * Tỉ lệ tile theo loại nội dung: card DivKit lấy khung điện thoại để fit trọn
 * màn, còn lại giữ tile ngắn.
 *
 * Loại chỉ biết được sau khi tải nội dung, nên mặc định là khung điện thoại —
 * phần lớn .json trong bucket là layout, đoán như vậy thì ít tile phải nhảy
 * kích thước nhất.
 */
function thumbShape(it: S3Item, kinds: Record<string, JsonKind>): string {
    if (!hasPreview(it) || !it.key) return '';
    const kind = kinds[it.key];
    if (kind === 'lottie' || kind === 'unknown') return ' anim';
    return ' live';
}

// Thumbnail: json render thu nhỏ (card DivKit hoặc animation Lottie); ảnh và
// video lấy từ CDN; còn lại icon lớn.
function CardThumb({ item, project, onKind }: {
    item: S3Item;
    project: string;
    onKind(key: string, kind: JsonKind): void;
}) {
    const key = item.key;
    if (hasPreview(item) && key) {
        return (
            <JsonThumb
                itemKey={key}
                project={project}
                fallback={Icon.json}
                onKind={(kind) => onKind(key, kind)}
            />
        );
    }
    if (isPreviewableAsset(item)) {
        return <AssetMedia item={item} fallback={thumbIcon(item.type)} />;
    }
    return <span className="thumb-big">{thumbIcon(item.type)}</span>;
}
