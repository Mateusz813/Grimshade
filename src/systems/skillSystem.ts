import type { CharacterClass } from '../api/v1/characterApi';

// ── Skill XP Curve ────────────────────────────────────────────────────────────
//
// Weapon / magic skills go from 0 to infinity (no level cap for offline training).
// Formula: ceil(100 * skillLevel^1.8) – harder at higher levels.

export const skillXpToNextLevel = (skillLevel: number): number => {
    if (skillLevel <= 0) return 100;
    return Math.ceil(100 * Math.pow(skillLevel, 1.8));
};

// ── XP gained per combat hit (weapon skills) ──────────────────────────────────
// Every hit grants XP base, reduced slightly at high skill levels.
export const skillXpPerHit = (skillLevel: number): number =>
    Math.max(1, Math.floor(10 / (1 + skillLevel * 0.05)));

// ── XP gained per spell cast (magic skills) ───────────────────────────────────
export const skillXpPerCast = (skillLevel: number): number =>
    Math.max(1, Math.floor(15 / (1 + skillLevel * 0.05)));

// ── MLVL XP from auto-attacks (magic classes only) ────────────────────────────
// Mage/Cleric/Necromancer gain MLVL from both attacks and skills.
// Knight/Archer/Rogue/Bard gain MLVL ONLY from skills, at 3x slower rate.

/** Classes that gain MLVL from auto-attacks */
export const MLVL_FROM_ATTACKS_CLASSES: CharacterClass[] = ['Mage', 'Cleric', 'Necromancer'];

/** MLVL XP gained per auto-attack (only for magic classes) */
export const mlvlXpPerAttack = (mlvl: number): number =>
    Math.max(1, Math.floor(8 / (1 + mlvl * 0.04)));

/** MLVL XP gained per skill use – magic classes get full rate, others get 1/3 */
export const mlvlXpPerSkillUse = (mlvl: number, characterClass: CharacterClass): number => {
    const base = Math.max(1, Math.floor(12 / (1 + mlvl * 0.04)));
    const isMagicClass = MLVL_FROM_ATTACKS_CLASSES.includes(characterClass);
    return isMagicClass ? base : Math.max(1, Math.floor(base / 3));
};

/** Check if a class gains MLVL from auto-attacks */
export const doesClassGainMlvlFromAttacks = (cls: CharacterClass): boolean =>
    MLVL_FROM_ATTACKS_CLASSES.includes(cls);

// ── Shielding skill (Knight) ──────────────────────────────────────────────────
// Separate skill from Sword Fighting. Grows passively when blocking in combat.
// Can also be trained offline (Knight chooses Sword Fighting OR Shielding).
// Effect: +0.5% block chance per level, +1 DEF per 2 levels.

/** Shielding XP gained per successful block in combat */
export const shieldingXpPerBlock = (shieldingLevel: number): number =>
    Math.max(1, Math.floor(15 / (1 + shieldingLevel * 0.06)));

/** DEF bonus from Shielding level */
export const getShieldingDefBonus = (shieldingLevel: number): number =>
    Math.floor(shieldingLevel / 2);

/** Block chance bonus from Shielding level (added to base 5%) */
export const getShieldingBlockBonus = (shieldingLevel: number): number =>
    shieldingLevel * 0.005; // +0.5% per level

// ── Offline training XP gain ──────────────────────────────────────────────────
// Rate is scaled by current skill level (higher level → slower offline gain).
// Max 24h of accumulated training.
// Powerful stats (hp_regen, crit_chance, crit_dmg, attack_speed) train MUCH slower.
export const MAX_OFFLINE_TRAINING_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Stat-specific speed multipliers for offline training.
 * Weapon/magic skills = 1.0 (baseline).
 * Powerful stats use much lower multipliers so they level very slowly.
 */
export const OFFLINE_TRAINING_SPEED_MULTIPLIER: Record<string, number> = {
    // Weapon / magic skills – baseline speed
    sword_fighting:    1.0,
    shielding:         1.0,
    distance_fighting: 1.0,
    dagger_fighting:   1.0,
    magic_level:       1.0,
    bard_level:        1.0,
    // General stats – slower
    max_hp:            0.6,
    max_mp:            0.6,
    defense:           0.5,
    // Very powerful stats – much slower
    mp_regen:          0.15,
    hp_regen:          0.15,
    crit_chance:       0.12,
    crit_dmg:          0.12,
    attack_speed:      0.1,
};

/** Base offline XP rate per second, decreasing with skill level */
export const offlineXpRate = (skillLevel: number): number =>
    Math.max(0.05, 2.0 / (1 + skillLevel * 0.1));

/** Offline XP rate per second for a specific stat, accounting for stat difficulty */
export const offlineXpRateForStat = (skillLevel: number, skillId: string): number => {
    const baseRate = offlineXpRate(skillLevel);
    const multiplier = OFFLINE_TRAINING_SPEED_MULTIPLIER[skillId] ?? 0.5;
    return baseRate * multiplier;
};

/**
 * Calculate offline XP earned, simulating level-ups during the training period.
 * This prevents players from getting a huge XP dump at low level that instantly
 * skips many levels – as you level up, the rate slows down mid-session.
 */
export const calculateOfflineSkillXp = (
    elapsedSeconds: number,
    skillLevel: number,
    skillId?: string,
): number => {
    // Cap at 24 hours
    const cappedSeconds = Math.min(elapsedSeconds, MAX_OFFLINE_TRAINING_SECONDS);

    if (!skillId) {
        // Legacy fallback: flat calculation without stat multiplier
        return Math.floor(cappedSeconds * offlineXpRate(skillLevel));
    }

    // Simulate second-by-second XP accumulation with level-ups
    // For performance, simulate in chunks of 60 seconds
    const CHUNK_SIZE = 60;
    let currentLevel = skillLevel;
    let currentXp = 0; // XP towards next level (we don't know starting XP, so we count gained XP)
    let totalXpGained = 0;
    let remainingSeconds = cappedSeconds;

    while (remainingSeconds > 0) {
        const chunk = Math.min(remainingSeconds, CHUNK_SIZE);
        const rate = offlineXpRateForStat(currentLevel, skillId);
        const xpThisChunk = chunk * rate;
        totalXpGained += xpThisChunk;
        currentXp += xpThisChunk;
        remainingSeconds -= chunk;

        // Check for level-up (use current level's XP requirement)
        // This is approximate – we don't know the player's starting XP in the level
        const needed = skillXpToNextLevel(currentLevel);
        while (currentXp >= needed) {
            currentXp -= needed;
            currentLevel++;
        }
    }

    return Math.floor(totalXpGained);
};

// ── Process skill XP – may trigger multiple level-ups ────────────────────────
export interface ISkillUpResult {
    newLevel: number;
    remainingXp: number;
    levelsGained: number;
}

export const processSkillXp = (
    currentLevel: number,
    currentXp: number,
    xpGained: number,
): ISkillUpResult => {
    let level = currentLevel;
    let xp = currentXp + xpGained;
    let levelsGained = 0;

    while (xp >= skillXpToNextLevel(level)) {
        xp -= skillXpToNextLevel(level);
        level++;
        levelsGained++;
    }

    return { newLevel: level, remainingXp: xp, levelsGained };
};

// ── Skill death penalty: –5% of current skill level XP ───────────────────────
export const applySkillDeathPenalty = (
    currentXp: number,
    skillLevel: number,
): number => {
    const penalty = Math.floor(skillXpToNextLevel(skillLevel) * 0.05);
    return Math.max(0, currentXp - penalty);
};

// ── Damage bonus from skill level ─────────────────────────────────────────────
// damageBonus per level is stored in skills.json (e.g. 0.05 = 5% per level)
export const getSkillDamageBonus = (
    skillLevel: number,
    damageBonus: number,
): number => skillLevel * damageBonus;

// ── Which weapon skill IDs map to each class ─────────────────────────────────
export const CLASS_WEAPON_SKILLS: Record<CharacterClass, string[]> = {
    Knight:      ['sword_fighting', 'shielding'],
    Mage:        ['magic_level'],
    Cleric:      ['magic_level'],
    Archer:      ['distance_fighting'],
    Rogue:       ['dagger_fighting'],
    Necromancer: ['magic_level'],
    Bard:        ['bard_level'],
};

/** Single primary weapon skill ID for a given class */
export const CLASS_WEAPON_SKILL: Record<CharacterClass, string> = {
    Knight:      'sword_fighting',
    Mage:        'magic_level',
    Cleric:      'magic_level',
    Archer:      'distance_fighting',
    Rogue:       'dagger_fighting',
    Necromancer: 'magic_level',
    Bard:        'bard_level',
};

export const getClassWeaponSkills = (cls: CharacterClass): string[] =>
    CLASS_WEAPON_SKILLS[cls] ?? [];

// ── Offline training skill labels ─────────────────────────────────────────────
export const SKILL_NAMES_PL: Record<string, string> = {
    sword_fighting:   'Walka Mieczem',
    shielding:        'Obrona Tarczą',
    distance_fighting:'Walka Dystansowa',
    dagger_fighting:  'Walka Sztyletem',
    magic_level:      'Poziom Magii',
    bard_level:       'Poziom Barda',
    // Trainable stats
    attack_speed:     'Prędkość Ataku',
    max_hp:           'Maksymalne HP',
    max_mp:           'Maksymalne MP',
    hp_regen:         'Regeneracja HP',
    mp_regen:         'Regeneracja MP',
    defense:          'Obrona',
    crit_chance:      'Szansa na Kryt',
    crit_dmg:         'Obrażenia Krytyczne',
};

// ── All trainable skill/stat IDs ──────────────────────────────────────────────
/** All weapon skill IDs (class-specific, one per class) */
export const ALL_WEAPON_SKILL_IDS: string[] = [
    'sword_fighting', 'shielding', 'distance_fighting', 'dagger_fighting', 'magic_level', 'bard_level',
];

/** General trainable stats available to ALL classes */
export const GENERAL_TRAINABLE_STATS: string[] = [
    'attack_speed', 'max_hp', 'max_mp', 'hp_regen', 'mp_regen',
    'defense', 'crit_chance', 'crit_dmg',
];

/** Get trainable stats for a specific class: class weapon skills + general stats */
export const getTrainableStatsForClass = (cls: CharacterClass): string[] => {
    const weaponSkills = CLASS_WEAPON_SKILLS[cls];
    return [...weaponSkills, ...GENERAL_TRAINABLE_STATS];
};

/** @deprecated Use getTrainableStatsForClass instead */
export const ALL_TRAINABLE_STATS: string[] = [
    ...ALL_WEAPON_SKILL_IDS,
    ...GENERAL_TRAINABLE_STATS,
];

// ── Training stat bonuses (applied to effective character stats) ──────────────
// These bonuses are computed from the trained skill levels (stored in skillStore).

export interface ITrainingBonuses {
    attack_speed: number;   // +0.1 per level
    max_hp: number;         // +5 per level
    max_mp: number;         // +5 per level
    hp_regen: number;       // +0.1 per level (HP/s)
    mp_regen: number;       // +0.1 per level (MP/s, flat)
    defense: number;        // +1 per level
    crit_chance: number;    // +0.5% per level (as fraction, e.g. 0.005)
    crit_dmg: number;       // +0.02 per level (as multiplier addition)
}

/**
 * Per-class multipliers for HP/MP regen training.
 * Knight gets the most HP regen per level, Mage/Cleric/Necro get the most MP regen.
 */
const CLASS_HP_REGEN_RATE: Record<string, number> = {
    Knight:      0.20,   // +0.20 HP/s per level — tank, highest HP regen
    Mage:        0.05,   // +0.05 HP/s per level — squishy
    Cleric:      0.15,   // +0.15 HP/s per level — healer, decent
    Archer:      0.10,   // +0.10 HP/s per level
    Rogue:       0.08,   // +0.08 HP/s per level
    Necromancer: 0.06,   // +0.06 HP/s per level — drain life compensates
    Bard:        0.12,   // +0.12 HP/s per level
};

const CLASS_MP_REGEN_RATE: Record<string, number> = {
    Knight:      0.05,   // +0.05 MP/s per level — barely uses MP
    Mage:        0.20,   // +0.20 MP/s per level — highest MP regen
    Cleric:      0.18,   // +0.18 MP/s per level — healer needs MP
    Archer:      0.08,   // +0.08 MP/s per level
    Rogue:       0.06,   // +0.06 MP/s per level
    Necromancer: 0.18,   // +0.18 MP/s per level — caster
    Bard:        0.15,   // +0.15 MP/s per level
};

/**
 * Compute effective stat bonuses from all trained general stats.
 * @param skillLevels - Map of skill/stat ID → trained level (from skillStore)
 * @param characterClass - optional class for class-specific regen rates
 */
export const getTrainingBonuses = (skillLevels: Record<string, number>, characterClass?: string): ITrainingBonuses => ({
    attack_speed: (skillLevels['attack_speed'] ?? 0) * 0.1,
    max_hp:       (skillLevels['max_hp'] ?? 0) * 5,
    max_mp:       (skillLevels['max_mp'] ?? 0) * 5,
    hp_regen:     (skillLevels['hp_regen'] ?? 0) * (characterClass ? (CLASS_HP_REGEN_RATE[characterClass] ?? 0.1) : 0.1),
    mp_regen:     (skillLevels['mp_regen'] ?? 0) * (characterClass ? (CLASS_MP_REGEN_RATE[characterClass] ?? 0.1) : 0.1),
    defense:      (skillLevels['defense'] ?? 0),
    crit_chance:  (skillLevels['crit_chance'] ?? 0) * 0.005,
    crit_dmg:     (skillLevels['crit_dmg'] ?? 0) * 0.02,
});

// ── XP progress fraction within current skill level (0–1) ────────────────────
export const skillXpProgress = (currentXp: number, skillLevel: number): number => {
    const needed = skillXpToNextLevel(skillLevel);
    return needed > 0 ? Math.min(1, currentXp / needed) : 0;
};

// ── Skill Unlock Cost ────────────────────────────────────────────────────────
// Skills cost gold to unlock, scaling heavily with unlock level.
// Formula: 500 * unlockLevel^1.8

/**
 * Calculate the gold cost to unlock (purchase) an active skill.
 * @param unlockLevel - The character level at which the skill becomes available.
 */
export const getSkillUnlockCost = (unlockLevel: number): number => {
    if (unlockLevel <= 0) return 100;
    return Math.floor(100 * Math.pow(unlockLevel, 1.8));
};

// ── Active Skill Upgrade System ──────────────────────────────────────────────
// Players can upgrade active skills for gold. Each + gives +8% DMG/Heal.
// Fail = ONLY gold loss (safe upgrade, skill doesn't lose level).
// Practically +1 to +10, beyond +10 is ultra hard but theoretically infinite.

export interface ISkillUpgradeCost {
    gold: number;
    successRate: number;
}

/** Success rate table for skill upgrades */
const UPGRADE_SUCCESS_RATES: Record<number, number> = {
    1:  100,
    2:  90,
    3:  75,
    4:  60,
    5:  45,
    6:  30,
    7:  20,
    8:  15,
    9:  10,
    10: 3,
};

/**
 * Get upgrade cost and success rate for a given target upgrade level.
 * Cost formula: 200 * (targetLevel)^2.2
 * @param targetLevel - The upgrade level to reach (1 for +0 -> +1, etc.)
 */
export const getSkillUpgradeCost = (targetLevel: number): ISkillUpgradeCost => {
    const gold = Math.floor(200 * Math.pow(targetLevel, 2.2));

    if (targetLevel <= 10) {
        const successRate = UPGRADE_SUCCESS_RATES[targetLevel] ?? 100;
        return { gold, successRate };
    }

    // Beyond +10: success * 0.5 per level above 10 (min 0.1%)
    const levelsAbove10 = targetLevel - 10;
    return {
        gold,
        successRate: Math.max(0.1, 3 * Math.pow(0.5, levelsAbove10)),
    };
};

/**
 * Damage/Heal bonus per skill upgrade level (returned as additive multiplier, so +1.15 means +115%).
 * Matches the item enhancement curve so upgrades feel meaningful:
 *   +1 → +15%   +5 → +101%   +10 → +305%   +15 → +494%   +20 → +774%
 * Levels 1-10 use 1.15^level; levels 11+ continue at 1.08^(level-10) on top.
 */
export const getSkillUpgradeBonus = (upgradeLevel: number): number => {
    if (upgradeLevel <= 0) return 0;
    const mult = upgradeLevel <= 10
        ? Math.pow(1.15, upgradeLevel)
        : Math.pow(1.15, 10) * Math.pow(1.08, upgradeLevel - 10);
    return mult - 1;
};

// ── Spell Chest System ──────────────────────────────────────────────────────
// Spell chests are consumable items required to unlock and upgrade active skills.
// They drop from monsters level 5+ and stack in inventory.

/** All skill unlock levels used in the game (sorted ascending) */
export const SPELL_CHEST_LEVELS: number[] = [5, 10, 20, 30, 40, 50, 60, 70, 80, 100, 150, 300, 600, 800, 1000];

export interface ISpellChestUnlockCost {
    chests: number;
    chestLevel: number;
    gold: number;
}

/**
 * Calculate the spell chest + gold cost to unlock (purchase) an active skill.
 * Requires 1 spell chest of the skill's unlock level + reduced gold (1/5 of old cost).
 */
export const getSpellChestUnlockCost = (unlockLevel: number): ISpellChestUnlockCost => {
    const gold = Math.floor(getSkillUnlockCost(unlockLevel) / 5);
    return { chests: 1, chestLevel: unlockLevel, gold };
};

export interface ISpellChestUpgradeCost {
    chests: number;
    chestLevel: number;
    gold: number;
    successRate: number;
}

/** Spell chest upgrade cost table */
const SPELL_CHEST_UPGRADE_TABLE: Record<number, { chests: number; gold: number; successRate: number }> = {
    1:  { chests: 1,  gold: 100,     successRate: 100 },
    2:  { chests: 1,  gold: 500,     successRate: 90 },
    3:  { chests: 2,  gold: 1500,    successRate: 75 },
    4:  { chests: 3,  gold: 5000,    successRate: 60 },
    5:  { chests: 4,  gold: 15000,   successRate: 45 },
    6:  { chests: 5,  gold: 50000,   successRate: 30 },
    7:  { chests: 7,  gold: 150000,  successRate: 20 },
    8:  { chests: 10, gold: 500000,  successRate: 15 },
    9:  { chests: 15, gold: 1500000, successRate: 10 },
    10: { chests: 20, gold: 5000000, successRate: 5 },
};

/**
 * Get spell chest upgrade cost and success rate for a given target upgrade level.
 * The chestLevel is the unlockLevel of the skill being upgraded.
 */
export const getSpellChestUpgradeCost = (targetLevel: number, skillUnlockLevel: number): ISpellChestUpgradeCost => {
    if (targetLevel <= 10) {
        const entry = SPELL_CHEST_UPGRADE_TABLE[targetLevel] ?? { chests: 20, gold: 5000000, successRate: 5 };
        return { chests: entry.chests, chestLevel: skillUnlockLevel, gold: entry.gold, successRate: entry.successRate };
    }

    // Beyond +10: chests*2, gold*2, success*0.5 per level above 10 (min 0.1%)
    const levelsAbove10 = targetLevel - 10;
    const baseChests = 20;
    const baseGold = 5000000;
    const baseSuccess = 5;
    return {
        chests: Math.floor(baseChests * Math.pow(2, levelsAbove10)),
        chestLevel: skillUnlockLevel,
        gold: Math.floor(baseGold * Math.pow(2, levelsAbove10)),
        successRate: Math.max(0.1, baseSuccess * Math.pow(0.5, levelsAbove10)),
    };
};

/** Attempt to upgrade a skill. Returns true if successful. */
export const rollSkillUpgrade = (targetLevel: number): boolean => {
    const { successRate } = getSkillUpgradeCost(targetLevel);
    return Math.random() * 100 < successRate;
};
