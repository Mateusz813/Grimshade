/**
 * Atomic E2E — admin panel gating + tab nav (BACKLOG 15.6 — "Admin
 * panel: każdy z 9 tabów ładuje się bez erroru").
 *
 * ## BLOCKER (carried over from BACKLOG note)
 *
 * `ADMIN_EMAIL = 'krasek39@gmail.com'` is the real account email of the
 * project owner (AdminPanel.tsx line 47). Running the full 9-tab smoke
 * with the owner's password in `.env.test` is unacceptable:
 *   • `.env.test` is local + would need to be on CI runner Secrets.
 *   • Test workers parallel-login as the owner → would be visible in
 *     analytics / activity logs / Realtime presence.
 *   • Cleanup helpers refuse to touch the owner's account
 *     (`STABLE_TEST_ACCOUNTS` whitelist in cleanup.ts) — by design.
 *
 * The proper fix is a separate `E2E_ADMIN_EMAIL` test account in Supabase
 * Auth, paired with an `ADMIN_EMAILS` allow-list (set, not single string)
 * in `AdminPanel.tsx` so the test email + production email both pass the
 * gate. This is OWNER DECISION territory — not something a test agent
 * decides unilaterally.
 *
 * ## What this test CAN do without that decision
 *
 * Verify the GATE WORKS. The non-admin path is what 99.9% of users
 * experience and is the load-bearing security boundary:
 *
 *   1. Login as `testUsers.primary` (NOT the admin email).
 *   2. Pick a character → land in Town.
 *   3. Open the avatar menu via the top-header avatar button.
 *   4. Assert "Panel admina" item is NOT visible (proves the
 *      `isAdmin && (...)` conditional at AvatarMenu.tsx line 242 + 271
 *      correctly hides the entry for non-admin sessions).
 *   5. Assert any other normal menu items ARE visible (proves the menu
 *      itself rendered — the negative assertion isn't accidentally
 *      "menu didn't open at all").
 *
 * This pins the gate's behavior atomically. If someone:
 *   - flips the email check to '!==' instead of '===' (regression at
 *     AvatarMenu.tsx line 56),
 *   - removes the `isAdmin &&` guard at AvatarMenu.tsx line 242,
 *   - hard-codes `isAdmin = true` during a refactor,
 *
 * the assertion fires immediately.
 *
 * The full 9-tab tap-each-tab smoke is wired below as a skipped block
 * with the gating spec captured in JSDoc so a future agent who unblocks
 * the admin-account decision can flip `test.skip` → `test` and ship it
 * without re-deriving the spec.
 *
 * ## Why we don't bypass via page.evaluate setAdminOpen(true)
 *
 * AdminPanel re-checks the session email itself (AdminPanel.tsx line
 * 95-103) and bails with `return null` for non-admin sessions. Forcing
 * the React parent state to render `<AdminPanel />` would still render
 * nothing — the gate is layered. The only way to actually render the
 * panel is to log in as an admin email, which loops back to the BLOCKER.
 *
 * ## Cleanup
 *
 * try/finally + cleanupCharacterById. Standard pattern.
 */

import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

/** Pick character → land in Town. */
const pickCharacterAndEnterTown = async (page: Page, nick: string): Promise<void> => {
    await page.goto('/character-select');
    const card = page.locator('.char-select__card', {
        has: page.locator('.char-select__card-name', { hasText: nick }),
    });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: /Wybierz/i }).tap();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
};

test.describe('Admin › Panel', { tag: '@admin' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('non-admin session: avatar menu hides "Panel admina" entry', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight on primary (non-admin). `testUsers.primary.email`
            //    is `test@grimshade.pl` per CLAUDE.md TESTING — different
            //    from `ADMIN_EMAIL = 'krasek39@gmail.com'`. The gate at
            //    AvatarMenu.tsx line 54-57 will resolve `isAdmin = false`
            //    and skip rendering the admin item.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 1, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login + pick → Town.
            await loginViaUI(page, testUsers.primary);
            await pickCharacterAndEnterTown(page, nick);

            // 3. Open avatar menu by tapping the top-header avatar button.
            //    TopHeader.tsx line 233-238: `.top-header__avatar-btn`
            //    triggers `setAvatarOpen(true)` which renders `<AvatarMenu />`
            //    inline in the header (line 367).
            const avatarBtn = page.locator('.top-header__avatar-btn');
            await expect(avatarBtn).toBeVisible({ timeout: 10_000 });
            await avatarBtn.tap();

            // 4. Wait for the menu to actually mount. AvatarMenu renders a
            //    `.avatar-menu` container with item buttons inside.
            //    Use "Wyloguj" as the synchronization barrier — it's
            //    always rendered last in the menu (AvatarMenu.tsx line
            //    254-262), so its visibility proves the FULL menu has
            //    rendered and any earlier `isAdmin &&` block has been
            //    evaluated.
            const logoutItem = page.locator('.avatar-menu__item--danger', { hasText: /Wyloguj/i });
            await expect(logoutItem).toBeVisible({ timeout: 10_000 });

            // 5. ASSERT — "Panel admina" item is NOT visible. This is the
            //    contract: AvatarMenu.tsx line 242 `{isAdmin && (...)}` is
            //    false for the primary test account → the button never
            //    enters the DOM. We assert count=0 (NOT visible-but-hidden,
            //    NOT display:none — entirely absent).
            const adminItem = page.locator('.avatar-menu__item--admin');
            await expect(adminItem).toHaveCount(0);

            // 5b. Belt-and-suspenders — also assert by the label text in
            //     case someone refactors the className but keeps the text.
            //     "Panel admina" is the canonical Polish label
            //     (AvatarMenu.tsx line 250).
            const adminByLabel = page.locator('.avatar-menu__item', { hasText: /Panel admina/i });
            await expect(adminByLabel).toHaveCount(0);

            // 6. Sanity — at least one normal menu item IS visible (proves
            //     we're not just on a blank page). "Zmień postać" is the
            //     first normal item (AvatarMenu.tsx line 167-173) — always
            //     rendered for a logged-in character.
            const changeCharItem = page.locator('.avatar-menu__item', { hasText: /Zmień postać/i });
            await expect(changeCharItem).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });

    // Full 9-tab smoke UNBLOCKED 2026-05-26 — see sibling
    // `all-9-tabs-load.spec.ts` which uses the e2e-admin test account
    // added to `ADMIN_EMAILS` set in AdminPanel.tsx.
});
