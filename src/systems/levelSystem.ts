// ── XP Curve ──────────────────────────────────────────────────────────────────
//
// Targets (CLAUDE.md):
//   Lvl   1–50  : fast                  (100 → ~125 000 XP per level)
//   Lvl  51–200 : ~dozens of min/level
//   Lvl 201–1000: ≥1 level/day          at active play
//   Lvl 1000    : ≈6 months total
//
// Formula: 100 * level^1.6 (min 100) — steeper early, prevents power-leveling

export const xpToNextLevel = (level: number): number => {
  if (level <= 0) return 300;
  return Math.max(300, Math.floor(300 * Math.pow(level, 1.5)));
};

// ── Total XP from level 1 to reach `level` ────────────────────────────────────
export const totalXpForLevel = (level: number): number => {
  if (level <= 1) return 0;
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNextLevel(l);
  return total;
};

// ── Stat points awarded per level-up (fixed per class) ──────────────────────
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

// ── Process accumulated XP – may trigger multiple level-ups ──────────────────
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

  while (xp >= xpToNextLevel(level) && level < 1000) {
    xp -= xpToNextLevel(level);
    level++;
    levelsGained++;
    statPointsGained += statPointsForLevelUp();
  }

  return { newLevel: level, remainingXp: xp, levelsGained, statPointsGained };
};

// ── Death penalty ─────────────────────────────────────────────────────────────
// Scales heavily with level:
//   Level 1:       no loss
//   Level 2-10:    lose 1 level
//   Level 11-50:   lose ~2-4% of levels (1-2 levels at 50)
//   Level 51-200:  lose ~3-5% (3-10 levels)
//   Level 201-500: lose ~4-5% (8-25 levels)
//   Level 501-1000: lose ~5% (25-50 levels)
//
// Formula: levelsLost = max(1, floor(level * (0.03 + level * 0.00002)))
//
// Skill XP loss is much smaller (1-3%) — training is slow and grinding to
// recover skills should NOT take days of playtime.
//
// Attributes from level-ups are NOT removed (idempotent via highest_level).

export interface IDeathPenaltyResult {
    newLevel: number;
    newXp: number;
    xpPercent: number;
    levelsLost: number;
    skillXpLossPercent: number;
}

/**
 * Calculate how many levels are lost on death.
 * Scales from 1 level at low levels to ~5% of current level at 1000.
 */
const calculateLevelsLost = (level: number): number => {
    if (level <= 1) return 0;
    if (level <= 10) return 1;
    // Smooth curve: 3% base + tiny quadratic component
    // lvl 50:   50 * 0.031  =  1.55 → 1
    // lvl 100:  100 * 0.032 =  3.2  → 3
    // lvl 200:  200 * 0.034 =  6.8  → 6
    // lvl 500:  500 * 0.04  = 20.0  → 20
    // lvl 1000: 1000 * 0.05 = 50.0  → 50
    const pct = 0.03 + level * 0.00002;
    return Math.max(1, Math.floor(level * pct));
};

/**
 * Calculate skill XP loss percentage on death.
 * Much smaller than level loss — skills are slow to train.
 *   lvl 1-10:  1%
 *   lvl 50:    1.1%
 *   lvl 200:   1.4%
 *   lvl 500:   2.0%
 *   lvl 1000:  3.0%
 */
const calculateSkillXpLossPercent = (level: number): number => {
    return Math.min(3, 1 + level * 0.002);
};

export const applyDeathPenalty = (
    currentLevel: number,
    currentXp: number,
): IDeathPenaltyResult => {
    // Can't lose level at level 1
    if (currentLevel <= 1) {
        return {
            newLevel: 1,
            newXp: Math.max(0, Math.floor(currentXp * 0.5)),
            xpPercent: 50,
            levelsLost: 0,
            skillXpLossPercent: 1,
        };
    }

    const levelsLost = calculateLevelsLost(currentLevel);
    const newLevel = Math.max(1, currentLevel - levelsLost);

    // XP percent to keep on the new (lower) level – scales down with level.
    // Low-level deaths are forgiving; high-level deaths leave you at ~5% of the
    // new level's bar so recovering requires meaningful playtime.
    let xpPercent: number;
    if (currentLevel <= 5)        xpPercent = 75;
    else if (currentLevel <= 20)  xpPercent = 50;
    else if (currentLevel <= 50)  xpPercent = 30;
    else if (currentLevel <= 100) xpPercent = 15;
    else if (currentLevel <= 300) xpPercent = 10;
    else                          xpPercent = 5;

    const xpNeededForNewLevel = xpToNextLevel(newLevel);
    // Clamp to at most xpNeeded - 1 to ensure the bar never appears "full" without leveling
    const newXp = Math.min(
        Math.floor(xpNeededForNewLevel * (xpPercent / 100)),
        xpNeededForNewLevel - 1,
    );

    return {
        newLevel,
        newXp,
        xpPercent,
        levelsLost,
        skillXpLossPercent: calculateSkillXpLossPercent(currentLevel),
    };
};

// ── Legacy death penalty (kept for backwards compat) ─────────────────────────
export const applyDeathXpPenalty = (
    currentXp: number,
    currentLevel: number,
): number => {
    const penalty = Math.floor(xpToNextLevel(currentLevel) * 0.1);
    return Math.max(0, currentXp - penalty);
};

// ── XP progress within current level (0–1) ───────────────────────────────────
export const xpProgress = (currentXp: number, currentLevel: number): number => {
  const needed = xpToNextLevel(currentLevel);
  return needed > 0 ? Math.min(1, currentXp / needed) : 0;
};

// ── HP & MP gained per level (from classes.json; used in level-up reward) ────
// Returns base level gains for each class (fallback if class data not loaded)
export const BASE_HP_PER_LEVEL: Record<string, number> = {
  Knight: 8, Mage: 3, Cleric: 5, Archer: 4,
  Rogue: 4, Necromancer: 3, Bard: 4,
};

export const BASE_MP_PER_LEVEL: Record<string, number> = {
  Knight: 2, Mage: 8, Cleric: 6, Archer: 3,
  Rogue: 3, Necromancer: 9, Bard: 5,
};
