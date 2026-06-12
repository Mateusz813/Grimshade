import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSkillStore } from './skillStore';
import { useBuffStore } from './buffStore';
import { useCharacterStore, type ICharacter } from './characterStore';
import {
    skillXpToNextLevel,
    mlvlXpPerAttack,
    shieldingXpPerBlock,
} from '../systems/skillSystem';
import { EMPTY_EQUIPMENT } from '../systems/itemSystem';

// -- Helpers ------------------------------------------------------------------

const SKILL_INITIAL_STATE = {
    skillLevels: {},
    skillXp: {},
    activeSkillSlots: [null, null, null, null] as [
        string | null, string | null, string | null, string | null,
    ],
    skillUpgradeLevels: {},
    unlockedSkills: {},
    offlineTrainingSkillId: null,
    trainingSegmentStartedAt: null,
    trainingAccumulatedEffectiveSeconds: 0,
    trainingCurrentSpeedMultiplier: 2,
};

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Tester',
    class: 'Knight',
    level: 1,
    xp: 0,
    hp: 100,
    max_hp: 100,
    mp: 30,
    max_mp: 30,
    attack: 10,
    defense: 5,
    attack_speed: 2.0,
    crit_chance: 3,
    crit_damage: 150,
    magic_level: 0,
    hp_regen: 0,
    mp_regen: 0,
    gold: 0,
    stat_points: 0,
    highest_level: 1,
    equipment: {},
    created_at: '',
    updated_at: '',
    ...overrides,
} as ICharacter);

beforeEach(() => {
    useSkillStore.setState(SKILL_INITIAL_STATE);
    useBuffStore.setState({ allBuffs: [], combatSpeedMult: 1 });
    useCharacterStore.setState({ character: makeChar(), isLoading: false });
});

// -- initSkills ---------------------------------------------------------------

describe('initSkills', () => {
    it('inits class weapon skills + magic_level at level 0 / xp 0', () => {
        useSkillStore.getState().initSkills('Knight');
        const s = useSkillStore.getState();
        // Knight has sword_fighting + shielding, plus magic_level seeded for all.
        expect(s.skillLevels['sword_fighting']).toBe(0);
        expect(s.skillLevels['shielding']).toBe(0);
        expect(s.skillLevels['magic_level']).toBe(0);
        expect(s.skillXp['sword_fighting']).toBe(0);
    });

    it('does NOT overwrite an existing skill level', () => {
        useSkillStore.setState({ skillLevels: { sword_fighting: 25 }, skillXp: { sword_fighting: 99 } });
        useSkillStore.getState().initSkills('Knight');
        expect(useSkillStore.getState().skillLevels['sword_fighting']).toBe(25);
        expect(useSkillStore.getState().skillXp['sword_fighting']).toBe(99);
    });
});

// -- addSkillXp ---------------------------------------------------------------

describe('addSkillXp', () => {
    it('accumulates XP without levelling up', () => {
        const gained = useSkillStore.getState().addSkillXp('sword_fighting', 50);
        expect(gained).toBe(0);
        expect(useSkillStore.getState().skillXp['sword_fighting']).toBe(50);
        expect(useSkillStore.getState().skillLevels['sword_fighting']).toBe(0);
    });

    it('levels up exactly when threshold is reached', () => {
        const need = skillXpToNextLevel(0); // 100 by default
        const gained = useSkillStore.getState().addSkillXp('sword_fighting', need);
        expect(gained).toBe(1);
        expect(useSkillStore.getState().skillLevels['sword_fighting']).toBe(1);
        expect(useSkillStore.getState().skillXp['sword_fighting']).toBe(0);
    });

    it('handles multiple level-ups in one call', () => {
        const need = skillXpToNextLevel(0) + skillXpToNextLevel(1) + skillXpToNextLevel(2);
        const gained = useSkillStore.getState().addSkillXp('sword_fighting', need);
        expect(gained).toBe(3);
        expect(useSkillStore.getState().skillLevels['sword_fighting']).toBe(3);
    });
});

// -- applyDeathPenalty --------------------------------------------------------

describe('applyDeathPenalty', () => {
    it('halves total banked XP across all trainable skills (50% default)', () => {
        // Knight skills + general stats start at lvl 5 each.
        useSkillStore.setState({
            skillLevels: {
                sword_fighting: 5,
                shielding: 5,
                magic_level: 5,
                max_hp: 5,
            },
            skillXp: {
                sword_fighting: 0,
                shielding: 0,
                magic_level: 0,
                max_hp: 0,
            },
        });
        useSkillStore.getState().applyDeathPenalty('Knight');
        // After losing 50% of banked XP, levels should be roughly halved.
        // Exact level depends on the cumulative XP curve — just verify each
        // skill dropped below its starting level.
        const s = useSkillStore.getState();
        expect(s.skillLevels['sword_fighting']).toBeLessThan(5);
        expect(s.skillLevels['shielding']).toBeLessThan(5);
        expect(s.skillLevels['magic_level']).toBeLessThan(5);
        expect(s.skillLevels['max_hp']).toBeLessThan(5);
    });

    it('applies the requested loss percentage (e.g. 0.1 for flee)', () => {
        // Big skill so 0.1% loss is observable
        useSkillStore.setState({
            skillLevels: { sword_fighting: 50 },
            skillXp: { sword_fighting: 0 },
        });
        useSkillStore.getState().applyDeathPenalty('Knight', 0.1);
        // 0.1% off a level-50 skill should leave it still at 50 or 49.
        const level = useSkillStore.getState().skillLevels['sword_fighting'];
        expect(level).toBeGreaterThanOrEqual(49);
        expect(level).toBeLessThanOrEqual(50);
    });

    it('is a no-op when lossPct <= 0', () => {
        useSkillStore.setState({
            skillLevels: { sword_fighting: 10 },
            skillXp: { sword_fighting: 42 },
        });
        useSkillStore.getState().applyDeathPenalty('Knight', 0);
        expect(useSkillStore.getState().skillLevels['sword_fighting']).toBe(10);
        expect(useSkillStore.getState().skillXp['sword_fighting']).toBe(42);
    });

    it('skips skills that are completely unset (lvl 0, xp 0)', () => {
        // Make sure addSkillXp doesn't break on undefined skill ids.
        // applyDeathPenalty must early-continue for empty skills so we
        // don't accidentally end up with NaN levels.
        useSkillStore.setState({ skillLevels: {}, skillXp: {} });
        useSkillStore.getState().applyDeathPenalty('Knight', 50);
        // All trainable skills are zero — no entries should be added either.
        for (const v of Object.values(useSkillStore.getState().skillLevels)) {
            expect(v).toBe(0);
        }
    });
});

// -- setActiveSkillSlot / purgeLockedSkillSlots -------------------------------

describe('setActiveSkillSlot', () => {
    it('sets a skill into a slot', () => {
        useSkillStore.getState().setActiveSkillSlot(0, 'shield_bash');
        expect(useSkillStore.getState().activeSkillSlots[0]).toBe('shield_bash');
    });

    it('clears a slot when given null', () => {
        useSkillStore.setState({ activeSkillSlots: ['shield_bash', null, null, null] });
        useSkillStore.getState().setActiveSkillSlot(0, null);
        expect(useSkillStore.getState().activeSkillSlots[0]).toBeNull();
    });

    it('removes the skill from any other slot it currently occupies', () => {
        // Avoid duplicates: a skill can only live in one slot at a time.
        useSkillStore.setState({ activeSkillSlots: ['shield_bash', null, null, null] });
        useSkillStore.getState().setActiveSkillSlot(2, 'shield_bash');
        const slots = useSkillStore.getState().activeSkillSlots;
        expect(slots[0]).toBeNull();
        expect(slots[2]).toBe('shield_bash');
    });
});

describe('purgeLockedSkillSlots', () => {
    it('clears slots holding skills whose unlockLevel > currentLevel', () => {
        // ultimate_slash unlocks at lvl 100 — a lvl 50 Knight should not
        // be able to keep it slotted after a death-penalty level drop.
        useSkillStore.setState({
            activeSkillSlots: ['shield_bash', 'ultimate_slash', null, null],
        });
        const cleared = useSkillStore.getState().purgeLockedSkillSlots('Knight', 50);
        expect(cleared).toBe(1);
        const slots = useSkillStore.getState().activeSkillSlots;
        expect(slots[0]).toBe('shield_bash'); // unlocked at 5, kept
        expect(slots[1]).toBeNull();           // ultimate_slash purged
    });

    it('returns 0 when nothing needs purging', () => {
        useSkillStore.setState({ activeSkillSlots: ['shield_bash', null, null, null] });
        const cleared = useSkillStore.getState().purgeLockedSkillSlots('Knight', 100);
        expect(cleared).toBe(0);
    });

    it('returns 0 when slots are empty', () => {
        const cleared = useSkillStore.getState().purgeLockedSkillSlots('Knight', 1);
        expect(cleared).toBe(0);
    });
});

// -- isSkillUnlocked / unlockSkill --------------------------------------------

describe('isSkillUnlocked', () => {
    it('returns false by default', () => {
        expect(useSkillStore.getState().isSkillUnlocked('shield_bash')).toBe(false);
    });

    it('returns true after an unlock', () => {
        useSkillStore.setState({ unlockedSkills: { shield_bash: true } });
        expect(useSkillStore.getState().isSkillUnlocked('shield_bash')).toBe(true);
    });
});

describe('unlockSkill', () => {
    it('consumes a spell chest + gold and marks the skill unlocked', () => {
        const useChests = vi.fn().mockReturnValue(true);
        const spendGold = vi.fn().mockReturnValue(true);
        const ok = useSkillStore.getState().unlockSkill('shield_bash', 100, spendGold, 5, useChests);
        expect(ok).toBe(true);
        expect(useChests).toHaveBeenCalledWith(5, 1);
        expect(spendGold).toHaveBeenCalledWith(100);
        expect(useSkillStore.getState().isSkillUnlocked('shield_bash')).toBe(true);
    });

    it('returns true and skips work if already unlocked (idempotent)', () => {
        useSkillStore.setState({ unlockedSkills: { shield_bash: true } });
        const useChests = vi.fn();
        const spendGold = vi.fn();
        const ok = useSkillStore.getState().unlockSkill('shield_bash', 100, spendGold, 5, useChests);
        expect(ok).toBe(true);
        expect(useChests).not.toHaveBeenCalled();
        expect(spendGold).not.toHaveBeenCalled();
    });

    it('returns false when chest spend fails (no unlock)', () => {
        const useChests = vi.fn().mockReturnValue(false);
        const spendGold = vi.fn();
        const ok = useSkillStore.getState().unlockSkill('shield_bash', 100, spendGold, 5, useChests);
        expect(ok).toBe(false);
        expect(spendGold).not.toHaveBeenCalled();
        expect(useSkillStore.getState().isSkillUnlocked('shield_bash')).toBe(false);
    });

    it('returns false when gold spend fails', () => {
        const useChests = vi.fn().mockReturnValue(true);
        const spendGold = vi.fn().mockReturnValue(false);
        const ok = useSkillStore.getState().unlockSkill('shield_bash', 100, spendGold, 5, useChests);
        expect(ok).toBe(false);
        expect(useSkillStore.getState().isSkillUnlocked('shield_bash')).toBe(false);
    });
});

describe('unlockAllActiveSkills', () => {
    it('unlocks every skill in the list', () => {
        useSkillStore.getState().unlockAllActiveSkills(['shield_bash', 'whirlwind']);
        const s = useSkillStore.getState();
        expect(s.isSkillUnlocked('shield_bash')).toBe(true);
        expect(s.isSkillUnlocked('whirlwind')).toBe(true);
    });
});

// -- upgradeActiveSkill -------------------------------------------------------

describe('upgradeActiveSkill', () => {
    it('returns failure shape when player has not enough gold', () => {
        const spendGold = vi.fn();
        const useChests = vi.fn().mockReturnValue(true);
        const getChestCount = vi.fn().mockReturnValue(99);
        const result = useSkillStore.getState().upgradeActiveSkill(
            'shield_bash',
            0, // insufficient gold
            spendGold,
            5,
            useChests,
            getChestCount,
        );
        expect(result.success).toBe(false);
        expect(result.newLevel).toBe(0);
        expect(spendGold).not.toHaveBeenCalled();
    });

    it('returns failure shape when player has not enough chests', () => {
        const spendGold = vi.fn().mockReturnValue(true);
        const useChests = vi.fn().mockReturnValue(true);
        const getChestCount = vi.fn().mockReturnValue(0); // no chests
        const result = useSkillStore.getState().upgradeActiveSkill(
            'shield_bash',
            10_000_000, // plenty of gold
            spendGold,
            5,
            useChests,
            getChestCount,
        );
        expect(result.success).toBe(false);
        expect(spendGold).not.toHaveBeenCalled();
        expect(useChests).not.toHaveBeenCalled();
    });

    it('bumps skillUpgradeLevels on success (Math.random forced low)', () => {
        // Force success at +1 -> target=1, success rate = 100% anyway.
        // We still mock Math.random to be safe across levels.
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
        const spendGold = vi.fn().mockReturnValue(true);
        const useChests = vi.fn().mockReturnValue(true);
        const getChestCount = vi.fn().mockReturnValue(99);
        const result = useSkillStore.getState().upgradeActiveSkill(
            'shield_bash',
            10_000_000,
            spendGold,
            5,
            useChests,
            getChestCount,
        );
        expect(result.success).toBe(true);
        expect(result.newLevel).toBe(1);
        expect(useSkillStore.getState().getSkillUpgradeLevel('shield_bash')).toBe(1);
        randomSpy.mockRestore();
    });

    it('keeps level on fail but reports chests + gold spent (Math.random forced high)', () => {
        // Target = +2 (90% success). Force random=0.99 -> fail.
        useSkillStore.setState({ skillUpgradeLevels: { shield_bash: 1 } });
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
        const spendGold = vi.fn().mockReturnValue(true);
        const useChests = vi.fn().mockReturnValue(true);
        const getChestCount = vi.fn().mockReturnValue(99);
        const result = useSkillStore.getState().upgradeActiveSkill(
            'shield_bash',
            10_000_000,
            spendGold,
            5,
            useChests,
            getChestCount,
        );
        expect(result.success).toBe(false);
        expect(result.newLevel).toBe(1); // stays at +1
        expect(result.goldSpent).toBeGreaterThan(0);
        // Skill upgrade level unchanged in state
        expect(useSkillStore.getState().getSkillUpgradeLevel('shield_bash')).toBe(1);
        randomSpy.mockRestore();
    });
});

// -- Weapon / MLVL XP from attacks / blocks -----------------------------------

describe('addShieldingXpOnBlock', () => {
    it('grants shielding XP scaled by current level', () => {
        useSkillStore.setState({
            skillLevels: { shielding: 0 },
            skillXp: { shielding: 0 },
        });
        const gained = useSkillStore.getState().addShieldingXpOnBlock();
        // levelsGained for a single block at lvl 0 is usually 0 (small XP).
        expect(gained).toBeGreaterThanOrEqual(0);
        const xp = useSkillStore.getState().skillXp['shielding'] ?? 0;
        const level = useSkillStore.getState().skillLevels['shielding'] ?? 0;
        // Some XP has been banked — either current xp > 0 or level > 0.
        expect(xp + level).toBeGreaterThan(0);
        expect(xp + level).toBe(shieldingXpPerBlock(0));
    });
});

describe('addMlvlXpFromAttack', () => {
    it('returns 0 for non-magic classes (Knight)', () => {
        const gained = useSkillStore.getState().addMlvlXpFromAttack('Knight');
        expect(gained).toBe(0);
        // No magic_level XP should be added either.
        expect(useSkillStore.getState().skillXp['magic_level'] ?? 0).toBe(0);
    });

    it('adds MLVL XP for magic classes (Mage)', () => {
        useSkillStore.setState({
            skillLevels: { magic_level: 0 },
            skillXp: { magic_level: 0 },
        });
        useSkillStore.getState().addMlvlXpFromAttack('Mage');
        // Some XP should have been added — exact value follows mlvlXpPerAttack(0).
        const xp = useSkillStore.getState().skillXp['magic_level'] ?? 0;
        const lvl = useSkillStore.getState().skillLevels['magic_level'] ?? 0;
        expect(xp + lvl).toBe(mlvlXpPerAttack(0));
    });
});

describe('addWeaponSkillXpFromAttack', () => {
    it('adds 1 XP to the class weapon skill (Knight -> sword_fighting)', () => {
        useSkillStore.setState({
            skillLevels: { sword_fighting: 0 },
            skillXp: { sword_fighting: 0 },
        });
        useSkillStore.getState().addWeaponSkillXpFromAttack('Knight');
        expect(useSkillStore.getState().skillXp['sword_fighting']).toBe(1);
    });

    it('skips when the class weapon skill IS magic_level (avoid double-dip)', () => {
        // Mage's weapon skill is magic_level and they gain MLVL from
        // attacks via addMlvlXpFromAttack — skipping here prevents double-counting.
        const before = useSkillStore.getState().skillXp['magic_level'] ?? 0;
        const gained = useSkillStore.getState().addWeaponSkillXpFromAttack('Mage');
        expect(gained).toBe(0);
        expect(useSkillStore.getState().skillXp['magic_level'] ?? 0).toBe(before);
    });
});

describe('addMlvlXpFromSkill', () => {
    it('grants more XP for magic classes than for melee (3× rate)', () => {
        useSkillStore.setState({ skillLevels: { magic_level: 0 }, skillXp: { magic_level: 0 } });
        useSkillStore.getState().addMlvlXpFromSkill('Mage');
        const mage = useSkillStore.getState().skillXp['magic_level'];

        useSkillStore.setState({ skillLevels: { magic_level: 0 }, skillXp: { magic_level: 0 } });
        useSkillStore.getState().addMlvlXpFromSkill('Knight');
        const knight = useSkillStore.getState().skillXp['magic_level'];

        expect(mage).toBeGreaterThan(knight);
    });
});

// -- Offline training ---------------------------------------------------------

describe('selectTrainingStat', () => {
    it('selects the new skill and starts a fresh segment', () => {
        useSkillStore.getState().selectTrainingStat('sword_fighting');
        const s = useSkillStore.getState();
        expect(s.offlineTrainingSkillId).toBe('sword_fighting');
        expect(s.trainingSegmentStartedAt).not.toBeNull();
    });
});

describe('pauseTraining / resumeTraining', () => {
    it('pause sets segmentStartedAt to null', () => {
        useSkillStore.getState().selectTrainingStat('sword_fighting');
        useSkillStore.getState().pauseTraining();
        expect(useSkillStore.getState().trainingSegmentStartedAt).toBeNull();
    });

    it('resume starts a new segment when paused', () => {
        useSkillStore.getState().selectTrainingStat('sword_fighting');
        useSkillStore.getState().pauseTraining();
        useSkillStore.getState().resumeTraining();
        expect(useSkillStore.getState().trainingSegmentStartedAt).not.toBeNull();
    });

    it('pause is a no-op when no skill is selected', () => {
        useSkillStore.getState().pauseTraining();
        expect(useSkillStore.getState().offlineTrainingSkillId).toBeNull();
    });

    it('resume is a no-op when no skill is selected', () => {
        useSkillStore.getState().resumeTraining();
        expect(useSkillStore.getState().trainingSegmentStartedAt).toBeNull();
    });
});

describe('collectOfflineTraining', () => {
    it('returns 0 when no skill is selected', () => {
        const xp = useSkillStore.getState().collectOfflineTraining();
        expect(xp).toBe(0);
    });

    it('credits XP for a skill that has been training', () => {
        // Start training 10 minutes ago (in effective seconds via accumulated bucket).
        useSkillStore.setState({
            offlineTrainingSkillId: 'sword_fighting',
            trainingSegmentStartedAt: null, // paused
            trainingAccumulatedEffectiveSeconds: 600,
            trainingCurrentSpeedMultiplier: 1,
            skillLevels: { sword_fighting: 0 },
            skillXp: { sword_fighting: 0 },
        });
        const xp = useSkillStore.getState().collectOfflineTraining();
        expect(xp).toBeGreaterThan(0);
        // The accumulator was flushed and reset.
        expect(useSkillStore.getState().trainingAccumulatedEffectiveSeconds).toBe(0);
    });
});

// -- resetSkills --------------------------------------------------------------

describe('resetSkills', () => {
    it('clears every gameplay piece back to the initial state', () => {
        useSkillStore.setState({
            skillLevels: { sword_fighting: 25 },
            skillXp: { sword_fighting: 100 },
            unlockedSkills: { shield_bash: true },
            activeSkillSlots: ['shield_bash', null, null, null],
            skillUpgradeLevels: { shield_bash: 3 },
        });
        useSkillStore.getState().resetSkills();
        const s = useSkillStore.getState();
        expect(s.skillLevels).toEqual({});
        expect(s.skillXp).toEqual({});
        expect(s.unlockedSkills).toEqual({});
        expect(s.activeSkillSlots).toEqual([null, null, null, null]);
        expect(s.skillUpgradeLevels).toEqual({});
    });
});

// keep imports referenced even if a future refactor drops the equipment setup
void EMPTY_EQUIPMENT;
