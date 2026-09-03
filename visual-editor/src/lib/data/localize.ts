// ── Logic Localize dùng chung (TextProp literal + Expression hỗn hợp) ─────
// Tách text thành đoạn chữ + biểu thức @{...}; chỉ localize phần CHỮ, giữ
// nguyên @{...} đúng vị trí. Mỗi đoạn chữ → 1 dict var locale_ + tự dịch.

import { get } from 'svelte/store';
import type { State } from './state';
import { ChangeCustomVariablesCommand } from './commands/changeCustomVariables';
import type { Variable } from './customVariables';
import { SUPPORTED_LOCALES } from './locales';

interface Token { type: 'text' | 'expr'; value: string; }

export function tokenizeText(text: string): Token[] {
    const re = /@\{[^}]*\}/g;
    const parts: Token[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
        parts.push({ type: 'expr', value: m[0] });
        last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
    return parts;
}

/** Có phần chữ (ngoài @{...}) để localize không. */
export function canLocalize(value: unknown): boolean {
    return typeof value === 'string' && value.replace(/@\{[^}]*\}/g, '').trim().length > 0;
}

function slugify(text: string): string {
    const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    return 'locale_' + (base || 'text');
}
function uniqueVarName(base: string, taken: Set<string>): string {
    if (!taken.has(base)) return base;
    let i = 2;
    while (taken.has(`${base}_${i}`)) i++;
    return `${base}_${i}`;
}

export interface LocalizeJob { name: string; core: string; }

/**
 * Đồng bộ: tạo dict var cho từng đoạn chữ, mark i18n, push command,
 * trả về value mới (chuỗi text đã thay literal bằng getOptStringFromDict) + danh sách job dịch.
 */
export function buildLocalize(state: State, original: string): { value: string; jobs: LocalizeJob[] } {
    const parts = tokenizeText(original);
    const from = get(state.previewLanguageCode) || 'en';
    const taken = new Set(get(state.customVariables).map(v => v.name));
    const newVars: Variable[] = [];
    const jobs: LocalizeJob[] = [];
    const pieces: string[] = [];

    for (const p of parts) {
        if (p.type === 'expr') { pieces.push(p.value); continue; }
        const lead = p.value.match(/^\s*/)?.[0] ?? '';
        const trail = p.value.match(/\s*$/)?.[0] ?? '';
        const core = p.value.slice(lead.length, p.value.length - trail.length);
        if (!core) { pieces.push(p.value); continue; }

        const name = uniqueVarName(slugify(core), taken);
        taken.add(name);
        const dict: Record<string, string> = {};
        for (const loc of SUPPORTED_LOCALES) dict[loc] = '';
        dict[from] = core;
        newVars.push({ id: `locale_${Date.now()}_${newVars.length}`, name, type: 'dict', value: JSON.stringify(dict) });
        jobs.push({ name, core });
        const escaped = core.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\s+/g, ' ');
        pieces.push(`${lead}@{getOptStringFromDict('${escaped}', ${name}, language_code)}${trail}`);
    }

    if (newVars.length) {
        state.pushCommand(new ChangeCustomVariablesCommand(state, [...get(state.customVariables), ...newVars]));
        state.i18nMarkedVars.update(s => { const n = new Set(s); newVars.forEach(v => n.add(v.name)); return n; });
    }
    return { value: pieces.join(''), jobs };
}

/** Async: gọi engine dịch cho từng job, đổ vào dict var tương ứng. */
export async function runTranslate(state: State, jobs: LocalizeJob[]): Promise<void> {
    if (!state.translateApi || !jobs.length) return;
    const from = get(state.previewLanguageCode) || 'en';
    const targets = SUPPORTED_LOCALES.filter(l => l !== from);
    for (const { name, core } of jobs) {
        const res = await state.translateApi(core, from, targets);
        const cur = get(state.customVariables).find(v => v.name === name);
        let d: Record<string, string>;
        try { d = cur ? JSON.parse(cur.value) : {}; } catch { d = {}; }
        for (const [loc, text] of Object.entries(res)) if (text) d[loc] = text;
        state.pushCommand(new ChangeCustomVariablesCommand(
            state,
            get(state.customVariables).map(v => v.name === name ? { ...v, value: JSON.stringify(d) } : v)
        ));
    }
}
