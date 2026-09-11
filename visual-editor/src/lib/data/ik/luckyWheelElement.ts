import type { DivExtensionContext } from '@divkitframework/divkit/typings/common';
import { parseColor, stringifyColorToCss } from '../../utils/colors';
import { attributeProps, objectProps } from './props';
import {
    CUSTOM_TYPE,
    DISC_RADIUS,
    LuckyWheelFlapper,
    MAX_FRAME_SECONDS,
    RIM_PIN_RADIUS_FROM_CENTRE,
    labelReadsOutward,
    metrics,
    parseLuckyWheelSpec,
    rotationForIndex,
    sliceAngle,
    sliceCount,
    spinEasing,
    spinTargetRotation,
    tickCount,
    type LuckyWheelSpec
} from './luckyWheel';

export const LUCKY_WHEEL_TAG = 'ik-lucky-wheel';

const DEFAULT_SLICE_COLOR = '#8c7ce8';
const DEFAULT_POINTER_COLOR = '#6c5ce0';
const DEFAULT_LABEL_COLOR = '#ffffff';
const DEFAULT_PIN_COLOR = '#ffffff';
/** Canvas arcs start at 3 o'clock; shift so slice 0 starts at 12 o'clock. */
const CANVAS_TOP_OFFSET = -90;
const DEG_TO_RAD = Math.PI / 180;

/** DivKit colour literal → css, or null when unparseable so the caller can fall back. */
function toCss(literal: string | undefined): string | null {
    if (!literal) {
        return null;
    }
    const parsed = parseColor(literal.trim());
    return parsed ? stringifyColorToCss(parsed) : null;
}

/** Picks colour `index` from a palette, cycling — `["#a", "#b"]` alternates across slices. */
function cycle(palette: string[], index: number, fallback: string): string {
    if (!palette.length) {
        return fallback;
    }
    return toCss(palette[index % palette.length]) || fallback;
}

/** The one geometry every draw pass shares: canvas, wheel centre, and the diameter it fits in. */
interface Frame {
    ctx: CanvasRenderingContext2D;
    centreX: number;
    centreY: number;
    diameter: number;
}

/**
 * DivKit gradient convention: 0° = left→right, 90° = bottom→top, 270° = top→bottom.
 * Returns null for a single-colour palette so the caller can use a flat fill.
 */
function linearGradient(
    frame: Frame,
    colors: string[],
    angleDegrees: number,
    extent: number
): CanvasGradient | null {
    if (colors.length < 2) {
        return null;
    }
    const { ctx, centreX, centreY } = frame;
    const radians = angleDegrees * DEG_TO_RAD;
    const halfX = Math.cos(radians) * extent / 2;
    // Screen y grows downward, so an upward gradient direction needs the sign flipped.
    const halfY = -Math.sin(radians) * extent / 2;
    const gradient = ctx.createLinearGradient(
        centreX - halfX,
        centreY - halfY,
        centreX + halfX,
        centreY + halfY
    );
    colors.forEach((color, index) => {
        gradient.addColorStop(
            colors.length === 1 ? 0 : index / (colors.length - 1),
            cycle(colors, index, DEFAULT_SLICE_COLOR)
        );
    });
    return gradient;
}

/**
 * Everything that makes this a *different* wheel. DivKit rebinds the same element around every
 * variable write, so an unchanged spec must not restart the spin.
 */
function specKey(spec: LuckyWheelSpec | null): string {
    return spec ? JSON.stringify(spec) : '';
}

/**
 * Renders `custom_type: "lucky_wheel"` in the editor preview, drawing and animating the same
 * wheel `IKLuckyWheelView` draws on Android — see `./luckyWheel.ts` for the shared maths.
 */
class LuckyWheelElement extends HTMLElement {
    private canvas: HTMLCanvasElement | undefined;
    private context: DivExtensionContext | undefined;
    private resizeObserver: ResizeObserver | undefined;
    private propsObserver: MutationObserver | undefined;

    private spec: LuckyWheelSpec | null = null;
    private key = '';
    /** Current wheel rotation in degrees, clockwise. */
    private rotation = 0;
    private flapper: LuckyWheelFlapper | undefined;

    private frame = 0;
    private spinStart = 0;
    private lastFrame = 0;
    private settled = true;
    private spinFrom = 0;
    private spinTravel = 0;
    private spinDuration = 0;

    connectedCallback(): void {
        if (!this.shadowRoot) {
            const root = this.attachShadow({ mode: 'open' });
            root.innerHTML = `<style>
                :host { display: block; box-sizing: border-box; width: 100%; height: 100%; }
                canvas { display: block; width: 100%; height: 100%; }
            </style><canvas></canvas>`;
            this.canvas = root.querySelector('canvas') as HTMLCanvasElement;
        }

        this.resizeObserver = new ResizeObserver(() => this.draw());
        this.resizeObserver.observe(this);
        // custom_props also land as attributes, which is the only change signal DivKit gives an
        // element after mount — the api callback fires once.
        this.propsObserver = new MutationObserver(() => this.apply());
        this.propsObserver.observe(this, { attributes: true });
        // Deferred by a microtask: DivKit hands over the component context from its own mount
        // callback, which runs after this. Reading the attributes now instead would parse a
        // stringified copy of the props and start a spin the exact props then restart.
        queueMicrotask(() => this.apply());
    }

    disconnectedCallback(): void {
        this.stopFrameLoop();
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
        this.propsObserver?.disconnect();
        this.propsObserver = undefined;
    }

    /** Called once by DivKit on mount, handing over the component context. */
    divKitApiCallback(context: DivExtensionContext): void {
        this.context = context;
        this.apply();
    }

    private apply(): void {
        const customProps = this.context?.getComponentProperty<unknown>('custom_props');
        const next = parseLuckyWheelSpec(
            customProps ? objectProps(customProps) : attributeProps(this)
        );

        if (!next) {
            this.context?.logError(Object.assign(
                new Error(`${CUSTOM_TYPE}: custom_props needs a 'slices' array with at least 2 entries`),
                { level: 'error' as const }
            ));
        }

        this.bind(next);
    }

    /** Applies `next` and, when it asks for a spin, starts one. Mirrors `IKLuckyWheelView.bind`. */
    private bind(next: LuckyWheelSpec | null): void {
        const key = specKey(next);
        if (key === this.key) {
            return;
        }
        const previous = this.spec;
        this.spec = next;
        this.key = key;
        this.stopFrameLoop();

        if (!next) {
            this.rotation = 0;
            this.flapper = undefined;
            this.draw();
            return;
        }

        this.applySizeHint(next);
        this.flapper = new LuckyWheelFlapper(tickCount(next));

        if (next.spin) {
            // Resume from wherever the previous spec left the wheel when the two agree on the
            // starting slice; otherwise snap to the declared start so the JSON stays authoritative.
            this.rotation = previous && previous.stopAtIndex === next.startAtIndex ?
                rotationForIndex(previous.stopAtIndex, sliceCount(previous)) :
                rotationForIndex(next.startAtIndex, sliceCount(next));
            this.startSpin(next);
        } else {
            this.rotation = rotationForIndex(next.stopAtIndex, sliceCount(next));
            this.settled = true;
            this.draw();
        }
    }

    /**
     * A circle has nothing to measure itself against, so a `wrap_content` axis would collapse to
     * zero — the `diameter` prop is the fallback, same as Android's onMeasure hint.
     */
    private applySizeHint(spec: LuckyWheelSpec): void {
        if (!spec.diameterDp) {
            this.style.removeProperty('width');
            this.style.removeProperty('height');
            return;
        }
        requestAnimationFrame(() => {
            if (!this.offsetWidth) {
                this.style.width = `${spec.diameterDp}px`;
            }
            if (!this.offsetHeight) {
                this.style.height = `${spec.diameterDp}px`;
            }
        });
    }

    // ── Spin loop ──

    private startSpin(spec: LuckyWheelSpec): void {
        this.spinFrom = this.rotation;
        // spinTargetRotation() is expressed from the declared start; re-anchor it on the angle we
        // are actually at so a resumed wheel still travels `turns` revolutions plus the remainder.
        this.spinTravel = spinTargetRotation(spec) - rotationForIndex(spec.startAtIndex, sliceCount(spec));
        this.spinDuration = Math.max(spec.durationSeconds * 1000, 1);
        this.settled = false;
        this.spinStart = 0;
        this.lastFrame = 0;
        this.frame = requestAnimationFrame(time => this.doFrame(time));
    }

    private doFrame(time: number): void {
        const spec = this.spec;
        if (!spec) {
            return;
        }
        if (!this.spinStart) {
            this.spinStart = time;
        }

        if (!this.settled) {
            const fraction = Math.min(Math.max((time - this.spinStart) / this.spinDuration, 0), 1);
            this.rotation = this.spinFrom + this.spinTravel * spinEasing.transform(fraction);
            if (fraction >= 1) {
                this.rotation = this.spinFrom + this.spinTravel;
                this.settled = true;
            }
        }

        if (this.lastFrame) {
            this.flapper?.step(
                Math.min((time - this.lastFrame) / 1000, MAX_FRAME_SECONDS),
                this.rotation,
                this.settled
            );
        }
        this.lastFrame = time;
        this.draw();

        // Keep running past the wheel's stop so the flapper can ring down, then stop.
        if (this.settled && (this.flapper?.isAtRest ?? true)) {
            this.flapper?.settleToRest();
            this.frame = 0;
            this.draw();
        } else {
            this.frame = requestAnimationFrame(next => this.doFrame(next));
        }
    }

    private stopFrameLoop(): void {
        if (this.frame) {
            cancelAnimationFrame(this.frame);
            this.frame = 0;
        }
        this.settled = true;
    }

    // ── Drawing ──

    private draw(): void {
        const canvas = this.canvas;
        const spec = this.spec;
        if (!canvas) {
            return;
        }

        const width = this.clientWidth;
        const height = this.clientHeight;
        const ratio = window.devicePixelRatio || 1;
        if (width <= 0 || height <= 0) {
            return;
        }
        if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        if (!spec) {
            return;
        }

        const frame: Frame = {
            ctx,
            centreX: width / 2,
            centreY: height / 2,
            diameter: Math.min(width, height)
        };

        this.drawRing(frame, spec);

        // Everything from here rotates with the wheel; the pointer is drawn afterwards, unrotated.
        this.rotated(frame, this.rotation, () => {
            this.drawSlices(frame, spec);
            this.drawLabels(frame, spec);
            this.drawRimPins(frame, spec);
        });

        this.drawHub(frame, spec);
        this.drawPointer(frame, spec);
    }

    /** Runs `body` with the canvas rotated by `degrees` about `pivotY` on the wheel's axis. */
    private rotated(frame: Frame, degrees: number, body: () => void, pivotY?: number): void {
        const { ctx, centreX } = frame;
        const y = pivotY ?? frame.centreY;
        ctx.save();
        ctx.translate(centreX, y);
        ctx.rotate(degrees * DEG_TO_RAD);
        ctx.translate(-centreX, -y);
        body();
        ctx.restore();
    }

    private fillCircle(frame: Frame, x: number, y: number, radius: number): void {
        frame.ctx.beginPath();
        frame.ctx.arc(x, y, radius, 0, Math.PI * 2);
        frame.ctx.fill();
    }

    private drawRing(frame: Frame, spec: LuckyWheelSpec): void {
        const { ctx, centreX, centreY, diameter } = frame;
        const ringOuter = diameter * metrics.ringOuterRadius;

        if (spec.ringColors.length) {
            ctx.fillStyle = linearGradient(frame, spec.ringColors, spec.ringGradientAngle, diameter) ||
                cycle(spec.ringColors, 0, DEFAULT_POINTER_COLOR);
            this.fillCircle(frame, centreX, centreY, ringOuter);
        }
        // The gap doubles as the ring's inner edge; without a gap colour the slices meet the ring.
        const gap = toCss(spec.ringGapColor);
        if (gap) {
            ctx.fillStyle = gap;
            this.fillCircle(frame, centreX, centreY, ringOuter - diameter * metrics.ringThickness);
        }
    }

    private drawSlices(frame: Frame, spec: LuckyWheelSpec): void {
        const { ctx, centreX, centreY, diameter } = frame;
        const discRadius = diameter * DISC_RADIUS;
        const angle = sliceAngle(spec);

        for (let index = 0; index < sliceCount(spec); ++index) {
            ctx.fillStyle = cycle(spec.sliceFills, index, DEFAULT_SLICE_COLOR);
            const start = (index * angle + CANVAS_TOP_OFFSET) * DEG_TO_RAD;
            ctx.beginPath();
            ctx.moveTo(centreX, centreY);
            ctx.arc(centreX, centreY, discRadius, start, start + angle * DEG_TO_RAD);
            ctx.closePath();
            ctx.fill();
        }
    }

    private drawLabels(frame: Frame, spec: LuckyWheelSpec): void {
        const { ctx, centreX, centreY, diameter } = frame;
        const count = sliceCount(spec);
        // Orientation is chosen for where the wheel comes to rest, so it stays fixed for the whole
        // spin and the resting frame reads upright.
        const restRotation = rotationForIndex(spec.stopAtIndex, count);
        const labelRadius = diameter * metrics.labelRadius;
        const angle = sliceAngle(spec);

        ctx.font = `${spec.labelBold ? 'bold ' : ''}${spec.labelSizeDp}px ` +
            'Roboto, system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        spec.labels.forEach((label, index) => {
            ctx.fillStyle = cycle(spec.sliceTextColors, index, DEFAULT_LABEL_COLOR);
            ctx.save();
            ctx.translate(centreX, centreY);
            ctx.rotate((index + 0.5) * angle * DEG_TO_RAD);
            ctx.translate(0, -labelRadius);
            // ±90° turns the text to run along the radius. The sign picks the reading direction,
            // which is what keeps the left half of the wheel from coming out upside down.
            ctx.rotate((labelReadsOutward(index, count, restRotation) ? -90 : 90) * DEG_TO_RAD);
            ctx.fillText(label, 0, 0);
            ctx.restore();
        });
    }

    private drawRimPins(frame: Frame, spec: LuckyWheelSpec): void {
        if (spec.rimPinCount <= 0) {
            return;
        }
        const { ctx, centreX, centreY, diameter } = frame;
        ctx.fillStyle = toCss(spec.rimPinColor) || DEFAULT_PIN_COLOR;
        const pinRadius = diameter * metrics.rimPinRadius;
        const orbit = diameter * RIM_PIN_RADIUS_FROM_CENTRE;
        const spacing = 360 / spec.rimPinCount;

        for (let index = 0; index < spec.rimPinCount; ++index) {
            const radians = (index * spacing - 90) * DEG_TO_RAD;
            this.fillCircle(
                frame,
                centreX + orbit * Math.cos(radians),
                centreY + orbit * Math.sin(radians),
                pinRadius
            );
        }
    }

    private drawHub(frame: Frame, spec: LuckyWheelSpec): void {
        if (!spec.hubColors.length) {
            return;
        }
        const hubRadius = frame.diameter * metrics.hubRadius;
        frame.ctx.fillStyle =
            linearGradient(frame, spec.hubColors, spec.hubGradientAngle, hubRadius * 2) ||
            cycle(spec.hubColors, 0, DEFAULT_LABEL_COLOR);
        this.fillCircle(frame, frame.centreX, frame.centreY, hubRadius);
    }

    /**
     * The pointer is hinged: it only *rotates* about its pivot dot on the ring mid-line, never
     * translates, so the pivot stays glued to the rim contact point. Push is negative, overshoot
     * flips positive.
     */
    private drawPointer(frame: Frame, spec: LuckyWheelSpec): void {
        const { ctx, centreX, centreY, diameter } = frame;
        const pivotY = centreY - diameter * RIM_PIN_RADIUS_FROM_CENTRE;
        const bladeLength = diameter * spec.pointerBladeLength;
        const bladeHalfWidth = diameter * metrics.pointerBladeHalfWidth;

        this.rotated(frame, -(this.flapper?.angleDegrees ?? 0), () => {
            ctx.fillStyle = toCss(spec.pointerColor) || DEFAULT_POINTER_COLOR;
            ctx.beginPath();
            ctx.moveTo(centreX - bladeHalfWidth, pivotY);
            ctx.lineTo(centreX + bladeHalfWidth, pivotY);
            ctx.lineTo(centreX, pivotY + bladeLength);
            ctx.closePath();
            ctx.fill();
            this.fillCircle(frame, centreX, pivotY, diameter * metrics.pointerPivotRadius);
        }, pivotY);
    }
}

export function defineLuckyWheelElement(): string {
    if (!customElements.get(LUCKY_WHEEL_TAG)) {
        customElements.define(LUCKY_WHEEL_TAG, LuckyWheelElement);
    }
    return LUCKY_WHEEL_TAG;
}
