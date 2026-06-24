import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTransformStore } from './transformStore';
import { useCharacterStore } from './characterStore';
import { getTransformMonsters } from '../systems/transformSystem';

// -- Helpers ------------------------------------------------------------------

const resetStore = (): void => {
    useTransformStore.setState({
        completedTransforms: [],
        currentTransformQuest: null,
        bakedBonusesApplied: false,
        transformMigrationVersion: 0,
        pendingClaimTransformId: null,
    });
};

beforeEach(() => {
    resetStore();
    useCharacterStore.setState({ character: null, isLoading: false });
});

// -- startTransformQuest ------------------------------------------------------

describe('startTransformQuest', () => {
    it('starts a quest for transform 1 when the player meets the level requirement', () => {
        const ok = useTransformStore.getState().startTransformQuest(1, 30);
        expect(ok).toBe(true);
        const quest = useTransformStore.getState().currentTransformQuest;
        expect(quest).not.toBeNull();
        expect(quest!.transformId).toBe(1);
        expect(quest!.inProgress).toBe(true);
        expect(quest!.monstersDefeated).toEqual([]);
        // 30 boss monsters for T1 (levels 1-30 range).
        expect(quest!.totalMonsters).toBe(getTransformMonsters(1).length);
    });

    it('rejects when the player is below the level requirement', () => {
        // Transform 1 requires level 30.
        const ok = useTransformStore.getState().startTransformQuest(1, 10);
        expect(ok).toBe(false);
        expect(useTransformStore.getState().currentTransformQuest).toBeNull();
    });

    it('rejects when a different quest is already in progress', () => {
        useTransformStore.getState().startTransformQuest(1, 1000);
        const secondTry = useTransformStore.getState().startTransformQuest(2, 1000);
        expect(secondTry).toBe(false);
    });

    it('rejects when previous transforms have not been completed (order check)', () => {
        // Trying to start transform 3 without completing 1 + 2.
        const ok = useTransformStore.getState().startTransformQuest(3, 1000);
        expect(ok).toBe(false);
    });

    it('rejects a transform id that has already been completed', () => {
        useTransformStore.setState({
            completedTransforms: [1],
            currentTransformQuest: null,
            bakedBonusesApplied: false,
            pendingClaimTransformId: null,
        });
        const ok = useTransformStore.getState().startTransformQuest(1, 1000);
        expect(ok).toBe(false);
    });

    it('rejects unknown transform ids (returns false, no quest set)', () => {
        const ok = useTransformStore.getState().startTransformQuest(99, 1000);
        expect(ok).toBe(false);
        expect(useTransformStore.getState().currentTransformQuest).toBeNull();
    });
});

// -- defeatMonster ------------------------------------------------------------

describe('defeatMonster', () => {
    beforeEach(() => {
        useTransformStore.getState().startTransformQuest(1, 1000);
    });

    it('records a defeated quest monster + returns true', () => {
        const questMonsters = getTransformMonsters(1);
        const ok = useTransformStore.getState().defeatMonster(questMonsters[0].id);
        expect(ok).toBe(true);
        expect(useTransformStore.getState().currentTransformQuest!.monstersDefeated)
            .toContain(questMonsters[0].id);
    });

    it('returns true (idempotent) for an already-defeated monster, without duplicating it', () => {
        const questMonsters = getTransformMonsters(1);
        const target = questMonsters[0].id;
        const store = useTransformStore.getState();
        store.defeatMonster(target);
        store.defeatMonster(target);
        const state = useTransformStore.getState();
        const occurrences = state.currentTransformQuest!.monstersDefeated.filter((id) => id === target);
        expect(occurrences).toHaveLength(1);
    });

    it('returns false for a monster not part of the quest', () => {
        const ok = useTransformStore.getState().defeatMonster('not_a_real_monster_id');
        expect(ok).toBe(false);
    });

    it('locks pendingClaimTransformId the moment the FINAL monster falls', () => {
        const questMonsters = getTransformMonsters(1);
        const store = useTransformStore.getState();
        for (const m of questMonsters) {
            store.defeatMonster(m.id);
        }
        // Quest still in progress (player hasn't pressed Claim yet) but a
        // pending claim now exists to protect the reward.
        expect(useTransformStore.getState().pendingClaimTransformId).toBe(1);
        // Quest is logically "complete".
        expect(useTransformStore.getState().isQuestComplete()).toBe(true);
    });
});

// -- completeTransform --------------------------------------------------------

describe('completeTransform', () => {
    it('returns 0 when no quest is active and no pending claim exists', () => {
        expect(useTransformStore.getState().completeTransform()).toBe(0);
    });

    it('moves the quest id into completedTransforms on the happy path', () => {
        useTransformStore.getState().startTransformQuest(1, 1000);
        for (const m of getTransformMonsters(1)) {
            useTransformStore.getState().defeatMonster(m.id);
        }
        const id = useTransformStore.getState().completeTransform();
        expect(id).toBe(1);
        const state = useTransformStore.getState();
        expect(state.completedTransforms).toContain(1);
        expect(state.currentTransformQuest).toBeNull();
        // pendingClaimTransformId remains for the rewards screen to consume.
        expect(state.pendingClaimTransformId).toBe(1);
    });

    it('avoids duplicating an already-completed id on subsequent completeTransform calls', () => {
        useTransformStore.setState({
            completedTransforms: [1],
            currentTransformQuest: null,
            bakedBonusesApplied: false,
            pendingClaimTransformId: 1,
        });
        const id = useTransformStore.getState().completeTransform();
        // Pending claim recovery — id returned, no dupe inserted.
        expect(id).toBe(1);
        expect(useTransformStore.getState().completedTransforms.filter((x) => x === 1)).toHaveLength(1);
    });
});

// -- abandonTransformQuest ----------------------------------------------------

describe('abandonTransformQuest', () => {
    it('clears the active quest', () => {
        useTransformStore.getState().startTransformQuest(1, 1000);
        useTransformStore.getState().abandonTransformQuest();
        expect(useTransformStore.getState().currentTransformQuest).toBeNull();
    });

    it('PRESERVES pendingClaimTransformId so a finished player can still claim rewards', () => {
        // Simulate: all monsters dead -> pending claim locked -> player flees.
        useTransformStore.getState().startTransformQuest(1, 1000);
        for (const m of getTransformMonsters(1)) {
            useTransformStore.getState().defeatMonster(m.id);
        }
        useTransformStore.getState().abandonTransformQuest();
        expect(useTransformStore.getState().pendingClaimTransformId).toBe(1);
    });
});

// -- claimPendingReward -------------------------------------------------------

describe('claimPendingReward', () => {
    it('returns null when nothing is pending', () => {
        expect(useTransformStore.getState().claimPendingReward()).toBeNull();
    });

    it('returns the transform id and clears the pending state', () => {
        useTransformStore.setState({
            completedTransforms: [1],
            currentTransformQuest: null,
            bakedBonusesApplied: false,
            pendingClaimTransformId: 1,
        });
        const id = useTransformStore.getState().claimPendingReward();
        expect(id).toBe(1);
        expect(useTransformStore.getState().pendingClaimTransformId).toBeNull();
    });
});

// -- Getters ------------------------------------------------------------------

describe('getHighestCompletedTransform', () => {
    it('returns 0 when nothing is completed', () => {
        expect(useTransformStore.getState().getHighestCompletedTransform()).toBe(0);
    });

    it('returns the max id in completedTransforms', () => {
        useTransformStore.setState({
            completedTransforms: [1, 3, 2],
            currentTransformQuest: null,
            bakedBonusesApplied: false,
            pendingClaimTransformId: null,
        });
        expect(useTransformStore.getState().getHighestCompletedTransform()).toBe(3);
    });
});

describe('getHighestTransformColor', () => {
    it('returns null when no transform has been completed', () => {
        expect(useTransformStore.getState().getHighestTransformColor()).toBeNull();
    });

    it('returns the color descriptor for the highest tier', () => {
        useTransformStore.setState({
            completedTransforms: [1],
            currentTransformQuest: null,
            bakedBonusesApplied: false,
            pendingClaimTransformId: null,
        });
        const color = useTransformStore.getState().getHighestTransformColor();
        expect(color).not.toBeNull();
        // The first transform has a solid red accent — confirms we wired through
        // to the system helper without depending on the exact hex.
        expect(typeof color!.css).toBe('string');
    });
});

describe('isTransformAvailable', () => {
    it('false when already completed', () => {
        useTransformStore.setState({
            completedTransforms: [1],
            currentTransformQuest: null,
            bakedBonusesApplied: false,
            pendingClaimTransformId: null,
        });
        expect(useTransformStore.getState().isTransformAvailable(1, 1000)).toBe(false);
    });

    it('false when a DIFFERENT quest is in progress', () => {
        useTransformStore.getState().startTransformQuest(1, 1000);
        expect(useTransformStore.getState().isTransformAvailable(2, 1000)).toBe(false);
    });

    it('true when level + order + completion checks all pass', () => {
        // Transform 2 needs transform 1 completed and the level requirement met.
        useTransformStore.setState({
            completedTransforms: [1],
            currentTransformQuest: null,
            bakedBonusesApplied: false,
            pendingClaimTransformId: null,
        });
        expect(useTransformStore.getState().isTransformAvailable(2, 1000)).toBe(true);
    });
});

describe('isQuestInProgress / getQuestProgress / getRemainingMonsters', () => {
    it('isQuestInProgress flips with start / abandon', () => {
        expect(useTransformStore.getState().isQuestInProgress()).toBe(false);
        useTransformStore.getState().startTransformQuest(1, 1000);
        expect(useTransformStore.getState().isQuestInProgress()).toBe(true);
        useTransformStore.getState().abandonTransformQuest();
        expect(useTransformStore.getState().isQuestInProgress()).toBe(false);
    });

    it('getQuestProgress returns 0 with no quest, and rises proportionally as monsters fall', () => {
        expect(useTransformStore.getState().getQuestProgress()).toBe(0);
        useTransformStore.getState().startTransformQuest(1, 1000);
        const monsters = getTransformMonsters(1);
        useTransformStore.getState().defeatMonster(monsters[0].id);
        // 1 / N — small but strictly positive.
        expect(useTransformStore.getState().getQuestProgress()).toBeGreaterThan(0);
        expect(useTransformStore.getState().getQuestProgress()).toBeLessThanOrEqual(1);
    });

    it('getRemainingMonsters shrinks as kills land', () => {
        useTransformStore.getState().startTransformQuest(1, 1000);
        const total = getTransformMonsters(1).length;
        expect(useTransformStore.getState().getRemainingMonsters()).toHaveLength(total);
        useTransformStore.getState().defeatMonster(getTransformMonsters(1)[0].id);
        expect(useTransformStore.getState().getRemainingMonsters()).toHaveLength(total - 1);
    });
});

// -- migrateLegacyBakedBonuses ------------------------------------------------

describe('migrateLegacyBakedBonuses', () => {
    it('no-op + returns false when already migrated (bakedBonusesApplied=false)', () => {
        // Default initial state already has the flag false -> migrate must
        // detect "nothing to do" and bail.
        expect(useTransformStore.getState().migrateLegacyBakedBonuses()).toBe(false);
    });

    it('flips the flag with no character/no completed transforms and returns true', () => {
        useTransformStore.setState({
            completedTransforms: [],
            currentTransformQuest: null,
            bakedBonusesApplied: true,
            pendingClaimTransformId: null,
        });
        const ok = useTransformStore.getState().migrateLegacyBakedBonuses();
        expect(ok).toBe(true);
        expect(useTransformStore.getState().bakedBonusesApplied).toBe(false);
    });

    it('returns false when bakedBonusesApplied is true but no character is loaded (with completed list)', () => {
        useTransformStore.setState({
            completedTransforms: [1],
            currentTransformQuest: null,
            bakedBonusesApplied: true,
            pendingClaimTransformId: null,
        });
        useCharacterStore.setState({ character: null, isLoading: false });
        // No character to migrate against -> returns false (does not flip the flag).
        expect(useTransformStore.getState().migrateLegacyBakedBonuses()).toBe(false);
        expect(useTransformStore.getState().bakedBonusesApplied).toBe(true);
    });

    it('subtracts the per-transform delta from character stats and flips the flag', () => {
        // Spy on the character updater so we don't care what the actual numbers
        // end up being — just that it was invoked and the flag flipped.
        // NOTE: max_hp/max_mp must sit ABOVE the Knight lvl-30 floor
        // (522 / 123) so the 2026-06-24 corrupted-base guard lets the genuine
        // geometric unbake run instead of skipping it. A truly-baked legacy
        // Knight always carries inflated stats well above the floor.
        const updateSpy = vi.fn();
        useCharacterStore.setState({
            character: {
                id: 'char-1',
                user_id: 'u-1',
                name: 'Tester',
                class: 'Knight',
                level: 30,
                xp: 0,
                hp: 900,
                max_hp: 900,
                mp: 400,
                max_mp: 400,
                attack: 40,
                defense: 30,
                attack_speed: 2,
                crit_chance: 5,
                crit_damage: 150,
                magic_level: 0,
                hp_regen: 0.05,
                mp_regen: 0.05,
                gold: 0,
                stat_points: 0,
                highest_level: 30,
                equipment: {},
                created_at: 'x',
                updated_at: 'x',
            } as never,
            isLoading: false,
            updateCharacter: updateSpy,
        } as never);
        useTransformStore.setState({
            completedTransforms: [1],
            currentTransformQuest: null,
            bakedBonusesApplied: true,
            pendingClaimTransformId: null,
        });
        const ok = useTransformStore.getState().migrateLegacyBakedBonuses();
        expect(ok).toBe(true);
        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(useTransformStore.getState().bakedBonusesApplied).toBe(false);
    });
});

// -- migrateLegacyBakedBonuses: corrupted-base safety guard (2026-06-24) ------

describe('migrateLegacyBakedBonuses › corrupted-base safety guard', () => {
    it('SKIPS the geometric unbake when the base is already below the floor', () => {
        // Mage lvl 109 floor = max_hp 524 / max_mp 1314. Simulate a save whose
        // base MP has ALREADY been collapsed by the prior double-run bug
        // (max_mp = 0). The unbake must NOT divide it again — it must detect
        // "base already corrupted", flip the flag, and bail WITHOUT lowering
        // any stat further.
        const updateSpy = vi.fn();
        useCharacterStore.setState({
            character: {
                id: 'char-krasek',
                user_id: 'u-1',
                name: 'Krasek',
                class: 'Mage',
                level: 109,
                xp: 0,
                hp: 200,
                max_hp: 200,   // also below the 524 floor
                mp: 0,
                max_mp: 0,     // collapsed by the bug
                attack: 100,
                defense: 20,
                attack_speed: 2,
                crit_chance: 5,
                crit_damage: 150,
                magic_level: 0,
                hp_regen: 0,
                mp_regen: 0,
                gold: 0,
                stat_points: 0,
                highest_level: 109,
                equipment: {},
                created_at: 'x',
                updated_at: 'x',
            } as never,
            isLoading: false,
            updateCharacter: updateSpy,
        } as never);
        useTransformStore.setState({
            completedTransforms: [1, 2, 3],
            currentTransformQuest: null,
            bakedBonusesApplied: true,
            transformMigrationVersion: 0,
            pendingClaimTransformId: null,
        });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const ok = useTransformStore.getState().migrateLegacyBakedBonuses();
        expect(ok).toBe(true);
        // The unbake never touched character stats (no further reduction).
        expect(updateSpy).not.toHaveBeenCalled();
        // Flag flipped so live bonuses now apply.
        expect(useTransformStore.getState().bakedBonusesApplied).toBe(false);

        vi.restoreAllMocks();
    });
});

// -- Idempotent load-migration (2026-06-24 player-data fix) -------------------

describe('load-migration idempotency (transformMigrationVersion guard)', () => {
    it('does NOT re-run the unbake once transformMigrationVersion=1', () => {
        // Simulate the load-migration gate logic that lives in characterScope:
        // "run only when completedTransforms.length>0 && version===0". A save
        // that already migrated (version=1) must be skipped so the lossy unbake
        // can never run a second time and double-reduce the base stats.
        const updateSpy = vi.fn();
        useCharacterStore.setState({
            character: {
                id: 'char-1', user_id: 'u-1', name: 'T', class: 'Mage',
                level: 109, xp: 0, hp: 524, max_hp: 524, mp: 1314, max_mp: 1314,
                attack: 100, defense: 20, attack_speed: 2, crit_chance: 5,
                crit_damage: 150, magic_level: 0, hp_regen: 0, mp_regen: 0,
                gold: 0, stat_points: 0, highest_level: 109, equipment: {},
                created_at: 'x', updated_at: 'x',
            } as never,
            isLoading: false,
            updateCharacter: updateSpy,
        } as never);

        // Already-migrated state: completed transforms + version 1 + flag false.
        useTransformStore.setState({
            completedTransforms: [1, 2, 3],
            currentTransformQuest: null,
            bakedBonusesApplied: false,
            transformMigrationVersion: 1,
            pendingClaimTransformId: null,
        });

        // Mirror the characterScope gate: skip when version !== 0.
        const version = useTransformStore.getState().transformMigrationVersion;
        const completed = useTransformStore.getState().completedTransforms;
        if (completed.length > 0 && (version ?? 0) === 0) {
            useTransformStore.setState({ bakedBonusesApplied: true });
            useTransformStore.getState().migrateLegacyBakedBonuses();
            useTransformStore.setState({ transformMigrationVersion: 1 });
        }

        // Migration was skipped: stats untouched, flag stayed false, no double-run.
        expect(updateSpy).not.toHaveBeenCalled();
        expect(useTransformStore.getState().bakedBonusesApplied).toBe(false);
        expect(useCharacterStore.getState().character!.max_mp).toBe(1314);
    });

    it('runs exactly once then stamps version=1 so a second load is a no-op', () => {
        const updateSpy = vi.fn();
        useCharacterStore.setState({
            character: {
                id: 'char-1', user_id: 'u-1', name: 'T', class: 'Knight',
                level: 30, xp: 0, hp: 600, max_hp: 600, mp: 200, max_mp: 200,
                attack: 60, defense: 40, attack_speed: 2, crit_chance: 5,
                crit_damage: 150, magic_level: 0, hp_regen: 0, mp_regen: 0,
                gold: 0, stat_points: 0, highest_level: 30, equipment: {},
                created_at: 'x', updated_at: 'x',
            } as never,
            isLoading: false,
            updateCharacter: updateSpy,
        } as never);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);

        const runGate = (): void => {
            const version = useTransformStore.getState().transformMigrationVersion;
            const completed = useTransformStore.getState().completedTransforms;
            if (completed.length > 0 && (version ?? 0) === 0) {
                useTransformStore.setState({ bakedBonusesApplied: true });
                useTransformStore.getState().migrateLegacyBakedBonuses();
                useTransformStore.setState({ transformMigrationVersion: 1 });
            }
        };

        // Legacy save: version 0 + completed transforms.
        useTransformStore.setState({
            completedTransforms: [1],
            currentTransformQuest: null,
            bakedBonusesApplied: false,
            transformMigrationVersion: 0,
            pendingClaimTransformId: null,
        });

        runGate(); // first load
        expect(useTransformStore.getState().transformMigrationVersion).toBe(1);
        const callsAfterFirst = updateSpy.mock.calls.length;
        expect(callsAfterFirst).toBe(1); // unbake ran once

        runGate(); // second load (e.g. after localStorage wipe on mobile)
        // No additional unbake — version guard held.
        expect(updateSpy.mock.calls.length).toBe(callsAfterFirst);

        vi.restoreAllMocks();
    });
});
