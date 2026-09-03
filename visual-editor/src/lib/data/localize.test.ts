import { describe, test, expect } from 'vitest';
import { get, writable } from 'svelte/store';
import { buildLocalize, canLocalize, tokenizeText } from './localize';
import type { State } from './state';
import type { Variable } from './customVariables';

// Stub tối thiểu: buildLocalize chỉ chạm 3 store + pushCommand.
function stubState(vars: Variable[] = [], lang = 'en') {
    const state = {
        customVariables: writable<Variable[]>(vars),
        i18nMarkedVars: writable<Set<string>>(new Set()),
        previewLanguageCode: writable<string>(lang),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pushCommand(command: any) {
            command.redo(state);
        }
    };
    return state as unknown as State & typeof state;
}

describe('localize', () => {
    test('tokenizeText tách literal khỏi @{...}', () => {
        expect(tokenizeText('Save @{price} now')).toEqual([
            { type: 'text', value: 'Save ' },
            { type: 'expr', value: '@{price}' },
            { type: 'text', value: ' now' }
        ]);

        expect(tokenizeText('@{a}@{b}')).toEqual([
            { type: 'expr', value: '@{a}' },
            { type: 'expr', value: '@{b}' }
        ]);

        expect(tokenizeText('plain')).toEqual([{ type: 'text', value: 'plain' }]);
    });

    test('canLocalize chỉ true khi còn phần chữ ngoài expression', () => {
        expect(canLocalize('Hello')).toBe(true);
        expect(canLocalize('Save @{price}')).toBe(true);
        expect(canLocalize('@{price}')).toBe(false);
        expect(canLocalize('  @{a}  ')).toBe(false);
        expect(canLocalize('')).toBe(false);
        expect(canLocalize(42)).toBe(false);
        expect(canLocalize(undefined)).toBe(false);
    });

    test('buildLocalize tạo dict var + thay literal bằng getOptStringFromDict', () => {
        const state = stubState();
        const { value, jobs } = buildLocalize(state, 'Hello world');

        expect(value).toBe("@{getOptStringFromDict('Hello world', locale_hello_world, language_code)}");
        expect(jobs).toEqual([{ name: 'locale_hello_world', core: 'Hello world' }]);

        const vars = get(state.customVariables);
        expect(vars).toHaveLength(1);
        expect(vars[0].name).toBe('locale_hello_world');
        expect(vars[0].type).toBe('dict');

        const dict = JSON.parse(vars[0].value);
        expect(dict.en).toBe('Hello world');
        // Các locale còn lại được khởi tạo rỗng để auto-translate điền vào.
        expect(dict.vi).toBe('');
        expect(dict.ja).toBe('');

        expect(get(state.i18nMarkedVars).has('locale_hello_world')).toBe(true);
    });

    test('buildLocalize giữ nguyên @{...} đúng vị trí và bảo toàn khoảng trắng', () => {
        const state = stubState();
        const { value, jobs } = buildLocalize(state, 'Save @{price} now');

        expect(value).toBe(
            "@{getOptStringFromDict('Save', locale_save, language_code)}" +
            ' @{price} ' +
            "@{getOptStringFromDict('now', locale_now, language_code)}"
        );
        expect(jobs.map(j => j.name)).toEqual(['locale_save', 'locale_now']);
        expect(get(state.customVariables)).toHaveLength(2);
    });

    test('buildLocalize không đổi gì khi không có phần chữ', () => {
        const state = stubState();
        const { value, jobs } = buildLocalize(state, '@{price}');

        expect(value).toBe('@{price}');
        expect(jobs).toEqual([]);
        expect(get(state.customVariables)).toHaveLength(0);
        expect(get(state.i18nMarkedVars).size).toBe(0);
    });

    test('buildLocalize thêm hậu tố khi tên biến đã tồn tại', () => {
        const state = stubState([
            { id: 'v1', name: 'locale_hello', type: 'dict', value: '{}' },
            { id: 'v2', name: 'locale_hello_2', type: 'dict', value: '{}' }
        ]);
        const { jobs } = buildLocalize(state, 'Hello');

        expect(jobs[0].name).toBe('locale_hello_3');
    });

    test('buildLocalize escape dấu nháy trong text mặc định', () => {
        const state = stubState();
        const { value } = buildLocalize(state, "It's ok");

        expect(value).toBe("@{getOptStringFromDict('It\\'s ok', locale_it_s_ok, language_code)}");
    });

    test('buildLocalize dùng previewLanguageCode làm ngôn ngữ nguồn', () => {
        const state = stubState([], 'vi');
        buildLocalize(state, 'Xin chào');

        const dict = JSON.parse(get(state.customVariables)[0].value);
        expect(dict.vi).toBe('Xin chào');
        expect(dict.en).toBe('');
    });
});
