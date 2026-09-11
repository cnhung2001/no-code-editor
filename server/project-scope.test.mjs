// ── Test cho project-scope.mjs ────────────────────────────────────────────
// Chạy: npm run test:scope  (node trần, không cần test runner)

import { resolveBucketPrefix, accessiblePrefixes } from './project-scope.mjs';

let pass = 0;
const fails = [];

function eq(actual, expected, label) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) pass++;
    else fails.push(`${label}\n    kỳ vọng: ${e}\n    nhận:    ${a}`);
}

const prefixOf = (req) => resolveBucketPrefix(req).prefix;
const invalid = (req) => Boolean(resolveBucketPrefix(req).invalid);

// ── key: file trong project ───────────────────────────────────────────────
eq(prefixOf({ query: { key: 'ai-video/welcome.json' } }), 'ai-video', 'key trong project');
eq(prefixOf({ query: { key: 'printer/Assets/anim/on-2/master.m3u8' } }), 'printer', 'key lồng sâu');
eq(prefixOf({ body: { key: 'wordoffice/paywall.json' } }), 'wordoffice', 'key trong body');

// ── key: file lẻ ở gốc bucket → không thuộc project nào ───────────────────
eq(prefixOf({ query: { key: 'nocode.html' } }), null, 'file lẻ ở gốc');
eq(prefixOf({ query: { key: '/nocode.html' } }), null, 'file lẻ có / đầu');

// ── prefix: 1 segment LÀ folder project (khác với key 1 segment) ──────────
eq(prefixOf({ query: { prefix: 'ai-video/' } }), 'ai-video', 'prefix folder project');
eq(prefixOf({ query: { prefix: 'ai-video' } }), 'ai-video', 'prefix không có / cuối');
eq(prefixOf({ query: { prefix: 'ai-video/images/' } }), 'ai-video', 'prefix thư mục lồng');

// ── prefix rỗng = liệt kê gốc bucket ──────────────────────────────────────
eq(prefixOf({ query: { prefix: '' } }), null, 'prefix rỗng');
eq(resolveBucketPrefix({ query: { prefix: '' } }).source, 'prefix', 'prefix rỗng vẫn ghi nhận source');

// ── body.project (upload) ─────────────────────────────────────────────────
eq(prefixOf({ body: { project: 'mira-cast' } }), 'mira-cast', 'body.project');
eq(prefixOf({ body: { project: 'mira-cast/' } }), 'mira-cast', 'body.project có / cuối');

// ── không mang vị trí nào ─────────────────────────────────────────────────
eq(prefixOf({}), null, 'request rỗng');
eq(prefixOf({ query: {}, body: {} }), null, 'query/body rỗng');
eq(resolveBucketPrefix({}).source, null, 'request rỗng không có source');

// ── thứ tự ưu tiên: key thắng prefix thắng project ────────────────────────
eq(
    prefixOf({ query: { prefix: 'wordoffice/' }, body: { key: 'ai-video/x.json' } }),
    'ai-video',
    'key ưu tiên hơn prefix'
);
eq(
    prefixOf({ query: { prefix: 'wordoffice/' }, body: { project: 'printer' } }),
    'wordoffice',
    'prefix ưu tiên hơn project'
);

// ── path traversal ────────────────────────────────────────────────────────
// S3 không chuẩn hoá key nhưng CDN ở giữa thì có → segment guard nhìn thấy có
// thể khác folder file thực sự nằm. Chặn thẳng.
eq(invalid({ query: { key: 'ai-video/../wordoffice/x.json' } }), true, 'traversal giữa key');
eq(invalid({ query: { key: '../wordoffice/x.json' } }), true, 'traversal đầu key');
eq(invalid({ query: { prefix: 'ai-video/./images/' } }), true, 'segment . trong prefix');
eq(invalid({ body: { project: '..' } }), true, 'project là ..');
eq(invalid({ query: { key: 'ai-video/welcome.json' } }), false, 'key sạch không bị chặn');

// Query lặp → express trả mảng. Không đoán ý người gọi.
eq(invalid({ query: { key: ['a/x.json', 'b/y.json'] } }), true, 'key lặp thành mảng');

// Tên file chứa dấu chấm vẫn hợp lệ — chỉ segment ĐÚNG BẰNG '.' hay '..' mới chặn.
eq(prefixOf({ query: { key: 'ai-video/flag_en@3x.png' } }), 'ai-video', 'tên file có dấu chấm');
eq(prefixOf({ query: { key: 'ai-video/..hidden.json' } }), 'ai-video', 'tên file bắt đầu bằng ..');

// ── accessiblePrefixes ────────────────────────────────────────────────────
const mappings = [
    { bucketPrefix: 'wordoffice', authzSlugs: ['word-office-android', 'word-office-ios-debug'] },
    { bucketPrefix: 'ai-video', authzSlugs: ['ai-video-hubx', 'ai-video-ios-native'] },
    { bucketPrefix: 'printer', authzSlugs: [] } // chưa map
];
const sorted = (set) => [...set].sort();

eq(sorted(accessiblePrefixes(mappings, ['ai-video-hubx'])), ['ai-video'], 'khớp 1 slug');
eq(
    sorted(accessiblePrefixes(mappings, ['word-office-ios-debug', 'ai-video-ios-native'])),
    ['ai-video', 'wordoffice'],
    'khớp nhiều folder'
);
eq(sorted(accessiblePrefixes(mappings, [])), [], 'user không có slug nào');
eq(sorted(accessiblePrefixes(mappings, ['slug-la'])), [], 'slug không khớp gì');
// Folder chưa map slug nào phải ẨN, kể cả khi user có đầy slug khác.
eq(
    sorted(accessiblePrefixes(mappings, ['word-office-android', 'printer-android'])),
    ['wordoffice'],
    'folder chưa map vẫn ẩn'
);
eq(sorted(accessiblePrefixes([], ['bat-ky'])), [], 'chưa có mapping nào');

// ── kết quả ───────────────────────────────────────────────────────────────
if (fails.length) {
    console.error(`\n❌ ${fails.length} test HỎNG (${pass} pass)\n`);
    for (const f of fails) console.error('  ' + f + '\n');
    process.exit(1);
}
console.log(`✅ ${pass}/${pass} test pass`);
