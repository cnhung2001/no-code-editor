// ── Test cho listCache.ts ─────────────────────────────────────────────────
// Chạy: npm run test:cache  (node --experimental-strip-types, không cần test runner)

import type { S3Adapter, S3Item } from '../types.ts';
import { peekList, withListCache } from './listCache.ts';

let pass = 0;
const fails: string[] = [];

function eq(actual: unknown, expected: unknown, label: string) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) pass++;
    else fails.push(`${label}\n      nhận:  ${a}\n      đợi:   ${e}`);
}

/** Adapter giả: đếm số lần bị hỏi, và cho phép đổi nội dung trả về. */
function fake() {
    const calls: string[] = [];
    let items: S3Item[] = [{ name: 'a.json', type: 'json', key: 'p/a.json' }];
    const adapter = {
        async listProjects() { return []; },
        async listPath(prefix: string, opts?: { recursive?: boolean; signal?: AbortSignal }) {
            calls.push(`${opts?.recursive ? 'r' : 'n'}:${prefix}`);
            return items;
        },
        async getObjectText() { return ''; },
        async getAssetUrl() { return ''; },
        async putObject() {},
        async deleteObject() {},
        async uploadAsset() { return ''; },
        async publish() {}
    } as S3Adapter;
    return { calls, adapter, setItems(next: S3Item[]) { items = next; } };
}

const names = (items?: S3Item[]) => items?.map(it => it.name);

// ── đọc lần đầu xuống adapter, sau đó peek thấy ngay (đồng bộ) ─────────────
{
    const f = fake();
    const s3 = withListCache(f.adapter);
    eq(peekList('proj1/'), undefined, 'chưa tải thì peek rỗng');
    await s3.listPath('proj1/');
    eq(names(peekList('proj1/')), ['a.json'], 'tải xong thì peek thấy ngay');
    eq(f.calls, ['n:proj1/'], 'chỉ hỏi adapter một lần');
}

// ── nông và đệ quy là hai entry riêng ─────────────────────────────────────
{
    const f = fake();
    const s3 = withListCache(f.adapter);
    await s3.listPath('proj2/');
    eq(peekList('proj2/', true), undefined, 'đệ quy không ăn ké cache của nông');
    await s3.listPath('proj2/', { recursive: true });
    eq(names(peekList('proj2/', true)), ['a.json'], 'đệ quy có cache riêng');
    eq(f.calls, ['n:proj2/', 'r:proj2/'], 'hai lượt hỏi khác nhau');
}

// ── request bị huỷ thì không ghi cache: danh sách có thể còn dở ───────────
{
    const f = fake();
    const s3 = withListCache(f.adapter);
    const ac = new AbortController();
    ac.abort();
    await s3.listPath('proj3/', { signal: ac.signal });
    eq(peekList('proj3/'), undefined, 'request đã huỷ thì không vào cache');
}

// ── mọi lệnh ghi đều dọn cache ────────────────────────────────────────────
{
    const writes: [string, (s3: S3Adapter) => Promise<unknown>][] = [
        ['putObject', s3 => s3.putObject('p/a.json', '{}')],
        ['deleteObject', s3 => s3.deleteObject('p/a.json')],
        ['publish', s3 => s3.publish('p/a.json', '{}', {} as never)],
        ['uploadAsset', s3 => s3.uploadAsset('p', {} as File)]
    ];
    for (const [name, write] of writes) {
        const f = fake();
        const s3 = withListCache(f.adapter);
        await s3.listPath('proj4/');
        eq(names(peekList('proj4/')), ['a.json'], `${name}: có cache trước khi ghi`);
        await write(s3);
        eq(peekList('proj4/'), undefined, `${name} dọn cache`);
    }
}

// ── sau khi ghi, lần đọc kế tiếp phải ra nội dung MỚI ────────────────────
{
    const f = fake();
    const s3 = withListCache(f.adapter);
    await s3.listPath('proj5/');
    await s3.publish('proj5/a.json', '{}', {} as never);
    f.setItems([{ name: 'b.json', type: 'json', key: 'proj5/b.json' }]);
    eq(names(await s3.listPath('proj5/')), ['b.json'], 'đọc lại ra bản mới');
    eq(names(peekList('proj5/')), ['b.json'], 'cache giữ bản mới');
}

// ── kết quả ───────────────────────────────────────────────────────────────
if (fails.length) {
    console.error(`\n❌ ${fails.length} test HỎNG (${pass} pass)\n`);
    for (const f of fails) console.error('  ' + f + '\n');
    process.exit(1);
}
console.log(`✅ ${pass}/${pass} test pass`);
