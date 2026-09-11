// ── Test cho draft-key.mjs ────────────────────────────────────────────────
// Chạy: npm run test:draft  (node trần, không cần test runner)

import { draftKey, draftPrefix } from './draft-key.mjs';

let pass = 0;
const fails = [];

function eq(actual, expected, label) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) pass++;
    else fails.push(`${label}\n    kỳ vọng: ${e}\n    nhận:    ${a}`);
}

// ── draftKey: chèn .drafts SAU project ────────────────────────────────────
eq(draftKey('ai-learn/onboarding.json'), 'ai-learn/.drafts/onboarding.json', 'layout trong project');
eq(draftKey('printer/paywall/iap_sale.json'), 'printer/.drafts/paywall/iap_sale.json', 'layout lồng sâu');
eq(draftKey('ai-learn//onboarding.json'), 'ai-learn/.drafts/onboarding.json', 'dấu / lặp');
eq(draftKey('/ai-learn/onboarding.json'), 'ai-learn/.drafts/onboarding.json', 'có / đầu');

// ── draftKey: không có project để nhét vào ────────────────────────────────
eq(draftKey('nocode.html'), null, 'file lẻ ở gốc bucket');
eq(draftKey(''), null, 'key rỗng');
eq(draftKey(undefined), null, 'key thiếu');

// ── draftKey: đã là key nháp thì đứng yên (gọi hai lần không nhân đôi) ────
eq(draftKey('ai-learn/.drafts/onboarding.json'), 'ai-learn/.drafts/onboarding.json', 'key nháp sẵn');
eq(draftKey(draftKey('ai-learn/onboarding.json')), 'ai-learn/.drafts/onboarding.json', 'gọi lồng hai lần');

// ── draftPrefix: luôn có / cuối ───────────────────────────────────────────
eq(draftPrefix('ai-learn/'), 'ai-learn/.drafts/', 'prefix project');
eq(draftPrefix('ai-learn'), 'ai-learn/.drafts/', 'prefix không có / cuối');
eq(draftPrefix('printer/paywall/'), 'printer/.drafts/paywall/', 'prefix thư mục con');
eq(draftPrefix('ai-learn/.drafts/'), 'ai-learn/.drafts/', 'prefix nháp sẵn');

// ── draftPrefix: gốc bucket và chính kho nháp → không liệt kê nháp ────────
eq(draftPrefix(''), null, 'gốc bucket');
eq(draftPrefix(undefined), null, 'prefix thiếu');
eq(draftPrefix('.drafts/'), null, 'segment đầu là .drafts');

if (fails.length) {
    console.error(`❌ ${fails.length} test fail\n\n${fails.join('\n\n')}`);
    process.exit(1);
}
console.log(`✅ ${pass}/${pass} test pass`);
