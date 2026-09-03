<script lang="ts">
    import { slide } from 'svelte/transition';
    import { get } from 'svelte/store';
    import { afterUpdate, createEventDispatcher, getContext } from 'svelte';
    import type { NumberProperty, StringProperty } from '../../data/componentProps';
    import { APP_CTX, type AppContext } from '../../ctx/appContext';
    import { LANGUAGE_CTX, type LanguageContext } from '../../ctx/languageContext';
    import { tankerKeyToVariableName } from '../../utils/tanker';
    import { buildLocalize, runTranslate, canLocalize as canLocalizeText } from '../../data/localize';
    import { calcSelectionOffset, getInnerText, setSelectionOffset } from '../../utils/contenteditable';
    import { parseConstraint } from '../../utils/parseConstraint';
    import { supportsPlainTextOnly } from '../../utils/supportsPlainTextOnly';

    export let id: string = '';
    export let value: string;
    export let item: StringProperty | NumberProperty;
    export let flags: {
        subtype?: string;
        constraint?: string;
    } = {};
    export let tankerToggled = false;
    export let showInsertVariable = true;

    const { getTranslationKey, getSelection, state, tanker2Dialog } = getContext<AppContext>(APP_CTX);
    const { l10n } = getContext<LanguageContext>(LANGUAGE_CTX);
    const { tanker, locale, readOnly, customVariables, i18nMarkedVars, previewLanguageCode, products, previewProductPrices } = state;

    const dispatch = createEventDispatcher();

    let showPicker = false;
    let pickerSearch = '';
    let insertTextInput = '';
    // Each entry: { expr: string, label: string }
    let selectedParts: { expr: string; label: string }[] = [];
    $: selectedExprs = new Set(selectedParts.map(p => p.expr));

    $: localeVars = $customVariables.filter(v => v.type === 'dict' && $i18nMarkedVars.has(v.name));
    $: regularVars = $customVariables.filter(v => !$i18nMarkedVars.has(v.name));

    $: filteredLocaleVars = pickerSearch
        ? localeVars.filter(v => v.name.toLowerCase().includes(pickerSearch.toLowerCase()) ||
            getLocaleDefault(v).toLowerCase().includes(pickerSearch.toLowerCase()))
        : localeVars;

    $: filteredRegularVars = pickerSearch
        ? regularVars.filter(v => v.name.toLowerCase().includes(pickerSearch.toLowerCase()))
        : regularVars;

    $: filteredProducts = ($products || []).filter(p => p.id &&
        (!pickerSearch || p.id.toLowerCase().includes(pickerSearch.toLowerCase()))
    );

    function getLocaleDefault(v: { value: string }): string {
        try {
            const dict = typeof v.value === 'string' ? JSON.parse(v.value) : v.value as Record<string, string>;
            const lang = get(previewLanguageCode);
            const val = dict[lang] ?? dict['en'] ?? '';
            return typeof val === 'string' ? val : '';
        } catch { return ''; }
    }

    function getVarPreview(v: { value: string; type: string }): string {
        if (v.type === 'dict' || v.type === 'array') {
            try {
                const parsed = JSON.parse(v.value);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const lang = get(previewLanguageCode);
                    if (typeof parsed[lang] === 'string') return parsed[lang];
                    if (typeof parsed['en'] === 'string') return parsed['en'];
                }
                return '{…}';
            } catch { return v.value; }
        }
        return v.value;
    }

    // ── Localize: tạo biến locale_ + gắn vào text + tự dịch (helper chung) ─
    // Bỏ qua các prop đã tắt chèn biến (id, accessibility.description) — thay
    // literal ở đó bằng expression sẽ làm hỏng layout.
    let localizing = false;
    let localizeError = '';
    $: canLocalize = canLocalizeText(value) && (item as StringProperty).showInsertVariable !== false;

    async function localize(): Promise<void> {
        const { value: newValue, jobs } = buildLocalize(state, value || '');
        if (!jobs.length) return;
        value = newValue;
        dispatch('change', { value, item });
        localizing = true;
        localizeError = '';
        try {
            await runTranslate(state, jobs);
        } catch (e) {
            localizeError = String((e as Error)?.message || e);
        } finally {
            localizing = false;
        }
    }

    function doInsertAtCursor(expr: string) {
        const editable = !$readOnly && item.enabled !== false;
        if (editable && elem && document.activeElement === elem) {
            document.execCommand('insertText', false, expr);
            onChange();
        } else if (editable && elem) {
            elem.focus();
            const sel = getSelection();
            if (sel && sel.rangeCount) {
                document.execCommand('insertText', false, expr);
            } else {
                value = (value || '') + expr;
            }
            onChange();
        } else {
            value = (value || '') + expr;
            onChange();
        }
    }

    function togglePart(expr: string, label: string) {
        const idx = selectedParts.findIndex(p => p.expr === expr);
        if (idx >= 0) {
            selectedParts = selectedParts.filter((_, i) => i !== idx);
        } else {
            selectedParts = [...selectedParts, { expr, label }];
        }
    }

    function addTextPart() {
        if (!insertTextInput.trim()) return;
        togglePart(insertTextInput, insertTextInput);
        insertTextInput = '';
    }

    function commitInsert() {
        if (!selectedParts.length) return;
        doInsertAtCursor(selectedParts.map(p => p.expr).join(''));
        selectedParts = [];
        showPicker = false;
        pickerSearch = '';
        insertTextInput = '';
    }

    function onPickerMousedown(e: MouseEvent) {
        e.preventDefault();
    }

    function onClickOutside(e: MouseEvent) {
        if (!(e.target as HTMLElement).closest('.text-prop__picker')) {
            showPicker = false;
            pickerSearch = '';
            selectedParts = [];
            insertTextInput = '';
        }
    }

    let elem: HTMLElement;
    let tankerKeyLoading = false;
    let tankerKeyFound = false;
    let tankerKey = '';

    $: if (value && tankerToggled) {
        tankerKey = state.getTankerKey(value);
        tankerKeyFound = tankerKey in $tanker;
    } else {
        tankerKey = '';
    }

    $: number = flags.subtype === 'number' || flags.subtype === 'integer';

    $: type = number ? 'number' : 'text';

    $: limits = parseConstraint(flags.subtype, flags.constraint);
    $: min = limits.min;
    $: max = limits.max;

    // eslint-disable-next-line no-nested-ternary
    $: step = flags.subtype === 'integer' ? 1 : (flags.subtype === 'number' ? .01 : null);

    $: pattern = flags.subtype === 'integer' ? '\\d+' : null;

    $: isTankerEditable = tankerToggled && !($readOnly || item.enabled === false);

    function onChange() {
        if (elem.hasAttribute('contenteditable')) {
            value = getInnerText(elem, false);
        }

        if (item.default === '\0') {
            value = value.replace(/\0/g, '');
            value = value || '\0';
        }

        dispatch('change', {
            value,
            item
        });
    }

    function onPaste(event: ClipboardEvent): void {
        event.preventDefault();
        if (event.clipboardData) {
            let text = event.clipboardData.getData('text/plain');
            text = text.trim();
            document.execCommand('inserttext', false, text);
        }
    }

    function onLockedClick(): void {
        tanker2Dialog().show({
            target: elem,
            value: tankerKey,
            callback(key) {
                if (!key || !getTranslationKey) {
                    value = '';
                    return;
                }

                const setValue = () => {
                    value = `@{${tankerKeyToVariableName(key)}}`;
                    state.storeTankerKey(key);
                    onChange();
                    tankerKey = key;
                    tankerKeyLoading = false;
                };

                tankerKeyLoading = true;
                getTranslationKey(key).then(res => {
                    setValue();

                    if (res) {
                        $tanker = {
                            ...$tanker,
                            [key]: res
                        };

                        tankerKeyFound = true;
                    } else {
                        tankerKeyFound = false;
                    }
                }).catch(_err => {
                    setValue();
                    tankerKeyFound = false;
                });
            }
        });
    }

    afterUpdate(() => {
        if (elem?.hasAttribute('contenteditable') && getInnerText(elem, false) !== value) {
            let selection;
            let prevStart;
            let prevEnd;

            if (document.activeElement === elem) {
                selection = getSelection();
                prevStart = calcSelectionOffset(selection, elem, 'start', false);
                prevEnd = calcSelectionOffset(selection, elem, 'end', false);
            }

            elem.innerText = value;

            if (document.activeElement === elem && selection && prevStart !== undefined && prevEnd !== undefined) {
                selection.removeAllRanges();
                const range = document.createRange();
                setSelectionOffset(selection, elem, range, 'start', prevStart, false);
                setSelectionOffset(selection, elem, range, 'end', prevEnd, false);
                selection.addRange(range);
            }
        }
    });
</script>

{#if type === 'text'}
    {#if $readOnly || item.enabled === false || tankerToggled}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="text-prop text-prop_disabled"
            class:text-prop_disabled-clickable={isTankerEditable}
            {id}
            bind:this={elem}
            on:paste={onPaste}
            on:click={isTankerEditable ? onLockedClick : null}
        >
            {#if tankerToggled}
                {$tanker[tankerKey]?.[$locale] || ''}
            {:else}
                {value}
            {/if}

            {#if isTankerEditable}
                <div
                    class="text-prop__loader"
                    class:text-prop__loader_shown={tankerKeyLoading}
                ></div>
            {/if}
        </div>
    {:else}
        <div
            {...{
                autocomplete: 'off',
                autocorrect: 'off'
            }}
            class="text-prop"
            autocapitalize="off"
            spellcheck="false"
            contenteditable={supportsPlainTextOnly ? 'plaintext-only' : 'true'}
            {id}
            bind:this={elem}
            on:input={onChange}
            on:paste={onPaste}
        >
        </div>
    {/if}
{:else}
    <input
        class="text-prop"
        class:text-prop_disabled={$readOnly}
        type="number"
        {min}
        {max}
        {step}
        {pattern}
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        {id}
        disabled={$readOnly}
        bind:this={elem}
        bind:value={value}
        on:input={onChange}
    />
{/if}

<svelte:window on:click={showPicker ? onClickOutside : null} />

{#if !number && !$readOnly && !tankerToggled && canLocalize}
    <button
        class="text-prop__insert-btn"
        on:click={localize}
        disabled={localizing}
        title="Tạo biến locale_ + gắn vào text + tự dịch mọi ngôn ngữ"
    >{localizing ? '⏳ Localizing…' : '🌐 Localize'}</button>
{/if}
{#if localizeError}
    <div class="text-prop__error" style="color:#c0392b;font-size:11px;margin-top:2px;">{localizeError}</div>
{/if}

{#if showInsertVariable && !number && !$readOnly && !tankerToggled && (localeVars.length || regularVars.length)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="text-prop__picker" on:mousedown={onPickerMousedown}>
        <button
            class="text-prop__insert-btn"
            on:click={() => { showPicker = !showPicker; pickerSearch = ''; }}
        >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            Insert variable
        </button>
        {#if showPicker}
            <div class="text-prop__picker-dropdown" transition:slide|local={{ duration: 120 }}>
                <div class="text-prop__picker-header">
                    <input
                        class="text-prop__picker-search"
                        type="text"
                        bind:value={pickerSearch}
                        placeholder="Search…"
                        on:mousedown|stopPropagation
                    />
                    <button class="text-prop__picker-close" aria-label="Close picker" on:click={() => { showPicker = false; pickerSearch = ''; selectedParts = []; }}>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>

                <div class="text-prop__picker-list">
                    {#if !pickerSearch}
                        <div class="text-prop__picker-section">Text</div>
                        <div class="text-prop__insert-text-row">
                            <input
                                class="text-prop__insert-text-input"
                                type="text"
                                bind:value={insertTextInput}
                                placeholder="Type text to add…"
                                on:mousedown|stopPropagation
                                on:keydown={e => { if (e.key === 'Enter') addTextPart(); }}
                            />
                            <button
                                class="text-prop__insert-text-btn"
                                disabled={!insertTextInput}
                                on:click={addTextPart}
                            >Add</button>
                        </div>
                        <div class="text-prop__quick-text">
                            <button class="text-prop__quick-btn" on:click={() => togglePart(' ', '·space·')}>
                                <span class:text-prop__picker-item_selected={selectedExprs.has(' ')}>· Space</span>
                            </button>
                        </div>
                    {/if}

                    {#if !pickerSearch || 'language_code'.includes(pickerSearch.toLowerCase())}
                        <div class="text-prop__picker-section">System</div>
                        {@const expr = '@{language_code}'}
                        <button
                            class="text-prop__picker-item"
                            class:text-prop__picker-item_selected={selectedExprs.has(expr)}
                            on:click={() => togglePart(expr, 'language_code')}
                        >
                            <span class="text-prop__picker-check">{selectedExprs.has(expr) ? '✓' : ''}</span>
                            <span class="text-prop__picker-key">language_code</span>
                            <span class="text-prop__picker-preview">{$previewLanguageCode}</span>
                        </button>
                    {/if}

                    {#if filteredLocaleVars.length}
                        <div class="text-prop__picker-section">Localization</div>
                        {#each filteredLocaleVars as v}
                            {@const expr = `@{getOptStringFromDict('${getLocaleDefault(v)}', ${v.name}, language_code)}`}
                            <button
                                class="text-prop__picker-item"
                                class:text-prop__picker-item_selected={selectedExprs.has(expr)}
                                on:click={() => togglePart(expr, v.name)}
                            >
                                <span class="text-prop__picker-check">{selectedExprs.has(expr) ? '✓' : ''}</span>
                                <span class="text-prop__picker-key">{v.name}</span>
                                <span class="text-prop__picker-preview">{getLocaleDefault(v) || '—'}</span>
                            </button>
                        {/each}
                    {/if}

                    {#if filteredRegularVars.length}
                        <div class="text-prop__picker-section">Variables</div>
                        {#each filteredRegularVars as v}
                            {@const expr = `@{${v.name}}`}
                            <button
                                class="text-prop__picker-item"
                                class:text-prop__picker-item_selected={selectedExprs.has(expr)}
                                on:click={() => togglePart(expr, v.name)}
                            >
                                <span class="text-prop__picker-check">{selectedExprs.has(expr) ? '✓' : ''}</span>
                                <span class="text-prop__picker-key">{v.name}</span>
                                <span class="text-prop__picker-preview">{getVarPreview(v) || '—'}</span>
                            </button>
                        {/each}
                    {/if}

                    {#if filteredProducts.length}
                        <div class="text-prop__picker-section">Products</div>
                        {#each filteredProducts as p}
                            {@const expr = `@{${p.id}}`}
                            <button
                                class="text-prop__picker-item"
                                class:text-prop__picker-item_selected={selectedExprs.has(expr)}
                                on:click={() => togglePart(expr, p.id)}
                            >
                                <span class="text-prop__picker-check">{selectedExprs.has(expr) ? '✓' : ''}</span>
                                <span class="text-prop__picker-key">{p.id}</span>
                                <span class="text-prop__picker-preview">{$previewProductPrices[p.id] ?? '0'}</span>
                            </button>
                        {/each}
                    {/if}

                    {#if !filteredLocaleVars.length && !filteredRegularVars.length && !filteredProducts.length && pickerSearch}
                        <div class="text-prop__picker-empty">No results</div>
                    {/if}
                </div>

                <!-- Footer: selected preview + Insert button -->
                {#if selectedParts.length}
                    <div class="text-prop__picker-footer" transition:slide|local={{ duration: 100 }}>
                        <div class="text-prop__picker-footer-preview">
                            {#each selectedParts as part, i}
                                <span class="text-prop__picker-chip">
                                    <span class="text-prop__picker-chip-label">{part.label}</span>
                                    <button class="text-prop__picker-chip-remove" on:click={() => selectedParts = selectedParts.filter((_, idx) => idx !== i)}>×</button>
                                </span>
                            {/each}
                        </div>
                        <button class="text-prop__picker-insert-btn" on:click={commitInsert}>
                            Insert {selectedParts.length}
                        </button>
                    </div>
                {/if}
            </div>
        {/if}
    </div>
{/if}

{#if tankerToggled}
    <div transition:slide|local>
        {#if value && tankerKey}
            <div class="text-prop__tanker">
                <div
                    class="text-prop__tanker-label"
                    class:text-prop__tanker-label_error={!tankerKeyFound}
                >
                    {$l10n(tankerKeyFound ? 'tankerKey' : 'tankerMissing')}
                </div>

                <button
                    class="text-prop__tanker-key"
                    class:text-prop__tanker-key_disabled={!isTankerEditable}
                    on:click={isTankerEditable ? onLockedClick : undefined}
                >
                    {tankerKey}
                </button>
            </div>
        {:else}
            {#if isTankerEditable}
                <div class="text-prop__tanker">
                    <button
                        class="text-prop__tanker-key"
                        on:click={onLockedClick}
                    >
                        {$l10n('tankerEnterValue')}
                    </button>
                </div>
            {/if}
        {/if}
    </div>
{/if}

<style>
    .text-prop {
        position: relative;
        box-sizing: border-box;
        width: 100%;
        min-height: 38px;
        margin: 0;
        padding: 8px 14px;
        font: inherit;
        font-size: 14px;
        line-height: 20px;
        color: inherit;
        border: 1px solid var(--fill-transparent-3);
        border-radius: 8px;
        background: var(--fill-transparent-minus-1);
        appearance: none;
        cursor: text;
        white-space: pre-wrap;
        transition: .15s ease-in-out;
        transition-property: border-color, background-color;
    }

    .text-prop_disabled {
        border-color: transparent;
        background: var(--fill-transparent-1);
        cursor: default;
    }

    .text-prop_disabled-clickable {
        padding-right: 40px;
        cursor: pointer;
    }

    .text-prop_disabled-clickable:hover {
        background: var(--fill-accent-2);
    }

    .text-prop:invalid {
        background: indianred;
    }

    .text-prop:not(.text-prop_disabled):hover {
        border-color: var(--fill-transparent-4);
    }

    .text-prop.text-prop:focus-visible {
        outline: none;
        border-color: var(--accent-purple);
    }

    .text-prop__tanker {
        display: flex;
        margin-top: 4px;
        font-size: 14px;
        line-height: 20px;
        color: var(--text-secondary);
    }

    .text-prop__tanker-label {
        margin-right: 6px;
    }

    .text-prop__tanker-label_error {
        color: var(--accent-red);
    }

    .text-prop__tanker-key {
        margin: 0;
        padding: 0;
        font-family: inherit;
        font-size: 14px;
        line-height: 20px;
        border: none;
        border-radius: 4px;
        color: var(--accent-purple);
        background: none;
        cursor: pointer;
        appearance: none;
    }

    .text-prop__tanker-key:not(.text-prop__tanker-key_disabled):hover {
        text-decoration: underline;
    }

    .text-prop__tanker-key_disabled {
        cursor: default;
    }

    .text-prop__tanker-key:focus-visible {
        outline: 1px solid var(--accent-purple);
    }

    .text-prop__loader {
        position: absolute;
        top: 14px;
        right: 14px;
        bottom: 14px;
        box-sizing: border-box;
        width: 12px;
        height: 12px;
        border-radius: 1024px;
        border: 1.5px solid var(--icons-gray);
        border-bottom-color: transparent;
        animation: rotate 1s linear infinite;
        opacity: 0;
        visibility: hidden;
        transition: .3s ease-in-out;
        transition-property: opacity, visibility;
    }

    .text-prop__loader_shown {
        opacity: 1;
        visibility: visible;
    }

    @keyframes rotate {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    .text-prop__picker {
        position: relative;
        margin-top: 4px;
    }

    .text-prop__insert-btn {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 0;
        margin: 0;
        font: inherit;
        font-size: 12px;
        color: var(--accent-purple);
        background: none;
        border: none;
        cursor: pointer;
        opacity: 0.7;
        transition: opacity 0.12s;
    }

    .text-prop__insert-btn:hover {
        opacity: 1;
    }

    .text-prop__picker-dropdown {
        position: absolute;
        left: 0;
        right: 0;
        z-index: 100;
        max-height: 300px;
        background: var(--background-primary);
        border: 1px solid var(--fill-transparent-3);
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.15);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .text-prop__picker-list {
        flex: 1;
        overflow-y: auto;
        max-height: 220px;
    }

    .text-prop__picker-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 8px 6px;
        border-bottom: 1px solid var(--fill-transparent-2);
        position: sticky;
        top: 0;
        background: var(--background-primary);
        z-index: 1;
    }

    .text-prop__picker-search {
        flex: 1;
        height: 26px;
        padding: 0 8px;
        font: inherit;
        font-size: 12px;
        border: 1px solid var(--fill-transparent-3);
        border-radius: 5px;
        background: var(--fill-transparent-1);
        color: var(--text-primary);
        outline: none;
    }

    .text-prop__picker-search:focus {
        border-color: var(--accent-purple);
    }

    .text-prop__picker-close {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        background: none;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        color: var(--text-secondary);
    }

    .text-prop__picker-close:hover {
        background: var(--fill-transparent-1);
        color: var(--text-primary);
    }

    .text-prop__picker-section {
        padding: 6px 10px 2px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: var(--text-secondary);
    }

    .text-prop__picker-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        background: none;
        border: none;
        cursor: pointer;
        text-align: left;
        width: 100%;
        min-width: 0;
        font: inherit;
        color: inherit;
        transition: background 0.1s;
    }

    .text-prop__picker-item:hover {
        background: var(--fill-transparent-1);
    }

    .text-prop__picker-item_selected {
        background: var(--fill-accent-2, rgba(123,97,255,0.08));
    }

    .text-prop__picker-item_selected:hover {
        background: var(--fill-accent-2, rgba(123,97,255,0.12));
    }

    .text-prop__picker-check {
        flex-shrink: 0;
        width: 14px;
        font-size: 11px;
        color: var(--accent-purple);
        font-weight: 700;
    }

    .text-prop__picker-footer {
        border-top: 1px solid var(--fill-transparent-2);
        padding: 6px 8px;
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--background-primary);
    }

    .text-prop__picker-footer-preview {
        flex: 1;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        min-width: 0;
    }

    .text-prop__picker-chip {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 1px 4px 1px 6px;
        background: var(--fill-accent-2, rgba(123,97,255,0.12));
        color: var(--accent-purple);
        border-radius: 4px;
        font-size: 11px;
        font-weight: 500;
        max-width: 120px;
    }

    .text-prop__picker-chip-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
        flex: 1;
    }

    .text-prop__picker-chip-remove {
        flex-shrink: 0;
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        color: var(--accent-purple);
        font-size: 13px;
        line-height: 1;
        opacity: 0.45;
        transition: opacity 0.1s;
    }

    .text-prop__picker-chip-remove:hover { opacity: 1; }

    .text-prop__picker-insert-btn {
        flex-shrink: 0;
        height: 28px;
        padding: 0 12px;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        border: none;
        border-radius: 6px;
        background: var(--accent-purple);
        color: #fff;
        cursor: pointer;
        white-space: nowrap;
    }

    .text-prop__picker-insert-btn:hover {
        opacity: 0.9;
    }

    .text-prop__picker-key {
        flex-shrink: 0;
        font-size: 11px;
        font-weight: 600;
        color: var(--accent-purple);
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .text-prop__picker-preview {
        flex: 1;
        font-size: 11px;
        color: var(--text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }

    .text-prop__insert-text-row {
        display: flex;
        gap: 6px;
        padding: 4px 10px 6px;
    }

    .text-prop__insert-text-input {
        flex: 1;
        height: 26px;
        padding: 0 8px;
        font: inherit;
        font-size: 12px;
        border: 1px solid var(--fill-transparent-3);
        border-radius: 5px;
        background: var(--fill-transparent-1);
        color: var(--text-primary);
        outline: none;
        min-width: 0;
    }

    .text-prop__insert-text-input:focus {
        border-color: var(--accent-purple);
    }

    .text-prop__insert-text-btn {
        flex-shrink: 0;
        height: 26px;
        padding: 0 10px;
        font: inherit;
        font-size: 12px;
        border: none;
        border-radius: 5px;
        background: var(--accent-purple);
        color: #fff;
        cursor: pointer;
    }

    .text-prop__insert-text-btn:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .text-prop__quick-text {
        display: flex;
        gap: 4px;
        padding: 0 10px 6px;
    }

    .text-prop__quick-btn {
        padding: 2px 8px;
        font: inherit;
        font-size: 11px;
        border: 1px solid var(--fill-transparent-3);
        border-radius: 4px;
        background: none;
        cursor: pointer;
        color: var(--text-secondary);
    }

    .text-prop__quick-btn:hover {
        background: var(--fill-transparent-1);
        color: var(--text-primary);
    }

    .text-prop__picker-empty {
        padding: 12px 10px;
        font-size: 12px;
        color: var(--text-secondary);
        text-align: center;
    }
</style>
