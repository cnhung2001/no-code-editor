import type { DivExtension, DivExtensionContext } from '@divkitframework/divkit/typings/common';
import { objectProps } from './props';
import {
    ScratchCoverage,
    clampBrushDp,
    clampResolution,
    clampRevealDurationSeconds,
    clampThreshold,
    scratchCardSpec
} from './scratchCoverage';

/**
 * The `scratch_card` div extension — rub-to-reveal on top of whatever the layout put underneath.
 *
 * Attach it to the **cover**: the top item of an `overlap` container whose lower item is the
 * reward. Android punches the holes with a `DST_OUT` composite in the parent's `ViewOverlay`; the
 * web equivalent is a CSS mask generated from a canvas, so the cover stays the ordinary div the
 * layout authored and only its alpha is edited.
 *
 * ```json
 * "extensions": [
 *   { "id": "scratch_card", "params": {
 *       "variable": "scratch_revealed",
 *       "threshold": 0.6,
 *       "brush": 44,
 *       "reveal_duration": 0.35
 *   } }
 * ]
 * ```
 */
export class ScratchCard implements DivExtension {
    private variable: string | undefined;
    private threshold: number;
    private brush: number;
    private revealMillis: number;
    private keepCover: boolean;
    private coverage: ScratchCoverage;

    private node: HTMLElement | undefined;
    private context: DivExtensionContext | undefined;
    private canvas: HTMLCanvasElement | undefined;
    private resizeObserver: ResizeObserver | undefined;

    private lastX = 0;
    private lastY = 0;
    private scratching = false;
    private revealed = false;
    private maskFrame = 0;

    private onPointerDown = (event: PointerEvent) => this.pointerDown(event);
    private onPointerMove = (event: PointerEvent) => this.pointerMove(event);
    private onPointerUp = (event: PointerEvent) => this.pointerUp(event);

    constructor(params: object) {
        const props = objectProps(params);
        this.variable = props.string('variable');
        this.threshold = clampThreshold(props.number('threshold') ?? scratchCardSpec.defaultThreshold);
        this.brush = clampBrushDp(props.number('brush') ?? scratchCardSpec.defaultBrushDp);
        this.revealMillis = clampRevealDurationSeconds(
            props.number('reveal_duration') ?? scratchCardSpec.defaultRevealDurationSeconds
        ) * 1000;
        this.keepCover = props.bool('keep_cover') ?? false;
        this.coverage = new ScratchCoverage(
            clampResolution(props.number('resolution') ?? scratchCardSpec.defaultResolution)
        );
    }

    mountView(node: HTMLElement, context: DivExtensionContext): void {
        this.node = node;
        this.context = context;
        this.canvas = document.createElement('canvas');

        // The preview is inert by default (`.renderer__content-inner > *` is pointer-events:
        // none). A cover that cannot be rubbed hides the reward underneath it for good, so this
        // one div opts back in — see the pointer handlers for how the editor's own drag is left
        // alone.
        node.style.pointerEvents = 'auto';
        node.style.touchAction = 'none';
        node.addEventListener('pointerdown', this.onPointerDown);
        node.addEventListener('pointermove', this.onPointerMove);
        node.addEventListener('pointerup', this.onPointerUp);
        node.addEventListener('pointercancel', this.onPointerUp);

        this.resizeObserver = new ResizeObserver(() => this.syncBounds());
        this.resizeObserver.observe(node);
        this.syncBounds();
    }

    unmountView(node: HTMLElement): void {
        node.removeEventListener('pointerdown', this.onPointerDown);
        node.removeEventListener('pointermove', this.onPointerMove);
        node.removeEventListener('pointerup', this.onPointerUp);
        node.removeEventListener('pointercancel', this.onPointerUp);
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
        if (this.maskFrame) {
            cancelAnimationFrame(this.maskFrame);
            this.maskFrame = 0;
        }
        node.style.removeProperty('mask-image');
        node.style.removeProperty('-webkit-mask-image');
        node.style.removeProperty('touch-action');
        node.style.removeProperty('pointer-events');
        node.style.removeProperty('transition');
        node.style.removeProperty('opacity');
        this.node = undefined;
        this.canvas = undefined;
    }

    /**
     * Adopts the cover's size. Cells are relative to the card, so a size change invalidates the
     * grid and the cover comes back whole rather than pretending the old count still means
     * something.
     */
    private syncBounds(): void {
        const node = this.node;
        const canvas = this.canvas;
        if (!node || !canvas || this.revealed) {
            return;
        }
        const width = node.clientWidth;
        const height = node.clientHeight;
        if (width <= 0 || height <= 0) {
            return;
        }
        if (canvas.width === width && canvas.height === height) {
            return;
        }
        canvas.width = width;
        canvas.height = height;
        this.coverage.resize(width, height);
        this.paintCover();
        this.scheduleMask();
    }

    /** An opaque mask means a whole cover; the strokes below erase into it. */
    private paintCover(): void {
        const ctx = this.canvas?.getContext('2d');
        if (!ctx || !this.canvas) {
            return;
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    private erase(fromX: number, fromY: number, toX: number, toY: number): void {
        const ctx = this.canvas?.getContext('2d');
        if (!ctx) {
            return;
        }
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = this.brush;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000';
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();
    }

    private dab(x: number, y: number): void {
        const ctx = this.canvas?.getContext('2d');
        if (!ctx) {
            return;
        }
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(x, y, this.brush / 2, 0, Math.PI * 2);
        ctx.fill();
    }

    /** One mask upload per frame, however many pointer moves arrived in it. */
    private scheduleMask(): void {
        if (this.maskFrame) {
            return;
        }
        this.maskFrame = requestAnimationFrame(() => {
            this.maskFrame = 0;
            const node = this.node;
            const canvas = this.canvas;
            if (!node || !canvas) {
                return;
            }
            const mask = `url(${canvas.toDataURL()})`;
            node.style.setProperty('mask-image', mask);
            node.style.setProperty('-webkit-mask-image', mask);
            node.style.setProperty('mask-size', '100% 100%');
            node.style.setProperty('-webkit-mask-size', '100% 100%');
        });
    }

    private pointerDown(event: PointerEvent): void {
        const node = this.node;
        if (!node || this.revealed) {
            return;
        }
        // A scratch surface is not a place to lose the gesture: without capture an enclosing
        // gallery or pager claims the drag and the page scrolls instead.
        node.setPointerCapture(event.pointerId);
        this.scratching = true;
        const { x, y } = this.localPoint(event);
        this.lastX = x;
        this.lastY = y;
        this.dab(x, y);
        this.coverage.mark(x, y, this.brush);
        this.afterStroke();
        // pointerdown deliberately propagates: that is what selects the div in the editor.
    }

    private pointerMove(event: PointerEvent): void {
        if (!this.scratching || this.revealed) {
            return;
        }
        const { x, y } = this.localPoint(event);
        this.erase(this.lastX, this.lastY, x, y);
        this.coverage.markStroke(this.lastX, this.lastY, x, y, this.brush);
        this.lastX = x;
        this.lastY = y;
        this.afterStroke();
        // The editor moves a component from a document-level pointermove, so a rub has to stop
        // here or it would drag the cover across the canvas as well.
        event.stopPropagation();
        event.preventDefault();
    }

    private pointerUp(event: PointerEvent): void {
        if (!this.scratching) {
            return;
        }
        this.scratching = false;
        this.node?.releasePointerCapture(event.pointerId);
    }

    private localPoint(event: PointerEvent): { x: number; y: number } {
        const rect = this.node?.getBoundingClientRect();
        return {
            x: event.clientX - (rect?.left ?? 0),
            y: event.clientY - (rect?.top ?? 0)
        };
    }

    private afterStroke(): void {
        this.scheduleMask();
        if (this.coverage.fraction >= this.threshold) {
            this.reveal();
        }
    }

    private reveal(): void {
        if (this.revealed) {
            return;
        }
        this.revealed = true;
        this.scratching = false;

        if (this.keepCover) {
            this.writeVariable();
            return;
        }

        const node = this.node;
        if (!node || this.revealMillis === 0) {
            this.hideCover();
            this.writeVariable();
            return;
        }

        // The variable is written when the fade ends, not when the threshold is met, so the
        // layout's own transition on the reward runs after the cover is out of the way.
        node.style.transition = `opacity ${this.revealMillis}ms linear`;
        requestAnimationFrame(() => {
            node.style.opacity = '0';
        });
        window.setTimeout(() => {
            this.hideCover();
            this.writeVariable();
        }, this.revealMillis);
    }

    private hideCover(): void {
        const node = this.node;
        if (!node) {
            return;
        }
        node.style.transition = '';
        node.style.opacity = '0';
        node.style.removeProperty('mask-image');
        node.style.removeProperty('-webkit-mask-image');
    }

    private writeVariable(): void {
        if (!this.variable) {
            return;
        }
        // Same call `div-action://set_variable` ends up in, so the value is coerced into the type
        // the card declared and every trigger and expression reacts as it would to a tap.
        this.context?.variables.get(this.variable)?.set('true');
    }
}
