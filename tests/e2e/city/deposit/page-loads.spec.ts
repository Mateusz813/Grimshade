/**
 * Atomic E2E — Depozyt (`/deposit`) renderuje podstawowe panele.
 *
 * Spec (BACKLOG.md punkt 5.8): "Depozyt: put + take basic".
 *
 * Pełny put/take flow wymaga seed-u inventory (item w plecaku z UUID
 * + sterowanie inventoryStore.depositItem). To wymaga osobnego
 * `seedInventory` helper-a którego jeszcze nie mamy w fixtures/.
 *
 * Na razie testujemy **smoke layer**:
 *  - Po nawigacji na /deposit widok ładuje się bez błędu.
 *  - Pokazuje nagłówek z napisem "Depozyt".
 *  - Pokazuje dwa panele: 🎒 Plecak + 🏦 Depozyt.
 *  - Panel Plecak pokazuje counter 0/1000 (lub > 0 jeśli seed dorzucił coś).
 *  - Empty state "Brak przedmiotów" jest widoczny (świeża postać bez itemów).
 *
 * Full put/take TODO: dorzucić gdy będzie `seedInventory` helper —
 * wtedy seed → tap tile → assert item przeniósł się między panelami.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('City › Deposit', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('/deposit renders header + Plecak panel + Depozyt panel + empty states', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight — żadne overrides, świeża postać bez inventory.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
            });
            createdId = created.id;

            // 2. Login + select character + go to /deposit
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/deposit');

            // 3. Nagłówek strony — tytuł "🏦 Depozyt"
            await expect(page.locator('.deposit__title')).toContainText('Depozyt');

            // 4. Dwa panele (plecak + depozyt) — Deposit.tsx renderuje
            //    dokładnie 2 `<section class="deposit__panel">`.
            const panels = page.locator('.deposit__panel');
            await expect(panels).toHaveCount(2);

            // 5. Każdy panel ma swój tytuł
            const panelTitles = panels.locator('.deposit__panel-title');
            await expect(panelTitles.nth(0)).toContainText('Plecak');
            await expect(panelTitles.nth(1)).toContainText('Depozyt');

            // 6. Counter formatu "N / MAX" w nagłówku każdego panelu.
            //    Świeża postać → plecak=0/1000, depozyt=0/10000.
            const bagCounter = panels.nth(0).locator('.deposit__panel-count');
            const depCounter = panels.nth(1).locator('.deposit__panel-count');
            await expect(bagCounter).toContainText('/ 1000');
            await expect(depCounter).toContainText('/ 10000');

            // 7. Empty state widoczny w obu panelach na świeżej postaci
            const emptyStates = page.locator('.deposit__empty');
            await expect(emptyStates).toHaveCount(2);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
