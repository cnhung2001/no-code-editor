<script lang="ts">
    import { getContext } from 'svelte';
    import { derived, get } from 'svelte/store';
    import { slide } from 'svelte/transition';
    import { APP_CTX, type AppContext } from '../ctx/appContext';
    import { walk } from '../utils/tree';
    import { ChangeCustomVariablesCommand } from '../data/commands/changeCustomVariables';
    import type { Variable } from '../data/customVariables';
    import { LOCALE_LABELS, SUPPORTED_LOCALES } from '../data/locales';
    import PanelTitle from './PanelTitle.svelte';

    const { state } = getContext<AppContext>(APP_CTX);
    const { customVariables, tree, readOnly, previewLanguageCode, i18nMarkedVars, singleLocaleMode } = state;

    function escapeRegex(s: string): string {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Only dict variables explicitly marked as i18n
    const i18nVars = derived([customVariables, i18nMarkedVars], ([$vars, $marked]) =>
        $vars.filter(v => v.type === 'dict' && $marked.has(v.name))
    );

    // Detect which i18n dict vars are actually referenced inside any @{...} expression in the tree.
    // Uses word-boundary search so it works regardless of which function (getOptStringFromDict,
    // getStringFromDict, dict[key], etc.) wraps the variable.
    const usedInLayout = derived([tree, i18nVars], ([$tree, $i18nVarsArr]) => {
        const candidates = $i18nVarsArr.map(v => ({
            name: v.name,
            re: new RegExp(`@\\{[^}]*\\b${escapeRegex(v.name)}\\b`)
        }));
        const names = new Set<string>();
        walk($tree, leaf => {
            const raw = JSON.stringify(leaf.props.json);
            for (const { name, re } of candidates) {
                if (!names.has(name) && re.test(raw)) names.add(name);
            }
        });
        return names;
    });

    // All locale keys across all dicts
    const allLocales = derived(i18nVars, ($vars) => {
        const locales = new Set<string>();
        for (const v of $vars) {
            try {
                const dict = JSON.parse(v.value);
                if (typeof dict === 'object' && dict) {
                    Object.keys(dict).forEach(k => locales.add(k));
                }
            } catch {}
        }
        return Array.from(locales).sort((a, b) => {
            if (a === 'en') return -1;
            if (b === 'en') return 1;
            return a.localeCompare(b);
        });
    });

    $: if ($allLocales.length && !$allLocales.includes($previewLanguageCode)) {
        previewLanguageCode.set($allLocales[0]);
    }

    let expandedVars = new Set<string>();
    function toggleExpand(name: string) {
        expandedVars.has(name) ? expandedVars.delete(name) : expandedVars.add(name);
        expandedVars = expandedVars;
    }

    function getDictValue(v: Variable, loc: string): string {
        try {
            const dict = JSON.parse(v.value);
            return dict[loc] ?? '';
        } catch { return ''; }
    }

    function updateLocaleValue(varName: string, loc: string, newValue: string) {
        const newList = get(customVariables).map(v => {
            if (v.name !== varName) return v;
            try {
                const dict = JSON.parse(v.value);
                if (newValue === '') delete dict[loc];
                else dict[loc] = newValue;
                return { ...v, value: JSON.stringify(dict) };
            } catch { return v; }
        });
        state.pushCommand(new ChangeCustomVariablesCommand(state, newList));
    }

    function deleteKey(varName: string) {
        const newList = get(customVariables).filter(v => v.name !== varName);
        state.pushCommand(new ChangeCustomVariablesCommand(state, newList));
        i18nMarkedVars.update(s => { const n = new Set(s); n.delete(varName); return n; });
    }

    // ── Auto-translate (engine ở backend qua state.translateApi) ──────────
    let translatingVars = new Set<string>();
    let translatingAll = false;
    let translateError = '';

    // Dịch các locale CÒN THIẾU/RỖNG của 1 key (không đè bản đã có).
    async function translateVar(v: Variable): Promise<void> {
        if (!state.translateApi) { translateError = 'Chưa cấu hình dịch (MT_PROVIDER)'; return; }
        let dict: Record<string, string>;
        try { dict = JSON.parse(v.value); } catch { return; }
        const from = get(previewLanguageCode) || 'en';
        const source = dict[from] || dict['en'] || '';
        if (!source) { translateError = `Key "${v.name}" chưa có text nguồn (${from})`; return; }
        const targets = SUPPORTED_LOCALES.filter(l => l !== from && !dict[l]);
        if (!targets.length) return;
        translatingVars.add(v.name); translatingVars = translatingVars;
        translateError = '';
        try {
            const res = await state.translateApi(source, from, targets);
            const newDict = { ...dict };
            for (const [loc, text] of Object.entries(res)) if (text) newDict[loc] = text;
            const newList = get(customVariables).map(x =>
                x.name === v.name ? { ...x, value: JSON.stringify(newDict) } : x);
            state.pushCommand(new ChangeCustomVariablesCommand(state, newList));
        } catch (e) {
            translateError = String((e as Error)?.message || e);
        } finally {
            translatingVars.delete(v.name); translatingVars = translatingVars;
        }
    }

    // Dịch tất cả key i18n (chỉ điền chỗ thiếu), tuần tự để tránh rate-limit.
    async function translateAllMissing(): Promise<void> {
        if (translatingAll) return;
        translatingAll = true;
        translateError = '';
        try {
            for (const v of get(i18nVars)) await translateVar(v);
        } finally {
            translatingAll = false;
        }
    }

    let editingKey: string | null = null;
    let editingKeyValue = '';
    let editKeyError = '';

    function startEditKey(name: string) {
        editingKey = name;
        editingKeyValue = name;
        editKeyError = '';
    }

    function replaceJsonStrings(val: unknown, oldName: string, newName: string): unknown {
        if (typeof val === 'string') {
            const escaped = escapeRegex(oldName);
            return val.replace(/@\{[^}]*\}/g, expr =>
                expr.replace(new RegExp(`\\b${escaped}\\b`, 'g'), newName)
            );
        }
        if (Array.isArray(val)) return val.map(item => replaceJsonStrings(item, oldName, newName));
        if (val && typeof val === 'object') {
            const result: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
                result[k] = replaceJsonStrings(v, oldName, newName);
            }
            return result;
        }
        return val;
    }

    function commitEditKey(oldName: string) {
        let newName = editingKeyValue.trim();
        if (!newName || newName === oldName) { editingKey = null; return; }
        if (!newName.startsWith('locale_')) newName = 'locale_' + newName;
        if (get(customVariables).some(v => v.name === newName)) {
            editKeyError = 'Key already exists';
            return;
        }
        const newList = get(customVariables).map(v => v.name === oldName ? { ...v, name: newName } : v);
        state.pushCommand(new ChangeCustomVariablesCommand(state, newList));
        i18nMarkedVars.update(s => { const n = new Set(s); n.delete(oldName); n.add(newName); return n; });
        // Update all references in the layout JSON
        walk(get(tree), leaf => {
            leaf.props.json = replaceJsonStrings(leaf.props.json, oldName, newName) as Record<string, unknown>;
        });
        tree.set(get(tree));
        if (expandedVars.has(oldName)) {
            expandedVars.delete(oldName);
            expandedVars.add(newName);
            expandedVars = expandedVars;
        }
        editingKey = null;
        editKeyError = '';
    }

    // Add locale to all marked i18n dict variables
    function addLocale(newLocale: string) {
        if (!newLocale.trim() || $allLocales.includes(newLocale.trim())) return;
        const loc = newLocale.trim();
        const marked = get(i18nMarkedVars);
        const newList = get(customVariables).map(v => {
            if (v.type !== 'dict' || !marked.has(v.name)) return v;
            try {
                const dict = JSON.parse(v.value);
                if (!(loc in dict)) dict[loc] = '';
                return { ...v, value: JSON.stringify(dict) };
            } catch { return v; }
        });
        state.pushCommand(new ChangeCustomVariablesCommand(state, newList));
        $previewLanguageCode = loc;
        newLocaleInput = '';
        showAddLocale = false;
    }

    // Add new text key
    function addTextKey() {
        let name = newKeyName.trim();
        if (!name) return;
        if (!name.startsWith('locale_')) name = 'locale_' + name;
        if (get(customVariables).some(v => v.name === name)) {
            keyError = 'Key already exists';
            return;
        }
        // Init all current locales with empty string + fill default text for current locale
        const dict: Record<string, string> = {};
        for (const loc of $allLocales) dict[loc] = '';
        if (newKeyDefault.trim()) {
            dict[$previewLanguageCode] = newKeyDefault.trim();
        }
        const newVar: Variable = {
            id: `locale_${Date.now()}`,
            name,
            type: 'dict',
            value: JSON.stringify(dict)
        };
        const newList = [...get(customVariables), newVar];
        state.pushCommand(new ChangeCustomVariablesCommand(state, newList));
        i18nMarkedVars.update(s => { const n = new Set(s); n.add(name); return n; });
        expandedVars.add(name);
        expandedVars = expandedVars;
        newKeyName = 'locale_';
        newKeyDefault = '';
        keyError = '';
        showAddKey = false;
    }

    function focusOnMount(node: HTMLElement) {
        node.focus();
        if (node instanceof HTMLInputElement) { node.select(); }
    }

    let newLocaleInput = '';
    let showAddLocale = false;
    let searchQuery = '';
    let showAddKey = false;
    let newKeyName = 'locale_';
    let newKeyDefault = '';
    let keyError = '';
</script>

<div class="loc-editor">
    <PanelTitle title="Localization" />

    <!-- language_code system variable -->
    <div class="loc-editor__lang-code">
        <span class="loc-editor__lang-code-label">language_code</span>
        <span class="loc-editor__lang-code-value">{$previewLanguageCode}</span>
        <span class="loc-editor__lang-code-badge">editor only</span>
    </div>

    <!-- Locale tabs -->
    <div class="loc-editor__locale-bar">
        <div class="loc-editor__locales">
            {#each $allLocales as loc}
                <button
                    class="loc-editor__locale-btn"
                    class:loc-editor__locale-btn_active={loc === $previewLanguageCode}
                    on:click={() => $previewLanguageCode = loc}
                    title={LOCALE_LABELS[loc] || loc}
                >{loc}</button>
            {/each}
            {#if !$readOnly}
                <button class="loc-editor__locale-add" on:click={() => showAddLocale = !showAddLocale} title="Add locale">+</button>
            {/if}
        </div>
        {#if showAddLocale && !$readOnly}
            <div class="loc-editor__add-locale" transition:slide={{ duration: 150 }}>
                <input
                    class="loc-editor__input"
                    type="text"
                    bind:value={newLocaleInput}
                    placeholder="e.g. ja, ko, th"
                    on:keydown={e => e.key === 'Enter' && addLocale(newLocaleInput)}
                />
                <button class="loc-editor__add-btn" on:click={() => addLocale(newLocaleInput)}>Add</button>
            </div>
        {/if}
    </div>

    <!-- Export mode -->
    <label class="loc-editor__single-locale" title="Khi Save/Push: cắt các dict i18n về đúng 1 key (locale đang chọn ở trên) thay vì lưu full mọi ngôn ngữ">
        <input type="checkbox" bind:checked={$singleLocaleMode} disabled={$readOnly} />
        Single locale mode (export only «{$previewLanguageCode}»)
    </label>

    <!-- Search -->
    <div class="loc-editor__search">
        <input
            class="loc-editor__input"
            type="text"
            bind:value={searchQuery}
            placeholder="Search keys..."
        />
    </div>

    <!-- Translate toolbar -->
    {#if !$readOnly && $i18nVars.length}
        <div class="loc-editor__add-locale" style="padding:6px 10px;">
            <button
                class="loc-editor__add-btn"
                on:click={translateAllMissing}
                disabled={translatingAll}
                title="Dịch các ô còn thiếu cho mọi key (engine backend)"
            >{translatingAll ? 'Translating…' : '🌐 Translate all missing'}</button>
        </div>
    {/if}
    {#if translateError}
        <div class="loc-editor__error" style="padding:4px 10px;">{translateError}</div>
    {/if}

    <!-- List -->
    <div class="loc-editor__list">
        {#if $i18nVars.length === 0 && !showAddKey}
            <div class="loc-editor__empty-list">
                No localization keys. Add one below, or click 🌐 on a dict variable in the Variables tab.
            </div>
        {/if}

        {#each $i18nVars.filter(v =>
            !searchQuery ||
            v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            getDictValue(v, $previewLanguageCode).toLowerCase().includes(searchQuery.toLowerCase())
        ) as v (v.id)}
            <div class="loc-editor__item" transition:slide={{ duration: 120 }}>
                <div class="loc-editor__item-row">
                    {#if editingKey === v.name}
                        <div class="loc-editor__edit-key-row">
                            <input
                                class="loc-editor__input loc-editor__edit-key-input"
                                class:loc-editor__input_error={!!editKeyError}
                                type="text"
                                bind:value={editingKeyValue}
                                use:focusOnMount
                                on:keydown={e => { if (e.key === 'Enter') commitEditKey(v.name); else if (e.key === 'Escape') editingKey = null; }}
                                on:blur={() => commitEditKey(v.name)}
                            />
                            {#if editKeyError}<span class="loc-editor__error">{editKeyError}</span>{/if}
                        </div>
                    {:else}
                        <button class="loc-editor__item-header" on:click={() => toggleExpand(v.name)}>
                            <span class="loc-editor__key">{v.name}</span>
                            {#if !$usedInLayout.has(v.name)}
                                <span class="loc-editor__unused" title="Not used in layout">!</span>
                            {/if}
                            <span class="loc-editor__preview">{getDictValue(v, $previewLanguageCode) || '—'}</span>
                            <svg class="loc-editor__chevron" class:loc-editor__chevron_open={expandedVars.has(v.name)}
                                width="12" height="12" viewBox="0 0 12 12">
                                <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
                            </svg>
                        </button>
                        {#if !$readOnly}
                            <button class="loc-editor__edit-icon" title="Translate missing locales"
                                on:click|stopPropagation={() => translateVar(v)}
                                disabled={translatingVars.has(v.name)}
                            >{translatingVars.has(v.name) ? '⏳' : '🌐'}</button>
                            <button class="loc-editor__edit-icon" title="Rename key" on:click|stopPropagation={() => startEditKey(v.name)}>
                                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                                    <path d="M9 1.5l2.5 2.5-7 7H2v-2.5l7-7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/>
                                </svg>
                            </button>
                            <button class="loc-editor__delete-icon" title="Delete key" on:click|stopPropagation={() => deleteKey(v.name)}></button>
                        {/if}
                    {/if}
                </div>

                {#if expandedVars.has(v.name)}
                    <div class="loc-editor__fields" transition:slide={{ duration: 120 }}>
                        <label class="loc-editor__field loc-editor__field_main">
                            <span class="loc-editor__field-label">{$previewLanguageCode} · {LOCALE_LABELS[$previewLanguageCode] || $previewLanguageCode}</span>
                            <textarea
                                class="loc-editor__textarea"
                                value={getDictValue(v, $previewLanguageCode)}
                                disabled={$readOnly}
                                rows="2"
                                on:change={e => updateLocaleValue(v.name, $previewLanguageCode, (e.target as HTMLTextAreaElement).value)}
                            ></textarea>
                        </label>
                        {#each $allLocales.filter(l => l !== $previewLanguageCode) as loc}
                            <label class="loc-editor__field">
                                <span class="loc-editor__field-label">{loc}</span>
                                <input
                                    class="loc-editor__input loc-editor__input_field"
                                    type="text"
                                    value={getDictValue(v, loc)}
                                    disabled={$readOnly}
                                    on:change={e => updateLocaleValue(v.name, loc, (e.target as HTMLInputElement).value)}
                                />
                            </label>
                        {/each}
                    </div>
                {/if}
            </div>
        {/each}

        <!-- Add new key form -->
        {#if showAddKey && !$readOnly}
            <div class="loc-editor__add-key-form" transition:slide={{ duration: 150 }}>
                <label class="loc-editor__field">
                    <span class="loc-editor__field-label">Key name</span>
                    <input
                        class="loc-editor__input loc-editor__input_field"
                        class:loc-editor__input_error={!!keyError}
                        type="text"
                        bind:value={newKeyName}
                        placeholder="e.g. paywall_title"
                        on:keydown={e => e.key === 'Enter' && addTextKey()}
                        on:input={() => keyError = ''}
                    />
                    {#if keyError}<span class="loc-editor__error">{keyError}</span>{/if}
                </label>
                <label class="loc-editor__field">
                    <span class="loc-editor__field-label">Default text ({$previewLanguageCode})</span>
                    <input
                        class="loc-editor__input loc-editor__input_field"
                        type="text"
                        bind:value={newKeyDefault}
                        placeholder="e.g. Unlock Premium"
                        on:keydown={e => e.key === 'Enter' && addTextKey()}
                    />
                </label>
                <div class="loc-editor__form-actions">
                    <button class="loc-editor__add-btn" on:click={addTextKey}>Add</button>
                    <button class="loc-editor__cancel-btn" on:click={() => { showAddKey = false; newKeyName = 'locale_'; newKeyDefault = ''; keyError = ''; }}>Cancel</button>
                </div>
            </div>
        {/if}

        {#if !$readOnly}
            <button class="loc-editor__new-key-btn" on:click={() => showAddKey = !showAddKey}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                Add text key
            </button>
        {/if}
    </div>
</div>

<style>
    .loc-editor {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .loc-editor__lang-code {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--fill-transparent-2);
        background: var(--fill-transparent-05);
    }

    .loc-editor__lang-code-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-primary);
    }

    .loc-editor__lang-code-value {
        font-size: 12px;
        color: var(--accent-purple);
        font-weight: 500;
    }

    .loc-editor__lang-code-badge {
        font-size: 10px;
        font-weight: 500;
        padding: 1px 5px;
        border-radius: 4px;
        background: var(--fill-accent-2, rgba(123,97,255,0.12));
        color: var(--accent-purple);
        text-transform: uppercase;
        letter-spacing: 0.3px;
    }

    .loc-editor__locale-bar {
        padding: 0 12px 8px;
        border-bottom: 1px solid var(--fill-transparent-2);
        flex-shrink: 0;
    }

    .loc-editor__locales {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding-top: 4px;
    }

    .loc-editor__locale-btn {
        padding: 3px 8px;
        font-size: 11px;
        font-weight: 500;
        border: 1px solid var(--fill-transparent-3);
        border-radius: 4px;
        background: none;
        cursor: pointer;
        color: var(--text-secondary);
        transition: all 0.12s;
    }

    .loc-editor__locale-btn_active {
        background: var(--accent-purple);
        border-color: var(--accent-purple);
        color: #fff;
    }

    .loc-editor__locale-btn:hover:not(.loc-editor__locale-btn_active) {
        background: var(--fill-transparent-1);
        color: var(--text-primary);
    }

    .loc-editor__locale-add {
        padding: 3px 8px;
        font-size: 14px;
        border: 1px dashed var(--fill-transparent-3);
        border-radius: 4px;
        background: none;
        cursor: pointer;
        color: var(--text-secondary);
    }

    .loc-editor__locale-add:hover {
        border-color: var(--accent-purple);
        color: var(--accent-purple);
    }

    .loc-editor__add-locale {
        display: flex;
        gap: 6px;
        margin-top: 8px;
    }

    .loc-editor__single-locale {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--fill-transparent-2);
        flex-shrink: 0;
        font-size: 12px;
        color: var(--text-secondary);
        cursor: pointer;
    }

    .loc-editor__single-locale input {
        cursor: pointer;
    }

    .loc-editor__search {
        padding: 8px 12px;
        border-bottom: 1px solid var(--fill-transparent-2);
        flex-shrink: 0;
    }

    .loc-editor__list {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 4px 0 8px;
        display: flex;
        flex-direction: column;
    }

    .loc-editor__empty-list {
        padding: 20px 16px;
        font-size: 13px;
        color: var(--text-secondary);
        text-align: center;
    }

    .loc-editor__item {
        border-bottom: 1px solid var(--fill-transparent-1);
    }

    .loc-editor__item-row {
        display: flex;
        align-items: center;
    }

    .loc-editor__item-header {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        min-width: 0;
        padding: 8px 12px;
        background: none;
        border: none;
        cursor: pointer;
        text-align: left;
        color: inherit;
    }

    .loc-editor__item-header:hover {
        background: var(--fill-transparent-05);
    }

    .loc-editor__edit-key-row {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        min-width: 0;
    }

    .loc-editor__edit-key-input {
        flex: 1;
        min-width: 0;
        font-size: 11px;
        font-weight: 600;
        color: var(--accent-purple);
    }

    .loc-editor__edit-icon {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        background: none;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        color: var(--text-secondary);
        transition: background 0.12s;
    }

    .loc-editor__edit-icon:hover {
        background: var(--fill-transparent-1);
        color: var(--accent-purple);
        opacity: 1;
    }

    .loc-editor__delete-icon {
        position: relative;
        flex-shrink: 0;
        margin: 0;
        margin-right: 4px;
        padding: 0;
        width: 32px;
        height: 32px;
        cursor: pointer;
        background: none;
        border: 1px solid transparent;
        border-radius: 6px;
        appearance: none;
        transition: .15s ease-in-out;
        transition-property: background-color, border-color;
    }

    .loc-editor__delete-icon::before {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: no-repeat 50% 50% url(../../assets/minus.svg);
        background-size: 20px;
        filter: var(--icon-filter);
        content: '';
    }

    .loc-editor__delete-icon:hover {
        background-color: var(--fill-transparent-1);
    }

    .loc-editor__delete-icon:active {
        background-color: var(--fill-transparent-2);
    }

    .loc-editor__delete-icon:focus-visible {
        outline: none;
        border-color: var(--accent-purple);
    }

    .loc-editor__key {
        font-size: 11px;
        font-weight: 600;
        color: var(--accent-purple);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 0;
        max-width: 130px;
    }

    .loc-editor__unused {
        flex-shrink: 0;
        font-size: 10px;
        font-weight: 700;
        color: var(--accent-yellow, #f5a623);
        background: rgba(245,166,35,0.12);
        border-radius: 3px;
        padding: 1px 4px;
        line-height: 1;
    }

    .loc-editor__preview {
        flex: 1;
        font-size: 12px;
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
    }

    .loc-editor__chevron {
        flex-shrink: 0;
        color: var(--text-secondary);
        transition: transform 0.15s;
    }

    .loc-editor__chevron_open {
        transform: rotate(180deg);
    }

    .loc-editor__fields {
        padding: 6px 12px 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        background: var(--fill-transparent-05);
    }

    .loc-editor__field {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .loc-editor__field_main { margin-bottom: 2px; }

    .loc-editor__field-label {
        font-size: 10px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.4px;
    }

    .loc-editor__field_main .loc-editor__field-label {
        color: var(--accent-purple);
    }

    .loc-editor__input {
        height: 28px;
        padding: 0 8px;
        border: 1px solid var(--fill-transparent-3);
        border-radius: 6px;
        background: var(--background-primary);
        color: var(--text-primary);
        font-size: 12px;
        outline: none;
        width: 100%;
        box-sizing: border-box;
        font-family: inherit;
    }

    .loc-editor__input:focus { border-color: var(--accent-purple); }
    .loc-editor__input:disabled { opacity: 0.5; }
    .loc-editor__input_field { font-size: 12px; }
    .loc-editor__input_error { border-color: var(--accent-red, #f44); }

    .loc-editor__textarea {
        padding: 6px 8px;
        border: 1px solid var(--fill-transparent-3);
        border-radius: 6px;
        background: var(--background-primary);
        color: var(--text-primary);
        font-size: 12px;
        outline: none;
        width: 100%;
        box-sizing: border-box;
        resize: vertical;
        font-family: inherit;
        line-height: 1.4;
    }

    .loc-editor__textarea:focus { border-color: var(--accent-purple); }
    .loc-editor__textarea:disabled { opacity: 0.5; }


    .loc-editor__add-key-form {
        margin: 4px 12px 0;
        padding: 10px 12px;
        border: 1px solid var(--fill-transparent-3);
        border-radius: 8px;
        background: var(--fill-transparent-05);
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .loc-editor__form-actions {
        display: flex;
        gap: 6px;
    }

    .loc-editor__add-btn {
        padding: 0 12px;
        height: 28px;
        font-size: 12px;
        border: none;
        border-radius: 6px;
        background: var(--accent-purple);
        color: #fff;
        cursor: pointer;
    }

    .loc-editor__cancel-btn {
        padding: 0 12px;
        height: 28px;
        font-size: 12px;
        border: 1px solid var(--fill-transparent-3);
        border-radius: 6px;
        background: none;
        color: var(--text-secondary);
        cursor: pointer;
    }

    .loc-editor__error {
        font-size: 11px;
        color: var(--accent-red, #f44336);
    }

    .loc-editor__new-key-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 8px 12px 4px;
        padding: 8px 12px;
        font-size: 13px;
        font-family: inherit;
        border: 1px dashed var(--fill-transparent-3);
        border-radius: 8px;
        background: none;
        color: var(--text-secondary);
        cursor: pointer;
        width: calc(100% - 24px);
        justify-content: center;
        transition: all 0.12s;
    }

    .loc-editor__new-key-btn:hover {
        border-color: var(--accent-purple);
        color: var(--accent-purple);
        background: var(--fill-accent-2, rgba(123,97,255,0.06));
    }
</style>
