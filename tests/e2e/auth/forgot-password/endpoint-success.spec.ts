
import { test, expect } from '@playwright/test';

test.describe('Auth › Forgot Password', { tag: '@auth' }, () => {
    test('endpoint responds with success on valid email submit', async ({ page }) => {
        await page.goto('/forgot-password');

        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.getByRole('button', { name: /wyślij/i })).toBeVisible();

        await page.locator('input[type="email"]').fill('forgot-check@grimshade-test.local');

        await page.getByRole('button', { name: /wyślij/i }).tap();

        await expect(page.getByText(/link resetujący został wysłany/i))
            .toBeVisible({ timeout: 15_000 });

        await expect(page.locator('.forgot-password__error')).toHaveCount(0);
    });
});
