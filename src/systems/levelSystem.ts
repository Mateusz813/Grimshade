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

/**
 * Calculate how many levels are lost on death.
 *   formula: floor(level * 0.02)
 *   - lvl 1   -> 0
 *   - lvl 50  -> 1
 *   - lvl 100 -> 2
 *   - lvl 500 -> 10
 *   - lvl 1000 -> 20
 */
const calculateLevelsLost = (level: number): number => {
    if (level <= 1) return 0;
    return Math.max(0, Math.floor(level * 0.02));
};

/** Death always takes 50% of every trained skill's banked XP. */
const DEATH_SKILL_XP_LOSS_PCT = 50;

export const applyDeathPenalty = (
    currentLevel: number,
    currentXp: number,
): IDeathPenaltyResult => {
    // Lvl 1 — no level to strip. Keep the current XP pointer; the
    // skill-XP penalty still applies.
    if (currentLevel <= 1) {
        return {
            newLevel: 1,
            newXp: currentXp,
            xpPercent: Math.round((currentXp / Math.max(1, xpToNextLevel(1))) * 100),
            levelsLost: 0,
            skillXpLossPercent: DEATH_SKILL_XP_LOSS_PCT,
        };
    }

    const levelsLost = calculateLevelsLost(currentLevel);
    const newLevel = Math.max(1, currentLevel - levelsLost);

    // After a level strip, drop the XP pointer to the FRESH base of the
    // new lower level (player has to re-earn the levels they lost).
    return {
        newLevel,
        newXp: 0,
        xpPercent: 0,
        levelsLost,
        skillXpLossPercent: DEATH_SKILL_XP_LOSS_PCT,
    };
};

/**
 * Flee penalty — applied when the player presses "Ucieknij" mid-fight in
 * non-hunting combat (Boss / Dungeon / Transform / Raid). Equipment is
 * never lost. Per 2026-05 spec:
 *   - level loss: floor(level * 0.003)  -> 3 at lvl 1000, 0 below ~333
 *   - skill XP:   0.1% of every trained skill's banked XP
 *
 * Returns the SAME shape as `applyDeathPenalty` so the UI overlay can
 * render a unified "you lost X" panel for both flows — only the copy
 * ("Uciekłeś" vs "Zginąłeś") and the visual intensity differ.
 */
const FLEE_SKILL_XP_LOSS_PCT = 0.1;

export const applyFleePenalty = (
    currentLevel: number,
    currentXp: number,
): IDeathPenaltyResult => {
    // Lvl 1 — nothing to lose; keep XP and skip skill-XP drain too.
    if (currentLevel <= 1) {
        return { newLevel: 1, newXp: currentXp, xpPercent: 100, levelsLost: 0, skillXpLossPercent: 0 };
    }

    const levelsLost = Math.max(0, Math.floor(currentLevel * 0.003));
    const newLevel = Math.max(1, currentLevel - levelsLost);

    if (levelsLost === 0) {
        // No level lost (lvl < ~333) — keep the XP pointer; only skill-XP
        // hits.
        return {
            newLevel,
            newXp: currentXp,
            xpPercent: Math.round((currentXp / Math.max(1, xpToNextLevel(currentLevel))) * 100),
            levelsLost: 0,
            skillXpLossPercent: FLEE_SKILL_XP_LOSS_PCT,
        };
    }

    // Level was stripped — drop XP pointer to fresh start of the new
    // lower level (consistent with applyDeathPenalty).
    return {
        newLevel,
        newXp: 0,
        xpPercent: 0,
        levelsLost,
        skillXpLossPercent: FLEE_SKILL_XP_LOSS_PCT,
    };
};

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
