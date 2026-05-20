/**
 * Task reward calculation based on live monster data.
 *
 * Formula:
 *   rewardXp   = effectiveXpPerKill(monster) * killCount * 1.5
 *   rewardGold = maxGoldFromMonster        * killCount * 3
 *
 * `effectiveXpPerKill` is the monster's native `xp` from monsters.json for
 * levels below 300. **From level 300 onward** the curve is rebuilt as a
 * geometric progression — each successive monster's task XP equals the
 * previous one × 1.05 — so the late-game grind doesn't blow up XP per
 * kill the way the underlying monster XP table does. Gold rewards stay on
 * the original `monster.gold[1] × killCount × 3` curve (only the **task**
 * XP is remapped; combat / hunt XP are untouched).
 *
 * Anchor: the lowest-level monster with `level >= 300` keeps its native
 * XP, then everything above scales from that anchor by 1.05^index.
 */

import monstersData from '../data/monsters.json';

export interface IMonsterRewardSource {
    level: number;
    xp: number;
    gold: [number, number];
}

export interface ITaskRewardResult {
    rewardXp: number;
    rewardGold: number;
}

// ── Late-game XP remap (≥ lvl 300, geometric ×1.05 per next monster) ────────

/** Inclusive lower bound for the geometric override. */
export const TASK_XP_CURVE_THRESHOLD = 300;
/** Per-step multiplier between consecutive (sorted by level) monsters ≥ threshold. */
export const TASK_XP_GEOMETRIC_RATIO = 1.05;

interface IMonsterRowMini { level: number; xp: number }

/**
 * Build a `level → effective xp per kill` map for monsters at or above the
 * threshold. Sorting is stable on level (we don't tie-break further — if two
 * monsters share a level they share the override, which is what the spec
 * asks for: "each next task pays prev × 1.05" walks monster-to-monster).
 */
const buildTaskXpOverride = (): Map<number, number> => {
    const monsters = (monstersData as IMonsterRowMini[])
        .filter((m) => m.level >= TASK_XP_CURVE_THRESHOLD)
        .sort((a, b) => a.level - b.level);
    const map = new Map<number, number>();
    if (monsters.length === 0) return map;
    const anchorXp = Math.max(0, Math.floor(monsters[0].xp));
    monsters.forEach((m, idx) => {
        const eff = Math.floor(anchorXp * Math.pow(TASK_XP_GEOMETRIC_RATIO, idx));
        map.set(m.level, Math.max(1, eff));
    });
    return map;
};

const TASK_XP_BY_LEVEL = buildTaskXpOverride();

/**
 * Returns the per-kill XP that the **task** reward formula should use. For
 * monsters under the threshold this is just `monster.xp`; at or above the
 * threshold the override map kicks in.
 */
export const getEffectiveTaskXpPerKill = (monster: IMonsterRewardSource): number => {
    if (monster.level >= TASK_XP_CURVE_THRESHOLD) {
        const override = TASK_XP_BY_LEVEL.get(monster.level);
        if (override !== undefined) return override;
    }
    return Number.isFinite(monster.xp) ? monster.xp : 0;
};

// ── Public API ──────────────────────────────────────────────────────────────

export const computeTaskRewards = (
    monster: IMonsterRewardSource,
    killCount: number,
): ITaskRewardResult => {
    const xpPerKill = getEffectiveTaskXpPerKill(monster);
    const maxGold = Array.isArray(monster.gold) && monster.gold.length >= 2
        ? monster.gold[1]
        : 0;
    const rewardXp = Math.max(0, Math.floor(xpPerKill * killCount * 1.5));
    const rewardGold = Math.max(0, Math.floor(maxGold * killCount * 3));
    return { rewardXp, rewardGold };
};
