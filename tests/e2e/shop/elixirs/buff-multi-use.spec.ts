/**
 * Atomic E2E — buff elixirs can be activated SEVERAL at once from the backpack.
 *
 * BUG 2 (2026-06-24): the use-potion popup only rendered a quantity selector
 * (−/value/+/MAX) for HP/MP heal potions. Buff elixirs showed a single
 * "Aktywuj buff" button, so you could only consume one at a time. Fix: render
 * the SAME amount selector + the existing `useElixirN` batch handler in the
 * buff branch (Inventory.tsx). Buff durations stack, so N activations consume N
 * stacks and extend the buff by N × its base duration.
 *
 * This test seeds 5× Dopalacz XP (xp_boost, minLevel 1), opens the use popup,
 * asserts the amount selector now exists for a buff, taps MAX (5), activates
 * "Aktywuj ×5", and verifies all 5 were consumed (tile gone) and the buff is
 * active (TopHeader buff count = 1, single stacked buff).
 *
 * Cleanup: try/finally -> cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedConsumables } from '../../fixtures/seedInventory';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Shop › Elixirs', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('buff elixir can be activated ×N at once (amount selector + batch consume)', async ({ page }) => {
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

            await seedConsumables({ characterId: created.id, counts: { xp_boost: 5 } });

            // Login -> select -> Town.
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

            // /inventory -> tap the Dopalacz XP stack tile.
            await page.getByRole('button', { name: /^Postać$/i }).tap();
            await expect(page).toHaveURL(/\/inventory$/, { timeout: 10_000 });
            const elixirTile = page.locator('.inventory__bag-tile', {
                has: page.locator('.inventory__bag-tile-name', { hasText: /^Dopalacz XP$/ }),
            }).first();
            await expect(elixirTile).toBeVisible({ timeout: 10_000 });
            await elixirTile.tap({ force: true });

            // Use-potion popup opens.
            const popup = page.locator('.inventory__popup--use-potion');
            await expect(popup).toBeVisible({ timeout: 5_000 });

            // BUG 2 core assertion: the amount selector is now present for a BUFF
            // elixir (previously buffs had only a single "Aktywuj buff" button).
            await expect(popup.locator('.inventory__use-potion-amount')).toBeVisible();

            // Tap MAX -> amount becomes the full stack (5).
            await popup.locator('.inventory__use-potion-max-btn').tap();
            await expect(popup.locator('.inventory__use-potion-amt-value')).toHaveText('5');

            // Activate ×5 (label switches to "Aktywuj ×5" when amount > 1).
            const activate = popup.locator('.inventory__use-potion-btn--use');
            await expect(activate).toContainText(/Aktywuj ×5/);
            await activate.tap();

            // Popup closes.
            await expect(popup).toHaveCount(0, { timeout: 5_000 });

            // All 5 consumed -> the Dopalacz XP tile is gone (stack 0).
            await expect(page.locator('.inventory__bag-tile', {
                has: page.locator('.inventory__bag-tile-name', { hasText: /^Dopalacz XP$/ }),
            })).toHaveCount(0, { timeout: 5_000 });

            // The buff is active (5 stacked into a single xp_boost buff) -> the
            // TopHeader buff button shows 1.
            const buffsBtn = page.locator('.top-header__buffs-btn');
            await expect(buffsBtn).toBeVisible({ timeout: 5_000 });
            await expect(buffsBtn.locator('.top-header__buffs-count')).toHaveText('1');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
