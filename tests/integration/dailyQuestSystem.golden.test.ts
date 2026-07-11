import { describe, it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
    DAILY_QUEST_COUNT,
    getTodayKey,
    needsRefresh,
    selectDailyQuests,
    scaleRewards,
    type IDailyQuestDef,
    type IDailyQuestRewards,
} from '../../src/systems/dailyQuestSystem';
import dailyQuestsRaw from '../../src/data/dailyQuests.json';

// ============================================================================
// GOLDEN-VECTOR EXPORT + GUARD dla dailyQuestSystem.
//
// Dwie role (jak levelSystem/lootSystem):
//  1. UPDATE_GOLDEN=1 → GENERUJE golden/dailyQuestSystem.json z realnych funkcji.
//  2. Normalnie → GUARD: fixture == aktualny output TS (zmiana formuły w TS bez
//     regeneracji zczerwienieje).
//
// Fixture kopiowany do backendu (grimshade-backend/tests/Golden/fixtures/) →
// Pest odtwarza go w PHP (DailyQuestSystemTest) → maszynowy parytet TS↔PHP.
//
// Regeneracja + kopia:
//   UPDATE_GOLDEN=1 npx vitest run tests/integration/dailyQuestSystem.golden.test.ts
//   cp golden/dailyQuestSystem.json ../grimshade-backend/tests/Golden/fixtures/
//
// KLASYFIKACJA funkcji (patrz DailyQuestSystem.php):
//  - getTodayKey/needsRefresh → zależne od `new Date()`; SPARAMETRYZOWANE:
//    generator podmienia zegar (vi.setSystemTime) na stałą datę i zapisuje
//    wynikowy klucz "YYYY-MM-DD", a PHP dostaje (rok,miesiac,dzien) / klucz jako
//    argumenty. Format bit-exact (padStart 2 na miesiacu/dniu, rok bez paddingu).
//  - selectDailyQuests → NIE uzywa Math.random. Losowanie jest DETERMINISTYCZNE:
//    seed z hasha daty (32-bit signed, jak ((seed<<5)-seed+char)|0), potem LCG
//    (seed*1103515245+12345)&0x7fffffff w Fisher-Yates. Czyste → bit-parity.
//    UWAGA: iloczyn seed*1103515245 przekracza 2^53, wiec PHP odtwarza semantyke
//    float64 (fmod mod 2^32) 1:1 — bez tego rozjazd na ostatnich bitach.
//    Generator podmienia zegar, zeby ustalic seed (klucz daty) i zapisuje go
//    w fixture; PHP replayuje z tym samym kluczem.
//  - scaleRewards → czysta arytmetyka (Math.floor) → bit-parity.
//
// Brak RngInterface: system nie konsumuje Math.random (odroznienie od loot/boss).
// ============================================================================

const ALL_QUESTS = dailyQuestsRaw as unknown as IDailyQuestDef[];

/**
 * Uruchamia `fn` z zamrozonym zegarem na (rok, miesiac 1-12, dzien) lokalnie o
 * 12:00, tak by `new Date()` w getTodayKey zwrocilo dokladnie ta date. Poludnie
 * = bezpieczne wobec DST, komponenty lokalne round-trippuja niezaleznie od TZ.
 */
const withFixedDate = <T>(year: number, month: number, day: number, fn: () => T): T => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(year, month - 1, day, 12, 0, 0, 0));
    try {
        return fn();
    } finally {
        vi.useRealTimers();
    }
};

// --- Przypadki testowe ------------------------------------------------------

// Daty pokrywajace padding (miesiac/dzien < 10 → "0X"), leap day, granice roku.
const TODAY_KEY_DATES: Array<[number, number, number]> = [
    [2026, 7, 8], [2026, 1, 5], [2026, 12, 31], [2025, 6, 15],
    [2024, 2, 29], [2000, 10, 1], [1999, 11, 9], [2026, 3, 1],
];

// needsRefresh: null/pusty string → true, ta sama data → false, inna → true.
const NEEDS_REFRESH_CASES: Array<{ date: [number, number, number]; last: string | null }> = [
    { date: [2026, 7, 8], last: null },
    { date: [2026, 7, 8], last: '' },
    { date: [2026, 7, 8], last: '2026-07-08' },
    { date: [2026, 7, 8], last: '2026-07-07' },
    { date: [2026, 1, 5], last: '2026-01-05' },
    { date: [2026, 1, 5], last: '2025-12-31' },
    { date: [2024, 2, 29], last: '2024-02-29' },
    { date: [2024, 2, 29], last: '2024-03-01' },
];

// scaleRewards: bazy z/bez eliksiru + zera + wartosci wymuszajace floor.
const SCALE_BASES: IDailyQuestRewards[] = [
    { gold: 200, xp: 100 },
    { gold: 333, xp: 777 },
    { gold: 0, xp: 0 },
    { gold: 1, xp: 1, elixir: 'xp_elixir' },
    { gold: 2500, xp: 1200, elixir: 'skill_xp_elixir' },
    { gold: 8000, xp: 1500 },
];
const SCALE_LEVELS = [0, 1, 2, 5, 10, 25, 50, 100, 1000];

// selectDailyQuests: rozne daty (rozny seed) × poziomy. Poziomy dobrane pod
// obie sciezki: ≤12 eligible (0/24/25/30/34 → bez shuffle) i >12 (35+ → shuffle).
const SELECT_DATES: Array<[number, number, number]> = [
    [2026, 7, 8], [2026, 1, 1], [2026, 12, 31], [2025, 6, 15], [2024, 2, 29],
];
const SELECT_LEVELS = [0, 24, 25, 30, 34, 35, 40, 50, 60, 80, 100, 1000];

const buildGolden = (): Record<string, unknown> => ({
    system: 'dailyQuestSystem',
    note: 'Generowane z src/systems/dailyQuestSystem.ts. NIE edytuj recznie — regeneruj UPDATE_GOLDEN=1.',
    constants: { DAILY_QUEST_COUNT },

    todayKey: TODAY_KEY_DATES.map(([year, month, day]) => ({
        year,
        month,
        day,
        value: withFixedDate(year, month, day, () => getTodayKey()),
    })),

    needsRefresh: NEEDS_REFRESH_CASES.map(({ date, last }) =>
        withFixedDate(date[0], date[1], date[2], () => ({
            last,
            today: getTodayKey(),
            value: needsRefresh(last),
        })),
    ),

    scaleRewards: SCALE_BASES.flatMap((base) =>
        SCALE_LEVELS.map((playerLevel) => ({
            base,
            playerLevel,
            value: scaleRewards(base, playerLevel),
        })),
    ),

    selectDailyQuests: SELECT_DATES.flatMap((date) =>
        SELECT_LEVELS.map((playerLevel) =>
            withFixedDate(date[0], date[1], date[2], () => {
                const result = selectDailyQuests(ALL_QUESTS, playerLevel);
                return {
                    playerLevel,
                    today: getTodayKey(),
                    count: result.length,
                    ids: result.map((q) => q.id),
                    result,
                };
            }),
        ),
    ),
});

const outPath = resolve(process.cwd(), 'golden/dailyQuestSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('dailyQuestSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current dailyQuestSystem output', () => {
        expect(existsSync(outPath), 'brak golden/dailyQuestSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        // Normalizacja przez JSON — usuwa -0 / undefined (np. brak eliksiru),
        // ktore i tak serializuja sie identycznie po obu stronach. Wzor lootSystem.
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
