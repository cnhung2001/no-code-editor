<script lang="ts">
    import { getContext } from 'svelte';
    import { slide } from 'svelte/transition';
    import { APP_CTX, type AppContext } from '../ctx/appContext';
    import { ChangeProductsCommand } from '../data/commands/changeProducts';
    import type { Product } from '../data/products';
    import PanelTitle from './PanelTitle.svelte';
    import AddButton from './controls/AddButton.svelte';

    const { state } = getContext<AppContext>(APP_CTX);
    const { products, readOnly, screenId, screenLabel, screenType, previewProductPrices } = state;

    function updatePreviewPrice(varId: string, value: string): void {
        previewProductPrices.update(prices => ({ ...prices, [varId]: value }));
    }

    const VARIABLE_TYPES = ['subscribe', 'consumable', 'lifetime'];
    const TYPES = ['string', 'integer', 'number', 'boolean'];

    function add(): void {
        const newList = $products.slice();
        newList.push({
            __id: state.genProductId(),
            id: '',
            product_id: '',
            variable_type: 'subscribe',
            type: 'string'
        });
        state.pushCommand(new ChangeProductsCommand(state, newList));
    }

    function remove(id: string): void {
        const newList = $products.filter(p => p.__id !== id);
        state.pushCommand(new ChangeProductsCommand(state, newList));
    }

    function update(id: string, field: keyof Product, value: string): void {
        const newList = $products.map(p =>
            p.__id === id ? { ...p, [field]: value || undefined } : p
        );
        state.pushCommand(new ChangeProductsCommand(state, newList));
    }

    function syncProductId(product: Product, newId: string): void {
        const newList = $products.map(p =>
            p.__id === product.__id
                ? { ...p, id: newId, product_id: p.product_id || newId }
                : p
        );
        state.pushCommand(new ChangeProductsCommand(state, newList));
    }
</script>

<div class="products">
    <PanelTitle title="Products" />

    <div class="products__meta">
        <label class="products__field">
            <span class="products__label">screen_id</span>
            <input
                class="products__input"
                type="text"
                bind:value={$screenId}
                disabled={$readOnly}
                placeholder="e.g. premium_intro"
            />
        </label>
        <label class="products__field">
            <span class="products__label">label</span>
            <input
                class="products__input"
                type="text"
                bind:value={$screenLabel}
                disabled={$readOnly}
                placeholder="e.g. iap4"
            />
        </label>
        <label class="products__field">
            <span class="products__label">screen_type</span>
            <input
                class="products__input"
                type="text"
                bind:value={$screenType}
                disabled={$readOnly}
                placeholder="e.g. paywall / onboarding"
            />
        </label>
    </div>

    <div class="products__section-title">IAP Variables</div>

    <div class="products__list">
        {#each $products as product (product.__id)}
            <div class="products__item" transition:slide={{ duration: 150 }}>
                <div class="products__item-header">
                    <span class="products__item-id">{product.id || 'New product'}</span>
                    {#if !$readOnly}
                        <button class="products__remove" on:click={() => remove(product.__id)} title="Remove">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                            </svg>
                        </button>
                    {/if}
                </div>

                <div class="products__fields">
                    <label class="products__field">
                        <span class="products__label">Variable ID</span>
                        <input
                            class="products__input"
                            type="text"
                            value={product.id}
                            disabled={$readOnly}
                            placeholder="e.g. subs_year_4999"
                            on:change={e => syncProductId(product, (e.target as HTMLInputElement).value)}
                        />
                    </label>

                    <label class="products__field">
                        <span class="products__label">Product ID</span>
                        <input
                            class="products__input"
                            type="text"
                            value={product.product_id}
                            disabled={$readOnly}
                            placeholder="e.g. com.app.subs.year"
                            on:change={e => update(product.__id, 'product_id', (e.target as HTMLInputElement).value)}
                        />
                    </label>

                    <div class="products__row">
                        <label class="products__field products__field_half">
                            <span class="products__label">Variable type</span>
                            <select
                                class="products__select"
                                value={product.variable_type}
                                disabled={$readOnly}
                                on:change={e => update(product.__id, 'variable_type', (e.target as HTMLSelectElement).value)}
                            >
                                {#each VARIABLE_TYPES as vt}
                                    <option value={vt}>{vt}</option>
                                {/each}
                            </select>
                        </label>

                        <label class="products__field products__field_half">
                            <span class="products__label">Type</span>
                            <select
                                class="products__select"
                                value={product.type || ''}
                                disabled={$readOnly}
                                on:change={e => update(product.__id, 'type', (e.target as HTMLSelectElement).value)}
                            >
                                <option value="">—</option>
                                {#each TYPES as t}
                                    <option value={t}>{t}</option>
                                {/each}
                            </select>
                        </label>
                    </div>

                    <label class="products__field">
                        <span class="products__label">Divisor <span class="products__hint">(optional, e.g. 365 for per-day price)</span></span>
                        <input
                            class="products__input"
                            type="text"
                            value={product.divisor || ''}
                            disabled={$readOnly}
                            placeholder="e.g. 365"
                            on:change={e => update(product.__id, 'divisor', (e.target as HTMLInputElement).value)}
                        />
                    </label>

                    <label class="products__field">
                        <span class="products__label">Multiplier <span class="products__hint">(optional, e.g. 12 for per-year price)</span></span>
                        <input
                            class="products__input"
                            type="text"
                            value={product.multiplier || ''}
                            disabled={$readOnly}
                            placeholder="e.g. 12"
                            on:change={e => update(product.__id, 'multiplier', (e.target as HTMLInputElement).value)}
                        />
                    </label>

                    <label class="products__field products__field_checkbox">
                        <input
                            type="checkbox"
                            checked={!!product.isIntroductoryOffer}
                            disabled={$readOnly}
                            on:change={e => {
                                const newList = $products.map(p =>
                                    p.__id === product.__id
                                        ? { ...p, isIntroductoryOffer: (e.target as HTMLInputElement).checked || undefined }
                                        : p
                                );
                                state.pushCommand(new ChangeProductsCommand(state, newList));
                            }}
                        />
                        <span class="products__label">isIntroductoryOffer</span>
                    </label>

                    <label class="products__field">
                        <span class="products__label products__label_preview">
                            Preview price
                            <span class="products__badge">editor only</span>
                        </span>
                        <input
                            class="products__input products__input_preview"
                            type="text"
                            value={$previewProductPrices[product.id] ?? '0'}
                            on:change={e => updatePreviewPrice(product.id, (e.target as HTMLInputElement).value)}
                        />
                    </label>
                </div>
            </div>
        {/each}


        {#if !$readOnly}
            <AddButton on:click={add}>Add product</AddButton>
        {/if}
    </div>
</div>

<style>
    .products {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }

    .products__meta {
        padding: 0 16px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        border-bottom: 1px solid var(--fill-transparent-2);
    }

    .products__section-title {
        padding: 10px 16px 6px;
        font-size: 11px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .products__list {
        padding: 0 16px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .products__item {
        background: var(--fill-transparent-05);
        border: 1px solid var(--fill-transparent-2);
        border-radius: 8px;
        overflow: hidden;
    }

    .products__item-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background: var(--fill-transparent-1);
        border-bottom: 1px solid var(--fill-transparent-2);
    }

    .products__item-id {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .products__remove {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border: none;
        background: none;
        cursor: pointer;
        color: var(--text-secondary);
        border-radius: 4px;
        padding: 0;
    }

    .products__remove:hover {
        background: var(--fill-red-1);
        color: var(--accent-red);
    }

    .products__fields {
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .products__row {
        display: flex;
        gap: 8px;
    }

    .products__field {
        display: flex;
        flex-direction: column;
        gap: 3px;
    }

    .products__field_half {
        flex: 1;
    }

    .products__field_checkbox {
        flex-direction: row;
        align-items: center;
        gap: 6px;
        cursor: pointer;
    }

    .products__label {
        font-size: 11px;
        color: var(--text-secondary);
        font-weight: 500;
    }

    .products__hint {
        font-weight: 400;
        color: var(--text-tertiary);
    }

    .products__label_preview {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--accent-purple);
    }

    .products__badge {
        font-size: 10px;
        font-weight: 500;
        padding: 1px 5px;
        border-radius: 4px;
        background: var(--fill-accent-2, rgba(123,97,255,0.12));
        color: var(--accent-purple);
        text-transform: uppercase;
        letter-spacing: 0.3px;
    }

    .products__input_preview {
        border-style: dashed;
        color: var(--accent-purple);
    }

    .products__input_preview::placeholder {
        color: var(--text-tertiary);
    }

    .products__input,
    .products__select {
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
    }

    .products__input:focus,
    .products__select:focus {
        border-color: var(--accent-purple);
    }

    .products__input:disabled,
    .products__select:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .products__list :global(.button2) {
        margin-top: 4px;
        width: 100%;
    }
</style>
