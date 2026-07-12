
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

test.describe('Auto-Potion › Settings', { tag: '@auto-potion' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('settings popup renders 4 threshold slots (Flat HP / Flat MP / Pct HP / Pct MP)', async ({ page }) => {
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
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 20_000 });

            await page.getByRole('button', { name: /^auto-potion$/i }).tap();

            const popup = page.locator('.inventory__popup--potion');
            await expect(popup).toBeVisible({ timeout: 5_000 });

            await expect(popup.getByText('Potiony')).toBeVisible();

            await expect(popup.getByRole('button', { name: /Auto-potion/i })).toBeVisible();
            await expect(popup.getByRole('button', { name: /Alchemia/i })).toBeVisible();

            await expect(popup.locator('.inventory__popup-tab--active'))
                .toContainText(/Auto-potion/i);

            await expect(popup.locator('.inventory__potion-setting')).toHaveCount(4);

            await expect(popup.getByText('Auto HP Potion')).toBeVisible();
            await expect(popup.getByText('Auto MP Potion')).toBeVisible();
            await expect(popup.getByText('Auto % HP Potion')).toBeVisible();
            await expect(popup.getByText('Auto % MP Potion')).toBeVisible();

            await expect(popup.locator('input[type="range"]')).toHaveCount(4);

            await expect(popup.locator('input[type="checkbox"].inventory__potion-checkbox')).toHaveCount(4);

            await expect(popup.locator('select.inventory__potion-dropdown')).toHaveCount(4);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
