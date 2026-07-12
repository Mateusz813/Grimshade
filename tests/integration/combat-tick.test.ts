
import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore, type ICharacter } from '../../src/stores/characterStore';
import { useInventoryStore } from '../../src/stores/inventoryStore';
import { useTaskStore, type ITask } from '../../src/stores/taskStore';
import { useMasteryStore, MASTERY_KILL_THRESHOLD } from '../../src/stores/masteryStore';
import { useQuestStore, type IQuest } from '../../src/stores/questStore';
import { EMPTY_EQUIPMENT } from '../../src/systems/itemSystem';


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

const simulateMonsterKill = (params: {
    monsterId: string;
    monsterLevel: number;
    rarity: 'normal' | 'strong' | 'epic' | 'legendary' | 'boss';
    xpReward: number;
    goldReward: number;
    taskKills?: number;
}): void => {
    const taskKills = params.taskKills ?? 1;
    useInventoryStore.getState().addGold(params.goldReward);
    useCharacterStore.getState().addXp(params.xpReward);
    useTaskStore.getState().addKill(params.monsterId, params.monsterLevel, taskKills);
    useQuestStore.getState().addProgress('kill', params.monsterId, taskKills);
    useQuestStore.getState().addProgress('kill_rarity', params.rarity, 1, params.monsterLevel);
    useMasteryStore.getState().addMasteryKills(params.monsterId, taskKills);
};


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
            taskKills: 3,
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
        useQuestStore.getState().startQuest({
            id: 'q_epic_kills',
            name_pl: 'Epiczni',
            name_en: 'Epic kills',
            minLevel: 1,
            description_pl: '', description_en: '',
            goals: [{ type: 'kill_rarity', rarity: 'epic', minMonsterLevel: 30, count: 10 }],
            rewards: [{ type: 'gold', amount: 1000 }],
        });
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
        useCharacterStore.getState().setCharacter(makeChar({ level: 5 }));
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
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(1);
    });
});
