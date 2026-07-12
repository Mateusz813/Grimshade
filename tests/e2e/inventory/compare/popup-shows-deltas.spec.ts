
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedInventoryItem, seedEquippedItem } from '../../fixtures/seedInventory';

test.describe('Inventory › Compare', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('tap bag item with same-slot equipped item -> popup shows comparison column with deltas', async ({ page }) => {
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

            await seedEquippedItem({
                characterId: created.id,
                slot: 'helmet',
                itemId: 'iron_helmet',
                rarity: 'common',
                itemLevel: 5,
            });

            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_helmet',
                rarity: 'rare',
                itemLevel: 5,
                bonuses: { hp: 20 },
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

            await expect(page.locator('.inventory__doll-slot--helmet')).toHaveClass(/inventory__doll-slot--filled/, { timeout: 10_000 });

            const bagTiles = page.locator('.inventory__bag-tile');
            await expect(bagTiles).toHaveCount(1);

            await bagTiles.first().tap();
            await expect(page.locator('.inventory__detail')).toBeVisible({ timeout: 5_000 });

            await expect(page.locator('.inventory__detail')).toHaveClass(/inventory__detail--comparing/);

            const newCol = page.locator('.inventory__detail-col--new');
            await expect(newCol).toBeVisible();
            await expect(newCol.locator('.inventory__detail-col-tag').first()).toContainText('Nowy');

            const eqCol = page.locator('.inventory__detail-col--equipped');
            await expect(eqCol).toBeVisible();
            await expect(eqCol.locator('.inventory__detail-col-tag--equipped')).toContainText('Założony');

            await expect(eqCol.locator('.inventory__compare-stats')).toBeVisible({ timeout: 5_000 });

            await expect(eqCol.locator('.inventory__compare-stat').first()).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
