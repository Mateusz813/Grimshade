import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Mulberry32 } from '../../src/systems/rng/mulberry32';
import type { CharacterClass } from '../../src/api/v1/characterApi';
import {
    skillXpToNextLevel,
    skillXpPerHit,
    skillXpPerCast,
    MLVL_FROM_ATTACKS_CLASSES,
    mlvlXpPerAttack,
    mlvlXpPerSkillUse,
    doesClassGainMlvlFromAttacks,
    shieldingXpPerHit,
    getShieldingDefBonus,
    MAX_OFFLINE_TRAINING_SECONDS,
    OFFLINE_TRAINING_SPEED_MULTIPLIER,
    offlineXpRate,
    offlineXpRateForStat,
    calculateOfflineSkillXp,
    processSkillXp,
    applySkillDeathPenalty,
    getSkillDamageBonus,
    CLASS_WEAPON_SKILLS,
    CLASS_WEAPON_SKILL,
    getClassWeaponSkills,
    ALL_WEAPON_SKILL_IDS,
    GENERAL_TRAINABLE_STATS,
    getTrainableStatsForClass,
    ALL_TRAINABLE_STATS,
    getTrainingBonuses,
    skillXpProgress,
    getSkillUnlockCost,
    getSkillUpgradeCost,
    getSkillUpgradeBonus,
    getCombatSkillUpgradeMultiplier,
    SPELL_CHEST_LEVELS,
    getSpellChestUnlockCost,
    getSpellChestUpgradeCost,
    rollSkillUpgrade,
} from '../../src/systems/skillSystem';


const withSeed = <T>(seed: number, fn: () => T): T => {
    const rng = new Mulberry32(seed);
    const orig = Math.random;
    Math.random = () => rng.nextFloat();
    try {
        return fn();
    } finally {
        Math.random = orig;
    }
};

const CLASSES: CharacterClass[] = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'];

const SKILL_LEVELS = [-1, 0, 1, 2, 3, 5, 10, 25, 50, 99, 100, 101, 150, 500, 1000];
const MLVL_LEVELS = [-1, 0, 1, 2, 5, 10, 25, 50, 100, 500, 1000];

const OFFLINE_RATE_STAT_CASES: Array<[number, string]> = [
    [0, 'sword_fighting'], [10, 'sword_fighting'], [50, 'magic_level'],
    [5, 'max_hp'], [5, 'defense'], [5, 'hp_regen'], [5, 'crit_chance'],
    [5, 'attack_speed'], [100, 'attack_speed'], [3, 'unknown_stat'], [0, 'unknown_stat'],
];

const OFFLINE_CASES: Array<[number, number, string | null]> = [
    [0, 0, null], [3600, 0, null], [86400, 0, null],
    [3600, 5, 'sword_fighting'], [86400, 1, 'magic_level'], [90000, 10, 'crit_chance'],
    [100, 50, 'max_hp'], [86400, 100, 'attack_speed'], [60, 3, 'unknown_stat'],
    [1000000, 0, 'sword_fighting'], [30, 2, 'defense'],
];

const PROCESS_CASES: Array<[number, number, number]> = [
    [0, 0, 100], [1, 0, 349], [1, 0, 1000], [1, 50, 300], [5, 0, 100000],
    [10, 0, 6310], [50, 0, 500000], [99, 0, 400000], [100, 0, 1000000],
    [1, 0, 0], [0, 50, 60], [10, 100, 0],
];

const DEATH_CASES: Array<[number, number]> = [
    [0, 1], [50, 1], [100, 5], [1000, 10], [500, 50], [0, 100], [10000, 100], [3, 0],
];

const DAMAGE_BONUS_CASES: Array<[number, number]> = [
    [0, 0.05], [1, 0.05], [10, 0.06], [25, 0.07], [50, 0.08], [100, 0.04], [1000, 0.05], [-1, 0.05],
];

const PROGRESS_CASES: Array<[number, number]> = [
    [0, 1], [50, 1], [100, 1], [200, 2], [1000, 10], [0, 0], [50, 0], [500000, 1000],
];

const UNLOCK_LEVELS = [-1, 0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 100, 150, 300, 600, 800, 1000];
const UPGRADE_COST_TARGETS = [0, 1, 2, 3, 5, 7, 10, 11, 12, 15, 20, 30, 50];
const UPGRADE_LEVELS = [-1, 0, 1, 2, 5, 9, 10, 11, 15, 20, 30, 50];

const CHEST_UPGRADE_TARGETS = [0, 1, 2, 3, 5, 10, 11, 12, 15, 20];
const CHEST_UNLOCK_LEVELS = [5, 50, 1000];

const TRAINING_CASES: Array<{ levels: Record<string, number>; cls: CharacterClass | 'UnknownClass' | null }> = [
    { levels: {}, cls: null },
    {
        levels: {
            attack_speed: 10, max_hp: 5, max_mp: 3, hp_regen: 20,
            mp_regen: 15, defense: 7, crit_chance: 4, crit_dmg: 8,
        },
        cls: 'Knight',
    },
    {
        levels: { hp_regen: 12, mp_regen: 30, max_mp: 10, defense: 2 },
        cls: 'Mage',
    },
    {
        levels: { hp_regen: 50, mp_regen: 50, crit_chance: 100, crit_dmg: 25, attack_speed: 40 },
        cls: 'Necromancer',
    },
    {
        levels: { hp_regen: 10, mp_regen: 10 },
        cls: 'UnknownClass',
    },
    {
        levels: { hp_regen: 100, mp_regen: 100, defense: 33 },
        cls: null,
    },
];

const SEEDS = [1, 2, 3, 7, 13, 42, 99, 777];
const ROLL_TARGETS = [1, 3, 5, 10, 15];

const buildGolden = (): Record<string, unknown> => ({
    system: 'skillSystem',
    note: 'Generowane z src/systems/skillSystem.ts. Funkcja RNG: seed + mulberry32. NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1.',

    constants: {
        MLVL_FROM_ATTACKS_CLASSES,
        MAX_OFFLINE_TRAINING_SECONDS,
        OFFLINE_TRAINING_SPEED_MULTIPLIER,
        CLASS_WEAPON_SKILLS,
        CLASS_WEAPON_SKILL,
        ALL_WEAPON_SKILL_IDS,
        GENERAL_TRAINABLE_STATS,
        ALL_TRAINABLE_STATS,
        SPELL_CHEST_LEVELS,
    },

    skillXpToNextLevel: SKILL_LEVELS.map((level) => ({ level, value: skillXpToNextLevel(level) })),
    skillXpPerHit: SKILL_LEVELS.map((level) => ({ level, value: skillXpPerHit(level) })),
    skillXpPerCast: SKILL_LEVELS.map((level) => ({ level, value: skillXpPerCast(level) })),
    mlvlXpPerAttack: MLVL_LEVELS.map((mlvl) => ({ mlvl, value: mlvlXpPerAttack(mlvl) })),
    mlvlXpPerSkillUse: MLVL_LEVELS.flatMap((mlvl) =>
        CLASSES.map((cls) => ({ mlvl, class: cls, value: mlvlXpPerSkillUse(mlvl, cls) }))),
    doesClassGainMlvlFromAttacks: CLASSES.map((cls) => ({ class: cls, value: doesClassGainMlvlFromAttacks(cls) })),
    shieldingXpPerHit: SKILL_LEVELS.map((level) => ({ level, value: shieldingXpPerHit(level) })),
    getShieldingDefBonus: SKILL_LEVELS.map((level) => ({ level, value: getShieldingDefBonus(level) })),
    offlineXpRate: SKILL_LEVELS.map((level) => ({ level, value: offlineXpRate(level) })),
    offlineXpRateForStat: OFFLINE_RATE_STAT_CASES.map(([level, skillId]) => ({
        level, skillId, value: offlineXpRateForStat(level, skillId),
    })),
    calculateOfflineSkillXp: OFFLINE_CASES.map(([elapsedSeconds, skillLevel, skillId]) => ({
        elapsedSeconds, skillLevel, skillId,
        value: calculateOfflineSkillXp(elapsedSeconds, skillLevel, skillId ?? undefined),
    })),
    processSkillXp: PROCESS_CASES.map(([level, xp, gained]) => ({
        level, xp, gained, result: processSkillXp(level, xp, gained),
    })),
    applySkillDeathPenalty: DEATH_CASES.map(([xp, level]) => ({
        xp, level, value: applySkillDeathPenalty(xp, level),
    })),
    getSkillDamageBonus: DAMAGE_BONUS_CASES.map(([level, damageBonus]) => ({
        level, damageBonus, value: getSkillDamageBonus(level, damageBonus),
    })),
    getClassWeaponSkills: CLASSES.map((cls) => ({ class: cls, value: getClassWeaponSkills(cls) })),
    getTrainableStatsForClass: CLASSES.map((cls) => ({ class: cls, value: getTrainableStatsForClass(cls) })),
    getTrainingBonuses: TRAINING_CASES.map(({ levels, cls }) => ({
        levels, class: cls, value: getTrainingBonuses(levels, cls ?? undefined),
    })),
    skillXpProgress: PROGRESS_CASES.map(([xp, level]) => ({ xp, level, value: skillXpProgress(xp, level) })),
    getSkillUnlockCost: UNLOCK_LEVELS.map((level) => ({ level, value: getSkillUnlockCost(level) })),
    getSkillUpgradeCost: UPGRADE_COST_TARGETS.map((targetLevel) => ({
        targetLevel, result: getSkillUpgradeCost(targetLevel),
    })),
    getSkillUpgradeBonus: UPGRADE_LEVELS.map((level) => ({ level, value: getSkillUpgradeBonus(level) })),
    getCombatSkillUpgradeMultiplier: UPGRADE_LEVELS.map((level) => ({
        level, value: getCombatSkillUpgradeMultiplier(level),
    })),
    getSpellChestUnlockCost: UNLOCK_LEVELS.map((level) => ({ level, result: getSpellChestUnlockCost(level) })),
    getSpellChestUpgradeCost: CHEST_UPGRADE_TARGETS.flatMap((targetLevel) =>
        CHEST_UNLOCK_LEVELS.map((unlockLevel) => ({
            targetLevel, unlockLevel, result: getSpellChestUpgradeCost(targetLevel, unlockLevel),
        }))),

    rollSkillUpgrade: SEEDS.flatMap((seed) =>
        ROLL_TARGETS.map((targetLevel) => ({
            seed, targetLevel, value: withSeed(seed, () => rollSkillUpgrade(targetLevel)),
        }))),
});

const outPath = resolve(process.cwd(), 'golden/skillSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('skillSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current skillSystem output', () => {
        expect(existsSync(outPath), 'brak golden/skillSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
