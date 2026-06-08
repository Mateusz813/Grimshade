/**
 * Atomic E2E — filtry w `/monsters` (MonsterList) faktycznie zmieniają
 * liczbę widocznych kart potworów.
 *
 * Spec (BACKLOG.md punkt 5.4): "Filtry w monster list".
 *
 * Pokrycie (3 z 4 filtrów; "Tylko z taskiem / questem" pominięty bo
 * wymagałby seed tasków/questów):
 *  • **Lvl od X (number input)** — wpisz "30" → tylko monsters z `level >= 30`
 *    widoczne. Tap-able na każdym poziomie postaci (filter nie zważa na unlock).
 *  • **Od najwyższego poziomu (sort desc)** — checkbox → pierwsza karta zmienia
 *    się z najniższego (Szczur lvl 1) na najwyższego (top z monsters.json).
 *  • **Wyczyść** — pojawia się przycisk gdy filtr aktywny; tap → wszystkie
 *    karty z powrotem.
 *
 * Setup:
 *  - Knight lvl 1 — większość potworów locked, ale filtry działają niezależnie
 *    od locked-state (`filterMinLevel` w MonsterList.tsx linia 162 filtruje
 *    tylko po `m.level`, nie po unlock).
 *  - Brak seedów task/quest/mastery — pusty character state.
 *
 * Filter selectors (MonsterList.tsx linia 193-251):
 *  - filterAvailableOnly: checkbox `.combat__filter-toggle` (text "Tylko dostępne")
 *  - filterTaskedOnly:    `.combat__filter-toggle` (text "Tylko z taskiem...")
 *  - filterSortDesc:      `.combat__filter-toggle` (text "Od najwyższego poziomu")
 *  - filterMinLevel:      `.combat__filter-input input[type=number]`
 *  - Wyczyść:             `.combat__filter-clear`
 *
 * Liczenie monsterów źródłowych: MONSTER_COUNT z `monsters.json` przez
 * fs runtime read (jak w `renders-all.spec.ts`).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

// Read monsters.json runtime — count + level distribution dla deterministic
// assertions niezależnych od dodawanych potworów w przyszłości.
interface IMonsterRow { level: number }
const monstersPath = resolve(process.cwd(), 'src/data/monsters.json');
const MONSTERS = JSON.parse(readFileSync(monstersPath, 'utf-8')) as ReadonlyArray<IMonsterRow>;
const MONSTER_COUNT = MONSTERS.length;
// Liczba potworów z level >= 30 — używana do asercji po wpisaniu "30" w filtrze.
// `>=` bo filterMinLevel w MonsterList.tsx: `if (filterMinLevel > 0 && m.level < filterMinLevel) return false`.
const MONSTERS_LVL_30_PLUS = MONSTERS.filter((m) => m.level >= 30).length;
// Top-level monster — do asercji że sort desc zmienia pierwszą kartę.
const TOP_LEVEL = MONSTERS.reduce((max, m) => Math.max(max, m.level), 0);

test.describe('City › Monsters', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Lvl filter + sort desc + clear button — each changes monster card count or order', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 1. Filtry monster-list nie patrzą na unlock-state —
            //    działają na całej liście z monsters.json. Lvl 1 wystarczy.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login + wybierz postać + idź do /monsters
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/monsters');
            await expect(page.locator('.combat__hub-monsters')).toBeVisible({ timeout: 10_000 });

            // 3. Default state — wszystkie karty (>= MONSTER_COUNT, bo monsters.json
            //    może urosnąć; sanity że render działa).
            const cards = page.locator('.combat__mcard');
            await expect(cards.first()).toBeVisible({ timeout: 10_000 });
            const initialCount = await cards.count();
            expect(initialCount).toBeGreaterThanOrEqual(MONSTER_COUNT);

            // Najtańszy invariant: pierwsza karta = najniższy poziom (Szczur lvl 1)
            // po sort-by-level-asc w MonsterList.tsx linia 39.
            await expect(cards.first().locator('.combat__mcard-name')).toContainText('Szczur');

            // 4. **Lvl od 30** — wpisz 30 w number input. Filter zostawia tylko
            //    monsters z `level >= 30`. Selektor: `combat__filter-input` ma
            //    `<input type="number">` (linia 230-235).
            const lvlInput = page.locator('.combat__filter-input input[type="number"]');
            await lvlInput.fill('30');
            // Po `fill` filter się natychmiast aplikuje (`onChange={(e) => setFilterMinLevel(...)}`).
            // Czekamy aż count się stabilize do oczekiwanej wartości.
            await expect(cards).toHaveCount(MONSTERS_LVL_30_PLUS, { timeout: 5_000 });

            // 5. **Wyczyść** — gdy filter aktywny, pojawia się przycisk
            //    `.combat__filter-clear` (linia 238-252). Tap → wszystkie 4 filtry reset.
            //    Count wraca do initial.
            const clearBtn = page.locator('.combat__filter-clear');
            await expect(clearBtn).toBeVisible();
            await clearBtn.tap();
            await expect(cards).toHaveCount(initialCount, { timeout: 5_000 });

            // 6. **Sort desc** — `Od najwyższego poziomu` checkbox (`.combat__filter-toggle`
            //    z textem "Od najwyższego poziomu"). Tap → pierwsza karta = top-level monster.
            //    Filter NIE zmienia count-u (sort tylko odwraca order), więc liczba kart =
            //    initialCount. Sprawdzamy że pierwsza karta zawiera `Lvl {TOP_LEVEL}`.
            const sortToggle = page.locator('.combat__filter-toggle', {
                hasText: 'Od najwyższego poziomu',
            });
            await sortToggle.tap();
            // Visual toggle — class `--active` po tap.
            await expect(sortToggle).toHaveClass(/combat__filter-toggle--active/);
            // Count nie powinien się zmienić — sort, nie filter.
            await expect(cards).toHaveCount(initialCount, { timeout: 5_000 });
            // Pierwsza karta = najwyższy level (MonsterList.tsx linia 176-178:
            // `visibleMonsters = filterSortDesc ? [...filteredMonsters].reverse() : filteredMonsters`)
            await expect(cards.first().locator('.combat__mcard-level')).toContainText(`Lvl ${TOP_LEVEL}`);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
