
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Inventory › Auto-Sell', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('toggle Common auto-sell -> button flips active class + text bidirectionally', async ({ page }) => {
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

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/inventory');
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('.inventory__auto-sell')).toBeVisible({ timeout: 10_000 });

            const commonBtn = page.locator('.inventory__auto-sell-btn').filter({
                hasText: /^Zwykle/,
            });
            await expect(commonBtn).toBeVisible({ timeout: 5_000 });
            await expect(commonBtn.locator('svg.game-icon')).toHaveAttribute('data-icon', 'cross-mark');
            await expect(commonBtn).not.toHaveClass(/inventory__auto-sell-btn--active/);

            for (let attempt = 1; attempt <= 3; attempt++) {
                await commonBtn.tap({ force: true });
                try {
                    await expect(commonBtn.locator('svg.game-icon')).toHaveAttribute('data-icon', 'check-mark-button', { timeout: 3_000 });
                    break;
                } catch (err) {
                    if (attempt === 3) throw err;
                }
            }
            await expect(commonBtn).toHaveClass(/inventory__auto-sell-btn--active/);

            const rareBtn = page.locator('.inventory__auto-sell-btn--rare');
            await expect(rareBtn).not.toHaveClass(/inventory__auto-sell-btn--active/);
            await expect(rareBtn.locator('svg.game-icon')).toHaveAttribute('data-icon', 'cross-mark');

            await page.waitForTimeout(150);
            for (let attempt = 1; attempt <= 3; attempt++) {
                await commonBtn.tap({ force: true });
                try {
                    await expect(commonBtn.locator('svg.game-icon')).toHaveAttribute('data-icon', 'cross-mark', { timeout: 3_000 });
                    break;
                } catch (err) {
                    if (attempt === 3) throw err;
                }
            }
            await expect(commonBtn).not.toHaveClass(/inventory__auto-sell-btn--active/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
