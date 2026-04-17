import { create } from 'zustand';
import questsData from '../data/quests.json';
import monstersData from '../data/monsters.json';
import { useMasteryStore, MASTERY_MAX_LEVEL } from './masteryStore';

// ── Types ─────────────────────────────────────────────────────────────────────

export type QuestGoalType = 'kill' | 'dungeon' | 'level' | 'boss' | 'kill_rarity'
  | 'complete_dungeons_any' | 'kill_bosses_any' | 'drop_rarity'
  | 'mastery_total' | 'mastery_max_count' | 'mastery_all_at_level';

export type QuestKillRarity = 'strong' | 'epic' | 'legendary' | 'boss' | 'any';

/** Item rarity tiers used by drop_rarity goals. */
export type QuestDropRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'heroic';

export interface IQuestGoal {
  type: QuestGoalType;
  monsterId?: string;
  dungeonId?: string;
  bossId?: string;
  /** For kill_rarity goals: minimum monster rarity tier; for drop_rarity goals: minimum item rarity tier */
  rarity?: QuestKillRarity | QuestDropRarity;
  /** For kill_rarity goals: minimum monster level to count */
  minMonsterLevel?: number;
  count: number;
  progress?: number;
}

export type QuestRewardType = 'gold' | 'xp' | 'elixir' | 'item' | 'stat_points' | 'stones' | 'stone' | 'gift';

export interface IQuestReward {
  type: QuestRewardType;
  amount?: number;
  /** For elixir rewards: consumable id (e.g. 'xp_elixir', 'skill_xp_elixir') */
  elixirId?: string;
  /** For item rewards: specific item_key to give, OR omit for random class item */
  itemId?: string;
  /** For item rewards: rarity of the generated item */
  rarity?: string;
  /** For item rewards: specific slot to generate (e.g. 'mainHand', 'armor') */
  slot?: string;
  /** For stone rewards (plural): stone type id (e.g. 'common_stone', 'legendary_stone') */
  stoneId?: string;
  /** For stone rewards (singular, legacy JSON format): stone type id */
  stoneType?: string;
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
  goals: IQuestGoal[]; // with progress filled in
  startedAt: string;
}

interface IQuestStore {
  activeQuests: IActiveQuest[];
  completedQuestIds: string[];
  startQuest: (quest: IQuest) => void;
  abandonQuest: (questId: string) => void;
  addProgress: (type: QuestGoalType, targetId: string, count: number, monsterLevel?: number) => void;
  /** Recalculate progress for mastery_total, mastery_max_count, mastery_all_at_level goals. */
  refreshMasteryProgress: () => void;
  claimQuest: (questId: string) => void;
  isCompleted: (questId: string) => boolean;
  isActive: (questId: string) => boolean;
}

// ── Helper ────────────────────────────────────────────────────────────────────

const isQuestGoalDone = (goal: IQuestGoal): boolean =>
  (goal.progress ?? 0) >= goal.count;

const isQuestComplete = (activeQuest: IActiveQuest): boolean =>
  activeQuest.goals.every((g) => isQuestGoalDone(g));

/**
 * Look up a quest definition by id from the static JSON data.
 */
export const getQuestById = (questId: string): IQuest | undefined =>
    (questsData as unknown as IQuest[]).find((q) => q.id === questId);

/**
 * Return all active `kill` goals (with quest name) that target a specific monster id.
 * Used to render per-monster quest progress badges in the monster list and combat view.
 * Note: `kill_rarity` goals are intentionally excluded because they match by rarity tier,
 * not by a specific monsterId — rendering them per card would require evaluating every
 * potential rarity roll of every monster card, which is not feasible here.
 */
export interface IQuestKillBadge {
    questId: string;
    questName: string;
    progress: number;
    count: number;
    done: boolean;
}

export const getActiveQuestKillProgress = (
    activeQuests: IActiveQuest[],
    monsterId: string,
): IQuestKillBadge[] =>
    activeQuests.flatMap((aq) => {
        const quest = getQuestById(aq.questId);
        const questName = quest?.name_pl ?? aq.questId;
        return aq.goals
            .filter((g) => g.type === 'kill' && g.monsterId === monsterId)
            .map((g) => {
                const progress = g.progress ?? 0;
                return {
                    questId: aq.questId,
                    questName,
                    progress,
                    count: g.count,
                    done: progress >= g.count,
                };
            });
    });

// ── Store ─────────────────────────────────────────────────────────────────────

export const useQuestStore = create<IQuestStore>()(
    (set, get) => ({
      activeQuests: [],
      completedQuestIds: [],

      startQuest: (quest) => {
        const { activeQuests, completedQuestIds } = get();
        if (completedQuestIds.includes(quest.id)) return;
        if (activeQuests.some((aq) => aq.questId === quest.id)) return;

        const totalMonsters = (monstersData as unknown as { id: string }[]).length;
        const activeQuest: IActiveQuest = {
          questId: quest.id,
          goals: quest.goals.map((g) => {
            if (g.type === 'mastery_all_at_level') {
              // count = required mastery level in JSON; store it in minMonsterLevel
              // and set count = total monsters (the actual target)
              return { ...g, progress: 0, minMonsterLevel: g.count, count: totalMonsters };
            }
            return { ...g, progress: 0 };
          }),
          startedAt: new Date().toISOString(),
        };

        set({ activeQuests: [...activeQuests, activeQuest] });
        // Immediately compute mastery progress for any mastery-type goals
        setTimeout(() => get().refreshMasteryProgress(), 0);
      },

      abandonQuest: (questId) => {
        const { activeQuests } = get();
        set({
          activeQuests: activeQuests.filter((aq) => aq.questId !== questId),
        });
      },

      addProgress: (type, targetId, count, monsterLevel) => {
        // Rarity tier ranking for kill_rarity goals (higher = rarer)
        const RARITY_RANK: Record<string, number> = {
          normal: 0,
          strong: 1,
          epic: 2,
          legendary: 3,
          boss: 4,
        };
        // Mastery goals are computed, not incremented via addProgress
        const MASTERY_TYPES: QuestGoalType[] = ['mastery_total', 'mastery_max_count', 'mastery_all_at_level'];
        if (MASTERY_TYPES.includes(type)) return;

        const { activeQuests } = get();
        const updated = activeQuests.map((aq) => {
          const updatedGoals = aq.goals.map((g) => {
            if (g.type !== type) return g;
            let matchId = false;
            if (type === 'kill' && g.monsterId === targetId) matchId = true;
            else if (type === 'dungeon' && g.dungeonId === targetId) matchId = true;
            else if (type === 'boss' && g.bossId === targetId) matchId = true;
            else if (type === 'kill_rarity') {
              const requiredRank = RARITY_RANK[g.rarity ?? 'any'] ?? 0;
              const killedRank = RARITY_RANK[targetId] ?? 0;
              const rarityOk = g.rarity === 'any' || killedRank >= requiredRank;
              const levelOk = (monsterLevel ?? 0) >= (g.minMonsterLevel ?? 0);
              matchId = rarityOk && levelOk;
            } else if (type === 'complete_dungeons_any') {
              // Any dungeon counts – targetId is ignored
              matchId = true;
            } else if (type === 'kill_bosses_any') {
              // Any boss kill counts – targetId is ignored
              matchId = true;
            } else if (type === 'drop_rarity') {
              // targetId = rarity string of the dropped item
              // Goal rarity field specifies minimum required rarity tier
              const ITEM_RARITY_RANK: Record<string, number> = {
                common: 0,
                rare: 1,
                epic: 2,
                legendary: 3,
                mythic: 4,
                heroic: 5,
              };
              const requiredRank = ITEM_RARITY_RANK[g.rarity ?? 'common'] ?? 0;
              const droppedRank = ITEM_RARITY_RANK[targetId] ?? 0;
              matchId = droppedRank >= requiredRank;
            }
            if (!matchId) return g;
            return {
              ...g,
              progress: Math.min(g.count, (g.progress ?? 0) + count),
            };
          });
          return { ...aq, goals: updatedGoals };
        });
        set({ activeQuests: updated });
      },

      refreshMasteryProgress: () => {
        const masteryState = useMasteryStore.getState();
        const allMonsterIds = (monstersData as unknown as { id: string }[]).map((m) => m.id);
        const totalMonsters = allMonsterIds.length;

        // Pre-compute mastery aggregates once
        let totalMasteryLevels = 0;
        let maxMasteryCount = 0;
        const masteryLevelCounts: Record<number, number> = {}; // level -> how many monsters at that level or above

        for (const mId of allMonsterIds) {
          const lvl = masteryState.getMasteryLevel(mId);
          totalMasteryLevels += lvl;
          if (lvl >= MASTERY_MAX_LEVEL) maxMasteryCount++;
          // Count monsters at each level threshold
          for (let threshold = 1; threshold <= MASTERY_MAX_LEVEL; threshold++) {
            if (lvl >= threshold) {
              masteryLevelCounts[threshold] = (masteryLevelCounts[threshold] ?? 0) + 1;
            }
          }
        }

        const { activeQuests } = get();
        const updated = activeQuests.map((aq) => {
          const updatedGoals = aq.goals.map((g) => {
            if (g.type === 'mastery_total') {
              return { ...g, progress: Math.min(g.count, totalMasteryLevels) };
            }
            if (g.type === 'mastery_max_count') {
              return { ...g, progress: Math.min(g.count, maxMasteryCount) };
            }
            if (g.type === 'mastery_all_at_level') {
              // minMonsterLevel stores the required mastery level (set in startQuest)
              // count = totalMonsters; progress = how many monsters have reached that level
              const requiredLevel = g.minMonsterLevel ?? 1;
              const monstersAtLevel = masteryLevelCounts[requiredLevel] ?? 0;
              return { ...g, progress: Math.min(g.count, monstersAtLevel) };
            }
            return g;
          });
          return { ...aq, goals: updatedGoals };
        });

        set({ activeQuests: updated });
      },

      claimQuest: (questId) => {
        const { activeQuests, completedQuestIds } = get();
        const quest = activeQuests.find((aq) => aq.questId === questId);
        if (!quest) return;
        if (!isQuestComplete(quest)) return;

        set({
          activeQuests: activeQuests.filter((aq) => aq.questId !== questId),
          completedQuestIds: [...completedQuestIds, questId],
        });
      },

      isCompleted: (questId) => {
        return get().completedQuestIds.includes(questId);
      },

      isActive: (questId) => {
        return get().activeQuests.some((aq) => aq.questId === questId);
      },
    }),
);
