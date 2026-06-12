/**
 * Atomic E2E — login odrzuca błędne hasło.
 *
 * Setup state:  fresh anonymous browser context.
 * One action:   wypełnij email = primary, password = świadomie zły +
 *               tap submit.
 * One outcome:  Renderuje się `.login__error` z komunikatem zwróconym
 *               przez Supabase ("Invalid login credentials"), URL
 *               pozostaje na `/login` (BEZ redirect).
 *
 * Login.tsx (linie 26-36) na error z `signInWithPassword` woła
 * `setError('root', { message: error.message })` -> react-hook-form
 * podpina message do `errors.root` -> JSX renderuje
 * `<span className="login__error">{errors.root.message}</span>`.
 *
 * Supabase zwraca dla złego hasła generic
 * "Invalid login credentials" (anti-enumeration — nie ujawnia czy
 * email istnieje). Regex `/invalid/i` zabezpiecza przed minor zmianami
 * copy (np. "Invalid credentials" w nowszej wersji SDK).
 *
 * BEZ cleanup-u — nie tworzymy żadnego state, tylko czytamy odpowiedź
 * z Supabase Auth. Stałe konto `primary` jest nietknięte.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';

test.describe('Auth › Login', { tag: '@auth' }, () => {
    test('rejects invalid password -> renders error message + stays on /login', async ({ page }) => {
        await page.goto('/login');

        await expect(page.locator('input[type="email"]')).toBeVisible();

        await page.locator('input[type="email"]').fill(testUsers.primary.email);
        await page.locator('input[type="password"]').fill('wrong-password-12345');

        await page.getByRole('button', { name: /zaloguj/i }).tap();

        // Error message wyrenderowane — Supabase zwrócił error, hook form
        // setError('root') wystawił `.login__error`.
        // 15s timeout bo Supabase network call.
        await expect(page.locator('.login__error')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.login__error')).toContainText(/invalid/i);

        // Negative assert — NIE było redirect na `/character-select` ani `/`.
        // URL musi pozostać na `/login` (router pokazuje Login bo brak session).
        await expect(page).toHaveURL(/\/login$/);
    });
});
