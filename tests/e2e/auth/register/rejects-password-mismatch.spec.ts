/**
 * Atomic E2E — register odrzuca password ≠ confirmPassword.
 *
 * Setup state:  fresh anonymous browser + unique test email.
 * One action:   wypełnij email + dwa różne hasła + tap submit.
 * One outcome:  Zod refine (`Register.tsx` linie 14-18) zwraca błąd
 *               na ścieżce `confirmPassword`. JSX renderuje
 *               `<span className="register__error">Hasła muszą być takie same</span>`.
 *               URL pozostaje na `/register`, ŻADEN user nie został
 *               utworzony (walidacja jest klient-side, przed `signUp`).
 *
 * BEZ cleanup-u — żaden user nie powstał w Supabase Auth. Email jest
 * unikalny żeby uniknąć jakichkolwiek interferencji z innymi testami.
 *
 * Note: nie używamy `generateTestEmail()` z cleanup.ts bo ten helper
 * jest dla *USERÓW których trzeba potem skasować*. Tutaj user nigdy
 * nie zostaje stworzony (walidacja blokuje submit), więc generujemy
 * email inline.
 */

import { test, expect } from '@playwright/test';

test.describe('Auth › Register', { tag: '@auth' }, () => {
    test('rejects password mismatch -> renders inline error + no signup', async ({ page }) => {
        await page.goto('/register');

        await expect(page.locator('input[type="email"]')).toBeVisible();

        // Email nie musi być cleanup-owany — zod refine blokuje submit
        // ZANIM dojdzie do `supabase.auth.signUp()`. Used random email
        // żeby fakirować jakiemukolwiek browser autocomplete-owi.
        const ts = Date.now();
        await page.locator('input[type="email"]').fill(`mismatch-${ts}@grimshade-test.local`);

        // 2 inputy `type="password"`: pierwszy "Hasło", drugi "Potwierdź".
        // Render order = Register.tsx linie 58-79.
        const passwordInputs = page.locator('input[type="password"]');
        await passwordInputs.first().fill('Test123456!!');
        await passwordInputs.last().fill('Different987654!!');

        await page.getByRole('button', { name: /zarejestruj/i }).tap();

        // Komunikat zod refine z Register.tsx linia 16.
        // Krótki timeout 5s — zod walidacja jest synchroniczna.
        await expect(page.getByText('Hasła muszą być takie same')).toBeVisible({ timeout: 5_000 });

        // Negative assert — NIE było redirect. Strona pozostała na `/register`.
        // Gdyby zod minął i `signUp` poszedł, router przekierowałby na
        // `/character-select` (success path z redirect-on-success.spec.ts).
        await expect(page).toHaveURL(/\/register$/);
    });
});
