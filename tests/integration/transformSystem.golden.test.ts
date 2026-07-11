import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
    getTransformTierMultiplier,
    getClassTransformBonuses,
    getAllTransforms,
    getTransformById,
    getTransformMonsters,
    getTransformMonsterCount,
    getTransformBonuses,
    getCumulativeTransformBonuses,
    isLevelSufficient,
    getNextAvailableTransform,
    getHighestCompletedTransform,
    getActiveAvatar,
    applyTransformBossStats,
    applyTransformTierStats,
    resolveActiveOpponentSlot,
    calculateTransformRewards,
    TRANSFORM_COUNT,
    TRANSFORM_SLOT_TIERS,
    TRANSFORM_BOSS_MULTIPLIER,
    TRANSFORM_TIER_MULTIPLIERS,
    type TTransformTier,
} from '../../src/systems/transformSystem';
import {
    getTransformDmgMultiplier,
    getTransformFlatHp,
    getTransformFlatMp,
    getTransformFlatAttack,
    getTransformFlatDefense,
    getTransformHpRegenFlat,
    getTransformMpRegenFlat,
    getTransformHpPctMultiplier,
    getTransformMpPctMultiplier,
    getTransformDefPctMultiplier,
    getTransformAtkPctMultiplier,
    getLiveTransformBreakdown,
    getDisplayTransformBreakdown,
} from '../../src/systems/transformBonuses';
import { useCharacterStore } from '../../src/stores/characterStore';
import { useTransformStore } from '../../src/stores/transformStore';
import type { ICharacter, TCharacterClass } from '../../src/api/v1/characterApi';
import type { IMonster } from '../../src/types/monster';

// ============================================================================
// GOLDEN-VECTOR EXPORT + GUARD dla transformSystem (+ transformBonuses).
//
// Żyje w tests/integration/ (nie w src), bo używa API node (fs) do zapisu
// fixture oraz ustawia stan Zustand store'ów (useTransformStore.setState /
// useCharacterStore.setState) żeby wygenerować wektory dla stateful getterów
// z transformBonuses.ts (rule 4: getter store → czysta funkcja z jawnym
// stanem jako parametr; generator ustawia store przed wywołaniem).
//
// Dwie role:
//  1. UPDATE_GOLDEN=1 → GENERUJE golden/transformSystem.json z realnych funkcji.
//  2. Normalnie → GUARD: asertuje, że commitowany fixture == aktualny output TS.
//
// Fixture jest kopiowany do backendu (grimshade-backend/tests/Golden/fixtures/
// transformSystem.json), gdzie Pest odtwarza go w PHP → parytet TS↔PHP.
//
// Regeneracja + kopia do backendu:
//   UPDATE_GOLDEN=1 npx vitest run tests/integration/transformSystem.golden.test.ts
//   cp golden/transformSystem.json ../grimshade-backend/tests/Golden/fixtures/
//
// ŚWIADOMIE POMINIĘTE (nie w fixture, patrz TransformSystem.php docblock):
//  - getTransformColor (kolory/CSS UI — rule 5),
//  - getTransformWaveLineup (buduje spriteImageUrl przez getMonsterImage — UI;
//    jego rdzeń liczbowy pokrywa applyTransformTierStats + scaleMonsterStats),
//  - weapon z calculateTransformRewards (generateWeapon = RNG w systemie
//    itemGenerator, poza zakresem tego systemu) — testujemy część
//    deterministyczną: consumables + permanentBonuses.
// ============================================================================

const CLASSES: TCharacterClass[] = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'];

// Pełny, type-poprawny ICharacter dla store'a (gettery czytają tylko char.class).
const makeChar = (cls: TCharacterClass): ICharacter => ({
    id: 'char-tx-golden',
    user_id: 'user-1',
    name: 'Golden',
    class: cls,
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

// Ustawia stan store'ów i wywołuje getter (rule 4). cls === null → brak postaci.
const withState = <T>(cls: TCharacterClass | null, ids: number[], baked: boolean, fn: () => T): T => {
    useCharacterStore.setState({ character: cls === null ? null : makeChar(cls), isLoading: false });
    useTransformStore.setState({
        completedTransforms: ids,
        currentTransformQuest: null,
        bakedBonusesApplied: baked,
        pendingClaimTransformId: null,
    });
    return fn();
};

// Wyciąga wygenerowany monster dla danego poziomu (przez getTransformMonsters),
// żeby przetestować prywatne scaleMonsterStats + findClosestMonster + gold.
const monsterForLevel = (level: number): IMonster | null => {
    const t = getAllTransforms().find(
        (tr) => level >= tr.monsterLevelRange[0] && level <= tr.monsterLevelRange[1],
    );
    if (!t) return null;
    return getTransformMonsters(t.id)[level - t.monsterLevelRange[0]] ?? null;
};

// -- Fixtury wejściowe --------------------------------------------------------

const TIER_IDS = [0, -1, 1, 2, 3, 5, 6, 10, 11, 12, 100];
const BONUS_IDS: Array<number | null> = [null, 1, 2, 5, 6, 11];
const MONSTER_LEVELS = [
    1, 2, 15, 30, 31, 40, 50, 51, 60, 100, 101, 125, 150, 151, 200, 201, 250, 300,
    301, 400, 500, 501, 700, 701, 800, 801, 900, 901, 950, 1000,
];
const COUNT_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 99];
const TIERS: TTransformTier[] = ['Normal', 'Strong', 'Epic', 'Boss'];

// Reprezentatywne monstery do apply* (jeden bez attack_min/max = ścieżka fallback,
// jeden z jawnymi min/max, jeden słaby = testuje klamry max(1, ...)).
const monsterNoMinMax: IMonster = {
    id: 'orc', name_pl: 'Ork', name_en: 'Orc', level: 20, hp: 250, attack: 28,
    defense: 8, speed: 2, xp: 120, gold: [20, 40], dropTable: [], sprite: 'orc',
};
const monsterWithMinMax: IMonster = {
    id: 'drake', name_pl: 'Smok', name_en: 'Drake', level: 60, hp: 900, attack: 55,
    attack_min: 40, attack_max: 70, defense: 24, speed: 3, xp: 800, gold: [200, 400],
    dropTable: [], sprite: 'drake',
};
const monsterWeak: IMonster = {
    id: 'weak', name_pl: 'Słaby', name_en: 'Weak', level: 1, hp: 1, attack: 1,
    defense: 0, speed: 1, xp: 1, gold: [0, 0], dropTable: [], sprite: 'weak',
};
const APPLY_MONSTERS = [monsterNoMinMax, monsterWithMinMax, monsterWeak];

// Escort-sloty do resolveActiveOpponentSlot (null = już wyczyszczony escort).
const ESCORT_CASES: Array<Array<{ currentHp: number } | null>> = [
    [{ currentHp: 10 }, { currentHp: 10 }, { currentHp: 10 }],
    [{ currentHp: 0 }, { currentHp: 10 }, { currentHp: 10 }],
    [{ currentHp: 0 }, { currentHp: 0 }, { currentHp: 10 }],
    [{ currentHp: 0 }, { currentHp: 0 }, { currentHp: 0 }],
    [null, { currentHp: 5 }, null],
    [null, null, null],
    [{ currentHp: 0 }, null, { currentHp: 3 }],
];

const HIGHEST_ID_LISTS = [[], [1], [3, 1, 2], [11, 5], [7, 7, 7], [2, 9, 4]];
const CUMULATIVE_ID_LISTS = [[], [1], [1, 2, 3], [1, 2, 3, 11], [5, 5], [1, 99, 3], [11]];
const AVATAR_ID_LISTS = [[], [1], [1, 2, 3], [10, 11], [99]];

const LEVEL_SUFFICIENT_CASES: Array<[number, number]> = [
    [1, 1], [29, 1], [30, 1], [50, 2], [49, 2], [100, 3], [999, 11], [1000, 11], [1000, 12],
];

const NEXT_AVAILABLE_CASES: Array<[number[], number]> = [
    [[], 1], [[], 29], [[], 30], [[1], 49], [[1], 50], [[1, 2, 3], 150],
    [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1000], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 1000],
];

const REWARD_CASES: Array<[number, TCharacterClass]> = [
    [1, 'Knight'], [2, 'Mage'], [5, 'Archer'], [7, 'Cleric'], [8, 'Rogue'],
    [10, 'Necromancer'], [11, 'Bard'], [3, 'Mage'], [0, 'Knight'], [12, 'Mage'],
];

// Kombinacje (klasa/brak, lista ukończonych) dla getterów transformBonuses.
const BONUS_STATE_CASES: Array<{ cls: TCharacterClass | null; ids: number[] }> = [
    { cls: null, ids: [1, 2, 3] },
    { cls: 'Knight', ids: [] },
    { cls: 'Knight', ids: [1] },
    { cls: 'Mage', ids: [1, 2, 3] },
    { cls: 'Mage', ids: [1, 2, 3, 11] },
    { cls: 'Archer', ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
    { cls: 'Cleric', ids: [3, 3, 5] },
    { cls: 'Rogue', ids: [1, 99, 5] },
    { cls: 'Bard', ids: [11] },
    { cls: 'Necromancer', ids: [2, 4, 6] },
];

const buildGolden = (): Record<string, unknown> => ({
    system: 'transformSystem',
    note: 'Generowane z src/systems/transformSystem.ts + transformBonuses.ts. NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1.',

    // -- Stałe --------------------------------------------------------------
    constants: {
        TRANSFORM_COUNT,
        TRANSFORM_SLOT_TIERS: [...TRANSFORM_SLOT_TIERS],
        TRANSFORM_BOSS_MULTIPLIER,
        TRANSFORM_TIER_MULTIPLIERS,
    },

    // -- Pure ---------------------------------------------------------------
    getTransformTierMultiplier: TIER_IDS.map((id) => ({ id, value: getTransformTierMultiplier(id) })),
    getClassTransformBonuses: CLASSES.flatMap((cls) =>
        BONUS_IDS.map((id) => ({ cls, id, value: getClassTransformBonuses(cls, id ?? undefined) })),
    ),
    applyTransformBossStats: APPLY_MONSTERS.map((m) => ({ monster: m, value: applyTransformBossStats(m) })),
    applyTransformTierStats: APPLY_MONSTERS.flatMap((m) =>
        TIERS.map((tier) => ({ monster: m, tier, value: applyTransformTierStats(m, tier) })),
    ),
    resolveActiveOpponentSlot: ESCORT_CASES.map((escorts) => ({ escorts, value: resolveActiveOpponentSlot(escorts) })),
    getHighestCompletedTransform: HIGHEST_ID_LISTS.map((ids) => ({ ids, value: getHighestCompletedTransform(ids) })),

    // -- Treść (transforms/monsters.json) -----------------------------------
    getTransformById: [0, 1, 5, 8, 11, 12].map((id) => ({ id, value: getTransformById(id) ?? null })),
    getTransformMonsterCount: COUNT_IDS.map((id) => ({ id, value: getTransformMonsterCount(id) })),
    generateTransformBossMonster: MONSTER_LEVELS.map((level) => ({ level, value: monsterForLevel(level) })),
    getTransformBonuses: CLASSES.flatMap((cls) =>
        [0, 1, 6, 11, 12].map((id) => ({ cls, id, value: getTransformBonuses(id, cls) })),
    ),
    // Brak klasy → zawsze EMPTY_BONUSES (nawet dla poprawnego id).
    getTransformBonusesNoClass: [1, 6, 12].map((id) => ({ id, value: getTransformBonuses(id) })),
    getCumulativeTransformBonuses: CLASSES.flatMap((cls) =>
        CUMULATIVE_ID_LISTS.map((ids) => ({ cls, ids, value: getCumulativeTransformBonuses(ids, cls) })),
    ),
    // Brak klasy → wszystkie sumy zerowe.
    getCumulativeTransformBonusesNoClass: CUMULATIVE_ID_LISTS.map((ids) => ({ ids, value: getCumulativeTransformBonuses(ids) })),
    isLevelSufficient: LEVEL_SUFFICIENT_CASES.map(([level, id]) => ({ level, id, value: isLevelSufficient(level, id) })),
    getNextAvailableTransform: NEXT_AVAILABLE_CASES.map(([ids, level]) => ({ ids, level, value: getNextAvailableTransform(ids, level) })),
    getActiveAvatar: CLASSES.flatMap((cls) =>
        AVATAR_ID_LISTS.map((ids) => ({ cls, ids, value: getActiveAvatar(cls, ids) })),
    ),
    calculateTransformRewardsDeterministic: REWARD_CASES.map(([id, cls]) => {
        const full = calculateTransformRewards(id, cls);
        // weapon POMINIĘTY (RNG/itemGenerator) — parytet tylko consumables + permanentBonuses.
        return { id, cls, value: { consumables: full.consumables, permanentBonuses: full.permanentBonuses } };
    }),

    // -- transformBonuses.ts (stateful → jawny stan) ------------------------
    getTransformDmgMultiplier: BONUS_STATE_CASES.map(({ cls, ids }) => ({
        cls, ids, value: withState(cls, ids, false, () => getTransformDmgMultiplier()),
    })),
    transformFlatBonuses: BONUS_STATE_CASES.map(({ cls, ids }) => ({
        cls, ids,
        value: withState(cls, ids, false, () => ({
            flatHp: getTransformFlatHp(),
            flatMp: getTransformFlatMp(),
            flatAttack: getTransformFlatAttack(),
            flatDefense: getTransformFlatDefense(),
            hpRegenFlat: getTransformHpRegenFlat(),
            mpRegenFlat: getTransformMpRegenFlat(),
        })),
    })),
    transformPctMultipliers: BONUS_STATE_CASES.map(({ cls, ids }) => ({
        cls, ids,
        value: withState(cls, ids, false, () => ({
            hp: getTransformHpPctMultiplier(),
            mp: getTransformMpPctMultiplier(),
            def: getTransformDefPctMultiplier(),
            atk: getTransformAtkPctMultiplier(),
        })),
    })),
    getLiveTransformBreakdown: BONUS_STATE_CASES.map(({ cls, ids }) => ({
        cls, ids, value: withState(cls, ids, false, () => getLiveTransformBreakdown()),
    })),
    getDisplayTransformBreakdown: BONUS_STATE_CASES.flatMap(({ cls, ids }) =>
        [false, true].map((baked) => ({
            cls, ids, baked, value: withState(cls, ids, baked, () => getDisplayTransformBreakdown()),
        })),
    ),
});

const outPath = resolve(process.cwd(), 'golden/transformSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('transformSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current transformSystem output', () => {
        expect(existsSync(outPath), 'brak golden/transformSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        // Normalizacja przez JSON — usuwa -0 (identyczne w PHP i tak liczącym 0).
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
