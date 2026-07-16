import { create } from 'zustand';
import type { CharacterClass, ICharacter as IApiCharacter } from '../api/v1/characterApi';
import { processXpGain, statPointsForLevelUp, BASE_HP_PER_LEVEL, BASE_MP_PER_LEVEL } from '../systems/levelSystem';
import classesData from '../data/classes.json';
import { useInventoryStore, registerCharacterLevelGetter } from './inventoryStore';
import { useSkillStore } from './skillStore';
import { useLevelUpStore } from './levelUpStore';
import { useBuffStore } from './buffStore';
import { getTotalEquipmentStats, flattenItemsData } from '../systems/itemSystem';
import { getTrainingBonuses } from '../systems/skillSystem';
import {
    getElixirHpBonus,
    getElixirMpBonus,
    getElixirHpPctMultiplier,
    getElixirMpPctMultiplier,
} from '../systems/combatElixirs';
import {
    getTransformFlatHp,
    getTransformFlatMp,
    getTransformHpPctMultiplier,
    getTransformMpPctMultiplier,
} from '../systems/transformBonuses';
import itemsRaw from '../data/items.json';

const ALL_ITEMS_FOR_HEAL = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);

const getEffectiveMaxValues = (baseMaxHp: number, baseMaxMp: number): { maxHp: number; maxMp: number } => {
    try {
        const { equipment } = useInventoryStore.getState();
        const eq = getTotalEquipmentStats(equipment, ALL_ITEMS_FOR_HEAL);
        const { skillLevels } = useSkillStore.getState();
        const tb = getTrainingBonuses(skillLevels);
        const rawMaxHp = baseMaxHp + (eq.hp ?? 0) + (tb.max_hp ?? 0) + getElixirHpBonus() + getTransformFlatHp();
        const rawMaxMp = baseMaxMp + (eq.mp ?? 0) + (tb.max_mp ?? 0) + getElixirMpBonus() + getTransformFlatMp();
        return {
            maxHp: Math.floor(rawMaxHp * getElixirHpPctMultiplier() * getTransformHpPctMultiplier()),
            maxMp: Math.floor(rawMaxMp * getElixirMpPctMultiplier() * getTransformMpPctMultiplier()),
        };
    } catch {
        return { maxHp: baseMaxHp, maxMp: baseMaxMp };
    }
};

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
  xpApplied: number;
}

type StatPointStat = 'max_hp' | 'max_mp' | 'attack' | 'defense';

const STAT_POINT_BONUSES: Record<StatPointStat, number> = {
  max_hp: 5,
  max_mp: 5,
  attack: 1,
  defense: 1,
};

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

const countMilestonesCrossed = (prevHighest: number, newHighest: number): number => {
    if (newHighest <= prevHighest) return 0;
    return Math.floor(newHighest / MILESTONE_INTERVAL) - Math.floor(prevHighest / MILESTONE_INTERVAL);
};

export const computeBaseStatFloor = (
    characterClass: CharacterClass,
    highestLevel: number,
): { max_hp: number; max_mp: number } => {
    const level = Math.max(1, Math.floor(highestLevel ?? 1));
    const classEntry = (classesData as Array<{ id: string; baseStats: { hp: number; mp: number } }>)
        .find((c) => c.id === characterClass);
    const baseStats = classEntry?.baseStats ?? { hp: 0, mp: 0 };
    const perLevelHp = BASE_HP_PER_LEVEL[characterClass] ?? 0;
    const perLevelMp = BASE_MP_PER_LEVEL[characterClass] ?? 0;
    const milestones = Math.floor(level / MILESTONE_INTERVAL);
    const milestoneBonus = MILESTONE_BONUSES[characterClass] ?? { hp: 0, mp: 0, attack: 0, defense: 0 };
    const milestoneHp = milestones * milestoneBonus.hp;
    const milestoneMp = milestones * milestoneBonus.mp;
    return {
        max_hp: baseStats.hp + perLevelHp * (level - 1) + milestoneHp,
        max_mp: baseStats.mp + perLevelMp * (level - 1) + milestoneMp,
    };
};

const GOLD_MILESTONE_REWARD_PER_LEVEL = 10000;
const isGoldMilestoneLevel = (level: number): boolean => {
    if (level <= 0) return false;
    if (level === 10 || level === 20 || level === 30 || level === 40 || level === 50) return true;
    if (level >= 100 && level % 50 === 0) return true;
    return false;
};
const collectGoldMilestones = (prevHighest: number, newHighest: number): number[] => {
    if (newHighest <= prevHighest) return [];
    const out: number[] = [];
    for (let lv = prevHighest + 1; lv <= newHighest; lv++) {
        if (isGoldMilestoneLevel(lv)) out.push(lv);
    }
    return out;
};

interface ICharacterState {
  character: ICharacter | null;
  isLoading: boolean;
  setCharacter: (character: ICharacter | null) => void;
  setLoading: (loading: boolean) => void;
  updateCharacter: (partial: Partial<ICharacter>) => void;
  addXp: (xp: number) => IXpGainResult;
  spendStatPoint: (stat: StatPointStat) => void;
  spendAllStatPoints: (stat: StatPointStat) => void;
  fullHealEffective: () => void;
  healCorruptedBaseStats: () => boolean;
  clearCharacter: () => void;
}

export const useCharacterStore = create<ICharacterState>((set, get) => ({
  character: null,
  isLoading: false,
  setCharacter: (character) => set({
    character: character ? {
      ...character,
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
    if (!char) return { levelsGained: 0, statPointsGained: 0, newLevel: 0, xpApplied: 0 };

    const boostMult = useBuffStore.getState().getXpBoostMultiplier();
    const xpApplied = Math.floor(Math.max(0, xp) * boostMult);
    const safeCurrentXp = Math.max(0, char.xp ?? 0);
    const result = processXpGain(char.level, safeCurrentXp, xpApplied);
    const hpPerLevel = BASE_HP_PER_LEVEL[char.class] ?? 10;
    const mpPerLevel = BASE_MP_PER_LEVEL[char.class] ?? 5;

    const highestLevel = char.highest_level ?? char.level;
    const newHighest = Math.max(highestLevel, result.newLevel);
    const newLevelsCount = Math.max(0, result.newLevel - highestLevel);

    const hpGain = newLevelsCount * hpPerLevel;
    const mpGain = newLevelsCount * mpPerLevel;
    const statPointsGained = newLevelsCount > 0
      ? newLevelsCount * statPointsForLevelUp(char.class)
      : 0;

    const milestonesCrossed = countMilestonesCrossed(highestLevel, newHighest);
    const milestoneBonus = MILESTONE_BONUSES[char.class] ?? { hp: 0, mp: 0, attack: 0, defense: 0 };
    const milestoneHp = milestonesCrossed * milestoneBonus.hp;
    const milestoneMp = milestonesCrossed * milestoneBonus.mp;
    const milestoneAtk = milestonesCrossed * milestoneBonus.attack;
    const milestoneDef = milestonesCrossed * milestoneBonus.defense;

    const goldMilestoneLevels = collectGoldMilestones(highestLevel, newHighest);
    const milestoneGoldGain = goldMilestoneLevels.reduce(
        (sum, lv) => sum + lv * GOLD_MILESTONE_REWARD_PER_LEVEL,
        0,
    );

    const newMaxHp = char.max_hp + hpGain + milestoneHp;
    const newMaxMp = char.max_mp + mpGain + milestoneMp;
    const newAttack = (char.attack ?? 0) + milestoneAtk;
    const newDefense = (char.defense ?? 0) + milestoneDef;
    const { hpBonus, mpBonus } = getEffectiveMaxBonuses();
    const effectiveMaxHp = newMaxHp + hpBonus;
    const effectiveMaxMp = newMaxMp + mpBonus;

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
        gold: char.gold ?? 0,
      },
    });

    if (milestoneGoldGain > 0) {
      useInventoryStore.getState().addGold(milestoneGoldGain);
    }

    if (result.levelsGained > 0) {
      const _newLevel = result.newLevel;
      const _levelsGained = result.levelsGained;
      const _statPointsGained = statPointsGained;
      const _goldGained = milestoneGoldGain;
      const _goldMilestoneLevels = goldMilestoneLevels;
      queueMicrotask(() => {
        const path = window.location.pathname;
        const combatPaths = ['/combat', '/dungeon', '/boss', '/transform'];
        const inCombat = combatPaths.some((p) => path.startsWith(p));
        useLevelUpStore.getState().triggerLevelUp({
          newLevel: _newLevel,
          levelsGained: _levelsGained,
          statPointsGained: _statPointsGained,
          inCombat,
          goldGained: _goldGained,
          goldMilestoneLevels: _goldMilestoneLevels,
        });
      });
    }

    return {
      levelsGained: result.levelsGained,
      statPointsGained,
      newLevel: result.newLevel,
      xpApplied,
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

    if (stat === 'max_hp') {
      updates.hp = (char.hp ?? 0) + bonus;
    } else if (stat === 'max_mp') {
      updates.mp = (char.mp ?? 0) + bonus;
    }

    set({ character: { ...char, ...updates } });
  },
  spendAllStatPoints: (stat: StatPointStat) => {
    const char = get().character;
    if (!char) return;
    const points = char.stat_points ?? 0;
    if (points <= 0) return;

    const bonus = STAT_POINT_BONUSES[stat];
    const total = bonus * points;
    const updates: Partial<ICharacter> = {
      stat_points: 0,
      [stat]: (char[stat] ?? 0) + total,
    };
    if (stat === 'max_hp') updates.hp = (char.hp ?? 0) + total;
    if (stat === 'max_mp') updates.mp = (char.mp ?? 0) + total;

    set({ character: { ...char, ...updates } });
  },
  fullHealEffective: () => {
    const char = get().character;
    if (!char) return;
    const { maxHp, maxMp } = getEffectiveMaxValues(char.max_hp, char.max_mp);
    set({
      character: {
        ...char,
        hp: maxHp,
        mp: maxMp,
      },
    });
  },
  healCorruptedBaseStats: (): boolean => {
    const char = get().character;
    if (!char) return false;

    const floor = computeBaseStatFloor(
        char.class,
        char.highest_level ?? char.level,
    );

    const hpLow = (char.max_hp ?? 0) < floor.max_hp;
    const mpLow = (char.max_mp ?? 0) < floor.max_mp;
    if (!hpLow && !mpLow) return false;

    const updates: Partial<ICharacter> = {};
    if (hpLow) {
        updates.max_hp = floor.max_hp;
        if ((char.hp ?? 0) > floor.max_hp) {
            updates.hp = floor.max_hp;
        } else {
            updates.hp = Math.max(char.hp ?? 0, floor.max_hp);
        }
    }
    if (mpLow) {
        updates.max_mp = floor.max_mp;
        if ((char.mp ?? 0) > floor.max_mp) {
            updates.mp = floor.max_mp;
        } else {
            updates.mp = Math.max(char.mp ?? 0, floor.max_mp);
        }
    }

    console.warn(
        `[characterStore] Healed corrupted base stats for ${char.class} ` +
        `(lvl ${char.level}, highest ${char.highest_level ?? char.level}): ` +
        (hpLow ? `HP ${char.max_hp}->${floor.max_hp} ` : '') +
        (mpLow ? `MP ${char.max_mp}->${floor.max_mp}` : ''),
    );

    set({ character: { ...char, ...updates } });
    return true;
  },
  clearCharacter: () => {
    const charId = get().character?.id;
    if (charId) {
        void (async () => {
            try {
                const { usePartyStore } = await import('./partyStore');
                if (usePartyStore.getState().party) {
                    await usePartyStore.getState().leaveParty(charId);
                }
            } catch { }
        })();
    }
    set({ character: null });
  },
}));

registerCharacterLevelGetter(() => useCharacterStore.getState().character?.level ?? 1);
