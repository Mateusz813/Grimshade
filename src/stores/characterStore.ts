import { create } from 'zustand';
import type { CharacterClass, ICharacter as IApiCharacter } from '../api/v1/characterApi';
import { processXpGain, statPointsForLevelUp, BASE_HP_PER_LEVEL, BASE_MP_PER_LEVEL } from '../systems/levelSystem';
import { useInventoryStore, registerCharacterLevelGetter } from './inventoryStore';
import { useSkillStore } from './skillStore';
import { useLevelUpStore } from './levelUpStore';
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

/**
 * Returns the player's full effective max HP / MP — base + equipment +
 * training + elixir + transform — mirroring `getEffectiveChar` in
 * combatEngine.ts. Used by level-up and death-respawn to fully restore
 * HP/MP up to the bar the player actually sees in the header.
 *
 * Older revisions only summed equipment + training, leaving 10–20 % gap
 * after death whenever the player had an active elixir or completed
 * transform tier.
 */
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

/**
 * Backwards-compatible delta helper — kept so existing call sites that
 * only need bonus deltas (level-up bar widening) keep working without
 * recomputing the whole effective max each time.
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

/**
 * Gold milestone schedule: levels 10, 20, 30, 40, 50, then 100, 150, 200, …
 * (every 50 from 100 onward, forever). Reward: 10000 × level.
 *
 * Gated on highest_level so re-leveling after death never re-awards gold.
 */
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
  /**
   * Spend EVERY available stat point on a single stat in one go. Used by the
   * Postać view's stat-alloc tiles so a player who just dinged 50 levels
   * doesn't have to click 50 times. Idempotent — no-op when stat_points = 0.
   */
  spendAllStatPoints: (stat: StatPointStat) => void;
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
    // This prevents exploit: die -> lose level -> re-level -> get free stat points
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

    // Gold milestone rewards: 10/20/30/40/50/100/150/200/… -> 10k × level.
    // Gated on highest_level — re-leveling after death never re-awards gold.
    const goldMilestoneLevels = collectGoldMilestones(highestLevel, newHighest);
    const milestoneGoldGain = goldMilestoneLevels.reduce(
        (sum, lv) => sum + lv * GOLD_MILESTONE_REWARD_PER_LEVEL,
        0,
    );

    const newMaxHp = char.max_hp + hpGain + milestoneHp;
    const newMaxMp = char.max_mp + mpGain + milestoneMp;
    const newAttack = (char.attack ?? 0) + milestoneAtk;
    const newDefense = (char.defense ?? 0) + milestoneDef;
    // 2026-06-21 fix: the milestone gold reward used to be added to
    // `character.gold` (the `characters` table column), but the gold the
    // player actually sees / spends lives in `inventoryStore.gold` (the
    // game_saves blob — what TopHeader renders, what the shop spends, what
    // task rewards credit via `addGold`). Writing only to `character.gold`
    // meant the "+1cc" level-up announcement fired but the balance never
    // moved. We now credit the inventory pool (below, after the set) so the
    // reward lands where every other gold reward does. `character.gold` is
    // left untouched — consistent with task/hunting/shop gold, which never
    // touch it either.
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
        gold: char.gold ?? 0,
      },
    });

    // Credit the milestone gold to the SPENDABLE/displayed pool (inventory),
    // not the vestigial `characters.gold` column. Guarded so non-milestone
    // level-ups don't churn the inventory store.
    if (milestoneGoldGain > 0) {
      useInventoryStore.getState().addGold(milestoneGoldGain);
    }

    // Fire global level-up notification (deferred to next microtask so React
    // picks it up as a separate render – prevents the notification from being
    // swallowed when other state changes happen in the same synchronous block,
    // e.g. dungeon setPhase('result') called right after addXp).
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
    // Same hp/mp side-effect as the single-point version — bumping max_hp/mp
    // also tops up the current pool by the same amount so the bar shows the
    // gain immediately instead of leaving an awkward gap until next heal.
    if (stat === 'max_hp') updates.hp = (char.hp ?? 0) + total;
    if (stat === 'max_mp') updates.mp = (char.mp ?? 0) + total;

    set({ character: { ...char, ...updates } });
  },
  fullHealEffective: () => {
    const char = get().character;
    if (!char) return;
    // Use the FULL effective max (equipment + training + elixir + transform)
    // so a heavily-buffed player respawns at the cap shown in the header,
    // not just at base + gear. Elixir/transform-aware so death-respawn
    // doesn't silently cap them at 80–90 %.
    const { maxHp, maxMp } = getEffectiveMaxValues(char.max_hp, char.max_mp);
    set({
      character: {
        ...char,
        hp: maxHp,
        mp: maxMp,
      },
    });
  },
  clearCharacter: () => {
    // 2026-05-13 spec ("Kiedy wychodze do wyboru postaci to moje party
    // ktore mialem powinno zostac zlikwidowane"): leave any active
    // party before tearing down the character session. We can't rely
    // solely on the AvatarMenu menu-button hook because the player can
    // also reach char-select by clearing the URL — at that point only
    // the local React Router triggers, not our menu callback. By
    // wiring the dissolve into clearCharacter itself we cover every
    // exit path (menu, URL, programmatic logout). Fire-and-forget
    // because the character clear must not be blocked on network.
    const charId = get().character?.id;
    if (charId) {
        void (async () => {
            try {
                const { usePartyStore } = await import('./partyStore');
                if (usePartyStore.getState().party) {
                    await usePartyStore.getState().leaveParty(charId);
                }
            } catch { /* best effort */ }
        })();
    }
    set({ character: null });
  },
}));

// Let inventoryStore's potion level-gate read the LIVE character level without
// a circular import (characterStore -> inventoryStore is the only static edge).
registerCharacterLevelGetter(() => useCharacterStore.getState().character?.level ?? 1);
