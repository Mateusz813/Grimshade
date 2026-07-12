
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


export const TASK_XP_CURVE_THRESHOLD = 300;
export const TASK_XP_GEOMETRIC_RATIO = 1.05;

interface IMonsterRowMini { level: number; xp: number }

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

export const getEffectiveTaskXpPerKill = (monster: IMonsterRewardSource): number => {
    if (monster.level >= TASK_XP_CURVE_THRESHOLD) {
        const override = TASK_XP_BY_LEVEL.get(monster.level);
        if (override !== undefined) return override;
    }
    return Number.isFinite(monster.xp) ? monster.xp : 0;
};


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
