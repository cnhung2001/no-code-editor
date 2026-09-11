import { objectProps, type IkProps } from './props';

/**
 * Geometry, motion and prop parsing for the `lucky_wheel` custom div.
 *
 * Ported from `ik-paywall`'s `IKLuckyWheelSpec` / `IKLuckyWheelGeometry` / `IKLuckyWheelMotion`
 * (client/android of the DivKit fork), which the iOS wheel mirrors as well. The point of porting
 * the maths rather than approximating it is that the preview lands on the same slice, at the same
 * off-centre angle, over the same easing curve as the device does — a designer tuning
 * `stop_at_index` sees what the user will see.
 */

export const CUSTOM_TYPE = 'lucky_wheel';

/** Wheel proportions as fractions of the diameter, so a tuned layout holds at any size. */
export const metrics = {
    ringOuterRadius: 0.5,
    ringThickness: 0.058,
    ringGapThickness: 0.012,
    hubRadius: 0.075,
    labelRadius: 0.30,
    pointerPivotRadius: 0.028,
    pointerBladeLength: 0.085,
    pointerBladeHalfWidth: 0.022,
    rimPinRadius: 0.013
} as const;

export const DISC_RADIUS = metrics.ringOuterRadius - metrics.ringThickness - metrics.ringGapThickness;
/** The pointer pivots on the ring mid-line, same as the rim pins it rides. */
export const RIM_PIN_RADIUS_FROM_CENTRE = metrics.ringOuterRadius - metrics.ringThickness / 2;

const DEFAULT_LABEL_SIZE_DP = 20;
const DEFAULT_TURNS = 4;
const DEFAULT_DURATION_SECONDS = 3;
/** DivKit's gradient convention: 0 = left→right, 90 = bottom→top, 270 = top→bottom. */
const DEFAULT_GRADIENT_ANGLE = 270;
const FALLBACK_POINTER_COLOR = '#6c5ce0';
const FALLBACK_SLICE_FILL = '#8c7ce8';
const FALLBACK_TEXT_COLOR = '#ffffff';

export interface LuckyWheelSpec {
    labels: string[];
    sliceFills: string[];
    sliceTextColors: string[];
    ringColors: string[];
    ringGapColor: string | undefined;
    hubColors: string[];
    pointerColor: string;
    rimPinColor: string | undefined;
    /** Blade length as a fraction of the diameter; 0 leaves a bare pivot dot. */
    pointerBladeLength: number;
    labelSizeDp: number;
    labelBold: boolean;
    ringGradientAngle: number;
    hubGradientAngle: number;
    spin: boolean;
    startAtIndex: number;
    stopAtIndex: number;
    turns: number;
    durationSeconds: number;
    rimPinCount: number;
    /**
     * Intrinsic size hint in dp. Only consulted when the div's own width/height are not fixed,
     * since a circle has no content to measure itself against.
     */
    diameterDp: number | undefined;
}

export function sliceCount(spec: LuckyWheelSpec): number {
    return spec.labels.length;
}

/** Degrees swept by one slice. */
export function sliceAngle(spec: LuckyWheelSpec): number {
    return 360 / sliceCount(spec);
}

/**
 * How many times the flapper is struck per revolution. One tick per slice boundary by default —
 * the boundaries line up with the pointer, so the cadence reads as "one click per prize passing".
 */
export function tickCount(spec: LuckyWheelSpec): number {
    return spec.rimPinCount > 0 ? spec.rimPinCount : sliceCount(spec);
}

export function normalizeAngle(degrees: number): number {
    const normalized = degrees % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}

/**
 * Deterministic landing offset so the wheel stops just past the prize centre instead of snapping
 * to it. A pure function of the index, so it stays identical across Android, iOS and here.
 */
export function landingJitterDegrees(index: number, count: number): number {
    const angle = 360 / count;
    // Keep the pointer comfortably inside the slice even for many-slice wheels.
    const limit = Math.max(angle / 2 - 4, 0);
    const magnitude = Math.min(limit, 6 + (index * 37 % 3));
    return index % 2 === 0 ? magnitude : -magnitude;
}

/** Rotation (degrees, clockwise) that parks slice `index`'s centre under the pointer. */
export function rotationForIndex(index: number, count: number): number {
    const centre = (index + 0.5) * (360 / count);
    return normalizeAngle(-centre + landingJitterDegrees(index, count));
}

/**
 * Absolute rotation the spin animates to. Always travels clockwise: `turns` full revolutions plus
 * whatever remains to reach `stopAtIndex` from `startAtIndex`.
 */
export function spinTargetRotation(spec: LuckyWheelSpec): number {
    const count = sliceCount(spec);
    const from = rotationForIndex(spec.startAtIndex, count);
    const to = rotationForIndex(spec.stopAtIndex, count);
    return from + spec.turns * 360 + normalizeAngle(to - from);
}

/**
 * Whether slice `index`'s label should read outward (hub → rim) rather than inward.
 *
 * Labels run along the radius, so a single reading direction leaves one half of the wheel upside
 * down. The half is decided from where the slice lands *at rest*, not from its live angle: the
 * orientation then stays fixed for the whole spin, and the resting frame reads upright.
 */
export function labelReadsOutward(index: number, count: number, restRotationDegrees: number): boolean {
    return normalizeAngle((index + 0.5) * (360 / count) + restRotationDegrees) < 180;
}

/** Shortest angular distance from `angleDegrees` to the pointer at 0°. */
export function distanceToPointerDegrees(angleDegrees: number): number {
    const atPointer = normalizeAngle(angleDegrees);
    return Math.min(atPointer, 360 - atPointer);
}

/** Index of the tick mark currently closest to the pointer. */
export function closestTickIndex(wheelRotationDegrees: number, ticks: number): number {
    const spacing = 360 / ticks;
    let bestIndex = 0;
    let bestDistance = Number.MAX_VALUE;
    for (let index = 0; index < ticks; ++index) {
        const distance = distanceToPointerDegrees(index * spacing + wheelRotationDegrees);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    }
    return bestIndex;
}

/**
 * One-sided ride-up (0..1): how far the nearest tick has pushed the flapper as it approaches the
 * pointer tip. Drops to 0 the instant the tick clears the tip, handing the flapper back to a free
 * damped oscillation.
 */
export function tickRideUpFraction(
    wheelRotationDegrees: number,
    ticks: number,
    approachWidthDegrees: number
): number {
    const spacing = 360 / ticks;
    let maxRide = 0;
    for (let index = 0; index < ticks; ++index) {
        const position = normalizeAngle(index * spacing + wheelRotationDegrees);
        const signedDelta = ((position + 180) % 360) - 180;
        if (signedDelta >= -approachWidthDegrees && signedDelta <= 0) {
            const progress = 1 + signedDelta / approachWidthDegrees; // 0 at -w, 1 at the tip
            const eased = progress * progress; // ride-up accelerates as the tick nears the tip
            if (eased > maxRide) {
                maxRide = eased;
            }
        }
    }
    return maxRide;
}

const FLAPPER = {
    naturalFreqHz: 11,
    dampingRatio: 0.22, // < 1 → underdamped → visible spring-back wobble
    maxDeflectionDegrees: 28,
    approachWidthDegrees: 7,
    subStepSeconds: 0.004, // fixed step → frame-rate independent
    maxFrameSeconds: 1 / 30,
    contactEpsilon: 0.01,
    settleAngleEpsilon: 0.05,
    settleVelocityEpsilon: 0.5
} as const;

const OMEGA_N = 2 * Math.PI * FLAPPER.naturalFreqHz;
const OMEGA_N_SQUARED = OMEGA_N * OMEGA_N;
const TWO_ZETA_OMEGA_N = 2 * FLAPPER.dampingRatio * OMEGA_N;

/**
 * The flapper: a one-sided, damped torsional oscillator driven by the wheel's tick marks.
 *
 * Underdamped on purpose — a tick shoves it out and it springs back past centre, which is what
 * reads as a physical flapper rather than a tween.
 */
export class LuckyWheelFlapper {
    /** Current deflection in degrees. Positive = pushed by a tick, negative = spring overshoot. */
    angleDegrees = 0;

    private velocityDegreesPerSecond = 0;

    constructor(private ticks: number) {}

    /** True once the flapper has rung down and no longer needs stepping. */
    get isAtRest(): boolean {
        return Math.abs(this.angleDegrees) < FLAPPER.settleAngleEpsilon &&
            Math.abs(this.velocityDegreesPerSecond) < FLAPPER.settleVelocityEpsilon;
    }

    step(deltaSeconds: number, wheelRotationDegrees: number, wheelSettled: boolean): void {
        const dt = Math.min(Math.max(deltaSeconds, 0), FLAPPER.maxFrameSeconds);
        const rideUp = FLAPPER.maxDeflectionDegrees * tickRideUpFraction(
            wheelRotationDegrees,
            this.ticks,
            FLAPPER.approachWidthDegrees
        );

        let remaining = dt;
        while (remaining > 0) {
            const step = Math.min(FLAPPER.subStepSeconds, remaining);
            if (!wheelSettled && rideUp > FLAPPER.contactEpsilon && rideUp > this.angleDegrees) {
                // A tick is riding the flapper up: kinematic, one-sided contact.
                this.angleDegrees = rideUp;
                this.velocityDegreesPerSecond = 0;
            } else {
                // Released: free damped oscillation back to rest (semi-implicit Euler).
                const acceleration = -OMEGA_N_SQUARED * this.angleDegrees -
                    TWO_ZETA_OMEGA_N * this.velocityDegreesPerSecond;
                this.velocityDegreesPerSecond += acceleration * step;
                this.angleDegrees += this.velocityDegreesPerSecond * step;
            }
            remaining -= step;
        }
    }

    settleToRest(): void {
        this.angleDegrees = 0;
        this.velocityDegreesPerSecond = 0;
    }
}

/**
 * Cubic Bézier timing curve, `P0 = (0,0)`, `P3 = (1,1)`. Hand-rolled so every platform advances
 * through identical progress values. Newton–Raphson with a bisection fallback.
 */
export class CubicBezierEasing {
    constructor(
        private x1: number,
        private y1: number,
        private x2: number,
        private y2: number
    ) {}

    transform(fraction: number): number {
        if (fraction <= 0) {
            return 0;
        }
        if (fraction >= 1) {
            return 1;
        }
        return this.cubic(this.solveForT(fraction), this.y1, this.y2);
    }

    private solveForT(x: number): number {
        let t = x;
        for (let i = 0; i < 8; ++i) {
            const error = this.cubic(t, this.x1, this.x2) - x;
            if (Math.abs(error) < 1e-4) {
                return t;
            }
            const derivative = this.curveXDerivative(t);
            if (Math.abs(derivative) < 1e-6) {
                continue;
            }
            t -= error / derivative;
        }

        // Newton stalled (near-vertical segment); bisection always converges.
        let low = 0;
        let high = 1;
        t = x;
        while (low < high) {
            const error = this.cubic(t, this.x1, this.x2) - x;
            if (Math.abs(error) < 1e-4) {
                return t;
            }
            if (error > 0) {
                high = t;
            } else {
                low = t;
            }
            const next = (low + high) / 2;
            if (next === t) {
                return t;
            }
            t = next;
        }
        return t;
    }

    private cubic(t: number, p1: number, p2: number): number {
        const inverse = 1 - t;
        return 3 * inverse * inverse * t * p1 + 3 * inverse * t * t * p2 + t * t * t;
    }

    private curveXDerivative(t: number): number {
        const inverse = 1 - t;
        return 3 * inverse * inverse * this.x1 +
            6 * inverse * t * (this.x2 - this.x1) +
            3 * t * t * (1 - this.x2);
    }
}

/** Fast start, long deceleration — the spin curve carried over from the original wheel. */
export const spinEasing = new CubicBezierEasing(0.12, 0.88, 0.22, 1);

/** Guards against a frame-clock hiccup producing an absurd delta. */
export const MAX_FRAME_SECONDS = 1 / 30;

/** Clamps a possibly-absent, possibly-negative index into `0 until size`. */
function wrapIndex(raw: number | undefined, size: number): number {
    const value = Math.trunc(raw ?? 0);
    return ((value % size) + size) % size;
}

/**
 * Returns null when `props` carries no usable `slices` array — a wheel with fewer than two slices
 * has no geometry, and rendering a degenerate one hides the config error.
 */
export function parseLuckyWheelSpec(props: IkProps | undefined): LuckyWheelSpec | null {
    if (!props) {
        return null;
    }

    const labels = props.stringList('slices') || [];
    if (labels.length < 2) {
        return null;
    }

    const stopAtIndex = wrapIndex(props.number('stop_at_index'), labels.length);
    const spin = props.bool('spin') ?? false;
    // A static wheel is simply parked on its landing slice, so start == stop.
    const startAtIndex = spin ? wrapIndex(props.number('start_at_index'), labels.length) : stopAtIndex;

    const nonEmpty = (list: string[] | undefined, fallback: string[]) =>
        list && list.length ? list : fallback;
    const positive = (value: number | undefined, fallback: number) =>
        value !== undefined && value > 0 ? value : fallback;

    return {
        labels,
        sliceFills: nonEmpty(props.stringList('slice_fills'), [FALLBACK_SLICE_FILL]),
        sliceTextColors: nonEmpty(props.stringList('slice_text_colors'), [FALLBACK_TEXT_COLOR]),
        ringColors: props.stringList('ring_colors') || [],
        ringGapColor: props.string('ring_gap_color'),
        hubColors: props.stringList('hub_colors') || [],
        pointerColor: props.string('pointer_color') || FALLBACK_POINTER_COLOR,
        // Pins sit on the ring, so the gap colour is the sensible default.
        rimPinColor: props.string('rim_pin_color') || props.string('ring_gap_color'),
        pointerBladeLength: Math.max(props.number('pointer_blade_length') ?? metrics.pointerBladeLength, 0),
        labelSizeDp: positive(props.number('label_size'), DEFAULT_LABEL_SIZE_DP),
        labelBold: props.bool('label_bold') ?? true,
        ringGradientAngle: props.number('ring_gradient_angle') ?? DEFAULT_GRADIENT_ANGLE,
        hubGradientAngle: props.number('hub_gradient_angle') ?? DEFAULT_GRADIENT_ANGLE,
        spin,
        startAtIndex,
        stopAtIndex,
        turns: Math.max(Math.trunc(props.number('turns') ?? DEFAULT_TURNS), 0),
        durationSeconds: positive(props.number('duration'), DEFAULT_DURATION_SECONDS),
        rimPinCount: Math.max(Math.trunc(props.number('rim_pin_count') ?? 0), 0),
        diameterDp: (value => value !== undefined && value > 0 ? value : undefined)(props.number('diameter'))
    };
}

export function parseLuckyWheelProps(customProps: unknown): LuckyWheelSpec | null {
    return parseLuckyWheelSpec(objectProps(customProps));
}
