
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';

test.describe('Character › Create', { tag: '@character' }, () => {
    test.describe.configure({ timeout: 30_000 });

    test('back button on /create-character returns to /character-select without creating a character', async ({ page }) => {
        await loginViaUI(page, testUsers.primary);
        if (!page.url().endsWith('/character-select')) {
            await page.goto('/character-select');
        }

        const nameLocator = page.locator('.char-select__card-name');
        await expect(nameLocator.first().or(page.locator('.char-select__empty'))).toBeVisible({ timeout: 10_000 });
        const namesBefore = new Set(await nameLocator.allTextContents());

        const createBtn = page.getByRole('button', { name: /Stwórz nową postać/i });
        if (await createBtn.count() > 0) {
            await createBtn.scrollIntoViewIfNeeded();
            await createBtn.tap();
        } else {
            await page.goto('/create-character');
        }
        await expect(page).toHaveURL(/\/create-character$/, { timeout: 10_000 });

        await expect(page.locator('.character-create__back-btn')).toBeVisible();

        await page.locator('.character-create__back-btn').tap();

        await expect(page).toHaveURL(/\/character-select$/, { timeout: 10_000 });

        await expect(nameLocator.first().or(page.locator('.char-select__empty'))).toBeVisible({ timeout: 10_000 });
        const namesAfter = new Set(await nameLocator.allTextContents());
        for (const name of namesBefore) {
            expect(namesAfter.has(name), `expected nick "${name}" to remain on list after back-button discard`).toBe(true);
        }
    });
});
