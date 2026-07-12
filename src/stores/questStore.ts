import { create } from 'zustand';
import questsData from '../data/quests.json';
import monstersData from '../data/monsters.json';
import { useMasteryStore, MASTERY_MAX_LEVEL } from './masteryStore';
import { useCharacterStore } from './characterStore';


export type QuestGoalType = 'kill' | 'dungeon' | 'level' | 'boss' | 'kill_rarity'
  | 'complete_dungeons_any' | 'kill_bosses_any' | 'drop_rarity'
  | 'mastery_total' | 'mastery_max_count' | 'mastery_all_at_level';

export type QuestKillRarity = 'strong' | 'epic' | 'legendary' | 'boss' | 'any';

export type QuestDropRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'heroic';

export interface IQuestGoal {
  type: QuestGoalType;
  monsterId?: string;
  dungeonId?: string;
  bossId?: string;
  rarity?: QuestKillRarity | QuestDropRarity;
  minMonsterLevel?: number;
  count: number;
  progress?: number;
}

export type QuestRewardType = 'gold' | 'xp' | 'elixir' | 'item' | 'stat_points' | 'stones' | 'stone' | 'gift';

export interface IQuestReward {
  type: QuestRewardType;
  amount?: number;
  elixirId?: string;
  itemId?: string;
  rarity?: string;
  slot?: string;
  stoneId?: string;
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
  goals: IQuestGoal[];
  startedAt: string;
}

interface IQuestStore {
  activeQuests: IActiveQuest[];
  completedQuestIds: string[];
  startQuest: (quest: IQuest) => void;
  abandonQuest: (questId: string) => void;
  addProgress: (type: QuestGoalType, targetId: string, count: number, monsterLevel?: number) => void;
  refreshMasteryProgress: () => void;
  claimQuest: (questId: string) => void;
  isCompleted: (questId: string) => boolean;
  isActive: (questId: string) => boolean;
}


const isQuestGoalDone = (goal: IQuestGoal): boolean =>
  (goal.progress ?? 0) >= goal.count;

const isQuestComplete = (activeQuest: IActiveQuest): boolean =>
  activeQuest.goals.every((g) => isQuestGoalDone(g));

export const getQuestById = (questId: string): IQuest | undefined =>
    (questsData as unknown as IQuest[]).find((q) => q.id === questId);

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
              return { ...g, progress: 0, minMonsterLevel: g.count, count: totalMonsters };
            }
            return { ...g, progress: 0 };
          }),
          startedAt: new Date().toISOString(),
        };

        set({ activeQuests: [...activeQuests, activeQuest] });
        setTimeout(() => get().refreshMasteryProgress(), 0);
      },

      abandonQuest: (questId) => {
        const { activeQuests } = get();
        set({
          activeQuests: activeQuests.filter((aq) => aq.questId !== questId),
        });
      },

      addProgress: (type, targetId, count, monsterLevel) => {
        const RARITY_RANK: Record<string, number> = {
          normal: 0,
          strong: 1,
          epic: 2,
          legendary: 3,
          boss: 4,
        };
        const MASTERY_TYPES: QuestGoalType[] = ['mastery_total', 'mastery_max_count', 'mastery_all_at_level'];
        if (MASTERY_TYPES.includes(type)) return;

        const charLevel = useCharacterStore.getState().character?.level ?? 0;

        const { activeQuests } = get();
        const updated = activeQuests.map((aq) => {
          const def = getQuestById(aq.questId);
          if (def && def.minLevel > charLevel) return aq;
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
              matchId = true;
            } else if (type === 'kill_bosses_any') {
              matchId = true;
            } else if (type === 'drop_rarity') {
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

        let totalMasteryLevels = 0;
        let maxMasteryCount = 0;
        const masteryLevelCounts: Record<number, number> = {};

        for (const mId of allMonsterIds) {
          const lvl = masteryState.getMasteryLevel(mId);
          totalMasteryLevels += lvl;
          if (lvl >= MASTERY_MAX_LEVEL) maxMasteryCount++;
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

        const charId = useCharacterStore.getState().character?.id;
        if (charId) {
          void import('../api/v1/characterApi').then(({ characterApi }) => {
            void characterApi.bumpStat({
              characterId: charId,
              column: 'quests_oneshot_done',
              value: 1,
              mode: 'add',
            });
          }).catch(() => { });
        }
      },

      isCompleted: (questId) => {
        return get().completedQuestIds.includes(questId);
      },

      isActive: (questId) => {
        return get().activeQuests.some((aq) => aq.questId === questId);
      },
    }),
);
