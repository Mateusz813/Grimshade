export type TQuestGoalType = 'kill' | 'dungeon' | 'level' | 'boss';

export type TQuestRewardType = 'gold' | 'elixir' | 'item' | 'stat_points';

export interface IQuestGoal {
    type: TQuestGoalType;
    monsterId?: string;
    dungeonId?: string;
    bossId?: string;
    count: number;
    progress?: number;
}

export interface IQuestReward {
    type: TQuestRewardType;
    amount?: number;
    elixirId?: string;
    itemId?: string;
}

export interface IQuest {
    id: string;
    name_pl: string;
    name_en: string;
    minLevel: number;
    goals: IQuestGoal[];
    rewards: IQuestReward[];
    description_pl: string;
    description_en: string;
}

export interface IActiveQuest {
    questId: string;
    goals: IQuestGoal[];
    startedAt: string;
}
