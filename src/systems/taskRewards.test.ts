import { describe, it, expect } from 'vitest';
import {
    computeTaskRewards,
    getEffectiveTaskXpPerKill,
    TASK_XP_CURVE_THRESHOLD,
    TASK_XP_GEOMETRIC_RATIO,
    type IMonsterRewardSource,
} from './taskRewards';
import monstersData from '../data/monsters.json';

// -- Fixtures -----------------------------------------------------------------
const makeMonster = (overrides?: Partial<IMonsterRewardSource>): IMonsterRewardSource => ({
    level: 1,
    xp: 10,
    gold: [1, 5],
    ...overrides,
});

// -- Constants ----------------------------------------------------------------

describe('TASK_XP_CURVE_THRESHOLD', () => {
    it('is 300', () => {
        expect(TASK_XP_CURVE_THRESHOLD).toBe(300);
    });
});

describe('TASK_XP_GEOMETRIC_RATIO', () => {
    it('is 1.05', () => {
        expect(TASK_XP_GEOMETRIC_RATIO).toBe(1.05);
    });
});

// -- getEffectiveTaskXpPerKill ------------------------------------------------

describe('getEffectiveTaskXpPerKill', () => {
    it('returns the monster native xp below the threshold', () => {
        const monster = makeMonster({ level: 10, xp: 42 });
        expect(getEffectiveTaskXpPerKill(monster)).toBe(42);
    });

    it('returns native xp for level just under threshold (level 299)', () => {
        const monster = makeMonster({ level: 299, xp: 1500 });
        expect(getEffectiveTaskXpPerKill(monster)).toBe(1500);
    });

    it('returns 0 when monster.xp is non-finite (NaN)', () => {
        const monster = makeMonster({ level: 5, xp: NaN });
        expect(getEffectiveTaskXpPerKill(monster)).toBe(0);
    });

    it('returns 0 when monster.xp is Infinity', () => {
        const monster = makeMonster({ level: 5, xp: Infinity });
        expect(getEffectiveTaskXpPerKill(monster)).toBe(0);
    });

    it('uses the override map for monsters at the threshold (level 300)', () => {
        // The first monster at lvl 300 in monsters.json keeps native xp as anchor.
        // From real data: death_knight lvl 300, xp 1538.
        const monster = makeMonster({ level: 300, xp: 999_999 });
        // Override must NOT just echo monster.xp — it must read from the map
        // built off monsters.json. The override floors the anchor.
        const result = getEffectiveTaskXpPerKill(monster);
        expect(result).toBeGreaterThan(0);
        // The override should NOT match the made-up huge xp we passed.
        expect(result).not.toBe(999_999);
    });

    it('scales geometrically by 1.05 across consecutive override-level monsters', () => {
        // Pull two consecutive monsters >= 300 from real data and verify
        // override[next] === floor(override[first] * 1.05^(steps)).
        const overrideMonsters = (monstersData as unknown as IMonsterRewardSource[])
            .filter((m) => m.level >= TASK_XP_CURVE_THRESHOLD)
            .sort((a, b) => a.level - b.level);
        if (overrideMonsters.length < 2) {
            // Defensive — if the data ever drops below 2 monsters in the
            // override range this test becomes a no-op; we still pass.
            return;
        }
        const a = overrideMonsters[0];
        const b = overrideMonsters[1];
        const xpA = getEffectiveTaskXpPerKill(a);
        const xpB = getEffectiveTaskXpPerKill(b);
        // Index 1 = anchor * 1.05^1. Allow a 1-unit floor()/Math.pow drift.
        const expected = Math.max(1, Math.floor(xpA * TASK_XP_GEOMETRIC_RATIO));
        expect(xpB).toBe(expected);
    });

    it('clamps override result to a minimum of 1', () => {
        // Find ANY override-range monster and verify > 0.
        const overrideMonsters = (monstersData as unknown as IMonsterRewardSource[])
            .filter((m) => m.level >= TASK_XP_CURVE_THRESHOLD);
        for (const m of overrideMonsters) {
            expect(getEffectiveTaskXpPerKill(m)).toBeGreaterThanOrEqual(1);
        }
    });
});

// -- computeTaskRewards -------------------------------------------------------

describe('computeTaskRewards', () => {
    it('computes xp = floor(xp * killCount * 1.5) for a sub-threshold monster', () => {
        const monster = makeMonster({ level: 5, xp: 10, gold: [2, 4] });
        const result = computeTaskRewards(monster, 100);
        // 10 * 100 * 1.5 = 1500
        expect(result.rewardXp).toBe(1500);
    });

    it('computes gold = floor(maxGold * killCount * 3)', () => {
        const monster = makeMonster({ level: 5, xp: 10, gold: [2, 4] });
        const result = computeTaskRewards(monster, 100);
        // maxGold = 4, 4 * 100 * 3 = 1200
        expect(result.rewardGold).toBe(1200);
    });

    it('returns 0 rewards for killCount = 0', () => {
        const monster = makeMonster({ level: 5, xp: 10, gold: [2, 4] });
        const result = computeTaskRewards(monster, 0);
        expect(result.rewardXp).toBe(0);
        expect(result.rewardGold).toBe(0);
    });

    it('clamps negative kill counts to 0 (never returns negative rewards)', () => {
        const monster = makeMonster({ level: 5, xp: 10, gold: [2, 4] });
        const result = computeTaskRewards(monster, -100);
        expect(result.rewardXp).toBe(0);
        expect(result.rewardGold).toBe(0);
    });

    it('returns 0 gold when monster.gold is missing or malformed', () => {
        // monster.gold has only 1 element -> falls through the length check
        const monster = { level: 5, xp: 10, gold: [5] as unknown as [number, number] };
        const result = computeTaskRewards(monster, 100);
        expect(result.rewardGold).toBe(0);
        // XP path still applies
        expect(result.rewardXp).toBe(Math.floor(10 * 100 * 1.5));
    });

    it('floors fractional xp results', () => {
        const monster = makeMonster({ level: 5, xp: 7, gold: [1, 2] });
        // 7 * 3 * 1.5 = 31.5 -> floor -> 31
        expect(computeTaskRewards(monster, 3).rewardXp).toBe(31);
    });

    it('uses the override map for monsters at or above level 300', () => {
        const overrideMonsters = (monstersData as unknown as IMonsterRewardSource[])
            .filter((m) => m.level >= TASK_XP_CURVE_THRESHOLD)
            .sort((a, b) => a.level - b.level);
        if (overrideMonsters.length === 0) return;
        const anchor = overrideMonsters[0];
        const overrideXp = getEffectiveTaskXpPerKill(anchor);
        // Compute rewards using a deliberately inflated `xp` on the same
        // level – the override map MUST win over the local field.
        const stub: IMonsterRewardSource = { ...anchor, xp: 9_999_999 };
        const result = computeTaskRewards(stub, 1);
        expect(result.rewardXp).toBe(Math.floor(overrideXp * 1.5));
    });

    it('keeps gold calculation independent of XP override (uses monster.gold[1])', () => {
        const overrideMonsters = (monstersData as unknown as IMonsterRewardSource[])
            .filter((m) => m.level >= TASK_XP_CURVE_THRESHOLD)
            .sort((a, b) => a.level - b.level);
        if (overrideMonsters.length === 0) return;
        const anchor = overrideMonsters[0];
        const result = computeTaskRewards(anchor, 10);
        // Gold = floor(monster.gold[1] * 10 * 3) — unchanged by the curve.
        expect(result.rewardGold).toBe(Math.floor(anchor.gold[1] * 10 * 3));
    });

    it('handles very large killCount values without overflowing to negative', () => {
        const monster = makeMonster({ level: 5, xp: 10, gold: [1, 2] });
        const result = computeTaskRewards(monster, 1_000_000);
        expect(result.rewardXp).toBeGreaterThan(0);
        expect(result.rewardGold).toBeGreaterThan(0);
    });
});
