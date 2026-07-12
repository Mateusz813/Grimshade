
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';

test.describe('Auth › Login', { tag: '@auth' }, () => {
    test('happy path: valid credentials -> /character-select', async ({ page }) => {
        await page.goto('/login');

        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();

        await page.locator('input[type="email"]').fill(testUsers.primary.email);
        await page.locator('input[type="password"]').fill(testUsers.primary.password);

        await page.getByRole('button', { name: /zaloguj/i }).tap();

        await expect(page).toHaveURL(/\/character-select$/, { timeout: 15_000 });

        await expect(page.locator('body')).not.toBeEmpty();
    });
});
