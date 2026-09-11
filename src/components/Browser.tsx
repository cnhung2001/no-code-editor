// ── Trình duyệt S3: breadcrumb + tìm kiếm + lưới card ─────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../lib/icons';
import { fmtSize, fmtDate } from '../lib/format';
import { s3, peekList } from '../s3';
import type { JsonKind } from '@divkitframework/visual-editor/dist/preview.js';
import { useProjectPerms } from '../auth/AuthContext';
import type { S3Item } from '../types';
import { Dots, SkeletonCards } from './Loader';
import { JsonThumb } from './JsonThumb';
import { AssetMedia, isPreviewableAsset, isVideoAsset } from './AssetPreview';

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
    const perms = useProjectPerms(path[0]);
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
    // Toàn bộ file của project (đệ quy). Dùng cho hai việc: danh sách Assets, và
    // biết folder nào chỉ chứa asset để loại khỏi lưới layout.
    const [projectFiles, setProjectFiles] = useState<S3Item[]>([]);
    const [projectLoaded, setProjectLoaded] = useState(false);
    // Loại của từng .json, do JsonThumb báo lên sau khi tải nội dung: tên file
    // không phân biệt được card DivKit với animation Lottie.
    const [kinds, setKinds] = useState<Record<string, JsonKind>>({});
    const noteKind = useCallback(
        (key: string, kind: JsonKind) => setKinds((prev) => (prev[key] === kind ? prev : { ...prev, [key]: kind })),
        []
    );

    // Huỷ, không chỉ bỏ qua. Cờ `alive` chặn được setState nhưng request vẫn
    // chạy tới cùng: bấm qua năm tab là ~90 request rác còn đang bay, mà browser
    // chỉ mở 6 kết nối/origin — request của tab ĐANG xem xếp hàng sau tất cả
    // chúng. Đó là lý do đổi tab liên tục thì mỗi lần lại lâu hơn lần trước.
    useEffect(() => {
        const ac = new AbortController();
        // Đã xem chỗ này rồi thì vẽ luôn, đừng bắt nhìn skeleton lần nữa. Vẫn
        // tải lại ở dưới: người khác có thể vừa publish hoặc xoá gì đó.
        const cached = peekList(prefix);
        setItems(cached ?? []);
        setLoading(!cached);
        setErr(null);
        setAssetsOpen(false);
        s3.listPath(prefix, { signal: ac.signal })
            .then((res) => !ac.signal.aborted && setItems(res))
            .catch((e) => !ac.signal.aborted && setErr(String(e.message || e)))
            .finally(() => !ac.signal.aborted && setLoading(false));
        return () => ac.abort();
    }, [prefix]);

    const project = path[0] || '';

    useEffect(() => {
        const ac = new AbortController();
        const cachedFiles = project ? peekList(`${project}/`, true) : undefined;
        setProjectFiles(cachedFiles ?? []);
        // Có cache thì folder chỉ chứa asset được lọc ngay từ nhịp đầu, không
        // hiện lên rồi biến mất.
        setProjectLoaded(Boolean(cachedFiles));
        if (!project) return;
        s3.listPath(`${project}/`, { recursive: true, signal: ac.signal })
            .then((res) => !ac.signal.aborted && setProjectFiles(res))
            .catch(() => {
                /* asset chỉ là phần phụ của lưới — lỗi ở đây không nên chặn view.
                   Không có danh sách thì không ẩn folder nào: thà thừa hơn thiếu. */
            })
            .finally(() => !ac.signal.aborted && setProjectLoaded(true));
        return () => ac.abort();
    }, [project]);

    const projectAssets = useMemo(
        () => collapseHlsStreams(projectFiles.filter(isAsset)),
        [projectFiles]
    );
    const assetFolders = useMemo(
        () => assetOnlyFolders(projectFiles, prefix),
        [projectFiles, prefix]
    );

    const filtered = useMemo(() => filterByName(items, q), [items, q]);

    const inProject = path.length >= 1;
    const searching = q.trim().length > 0;
    // Chỉ chờ danh sách prefix. Trước đây chờ cả danh sách đệ quy của CẢ project
    // nữa, nên lưới nằm im sau skeleton dù dữ liệu để vẽ card đã về từ lâu.
    const gridLoading = loading;
    // Danh sách prefix về trước, mà chỉ danh sách đệ quy mới biết folder nào chỉ
    // chứa asset. Cái phải hoãn vì vậy đúng là FOLDER, không phải cả lưới: vẽ
    // sớm rồi rút đi là nhấp nháy, còn vẽ muộn chỉ là một mục xuất hiện thêm —
    // và phần nặng của lưới (card layout + thumbnail) không phải chờ gì cả.
    const foldersReady = !inProject || projectLoaded;
    // Khung chính chỉ có layout: bỏ file asset, và bỏ luôn những folder mà bên
    // trong không có layout nào (images/, videos/, anim/…) — asset đã có view
    // riêng gom cả project nên không mất gì.
    const nonAssets = useMemo(
        () => filtered.filter((it) => {
            if (isAsset(it)) return false;
            if (it.type !== 'folder') return true;
            return foldersReady && !assetFolders.has(it.name);
        }),
        [filtered, assetFolders, foldersReady]
    );
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
            setProjectFiles((prev) => prev.filter((x) => x.key !== it.key));
        } catch (e) {
            setErr(String((e as Error).message || e));
        } finally {
            setDeleting(null);
        }
    }

    // Một card, dùng cho cả lưới layout và các nhóm trong view assets.
    function renderCard(it: S3Item) {
        return (
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
                    {/* Không có nút xoá cho stream HLS: nó là hàng chục object, mà
                        nút này xoá đúng một key — bấm xong sẽ còn lại một folder
                        segment mồ côi không ai thấy. */}
                    {it.type !== 'folder' && it.type !== 'hls' && it.key && perms.delete && (
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
        );
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
                {gridLoading ? <Dots label="Đang tải" /> : `${shownCount} mục`}
                {err && <span className="b-err"> · Lỗi: {err}</span>}
            </div>

            <div className="cards-scroll">
                {gridLoading && <div className="cards"><SkeletonCards n={8} /></div>}
                {!gridLoading && assetsView && groupAssets(visible).map((group) => (
                    <section key={group.key} className="asset-group">
                        <h3 className="asset-group-head">
                            {group.label}
                            <span className="asset-group-count">{group.items.length}</span>
                        </h3>
                        <div className="cards">{group.items.map(renderCard)}</div>
                    </section>
                ))}
                {!gridLoading && !assetsView && <div className="cards">{visible.map(renderCard)}</div>}
            </div>
        </main>
    );
}

const BUCKET_LABEL = 'ik-nocode-paywall';

/**
 * Tên những folder con của `prefix` mà cả cây bên dưới không có layout nào.
 *
 * Xét theo nội dung chứ không theo tên: một folder tên "videos" vẫn có thể có
 * layout, và một folder tên bất kỳ vẫn có thể chỉ chứa ảnh. `files` là danh
 * sách đệ quy của cả project nên phủ được folder lồng nhiều tầng.
 */
function assetOnlyFolders(files: S3Item[], prefix: string): Set<string> {
    const folders = new Set<string>();
    const withLayout = new Set<string>();

    for (const file of files) {
        if (!file.key?.startsWith(prefix)) continue;
        const rest = file.key.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash < 0) continue; // file nằm ngay tại prefix, không thuộc folder con
        const folder = rest.slice(0, slash);
        folders.add(folder);
        if (!isAsset(file)) withLayout.add(folder);
    }

    for (const folder of withLayout) {
        folders.delete(folder);
    }
    return folders;
}

/**
 * Gộp mỗi stream HLS thành MỘT mục.
 *
 * Một stream là cả một folder — master.m3u8, playlist từng rendition, rồi hàng
 * chục segment .ts — nhưng nó là một video. Trải phẳng ra thì 29 mục rác đè
 * chết mọi asset khác trong danh sách.
 *
 * Gốc của stream là folder chứa .m3u8 NÔNG NHẤT: các rendition
 * (stream_360p/index.m3u8) nằm dưới nó nên tự động bị gộp vào.
 */
function collapseHlsStreams(assets: S3Item[]): S3Item[] {
    const playlistFolders = assets
        .filter((it) => it.name.endsWith('.m3u8'))
        .map((it) => it.name.replace(/\/[^/]+$/, ''))
        .filter((folder, i, all) => all.indexOf(folder) === i)
        .sort((a, b) => a.length - b.length);
    if (!playlistFolders.length) return assets;

    const roots: string[] = [];
    for (const folder of playlistFolders) {
        if (!roots.some((root) => folder === root || folder.startsWith(`${root}/`))) {
            roots.push(folder);
        }
    }

    const streams = new Map<string, S3Item>(
        roots.map((root) => [root, { name: root, type: 'hls' as const, size: 0 }])
    );
    const rest: S3Item[] = [];

    for (const item of assets) {
        const root = roots.find((r) => item.name.startsWith(`${r}/`));
        if (!root) {
            rest.push(item);
            continue;
        }
        const stream = streams.get(root)!;
        stream.size = (stream.size || 0) + (item.size || 0);
        if (!stream.modified || (item.modified && item.modified > stream.modified)) {
            stream.modified = item.modified;
        }
        // Playlist gốc là chỗ vào của stream — giữ key đó để copy/mở được.
        if (!stream.key && item.name === `${root}/master.m3u8`) {
            stream.key = item.key;
        }
    }
    // Không có master.m3u8 thì lấy playlist nông nhất làm chỗ vào.
    for (const [root, stream] of streams) {
        if (stream.key) continue;
        stream.key = assets.find(
            (it) => it.name.startsWith(`${root}/`) && it.name.endsWith('.m3u8')
        )?.key;
    }

    return [...rest, ...streams.values()];
}

/**
 * Assets chia theo loại. Một project có thể có tám mươi mấy file trộn lẫn,
 * mà tìm một cái ảnh và tìm một cái animation là hai việc khác nhau.
 *
 * "Khác" phải có để không file nào biến mất: .m3u8, .zip… đều rơi vào đây.
 */
const ASSET_GROUPS: { key: string; label: string; match(it: S3Item): boolean }[] = [
    { key: 'image', label: 'Ảnh', match: (it) => it.type === 'image' },
    { key: 'video', label: 'Video', match: isVideoAsset },
    { key: 'lottie', label: 'Animation', match: (it) => it.type === 'lottie' },
    { key: 'other', label: 'Khác', match: () => true }
];

function groupAssets(items: S3Item[]) {
    const groups = ASSET_GROUPS.map((g) => ({ ...g, items: [] as S3Item[] }));
    for (const item of items) {
        // Nhóm đầu tiên khớp thắng, nên 'other' ở cuối là chỗ hứng phần còn lại.
        groups.find((g) => g.match(item))?.items.push(item);
    }
    return groups.filter((g) => g.items.length > 0);
}

function filterByName(items: S3Item[], q: string): S3Item[] {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => it.name.toLowerCase().includes(needle));
}

// Asset = ảnh, media (mp4…) và animation Lottie. Lottie là .json nhưng không
// phải layout: nó là nguyên liệu của layout, nên thuộc Assets.
// Card DivKit, config, html, folder giữ nguyên trong lưới.
function isAsset(it: S3Item): boolean {
    return it.type === 'image' || it.type === 'other' || it.type === 'lottie';
}

// config.json không phải card DivKit nên không dựng được preview.
function hasPreview(it: S3Item): boolean {
    return (it.type === 'json' || it.type === 'lottie') && !it.config && Boolean(it.key);
}

function thumbIcon(type: S3Item['type']) {
    if (type === 'folder') return Icon.folder;
    if (type === 'image') return Icon.image;
    if (type === 'html') return Icon.html;
    if (type === 'lottie' || type === 'other' || type === 'hls') return Icon.media;
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
    if (it.type === 'lottie') return ' anim';
    // Server đoán theo 512 byte đầu; kinds[] là kết quả đọc trọn file lúc
    // render, nên nó thắng khi hai bên lệch nhau.
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
