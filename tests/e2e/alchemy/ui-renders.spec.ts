/**
 * Atomic E2E — Alchemia tab renders conversion recipes grid.
 *
 * Spec (BACKLOG.md punkt 10.2 — basic): "Alchemia UI renders (smoke —
 * list of recipes visible)".
 *
 * Alchemia (potion conversion) NIE ma osobnego route — lives jako 2-ga
 * zakladka w Potion popup-ie (Inventory.tsx linia 3818-3898).
 * Recepty są zdefiniowane w `src/systems/potionConversion.ts`
 * (POTION_CONVERSIONS — 7 HP + 7 MP = 14 wszystkich).
 *
 * Setup state:
 *   1. Seed Knight via API. Bez seedu consumables — pusty inventory =
 *      kazda recepta będzie disabled ("Za malo") ale grid powinien się
 *      WYRENDEROWAĆ wszystkie 14 conversion rows.
 *   2. Login + select character → wejscie do Town (`/`).
 *
 * Actions:
 *   1. /inventory → tap "Auto-potion" → popup z 2 zakladkami.
 *   2. Tap "🧪 Alchemia" tab → switchuje setPotionTab('alchemy').
 *
 * Outcome:
 *   - Popup nadal widoczny.
 *   - Active tab = Alchemia (`.inventory__popup-tab--active` ma tekst Alchemia).
 *   - Hint widoczny: "Zamieniaj slabsze eliksiry na mocniejsze..." (linia 3821).
 *   - Grid `.inventory__alchemy-grid` widoczny (linia 3826).
 *   - 14 conversion rows `.inventory__alchemy-row` renderowane
 *     (POTION_CONVERSIONS.length === 14: tiery 1-6 HP + 1 alt HP tier 7 +
 *     tiery 1-6 MP + 1 alt MP tier 7 — patrz potionConversion.ts).
 *
 * Cleanup: try/finally → cleanupCharacterById.
 *
 * Co NIE testujemy:
 *  - Click "🧪 Przetworz" button (10.x feature test).
 *  - Amount adjust przez +/- buttons (osobne mass-convert test).
 *  - Disabled state każdej recepty (zal. od owned count).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

test.describe('Alchemy › UI', { tag: '@alchemy' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Alchemia tab renders 14 conversion recipe rows', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 1. Login → wybierz postac → Town
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 2. /inventory → tap Auto-potion button (popup ma 2 zakladki)
            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^auto-potion$/i }).tap();

            const popup = page.locator('.inventory__popup--potion');
            await expect(popup).toBeVisible({ timeout: 5_000 });

            // 3. Tap Alchemia tab button (linia 3606-3612).
            //    Wewnatrz popup-u zeby uniknac kolizji jesli na ekranie jest
            //    inny "Alchemia" wpis (np. quick link spec 13c).
            await popup.getByRole('button', { name: /Alchemia/i }).tap();

            // 4. Tab Alchemia jest aktywny.
            await expect(popup.locator('.inventory__popup-tab--active'))
                .toContainText(/Alchemia/i);

            // 5. Hint o tym jak działa Alchemia (linia 3820-3822).
            await expect(popup.locator('.inventory__alchemy-hint'))
                .toContainText(/Zamieniaj slabsze eliksiry/i);

            // 6. Grid recipes widoczny (linia 3826).
            const grid = popup.locator('.inventory__alchemy-grid');
            await expect(grid).toBeVisible();

            // 7. KRYTYCZNA asercja — 14 conversion rows.
            //    POTION_CONVERSIONS w potionConversion.ts ma:
            //      HP: tiery 1-6 (6) + alt tier 7 (lg→mega) = 7
            //      MP: tiery 1-6 (6) + alt tier 7 (lg→mega) = 7
            //    Razem 14.
            await expect(grid.locator('.inventory__alchemy-row')).toHaveCount(14);

            // 8. Sanity — pierwszy row to HP tier 1 (5x maly → 1x sredni)
            //    bo POTION_CONVERSIONS są listed w kolejnosci jak w json.
            //    Sprawdzamy obecnosc nazwy "Maly Eliksir HP" w gdzieś w gridzie
            //    (jako input name pierwszej recepty).
            await expect(grid.getByText('Maly Eliksir HP').first()).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
