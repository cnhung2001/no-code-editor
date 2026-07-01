<script lang="ts">
    import { createEventDispatcher, getContext } from 'svelte';
    import type { ComponentProperty } from '../../data/componentProps';
    import { APP_CTX, type AppContext } from '../../ctx/appContext';
    import Select from '../Select.svelte';
    import type { ItemStates } from '../../utils/items';
    import { LANGUAGE_CTX, type LanguageContext } from '../../ctx/languageContext';

    export let value: string;
    export let item: ComponentProperty;
    export let processedJson: unknown | undefined;

    const { state } = getContext<AppContext>(APP_CTX);
    const { l10nString } = getContext<LanguageContext>(LANGUAGE_CTX);
    const { readOnly } = state;

    const dispatch = createEventDispatcher();

    function onChange(): void {
        if (!$readOnly) {
            dispatch('change', {
                item,
                value
            });
        }
    }

    $: items = [{
        text: $l10nString('emptyValue'),
        value: '',
        isEmpty: true
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }, ...(processedJson as any)?.states.map((it: ItemStates) => {
        return {
            text: it.state_id,
            value: it.state_id
        };
    })];
</script>

<Select
    mix="state-default-id-prop"
    disabled={$readOnly}
    bind:value={value}
    on:change={onChange}
    theme="normal"
    size="medium"
    items={items}
/>
