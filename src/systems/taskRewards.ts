/**
 * Task reward calculation based on live monster data.
 *
 * Formula (rebalance April 2026):
 *   rewardXp   = monsterXpPerKill * killCount * 1.5
 *   rewardGold = maxGoldFromMonster * killCount * 3
 *
 * monsterXpPerKill is sourced from the monster's `xp` field in monsters.json
 * (not recomputed from level) so task rewards stay consistent with the actual
 * XP a player receives in combat. Max gold is the upper bound of the monster's
 * capped gold tuple.
 */
export interface IMonsterRewardSource {
    level: number;
    xp: number;
    gold: [number, number];
}

export interface ITaskRewardResult {
    rewardXp: number;
    rewardGold: number;
}

export const computeTaskRewards = (
    monster: IMonsterRewardSource,
    killCount: number,
): ITaskRewardResult => {
    const xpPerKill = Number.isFinite(monster.xp) ? monster.xp : 0;
    const maxGold = Array.isArray(monster.gold) && monster.gold.length >= 2
        ? monster.gold[1]
        : 0;
    const rewardXp = Math.max(0, Math.floor(xpPerKill * killCount * 1.5));
    const rewardGold = Math.max(0, Math.floor(maxGold * killCount * 3));
    return { rewardXp, rewardGold };
};
