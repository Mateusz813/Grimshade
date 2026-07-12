
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import {
    seedGameSave,
    findUserIdByEmail,
    generateFillerBagItems,
    generateDepositItem,
} from '../../fixtures/seedGameSave';

test.describe('City › Deposit', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('full bag (1000/1000) blocks "Wypłać wszystkie" + per-tile tap silently fails', async ({ page }) => {
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

            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                bagItems: generateFillerBagItems(1000),
                depositItems: [generateDepositItem('wooden_sword')],
            });

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const charCard = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(charCard).toBeVisible({ timeout: 10_000 });
            await charCard.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/deposit');
            await expect(page.locator('.deposit__title')).toContainText('Depozyt');

            const panels = page.locator('.deposit__panel');
            await expect(panels).toHaveCount(2);

            const bagPanel = panels.nth(0);
            const depositPanel = panels.nth(1);
            await expect(bagPanel.locator('.deposit__panel-count')).toContainText('1000 / 1000');
            await expect(depositPanel.locator('.deposit__panel-count')).toContainText('1 / 10000');

            const depositBulkBtn = depositPanel.locator('.deposit__bulk-btn');
            await expect(depositBulkBtn).toContainText('Wypłać wszystkie');
            await expect(depositBulkBtn).toBeDisabled();

            const depositTiles = depositPanel.locator('.deposit__tile');
            await expect(depositTiles).toHaveCount(1);
            const firstTile = depositTiles.first();

            await firstTile.tap();

            await expect(depositTiles).toHaveCount(1, { timeout: 3_000 });
            await expect(depositPanel.locator('.deposit__panel-count')).toContainText('1 / 10000');
            await expect(bagPanel.locator('.deposit__panel-count')).toContainText('1000 / 1000');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
