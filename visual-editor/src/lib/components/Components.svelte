<script lang="ts">
    import { createEventDispatcher, getContext } from 'svelte';
    import ComponentsTree from './ComponentsTree.svelte';
    import type { TreeLeaf } from '../ctx/tree';
    import { isTemplate, namedTemplates } from '../data/templates';
    import { LANGUAGE_CTX, type LanguageContext } from '../ctx/languageContext';
    import { supportedComponents } from '../data/componentProps';
    import { APP_CTX, type AppContext } from '../ctx/appContext';

    export let showAddButton = false;
    export let addActive = false;

    const dispatch = createEventDispatcher<{ add: void }>();

    const { l10n, lang } = getContext<LanguageContext>(LANGUAGE_CTX);
    const { state } = getContext<AppContext>(APP_CTX);
    const { highlightLeaf, highlightElem, highlightRanges, tree } = state;

    let highlightLeafs: TreeLeaf[] | null = null;
    let treeComponent: ComponentsTree;

    $: {
        if ($highlightLeaf) {
            highlightLeafs = $highlightLeaf?.filter(Boolean) || null;
        } else {
            highlightLeafs = null;
        }
    }

    function getText(leaf: TreeLeaf): string {
        if (leaf === $tree) {
            return $l10n('rootComponent');
        }

        const type = leaf.props.json.type;

        if (isTemplate(type)) {
            return $l10n(namedTemplates[type].nameKey);
        }

        if (supportedComponents.has(type)) {
            return $l10n(`components.${type}`);
        }

        return type;
    }

    function onTreeHover(event: CustomEvent<TreeLeaf | null>): void {
        const leaf = event.detail;
        const node = leaf?.props.node;
        const range = leaf?.props.range;
        if (node && range) {
            highlightLeaf.set([leaf]);
            highlightElem.set([node]);
            highlightRanges.set([range]);
        } else {
            highlightLeaf.set(null);
            highlightElem.set(null);
            highlightRanges.set(null);
        }
    }

    function onTreeKeyboardHover(event: CustomEvent<TreeLeaf>): void {
        highlightLeaf.set([event.detail]);
        highlightElem.set([event.detail.props.node]);
        const range = event.detail.props.range;
        highlightRanges.set(range ? [event.detail.props.range] : null);
    }
</script>

<div class="components__header">
    <h2 class="components__title">{$l10n('components')}</h2>
    {#if showAddButton}
        <button
            type="button"
            class="components__add"
            class:components__add_active={addActive}
            title={$l10n('basicComponents')}
            on:click={() => dispatch('add')}
        >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <span>Add</span>
        </button>
    {/if}
</div>

{#if $tree}
    <div class="components__tree-wrap">
        {#key $lang}
            <ComponentsTree
                {highlightLeafs}
                {getText}
                on:hover={onTreeHover}
                on:keyboardhover={onTreeKeyboardHover}
                bind:this={treeComponent}
            />
        {/key}
    </div>
{/if}

<style>
    .components__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 24px 24px 16px;
        flex-shrink: 0;
    }

    .components__title {
        margin: 0;
        font-weight: 500;
        font-size: 18px;
        line-height: 28px;
    }

    .components__add {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 500;
        line-height: 1;
        color: var(--text-primary);
        background: var(--fill-transparent-1);
        border: 1px solid var(--fill-transparent-2);
        border-radius: 6px;
        cursor: pointer;
        transition: background-color .15s, color .15s, border-color .15s;
    }

    .components__add:hover {
        background: var(--fill-transparent-2);
    }

    .components__add_active {
        background: var(--fill-accent-1);
        color: var(--accent-purple);
        border-color: var(--accent-purple);
    }

    .components__tree-wrap {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        display: flex;
        flex-direction: column;
    }
</style>
