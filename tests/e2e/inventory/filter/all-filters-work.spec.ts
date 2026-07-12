
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedInventoryItem } from '../../fixtures/seedInventory';

test.describe('Inventory › Filter', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('rarity filter narrows to matching items; slot filter narrows by group; "Wszystkie" resets', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await seedInventoryItem({
                characterId: created.id,
                itemId: 'wooden_mace',
                rarity: 'common',
                itemLevel: 1,
            });
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_helmet',
                rarity: 'rare',
                itemLevel: 5,
            });
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'leather_armor',
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

            const rareFilter = page.locator('.inventory__filter-btn', { hasText: /^Rzadki$/ }).first();
            await rareFilter.tap();
            await expect(rareFilter).toHaveClass(/inventory__filter-btn--active/);

            await expect(bagTiles).toHaveCount(1, { timeout: 5_000 });

            const allRarity = page.locator('.inventory__filter-btn', { hasText: /^Wszystkie$/ }).first();
            await allRarity.tap();
            await expect(allRarity).toHaveClass(/inventory__filter-btn--active/);
            await expect(bagTiles).toHaveCount(3, { timeout: 5_000 });

            const weaponsFilter = page.locator('.inventory__filter-btn--slot', { hasText: /^Bronie$/ });
            await weaponsFilter.tap();
            await expect(weaponsFilter).toHaveClass(/inventory__filter-btn--active/);
            await expect(bagTiles).toHaveCount(1, { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
