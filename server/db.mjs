// ── Postgres: pool + schema tự sync lúc boot ──────────────────────────────
// Không có file migration. Schema định nghĩa ngay trong file này bằng các câu
// lệnh idempotent, chạy mỗi lần khởi động.
//
// ⚠ Giới hạn cố ý: cách này THÊM bảng/cột thì an toàn, nhưng KHÔNG đổi tên và
//   KHÔNG xoá cột. Thay đổi phá huỷ phải làm tay trên DB — nếu để tự động, một
//   lần deploy nhầm là mất dữ liệu audit không lấy lại được.

import pg from 'pg';

const {
    POSTGRES_HOST,
    POSTGRES_PORT = '5432',
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_DATABASE
} = process.env;

/**
 * DB là tuỳ chọn: thiếu cấu hình thì app vẫn chạy được ở chế độ hiện tại
 * (AUTHZ_PROJECT_SCOPE=off, không audit). Nếu bắt buộc phải có DB mới boot
 * được thì một sự cố Postgres sẽ kéo sập cả tool chỉ vì mất phần ghi log.
 */
export const DB_ENABLED = Boolean(POSTGRES_HOST && POSTGRES_USER && POSTGRES_DATABASE);

export const pool = DB_ENABLED
    ? new pg.Pool({
          host: POSTGRES_HOST,
          port: Number(POSTGRES_PORT),
          user: POSTGRES_USER,
          password: POSTGRES_PASSWORD,
          database: POSTGRES_DATABASE,
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 10_000
      })
    : null;

// Pool phát 'error' cho client đang idle bị server đóng. Không bắt thì Node
// coi là uncaught và giết tiến trình — mất cả app chỉ vì DB restart.
pool?.on('error', (err) => console.warn('[db] lỗi idle client:', err.message));

export async function query(text, params) {
    if (!pool) throw new Error('Postgres chưa được cấu hình');
    return pool.query(text, params);
}

// Khoá tư vấn cho ensureSchema. Blue-green có lúc hai container cùng khởi
// động; hai lần CREATE TABLE IF NOT EXISTS chạy song song vẫn có thể đâm nhau
// ở tầng catalog của Postgres.
const SCHEMA_LOCK_ID = 8_140_2601;

const STATEMENTS = [
    `create table if not exists projects (
        id            serial primary key,
        bucket_prefix text not null unique,
        display_name  text,
        is_active     boolean not null default true,
        created_at    timestamptz not null default now(),
        updated_at    timestamptz not null default now()
    )`,

    `create table if not exists project_authz_links (
        project_id integer not null references projects(id) on delete cascade,
        authz_slug text not null,
        primary key (project_id, authz_slug)
    )`,

    // Tra ngược: từ danh sách slug của user → những folder họ được thấy.
    `create index if not exists project_authz_links_slug_idx
        on project_authz_links (authz_slug)`,

    `create table if not exists audit_logs (
        id            bigserial primary key,
        at            timestamptz not null default now(),
        user_id       text,
        user_email    text,
        action        text not null,
        outcome       text not null,
        bucket_prefix text,
        object_key    text,
        method        text,
        path          text,
        status_code   integer,
        s3_version_id text,
        detail        jsonb,
        ip            text,
        user_agent    text
    )`,

    `create index if not exists audit_logs_at_idx on audit_logs (at desc)`,
    `create index if not exists audit_logs_prefix_at_idx on audit_logs (bucket_prefix, at desc)`,
    `create index if not exists audit_logs_user_at_idx on audit_logs (user_id, at desc)`
];

/**
 * Dựng/cập nhật schema. Idempotent, an toàn khi chạy song song.
 * Trả về false khi DB chưa cấu hình để caller biết mà tắt các tính năng cần DB.
 */
export async function ensureSchema() {
    if (!pool) {
        console.warn('[db] thiếu POSTGRES_* — chạy không có DB (không phân quyền project, không audit)');
        return false;
    }

    const client = await pool.connect();
    try {
        await client.query('select pg_advisory_lock($1)', [SCHEMA_LOCK_ID]);
        for (const sql of STATEMENTS) await client.query(sql);
        console.log(`[db] schema OK (${POSTGRES_DATABASE}@${POSTGRES_HOST})`);
        return true;
    } finally {
        // Nhả khoá trước khi trả client về pool, nếu không client mang khoá quay
        // lại pool và lần ensureSchema sau của tiến trình này sẽ tự chờ chính nó.
        await client.query('select pg_advisory_unlock($1)', [SCHEMA_LOCK_ID]).catch(() => {});
        client.release();
    }
}
