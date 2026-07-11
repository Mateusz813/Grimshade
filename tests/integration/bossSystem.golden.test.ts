import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Mulberry32 } from '../../src/systems/rng/mulberry32';
import {
    BOSS_HP_MULTIPLIER,
    BOSS_ATK_MULTIPLIER,
    BOSS_DEF_MULTIPLIER,
    BOSS_REWARD_MULTIPLIER,
    getBossDrops,
    getBossCooldown,
    getScaledBossStats,
    getBossPhaseMultiplier,
    isBossEnraged,
    computeBossRewards,
    getBossGoldRange,
    getBossXp,
    getBossRecommendedLevel,
    canChallengeBoss,
    getBossRemainingMs,
    rollBossGold,
    rollBossLoot,
    resolveBoss,
    type IBoss,
    type IBossCharacter,
} from '../../src/systems/bossSystem';
import bossesData from '../../src/data/bosses.json';

// ============================================================================
// GOLDEN-VECTOR EXPORT + GUARD dla bossSystem.
//
// Dwie role (jak levelSystem/lootSystem):
//  1. UPDATE_GOLDEN=1 → GENERUJE golden/bossSystem.json z realnych funkcji.
//  2. Normalnie → GUARD: fixture == aktualny output TS (zmiana formuły w TS bez
//     regeneracji zczerwienieje).
//
// Fixture kopiowany do backendu (grimshade-backend/tests/Golden/fixtures/) →
// Pest odtwarza go w PHP (BossSystemTest) → maszynowy parytet TS↔PHP.
//
// Regeneracja + kopia:
//   UPDATE_GOLDEN=1 npx vitest run tests/integration/bossSystem.golden.test.ts
//   cp golden/bossSystem.json ../grimshade-backend/tests/Golden/fixtures/
//
// KLASYFIKACJA funkcji (patrz BossSystem.php):
//  - Czyste/deterministyczne → bit-parity (getScaledBossStats, getBossCooldown,
//    getBossDrops, getBossPhaseMultiplier, isBossEnraged, computeBossRewards,
//    getBossGoldRange, getBossXp, getBossRecommendedLevel).
//  - RNG w STAŁEJ kolejności konsumpcji Math.random → seed + mulberry32
//    (rollBossGold: 1 rzut; rollBossLoot: 1 rzut/wpis dropu; resolveBoss:
//    deterministyczna pętla walki, potem loot + gold gdy wygrana).
//  - Date.now()/new Date() → sparametryzowane: canChallengeBoss/getBossRemainingMs
//    dostają now (ms) i lastDefeated (ms) jako argumenty; generator podmienia
//    Date.now na stałą, a lastDefeatedAt buduje z ms (round-trip przez ISO).
//  - formatBossCooldown POMINIĘTE (czysty formatter UI "5m 30s"; serwer wysyła
//    remainingMs z getBossRemainingMs, klient renderuje).
// ============================================================================

/** Podmienia Math.random na deterministyczny mulberry32(seed) (wzór lootSystem). */
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

/** Podmienia Date.now na stałą, żeby cooldown-logic była deterministyczna. */
const withNow = <T>(nowMs: number, fn: () => T): T => {
    const orig = Date.now;
    Date.now = () => nowMs;
    try {
        return fn();
    } finally {
        Date.now = orig;
    }
};

const BOSSES = bossesData as unknown as IBoss[];

const boss = (id: string): IBoss => {
    const found = BOSSES.find((b) => b.id === id);
    if (!found) throw new Error(`Nieznany boss w golden: ${id}`);
    return found;
};

/** Fabryka syntetycznych bossów do testu gałęzi fallback (spełnia IBoss). */
const mkBoss = (over: Partial<IBoss> & { id: string }): IBoss => ({
    id: over.id,
    name_pl: 'X',
    name_en: 'X',
    level: 1,
    hp: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    xp: 0,
    gold: [0, 0],
    sprite: 'x',
    description_pl: 'x',
    ...over,
});

const SEEDS = [1, 2, 3, 7, 13, 42, 99, 777];

// Poziomy: zera/1, granice krzywych XP (100/200/400/500/600/800/1000/1001),
// wysokie (1010/1100) oraz ujemny (robustność max(1,level)).
const REWARD_LEVELS = [-5, 0, 1, 2, 5, 10, 50, 99, 100, 101, 150, 200, 400, 500, 600, 800, 999, 1000, 1001, 1010, 1100];

const REAL_IDS = [
    'sewer_king', 'shadow_lord', 'ancient_dragon', 'demon_king', 'lich_king',
    'chaos_emperor', 'abyssal_titan', 'infernal_overlord', 'celestial_destroyer',
    'world_eater', 'world_destroyer', 'end_of_all',
];

// Fraction wokół progu enrage 0.3 (+ wartości poza [0,1] jako robustność).
const PHASE_FRACTIONS = [-0.1, 0, 0.1, 0.2, 0.2999, 0.3, 0.3001, 0.5, 1, 2];

const ENRAGE_CASES: Array<[number, number]> = [
    [0, 100], [29, 100], [30, 100], [100, 100], [0, 0], [50, 0],
    [15, 50], [14, 50], [1, 1000], [300, 1000],
];

// Syntetyki dla getScaledBossStats (edge: atk 0, floor-podwójny, wielki).
const SCALED_SYNTH = [
    mkBoss({ id: 'syn_zero', level: 1, hp: 0, attack: 0, defense: 0 }),
    mkBoss({ id: 'syn_one', level: 1, hp: 1, attack: 1, defense: 1 }),
    mkBoss({ id: 'syn_small_atk', level: 5, hp: 100, attack: 2, defense: 0 }),
    mkBoss({ id: 'syn_big', level: 1000, hp: 1_000_000, attack: 9999, defense: 500 }),
];

// Syntetyki dla getBossDrops (uniqueDrops vs dropTable vs pusta vs brak).
const DROPS_SYNTH = [
    mkBoss({
        id: 'syn_unique',
        uniqueDrops: [{ itemId: 'a', chance: 0.5, rarity: 'rare' }],
        dropTable: [{ itemId: 'b', chance: 0.1, rarity: 'epic' }],
    }),
    mkBoss({
        id: 'syn_unique_empty',
        uniqueDrops: [],
        dropTable: [{ itemId: 'b', chance: 0.1, rarity: 'epic' }],
    }),
    mkBoss({ id: 'syn_droptable', dropTable: [{ itemId: 'c', chance: 0.2, rarity: 'common' }] }),
    mkBoss({ id: 'syn_no_drops' }),
];

// Syntetyki dla getBossCooldown (cooldown vs dailyAttempts; nullish vs falsy 0).
const COOLDOWN_SYNTH = [
    mkBoss({ id: 'syn_cd', cooldown: 3600, dailyAttempts: 3 }),  // cooldown wygrywa
    mkBoss({ id: 'syn_cd0', cooldown: 0, dailyAttempts: 3 }),    // 0 nie jest nullish → 0
    mkBoss({ id: 'syn_da7', dailyAttempts: 7 }),                 // floor(86400/7)
    mkBoss({ id: 'syn_da0', dailyAttempts: 0 }),                 // 0 falsy → 28800
    mkBoss({ id: 'syn_da_neg', dailyAttempts: -5 }),             // JS-truthy → floor(86400/-5)
    mkBoss({ id: 'syn_cd_none' }),                               // brak → 28800
];

const CD_MS = 28_800_000; // realny boss (dailyAttempts 3): floor(86400/3)*1000
const T0 = 1_700_000_000_000;

const CHALLENGE_CASES: Array<{ bossId: string; characterLevel: number; nowMs: number; lastMs: number | null }> = [
    { bossId: 'demon_king', characterLevel: 99, nowMs: T0 + 5, lastMs: T0 },          // poziom < boss.level
    { bossId: 'demon_king', characterLevel: 100, nowMs: T0 + 5, lastMs: null },       // brak lastDefeated
    { bossId: 'demon_king', characterLevel: 150, nowMs: T0 + 10_000_000, lastMs: T0 },// wciąż cooldown
    { bossId: 'demon_king', characterLevel: 150, nowMs: T0 + CD_MS, lastMs: T0 },     // elapsed == cooldown → true
    { bossId: 'demon_king', characterLevel: 150, nowMs: T0 + CD_MS + 1, lastMs: T0 }, // po cooldownie
    { bossId: 'demon_king', characterLevel: 150, nowMs: T0 + CD_MS - 1, lastMs: T0 }, // tuż przed
    { bossId: 'end_of_all', characterLevel: 1000, nowMs: T0 + 50_000_000, lastMs: T0 },
    { bossId: 'end_of_all', characterLevel: 500, nowMs: T0 + 50_000_000, lastMs: T0 },// poziom < 1000
    { bossId: 'sewer_king', characterLevel: 10, nowMs: T0, lastMs: T0 },              // elapsed 0
    { bossId: 'sewer_king', characterLevel: 9, nowMs: T0, lastMs: null },             // poziom < 10
];

const REMAINING_CASES: Array<{ bossId: string; nowMs: number; lastMs: number | null }> = [
    { bossId: 'demon_king', nowMs: T0 + 10_000_000, lastMs: T0 },
    { bossId: 'demon_king', nowMs: T0 + CD_MS, lastMs: T0 },
    { bossId: 'demon_king', nowMs: T0 + CD_MS + 5_000_000, lastMs: T0 }, // clamp do 0
    { bossId: 'demon_king', nowMs: T0 + 999, lastMs: null },            // brak → 0
    { bossId: 'end_of_all', nowMs: T0 + 1_000_000, lastMs: T0 },
    { bossId: 'sewer_king', nowMs: T0, lastMs: T0 },
];

// resolveBoss: win-stomp, win-mid, win-z-enrage, loss (bez RNG).
const RESOLVE_CASES: Array<{ bossId: string; character: IBossCharacter }> = [
    { bossId: 'sewer_king', character: { attack: 5000, defense: 1000, max_hp: 100_000, level: 50 } },
    { bossId: 'demon_king', character: { attack: 2000, defense: 200, max_hp: 50_000, level: 120 } },
    { bossId: 'ancient_dragon', character: { attack: 1000, defense: 200, max_hp: 200_000, level: 55 } },
    { bossId: 'end_of_all', character: { attack: 100, defense: 10, max_hp: 500, level: 10 } },
];

const iso = (ms: number): string => new Date(ms).toISOString();

const buildGolden = (): Record<string, unknown> => ({
    system: 'bossSystem',
    note: 'Generowane z src/systems/bossSystem.ts + realne bosses.json. Funkcje RNG: seed + mulberry32; cooldown: now/last w ms. NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1.',

    constants: {
        hpMultiplier: BOSS_HP_MULTIPLIER,
        atkMultiplier: BOSS_ATK_MULTIPLIER,
        defMultiplier: BOSS_DEF_MULTIPLIER,
        rewardMultiplier: BOSS_REWARD_MULTIPLIER,
    },

    // -- Deterministyczne (bit-parity) --------------------------------------
    getScaledBossStats: REAL_IDS.map((id) => ({ bossId: id, value: getScaledBossStats(boss(id)) })),
    getScaledBossStatsSynthetic: SCALED_SYNTH.map((b) => ({ boss: b, value: getScaledBossStats(b) })),

    getBossDrops: REAL_IDS.map((id) => ({ bossId: id, value: getBossDrops(boss(id)) })),
    getBossDropsSynthetic: DROPS_SYNTH.map((b) => ({ boss: b, value: getBossDrops(b) })),

    getBossCooldown: REAL_IDS.map((id) => ({ bossId: id, value: getBossCooldown(boss(id)) })),
    getBossCooldownSynthetic: COOLDOWN_SYNTH.map((b) => ({ boss: b, value: getBossCooldown(b) })),

    getBossPhaseMultiplier: PHASE_FRACTIONS.map((fraction) => ({ fraction, value: getBossPhaseMultiplier(fraction) })),
    isBossEnraged: ENRAGE_CASES.map(([currentHp, maxHp]) => ({ currentHp, maxHp, value: isBossEnraged(currentHp, maxHp) })),

    computeBossRewards: REWARD_LEVELS.map((level) => ({ level, value: computeBossRewards(level) })),
    getBossGoldRange: REAL_IDS.map((id) => ({ bossId: id, value: getBossGoldRange(boss(id)) })),
    getBossXp: REAL_IDS.map((id) => ({ bossId: id, value: getBossXp(boss(id)) })),
    getBossRecommendedLevel: REAL_IDS.map((id) => ({ bossId: id, value: getBossRecommendedLevel(boss(id)) })),

    // -- Sparametryzowany czas (now/last w ms) ------------------------------
    canChallengeBoss: CHALLENGE_CASES.map((c) => ({
        bossId: c.bossId,
        characterLevel: c.characterLevel,
        nowMs: c.nowMs,
        lastMs: c.lastMs,
        value: withNow(c.nowMs, () => canChallengeBoss(
            boss(c.bossId),
            c.characterLevel,
            c.lastMs === null ? null : iso(c.lastMs),
        )),
    })),
    getBossRemainingMs: REMAINING_CASES.map((c) => ({
        bossId: c.bossId,
        nowMs: c.nowMs,
        lastMs: c.lastMs,
        value: withNow(c.nowMs, () => getBossRemainingMs(
            boss(c.bossId),
            c.lastMs === null ? null : iso(c.lastMs),
        )),
    })),

    // -- RNG (seed → mulberry32, stała kolejność) ---------------------------
    rollBossGold: ['sewer_king', 'demon_king', 'end_of_all'].flatMap((id) =>
        SEEDS.map((seed) => ({ bossId: id, seed, value: withSeed(seed, () => rollBossGold(boss(id))) })),
    ),
    rollBossLoot: ['sewer_king', 'shadow_lord', 'ancient_dragon'].flatMap((id) =>
        SEEDS.map((seed) => ({ bossId: id, seed, value: withSeed(seed, () => rollBossLoot(boss(id))) })),
    ),
    resolveBoss: RESOLVE_CASES.flatMap((c) =>
        SEEDS.map((seed) => ({
            bossId: c.bossId,
            character: c.character,
            seed,
            result: withSeed(seed, () => resolveBoss(boss(c.bossId), c.character)),
        })),
    ),
});

const outPath = resolve(process.cwd(), 'golden/bossSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('bossSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current bossSystem output', () => {
        expect(existsSync(outPath), 'brak golden/bossSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        // Normalizacja przez JSON usuwa -0 (np. getBossPhaseMultiplier) — parytet
        // nienaruszony, PHP i tak serializuje 0.
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
