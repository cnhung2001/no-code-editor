// ── Màn Admin: mapping folder↔project authz + audit log ───────────────────
// Chỉ hiện cho admin/owner cấp system (gate theo ROLE, xem App.tsx). Backend
// vẫn gate độc lập — ẩn nút không phải là phân quyền.

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../lib/icons';
import {
    listAudit,
    listMappings,
    removeMapping,
    saveMapping,
    type AuditFilter,
    type AuditRow,
    type MappingsResponse,
    type ProjectMapping
} from './api';

type Tab = 'mapping' | 'audit';

export function AdminScreen({ onBack }: { onBack(): void }) {
    const [tab, setTab] = useState<Tab>('mapping');

    return (
        <main className="admin">
            <header className="admin-head">
                <button className="link-back" onClick={onBack}>{Icon.back} Quay lại</button>
                <nav className="admin-tabs">
                    <button
                        className={'admin-tab' + (tab === 'mapping' ? ' active' : '')}
                        onClick={() => setTab('mapping')}
                    >
                        Phân quyền project
                    </button>
                    <button
                        className={'admin-tab' + (tab === 'audit' ? ' active' : '')}
                        onClick={() => setTab('audit')}
                    >
                        Audit log
                    </button>
                </nav>
            </header>

            {tab === 'mapping' ? <MappingPanel /> : <AuditPanel />}
        </main>
    );
}

// ── Tab 1: mapping folder bucket ↔ slug authz ─────────────────────────────

function MappingPanel() {
    const [data, setData] = useState<MappingsResponse | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);
    const [slugDraft, setSlugDraft] = useState('');

    const load = useCallback(() => {
        listMappings()
            .then(setData)
            .catch((e) => setErr(String((e as Error).message || e)));
    }, []);

    useEffect(load, [load]);

    if (err) return <div className="admin-err">Lỗi: {err}</div>;
    if (!data) return <div className="admin-empty">Đang tải…</div>;

    const byPrefix = new Map(data.mappings.map((m) => [m.bucketPrefix, m]));
    // Folder có trong bucket nhưng chưa khai báo ⇒ thành viên project không có
    // đường vào; role cấp system vẫn vào bình thường.
    const rows = data.bucketPrefixes.map((prefix) => ({
        prefix,
        mapping: byPrefix.get(prefix) || null
    }));
    // Mapping trỏ tới folder không còn tồn tại trong bucket — rác, nên thấy được.
    const orphans = data.mappings.filter((m) => !data.bucketPrefixes.includes(m.bucketPrefix));

    async function persist(prefix: string, slugs: string[]) {
        setBusy(true);
        setErr(null);
        try {
            await saveMapping({ bucketPrefix: prefix, authzSlugs: slugs });
            // Client không cache perms — backend resolve lại mỗi request, nên
            // load() phía dưới là đủ để UI thấy mapping mới.
            setEditing(null);
            load();
        } catch (e) {
            setErr(String((e as Error).message || e));
        } finally {
            setBusy(false);
        }
    }

    async function drop(m: ProjectMapping) {
        if (!window.confirm(`Xoá mapping của "${m.bucketPrefix}"?\n\nThành viên project sẽ mất đường vào folder này; người có role cấp system không ảnh hưởng.`)) return;
        setBusy(true);
        try {
            await removeMapping(m.id);
            load();
        } catch (e) {
            setErr(String((e as Error).message || e));
        } finally {
            setBusy(false);
        }
    }

    const unmapped = rows.filter((r) => !r.mapping || r.mapping.authzSlugs.length === 0).length;

    return (
        <div className="admin-body">
            <div className="admin-note">
                Chế độ hiện tại: <b>{data.scope}</b>
                {data.scope === 'off' && ' — quyền vẫn quyết định ở cấp system, mapping chưa có hiệu lực.'}
                {data.scope === 'shadow' && ' — vẫn quyết định ở cấp system, nhưng ghi lại ai đang bị chặn oan mà bật "on" sẽ vào được.'}
                {data.scope === 'on' && ' — quyền quyết định theo từng project.'}
                {unmapped > 0 && (
                    <div className="admin-warn">
                        {unmapped} folder chưa map slug nào — thành viên project không vào được, chỉ
                        người có role cấp system vào được. Bật <code>on</code> KHÔNG lấy đi quyền của
                        ai; nó chỉ thêm đường vào cho thành viên project của folder đã map.
                    </div>
                )}
            </div>

            <table className="admin-table">
                <thead>
                    <tr>
                        <th>Folder bucket</th>
                        <th>Project authz</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {rows.map(({ prefix, mapping }) => (
                        <tr key={prefix} className={!mapping?.authzSlugs.length ? 'row-unmapped' : ''}>
                            <td className="cell-prefix">{prefix}</td>
                            <td>
                                {editing === prefix ? (
                                    <input
                                        autoFocus
                                        className="admin-input"
                                        value={slugDraft}
                                        placeholder="slug-1, slug-2"
                                        onChange={(e) => setSlugDraft(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                persist(
                                                    prefix,
                                                    slugDraft.split(',').map((s) => s.trim()).filter(Boolean)
                                                );
                                            }
                                            if (e.key === 'Escape') setEditing(null);
                                        }}
                                    />
                                ) : mapping?.authzSlugs.length ? (
                                    <span className="slug-list">
                                        {mapping.authzSlugs.map((s) => (
                                            <code key={s} className="slug">{s}</code>
                                        ))}
                                    </span>
                                ) : (
                                    <span className="muted">chưa map</span>
                                )}
                            </td>
                            <td className="cell-actions">
                                {editing === prefix ? (
                                    <>
                                        <button
                                            className="btn primary sm"
                                            disabled={busy}
                                            onClick={() =>
                                                persist(
                                                    prefix,
                                                    slugDraft.split(',').map((s) => s.trim()).filter(Boolean)
                                                )
                                            }
                                        >
                                            Lưu
                                        </button>
                                        <button className="btn ghost sm" onClick={() => setEditing(null)}>
                                            Huỷ
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            className="btn ghost sm"
                                            onClick={() => {
                                                setEditing(prefix);
                                                setSlugDraft((mapping?.authzSlugs || []).join(', '));
                                            }}
                                        >
                                            Sửa
                                        </button>
                                        {mapping && (
                                            <button className="btn ghost sm" disabled={busy} onClick={() => drop(mapping)}>
                                                Xoá
                                            </button>
                                        )}
                                    </>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {orphans.length > 0 && (
                <>
                    <div className="admin-note admin-warn">
                        Mapping trỏ tới folder không còn trong bucket:
                    </div>
                    <table className="admin-table">
                        <tbody>
                            {orphans.map((m) => (
                                <tr key={m.id}>
                                    <td className="cell-prefix">{m.bucketPrefix}</td>
                                    <td>
                                        <span className="slug-list">
                                            {m.authzSlugs.map((s) => (
                                                <code key={s} className="slug">{s}</code>
                                            ))}
                                        </span>
                                    </td>
                                    <td className="cell-actions">
                                        <button className="btn ghost sm" disabled={busy} onClick={() => drop(m)}>
                                            Xoá
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}
        </div>
    );
}

// ── Tab 2: audit log ──────────────────────────────────────────────────────

const ACTIONS = ['', 'update', 'publish', 'delete', 'upload', 'read', 'login', 'logout', 'admin-update'];

function AuditPanel() {
    const [filter, setFilter] = useState<AuditFilter>({ limit: 100 });
    const [rows, setRows] = useState<AuditRow[] | null>(null);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        setErr(null);
        listAudit(filter)
            .then((r) => alive && setRows(r))
            .catch((e) => alive && setErr(String((e as Error).message || e)));
        return () => {
            alive = false;
        };
    }, [filter]);

    const set = (patch: Partial<AuditFilter>) => setFilter((f) => ({ ...f, ...patch }));

    return (
        <div className="admin-body">
            <div className="audit-filters">
                <input
                    className="admin-input"
                    placeholder="Project (folder)"
                    value={filter.project || ''}
                    onChange={(e) => set({ project: e.target.value })}
                />
                <input
                    className="admin-input"
                    placeholder="Email người dùng"
                    value={filter.user || ''}
                    onChange={(e) => set({ user: e.target.value })}
                />
                <select
                    className="admin-input"
                    value={filter.action || ''}
                    onChange={(e) => set({ action: e.target.value })}
                >
                    {ACTIONS.map((a) => (
                        <option key={a} value={a}>{a || 'Mọi action'}</option>
                    ))}
                </select>
                <input
                    className="admin-input"
                    type="date"
                    value={filter.from || ''}
                    onChange={(e) => set({ from: e.target.value })}
                />
                <input
                    className="admin-input"
                    type="date"
                    value={filter.to || ''}
                    onChange={(e) => set({ to: e.target.value })}
                />
            </div>

            {err && <div className="admin-err">Lỗi: {err}</div>}
            {!rows && !err && <div className="admin-empty">Đang tải…</div>}
            {rows && rows.length === 0 && <div className="admin-empty">Không có bản ghi nào khớp.</div>}

            {rows && rows.length > 0 && (
                <table className="admin-table audit-table">
                    <thead>
                        <tr>
                            <th>Thời điểm</th>
                            <th>Người dùng</th>
                            <th>Action</th>
                            <th>Project</th>
                            <th>File</th>
                            <th>Kết quả</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.id} className={r.outcome !== 'allow' ? 'row-deny' : ''}>
                                <td className="cell-time">{new Date(r.at).toLocaleString('vi-VN')}</td>
                                <td>{r.user_email || <span className="muted">—</span>}</td>
                                <td><code>{r.action}</code></td>
                                <td>{r.bucket_prefix || <span className="muted">—</span>}</td>
                                <td className="cell-key" title={r.object_key || ''}>
                                    {r.object_key || <span className="muted">—</span>}
                                    {r.detail?.version ? <span className="ver"> {String(r.detail.version)}</span> : null}
                                </td>
                                <td>
                                    <span className={'outcome outcome--' + r.outcome}>{r.outcome}</span>
                                    {r.status_code ? <span className="muted"> {r.status_code}</span> : null}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
