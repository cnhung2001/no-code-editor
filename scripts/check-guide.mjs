// ── Kiểm tra tài liệu hướng dẫn ───────────────────────────────────────────
// Chạy: npm run test:guide
//
// Tài liệu này nằm TRONG app nên nó là lời nói chính thức. Mà nó là một file
// HTML tĩnh: không ai compile, không ai typecheck, và hỏng thì hỏng im lặng —
// một ảnh mất đường dẫn vẫn ra trang trắng chứ không ra lỗi.
//
// Test này bắt những thứ máy kiểm được: cấu trúc file, đường dẫn, và những
// tên gọi đã từng SAI và không được phép quay lại. Nội dung đúng hay không thì
// vẫn phải người đọc — phần đó ghi trong git log của lần sửa.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'public/huong-dan');
const FILE = join(DIR, 'index.html');

let pass = 0;
const fails = [];
function ok(cond, label, detail = '') {
    if (cond) pass++;
    else fails.push(`${label}${detail ? `\n      ${detail}` : ''}`);
}

const html = readFileSync(FILE, 'utf-8');

// ── 1. Thẻ HTML cân ───────────────────────────────────────────────────────
// Sửa tài liệu bằng thay-chuỗi rất dễ để lại một </div> mồ côi, mà trình duyệt
// thì tự vá và không kêu — bố cục lệch mà không ai biết vì sao.
{
    const VOID = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'source',
        'path', 'rect', 'circle', 'area', 'col', 'embed']);
    const stack = [];
    const mismatched = [];
    const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
    // Bỏ qua phần bên trong <style>/<script>: dấu ">" trong CSS/JS không phải thẻ.
    const stripped = html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/g, '');
    for (const m of stripped.matchAll(tag)) {
        const [, close, name, selfClose] = m;
        if (VOID.has(name.toLowerCase()) || selfClose) continue;
        if (close) {
            if (stack.at(-1) === name) stack.pop();
            else mismatched.push(name);
        } else {
            stack.push(name);
        }
    }
    ok(stack.length === 0 && mismatched.length === 0, 'HTML cân thẻ',
        `chưa đóng=[${stack}] lệch=[${mismatched}]`);
}

// ── 2. Mọi neo nội bộ đều có đích ────────────────────────────────────────
// Sidebar của tài liệu trỏ bằng #id, và app cũng deep-link vào đây
// (src/lib/guide.ts). Neo chết thì bấm vào không đi đâu, cũng không báo gì.
{
    const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    const missing = [...new Set([...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]))]
        .filter((a) => !ids.has(a));
    ok(missing.length === 0, 'Neo nội bộ có đích', `thiếu id: ${missing}`);

    // Những neo mà CODE trỏ tới — đổi tên id trong tài liệu là nút Hướng dẫn
    // trong Builder/Preview nhảy vào hư không.
    const used = readFileSync(join(ROOT, 'src/lib/guide.ts'), 'utf-8');
    const fromCode = [...used.matchAll(/^\s*\|\s*'([a-z-]+)'/gm)].map((m) => m[1]);
    ok(fromCode.length > 0, 'Đọc được danh sách neo trong guide.ts');
    for (const a of fromCode) ok(ids.has(a), `Neo "${a}" mà code trỏ tới vẫn còn`);
}

// ── 3. Ảnh có thật ───────────────────────────────────────────────────────
{
    const imgs = [...new Set([...html.matchAll(/src="(images\/[^"]+)"/g)].map((m) => m[1]))];
    ok(imgs.length > 0, 'Tài liệu có ảnh minh hoạ');
    const missing = imgs.filter((i) => !existsSync(join(DIR, i)));
    ok(missing.length === 0, 'Mọi ảnh đều tồn tại', `thiếu: ${missing}`);
}

// ── 4. Không trỏ ra ngoài thư mục của chính nó ───────────────────────────
// Bản gốc nằm cạnh divkit-samples.html và một thư mục images khác. Bản trong
// app phải tự chứa, nếu không là ship link 404.
{
    const ext = [...new Set([...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)].map((m) => m[1]))]
        .filter((u) => !u.startsWith('images/') && u !== 'index.html');
    ok(ext.length === 0, 'Không có link ra ngoài', `còn: ${ext}`);
}

// ── 5. Những tên gọi đã sai, không được quay lại ─────────────────────────
// Mỗi dòng dưới đây là một lỗi đã từng có thật trong tài liệu này.
{
    const banned = [
        ['Tanker', 'tab tên "Localization", "Tanker" chỉ còn trong union type'],
        ['VITE_ALLOW_PUSH', 'cờ đã bỏ — quyền do authz quyết định theo project'],
        ['Invalidate CDN cache', 'nhãn thật là "Xoá cache CDN sau khi publish"'],
        ['nút <strong>Figma</strong>', 'không có nút Figma nào trong editor'],
        ['localhost:8787', 'đã gộp về một origin, cổng 8080'],
        ['bấm <strong>Save</strong>', 'hai nút: Save draft và Push to S3']
    ];
    for (const [needle, why] of banned) {
        ok(!html.includes(needle), `Không còn "${needle}"`, why);
    }

    // Tên sản phẩm là "iKame NoCode". Tài liệu người dùng đọc không nói tên
    // engine — TRỪ đúng một dòng ghi nguồn ở footer, giữ lại vì engine là
    // Apache-2.0 và người cần tra thuộc tính vẫn phải biết tra ở đâu.
    // Đếm theo VỊ TRÍ chứ không theo số lần: một dòng ghi nguồn hợp lệ chứa cả
    // "DivKit" lẫn "divkit.tech", nên giới hạn bằng con số là sai ngay từ đầu.
    const outside = [...html.matchAll(/[Dd]iv[Kk]it/g)].filter((m) => {
        const around = html.slice(Math.max(0, m.index - 260), m.index + 260);
        return !/Apache-2\.0/.test(around);
    });
    ok(outside.length === 0, 'Không nhắc engine ngoài dòng ghi nguồn',
        outside.length
            ? `${outside.length} chỗ — phần người dùng đọc phải gọi là "iKame NoCode"`
            : '');
    ok(html.includes('iKame NoCode'), 'Tài liệu gọi đúng tên sản phẩm');
}

// ── 6. Đối chiếu từ vựng DivKit (bỏ qua nếu không có bộ docs) ───────────
// Docs sinh ra từ api_generator của DivKit và nằm ngoài repo, nên đây là kiểm
// tra "có thì tốt": chạy được ở máy ai có checkout divkit, bỏ qua ở CI.
{
    const CANDIDATES = [
        '/Volumes/DiepDB/nocode/divkit/api_generator/build/documentation/en',
        '/Volumes/DiepDB/upload_icon_to_s3/Remote Config/docs/en'
    ];
    const docs = CANDIDATES.find((d) => existsSync(d));
    if (!docs) {
        console.log('  (bỏ qua đối chiếu từ vựng DivKit — không tìm thấy bộ docs)');
    } else {
        const { readdirSync } = await import('node:fs');
        const vocab = new Set();
        for (const f of readdirSync(docs)) {
            if (!f.endsWith('.md')) continue;
            vocab.add(f.slice(0, -3));
            vocab.add(f.slice(0, -3).replace('div-', ''));
            for (const line of readFileSync(join(docs, f), 'utf-8').split('\n')) {
                const m = /^\|\s*`([^`]+)`\s*\|(.*)/.exec(line);
                if (!m) continue;
                vocab.add(m[1]);
                for (const v of m[2].matchAll(/`([^`]+)`/g)) vocab.add(v[1]);
            }
        }
        // Tên riêng của hệ này, DivKit không biết — liệt kê tường minh để một
        // tên GÕ SAI không lẫn vào đây mà thoát.
        const OURS = new Set(['inapp', 'subscribe', 'plain', 'wrapper', 'selected', 'unselected',
            'label', 'screen_id', 'screen_type', 'product_id', 'variable_type', 'language_code',
            'local_palette', 'selected_plan', 'weekly_trial', 'weekly_notrial', 'sub_weekly_699',
            'url_base', 'url_image_hero', 'divisor', 'multiplier', 'spin_wheel', 'view_all_plans',
            'reminder_on', 'reminder_off', 'set_current_item', 'set_next_item',
            // Thấy tận mắt trong app khi chụp ảnh tài liệu: hai cái đầu là biến
            // của layout ikame-product-heartrate-android/premium_intro, cái cuối
            // là một lựa chọn trong ô "Variable type" của tab Products.
            'url_icon_close', 'locale_i18n_terms', 'consumable']);
        const codes = new Set([...html.matchAll(/<code>([^<]+)<\/code>/g)]
            .map((m) => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
            .filter((c) => /^[a-z][a-z0-9_]*$/.test(c)));
        const unknown = [...codes].filter((c) => !vocab.has(c) && !OURS.has(c));
        ok(unknown.length === 0, 'Tên thuộc tính đều có trong docs DivKit',
            `lạ: ${unknown}`);
    }
}

// ── kết quả ───────────────────────────────────────────────────────────────
if (fails.length) {
    console.error(`\n❌ ${fails.length} test HỎNG (${pass} pass)\n`);
    for (const f of fails) console.error('  ' + f + '\n');
    process.exit(1);
}
console.log(`✅ ${pass}/${pass} test pass`);
