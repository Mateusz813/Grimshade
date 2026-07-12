
import { test, expect } from '@playwright/test';
import { generateTestEmail, cleanupTestUserByEmail } from '../../fixtures/cleanup';

test.describe('Auth › Register', { tag: '@auth' }, () => {
    test('happy path: valid signup -> account exists -> /character-select', async ({ page }) => {
        const email = generateTestEmail();
        const password = 'Test123456!!';

        try {
            await page.goto('/register');

            await expect(page.locator('input[type="email"]')).toBeVisible();

            await page.locator('input[type="email"]').fill(email);

            const passwordInputs = page.locator('input[type="password"]');
            await passwordInputs.first().fill(password);
            await passwordInputs.last().fill(password);

            await page.getByRole('button', { name: /zarejestruj/i }).tap();

            await expect(page).toHaveURL(/\/character-select$/, { timeout: 20_000 });

            await expect(page.locator('body')).not.toBeEmpty();
        } finally {
            const result = await cleanupTestUserByEmail(email);
            if (!result.deleted && result.reason !== 'user not found (already deleted)') {
                console.warn(`[cleanup] Failed for ${email}: ${result.reason}`);
            }
        }
    });
});
