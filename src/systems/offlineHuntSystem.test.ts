import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    previewOfflineHunt,
    claimOfflineHunt,
} from './offlineHuntSystem';
import {
    useOfflineHuntStore,
    OFFLINE_HUNT_BASE_SECONDS_PER_KILL,
    OFFLINE_HUNT_MAX_SECONDS,
} from '../stores/offlineHuntStore';
import { useCharacterStore } from '../stores/characterStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useMasteryStore } from '../stores/masteryStore';
import { useSkillStore } from '../stores/skillStore';
import { useTaskStore } from '../stores/taskStore';
import { useQuestStore } from '../stores/questStore';
import { useDailyQuestStore } from '../stores/dailyQuestStore';
import { useBuffStore } from '../stores/buffStore';
import { EMPTY_EQUIPMENT } from './itemSystem';
import { MONSTER_RARITY_TASK_KILLS } from './lootSystem';
import type { IMonster } from '../types/monster';
import type { ICharacter } from '../api/v1/characterApi';


const makeMonster = (overrides?: Partial<IMonster>): IMonster => ({
    id: 'rat',
    name_pl: 'Szczur',
    name_en: 'Rat',
    level: 5,
    hp: 60,
    attack: 10,
    defense: 2,
    speed: 5,
    xp: 20,
    gold: [10, 20],
    dropTable: [],
    sprite: 'X',
    ...overrides,
});

const makeCharacter = (overrides?: Partial<ICharacter>): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Tester',
    class: 'Knight',
    level: 10,
    xp: 0,
    hp: 200,
    max_hp: 200,
    mp: 50,
    max_mp: 50,
    attack: 20,
    defense: 10,
    attack_speed: 2,
    crit_chance: 5,
    crit_damage: 150,
    magic_level: 0,
    hp_regen: 0,
    mp_regen: 0,
    gold: 0,
    stat_points: 0,
    highest_level: 10,
    equipment: {},
    created_at: '2026-05-21T00:00:00Z',
    updated_at: '2026-05-21T00:00:00Z',
    ...overrides,
});

const stubAllRandomness = (value = 0.5): void => {
    vi.spyOn(Math, 'random').mockReturnValue(value);
};


beforeEach(() => {
    useOfflineHuntStore.setState({
        isActive: false,
        startedAt: null,
        targetMonster: null,
        trainedSkillId: null,
    });
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
    useMasteryStore.setState({ masteries: {}, masteryKills: {} });
    useSkillStore.setState({
        skillLevels: {},
        skillXp: {},
        activeSkillSlots: [null, null, null, null],
        skillUpgradeLevels: {},
        unlockedSkills: {},
        offlineTrainingSkillId: null,
        trainingSegmentStartedAt: null,
        trainingAccumulatedEffectiveSeconds: 0,
        trainingCurrentSpeedMultiplier: 2,
    });
    useTaskStore.setState({ activeTask: null, activeTasks: [], completedTasks: [] });
    useQuestStore.setState({ activeQuests: [], completedQuestIds: [] });
    useDailyQuestStore.setState({
        ...useDailyQuestStore.getState(),
        lastRefreshDate: null,
        activeQuests: [],
        todayQuestDefs: [],
    });
    useBuffStore.setState({ allBuffs: [], combatSpeedMult: 1 });
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});


describe('previewOfflineHunt', () => {
    it('returns null when no hunt is active', () => {
        expect(previewOfflineHunt()).toBeNull();
    });

    it('returns null when isActive but missing startedAt', () => {
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: null,
            targetMonster: makeMonster(),
            trainedSkillId: 'sword_fighting',
        });
        expect(previewOfflineHunt()).toBeNull();
    });

    it('returns null when missing targetMonster', () => {
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: '2026-05-21T00:00:00.000Z',
            targetMonster: null,
            trainedSkillId: 'sword_fighting',
        });
        expect(previewOfflineHunt()).toBeNull();
    });

    it('returns null when missing trainedSkillId', () => {
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: '2026-05-21T00:00:00.000Z',
            targetMonster: makeMonster(),
            trainedSkillId: null,
        });
        expect(previewOfflineHunt()).toBeNull();
    });

    it('computes kills based on elapsedSeconds / BASE_SECONDS_PER_KILL at mastery 0 (x1)', () => {
        const monster = makeMonster({ id: 'rat', level: 5, xp: 20, gold: [10, 20] });
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 100_000));

        const p = previewOfflineHunt();
        expect(p).not.toBeNull();
        expect(p!.elapsedSeconds).toBe(100);
        expect(p!.cappedSeconds).toBe(100);
        expect(p!.speedMultiplier).toBe(1);
        expect(p!.kills).toBe(10);
    });

    it('caps cappedSeconds at OFFLINE_HUNT_MAX_SECONDS (12h)', () => {
        const monster = makeMonster();
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 24 * 60 * 60 * 1000));

        const p = previewOfflineHunt()!;
        expect(p.elapsedSeconds).toBe(24 * 60 * 60);
        expect(p.cappedSeconds).toBe(OFFLINE_HUNT_MAX_SECONDS);
        expect(p.kills).toBe(Math.floor(OFFLINE_HUNT_MAX_SECONDS / OFFLINE_HUNT_BASE_SECONDS_PER_KILL));
    });

    it('reports the chosen monster and skill back', () => {
        const monster = makeMonster({ id: 'goblin' });
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 60_000));

        const p = previewOfflineHunt()!;
        expect(p.monster.id).toBe('goblin');
        expect(p.skillId).toBe('sword_fighting');
    });

    it('returns 0 kills when no time has elapsed', () => {
        const monster = makeMonster();
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        const p = previewOfflineHunt()!;
        expect(p.elapsedSeconds).toBe(0);
        expect(p.kills).toBe(0);
        expect(p.xpGained).toBe(0);
        expect(p.goldGained).toBe(0);
    });

    it('clamps negative elapsed (clock skew) to 0', () => {
        const monster = makeMonster();
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs + 60_000).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });

        const p = previewOfflineHunt()!;
        expect(p.elapsedSeconds).toBe(0);
        expect(p.kills).toBe(0);
    });

    it('uses higher kills-per-second when mastery >= 5 (x2 speed)', () => {
        const monster = makeMonster({ id: 'rat', level: 5 });
        useMasteryStore.setState({
            masteries: { rat: { level: 5 } },
            masteryKills: {},
        });
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 100_000));

        const p = previewOfflineHunt()!;
        expect(p.speedMultiplier).toBe(2);
        expect(p.kills).toBe(20);
    });

    it('reaches x4 speed at mastery >= 20', () => {
        const monster = makeMonster({ id: 'rat' });
        useMasteryStore.setState({
            masteries: { rat: { level: 25 } },
            masteryKills: {},
        });
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 100_000));

        const p = previewOfflineHunt()!;
        expect(p.speedMultiplier).toBe(4);
        expect(p.kills).toBe(40);
    });

    it('xpGained scales with mastery XP bonus (+2% per level)', () => {
        const monster = makeMonster({ id: 'rat', level: 5, xp: 100, gold: [10, 20] });
        useMasteryStore.setState({
            masteries: { rat: { level: 10 } },
            masteryKills: {},
        });
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 50_000));

        const p = previewOfflineHunt()!;
        expect(p.xpGained).toBe(p.kills * 120);
    });

    it('goldGained uses midpoint of gold range × mastery gold multiplier', () => {
        const monster = makeMonster({ id: 'rat', level: 5, gold: [10, 30] });
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 100_000));

        const p = previewOfflineHunt()!;
        expect(p.goldGained).toBe(p.kills * 20);
    });

    it('is read-only — does NOT mutate any store', () => {
        const character = makeCharacter({ level: 10, xp: 0, gold: 500 });
        useCharacterStore.setState({ character });
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: makeMonster(),
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 600_000));

        previewOfflineHunt();
        expect(useCharacterStore.getState().character?.xp).toBe(0);
        expect(useInventoryStore.getState().gold).toBe(0);
        expect(useOfflineHuntStore.getState().isActive).toBe(true);
    });
});


describe('claimOfflineHunt', () => {
    it('returns null when no hunt is active', () => {
        expect(claimOfflineHunt()).toBeNull();
    });

    it('returns null AND stops the hunt when no kills have accumulated', () => {
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useCharacterStore.setState({ character: makeCharacter() });
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: makeMonster(),
            trainedSkillId: 'sword_fighting',
        });
        const result = claimOfflineHunt();
        expect(result).toBeNull();
        expect(useOfflineHuntStore.getState().isActive).toBe(false);
    });

    it('grants XP and gold proportional to kills (with zero-randomness drops)', () => {
        stubAllRandomness();
        const character = makeCharacter({ level: 100, xp: 0, gold: 0, highest_level: 100 });
        useCharacterStore.setState({ character });
        const monster = makeMonster({ id: 'rat', level: 5, xp: 20, gold: [10, 20] });
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 60_000));

        const result = claimOfflineHunt();
        expect(result).not.toBeNull();
        expect(result!.kills).toBe(6);
        expect(result!.xpGained).toBe(6 * 20);
        expect(result!.goldGained).toBe(6 * 15);
        expect(result!.killsByRarity.normal).toBe(6);
        expect(result!.killsByRarity.strong).toBe(0);
        expect(result!.killsByRarity.epic).toBe(0);
        expect(result!.killsByRarity.legendary).toBe(0);
        expect(result!.killsByRarity.boss).toBe(0);
        expect(useInventoryStore.getState().gold).toBe(6 * 15);
        expect(useOfflineHuntStore.getState().isActive).toBe(false);
    });

    it('captures level progression in the result', () => {
        stubAllRandomness();
        const character = makeCharacter({ level: 1, xp: 0, gold: 0, highest_level: 1 });
        useCharacterStore.setState({ character });
        const monster = makeMonster({ id: 'rat', level: 5, xp: 20, gold: [10, 20] });
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 60_000));

        const r = claimOfflineHunt()!;
        expect(r.levelBefore).toBe(1);
        expect(r.levelAfter).toBe(1);
        expect(r.levelsGained).toBe(0);
        expect(r.xpProgressAfter).toBe(120);
        expect(r.xpPctOfLevel).toBeGreaterThan(0);
    });

    it('grants skill XP to the trained skill', () => {
        stubAllRandomness();
        useCharacterStore.setState({ character: makeCharacter({ level: 10 }) });
        const monster = makeMonster();
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 300_000));

        const r = claimOfflineHunt()!;
        expect(r.skillId).toBe('sword_fighting');
        expect(r.skillXpGained).toBeGreaterThan(0);
        expect(r.skillLevelBefore).toBe(0);
        const xpInStore = useSkillStore.getState().skillXp['sword_fighting'] ?? 0;
        const lvlInStore = useSkillStore.getState().skillLevels['sword_fighting'] ?? 0;
        expect(xpInStore + lvlInStore).toBeGreaterThan(0);
    });

    it('weights task / mastery progress by MONSTER_RARITY_TASK_KILLS', () => {
        stubAllRandomness();
        useCharacterStore.setState({ character: makeCharacter({ level: 10 }) });
        const monster = makeMonster({ id: 'rat', level: 5 });
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 100_000));

        claimOfflineHunt();

        const masteryKills = useMasteryStore.getState().getMasteryKills('rat');
        expect(masteryKills).toBe(10 * MONSTER_RARITY_TASK_KILLS.normal);
    });

    it('forwards earn_gold and kill_any progress into the daily-quest store', () => {
        stubAllRandomness();
        useCharacterStore.setState({ character: makeCharacter({ level: 10 }) });
        useDailyQuestStore.setState({
            lastRefreshDate: '2026-05-21',
            todayQuestDefs: [
                {
                    id: 'dq_kill',
                    name_pl: 'k', name_en: 'k', description_pl: 'd',
                    minLevel: 1,
                    goal: { type: 'kill_any', count: 9_999_999 },
                    rewards: { gold: 1, xp: 1 },
                },
                {
                    id: 'dq_gold',
                    name_pl: 'g', name_en: 'g', description_pl: 'd',
                    minLevel: 1,
                    goal: { type: 'earn_gold', count: 9_999_999 },
                    rewards: { gold: 1, xp: 1 },
                },
            ],
            activeQuests: [
                { questId: 'dq_kill', progress: 0, completed: false, claimed: false },
                { questId: 'dq_gold', progress: 0, completed: false, claimed: false },
            ],
        });
        const monster = makeMonster({ id: 'rat', level: 5, gold: [10, 20] });
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 100_000));

        const r = claimOfflineHunt()!;
        const dq = useDailyQuestStore.getState().activeQuests;
        const killQuest = dq.find((q) => q.questId === 'dq_kill');
        const goldQuest = dq.find((q) => q.questId === 'dq_gold');
        expect(killQuest!.progress).toBe(10);
        expect(goldQuest!.progress).toBe(r.goldGained);
    });

    it('stops the hunt after a successful claim', () => {
        stubAllRandomness();
        useCharacterStore.setState({ character: makeCharacter({ level: 10 }) });
        const monster = makeMonster();
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 60_000));

        claimOfflineHunt();
        const state = useOfflineHuntStore.getState();
        expect(state.isActive).toBe(false);
        expect(state.startedAt).toBeNull();
        expect(state.targetMonster).toBeNull();
        expect(state.trainedSkillId).toBeNull();
    });

    it('respects the 12h cap on cappedSeconds inside the claim path', () => {
        stubAllRandomness();
        useCharacterStore.setState({ character: makeCharacter({ level: 100 }) });
        const monster = makeMonster();
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 48 * 60 * 60 * 1000));

        const r = claimOfflineHunt()!;
        expect(r.cappedSeconds).toBe(OFFLINE_HUNT_MAX_SECONDS);
        expect(r.kills).toBe(Math.floor(OFFLINE_HUNT_MAX_SECONDS / OFFLINE_HUNT_BASE_SECONDS_PER_KILL));
    });

    it('reports the speedMultiplier matching the mastery snapshot', () => {
        stubAllRandomness();
        useCharacterStore.setState({ character: makeCharacter({ level: 100 }) });
        const monster = makeMonster({ id: 'rat' });
        useMasteryStore.setState({
            masteries: { rat: { level: 20 } },
            masteryKills: {},
        });
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 60_000));

        const r = claimOfflineHunt()!;
        expect(r.speedMultiplier).toBe(4);
    });

    it('mastery XP multiplier applies at claim time (snapshotted)', () => {
        stubAllRandomness();
        useCharacterStore.setState({ character: makeCharacter({ level: 100 }) });
        const monster = makeMonster({ id: 'rat', level: 5, xp: 100, gold: [10, 20] });
        useMasteryStore.setState({
            masteries: { rat: { level: 10 } },
            masteryKills: {},
        });
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 50_000));

        const r = claimOfflineHunt()!;
        expect(r.xpGained).toBe(r.kills * 120);
    });

    it('initializes empty drop containers when no drops roll', () => {
        stubAllRandomness();
        useCharacterStore.setState({ character: makeCharacter({ level: 10 }) });
        const monster = makeMonster();
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 60_000));

        const r = claimOfflineHunt()!;
        expect(r.itemDrops).toEqual([]);
        expect(r.potionDrops).toEqual({});
        expect(r.spellChestDrops).toEqual({});
        expect(r.stoneDrops).toEqual({});
    });

    it('sorts itemDrops descending by count', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.001);
        useCharacterStore.setState({ character: makeCharacter({ level: 10 }) });
        const monster = makeMonster({ id: 'rat', level: 5 });
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 60_000));

        const r = claimOfflineHunt()!;
        if (r.itemDrops.length > 1) {
            for (let i = 1; i < r.itemDrops.length; i++) {
                expect(r.itemDrops[i - 1].count).toBeGreaterThanOrEqual(r.itemDrops[i].count);
            }
        }
        expect(r.kills).toBeGreaterThan(0);
    });
});


describe('previewOfflineHunt – buff multipliers', () => {
    it('does NOT multiply XP when no buff is active (sanity baseline)', () => {
        const monster = makeMonster({ xp: 100, gold: [10, 20] });
        const startMs = 1_700_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(new Date(startMs));
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date(startMs).toISOString(),
            targetMonster: monster,
            trainedSkillId: 'sword_fighting',
        });
        vi.setSystemTime(new Date(startMs + 100_000));

        const p = previewOfflineHunt()!;
        expect(p.xpGained).toBe(10 * 100);
    });
});
