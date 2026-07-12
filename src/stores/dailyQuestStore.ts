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
    lastRefreshDate: string | null;
    activeQuests: IActiveDailyQuest[];
    todayQuestDefs: IDailyQuestDef[];
}

interface IDailyQuestStore extends IDailyQuestState {
    refreshIfNeeded: (playerLevel: number) => void;
    addProgress: (goalType: DailyQuestGoalType, amount: number) => void;
    claimReward: (questId: string, playerLevel: number) => { gold: number; xp: number; elixir?: string } | null;
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

                void Promise.all([
                    import('./characterStore'),
                    import('../api/v1/characterApi'),
                ]).then(([{ useCharacterStore }, { characterApi }]) => {
                    const charId = useCharacterStore.getState().character?.id;
                    if (!charId) return;
                    void characterApi.bumpStat({
                        characterId: charId,
                        column: 'quests_daily_done',
                        value: 1,
                        mode: 'add',
                    });
                }).catch(() => { });

                return rewards;
            },

            resetDailyQuests: () => set(INITIAL_STATE),
        }),
);
