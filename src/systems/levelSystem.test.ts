import { describe, it, expect } from 'vitest';
import {
    xpToNextLevel,
    totalXpForLevel,
    processXpGain,
    applyDeathPenalty,
    applyDeathXpPenalty,
    xpProgress,
} from './levelSystem';

// ── xpToNextLevel ─────────────────────────────────────────────────────────────

describe('xpToNextLevel', () => {
    it('returns at least 300 for any level', () => {
        expect(xpToNextLevel(0)).toBe(300);
        expect(xpToNextLevel(-5)).toBe(300);
        expect(xpToNextLevel(1)).toBeGreaterThanOrEqual(300);
    });

    it('is strictly increasing', () => {
        for (let l = 1; l < 100; l++) {
            expect(xpToNextLevel(l + 1)).toBeGreaterThan(xpToNextLevel(l));
        }
    });
});

// ── totalXpForLevel ───────────────────────────────────────────────────────────

describe('totalXpForLevel', () => {
    it('returns 0 for level 1', () => {
        expect(totalXpForLevel(1)).toBe(0);
    });

    it('equals xpToNextLevel(1) for level 2', () => {
        expect(totalXpForLevel(2)).toBe(xpToNextLevel(1));
    });

    it('is cumulative sum of xpToNextLevel', () => {
        const sum = xpToNextLevel(1) + xpToNextLevel(2) + xpToNextLevel(3);
        expect(totalXpForLevel(4)).toBe(sum);
    });
});

// ── processXpGain ─────────────────────────────────────────────────────────────

describe('processXpGain', () => {
    it('accumulates XP without levelling up', () => {
        const result = processXpGain(1, 0, 50);
        expect(result.newLevel).toBe(1);
        expect(result.remainingXp).toBe(50);
        expect(result.levelsGained).toBe(0);
    });

    it('levels up exactly when threshold is reached', () => {
        const needed = xpToNextLevel(1);
        const result = processXpGain(1, 0, needed);
        expect(result.newLevel).toBe(2);
        expect(result.remainingXp).toBe(0);
        expect(result.levelsGained).toBe(1);
    });

    it('handles multiple level-ups in one XP gain', () => {
        const xp = xpToNextLevel(1) + xpToNextLevel(2) + xpToNextLevel(3);
        const result = processXpGain(1, 0, xp);
        expect(result.newLevel).toBe(4);
        expect(result.levelsGained).toBe(3);
    });

    it('awards stat points on level-up', () => {
        const result = processXpGain(1, 0, xpToNextLevel(1));
        expect(result.statPointsGained).toBeGreaterThanOrEqual(1);
        expect(result.statPointsGained).toBeLessThanOrEqual(3);
    });

    it('carries over excess XP correctly', () => {
        const needed = xpToNextLevel(1);
        const result = processXpGain(1, 0, needed + 42);
        expect(result.remainingXp).toBe(42);
    });

    it('does not exceed level 1000', () => {
        const result = processXpGain(999, 0, xpToNextLevel(999) + xpToNextLevel(1000) + 9999);
        expect(result.newLevel).toBe(1000);
    });
});

// ── applyDeathPenalty (NEW – level loss) ─────────────────────────────────────

describe('applyDeathPenalty', () => {
    it('should not lose level at level 1', () => {
        const result = applyDeathPenalty(1, 500);
        expect(result.newLevel).toBe(1);
        expect(result.levelsLost).toBe(0);
        // Level 1 keeps 50% of current XP
        expect(result.newXp).toBe(250);
    });

    it('should lose 1 level at level 3 (75% XP kept)', () => {
        const result = applyDeathPenalty(3, 500);
        expect(result.newLevel).toBe(2);
        expect(result.levelsLost).toBe(1);
        expect(result.xpPercent).toBe(75);
        // newXp = 75% of xpToNextLevel(2)
        const expected = Math.floor(xpToNextLevel(2) * 0.75);
        expect(result.newXp).toBe(expected);
    });

    it('should lose 1 level at level 10 (50% XP kept)', () => {
        const result = applyDeathPenalty(10, 1000);
        expect(result.newLevel).toBe(9);
        expect(result.levelsLost).toBe(1);
        expect(result.xpPercent).toBe(50);
    });

    it('should lose 1 level at level 30 (30% XP kept)', () => {
        const result = applyDeathPenalty(30, 5000);
        expect(result.newLevel).toBe(29);
        expect(result.xpPercent).toBe(30);
    });

    it('should lose 1 level at level 100 (10% XP kept)', () => {
        const result = applyDeathPenalty(100, 50000);
        expect(result.newLevel).toBe(99);
        expect(result.xpPercent).toBe(10);
    });

    it('should lose 1 level at level 500 (5% XP kept)', () => {
        const result = applyDeathPenalty(500, 50000);
        expect(result.newLevel).toBe(499);
        expect(result.xpPercent).toBe(5);
    });

    it('should include 5% skill XP loss', () => {
        const result = applyDeathPenalty(10, 1000);
        expect(result.skillXpLossPercent).toBe(5);
    });

    it('should never go below level 1', () => {
        const result = applyDeathPenalty(1, 100);
        expect(result.newLevel).toBe(1);
    });
});

// ── applyDeathXpPenalty (legacy) ─────────────────────────────────────────────

describe('applyDeathXpPenalty', () => {
    it('reduces XP by 10% of current level requirement', () => {
        const result = applyDeathXpPenalty(500, 10);
        const penalty = Math.floor(xpToNextLevel(10) * 0.1);
        expect(result).toBe(500 - penalty);
    });

    it('does not go below 0', () => {
        expect(applyDeathXpPenalty(10, 10)).toBeGreaterThanOrEqual(0);
    });

    it('never takes you below 0 even with a tiny XP pool', () => {
        expect(applyDeathXpPenalty(0, 50)).toBe(0);
    });
});

// ── xpProgress ────────────────────────────────────────────────────────────────

describe('xpProgress', () => {
    it('returns 0 when no XP accumulated', () => {
        expect(xpProgress(0, 5)).toBe(0);
    });

    it('returns 1 when XP equals the next level requirement', () => {
        expect(xpProgress(xpToNextLevel(5), 5)).toBe(1);
    });

    it('returns ~0.5 at half-way', () => {
        const half = Math.floor(xpToNextLevel(10) / 2);
        expect(xpProgress(half, 10)).toBeCloseTo(0.5, 1);
    });

    it('is clamped to 1', () => {
        expect(xpProgress(999_999, 1)).toBe(1);
    });
});
