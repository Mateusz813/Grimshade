import { create } from 'zustand';

// ── Types ─────────────────────────────────────────────────────────────────────

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

/** Kills required per mastery level (auto-increments when reached). */
export const MASTERY_KILL_THRESHOLD = 5000;

/** Maximum mastery level per monster. */
export const MASTERY_MAX_LEVEL = 25;

/** Bonuses per mastery level (percentage points). */
const BONUS_PER_LEVEL: IMasteryBonuses = {
  strong: 1.0,
  epic: 0.5,
  legendary: 0.25,
  mythic: 0.1,
  heroic: 0,
};

/** At max mastery (25), heroic drop rate unlocked on boss-rarity variants.
 *  0.005 = 0.5% base chance. Actual chance is further reduced by monster level in lootSystem. */
export const HEROIC_DROP_RATE_AT_MAX = 0.005;

/**
 * Point N7: each mastery level grants +2% XP and +2% Gold on kills of that
 * monster. Max at lvl 25 = +50%. Also applies in offline hunt / training
 * outputs that feed off live kills. Returns a multiplier (1.00–1.50).
 */
export const MASTERY_XP_BONUS_PER_LEVEL = 0.02; // 2% per level
export const MASTERY_GOLD_BONUS_PER_LEVEL = 0.02; // 2% per level

export const getMasteryXpMultiplier = (masteryLevel: number): number => {
  const lvl = Math.max(0, Math.min(MASTERY_MAX_LEVEL, masteryLevel));
  return 1 + lvl * MASTERY_XP_BONUS_PER_LEVEL;
};

export const getMasteryGoldMultiplier = (masteryLevel: number): number => {
  const lvl = Math.max(0, Math.min(MASTERY_MAX_LEVEL, masteryLevel));
  return 1 + lvl * MASTERY_GOLD_BONUS_PER_LEVEL;
};

/** Calculate kills required for the next mastery level. */
const killsRequiredForLevel = (currentLevel: number): number => {
  return MASTERY_KILL_THRESHOLD * (currentLevel + 1);
};

// ── Store interface ──────────────────────────────────────────────────────────

interface IMasteryStore {
  masteries: Record<string, IMasteryData>;
  masteryKills: Record<string, number>;
  /** @deprecated Use addMasteryKills instead. Kept for backward compat. */
  addMasteryLevel: (monsterId: string) => void;
  addMasteryKills: (monsterId: string, killCount: number) => void;
  getMasteryKills: (monsterId: string) => number;
  getMasteryProgress: (monsterId: string) => IMasteryProgress;
  getMasteryLevel: (monsterId: string) => number;
  getMasteryData: (monsterId: string) => IMasteryData;
  getMasteryBonuses: (monsterId: string) => IMasteryBonuses;
  isMaxMastery: (monsterId: string) => boolean;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useMasteryStore = create<IMasteryStore>()(
    (set, get) => ({
      masteries: {},
      masteryKills: {},

      addMasteryLevel: (monsterId: string) => {
        const { masteries } = get();
        const current = masteries[monsterId] ?? { level: 0 };

        // Already maxed – no more tracking needed
        if (current.level >= MASTERY_MAX_LEVEL) return;

        set({
          masteries: {
            ...masteries,
            [monsterId]: { level: current.level + 1 },
          },
        });
        // Refresh mastery-type quest goals (lazy import to avoid circular dependency)
        setTimeout(() => {
          const { useQuestStore } = require('./questStore') as { useQuestStore: { getState: () => { refreshMasteryProgress: () => void } } };
          useQuestStore.getState().refreshMasteryProgress();
        }, 0);
      },

      addMasteryKills: (monsterId: string, killCount: number) => {
        const { masteries, masteryKills } = get();
        const currentLevel = masteries[monsterId]?.level ?? 0;

        // Already maxed – no more tracking needed
        if (currentLevel >= MASTERY_MAX_LEVEL) return;

        const currentKills = masteryKills[monsterId] ?? 0;
        const newKills = currentKills + killCount;
        const required = killsRequiredForLevel(currentLevel);

        if (newKills >= required) {
          // Level up mastery, reset kills (carry over excess)
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
          // Refresh mastery-type quest goals (lazy import to avoid circular dependency)
          setTimeout(() => {
            const { useQuestStore } = require('./questStore') as { useQuestStore: { getState: () => { refreshMasteryProgress: () => void } } };
            useQuestStore.getState().refreshMasteryProgress();
          }, 0);
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
