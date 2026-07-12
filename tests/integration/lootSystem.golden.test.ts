import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Mulberry32 } from '../../src/systems/rng/mulberry32';
import {
    scaleHeroicDropRate,
    getGeneratedSellPrice,
    getMaxRarityForLevel,
    getEffectiveRarityChances,
    rollMonsterRarity,
    rollRarity,
    rollStoneDrop,
    calculateGoldDrop,
    rollPotionDrop,
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

const SEEDS = [1, 2, 3, 7, 13, 42, 99, 100, 777, 2654435761, 123456, 987654];
const HEAVY_MASTERY: IMasteryRarityBonuses = { strong: 30, epic: 20, legendary: 10, mythic: 5, heroic: 0 };
const MRARITIES: TMonsterRarity[] = ['normal', 'strong', 'epic', 'legendary', 'boss'];

const buildGolden = (): Record<string, unknown> => ({
    system: 'lootSystem',
    note: 'Generowane z src/systems/lootSystem.ts (podzbiór). Funkcje RNG: seed + mulberry32. NIE edytuj ręcznie.',

    scaleHeroicDropRate: [[0.005, 1], [0.005, 100], [0.005, 200], [0.005, 500], [0.005, 1000], [0, 50]]
        .map(([rate, lvl]) => ({ rate, lvl, value: scaleHeroicDropRate(rate, lvl) })),
    getGeneratedSellPrice: (['common', 'rare', 'epic', 'legendary', 'mythic', 'heroic'])
        .flatMap((r) => [1, 50, 500].map((lvl) => ({ rarity: r, lvl, value: getGeneratedSellPrice(r, lvl) }))),
    getMaxRarityForLevel: [1, 30, 31, 60, 61, 100, 500].map((lvl) => ({ lvl, value: getMaxRarityForLevel(lvl) })),
    getEffectiveRarityChances: [
        { m: null, value: getEffectiveRarityChances() },
        { m: HEAVY_MASTERY, value: getEffectiveRarityChances(HEAVY_MASTERY) },
    ],

    rollMonsterRarity: SEEDS.flatMap((seed) => [
        { seed, skip: false, mastery: null, value: withSeed(seed, () => rollMonsterRarity(false)) },
        { seed, skip: false, mastery: HEAVY_MASTERY, value: withSeed(seed, () => rollMonsterRarity(false, HEAVY_MASTERY)) },
    ]),
    rollRarity: SEEDS.flatMap((seed) => [
        { seed, monsterRarity: 'normal' as TMonsterRarity, heroic: 0, value: withSeed(seed, () => rollRarity('normal', 0)) },
        { seed, monsterRarity: 'boss' as TMonsterRarity, heroic: 0.5, value: withSeed(seed, () => rollRarity('boss', 0.5)) },
    ]),
    rollStoneDrop: SEEDS.flatMap((seed) => MRARITIES.map((mr) => ({
        seed, monsterLevel: 100, monsterRarity: mr, value: withSeed(seed, () => rollStoneDrop(100, mr)),
    }))),
    calculateGoldDrop: SEEDS.flatMap((seed) => [
        { seed, goldRange: [10, 40] as [number, number], partySize: 1, value: withSeed(seed, () => calculateGoldDrop([10, 40], 1)) },
        { seed, goldRange: [100, 500] as [number, number], partySize: 4, value: withSeed(seed, () => calculateGoldDrop([100, 500], 4)) },
    ]),
    rollPotionDrop: SEEDS.flatMap((seed) => [10, 60, 150, 700].map((lvl) => ({
        seed, monsterLevel: lvl, value: withSeed(seed, () => rollPotionDrop(lvl)),
    }))),
});

const outPath = resolve(process.cwd(), 'golden/lootSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('lootSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current lootSystem output', () => {
        expect(existsSync(outPath), 'brak golden/lootSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
