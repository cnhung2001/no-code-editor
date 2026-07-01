<script lang="ts">
    import { getContext } from 'svelte';
    import { derived } from 'svelte/store';
    import { slide } from 'svelte/transition';
    import { APP_CTX, type AppContext } from '../ctx/appContext';
    import { findLeaf } from '../utils/tree';
    import PanelTitle from './PanelTitle.svelte';

    const {
        state,
        updateTranslationEntry,
        deleteTranslationEntry,
        refreshTranslations,
    } = getContext<AppContext>(APP_CTX);

    const {
        tanker,
        tankerKeyToNodes,
        selectedLeaf,
        highlightLeaf,
        highlightElem,
        highlightRanges,
        tree,
        locale,
    } = state;

    const LOCALE_LABELS: Record<string, string> = {
        en: 'English', vi: 'Tiếng Việt', ar: 'العربية', zh: '中文',
        fr: 'Français', de: 'Deutsch', es: 'Español', pt: 'Português',
        ru: 'Русский', ja: '日本語', ko: '한국어', it: 'Italiano',
        nl: 'Nederlands', tr: 'Türkçe', pl: 'Polski', uk: 'Українська',
        th: 'ภาษาไทย', id: 'Bahasa Indonesia', ms: 'Bahasa Melayu',
        hi: 'हिन्दी', cs: 'Čeština', da: 'Dansk', fi: 'Suomi',
        el: 'Ελληνικά', he: 'עברית', hr: 'Hrvatski', hu: 'Magyar',
        no: 'Norsk', ro: 'Română', sk: 'Slovenčina', sv: 'Svenska',
    };

    const allLocales = derived(tanker, ($t) => {
        const locales = new Set<string>();
        for (const localeMap of Object.values($t)) {
            for (const loc of Object.keys(localeMap)) {
                if (loc !== '*') locales.add(loc);
            }
        }
        return Array.from(locales).sort((a, b) => {
            if (a === 'en') return -1;
            if (b === 'en') return 1;
            return a.localeCompare(b);
        });
    });

    let activeLocale = '';
    $: if ($allLocales.length && (!activeLocale || !$allLocales.includes(activeLocale))) {
        activeLocale = $locale || $allLocales[0] || 'en';
    }

    const sortedKeys = derived(tanker, ($t) =>
        Object.keys($t).sort((a, b) => a.localeCompare(b))
    );

    let searchQuery = '';
    $: filteredKeys = $sortedKeys.filter(key => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        const val = $tanker[key]?.[activeLocale] || $tanker[key]?.['*'] || '';
        return key.toLowerCase().includes(q) || val.toLowerCase().includes(q);
    });

    let isRefreshing = false;
    async function onRefresh(): Promise<void> {
        if (isRefreshing || !refreshTranslations) return;
        isRefreshing = true;
        try {
            await refreshTranslations();
        } finally {
            isRefreshing = false;
        }
    }

    let editingKey: string | null = null;
    let editingLocale = '';
    let editingValue = '';
    let isSaving = false;
    let saveError = '';

    function startEdit(key: string, loc: string): void {
        editingKey = key;
        editingLocale = loc;
        editingValue = $tanker[key]?.[loc] || '';
        saveError = '';
    }

    async function commitEdit(): Promise<void> {
        if (!editingKey || isSaving || !updateTranslationEntry) return;
        const key = editingKey;
        const loc = editingLocale;
        const val = editingValue;
        isSaving = true;
        saveError = '';
        try {
            await updateTranslationEntry(key, loc, val);
            tanker.update(t => ({
                ...t,
                [key]: { ...(t[key] || {}), [loc]: val },
            }));
            editingKey = null;
        } catch (e) {
            saveError = e instanceof Error ? e.message : 'Save failed';
        } finally {
            isSaving = false;
        }
    }

    function cancelEdit(): void {
        editingKey = null;
        saveError = '';
    }

    let deletingKey: string | null = null;
    let isDeleting = false;

    async function confirmDelete(key: string): Promise<void> {
        if (isDeleting || !deleteTranslationEntry) return;
        isDeleting = true;
        try {
            await deleteTranslationEntry(key);
            tanker.update(t => {
                const copy = { ...t };
                delete copy[key];
                return copy;
            });
            deletingKey = null;
        } finally {
            isDeleting = false;
        }
    }

    function getLeafByKey(key: string) {
        const set = $tankerKeyToNodes.get(key);
        if (!set) return undefined;
        const id = [...set][0];
        return id ? findLeaf($tree, id) : undefined;
    }

    function navigateToKey(key: string): void {
        const leaf = getLeafByKey(key);
        if (leaf) selectedLeaf.set(leaf);
    }

    function onKeyOver(key: string): void {
        const leaf = getLeafByKey(key);
        const node = leaf?.props.node;
        const range = leaf?.props.range;
        if (node && range) {
            highlightLeaf.set([leaf]);
            highlightElem.set([node]);
            highlightRanges.set([range]);
        }
    }

    function onKeyOut(): void {
        highlightLeaf.set(null);
        highlightElem.set(null);
        highlightRanges.set(null);
    }

    function formatKey(key: string): { ns: string; name: string } {
        // Expected: "i18n.<ns>.<name>" — show ns as secondary label
        const parts = key.split('.');
        if (parts.length >= 3 && parts[0] === 'i18n') {
            return { ns: parts[1]!, name: parts.slice(2).join('.') };
        }
        return { ns: '', name: key };
    }
</script>

<div class="tanker-panel">
    <div class="tanker-panel__header">
        <PanelTitle title="Tanker" />
        {#if refreshTranslations}
            <button
                class="tanker-panel__refresh"
                class:tanker-panel__refresh_spinning={isRefreshing}
                disabled={isRefreshing}
                on:click={onRefresh}
                title="Refresh translations"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16">
                    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                        d="M2.5 8a5.5 5.5 0 1 1 1.1 3.3M2.5 13.5V8.5H7.5"/>
                </svg>
            </button>
        {/if}
    </div>

    {#if $allLocales.length}
        <!-- Locale tabs -->
        <div class="tanker-panel__locale-bar">
            {#each $allLocales as loc}
                <button
                    class="tanker-panel__locale-btn"
                    class:tanker-panel__locale-btn_active={loc === activeLocale}
                    on:click={() => { activeLocale = loc; locale.set(loc); }}
                    title={LOCALE_LABELS[loc] || loc}
                >{loc}</button>
            {/each}
        </div>

        <!-- Search -->
        <div class="tanker-panel__search">
            <input
                class="tanker-panel__input"
                type="text"
                bind:value={searchQuery}
                placeholder="Search keys or text..."
            />
        </div>

        <!-- Key list -->
        <div class="tanker-panel__list">
            {#if filteredKeys.length === 0}
                <div class="tanker-panel__empty">No matching keys.</div>
            {/if}

            {#each filteredKeys as key (key)}
                {@const fmt = formatKey(key)}
                {@const usedInLayout = $tankerKeyToNodes.has(key)}
                {@const value = $tanker[key]?.[activeLocale] || $tanker[key]?.['*'] || ''}
                <div class="tanker-panel__item" transition:slide={{ duration: 120 }}>
                    <div class="tanker-panel__item-meta">
                        <div class="tanker-panel__item-name">
                            {#if fmt.ns}
                                <span class="tanker-panel__item-ns">{fmt.ns}</span>
                                <span class="tanker-panel__item-sep">/</span>
                            {/if}
                            <button
                                class="tanker-panel__item-key"
                                class:tanker-panel__item-key_linked={usedInLayout}
                                on:click={() => navigateToKey(key)}
                                on:mouseenter={() => onKeyOver(key)}
                                on:mouseleave={onKeyOut}
                                disabled={!usedInLayout}
                                title={usedInLayout ? 'Click to select in layout' : key}
                            >{fmt.name}</button>
                        </div>
                        {#if !deleteTranslationEntry}
                            <!-- read-only, no delete -->
                        {:else if deletingKey === key}
                            <div class="tanker-panel__confirm-delete" transition:slide={{ duration: 100 }}>
                                <span class="tanker-panel__confirm-label">Delete key?</span>
                                <button
                                    class="tanker-panel__confirm-yes"
                                    disabled={isDeleting}
                                    on:click={() => confirmDelete(key)}
                                >Yes</button>
                                <button
                                    class="tanker-panel__confirm-no"
                                    on:click={() => deletingKey = null}
                                >No</button>
                            </div>
                        {:else}
                            <button
                                class="tanker-panel__delete"
                                on:click={() => deletingKey = key}
                                title="Delete key"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 14 14">
                                    <path stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="M2 2l10 10M12 2L2 12"/>
                                </svg>
                            </button>
                        {/if}
                    </div>

                    {#if editingKey === key && editingLocale === activeLocale}
                        <div class="tanker-panel__edit" transition:slide={{ duration: 100 }}>
                            <textarea
                                class="tanker-panel__textarea"
                                bind:value={editingValue}
                                rows={3}
                                on:keydown={e => {
                                    if (e.key === 'Escape') cancelEdit();
                                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit();
                                }}
                            ></textarea>
                            {#if saveError}
                                <div class="tanker-panel__error">{saveError}</div>
                            {/if}
                            <div class="tanker-panel__edit-actions">
                                <button
                                    class="tanker-panel__save-btn"
                                    disabled={isSaving}
                                    on:click={commitEdit}
                                >{isSaving ? 'Saving…' : 'Save'}</button>
                                <button
                                    class="tanker-panel__cancel-btn"
                                    on:click={cancelEdit}
                                >Cancel</button>
                            </div>
                        </div>
                    {:else}
                        <button
                            class="tanker-panel__value"
                            class:tanker-panel__value_empty={!value}
                            disabled={!updateTranslationEntry}
                            on:click={() => startEdit(key, activeLocale)}
                            title={updateTranslationEntry ? 'Click to edit' : ''}
                        >{value || '(empty)'}</button>
                    {/if}
                </div>
            {/each}
        </div>
    {:else}
        <div class="tanker-panel__no-tanker">
            No tanker keys loaded. Open a layout that uses i18n keys.
        </div>
    {/if}
</div>

<style>
    .tanker-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }

    .tanker-panel__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-right: 12px;
    }

    .tanker-panel__refresh {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: none;
        border-radius: 6px;
        background: none;
        color: var(--text-secondary);
        cursor: pointer;
        transition: background-color .15s, color .15s;
    }

    .tanker-panel__refresh:hover {
        background: var(--fill-transparent-1);
        color: var(--text-primary);
    }

    .tanker-panel__refresh_spinning svg {
        animation: spin .8s linear infinite;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .tanker-panel__locale-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 4px 12px 8px;
        border-bottom: 1px solid var(--fill-transparent-3);
    }

    .tanker-panel__locale-btn {
        padding: 2px 8px;
        font: inherit;
        font-size: 12px;
        line-height: 18px;
        color: var(--text-secondary);
        border: 1px solid transparent;
        border-radius: 4px;
        background: var(--fill-transparent-1);
        cursor: pointer;
        transition: background-color .15s, color .15s, border-color .15s;
    }

    .tanker-panel__locale-btn:hover {
        background: var(--fill-transparent-2);
        color: var(--text-primary);
    }

    .tanker-panel__locale-btn_active {
        background: var(--fill-accent-2);
        border-color: var(--accent-purple);
        color: var(--accent-purple);
    }

    .tanker-panel__search {
        padding: 8px 12px 4px;
    }

    .tanker-panel__input {
        box-sizing: border-box;
        width: 100%;
        padding: 6px 10px;
        font: inherit;
        font-size: 13px;
        color: var(--text-primary);
        border: 1px solid var(--fill-transparent-3);
        border-radius: 6px;
        background: var(--fill-transparent-1);
        outline: none;
        transition: border-color .15s;
    }

    .tanker-panel__input:focus {
        border-color: var(--accent-purple);
    }

    .tanker-panel__list {
        flex: 1;
        overflow-y: auto;
        padding: 4px 12px 16px;
    }

    .tanker-panel__empty,
    .tanker-panel__no-tanker {
        padding: 24px 0;
        font-size: 13px;
        color: var(--text-secondary);
        text-align: center;
    }

    .tanker-panel__item {
        margin-bottom: 12px;
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--fill-transparent-1);
    }

    .tanker-panel__item-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 4px;
        gap: 6px;
    }

    .tanker-panel__item-name {
        display: flex;
        align-items: center;
        gap: 3px;
        min-width: 0;
        overflow: hidden;
    }

    .tanker-panel__item-ns {
        font-size: 11px;
        color: var(--text-secondary);
        white-space: nowrap;
        flex-shrink: 0;
    }

    .tanker-panel__item-sep {
        font-size: 11px;
        color: var(--text-secondary);
        flex-shrink: 0;
    }

    .tanker-panel__item-key {
        margin: 0;
        padding: 0;
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        color: var(--text-secondary);
        border: none;
        background: none;
        cursor: default;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: left;
    }

    .tanker-panel__item-key_linked {
        color: var(--accent-purple);
        cursor: pointer;
    }

    .tanker-panel__item-key_linked:hover {
        text-decoration: underline;
    }

    .tanker-panel__delete {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: none;
        border-radius: 4px;
        background: none;
        color: var(--text-secondary);
        cursor: pointer;
        opacity: 0;
        transition: opacity .15s, background-color .15s, color .15s;
    }

    .tanker-panel__item:hover .tanker-panel__delete {
        opacity: 1;
    }

    .tanker-panel__delete:hover {
        background: var(--fill-transparent-2);
        color: var(--accent-red, #e53e3e);
    }

    .tanker-panel__confirm-delete {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
    }

    .tanker-panel__confirm-label {
        font-size: 12px;
        color: var(--text-secondary);
    }

    .tanker-panel__confirm-yes,
    .tanker-panel__confirm-no {
        padding: 1px 8px;
        font: inherit;
        font-size: 12px;
        border: 1px solid transparent;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color .15s;
    }

    .tanker-panel__confirm-yes {
        background: var(--accent-red, #e53e3e);
        color: #fff;
        border-color: var(--accent-red, #e53e3e);
    }

    .tanker-panel__confirm-yes:hover {
        opacity: .85;
    }

    .tanker-panel__confirm-no {
        background: var(--fill-transparent-1);
        color: var(--text-primary);
        border-color: var(--fill-transparent-3);
    }

    .tanker-panel__confirm-no:hover {
        background: var(--fill-transparent-2);
    }

    .tanker-panel__value {
        display: block;
        box-sizing: border-box;
        width: 100%;
        padding: 6px 8px;
        font: inherit;
        font-size: 13px;
        line-height: 1.4;
        color: var(--text-primary);
        text-align: left;
        border: 1px solid transparent;
        border-radius: 6px;
        background: var(--fill-transparent-2);
        cursor: text;
        transition: border-color .15s, background-color .15s;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .tanker-panel__value:not(:disabled):hover {
        border-color: var(--fill-transparent-3);
        background: var(--fill-transparent-3);
    }

    .tanker-panel__value_empty {
        color: var(--text-secondary);
        font-style: italic;
    }

    .tanker-panel__value:disabled {
        cursor: default;
    }

    .tanker-panel__edit {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .tanker-panel__textarea {
        box-sizing: border-box;
        width: 100%;
        padding: 6px 8px;
        font: inherit;
        font-size: 13px;
        line-height: 1.4;
        color: var(--text-primary);
        border: 1px solid var(--accent-purple);
        border-radius: 6px;
        background: var(--fill-transparent-1);
        outline: none;
        resize: vertical;
    }

    .tanker-panel__error {
        font-size: 12px;
        color: var(--accent-red, #e53e3e);
    }

    .tanker-panel__edit-actions {
        display: flex;
        gap: 6px;
    }

    .tanker-panel__save-btn,
    .tanker-panel__cancel-btn {
        padding: 3px 12px;
        font: inherit;
        font-size: 13px;
        border: 1px solid transparent;
        border-radius: 6px;
        cursor: pointer;
        transition: background-color .15s, opacity .15s;
    }

    .tanker-panel__save-btn {
        background: var(--accent-purple);
        color: #fff;
    }

    .tanker-panel__save-btn:hover:not(:disabled) {
        opacity: .85;
    }

    .tanker-panel__save-btn:disabled {
        opacity: .5;
        cursor: not-allowed;
    }

    .tanker-panel__cancel-btn {
        background: var(--fill-transparent-1);
        color: var(--text-primary);
        border-color: var(--fill-transparent-3);
    }

    .tanker-panel__cancel-btn:hover {
        background: var(--fill-transparent-2);
    }
</style>
