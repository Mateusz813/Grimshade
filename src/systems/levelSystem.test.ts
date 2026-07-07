import { describe, it, expect } from 'vitest';
import {
    xpToNextLevel,
    totalXpForLevel,
    processXpGain,
    applyDeathPenalty,
    applyDeathXpPenalty,
    applyFleePenalty,
    getDeathLossLevels,
    getFleeLossLevels,
    losesItemsOnDeath,
    ITEM_LOSS_GRACE_MAX_LEVEL,
    xpProgress,
} from './levelSystem';

// -- xpToNextLevel -------------------------------------------------------------

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

// -- totalXpForLevel -----------------------------------------------------------

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

// -- processXpGain -------------------------------------------------------------

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

// -- getDeathLossLevels / getFleeLossLevels (2026-06-21 spec) -----------------

describe('getDeathLossLevels', () => {
    it('floors at 0.20 levels for low levels (lvl 1 → 20% of a level)', () => {
        expect(getDeathLossLevels(1)).toBeCloseTo(0.20, 5);
        expect(getDeathLossLevels(10)).toBeCloseTo(0.20, 5); // 10/100=0.1 < floor
    });
    it('= level/100 from lvl 20 up: 100→1, 200→2, 1000→10', () => {
        expect(getDeathLossLevels(41)).toBeCloseTo(0.41, 5);
        expect(getDeathLossLevels(100)).toBe(1);
        expect(getDeathLossLevels(200)).toBe(2);
        expect(getDeathLossLevels(1000)).toBe(10);
    });
});

describe('getFleeLossLevels', () => {
    it('is exactly 10% of the death loss (lvl 1000 → 1 level)', () => {
        expect(getFleeLossLevels(1000)).toBeCloseTo(1, 5);
        for (const lv of [1, 41, 100, 500, 1000]) {
            expect(getFleeLossLevels(lv)).toBeCloseTo(getDeathLossLevels(lv) * 0.1, 6);
        }
    });
});

// -- applyDeathPenalty (2026-06-21 spec — continuous loss) --------------------

describe('applyDeathPenalty', () => {
    it('REGRESSION: lvl 41 at 0% XP drops to lvl 40 (was wrongly staying at 41)', () => {
        const r = applyDeathPenalty(41, 0);
        expect(r.newLevel).toBe(40);
        expect(r.levelsLost).toBe(1);
        expect(r.newXp).toBeGreaterThan(0); // lands partway into lvl 40 (~59%)
    });

    it('loses exactly 1 level at lvl 100', () => {
        const r = applyDeathPenalty(100, 0);
        expect(r.levelsLost).toBe(1);
        expect(r.newLevel).toBe(99);
    });

    it('loses 2 levels at lvl 200, 10 levels at lvl 1000', () => {
        expect(applyDeathPenalty(200, 0).levelsLost).toBe(2);
        expect(applyDeathPenalty(200, 0).newLevel).toBe(198);
        expect(applyDeathPenalty(1000, 0).levelsLost).toBe(10);
        expect(applyDeathPenalty(1000, 0).newLevel).toBe(990);
    });

    it('lvl 1 with progress loses ~20% of current-level XP (no level to drop)', () => {
        const toNext = xpToNextLevel(1);
        const r = applyDeathPenalty(1, toNext * 0.6); // 60% into lvl 1
        expect(r.newLevel).toBe(1);
        expect(r.levelsLost).toBe(0);
        // lost 0.20 levels worth → 60% - 20% = ~40% remaining.
        expect(r.xpPercent).toBeCloseTo(40, 0);
    });

    it('clamps at level 1 (a fresh lvl-1/0% character loses nothing more)', () => {
        const r = applyDeathPenalty(1, 0);
        expect(r.newLevel).toBe(1);
        expect(r.newXp).toBe(0);
        expect(r.levelsLost).toBe(0);
    });

    it('always reports 25% skill XP loss (flat, level-independent)', () => {
        expect(applyDeathPenalty(50, 0).skillXpLossPercent).toBe(25);
        expect(applyDeathPenalty(1000, 0).skillXpLossPercent).toBe(25);
    });
});

// -- applyFleePenalty (2026-06-21 spec — 10% of death) -----------------------

describe('applyFleePenalty', () => {
    it('loses exactly 1 level at lvl 1000 (10% of death’s 10)', () => {
        const r = applyFleePenalty(1000, 0);
        expect(r.levelsLost).toBe(1);
        expect(r.newLevel).toBe(999);
    });

    it('barely dents progress mid-level (lvl 100, 50% XP → still lvl 100, ~40%)', () => {
        const r = applyFleePenalty(100, xpToNextLevel(100) * 0.5);
        expect(r.newLevel).toBe(100);
        expect(r.levelsLost).toBe(0);
        expect(r.xpPercent).toBeCloseTo(40, 0); // lost 0.1 level = 10%
    });

    it('reports 2.5% skill XP loss above lvl 1 (10% of death’s 25%)', () => {
        expect(applyFleePenalty(500, 0).skillXpLossPercent).toBe(2.5);
        expect(applyFleePenalty(1000, 0).skillXpLossPercent).toBe(2.5);
    });
});

// -- applyDeathXpPenalty (legacy) ---------------------------------------------

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

// -- xpProgress ----------------------------------------------------------------

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

// -- losesItemsOnDeath (2026-06-24 beginner item-loss grace) ------------------
describe('losesItemsOnDeath', () => {
    it('grace ceiling is level 50', () => {
        expect(ITEM_LOSS_GRACE_MAX_LEVEL).toBe(50);
    });

    it('lvl 1-50 are protected (no item loss)', () => {
        for (const lvl of [1, 25, 49, 50]) {
            expect(losesItemsOnDeath(lvl)).toBe(false);
        }
    });

    it('lvl 51+ can lose items', () => {
        for (const lvl of [51, 100, 1000]) {
            expect(losesItemsOnDeath(lvl)).toBe(true);
        }
    });
});
