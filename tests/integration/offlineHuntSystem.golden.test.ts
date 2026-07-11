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

// ============================================================================
// GOLDEN-VECTOR EXPORT + GUARD dla src/systems/offlineHuntSystem.ts.
//
// offlineHuntSystem żyje na store'ach (offlineHunt/mastery/buff/skill/…) i na
// Date.now(). Wrapper previewOfflineHunt/claimOfflineHunt (odczyt+mutacja
// store'ów, side-effekty addXp/addItem/… oraz Realtime/UI) jest POMINIĘTY
// (reguła 4/5). Portujemy CZYSTĄ logikę liczbową systemu, mirrorując
// offlineHuntSystem.ts 1:1, ale każdy nietrywialny podskładnik używa
// AUTORYTATYWNEJ, wyeksportowanej funkcji źródłowej:
//   - getOfflineHuntSpeedMultiplier (offlineHuntStore) — tempo zabójstw,
//   - getMasteryXp/GoldMultiplier    (masteryStore)     — bonus N7,
//   - calculateOfflineSkillXp        (skillSystem)      — krzywa skill-XP,
//   - rollMonsterRarity              (lootSystem)        — rzut rzadkości,
//   - MONSTER_RARITY_TASK_KILLS      (lootSystem)        — wagi tasków.
// Jedyne mirrory (module-private w źródle, więc niedostępne do importu):
// RARITY_XP_MULT / RARITY_GOLD_MULT — trzymane niżej z komentarzem; guard
// wiąże PHP z tymi wartościami.
//
// Czas parametryzowany (reguła 6): nowMs + startedAtMs zamiast Date.now().
//
// PARYTET RNG: rollKillsByRarity woła rollMonsterRarity N× w sekwencji —
// każde wywołanie konsumuje 1× Math.random, więc z tym samym seedem
// (mulberry32) PHP replay = bit-parity. UWAGA: żywy claim PRZEPLATA rzuty
// rzadkości z rzutami lootu (rollLoot używa sort-shuffle → nieportowalne),
// więc pełny rozkład killsByRarity w kliencie jest serwer-autorytatywny;
// tu golden dowodzi jedynie parytetu SAMEGO prymitywu rzadkości w agregacie.
//
// Regeneracja + kopia do backendu:
//   UPDATE_GOLDEN=1 npx vitest run tests/integration/offlineHuntSystem.golden.test.ts
//   cp golden/offlineHuntSystem.json ../grimshade-backend/tests/Golden/fixtures/
// ============================================================================

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

// Mirror module-private stałych z offlineHuntSystem.ts (niedostępne do importu).
// Rzadkość → mnożnik XP/Gold za zabójstwo (odzwierciedla żywy silnik walki).
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

// -- Preview (deterministyczne) ----------------------------------------------
// Mirror previewOfflineHunt() z pominięciem odczytów store'ów (wstrzyknięte
// jako jawne parametry) i Date.now() (nowMs/startedAtMs). Kolejność mnożeń
// float zachowana 1:1 dla bit-parity.

interface IPreviewInput {
    nowMs: number;
    startedAtMs: number;
    masteryLevel: number;
    monsterXp: number;
    goldMin: number;
    goldMax: number;
    skillLevel: number;
    trainedSkillId: string;
    xpBuffMult: number;      // getBuffMultiplier('xp_boost')
    premiumXpMult: number;   // getBuffMultiplier('premium_xp_boost')
    skillXpBoostMult: number;      // getBuffMultiplier('skill_xp_boost')
    offlineTrainingBoostMult: number; // getBuffMultiplier('offline_training_boost')
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

// -- Claim reward aggregation (deterministyczne przy danym killsByRarity) -----
// Mirror pętli claimOfflineHunt(): dla każdego zabójstwa danej rzadkości
// per-kill XP/Gold to STAŁA (floor). Suma N kopii = N * wartość (dokładna
// arytmetyka int), więc agregat = Σ killsByRarity[r] * perKillValue[r].
// UWAGA: preview mnoży (min+max)/2 BEZ wewnętrznego floor; claim floor'uje
// goldBase PRZED mnożeniem — świadomie różne, zachowane wiernie.

interface IAggregateInput {
    monsterXp: number;
    goldMin: number;
    goldMax: number;
    masteryLevel: number;
    xpBuffMult: number;      // getBuffMultiplier('xp_boost')
    premiumXpMult: number;   // getBuffMultiplier('premium_xp_boost')
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

// -- Weighted task kills (mirror claim) --------------------------------------

const computeWeightedTaskKills = (kbr: TKillsByRarity): number =>
    kbr.normal * (MONSTER_RARITY_TASK_KILLS.normal ?? 1) +
    kbr.strong * (MONSTER_RARITY_TASK_KILLS.strong ?? 1) +
    kbr.epic * (MONSTER_RARITY_TASK_KILLS.epic ?? 1) +
    kbr.legendary * (MONSTER_RARITY_TASK_KILLS.legendary ?? 1) +
    kbr.boss * (MONSTER_RARITY_TASK_KILLS.boss ?? 1);

// -- Per-kill rarity roll aggregation (seeded RNG primitive) ------------------

const rollKillsByRarity = (kills: number, masteryBonuses?: IMasteryRarityBonuses): TKillsByRarity => {
    const kbr = emptyKillsByRarity();
    for (let k = 0; k < kills; k++) {
        kbr[rollMonsterRarity(false, masteryBonuses)]++;
    }
    return kbr;
};

// -- Case tables -------------------------------------------------------------

const SEEDS = [1, 2, 3, 7, 13, 42, 99, 777];
const HEAVY_MASTERY: IMasteryRarityBonuses = { strong: 30, epic: 20, legendary: 10, mythic: 5, heroic: 0 };

const MS = 1_000_000; // wspólny punkt startu (Date.now-agnostyczny)
const noBuff = { xpBuffMult: 1, premiumXpMult: 1, skillXpBoostMult: 1, offlineTrainingBoostMult: 1 };
const fullBuff = { xpBuffMult: 1.5, premiumXpMult: 2.0, skillXpBoostMult: 1.5, offlineTrainingBoostMult: 2.0 };

const PREVIEW_CASES: IPreviewInput[] = [
    // Zero / brzegowe czasy
    { nowMs: MS, startedAtMs: MS, masteryLevel: 0, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 0, trainedSkillId: 'sword_fighting', ...noBuff },
    { nowMs: MS, startedAtMs: MS + 2000, masteryLevel: 0, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 0, trainedSkillId: 'sword_fighting', ...noBuff }, // now < started → 0
    // Tempo per mastery (speed 1/2/3/4)
    { nowMs: MS + 100_000, startedAtMs: MS, masteryLevel: 0, monsterXp: 3, goldMin: 1, goldMax: 1, skillLevel: 0, trainedSkillId: 'sword_fighting', ...noBuff }, // 100s speed1
    { nowMs: MS + 1_000_000, startedAtMs: MS, masteryLevel: 5, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 10, trainedSkillId: 'sword_fighting', ...noBuff }, // 1000s speed2
    { nowMs: MS + 3_600_000, startedAtMs: MS, masteryLevel: 12, monsterXp: 451, goldMin: 50, goldMax: 100, skillLevel: 25, trainedSkillId: 'magic_level', ...noBuff }, // 3600s speed3
    { nowMs: MS + 43_200_000, startedAtMs: MS, masteryLevel: 20, monsterXp: 977, goldMin: 100, goldMax: 200, skillLevel: 50, trainedSkillId: 'distance_fighting', ...noBuff }, // cap dokładnie, speed4
    // Cap: elapsed > OFFLINE_HUNT_MAX_SECONDS
    { nowMs: MS + 50_000_000, startedAtMs: MS, masteryLevel: 25, monsterXp: 5981, goldMin: 500, goldMax: 1000, skillLevel: 100, trainedSkillId: 'magic_level', ...noBuff },
    { nowMs: MS + 100_000_000, startedAtMs: MS, masteryLevel: 25, monsterXp: 5981, goldMin: 500, goldMax: 1000, skillLevel: 1000, trainedSkillId: 'magic_level', ...noBuff },
    // Bufy (XP + skill boosts)
    { nowMs: MS + 3_600_000, startedAtMs: MS, masteryLevel: 25, monsterXp: 451, goldMin: 50, goldMax: 100, skillLevel: 10, trainedSkillId: 'sword_fighting', ...fullBuff },
    { nowMs: MS + 3_600_000, startedAtMs: MS, masteryLevel: 0, monsterXp: 451, goldMin: 50, goldMax: 100, skillLevel: 10, trainedSkillId: 'sword_fighting', xpBuffMult: 1.5, premiumXpMult: 1, skillXpBoostMult: 1, offlineTrainingBoostMult: 1 },
    { nowMs: MS + 3_600_000, startedAtMs: MS, masteryLevel: 0, monsterXp: 451, goldMin: 50, goldMax: 100, skillLevel: 10, trainedSkillId: 'sword_fighting', xpBuffMult: 1, premiumXpMult: 2, skillXpBoostMult: 1, offlineTrainingBoostMult: 2 },
    // Złoto z nieparzystą sumą (floor((1+2)/2)=1 vs preview 1.5)
    { nowMs: MS + 600_000, startedAtMs: MS, masteryLevel: 0, monsterXp: 10, goldMin: 1, goldMax: 2, skillLevel: 3, trainedSkillId: 'sword_fighting', ...noBuff },
    { nowMs: MS + 600_000, startedAtMs: MS, masteryLevel: 25, monsterXp: 10, goldMin: 1, goldMax: 2, skillLevel: 3, trainedSkillId: 'sword_fighting', ...noBuff }, // masteryGold 1.5 * 1.5 = 2.25 → floor 2
    // Monster z zerowym xp / złotem
    { nowMs: MS + 600_000, startedAtMs: MS, masteryLevel: 10, monsterXp: 0, goldMin: 0, goldMax: 0, skillLevel: 5, trainedSkillId: 'sword_fighting', ...noBuff },
    // Różne staty treningowe (mnożniki OFFLINE_TRAINING_SPEED_MULTIPLIER)
    { nowMs: MS + 7_200_000, startedAtMs: MS, masteryLevel: 5, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 0, trainedSkillId: 'crit_chance', ...noBuff },
    { nowMs: MS + 7_200_000, startedAtMs: MS, masteryLevel: 5, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 0, trainedSkillId: 'attack_speed', ...noBuff },
    { nowMs: MS + 7_200_000, startedAtMs: MS, masteryLevel: 5, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 20, trainedSkillId: 'defense', ...noBuff },
    { nowMs: MS + 7_200_000, startedAtMs: MS, masteryLevel: 5, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 20, trainedSkillId: 'unknown_stat', ...noBuff }, // fallback 0.5
    // Ujemny mastery (poniżej progu → speed 1, mastery mult clamp do 0)
    { nowMs: MS + 500_000, startedAtMs: MS, masteryLevel: -3, monsterXp: 209, goldMin: 25, goldMax: 50, skillLevel: 5, trainedSkillId: 'sword_fighting', ...noBuff },
];

const AGGREGATE_CASES: IAggregateInput[] = [
    // Zero zabójstw
    { monsterXp: 209, goldMin: 25, goldMax: 50, masteryLevel: 0, xpBuffMult: 1, premiumXpMult: 1, killsByRarity: emptyKillsByRarity() },
    // Czysto normal
    { monsterXp: 209, goldMin: 25, goldMax: 50, masteryLevel: 0, xpBuffMult: 1, premiumXpMult: 1, killsByRarity: { normal: 100, strong: 0, epic: 0, legendary: 0, boss: 0 } },
    // Mieszane rzadkości
    { monsterXp: 451, goldMin: 50, goldMax: 100, masteryLevel: 0, xpBuffMult: 1, premiumXpMult: 1, killsByRarity: { normal: 50, strong: 10, epic: 5, legendary: 2, boss: 1 } },
    // Sam boss
    { monsterXp: 977, goldMin: 100, goldMax: 200, masteryLevel: 0, xpBuffMult: 1, premiumXpMult: 1, killsByRarity: { normal: 0, strong: 0, epic: 0, legendary: 0, boss: 10 } },
    // Mastery 25 + bufy XP
    { monsterXp: 451, goldMin: 50, goldMax: 100, masteryLevel: 25, xpBuffMult: 1.5, premiumXpMult: 2.0, killsByRarity: { normal: 50, strong: 10, epic: 5, legendary: 2, boss: 1 } },
    // Mały potwór (rat) — testuje floor(3 * mult)
    { monsterXp: 3, goldMin: 1, goldMax: 1, masteryLevel: 0, xpBuffMult: 1, premiumXpMult: 1, killsByRarity: { normal: 500, strong: 20, epic: 5, legendary: 1, boss: 0 } },
    // Duży potwór (world_ender)
    { monsterXp: 5981, goldMin: 500, goldMax: 1000, masteryLevel: 12, xpBuffMult: 1, premiumXpMult: 1, killsByRarity: { normal: 10, strong: 5, epic: 3, legendary: 2, boss: 1 } },
    // Nieparzysta suma złota (goldBase floor pierwej)
    { monsterXp: 10, goldMin: 1, goldMax: 2, masteryLevel: 0, xpBuffMult: 1, premiumXpMult: 1, killsByRarity: { normal: 7, strong: 3, epic: 0, legendary: 0, boss: 0 } },
    // Zerowy xp/gold potwór
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
        // Normalizacja przez JSON — usuwa -0 (wzór lootSystem). Parytet nienaruszony.
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
