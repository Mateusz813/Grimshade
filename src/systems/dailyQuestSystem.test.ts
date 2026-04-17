import { describe, it, expect } from 'vitest';
import {
    getTodayKey,
    needsRefresh,
    selectDailyQuests,
    scaleRewards,
    DAILY_QUEST_COUNT,
    type IDailyQuestDef,
} from './dailyQuestSystem';

const makeMockQuest = (id: string, minLevel: number, goalType: string = 'kill_any', count: number = 10): IDailyQuestDef => ({
    id,
    name_pl: id,
    name_en: id,
    description_pl: 'd',
    minLevel,
    goal: { type: goalType as IDailyQuestDef['goal']['type'], count },
    rewards: { gold: 500, xp: 200 },
});

// Generate 20 mock quests to ensure we have enough to select 10
const MOCK_QUESTS: IDailyQuestDef[] = [
    makeMockQuest('q1', 25, 'kill_any', 5),
    makeMockQuest('q2', 25, 'kill_any', 10),
    makeMockQuest('q3', 25, 'kill_any', 20),
    makeMockQuest('q4', 25, 'earn_gold', 500),
    makeMockQuest('q5', 25, 'earn_gold', 1500),
    makeMockQuest('q6', 25, 'complete_dungeon', 1),
    makeMockQuest('q7', 40, 'complete_dungeon', 2),
    makeMockQuest('q8', 40, 'kill_boss', 1),
    makeMockQuest('q9', 25, 'use_potion', 3),
    makeMockQuest('q10', 25, 'use_potion', 8),
    makeMockQuest('q11', 25, 'deal_damage', 500),
    makeMockQuest('q12', 35, 'deal_damage', 2000),
    makeMockQuest('q13', 50, 'deal_damage', 5000),
    makeMockQuest('q14', 50, 'kill_any', 35),
    makeMockQuest('q15', 60, 'kill_any', 50),
    makeMockQuest('q16', 25, 'kill_any', 15),
    makeMockQuest('q17', 30, 'earn_gold', 3000),
    makeMockQuest('q18', 40, 'kill_boss', 2),
    makeMockQuest('q19', 50, 'use_potion', 15),
    makeMockQuest('q20', 80, 'deal_damage', 15000),
];

describe('DAILY_QUEST_COUNT', () => {
    it('should be 12', () => {
        expect(DAILY_QUEST_COUNT).toBe(12);
    });
});

describe('getTodayKey', () => {
    it('returns YYYY-MM-DD format', () => {
        const key = getTodayKey();
        expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

describe('needsRefresh', () => {
    it('returns true when no last refresh date', () => {
        expect(needsRefresh(null)).toBe(true);
    });

    it('returns false when last refresh is today', () => {
        expect(needsRefresh(getTodayKey())).toBe(false);
    });

    it('returns true when last refresh is yesterday', () => {
        expect(needsRefresh('2020-01-01')).toBe(true);
    });
});

describe('selectDailyQuests', () => {
    it('returns max 12 quests', () => {
        const selected = selectDailyQuests(MOCK_QUESTS, 100);
        expect(selected.length).toBe(12);
    });

    it('filters by player level', () => {
        const selected = selectDailyQuests(MOCK_QUESTS, 25);
        for (const q of selected) {
            expect(q.minLevel).toBeLessThanOrEqual(25);
        }
    });

    it('returns all if fewer than 12 eligible', () => {
        const fewQuests = MOCK_QUESTS.slice(0, 3);
        expect(selectDailyQuests(fewQuests, 100).length).toBe(3);
    });

    it('returns same quests for same day (deterministic)', () => {
        const a = selectDailyQuests(MOCK_QUESTS, 100);
        const b = selectDailyQuests(MOCK_QUESTS, 100);
        expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
    });

    it('includes new goal types (use_potion, deal_damage)', () => {
        const selected = selectDailyQuests(MOCK_QUESTS, 100);
        const goalTypes = new Set(selected.map((q) => q.goal.type));
        // With 20 quests and 12 selected, we should have variety
        expect(goalTypes.size).toBeGreaterThanOrEqual(2);
    });
});

describe('scaleRewards', () => {
    it('applies level-based gold scaling: base * (1 + level * 0.25)', () => {
        const scaled = scaleRewards({ gold: 100, xp: 100 }, 4);
        // 100 * (1 + 4 * 0.25) = 100 * 2 = 200
        expect(scaled.gold).toBe(200);
    });

    it('applies level-based xp scaling: base * (1 + level * 0.3)', () => {
        const scaled = scaleRewards({ gold: 100, xp: 100 }, 10);
        // 100 * (1 + 10 * 0.3) = 100 * 4 = 400
        expect(scaled.xp).toBe(400);
    });

    it('returns base rewards at level 0', () => {
        const scaled = scaleRewards({ gold: 500, xp: 200 }, 0);
        expect(scaled.gold).toBe(500);
        expect(scaled.xp).toBe(200);
    });

    it('scales significantly at high levels', () => {
        const scaled = scaleRewards({ gold: 500, xp: 200 }, 100);
        // gold: 500 * (1 + 100 * 0.25) = 500 * 26 = 13000
        expect(scaled.gold).toBe(13000);
        // xp: 200 * (1 + 100 * 0.3) = 200 * 31 = 6200
        expect(scaled.xp).toBe(6200);
    });

    it('preserves elixir reward', () => {
        const scaled = scaleRewards({ gold: 300, xp: 100, elixir: 'xp_elixir' }, 50);
        expect(scaled.elixir).toBe('xp_elixir');
    });
});
