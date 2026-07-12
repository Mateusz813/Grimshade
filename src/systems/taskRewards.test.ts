import { describe, it, expect } from 'vitest';
import {
    computeTaskRewards,
    getEffectiveTaskXpPerKill,
    TASK_XP_CURVE_THRESHOLD,
    TASK_XP_GEOMETRIC_RATIO,
    type IMonsterRewardSource,
} from './taskRewards';
import monstersData from '../data/monsters.json';
import tasksData from '../data/tasks.json';

const makeMonster = (overrides?: Partial<IMonsterRewardSource>): IMonsterRewardSource => ({
    level: 1,
    xp: 10,
    gold: [1, 5],
    ...overrides,
});


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
        const monster = makeMonster({ level: 300, xp: 999_999 });
        const result = getEffectiveTaskXpPerKill(monster);
        expect(result).toBeGreaterThan(0);
        expect(result).not.toBe(999_999);
    });

    it('scales geometrically by 1.05 across consecutive override-level monsters', () => {
        const overrideMonsters = (monstersData as unknown as IMonsterRewardSource[])
            .filter((m) => m.level >= TASK_XP_CURVE_THRESHOLD)
            .sort((a, b) => a.level - b.level);
        if (overrideMonsters.length < 2) {
            return;
        }
        const a = overrideMonsters[0];
        const b = overrideMonsters[1];
        const xpA = getEffectiveTaskXpPerKill(a);
        const xpB = getEffectiveTaskXpPerKill(b);
        const expected = Math.max(1, Math.floor(xpA * TASK_XP_GEOMETRIC_RATIO));
        expect(xpB).toBe(expected);
    });

    it('clamps override result to a minimum of 1', () => {
        const overrideMonsters = (monstersData as unknown as IMonsterRewardSource[])
            .filter((m) => m.level >= TASK_XP_CURVE_THRESHOLD);
        for (const m of overrideMonsters) {
            expect(getEffectiveTaskXpPerKill(m)).toBeGreaterThanOrEqual(1);
        }
    });
});


describe('computeTaskRewards', () => {
    it('computes xp = floor(xp * killCount * 1.5) for a sub-threshold monster', () => {
        const monster = makeMonster({ level: 5, xp: 10, gold: [2, 4] });
        const result = computeTaskRewards(monster, 100);
        expect(result.rewardXp).toBe(1500);
    });

    it('computes gold = floor(maxGold * killCount * 3)', () => {
        const monster = makeMonster({ level: 5, xp: 10, gold: [2, 4] });
        const result = computeTaskRewards(monster, 100);
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
        const monster = { level: 5, xp: 10, gold: [5] as unknown as [number, number] };
        const result = computeTaskRewards(monster, 100);
        expect(result.rewardGold).toBe(0);
        expect(result.rewardXp).toBe(Math.floor(10 * 100 * 1.5));
    });

    it('floors fractional xp results', () => {
        const monster = makeMonster({ level: 5, xp: 7, gold: [1, 2] });
        expect(computeTaskRewards(monster, 3).rewardXp).toBe(31);
    });

    it('uses the override map for monsters at or above level 300', () => {
        const overrideMonsters = (monstersData as unknown as IMonsterRewardSource[])
            .filter((m) => m.level >= TASK_XP_CURVE_THRESHOLD)
            .sort((a, b) => a.level - b.level);
        if (overrideMonsters.length === 0) return;
        const anchor = overrideMonsters[0];
        const overrideXp = getEffectiveTaskXpPerKill(anchor);
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
        expect(result.rewardGold).toBe(Math.floor(anchor.gold[1] * 10 * 3));
    });

    it('handles very large killCount values without overflowing to negative', () => {
        const monster = makeMonster({ level: 5, xp: 10, gold: [1, 2] });
        const result = computeTaskRewards(monster, 1_000_000);
        expect(result.rewardXp).toBeGreaterThan(0);
        expect(result.rewardGold).toBeGreaterThan(0);
    });
});

describe('100k-kill task tier', () => {
    const tasks = tasksData as Array<{ id: string; monsterId: string; killCount: number }>;

    it('every monster with a 10k task also has a 100k task', () => {
        const with10k = new Set(tasks.filter((t) => t.killCount === 10000).map((t) => t.monsterId));
        const with100k = new Set(tasks.filter((t) => t.killCount === 100000).map((t) => t.monsterId));
        expect(with100k.size).toBe(with10k.size);
        expect(with100k.size).toBeGreaterThan(0);
        for (const id of with10k) expect(with100k.has(id)).toBe(true);
    });

    it('100k tasks are id `<monster>_100000` with killCount 100000', () => {
        const k = tasks.filter((t) => t.killCount === 100000);
        for (const t of k) {
            expect(t.id).toBe(`${t.monsterId}_100000`);
            expect(t.killCount).toBe(100000);
        }
    });

    it('reward is linear: the 100k task pays exactly 10x the 10k task', () => {
        const monsters = monstersData as unknown as Array<IMonsterRewardSource & { id: string }>;
        const rat = monsters.find((m) => m.id === 'rat')!;
        const r10k = computeTaskRewards(rat, 10000);
        const r100k = computeTaskRewards(rat, 100000);
        expect(r100k.rewardGold).toBe(r10k.rewardGold * 10);
        expect(r100k.rewardXp).toBe(r10k.rewardXp * 10);
    });
});
