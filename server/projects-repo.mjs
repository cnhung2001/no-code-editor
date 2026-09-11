// ── Mapping folder bucket ↔ project authz ─────────────────────────────────
// Tên folder trong bucket KHÔNG trùng slug bên authz (đã đối chiếu: 17 folder,
// 86 project, 0 cặp trùng tuyệt đối), và một folder thường ứng với nhiều project
// (prod + debug + iOS + Android tách riêng). Nên mapping là dữ liệu người vận
// hành nhập, quan hệ nhiều-nhiều, không phải quy ước suy ra từ tên.

import { query, DB_ENABLED } from './db.mjs';

// Guard chạy trên MỌI request /api, mapping thì đổi vài lần một tháng → cache.
// TTL ngắn để sửa mapping trên UI có hiệu lực gần như ngay, kể cả ở container
// blue/green còn lại (nơi invalidate cục bộ không với tới).
const CACHE_TTL_MS = 60_000;

let cache = null;
let cacheAt = 0;
let inflight = null;

async function load() {
    const { rows } = await query(
        `select p.id, p.bucket_prefix, p.display_name, p.is_active,
                coalesce(
                    array_agg(l.authz_slug order by l.authz_slug)
                        filter (where l.authz_slug is not null),
                    '{}'
                ) as authz_slugs
           from projects p
           left join project_authz_links l on l.project_id = p.id
          group by p.id
          order by p.bucket_prefix`
    );
    return rows.map((r) => ({
        id: r.id,
        bucketPrefix: r.bucket_prefix,
        displayName: r.display_name,
        isActive: r.is_active,
        authzSlugs: r.authz_slugs
    }));
}

/** Toàn bộ mapping, có cache. Nhiều request đồng thời chia chung một lần load. */
export async function listMappings() {
    if (!DB_ENABLED) return [];
    if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
    // Không single-flight thì một burst request lúc cache hết hạn sẽ bắn N query
    // song song, mỗi cái ghi đè cache của cái trước.
    if (!inflight) {
        inflight = load()
            .then((rows) => {
                cache = rows;
                cacheAt = Date.now();
                return rows;
            })
            .finally(() => {
                inflight = null;
            });
    }
    return inflight;
}

export function invalidateCache() {
    cache = null;
    cacheAt = 0;
}

/** Mapping của đúng một folder. `null` khi folder chưa được khai báo. */
export async function findByPrefix(bucketPrefix) {
    const all = await listMappings();
    return all.find((m) => m.bucketPrefix === bucketPrefix) || null;
}

/**
 * Các authz slug đã map với folder. Mảng rỗng nghĩa là folder chưa map (hoặc
 * chưa khai báo) — caller phải xử như "không ai ngoài role system vào được",
 * không phải "cho qua".
 */
export async function slugsForPrefix(bucketPrefix) {
    const row = await findByPrefix(bucketPrefix);
    if (!row || !row.isActive) return [];
    return row.authzSlugs;
}

// ── CRUD cho màn admin ────────────────────────────────────────────────────

export async function createProject({ bucketPrefix, displayName, authzSlugs = [] }) {
    const { rows } = await query(
        `insert into projects (bucket_prefix, display_name)
         values ($1, $2)
         on conflict (bucket_prefix)
           do update set display_name = excluded.display_name, updated_at = now()
         returning id`,
        [bucketPrefix, displayName || null]
    );
    await replaceLinks(rows[0].id, authzSlugs);
    invalidateCache();
    return rows[0].id;
}

export async function updateProject(id, { displayName, isActive, authzSlugs }) {
    await query(
        `update projects
            set display_name = coalesce($2, display_name),
                is_active    = coalesce($3, is_active),
                updated_at   = now()
          where id = $1`,
        [id, displayName ?? null, isActive ?? null]
    );
    if (authzSlugs) await replaceLinks(id, authzSlugs);
    invalidateCache();
}

export async function deleteProject(id) {
    // project_authz_links có ON DELETE CASCADE → link tự đi theo.
    await query('delete from projects where id = $1', [id]);
    invalidateCache();
}

async function replaceLinks(projectId, authzSlugs) {
    await query('delete from project_authz_links where project_id = $1', [projectId]);
    const slugs = [...new Set(authzSlugs.filter(Boolean))];
    if (!slugs.length) return;
    await query(
        `insert into project_authz_links (project_id, authz_slug)
         select $1, unnest($2::text[])
         on conflict do nothing`,
        [projectId, slugs]
    );
}
