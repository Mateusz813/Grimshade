/**
 * Integration: combat kill propagation.
 *
 * When a monster dies in combat, the engine has to fan a single event out
 * to FIVE separate gameplay stores in one shot:
 *   1. characterStore  — XP gained (may level up, may grant stat points).
 *   2. inventoryStore  — gold credited + any rolled drops put into bag.
 *   3. taskStore       — kill count advanced for that monster, if a task
 *                        for it is active.
 *   4. masteryStore    — monster mastery kill counter bumped (and possibly
 *                        ticked over to next mastery level).
 *   5. questStore      — `kill` and `kill_rarity` goals advanced where
 *                        applicable.
 *
 * Unit tests cover each store in isolation; this suite exercises the
 * REAL chain — we let the actual store implementations talk to each
 * other instead of mocking the calls. The point is to catch regressions
 * where a refactor breaks one of the propagation hops (e.g. quest goals
 * stopped advancing because someone changed the `addProgress` signature).
 *
 * The combat engine itself drives a lot of UI / network plumbing we
 * don't want to spin up in a node test, so the suite simulates a
 * "monster died" event by calling the same store actions the engine
 * would (kept faithful to `combatEngine.handleMonsterDeath`). The
 * upshot is the SAME mutation graph hits the SAME stores — we just
 * skip the React + party-broadcast layers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore, type ICharacter } from '../../src/stores/characterStore';
import { useInventoryStore } from '../../src/stores/inventoryStore';
import { useTaskStore, type ITask } from '../../src/stores/taskStore';
import { useMasteryStore, MASTERY_KILL_THRESHOLD } from '../../src/stores/masteryStore';
import { useQuestStore, type IQuest } from '../../src/stores/questStore';
import { EMPTY_EQUIPMENT } from '../../src/systems/itemSystem';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-int-1',
    user_id: 'user-1',
    name: 'Integ',
    class: 'Knight',
    level: 50,
    xp: 1000,
    hp: 500,
    max_hp: 500,
    mp: 100,
    max_mp: 100,
    attack: 50,
    defense: 30,
    attack_speed: 2.0,
    crit_chance: 5,
    crit_damage: 200,
    magic_level: 0,
    hp_regen: 0,
    mp_regen: 0,
    gold: 0,
    stat_points: 0,
    highest_level: 50,
    equipment: {},
    created_at: '',
    updated_at: '',
    ...overrides,
} as ICharacter);

/** Reset every store the propagation chain touches. */
const resetStores = (): void => {
    useCharacterStore.setState({ character: null, isLoading: false });
    useInventoryStore.setState({
        bag: [],
        equipment: { ...EMPTY_EQUIPMENT },
        deposit: [],
        gold: 0,
        arenaPoints: 0,
        consumables: {},
        stones: {},
    });
    useTaskStore.setState({ activeTask: null, activeTasks: [], completedTasks: [] });
    useMasteryStore.setState({ masteries: {}, masteryKills: {} });
    useQuestStore.setState({ activeQuests: [], completedQuestIds: [] });
};

beforeEach(() => {
    resetStores();
});

/**
 * Reproduces the propagation steps `combatEngine.handleMonsterDeath` runs
 * for a SOLO kill (no party). We deliberately don't import combatEngine
 * itself — it pulls in dozens of subsystems (party sync, loot, save).
 * Instead, we replay the exact store calls the engine makes so we test
 * the SAME end-to-end chain on the SAME real store implementations.
 */
const simulateMonsterKill = (params: {
    monsterId: string;
    monsterLevel: number;
    rarity: 'normal' | 'strong' | 'epic' | 'legendary' | 'boss';
    xpReward: number;
    goldReward: number;
    taskKills?: number;
}): void => {
    const taskKills = params.taskKills ?? 1;
    // Gold + XP (mirrors combatEngine line 1021 / 1080).
    useInventoryStore.getState().addGold(params.goldReward);
    useCharacterStore.getState().addXp(params.xpReward);
    // Task / quest / mastery (mirrors combatEngine lines 1125–1134).
    useTaskStore.getState().addKill(params.monsterId, params.monsterLevel, taskKills);
    useQuestStore.getState().addProgress('kill', params.monsterId, taskKills);
    useQuestStore.getState().addProgress('kill_rarity', params.rarity, 1, params.monsterLevel);
    useMasteryStore.getState().addMasteryKills(params.monsterId, taskKills);
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('combat tick: kill propagates to every collaborating store', () => {
    it('credits XP onto the character', () => {
        useCharacterStore.getState().setCharacter(makeChar({ xp: 1000, level: 50 }));
        const before = useCharacterStore.getState().character!.xp;
        simulateMonsterKill({
            monsterId: 'rat',
            monsterLevel: 1,
            rarity: 'normal',
            xpReward: 250,
            goldReward: 5,
        });
        const after = useCharacterStore.getState().character!.xp;
        // XP either landed in current level's bucket, or rolled into a
        // level-up. Either way the GAIN must be visible somewhere — for a
        // lvl-50 character far from the next ding, +250 XP is well below
        // the per-level threshold so it lands in `xp` directly.
        expect(after).toBe(before + 250);
    });

    it('credits gold into the inventory store', () => {
        useCharacterStore.getState().setCharacter(makeChar());
        simulateMonsterKill({
            monsterId: 'rat',
            monsterLevel: 1,
            rarity: 'normal',
            xpReward: 10,
            goldReward: 123,
        });
        expect(useInventoryStore.getState().gold).toBe(123);
    });

    it('advances the task kill counter for the matching monster', () => {
        useCharacterStore.getState().setCharacter(makeChar());
        const task: ITask = {
            id: 'task_rat_10',
            monsterId: 'rat',
            monsterLevel: 1,
            monsterName: 'Szczur',
            killCount: 10,
            rewardGold: 50,
            rewardXp: 100,
        };
        useTaskStore.getState().startTask(task);
        simulateMonsterKill({
            monsterId: 'rat',
            monsterLevel: 1,
            rarity: 'normal',
            xpReward: 10,
            goldReward: 1,
            taskKills: 3, // simulate three rats killed at once (wave)
        });
        const active = useTaskStore.getState().activeTasks[0];
        expect(active.progress).toBe(3);
    });

    it('does NOT advance a task for a different monster', () => {
        useCharacterStore.getState().setCharacter(makeChar());
        useTaskStore.getState().startTask({
            id: 'task_goblin_10',
            monsterId: 'goblin',
            monsterLevel: 5,
            monsterName: 'Goblin',
            killCount: 10,
            rewardGold: 50,
            rewardXp: 100,
        });
        simulateMonsterKill({
            monsterId: 'rat',
            monsterLevel: 1,
            rarity: 'normal',
            xpReward: 10,
            goldReward: 1,
        });
        const active = useTaskStore.getState().activeTasks[0];
        expect(active.progress).toBe(0);
    });

    it('bumps masteryKills for that monster', () => {
        useCharacterStore.getState().setCharacter(makeChar());
        simulateMonsterKill({
            monsterId: 'rat',
            monsterLevel: 1,
            rarity: 'normal',
            xpReward: 10,
            goldReward: 1,
            taskKills: 7,
        });
        expect(useMasteryStore.getState().getMasteryKills('rat')).toBe(7);
        expect(useMasteryStore.getState().getMasteryLevel('rat')).toBe(0);
    });

    it('rolls mastery to level 1 when the kill threshold is crossed in one shot', () => {
        useCharacterStore.getState().setCharacter(makeChar());
        // Seed kills 1 short of the threshold so a single kill flips it.
        useMasteryStore.setState({
            masteries: {},
            masteryKills: { rat: MASTERY_KILL_THRESHOLD - 1 },
        });
        simulateMonsterKill({
            monsterId: 'rat',
            monsterLevel: 1,
            rarity: 'normal',
            xpReward: 10,
            goldReward: 1,
        });
        expect(useMasteryStore.getState().getMasteryLevel('rat')).toBe(1);
        // Overflow carries to the next level's bucket; one extra kill →
        // 0 overflow.
        expect(useMasteryStore.getState().getMasteryKills('rat')).toBe(0);
    });

    it('advances a `kill` quest goal that targets the same monster', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 50 }));
        const quest: IQuest = {
            id: 'q_rats',
            name_pl: 'Wybij szczury',
            name_en: 'Kill rats',
            minLevel: 1,
            description_pl: '',
            description_en: '',
            goals: [{ type: 'kill', monsterId: 'rat', count: 50 }],
            rewards: [{ type: 'gold', amount: 1000 }],
        };
        useQuestStore.getState().startQuest(quest);
        simulateMonsterKill({
            monsterId: 'rat',
            monsterLevel: 1,
            rarity: 'normal',
            xpReward: 10,
            goldReward: 1,
            taskKills: 5,
        });
        const aq = useQuestStore.getState().activeQuests[0];
        expect(aq.goals[0].progress).toBe(5);
    });

    it('advances a `kill_rarity` quest goal when the rarity tier matches', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 50 }));
        // Goal: kill 10 monsters of EPIC rarity or higher at lvl 30+.
        useQuestStore.getState().startQuest({
            id: 'q_epic_kills',
            name_pl: 'Epiczni',
            name_en: 'Epic kills',
            minLevel: 1,
            description_pl: '', description_en: '',
            goals: [{ type: 'kill_rarity', rarity: 'epic', minMonsterLevel: 30, count: 10 }],
            rewards: [{ type: 'gold', amount: 1000 }],
        });
        // Kill an EPIC rat at lvl 35 — qualifies (epic >= epic, 35 >= 30).
        simulateMonsterKill({
            monsterId: 'big_rat',
            monsterLevel: 35,
            rarity: 'epic',
            xpReward: 1000,
            goldReward: 50,
        });
        const aq = useQuestStore.getState().activeQuests[0];
        expect(aq.goals[0].progress).toBe(1);
    });

    it('skips a `kill_rarity` goal whose monster-level floor is too high', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 50 }));
        useQuestStore.getState().startQuest({
            id: 'q_high_lvl_epic',
            name_pl: 'Wysoki', name_en: 'High',
            minLevel: 1,
            description_pl: '', description_en: '',
            goals: [{ type: 'kill_rarity', rarity: 'epic', minMonsterLevel: 100, count: 5 }],
            rewards: [{ type: 'gold', amount: 1000 }],
        });
        // Epic but only lvl 35 — should NOT advance the goal.
        simulateMonsterKill({
            monsterId: 'rat',
            monsterLevel: 35,
            rarity: 'epic',
            xpReward: 1000,
            goldReward: 50,
        });
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(0);
    });

    it('hits every store in a single kill — XP, gold, task, mastery, quest', () => {
        useCharacterStore.getState().setCharacter(makeChar({ xp: 0, level: 50 }));
        useTaskStore.getState().startTask({
            id: 'task_full',
            monsterId: 'rat',
            monsterLevel: 1,
            monsterName: 'Szczur',
            killCount: 10,
            rewardGold: 100,
            rewardXp: 200,
        });
        useQuestStore.getState().startQuest({
            id: 'q_full',
            name_pl: '', name_en: '',
            minLevel: 1,
            description_pl: '', description_en: '',
            goals: [{ type: 'kill', monsterId: 'rat', count: 10 }],
            rewards: [{ type: 'gold', amount: 100 }],
        });
        simulateMonsterKill({
            monsterId: 'rat',
            monsterLevel: 1,
            rarity: 'normal',
            xpReward: 100,
            goldReward: 25,
        });
        const ch = useCharacterStore.getState().character!;
        expect(ch.xp).toBe(100);
        expect(useInventoryStore.getState().gold).toBe(25);
        expect(useTaskStore.getState().activeTasks[0].progress).toBe(1);
        expect(useMasteryStore.getState().getMasteryKills('rat')).toBe(1);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(1);
    });

    it('respects the quest minLevel gate when the quest is in quests.json', () => {
        // The active quest is in the store but the player is BELOW minLevel
        // (e.g. they activated it then leveled-down via death). Per the
        // 2026-05 spec questStore.addProgress silently skips below-level
        // quests so kills don't bleed into them.
        //
        // IMPORTANT: the gate inside addProgress runs `getQuestById` to fetch
        // the canonical definition — if the quest id is NOT in quests.json
        // the gate falls through (def is undefined). We use a REAL high-level
        // quest from quests.json so the gate actually engages.
        useCharacterStore.getState().setCharacter(makeChar({ level: 5 }));
        // `quest_void_crisis` is a lvl-200 quest targeting `void_behemoth`.
        // The player is lvl 5 so kills must NOT register.
        useQuestStore.setState({
            activeQuests: [{
                questId: 'quest_void_crisis',
                goals: [{ type: 'kill', monsterId: 'void_behemoth', count: 25, progress: 0 }],
                startedAt: '2025-01-01T00:00:00Z',
            }],
            completedQuestIds: [],
        });
        simulateMonsterKill({
            monsterId: 'void_behemoth',
            monsterLevel: 200,
            rarity: 'normal',
            xpReward: 10,
            goldReward: 1,
        });
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(0);
    });

    it('falls through the gate for quests not in quests.json (current behavior)', () => {
        // TODO: verify behavior — `getQuestById` returning undefined causes
        // the level-gate inside `addProgress` to bypass. Today this only
        // matters for tests / sandbox-injected quests; real player-facing
        // quests are always in quests.json. Documented here so a future
        // refactor that tightens the gate makes this assertion flip.
        useCharacterStore.getState().setCharacter(makeChar({ level: 5 }));
        useQuestStore.getState().startQuest({
            id: 'q_synthetic_high',
            name_pl: '', name_en: '',
            minLevel: 200,
            description_pl: '', description_en: '',
            goals: [{ type: 'kill', monsterId: 'rat', count: 10 }],
            rewards: [{ type: 'gold', amount: 1 }],
        });
        simulateMonsterKill({
            monsterId: 'rat',
            monsterLevel: 1,
            rarity: 'normal',
            xpReward: 10,
            goldReward: 1,
        });
        // Today: gate bypassed → progress IS recorded.
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(1);
    });
});
