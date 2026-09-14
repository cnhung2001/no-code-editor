// ── Left rail: bucket + danh sách project ─────────────────────────────────
import { Icon } from '../lib/icons';
import { UserMenu } from '../auth/UserMenu';
import type { ProjectInfo, S3Item } from '../types';
import { SkeletonRows } from './Loader';

const BUCKET = 'ik-nocode-paywall';
const REGION = 'ap-southeast-1';

function kindIcon(type: S3Item['type']) {
    if (type === 'image') return Icon.image;
    if (type === 'html') return Icon.html;
    if (type === 'json') return Icon.json;
    return Icon.external;
}

interface Props {
    projects: ProjectInfo[];
    files: S3Item[];
    activeProject: string | null;
    onProject(name: string): void;
    onFile(item: S3Item): void;
    onRoot(): void;
    /** Quyền cấp system — chỉ để ẩn/hiện mục Admin, backend vẫn tự gate. */
    canAdmin?: boolean;
    onAdmin?(): void;
    onGuide(): void;
}

export function Sidebar({
    projects,
    files,
    activeProject,
    onProject,
    onFile,
    onRoot,
    canAdmin,
    onAdmin,
    onGuide
}: Props) {
    return (
        <aside className="sidebar">
            <button className="brand" onClick={onRoot}>
                <span className="brand-mark">&lt;/&gt;</span>
                <div>
                    <div className="brand-name">NoCode Preview</div>
                    <div className="brand-sub">DivKit · Remote Config</div>
                </div>
            </button>

            <button className={'bucket' + (!activeProject ? ' active' : '')} onClick={onRoot}>
                <span className="bucket-ic">{Icon.cloud}</span>
                <div>
                    <div className="bucket-name">{BUCKET}</div>
                    <div className="bucket-region">s3 · {REGION}</div>
                </div>
                <span className="bucket-conn" title="Connected" />
            </button>

            <div className="tree-label">Projects</div>
            <nav className="tree">
                {projects.map((p) => (
                    <button
                        key={p.name}
                        // Tên dài bị cắt bằng ellipsis → title là cách duy nhất
                        // đọc được tên đầy đủ.
                        title={p.name}
                        className={'tree-item' + (activeProject === p.name ? ' active' : '')}
                        onClick={() => onProject(p.name)}
                    >
                        <span className="tree-ic">{Icon.folder}</span>
                        <span className="tree-name">{p.name}</span>
                        <span className="tree-count">{p.layoutCount}</span>
                    </button>
                ))}
                {projects.length === 0 && <SkeletonRows n={4} />}
            </nav>

            {files.length > 0 && (
                <>
                    <div className="tree-label">Files</div>
                    <nav className="tree">
                        {files.map((f) => (
                            <button
                                key={f.key || f.name}
                                title={f.name}
                                className="tree-item"
                                onClick={() => onFile(f)}
                            >
                                <span className="tree-ic">{kindIcon(f.type)}</span>
                                <span className="tree-name">{f.name}</span>
                            </button>
                        ))}
                    </nav>
                </>
            )}

            <div className="sidebar-foot">
                <button className="tree-item" onClick={onGuide}>
                    <span className="tree-ic">{Icon.info}</span>
                    <span className="tree-name">Hướng dẫn</span>
                </button>
                {canAdmin && onAdmin && (
                    <button className="tree-item admin-link" onClick={onAdmin}>
                        <span className="tree-ic">{Icon.settings}</span>
                        <span className="tree-name">Admin</span>
                    </button>
                )}
                <UserMenu />
            </div>
        </aside>
    );
}
