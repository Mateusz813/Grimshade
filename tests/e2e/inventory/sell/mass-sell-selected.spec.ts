
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

            await expect(page.locator('.inventory__bag-count')).toContainText('Plecak: 3', { timeout: 10_000 });
            const bagTiles = page.locator('.inventory__bag-tile');
            await expect(bagTiles).toHaveCount(3);
            const goldBtn = page.locator('.top-header__gold-btn');
            await expect(goldBtn).toHaveAttribute('aria-label', 'Złoto: 0');

            const sellToggle = page.locator('.inventory__multi-sell-toggle--sell');
            await expect(sellToggle).toBeVisible();
            await sellToggle.tap();

            const bulkLabel = page.locator('.inventory__bulk-mode-label');
            await expect(bulkLabel).toBeVisible({ timeout: 5_000 });
            await expect(bulkLabel).toContainText('Tryb sprzedazy');

            await page.locator('.inventory__multi-btn--tx', { hasText: 'Zaznacz wszystkie' }).tap();

            await expect(page.locator('.inventory__bag-tile--selected')).toHaveCount(3, { timeout: 5_000 });

            const sellFooterBtn = page.locator('.inventory__multi-sell-btn');
            await expect(sellFooterBtn).toBeVisible({ timeout: 5_000 });
            await expect(sellFooterBtn).toContainText('3 szt');
            await expect(sellFooterBtn).toContainText('56 gp');

            await sellFooterBtn.tap();

            await expect(bagTiles).toHaveCount(0, { timeout: 5_000 });
            await expect(page.locator('.inventory__bulk-mode-label')).toHaveCount(0);

            await expect(goldBtn).toHaveAttribute('aria-label', 'Złoto: 56', { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
