
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedConsumables } from '../../fixtures/seedInventory';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Inventory › Filter', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('the "Spell Chesty" backpack filter shows owned spell chests', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 60, highest_level: 60, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;
            await seedConsumables({
                characterId: created.id,
                counts: { spell_chest_5: 3, spell_chest_10: 2, spell_chest_25: 1, spell_chest_1000: 1 },
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

            await expect(page.locator('.inventory__filter-row--slots')).toBeVisible({ timeout: 10_000 });

            await expect(
                page.locator('.inventory__bag-tile-name', { hasText: /Spell Chest/i }).first(),
            ).toBeVisible({ timeout: 10_000 });

            await page.locator('button[title="Spell Chesty"]').tap();

            await expect(page.locator('.inventory__empty')).toHaveCount(0);
            const chestTile = page.locator('.inventory__bag-tile-name', { hasText: /Spell Chest/i });
            await expect(chestTile.first()).toBeVisible({ timeout: 10_000 });
            await expect(chestTile).not.toHaveCount(0);

            await page.getByRole('button', { name: 'Zwykly', exact: true }).tap();
            await expect(page.locator('.inventory__empty')).toHaveCount(0);
            await expect(
                page.locator('.inventory__bag-tile-name', { hasText: /Spell Chest/i }).first(),
            ).toBeVisible({ timeout: 10_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
