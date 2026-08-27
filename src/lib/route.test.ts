// ── Test cho route.ts ─────────────────────────────────────────────────────
// Chạy: npm run test:route  (node --experimental-strip-types, không cần test runner)

import { buildUrl, parseUrl } from './route.ts';

let pass = 0;
const fails: string[] = [];

function eq(actual: unknown, expected: unknown, label: string) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) pass++;
    else fails.push(`${label}\n    kỳ vọng: ${e}\n    nhận:    ${a}`);
}

// ── parseUrl ──────────────────────────────────────────────────────────────
eq(parseUrl('/'), { segments: [], isNew: false }, 'parseUrl gốc');
eq(parseUrl(''), { segments: [], isNew: false }, 'parseUrl chuỗi rỗng');
eq(parseUrl('/ai-video'), { segments: ['ai-video'], isNew: false }, 'parseUrl project');
eq(parseUrl('/ai-video/images'), { segments: ['ai-video', 'images'], isNew: false }, 'parseUrl thư mục lồng');
eq(
    parseUrl('/ai-video/welcome.json'),
    { segments: ['ai-video', 'welcome.json'], isNew: false },
    'parseUrl file layout'
);
eq(
    parseUrl('/printer/Assets/anim/on-2/master.m3u8'),
    { segments: ['printer', 'Assets', 'anim', 'on-2', 'master.m3u8'], isNew: false },
    'parseUrl lồng sâu'
);

// Dấu / thừa phải được chuẩn hoá, nếu không state sẽ có segment rỗng.
eq(parseUrl('/ai-video/'), { segments: ['ai-video'], isNew: false }, 'parseUrl bỏ / cuối');
eq(parseUrl('//ai-video//images//'), { segments: ['ai-video', 'images'], isNew: false }, 'parseUrl gộp / lặp');

// "new" là route dựng layout mới, không phải tên thư mục.
eq(parseUrl('/ai-video/new'), { segments: ['ai-video'], isNew: true }, 'parseUrl new trong project');
eq(parseUrl('/ai-video/images/new'), { segments: ['ai-video', 'images'], isNew: true }, 'parseUrl new lồng');
// /new ở gốc: parse trung thực, App tự bỏ qua vì tạo layout cần có project.
eq(parseUrl('/new'), { segments: [], isNew: true }, 'parseUrl new ở gốc');

// 137 key trong bucket chứa '@' (flag_en@3x.png) — phải decode lại đúng.
eq(
    parseUrl('/ai-learn/onboarding_1/flag_en%403x.png'),
    { segments: ['ai-learn', 'onboarding_1', 'flag_en@3x.png'], isNew: false },
    'parseUrl decode %40'
);

// ── buildUrl ──────────────────────────────────────────────────────────────
eq(buildUrl({ path: [] }), '/', 'buildUrl gốc');
eq(buildUrl({ path: ['ai-video'] }), '/ai-video', 'buildUrl project');
eq(buildUrl({ path: ['ai-video', 'images'] }), '/ai-video/images', 'buildUrl thư mục lồng');
eq(
    buildUrl({ path: ['ai-video'], fileName: 'welcome.json' }),
    '/ai-video/welcome.json',
    'buildUrl file'
);
eq(buildUrl({ path: ['ai-video'], isNew: true }), '/ai-video/new', 'buildUrl new');
eq(
    buildUrl({ path: ['ai-learn', 'onboarding_1'], fileName: 'flag_en@3x.png' }),
    '/ai-learn/onboarding_1/flag_en%403x.png',
    'buildUrl encode @'
);
// fileName rỗng/null bị bỏ qua, không sinh ra dấu / thừa.
eq(buildUrl({ path: ['ai-video'], fileName: null }), '/ai-video', 'buildUrl fileName null');

// ── round-trip ────────────────────────────────────────────────────────────
// Mọi URL dựng ra phải parse lại được về đúng segment ban đầu.
const cases: { path: string[]; fileName?: string | null; isNew?: boolean }[] = [
    { path: [] },
    { path: ['ai-video'] },
    { path: ['ai-video', 'images'] },
    { path: ['ai-video'], fileName: 'welcome.json' },
    { path: ['ai-learn', 'onboarding_1'], fileName: 'flag_en@3x.png' },
    { path: ['ai-video'], isNew: true },
    { path: ['ai-video', 'images'], isNew: true }
];
for (const c of cases) {
    const url = buildUrl(c);
    const back = parseUrl(url);
    const expectSegments = c.isNew ? c.path : c.fileName ? [...c.path, c.fileName] : c.path;
    eq(
        back,
        { segments: expectSegments, isNew: Boolean(c.isNew) },
        `round-trip ${url}`
    );
}

// ── kết quả ───────────────────────────────────────────────────────────────
if (fails.length) {
    console.error(`\n❌ ${fails.length} test HỎNG (${pass} pass)\n`);
    for (const f of fails) console.error('  ' + f + '\n');
    process.exit(1);
}
console.log(`✅ ${pass}/${pass} test pass`);
