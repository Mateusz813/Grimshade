import type { IMasteryData } from '../stores/masteryStore';


export interface IMonsterLike {
    id: string;
    level: number;
    name_pl: string;
}

export interface IUnlockStatus {
    unlocked: boolean;
    shortLabel?: string;
    reason?: string;
    requiredMonster?: IMonsterLike;
    lockKind?: 'level' | 'mastery';
}

export const MASTERY_UNLOCK_THRESHOLD = 1;

const findPrerequisiteMonster = (
    target: IMonsterLike,
    sortedMonsters: IMonsterLike[],
): IMonsterLike | undefined => {
    const idx = sortedMonsters.findIndex((m) => m.id === target.id);
    if (idx <= 0) return undefined;
    return sortedMonsters[idx - 1];
};

export const getMonsterUnlockStatus = (
    monster: IMonsterLike,
    allMonsters: IMonsterLike[],
    characterLevel: number,
    masteries: Record<string, IMasteryData>,
): IUnlockStatus => {
    if (monster.level > characterLevel) {
        return {
            unlocked: false,
            shortLabel: `:locked: Lvl ${monster.level}`,
            reason: `Wymaga poziomu postaci ${monster.level}`,
            lockKind: 'level',
        };
    }

    const sorted = [...allMonsters].sort((a, b) => a.level - b.level);
    const prereq = findPrerequisiteMonster(monster, sorted);
    if (!prereq) return { unlocked: true };

    const prereqLevel = masteries[prereq.id]?.level ?? 0;
    if (prereqLevel < MASTERY_UNLOCK_THRESHOLD) {
        return {
            unlocked: false,
            shortLabel: `:locked: Mastery: ${prereq.name_pl}`,
            reason: `Zdobądź Mastery 1/25 na ${prereq.name_pl} (Lvl ${prereq.level}) żeby odblokować`,
            requiredMonster: prereq,
            lockKind: 'mastery',
        };
    }

    return { unlocked: true };
};
