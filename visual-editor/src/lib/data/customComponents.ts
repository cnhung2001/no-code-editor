import type { CustomComponentDescription } from '@divkitframework/divkit/typings/custom';
import { defineLuckyWheelElement } from './ik/luckyWheelElement';
import { CUSTOM_TYPE as LUCKY_WHEEL } from './ik/luckyWheel';
import {
    BOTTOM_SHEET_SCROLL,
    NESTED_SCROLL_VIEW,
    defineBottomSheetElement,
    defineNestedScrollElement
} from './ik/scrollElements';

/**
 * Custom divs are implemented natively by the host app, so DivKit web has nothing to render for
 * them on its own: without a registration it only logs
 * `Unknown or incorrect "custom_type" prop for div "custom"` and drops the subtree, hiding the
 * fallback `items` too.
 *
 * The `custom_type`s the paywall SDK supports are rebuilt here as custom elements (see `./ik/`),
 * so the preview shows what the device shows. Anything else — a type another app implements —
 * falls back to a stub that renders the div's own `items` and labels an empty one.
 */

const TAG_PREFIX = 'divkit-custom-';

/** `custom_type` → the tag registered for it, whether ported or stubbed. */
const tagByCustomType = new Map<string, string>();

const ikElements: Record<string, () => string> = {
    [LUCKY_WHEEL]: defineLuckyWheelElement,
    [NESTED_SCROLL_VIEW]: defineNestedScrollElement,
    [BOTTOM_SHEET_SCROLL]: defineBottomSheetElement
};

function escapeHtml(str: string): string {
    return str.replace(/[&<>"]/g, char => {
        switch (char) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            default: return '&quot;';
        }
    });
}

function makeTag(customType: string): string {
    const base = TAG_PREFIX + (customType.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'unnamed');
    let tag = base;
    let index = 2;
    // sanitizing may collide, e.g. `spin_wheel` and `spin.wheel`
    while (customElements.get(tag)) {
        tag = `${base}-${index++}`;
    }
    return tag;
}

function defineStubElement(tag: string, customType: string): void {
    const html = `<style>
        :host {
            display: block;
            box-sizing: border-box;
            width: 100%;
            height: 100%;
            outline: 1px dashed rgba(140, 124, 232, .7);
            outline-offset: -1px;
        }
        .stub {
            display: flex;
            box-sizing: border-box;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            min-height: 24px;
            padding: 4px;
            overflow: hidden;
            color: #8c7ce8;
            font: 11px/1.2 ui-monospace, monospace;
            text-align: center;
            word-break: break-all;
        }
    </style>
    <slot><div class="stub">${escapeHtml(customType)}</div></slot>`;

    customElements.define(tag, class extends HTMLElement {
        connectedCallback(): void {
            if (this.shadowRoot) {
                return;
            }
            this.attachShadow({ mode: 'open' }).innerHTML = html;
        }
    });
}

function register(customType: string, target: Map<string, CustomComponentDescription>): void {
    let tag = tagByCustomType.get(customType);
    if (!tag) {
        const ported = ikElements[customType];
        if (ported) {
            tag = ported();
        } else {
            tag = makeTag(customType);
            defineStubElement(tag, customType);
        }
        tagByCustomType.set(customType, tag);
    }
    target.set(customType, {
        element: tag
    });
}

/**
 * Walks the whole json (templates included) and makes sure every `custom_type` it mentions has an
 * element in `target`. `target` is mutated in place, because DivKit captures the map on the first
 * render and re-reads it on every update.
 */
export function collectCustomComponents(
    json: unknown,
    target: Map<string, CustomComponentDescription>
): void {
    if (Array.isArray(json)) {
        for (const item of json) {
            collectCustomComponents(item, target);
        }
        return;
    }

    if (!json || typeof json !== 'object') {
        return;
    }

    const obj = json as Record<string, unknown>;
    if (obj.type === 'custom' && typeof obj.custom_type === 'string' && obj.custom_type &&
        !obj.custom_type.includes('@{') && !target.has(obj.custom_type)
    ) {
        register(obj.custom_type, target);
    }

    for (const key in obj) {
        collectCustomComponents(obj[key], target);
    }
}
