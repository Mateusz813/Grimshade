
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';

test.describe('Auth › Login', { tag: '@auth' }, () => {
    test('rejects invalid password -> renders error message + stays on /login', async ({ page }) => {
        await page.goto('/login');

        await expect(page.locator('input[type="email"]')).toBeVisible();

        await page.locator('input[type="email"]').fill(testUsers.primary.email);
        await page.locator('input[type="password"]').fill('wrong-password-12345');

        await page.getByRole('button', { name: /zaloguj/i }).tap();

        await expect(page.locator('.login__error')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.login__error')).toContainText(/invalid/i);

        await expect(page).toHaveURL(/\/login$/);
    });
});
