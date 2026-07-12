
import { getAdminClient, withSupabaseRetry } from './adminClient';

const findUserIdForCharacter = async (
    admin: SupabaseClient,
    characterId: string,
): Promise<string> => {
    const { data, error } = await withSupabaseRetry(
        () => admin
            .from('characters')
            .select('user_id')
            .eq('id', characterId)
            .single(),
    );
    if (error) {
        throw new Error(`[seedQuestState] character lookup failed: ${error.message ?? JSON.stringify(error)}`);
    }
    if (!data) {
        throw new Error(`[seedQuestState] character not found: ${characterId}`);
    }
    return data.user_id as string;
};


export interface ISeedActiveTask {
    id: string;
    monsterId: string;
    monsterLevel: number;
    monsterName: string;
    killCount: number;
    rewardGold: number;
    rewardXp: number;
    progress: number;
    startedAt?: string;
}

export interface ISeedCompletedTask {
    id: string;
    taskId: string;
    monsterName: string;
    killCount: number;
    rewardGold: number;
    rewardXp: number;
    completedAt?: string;
}


export interface ISeedQuestGoal {
    type: string;
    monsterId?: string;
    dungeonId?: string;
    bossId?: string;
    rarity?: string;
    minMonsterLevel?: number;
    count: number;
    progress: number;
}

export interface ISeedActiveQuest {
    questId: string;
    goals: ISeedQuestGoal[];
    startedAt?: string;
}


export type DailySeedGoalType =
    | 'kill_any'
    | 'earn_gold'
    | 'complete_dungeon'
    | 'kill_boss'
    | 'use_potion'
    | 'deal_damage';

export interface ISeedDailyQuestDef {
    id: string;
    name_pl: string;
    name_en: string;
    description_pl: string;
    minLevel: number;
    goal: { type: DailySeedGoalType; count: number };
    rewards: { gold: number; xp: number; elixir?: string };
}

export interface ISeedActiveDailyQuest {
    questId: string;
    progress: number;
    completed: boolean;
    claimed: boolean;
}

export interface ISeedDailyQuests {
    lastRefreshDate?: string;
    todayQuestDefs: ISeedDailyQuestDef[];
    activeQuests: ISeedActiveDailyQuest[];
}

export interface ISeedQuestStateArgs {
    characterId: string;
    activeTasks?: ISeedActiveTask[];
    completedTasks?: ISeedCompletedTask[];
    activeQuests?: ISeedActiveQuest[];
    completedQuestIds?: string[];
    dailyQuests?: ISeedDailyQuests;
}

export const seedQuestState = async (
    args: ISeedQuestStateArgs,
): Promise<void> => {
    const admin = getAdminClient();
    const userId = await findUserIdForCharacter(admin, args.characterId);
    const now = new Date().toISOString();

    const { data: existing, error: selectErr } = await withSupabaseRetry(
        () => admin
            .from('game_saves')
            .select('state')
            .eq('character_id', args.characterId)
            .maybeSingle(),
    );

    if (selectErr) {
        throw new Error(`[seedQuestState] select game_saves failed: ${selectErr.message ?? JSON.stringify(selectErr)}`);
    }

    const baseState: Record<string, unknown> = (existing?.state as Record<string, unknown>) ?? {};

    const activeTasks = (args.activeTasks ?? []).map((t) => ({
        id: t.id,
        monsterId: t.monsterId,
        monsterLevel: t.monsterLevel,
        monsterName: t.monsterName,
        killCount: t.killCount,
        rewardGold: t.rewardGold,
        rewardXp: t.rewardXp,
        progress: t.progress,
        startedAt: t.startedAt ?? now,
    }));

    const completedTasks = (args.completedTasks ?? []).map((c) => ({
        id: c.id,
        taskId: c.taskId,
        monsterName: c.monsterName,
        killCount: c.killCount,
        rewardGold: c.rewardGold,
        rewardXp: c.rewardXp,
        completedAt: c.completedAt ?? now,
    }));

    const activeQuests = (args.activeQuests ?? []).map((q) => ({
        questId: q.questId,
        goals: q.goals.map((g) => ({ ...g })),
        startedAt: q.startedAt ?? now,
    }));

    const tasksSlice = {
        activeTask: activeTasks[0] ?? null,
        activeTasks,
        completedTasks,
        _entryOwner: args.characterId,
    };

    const questsSlice = {
        activeQuests,
        completedQuestIds: args.completedQuestIds ?? [],
        _entryOwner: args.characterId,
    };

    let dailyQuestsSlice: Record<string, unknown> | null = null;
    if (args.dailyQuests) {
        const today = (() => {
            const n = new Date();
            return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
        })();
        dailyQuestsSlice = {
            lastRefreshDate: args.dailyQuests.lastRefreshDate ?? today,
            todayQuestDefs: args.dailyQuests.todayQuestDefs.map((d) => ({ ...d, goal: { ...d.goal }, rewards: { ...d.rewards } })),
            activeQuests: args.dailyQuests.activeQuests.map((a) => ({ ...a })),
            _entryOwner: args.characterId,
        };
    }

    const nextState: Record<string, unknown> = {
        ...baseState,
        tasks: tasksSlice,
        quests: questsSlice,
        _ownerCharacterId: args.characterId,
    };
    if (dailyQuestsSlice) {
        nextState.dailyQuests = dailyQuestsSlice;
    }

    const payload = {
        character_id: args.characterId,
        user_id: userId,
        state: nextState,
        updated_at: now,
    };

    const { error: upsertErr } = await withSupabaseRetry(
        () => admin
            .from('game_saves')
            .upsert(payload, { onConflict: 'character_id' }),
    );

    if (upsertErr) {
        throw new Error(`[seedQuestState] upsert failed: ${upsertErr.message ?? JSON.stringify(upsertErr)}`);
    }
};
