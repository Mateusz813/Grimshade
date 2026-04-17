import type { IMasteryData } from '../stores/masteryStore';

/**
 * Progression gating system.
 *
 * Rules:
 *  1. A monster is locked if its `level` exceeds the player's `characterLevel`.
 *  2. Additionally, a monster is locked until the **previous** monster in the
 *     level-sorted list has mastery level >= 1. The very first (lowest level)
 *     monster has no prerequisite and is always unlocked as long as rule #1
 *     is satisfied.
 *
 * This creates a stepped progression: player must earn at least one mastery
 * level on monster N before they can engage monster N+1, and so on.
 */

export interface IMonsterLike {
    id: string;
    level: number;
    name_pl: string;
}

export interface IUnlockStatus {
    unlocked: boolean;
    /** Short badge text, e.g. "🔒 Lvl 3" or "🔒 Mastery: Szczur". */
    shortLabel?: string;
    /** Full human-readable reason (title/tooltip text). */
    reason?: string;
    /** The prerequisite monster (if locked due to mastery requirement). */
    requiredMonster?: IMonsterLike;
    /** Kind of lock for styling / logic. */
    lockKind?: 'level' | 'mastery';
}

/** Minimum mastery level required on the previous monster to unlock the next. */
export const MASTERY_UNLOCK_THRESHOLD = 1;

/**
 * Given a sorted monsters array and a target monster, find the "previous"
 * monster that must be mastered before the target can be fought. Monsters
 * are sorted by level; if several share a level we pick the one immediately
 * before the target in the sorted order.
 */
const findPrerequisiteMonster = (
    target: IMonsterLike,
    sortedMonsters: IMonsterLike[],
): IMonsterLike | undefined => {
    const idx = sortedMonsters.findIndex((m) => m.id === target.id);
    if (idx <= 0) return undefined;
    return sortedMonsters[idx - 1];
};

/**
 * Determine if a monster is unlocked for the player.
 *
 * @param monster           The monster to check.
 * @param allMonsters       Full list of monsters (will be sorted by level).
 * @param characterLevel    Current player level.
 * @param masteries         Mastery state keyed by monster id.
 */
export const getMonsterUnlockStatus = (
    monster: IMonsterLike,
    allMonsters: IMonsterLike[],
    characterLevel: number,
    masteries: Record<string, IMasteryData>,
): IUnlockStatus => {
    // Rule 1: level gate
    if (monster.level > characterLevel) {
        return {
            unlocked: false,
            shortLabel: `🔒 Lvl ${monster.level}`,
            reason: `Wymaga poziomu postaci ${monster.level}`,
            lockKind: 'level',
        };
    }

    // Rule 2: mastery gate on the previous monster
    const sorted = [...allMonsters].sort((a, b) => a.level - b.level);
    const prereq = findPrerequisiteMonster(monster, sorted);
    if (!prereq) return { unlocked: true };

    const prereqLevel = masteries[prereq.id]?.level ?? 0;
    if (prereqLevel < MASTERY_UNLOCK_THRESHOLD) {
        return {
            unlocked: false,
            shortLabel: `🔒 Mastery: ${prereq.name_pl}`,
            reason: `Zdobądź Mastery 1/25 na ${prereq.name_pl} (Lvl ${prereq.level}) żeby odblokować`,
            requiredMonster: prereq,
            lockKind: 'mastery',
        };
    }

    return { unlocked: true };
};
