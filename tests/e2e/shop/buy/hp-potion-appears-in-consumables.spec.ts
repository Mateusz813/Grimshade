/**
 * Atomic E2E — Shop "Potions" tab buy flow (HP potion).
 *
 * Backlog item 3.2 ("Kup HP potion + użyj w walce"). The original spec
 * pairs purchase with using the potion in combat, but combat setup
 * requires monster seeding + combat engine readiness — that's a
 * separate scenario. This test covers ONLY the purchase half:
 *  1. Open Shop → tap Potions tab.
 *  2. Tap "Kup" on the cheapest HP potion (Mały Eliksir HP, 30 gold).
 *  3. Toast confirms purchase.
 *  4. Card now shows "×1" owned badge.
 *  5. Gold decreased by 30.
 *  6. Inventory → Potions filter shows the potion stack.
 *
 * "Use in combat" is left for a separate test in `combat/potion/`
 * (item 13.x in BACKLOG.md) — coupling the purchase test to combat
 * makes failures harder to diagnose ("is buy broken or is potion
 * use broken?").
 *
 * Why Mały Eliksir HP (`hp_potion_sm`):
 *   • Cheapest in the registry (30 gold), so 100k starting gold is
 *     overkill — never hits no_gold.
 *   • minLevel: 1 (no level gate, our Knight is Lv 1).
 *   • Deterministic name_pl ("Mały Eliksir HP") for selector.
 *
 * Pattern mirrors `item-appears-in-inventory-and-deducts-gold.spec.ts`.
 * Cleanup: `cleanupCharacterById` in finally (also wipes game_save).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Shop › Buy', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('buying Mały Eliksir HP increments owned count and deducts 30 gold', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        // Mały Eliksir HP price = 30 gold (per shopStore.ts ELIXIRS table),
        // so post-buy = 100,000 - 30 = 99,970.
        const STARTING_GOLD = 100_000;

        try {
            // Seed Knight + game_save with starting gold. Knight has no
            // weird minLevel restrictions on hp_potion_sm at Lv 1.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { gold: STARTING_GOLD, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                gold: STARTING_GOLD,
            });

            // Login → pick character → Town
            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // Confirm starting gold via TopHeader aria-label.
            const goldBtn = page.locator('.top-header__gold-btn').first();
            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s*100[\s ]?000/, { timeout: 5_000 });

            // Navigate to Shop via BottomNav (SPA — preserves stores).
            // page.goto('/shop') would full-reload and reset the character
            // store → Shop stays on spinner. See sibling test
            // `item-appears-in-inventory-and-deducts-gold.spec.ts` for full
            // rationale.
            await page.getByRole('button', { name: /^Sklep$/i }).tap();
            await expect(page).toHaveURL(/\/shop$/, { timeout: 10_000 });
            await expect(page.locator('.shop__tabs')).toBeVisible({ timeout: 10_000 });
            // Tap the Potions tab (aria-label="Potiony").
            await page.locator('.shop__tab[aria-label="Potiony"]').tap();

            // Locate the Mały Eliksir HP card. Scope by exact name match.
            const potionCard = page.locator('.shop__card', {
                has: page.locator('.shop__card-name', { hasText: /^Mały Eliksir HP$/ }),
            }).first();
            await potionCard.scrollIntoViewIfNeeded();
            await expect(potionCard).toBeVisible();

            // Pre-buy: card should NOT have a ×N badge (no consumables owned).
            await expect(potionCard.locator('.shop__card-lvl-badge')).toHaveCount(0);

            // Tap "Kup" — qty defaults to 1, so button text is just "Kup".
            await potionCard.getByRole('button', { name: /^Kup$/i }).tap();

            // Toast: "Kupiono 1× Mały Eliksir HP" (per handleBuyPotion msg).
            await expect(page.locator('.shop__toast')).toHaveText(/Kupiono\s+1×\s*Mały Eliksir HP/i, { timeout: 5_000 });

            // Post-buy: card now shows "×1" owned badge.
            await expect(potionCard.locator('.shop__card-lvl-badge')).toHaveText('×1', { timeout: 5_000 });

            // Gold decreased by 30 → 99,970.
            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s*99[\s ]?970/, { timeout: 5_000 });

            // Cross-check: tap Postać in BottomNav → /inventory and confirm
            // the potion appears as a stack tile under the bag grid.
            await page.getByRole('button', { name: /^Postać$/i }).tap();
            await expect(page).toHaveURL(/\/inventory$/, { timeout: 10_000 });
            await expect(page.locator('.inventory__bag-count')).toHaveText(/Plecak:\s*0\s*\/\s*1000/, { timeout: 10_000 });
            // Potions are stackable tiles — name appears in the bag grid as
            // "Mały Eliksir HP" (separate from gear, no bag-slot consumed).
            const inventoryPotion = page.locator('.inventory__bag-tile-name', { hasText: /^Mały Eliksir HP$/ }).first();
            await expect(inventoryPotion).toBeVisible({ timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
