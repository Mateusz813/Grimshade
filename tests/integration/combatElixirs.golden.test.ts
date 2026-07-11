import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
    getAtkDamageMultiplier,
    getSpellDamageMultiplier,
    getElixirHpBonus,
    getElixirMpBonus,
    getElixirHpPctMultiplier,
    getElixirMpPctMultiplier,
    getElixirAtkBonus,
    getElixirDefBonus,
    getElixirAttackSpeedMultiplier,
    tickCombatElixirs,
} from '../../src/systems/combatElixirs';
import { useBuffStore, type IActiveBuff } from '../../src/stores/buffStore';
import { useCharacterStore } from '../../src/stores/characterStore';
import type { ICharacter } from '../../src/api/v1/characterApi';

// ============================================================================
// GOLDEN-VECTOR EXPORT + GUARD dla combatElixirs.
//
// combatElixirs.ts to CZYSTA matematyka mnożników / bonusów eliksirów bojowych
// czytana z buffStore. Bez RNG, bez Date.now — jedyne „wejście" to zbiór
// aktywnych buffów (hasBuff) oraz pozostały czas pausable (remainingMs).
//
// Decyzja portowa (reguła 4 — gettery czytające Zustand store):
//  - PHP dostaje stan JAWNIE jako parametry (czysta funkcja):
//      * gettery       -> lista aktywnych efektów (hasBuff == in_array),
//      * tickCombatElixirs -> mapa effect => remainingMs (pausable) + ms.
//  - Generator TS USTAWIA stan store (setState) i wywołuje REALNE funkcje TS,
//    żeby wektory pochodziły z produkcyjnego kodu, nie z re-implementacji.
//
// Dwie role:
//  1. UPDATE_GOLDEN=1 -> GENERUJE golden/combatElixirs.json z realnych funkcji.
//  2. Normalnie       -> GUARD: commitowany fixture == aktualny output TS.
//
// Regeneracja + kopia do backendu:
//   UPDATE_GOLDEN=1 npx vitest run tests/integration/combatElixirs.golden.test.ts
//   cp golden/combatElixirs.json ../grimshade-backend/tests/Golden/fixtures/
// ============================================================================

const CHAR_ID = 'char-elixir-golden';

const makeChar = (): ICharacter => ({
    id: CHAR_ID,
    user_id: 'user-golden',
    name: 'GoldenElixir',
    class: 'Knight',
    level: 10,
    xp: 0,
    hp: 100,
    max_hp: 100,
    mp: 50,
    max_mp: 50,
    attack: 20,
    defense: 10,
    attack_speed: 2.0,
    crit_chance: 5,
    crit_damage: 200,
    magic_level: 0,
    hp_regen: 0,
    mp_regen: 0,
    gold: 0,
    stat_points: 0,
    highest_level: 10,
    equipment: {},
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
});

const pausableBuff = (effect: string, remainingMs: number, i: number): IActiveBuff => ({
    id: `elixir_${effect}_${i}`,
    characterId: CHAR_ID,
    name: effect,
    icon: 'sparkles',
    effect,
    expiresAt: Number.POSITIVE_INFINITY,
    timerMode: 'pausable',
    remainingMs,
});

/** Wgraj świeży stan store: aktywna postać + podane pausable buffy. */
const setBuffs = (buffs: IActiveBuff[]): void => {
    useCharacterStore.setState({ character: makeChar(), isLoading: false });
    useBuffStore.setState({ allBuffs: buffs, combatSpeedMult: 1 });
};

// -- Gettery: stan = lista aktywnych efektów (każdy jako pausable, remainingMs>0)

const runGetters = (active: string[]): Record<string, number> => {
    setBuffs(active.map((e, i) => pausableBuff(e, 10_000, i)));
    return {
        atkDamageMultiplier: getAtkDamageMultiplier(),
        spellDamageMultiplier: getSpellDamageMultiplier(),
        hpBonus: getElixirHpBonus(),
        mpBonus: getElixirMpBonus(),
        hpPctMultiplier: getElixirHpPctMultiplier(),
        mpPctMultiplier: getElixirMpPctMultiplier(),
        atkBonus: getElixirAtkBonus(),
        defBonus: getElixirDefBonus(),
        attackSpeedMultiplier: getElixirAttackSpeedMultiplier(),
    };
};

// -- tickCombatElixirs: stan = mapa effect => remainingMs (pausable) + ms.
//    Wynik = przeżywające buffy (remainingMs>0) po drenażu, jako mapa.

const runTick = (input: Record<string, number>, ms: number): Record<string, number> => {
    const effects = Object.keys(input);
    setBuffs(effects.map((e, i) => pausableBuff(e, input[e], i)));
    tickCombatElixirs(ms);
    const out: Record<string, number> = {};
    for (const b of useBuffStore.getState().allBuffs) {
        if (b.characterId === CHAR_ID && b.timerMode === 'pausable' && b.remainingMs > 0) {
            out[b.effect] = b.remainingMs;
        }
    }
    return out;
};

// Scenariusze getterów — pojedyncze eliksiry, kaskady tierów (highest-first),
// niepowiązany buff (nie wpływa na eliksiry), oraz wszystko naraz.
const GETTER_SCENARIOS: string[][] = [
    [],
    ['atk_dmg_25'],
    ['atk_dmg_50'],
    ['atk_dmg_100'],
    ['atk_dmg_50', 'atk_dmg_25'],
    ['atk_dmg_100', 'atk_dmg_50', 'atk_dmg_25'],
    ['spell_dmg_25'],
    ['spell_dmg_50'],
    ['spell_dmg_100'],
    ['spell_dmg_100', 'spell_dmg_50', 'spell_dmg_25'],
    ['atk_dmg_100', 'spell_dmg_50'],
    ['hp_boost_500'],
    ['mp_boost_500'],
    ['atk_boost_50'],
    ['def_boost_50'],
    ['hp_pct_25'],
    ['mp_pct_25'],
    ['attack_speed'],
    ['xp_boost'],
    [
        'atk_dmg_100', 'spell_dmg_100', 'hp_boost_500', 'mp_boost_500',
        'atk_boost_50', 'def_boost_50', 'hp_pct_25', 'mp_pct_25', 'attack_speed',
    ],
];

// Scenariusze ticka — always-drain, grupy tierów (drenuje TYLKO najwyższy),
// zera, dokładny drenaż do 0 (usunięcie), ms > pozostały czas, ms=0, ms<0.
const TICK_SCENARIOS: Array<{ input: Record<string, number>; ms: number }> = [
    { input: {}, ms: 1000 },
    { input: { atk_boost_50: 5000 }, ms: 1000 },
    {
        input: {
            hp_boost_500: 5000, mp_boost_500: 5000, atk_boost_50: 5000,
            def_boost_50: 5000, hp_pct_25: 5000, mp_pct_25: 5000, attack_speed: 5000,
        },
        ms: 1000,
    },
    { input: { atk_dmg_100: 5000, atk_dmg_50: 5000, atk_dmg_25: 5000 }, ms: 1000 },
    { input: { atk_dmg_50: 5000, atk_dmg_25: 5000 }, ms: 1000 },
    { input: { atk_dmg_25: 5000 }, ms: 1000 },
    { input: { spell_dmg_100: 5000, spell_dmg_50: 5000, spell_dmg_25: 5000 }, ms: 1000 },
    {
        input: {
            atk_boost_50: 5000, atk_dmg_100: 5000, atk_dmg_50: 5000,
            spell_dmg_50: 5000, spell_dmg_25: 5000, attack_speed: 3000,
        },
        ms: 1000,
    },
    { input: { atk_boost_50: 5000, atk_dmg_100: 5000 }, ms: 0 },
    { input: { atk_boost_50: 1000 }, ms: 1000 },
    { input: { atk_boost_50: 1000, atk_dmg_100: 2000, atk_dmg_50: 500 }, ms: 5000 },
    { input: { atk_dmg_50: 1000, atk_dmg_25: 5000 }, ms: 1000 },
    { input: { xp_boost: 5000, atk_boost_50: 5000 }, ms: 1000 },
    { input: { atk_boost_50: 5000 }, ms: -500 },
    {
        input: {
            hp_boost_500: 1000, mp_boost_500: 1000, atk_boost_50: 1000,
            def_boost_50: 1000, hp_pct_25: 1000, mp_pct_25: 1000, attack_speed: 1000,
        },
        ms: 1000,
    },
];

const buildGolden = (): Record<string, unknown> => ({
    system: 'combatElixirs',
    note: 'Generowane z src/systems/combatElixirs.ts. NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1.',
    getters: GETTER_SCENARIOS.map((active) => ({ active, result: runGetters(active) })),
    tick: TICK_SCENARIOS.map(({ input, ms }) => ({ input, ms, result: runTick(input, ms) })),
});

const outPath = resolve(process.cwd(), 'golden/combatElixirs.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('combatElixirs golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current combatElixirs output', () => {
        expect(existsSync(outPath), 'brak golden/combatElixirs.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        // Normalizacja przez JSON (usuwa -0 itp.) — wzór z lootSystem.
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
