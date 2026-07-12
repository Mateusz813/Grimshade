import type { CharacterClass } from '../api/v1/characterApi';


export const skillXpToNextLevel = (skillLevel: number): number => {
    if (skillLevel <= 0) return 100;
    return Math.ceil(100 * Math.pow(skillLevel, 1.8));
};

export const skillXpPerHit = (skillLevel: number): number =>
    Math.max(1, Math.floor(10 / (1 + skillLevel * 0.05)));

export const skillXpPerCast = (skillLevel: number): number =>
    Math.max(1, Math.floor(15 / (1 + skillLevel * 0.05)));


export const MLVL_FROM_ATTACKS_CLASSES: CharacterClass[] = ['Mage', 'Cleric', 'Necromancer'];

export const mlvlXpPerAttack = (mlvl: number): number =>
    Math.max(1, Math.floor(8 / (1 + mlvl * 0.04)));

export const mlvlXpPerSkillUse = (mlvl: number, characterClass: CharacterClass): number => {
    const base = Math.max(1, Math.floor(12 / (1 + mlvl * 0.04)));
    const isMagicClass = MLVL_FROM_ATTACKS_CLASSES.includes(characterClass);
    return isMagicClass ? base : Math.max(1, Math.floor(base / 3));
};

export const doesClassGainMlvlFromAttacks = (cls: CharacterClass): boolean =>
    MLVL_FROM_ATTACKS_CLASSES.includes(cls);


export const shieldingXpPerBlock = (shieldingLevel: number): number =>
    Math.max(1, Math.floor(15 / (1 + shieldingLevel * 0.06)));

export const getShieldingDefBonus = (shieldingLevel: number): number =>
    Math.floor(shieldingLevel / 2);

export const getShieldingBlockBonus = (shieldingLevel: number): number =>
    shieldingLevel * 0.005;

export const MAX_OFFLINE_TRAINING_SECONDS = 24 * 60 * 60;

export const OFFLINE_TRAINING_SPEED_MULTIPLIER: Record<string, number> = {
    sword_fighting:    1.0,
    shielding:         1.0,
    distance_fighting: 1.0,
    dagger_fighting:   1.0,
    magic_level:       1.0,
    bard_level:        1.0,
    max_hp:            0.6,
    max_mp:            0.6,
    defense:           0.5,
    mp_regen:          0.15,
    hp_regen:          0.15,
    crit_chance:       0.12,
    crit_dmg:          0.12,
    attack_speed:      0.1,
};

export const offlineXpRate = (skillLevel: number): number =>
    Math.max(0.05, 2.0 / (1 + skillLevel * 0.1));

export const offlineXpRateForStat = (skillLevel: number, skillId: string): number => {
    const baseRate = offlineXpRate(skillLevel);
    const multiplier = OFFLINE_TRAINING_SPEED_MULTIPLIER[skillId] ?? 0.5;
    return baseRate * multiplier;
};

export const calculateOfflineSkillXp = (
    elapsedSeconds: number,
    skillLevel: number,
    skillId?: string,
): number => {
    const cappedSeconds = Math.min(elapsedSeconds, MAX_OFFLINE_TRAINING_SECONDS);

    if (!skillId) {
        return Math.floor(cappedSeconds * offlineXpRate(skillLevel));
    }

    const CHUNK_SIZE = 60;
    let currentLevel = skillLevel;
    let currentXp = 0;
    let totalXpGained = 0;
    let remainingSeconds = cappedSeconds;

    while (remainingSeconds > 0) {
        const chunk = Math.min(remainingSeconds, CHUNK_SIZE);
        const rate = offlineXpRateForStat(currentLevel, skillId);
        const xpThisChunk = chunk * rate;
        totalXpGained += xpThisChunk;
        currentXp += xpThisChunk;
        remainingSeconds -= chunk;

        const needed = skillXpToNextLevel(currentLevel);
        while (currentXp >= needed) {
            currentXp -= needed;
            currentLevel++;
        }
    }

    return Math.floor(totalXpGained);
};

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

export const applySkillDeathPenalty = (
    currentXp: number,
    skillLevel: number,
): number => {
    const penalty = Math.floor(skillXpToNextLevel(skillLevel) * 0.05);
    return Math.max(0, currentXp - penalty);
};

export const getSkillDamageBonus = (
    skillLevel: number,
    damageBonus: number,
): number => skillLevel * damageBonus;

export const CLASS_WEAPON_SKILLS: Record<CharacterClass, string[]> = {
    Knight:      ['sword_fighting', 'shielding'],
    Mage:        ['magic_level'],
    Cleric:      ['magic_level'],
    Archer:      ['distance_fighting'],
    Rogue:       ['dagger_fighting'],
    Necromancer: ['magic_level'],
    Bard:        ['bard_level'],
};

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

export const SKILL_NAMES_PL: Record<string, string> = {
    sword_fighting:   'Walka Mieczem',
    shielding:        'Obrona Tarczą',
    distance_fighting:'Walka Dystansowa',
    dagger_fighting:  'Walka Sztyletem',
    magic_level:      'Poziom Magii',
    bard_level:       'Poziom Barda',
    attack_speed:     'Prędkość Ataku',
    max_hp:           'Maksymalne HP',
    max_mp:           'Maksymalne MP',
    hp_regen:         'Regeneracja HP',
    mp_regen:         'Regeneracja MP',
    defense:          'Obrona',
    crit_chance:      'Szansa na Kryt',
    crit_dmg:         'Obrażenia Krytyczne',
};

export const ALL_WEAPON_SKILL_IDS: string[] = [
    'sword_fighting', 'shielding', 'distance_fighting', 'dagger_fighting', 'magic_level', 'bard_level',
];

export const GENERAL_TRAINABLE_STATS: string[] = [
    'attack_speed', 'max_hp', 'max_mp', 'hp_regen', 'mp_regen',
    'defense', 'crit_chance', 'crit_dmg',
];

export const getTrainableStatsForClass = (cls: CharacterClass): string[] => {
    const weaponSkills = CLASS_WEAPON_SKILLS[cls];
    return [...weaponSkills, ...GENERAL_TRAINABLE_STATS];
};

export const ALL_TRAINABLE_STATS: string[] = [
    ...ALL_WEAPON_SKILL_IDS,
    ...GENERAL_TRAINABLE_STATS,
];


export interface ITrainingBonuses {
    attack_speed: number;
    max_hp: number;
    max_mp: number;
    hp_regen: number;
    mp_regen: number;
    defense: number;
    crit_chance: number;
    crit_dmg: number;
}

const CLASS_HP_REGEN_RATE: Record<string, number> = {
    Knight:      0.20,
    Mage:        0.05,
    Cleric:      0.15,
    Archer:      0.10,
    Rogue:       0.08,
    Necromancer: 0.06,
    Bard:        0.12,
};

const CLASS_MP_REGEN_RATE: Record<string, number> = {
    Knight:      0.05,
    Mage:        0.20,
    Cleric:      0.18,
    Archer:      0.08,
    Rogue:       0.06,
    Necromancer: 0.18,
    Bard:        0.15,
};

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

export const skillXpProgress = (currentXp: number, skillLevel: number): number => {
    const needed = skillXpToNextLevel(skillLevel);
    return needed > 0 ? Math.min(1, currentXp / needed) : 0;
};


export const getSkillUnlockCost = (unlockLevel: number): number => {
    if (unlockLevel <= 0) return 100;
    return Math.floor(100 * Math.pow(unlockLevel, 1.8));
};


export interface ISkillUpgradeCost {
    gold: number;
    successRate: number;
}

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

export const getSkillUpgradeCost = (targetLevel: number): ISkillUpgradeCost => {
    const gold = Math.floor(200 * Math.pow(targetLevel, 2.2));

    if (targetLevel <= 10) {
        const successRate = UPGRADE_SUCCESS_RATES[targetLevel] ?? 100;
        return { gold, successRate };
    }

    const levelsAbove10 = targetLevel - 10;
    return {
        gold,
        successRate: Math.max(0.1, 3 * Math.pow(0.5, levelsAbove10)),
    };
};

export const getSkillUpgradeBonus = (upgradeLevel: number): number => {
    if (upgradeLevel <= 0) return 0;
    const mult = upgradeLevel <= 10
        ? Math.pow(1.15, upgradeLevel)
        : Math.pow(1.15, 10) * Math.pow(1.08, upgradeLevel - 10);
    return mult - 1;
};

export const getCombatSkillUpgradeMultiplier = (upgradeLevel: number): number =>
    upgradeLevel <= 0
        ? 1
        : 1 + Math.min(upgradeLevel, 10) * 0.02 + Math.max(0, upgradeLevel - 10) * 0.01;


export const SPELL_CHEST_LEVELS: number[] = [5, 10, 20, 30, 40, 50, 60, 70, 80, 100, 150, 300, 600, 800, 1000];

export interface ISpellChestUnlockCost {
    chests: number;
    chestLevel: number;
    gold: number;
}

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

export const getSpellChestUpgradeCost = (targetLevel: number, skillUnlockLevel: number): ISpellChestUpgradeCost => {
    if (targetLevel <= 10) {
        const entry = SPELL_CHEST_UPGRADE_TABLE[targetLevel] ?? { chests: 20, gold: 5000000, successRate: 5 };
        return { chests: entry.chests, chestLevel: skillUnlockLevel, gold: entry.gold, successRate: entry.successRate };
    }

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

export const rollSkillUpgrade = (targetLevel: number): boolean => {
    const { successRate } = getSkillUpgradeCost(targetLevel);
    return Math.random() * 100 < successRate;
};
