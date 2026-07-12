import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
    getRequiredStoneType,
    getEnhancementCost,
    getEnhancementMultiplier,
    getUpgradedBaseStat,
    getGearGapMultiplier,
    getEnhancementRefund,
    getSellPrice,
    type Rarity,
    type IInventoryItem,
    type IBaseItem,
} from '../../src/systems/itemSystem';


const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic', 'heroic'];
const COST_LEVELS = [1, 2, 5, 10, 20, 21, 25, 30];
const MULT_LEVELS = [0, 1, 3, 5, 7, 30];
const UPGRADED_CASES: Array<[number, number]> = [[0, 5], [10, 0], [10, 3], [2, 5], [100, 7], [50, 30]];
const GAP_CASES: Array<[number, number]> = [[100, 100], [50, 100], [150, 100], [100, 200], [0, 100], [10, 1000]];
const REFUND_CASES: Array<[number, Rarity]> = [[0, 'common'], [3, 'common'], [5, 'epic'], [10, 'heroic'], [20, 'legendary']];

const mkItem = (rarity: Rarity, itemLevel: number, upgradeLevel: number): IInventoryItem => ({
    uuid: 'u', itemId: 'i', rarity, bonuses: {}, itemLevel, upgradeLevel,
});
const mkBase = (basePrice: number, rarity: Rarity): IBaseItem => ({
    id: 'i', name_pl: 'x', name_en: 'x', slot: 'armor', minLevel: 1, basePrice, rarity,
});

const SELL_CASES = [
    { item: mkItem('common', 10, 0), base: undefined },
    { item: mkItem('rare', 50, 2), base: undefined },
    { item: mkItem('heroic', 100, 5), base: undefined },
    { item: mkItem('mythic', 200, 0), base: undefined },
    { item: mkItem('epic', 20, 0), base: mkBase(1000, 'epic') },
    { item: mkItem('legendary', 30, 3), base: mkBase(5000, 'legendary') },
];

const buildGolden = (): Record<string, unknown> => ({
    system: 'itemSystem',
    note: 'Generowane z src/systems/itemSystem.ts (podzbiór ekonomiczny). NIE edytuj ręcznie.',
    getRequiredStoneType: RARITIES.map((r) => ({ rarity: r, value: getRequiredStoneType(r) })),
    getEnhancementCost: COST_LEVELS.flatMap((lvl) =>
        (['common', 'epic', 'heroic'] as Rarity[]).map((r) => ({ lvl, rarity: r, result: getEnhancementCost(lvl, r) })),
    ),
    getEnhancementMultiplier: MULT_LEVELS.map((u) => ({ u, value: getEnhancementMultiplier(u) })),
    getUpgradedBaseStat: UPGRADED_CASES.map(([base, u]) => ({ base, u, value: getUpgradedBaseStat(base, u) })),
    getGearGapMultiplier: GAP_CASES.map(([g, c]) => ({ gear: g, content: c, value: getGearGapMultiplier(g, c) })),
    getEnhancementRefund: REFUND_CASES.map(([lvl, r]) => ({ lvl, rarity: r, result: getEnhancementRefund(lvl, r) })),
    getSellPrice: SELL_CASES.map((c) => ({
        item: { rarity: c.item.rarity, itemLevel: c.item.itemLevel, upgradeLevel: c.item.upgradeLevel },
        basePrice: c.base?.basePrice ?? null,
        value: getSellPrice(c.item, c.base),
    })),
});

const outPath = resolve(process.cwd(), 'golden/itemSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('itemSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current itemSystem output', () => {
        expect(existsSync(outPath), 'brak golden/itemSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(computed).toEqual(fixture);
    });
});
