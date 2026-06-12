import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    useQuestStore,
    getActiveQuestKillProgress,
    type IQuest,
    type IActiveQuest,
} from './questStore';
import { MASTERY_MAX_LEVEL } from './masteryStore';

// -- Mocks --------------------------------------------------------------------
// questStore reads useCharacterStore.character.level inside addProgress as a
// defensive level gate, and dynamic-imports characterApi on claimQuest to push
// a one-shot quest counter. The masteryStore is read by refreshMasteryProgress.

const characterStateMock = { character: { id: 'c1', level: 100 } };

vi.mock('./characterStore', () => ({
    useCharacterStore: {
        getState: () => characterStateMock,
    },
}));

const masteryStoreState = {
    masteries: {} as Record<string, { level: number }>,
    getMasteryLevel: (monsterId: string) => masteryStoreState.masteries[monsterId]?.level ?? 0,
};

vi.mock('./masteryStore', async () => {
    const actual = await vi.importActual<typeof import('./masteryStore')>('./masteryStore');
    return {
        ...actual,
        useMasteryStore: {
            getState: () => masteryStoreState,
        },
    };
});

vi.mock('../api/v1/characterApi', () => ({
    characterApi: {
        bumpStat: vi.fn().mockResolvedValue(undefined),
    },
}));

// -- Fixtures -----------------------------------------------------------------

const makeQuest = (overrides: Partial<IQuest> = {}): IQuest => ({
    id: 'test_quest',
    name_pl: 'Test Quest',
    name_en: 'Test Quest',
    minLevel: 1,
    goals: [
        { type: 'kill', monsterId: 'rat', count: 10 },
    ],
    rewards: [{ type: 'gold', amount: 100 }],
    description_pl: 'opis',
    description_en: 'desc',
    ...overrides,
});

// -- Helpers ------------------------------------------------------------------

const resetStore = (): void => {
    useQuestStore.setState({ activeQuests: [], completedQuestIds: [] });
    characterStateMock.character.level = 100;
    masteryStoreState.masteries = {};
};

// -- Tests --------------------------------------------------------------------

describe('questStore — initial state', () => {
    beforeEach(resetStore);

    it('starts with no active or completed quests', () => {
        const s = useQuestStore.getState();
        expect(s.activeQuests).toEqual([]);
        expect(s.completedQuestIds).toEqual([]);
    });
});

describe('questStore — startQuest', () => {
    beforeEach(resetStore);

    it('adds a quest to activeQuests with progress 0', () => {
        const quest = makeQuest();
        useQuestStore.getState().startQuest(quest);
        const s = useQuestStore.getState();
        expect(s.activeQuests).toHaveLength(1);
        expect(s.activeQuests[0].questId).toBe(quest.id);
        expect(s.activeQuests[0].goals[0].progress).toBe(0);
    });

    it('records the startedAt timestamp as an ISO string', () => {
        useQuestStore.getState().startQuest(makeQuest());
        expect(typeof useQuestStore.getState().activeQuests[0].startedAt).toBe('string');
    });

    it('refuses to start an already-active quest', () => {
        useQuestStore.getState().startQuest(makeQuest({ id: 'q1' }));
        useQuestStore.getState().startQuest(makeQuest({ id: 'q1' }));
        expect(useQuestStore.getState().activeQuests).toHaveLength(1);
    });

    it('refuses to start an already-completed quest', () => {
        useQuestStore.setState({ activeQuests: [], completedQuestIds: ['q_done'] });
        useQuestStore.getState().startQuest(makeQuest({ id: 'q_done' }));
        expect(useQuestStore.getState().activeQuests).toHaveLength(0);
    });

    it('allows multiple distinct quests in parallel', () => {
        useQuestStore.getState().startQuest(makeQuest({ id: 'a' }));
        useQuestStore.getState().startQuest(makeQuest({ id: 'b' }));
        useQuestStore.getState().startQuest(makeQuest({ id: 'c' }));
        expect(useQuestStore.getState().activeQuests).toHaveLength(3);
    });

    it('special-cases mastery_all_at_level goals (count -> totalMonsters, minMonsterLevel -> required mastery)', () => {
        const requiredMasteryLevel = 5;
        useQuestStore.getState().startQuest(makeQuest({
            id: 'mastery_q',
            goals: [{ type: 'mastery_all_at_level', count: requiredMasteryLevel }],
        }));
        const goal = useQuestStore.getState().activeQuests[0].goals[0];
        expect(goal.minMonsterLevel).toBe(requiredMasteryLevel);
        // count is reassigned to total monster pool size — just verify it's been changed
        expect(goal.count).toBeGreaterThan(requiredMasteryLevel);
    });
});

describe('questStore — addProgress (kill)', () => {
    beforeEach(resetStore);

    it('increments matching kill goals', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q1',
            goals: [{ type: 'kill', monsterId: 'rat', count: 10 }],
        }));
        useQuestStore.getState().addProgress('kill', 'rat', 3);
        useQuestStore.getState().addProgress('kill', 'rat', 2);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(5);
    });

    it('does NOT progress goals for a different monster', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q1',
            goals: [{ type: 'kill', monsterId: 'rat', count: 10 }],
        }));
        useQuestStore.getState().addProgress('kill', 'goblin', 5);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(0);
    });

    it('caps progress at the goal count', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q1',
            goals: [{ type: 'kill', monsterId: 'rat', count: 10 }],
        }));
        useQuestStore.getState().addProgress('kill', 'rat', 999);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(10);
    });

    it('progresses only the matching goal in a multi-goal quest', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q1',
            goals: [
                { type: 'kill', monsterId: 'rat', count: 10 },
                { type: 'kill', monsterId: 'goblin', count: 5 },
            ],
        }));
        useQuestStore.getState().addProgress('kill', 'rat', 2);
        const goals = useQuestStore.getState().activeQuests[0].goals;
        expect(goals[0].progress).toBe(2);
        expect(goals[1].progress).toBe(0);
    });

    it('respects the minLevel gate (no progress when char level < quest minLevel)', () => {
        // Use a quest id NOT in quests.json so getQuestById returns undefined
        // -> no level gate. Instead, ensure the gate fires for known quests:
        characterStateMock.character.level = 5;
        // 'quest_first_steps' is a real quest with minLevel=10
        const realQuest: IQuest = {
            id: 'quest_first_steps',
            name_pl: 'x', name_en: 'x',
            minLevel: 10,
            goals: [{ type: 'kill', monsterId: 'rat', count: 10 }],
            rewards: [],
            description_pl: '', description_en: '',
        };
        useQuestStore.setState({
            activeQuests: [{
                questId: realQuest.id,
                goals: realQuest.goals.map((g) => ({ ...g, progress: 0 })),
                startedAt: new Date().toISOString(),
            }],
            completedQuestIds: [],
        });
        useQuestStore.getState().addProgress('kill', 'rat', 5);
        // Player is below minLevel -> no progress
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(0);
    });
});

describe('questStore — addProgress (drop_rarity)', () => {
    beforeEach(resetStore);

    it('progresses when dropped rarity ≥ required', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_drop',
            goals: [{ type: 'drop_rarity', rarity: 'rare', count: 5 }],
        }));
        useQuestStore.getState().addProgress('drop_rarity', 'epic', 1);
        useQuestStore.getState().addProgress('drop_rarity', 'rare', 1);
        // common < required (rare) -> skipped
        useQuestStore.getState().addProgress('drop_rarity', 'common', 1);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(2);
    });

    it('progresses for higher-tier drops (heroic counts for any tier)', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_drop',
            goals: [{ type: 'drop_rarity', rarity: 'common', count: 3 }],
        }));
        useQuestStore.getState().addProgress('drop_rarity', 'heroic', 1);
        useQuestStore.getState().addProgress('drop_rarity', 'mythic', 1);
        useQuestStore.getState().addProgress('drop_rarity', 'common', 1);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(3);
    });

    it('does not progress for an unknown rarity string', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_drop',
            goals: [{ type: 'drop_rarity', rarity: 'rare', count: 5 }],
        }));
        useQuestStore.getState().addProgress('drop_rarity', 'gibberish', 1);
        // gibberish gets rank 0 < 1 -> skipped
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(0);
    });
});

describe('questStore — addProgress (kill_rarity)', () => {
    beforeEach(resetStore);

    it('progresses when monster rarity meets the threshold and level is high enough', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_kill_rarity',
            goals: [{ type: 'kill_rarity', rarity: 'strong', count: 5, minMonsterLevel: 10 }],
        }));
        useQuestStore.getState().addProgress('kill_rarity', 'epic', 1, 15);
        useQuestStore.getState().addProgress('kill_rarity', 'strong', 1, 10);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(2);
    });

    it('skips kills below the minimum monster level', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_kill_rarity',
            goals: [{ type: 'kill_rarity', rarity: 'strong', count: 5, minMonsterLevel: 50 }],
        }));
        useQuestStore.getState().addProgress('kill_rarity', 'epic', 1, 10);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(0);
    });

    it('skips kills below the required rarity', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_kill_rarity',
            goals: [{ type: 'kill_rarity', rarity: 'epic', count: 5, minMonsterLevel: 1 }],
        }));
        useQuestStore.getState().addProgress('kill_rarity', 'strong', 1, 50);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(0);
    });

    it('"any" rarity accepts every kill that meets the level requirement', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_kill_rarity',
            goals: [{ type: 'kill_rarity', rarity: 'any', count: 5, minMonsterLevel: 1 }],
        }));
        useQuestStore.getState().addProgress('kill_rarity', 'normal', 1, 5);
        useQuestStore.getState().addProgress('kill_rarity', 'strong', 1, 5);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(2);
    });
});

describe('questStore — addProgress (complete_dungeons_any / kill_bosses_any / boss / dungeon)', () => {
    beforeEach(resetStore);

    it('complete_dungeons_any counts every dungeon regardless of targetId', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_any_dung',
            goals: [{ type: 'complete_dungeons_any', count: 3 }],
        }));
        useQuestStore.getState().addProgress('complete_dungeons_any', 'dungeon_1', 1);
        useQuestStore.getState().addProgress('complete_dungeons_any', 'dungeon_99', 1);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(2);
    });

    it('kill_bosses_any counts every boss kill', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_any_boss',
            goals: [{ type: 'kill_bosses_any', count: 5 }],
        }));
        useQuestStore.getState().addProgress('kill_bosses_any', 'boss_25', 1);
        useQuestStore.getState().addProgress('kill_bosses_any', 'boss_50', 1);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(2);
    });

    it('boss progress requires a matching bossId', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_boss',
            goals: [{ type: 'boss', bossId: 'boss_25', count: 1 }],
        }));
        useQuestStore.getState().addProgress('boss', 'boss_50', 1);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(0);
        useQuestStore.getState().addProgress('boss', 'boss_25', 1);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(1);
    });

    it('dungeon progress requires a matching dungeonId', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_dung',
            goals: [{ type: 'dungeon', dungeonId: 'dungeon_1', count: 1 }],
        }));
        useQuestStore.getState().addProgress('dungeon', 'dungeon_99', 1);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(0);
        useQuestStore.getState().addProgress('dungeon', 'dungeon_1', 1);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(1);
    });
});

describe('questStore — addProgress (mastery goals are no-ops)', () => {
    beforeEach(resetStore);

    it('mastery_total cannot be incremented via addProgress', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_mt',
            goals: [{ type: 'mastery_total', count: 100 }],
        }));
        useQuestStore.getState().addProgress('mastery_total', 'anything', 50);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(0);
    });

    it('mastery_max_count cannot be incremented via addProgress', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_mm',
            goals: [{ type: 'mastery_max_count', count: 5 }],
        }));
        useQuestStore.getState().addProgress('mastery_max_count', 'anything', 3);
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(0);
    });
});

describe('questStore — refreshMasteryProgress', () => {
    beforeEach(resetStore);

    it('updates mastery_total goal from the mastery store snapshot', () => {
        masteryStoreState.masteries = {
            rat: { level: 5 },
            goblin: { level: 3 },
        };
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_mt',
            goals: [{ type: 'mastery_total', count: 100 }],
        }));
        useQuestStore.getState().refreshMasteryProgress();
        // 5 + 3 = 8
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(8);
    });

    it('updates mastery_max_count goal with the number of monsters at MAX_LEVEL', () => {
        masteryStoreState.masteries = {
            rat: { level: MASTERY_MAX_LEVEL },
            goblin: { level: MASTERY_MAX_LEVEL },
            spider: { level: MASTERY_MAX_LEVEL - 1 },
        };
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_mm',
            goals: [{ type: 'mastery_max_count', count: 50 }],
        }));
        useQuestStore.getState().refreshMasteryProgress();
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(2);
    });

    it('updates mastery_all_at_level goal with monsters at-or-above the threshold', () => {
        masteryStoreState.masteries = {
            rat: { level: 5 },
            goblin: { level: 7 },
            spider: { level: 2 },
        };
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_all',
            goals: [{ type: 'mastery_all_at_level', count: 5 }],
        }));
        useQuestStore.getState().refreshMasteryProgress();
        // 2 monsters at level ≥ 5
        expect(useQuestStore.getState().activeQuests[0].goals[0].progress).toBe(2);
    });
});

describe('questStore — claimQuest', () => {
    beforeEach(resetStore);

    it('is a no-op when the quest is not active', () => {
        useQuestStore.getState().claimQuest('does_not_exist');
        expect(useQuestStore.getState().completedQuestIds).toEqual([]);
    });

    it('refuses to claim an incomplete quest', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q1',
            goals: [{ type: 'kill', monsterId: 'rat', count: 10 }],
        }));
        useQuestStore.getState().addProgress('kill', 'rat', 5);
        useQuestStore.getState().claimQuest('q1');
        expect(useQuestStore.getState().completedQuestIds).toEqual([]);
        // Still active
        expect(useQuestStore.getState().activeQuests).toHaveLength(1);
    });

    it('claims a complete quest, moves it to completedQuestIds, and clears from activeQuests', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q1',
            goals: [{ type: 'kill', monsterId: 'rat', count: 5 }],
        }));
        useQuestStore.getState().addProgress('kill', 'rat', 5);
        useQuestStore.getState().claimQuest('q1');
        const s = useQuestStore.getState();
        expect(s.completedQuestIds).toContain('q1');
        expect(s.activeQuests).toHaveLength(0);
    });

    it('requires every goal to be complete (any unmet goal blocks the claim)', () => {
        useQuestStore.getState().startQuest(makeQuest({
            id: 'q_multi',
            goals: [
                { type: 'kill', monsterId: 'rat', count: 5 },
                { type: 'kill', monsterId: 'goblin', count: 5 },
            ],
        }));
        useQuestStore.getState().addProgress('kill', 'rat', 5);
        useQuestStore.getState().claimQuest('q_multi');
        // Second goal still incomplete -> no claim
        expect(useQuestStore.getState().completedQuestIds).toEqual([]);
        useQuestStore.getState().addProgress('kill', 'goblin', 5);
        useQuestStore.getState().claimQuest('q_multi');
        expect(useQuestStore.getState().completedQuestIds).toContain('q_multi');
    });
});

describe('questStore — abandonQuest', () => {
    beforeEach(resetStore);

    it('removes an active quest without marking it complete', () => {
        useQuestStore.getState().startQuest(makeQuest({ id: 'q_abandon' }));
        useQuestStore.getState().abandonQuest('q_abandon');
        const s = useQuestStore.getState();
        expect(s.activeQuests).toHaveLength(0);
        expect(s.completedQuestIds).not.toContain('q_abandon');
    });

    it('is a no-op when the quest id is unknown', () => {
        useQuestStore.getState().startQuest(makeQuest({ id: 'q1' }));
        useQuestStore.getState().abandonQuest('nope');
        expect(useQuestStore.getState().activeQuests).toHaveLength(1);
    });
});

describe('questStore — isActive / isCompleted (hasActiveQuest / getCompletedCount)', () => {
    beforeEach(resetStore);

    it('isActive reflects activeQuests membership', () => {
        useQuestStore.getState().startQuest(makeQuest({ id: 'q1' }));
        expect(useQuestStore.getState().isActive('q1')).toBe(true);
        expect(useQuestStore.getState().isActive('q2')).toBe(false);
    });

    it('isCompleted reflects completedQuestIds membership', () => {
        useQuestStore.setState({ activeQuests: [], completedQuestIds: ['q_done'] });
        expect(useQuestStore.getState().isCompleted('q_done')).toBe(true);
        expect(useQuestStore.getState().isCompleted('q_not')).toBe(false);
    });

    it('completedQuestIds length is the "getCompletedCount" equivalent', () => {
        useQuestStore.setState({
            activeQuests: [],
            completedQuestIds: ['a', 'b', 'c'],
        });
        expect(useQuestStore.getState().completedQuestIds.length).toBe(3);
    });
});

describe('questStore — getActiveQuestKillProgress', () => {
    beforeEach(resetStore);

    it('returns empty array when no active quests target the monster', () => {
        const active: IActiveQuest[] = [];
        expect(getActiveQuestKillProgress(active, 'rat')).toEqual([]);
    });

    it('returns badges only for matching kill goals', () => {
        const active: IActiveQuest[] = [{
            questId: 'q1',
            goals: [
                { type: 'kill', monsterId: 'rat', count: 10, progress: 3 },
                { type: 'kill', monsterId: 'goblin', count: 5, progress: 0 },
            ],
            startedAt: new Date().toISOString(),
        }];
        const badges = getActiveQuestKillProgress(active, 'rat');
        expect(badges).toHaveLength(1);
        expect(badges[0].progress).toBe(3);
        expect(badges[0].count).toBe(10);
        expect(badges[0].done).toBe(false);
    });

    it('flags a badge as done when progress ≥ count', () => {
        const active: IActiveQuest[] = [{
            questId: 'q1',
            goals: [{ type: 'kill', monsterId: 'rat', count: 5, progress: 5 }],
            startedAt: new Date().toISOString(),
        }];
        const badges = getActiveQuestKillProgress(active, 'rat');
        expect(badges[0].done).toBe(true);
    });

    it('skips kill_rarity goals (intentional — they match by tier, not monsterId)', () => {
        const active: IActiveQuest[] = [{
            questId: 'q1',
            goals: [{ type: 'kill_rarity', rarity: 'epic', count: 5, progress: 0 }],
            startedAt: new Date().toISOString(),
        }];
        expect(getActiveQuestKillProgress(active, 'rat')).toHaveLength(0);
    });
});
