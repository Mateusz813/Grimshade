import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
    GUILD_INITIAL_MEMBER_CAP,
    GUILD_CREATE_COST_GOLD,
    GUILD_MAX_LEVEL,
    GUILD_BOSS_MAX_TIER,
    GUILD_TREASURY_SLOTS,
    GUILD_BOSS_HEROIC_MAX_CHANCE,
    GUILD_BOSS_BLOCK_PCT,
    clampGuildBossTier,
    getGuildBossMaxHp,
    guildXpToNextLevel,
    guildXpForLevel,
    guildMemberCap,
    applyGuildXp,
    computeGuildBossDamage,
    contributionMultiplier,
    getCurrentWeekStartIso,
    isGuildBossClaimDay,
    getTodayIso,
} from '../../src/systems/guildSystem';

// ============================================================================
// GOLDEN-VECTOR EXPORT + GUARD dla guildSystem.
//
// System jest CZYSTY/DETERMINISTYCZNY — zero RNG. Wszystkie formuły (krzywa XP
// gildii, skalowanie HP bossa, obrażenia/cios, koszt/limit, mnożnik nagrody) to
// bit-parity golden. Trzy funkcje daty (getCurrentWeekStartIso / isGuildBossClaimDay
// / getTodayIso) są sparametryzowane epoką w ms (Date(ms)) zamiast new Date() —
// PHP odtwarza z tego samego znacznika czasu w UTC.
//
// Dwie role (jak levelSystem):
//  1. UPDATE_GOLDEN=1 → GENERUJE golden/guildSystem.json z realnych funkcji.
//  2. Normalnie → GUARD: commitowany fixture == aktualny output TS.
//
// Regeneracja + kopia do backendu:
//   UPDATE_GOLDEN=1 npx vitest run tests/integration/guildSystem.golden.test.ts
//   cp golden/guildSystem.json ../grimshade-backend/tests/Golden/fixtures/
//
// UWAGA PRECYZJA:
//  - getGuildBossMaxHp / guildXpToNextLevel testowane do tier/level, gdzie wynik
//    ≤ 2^53 (Number.MAX_SAFE_INTEGER). Tier bossa i tak jest clampowany do 50, więc
//    getGuildBossMaxHp badamy w [−5..50] (powyżej ~96 pow(1.25) rozjeżdża się o 1 ULP
//    między V8 a libm PHP, ale ta strefa jest poza grą).
//  - guildXpForLevel to SUMA — narastająco przekracza 2^53 ~ powyżej poziomu 400,
//    gdzie JS (double) traci precyzję integer i rozjeżdża się z int64 PHP. Dlatego
//    poziomy dla guildXpForLevel są ograniczone do ≤ 400 (total < 2^53).
// ============================================================================

const BOSS_TIERS = [-5, 0, 1, 2, 3, 5, 10, 25, 49, 50];
const CLAMP_TIERS = [-5, -0.5, 0, 0.5, 1, 1.9, 2.5, 3, 25, 49, 49.9, 50, 50.9, 51, 100, 1000];
const XP_NEXT_LEVELS = [-3, 0, 1, 2, 3, 5, 10, 25, 49, 50, 51, 52, 100, 200, 500, 1000];
const XP_FOR_LEVELS = [1, 2, 3, 5, 10, 25, 50, 51, 100, 150, 200, 300, 400];
const MEMBER_CAP_LEVELS = [-5, 0, 1, 2, 3, 20, 50, 100, 1000];

const APPLY_XP_CASES: Array<[number, number, number]> = [
    [1, 0, 0], [1, 0, 2000000], [1, 0, 1999999], [1, 0, 7000000], [1, 0, 10000000],
    [2, 0, 5000000], [5, 0, 24414060], [10, 100000000, 200000000], [0, 0, 0],
    [50, 0, 5605193857250], [1, 500, 0], [100, 0, 22420775429000], [5, 100, -999],
    [3, 1000000, 50000000],
];

const BOSS_DMG_CASES: Array<[number, number, number]> = [
    [0, 0, 1], [1, 1, 1], [50, 1, 1], [100, 50, 1], [500, 400, 1], [500, 400, 10],
    [500, 400, 25], [500, 400, 50], [1000000000, 1000, 1], [0, 0, 0], [10, 10, -5],
    [200, 120, 5], [1, 1000, 50], [-50, 100, 3], [123, 456, 7],
];

const CONTRIB_CASES: Array<[number, number]> = [
    [0, 1000000], [100000, 1000000], [250000, 1000000], [500000, 1000000],
    [1000000, 1000000], [2000000, 1000000], [0, 0], [50, 0], [-100, 1000000],
    [15000000, 15000000], [1, 112103877145],
];

// [rok, miesiąc(1-12), dzień, godzina, minuta] → Date.UTC → ms. Pokrywa każdy dzień
// tygodnia, granice miesiąca/roku, rok przestępny, niedzielę (dzień claim).
const DATE_SPECS: Array<[number, number, number, number, number]> = [
    [2026, 7, 6, 0, 0], [2026, 7, 7, 12, 30], [2026, 7, 8, 23, 59], [2026, 7, 12, 10, 0],
    [2026, 7, 13, 0, 1], [2026, 1, 1, 5, 0], [2024, 3, 1, 15, 0], [2026, 3, 1, 9, 0],
    [2026, 12, 31, 20, 0], [2025, 12, 29, 0, 0], [2024, 2, 29, 23, 59], [2000, 1, 3, 0, 0],
    [2027, 1, 4, 6, 0],
];

const dateMs = ([y, mo, d, h, mi]: [number, number, number, number, number]): number =>
    Date.UTC(y, mo - 1, d, h, mi, 0, 0);

const buildGolden = (): Record<string, unknown> => ({
    system: 'guildSystem',
    note: 'Generowane z src/systems/guildSystem.ts. System czysty (zero RNG). NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1.',

    constants: {
        initialMemberCap: GUILD_INITIAL_MEMBER_CAP,
        createCostGold: GUILD_CREATE_COST_GOLD,
        bossMaxTier: GUILD_BOSS_MAX_TIER,
        treasurySlots: GUILD_TREASURY_SLOTS,
        bossHeroicMaxChance: GUILD_BOSS_HEROIC_MAX_CHANCE,
        bossBlockPct: GUILD_BOSS_BLOCK_PCT,
    },
    // GUILD_MAX_LEVEL === +Infinity nie serializuje się w JSON (→ null), więc
    // zamiast wartości zapisujemy niezmiennik: „brak górnego limitu poziomu".
    maxLevelIsInfinite: !Number.isFinite(GUILD_MAX_LEVEL),

    clampGuildBossTier: CLAMP_TIERS.map((tier) => ({ tier, value: clampGuildBossTier(tier) })),
    getGuildBossMaxHp: BOSS_TIERS.map((tier) => ({ tier, value: getGuildBossMaxHp(tier) })),
    guildXpToNextLevel: XP_NEXT_LEVELS.map((level) => ({ level, value: guildXpToNextLevel(level) })),
    guildXpForLevel: XP_FOR_LEVELS.map((level) => ({ level, value: guildXpForLevel(level) })),
    guildMemberCap: MEMBER_CAP_LEVELS.map((level) => ({ level, value: guildMemberCap(level) })),
    applyGuildXp: APPLY_XP_CASES.map(([level, xp, gain]) => ({
        level, xp, gain, result: applyGuildXp(level, xp, gain),
    })),
    computeGuildBossDamage: BOSS_DMG_CASES.map(([attack, level, tier]) => ({
        attack, level, tier, value: computeGuildBossDamage(attack, level, tier),
    })),
    contributionMultiplier: CONTRIB_CASES.map(([damage, bossMaxHp]) => ({
        damage, bossMaxHp, value: contributionMultiplier(damage, bossMaxHp),
    })),
    getCurrentWeekStartIso: DATE_SPECS.map((spec) => {
        const ms = dateMs(spec);
        return { ms, value: getCurrentWeekStartIso(new Date(ms)) };
    }),
    isGuildBossClaimDay: DATE_SPECS.map((spec) => {
        const ms = dateMs(spec);
        return { ms, value: isGuildBossClaimDay(new Date(ms)) };
    }),
    getTodayIso: DATE_SPECS.map((spec) => {
        const ms = dateMs(spec);
        return { ms, value: getTodayIso(new Date(ms)) };
    }),
});

const outPath = resolve(process.cwd(), 'golden/guildSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('guildSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current guildSystem output', () => {
        expect(existsSync(outPath), 'brak golden/guildSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        // Normalizacja przez JSON — usuwa -0 (np. contributionMultiplier na ujemnym
        // damage), który i tak serializuje się jako 0. Parytet nienaruszony.
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
