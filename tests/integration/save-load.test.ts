
import { describe, it, expect, beforeEach } from 'vitest';
import {
    saveCurrentCharacterStoresSync,
    restoreFromLocalStorageSync,
    switchToCharacter,
} from '../../src/stores/characterScope';
import { useCharacterStore, type ICharacter } from '../../src/stores/characterStore';
import { useInventoryStore } from '../../src/stores/inventoryStore';
import { useSkillStore } from '../../src/stores/skillStore';
import { useTaskStore } from '../../src/stores/taskStore';
import { useQuestStore } from '../../src/stores/questStore';
import { useMasteryStore } from '../../src/stores/masteryStore';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { EMPTY_EQUIPMENT, buildItem } from '../../src/systems/itemSystem';


const CHAR_ID = 'char-roundtrip-1';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: CHAR_ID,
    user_id: 'user-1',
    name: 'Saver',
    class: 'Knight',
    level: 42,
    xp: 9001,
    hp: 800,
    max_hp: 1000,
    mp: 150,
    max_mp: 200,
    attack: 60,
    defense: 35,
    attack_speed: 2.0,
    crit_chance: 8,
    crit_damage: 250,
    magic_level: 5,
    hp_regen: 0,
    mp_regen: 1,
    gold: 0,
    stat_points: 3,
    highest_level: 42,
    equipment: {},
    created_at: '',
    updated_at: '',
    ...overrides,
} as ICharacter);

const resetAll = (): void => {
    localStorage.clear();
    sessionStorage.clear();
    useCharacterStore.setState({ character: null, isLoading: false });
    useInventoryStore.setState({
        bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [],
        gold: 0, arenaPoints: 0, consumables: {}, stones: {},
    });
    useSkillStore.setState({
        skillLevels: {}, skillXp: {}, activeSkillSlots: [null, null, null, null],
        skillUpgradeLevels: {}, unlockedSkills: {},
        offlineTrainingSkillId: null, trainingSegmentStartedAt: null,
        trainingAccumulatedEffectiveSeconds: 0, trainingCurrentSpeedMultiplier: 2,
    });
    useTaskStore.setState({ activeTask: null, activeTasks: [], completedTasks: [] });
    useQuestStore.setState({ activeQuests: [], completedQuestIds: [] });
    useMasteryStore.setState({ masteries: {}, masteryKills: {} });
};

beforeEach(() => {
    resetAll();
});

const fullStateRoundTrip = async (): Promise<{ sword: ReturnType<typeof buildItem>; before: ReturnType<typeof captureSnapshot> }> => {
    await switchToCharacter(CHAR_ID);

    useCharacterStore.getState().setCharacter(makeChar());
    const sword = buildItem({
        itemId: 'sword_lvl10_rare',
        rarity: 'rare',
        bonuses: { dmg_min: 12, dmg_max: 18 },
        itemLevel: 10,
    });
    useInventoryStore.setState({
        bag: [sword],
        equipment: { ...EMPTY_EQUIPMENT },
        deposit: [], gold: 5000, arenaPoints: 100, consumables: { hp_potion_sm: 5 }, stones: { common_stone: 12 },
    });
    useSkillStore.setState({
        skillLevels: { sword_fighting: 25, magic_level: 8, shielding: 12 },
        skillXp: { sword_fighting: 150, magic_level: 30 },
        activeSkillSlots: ['shield_bash', null, null, null] as [string | null, string | null, string | null, string | null],
        skillUpgradeLevels: { shield_bash: 3 },
        unlockedSkills: { shield_bash: true },
        offlineTrainingSkillId: 'shielding',
        trainingSegmentStartedAt: null,
        trainingAccumulatedEffectiveSeconds: 0,
        trainingCurrentSpeedMultiplier: 2,
    });
    useTaskStore.setState({
        activeTask: null,
        activeTasks: [{
            id: 'task_rat_50',
            monsterId: 'rat',
            monsterLevel: 1,
            monsterName: 'Szczur',
            killCount: 50,
            rewardGold: 250,
            rewardXp: 500,
            progress: 17,
            startedAt: '2025-01-01T00:00:00Z',
        }],
        completedTasks: [],
    });
    useQuestStore.setState({
        activeQuests: [{
            questId: 'q_intro',
            goals: [{ type: 'kill', monsterId: 'rat', count: 10, progress: 3 }],
            startedAt: '2025-01-01T00:00:00Z',
        }],
        completedQuestIds: ['q_tutorial'],
    });
    useMasteryStore.setState({
        masteries: { rat: { level: 2 } },
        masteryKills: { rat: 1234 },
    });

    const before = captureSnapshot(sword.uuid);

    saveCurrentCharacterStoresSync();

    useCharacterStore.setState({ character: null });
    useInventoryStore.setState({
        bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [],
        gold: 0, arenaPoints: 0, consumables: {}, stones: {},
    });
    useSkillStore.setState({
        skillLevels: {}, skillXp: {}, activeSkillSlots: [null, null, null, null],
        skillUpgradeLevels: {}, unlockedSkills: {},
        offlineTrainingSkillId: null, trainingSegmentStartedAt: null,
        trainingAccumulatedEffectiveSeconds: 0, trainingCurrentSpeedMultiplier: 2,
    });
    useTaskStore.setState({ activeTask: null, activeTasks: [], completedTasks: [] });
    useQuestStore.setState({ activeQuests: [], completedQuestIds: [] });
    useMasteryStore.setState({ masteries: {}, masteryKills: {} });

    const restored = restoreFromLocalStorageSync(CHAR_ID);
    expect(restored).toBe(true);

    return { sword, before };
};

const captureSnapshot = (swordUuid: string) => ({
    swordUuid,
    bag: useInventoryStore.getState().bag.map(i => i.uuid),
    gold: useInventoryStore.getState().gold,
    arenaPoints: useInventoryStore.getState().arenaPoints,
    consumables: { ...useInventoryStore.getState().consumables },
    stones: { ...useInventoryStore.getState().stones },
    skillLevels: { ...useSkillStore.getState().skillLevels },
    skillXp: { ...useSkillStore.getState().skillXp },
    upgrades: { ...useSkillStore.getState().skillUpgradeLevels },
    unlocked: { ...useSkillStore.getState().unlockedSkills },
    activeTasks: useTaskStore.getState().activeTasks.map(t => ({ id: t.id, progress: t.progress })),
    activeQuests: useQuestStore.getState().activeQuests.map(q => ({
        id: q.questId,
        goals: q.goals.map(g => ({ type: g.type, progress: g.progress })),
    })),
    completedQuestIds: [...useQuestStore.getState().completedQuestIds],
    masteryLevels: { ...useMasteryStore.getState().masteries },
    masteryKills: { ...useMasteryStore.getState().masteryKills },
});


describe('characterScope: save -> restore round-trip preserves state', () => {
    it('restores inventory (bag, gold, arena points, consumables, stones)', async () => {
        const { sword } = await fullStateRoundTrip();
        const inv = useInventoryStore.getState();
        expect(inv.bag.some(i => i.uuid === sword.uuid)).toBe(true);
        expect(inv.gold).toBe(5000);
        expect(inv.arenaPoints).toBe(100);
        expect(inv.consumables.hp_potion_sm).toBe(5);
        expect(inv.stones.common_stone).toBe(12);
    });

    it('restores skill levels + XP', async () => {
        await fullStateRoundTrip();
        const sk = useSkillStore.getState();
        expect(sk.skillLevels.sword_fighting).toBe(25);
        expect(sk.skillLevels.magic_level).toBe(8);
        expect(sk.skillLevels.shielding).toBe(12);
        expect(sk.skillXp.sword_fighting).toBe(150);
        expect(sk.skillXp.magic_level).toBe(30);
    });

    it('restores active skill slots + upgrade levels + unlocked map', async () => {
        await fullStateRoundTrip();
        const sk = useSkillStore.getState();
        expect(sk.activeSkillSlots).toEqual(['shield_bash', null, null, null]);
        expect(sk.skillUpgradeLevels.shield_bash).toBe(3);
        expect(sk.unlockedSkills.shield_bash).toBe(true);
    });

    it('restores active offline-training selection', async () => {
        await fullStateRoundTrip();
        expect(useSkillStore.getState().offlineTrainingSkillId).toBe('shielding');
    });

    it('restores active tasks with their progress preserved', async () => {
        await fullStateRoundTrip();
        const tasks = useTaskStore.getState().activeTasks;
        expect(tasks).toHaveLength(1);
        expect(tasks[0].id).toBe('task_rat_50');
        expect(tasks[0].progress).toBe(17);
        expect(tasks[0].killCount).toBe(50);
    });

    it('restores quest progress + completed quest ids', async () => {
        await fullStateRoundTrip();
        const qs = useQuestStore.getState();
        expect(qs.activeQuests).toHaveLength(1);
        expect(qs.activeQuests[0].questId).toBe('q_intro');
        expect(qs.activeQuests[0].goals[0].progress).toBe(3);
        expect(qs.completedQuestIds).toContain('q_tutorial');
    });

    it('restores mastery levels + per-monster kill counters', async () => {
        await fullStateRoundTrip();
        const m = useMasteryStore.getState();
        expect(m.masteries.rat.level).toBe(2);
        expect(m.masteryKills.rat).toBe(1234);
    });

    it('restores the entire state via a single before/after snapshot comparison', async () => {
        const { before } = await fullStateRoundTrip();
        const after = captureSnapshot(before.swordUuid);
        expect(after).toEqual(before);
    });

    it('persists Quests task filters/sort across save -> restore (settings slice)', async () => {
        await switchToCharacter(CHAR_ID);
        useCharacterStore.getState().setCharacter(makeChar());
        useSettingsStore.setState({
            taskFilterAvailableOnly: true,
            taskFilterInactiveOnly: true,
            taskFilterSortDesc: true,
            taskFilterLvlFrom: '65',
        });
        saveCurrentCharacterStoresSync();
        useSettingsStore.setState({
            taskFilterAvailableOnly: false,
            taskFilterInactiveOnly: false,
            taskFilterSortDesc: false,
            taskFilterLvlFrom: '',
        });
        expect(restoreFromLocalStorageSync(CHAR_ID)).toBe(true);
        const s = useSettingsStore.getState();
        expect(s.taskFilterAvailableOnly).toBe(true);
        expect(s.taskFilterInactiveOnly).toBe(true);
        expect(s.taskFilterSortDesc).toBe(true);
        expect(s.taskFilterLvlFrom).toBe('65');
    });

    it('returns false when no save exists for the character', () => {
        const restored = restoreFromLocalStorageSync('char-no-save');
        expect(restored).toBe(false);
        expect(useInventoryStore.getState().gold).toBe(0);
    });

    it('writes the save blob to the expected localStorage key', async () => {
        await switchToCharacter(CHAR_ID);
        useCharacterStore.getState().setCharacter(makeChar());
        saveCurrentCharacterStoresSync();
        const raw = localStorage.getItem(`dungeon_rpg_save_char_${CHAR_ID}`);
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!) as { state: { _ownerCharacterId: string } };
        expect(parsed.state._ownerCharacterId).toBe(CHAR_ID);
    });
});
