import type { DivExtension, DivExtensionContext } from '@divkitframework/divkit/typings/common';
import { objectProps } from './props';

/**
 * The `marquee_anim` div extension — seamless infinite horizontal ticker.
 *
 * ```json
 * "extensions": [
 *   { "id": "marquee_anim", "params": {
 *       "direction": "left",
 *       "speed_dp_per_sec": 30,
 *       "spacing_dp": 32,
 *       "delay_ms": 0,
 *       "loop": true
 *   } }
 * ]
 * ```
 *
 * Like `Modifier.basicMarquee` — and like the Android handler — it only scrolls when the content
 * actually overflows its container, and it keeps a twin of the content one `scrollDistance` ahead
 * so the gap a plain restart would leave never appears. Android draws that twin live into the
 * parent's `ViewOverlay`; here it is a clone parked in an overlay layer, refreshed whenever DivKit
 * rebinds the div.
 */
export class MarqueeAnim implements DivExtension {
    private direction: string;
    private speedDpPerSec: number;
    private spacingDp: number;
    private delayMs: number;
    private loop: boolean;

    private node: HTMLElement | undefined;
    private parent: HTMLElement | undefined;
    private overlay: HTMLElement | undefined;
    private twin: HTMLElement | undefined;
    private animations: Animation[] = [];
    private observer: ResizeObserver | undefined;
    private parentOverflow: string | undefined;
    private parentPosition: string | undefined;

    constructor(params: object) {
        const props = objectProps(params);
        this.direction = props.string('direction') || 'left';
        this.speedDpPerSec = Math.max(Math.trunc(props.number('speed_dp_per_sec') ?? DEFAULT_SPEED_DP), 1);
        this.spacingDp = Math.max(Math.trunc(props.number('spacing_dp') ?? DEFAULT_SPACING_DP), 0);
        this.delayMs = Math.max(props.number('delay_ms') ?? 0, 0);
        this.loop = props.bool('loop') ?? true;
    }

    mountView(node: HTMLElement, _context: DivExtensionContext): void {
        this.node = node;
        // Width is only known once laid out, and it decides whether the ticker runs at all.
        this.observer = new ResizeObserver(() => this.start());
        this.observer.observe(node);
        if (node.parentElement) {
            this.observer.observe(node.parentElement);
        }
        this.start();
    }

    /** Keeps the twin showing what the div now shows, without disturbing the running animation. */
    updateView(node: HTMLElement): void {
        if (this.twin) {
            this.twin.innerHTML = node.innerHTML;
        }
    }

    unmountView(node: HTMLElement): void {
        this.observer?.disconnect();
        this.observer = undefined;
        this.stop();
        node.style.removeProperty('translate');
        this.node = undefined;
    }

    private stop(): void {
        this.animations.forEach(animation => animation.cancel());
        this.animations = [];
        this.overlay?.remove();
        this.overlay = undefined;
        this.twin = undefined;

        const parent = this.parent;
        if (parent) {
            if (this.parentOverflow !== undefined) {
                parent.style.overflow = this.parentOverflow;
            }
            if (this.parentPosition !== undefined) {
                parent.style.position = this.parentPosition;
            }
        }
        this.parent = undefined;
        this.parentOverflow = undefined;
        this.parentPosition = undefined;
    }

    private start(): void {
        const node = this.node;
        const parent = node?.parentElement;
        if (!node || !parent) {
            return;
        }

        const contentWidth = node.offsetWidth;
        const containerWidth = parent.clientWidth;
        if (contentWidth <= 0 || contentWidth <= containerWidth) {
            // Nothing to scroll — and a div that fits must not be left translated by a previous
            // pass over a narrower container.
            if (this.animations.length) {
                this.stop();
                node.style.removeProperty('translate');
            }
            return;
        }
        // Already running: a rebind after a click action must not restart the ticker.
        if (this.animations.length) {
            return;
        }

        this.parent = parent;
        this.parentOverflow = parent.style.overflow;
        this.parentPosition = parent.style.position;
        parent.style.overflow = 'hidden';
        if (getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }

        const scrollDistance = contentWidth + this.spacingDp;
        const fromX = this.direction === 'right' ? -scrollDistance : 0;
        const toX = this.direction === 'right' ? 0 : -scrollDistance;
        const duration = Math.max(scrollDistance / this.speedDpPerSec * 1000, 1);

        this.buildOverlay(node, parent, contentWidth);
        this.animations = [
            this.animate(node, fromX, toX, duration),
            this.twin ? this.animate(this.twin, fromX + scrollDistance, toX + scrollDistance, duration) : null
        ].filter(Boolean) as Animation[];
    }

    private animate(target: HTMLElement, fromX: number, toX: number, duration: number): Animation {
        return target.animate(
            [{ translate: `${fromX}px` }, { translate: `${toX}px` }],
            {
                duration,
                delay: this.delayMs,
                easing: 'linear',
                iterations: this.loop ? Infinity : 1,
                fill: 'both'
            }
        );
    }

    /**
     * The twin, plus the gradient edge fades that give `basicMarquee` its visual signature. The
     * fades only appear over a solid parent background — over anything else they would paint a
     * wrong-coloured band, which is why Android skips them too.
     */
    private buildOverlay(node: HTMLElement, parent: HTMLElement, contentWidth: number): void {
        const overlay = document.createElement('div');
        overlay.dataset.ikMarquee = 'overlay';
        overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';

        const twin = node.cloneNode(true) as HTMLElement;
        // A clone brings duplicate ids along, and the editor resolves nothing by id — but a
        // duplicate id in the document is a trap for anything that does.
        twin.removeAttribute('id');
        twin.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
        twin.style.position = 'absolute';
        twin.style.left = `${node.offsetLeft}px`;
        twin.style.top = `${node.offsetTop}px`;
        twin.style.width = `${contentWidth}px`;
        twin.style.margin = '0';
        overlay.appendChild(twin);

        const background = getComputedStyle(parent).backgroundColor;
        if (background && background !== 'transparent' && !background.endsWith(', 0)')) {
            const fadeWidth = Math.min(parent.clientWidth * FADE_FRACTION, FADE_MAX_DP);
            overlay.appendChild(fade(background, fadeWidth, 'left'));
            overlay.appendChild(fade(background, fadeWidth, 'right'));
        }

        parent.appendChild(overlay);
        this.overlay = overlay;
        this.twin = twin;
    }
}

function fade(color: string, width: number, side: 'left' | 'right'): HTMLElement {
    const element = document.createElement('div');
    const direction = side === 'left' ? 'right' : 'left';
    element.style.cssText = `position:absolute;top:0;bottom:0;${side}:0;width:${width}px;` +
        `background:linear-gradient(to ${direction}, ${color}, transparent);`;
    return element;
}

const DEFAULT_SPEED_DP = 30;
const DEFAULT_SPACING_DP = 32;
const FADE_FRACTION = 0.08;
const FADE_MAX_DP = 16;
