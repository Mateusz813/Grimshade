/**
 * Atomic E2E — login odrzuca malformed email (zod walidacja).
 *
 * Setup state:  fresh anonymous browser context.
 * One action:   wypełnij email = 'foo@bar' (passes HTML5 native validation
 *               bo ma `@`, ale FAILuje zod `.email()` bo brak TLD) +
 *               jakieś valid password + tap submit.
 * One outcome:  Zod schema (`Login.tsx` linie 9-13:
 *               `email: z.string().email('Nieprawidłowy email')`) zablokuje
 *               submit → `errors.email` jest set → renderuje się
 *               `<span className="login__error">Nieprawidłowy email</span>`.
 *               URL pozostaje na `/login` (form NIE wysłał nic do Supabase).
 *
 * Różnica vs rejects-invalid-credentials: TAM forma idzie do Supabase
 * z prawidłowo sformatowanym email-em → backend odrzuca → `errors.root`.
 * TUTAJ klient-side zod odrzuca przed network → `errors.email` (specific
 * field error, NIE root). Selector `.login__error` łapie oba bo to ten
 * sam CSS class.
 *
 * Dlatego asercja matchuje na konkretny tekst zod-a ("Nieprawidłowy email"),
 * a nie na regex `/invalid/i` (który by zlapał obie ścieżki niezróżnicowanie).
 *
 * Dlaczego NIE `'not-an-email'`: bez `@` browser refuses to submit form
 * (input[type="email"] native validation gate). Wtedy zod nigdy nie
 * zostanie odpalony — form nie odpalił `handleSubmit`. Wartość MUSI być
 * akceptowalna dla HTML5 (mieć @, mieć domain part), ale zod ma
 * strict-er regex i odmawia `foo@bar` bez TLD.
 */

import { test, expect } from '@playwright/test';

test.describe('Auth › Login', { tag: '@auth' }, () => {
    test('rejects malformed email → zod validation surfaces inline', async ({ page }) => {
        await page.goto('/login');

        await expect(page.locator('input[type="email"]')).toBeVisible();

        // Malformed email — `foo@bar` przechodzi HTML5 native validation
        // (ma `@`, ma jakiś domain), ale zod 4.x `.email()` wymaga TLD
        // (kropka + min jeden segment) → zod refuse → renderuje error.
        // Wartość bez `@` (np. `'not-an-email'`) zatrzymałaby browser ZANIM
        // formularz w ogóle by się odpalił — wtedy nie zobaczymy zod-a.
        await page.locator('input[type="email"]').fill('foo@bar');
        await page.locator('input[type="password"]').fill('any-password-here');

        await page.getByRole('button', { name: /zaloguj/i }).tap();

        // Zod error pokazuje się natychmiast (klient-side, brak network call).
        // Krótki timeout 5s wystarczy — nie czekamy na nic asynchronicznego.
        await expect(page.locator('.login__error')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('.login__error')).toContainText('Nieprawidłowy email');

        // Negative — nie ma redirect, jesteśmy nadal na `/login`.
        await expect(page).toHaveURL(/\/login$/);
    });
});
