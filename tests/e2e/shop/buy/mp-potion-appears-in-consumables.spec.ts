/**
 * Atomic E2E — Shop "Potions" tab buy flow (MP potion).
 *
 * Backlog item 3.3 ("Kup MP potion + użyj w walce"). Same scoping
 * as 3.2 — purchase only, "use in combat" is its own future test.
 *
 * The MP-potion variant exists as a separate file (not parametrized
 * with 3.2) because:
 *   1. Atomic E2E principle — one failure points at one file.
 *   2. Future divergence: HP potions and MP potions are filtered
 *      differently in some views (autoPotionHpEnabled vs Mp), so
 *      keeping them split lets each grow independently.
 *
 * We use Mały Eliksir MP (`mp_potion_sm`), the cheapest MP variant
 * — 30 gold, minLevel 1. Mage class chosen because mage chars need
 * MP regen / potions in canon, even though this test doesn't use
 * the potion in combat. Picking Mage also exercises a different
 * class than 3.1 / 3.2 (Knight) — broadens our cross-class coverage
 * for free.
 *
 * Cleanup: per-character via `cleanupCharacterById` in finally
 * (also wipes seeded game_save).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Shop › Buy', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('buying Mały Eliksir MP increments owned count and deducts 30 gold', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        // Mały Eliksir MP = 30 gold (mirror of hp_potion_sm in ELIXIRS),
        // so post-buy = 100,000 - 30 = 99,970.
        const STARTING_GOLD = 100_000;

        try {
            // Seed Mage — different class than 3.1/3.2 for cross-class coverage.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Mage',
                overrides: { gold: STARTING_GOLD, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                gold: STARTING_GOLD,
            });

            // Login -> select character -> Town
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

            // Confirm starting gold
            const goldBtn = page.locator('.top-header__gold-btn').first();
            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s*100[\s ]?000/, { timeout: 5_000 });

            // Navigate to Shop via BottomNav (SPA route preserves stores;
            // page.goto would reset characterStore + leave Shop on Spinner).
            await page.getByRole('button', { name: /^Sklep$/i }).tap();
            await expect(page).toHaveURL(/\/shop$/, { timeout: 10_000 });
            await expect(page.locator('.shop__tabs')).toBeVisible({ timeout: 10_000 });
            await page.locator('.shop__tab[aria-label="Potiony"]').tap();

            // Locate Mały Eliksir MP card (exact name match)
            const potionCard = page.locator('.shop__card', {
                has: page.locator('.shop__card-name', { hasText: /^Mały Eliksir MP$/ }),
            }).first();
            await potionCard.scrollIntoViewIfNeeded();
            await expect(potionCard).toBeVisible();

            // Pre-buy: card should NOT have a ×N badge
            await expect(potionCard.locator('.shop__card-lvl-badge')).toHaveCount(0);

            // Buy
            await potionCard.getByRole('button', { name: /^Kup$/i }).tap();

            // Toast
            await expect(page.locator('.shop__toast')).toHaveText(/Kupiono\s+1×\s*Mały Eliksir MP/i, { timeout: 5_000 });

            // Post-buy: ×1 badge
            await expect(potionCard.locator('.shop__card-lvl-badge')).toHaveText('×1', { timeout: 5_000 });

            // Gold decreased by 30 -> 99,970
            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s*99[\s ]?970/, { timeout: 5_000 });

            // Cross-check: tap Postać in BottomNav (preserves stores)
            await page.getByRole('button', { name: /^Postać$/i }).tap();
            await expect(page).toHaveURL(/\/inventory$/, { timeout: 10_000 });
            await expect(page.locator('.inventory__bag-count')).toHaveText(/Plecak:\s*0\s*\/\s*1000/, { timeout: 10_000 });
            const inventoryPotion = page.locator('.inventory__bag-tile-name', { hasText: /^Mały Eliksir MP$/ }).first();
            await expect(inventoryPotion).toBeVisible({ timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
