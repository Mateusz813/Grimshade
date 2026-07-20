
export type DailyQuestGoalType = 'kill_any' | 'earn_gold' | 'complete_dungeon' | 'kill_boss' | 'use_potion' | 'deal_damage';

export interface IDailyQuestGoal {
    type: DailyQuestGoalType;
    count: number;
}

export interface IDailyQuestRewards {
    gold: number;
    xp: number;
    elixir?: string;
}

export interface IDailyQuestDef {
    id: string;
    name_pl: string;
    name_en: string;
    description_pl: string;
    minLevel: number;
    goal: IDailyQuestGoal;
    rewards: IDailyQuestRewards;
}

export interface IActiveDailyQuest {
    questId: string;
    progress: number;
    completed: boolean;
    claimed: boolean;
}

export const DAILY_QUEST_COUNT = 12;

export const getTodayKey = (): string => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export const needsRefresh = (lastRefreshDate: string | null): boolean => {
    if (!lastRefreshDate) return true;
    return lastRefreshDate !== getTodayKey();
};

export const selectDailyQuests = (
    allQuests: IDailyQuestDef[],
    playerLevel: number,
): IDailyQuestDef[] => {
    const eligible = allQuests.filter((q) => playerLevel >= q.minLevel);
    if (eligible.length <= DAILY_QUEST_COUNT) return eligible;

    const today = getTodayKey();
    let seed = 0;
    for (let i = 0; i < today.length; i++) {
        seed = ((seed << 5) - seed + today.charCodeAt(i)) | 0;
    }

    const shuffled = [...eligible];
    const pseudoRandom = (max: number): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % max;
    };

    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = pseudoRandom(i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled.slice(0, DAILY_QUEST_COUNT);
};

export const reconcileDailyQuests = (
    allQuests: IDailyQuestDef[],
    playerLevel: number,
    activeQuests: IActiveDailyQuest[],
): { todayQuestDefs: IDailyQuestDef[]; activeQuests: IActiveDailyQuest[] } => {
    const todayQuestDefs = selectDailyQuests(allQuests, playerLevel);
    return {
        todayQuestDefs,
        activeQuests: todayQuestDefs.map((def) =>
            activeQuests.find((aq) => aq.questId === def.id) ?? {
                questId: def.id,
                progress: 0,
                completed: false,
                claimed: false,
            },
        ),
    };
};

export const isDailySliceDegraded = (
    allQuests: IDailyQuestDef[],
    playerLevel: number,
    todayQuestDefs: IDailyQuestDef[],
    activeQuests: IActiveDailyQuest[],
): boolean => {
    const expected = selectDailyQuests(allQuests, playerLevel);
    if (todayQuestDefs.length !== expected.length) return true;
    const presentIds = new Set(todayQuestDefs.map((d) => d.id));
    if (expected.some((d) => !presentIds.has(d.id))) return true;
    return todayQuestDefs.some((d) => !activeQuests.some((aq) => aq.questId === d.id));
};

export const mergeDailyForDisplay = (
    todayQuestDefs: IDailyQuestDef[],
    activeQuests: IActiveDailyQuest[],
): Array<{ def: IDailyQuestDef; active: IActiveDailyQuest }> =>
    todayQuestDefs.map((def) => ({
        def,
        active: activeQuests.find((a) => a.questId === def.id) ?? {
            questId: def.id,
            progress: 0,
            completed: false,
            claimed: false,
        },
    }));

export const scaleRewards = (
    base: IDailyQuestRewards,
    playerLevel: number,
): IDailyQuestRewards => {
    const goldMultiplier = 1 + playerLevel * 0.25;
    const xpMultiplier = 1 + playerLevel * 0.3;
    return {
        gold: Math.floor(base.gold * goldMultiplier * 0.6),
        xp: Math.floor(base.xp * xpMultiplier),
        elixir: base.elixir,
    };
};
