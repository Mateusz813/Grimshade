// -- XP Curve ------------------------------------------------------------------
//
// Below level 100 we keep the legacy `300 * L^1.5` curve — cheap early levels
// so new players see progress fast. From 100 onwards the curve bends up so a
// level's worth of XP roughly equals the reward from a single bulk kill-task
// at the player's tier, following these player-defined anchors:
//
//   Level  200 -> 5 000   kills = 1 level   -> ~7.3M  XP / level
//   Level  400 -> 10 000  kills = 1 level   -> ~31.9M XP / level
//   Level  600 -> 20 000  kills = 1 level   -> ~100.7M XP / level   (2× @400)
//   Level  800 -> 100 000 kills = 1 level   -> ~696.8M XP / level   (10× @800)
//   Level 1000 -> 100 000 kills = 1 level   -> ~897.2M XP / level
//
// 2026-05-11 spec ("Mozna lvlowac powyzej 1000lvl tylko kazdy kolejny
// poziom jest o 10% trudniejszy do wbicia niz poprzedni"): above 1000
// the soft cap lifts and every subsequent level needs 10 % more XP
// than the one before. The growth is `xpToNextLevel(1000) × 1.10^(L−1000)`
// — exponential but slow enough that day-1 grinding feels like normal
// post-cap progression; by lvl 1100 a level costs ~13× as much as 1000,
// and by 1200 ~136× — diminishing-returns territory but still always
// reachable.
//
// taskRewardXp = monsterXp(L) × killCount × 1.5 (see taskRewards.ts), and the
// anchors were computed from monsters.json's `xp` column at each level tier.
// Between anchors we interpolate linearly.

interface IXpAnchor { level: number; xp: number }

const XP_ANCHORS: readonly IXpAnchor[] = [
  { level: 100,  xp: Math.floor(300 * Math.pow(100, 1.5)) }, // 300 000 — smooth join with legacy curve
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

/** XP required to advance from `level` -> `level + 1`. */
export const xpToNextLevel = (level: number): number => {
  if (level <= 0) return 300;
  if (level < XP_ANCHORS[0].level) return legacyXp(level);
  // 2026-05-11: above the level-1000 anchor every additional level
  // costs 10 % more XP than the previous one. Compounding from the
  // 1000 anchor: cost(L) = anchor1000 * 1.10^(L-1000).
  const last = XP_ANCHORS[XP_ANCHORS.length - 1];
  if (level >= last.level) {
    const overflow = level - last.level;
    return Math.floor(last.xp * Math.pow(1.10, overflow));
  }
  return interpolateAnchors(level);
};

// -- Total XP from level 1 to reach `level` ------------------------------------
export const totalXpForLevel = (level: number): number => {
  if (level <= 1) return 0;
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNextLevel(l);
  return total;
};

// -- Stat points awarded per level-up (fixed per class) ----------------------
const STAT_POINTS_PER_CLASS: Record<string, number> = {
  Knight: 2,
  Mage: 2,
  Cleric: 2,
  Archer: 2,
  Rogue: 2,
  Necromancer: 2,
  Bard: 2,
};

export const statPointsForLevelUp = (characterClass?: string): number =>
  STAT_POINTS_PER_CLASS[characterClass ?? ''] ?? 2;

// -- Process accumulated XP – may trigger multiple level-ups ------------------
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
  let statPointsGained = 0;

  // 2026-05-11: the hard cap at 1000 is gone. Each level past 1000 costs
  // 10 % more XP than the previous (see xpToNextLevel). Hard safety cap
  // at 10000 to prevent a runaway loop if someone hands the engine an
  // absurd XP gain — that's already ~lvl 1000 + 9000×1.10^n which is
  // effectively unreachable; the bound only guards against a pathological
  // input rather than a real player.
  const HARD_SAFETY_CAP = 10_000;
  while (xp >= xpToNextLevel(level) && level < HARD_SAFETY_CAP) {
    xp -= xpToNextLevel(level);
    level++;
    levelsGained++;
    statPointsGained += statPointsForLevelUp();
  }

  return { newLevel: level, remainingXp: xp, levelsGained, statPointsGained };
};

// -- Death penalty -------------------------------------------------------------
// Player-spec'd (2026-05): the curve is now flat-percentage, not a tier
// table. Death takes 2% of current level + 50% of every skill's trained
// XP. Examples:
//   Level 1   -> 0 levels lost (floor below 1 -> keeps you at 1)
//   Level 50  -> 1 level lost  (50  × 0.02 = 1.0)
//   Level 100 -> 2 levels lost (100 × 0.02 = 2.0)
//   Level 500 -> 10 levels lost
//   Level 1000 -> 20 levels lost (the spec's anchor — "20 lvls at 1000")
//
// Skill XP: every trained skill drops by 50% of its banked XP. So a skill
// trained to half of level 50 ends up at ~level 25's worth — meaningful
// pain but never wipes a skill back to zero.
//
// Attributes from past level-ups are NOT removed (idempotent via
// highest_level): the penalty only resets the XP CURRENT-level pointer and
// strips a few levels from the bar.

export interface IDeathPenaltyResult {
    newLevel: number;
    newXp: number;
    xpPercent: number;
    levelsLost: number;
    skillXpLossPercent: number;
}

/** Death takes 25% of every trained skill's banked XP (flat, level-independent). */
const DEATH_SKILL_XP_LOSS_PCT = 25;
/** Flee takes 2.5% of every trained skill's banked XP (10% of the death cut). */
const FLEE_SKILL_XP_LOSS_PCT = 2.5;

/**
 * 2026-06-21 spec — death penalty in "levels' worth of XP", applied as a
 * CONTINUOUS reduction (so it can drop you below your current level even at
 * 0% XP). Floor of 0.20 levels keeps low-level deaths stinging.
 *   - lvl 1   -> 0.20  (≈20% of current-level XP)
 *   - lvl 41  -> 0.41  (a lvl-41/0% death drops to lvl 40)
 *   - lvl 100 -> 1     (1 level)
 *   - lvl 200 -> 2 · lvl 1000 -> 10
 */
export const getDeathLossLevels = (level: number): number =>
    Math.max(0.20, level / 100);

/** Flee penalty = 10% of the death penalty (lvl 1000 → 1 level). Never loses items. */
export const getFleeLossLevels = (level: number): number =>
    getDeathLossLevels(level) * 0.10;

/**
 * Item-loss grace period (2026-06-24 owner request): characters at or below this
 * level NEVER lose items on death. The level / XP / skill-XP penalty STILL
 * applies — only the 5% item loss is skipped — so new players (lvl 1-50) don't
 * lose gear while learning the game.
 */
export const ITEM_LOSS_GRACE_MAX_LEVEL = 50;

/** True if a death at `level` risks item loss (only from level 51 upward). */
export const losesItemsOnDeath = (level: number): boolean =>
    level > ITEM_LOSS_GRACE_MAX_LEVEL;

/**
 * Apply a fractional `lossLevels` reduction to a (level, xp) position and
 * recompute the resulting level + remaining XP. Works on the continuous
 * "exact position" axis = level + (xp / xpToNextLevel(level)).
 */
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

/**
 * Flee penalty — pressing "Ucieknij" mid-fight (Boss / Dungeon / Transform /
 * Raid). 10% of the death penalty; equipment is NEVER lost on flee (the caller
 * enforces that). Returns the same shape as applyDeathPenalty so the overlay
 * can render a unified panel.
 */
export const applyFleePenalty = (
    currentLevel: number,
    currentXp: number,
): IDeathPenaltyResult =>
    applyLevelLoss(currentLevel, currentXp, getFleeLossLevels(currentLevel), FLEE_SKILL_XP_LOSS_PCT);

// -- Legacy death penalty (kept for backwards compat) -------------------------
export const applyDeathXpPenalty = (
    currentXp: number,
    currentLevel: number,
): number => {
    const penalty = Math.floor(xpToNextLevel(currentLevel) * 0.1);
    return Math.max(0, currentXp - penalty);
};

// -- XP progress within current level (0–1) -----------------------------------
export const xpProgress = (currentXp: number, currentLevel: number): number => {
  const needed = xpToNextLevel(currentLevel);
  return needed > 0 ? Math.min(1, currentXp / needed) : 0;
};

// -- HP & MP gained per level (from classes.json; used in level-up reward) ----
// Returns base level gains for each class (fallback if class data not loaded)
export const BASE_HP_PER_LEVEL: Record<string, number> = {
  Knight: 8, Mage: 3, Cleric: 5, Archer: 4,
  Rogue: 4, Necromancer: 3, Bard: 4,
};

export const BASE_MP_PER_LEVEL: Record<string, number> = {
  Knight: 2, Mage: 8, Cleric: 6, Archer: 3,
  Rogue: 3, Necromancer: 9, Bard: 5,
};
