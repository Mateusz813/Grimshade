
import { describe, it, expect } from 'vitest';
import {
    formatGoldShort,
    getGoldBreakdown,
    GOLD_PER_K,
    GOLD_PER_CC,
    GOLD_PER_SC,
} from './goldFormat';


describe('gold tier constants', () => {
    it('uses the canonical conversion factors (100× per tier)', () => {
        expect(GOLD_PER_K).toBe(1_000);
        expect(GOLD_PER_CC).toBe(100_000);
        expect(GOLD_PER_SC).toBe(10_000_000);
        expect(GOLD_PER_CC).toBe(GOLD_PER_K * 100);
        expect(GOLD_PER_SC).toBe(GOLD_PER_CC * 100);
    });
});


describe('formatGoldShort', () => {
    it('renders raw gp for amounts below 1k', () => {
        expect(formatGoldShort(0)).toBe('0 gp');
        expect(formatGoldShort(1)).toBe('1 gp');
        expect(formatGoldShort(99)).toBe('99 gp');
        expect(formatGoldShort(500)).toBe('500 gp');
        expect(formatGoldShort(999)).toBe('999 gp');
    });

    it('switches to "k" exactly at 1 000 gp', () => {
        expect(formatGoldShort(1_000)).toBe('1,00 k');
        expect(formatGoldShort(1_500)).toBe('1,50 k');
        expect(formatGoldShort(99_999)).toBe('99,99 k');
    });

    it('switches to "cc" exactly at 100 000 gp', () => {
        expect(formatGoldShort(100_000)).toBe('1,00 cc');
        expect(formatGoldShort(150_000)).toBe('1,50 cc');
        expect(formatGoldShort(5_138_755)).toBe('51,38 cc');
        expect(formatGoldShort(9_999_999)).toBe('99,99 cc');
    });

    it('switches to "sc" exactly at 10 000 000 gp', () => {
        expect(formatGoldShort(10_000_000)).toBe('1,00 sc');
        expect(formatGoldShort(15_000_000)).toBe('1,50 sc');
        expect(formatGoldShort(123_456_789)).toBe('12,34 sc');
    });

    it('keeps growing into 4+ digits at the "sc" tier (no further unit)', () => {
        expect(formatGoldShort(1_000_000_000)).toBe('100,00 sc');
    });

    it('truncates rather than rounds (player never sees more than they own)', () => {
        expect(formatGoldShort(51_387)).toBe('51,38 k');
        expect(formatGoldShort(5_138_999)).toBe('51,38 cc');
    });

    it('uses Polish comma as the decimal separator everywhere', () => {
        expect(formatGoldShort(1_000)).toContain(',');
        expect(formatGoldShort(100_000)).toContain(',');
        expect(formatGoldShort(10_000_000)).toContain(',');
        expect(formatGoldShort(1_500)).not.toContain('.');
    });

    it('coerces negative input to 0', () => {
        expect(formatGoldShort(-1)).toBe('0 gp');
        expect(formatGoldShort(-1_000_000)).toBe('0 gp');
    });

    it('floors fractional input (defensive)', () => {
        expect(formatGoldShort(999.99)).toBe('999 gp');
        expect(formatGoldShort(1500.7)).toBe('1,50 k');
    });
});


describe('getGoldBreakdown', () => {
    it('returns all-zeros for 0', () => {
        expect(getGoldBreakdown(0)).toEqual({ sc: 0, cc: 0, k: 0, gold: 0 });
    });

    it('keeps amounts below 1k entirely in the gold field', () => {
        expect(getGoldBreakdown(500)).toEqual({ sc: 0, cc: 0, k: 0, gold: 500 });
        expect(getGoldBreakdown(999)).toEqual({ sc: 0, cc: 0, k: 0, gold: 999 });
    });

    it('extracts the k field when 1k ≤ gold < 100k', () => {
        expect(getGoldBreakdown(1_000)).toEqual({ sc: 0, cc: 0, k: 1, gold: 0 });
        expect(getGoldBreakdown(1_500)).toEqual({ sc: 0, cc: 0, k: 1, gold: 500 });
        expect(getGoldBreakdown(99_999)).toEqual({ sc: 0, cc: 0, k: 99, gold: 999 });
    });

    it('extracts the cc field when 100k ≤ gold < 10M', () => {
        expect(getGoldBreakdown(100_000)).toEqual({ sc: 0, cc: 1, k: 0, gold: 0 });
        expect(getGoldBreakdown(1_234_567)).toEqual({ sc: 0, cc: 12, k: 34, gold: 567 });
    });

    it('extracts the sc field at 10M+', () => {
        expect(getGoldBreakdown(10_000_000)).toEqual({ sc: 1, cc: 0, k: 0, gold: 0 });
        expect(getGoldBreakdown(12_345_678)).toEqual({ sc: 1, cc: 23, k: 45, gold: 678 });
    });

    it('cumulative breakdown re-sums to the original gold amount', () => {
        const samples = [0, 1, 999, 1_000, 1_500, 99_999, 100_000, 1_234_567, 12_345_678];
        for (const g of samples) {
            const b = getGoldBreakdown(g);
            const total = b.sc * GOLD_PER_SC + b.cc * GOLD_PER_CC + b.k * GOLD_PER_K + b.gold;
            expect(total).toBe(g);
        }
    });

    it('coerces negative input to all-zeros', () => {
        expect(getGoldBreakdown(-50)).toEqual({ sc: 0, cc: 0, k: 0, gold: 0 });
    });

    it('floors fractional input (defensive)', () => {
        expect(getGoldBreakdown(1_500.9)).toEqual({ sc: 0, cc: 0, k: 1, gold: 500 });
    });
});
