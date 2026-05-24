import { describe, it, expect } from 'vitest';
import {
    xpToNextLevel,
    totalXpForLevel,
    processXpGain,
    applyDeathPenalty,
    applyDeathXpPenalty,
    applyFleePenalty,
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

    // 2026-05-21: replaces deleted test "does not exceed level 1000" — now tests current logic
    // The hard level cap at 1000 was lifted per 2026-05-11 spec: each level past 1000
    // costs 10% more XP than the previous (xpToNextLevel(L) = anchor * 1.10^(L-1000)).
    // processXpGain still bounds runaway loops at HARD_SAFETY_CAP = 10_000.
    it('can advance past level 1000 (cap was removed)', () => {
        // From level 1000 with enough XP to push at least 1 level
        const need = xpToNextLevel(1000);
        const result = processXpGain(1000, 0, need);
        expect(result.newLevel).toBe(1001);
        expect(result.levelsGained).toBe(1);
    });

    it('is bounded by HARD_SAFETY_CAP (10000) on absurd XP gains', () => {
        // Absurd input — engine should not loop forever. Cap is the bound.
        const result = processXpGain(1, 0, Number.MAX_SAFE_INTEGER);
        expect(result.newLevel).toBeLessThanOrEqual(10_000);
    });
});

// ── applyDeathPenalty (NEW spec, 2026-05) ────────────────────────────────────
// Death takes floor(level * 0.02) levels and 50% of every skill's banked XP.

describe('applyDeathPenalty', () => {
    it('keeps level 1 at level 1 (nothing to strip)', () => {
        const result = applyDeathPenalty(1, 500);
        expect(result.newLevel).toBe(1);
        expect(result.levelsLost).toBe(0);
        expect(result.newXp).toBe(500); // XP pointer untouched at lvl 1
        expect(result.skillXpLossPercent).toBe(50);
    });

    it('loses 0 levels below lvl 50 (2% rounds down to 0)', () => {
        const r3 = applyDeathPenalty(3, 500);
        expect(r3.levelsLost).toBe(0);
        expect(r3.newLevel).toBe(3);
        const r10 = applyDeathPenalty(10, 1000);
        expect(r10.levelsLost).toBe(0);
        expect(r10.newLevel).toBe(10);
        const r49 = applyDeathPenalty(49, 1000);
        expect(r49.levelsLost).toBe(0);
        expect(r49.newLevel).toBe(49);
    });

    it('loses exactly 1 level at lvl 50 (50 * 0.02 = 1)', () => {
        const result = applyDeathPenalty(50, 5000);
        expect(result.levelsLost).toBe(1);
        expect(result.newLevel).toBe(49);
    });

    it('loses 2 levels at lvl 100', () => {
        const result = applyDeathPenalty(100, 50000);
        expect(result.levelsLost).toBe(2);
        expect(result.newLevel).toBe(98);
    });

    it('loses 10 levels at lvl 500', () => {
        const result = applyDeathPenalty(500, 50000);
        expect(result.levelsLost).toBe(10);
        expect(result.newLevel).toBe(490);
    });

    it('loses exactly 20 levels at lvl 1000 (the spec anchor)', () => {
        const result = applyDeathPenalty(1000, 0);
        expect(result.levelsLost).toBe(20);
        expect(result.newLevel).toBe(980);
    });

    it('always reports 50% skill XP loss', () => {
        expect(applyDeathPenalty(50, 0).skillXpLossPercent).toBe(50);
        expect(applyDeathPenalty(500, 0).skillXpLossPercent).toBe(50);
        expect(applyDeathPenalty(1000, 0).skillXpLossPercent).toBe(50);
    });

    it('never goes below level 1', () => {
        const result = applyDeathPenalty(1, 100);
        expect(result.newLevel).toBe(1);
    });

    it('drops XP pointer to 0 when a level is stripped', () => {
        const result = applyDeathPenalty(100, 50000);
        expect(result.newXp).toBe(0);
        expect(result.xpPercent).toBe(0);
    });
});

// ── applyFleePenalty (NEW spec, 2026-05) ─────────────────────────────────────
// Flee takes floor(level * 0.003) levels and 0.1% of every skill's banked XP.

describe('applyFleePenalty', () => {
    it('keeps level 1 at level 1 with no skill XP loss', () => {
        const result = applyFleePenalty(1, 500);
        expect(result.newLevel).toBe(1);
        expect(result.levelsLost).toBe(0);
        expect(result.newXp).toBe(500);
        expect(result.skillXpLossPercent).toBe(0);
    });

    it('loses 0 levels below lvl 333', () => {
        expect(applyFleePenalty(50, 1000).levelsLost).toBe(0);
        expect(applyFleePenalty(100, 1000).levelsLost).toBe(0);
        expect(applyFleePenalty(332, 1000).levelsLost).toBe(0);
    });

    it('loses 1 level at lvl 334 (0.3%)', () => {
        const result = applyFleePenalty(334, 1000);
        expect(result.levelsLost).toBe(1);
        expect(result.newLevel).toBe(333);
    });

    it('loses 3 levels at lvl 1000 (the spec anchor)', () => {
        const result = applyFleePenalty(1000, 0);
        expect(result.levelsLost).toBe(3);
        expect(result.newLevel).toBe(997);
    });

    it('reports 0.1% skill XP loss when above lvl 1', () => {
        expect(applyFleePenalty(50, 0).skillXpLossPercent).toBe(0.1);
        expect(applyFleePenalty(500, 0).skillXpLossPercent).toBe(0.1);
        expect(applyFleePenalty(1000, 0).skillXpLossPercent).toBe(0.1);
    });

    it('preserves XP pointer when no level was stripped', () => {
        const result = applyFleePenalty(100, 12345);
        expect(result.newXp).toBe(12345);
    });
});

// ── applyDeathXpPenalty (legacy) ─────────────────────────────────────────────

describe('applyDeathXpPenalty', () => {
    // 2026-05-21: replaces deleted test "reduces XP by 10%" — now tests current logic
    // applyDeathXpPenalty is kept for backwards compatibility. Formula:
    //   penalty = floor(xpToNextLevel(currentLevel) * 0.1)
    //   result  = max(0, currentXp - penalty)
    // xpToNextLevel(1) = 300, so penalty at level 1 is 30.
    it('reduces XP by 10% of the next-level XP requirement', () => {
        // currentXp must be larger than penalty so we can observe the subtraction.
        const penalty = Math.floor(xpToNextLevel(1) * 0.1); // 30
        expect(applyDeathXpPenalty(1000, 1)).toBe(1000 - penalty);
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
