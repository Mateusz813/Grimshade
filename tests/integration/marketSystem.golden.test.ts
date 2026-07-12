import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
    isValidPrice,
    isValidQuantity,
    calculateMarketTax,
    isStackKind,
    type MarketKind,
} from '../../src/systems/marketSystem';


const PRICE_CASES = [0, 1, 100, 999_999_999, 1_000_000_000, -5, 2.5];
const QTY_CASES: Array<[number, number | null]> = [
    [0, null], [1, null], [999_999, null], [1_000_000, null], [5, 10], [11, 10], [2.5, null],
];
const TAX_CASES = [0, 1, 100, 999, 1000, 12345, 999_999_999];
const KIND_CASES: MarketKind[] = ['item', 'potion', 'elixir', 'stone', 'arena_points', 'spell_chest'];

const buildGolden = (): Record<string, unknown> => ({
    system: 'marketSystem',
    note: 'Generowane z src/systems/marketSystem.ts (walidatory + tax). NIE edytuj ręcznie.',
    isValidPrice: PRICE_CASES.map((price) => ({ price, value: isValidPrice(price) })),
    isValidQuantity: QTY_CASES.map(([qty, max]) => ({
        qty, max, value: max === null ? isValidQuantity(qty) : isValidQuantity(qty, max),
    })),
    calculateMarketTax: TAX_CASES.map((price) => ({ price, value: calculateMarketTax(price) })),
    isStackKind: KIND_CASES.map((kind) => ({ kind, value: isStackKind(kind) })),
});

const outPath = resolve(process.cwd(), 'golden/marketSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('marketSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current marketSystem output', () => {
        expect(existsSync(outPath), 'brak golden/marketSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(computed).toEqual(fixture);
    });
});
