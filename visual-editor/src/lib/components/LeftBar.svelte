<script lang="ts">
    import type { LeftBarTab } from './leftBarTypes';

    export let activeTab: LeftBarTab = 'components';

    const tabs: { id: LeftBarTab; label: string; icon: string }[] = [
        {
            id: 'components',
            label: 'Components',
            icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20">
                <rect x="2" y="2" width="7" height="7" rx="1" fill="currentColor"/>
                <rect x="11" y="2" width="7" height="7" rx="1" fill="currentColor"/>
                <rect x="2" y="11" width="7" height="7" rx="1" fill="currentColor"/>
                <rect x="11" y="11" width="7" height="7" rx="1" fill="currentColor"/>
            </svg>`
        },
        {
            id: 'palette',
            label: 'Palette',
            icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20">
                <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M10 2a8 8 0 1 0 0 16c.92 0 1.5-.78 1.5-1.5 0-.39-.15-.74-.38-1-.22-.25-.37-.6-.37-.97 0-.83.67-1.5 1.5-1.5H14a4 4 0 0 0 0-8h-.5A7.97 7.97 0 0 0 10 2ZM4 10a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/>
            </svg>`
        },
        {
            id: 'variable',
            label: 'Variable',
            icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20">
                <path fill="currentColor" d="M3 5h2l3 5-3 5H3l3-5-3-5Zm11 0h2l-3 5 3 5h-2l-3-5 3-5Z"/>
            </svg>`
        },
        {
            id: 'timers',
            label: 'Timers',
            icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20">
                <circle cx="10" cy="11" r="7" stroke="currentColor" stroke-width="1.5"/>
                <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M10 8v4l2.5 2"/>
                <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M8 2h4"/>
                <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M16 4l1 1"/>
            </svg>`
        },
        {
            id: 'products',
            label: 'Products',
            icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20">
                <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M2 3a1 1 0 0 1 1-1h1.5a1 1 0 0 1 .97.75L6 4h11a1 1 0 0 1 .97 1.24l-1.5 6A1 1 0 0 1 15.5 12H7.5l.25 1H15a1.5 1.5 0 1 1 0 1.5H7.25a1 1 0 0 1-.97-.75L4 4H3a1 1 0 0 1-1-1Zm7 11a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/>
            </svg>`
        },
        {
            id: 'localization',
            label: 'Localization',
            icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20">
                <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M2.5 5h7M6 5V3M8.75 5c0 3.4-2.4 6.1-6.25 7.4M4.5 8.2c.85 1.85 2.3 3.2 4.1 3.9"/>
                <path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M10.5 17.5l3.25-8 3.25 8M11.8 14.8h3.9"/>
            </svg>`
        }
    ];

    function select(tab: LeftBarTab): void {
        activeTab = tab;
    }
</script>

<div class="left-bar">
    {#each tabs as tab}
        <button
            class="left-bar__btn"
            class:left-bar__btn_active={activeTab === tab.id}
            title={tab.label}
            on:click={() => select(tab.id)}
        >
            {@html tab.icon}
            <span class="left-bar__label">{tab.label}</span>
        </button>
    {/each}
</div>

<style>
    .left-bar {
        display: flex;
        flex-direction: column;
        width: 56px;
        flex-shrink: 0;
        background-color: var(--background-secondary);
        border-right: 1px solid var(--fill-transparent-2);
        padding: 4px 0;
        gap: 2px;
    }

    .left-bar__btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        width: 100%;
        padding: 8px 4px;
        border: none;
        background: none;
        cursor: pointer;
        color: var(--text-secondary);
        border-radius: 6px;
        margin: 0 4px;
        width: calc(100% - 8px);
        transition: background-color 0.1s, color 0.1s;
    }

    .left-bar__btn:hover {
        background-color: var(--fill-transparent-1);
        color: var(--text-primary);
    }

    .left-bar__btn_active {
        background-color: var(--fill-accent-1);
        color: var(--accent-purple);
    }

    .left-bar__btn_active :global(svg) {
        color: var(--accent-purple);
    }

    .left-bar__label {
        font-size: 9px;
        font-weight: 500;
        line-height: 1;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
    }
</style>
