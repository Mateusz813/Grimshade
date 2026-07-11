import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
    getPotionMinLevel,
    canUsePotionAtLevel,
    isHpMpPotionId,
} from '../../src/systems/potionGating';
import {
    isPctPotion,
    isPctPotionId,
    isFlatPotionId,
    getPotionCooldownMs,
    getPotionLabel,
    getBestPotion,
    resolveAutoPotionElixir,
    ALL_HP_POTIONS,
    ALL_MP_POTIONS,
    FLAT_HP_POTIONS,
    FLAT_MP_POTIONS,
    PCT_HP_POTIONS,
    PCT_MP_POTIONS,
    PCT_POTION_MIN_LEVEL,
} from '../../src/systems/potionSystem';
import {
    POTION_CONVERSIONS,
    getMaxConversions,
    checkConversionAvailability,
} from '../../src/systems/potionConversion';

// ============================================================================
// GOLDEN-VECTOR EXPORT + GUARD dla potionSystem (potionSystem.ts +
// potionConversion.ts + potionGating.ts).
//
// System CZYSTY/deterministyczny (zero RNG) — golden bit-parity. Backend
// (App\Domain\Items\PotionSystem) odtwarza każdy wektor bajt-w-bajt.
//
// Dwie role:
//  1. UPDATE_GOLDEN=1 → GENERUJE golden/potionSystem.json z realnych funkcji.
//  2. Normalnie → GUARD: fixture == aktualny output TS (zmiana logiki bez
//     regeneracji → czerwień).
//
// Regeneracja + kopia do backendu:
//   UPDATE_GOLDEN=1 npx vitest run tests/integration/potionSystem.golden.test.ts
//   cp golden/potionSystem.json ../grimshade-backend/tests/Golden/fixtures/
//
// POMINIĘTO (UI, nie autorytet): name_pl/name_en/description/icon/price z
// ELIXIRS oraz inputName/inputIcon/outputName/outputIcon z konwersji. Portujemy
// TYLKO logikę: id, effect, kolejność pul, gating po poziomie, koszty i sortowanie
// konwersji, wartości leczenia parsowane z effect-stringa (protokół).
// ============================================================================

/** Pule potek (id-only reprezentacja pobierana po nazwie w PHP i TS). */
const POOLS: Record<string, ReadonlyArray<{ id: string; effect: string }>> = {
    allHp: ALL_HP_POTIONS,
    allMp: ALL_MP_POTIONS,
    flatHp: FLAT_HP_POTIONS,
    flatMp: FLAT_MP_POTIONS,
    pctHp: PCT_HP_POTIONS,
    pctMp: PCT_MP_POTIONS,
    empty: [],
};

// -- Kolekcje przypadków ------------------------------------------------------

const POTION_IDS = [
    'hp_potion_sm', 'hp_potion_md', 'hp_potion_lg', 'hp_potion_mega',
    'hp_potion_great', 'hp_potion_super', 'hp_potion_ultimate', 'hp_potion_divine',
    'mp_potion_sm', 'mp_potion_md', 'mp_potion_lg', 'mp_potion_mega',
    'mp_potion_great', 'mp_potion_super', 'mp_potion_ultimate', 'mp_potion_divine',
];

// Nie-poteki + brzegowe id (nieznany tier, prefiks bez podkreślenia, pusty).
const MISC_IDS = ['xp_boost', 'stat_reset', 'hp_potion_weird', 'hp_potionx', 'HP_POTION_sm', 'unknown', ''];

const MIN_LEVEL_IDS = [...POTION_IDS, ...MISC_IDS];

const CAN_USE_CASES: Array<[string, number]> = [
    ['hp_potion_sm', 0], ['hp_potion_sm', 1],
    ['hp_potion_great', 199], ['hp_potion_great', 200], ['hp_potion_great', 201],
    ['hp_potion_divine', 699], ['hp_potion_divine', 700],
    ['mp_potion_lg', 49], ['mp_potion_lg', 50],
    ['xp_boost', 0], ['xp_boost', 1], ['unknown', 1], ['', 1],
];

const IS_HP_MP_IDS = ['hp_potion_sm', 'mp_potion_divine', 'xp_boost', 'hp_potionx', 'HP_POTION_sm', ''];

const EFFECTS = [
    'heal_hp_50', 'heal_hp_150', 'heal_hp_400', 'heal_hp_1000',
    'heal_hp_pct_20', 'heal_hp_pct_35', 'heal_hp_pct_50', 'heal_hp_pct_100',
    'heal_mp_30', 'heal_mp_100', 'heal_mp_300', 'heal_mp_1000',
    'heal_mp_pct_20', 'heal_mp_pct_35', 'heal_mp_pct_50', 'heal_mp_pct_100',
    '_pct_', 'xp_boost_1h', 'heal_hp_', 'heal_hp_pct_', '',
];

const COOLDOWN_IDS = [...POTION_IDS, 'xp_boost', 'unknown'];

const BEST_CASES: Array<{ pool: string; consumables: Record<string, number>; level: number | null }> = [
    { pool: 'allHp', consumables: {}, level: null },
    { pool: 'allHp', consumables: {}, level: 1 },
    { pool: 'allHp', consumables: { hp_potion_md: 2 }, level: 1 },
    { pool: 'allHp', consumables: { hp_potion_md: 2 }, level: 20 },
    { pool: 'allHp', consumables: { hp_potion_divine: 1 }, level: 700 },
    { pool: 'allHp', consumables: { hp_potion_divine: 1 }, level: 699 },
    { pool: 'flatHp', consumables: { hp_potion_mega: 0 }, level: 100 },
    { pool: 'pctMp', consumables: { mp_potion_great: 5 }, level: 200 },
    { pool: 'allHp', consumables: { hp_potion_sm: -3 }, level: 50 },
    { pool: 'flatMp', consumables: {}, level: 1000 },
    { pool: 'empty', consumables: {}, level: 1 },
];

const RESOLVE_CASES: Array<{
    preferredId: string | null;
    hpOrMp: 'hp' | 'mp';
    slotKind: 'flat' | 'pct';
    consumables: Record<string, number>;
    level: number | null;
}> = [
    { preferredId: 'hp_potion_great', hpOrMp: 'hp', slotKind: 'pct', consumables: { hp_potion_great: 3 }, level: 200 },
    { preferredId: 'hp_potion_great', hpOrMp: 'hp', slotKind: 'pct', consumables: { hp_potion_great: 3 }, level: 199 },
    { preferredId: null, hpOrMp: 'hp', slotKind: 'flat', consumables: { hp_potion_lg: 5 }, level: 50 },
    { preferredId: 'mp_potion_divine', hpOrMp: 'mp', slotKind: 'pct', consumables: { mp_potion_super: 2 }, level: 700 },
    { preferredId: 'nonexistent_id', hpOrMp: 'hp', slotKind: 'flat', consumables: { hp_potion_sm: 1 }, level: 1 },
    { preferredId: 'xp_boost', hpOrMp: 'hp', slotKind: 'flat', consumables: { xp_boost: 5 }, level: 1 },
    { preferredId: null, hpOrMp: 'mp', slotKind: 'flat', consumables: {}, level: 100 },
    { preferredId: 'hp_potion_divine', hpOrMp: 'hp', slotKind: 'pct', consumables: { hp_potion_divine: 1 }, level: null },
    { preferredId: '', hpOrMp: 'hp', slotKind: 'flat', consumables: { hp_potion_sm: 2 }, level: 1 },
];

const byOutput = (outputId: string) => {
    const conv = POTION_CONVERSIONS.find((c) => c.outputId === outputId);
    if (!conv) throw new Error(`brak konwersji dla ${outputId}`);
    return conv;
};

const GET_MAX_CASES: Array<[string, number]> = [
    ['hp_potion_md', 0], ['hp_potion_md', 4], ['hp_potion_md', 5], ['hp_potion_md', 12],
    ['hp_potion_great', 333], ['hp_potion_great', 334], ['hp_potion_great', 700],
    ['hp_potion_super', 5], ['hp_potion_mega', 100], ['hp_potion_md', -10],
];

const CHECK_CASES: Array<[string, number, number | null]> = [
    ['hp_potion_great', 334, 200],
    ['hp_potion_great', 334, 199],
    ['hp_potion_md', 4, 20],
    ['hp_potion_divine', 10, 700],
    ['hp_potion_mega', 100, null],
    ['hp_potion_super', 0, 350],
];

const buildGolden = (): Record<string, unknown> => ({
    system: 'potionSystem',
    note: 'Generowane z src/systems/potionSystem.ts + potionConversion.ts + potionGating.ts. NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1.',

    // -- potionGating ---------------------------------------------------------
    pctPotionMinLevel: PCT_POTION_MIN_LEVEL,
    getPotionMinLevel: MIN_LEVEL_IDS.map((id) => ({ id, value: getPotionMinLevel(id) })),
    canUsePotionAtLevel: CAN_USE_CASES.map(([id, level]) => ({ id, level, value: canUsePotionAtLevel(id, level) })),
    isHpMpPotionId: IS_HP_MP_IDS.map((id) => ({ id, value: isHpMpPotionId(id) })),

    // -- Kategoryzacja + cooldowny + etykieta leczenia ------------------------
    isPctPotion: EFFECTS.map((effect) => ({ effect, value: isPctPotion(effect) })),
    isPctPotionId: MIN_LEVEL_IDS.map((id) => ({ id, value: isPctPotionId(id) })),
    isFlatPotionId: MIN_LEVEL_IDS.map((id) => ({ id, value: isFlatPotionId(id) })),
    getPotionCooldownMs: COOLDOWN_IDS.map((id) => ({ id, value: getPotionCooldownMs(id) })),
    getPotionLabel: EFFECTS.map((effect) => ({ effect, value: getPotionLabel(effect) })),

    // -- Pule potek (kolejność jest logiką) -----------------------------------
    pools: Object.fromEntries(
        Object.entries(POOLS).map(([name, pool]) => [name, pool.map((p) => p.id)]),
    ),

    // -- Gettery czytające stan (consumables + level jako jawne parametry) -----
    getBestPotion: BEST_CASES.map((c) => ({
        pool: c.pool,
        consumables: c.consumables,
        level: c.level,
        resultId: (c.level === null
            ? getBestPotion(POOLS[c.pool] as never, c.consumables)
            : getBestPotion(POOLS[c.pool] as never, c.consumables, c.level))?.id ?? null,
    })),
    resolveAutoPotionElixir: RESOLVE_CASES.map((c) => ({
        preferredId: c.preferredId,
        hpOrMp: c.hpOrMp,
        slotKind: c.slotKind,
        consumables: c.consumables,
        level: c.level,
        resultId: (c.level === null
            ? resolveAutoPotionElixir(c.preferredId ?? undefined, c.hpOrMp, c.slotKind, c.consumables)
            : resolveAutoPotionElixir(c.preferredId ?? undefined, c.hpOrMp, c.slotKind, c.consumables, c.level))?.id ?? null,
    })),

    // -- Konwersja (chain, sort, gating) --------------------------------------
    potionConversions: POTION_CONVERSIONS.map((c) => ({
        tier: c.tier,
        family: c.family,
        inputId: c.inputId,
        inputCount: c.inputCount,
        outputId: c.outputId,
        outputMinLevel: c.outputMinLevel,
    })),
    getMaxConversions: GET_MAX_CASES.map(([outputId, ownedInput]) => {
        const conv = byOutput(outputId);
        return { outputId, inputCount: conv.inputCount, ownedInput, value: getMaxConversions(conv, ownedInput) };
    }),
    checkConversionAvailability: CHECK_CASES.map(([outputId, ownedInput, level]) => {
        const conv = byOutput(outputId);
        return {
            outputId,
            inputCount: conv.inputCount,
            ownedInput,
            level,
            result: level === null
                ? checkConversionAvailability(conv, ownedInput)
                : checkConversionAvailability(conv, ownedInput, level),
        };
    }),
});

const outPath = resolve(process.cwd(), 'golden/potionSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('potionSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current potionSystem output', () => {
        expect(existsSync(outPath), 'brak golden/potionSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        // Normalizacja przez JSON (usuwa -0), wzór lootSystem — parytet nienaruszony.
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
