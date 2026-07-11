import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Mulberry32 } from '../../src/systems/rng/mulberry32';
import {
    getDungeonMinLevel,
    getDungeonWaves,
    getDungeonCooldown,
    getDungeonRewardGold,
    getDungeonRewardXp,
    canEnterDungeon,
    getDungeonRemainingMs,
    formatCooldown,
    rollDungeonRarity,
    pickWaveMonster,
    getFinalWaveMonsterType,
    getMidWaveMonsterType,
    getWaveMonsterType,
    getWaveMonsterCount,
    getWaveComposition,
    pickWaveMonsters,
    scaleDungeonMonster,
    scaleDungeonMonsterAsType,
    resolveWave,
    rollDungeonGold,
    rollDungeonItemDrop,
    resolveDungeon,
    estimateDungeonRewards,
    DUNGEON_RARITY_ORDER,
    DUNGEON_MONSTER_TYPE_MULTIPLIERS,
    type IDungeon,
    type IDungeonMonster,
    type IDungeonCharacter,
    type DungeonMonsterType,
} from '../../src/systems/dungeonSystem';

// ============================================================================
// GOLDEN-VECTOR EXPORT + GUARD dla dungeonSystem.
//
// Trzy klasy funkcji (patrz DungeonSystem.php po stronie backendu):
//  1. DETERMINISTYCZNE (bez RNG) → golden bit-parity: skalowanie fal, kompozycje
//     potworów, pick po poziomie (sort deterministyczny), symulacja fali,
//     estymacja nagród, helpery poziom/waves/cooldown/reward, format cooldownu.
//  2. RNG STAŁA KOLEJNOŚĆ (1 rzut) → seeded golden bit-parity: rollDungeonRarity,
//     rollDungeonGold. mulberry32(seed) podmienia Math.random (helper withSeed),
//     backend replay z Mulberry32Rng(seed).
//  3. RNG + ItemGenerator: rollDungeonItemDrop / resolveDungeon. Tu używamy
//     lochów o maxRarity 'common' — rarity itemów zawsze 'common' → 0 slotów
//     bonusów → BRAK sort-shuffle w generatorze → CAŁA sekwencja RNG jest
//     deterministyczna, więc te wektory są bit-parity (uuid nie jest zwracane
//     w IGeneratedItem). Ścieżki rare+ (shuffle) NIE są bit-parity — testowane
//     własnościowo po stronie PHP (patrz DungeonSystemTest + ItemGenerator).
//
// Date.now() jest podmieniane helperem withNow (parametryzacja czasu, reguła 6).
//
// Regeneracja + kopia do backendu:
//   UPDATE_GOLDEN=1 npx vitest run tests/integration/dungeonSystem.golden.test.ts
//   cp golden/dungeonSystem.json ../grimshade-backend/tests/Golden/fixtures/
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

const withNow = <T>(nowMs: number, fn: () => T): T => {
    const orig = Date.now;
    Date.now = () => nowMs;
    try {
        return fn();
    } finally {
        Date.now = orig;
    }
};

const SEEDS = [1, 2, 3, 7, 13, 42, 99, 777];
const RESOLVE_SEEDS = [1, 42, 777];

// -- Wspólny roster potworów (rozpiętość poziomów pod sort pickWaveMonster) ----

const MONSTERS: IDungeonMonster[] = [
    { id: 'rat', name_pl: 'Szczur', hp: 60, attack: 8, defense: 1, level: 1, xp: 3, sprite: 'rat', speed: 2 },
    { id: 'goblin', name_pl: 'Goblin', hp: 64, attack: 9, defense: 1, level: 3, xp: 10, sprite: 'goblin', speed: 2 },
    { id: 'orc', name_pl: 'Ork', hp: 69, attack: 9, defense: 2, level: 5, xp: 18, sprite: 'ogre', speed: 2 },
    { id: 'zombie', name_pl: 'Zombie', hp: 70, attack: 10, defense: 2, level: 6, xp: 22, sprite: 'zombie', speed: 3 },
    { id: 'wolf', name_pl: 'Wilk', hp: 80, attack: 12, defense: 3, level: 9, xp: 30, sprite: 'wolf', speed: 3 },
    { id: 'troll', name_pl: 'Troll', hp: 120, attack: 18, defense: 5, level: 15, xp: 60, sprite: 'troll', speed: 1 },
    { id: 'ogre_boss', name_pl: 'Ogr', hp: 200, attack: 25, defense: 8, level: 22, xp: 120, sprite: 'ogre', speed: 1 },
    { id: 'dragon', name_pl: 'Smok', hp: 500, attack: 40, defense: 12, level: 40, xp: 400, sprite: 'dragon', speed: 1 },
];

// -- Lochy: pokrywają gałęzie helperów (derived vs override, explicit picks) ----

const D_SIMPLE: IDungeon = {
    id: 'd_simple', name_pl: 'Prosty', name_en: 'Simple', level: 1,
    maxRarity: 'common', description_pl: '', dailyAttempts: 5,
};
const D_EXPLICIT: IDungeon = {
    id: 'd_explicit', name_pl: 'Wyznaczony', name_en: 'Explicit', level: 5,
    maxRarity: 'common', description_pl: '', dailyAttempts: 5,
    monsters: ['goblin', 'orc'], bossMonster: 'zombie',
};
const D_MID: IDungeon = {
    id: 'd_mid', name_pl: 'Środkowy', name_en: 'Mid', level: 15,
    maxRarity: 'common', description_pl: '', dailyAttempts: 5,
};
const D_HARD: IDungeon = {
    id: 'd_hard', name_pl: 'Trudny', name_en: 'Hard', level: 30,
    maxRarity: 'common', description_pl: '', dailyAttempts: 5,
};
const D_TOP: IDungeon = {
    id: 'd_top', name_pl: 'Szczytowy', name_en: 'Top', level: 1000,
    maxRarity: 'common', description_pl: '', dailyAttempts: 3,
};
const D_OVERRIDE: IDungeon = {
    id: 'd_override', name_pl: 'Nadpisany', name_en: 'Override', level: 12,
    minLevel: 14, waves: 5, cooldown: 100, dailyAttempts: 5,
    rewardGold: [7, 9], rewardXp: 99, maxRarity: 'common', description_pl: '',
};
const D_DAILY: IDungeon = {
    id: 'd_daily', name_pl: 'Dzienny', name_en: 'Daily', level: 8,
    maxRarity: 'epic', description_pl: '', dailyAttempts: 5,
};

const ALL_DUNGEONS: IDungeon[] = [D_SIMPLE, D_EXPLICIT, D_MID, D_HARD, D_TOP, D_OVERRIDE, D_DAILY];

// Poziomy lochów pod matryce typów/kompozycji fal (granice tierów).
const WAVE_LEVELS = [1, 5, 8, 9, 14, 15, 18, 19, 20, 30, 50, 100, 799, 800, 1000];
const WAVE_COUNTS = [3, 4, 5, 6, 10];

const buildWaveTypeCases = (): Array<{ dungeonLevel: number; wave: number; totalWaves: number; value: DungeonMonsterType }> => {
    const out: Array<{ dungeonLevel: number; wave: number; totalWaves: number; value: DungeonMonsterType }> = [];
    for (const dungeonLevel of WAVE_LEVELS) {
        for (const totalWaves of WAVE_COUNTS) {
            for (let wave = 0; wave < totalWaves; wave++) {
                out.push({ dungeonLevel, wave, totalWaves, value: getWaveMonsterType(wave, totalWaves, dungeonLevel) });
            }
        }
    }
    return out;
};

const buildWaveCountCases = (): Array<{ dungeonLevel: number; wave: number; totalWaves: number; value: number }> => {
    const out: Array<{ dungeonLevel: number; wave: number; totalWaves: number; value: number }> = [];
    for (const dungeonLevel of WAVE_LEVELS) {
        for (const totalWaves of WAVE_COUNTS) {
            for (let wave = 0; wave < totalWaves; wave++) {
                out.push({ dungeonLevel, wave, totalWaves, value: getWaveMonsterCount(dungeonLevel, wave, totalWaves) });
            }
        }
    }
    return out;
};

const buildCompositionCases = (): Array<{ dungeonLevel: number; wave: number; totalWaves: number; value: DungeonMonsterType[] }> => {
    const out: Array<{ dungeonLevel: number; wave: number; totalWaves: number; value: DungeonMonsterType[] }> = [];
    for (const dungeonLevel of WAVE_LEVELS) {
        for (const totalWaves of WAVE_COUNTS) {
            for (let wave = 0; wave < totalWaves; wave++) {
                out.push({ dungeonLevel, wave, totalWaves, value: getWaveComposition(dungeonLevel, wave, totalWaves) });
            }
        }
    }
    return out;
};

const buildScaleCases = (): Array<{ monster: IDungeonMonster; wave: number; totalWaves: number; dungeonLevel: number; value: IDungeonMonster }> => {
    const out: Array<{ monster: IDungeonMonster; wave: number; totalWaves: number; dungeonLevel: number; value: IDungeonMonster }> = [];
    const bases = [MONSTERS[5], MONSTERS[7]]; // troll, dragon
    for (const monster of bases) {
        for (const dungeonLevel of [1, 5, 8, 9, 15, 18, 20, 30, 100, 220, 800, 1000]) {
            for (const totalWaves of [3, 5, 6, 10]) {
                for (let wave = 0; wave < totalWaves; wave++) {
                    out.push({
                        monster, wave, totalWaves, dungeonLevel,
                        value: scaleDungeonMonster(monster, wave, totalWaves, dungeonLevel),
                    });
                }
            }
        }
    }
    return out;
};

const buildScaleAsTypeCases = (): Array<{ monster: IDungeonMonster; wave: number; totalWaves: number; dungeonLevel: number; asType: DungeonMonsterType; value: IDungeonMonster }> => {
    const out: Array<{ monster: IDungeonMonster; wave: number; totalWaves: number; dungeonLevel: number; asType: DungeonMonsterType; value: IDungeonMonster }> = [];
    const types: DungeonMonsterType[] = ['Normal', 'Strong', 'Epic', 'Legendary', 'Boss'];
    const monster = MONSTERS[6]; // ogre_boss
    for (const dungeonLevel of [5, 15, 30, 800]) {
        for (const totalWaves of [4, 6]) {
            for (let wave = 0; wave < totalWaves; wave++) {
                for (const asType of types) {
                    out.push({
                        monster, wave, totalWaves, dungeonLevel, asType,
                        value: scaleDungeonMonsterAsType(monster, wave, totalWaves, dungeonLevel, asType),
                    });
                }
            }
        }
    }
    return out;
};

const buildPickCases = (): Array<{ dungeon: IDungeon; wave: number; totalWaves: number; value: IDungeonMonster }> => {
    const out: Array<{ dungeon: IDungeon; wave: number; totalWaves: number; value: IDungeonMonster }> = [];
    for (const dungeon of [D_SIMPLE, D_EXPLICIT, D_HARD, D_TOP, D_OVERRIDE]) {
        const totalWaves = getDungeonWaves(dungeon);
        for (let wave = 0; wave < totalWaves; wave++) {
            out.push({ dungeon, wave, totalWaves, value: pickWaveMonster(dungeon, MONSTERS, wave, totalWaves) });
        }
    }
    return out;
};

const buildPickMultiCases = (): Array<{ dungeon: IDungeon; wave: number; totalWaves: number; value: IDungeonMonster[] }> => {
    const out: Array<{ dungeon: IDungeon; wave: number; totalWaves: number; value: IDungeonMonster[] }> = [];
    for (const dungeon of [D_SIMPLE, D_EXPLICIT, D_HARD, D_TOP, D_OVERRIDE]) {
        const totalWaves = getDungeonWaves(dungeon);
        for (let wave = 0; wave < totalWaves; wave++) {
            out.push({ dungeon, wave, totalWaves, value: pickWaveMonsters(dungeon, MONSTERS, wave, totalWaves) });
        }
    }
    return out;
};

const RESOLVE_WAVE_CASES: Array<[number, number, number, number, number, number]> = [
    [500, 999, 100, 60, 8, 1],      // one-shot win
    [200, 30, 5, 80, 12, 3],        // multi-round win, player loses some hp
    [30, 10, 0, 100, 15, 2],        // loss
    [10, 1, 0, 48, 5, 0],           // fast loss, pDmg floored to 1
    [1000, 5, 50, 500, 200, 40],    // player blocks (mDmg floored to 1), grind win
    [50, 8, 2, 40, 60, 10],         // exact-ish lethal exchange
    [100, 100, 100, 100, 100, 100], // symmetric floors
    [1, 1, 0, 1, 1, 0],             // minimal
];

const buildEstimateCases = (): Array<{ dungeon: IDungeon; monstersRaw: { id: string; gold: [number, number] }[]; value: unknown }> => {
    const monstersRaw = MONSTERS.map((m) => ({ id: m.id, gold: [Math.max(1, m.level), m.level * 2] as [number, number] }));
    return [D_SIMPLE, D_EXPLICIT, D_MID, D_HARD, D_TOP, D_OVERRIDE].map((dungeon) => ({
        dungeon,
        monstersRaw,
        value: estimateDungeonRewards(dungeon, MONSTERS, monstersRaw),
    }));
};

// -- Loch/postać dla resolveDungeon (maxRarity common → bit-parity) ------------

const RD_L8: IDungeon = {
    id: 'rd_l8', name_pl: 'RD8', name_en: 'RD8', level: 8,
    maxRarity: 'common', description_pl: '', dailyAttempts: 5,
};
const RD_L30: IDungeon = {
    id: 'rd_l30', name_pl: 'RD30', name_en: 'RD30', level: 30,
    maxRarity: 'common', description_pl: '', dailyAttempts: 5,
};

const CHAR_STRONG: IDungeonCharacter = { attack: 99999, defense: 9999, max_hp: 10_000_000, level: 50 };
const CHAR_MODERATE: IDungeonCharacter = { attack: 30, defense: 5, max_hp: 500, level: 8 };
const CHAR_WEAK: IDungeonCharacter = { attack: 1, defense: 0, max_hp: 20, level: 1 };

const RESOLVE_SCENARIOS: Array<{ label: string; dungeon: IDungeon; character: IDungeonCharacter }> = [
    { label: 'l8-strong', dungeon: RD_L8, character: CHAR_STRONG },
    { label: 'l8-moderate', dungeon: RD_L8, character: CHAR_MODERATE },
    { label: 'l8-weak', dungeon: RD_L8, character: CHAR_WEAK },
    { label: 'l30-strong', dungeon: RD_L30, character: CHAR_STRONG },
];

// -- Lochy dla rollDungeonItemDrop (maxRarity common → item zawsze common) ------

const DROP_DUNGEONS: IDungeon[] = [
    { id: 'drop_l1', name_pl: 'DL1', name_en: 'DL1', level: 1, maxRarity: 'common', description_pl: '' },
    { id: 'drop_l8', name_pl: 'DL8', name_en: 'DL8', level: 8, maxRarity: 'common', description_pl: '' },
    { id: 'drop_l30', name_pl: 'DL30', name_en: 'DL30', level: 30, minLevel: 30, maxRarity: 'common', description_pl: '' },
];

const buildGolden = (): Record<string, unknown> => ({
    system: 'dungeonSystem',
    note: 'Generowane z src/systems/dungeonSystem.ts. NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1.',

    monsters: MONSTERS,
    constants: {
        DUNGEON_RARITY_ORDER,
        DUNGEON_MONSTER_TYPE_MULTIPLIERS,
    },

    // -- Deterministyczne helpery ---------------------------------------------
    getDungeonMinLevel: ALL_DUNGEONS.map((dungeon) => ({ dungeon, value: getDungeonMinLevel(dungeon) })),
    getDungeonWaves: ALL_DUNGEONS.map((dungeon) => ({ dungeon, value: getDungeonWaves(dungeon) })),
    getDungeonCooldown: ALL_DUNGEONS.map((dungeon) => ({ dungeon, value: getDungeonCooldown(dungeon) })),
    getDungeonRewardGold: ALL_DUNGEONS.map((dungeon) => ({ dungeon, value: getDungeonRewardGold(dungeon) })),
    getDungeonRewardXp: ALL_DUNGEONS.map((dungeon) => ({ dungeon, value: getDungeonRewardXp(dungeon) })),

    // -- Czas (Date.now podmieniony przez withNow) ----------------------------
    canEnterDungeon: [
        { dungeon: D_MID, characterLevel: 10, lastCompletedAt: null, nowMs: 1_000_000_000_000 },
        { dungeon: D_MID, characterLevel: 15, lastCompletedAt: null, nowMs: 1_000_000_000_000 },
        { dungeon: D_DAILY, characterLevel: 8, lastCompletedAt: '2026-07-08T00:00:00.000Z', nowMs: Date.parse('2026-07-08T04:00:00.000Z') },
        { dungeon: D_DAILY, characterLevel: 8, lastCompletedAt: '2026-07-08T00:00:00.000Z', nowMs: Date.parse('2026-07-08T04:47:59.000Z') },
        { dungeon: D_DAILY, characterLevel: 8, lastCompletedAt: '2026-07-08T00:00:00.000Z', nowMs: Date.parse('2026-07-08T04:48:00.000Z') },
        { dungeon: D_OVERRIDE, characterLevel: 20, lastCompletedAt: '2026-07-08T12:00:00.500Z', nowMs: Date.parse('2026-07-08T12:01:40.500Z') },
        { dungeon: D_OVERRIDE, characterLevel: 20, lastCompletedAt: '2026-07-08T12:00:00.500Z', nowMs: Date.parse('2026-07-08T12:01:40.499Z') },
    ].map((c) => ({ ...c, value: withNow(c.nowMs, () => canEnterDungeon(c.dungeon, c.characterLevel, c.lastCompletedAt)) })),

    getDungeonRemainingMs: [
        { dungeon: D_DAILY, lastCompletedAt: null, nowMs: 1_000_000_000_000 },
        { dungeon: D_DAILY, lastCompletedAt: '2026-07-08T00:00:00.000Z', nowMs: Date.parse('2026-07-08T04:00:00.000Z') },
        { dungeon: D_DAILY, lastCompletedAt: '2026-07-08T00:00:00.000Z', nowMs: Date.parse('2026-07-08T05:00:00.000Z') },
        { dungeon: D_OVERRIDE, lastCompletedAt: '2026-07-08T12:00:00.500Z', nowMs: Date.parse('2026-07-08T12:00:30.500Z') },
    ].map((c) => ({ ...c, value: withNow(c.nowMs, () => getDungeonRemainingMs(c.dungeon, c.lastCompletedAt)) })),

    formatCooldown: [0, 500, 999, 1000, 1001, 59_000, 60_000, 61_000, 3_599_000, 3_600_000, 3_661_000, 7_325_000, 90_061_000]
        .map((ms) => ({ ms, value: formatCooldown(ms) })),

    // -- Typy/kompozycje fal ---------------------------------------------------
    getFinalWaveMonsterType: [1, 5, 8, 9, 15, 18, 19, 20, 50, 1000]
        .map((dungeonLevel) => ({ dungeonLevel, value: getFinalWaveMonsterType(dungeonLevel) })),
    getMidWaveMonsterType: buildWaveTypeCases()
        .map(({ dungeonLevel, wave, totalWaves }) => ({ dungeonLevel, wave, totalWaves, value: getMidWaveMonsterType(dungeonLevel, wave, totalWaves) })),
    getWaveMonsterType: buildWaveTypeCases(),
    getWaveMonsterCount: buildWaveCountCases(),
    getWaveComposition: buildCompositionCases(),

    // -- Pick po poziomie (sort deterministyczny) -----------------------------
    pickWaveMonster: buildPickCases(),
    pickWaveMonsters: buildPickMultiCases(),

    // -- Skalowanie potworów ---------------------------------------------------
    scaleDungeonMonster: buildScaleCases(),
    scaleDungeonMonsterAsType: buildScaleAsTypeCases(),

    // -- Symulacja fali + estymacja -------------------------------------------
    resolveWave: RESOLVE_WAVE_CASES.map(([playerHp, playerAtk, playerDef, monsterHp, monsterAtk, monsterDef]) => ({
        playerHp, playerAtk, playerDef, monsterHp, monsterAtk, monsterDef,
        value: resolveWave(playerHp, playerAtk, playerDef, monsterHp, monsterAtk, monsterDef),
    })),
    estimateDungeonRewards: buildEstimateCases(),

    // -- RNG stała kolejność (1 rzut) → bit-parity ----------------------------
    rollDungeonRarity: DUNGEON_RARITY_ORDER.flatMap((maxRarity) =>
        SEEDS.map((seed) => ({ maxRarity, seed, value: withSeed(seed, () => rollDungeonRarity(maxRarity)) }))),
    rollDungeonGold: SEEDS.flatMap((seed) => [
        { seed, range: [10, 25] as [number, number], value: withSeed(seed, () => rollDungeonGold([10, 25])) },
        { seed, range: [100, 500] as [number, number], value: withSeed(seed, () => rollDungeonGold([100, 500])) },
        { seed, range: [7, 7] as [number, number], value: withSeed(seed, () => rollDungeonGold([7, 7])) },
    ]),

    // -- RNG + ItemGenerator (common → bit-parity, uuid nie zwracane) ----------
    rollDungeonItemDrop: DROP_DUNGEONS.flatMap((dungeon) =>
        SEEDS.flatMap((seed) => [false, true].map((isBossWave) => ({
            dungeon, seed, isBossWave,
            value: withSeed(seed, () => rollDungeonItemDrop(dungeon, 50, [], isBossWave)),
        })))),
    resolveDungeon: RESOLVE_SCENARIOS.flatMap(({ label, dungeon, character }) =>
        RESOLVE_SEEDS.map((seed) => ({
            label, dungeon, character, seed,
            value: withSeed(seed, () => resolveDungeon(dungeon, character, MONSTERS, [])),
        }))),
});

const outPath = resolve(process.cwd(), 'golden/dungeonSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('dungeonSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current dungeonSystem output', () => {
        expect(existsSync(outPath), 'brak golden/dungeonSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        // Normalizacja przez JSON usuwa -0 (skalowania float) — i tak serializuje
        // się jako 0, tak samo liczy PHP. Parytet nienaruszony.
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
