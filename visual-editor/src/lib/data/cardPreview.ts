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
 * Kind of json a `.json` in the bucket turns out to be.
 *
 * Extension and filename say nothing: a Lottie animation and a DivKit card are both `.json`, and
 * both live next to each other in a project folder. Only the content settles it, and the caller
 * needs to know before it decides how to render — and what shape to give it.
 */
export type JsonKind = 'divkit' | 'lottie' | 'unknown';

export function detectJsonKind(value: string): JsonKind {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return 'unknown';
    }
    if (!parsed || typeof parsed !== 'object') {
        return 'unknown';
    }

    const obj = parsed as Record<string, unknown>;
    // Same condition renderCardPreview and State.setDivJson insist on, kept here so the two
    // cannot disagree about what counts as a card.
    const card = ((obj.remote_layout ?? obj) as { card?: { states?: unknown[] } })?.card;
    if (Array.isArray(card?.states) && card.states.length) {
        return 'divkit';
    }
    // Lottie's header: a frame rate and a layer list. `layers` alone is not enough — it sits
    // after `assets`, which in a card exported with embedded images is most of the file.
    if (typeof obj.fr === 'number' && Array.isArray(obj.layers)) {
        return 'lottie';
    }
    return 'unknown';
}

export interface LottiePreviewOptions {
    node: HTMLElement;
    /** Lottie animation json. */
    value: string;
    loop?: boolean;
}

export interface LottiePreviewInstance {
    destroy(): void;
}

/**
 * Plays a Lottie animation into `node`.
 *
 * lottie-web is loaded on demand — it is a 165 KB chunk that most sessions never touch, and it is
 * already here for the `lottie` div extension, so previews cost no extra dependency.
 */
export async function renderLottiePreview(
    opts: LottiePreviewOptions
): Promise<LottiePreviewInstance> {
    const { loadAnimation } = await import('./lottieApi');
    // The same node may have held a card before (a tile is reused across files), and
    // prepareTarget leaves flex behind on it — lottie wants a plain box to size its svg in.
    opts.node.style.removeProperty('display');
    opts.node.style.removeProperty('align-items');
    const animation = loadAnimation({
        container: opts.node,
        animationData: JSON.parse(opts.value),
        renderer: 'svg',
        loop: opts.loop ?? true,
        autoplay: true
    });

    return {
        destroy() {
            animation.destroy();
        }
    };
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

    muteVideos(json);
    prepareTarget(opts.node);

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

    const silence = keepSilent(opts.node);

    return {
        destroy() {
            silence();
            instance.$destroy();
        }
    };
}

/**
 * A card's root resolves `height: match_parent` by stretching as a flex item, so the target has
 * to be a flex container — this is what the editor's own preview does from CSS
 * (`.renderer__content-inner`), and it is not optional.
 *
 * A plain block target leaves the root at content height, and every `match_parent` inside it
 * collapses with it: the card renders as a strip of `wrap_content` items at the top with white
 * space below, which reads as a broken layout rather than a wrong container. The matching
 * `width: 100%` on the root goes with it — stretch only settles the cross axis.
 */
function prepareTarget(node: HTMLElement): void {
    node.style.display = 'flex';
    node.style.alignItems = 'stretch';
}

/**
 * Forces every video div silent.
 *
 * A preview is something you look at, often several at once, so it must never make noise —
 * `muted` is not the card author's decision here. The web runtime reads `json.muted`, and a
 * template may bind that prop to a parameter, so the binding goes too or it would win.
 */
function muteVideos(node: unknown): void {
    if (Array.isArray(node)) {
        node.forEach(muteVideos);
        return;
    }
    if (!node || typeof node !== 'object') {
        return;
    }

    const obj = node as Record<string, unknown>;
    if (obj.type === 'video') {
        delete obj.$muted;
        obj.muted = true;
    }
    for (const key in obj) {
        muteVideos(obj[key]);
    }
}

/**
 * Belt to the `muteVideos` braces: mutes media elements as they appear.
 *
 * Whatever the json says, a `<video>` that reaches the DOM unmuted is audible — and elements
 * arrive late (a source resolving, a state swapping, a custom div building its own player), long
 * after the render call returns. Returns the teardown.
 */
function keepSilent(node: HTMLElement): () => void {
    const mute = (root: ParentNode) => {
        root.querySelectorAll('video, audio').forEach(element => {
            (element as HTMLMediaElement).muted = true;
        });
    };

    mute(node);
    const observer = new MutationObserver(records => {
        for (const record of records) {
            record.addedNodes.forEach(added => {
                if (added instanceof HTMLMediaElement) {
                    added.muted = true;
                } else if (added instanceof Element) {
                    mute(added);
                }
            });
        }
    });
    observer.observe(node, { childList: true, subtree: true });

    return () => observer.disconnect();
}

function localPalette(json: DivJson): object {
    const variable = json.card?.variables?.find(
        (it: DivVariable) => it.type === 'dict' && it.name === 'local_palette'
    );
    return variable && 'value' in variable && variable.value && typeof variable.value === 'object' ?
        variable.value :
        {};
}
