
import { test, expect } from '@playwright/test';

test.describe('Auth › Register', { tag: '@auth' }, () => {
    test('rejects password mismatch -> renders inline error + no signup', async ({ page }) => {
        await page.goto('/register');

        await expect(page.locator('input[type="email"]')).toBeVisible();

        const ts = Date.now();
        await page.locator('input[type="email"]').fill(`mismatch-${ts}@grimshade-test.local`);

        const passwordInputs = page.locator('input[type="password"]');
        await passwordInputs.first().fill('Test123456!!');
        await passwordInputs.last().fill('Different987654!!');

        await page.getByRole('button', { name: /zarejestruj/i }).tap();

        await expect(page.getByText('Hasła muszą być takie same')).toBeVisible({ timeout: 5_000 });

        await expect(page).toHaveURL(/\/register$/);
    });
});
