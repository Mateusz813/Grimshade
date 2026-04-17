import { create } from 'zustand';
import type { CharacterClass, ICharacter as IApiCharacter } from '../api/v1/characterApi';
import { processXpGain, statPointsForLevelUp, BASE_HP_PER_LEVEL, BASE_MP_PER_LEVEL } from '../systems/levelSystem';
import { useInventoryStore } from './inventoryStore';
import { useSkillStore } from './skillStore';
import { useLevelUpStore } from './levelUpStore';
import { getTotalEquipmentStats, flattenItemsData } from '../systems/itemSystem';
import { getTrainingBonuses } from '../systems/skillSystem';
import itemsRaw from '../data/items.json';

const ALL_ITEMS_FOR_HEAL = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);

/**
 * Returns bonus HP/MP from equipment + training (added on top of base max_hp/max_mp).
 * Used by level-up and death-respawn to fully restore HP/MP up to effective maximum.
 */
const getEffectiveMaxBonuses = (): { hpBonus: number; mpBonus: number } => {
    try {
        const { equipment } = useInventoryStore.getState();
        const eq = getTotalEquipmentStats(equipment, ALL_ITEMS_FOR_HEAL);
        const { skillLevels } = useSkillStore.getState();
        const tb = getTrainingBonuses(skillLevels);
        return {
            hpBonus: (eq.hp ?? 0) + (tb.max_hp ?? 0),
            mpBonus: (eq.mp ?? 0) + (tb.max_mp ?? 0),
        };
    } catch {
        return { hpBonus: 0, mpBonus: 0 };
    }
};

export type { CharacterClass };

export type ICharacter = IApiCharacter;

export interface IXpGainResult {
  levelsGained: number;
  statPointsGained: number;
  newLevel: number;
}

type StatPointStat = 'max_hp' | 'max_mp' | 'attack' | 'defense';

const STAT_POINT_BONUSES: Record<StatPointStat, number> = {
  max_hp: 5,
  max_mp: 5,
  attack: 1,
  defense: 1,
};

/**
 * Milestone stat bonuses granted automatically every 10 levels, on top of the
 * normal per-level HP/MP gain and manual stat-point allocation. Each class
 * gets its own HP/MP emphasis but everyone earns +1 ATK and +1 DEF per
 * milestone. These bonuses are gated on `highest_level` so dying and
 * re-leveling NEVER grants them twice.
 */
interface IMilestoneBonus {
    hp: number;
    mp: number;
    attack: number;
    defense: number;
}

const MILESTONE_BONUSES: Record<CharacterClass, IMilestoneBonus> = {
    Knight:      { hp: 30, mp: 5,  attack: 1, defense: 1 },
    Mage:        { hp: 10, mp: 25, attack: 1, defense: 1 },
    Cleric:      { hp: 15, mp: 20, attack: 1, defense: 1 },
    Archer:      { hp: 15, mp: 10, attack: 1, defense: 1 },
    Rogue:       { hp: 15, mp: 8,  attack: 1, defense: 1 },
    Necromancer: { hp: 12, mp: 22, attack: 1, defense: 1 },
    Bard:        { hp: 15, mp: 15, attack: 1, defense: 1 },
};

const MILESTONE_INTERVAL = 10;

/**
 * Count milestone levels crossed in range (prevHighest, newHighest].
 * Returns the number of multiples of 10 that are strictly greater than
 * prevHighest and less-or-equal to newHighest.
 */
const countMilestonesCrossed = (prevHighest: number, newHighest: number): number => {
    if (newHighest <= prevHighest) return 0;
    return Math.floor(newHighest / MILESTONE_INTERVAL) - Math.floor(prevHighest / MILESTONE_INTERVAL);
};

interface ICharacterState {
  character: ICharacter | null;
  isLoading: boolean;
  setCharacter: (character: ICharacter | null) => void;
  setLoading: (loading: boolean) => void;
  updateCharacter: (partial: Partial<ICharacter>) => void;
  addXp: (xp: number) => IXpGainResult;
  spendStatPoint: (stat: StatPointStat) => void;
  fullHealEffective: () => void;
  clearCharacter: () => void;
}

export const useCharacterStore = create<ICharacterState>((set, get) => ({
  character: null,
  isLoading: false,
  setCharacter: (character) => set({
    character: character ? {
      ...character,
      // Ensure highest_level is always set (migration for existing characters)
      highest_level: Math.max(character.highest_level ?? 1, character.level),
    } : null,
  }),
  setLoading: (isLoading) => set({ isLoading }),
  updateCharacter: (partial) =>
    set((state) => ({
      character: state.character ? { ...state.character, ...partial } : null,
    })),
  addXp: (xp: number): IXpGainResult => {
    const char = get().character;
    if (!char) return { levelsGained: 0, statPointsGained: 0, newLevel: 0 };

    // Ensure current XP is valid (not negative, not exceeding level threshold)
    const safeCurrentXp = Math.max(0, char.xp ?? 0);
    const result = processXpGain(char.level, safeCurrentXp, xp);
    const hpPerLevel = BASE_HP_PER_LEVEL[char.class] ?? 10;
    const mpPerLevel = BASE_MP_PER_LEVEL[char.class] ?? 5;

    // Only award stat points, HP/MP for levels ABOVE highest_level ever reached
    // This prevents exploit: die → lose level → re-level → get free stat points
    const highestLevel = char.highest_level ?? char.level;
    const newHighest = Math.max(highestLevel, result.newLevel);
    const newLevelsCount = Math.max(0, result.newLevel - highestLevel);

    const hpGain = newLevelsCount * hpPerLevel;
    const mpGain = newLevelsCount * mpPerLevel;
    // Only generate stat points for genuinely new levels
    const statPointsGained = newLevelsCount > 0
      ? newLevelsCount * statPointsForLevelUp(char.class)
      : 0;

    // Milestone bonuses every 10 levels (idempotent vs death penalty: gated on highest_level)
    const milestonesCrossed = countMilestonesCrossed(highestLevel, newHighest);
    const milestoneBonus = MILESTONE_BONUSES[char.class] ?? { hp: 0, mp: 0, attack: 0, defense: 0 };
    const milestoneHp = milestonesCrossed * milestoneBonus.hp;
    const milestoneMp = milestonesCrossed * milestoneBonus.mp;
    const milestoneAtk = milestonesCrossed * milestoneBonus.attack;
    const milestoneDef = milestonesCrossed * milestoneBonus.defense;

    const newMaxHp = char.max_hp + hpGain + milestoneHp;
    const newMaxMp = char.max_mp + mpGain + milestoneMp;
    const newAttack = (char.attack ?? 0) + milestoneAtk;
    const newDefense = (char.defense ?? 0) + milestoneDef;
    const { hpBonus, mpBonus } = getEffectiveMaxBonuses();
    const effectiveMaxHp = newMaxHp + hpBonus;
    const effectiveMaxMp = newMaxMp + mpBonus;

    // On level-up: FULL HEAL to 100% HP/MP. Otherwise just clamp.
    const didLevelUp = result.levelsGained > 0;
    const newHp = didLevelUp
      ? effectiveMaxHp
      : Math.min((char.hp ?? 0) + hpGain + milestoneHp, effectiveMaxHp);
    const newMp = didLevelUp
      ? effectiveMaxMp
      : Math.min((char.mp ?? 0) + mpGain + milestoneMp, effectiveMaxMp);

    set({
      character: {
        ...char,
        level: result.newLevel,
        xp: result.remainingXp,
        stat_points: (char.stat_points ?? 0) + statPointsGained,
        highest_level: newHighest,
        max_hp: newMaxHp,
        max_mp: newMaxMp,
        attack: newAttack,
        defense: newDefense,
        hp: newHp,
        mp: newMp,
      },
    });

    // Fire global level-up notification (deferred to next microtask so React
    // picks it up as a separate render – prevents the notification from being
    // swallowed when other state changes happen in the same synchronous block,
    // e.g. dungeon setPhase('result') called right after addXp).
    if (result.levelsGained > 0) {
      const _newLevel = result.newLevel;
      const _levelsGained = result.levelsGained;
      const _statPointsGained = statPointsGained;
      queueMicrotask(() => {
        const path = window.location.pathname;
        const combatPaths = ['/combat', '/dungeon', '/boss', '/transform'];
        const inCombat = combatPaths.some((p) => path.startsWith(p));
        useLevelUpStore.getState().triggerLevelUp({
          newLevel: _newLevel,
          levelsGained: _levelsGained,
          statPointsGained: _statPointsGained,
          inCombat,
        });
      });
    }

    return {
      levelsGained: result.levelsGained,
      statPointsGained,
      newLevel: result.newLevel,
    };
  },
  spendStatPoint: (stat: StatPointStat) => {
    const char = get().character;
    if (!char || (char.stat_points ?? 0) <= 0) return;

    const bonus = STAT_POINT_BONUSES[stat];
    const updates: Partial<ICharacter> = {
      stat_points: (char.stat_points ?? 0) - 1,
      [stat]: (char[stat] ?? 0) + bonus,
    };

    // When increasing max_hp/max_mp, also increase current hp/mp
    if (stat === 'max_hp') {
      updates.hp = (char.hp ?? 0) + bonus;
    } else if (stat === 'max_mp') {
      updates.mp = (char.mp ?? 0) + bonus;
    }

    set({ character: { ...char, ...updates } });
  },
  fullHealEffective: () => {
    const char = get().character;
    if (!char) return;
    const { hpBonus, mpBonus } = getEffectiveMaxBonuses();
    set({
      character: {
        ...char,
        hp: char.max_hp + hpBonus,
        mp: char.max_mp + mpBonus,
      },
    });
  },
  clearCharacter: () => set({ character: null }),
}));
