
import { test, expect } from '@playwright/test';

test.describe('Auth › Login', { tag: '@auth' }, () => {
    test('rejects malformed email -> zod validation surfaces inline', async ({ page }) => {
        await page.goto('/login');

        await expect(page.locator('input[type="email"]')).toBeVisible();

        await page.locator('input[type="email"]').fill('foo@bar');
        await page.locator('input[type="password"]').fill('any-password-here');

        await page.getByRole('button', { name: /zaloguj/i }).tap();

        await expect(page.locator('.login__error')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('.login__error')).toContainText('Nieprawidłowy email');

        await expect(page).toHaveURL(/\/login$/);
    });
});
