import type { DivExtension, DivExtensionContext } from '@divkitframework/divkit/typings/common';
import { objectProps } from './props';

/**
 * The `tween_anim` div extension — plays an Android tween animation on any div:
 *
 * ```json
 * "extensions": [
 *   { "id": "tween_anim", "params": { "anim": "shake", "loop": true } }
 * ]
 * ```
 *
 * On device the name resolves against the host app's `res/anim`, so the set is open-ended. Only
 * the animations `ik-paywall` itself ships can be reproduced here; anything else is reported the
 * same way Android reports a missing resource, and the div renders unanimated.
 *
 * `shake` is `res/anim/shake.xml`: `translate` 0 → 2% of the view's width over 600 ms, through a
 * `cycleInterpolator` of 4 cycles, after a 1800 ms `startOffset`. A cycle interpolator is
 * `sin(2 * cycles * PI * t)`, so the whole thing is one sine sampled per frame.
 */
export class TweenAnim implements DivExtension {
    private anim: string | undefined;
    private loop: boolean;

    private node: HTMLElement | undefined;
    private frame = 0;
    private startTime = 0;

    constructor(params: object) {
        const props = objectProps(params);
        this.anim = props.string('anim');
        this.loop = props.bool('loop') ?? false;
    }

    mountView(node: HTMLElement, context: DivExtensionContext): void {
        if (!this.anim) {
            return;
        }
        if (this.anim !== SHAKE.name) {
            context.logError(Object.assign(
                new Error(`tween_anim: anim resource '${this.anim}' is not available in the preview`),
                { level: 'warn' as const, additional: { anim: this.anim } }
            ));
            return;
        }

        this.node = node;
        this.frame = requestAnimationFrame(time => this.step(time));
    }

    unmountView(node: HTMLElement): void {
        if (this.frame) {
            cancelAnimationFrame(this.frame);
            this.frame = 0;
        }
        // `translate` rather than `transform`: DivKit owns the div's transform, and the two
        // compose, so restoring means clearing only what this extension set.
        node.style.removeProperty('translate');
        this.node = undefined;
    }

    private step(time: number): void {
        const node = this.node;
        if (!node) {
            return;
        }
        if (!this.startTime) {
            this.startTime = time;
        }

        const elapsed = time - this.startTime;
        const amplitude = node.offsetWidth * SHAKE.deltaFraction;
        let offset = 0;
        let running = true;

        if (elapsed >= SHAKE.startOffsetMs) {
            const fraction = (elapsed - SHAKE.startOffsetMs) / SHAKE.durationMs;
            if (fraction >= 1) {
                // Android's Animation ends with fillAfter=false, so the view snaps back to 0 and
                // a looping animation starts over — start offset included.
                if (this.loop) {
                    this.startTime = time;
                } else {
                    running = false;
                }
            } else {
                offset = amplitude * Math.sin(2 * SHAKE.cycles * Math.PI * fraction);
            }
        }

        node.style.translate = `${offset}px`;
        if (running) {
            this.frame = requestAnimationFrame(next => this.step(next));
        } else {
            this.frame = 0;
        }
    }
}

const SHAKE = {
    name: 'shake',
    /** `android:toXDelta="2%"` — a fraction of the animated view's own width. */
    deltaFraction: 0.02,
    durationMs: 600,
    startOffsetMs: 1800,
    /** `res/anim/shake_cycle.xml`: `cycleInterpolator` with `android:cycles="4"`. */
    cycles: 4
} as const;
