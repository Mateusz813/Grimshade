/**
 * Atomic E2E — Monster list (`/monsters`) renders the full bestiary.
 *
 * Spec (BACKLOG.md punkt 5.1): "Monster list renderuje wszystkie potwory".
 *
 * Co testujemy:
 *  - Po wejściu na `/monsters` widzimy listę kart `.combat__mcard`
 *  - Liczba kart >= liczba potworów w `src/data/monsters.json` (60 jak na
 *    2026-05-25). Używamy >= zamiast === bo monsters.json może urosnąć,
 *    a test ma być stabilny — gdy ktoś doda potwora, test nadal przechodzi.
 *  - Lista pokazuje BOTH zablokowane i odblokowane potwory (per
 *    MonsterList.tsx — filter `filterAvailableOnly` jest domyślnie false,
 *    więc full list leci do DOM-u).
 *
 * Seed: postać Knight lvl 1 — wystarczy żeby `/monsters` w ogóle się
 * załadował (Town view wymaga aktywnej postaci żeby przejść dalej).
 * Większość kart będzie locked, ale to nie psuje testu — sprawdzamy
 * tylko że WSZYSTKIE są wyrenderowane.
 *
 * Cleanup: try/finally + cleanupCharacterById (per-test, race-safe wobec
 * fullyParallel).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

// JSON import attribute syntax `with { type: 'json' }` jest niedostępne
// w starszych Node ESM loaderach Playwright-a — czytamy plik runtime-owo
// przez fs zamiast import statement. Path resolved from process.cwd()
// (= project root, gdzie Playwright odpala).
const monstersPath = resolve(process.cwd(), 'src/data/monsters.json');
const MONSTER_COUNT = (JSON.parse(readFileSync(monstersPath, 'utf-8')) as ReadonlyArray<unknown>).length;

test.describe('City › Monsters', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('renders all monsters from monsters.json on /monsters', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 1 (most monsters będą locked, ale renderują się i tak).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
            });
            createdId = created.id;

            // 2. Login → /character-select → tap "Wybierz" na naszej karcie → Town
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            // 3. Nawiguj na /monsters
            await page.goto('/monsters');

            // 4. Sekcja "Przeciwnicy" musi się załadować (i.e. komponent
            //    osiadł, nie jest jeszcze pusty / w skeleton state).
            await expect(page.locator('.combat__hub-monsters')).toBeVisible({ timeout: 10_000 });

            // 5. Czekamy aż wszystkie karty się wyrenderują. Lista monsters.json
            //    jest statyczna (import), więc render jest synchronous —
            //    ale `combat__mcard-grid` jest dziećmi React-a, więc dajemy
            //    timeout na first paint + ewentualny scroll.
            const cards = page.locator('.combat__mcard');
            await expect(cards.first()).toBeVisible({ timeout: 10_000 });

            // 6. Hard assert: liczba kart >= liczba potworów w danych.
            //    Używamy >= żeby test nie pękał gdy ktoś doda potwora bez
            //    update'u tego testu. Jeśli ktoś USUNIE potwora, test pęka —
            //    co jest pożądane (zwracamy uwagę że content się skurczył).
            const count = await cards.count();
            expect(count).toBeGreaterThanOrEqual(MONSTER_COUNT);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
