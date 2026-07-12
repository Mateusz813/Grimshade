import { create } from 'zustand';


export interface IMasteryData {
  level: number;
}

export interface IMasteryBonuses {
  strong: number;
  epic: number;
  legendary: number;
  mythic: number;
  heroic: number;
}

export interface IMasteryProgress {
  kills: number;
  required: number;
  level: number;
}

export const MASTERY_KILL_THRESHOLD = 5000;

export const MASTERY_MAX_LEVEL = 25;

const BONUS_PER_LEVEL: IMasteryBonuses = {
  strong: 1.0,
  epic: 0.5,
  legendary: 0.25,
  mythic: 0.1,
  heroic: 0,
};

export const HEROIC_DROP_RATE_AT_MAX = 0.005;

export const MASTERY_XP_BONUS_PER_LEVEL = 0.02;
export const MASTERY_GOLD_BONUS_PER_LEVEL = 0.02;

export const getMasteryXpMultiplier = (masteryLevel: number): number => {
  const lvl = Math.max(0, Math.min(MASTERY_MAX_LEVEL, masteryLevel));
  return 1 + lvl * MASTERY_XP_BONUS_PER_LEVEL;
};

export const getMasteryGoldMultiplier = (masteryLevel: number): number => {
  const lvl = Math.max(0, Math.min(MASTERY_MAX_LEVEL, masteryLevel));
  return 1 + lvl * MASTERY_GOLD_BONUS_PER_LEVEL;
};

const killsRequiredForLevel = (currentLevel: number): number => {
  return MASTERY_KILL_THRESHOLD * (currentLevel + 1);
};


interface IMasteryStore {
  masteries: Record<string, IMasteryData>;
  masteryKills: Record<string, number>;
  addMasteryLevel: (monsterId: string) => void;
  addMasteryKills: (monsterId: string, killCount: number) => void;
  getMasteryKills: (monsterId: string) => number;
  getMasteryProgress: (monsterId: string) => IMasteryProgress;
  getMasteryLevel: (monsterId: string) => number;
  getMasteryData: (monsterId: string) => IMasteryData;
  getMasteryBonuses: (monsterId: string) => IMasteryBonuses;
  isMaxMastery: (monsterId: string) => boolean;
}


export const useMasteryStore = create<IMasteryStore>()(
    (set, get) => ({
      masteries: {},
      masteryKills: {},

      addMasteryLevel: (monsterId: string) => {
        const { masteries } = get();
        const current = masteries[monsterId] ?? { level: 0 };

        if (current.level >= MASTERY_MAX_LEVEL) return;

        set({
          masteries: {
            ...masteries,
            [monsterId]: { level: current.level + 1 },
          },
        });
        setTimeout(() => {
          void import('./questStore').then(({ useQuestStore }) => {
            useQuestStore.getState().refreshMasteryProgress();
          });
        }, 0);
        void pushMasteryTotal(get());
      },

      addMasteryKills: (monsterId: string, killCount: number) => {
        const { masteries, masteryKills } = get();
        const currentLevel = masteries[monsterId]?.level ?? 0;

        if (currentLevel >= MASTERY_MAX_LEVEL) return;

        const currentKills = masteryKills[monsterId] ?? 0;
        const newKills = currentKills + killCount;
        const required = killsRequiredForLevel(currentLevel);

        if (newKills >= required) {
          const newLevel = currentLevel + 1;
          const overflow = newKills - required;
          set({
            masteries: {
              ...masteries,
              [monsterId]: { level: newLevel },
            },
            masteryKills: {
              ...masteryKills,
              [monsterId]: newLevel >= MASTERY_MAX_LEVEL ? 0 : overflow,
            },
          });
          setTimeout(() => {
            void import('./questStore').then(({ useQuestStore }) => {
              useQuestStore.getState().refreshMasteryProgress();
            });
          }, 0);
          void pushMasteryTotal(get());
        } else {
          set({
            masteryKills: {
              ...masteryKills,
              [monsterId]: newKills,
            },
          });
        }
      },

      getMasteryKills: (monsterId: string): number => {
        return get().masteryKills[monsterId] ?? 0;
      },

      getMasteryProgress: (monsterId: string): IMasteryProgress => {
        const level = get().masteries[monsterId]?.level ?? 0;
        const kills = get().masteryKills[monsterId] ?? 0;
        const required = level >= MASTERY_MAX_LEVEL ? 0 : killsRequiredForLevel(level);
        return { kills, required, level };
      },

      getMasteryLevel: (monsterId: string): number => {
        return get().masteries[monsterId]?.level ?? 0;
      },

      getMasteryData: (monsterId: string): IMasteryData => {
        return get().masteries[monsterId] ?? { level: 0 };
      },

      getMasteryBonuses: (monsterId: string): IMasteryBonuses => {
        const level = get().getMasteryLevel(monsterId);
        if (level <= 0) {
          return { strong: 0, epic: 0, legendary: 0, mythic: 0, heroic: 0 };
        }

        return {
          strong: level * BONUS_PER_LEVEL.strong,
          epic: level * BONUS_PER_LEVEL.epic,
          legendary: level * BONUS_PER_LEVEL.legendary,
          mythic: level * BONUS_PER_LEVEL.mythic,
          heroic: level >= MASTERY_MAX_LEVEL ? HEROIC_DROP_RATE_AT_MAX : 0,
        };
      },

      isMaxMastery: (monsterId: string): boolean => {
        return (get().masteries[monsterId]?.level ?? 0) >= MASTERY_MAX_LEVEL;
      },
    }),
);

async function pushMasteryTotal(snapshot: { masteries: Record<string, IMasteryData> }): Promise<void> {
    try {
        const total = Object.values(snapshot.masteries).reduce(
            (sum, m) => sum + (m?.level ?? 0),
            0,
        );
        const [{ useCharacterStore }, { characterApi }] = await Promise.all([
            import('./characterStore'),
            import('../api/v1/characterApi'),
        ]);
        const charId = useCharacterStore.getState().character?.id;
        if (!charId) return;
        await characterApi.bumpStat({
            characterId: charId,
            column: 'mastery_points',
            value: total,
            mode: 'set',
        });
    } catch {
    }
}
