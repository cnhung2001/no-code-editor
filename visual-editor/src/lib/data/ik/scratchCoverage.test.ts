import { describe, test, expect } from 'vitest';
import { ScratchCoverage, clampBrushDp, clampResolution, clampThreshold } from './scratchCoverage';

describe('scratch coverage', () => {
    test('clamps keep a card openable', () => {
        expect(clampThreshold(0)).toBe(0.05);
        expect(clampThreshold(1)).toBe(0.95);
        expect(clampThreshold(0.6)).toBe(0.6);
        expect(clampBrushDp(0)).toBe(1);
        expect(clampResolution(0)).toBe(1);
    });

    test('an untouched card reads zero and a filled one reads exactly one', () => {
        const coverage = new ScratchCoverage(10);
        coverage.resize(100, 100);
        expect(coverage.fraction).toBe(0);
        coverage.fill();
        expect(coverage.fraction).toBe(1);
    });

    test('a dab marks the cells under the brush only', () => {
        const coverage = new ScratchCoverage(10);
        coverage.resize(100, 100);
        // A 10dp brush at a cell centre covers that one cell out of 100.
        coverage.mark(5, 5, 10);
        expect(coverage.fraction).toBeCloseTo(0.01, 6);
    });

    test('a stroke fills the cells between its ends, not just the ends', () => {
        const coverage = new ScratchCoverage(10);
        coverage.resize(100, 100);
        coverage.markStroke(5, 5, 95, 5, 10);
        expect(coverage.fraction).toBeCloseTo(0.1, 6);
    });

    test('a brush dragged off the card marks nothing extra', () => {
        const coverage = new ScratchCoverage(10);
        coverage.resize(100, 100);
        coverage.mark(-50, -50, 10);
        expect(coverage.fraction).toBe(0);
    });

    test('a size change invalidates the grid', () => {
        const coverage = new ScratchCoverage(10);
        coverage.resize(100, 100);
        coverage.markStroke(5, 5, 95, 5, 10);
        expect(coverage.fraction).toBeGreaterThan(0);
        coverage.resize(200, 100);
        expect(coverage.fraction).toBe(0);
    });
});
