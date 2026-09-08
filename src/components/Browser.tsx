// ── Trình duyệt S3: breadcrumb + tìm kiếm + lưới card ─────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../lib/icons';
import { fmtSize, fmtDate } from '../lib/format';
import { s3 } from '../s3';
import { usePerms } from '../auth/AuthContext';
import type { S3Item } from '../types';
import { Dots, SkeletonCards } from './Loader';
import { LayoutThumb } from './LayoutThumb';

function StatusBadge({ status }: { status?: S3Item['status'] }) {
    const map: Record<string, [string, string]> = {
        live: ['var(--green)', 'Live'],
        draft: ['var(--amber)', 'Draft'],
        archived: ['#888', 'Archived']
    };
    const [c, label] = map[status || 'draft'] || map.draft;
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
    // Gom ảnh/video vào 1 "folder" Assets ảo (chỉ hiển thị, không đổi S3).
    const [assetsOpen, setAssetsOpen] = useState(false);

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

    const filtered = useMemo(
        () => items.filter((it) => it.name.toLowerCase().includes(q.toLowerCase())),
        [items, q]
    );

    const inProject = path.length >= 1;
    const searching = q.trim().length > 0;
    const assets = useMemo(() => filtered.filter(isAsset), [filtered]);
    const nonAssets = useMemo(() => filtered.filter((it) => !isAsset(it)), [filtered]);
    // Chỉ gom khi đang trong project và không tìm kiếm (tìm kiếm → phẳng để tìm cả asset).
    const grouped = inProject && !searching;
    const visible = grouped ? (assetsOpen ? assets : nonAssets) : filtered;
    const showAssetCard = grouped && !assetsOpen && assets.length > 0;
    const shownCount = visible.length + (showAssetCard ? 1 : 0);

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
                    {path.map((seg, i) => (
                        <span key={i} className="crumb-wrap">
                            <span className="crumb-sep">{Icon.chevron}</span>
                            <button className="crumb" onClick={() => { closeAssets(); onCrumb(i); }}>{seg}</button>
                        </span>
                    ))}
                    {grouped && assetsOpen && (
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
                {showAssetCard && (
                    <div className="card-wrap">
                        <button className="card" onClick={() => setAssetsOpen(true)}>
                            <div className="card-thumb folder">
                                <span className="thumb-big">{Icon.folder}</span>
                            </div>
                            <div className="card-body">
                                <div className="card-name">
                                    <span className="card-ic">{Icon.folder}</span>
                                    Assets
                                </div>
                                <div className="card-sub">{assets.length} ảnh/video</div>
                            </div>
                        </button>
                    </div>
                )}
                {visible.map((it) => (
                    <div key={it.name} className="card-wrap">
                        <button className="card" onClick={() => onOpen(it)}>
                            <div className={'card-thumb ' + it.type + (hasPreview(it) ? ' live' : '')}>
                                <CardThumb item={it} prefix={prefix} project={path[0] || ''} />
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
                                {it.type === 'json' && !it.config && (
                                    <div className="card-foot">
                                        <StatusBadge status={it.status} />
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

// Thumbnail: ảnh thật resolve qua presign/CDN; layout JSON render thu nhỏ;
// còn lại dùng icon lớn.
function CardThumb({ item, prefix, project }: { item: S3Item; prefix: string; project: string }) {
    const [src, setSrc] = useState<string | null>(null);
    useEffect(() => {
        let alive = true;
        if (item.type === 'image' && item.key) {
            s3.getAssetUrl(item.key).then((u) => alive && setSrc(u)).catch(() => {});
        }
        return () => {
            alive = false;
        };
    }, [item, prefix]);

    if (item.type === 'image') {
        return src ? <img src={src} alt={item.name} /> : <span className="thumb-big">{Icon.image}</span>;
    }
    if (hasPreview(item) && item.key) {
        return <LayoutThumb itemKey={item.key} project={project} fallback={Icon.json} />;
    }
    return <span className="thumb-big">{thumbIcon(item.type)}</span>;
}
