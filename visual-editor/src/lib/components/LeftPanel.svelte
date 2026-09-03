<script lang="ts">
    import { getContext } from 'svelte';
    import type { LeftBarTab } from './leftBarTypes';
    import NewComponent from './NewComponent.svelte';
    import Components from './Components.svelte';
    import Palette from './Palette.svelte';
    import CustomVariables from './CustomVariables.svelte';
    import Timers from './Timers.svelte';
    import Products from './Products.svelte';
    import TankerPanel from './TankerPanel.svelte';
    import LocalizationEditor from './LocalizationEditor.svelte';
    import { APP_CTX, type AppContext } from '../ctx/appContext';

    export let activeTab: LeftBarTab;

    const { state } = getContext<AppContext>(APP_CTX);
    const { paletteEnabled, readOnly } = state;

    let addPanelOpen = false;
    let panelEl: HTMLDivElement;
    let flyoutLeft = 0;
    let flyoutTop = 0;
    let flyoutHeight = 0;

    $: if (activeTab !== 'components') addPanelOpen = false;

    $: addPanelOpen, panelEl, width, updateFlyoutPosition();

    function updateFlyoutPosition() {
        if (!panelEl) return;
        const rect = panelEl.getBoundingClientRect();
        flyoutLeft = rect.right;
        flyoutTop = rect.top;
        flyoutHeight = rect.height;
    }

    let width = 280;
    const MIN_WIDTH = 200;
    const MAX_WIDTH = 600;

    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    function onMouseDown(e: MouseEvent) {
        dragging = true;
        startX = e.clientX;
        startWidth = width;
        e.preventDefault();
    }

    function onMouseMove(e: MouseEvent) {
        if (!dragging) return;
        const delta = e.clientX - startX;
        width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
    }

    function onMouseUp() {
        dragging = false;
    }
</script>

<svelte:window
    on:mousemove={onMouseMove}
    on:mouseup={onMouseUp}
    on:resize={updateFlyoutPosition}
/>

<div class="left-panel" style="width: {width}px" bind:this={panelEl}>
    {#if activeTab === 'components'}
        <Components
            showAddButton={!$readOnly}
            addActive={addPanelOpen}
            on:add={() => addPanelOpen = !addPanelOpen}
        />
    {:else if activeTab === 'palette'}
        {#if $paletteEnabled}
            <Palette />
        {:else}
            <div class="left-panel__empty">Palette is disabled</div>
        {/if}
    {:else if activeTab === 'variable'}
        <CustomVariables />
    {:else if activeTab === 'timers'}
        <Timers />
    {:else if activeTab === 'products'}
        <Products />
    {:else if activeTab === 'tanker'}
        <TankerPanel />
    {:else if activeTab === 'localization'}
        <LocalizationEditor />
    {/if}

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
        class="left-panel__resize"
        class:left-panel__resize_active={dragging}
        on:mousedown={onMouseDown}
        role="separator"
        aria-orientation="vertical"
    ></div>

</div>

{#if activeTab === 'components' && addPanelOpen && !$readOnly}
    <div
        class="left-panel__flyout"
        style="left: {flyoutLeft}px; top: {flyoutTop}px; height: {flyoutHeight}px"
    >
        <div class="left-panel__flyout-header">
            <span class="left-panel__flyout-title">Add component</span>
            <button
                type="button"
                class="left-panel__flyout-close"
                title="Close"
                on:click={() => addPanelOpen = false}
            >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                </svg>
            </button>
        </div>
        <div class="left-panel__flyout-body">
            <NewComponent />
        </div>
    </div>
{/if}

<style>
    .left-panel {
        position: relative;
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        min-width: 200px;
        height: 100%;
        overflow: hidden;
        border-right: 1px solid var(--fill-transparent-2);
        background-color: var(--background-primary);
    }

    .left-panel__empty {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1;
        font-size: 13px;
        color: var(--text-secondary);
    }

    .left-panel__resize {
        position: absolute;
        top: 0;
        right: -3px;
        width: 6px;
        height: 100%;
        cursor: col-resize;
        z-index: 10;
    }

    .left-panel__resize::after {
        content: '';
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 2px;
        height: 100%;
        background: transparent;
        transition: background 0.15s;
    }

    .left-panel__resize:hover::after,
    .left-panel__resize_active::after {
        background: var(--accent-purple);
    }

    .left-panel__flyout {
        position: fixed;
        width: 320px;
        z-index: 50;
        display: flex;
        flex-direction: column;
        background: var(--background-primary);
        border-right: 1px solid var(--fill-transparent-2);
        box-shadow: 4px 0 16px rgba(0, 0, 0, 0.12);
        overflow: hidden;
    }

    .left-panel__flyout-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 16px 20px 12px;
        border-bottom: 1px solid var(--fill-transparent-2);
        flex-shrink: 0;
    }

    .left-panel__flyout-title {
        font-weight: 500;
        font-size: 14px;
        line-height: 20px;
        color: var(--text-primary);
    }

    .left-panel__flyout-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--text-secondary);
        border-radius: 4px;
        cursor: pointer;
        transition: background-color .15s, color .15s;
    }

    .left-panel__flyout-close:hover {
        background: var(--fill-transparent-1);
        color: var(--text-primary);
    }

    .left-panel__flyout-body {
        flex: 1;
        overflow-y: auto;
        padding-top: 8px;
    }
</style>
