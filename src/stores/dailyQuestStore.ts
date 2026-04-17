import { create } from 'zustand';
import {
    getTodayKey,
    needsRefresh,
    selectDailyQuests,
    scaleRewards,
    type DailyQuestGoalType,
    type IDailyQuestDef,
    type IActiveDailyQuest,
} from '../systems/dailyQuestSystem';
import dailyQuestsRaw from '../data/dailyQuests.json';

const ALL_DAILY_QUESTS = dailyQuestsRaw as IDailyQuestDef[];

interface IDailyQuestState {
    /** Date key when quests were last refreshed */
    lastRefreshDate: string | null;
    /** Today's active daily quests */
    activeQuests: IActiveDailyQuest[];
    /** Quest definitions for today (cached) */
    todayQuestDefs: IDailyQuestDef[];
}

interface IDailyQuestStore extends IDailyQuestState {
    /** Refresh daily quests if it's a new day */
    refreshIfNeeded: (playerLevel: number) => void;
    /** Increment progress for a specific goal type */
    addProgress: (goalType: DailyQuestGoalType, amount: number) => void;
    /** Claim rewards for a completed quest */
    claimReward: (questId: string, playerLevel: number) => { gold: number; xp: number; elixir?: string } | null;
    /** Reset all daily quest data */
    resetDailyQuests: () => void;
}

const INITIAL_STATE: IDailyQuestState = {
    lastRefreshDate: null,
    activeQuests: [],
    todayQuestDefs: [],
};

export const useDailyQuestStore = create<IDailyQuestStore>()(
        (set, get) => ({
            ...INITIAL_STATE,

            refreshIfNeeded: (playerLevel) => {
                const state = get();
                if (!needsRefresh(state.lastRefreshDate)) return;

                const quests = selectDailyQuests(ALL_DAILY_QUESTS, playerLevel);
                set({
                    lastRefreshDate: getTodayKey(),
                    todayQuestDefs: quests,
                    activeQuests: quests.map((q) => ({
                        questId: q.id,
                        progress: 0,
                        completed: false,
                        claimed: false,
                    })),
                });
            },

            addProgress: (goalType, amount) => {
                const { activeQuests, todayQuestDefs } = get();
                const updated = activeQuests.map((aq) => {
                    if (aq.completed || aq.claimed) return aq;
                    const def = todayQuestDefs.find((d) => d.id === aq.questId);
                    if (!def || def.goal.type !== goalType) return aq;
                    const newProgress = Math.min(aq.progress + amount, def.goal.count);
                    return {
                        ...aq,
                        progress: newProgress,
                        completed: newProgress >= def.goal.count,
                    };
                });
                set({ activeQuests: updated });
            },

            claimReward: (questId, playerLevel) => {
                const { activeQuests, todayQuestDefs } = get();
                const quest = activeQuests.find((q) => q.questId === questId);
                if (!quest || !quest.completed || quest.claimed) return null;

                const def = todayQuestDefs.find((d) => d.id === questId);
                if (!def) return null;

                const rewards = scaleRewards(def.rewards, playerLevel);

                set({
                    activeQuests: activeQuests.map((q) =>
                        q.questId === questId ? { ...q, claimed: true } : q,
                    ),
                });

                return rewards;
            },

            resetDailyQuests: () => set(INITIAL_STATE),
        }),
);
