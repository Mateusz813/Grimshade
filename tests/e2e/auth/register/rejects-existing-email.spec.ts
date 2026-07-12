
import { test, expect } from '@playwright/test';
import { generateTestEmail, cleanupTestUserByEmail } from '../../fixtures/cleanup';

test.describe('Auth › Register', { tag: '@auth' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('second signup with same email -> inline error + no second account created', async ({ page }) => {
        const email = generateTestEmail();
        const password = 'Test123456!!';

        try {
            await page.goto('/register');
            await expect(page.locator('input[type="email"]')).toBeVisible();

            await page.locator('input[type="email"]').fill(email);
            const firstPasswordInputs = page.locator('input[type="password"]');
            await firstPasswordInputs.first().fill(password);
            await firstPasswordInputs.last().fill(password);

            await page.getByRole('button', { name: /zarejestruj/i }).tap();

            await expect(page).toHaveURL(/\/character-select$/, { timeout: 20_000 });

            await page.evaluate(async () => {
                const mod = await import('/src/lib/supabase.ts');
                await (mod as { supabase: { auth: { signOut: () => Promise<unknown> } } })
                    .supabase.auth.signOut();
            });

            await page.goto('/register');
            await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10_000 });
            await expect(page.locator('input[type="email"]')).toHaveValue('');

            await page.locator('input[type="email"]').fill(email);
            const secondPasswordInputs = page.locator('input[type="password"]');
            await secondPasswordInputs.first().fill(password);
            await secondPasswordInputs.last().fill(password);

            await page.getByRole('button', { name: /zarejestruj/i }).tap();


            const errorEl = page.locator('.register__error', {
                hasText: /already|registered|exists|in use|signup/i,
            });
            await expect(errorEl).toBeVisible({ timeout: 15_000 });

            await expect(page).toHaveURL(/\/register$/);
        } finally {
            const result = await cleanupTestUserByEmail(email);
            if (!result.deleted && result.reason !== 'user not found (already deleted)') {
                console.warn(`[cleanup] Failed for ${email}: ${result.reason}`);
            }
        }
    });
});
