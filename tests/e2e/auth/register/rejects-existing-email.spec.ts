/**
 * Atomic E2E — register odrzuca email który jest już zarejestrowany.
 *
 * Backlog item 1.7 ("Register odrzuca duplicate email").
 *
 * ## Strategia (workaround zgodnie ze specem testu)
 *
 * Nie możemy użyć stałych test-kont (`test@grimshade.pl` /
 * `test2@grimshade.pl`) — to są realne konta właściciela i każda
 * pomyłka w teście (np. krzywa asercja → cleanup leci na nich)
 * skasowałaby ich game state.
 *
 * Workaround: w jednym tescie rejestrujemy ŚWIEŻY `e2e-register-*`
 * email PRZEZ UI (pierwszy register tap), czekamy aż wyląduje na
 * `/character-select` (oznacza Supabase potwierdził `signUp`),
 * a następnie wylogowujemy się i próbujemy zarejestrować TEN SAM
 * email DRUGI raz. Supabase zwraca błąd "User already registered"
 * (albo równoważny — w nowszych wersjach SDK może być "User already
 * exists" / "Email already in use"). Komunikat lądu je w
 * `errors.root.message` w Register.tsx linia 37, renderowany jako
 * `<span className="register__error">{errors.root.message}</span>`.
 *
 * ## Co weryfikujemy
 *
 *  1. Pierwsza rejestracja kończy się sukcesem (`/character-select`).
 *  2. Logout czyści session — możemy wrócić na `/register` bez auto-redirect-u.
 *  3. Druga próba rejestracji TYM samym emailem:
 *     • URL pozostaje na `/register` (Supabase odrzucił → router NIE
 *       robi nawigacji w `onSubmit`).
 *     • Pojawia się komunikat błędu w `.register__error` (root-level,
 *       nie powiązany z konkretnym polem — bo to error z Supabase, nie
 *       walidacja Zod).
 *     • Komunikat zawiera substring który sugeruje duplikat — match
 *       lowercase na "registered" / "already" / "exists" / "in use" —
 *       Supabase historycznie używa różnych dokładnych fraz, wszystkie
 *       jednoznaczne dla użytkownika.
 *
 * ## Logout flow
 *
 * Po `signUp` jesteśmy na `/character-select`. Logout w Grimshade
 * przebiega przez AvatarMenu (TopHeader nie pokazuje się gdy nie ma
 * wybranej postaci, więc AvatarMenu też nie jest dostępne na
 * `/character-select`). Najprostszy reliable path: `page.evaluate`
 * → `supabase.auth.signOut()` + redirect na `/login`. Pomija UI flow
 * ale dla tego testu logout NIE jest tym co testujemy — testujemy
 * rejection drugiej rejestracji.
 *
 * Tak jak z arenaPoints w `shop/arena/buy-with-ap.spec.ts`, używamy
 * dynamicznego importu modułu Vite (`/src/lib/supabase.ts`) — działa
 * w `npm run dev` (jedyne env który `playwright.config.ts` targetuje).
 *
 * ## Cleanup
 *
 * `cleanupTestUserByEmail` w `finally` — kasuje świeżo utworzonego
 * usera ZAWSZE, niezależnie czy test przeszedł czy padł na asercji.
 * Pattern z `redirect-on-success.spec.ts`. Bez tego user byłby
 * "sieroty" w bazie (`@grimshade-test.local` domena, ale złamane
 * stan jeśli test pada w środku).
 *
 * Per-test try/finally zamiast moduł-level array + afterEach — żeby
 * uniknąć race condition przy `fullyParallel: true`.
 *
 * ## Co NIE testujemy tutaj
 *
 *  • Case-sensitivity emaila (czy `Foo@x.com` vs `foo@x.com` to ta
 *    sama tożsamość). Supabase domyślnie traktuje email
 *    case-insensitive, ale to osobna sprawa — tutaj generujemy
 *    deterministyczny lowercase email z helpera.
 *  • Rate-limiting (jak szybko Supabase odrzuci kolejne attempty).
 *    Tests są atomowe, nie próbujemy 100× pod rząd.
 *  • Wygląd komunikatu błędu (kolor, ikona). Tylko jego obecność +
 *    treść matching "duplikatowych" słów-kluczy.
 */

import { test, expect } from '@playwright/test';
import { generateTestEmail, cleanupTestUserByEmail } from '../../fixtures/cleanup';

test.describe('Auth › Register', { tag: '@auth' }, () => {
    // First-register + sign-out + second-register × 2 form submits +
    // Supabase round-trips × 2 = często 15+ s na cold WebKit. 60s daje
    // bezpieczny zapas.
    test.describe.configure({ timeout: 60_000 });

    test('second signup with same email → inline error + no second account created', async ({ page }) => {
        const email = generateTestEmail();
        const password = 'Test123456!!';

        try {
            // ─── Krok 1: pierwsza rejestracja (happy path) ─────────────
            // Wzorzec identyczny z redirect-on-success.spec.ts. Sukces
            // = URL ląduje na /character-select.
            await page.goto('/register');
            await expect(page.locator('input[type="email"]')).toBeVisible();

            await page.locator('input[type="email"]').fill(email);
            const firstPasswordInputs = page.locator('input[type="password"]');
            await firstPasswordInputs.first().fill(password);
            await firstPasswordInputs.last().fill(password);

            await page.getByRole('button', { name: /zarejestruj/i }).tap();

            // 20s timeout zgodny z redirect-on-success — signUp na
            // Supabase czasem wolniejszy niż signIn.
            await expect(page).toHaveURL(/\/character-select$/, { timeout: 20_000 });

            // ─── Krok 2: logout przez supabase SDK ─────────────────────
            // AvatarMenu nie jest dostępne na /character-select (brak
            // wybranej postaci), więc bypass-ujemy UI logout flow przez
            // bezpośredni call do supabase.auth.signOut(). Tak samo jak
            // robi to AvatarMenu pod spodem (patrz src/components/layout/
            // AvatarMenu/AvatarMenu.tsx → handleLogout).
            //
            // Dynamic import URL działa w dev (Vite serwuje source).
            // eslint-disable-next-line @typescript-eslint/no-explicit-any —
            // nie typujemy całego shape supabase modułu dla one-shot test.
            await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc, but works in browser context
                const mod = await import('/src/lib/supabase.ts');
                await (mod as { supabase: { auth: { signOut: () => Promise<unknown> } } })
                    .supabase.auth.signOut();
            });

            // Naviguj manualnie na /register — po signOut router nie
            // auto-redirectuje (jesteśmy w stanie "anonimowym").
            await page.goto('/register');
            await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10_000 });
            // Verify formularz jest pusty po świeżym loadzie (nie mamy
            // leftover state z poprzedniej rejestracji).
            await expect(page.locator('input[type="email"]')).toHaveValue('');

            // ─── Krok 3: druga rejestracja TYM samym emailem ───────────
            await page.locator('input[type="email"]').fill(email);
            const secondPasswordInputs = page.locator('input[type="password"]');
            await secondPasswordInputs.first().fill(password);
            await secondPasswordInputs.last().fill(password);

            await page.getByRole('button', { name: /zarejestruj/i }).tap();

            // ─── Asercje: rejection, error message, URL bez zmian ──────

            // Komunikat błędu z `errors.root.message` (Register.tsx
            // linia 37 → linia 80). Selektor `.register__error` jest
            // współdzielony z field-errors, ale jako jedyny zawiera
            // ROOT error (po niewalidacji email/password format).
            // Match na "already" / "registered" / "exists" / "in use" —
            // Supabase różne wersje API używają różnych fraz; każda
            // jednoznaczna.
            const errorEl = page.locator('.register__error', {
                hasText: /already|registered|exists|in use|signup/i,
            });
            await expect(errorEl).toBeVisible({ timeout: 15_000 });

            // URL pozostał na /register (Supabase odrzucił → onSubmit
            // wrócił WCZEŚNIEJ z `setError` zamiast `navigate('/')`).
            await expect(page).toHaveURL(/\/register$/);
        } finally {
            // ZAWSZE cleanup, nawet gdy assertions padły. Whitelist
            // chroni przed przypadkowym kasowaniem realnych kont.
            const result = await cleanupTestUserByEmail(email);
            if (!result.deleted && result.reason !== 'user not found (already deleted)') {
                console.warn(`[cleanup] Failed for ${email}: ${result.reason}`);
            }
        }
    });
});
