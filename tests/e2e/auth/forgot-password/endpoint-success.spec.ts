/**
 * Atomic E2E — forgot-password endpoint health check.
 *
 * Setup state:  fresh anonymous browser context.
 * One action:   wypełnij email + tap "Wyślij link".
 * One outcome:  Renderuje się `.forgot-password__success` z tekstem
 *               "Link resetujący został wysłany…" — POTWIERDZA że
 *               Supabase `auth.resetPasswordForEmail()` zwróciła
 *               `error: null`, więc endpoint POST `/auth/v1/recover`
 *               jest live i odpowiada cleanly.
 *
 * NIE weryfikujemy:
 *  - czy mail rzeczywiście przyszedł (do tego potrzebny mailbox /
 *    Mailtrap / Inbucket — out of scope dla prostego endpoint check-a)
 *  - czy link w mailu działa (oddzielny test, nie w tym pliku)
 *
 * Dlaczego używamy fake-TLD emaila zamiast `test@grimshade.pl`:
 *  Supabase `resetPasswordForEmail` WYSYŁA mailing nawet jeśli zwraca
 *  generic-success dla nieistniejących userów (anti-enumeration). Dla
 *  istniejącego `test@grimshade.pl` Supabase wyśle prawdziwego maila
 *  za każdym test-runem → zatłucze inbox. Dla fake-TLD `@grimshade-test.local`
 *  Supabase próbuje wysłać → SMTP nie znajdzie MX recordu → silently fails →
 *  zero zaśmiecania.
 *
 *  Endpoint i tak zwraca success/no-error niezależnie od tego czy email
 *  istnieje (security: nie ujawniamy które emaile są w bazie), więc test
 *  pokrywa zachowanie endpoint-a tak samo dobrze.
 */

import { test, expect } from '@playwright/test';

test.describe('Auth › Forgot Password', { tag: '@auth' }, () => {
    test('endpoint responds with success on valid email submit', async ({ page }) => {
        await page.goto('/forgot-password');

        // Sanity — formularz wyrenderowany przed interakcją
        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.getByRole('button', { name: /wyślij/i })).toBeVisible();

        // Fake-TLD email — nie generujemy unique ani nie cleanup-ujemy, bo
        // `resetPasswordForEmail` nie tworzy nowych user-ów (działa tylko
        // na istniejących + tych co nie istnieją zwraca generic success).
        // Hard-coded `@grimshade-test.local` — nie maczamy testowych
        // primary/secondary kont żeby ich inboxa nie zaśmiecić.
        await page.locator('input[type="email"]').fill('forgot-check@grimshade-test.local');

        await page.getByRole('button', { name: /wyślij/i }).tap();

        // Komponent przełącza widok na success-state po `setSent(true)`.
        // Text z ForgotPassword.tsx linia 40 — jeśli zmiana copy, dostosuj regex.
        await expect(page.getByText(/link resetujący został wysłany/i))
            .toBeVisible({ timeout: 15_000 });

        // Negative assertion — explicit że nie ma error message obok success.
        // `.forgot-password__error` jest renderowane tylko gdy `errors.root`
        // jest set (z setError('root', ...) po Supabase error response).
        await expect(page.locator('.forgot-password__error')).toHaveCount(0);
    });
});
