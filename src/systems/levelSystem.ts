import { getAttributePointsForLevel } from './attributeSystem';

interface IXpAnchor { level: number; xp: number }

const XP_ANCHORS: readonly IXpAnchor[] = [
  { level: 100,  xp: Math.floor(300 * Math.pow(100, 1.5)) },
  { level: 200,  xp:   7_327_500 },
  { level: 400,  xp:  31_875_000 },
  { level: 600,  xp: 100_680_000 },
  { level: 800,  xp: 696_750_000 },
  { level: 1000, xp: 897_150_000 },
];

const legacyXp = (level: number): number =>
  Math.max(300, Math.floor(300 * Math.pow(level, 1.5)));

const interpolateAnchors = (level: number): number => {
  if (level <= XP_ANCHORS[0].level) return XP_ANCHORS[0].xp;
  const last = XP_ANCHORS[XP_ANCHORS.length - 1];
  if (level >= last.level) return last.xp;
  for (let i = 1; i < XP_ANCHORS.length; i++) {
    const a = XP_ANCHORS[i - 1];
    const b = XP_ANCHORS[i];
    if (level <= b.level) {
      const t = (level - a.level) / (b.level - a.level);
      return Math.floor(a.xp + (b.xp - a.xp) * t);
    }
  }
  return last.xp;
};

export const xpToNextLevel = (level: number): number => {
  if (level <= 0) return 300;
  if (level < XP_ANCHORS[0].level) return legacyXp(level);
  const last = XP_ANCHORS[XP_ANCHORS.length - 1];
  if (level >= last.level) {
    const overflow = level - last.level;
    return Math.floor(last.xp * Math.pow(1.10, overflow));
  }
  return interpolateAnchors(level);
};

export const totalXpForLevel = (level: number): number => {
  if (level <= 1) return 0;
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNextLevel(l);
  return total;
};

export const ATTRIBUTE_POINTS_PER_MILESTONE = 1;

export interface ILevelUpResult {
  newLevel: number;
  remainingXp: number;
  levelsGained: number;
  statPointsGained: number;
}

export const processXpGain = (
  currentLevel: number,
  currentXp: number,
  xpGained: number,
): ILevelUpResult => {
  let level = currentLevel;
  let xp = currentXp + xpGained;
  let levelsGained = 0;

  const HARD_SAFETY_CAP = 10_000;
  const startLevel = level;
  while (xp >= xpToNextLevel(level) && level < HARD_SAFETY_CAP) {
    xp -= xpToNextLevel(level);
    level++;
    levelsGained++;
  }

  const statPointsGained = getAttributePointsForLevel(level) - getAttributePointsForLevel(startLevel);

  return { newLevel: level, remainingXp: xp, levelsGained, statPointsGained };
};


export interface IDeathPenaltyResult {
    newLevel: number;
    newXp: number;
    xpPercent: number;
    levelsLost: number;
    skillXpLossPercent: number;
}

const DEATH_SKILL_XP_LOSS_PCT = 25;
const FLEE_SKILL_XP_LOSS_PCT = 2.5;

export const getDeathLossLevels = (level: number): number =>
    Math.max(0.20, level / 100);

export const getFleeLossLevels = (level: number): number =>
    getDeathLossLevels(level) * 0.10;

export const ITEM_LOSS_GRACE_MAX_LEVEL = 50;

export const losesItemsOnDeath = (level: number): boolean =>
    level > ITEM_LOSS_GRACE_MAX_LEVEL;

const applyLevelLoss = (
    currentLevel: number,
    currentXp: number,
    lossLevels: number,
    skillXpLossPercent: number,
): IDeathPenaltyResult => {
    const denom = Math.max(1, xpToNextLevel(currentLevel));
    const frac = Math.max(0, Math.min(1, (currentXp ?? 0) / denom));
    const exactPos = currentLevel + frac;
    const newExactPos = Math.max(1, exactPos - Math.max(0, lossLevels));
    const newLevel = Math.max(1, Math.floor(newExactPos));
    const newFrac = Math.max(0, newExactPos - newLevel);
    const newXp = Math.max(0, Math.round(newFrac * Math.max(1, xpToNextLevel(newLevel))));
    return {
        newLevel,
        newXp,
        xpPercent: Math.round(newFrac * 100),
        levelsLost: currentLevel - newLevel,
        skillXpLossPercent,
    };
};

export const applyDeathPenalty = (
    currentLevel: number,
    currentXp: number,
): IDeathPenaltyResult =>
    applyLevelLoss(currentLevel, currentXp, getDeathLossLevels(currentLevel), DEATH_SKILL_XP_LOSS_PCT);

export const applyFleePenalty = (
    currentLevel: number,
    currentXp: number,
): IDeathPenaltyResult =>
    applyLevelLoss(currentLevel, currentXp, getFleeLossLevels(currentLevel), FLEE_SKILL_XP_LOSS_PCT);

export const applyDeathXpPenalty = (
    currentXp: number,
    currentLevel: number,
): number => {
    const penalty = Math.floor(xpToNextLevel(currentLevel) * 0.1);
    return Math.max(0, currentXp - penalty);
};

export const xpProgress = (currentXp: number, currentLevel: number): number => {
  const needed = xpToNextLevel(currentLevel);
  return needed > 0 ? Math.min(1, currentXp / needed) : 0;
};

export const BASE_HP_PER_LEVEL: Record<string, number> = {
  Knight: 8, Mage: 3, Cleric: 5, Archer: 4,
  Rogue: 4, Necromancer: 3, Bard: 4,
};

export const BASE_MP_PER_LEVEL: Record<string, number> = {
  Knight: 2, Mage: 8, Cleric: 6, Archer: 3,
  Rogue: 3, Necromancer: 9, Bard: 5,
};
