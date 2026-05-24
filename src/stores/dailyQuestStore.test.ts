import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDailyQuestStore } from './dailyQuestStore';
import { getTodayKey, DAILY_QUEST_COUNT } from '../systems/dailyQuestSystem';

// ── Mocks ────────────────────────────────────────────────────────────────────
// claimReward dynamically imports characterStore + characterApi to bump a
// leaderboard column. Mock both so the test focuses on store state changes.

vi.mock('./characterStore', () => ({
    useCharacterStore: {
        getState: () => ({
            character: { id: 'test-char-id' },
        }),
    },
}));

vi.mock('../api/v1/characterApi', () => ({
    characterApi: {
        bumpStat: vi.fn().mockResolvedValue(undefined),
    },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const resetStore = (): void => {
    useDailyQuestStore.getState().resetDailyQuests();
};

// Force a refresh at a known player level so the rest of the test has a
// deterministic active-quest list.
const seedTodayQuests = (playerLevel = 100): void => {
    useDailyQuestStore.getState().refreshIfNeeded(playerLevel);
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('dailyQuestStore — initial state', () => {
    beforeEach(resetStore);

    it('has no last refresh date', () => {
        expect(useDailyQuestStore.getState().lastRefreshDate).toBeNull();
    });

    it('starts with empty active quests', () => {
        expect(useDailyQuestStore.getState().activeQuests).toEqual([]);
    });

    it('starts with empty quest defs', () => {
        expect(useDailyQuestStore.getState().todayQuestDefs).toEqual([]);
    });
});

describe('dailyQuestStore — refreshIfNeeded (refreshDailyQuests)', () => {
    beforeEach(resetStore);

    it('populates today\'s quests on first call', () => {
        useDailyQuestStore.getState().refreshIfNeeded(100);
        const s = useDailyQuestStore.getState();
        expect(s.lastRefreshDate).toBe(getTodayKey());
        expect(s.activeQuests.length).toBeGreaterThan(0);
        expect(s.activeQuests.length).toBeLessThanOrEqual(DAILY_QUEST_COUNT);
    });

    it('initialises each active quest with progress 0 and not completed/claimed', () => {
        useDailyQuestStore.getState().refreshIfNeeded(100);
        const s = useDailyQuestStore.getState();
        for (const aq of s.activeQuests) {
            expect(aq.progress).toBe(0);
            expect(aq.completed).toBe(false);
            expect(aq.claimed).toBe(false);
        }
    });

    it('is idempotent when called twice on the same day', () => {
        useDailyQuestStore.getState().refreshIfNeeded(100);
        const firstSnapshot = useDailyQuestStore.getState().activeQuests;
        // Mutate progress so we can verify the second call doesn't overwrite
        useDailyQuestStore.setState({
            activeQuests: firstSnapshot.map((aq) => ({ ...aq, progress: 999 })),
        });
        useDailyQuestStore.getState().refreshIfNeeded(100);
        const secondSnapshot = useDailyQuestStore.getState().activeQuests;
        // No reset → progress kept
        expect(secondSnapshot[0].progress).toBe(999);
    });

    it('forces refresh when lastRefreshDate is from a different day', () => {
        useDailyQuestStore.setState({
            lastRefreshDate: '1999-01-01',
            activeQuests: [],
            todayQuestDefs: [],
        });
        useDailyQuestStore.getState().refreshIfNeeded(100);
        expect(useDailyQuestStore.getState().lastRefreshDate).toBe(getTodayKey());
        expect(useDailyQuestStore.getState().activeQuests.length).toBeGreaterThan(0);
    });

    it('only returns quests whose minLevel ≤ playerLevel', () => {
        useDailyQuestStore.getState().refreshIfNeeded(25);
        const defs = useDailyQuestStore.getState().todayQuestDefs;
        for (const def of defs) {
            expect(def.minLevel).toBeLessThanOrEqual(25);
        }
    });

    it('returns no quests when player level is below every quest\'s minLevel', () => {
        // Daily quests all start at minLevel >= 25 in the JSON
        useDailyQuestStore.getState().refreshIfNeeded(0);
        expect(useDailyQuestStore.getState().activeQuests).toEqual([]);
    });
});

describe('dailyQuestStore — addProgress', () => {
    beforeEach(() => {
        resetStore();
        seedTodayQuests(100);
    });

    it('increments quests of the matching goal type', () => {
        // Find a kill_any quest from today's batch
        const { todayQuestDefs } = useDailyQuestStore.getState();
        const killQuest = todayQuestDefs.find((d) => d.goal.type === 'kill_any');
        if (!killQuest) return; // can't run this assertion w/o a kill quest in pool
        useDailyQuestStore.getState().addProgress('kill_any', 1);
        const aq = useDailyQuestStore.getState().activeQuests.find((q) => q.questId === killQuest.id);
        expect(aq?.progress).toBe(1);
    });

    it('ignores progress for unmatched goal types', () => {
        useDailyQuestStore.getState().addProgress('use_potion', 5);
        // Any quest not of type "use_potion" should still be at 0
        const { activeQuests, todayQuestDefs } = useDailyQuestStore.getState();
        for (const aq of activeQuests) {
            const def = todayQuestDefs.find((d) => d.id === aq.questId);
            if (def && def.goal.type !== 'use_potion') {
                expect(aq.progress).toBe(0);
            }
        }
    });

    it('caps progress at the goal count', () => {
        // Pick the first quest, find its target count, then over-progress
        const def = useDailyQuestStore.getState().todayQuestDefs[0];
        if (!def) return;
        useDailyQuestStore.getState().addProgress(def.goal.type, def.goal.count + 9999);
        const aq = useDailyQuestStore.getState().activeQuests.find((q) => q.questId === def.id);
        expect(aq?.progress).toBe(def.goal.count);
        expect(aq?.completed).toBe(true);
    });

    it('flips completed → true once progress reaches the count', () => {
        const def = useDailyQuestStore.getState().todayQuestDefs[0];
        if (!def) return;
        useDailyQuestStore.getState().addProgress(def.goal.type, def.goal.count);
        const aq = useDailyQuestStore.getState().activeQuests.find((q) => q.questId === def.id);
        expect(aq?.completed).toBe(true);
    });

    it('does not progress an already-claimed quest', () => {
        const def = useDailyQuestStore.getState().todayQuestDefs[0];
        if (!def) return;
        // Mark it claimed manually
        useDailyQuestStore.setState({
            activeQuests: useDailyQuestStore.getState().activeQuests.map((aq) =>
                aq.questId === def.id ? { ...aq, claimed: true, progress: 0 } : aq,
            ),
        });
        useDailyQuestStore.getState().addProgress(def.goal.type, def.goal.count);
        const aq = useDailyQuestStore.getState().activeQuests.find((q) => q.questId === def.id);
        // Progress untouched because claimed=true
        expect(aq?.progress).toBe(0);
    });
});

describe('dailyQuestStore — claimReward', () => {
    beforeEach(() => {
        resetStore();
        seedTodayQuests(100);
    });

    it('returns null when the quest is not in active quests', () => {
        const result = useDailyQuestStore.getState().claimReward('does_not_exist', 100);
        expect(result).toBeNull();
    });

    it('returns null when the quest is incomplete', () => {
        const def = useDailyQuestStore.getState().todayQuestDefs[0];
        if (!def) return;
        const result = useDailyQuestStore.getState().claimReward(def.id, 100);
        expect(result).toBeNull();
    });

    it('returns null on a double-claim attempt', () => {
        const def = useDailyQuestStore.getState().todayQuestDefs[0];
        if (!def) return;
        useDailyQuestStore.getState().addProgress(def.goal.type, def.goal.count);
        const first = useDailyQuestStore.getState().claimReward(def.id, 100);
        const second = useDailyQuestStore.getState().claimReward(def.id, 100);
        expect(first).not.toBeNull();
        expect(second).toBeNull();
    });

    it('returns scaled rewards (gold + xp positive)', () => {
        const def = useDailyQuestStore.getState().todayQuestDefs[0];
        if (!def) return;
        useDailyQuestStore.getState().addProgress(def.goal.type, def.goal.count);
        const result = useDailyQuestStore.getState().claimReward(def.id, 100);
        expect(result).not.toBeNull();
        expect(result?.gold).toBeGreaterThan(0);
        expect(result?.xp).toBeGreaterThan(0);
    });

    it('marks the quest as claimed in store state', () => {
        const def = useDailyQuestStore.getState().todayQuestDefs[0];
        if (!def) return;
        useDailyQuestStore.getState().addProgress(def.goal.type, def.goal.count);
        useDailyQuestStore.getState().claimReward(def.id, 100);
        const aq = useDailyQuestStore.getState().activeQuests.find((q) => q.questId === def.id);
        expect(aq?.claimed).toBe(true);
    });

    it('scales the reward with the player level (higher level → bigger rewards)', () => {
        const def = useDailyQuestStore.getState().todayQuestDefs[0];
        if (!def) return;
        useDailyQuestStore.getState().addProgress(def.goal.type, def.goal.count);
        const lowRewards = useDailyQuestStore.getState().claimReward(def.id, 1);
        // Reset + re-prime so we can claim again at a higher level
        resetStore();
        seedTodayQuests(500);
        const def2 = useDailyQuestStore.getState().todayQuestDefs.find((d) => d.id === def.id);
        if (!def2) return; // Daily quests are sampled — skip if def isn't selected
        useDailyQuestStore.getState().addProgress(def2.goal.type, def2.goal.count);
        const highRewards = useDailyQuestStore.getState().claimReward(def2.id, 500);
        expect(highRewards?.gold ?? 0).toBeGreaterThan(lowRewards?.gold ?? 0);
        expect(highRewards?.xp ?? 0).toBeGreaterThan(lowRewards?.xp ?? 0);
    });
});

describe('dailyQuestStore — resetDailyQuests', () => {
    beforeEach(resetStore);

    it('returns the store to its initial state', () => {
        seedTodayQuests(100);
        useDailyQuestStore.getState().resetDailyQuests();
        const s = useDailyQuestStore.getState();
        expect(s.lastRefreshDate).toBeNull();
        expect(s.activeQuests).toEqual([]);
        expect(s.todayQuestDefs).toEqual([]);
    });
});
