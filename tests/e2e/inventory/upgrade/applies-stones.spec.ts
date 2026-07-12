
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedInventoryItem, seedInventoryResources } from '../../fixtures/seedInventory';

test.describe('Inventory › Upgrade', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('apply +1 upgrade to common item -> item gets +1 badge + gold/stones consumed', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, gold: 200, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_helmet',
                rarity: 'common',
                itemLevel: 5,
                upgradeLevel: 0,
            });

            await seedInventoryResources({
                characterId: created.id,
                gold: 200,
                stones: { common_stone: 5 },
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
            await expect(page.locator('.inventory')).toBeVisible({ timeout: 10_000 });

            const bagTiles = page.locator('.inventory__bag-tile:has(.inventory__bag-tile-level)');
            await expect(bagTiles).toHaveCount(1, { timeout: 10_000 });
            const goldBtn = page.locator('.top-header__gold-btn');
            await expect(goldBtn).toHaveAttribute('aria-label', 'Złoto: 200');

            await bagTiles.first().tap();
            await expect(page.locator('.inventory__detail')).toBeVisible({ timeout: 5_000 });

            const enhanceSection = page.locator('.inventory__detail-enhance');
            await expect(enhanceSection).toBeVisible({ timeout: 5_000 });
            await expect(enhanceSection).toContainText('+0');
            await expect(enhanceSection).toContainText('+1');
            await expect(enhanceSection).toContainText('100%');

            const enhanceBtn = page.locator('.inventory__action-btn--enhance');
            await expect(enhanceBtn).toBeEnabled({ timeout: 2_000 });
            await expect(enhanceBtn).toContainText(/Ulepsz/);
            await enhanceBtn.tap();

            await expect(page.locator('.inventory__enhance-result--success')).toBeVisible({ timeout: 4_000 });

            await page.locator('.inventory__detail-close').tap();
            await expect(page.locator('.inventory__detail')).toHaveCount(0, { timeout: 3_000 });

            await expect(goldBtn).toHaveAttribute('aria-label', 'Złoto: 100', { timeout: 15_000 });

            const upgradeOverlay = bagTiles.first().locator('.item-icon__upgrade');
            await expect(upgradeOverlay).toBeVisible({ timeout: 5_000 });
            await expect(upgradeOverlay).toHaveText('+1');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
