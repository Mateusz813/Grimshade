/**
 * Atomic E2E — masowa sprzedaż wybranych przedmiotów z plecaka.
 *
 * Spec (BACKLOG.md punkt 6.4): "Masowa sprzedaż".
 *
 * Test sprawdza pełen flow bulk sell:
 *  1. Tap ":money-bag: Sprzedaj" toggle na header-ze plecaka -> wchodzi w bulk
 *     mode (sell), tile-y dostają checkbox-y.
 *  2. Tap "Zaznacz wszystkie" -> wszystkie 3 seeded items są oznaczone.
 *  3. Tap przycisku w stopce ":money-bag: Sprzedaj (3 szt. za ...)" -> wszystkie
 *     items znikają + gold counter rośnie o sumę cen sprzedaży.
 *
 * Setup: postać Knight, gold=0, +3 seeded items w bagu:
 *   - iron_mace    (common, lvl 1) — basePrice=80, sell = floor(80*0.20) = 16g
 *   - iron_sword   (common, lvl 1) — basePrice=80, sell = floor(80*0.20) = 16g
 *   - iron_helmet  (common, lvl 1) — basePrice=120, sell = floor(120*0.20) = 24g
 *  Sumarycznie po sprzedaży gold = 0 + (16 + 16 + 24) = 56g.
 *
 * Sell math (z `itemSystem.ts` getSellPrice + RARITY_SELL_MULTIPLIER):
 *  - Common rarity -> mult 0.20
 *  - basePrice > 0 -> priceFromBase = floor(basePrice * mult)
 *  - upgradeLevel = 0 -> enhanceRefund.gold = 0
 *  - Razem: floor(basePrice * 0.20)
 *
 * Asercje:
 *  - Przed: 3 bag tiles, gold "0 gp"
 *  - Po tap ":money-bag: Sprzedaj" toggle -> bulkMode active (przycisk "x Anuluj"
 *    widoczny), bulk-mode-label ":money-bag: Tryb sprzedazy" widoczna
 *  - Po tap "Zaznacz wszystkie" -> 3 tile-y mają klasę
 *    `inventory__bag-tile--selected`
 *  - Po tap stopki ":money-bag: Sprzedaj (3 szt. ...)" -> 0 bag tiles + gold "56 gp"
 *  - Bulk-mode-label znika (handleMultiSell ustawia bulkMode='none')
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedInventoryItem } from '../../fixtures/seedInventory';

test.describe('Inventory › Sell', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('bulk mode -> select all -> "Sprzedaj" footer -> all items removed + gold = sum of sell prices', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight, level 5, gold = 0.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, gold: 0, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed 3 common-rarity items. Each goes through getSellPrice:
            //    basePrice * 0.20 (RARITY_SELL_MULTIPLIER.common) + 0 (no upgrade refund).
            //    iron_mace   basePrice=80   -> 16g
            //    iron_sword  basePrice=80   -> 16g
            //    iron_helmet basePrice=120  -> 24g
            //    Total: 56g.
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_mace',
                rarity: 'common',
                itemLevel: 1,
            });
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_sword',
                rarity: 'common',
                itemLevel: 1,
            });
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_helmet',
                rarity: 'common',
                itemLevel: 1,
            });

            // 3. Login + wybierz postać + otwórz /inventory
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/inventory');
            await expect(page.locator('.inventory')).toBeVisible({ timeout: 10_000 });

            // 4. Sanity — przed: 3 tiles, gold = 0.
            //    Bag counter "Plecak: 3 / 1000" confirms hydration zadziałała.
            //    UWAGA o gold value source:
            //      `.top-header__gold-value` text pochodzi z `displayGold` —
            //      stanu lokalnego TopHeader.tsx który ANIMOWANY (count-up
            //      przez rAF, ~600ms) gdy gold rośnie. Headless browser
            //      czasem throttluje rAF (focus lost) -> displayGold zamarza
            //      na wartości mid-animacji.
            //      ROZWIĄZANIE: czytamy `aria-label` z `.top-header__gold-btn`
            //      (linia 329 TopHeader.tsx) który używa SUROWEJ `gold`
            //      wartości ze store-u — `Złoto: 0` / `Złoto: 56` itd.
            //      Brak animacji = brak flake-a.
            await expect(page.locator('.inventory__bag-count')).toContainText('Plecak: 3', { timeout: 10_000 });
            const bagTiles = page.locator('.inventory__bag-tile');
            await expect(bagTiles).toHaveCount(3);
            const goldBtn = page.locator('.top-header__gold-btn');
            await expect(goldBtn).toHaveAttribute('aria-label', 'Złoto: 0');

            // 5. Tap toggle ":money-bag: Sprzedaj" (multi-sell-toggle--sell) — wchodzi w
            //    bulkMode='sell'. Inventory.tsx linia 4291-4296.
            //    UWAGA: explicit toBeVisible PRZED tap-em — czasem button
            //    re-renderuje się tuż po hydration (auto-save subscribers) ->
            //    "element was detached from DOM" flake.
            const sellToggle = page.locator('.inventory__multi-sell-toggle--sell');
            await expect(sellToggle).toBeVisible();
            await sellToggle.tap();

            // 6. Bulk mode UI pojawia się: label ":money-bag: Tryb sprzedazy" + multi-controls
            //    z przyciskami "Zaznacz wszystkie" itd.
            const bulkLabel = page.locator('.inventory__bulk-mode-label');
            await expect(bulkLabel).toBeVisible({ timeout: 5_000 });
            await expect(bulkLabel).toContainText('Tryb sprzedazy');

            // 7. Tap "Zaznacz wszystkie" — przycisk inventory__multi-btn--tx z
            //    tekstem "Zaznacz wszystkie" (Inventory.tsx linia 4396).
            //    Po tap: wszystkie 3 tiles mają isChecked=true -> klasa
            //    `inventory__bag-tile--selected`.
            await page.locator('.inventory__multi-btn--tx', { hasText: 'Zaznacz wszystkie' }).tap();

            // 8. Wszystkie 3 tiles mają klasę --selected.
            await expect(page.locator('.inventory__bag-tile--selected')).toHaveCount(3, { timeout: 5_000 });

            // 9. Stopka footer pokazuje ":money-bag: Sprzedaj (3 szt. za 56g)" —
            //    Inventory.tsx linia 4742: tekst zawiera "(3 szt." i kwota
            //    formatowana przez formatGoldShort(56) = "56 gp".
            const sellFooterBtn = page.locator('.inventory__multi-sell-btn');
            await expect(sellFooterBtn).toBeVisible({ timeout: 5_000 });
            await expect(sellFooterBtn).toContainText('3 szt');
            await expect(sellFooterBtn).toContainText('56 gp');

            // 10. Tap przycisk "Sprzedaj" w stopce.
            await sellFooterBtn.tap();

            // 11. Wszystkie tiles znikają + bulk mode się resetuje
            //     (handleMultiSell ustawia bulkMode='none' + selectedUuids=new Set()).
            await expect(bagTiles).toHaveCount(0, { timeout: 5_000 });
            await expect(page.locator('.inventory__bulk-mode-label')).toHaveCount(0);

            // 12. KRYTYCZNA ASERCJA: gold = 56 (= 16 + 16 + 24).
            //     Asercja po aria-label (raw value, no animation flake).
            await expect(goldBtn).toHaveAttribute('aria-label', 'Złoto: 56', { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
