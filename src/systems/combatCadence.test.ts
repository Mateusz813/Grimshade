
import { describe, it, expect } from 'vitest';
import { calculateAttackInterval } from './combat';
import { getAttackMs } from './combatEngine';


describe('getAttackMs — hunt engine attack cadence (BASE=3000)', () => {
    it('speed 1.0 -> 3000ms (slowest baseline)', () => {
        expect(getAttackMs(1.0)).toBe(3000);
    });

    it('speed 1.5 -> 2000ms (matches spec "speed 1.5 -> 2000ms")', () => {
        expect(getAttackMs(1.5)).toBe(2000);
    });

    it('speed 2.0 -> 1500ms (matches spec "speed 2.0 -> 1500ms")', () => {
        expect(getAttackMs(2.0)).toBe(1500);
    });

    it('speed 3.0 -> 1000ms (matches spec "speed 3.0 -> 1000ms")', () => {
        expect(getAttackMs(3.0)).toBe(1000);
    });

    it('speed 4.0 -> 750ms (just above the floor, NOT yet at 500ms cap)', () => {
        expect(getAttackMs(4.0)).toBe(750);
    });

    it('speed 5.0 -> 600ms (still above 500ms floor)', () => {
        expect(getAttackMs(5.0)).toBe(600);
    });

    it('speed 6.0 -> 500ms (clamped — Math.floor(3000/6)=500 = floor)', () => {
        expect(getAttackMs(6.0)).toBe(500);
    });

    it('speed 10 -> 500ms (clamped by min)', () => {
        expect(getAttackMs(10)).toBe(500);
    });

    it('speed 100 -> 500ms (clamped by min, "effective max ~4.0")', () => {
        expect(getAttackMs(100)).toBe(500);
    });

    it('speed 1000 -> 500ms (extreme cap still respects min 500ms)', () => {
        expect(getAttackMs(1000)).toBe(500);
    });

    it('speed 0 -> 3000ms (Math.max(1, …) treats 0 as 1)', () => {
        expect(getAttackMs(0)).toBe(3000);
    });

    it('speed -5 -> 3000ms (negative treated as 1)', () => {
        expect(getAttackMs(-5)).toBe(3000);
    });

    it('speed NaN -> NOT NaN — Math.max(1, NaN) returns NaN, but Math.max(500, NaN) returns NaN', () => {
        expect(getAttackMs(NaN)).not.toBeNaN();
        expect(getAttackMs(NaN)).toBe(3000);
    });

    it('returns an integer ms (Math.floor protects against fractional setTimeout)', () => {
        for (const speed of [1.1, 1.7, 2.3, 3.7, 5.55]) {
            const ms = getAttackMs(speed);
            expect(Number.isInteger(ms)).toBe(true);
        }
    });

    it('cadence is monotonic — higher speed yields lower-or-equal interval', () => {
        const speeds = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 10];
        const intervals = speeds.map(getAttackMs);
        for (let i = 1; i < intervals.length; i++) {
            expect(intervals[i]).toBeLessThanOrEqual(intervals[i - 1]);
        }
    });
});


describe('calculateAttackInterval — legacy combat path (BASE=2000)', () => {
    it('speed 1 -> 2000ms', () => {
        expect(calculateAttackInterval(1)).toBe(2000);
    });

    it('speed 2 -> 1000ms (halved)', () => {
        expect(calculateAttackInterval(2)).toBe(1000);
    });

    it('speed 3 -> 666ms (Math.floor(2000/3))', () => {
        expect(calculateAttackInterval(3)).toBe(666);
    });

    it('speed 4 -> 500ms (cap hit)', () => {
        expect(calculateAttackInterval(4)).toBe(500);
    });

    it('speed 100 -> 500ms (clamped)', () => {
        expect(calculateAttackInterval(100)).toBe(500);
    });

    it('speed NaN -> never NaN', () => {
        expect(calculateAttackInterval(NaN)).not.toBeNaN();
    });

    it('speed 0 -> 2000ms (Math.max(1, …) catches it)', () => {
        expect(calculateAttackInterval(0)).toBe(2000);
    });

    it('returns integer ms', () => {
        for (const speed of [1.1, 1.7, 2.3, 3.7]) {
            const ms = calculateAttackInterval(speed);
            expect(Number.isInteger(ms)).toBe(true);
        }
    });
});


describe('Attack cadence — shared 500ms floor (CLAUDE.md "min 500ms między atakami")', () => {
    it('both formulas honour the 500ms minimum at speed=4', () => {
        expect(calculateAttackInterval(4)).toBe(500);
        expect(getAttackMs(4)).toBeGreaterThanOrEqual(500);
    });

    it('neither formula ever returns < 500ms even at absurd speeds', () => {
        for (const speed of [10, 50, 100, 1000, 9999]) {
            expect(calculateAttackInterval(speed)).toBeGreaterThanOrEqual(500);
            expect(getAttackMs(speed)).toBeGreaterThanOrEqual(500);
        }
    });

    it('both formulas return positive integer ms for any positive speed', () => {
        for (const speed of [0.1, 0.5, 1, 1.5, 2, 3, 4, 5]) {
            const a = calculateAttackInterval(speed);
            const b = getAttackMs(speed);
            expect(a).toBeGreaterThan(0);
            expect(b).toBeGreaterThan(0);
            expect(Number.isInteger(a)).toBe(true);
            expect(Number.isInteger(b)).toBe(true);
        }
    });
});


describe('Cadence: attacks-per-second derived from interval', () => {
    const COMBAT_WINDOW_MS = 10_000;

    it('speed 1.0 (3000ms interval) -> ~3 attacks in 10s (hunt)', () => {
        const ms = getAttackMs(1.0);
        const attacks = Math.floor(COMBAT_WINDOW_MS / ms);
        expect(attacks).toBe(3);
    });

    it('speed 2.0 (1500ms interval) -> ~6 attacks in 10s (hunt)', () => {
        const ms = getAttackMs(2.0);
        const attacks = Math.floor(COMBAT_WINDOW_MS / ms);
        expect(attacks).toBe(6);
    });

    it('speed 4.0 (750ms interval) -> ~13 attacks in 10s (hunt)', () => {
        const ms = getAttackMs(4.0);
        const attacks = Math.floor(COMBAT_WINDOW_MS / ms);
        expect(attacks).toBe(13);
    });

    it('speed 6.0 (500ms floor) -> 20 attacks in 10s (hunt, capped)', () => {
        const ms = getAttackMs(6.0);
        const attacks = Math.floor(COMBAT_WINDOW_MS / ms);
        expect(attacks).toBe(20);
    });

    it('legacy path: speed 4 (500ms) -> 20 attacks in 10s', () => {
        const ms = calculateAttackInterval(4);
        const attacks = Math.floor(COMBAT_WINDOW_MS / ms);
        expect(attacks).toBe(20);
    });
});


describe('Cadence: real-time setTimeout simulation (sanity)', () => {
    it('100 successive intervals at speed 2.0 sum to 150_000ms (100 × 1500ms)', () => {
        const ms = getAttackMs(2.0);
        const total = ms * 100;
        expect(total).toBe(150_000);
    });

    it('100 successive intervals at speed 6.0 (capped) sum to 50_000ms', () => {
        const ms = getAttackMs(6.0);
        const total = ms * 100;
        expect(total).toBe(50_000);
    });
});
