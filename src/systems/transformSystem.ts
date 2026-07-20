
import type { IMonster } from '../types/monster';
import type { IInventoryItem } from './itemSystem';
import type { TCharacterClass } from '../api/v1/characterApi';
import { generateWeapon } from './itemGenerator';
import { getMonsterImage } from './spriteAssets';
import { SPELL_CHEST_LEVELS } from './skillSystem';
import monstersData from '../data/monsters.json';
import transformsData from '../data/transforms.json';


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

export interface ITransformColor {
  solid: string | null;
  gradient: [string, string] | null;
  css: string;
}

export interface ITransformRewards {
  weapon: IInventoryItem | null;
  consumables: Array<{ id: string; count: number }>;
  permanentBonuses: ITransformPermanentBonuses;
}

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


const CLASS_TRANSFORM_BONUSES: Record<TCharacterClass, ITransformPermanentBonuses> = {
  Mage: {
    dmgPercent: 3,
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
    dmgPercent: 2,
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
    dmgPercent: 2,
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
    dmgPercent: 2,
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
    dmgPercent: 2,
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
    dmgPercent: 2,
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
    dmgPercent: 1,
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

export const getTransformTierMultiplier = (transformId: number): number => {
  if (!transformId || transformId < 1) return 1.0;
  return 1 + (transformId - 1) * 0.3;
};

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


const CLASS_WEAPON_TYPE: Record<TCharacterClass, string> = {
  Knight: 'sword',
  Mage: 'staff',
  Cleric: 'holy_wand',
  Archer: 'bow',
  Rogue: 'dagger',
  Necromancer: 'dead_staff',
  Bard: 'harp',
};


export const TRANSFORM_BOSS_MULTIPLIER = {
  hp: 5.0,
  atk: 3.0,
  def: 3.0,
};

export type TTransformTier = 'Normal' | 'Strong' | 'Epic' | 'Boss';

export const TRANSFORM_TIER_MULTIPLIERS: Record<TTransformTier, { hp: number; atk: number; def: number }> = {
  Normal: { hp: 1.0, atk: 1.0, def: 1.0 },
  Strong: { hp: 2.0, atk: 1.5, def: 1.3 },
  Epic:   { hp: 4.0, atk: 2.5, def: 1.8 },
  Boss:   { hp: TRANSFORM_BOSS_MULTIPLIER.hp, atk: TRANSFORM_BOSS_MULTIPLIER.atk, def: TRANSFORM_BOSS_MULTIPLIER.def },
};

export const TRANSFORM_SLOT_TIERS: readonly TTransformTier[] = ['Normal', 'Strong', 'Epic', 'Boss'];

export const resolveActiveOpponentSlot = (
  escorts: ReadonlyArray<{ currentHp: number } | null>,
): 0 | 1 | 2 | 3 => {
  for (let s = 0; s < 3; s++) {
    const e = escorts[s];
    if (e && e.currentHp > 0) return s as 0 | 1 | 2;
  }
  return 3;
};


const allTransforms: ITransformData[] = transformsData as ITransformData[];
const allMonsters: IMonster[] = monstersData as unknown as IMonster[];

export const TRANSFORM_COUNT = allTransforms.length;

export const getAllTransforms = (): ITransformData[] => {
  return allTransforms;
};

export const getTransformById = (transformId: number): ITransformData | undefined => {
  return allTransforms.find((t) => t.id === transformId);
};


const sortedMonsters = [...allMonsters].sort((a, b) => a.level - b.level);

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

const scaleMonsterStats = (
  level: number,
): { hp: number; attack: number; attack_min: number; attack_max: number; defense: number; xp: number } => {
  const capstone = level >= 901 ? 3.5 : 1;
  const hp = Math.floor((95 * Math.pow(level, 1.1) + 30) * capstone);
  const dmgBase = 8 + level * 1.0;
  const attack = Math.floor(dmgBase);
  const attack_min = Math.max(1, Math.floor(dmgBase * 0.8));
  const attack_max = Math.max(attack_min, Math.floor(dmgBase * 1.2));
  const defense = Math.floor(level * 0.4);
  const xp = Math.floor(level * 15 + Math.pow(level, 1.5) * 2);
  return { hp, attack, attack_min, attack_max, defense, xp };
};

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

const transformMonsterCache = new Map<number, IMonster[]>();


export const getTransformMonsters = (transformId: number): IMonster[] => {
  const transform = getTransformById(transformId);
  if (!transform) return [];

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

export const getTransformMonsterCount = (transformId: number): number => {
  return getTransformMonsters(transformId).length;
};

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

  if (transform.rewards.premiumXpElixirCount > 0) {
    consumables.push({
      id: 'premium_xp_elixir',
      count: transform.rewards.premiumXpElixirCount,
    });
  }

  if (transform.rewards.hpPotionCount > 0) {
    consumables.push({
      id: transform.rewards.hpPotionId,
      count: transform.rewards.hpPotionCount,
    });
  }

  if (transform.rewards.mpPotionCount > 0) {
    consumables.push({
      id: transform.rewards.mpPotionId,
      count: transform.rewards.mpPotionCount,
    });
  }

  if (transform.rewards.spellChestCount > 0) {
    const chestLevel = SPELL_CHEST_LEVELS.find(
      (l) => l >= transform.rewards.spellChestLevel,
    ) ?? null;
    if (chestLevel !== null) {
      consumables.push({
        id: `spell_chest_${chestLevel}`,
        count: transform.rewards.spellChestCount,
      });
    }
  }

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

export const getTransformBonuses = (
  transformId: number,
  characterClass?: TCharacterClass,
): ITransformPermanentBonuses => {
  const transform = getTransformById(transformId);
  if (!transform) return { ...EMPTY_BONUSES };
  if (!characterClass) return { ...EMPTY_BONUSES };
  return getClassTransformBonuses(characterClass, transformId);
};

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

export const isLevelSufficient = (characterLevel: number, transformId: number): boolean => {
  const transform = getTransformById(transformId);
  if (!transform) return false;
  return characterLevel >= transform.level;
};

export const getNextAvailableTransform = (
  completedTransformIds: number[],
  characterLevel: number,
): ITransformData | null => {
  const completedSet = new Set(completedTransformIds);

  for (const transform of allTransforms) {
    if (!completedSet.has(transform.id)) {
      if (characterLevel >= transform.level) {
        return transform;
      }
      return null;
    }
  }

  return null;
};

export const getHighestCompletedTransform = (completedTransformIds: number[]): number => {
  if (completedTransformIds.length === 0) return 0;
  return Math.max(...completedTransformIds);
};

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

export const applyTransformTierStats = (
  monster: IMonster,
  tier: TTransformTier,
): IMonster => {
  const mult = TRANSFORM_TIER_MULTIPLIERS[tier];
  const atkMin = monster.attack_min ?? Math.floor(monster.attack * 0.8);
  const atkMax = monster.attack_max ?? Math.floor(monster.attack * 1.2);
  return {
    ...monster,
    hp: Math.floor(monster.hp * mult.hp),
    attack: Math.floor(monster.attack * mult.atk),
    attack_min: Math.max(1, Math.floor(atkMin * mult.atk)),
    attack_max: Math.max(1, Math.floor(atkMax * mult.atk)),
    defense: Math.floor(monster.defense * mult.def),
  };
};

export const getTransformWaveLineup = (
  bossMonster: IMonster,
  bossLevel: number,
): Array<{ slot: 0 | 1 | 2 | 3; tier: TTransformTier; monster: IMonster; spriteImageUrl: string | null }> => {
  const pool = [...allMonsters]
    .filter((m) => m.id !== bossMonster.id)
    .sort((a, b) => Math.abs(a.level - bossLevel) - Math.abs(b.level - bossLevel));

  const fallback = pool[0] ?? bossMonster;
  const tplNormal = pool[0] ?? fallback;
  const tplStrong = pool[1] ?? fallback;
  const tplEpic   = pool[2] ?? fallback;

  const stamp = (tpl: IMonster, slot: number): IMonster => {
    const scaled = scaleMonsterStats(bossLevel);
    return {
      ...tpl,
      id: `${bossMonster.id}__slot${slot}_${tpl.id}`,
      level: bossLevel,
      hp: scaled.hp,
      attack: scaled.attack,
      attack_min: scaled.attack_min,
      attack_max: scaled.attack_max,
      defense: scaled.defense,
      xp: scaled.xp,
    };
  };

  const lookupSprite = (tpl: IMonster) => getMonsterImage(tpl.level);

  return [
    { slot: 0, tier: 'Normal', monster: applyTransformTierStats(stamp(tplNormal, 0), 'Normal'), spriteImageUrl: lookupSprite(tplNormal) },
    { slot: 1, tier: 'Strong', monster: applyTransformTierStats(stamp(tplStrong, 1), 'Strong'), spriteImageUrl: lookupSprite(tplStrong) },
    { slot: 2, tier: 'Epic',   monster: applyTransformTierStats(stamp(tplEpic,   2), 'Epic'),   spriteImageUrl: lookupSprite(tplEpic) },
    { slot: 3, tier: 'Boss',   monster: bossMonster, spriteImageUrl: null },
  ];
};
