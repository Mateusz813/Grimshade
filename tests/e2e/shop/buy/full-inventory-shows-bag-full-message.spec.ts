/**
 * Atomic E2E — Shop buy edge case: bag full.
 *
 * Backlog item 3.12 ("Pełny plecak + kup broń → komunikat / auto-sell
 * / poprawne UX"). The current app behaviour (see
 * `useShopStore.buyShopItem` in src/stores/shopStore.ts):
 *   1. `spendGold(price)` — debits cost up-front.
 *   2. Generates the item.
 *   3. Calls `inv.restoreItem(generated)` which returns FALSE when
 *      `bag.length >= MAX_BAG_SIZE` (1000 slots).
 *   4. On `restoreItem === false` → `addGold(price)` (refund) +
 *      returns `'bag_full'` → Shop maps to toast "Plecak pełny!".
 *
 * So the contract under test is:
 *   • Toast text: "Plecak pełny!"
 *   • Gold AFTER buy attempt = gold BEFORE (refund was issued).
 *   • Bag count stays at 1000 (no overflow).
 *
 * Setup: `seedGameSave` with `bagItems` = 1000 filler items. The
 * items themselves are dummy commons (uuid + itemId + rarity), enough
 * to register as bag slots without triggering any UI render bug.
 * 1000 entries is the exact `MAX_BAG_SIZE` constant.
 *
 * Why we use `restoreItem` path (not `addItem` + auto-sell-victim):
 *   `buyShopItem` deliberately calls `restoreItem` (the bypass path)
 *   instead of `addItem` so a stale "Autosprzedaj commony" toggle
 *   doesn't silently auto-sell a shop purchase. `restoreItem` has no
 *   overflow-victim fallback — bag full = hard reject. That's the
 *   path this test exercises.
 *
 * Cleanup: per-character via `cleanupCharacterById` in finally
 * (also wipes seeded game_save + the 1000 filler items inside it).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail, generateFillerBagItems } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Shop › Buy', { tag: '@shop' }, () => {
    // Seeding a 1000-item bag + going through full UI flow is heavier
    // than a normal test — extra time for the bag-payload upload + the
    // inventory-page render (1000 tiles, paged).
    test.describe.configure({ timeout: 120_000 });

    test('buying a weapon with bag full shows "Plecak pełny!" toast and refunds gold', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        // Lv 1 Knight common sword = 50 gold; after refund gold stays 100,000.
        const STARTING_GOLD = 100_000;

        try {
            // Seed Knight + bag pre-filled with 1000 filler items.
            // MAX_BAG_SIZE = 1000 in inventoryStore.ts → 1000 fillers is
            // exactly full. Any incoming item from buyShopItem fails restoreItem.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { gold: STARTING_GOLD, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.primary.email);
            const filler = generateFillerBagItems(1000);
            await seedGameSave({
                characterId: created.id,
                userId,
                gold: STARTING_GOLD,
                bagItems: filler,
            });

            // Login → select character → Town
            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 15_000 });
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // Confirm starting gold via TopHeader aria-label.
            const goldBtn = page.locator('.top-header__gold-btn').first();
            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s*100[\s ]?000/, { timeout: 5_000 });

            // Navigate to Shop via BottomNav (SPA route — preserves stores).
            // page.goto would full-reload, wipe characterStore, leave Shop
            // on Spinner forever.
            await page.getByRole('button', { name: /^Sklep$/i }).tap();
            await expect(page).toHaveURL(/\/shop$/, { timeout: 10_000 });
            await expect(page.locator('.shop__tabs')).toBeVisible({ timeout: 10_000 });

            // Locate Miecz common Lv 1 card and tap Kup.
            const swordCard = page.locator('.shop__card', {
                has: page.locator('.shop__card-name', { hasText: /^Miecz$/ }),
            }).first();
            await swordCard.scrollIntoViewIfNeeded();
            await expect(swordCard).toBeVisible();
            await swordCard.getByRole('button', { name: /^Kup$/i }).tap();

            // Toast: "Plecak pełny!" (per BUY_MESSAGES.bag_full in Shop.tsx).
            await expect(page.locator('.shop__toast')).toHaveText(/Plecak pełny/i, { timeout: 5_000 });

            // Gold UNCHANGED — refund issued in buyShopItem when restoreItem fails.
            // Allow up to 2 s for any async pulse before re-assert.
            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s*100[\s ]?000/, { timeout: 5_000 });

            // Bag count still 1000 / 1000 — no overflow. Navigate via
            // BottomNav so the store keeps its hydrated state.
            await page.getByRole('button', { name: /^Postać$/i }).tap();
            await expect(page).toHaveURL(/\/inventory$/, { timeout: 10_000 });
            await expect(page.locator('.inventory__bag-count')).toHaveText(/Plecak:\s*1000\s*\/\s*1000/, { timeout: 15_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
