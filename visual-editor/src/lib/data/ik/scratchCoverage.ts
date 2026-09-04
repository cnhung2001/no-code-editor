/**
 * Tracks how much of a scratch card has been rubbed off, without ever reading the cover back.
 *
 * The scratched area is approximated by a grid: a brush stroke marks every cell whose centre
 * falls under it, and `fraction` is the share of marked cells. Ported from `IKScratchCoverage` in
 * `ik-paywall`, so the editor opens a card at the same rub as the device does.
 */

export const scratchCardSpec = {
    extensionId: 'scratch_card',
    /** Share of the card that has to be rubbed off. At 0.6 the reward is already legible. */
    defaultThreshold: 0.6,
    /** Brush diameter in dp — roughly a fingertip. Smaller makes the card feel unresponsive. */
    defaultBrushDp: 44,
    defaultRevealDurationSeconds: 0.35,
    /** Cells per axis of the coverage grid: 20 -> 400 cells, a resolution of 0.25%. */
    defaultResolution: 20
} as const;

/**
 * Never 1: the corners of a rounded card are unreachable by a fingertip, so a threshold near the
 * top leaves a card that can only be opened by scribbling. Never 0 either — the card would open on
 * the first touch.
 */
export function clampThreshold(value: number): number {
    return Math.min(Math.max(value, 0.05), 0.95);
}

/** A zero or negative brush erases nothing at all, which is a card nobody can open. */
export function clampBrushDp(value: number): number {
    return Math.max(value, 1);
}

export function clampRevealDurationSeconds(value: number): number {
    return Math.max(value, 0);
}

export function clampResolution(value: number): number {
    return Math.max(Math.trunc(value), 1);
}

export class ScratchCoverage {
    private resolution: number;
    private marked = new Set<number>();
    /** Set by `fill` so `fraction` reports exactly 1 rather than "every cell we happened to hit". */
    private filled = false;

    width = 0;
    height = 0;

    constructor(resolution: number = scratchCardSpec.defaultResolution) {
        this.resolution = clampResolution(resolution);
    }

    /** 0 = untouched, 1 = fully scratched. */
    get fraction(): number {
        return this.filled ? 1 : this.marked.size / (this.resolution * this.resolution);
    }

    /**
     * Adopts a new card size. Cells are relative to the card, so an unchanged size keeps the
     * progress and a changed one invalidates it.
     */
    resize(width: number, height: number): void {
        if (width === this.width && height === this.height) {
            return;
        }
        this.width = width;
        this.height = height;
        this.reset();
    }

    reset(): void {
        this.marked.clear();
        this.filled = false;
    }

    /** Marks everything — for a card opened by something other than a finger. */
    fill(): void {
        this.filled = true;
    }

    /**
     * Marks the swept area of one brush move. Pointer events arrive far apart at speed, so the
     * segment is walked in steps of a quarter brush rather than marking only its ends; otherwise a
     * fast rub leaves unmarked gaps and the card reads as less scratched than it looks.
     */
    markStroke(fromX: number, fromY: number, toX: number, toY: number, brush: number): void {
        if (brush <= 0 || this.width <= 0 || this.height <= 0) {
            return;
        }
        const distance = Math.hypot(toX - fromX, toY - fromY);
        const steps = Math.max(1, Math.trunc(distance / Math.max(brush / 4, 1)));
        for (let step = 0; step <= steps; ++step) {
            const t = step / steps;
            this.mark(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t, brush);
        }
    }

    /** Marks a single brush print — the dab a touch with no movement leaves. */
    mark(x: number, y: number, brush: number): void {
        if (brush <= 0 || this.width <= 0 || this.height <= 0) {
            return;
        }

        const cellWidth = this.width / this.resolution;
        const cellHeight = this.height / this.resolution;
        const radius = brush / 2;
        const firstColumn = Math.max(0, Math.floor((x - radius) / cellWidth));
        const lastColumn = Math.min(this.resolution - 1, Math.floor((x + radius) / cellWidth));
        const firstRow = Math.max(0, Math.floor((y - radius) / cellHeight));
        const lastRow = Math.min(this.resolution - 1, Math.floor((y + radius) / cellHeight));
        // Brush entirely outside the card; a finger dragged past the edge is not an error.
        if (firstColumn > lastColumn || firstRow > lastRow) {
            return;
        }

        for (let column = firstColumn; column <= lastColumn; ++column) {
            for (let row = firstRow; row <= lastRow; ++row) {
                const centerX = (column + 0.5) * cellWidth;
                const centerY = (row + 0.5) * cellHeight;
                if (Math.hypot(centerX - x, centerY - y) <= radius) {
                    this.marked.add(row * this.resolution + column);
                }
            }
        }
    }
}
