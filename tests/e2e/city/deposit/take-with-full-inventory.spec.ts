/**
 * Atomic E2E — Wypłata z depozytu blokowana gdy plecak jest pełny.
 *
 * Spec (BACKLOG.md punkt 5.9): "Depozyt: take z pełnym plecakiem →
 * komunikat".
 *
 * **App caveat** (sprawdzone w `src/views/Deposit/Deposit.tsx` 2026-05-25):
 * Deposit NIE renderuje toastu "Plecak pełny" przy tap-ie pojedynczego
 * tile w deposit panel-u. `withdrawItem` w `src/stores/inventoryStore.ts`
 * (linia 514-524) zwraca `false` gdy `bag.length >= MAX_BAG_SIZE`, ale
 * Deposit.tsx nie sprawdza zwracanej wartości i nie pokazuje feedback-u.
 * Item silentily zostaje w deposit.
 *
 * Jedynym widocznym "komunikatem" jest **disabled state** bulk-button-a
 * `↑ Wypłać wszystkie` (linia 238): `disabled={bag.length >= MAX_BAG_SIZE}`.
 *
 * Co testujemy:
 *  - Seed 1000 itemów w bagu (filler, `generateFillerBagItems(1000)`) +
 *    1 item w deposit (`generateDepositItem`).
 *  - Nawigacja na `/deposit` → counter "1000 / 1000" w panelu Plecak;
 *    counter "1 / 10000" w panelu Depozyt; 1 tile widoczny w deposit panel-u.
 *  - **Bulk button** `↑ Wypłać wszystkie` jest DISABLED (selektor:
 *    `.deposit__panel:has(.deposit__panel-title:has-text("Depozyt"))
 *    .deposit__bulk-btn`).
 *  - **Per-tile** tap na deposit tile — sprawdzamy że item NIE zniknął
 *    z deposit panel-u + counter w deposit panelu nadal pokazuje "1".
 *    (Test ten dokumentuje silent-fail; jeśli kiedyś dorzucimy toast,
 *    to test trzeba rozszerzyć o expect(toast).toBeVisible().)
 *
 * Cleanup: try/finally + cleanupCharacterById — game_saves jest w
 * CHARACTER_CHILD_TABLES, więc kasowanie postaci kasuje też seeded
 * bag + deposit.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import {
    seedGameSave,
    findUserIdByEmail,
    generateFillerBagItems,
    generateDepositItem,
} from '../../fixtures/seedGameSave';

test.describe('City › Deposit', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('full bag (1000/1000) blocks "Wypłać wszystkie" + per-tile tap silently fails', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight — żadne stat overrides, świeża postać.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed game_save: 1000 fillerów w bagu (MAX_BAG_SIZE = 1000) +
            //    1 real-looking item w deposit. Patrz `seedGameSave.ts` —
            //    pole `bagItems` accept array, pole `depositItems` accept array.
            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                bagItems: generateFillerBagItems(1000),
                depositItems: [generateDepositItem('wooden_sword')],
            });

            // 3. Login + select character + go to /deposit
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const charCard = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(charCard).toBeVisible({ timeout: 10_000 });
            await charCard.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/deposit');
            await expect(page.locator('.deposit__title')).toContainText('Depozyt');

            // 4. Panele — Plecak (panel #0), Depozyt (panel #1).
            //    Counter format: `{count} / {MAX}`. Z MAX_BAG_SIZE=1000 + 1000
            //    seeded items → text exact "1000 / 1000".
            const panels = page.locator('.deposit__panel');
            await expect(panels).toHaveCount(2);

            const bagPanel = panels.nth(0);
            const depositPanel = panels.nth(1);
            await expect(bagPanel.locator('.deposit__panel-count')).toContainText('1000 / 1000');
            await expect(depositPanel.locator('.deposit__panel-count')).toContainText('1 / 10000');

            // 5. **Bulk button** w deposit panelu disabled (linia 238 Deposit.tsx:
            //    `disabled={filteredDeposit.length === 0 || bag.length >= MAX_BAG_SIZE}`).
            //    Z naszego seedu: filteredDeposit.length=1 (>0), bag.length=1000 → disabled.
            const depositBulkBtn = depositPanel.locator('.deposit__bulk-btn');
            await expect(depositBulkBtn).toContainText('Wypłać wszystkie');
            await expect(depositBulkBtn).toBeDisabled();

            // 6. **Per-tile** silent-fail flow. Tap tile w deposit panelu →
            //    `withdrawItem` zwraca false silently, item zostaje.
            //    Asercja PRZED tap: 1 tile w deposit panelu.
            const depositTiles = depositPanel.locator('.deposit__tile');
            await expect(depositTiles).toHaveCount(1);
            const firstTile = depositTiles.first();

            // Tap. NIE sprawdzamy expect-no-throw bo Playwright .tap() nie throw-uje
            // na disabled tile (tile sam nie jest disabled — clickable, ale
            // handler robi no-op gdy bag full).
            await firstTile.tap();

            // Czekamy chwilę żeby ewentualne React re-render się odpalił.
            // Wait alternative: short timeout + asercja że tile nadal jest.
            // Stable approach: `toHaveCount` z timeout — jeśli item zniknąłby
            // (jeśli bug regresji w przyszłości), assertion failuje na timeout.
            await expect(depositTiles).toHaveCount(1, { timeout: 3_000 });
            // Counter w deposit panel-u nadal "1 / 10000".
            await expect(depositPanel.locator('.deposit__panel-count')).toContainText('1 / 10000');
            // Counter w plecaku nadal "1000 / 1000" — nic się nie dodało.
            await expect(bagPanel.locator('.deposit__panel-count')).toContainText('1000 / 1000');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
