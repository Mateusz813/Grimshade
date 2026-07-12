
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedInventoryItem } from '../../fixtures/seedInventory';

test.describe('Inventory › Disassemble', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('bulk mode -> select all -> "Rozloz zaznaczone" -> all removed + result popup with 3 stones (stubbed RNG)', async ({ page }) => {
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

            for (const itemId of ['iron_mace', 'iron_sword', 'iron_helmet']) {
                await seedInventoryItem({
                    characterId: created.id,
                    itemId,
                    rarity: 'common',
                    itemLevel: 1,
                });
            }

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

            await expect(page.locator('.inventory__bag-count')).toContainText('Plecak: 3', { timeout: 10_000 });
            const bagTiles = page.locator('.inventory__bag-tile:has(.inventory__bag-tile-level)');
            await expect(bagTiles).toHaveCount(3);

            await page.evaluate(() => {
                let counter = 0;
                Math.random = () => 0.10 + (counter++ % 9000000) * 1e-8;
            });

            const disassembleToggle = page.locator('.inventory__multi-sell-toggle--disassemble');
            await expect(disassembleToggle).toBeVisible();
            await disassembleToggle.tap();

            const bulkLabel = page.locator('.inventory__bulk-mode-label');
            await expect(bulkLabel).toBeVisible({ timeout: 5_000 });
            await expect(bulkLabel).toContainText('Tryb rozkladania');

            await page.locator('.inventory__multi-btn--tx', { hasText: 'Zaznacz wszystkie' }).tap();
            await expect(page.locator('.inventory__bag-tile--selected')).toHaveCount(3, { timeout: 5_000 });

            const massDisassembleBtn = page.locator('.inventory__mass-disassemble-btn');
            await expect(massDisassembleBtn).toBeVisible({ timeout: 5_000 });
            await expect(massDisassembleBtn).toContainText('3 szt');

            await massDisassembleBtn.tap();

            await expect(page.locator('.inventory__disassemble-anim-overlay')).toBeVisible({ timeout: 2_000 });

            await expect(page.locator('.inventory__bulk-result')).toBeVisible({ timeout: 4_000 });
            await expect(bagTiles).toHaveCount(0);

            const resultPopup = page.locator('.inventory__bulk-result');
            await expect(resultPopup).toContainText('Rozlozono przedmiotow');
            await expect(resultPopup).toContainText('3');
            await expect(resultPopup.locator('.inventory__bulk-result-stones')).toContainText('Zwykly Kamien');
            await expect(resultPopup.locator('.inventory__bulk-result-stones')).toContainText('x3');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
