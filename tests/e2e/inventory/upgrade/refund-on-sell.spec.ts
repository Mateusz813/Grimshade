
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { waitForAppReady } from '../../fixtures/appReady';
import { seedInventoryItem } from '../../fixtures/seedInventory';

test.describe('Inventory › Upgrade', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });
    test.describe.configure({ retries: 8 });

    test('sell +2 upgraded item -> gold = base + 100% refund AND stones returned', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, gold: 0, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_mace',
                rarity: 'common',
                itemLevel: 1,
                upgradeLevel: 2,
            });

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/inventory');
            await waitForAppReady(page);
            await expect(page.locator('.inventory')).toBeVisible({ timeout: 10_000 });

            const bagTiles = page.locator('.inventory__bag-tile');
            await expect(bagTiles).toHaveCount(1, { timeout: 10_000 });
            await expect(page.locator('.top-header__gold-value')).toHaveText('0 gp');

            const upgradeOverlay = bagTiles.first().locator('.item-icon__upgrade');
            await expect(upgradeOverlay).toBeVisible({ timeout: 5_000 });
            await expect(upgradeOverlay).toHaveText('+2');

            await bagTiles.first().tap();
            await expect(page.locator('.inventory__detail')).toBeVisible({ timeout: 5_000 });

            const sellBtn = page.locator('.inventory__action-btn--sell');
            await expect(sellBtn).toBeVisible({ timeout: 5_000 });
            await expect(sellBtn).toContainText('Sprzedaj');
            await expect(sellBtn).toContainText('616 gp');
            await expect(sellBtn).toContainText('+2');
            await expect(sellBtn.locator('svg.game-icon[data-icon="gem-stone"]')).toBeVisible();

            await sellBtn.tap();

            await expect(page.locator('.inventory__detail')).toHaveCount(0, { timeout: 5_000 });

            await expect(page.locator('.top-header__gold-value')).toHaveText('616 gp', { timeout: 5_000 });

            const gearTiles = page.locator('.inventory__bag-tile:has(.inventory__bag-tile-level)');
            await expect(gearTiles).toHaveCount(0, { timeout: 5_000 });

            const stonesTile = page.locator('.inventory__bag-tile', {
                has: page.locator('.inventory__bag-tile-name', { hasText: 'Zwykly Kamien' }),
            });
            await expect(stonesTile).toBeVisible({ timeout: 5_000 });

            const stonesCount = stonesTile.locator('.item-icon__quantity');
            await expect(stonesCount).toHaveText('x2', { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
