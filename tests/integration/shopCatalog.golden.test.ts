import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ELIXIRS, getElixirPrice } from '../../src/stores/shopStore';

// KATALOG SKLEPU jako współdzielona treść (backend = autorytet cen).
// ELIXIRS żyje w shopStore.ts (TS, nie JSON), więc eksportujemy go tak jak
// golden-vectory. Kopia trafia do backendu resources/game-content/shop.json —
// serwer waliduje ceny/minLevel przy POST /shop/buy-elixir.
// Regeneracja:
//   UPDATE_GOLDEN=1 npx vitest run tests/integration/shopCatalog.golden.test.ts
//   cp golden/shopCatalog.json ../grimshade-backend/resources/game-content/shop.json

const buildGolden = (): Record<string, unknown> => ({
    system: 'shopCatalog',
    note: 'Generowane z src/stores/shopStore.ts ELIXIRS. NIE edytuj ręcznie.',
    elixirs: ELIXIRS.map((e) => ({
        id: e.id,
        price: getElixirPrice(e, 1), // płaska cena (getElixirPrice ignoruje level)
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
