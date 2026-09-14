// ── Engine dịch Gemini — gọi thẳng gateway core-ai (giống cms-admin) ───────
// cms-admin dịch bằng Gemini qua gateway nội bộ core-ai-platform, xác thực bằng
// ?key=<GEMINI_API_KEY>. Ở đây làm đúng như vậy chứ KHÔNG gọi vòng qua API của
// cms-admin: route dịch bên đó nằm sau AuthGuard đọc cookie `auth_token` và
// SDK authz chặn token khác `aud` (xem client.js: audience ?? [systemCode]),
// nên muốn đi đường đó phải xin allowlist token-exchange — thừa, vì thứ duy
// nhất mình cần là engine dịch.
//
// Khác cms-admin một điểm có chủ đích: cms gửi 1 target/lượt, còn localize của
// editor cần ~32 locale cho MỖI chuỗi. Prompt dưới đây xin cả bảng locale →
// bản dịch trong MỘT request, nên 1 chuỗi = 1-2 lần gọi thay vì 32.

import './env.mjs';

const {
    GEMINI_API_KEY = '',
    GEMINI_MODEL = '',
    // Đổi được để trỏ sang gateway khác (hoặc generativelanguage.googleapis.com).
    // Gateway nội bộ nhận cả /v1beta/... lẫn /gemini/v1beta/...; giữ dạng trần
    // đúng như cms-admin đang dùng.
    GEMINI_BASE_URL = 'https://core-ai-platform.ikameglobal.com',
    GEMINI_TIMEOUT_MS = '30000',
    // Ngữ cảnh sản phẩm, nhét vào prompt. Nhãn UI thường là MỘT từ và một từ
    // trần thì mơ hồ: "Play" trơ trọi được dịch thành "Phát/再生/播放" (phát
    // media) thay vì "chơi". Model không đoán được domain, phải nói cho nó biết.
    // Đổi theo app đang làm; để trống thì bỏ hẳn dòng context khỏi prompt.
    MT_CONTEXT = 'a mobile game app (paywall, onboarding and in-game screens)'
} = process.env;

const ALLOWED_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
const DEFAULT_MODEL = 'gemini-2.5-flash';
const TEMPERATURE = 0.2;
const TOP_P = 0.9;
const MAX_OUTPUT_TOKENS = 8192;
// Nhiều locale/lượt thì output dài dần và rủi ro JSON đứt giữa chừng tăng theo.
// 16 giữ câu trả lời gọn mà vẫn phủ 32 locale trong 2 lượt.
const TARGETS_PER_CALL = 16;
const FALLBACK_CONCURRENCY = 6;

/** Tên tiếng Anh của locale — mã trần như 'zh' quá mơ hồ để nhét thẳng vào prompt. */
const LANG_NAMES = {
    en: 'English', vi: 'Vietnamese', ar: 'Arabic', zh: 'Simplified Chinese',
    fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese',
    ru: 'Russian', ja: 'Japanese', ko: 'Korean', it: 'Italian',
    nl: 'Dutch', tr: 'Turkish', pl: 'Polish', uk: 'Ukrainian',
    th: 'Thai', id: 'Indonesian', ms: 'Malay', hi: 'Hindi',
    cs: 'Czech', da: 'Danish', fi: 'Finnish', el: 'Greek',
    he: 'Hebrew', hr: 'Croatian', hu: 'Hungarian', no: 'Norwegian',
    ro: 'Romanian', sk: 'Slovak', sv: 'Swedish', ca: 'Catalan'
};

const langLabel = (code) => (LANG_NAMES[code] ? `${code} (${LANG_NAMES[code]})` : code);

export function isGeminiConfigured() {
    return !!GEMINI_API_KEY;
}

function resolveModel(value) {
    return ALLOWED_MODELS.has(value) ? value : DEFAULT_MODEL;
}

/** Gemini hay bọc JSON trong ```json … ``` dù đã dặn là đừng. */
function stripMarkdownFence(text) {
    const m = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/.exec(text);
    return (m?.[1] ?? text).trim();
}

/**
 * Nhãn UI phần lớn là một từ ("Play", "Settings"). Gemini hay trả về chữ
 * thường, đặt cạnh các nhãn khác thì lệch hẳn — nguồn viết hoa thì ép bản dịch
 * viết hoa theo. Ngôn ngữ không có hoa/thường (Nhật, Ả Rập…) thì toUpperCase là
 * no-op nên không ảnh hưởng.
 */
function matchCasing(source, translated) {
    const src = source.trim();
    const out = translated.trim();
    if (!out || /\s/.test(src)) return out;
    const first = src.charAt(0);
    if (first !== first.toUpperCase()) return out;
    return out.charAt(0).toUpperCase() + out.slice(1);
}

function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

// ── HTTP ──────────────────────────────────────────────────────────────────

async function callGemini(prompt, model) {
    const base = GEMINI_BASE_URL.replace(/\/$/, '');
    const url = `${base}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Number(GEMINI_TIMEOUT_MS) || 30000);
    let resp;
    try {
        resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: TEMPERATURE,
                    topP: TOP_P,
                    maxOutputTokens: MAX_OUTPUT_TOKENS,
                    // Dịch một nhãn không cần suy luận; bật thinking chỉ đốt token
                    // và có lúc ăn hết budget rồi trả rỗng.
                    thinkingConfig: { thinkingBudget: 0 }
                }
            }),
            signal: ac.signal
        });
    } catch (e) {
        if (e?.name === 'AbortError') throw new Error(`gemini timeout sau ${GEMINI_TIMEOUT_MS}ms`);
        throw e;
    } finally {
        clearTimeout(timer);
    }

    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        // Key hỏng/hết hạn là lỗi cấu hình chứ không phải lỗi mạng — nói rõ ra,
        // đừng để UI hiện "502" rồi người ta đi mò gateway.
        if (resp.status === 401 || resp.status === 403) {
            throw new Error(`gemini ${resp.status}: GEMINI_API_KEY bị từ chối — ${body.slice(0, 200)}`);
        }
        throw new Error(`gemini ${resp.status}: ${body.slice(0, 300)}`);
    }

    const payload = await resp.json();
    const parts = payload?.candidates?.[0]?.content?.parts ?? [];
    const text = parts
        .filter((p) => !p.thought)
        .map((p) => (typeof p.text === 'string' ? p.text : ''))
        .join('\n')
        .trim();
    return text || null;
}

// ── Prompt ────────────────────────────────────────────────────────────────

/** Luật dùng chung cho cả prompt batch lẫn prompt lẻ — sửa một chỗ. */
const COPY_RULES = [
    '- The source is a button label, title or short line of UI copy. Keep the translation short and roughly the same length; a label that doubles in length breaks the layout.',
    '- Use natural sentence or title case, even if the source is ALL CAPS or all lowercase.',
    '- Resolve ambiguous words from the context above, not from the most literal dictionary sense. On a game screen a bare "Play" means start playing the game (not play media/audio), "Free" means no cost (not unoccupied), "Claim" means collect a reward.',
    '- Leave any @{...} placeholder untouched, in the same position.',
    '- Do not translate URLs or brand names.'
].join('\n');

const contextLine = () => (MT_CONTEXT ? `You are localizing UI copy for ${MT_CONTEXT}.\n\n` : '');

function buildBatchPrompt(text, from, targets) {
    return `${contextLine()}Translate the text below from ${langLabel(from)} into EACH of these languages:
${targets.map((t) => `- ${langLabel(t)}`).join('\n')}

Rules:
- Return ONLY a JSON object. No markdown fence, no explanation.
- Keys MUST be exactly the language codes listed above (e.g. "vi", "zh"), one entry per language.
- Values are the translated text, nothing else — no quotes around it, no notes.
${COPY_RULES}

Text:
${text}`;
}

function buildSinglePrompt(text, from, to) {
    return `${contextLine()}Translate the text below from ${langLabel(from)} to ${langLabel(to)}.

Rules:
${COPY_RULES}
- Return only the translated text, without quotes or explanation.

Text:
${text}`;
}

// ── API ───────────────────────────────────────────────────────────────────

/** Dịch từng target một. Dùng làm lưới an toàn khi lượt batch trả JSON hỏng. */
async function translateOneByOne(text, from, targets, model) {
    const out = {};
    let idx = 0;
    async function worker() {
        while (idx < targets.length) {
            const to = targets[idx++];
            try {
                const t = await callGemini(buildSinglePrompt(text, from, to), model);
                if (t) out[to] = matchCasing(text, t);
            } catch {
                // Bỏ qua locale lỗi → để trống, không chặn cả batch.
            }
        }
    }
    await Promise.all(
        Array.from({ length: Math.min(FALLBACK_CONCURRENCY, targets.length) }, worker)
    );
    return out;
}

/**
 * Dịch `text` sang nhiều locale trong một lượt gọi. Trả { locale: text }; locale
 * nào Gemini không trả (hoặc trả rỗng) thì vắng mặt — bên gọi giữ ô trống và
 * getOptStringFromDict tự rơi về chuỗi gốc, tốt hơn là đổ đại text nguồn vào.
 */
export async function translateGemini(text, from, targets, opts = {}) {
    if (!isGeminiConfigured()) throw new Error('Thiếu GEMINI_API_KEY');
    if (!targets.length) return {};
    const model = resolveModel(opts.model || GEMINI_MODEL);

    const results = await Promise.all(
        chunk(targets, TARGETS_PER_CALL).map(async (group) => {
            const raw = await callGemini(buildBatchPrompt(text, from, group), model);
            if (!raw) return translateOneByOne(text, from, group, model);

            let parsed;
            try {
                parsed = JSON.parse(stripMarkdownFence(raw));
            } catch {
                return translateOneByOne(text, from, group, model);
            }
            if (!parsed || typeof parsed !== 'object') {
                return translateOneByOne(text, from, group, model);
            }

            const out = {};
            for (const to of group) {
                const v = parsed[to];
                if (typeof v === 'string' && v.trim()) out[to] = matchCasing(text, v);
            }
            // Model trả JSON nhưng lệch key (dùng tên ngôn ngữ thay vì mã) →
            // coi như trượt, dịch lại từng cái cho chắc.
            return Object.keys(out).length ? out : translateOneByOne(text, from, group, model);
        })
    );

    return Object.assign({}, ...results);
}
