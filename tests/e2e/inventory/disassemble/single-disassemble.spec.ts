
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedInventoryItem } from '../../fixtures/seedInventory';

test.describe('Inventory › Disassemble', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('tap "Rozloz" -> progress bar -> item removed + success popup (with stubbed Math.random)', async ({ page }) => {
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
                itemId: 'iron_helmet',
                rarity: 'common',
                itemLevel: 5,
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
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('.inventory')).toBeVisible({ timeout: 10_000 });

            const bagTiles = page.locator('.inventory__bag-tile:has(.inventory__bag-tile-level)');
            await expect(bagTiles).toHaveCount(1, { timeout: 10_000 });

            await page.evaluate(() => {
                let counter = 0;
                Math.random = () => 0.10 + (counter++ % 9000000) * 1e-8;
            });

            await expect(bagTiles.first()).toBeVisible({ timeout: 5_000 });
            const tileIcon = bagTiles.first().locator('.item-icon').first();
            const detailPanel = page.locator('.inventory__detail');
            for (let attempt = 1; attempt <= 3; attempt++) {
                await tileIcon.tap();
                try {
                    await expect(detailPanel).toBeVisible({ timeout: 3_000 });
                    break;
                } catch (err) {
                    if (attempt === 3) throw err;
                }
            }

            const disassembleBtn = page.locator('.inventory__action-btn--disassemble');
            await expect(disassembleBtn).toBeVisible({ timeout: 5_000 });
            await expect(disassembleBtn).toContainText(/Rozloz/);
            await expect(disassembleBtn).toBeEnabled();
            await disassembleBtn.tap({ force: true });

            await expect(page.locator('.inventory__disassemble-progress')).toBeVisible({ timeout: 2_000 });

            await expect(page.locator('.inventory__disassemble-result--success')).toBeVisible({ timeout: 5_000 });

            await expect(bagTiles).toHaveCount(0, { timeout: 2_000 });

            const result = page.locator('.inventory__disassemble-result--success');
            await expect(result).toContainText('Zwykly Kamien');
            await expect(result).toContainText('x1');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
