<script lang="ts" context="module">
    const TYPED_TO_SCHEMA_MAP = {
        focus_element: 'div-action-focus-element',
        clear_focus: 'div-action-clear-focus',
        set_variable: 'div-action-set-variable',
        array_insert_value: 'div-action-array-insert-value',
        array_remove_value: 'div-action-array-remove-value',
        dict_set_value: 'div-action-dict-set-value',
        array_set_value: 'div-action-array-set-value',
        update_structure: 'div-action-update-structure',
        copy_to_clipboard: 'div-action-copy-to-clipboard',
        show_tooltip: 'div-action-show-tooltip',
        hide_tooltip: 'div-action-hide-tooltip',
        timer: 'div-action-timer',
        video: 'div-action-video',
        download: 'div-action-download',
        set_state: 'div-action-set-state',
        scroll_by: 'div-action-scroll-by',
        scroll_to: 'div-action-scroll-to',
        set_stored_value: 'div-action-set-stored-value',
        submit: 'div-action-submit'
    };

    type PresetParamKind = 'none' | 'text' | 'product' | 'screen';

    interface ActionPreset {
        value: string;
        text: string;
        log_id: string;
        baseUrl: string;
        paramKind: PresetParamKind;
        paramName?: string;
        paramLabel?: string;
        paramDefault?: string;
    }

    const ACTION_PRESETS: ActionPreset[] = [
        {
            value: 'close',
            text: 'Close',
            log_id: 'act__close',
            baseUrl: 'div-action://paywall/close',
            paramKind: 'none'
        },
        {
            value: 'restore',
            text: 'Restore',
            log_id: 'act__restore',
            baseUrl: 'div-action://paywall/restore',
            paramKind: 'none'
        },
        {
            value: 'purchase',
            text: 'Purchase',
            log_id: 'act__continue',
            baseUrl: 'div-action://paywall/purchase',
            paramKind: 'product',
            paramName: 'variable_id',
            paramLabel: 'Variable ID (product)'
        },
        {
            value: 'privacy',
            text: 'Open Privacy',
            log_id: 'act__open_privacy',
            baseUrl: 'div-action://paywall/open_privacy',
            paramKind: 'text',
            paramName: 'privacy_url',
            paramLabel: 'Privacy URL',
            paramDefault: 'https://begamob.com/bega-policy.html'
        },
        {
            value: 'terms',
            text: 'Open Terms',
            log_id: 'act__open_terms',
            baseUrl: 'div-action://paywall/open_terms',
            paramKind: 'text',
            paramName: 'term_url',
            paramLabel: 'Terms URL',
            paramDefault: 'https://begamob.com/ofs-termofuse.html'
        },
        {
            value: 'navigate',
            text: 'Navigate',
            log_id: 'act__navigate',
            baseUrl: 'div-action://ik-nav/navigate',
            paramKind: 'screen',
            paramName: 'screen_id',
            paramLabel: 'Screen'
        }
    ];

    function findPreset(value: string): ActionPreset | undefined {
        return ACTION_PRESETS.find(p => p.value === value);
    }

    function detectPreset(url: string | undefined): string {
        if (!url) {
            return '';
        }
        const urlBase = url.split('?')[0];
        const preset = ACTION_PRESETS.find(p => p.baseUrl === urlBase);
        return preset ? preset.value : '';
    }

    function parsePresetParam(url: string | undefined, preset: ActionPreset): string {
        if (!url || !preset.paramName) {
            return '';
        }
        const queryStr = url.split('?')[1] || '';
        const params = new URLSearchParams(queryStr);
        return params.get(preset.paramName) || '';
    }

    function buildPresetUrl(preset: ActionPreset, paramValue: string): string {
        if (preset.paramKind === 'none' || !preset.paramName) {
            return preset.baseUrl;
        }
        return `${preset.baseUrl}?${preset.paramName}=${paramValue}`;
    }
</script>

<script lang="ts">
    import { getContext } from 'svelte';
    import type { Action, TypedAction } from '@divkitframework/divkit/typings/common';
    import { LANGUAGE_CTX, type LanguageContext } from '../../ctx/languageContext';
    import Select from '../Select.svelte';
    import Text from '../controls/Text.svelte';
    import ContextDialog from './ContextDialog.svelte';
    import { parseAction, type ArgResult } from '../../data/actions';
    import { APP_CTX, type Actions2DialogShowProps, type AppContext } from '../../ctx/appContext';
    import type { ActionDesc } from '../../../lib';
    import { parseControls, type Control } from '../../data/schemaTypedActions';
    import ControlsList from './actions-controls/ControlsList.svelte';

    const { l10n, lang } = getContext<LanguageContext>(LANGUAGE_CTX);
    const { state } = getContext<AppContext>(APP_CTX);
    const { customActions, valueFilters, products, customVariables, navScreens } = state;

    $: if (isShown && !readOnly && callback) {
        if (!value.log_url) {
            delete value.log_url;
        }
        callback(value);
    }

    $: if (subtype.startsWith('typed:')) {
        const typedType = subtype.split(':')[1];
        if (typedType in TYPED_TO_SCHEMA_MAP) {
            typedControls = parseControls(TYPED_TO_SCHEMA_MAP[typedType as keyof typeof TYPED_TO_SCHEMA_MAP]);
        } else {
            typedControls = [];
        }
    } else {
        typedControls = null;
    }

    export function show(props: Actions2DialogShowProps): void {
        callback = props.callback;
        target = props.target;
        value = props.value;
        readOnly = props.readOnly;
        isShown = true;
        const parsed = parseAction(props.value, $customActions);
        subtype = parsed.type;
        customDesc = parsed.desc;
        actionArgs = parsed.args || [];
        selectedPreset = subtype === 'url' ? detectPreset(props.value.url) : '';
        const preset = selectedPreset ? findPreset(selectedPreset) : undefined;
        presetParamValue = preset ? parsePresetParam(props.value.url, preset) : '';
    }

    export function hide(): void {
        isShown = false;
    }

    let target: HTMLElement;
    let subtype = 'url';
    let actionArgs: ArgResult[] = [];
    let isShown = false;
    let value: Action;
    let callback: ((val: Action) => void) | undefined;
    let readOnly: boolean | undefined;
    let customDesc: ActionDesc | undefined;
    let typedControls: Control[] | null = null;
    let selectedPreset = '';
    let presetParamValue = '';

    // `navigate` is only meaningful when the host supplied a list of screens
    // (the onboarding flow editor); hide it everywhere else (e.g. paywalls).
    $: presetItems = [
        { value: '', text: 'Custom' },
        ...ACTION_PRESETS
            .filter(p => p.value !== 'navigate' || $navScreens.length > 0)
            .map(p => ({ value: p.value, text: p.text }))
    ];

    $: currentPreset = selectedPreset ? findPreset(selectedPreset) : undefined;

    function onPresetChange(): void {
        if (!selectedPreset) {
            return;
        }
        const preset = findPreset(selectedPreset);
        if (!preset) {
            return;
        }
        value.log_id = preset.log_id;
        if (preset.paramKind === 'none') {
            presetParamValue = '';
        } else if (preset.paramKind === 'product') {
            if (!presetParamValue && $products.length > 0) {
                presetParamValue = $products[0].id;
            }
        } else if (preset.paramKind === 'screen') {
            if (!presetParamValue && $navScreens.length > 0) {
                presetParamValue = $navScreens[0].id;
            }
        } else if (preset.paramKind === 'text') {
            if (!presetParamValue) {
                presetParamValue = preset.paramDefault || '';
            }
        }
        value.url = buildPresetUrl(preset, presetParamValue);
        value = value;
    }

    function onPresetParamChange(): void {
        const preset = currentPreset;
        if (!preset) {
            return;
        }
        value.url = buildPresetUrl(preset, presetParamValue);
        value = value;
    }

    function onClose(): void {
        isShown = false;
    }

    function customActionToUrl(desc: ActionDesc, args: ArgResult[]): string {
        const searchParams = new URLSearchParams();
        for (const arg of args) {
            const value = arg.value;
            if (value) {
                searchParams.set(arg.desc.name, value);
            }
        }
        return desc.baseUrl + (searchParams.size ? '?' + searchParams.toString() : '');
    }

    function onSubtypeChange(): void {
        selectedPreset = '';
        presetParamValue = '';
        customDesc = subtype.startsWith('custom:') ? $customActions[Number(subtype.split(':')[1])] : undefined;
        if (customDesc || !subtype.startsWith('typed:')) {
            for (const key in value) {
                if (key !== 'url' && key !== 'log_id' && key !== 'log_url') {
                    delete value[key as keyof typeof value];
                }
            }
        }

        if (customDesc) {
            value.url = customActionToUrl(customDesc, []);
            actionArgs = customDesc.args?.map(desc => {
                return {
                    value: '',
                    desc
                };
            }) || [];
        } else if (subtype.startsWith('typed:')) {
            value.typed = {
                type: subtype.split(':')[1]
            } as TypedAction;
        } else {
            actionArgs = [];
        }
    }

    function onArgChange(): void {
        if (!customDesc) {
            return;
        }

        value.url = customActionToUrl(customDesc, actionArgs);
    }

    $: types = [{
        value: 'url',
        text: $l10n('actions-url')
    }, {
        value: 'typed:set_variable',
        text: $l10n('actions.set_variable')
    }, {
        value: 'typed:focus_element',
        text: $l10n('actions.focus_element')
    }, {
        value: 'typed:clear_focus',
        text: $l10n('actions.clear_focus')
    }, {
        value: 'typed:array_insert_value',
        text: $l10n('actions.array_insert_value')
    }, {
        value: 'typed:array_remove_value',
        text: $l10n('actions.array_remove_value')
    }, {
        value: 'typed:array_set_value',
        text: $l10n('actions.array_set_value')
    }, {
        value: 'typed:dict_set_value',
        text: $l10n('actions.dict_set_value')
    }, {
        value: 'typed:update_structure',
        text: $l10n('actions.update_structure')
    }, {
        value: 'typed:copy_to_clipboard',
        text: $l10n('actions.copy_to_clipboard')
    }, {
        value: 'typed:show_tooltip',
        text: $l10n('actions.show_tooltip')
    }, {
        value: 'typed:hide_tooltip',
        text: $l10n('actions.hide_tooltip')
    }, {
        value: 'typed:timer',
        text: $l10n('actions.timer')
    }, {
        value: 'typed:video',
        text: $l10n('actions.video')
    }, {
        value: 'typed:download',
        text: $l10n('actions.download')
    }, {
        value: 'typed:set_state',
        text: $l10n('actions.set_state')
    }, {
        value: 'typed:scroll_by',
        text: $l10n('actions.scroll_by')
    }, {
        value: 'typed:scroll_to',
        text: $l10n('actions.scroll_to')
    }, {
        value: 'typed:set_stored_value',
        text: $l10n('actions.set_stored_value')
    }, {
        value: 'typed:submit',
        text: $l10n('actions.submit')
    }].concat($customActions.map((actionDesc, i) => {
        return {
            value: `custom:${i}`,
            text: actionDesc.text[$lang] || actionDesc.baseUrl
        };
    }));
</script>

{#if isShown && target}
    <ContextDialog
        {target}
        canMove={true}
        overflow="visible"
        on:close={onClose}
    >
        <div class="actions2-dialog__content">
            <Select
                items={types}
                bind:value={subtype}
                theme="normal"
                size="medium"
                disabled={readOnly}
                on:change={onSubtypeChange}
            />

            {#if subtype === 'url'}
                <div>
                    <label>
                        <div class="actions2-dialog__label">
                            Preset
                        </div>
                        <Select
                            items={presetItems}
                            bind:value={selectedPreset}
                            theme="normal"
                            size="medium"
                            disabled={readOnly}
                            on:change={onPresetChange}
                        />
                    </label>
                </div>
                {#if currentPreset?.paramKind === 'text'}
                    <div>
                        <label>
                            <div class="actions2-dialog__label">
                                {currentPreset.paramLabel}
                            </div>
                            <Text
                                bind:value={presetParamValue}
                                disabled={readOnly}
                                on:change={onPresetParamChange}
                            />
                        </label>
                    </div>
                {:else if currentPreset?.paramKind === 'product'}
                    <div>
                        <label>
                            <div class="actions2-dialog__label">
                                {currentPreset.paramLabel}
                            </div>
                            <input
                                type="text"
                                class="actions2-dialog__combobox"
                                list="actions2-dialog-product-options"
                                bind:value={presetParamValue}
                                disabled={readOnly}
                                on:input={onPresetParamChange}
                                on:change={onPresetParamChange}
                                autocomplete="off"
                                spellcheck="false"
                                placeholder="Type or pick a product / variable"
                            />
                            <datalist id="actions2-dialog-product-options">
                                {#each $products as product (product.__id)}
                                    <option value={product.id}>Product</option>
                                {/each}
                                {#each $customVariables as variable (variable.id)}
                                    <option value={`@{${variable.name}}`}>Variable</option>
                                {/each}
                            </datalist>
                        </label>
                    </div>
                {:else if currentPreset?.paramKind === 'screen'}
                    <div>
                        <label>
                            <div class="actions2-dialog__label">
                                {currentPreset.paramLabel}
                            </div>
                            <Select
                                items={$navScreens.map(s => ({ value: s.id, text: s.label }))}
                                bind:value={presetParamValue}
                                theme="normal"
                                size="medium"
                                disabled={readOnly}
                                on:change={onPresetParamChange}
                            />
                        </label>
                    </div>
                {:else if !currentPreset}
                    <div>
                        <label>
                            <div class="actions2-dialog__label">
                                {$l10n('actions-url')}
                            </div>
                            <Text
                                bind:value={value.url}
                                disabled={readOnly}
                                filter={valueFilters?.actionUrl}
                            />
                        </label>
                    </div>
                {/if}
            {:else if typedControls?.length && value.typed}
                <ControlsList
                    {readOnly}
                    bind:value={value.typed}
                    controls={typedControls}
                />
            {:else if actionArgs.length}
                {#each actionArgs as arg}
                    <div>
                        <label>
                            <div class="actions2-dialog__label">
                                {arg.desc.text[$lang] || arg.desc.name}
                            </div>
                            <Text
                                bind:value={arg.value}
                                disabled={readOnly}
                                on:change={onArgChange}
                            />
                        </label>
                    </div>
                {/each}
            {/if}

            <div>
                <label>
                    <div class="actions2-dialog__label">
                        {$l10n('actions-log-id')}
                    </div>
                    <Text
                        bind:value={value.log_id}
                        disabled={readOnly}
                    />
                </label>
            </div>
        </div>
    </ContextDialog>
{/if}

<style>
    .actions2-dialog__content {
        display: flex;
        flex-direction: column;
        gap: 24px;
        margin: 16px;
    }

    .actions2-dialog__label {
        margin-bottom: 6px;
        font-size: 14px;
        line-height: 20px;
        color: var(--text-secondary);
    }

    .actions2-dialog__combobox {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        margin: 0;
        padding: 9px 14px;
        font: inherit;
        font-size: 14px;
        line-height: 20px;
        color: inherit;
        border: 1px solid var(--fill-transparent-3);
        border-radius: 8px;
        background: var(--fill-transparent-minus-1);
        appearance: none;
        transition: border-color .15s ease-in-out;
    }

    .actions2-dialog__combobox:hover {
        border-color: var(--fill-transparent-4);
    }

    .actions2-dialog__combobox:focus-visible {
        outline: none;
        border-color: var(--accent-purple);
    }

    .actions2-dialog__combobox:disabled {
        border: none;
        background: var(--fill-transparent-1);
    }
</style>
