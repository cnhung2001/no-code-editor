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
}

export function Sidebar({ projects, files, activeProject, onProject, onFile, onRoot }: Props) {
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
                <UserMenu />
            </div>
        </aside>
    );
}
