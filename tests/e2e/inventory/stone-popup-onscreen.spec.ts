/**
 * Atomic E2E — stone-conversion popup is 100% on-screen on mobile.
 *
 * BUG 1 (2026-06-24): the "Zamiana kamieni" popup (`.inventory__stone-popup`)
 * was the only inventory popup that self-centered via CSS
 * `position:fixed; top/left:50%; transform:translate(-50%,-50%)`. It is also a
 * framer-motion element animating `scale`, and Motion writes its own inline
 * `transform` (scale only), which ERASED the CSS centering translate. The
 * popup's top-left corner then anchored at the viewport center, pushing the
 * right edge + lower part (incl. the convert button) off-screen on a phone.
 *
 * Fix: the popup is now a CHILD of the flex-centered `.inventory__overlay`
 * (centering = the overlay's job), and the self-centering CSS was removed, so
 * Motion's scale is harmless.
 *
 * This test seeds 100 common stones + gold, opens the popup, and asserts its
 * bounding box (and the convert button) is fully within the viewport. Red
 * before the fix (right/bottom overflow), green after.
 *
 * Cleanup: try/finally -> cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { seedInventoryResources } from '../fixtures/seedInventory';
import { cleanupCharacterById } from '../fixtures/cleanup';

test.describe('Inventory › Stones', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('stone-conversion popup is fully within the viewport on mobile', async ({ page }) => {
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

            // 100 common stones (= STONE_CONVERSION_COST) + gold for the fee.
            await seedInventoryResources({
                characterId: created.id,
                gold: 5000,
                stones: { common_stone: 100 },
            });

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

            // /inventory -> tap the common-stone stack tile ("Zwykly Kamien").
            await page.getByRole('button', { name: /^Postać$/i }).tap();
            await expect(page).toHaveURL(/\/inventory$/, { timeout: 10_000 });
            const stoneTile = page.locator('.inventory__bag-tile', {
                has: page.locator('.inventory__bag-tile-name', { hasText: /^Zwykly Kamien$/ }),
            }).first();
            await expect(stoneTile).toBeVisible({ timeout: 10_000 });
            await stoneTile.tap({ force: true });

            // The conversion popup opens.
            const popup = page.locator('.inventory__stone-popup');
            await expect(popup).toBeVisible({ timeout: 5_000 });

            const viewport = page.viewportSize();
            expect(viewport).not.toBeNull();
            const vw = viewport!.width;
            const vh = viewport!.height;

            // The popup card must be fully inside the viewport (1px tolerance).
            const box = await popup.boundingBox();
            expect(box).not.toBeNull();
            expect(box!.x).toBeGreaterThanOrEqual(-1);
            expect(box!.y).toBeGreaterThanOrEqual(-1);
            expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
            expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 1);

            // The convert button (bottom of the card) must also be on-screen.
            const convertBtn = popup.locator('.inventory__stone-popup-btn');
            await expect(convertBtn).toBeVisible();
            const btnBox = await convertBtn.boundingBox();
            expect(btnBox).not.toBeNull();
            expect(btnBox!.x + btnBox!.width).toBeLessThanOrEqual(vw + 1);
            expect(btnBox!.y + btnBox!.height).toBeLessThanOrEqual(vh + 1);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
