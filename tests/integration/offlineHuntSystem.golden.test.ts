import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Mulberry32 } from '../../src/systems/rng/mulberry32';
import {
    OFFLINE_HUNT_BASE_SECONDS_PER_KILL,
    OFFLINE_HUNT_MAX_SECONDS,
    getOfflineHuntSpeedMultiplier,
} from '../../src/stores/offlineHuntStore';
import { getMasteryXpMultiplier, getMasteryGoldMultiplier } from '../../src/stores/masteryStore';
import { calculateOfflineSkillXp } from '../../src/systems/skillSystem';
import {
    MONSTER_RARITY_TASK_KILLS,
    rollMonsterRarity,
    type TMonsterRarity,
    type IMasteryRarityBonuses,
} from '../../src/systems/lootSystem';


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

const RARITY_XP_MULT: Record<TMonsterRarity, number> = {
    normal: 1,
    strong: 1.5,
    epic: 2.5,
    legendary: 4,
    boss: 8,
};
const RARITY_GOLD_MULT: Record<TMonsterRarity, number> = {
    normal: 1,
    strong: 1.5,
    epic: 2.5,
    legendary: 4,
    boss: 8,
};

const RARITIES: TMonsterRarity[] = ['normal', 'strong', 'epic', 'legendary', 'boss'];

type TKillsByRarity = Record<TMonsterRarity, number>;

const emptyKillsByRarity = (): TKillsByRarity => ({
    normal: 0, strong: 0, epic: 0, legendary: 0, boss: 0,
});


interface IPreviewInput {
    nowMs: number;
    startedAtMs: number;
    masteryLevel: number;
    monsterXp: number;
    goldMin: number;
    goldMax: number;
    skillLevel: number;
    trainedSkillId: string;
    xpBuffMult: number;
    premiumXpMult: number;
    skillXpBoostMult: number;
    offlineTrainingBoostMult: number;
}

interface IPreviewResult {
    elapsedSeconds: number;
    cappedSeconds: number;
    kills: number;
    xpGained: number;
    goldGained: number;
    skillXpGained: number;
    speedMultiplier: number;
}

const computePreview = (i: IPreviewInput): IPreviewResult => {
    const elapsedSeconds = Math.max(0, Math.floor((i.nowMs - i.startedAtMs) / 1000));
    const cappedSeconds = Math.min(elapsedSeconds, OFFLINE_HUNT_MAX_SECONDS);

    const speedMultiplier = getOfflineHuntSpeedMultiplier(i.masteryLevel);
    const killsPerSecond = speedMultiplier / OFFLINE_HUNT_BASE_SECONDS_PER_KILL;
    const kills = Math.floor(cappedSeconds * killsPerSecond);

    const masteryXpMult = getMasteryXpMultiplier(i.masteryLevel);
    const masteryGoldMult = getMasteryGoldMultiplier(i.masteryLevel);

    const totalXpMult = i.xpBuffMult * i.premiumXpMult * masteryXpMult;
    const xpPerKill = Math.floor(i.monsterXp * totalXpMult);
    const xpGained = kills * xpPerKill;

    const goldPerKill = Math.floor(((i.goldMin + i.goldMax) / 2) * masteryGoldMult);
    const goldGained = kills * goldPerKill;

    const skillXpBaseRaw = calculateOfflineSkillXp(cappedSeconds, i.skillLevel, i.trainedSkillId);
    const skillXpMult = i.skillXpBoostMult * i.offlineTrainingBoostMult * i.premiumXpMult;
    const skillXpGained = Math.floor(skillXpBaseRaw * skillXpMult);

    return { elapsedSeconds, cappedSeconds, kills, xpGained, goldGained, skillXpGained, speedMultiplier };
};


interface IAggregateInput {
    monsterXp: number;
    goldMin: number;
    goldMax: number;
    masteryLevel: number;
    xpBuffMult: number;
    premiumXpMult: number;
    killsByRarity: TKillsByRarity;
}

const computeAggregate = (i: IAggregateInput): { xpGained: number; goldGained: number } => {
    const xpMult = i.xpBuffMult * i.premiumXpMult;
    const masteryXpMult = getMasteryXpMultiplier(i.masteryLevel);
    const masteryGoldMult = getMasteryGoldMultiplier(i.masteryLevel);
    const goldBase = Math.floor((i.goldMin + i.goldMax) / 2);

    let xpGained = 0;
    let goldGained = 0;
    for (const r of RARITIES) {
        const n = i.killsByRarity[r] ?? 0;
        const xpPerKill = Math.floor(i.monsterXp * (RARITY_XP_MULT[r] ?? 1) * xpMult * masteryXpMult);
        const goldPerKill = Math.floor(goldBase * (RARITY_GOLD_MULT[r] ?? 1) * masteryGoldMult);
        xpGained += n * xpPerKill;
        goldGained += n * goldPerKill;
    }
    return { xpGained, goldGained };
};


const computeWeightedTaskKills = (kbr: TKillsByRarity): number =>
    kbr.normal * (MONSTER_RARITY_TASK_KILLS.normal ?? 1) +
    kbr.strong * (MONSTER_RARITY_TASK_KILLS.strong ?? 1) +
    kbr.epic * (MONSTER_RARITY_TASK_KILLS.epic ?? 1) +
    kbr.legendary * (MONSTER_RARITY_TASK_KILLS.legendary ?? 1) +
    kbr.boss * (MONSTER_RARITY_TASK_KILLS.boss ?? 1);


const rollKillsByRarity = (kills: number, masteryBonuses?: IMasteryRarityBonuses): TKillsByRarity => {
    const kbr = emptyKillsByRarity();
    for (let k = 0; k < kills; k++) {
        kbr[rollMonsterRarity(false, masteryBonuses)]++;
    }
    return kbr;
};


const SEEDS = [1, 2, 3, 7, 13, 42, 99, 777];
const HEAVY_MASTERY: IMasteryRarityBonuses = { strong: 30, epic: 20, legendary: 10, mythic: 5, heroic: 0 };

const MS = 1_000_000;
const noBuff = { xpBuffMult: 1, premiumXpMult: 1, skillXpBoostMult: 1, offlineTrainingBoostMult: 1 };
const fullBuff = { xpBuffMult: 1.5, premiumXpMult: 2.0, skillXpBoostMult: 1.5, offlineTrainingBoostMult: 2.0 };

const PREVIEW_CASES: IPreviewInput[] = [
    { nowMs: MS, startedAtMs: MS, masteryLevel: 0, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 0, trainedSkillId: 'sword_fighting', ...noBuff },
    { nowMs: MS, startedAtMs: MS + 2000, masteryLevel: 0, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 0, trainedSkillId: 'sword_fighting', ...noBuff },
    { nowMs: MS + 100_000, startedAtMs: MS, masteryLevel: 0, monsterXp: 3, goldMin: 1, goldMax: 1, skillLevel: 0, trainedSkillId: 'sword_fighting', ...noBuff },
    { nowMs: MS + 1_000_000, startedAtMs: MS, masteryLevel: 5, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 10, trainedSkillId: 'sword_fighting', ...noBuff },
    { nowMs: MS + 3_600_000, startedAtMs: MS, masteryLevel: 12, monsterXp: 451, goldMin: 50, goldMax: 100, skillLevel: 25, trainedSkillId: 'magic_level', ...noBuff },
    { nowMs: MS + 43_200_000, startedAtMs: MS, masteryLevel: 20, monsterXp: 977, goldMin: 100, goldMax: 200, skillLevel: 50, trainedSkillId: 'distance_fighting', ...noBuff },
    { nowMs: MS + 50_000_000, startedAtMs: MS, masteryLevel: 25, monsterXp: 5981, goldMin: 500, goldMax: 1000, skillLevel: 100, trainedSkillId: 'magic_level', ...noBuff },
    { nowMs: MS + 100_000_000, startedAtMs: MS, masteryLevel: 25, monsterXp: 5981, goldMin: 500, goldMax: 1000, skillLevel: 1000, trainedSkillId: 'magic_level', ...noBuff },
    { nowMs: MS + 3_600_000, startedAtMs: MS, masteryLevel: 25, monsterXp: 451, goldMin: 50, goldMax: 100, skillLevel: 10, trainedSkillId: 'sword_fighting', ...fullBuff },
    { nowMs: MS + 3_600_000, startedAtMs: MS, masteryLevel: 0, monsterXp: 451, goldMin: 50, goldMax: 100, skillLevel: 10, trainedSkillId: 'sword_fighting', xpBuffMult: 1.5, premiumXpMult: 1, skillXpBoostMult: 1, offlineTrainingBoostMult: 1 },
    { nowMs: MS + 3_600_000, startedAtMs: MS, masteryLevel: 0, monsterXp: 451, goldMin: 50, goldMax: 100, skillLevel: 10, trainedSkillId: 'sword_fighting', xpBuffMult: 1, premiumXpMult: 2, skillXpBoostMult: 1, offlineTrainingBoostMult: 2 },
    { nowMs: MS + 600_000, startedAtMs: MS, masteryLevel: 0, monsterXp: 10, goldMin: 1, goldMax: 2, skillLevel: 3, trainedSkillId: 'sword_fighting', ...noBuff },
    { nowMs: MS + 600_000, startedAtMs: MS, masteryLevel: 25, monsterXp: 10, goldMin: 1, goldMax: 2, skillLevel: 3, trainedSkillId: 'sword_fighting', ...noBuff },
    { nowMs: MS + 600_000, startedAtMs: MS, masteryLevel: 10, monsterXp: 0, goldMin: 0, goldMax: 0, skillLevel: 5, trainedSkillId: 'sword_fighting', ...noBuff },
    { nowMs: MS + 7_200_000, startedAtMs: MS, masteryLevel: 5, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 0, trainedSkillId: 'crit_chance', ...noBuff },
    { nowMs: MS + 7_200_000, startedAtMs: MS, masteryLevel: 5, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 0, trainedSkillId: 'attack_speed', ...noBuff },
    { nowMs: MS + 7_200_000, startedAtMs: MS, masteryLevel: 5, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 20, trainedSkillId: 'defense', ...noBuff },
    { nowMs: MS + 7_200_000, startedAtMs: MS, masteryLevel: 5, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 20, trainedSkillId: 'unknown_stat', ...noBuff },
    { nowMs: MS + 500_000, startedAtMs: MS, masteryLevel: -3, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 5, trainedSkillId: 'sword_fighting', ...noBuff },
];

const AGGREGATE_CASES: IAggregateInput[] = [
    { monsterXp: 209, goldMin: 25, goldMax: 50, masteryLevel: 0, xpBuffMult: 1, premiumXpMult: 1, killsByRarity: emptyKillsByRarity() },
    { monsterXp: 209, goldMin: 25, goldMax: 50, masteryLevel: 0, xpBuffMult: 1, premiumXpMult: 1, killsByRarity: { normal: 100, strong: 0, epic: 0, legendary: 0, boss: 0 } },
    { monsterXp: 451, goldMin: 50, goldMax: 100, masteryLevel: 0, xpBuffMult: 1, premiumXpMult: 1, killsByRarity: { normal: 50, strong: 10, epic: 5, legendary: 2, boss: 1 } },
    { monsterXp: 977, goldMin: 100, goldMax: 200, masteryLevel: 0, xpBuffMult: 1, premiumXpMult: 1, killsByRarity: { normal: 0, strong: 0, epic: 0, legendary: 0, boss: 10 } },
    { monsterXp: 451, goldMin: 50, goldMax: 100, masteryLevel: 25, xpBuffMult: 1.5, premiumXpMult: 2.0, killsByRarity: { normal: 50, strong: 10, epic: 5, legendary: 2, boss: 1 } },
    { monsterXp: 3, goldMin: 1, goldMax: 1, masteryLevel: 0, xpBuffMult: 1, premiumXpMult: 1, killsByRarity: { normal: 500, strong: 20, epic: 5, legendary: 1, boss: 0 } },
    { monsterXp: 5981, goldMin: 500, goldMax: 1000, masteryLevel: 12, xpBuffMult: 1, premiumXpMult: 1, killsByRarity: { normal: 10, strong: 5, epic: 3, legendary: 2, boss: 1 } },
    { monsterXp: 10, goldMin: 1, goldMax: 2, masteryLevel: 0, xpBuffMult: 1, premiumXpMult: 1, killsByRarity: { normal: 7, strong: 3, epic: 0, legendary: 0, boss: 0 } },
    { monsterXp: 0, goldMin: 0, goldMax: 0, masteryLevel: 25, xpBuffMult: 1.5, premiumXpMult: 2.0, killsByRarity: { normal: 100, strong: 50, epic: 25, legendary: 10, boss: 5 } },
];

const WEIGHTED_CASES: TKillsByRarity[] = [
    emptyKillsByRarity(),
    { normal: 1, strong: 0, epic: 0, legendary: 0, boss: 0 },
    { normal: 0, strong: 1, epic: 0, legendary: 0, boss: 0 },
    { normal: 0, strong: 0, epic: 1, legendary: 0, boss: 0 },
    { normal: 0, strong: 0, epic: 0, legendary: 1, boss: 0 },
    { normal: 0, strong: 0, epic: 0, legendary: 0, boss: 1 },
    { normal: 100, strong: 10, epic: 5, legendary: 2, boss: 1 },
    { normal: 1234, strong: 56, epic: 7, legendary: 8, boss: 9 },
];

const SPEED_LEVELS = [-3, 0, 4, 5, 11, 12, 19, 20, 25, 100];

const buildGolden = (): Record<string, unknown> => ({
    system: 'offlineHuntSystem',
    note: 'Generowane z src/systems/offlineHuntSystem.ts (czysta logika liczbowa). NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1.',

    getOfflineHuntSpeedMultiplier: SPEED_LEVELS.map((masteryLevel) => ({
        masteryLevel, value: getOfflineHuntSpeedMultiplier(masteryLevel),
    })),

    preview: PREVIEW_CASES.map((input) => ({ input, result: computePreview(input) })),

    aggregateClaimRewards: AGGREGATE_CASES.map((input) => ({ input, result: computeAggregate(input) })),

    weightedTaskKills: WEIGHTED_CASES.map((killsByRarity) => ({
        killsByRarity, value: computeWeightedTaskKills(killsByRarity),
    })),

    rollKillsByRarity: SEEDS.flatMap((seed) => [
        { seed, kills: 0, mastery: null, value: withSeed(seed, () => rollKillsByRarity(0)) },
        { seed, kills: 1, mastery: null, value: withSeed(seed, () => rollKillsByRarity(1)) },
        { seed, kills: 10, mastery: null, value: withSeed(seed, () => rollKillsByRarity(10)) },
        { seed, kills: 100, mastery: null, value: withSeed(seed, () => rollKillsByRarity(100)) },
        { seed, kills: 100, mastery: HEAVY_MASTERY, value: withSeed(seed, () => rollKillsByRarity(100, HEAVY_MASTERY)) },
    ]),
});

const outPath = resolve(process.cwd(), 'golden/offlineHuntSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('offlineHuntSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current offlineHuntSystem output', () => {
        expect(existsSync(outPath), 'brak golden/offlineHuntSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
