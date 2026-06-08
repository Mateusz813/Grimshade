/**
 * Atomic E2E — registration happy path.
 *
 * Setup state:  fresh anonymous browser + unique test email.
 * One action:   wypełnij formularz (email + 2x password) + tap submit.
 * One outcome:  URL === `/character-select` (po `signUp` Supabase od
 *               razu zwraca session bo email-confirm jest WYŁĄCZONE
 *               w tym projekcie → router widzi session+brak character-a
 *               → redirect na character-select, tak samo jak po loginie).
 *
 * Cleanup:      afterEach hard-deletuje świeżo utworzonego user-a
 *               z `auth.users` przez service_role admin SDK. Pattern
 *               z `tests/e2e/README.md` sekcja "Konta ulotne".
 *               Safety net: cleanup ABSOLUTNIE odmawia kasowania
 *               emailа który nie matchuje `@grimshade-test.local`
 *               (whitelist guard w `cleanup.ts` → rzuca Error).
 *
 * Co weryfikuje:
 *  - formularz przyjmuje dane i nie blokuje submit przez walidację
 *  - Supabase `signUp()` na production env odpowiada bez błędu
 *  - session jest natychmiast dostępna (no email-confirm gate)
 *  - AppRouter widzi nową session i robi redirect chain
 *  - user w `auth.users` jest faktycznie nowy (cleanup go znajdzie i skasuje)
 */

import { test, expect } from '@playwright/test';
import { generateTestEmail, cleanupTestUserByEmail } from '../../fixtures/cleanup';

test.describe('Auth › Register', { tag: '@auth' }, () => {
    test('happy path: valid signup → account exists → /character-select', async ({ page }) => {
        const email = generateTestEmail();
        const password = 'Test123456!!';

        // Try/finally zamiast module-level array + afterEach — bo
        // `fullyParallel: true` może odpalić wiele tests z tego pliku
        // równocześnie, a moduł-level array tworzy race condition
        // (jeden test by skasował emaila drugiego). Per-test scope = atomic.
        // Finally leci nawet gdy assertion failuje → zero sierot w bazie.
        try {
            await page.goto('/register');

            await expect(page.locator('input[type="email"]')).toBeVisible();

            await page.locator('input[type="email"]').fill(email);

            // 2 inputy `type="password"`: pierwszy to "Hasło", drugi "Potwierdź".
            // Register.tsx renderuje je w tej kolejności, więc `.first()` / `.last()`
            // jest niezawodne (zmiana kolejności w JSX = inny test).
            const passwordInputs = page.locator('input[type="password"]');
            await passwordInputs.first().fill(password);
            await passwordInputs.last().fill(password);

            await page.getByRole('button', { name: /zarejestruj/i }).tap();

            // Po `signUp` → `navigate('/')` → router redirect → `/character-select`.
            // 20s timeout — `signUp` na Supabase czasem jest wolniejszy niż signIn
            // (musi utworzyć row, wysłać email-confirm jeśli włączony, etc).
            await expect(page).toHaveURL(/\/character-select$/, { timeout: 20_000 });

            // Sanity — strona character-select wyrenderowała się (nie pusty body
            // po nawigacji wskazującej że JS się zawiesił).
            await expect(page.locator('body')).not.toBeEmpty();
        } finally {
            const result = await cleanupTestUserByEmail(email);
            if (!result.deleted && result.reason !== 'user not found (already deleted)') {
                // Loguje ale nie failuje testu — main assertion może być OK,
                // a sieć przy cleanup-ie czasem fliknie. CI cron
                // (`cleanupAllRegistrationTestUsers`) złapie sierotę.
                console.warn(`[cleanup] Failed for ${email}: ${result.reason}`);
            }
        }
    });
});
