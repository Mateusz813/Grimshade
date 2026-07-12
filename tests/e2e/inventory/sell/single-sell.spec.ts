
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedInventoryItem } from '../../fixtures/seedInventory';
import { waitForAppReady } from '../../fixtures/appReady';

test.describe('Inventory › Sell', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });
    test.describe.configure({ retries: 5 });

    test('tap bag tile -> tap "Sprzedaj" -> item removed + gold counter increases by sell price', async ({ page }) => {
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

            await bagTiles.first().tap();
            await expect(page.locator('.inventory__detail')).toBeVisible({ timeout: 5_000 });

            const sellBtn = page.locator('.inventory__action-btn--sell');
            await expect(sellBtn).toContainText(/Sprzedaj/);
            await sellBtn.tap();

            await expect(page.locator('.inventory__detail')).toHaveCount(0, { timeout: 5_000 });

            await expect(bagTiles).toHaveCount(0, { timeout: 5_000 });

            await expect(page.locator('.top-header__gold-value')).toHaveText('16 gp', { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
