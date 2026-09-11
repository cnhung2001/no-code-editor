import { describe, test, expect } from 'vitest';
import {
    closestTickIndex,
    labelReadsOutward,
    landingJitterDegrees,
    normalizeAngle,
    parseLuckyWheelProps,
    rotationForIndex,
    sliceCount,
    spinTargetRotation,
    tickCount,
    tickRideUpFraction
} from './luckyWheel';

describe('lucky wheel geometry', () => {
    test('normalizeAngle wraps into 0..360', () => {
        expect(normalizeAngle(0)).toBe(0);
        expect(normalizeAngle(-90)).toBe(270);
        expect(normalizeAngle(450)).toBe(90);
        expect(normalizeAngle(-450)).toBe(270);
    });

    test('landing jitter alternates sign and stays inside the slice', () => {
        expect(landingJitterDegrees(0, 8)).toBeGreaterThan(0);
        expect(landingJitterDegrees(1, 8)).toBeLessThan(0);
        for (let count = 2; count <= 24; ++count) {
            for (let index = 0; index < count; ++index) {
                expect(Math.abs(landingJitterDegrees(index, count))).toBeLessThanOrEqual(360 / count / 2);
            }
        }
    });

    test('rotationForIndex parks the slice near the pointer', () => {
        // Slice centre lands under the pointer at 0°, offset only by the landing jitter.
        for (let index = 0; index < 8; ++index) {
            const centreAtPointer = normalizeAngle((index + 0.5) * 45 + rotationForIndex(index, 8));
            const distance = Math.min(centreAtPointer, 360 - centreAtPointer);
            expect(distance).toBeCloseTo(Math.abs(landingJitterDegrees(index, 8)), 4);
        }
    });

    test('spin always travels clockwise for at least `turns` revolutions', () => {
        const spec = parseLuckyWheelProps({
            slices: ['a', 'b', 'c', 'd'],
            spin: true,
            start_at_index: 3,
            stop_at_index: 1,
            turns: 4
        });
        if (!spec) {
            throw new Error('spec should parse');
        }
        const travel = spinTargetRotation(spec) - rotationForIndex(spec.startAtIndex, sliceCount(spec));
        expect(travel).toBeGreaterThanOrEqual(4 * 360);
        expect(travel).toBeLessThan(5 * 360);
    });

    test('labels read outward on the half the slice rests in', () => {
        const restRotation = rotationForIndex(0, 4);
        expect(labelReadsOutward(0, 4, restRotation)).toBe(true);
        expect(labelReadsOutward(2, 4, restRotation)).toBe(false);
    });

    test('closestTickIndex and rideUp track the pointer', () => {
        expect(closestTickIndex(0, 8)).toBe(0);
        expect(closestTickIndex(-45, 8)).toBe(1);
        // A tick sitting exactly on the pointer tip has finished its ride-up.
        expect(tickRideUpFraction(0, 8, 7)).toBeCloseTo(1, 4);
        // Half way through the approach window it is only partway up, and eased.
        expect(tickRideUpFraction(-3.5, 8, 7)).toBeCloseTo(0.25, 4);
        // Just past the tip, the flapper has been released.
        expect(tickRideUpFraction(1, 8, 7)).toBe(0);
    });
});

describe('lucky wheel props', () => {
    test('needs at least two slices', () => {
        expect(parseLuckyWheelProps(undefined)).toBeNull();
        expect(parseLuckyWheelProps({})).toBeNull();
        expect(parseLuckyWheelProps({ slices: ['only'] })).toBeNull();
    });

    test('reads numbers written as strings and wraps indices', () => {
        const spec = parseLuckyWheelProps({
            slices: ['a', 'b', 'c'],
            spin: 'true',
            stop_at_index: '-1',
            turns: '2',
            duration: '1.5',
            label_size: '0'
        });
        expect(spec?.spin).toBe(true);
        expect(spec?.stopAtIndex).toBe(2);
        expect(spec?.turns).toBe(2);
        expect(spec?.durationSeconds).toBe(1.5);
        // A non-positive label size falls back rather than rendering invisible text.
        expect(spec?.labelSizeDp).toBe(20);
    });

    test('a static wheel parks on its landing slice', () => {
        const spec = parseLuckyWheelProps({
            slices: ['a', 'b'],
            start_at_index: 1,
            stop_at_index: 0
        });
        expect(spec?.spin).toBe(false);
        expect(spec?.startAtIndex).toBe(0);
    });

    test('rim pins override the tick cadence, colours default to the ring gap', () => {
        const plain = parseLuckyWheelProps({ slices: ['a', 'b', 'c'] });
        expect(plain && tickCount(plain)).toBe(3);

        const pinned = parseLuckyWheelProps({
            slices: ['a', 'b', 'c'],
            rim_pin_count: 12,
            ring_gap_color: '#ffffff'
        });
        expect(pinned && tickCount(pinned)).toBe(12);
        expect(pinned?.rimPinColor).toBe('#ffffff');
    });
});
