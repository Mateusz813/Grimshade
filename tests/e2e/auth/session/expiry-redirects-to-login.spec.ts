/**
 * Atomic E2E — BACKLOG 15.1: session expiry → protected route → redirect.
 *
 * Scenario: a logged-in player whose Supabase JWT was wiped (token
 * expired, manually cleared, lost via storage quota, etc.) tries to
 * navigate to a protected route. App MUST redirect to `/login`,
 * NOT silently render the protected view with stale data.
 *
 * Setup state:
 *   1. Seed character via API so `/inventory` has a real character to
 *      render after login (Inventory.tsx hard-returns null without one).
 *   2. Login via UI → pick character → land in Town with valid session.
 *   3. Verify avatar button is present (sanity: real session restored
 *      stores). Without this we can't tell if the redirect came from
 *      "no session" or "Inventory crashed on a fresh-character ID".
 *
 * One action:   wipe Supabase JWT from localStorage (key `sb-{ref}-auth-token`,
 *               default storage key for supabase-js v2 createClient) →
 *               `page.goto('/inventory')` (full page load forces App.tsx
 *               to re-run `supabase.auth.getSession()` against an empty
 *               localStorage → returns `{ data: { session: null } }`).
 * One outcome:  URL = `/login` + login form visible (proves we hit
 *               <Login /> via the `path="/login"` route, not just any
 *               redirect target).
 *
 * Why a full reload (vs `evaluate(() => supabase.auth.signOut())`):
 *   The task explicitly says "verify expired/invalid token = /login
 *   redirect" — that's the production failure mode (JWT TTL expired,
 *   server returns 401, our auth listener never fires). Clearing
 *   localStorage + reload simulates exactly that — App.tsx wakes up
 *   "cold" with no session. Calling signOut() would trigger the
 *   `onAuthStateChange` listener path which is already covered by
 *   `auth/logout/clears-session.spec.ts`. The two tests cover the two
 *   real failure modes (explicit logout vs ambient token loss).
 *
 * Why we navigate to `/inventory` (not `/`):
 *   `/` is special-cased in AppRouter (line 122-134): no session → redirect
 *   to /login. That's the "happy path" of the redirect chain.
 *   `/inventory` is gated by the generic `<ProtectedRoute>` wrapper
 *   (the same pattern as 15+ other routes: /shop, /party, /quests, etc.).
 *   Testing it proves the GENERIC guard works, which is what protects
 *   the bulk of the app. If `/inventory` redirects, so do all siblings.
 *
 * Cleanup: `cleanupCharacterById` in `finally`. Session itself doesn't
 * need cleanup (we *want* it gone for the test, and the next test gets
 * a fresh browser context per Playwright defaults).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Auth › Session', { tag: '@auth' }, () => {
    // Login + character pick + Town hydration + storage wipe + full reload
    // + redirect chain ≈ 4-5 nav transitions on WebKit cold start.
    test.describe.configure({ timeout: 60_000 });

    test('cleared Supabase token → navigating to /inventory redirects to /login', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight. hp_regen=0 so no background ticks race with
            //    the page reload / asserts (cargo-culted from other auth tests).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login → /character-select → pick our character → Town.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 3. Sanity — Town rendered with our nick. Proves session was
            //    valid + stores hydrated. Without this assert, a flake in
            //    character-select → Town transition would look like
            //    "redirect worked" when really nothing was loaded.
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 4. WIPE Supabase JWT from localStorage. supabase-js v2's
            //    default storage key is `sb-{project-ref}-auth-token` —
            //    we don't have the ref at test-time, so we sweep every
            //    `sb-*-auth-token` key (there's only one per env in
            //    practice but the loop future-proofs against env swaps
            //    mid-suite). Also clear `sb-{ref}-auth-token-code-verifier`
            //    just to be thorough — refresh tokens may leak otherwise.
            await page.evaluate(() => {
                const keys = Object.keys(window.localStorage);
                for (const k of keys) {
                    if (k.startsWith('sb-')) {
                        window.localStorage.removeItem(k);
                    }
                }
            });

            // 5. Try to enter a protected route. Full-reload navigation
            //    (page.goto vs SPA route change) is intentional — it forces
            //    App.tsx to re-mount, re-run `supabase.auth.getSession()`,
            //    and discover the empty storage. SPA-nav alone wouldn't
            //    flip `session` state because `onAuthStateChange` doesn't
            //    fire when storage is wiped silently from outside.
            await page.goto('/inventory');

            // 6. PRIMARY assertion — URL settles on /login. AppRouter:
            //      `path="/inventory"` → <ProtectedRoute session={null}>
            //      → <Navigate to="/login" replace />
            //    → URL changes synchronously after Navigate resolves.
            await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });

            // 7. SANITY — login form actually rendered (proves we hit the
            //    public /login route which renders <Login />, not a
            //    coincidental redirect to e.g. /character-select). Without
            //    this we'd false-positive on any /login URL even if it was
            //    a blank screen mid-redirect.
            await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5_000 });
            await expect(page.locator('input[type="password"]')).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
