import { describe, it, expect } from 'vitest';
import {
    getMonsterUnlockStatus,
    MASTERY_UNLOCK_THRESHOLD,
    type IMonsterLike,
} from './progression';
import type { IMasteryData } from '../stores/masteryStore';

// -- Fixtures -----------------------------------------------------------------

const makeMonster = (overrides: Partial<IMonsterLike> & { id: string; level: number }): IMonsterLike => ({
    name_pl: overrides.id,
    ...overrides,
});

const SAMPLE_MONSTERS: IMonsterLike[] = [
    makeMonster({ id: 'rat', level: 1, name_pl: 'Szczur' }),
    makeMonster({ id: 'spider', level: 2, name_pl: 'Pająk' }),
    makeMonster({ id: 'goblin', level: 3, name_pl: 'Goblin' }),
    makeMonster({ id: 'skeleton', level: 4, name_pl: 'Szkielet' }),
    makeMonster({ id: 'orc', level: 5, name_pl: 'Ork' }),
];

const emptyMasteries: Record<string, IMasteryData> = {};

// -- Constants ----------------------------------------------------------------

describe('MASTERY_UNLOCK_THRESHOLD', () => {
    it('is 1 (need at least one mastery level on the prereq)', () => {
        expect(MASTERY_UNLOCK_THRESHOLD).toBe(1);
    });
});

// -- Rule 1: level gate ------------------------------------------------------

describe('getMonsterUnlockStatus – level gate', () => {
    it('locks a monster whose level exceeds the character level', () => {
        const target = SAMPLE_MONSTERS[4]; // lvl 5
        const status = getMonsterUnlockStatus(target, SAMPLE_MONSTERS, 4, emptyMasteries);
        expect(status.unlocked).toBe(false);
        expect(status.lockKind).toBe('level');
        expect(status.shortLabel).toContain('Lvl 5');
        expect(status.reason).toContain('5');
    });

    it('locks at exactly characterLevel + 1', () => {
        const target = SAMPLE_MONSTERS[3]; // lvl 4
        const status = getMonsterUnlockStatus(target, SAMPLE_MONSTERS, 3, emptyMasteries);
        expect(status.unlocked).toBe(false);
        expect(status.lockKind).toBe('level');
    });

    it('does NOT trip the level gate when monster.level === characterLevel', () => {
        // The first monster (no prereq) is unlocked when the player's
        // level matches the monster's level exactly.
        const target = SAMPLE_MONSTERS[0]; // lvl 1
        const status = getMonsterUnlockStatus(target, SAMPLE_MONSTERS, 1, emptyMasteries);
        expect(status.unlocked).toBe(true);
    });

    it('does NOT trip when characterLevel is much higher than monster.level', () => {
        const target = SAMPLE_MONSTERS[0]; // lvl 1
        const status = getMonsterUnlockStatus(target, SAMPLE_MONSTERS, 999, emptyMasteries);
        expect(status.unlocked).toBe(true);
    });

    it('level gate takes priority over mastery gate', () => {
        // Even with mastery on previous, level gate still locks.
        const masteries: Record<string, IMasteryData> = {
            spider: { level: 5 }, // would otherwise unlock goblin
        };
        const target = SAMPLE_MONSTERS[2]; // lvl 3
        const status = getMonsterUnlockStatus(target, SAMPLE_MONSTERS, 1, masteries);
        expect(status.unlocked).toBe(false);
        expect(status.lockKind).toBe('level');
    });
});

// -- Rule 2: mastery gate -----------------------------------------------------

describe('getMonsterUnlockStatus – mastery gate', () => {
    it('locks a monster when the previous monster has mastery 0', () => {
        const target = SAMPLE_MONSTERS[1]; // lvl 2 (prereq: rat lvl 1)
        const status = getMonsterUnlockStatus(target, SAMPLE_MONSTERS, 50, emptyMasteries);
        expect(status.unlocked).toBe(false);
        expect(status.lockKind).toBe('mastery');
        expect(status.requiredMonster?.id).toBe('rat');
        expect(status.shortLabel).toContain('Szczur');
    });

    it('unlocks a monster when the previous monster has mastery >= 1', () => {
        const masteries: Record<string, IMasteryData> = {
            rat: { level: 1 },
        };
        const target = SAMPLE_MONSTERS[1]; // lvl 2
        const status = getMonsterUnlockStatus(target, SAMPLE_MONSTERS, 50, masteries);
        expect(status.unlocked).toBe(true);
        expect(status.requiredMonster).toBeUndefined();
    });

    it('unlocks regardless of higher mastery levels on prereq', () => {
        const masteries: Record<string, IMasteryData> = {
            rat: { level: 25 }, // max mastery
        };
        const target = SAMPLE_MONSTERS[1];
        expect(getMonsterUnlockStatus(target, SAMPLE_MONSTERS, 50, masteries).unlocked).toBe(true);
    });

    it('locks at threshold - 1 (no fractional unlock)', () => {
        // Mastery level data must satisfy >= 1 per the threshold. Level 0
        // is identical to "missing".
        const masteries: Record<string, IMasteryData> = {
            rat: { level: 0 },
        };
        const target = SAMPLE_MONSTERS[1];
        expect(getMonsterUnlockStatus(target, SAMPLE_MONSTERS, 50, masteries).unlocked).toBe(false);
    });

    it('unlocks the first (lowest level) monster with no prereq', () => {
        const target = SAMPLE_MONSTERS[0];
        const status = getMonsterUnlockStatus(target, SAMPLE_MONSTERS, 1, emptyMasteries);
        expect(status.unlocked).toBe(true);
        expect(status.requiredMonster).toBeUndefined();
        expect(status.lockKind).toBeUndefined();
    });

    it('reports requiredMonster as the immediate previous in level-sorted order', () => {
        const target = SAMPLE_MONSTERS[2]; // goblin lvl 3 (prereq: spider lvl 2)
        const status = getMonsterUnlockStatus(target, SAMPLE_MONSTERS, 50, emptyMasteries);
        expect(status.requiredMonster?.id).toBe('spider');
        expect(status.requiredMonster?.level).toBe(2);
    });

    it('sorts internally so input order does not matter', () => {
        // Pass monsters in REVERSE order – algorithm should still resolve
        // the prereq chain by level.
        const reversed = [...SAMPLE_MONSTERS].reverse();
        const target = SAMPLE_MONSTERS[2]; // goblin lvl 3
        const status = getMonsterUnlockStatus(target, reversed, 50, emptyMasteries);
        expect(status.requiredMonster?.id).toBe('spider'); // still finds lvl 2
    });

    it('uses 0 mastery when the prereq entry is missing entirely', () => {
        const target = SAMPLE_MONSTERS[3]; // skeleton, prereq: goblin
        const masteries: Record<string, IMasteryData> = {
            // No goblin entry -> defaults to 0 -> locked.
        };
        const status = getMonsterUnlockStatus(target, SAMPLE_MONSTERS, 100, masteries);
        expect(status.unlocked).toBe(false);
        expect(status.requiredMonster?.id).toBe('goblin');
    });

    it('handles a monster that is not in allMonsters (findIndex = -1)', () => {
        // Target not in the list — findPrerequisiteMonster returns
        // undefined (idx <= 0 path), so the function reports unlocked.
        const ghost: IMonsterLike = { id: 'ghost', level: 1, name_pl: 'Duch' };
        const status = getMonsterUnlockStatus(ghost, SAMPLE_MONSTERS, 50, emptyMasteries);
        expect(status.unlocked).toBe(true);
    });

    it('shortLabel for mastery lock contains the prereq Polish name', () => {
        const target = SAMPLE_MONSTERS[2]; // goblin (prereq: spider)
        const status = getMonsterUnlockStatus(target, SAMPLE_MONSTERS, 50, emptyMasteries);
        expect(status.shortLabel).toContain('Pająk');
    });

    it('reason text references the prereq monster name and level', () => {
        const target = SAMPLE_MONSTERS[1]; // spider, prereq: rat lvl 1
        const status = getMonsterUnlockStatus(target, SAMPLE_MONSTERS, 50, emptyMasteries);
        expect(status.reason).toContain('Szczur');
        expect(status.reason).toContain('1');
    });
});

// -- Boundary: empty / single monster lists -----------------------------------

describe('getMonsterUnlockStatus – list boundaries', () => {
    it('handles a single-monster list (always unlockable up to level)', () => {
        const single = [SAMPLE_MONSTERS[0]];
        const status = getMonsterUnlockStatus(single[0], single, 1, emptyMasteries);
        expect(status.unlocked).toBe(true);
    });

    it('handles an empty allMonsters list gracefully (target falls through to unlocked)', () => {
        // findIndex returns -1 -> no prereq -> unlocked (after passing level gate).
        const target = SAMPLE_MONSTERS[0];
        const status = getMonsterUnlockStatus(target, [], 5, emptyMasteries);
        expect(status.unlocked).toBe(true);
    });

    it('chain progression: unlocking N enables N+1 only', () => {
        // Mastery only on rat -> spider unlocked, goblin still locked.
        const masteries: Record<string, IMasteryData> = {
            rat: { level: 1 },
        };
        expect(getMonsterUnlockStatus(SAMPLE_MONSTERS[1], SAMPLE_MONSTERS, 50, masteries).unlocked).toBe(true);
        expect(getMonsterUnlockStatus(SAMPLE_MONSTERS[2], SAMPLE_MONSTERS, 50, masteries).unlocked).toBe(false);
        expect(getMonsterUnlockStatus(SAMPLE_MONSTERS[3], SAMPLE_MONSTERS, 50, masteries).unlocked).toBe(false);
    });

    it('full chain unlock: every prereq mastered -> every monster unlocked', () => {
        const masteries: Record<string, IMasteryData> = {
            rat: { level: 1 },
            spider: { level: 1 },
            goblin: { level: 1 },
            skeleton: { level: 1 },
        };
        for (const m of SAMPLE_MONSTERS) {
            expect(getMonsterUnlockStatus(m, SAMPLE_MONSTERS, 50, masteries).unlocked).toBe(true);
        }
    });
});
