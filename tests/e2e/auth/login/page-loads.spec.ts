
import { test, expect } from '@playwright/test';

test.describe('Auth › Login', { tag: '@auth' }, () => {
    test('smoke: login page renders email + password form', async ({ page }) => {
        await page.goto('/login');

        await expect(page.getByAltText('Grimshade')).toBeVisible();

        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();

        await expect(page.getByRole('button', { name: /zaloguj/i })).toBeVisible();
    });
});
