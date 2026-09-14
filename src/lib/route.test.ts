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
eq(parseUrl('/'), { segments: [], isNew: false, isAdmin: false, help: null }, 'parseUrl gốc');
eq(parseUrl(''), { segments: [], isNew: false, isAdmin: false, help: null }, 'parseUrl chuỗi rỗng');
eq(parseUrl('/ai-video'), { segments: ['ai-video'], isNew: false, isAdmin: false, help: null }, 'parseUrl project');
eq(parseUrl('/ai-video/images'), { segments: ['ai-video', 'images'], isNew: false, isAdmin: false, help: null }, 'parseUrl thư mục lồng');
eq(
    parseUrl('/ai-video/welcome.json'),
    { segments: ['ai-video', 'welcome.json'], isNew: false, isAdmin: false, help: null },

    'parseUrl file layout'
);
eq(
    parseUrl('/printer/Assets/anim/on-2/master.m3u8'),
    { segments: ['printer', 'Assets', 'anim', 'on-2', 'master.m3u8'], isNew: false, isAdmin: false, help: null },

    'parseUrl lồng sâu'
);

// Dấu / thừa phải được chuẩn hoá, nếu không state sẽ có segment rỗng.
eq(parseUrl('/ai-video/'), { segments: ['ai-video'], isNew: false, isAdmin: false, help: null }, 'parseUrl bỏ / cuối');
eq(parseUrl('//ai-video//images//'), { segments: ['ai-video', 'images'], isNew: false, isAdmin: false, help: null }, 'parseUrl gộp / lặp');

// "new" là route dựng layout mới, không phải tên thư mục.
eq(parseUrl('/ai-video/new'), { segments: ['ai-video'], isNew: true, isAdmin: false, help: null }, 'parseUrl new trong project');
eq(parseUrl('/ai-video/images/new'), { segments: ['ai-video', 'images'], isNew: true, isAdmin: false, help: null }, 'parseUrl new lồng');
// /new ở gốc: parse trung thực, App tự bỏ qua vì tạo layout cần có project.
eq(parseUrl('/new'), { segments: [], isNew: true, isAdmin: false, help: null }, 'parseUrl new ở gốc');


// 137 key trong bucket chứa '@' (flag_en@3x.png) — phải decode lại đúng.
eq(
    parseUrl('/ai-learn/onboarding_1/flag_en%403x.png'),
    { segments: ['ai-learn', 'onboarding_1', 'flag_en@3x.png'], isNew: false, isAdmin: false, help: null },

    'parseUrl decode %40'
);

// ── /admin ────────────────────────────────────────────────────────────────
// Chỉ nhận ở GỐC. Lồng trong project vẫn là thư mục thật tên "admin".
eq(parseUrl('/admin'), { segments: [], isNew: false, isAdmin: true, help: null }, 'parseUrl admin');
eq(parseUrl('/admin/'), { segments: [], isNew: false, isAdmin: true, help: null }, 'parseUrl admin có / cuối');
eq(parseUrl('//admin//'), { segments: [], isNew: false, isAdmin: true, help: null }, 'parseUrl admin / lặp');
eq(
    parseUrl('/ai-video/admin'),
    { segments: ['ai-video', 'admin'], isNew: false, isAdmin: false, help: null },
    'parseUrl admin lồng vẫn là thư mục'
);
eq(
    parseUrl('/admin/settings'),
    { segments: ['admin', 'settings'], isNew: false, isAdmin: false, help: null },
    'parseUrl admin có segment sau thì không phải route admin'
);
// "new" đứng sau admin không được biến nó thành route tạo layout.
eq(
    parseUrl('/admin/new'),
    { segments: ['admin'], isNew: true, isAdmin: false, help: null },
    'parseUrl admin/new là thư mục admin + new'
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
eq(buildUrl({ path: ['ai-video'], isNew: true, isAdmin: false, help: null }), '/ai-video/new', 'buildUrl new');

eq(
    buildUrl({ path: ['ai-learn', 'onboarding_1'], fileName: 'flag_en@3x.png' }),
    '/ai-learn/onboarding_1/flag_en%403x.png',
    'buildUrl encode @'
);
// fileName rỗng/null bị bỏ qua, không sinh ra dấu / thừa.
eq(buildUrl({ path: ['ai-video'], fileName: null }), '/ai-video', 'buildUrl fileName null');

// isAdmin thắng mọi option còn lại: `path` vẫn giữ chỗ cũ để đóng Admin quay về
// đúng đó, nên nó KHÔNG được lọt vào URL.
eq(buildUrl({ path: [], isAdmin: true }), '/admin', 'buildUrl admin ở gốc');
eq(
    buildUrl({ path: ['ai-video', 'images'], fileName: 'welcome.json', isAdmin: true }),
    '/admin',
    'buildUrl admin bỏ qua path/fileName'
);
eq(buildUrl({ path: ['ai-video'], isNew: true, isAdmin: true }), '/admin', 'buildUrl admin thắng isNew');
eq(buildUrl({ path: ['ai-video'], isAdmin: false }), '/ai-video', 'buildUrl isAdmin false không đổi gì');

// Round-trip riêng: /admin parse lại phải ra đúng cờ admin.
eq(parseUrl(buildUrl({ path: ['ai-video'], isAdmin: true })), { segments: [], isNew: false, isAdmin: true, help: null }, 'round-trip admin');

// ── round-trip ────────────────────────────────────────────────────────────
// Mọi URL dựng ra phải parse lại được về đúng segment ban đầu.
const cases: { path: string[]; fileName?: string | null; isNew?: boolean }[] = [
    { path: [] },
    { path: ['ai-video'] },
    { path: ['ai-video', 'images'] },
    { path: ['ai-video'], fileName: 'welcome.json' },
    { path: ['ai-learn', 'onboarding_1'], fileName: 'flag_en@3x.png' },
    { path: ['ai-video'], isNew: true, isAdmin: false, help: null },
    { path: ['ai-video', 'images'], isNew: true, isAdmin: false, help: null }

];
for (const c of cases) {
    const url = buildUrl(c);
    const back = parseUrl(url);
    const expectSegments = c.isNew ? c.path : c.fileName ? [...c.path, c.fileName] : c.path;
    eq(
        back,
        { segments: expectSegments, isNew: Boolean(c.isNew), isAdmin: false, help: null },

        `round-trip ${url}`
    );
}

// ── route hướng dẫn ───────────────────────────────────────────────────────
// Nó chiếm segment ĐẦU và nuốt phần còn lại, khác hẳn "new" (segment CUỐI).
eq(parseUrl('/help'), { segments: [], isNew: false, isAdmin: false, help: '' }, '/help → mở từ đầu');
eq(parseUrl('/help/'), { segments: [], isNew: false, isAdmin: false, help: '' }, '/help/ → bỏ "/" thừa');
eq(parseUrl('/help/quy-trinh'), { segments: [], isNew: false, isAdmin: false, help: 'quy-trinh' }, '/help/<mục>');
eq(
    parseUrl('/help/quy-trinh/lung-tung'),
    { segments: [], isNew: false, isAdmin: false, help: 'quy-trinh' },
    'segment thừa sau mục bị bỏ, không thành thư mục'
);
// "help" chỉ là route khi đứng ĐẦU — một project tên "help" ở giữa không bị nuốt.
eq(parseUrl('/ai-video/help'), { segments: ['ai-video', 'help'], isNew: false, isAdmin: false, help: null }, '"help" ở giữa vẫn là thư mục');
eq(parseUrl('/ai-video/new'), { segments: ['ai-video'], isNew: true, isAdmin: false, help: null }, 'route "new" không đổi');
eq(parseUrl('/'), { segments: [], isNew: false, isAdmin: false, help: null }, 'gốc bucket vẫn help=null');

eq(buildUrl({ path: [], help: '' }), '/help', 'buildUrl: help rỗng → /help');
eq(buildUrl({ path: [], help: 'luu' }), '/help/luu', 'buildUrl: help có neo');
eq(
    buildUrl({ path: ['ai-video'], fileName: 'a.json', help: 'luu' }),
    '/help/luu',
    'help thắng mọi thứ còn lại'
);
eq(buildUrl({ path: ['ai-video'], fileName: 'a.json', help: null }), '/ai-video/a.json', 'help=null → đường cũ');
eq(buildUrl({ path: ['ai-video'], fileName: 'a.json' }), '/ai-video/a.json', 'không truyền help → đường cũ');

// round-trip
for (const url of ['/help', '/help/quy-trinh', '/help/luu']) {
    const p = parseUrl(url);
    eq(buildUrl({ path: [], help: p.help }), url, `round-trip ${url}`);
}

// ── kết quả ───────────────────────────────────────────────────────────────
if (fails.length) {
    console.error(`\n❌ ${fails.length} test HỎNG (${pass} pass)\n`);
    for (const f of fails) console.error('  ' + f + '\n');
    process.exit(1);
}
console.log(`✅ ${pass}/${pass} test pass`);
