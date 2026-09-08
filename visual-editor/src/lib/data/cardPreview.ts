import { render, createVariable, createGlobalVariablesController } from '@divkitframework/divkit/client-devtool';
import type { CustomComponentDescription } from '@divkitframework/divkit/typings/custom';
import type { Direction, DivJson, DivVariable } from '@divkitframework/divkit/typings/common';
import { collectCustomComponents } from './customComponents';
import { createDivExtensions } from './divExtensions';

/**
 * Read-only render of a card, for showing a layout as a picture rather than a filename.
 *
 * This is the editor's preview minus the editor: no selection overlays, no leaf tree, no error
 * store — just the same DivKit render with the same extensions and custom components, so a
 * thumbnail cannot show something the editor would not. The caller sizes the node and scales it
 * down; nothing here knows about thumbnails.
 */

export interface CardPreviewOptions {
    node: HTMLElement;
    /** Wrapper (`{ screen_id, remote_layout, variables }`) or a bare DivKit card. */
    value: string;
    theme?: 'light' | 'dark';
    /** Value for the `language_code` variable the SDK injects on device. */
    languageCode?: string;
    direction?: Direction;
    onError?(error: Error): void;
}

export interface CardPreviewInstance {
    destroy(): void;
}

/**
 * Products carry no price until billing answers, and the editor's Products panel starts them at
 * "0" — a preview does the same so `@{annual_plan}` renders a number instead of failing.
 */
const PRICE_PLACEHOLDER = '0';

interface Wrapper {
    remote_layout?: unknown;
    variables?: { id?: string }[];
}

let nextId = 0;

export function renderCardPreview(opts: CardPreviewOptions): CardPreviewInstance {
    const parsed = JSON.parse(opts.value) as Wrapper;
    const json = (parsed?.remote_layout ?? parsed) as DivJson;

    if (!json?.card?.states?.[0]?.div) {
        throw new Error('Incorrect format');
    }

    const globalVariablesController = createGlobalVariablesController();
    globalVariablesController.setVariable(createVariable('theme', 'string', opts.theme || 'light'));
    globalVariablesController.setVariable(
        createVariable('language_code', 'string', opts.languageCode || 'en')
    );
    // Declared by the host app on device, so a card reading it must not fall over here.
    globalVariablesController.setVariable(createVariable('local_palette', 'dict', localPalette(json)));

    // Wrapper-level `variables` are the product list: they never reach card.variables, so
    // without them every price expression on the card is an undefined variable.
    if (Array.isArray(parsed?.variables)) {
        for (const variable of parsed.variables) {
            if (variable?.id) {
                globalVariablesController.setVariable(
                    createVariable(variable.id, 'string', PRICE_PLACEHOLDER)
                );
            }
        }
    }

    const customComponents = new Map<string, CustomComponentDescription>();
    collectCustomComponents(json, customComponents);

    const instance = render({
        id: `card-preview-${++nextId}`,
        target: opts.node,
        json,
        globalVariablesController,
        platform: 'desktop',
        extensions: createDivExtensions(),
        customComponents,
        direction: opts.direction || 'ltr',
        onError(event) {
            opts.onError?.(event.error);
        }
    });

    return {
        destroy() {
            instance.$destroy();
        }
    };
}

function localPalette(json: DivJson): object {
    const variable = json.card?.variables?.find(
        (it: DivVariable) => it.type === 'dict' && it.name === 'local_palette'
    );
    return variable && 'value' in variable && variable.value && typeof variable.value === 'object' ?
        variable.value :
        {};
}
