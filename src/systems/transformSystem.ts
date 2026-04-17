/**
 * Transform System – logic for the character transformation progression.
 *
 * Players complete difficult quests (defeating ALL monsters in a level range
 * as BOSS rarity x8) to permanently upgrade their character.
 */

import type { IMonster } from '../types/monster';
import type { IInventoryItem } from './itemSystem';
import type { TCharacterClass } from '../api/v1/characterApi';
import { generateWeapon } from './itemGenerator';
import monstersData from '../data/monsters.json';
import transformsData from '../data/transforms.json';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ITransformData {
  id: number;
  level: number;
  name_pl: string;
  name_en: string;
  color: string | null;
  gradientColors: [string, string] | null;
  monsterLevelRange: [number, number];
  avatarSuffix: string;
  rewards: ITransformRewardsConfig;
}

export interface ITransformRewardsConfig {
  permanentBonuses: ITransformPermanentBonuses;
  premiumXpElixirCount: number;
  hpPotionId: string;
  hpPotionCount: number;
  mpPotionId: string;
  mpPotionCount: number;
  spellChestLevel: number;
  spellChestCount: number;
  mythicStoneCount: number;
}

export interface ITransformPermanentBonuses {
  /** Percent bonus to max HP, applied live via getTransformHpPctMultiplier. */
  hpPercent: number;
  /** Percent bonus to max MP, applied live. */
  mpPercent: number;
  /** Percent bonus to defense, applied live. */
  defPercent: number;
  /**
   * Percent bonus to outgoing player damage. NOT baked at completion –
   * applied live via getTransformDmgMultiplier() in transformBonuses.ts.
   * All completed transforms stack additively (Σ dmgPercent / 100).
   */
  dmgPercent: number;
  /** Point N5: percent bonus to flat attack, applied live on top of base+eq. */
  atkPercent: number;
  /** Flat bonus to max HP. */
  flatHp: number;
  /** Flat bonus to max MP. */
  flatMp: number;
  /** Flat bonus to attack stat. */
  attack: number;
  /** Flat bonus to defense stat. */
  defense: number;
  /** Legacy: flat hp regen per second bonus (currently not wired into combat). */
  hpRegen: number;
  /** Legacy: flat mp regen per second bonus (currently not wired into combat). */
  mpRegen: number;
  /** Flat HP/s bonus live-applied in getEffectiveChar. */
  hpRegenFlat: number;
  /** Flat MP/s bonus live-applied in getEffectiveChar. */
  mpRegenFlat: number;
  /** Legacy: class skill bonus marker (unused in combat). */
  classSkillBonus: number;
}

export interface ITransformColor {
  solid: string | null;
  gradient: [string, string] | null;
  /** CSS value ready to use (either solid color or linear-gradient). */
  css: string;
}

export interface ITransformRewards {
  weapon: IInventoryItem | null;
  consumables: Array<{ id: string; count: number }>;
  permanentBonuses: ITransformPermanentBonuses;
}

/** Cumulative permanent bonuses from all completed transforms. */
export interface ICumulativeTransformBonuses {
  hpPercent: number;
  mpPercent: number;
  defPercent: number;
  dmgPercent: number;
  atkPercent: number;
  flatHp: number;
  flatMp: number;
  attack: number;
  defense: number;
  hpRegen: number;
  mpRegen: number;
  hpRegenFlat: number;
  mpRegenFlat: number;
  classSkillBonus: number;
}

// ── Class-specific per-transform permanent bonuses ───────────────────────────
// These OVERRIDE the permanentBonuses block in transforms.json so that every
// transform grants the same class-specific reward. With 11 transforms the
// totals are designed to be strong but not broken:
//   Mage      ≈ +88% dmg, +22% HP, +33% MP, +770 HP, +2200 MP, +143 ATK
//   Knight    ≈ +33% dmg, +44% HP, +33% DEF, +2200 HP, +99 ATK, +176 DEF
//   (etc.)
// hpRegen / mpRegen / classSkillBonus are kept at 0 – they were never wired
// into combat in the old system and this rebalance keeps that behaviour.

// Baseline (tier 1) per-class bonuses. Later transforms scale these up via
// getTransformTierMultiplier() so that completing T11 grants a dramatically
// larger reward than T1 (~4x by default).
const CLASS_TRANSFORM_BONUSES: Record<TCharacterClass, ITransformPermanentBonuses> = {
  Mage: {
    dmgPercent: 8,
    hpPercent: 2,
    mpPercent: 3,
    defPercent: 1,
    atkPercent: 0,
    flatHp: 150,
    flatMp: 400,
    attack: 13,
    defense: 3,
    hpRegen: 0,
    mpRegen: 0,
    hpRegenFlat: 0.2,
    mpRegenFlat: 0.5,
    classSkillBonus: 0,
  },
  Cleric: {
    dmgPercent: 5,
    hpPercent: 3,
    mpPercent: 3,
    defPercent: 2,
    atkPercent: 0,
    flatHp: 220,
    flatMp: 380,
    attack: 10,
    defense: 10,
    hpRegen: 0,
    mpRegen: 0,
    hpRegenFlat: 0.5,
    mpRegenFlat: 0.4,
    classSkillBonus: 0,
  },
  Necromancer: {
    dmgPercent: 7,
    hpPercent: 2,
    mpPercent: 3,
    defPercent: 1,
    atkPercent: 0,
    flatHp: 180,
    flatMp: 380,
    attack: 12,
    defense: 5,
    hpRegen: 0,
    mpRegen: 0,
    hpRegenFlat: 0.25,
    mpRegenFlat: 0.4,
    classSkillBonus: 0,
  },
  Archer: {
    // Point N5: Archer's attack bonus is now percent-based so it scales with
    // the player's live ATK (base + equip + training + elixirs). Flat attack
    // is zeroed out — the +7% multiplier replaces it at every transform tier.
    dmgPercent: 7,
    hpPercent: 2,
    mpPercent: 1,
    defPercent: 1,
    atkPercent: 7,
    flatHp: 220,
    flatMp: 150,
    attack: 0,
    defense: 5,
    hpRegen: 0,
    mpRegen: 0,
    hpRegenFlat: 0.3,
    mpRegenFlat: 0.2,
    classSkillBonus: 0,
  },
  Rogue: {
    dmgPercent: 7,
    hpPercent: 2,
    mpPercent: 1,
    defPercent: 1,
    atkPercent: 0,
    flatHp: 190,
    flatMp: 150,
    attack: 15,
    defense: 4,
    hpRegen: 0,
    mpRegen: 0,
    hpRegenFlat: 0.3,
    mpRegenFlat: 0.2,
    classSkillBonus: 0,
  },
  Bard: {
    dmgPercent: 5,
    hpPercent: 3,
    mpPercent: 3,
    defPercent: 2,
    atkPercent: 0,
    flatHp: 230,
    flatMp: 260,
    attack: 10,
    defense: 9,
    hpRegen: 0,
    mpRegen: 0,
    hpRegenFlat: 0.4,
    mpRegenFlat: 0.3,
    classSkillBonus: 0,
  },
  Knight: {
    dmgPercent: 3,
    hpPercent: 4,
    mpPercent: 1,
    defPercent: 3,
    atkPercent: 0,
    flatHp: 420,
    flatMp: 70,
    attack: 9,
    defense: 16,
    hpRegen: 0,
    mpRegen: 0,
    hpRegenFlat: 0.5,
    mpRegenFlat: 0.1,
    classSkillBonus: 0,
  },
};

/**
 * Tier multiplier for a given transform id. Later transforms grant larger
 * flat rewards (HP/MP/ATK/DEF/regen) while percent bonuses remain unchanged.
 *   T1 → 1.0x · T6 → 2.5x · T11 → 4.0x
 */
export const getTransformTierMultiplier = (transformId: number): number => {
  if (!transformId || transformId < 1) return 1.0;
  return 1 + (transformId - 1) * 0.3;
};

/**
 * Get the per-transform permanent bonuses for a given class. If a transformId
 * is provided, flat rewards (HP/MP/ATK/DEF/regen) are scaled by the tier
 * multiplier so that later transforms grant dramatically larger bonuses.
 * Percent bonuses (hpPercent/mpPercent/defPercent/dmgPercent) are kept flat
 * per tier – they stack naturally across transforms already.
 */
export const getClassTransformBonuses = (
  characterClass: TCharacterClass,
  transformId?: number,
): ITransformPermanentBonuses => {
  const base = { ...CLASS_TRANSFORM_BONUSES[characterClass] };
  if (!transformId || transformId < 1) return base;
  const mult = getTransformTierMultiplier(transformId);
  return {
    ...base,
    flatHp:      Math.floor(base.flatHp * mult),
    flatMp:      Math.floor(base.flatMp * mult),
    attack:      Math.floor(base.attack * mult),
    defense:     Math.floor(base.defense * mult),
    hpRegenFlat: Math.round(base.hpRegenFlat * mult * 10) / 10,
    mpRegenFlat: Math.round(base.mpRegenFlat * mult * 10) / 10,
  };
};

const EMPTY_BONUSES: ITransformPermanentBonuses = {
  hpPercent: 0,
  mpPercent: 0,
  defPercent: 0,
  dmgPercent: 0,
  atkPercent: 0,
  flatHp: 0,
  flatMp: 0,
  attack: 0,
  defense: 0,
  hpRegen: 0,
  mpRegen: 0,
  hpRegenFlat: 0,
  mpRegenFlat: 0,
  classSkillBonus: 0,
};

// ── Weapon type per class ─────────────────────────────────────────────────────

const CLASS_WEAPON_TYPE: Record<TCharacterClass, string> = {
  Knight: 'sword',
  Mage: 'staff',
  Cleric: 'holy_wand',
  Archer: 'bow',
  Rogue: 'dagger',
  Necromancer: 'dead_staff',
  Bard: 'harp',
};

// ── Boss multiplier for transform quest monsters ──────────────────────────────

export const TRANSFORM_BOSS_MULTIPLIER = {
  hp: 8.0,
  atk: 8.0,
  def: 8.0,
};

// ── Data access helpers ───────────────────────────────────────────────────────

const allTransforms: ITransformData[] = transformsData as ITransformData[];
const allMonsters: IMonster[] = monstersData as IMonster[];

/** Total number of transforms in the game. */
export const TRANSFORM_COUNT = allTransforms.length;

/** Get all transform definitions. */
export const getAllTransforms = (): ITransformData[] => {
  return allTransforms;
};

/** Get a single transform by ID (1-11). Returns undefined if not found. */
export const getTransformById = (transformId: number): ITransformData | undefined => {
  return allTransforms.find((t) => t.id === transformId);
};

// ── Monster generation helpers ───────────────────────────────────────────────

/** Sort monsters by level ascending for binary-search-like lookup. */
const sortedMonsters = [...allMonsters].sort((a, b) => a.level - b.level);

/**
 * Find the closest monster from monsters.json at or below the given level.
 * Falls back to the lowest-level monster if none is at or below.
 */
const findClosestMonster = (level: number): IMonster => {
  let best: IMonster = sortedMonsters[0];
  for (const m of sortedMonsters) {
    if (m.level <= level) {
      best = m;
    } else {
      break;
    }
  }
  return best;
};

/**
 * Scale monster stats using the standard formulas from CLAUDE.md.
 * These are the BASE stats (before boss multiplier).
 */
const scaleMonsterStats = (
  level: number,
): { hp: number; attack: number; attack_min: number; attack_max: number; defense: number; xp: number } => {
  const hp = Math.floor(15 + level * 12 + Math.pow(level, 1.4) * 3);
  const dmgBase = 2 + level * 1.8 + Math.pow(level, 1.2) * 0.5;
  const attack = Math.floor(dmgBase);
  const attack_min = Math.max(1, Math.floor(dmgBase * 0.8));
  const attack_max = Math.max(attack_min, Math.floor(dmgBase * 1.2));
  const defense = Math.floor(level * 1.2);
  const xp = Math.floor(level * 15 + Math.pow(level, 1.5) * 2);
  return { hp, attack, attack_min, attack_max, defense, xp };
};

/**
 * Generate a transform boss monster for a specific level.
 * Finds the closest real monster for name/sprite, then scales stats to the target level.
 */
const generateTransformBossMonster = (level: number): IMonster => {
  const template = findClosestMonster(level);
  const stats = scaleMonsterStats(level);

  return {
    id: `transform_boss_${level}`,
    name_pl: template.name_pl,
    name_en: template.name_en,
    level,
    hp: stats.hp,
    attack: stats.attack,
    attack_min: stats.attack_min,
    attack_max: stats.attack_max,
    defense: stats.defense,
    speed: template.speed,
    xp: stats.xp,
    gold: [
      Math.floor(level * 10),
      Math.floor(level * 20),
    ],
    dropTable: [],
    sprite: template.sprite,
  };
};

/** Cache generated monsters per transform to avoid regenerating every call. */
const transformMonsterCache = new Map<number, IMonster[]>();

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Get the list of monsters that must be defeated for a given transform.
 * Generates one boss monster for EVERY level in the range (inclusive).
 * For example, T1 with range [1, 30] produces 30 monsters (levels 1-30).
 */
export const getTransformMonsters = (transformId: number): IMonster[] => {
  const transform = getTransformById(transformId);
  if (!transform) return [];

  // Return from cache if available
  const cached = transformMonsterCache.get(transformId);
  if (cached) return cached;

  const [minLvl, maxLvl] = transform.monsterLevelRange;
  const monsters: IMonster[] = [];

  for (let lvl = minLvl; lvl <= maxLvl; lvl++) {
    monsters.push(generateTransformBossMonster(lvl));
  }

  transformMonsterCache.set(transformId, monsters);
  return monsters;
};

/**
 * Get the total number of monsters required for a transform quest.
 */
export const getTransformMonsterCount = (transformId: number): number => {
  return getTransformMonsters(transformId).length;
};

/**
 * Calculate the full rewards for completing a transform.
 * Generates a mythic weapon for the player's class at the transform's level,
 * plus consumable rewards (elixirs, potions).
 */
export const calculateTransformRewards = (
  transformId: number,
  characterClass: TCharacterClass,
): ITransformRewards => {
  const transform = getTransformById(transformId);
  if (!transform) {
    return {
      weapon: null,
      consumables: [],
      permanentBonuses: { ...EMPTY_BONUSES },
    };
  }

  const weaponType = CLASS_WEAPON_TYPE[characterClass];
  const weapon = generateWeapon(weaponType, transform.level, 'mythic');

  const consumables: Array<{ id: string; count: number }> = [];

  // Premium XP Elixirs
  if (transform.rewards.premiumXpElixirCount > 0) {
    consumables.push({
      id: 'premium_xp_elixir',
      count: transform.rewards.premiumXpElixirCount,
    });
  }

  // HP Potions
  if (transform.rewards.hpPotionCount > 0) {
    consumables.push({
      id: transform.rewards.hpPotionId,
      count: transform.rewards.hpPotionCount,
    });
  }

  // MP Potions
  if (transform.rewards.mpPotionCount > 0) {
    consumables.push({
      id: transform.rewards.mpPotionId,
      count: transform.rewards.mpPotionCount,
    });
  }

  // Spell Chest (guaranteed, level matches transform level)
  if (transform.rewards.spellChestCount > 0) {
    consumables.push({
      id: `spell_chest_${transform.rewards.spellChestLevel}`,
      count: transform.rewards.spellChestCount,
    });
  }

  // Mythic Enhancement Stone
  if (transform.rewards.mythicStoneCount > 0) {
    consumables.push({
      id: 'mythic_stone',
      count: transform.rewards.mythicStoneCount,
    });
  }

  return {
    weapon,
    consumables,
    permanentBonuses: getClassTransformBonuses(characterClass, transformId),
  };
};

/**
 * Get the color/gradient info for a transform.
 * Returns a ready-to-use CSS value.
 */
export const getTransformColor = (transformId: number): ITransformColor => {
  const transform = getTransformById(transformId);
  if (!transform) {
    return { solid: '#9e9e9e', gradient: null, css: '#9e9e9e' };
  }

  if (transform.gradientColors) {
    const grad = transform.gradientColors as [string, string];
    return {
      solid: null,
      gradient: grad,
      css: `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`,
    };
  }

  const color = transform.color ?? '#9e9e9e';
  return {
    solid: color,
    gradient: null,
    css: color,
  };
};

/**
 * Get the permanent stat bonuses for a specific transform. Bonuses are now
 * class-specific – every transform grants the same per-class reward, strength
 * comes from stacking across all completed transforms. The transformId is
 * kept for API compatibility but the reward table is not transform-indexed.
 */
export const getTransformBonuses = (
  transformId: number,
  characterClass?: TCharacterClass,
): ITransformPermanentBonuses => {
  const transform = getTransformById(transformId);
  if (!transform) return { ...EMPTY_BONUSES };
  if (!characterClass) return { ...EMPTY_BONUSES };
  return getClassTransformBonuses(characterClass, transformId);
};

/**
 * Calculate cumulative bonuses from all completed transforms for a class.
 * Used to apply permanent stat bonuses to the character.
 */
export const getCumulativeTransformBonuses = (
  completedTransformIds: number[],
  characterClass?: TCharacterClass,
): ICumulativeTransformBonuses => {
  const result: ICumulativeTransformBonuses = {
    hpPercent: 0,
    mpPercent: 0,
    defPercent: 0,
    dmgPercent: 0,
    atkPercent: 0,
    flatHp: 0,
    flatMp: 0,
    attack: 0,
    defense: 0,
    hpRegen: 0,
    mpRegen: 0,
    hpRegenFlat: 0,
    mpRegenFlat: 0,
    classSkillBonus: 0,
  };

  if (!characterClass) return result;

  for (const tid of completedTransformIds) {
    if (!getTransformById(tid)) continue;
    const per = getClassTransformBonuses(characterClass, tid);
    result.hpPercent += per.hpPercent;
    result.mpPercent += per.mpPercent;
    result.defPercent += per.defPercent;
    result.dmgPercent += per.dmgPercent;
    result.atkPercent += per.atkPercent;
    result.flatHp += per.flatHp;
    result.flatMp += per.flatMp;
    result.attack += per.attack;
    result.defense += per.defense;
    result.hpRegen += per.hpRegen;
    result.mpRegen += per.mpRegen;
    result.hpRegenFlat += per.hpRegenFlat;
    result.mpRegenFlat += per.mpRegenFlat;
    result.classSkillBonus += per.classSkillBonus;
  }

  return result;
};

/**
 * Check if a character level is high enough for a specific transform.
 */
export const isLevelSufficient = (characterLevel: number, transformId: number): boolean => {
  const transform = getTransformById(transformId);
  if (!transform) return false;
  return characterLevel >= transform.level;
};

/**
 * Get the next transform a character should do, given their completed transforms
 * and current level. Returns null if all transforms are done or character level
 * is too low for the next one.
 */
export const getNextAvailableTransform = (
  completedTransformIds: number[],
  characterLevel: number,
): ITransformData | null => {
  const completedSet = new Set(completedTransformIds);

  // Transforms must be done in order
  for (const transform of allTransforms) {
    if (!completedSet.has(transform.id)) {
      // This is the next one; check if level is sufficient
      if (characterLevel >= transform.level) {
        return transform;
      }
      // Level too low for the next required transform
      return null;
    }
  }

  // All transforms completed
  return null;
};

/**
 * Get the highest completed transform number (0 if none completed).
 */
export const getHighestCompletedTransform = (completedTransformIds: number[]): number => {
  if (completedTransformIds.length === 0) return 0;
  return Math.max(...completedTransformIds);
};

/**
 * Get the avatar filename for a character based on their class and highest
 * completed transform. Returns null if no transform is completed.
 */
export const getActiveAvatar = (
  characterClass: TCharacterClass,
  completedTransformIds: number[],
): string | null => {
  const highest = getHighestCompletedTransform(completedTransformIds);
  if (highest === 0) return null;

  const transform = getTransformById(highest);
  if (!transform) return null;

  const classKey = characterClass.toLowerCase();
  return `${classKey}${transform.avatarSuffix}.png`;
};

/**
 * Apply BOSS multipliers to a monster for the transform quest.
 * Returns a copy of the monster with scaled stats.
 */
export const applyTransformBossStats = (monster: IMonster): IMonster => {
  const atkMin = monster.attack_min ?? Math.floor(monster.attack * 0.8);
  const atkMax = monster.attack_max ?? Math.floor(monster.attack * 1.2);
  return {
    ...monster,
    hp: Math.floor(monster.hp * TRANSFORM_BOSS_MULTIPLIER.hp),
    attack: Math.floor(monster.attack * TRANSFORM_BOSS_MULTIPLIER.atk),
    attack_min: Math.max(1, Math.floor(atkMin * TRANSFORM_BOSS_MULTIPLIER.atk)),
    attack_max: Math.max(1, Math.floor(atkMax * TRANSFORM_BOSS_MULTIPLIER.atk)),
    defense: Math.floor(monster.defense * TRANSFORM_BOSS_MULTIPLIER.def),
  };
};
