/**
 * Direct-API quest/task state seeder via `game_saves` JSONB blob.
 *
 * Pre-populates `tasks.activeTasks` / `tasks.completedTasks` /
 * `quests.activeQuests` / `quests.completedQuestIds` /
 * `dailyQuests.activeQuests` / `dailyQuests.todayQuestDefs` slices for
 * a given character ZANIM test odpali browser. Same architectural
 * pattern as `seedInventory.ts` — write straight into the
 * `game_saves.state` blob through service_role, hydration applies it on
 * character switch.
 *
 * ## Krytyczne tło architektoniczne (do przeczytania PRZED edycją)
 *
 * Per `src/stores/characterScope.ts` (STORE_ENTRIES, lines 173-354):
 *
 *  • `tasks` baseKey persists `{ activeTask, activeTasks, completedTasks }`
 *    (stateKeys line 204). Shape per `useTaskStore` (`src/stores/taskStore.ts`).
 *  • `quests` baseKey persists `{ activeQuests, completedQuestIds }`
 *    (stateKeys line 211). Shape per `useQuestStore`
 *    (`src/stores/questStore.ts`).
 *  • `dailyQuests` baseKey persists `{ lastRefreshDate, activeQuests,
 *    todayQuestDefs }` (stateKeys line 277). Shape per
 *    `useDailyQuestStore` (`src/stores/dailyQuestStore.ts`). To pin
 *    seeded daily state we MUST also set `lastRefreshDate = today` so
 *    `refreshIfNeeded` (Quests.tsx line 365) doesn't blow away our
 *    seed on mount.
 *  • Each per-store slice MUST carry `_entryOwner: characterId`, AND the
 *    root state object MUST carry `_ownerCharacterId: characterId` —
 *    `applyBlobToStores` (characterScope ~line 410-420) refuses to
 *    rehydrate any slice with mismatched owner stamps, defaulting that
 *    slice back to empty.
 *  • Hydration runs ONCE per character switch (on `/character-select` →
 *    `Wybierz`). Subsequent navigations re-read in-memory store, not
 *    blob. So our test pattern is: seed → login → select character →
 *    navigate to whatever. By the time the test reaches `/quests` the
 *    blob is already applied.
 *
 * ## Shape reference
 *
 * `IActiveTask` (taskStore.ts line 21):
 *   { id, monsterId, monsterLevel, monsterName, killCount, rewardGold,
 *     rewardXp, progress, startedAt }
 *
 * `ICompletedTask` (taskStore.ts line 26):
 *   { id, taskId, monsterName, killCount, rewardGold, rewardXp,
 *     completedAt }
 *
 * `IActiveQuest` (questStore.ts line 61):
 *   { questId, goals: IQuestGoal[], startedAt }
 *
 * `IQuestGoal` (questStore.ts line 18) — what gets stored after
 * `startQuest()` hydrates `progress: 0` on each goal:
 *   { type, monsterId?, dungeonId?, bossId?, rarity?, minMonsterLevel?,
 *     count, progress }
 *
 * `IActiveDailyQuest` (dailyQuestSystem.ts line 26):
 *   { questId, progress, completed, claimed }
 *
 * `IDailyQuestDef` (dailyQuestSystem.ts line 16) — full quest blueprint
 * normally selected by `selectDailyQuests` for today; seeded for tests
 * to short-circuit the random pick.
 *
 * ## Cleanup
 *
 * `game_saves` row is in `CHARACTER_CHILD_TABLES` (cleanup.ts line 77),
 * so `cleanupCharacterById(characterId)` flushes everything including
 * the seeded quest/task state. No extra cleanup helper needed.
 */

// Shared admin client (cached) — patrz adminClient.ts.
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

// ── Task shapes (mirror src/stores/taskStore.ts) ─────────────────────────

export interface ISeedActiveTask {
    /** Stable id from `src/data/tasks.json` — e.g. 'rat_10', 'rat_50'. */
    id: string;
    monsterId: string;
    monsterLevel: number;
    monsterName: string;
    killCount: number;
    rewardGold: number;
    rewardXp: number;
    /** 0..killCount. Set to killCount for "claimable" / done state. */
    progress: number;
    /** ISO timestamp; default = now. */
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

// ── Quest shapes (mirror src/stores/questStore.ts) ───────────────────────

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

// ── Daily quest shapes (mirror src/systems/dailyQuestSystem.ts) ─────────

export type DailySeedGoalType =
    | 'kill_any'
    | 'earn_gold'
    | 'complete_dungeon'
    | 'kill_boss'
    | 'use_potion'
    | 'deal_damage';

/** Full IDailyQuestDef — copy verbatim from `src/data/dailyQuests.json`
 *  rows we want pinned for the day. */
export interface ISeedDailyQuestDef {
    id: string;
    name_pl: string;
    name_en: string;
    description_pl: string;
    minLevel: number;
    goal: { type: DailySeedGoalType; count: number };
    rewards: { gold: number; xp: number; elixir?: string };
}

/** IActiveDailyQuest — the per-character runtime mirror of a daily def. */
export interface ISeedActiveDailyQuest {
    questId: string;
    progress: number;
    completed: boolean;
    claimed: boolean;
}

export interface ISeedDailyQuests {
    /** ISO YYYY-MM-DD; default = today (so `refreshIfNeeded` no-ops). */
    lastRefreshDate?: string;
    /** Full quest defs (will populate `todayQuestDefs`). */
    todayQuestDefs: ISeedDailyQuestDef[];
    /** Runtime progress per quest id. */
    activeQuests: ISeedActiveDailyQuest[];
}

export interface ISeedQuestStateArgs {
    characterId: string;
    /** Pre-populated active tasks. */
    activeTasks?: ISeedActiveTask[];
    /** Pre-populated completed tasks (history). */
    completedTasks?: ISeedCompletedTask[];
    /** Pre-populated active quests with goal progress. */
    activeQuests?: ISeedActiveQuest[];
    /** Already-claimed quest ids (drop from "available" list, show in "Ukończone"). */
    completedQuestIds?: string[];
    /** Pre-populated daily quest state (today's pick + per-quest progress). */
    dailyQuests?: ISeedDailyQuests;
}

/**
 * Upsert quest/task slices into `game_saves.state` for a given character.
 *
 * Reads existing state (preserves inventory/skills/etc.), overlays only
 * the `tasks` + `quests` baseKeys with the provided seed values, writes
 * back. Idempotent — re-running overwrites the same slices.
 *
 * @example
 * await seedQuestState({
 *   characterId: created.id,
 *   activeTasks: [{
 *     id: 'rat_10', monsterId: 'rat', monsterLevel: 1,
 *     monsterName: 'Szczur', killCount: 10,
 *     rewardGold: 50, rewardXp: 100, progress: 10, // claimable
 *   }],
 * });
 */
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

    // Normalize seed inputs to runtime store shapes.
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

    // Build the tasks + quests slices with _entryOwner stamp.
    const tasksSlice = {
        // taskStore keeps `activeTask` (singular) as legacy backward-compat
        // mirror of activeTasks[0] (taskStore.ts line 81). Mirror that here.
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

    // Daily-quest slice — only constructed when caller passes daily seed
    // (otherwise we leave the existing blob alone so we don't reset a
    // separate slice the test doesn't care about). Match today's date key
    // so `refreshIfNeeded(playerLevel)` in Quests.tsx (line 365) no-ops
    // instead of overwriting our pinned `todayQuestDefs` + `activeQuests`.
    let dailyQuestsSlice: Record<string, unknown> | null = null;
    if (args.dailyQuests) {
        // Build the same "YYYY-MM-DD" key getTodayKey() in
        // dailyQuestSystem.ts produces (line 37). Mirror inline so we
        // don't drag a runtime import into the seeder.
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
        // Root owner stamp — without this characterScope rejects the
        // WHOLE blob (line 394 of characterScope.ts).
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
