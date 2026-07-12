import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ELIXIRS, getElixirPrice } from '../../src/stores/shopStore';


const buildGolden = (): Record<string, unknown> => ({
    system: 'shopCatalog',
    note: 'Generowane z src/stores/shopStore.ts ELIXIRS. NIE edytuj ręcznie.',
    elixirs: ELIXIRS.map((e) => ({
        id: e.id,
        price: getElixirPrice(e, 1),
        minLevel: e.minLevel,
        effect: e.effect,
    })),
});

const outPath = resolve(process.cwd(), 'golden/shopCatalog.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('shopCatalog golden (współdzielony katalog cen)', () => {
    it('committed catalog matches current ELIXIRS', () => {
        expect(existsSync(outPath), 'brak golden/shopCatalog.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
