/**
 * Multi-context E2E — add a friend via the canonical UI flow
 * (BACKLOG 4.10).
 *
 * ## Status — RLS migration APPLIED 2026-05-25
 *
 * The public-SELECT policy from
 * `scripts/characters_public_select_rls_migration.sql`
 * (`CREATE POLICY "anyone reads characters" ON characters FOR SELECT
 * USING (TRUE)`) is APPLIED to production Supabase. Verified end-to-end
 * via the anon REST endpoint:
 *   • Anon SELECT on `/rest/v1/characters?limit=5` returns rows from
 *     MULTIPLE distinct `user_id`s — i.e. cross-user reads now succeed.
 * The earlier seeded-friends workaround is therefore removed in favour
 * of the canonical UI add-flow.
 *
 * ## Test flow (canonical UI add-friend)
 *
 *  1. Seed a character on SECONDARY ("Bar") via service_role so the
 *     lookup target physically exists in `characters`. We seed PRIMARY
 *     too because `/friends` is only reachable after a character is
 *     picked (Town → Społeczność → Znajomi).
 *  2. Both contexts log in via UI in parallel.
 *  3. Both pick their character → land on Town.
 *  4. PRIMARY navigates Town → Społeczność → Znajomi.
 *  5. PRIMARY types the SECONDARY's nick into `.friends__add-input` and
 *     taps "🔍 Szukaj" (`.friends__add-btn`).
 *  6. `.friends__lookup-result` renders the secondary's character meta
 *     (nick + Lv 10 + class). Proves cross-user RLS works.
 *  7. PRIMARY taps "➕ Dodaj" (`.friends__lookup-add`) → addFriend store
 *     action runs → tab counter flips to `Znajomi (1)`.
 *  8. The friends list shows a row with secondary's nick + the three
 *     action buttons (💌 PM / 🚫 Block / ✖ Remove).
 *
 * ## Why multi-context (not solo)
 *
 *  • Friends data (whoIAdded / blocked / favorites) is per-character
 *    state in `useFriendsStore`. The ADDED row's metadata (level / class
 *    / online) comes from `friendsApi.findByName` against the
 *    `characters` table. To prove the cross-user lookup we need the
 *    target to be a REAL character on a DIFFERENT account.
 *  • The secondary context isn't strictly needed for the lookup itself
 *    (the seeded char exists regardless of login state), but keeping
 *    the multi-context fixture aligns this test with sibling
 *    `direct-message.spec.ts` and `block-and-unblock.spec.ts` — same
 *    `openMultiContext` boilerplate → easy review parity.
 *
 * ## Why seedGameSave with `level: 10` on secondary
 *
 * Sets the character.level = 10 so the lookup-result row shows "Lv 10
 * Mage" — pins a concrete render that won't drift if defaults change.
 *
 * ## Cleanup
 *
 *   • `cleanupCharacterById` on both characters (via multiContext.cleanup).
 *   • The friends slice for primary lives in `game_saves` which is in
 *     CHARACTER_CHILD_TABLES, so it's cascaded by primary's cleanup.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { openMultiContext } from '../../fixtures/multiContext';
import type { Page } from '@playwright/test';

test.describe('Social › Friends', { tag: '@social' }, () => {
    // Multi-context = 2× login + 2× character pick + UI add-flow + DB
    // round-trip → 120 s headroom per README convention.
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary types secondary nick → searches → adds friend via UI', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            // 1. Seed characters on BOTH accounts. Secondary is the
            //    LOOKUP TARGET — it must exist in the `characters` table
            //    for `friendsApi.findByName` to find it. Primary is the
            //    actor — it picks its character so the /friends route
            //    becomes reachable from Town.
            const primaryCreated = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: primaryNick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            primaryCharId = primaryCreated.id;
            const secondaryCreated = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: secondaryNick,
                class: 'Mage',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;

            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);

            // Seed game_save rows so applyBlobToStores has a payload to
            // hydrate when each context picks its character. We do NOT
            // pre-seed primary's friends list — the whole point of this
            // test is that the UI add-flow puts the friend in.
            await seedGameSave({ characterId: primaryCharId, userId: primaryUserId });
            await seedGameSave({ characterId: secondaryCharId, userId: secondaryUserId });

            // 2. Open both contexts + parallel login.
            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            // 3. Both pick their character → Town.
            const pickCharacter = async (page: Page, nick: string): Promise<void> => {
                if (!page.url().endsWith('/character-select')) {
                    await page.goto('/character-select');
                }
                await expect(page.locator('.char-select__card-name', { hasText: nick }))
                    .toBeVisible({ timeout: 15_000 });
                const card = page.locator('.char-select__card', {
                    has: page.locator('.char-select__card-name', { hasText: nick }),
                });
                await card.getByRole('button', { name: /Wybierz/i }).tap();
                await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
                await expect(page.locator('.town__char-name')).toHaveText(nick);
            };
            await Promise.all([
                pickCharacter(primaryPage, primaryNick),
                pickCharacter(secondaryPage, secondaryNick),
            ]);

            // 4. PRIMARY: navigate Town → Społeczność → Znajomi.
            await primaryPage.getByRole('button', { name: /^Społeczność$/i }).tap();
            await expect(primaryPage).toHaveURL(/\/social$/, { timeout: 10_000 });
            await primaryPage.locator('.social__tile--znajomi').tap();
            await expect(primaryPage).toHaveURL(/\/friends$/, { timeout: 10_000 });

            // Sanity: counter starts at 0 (no pre-seeded friends).
            const friendsTab = primaryPage.locator('.friends__tab--active');
            await expect(friendsTab).toBeVisible({ timeout: 10_000 });
            await expect(friendsTab).toContainText(/Znajomi\s*\(0\)/, { timeout: 10_000 });

            // 5. Type secondary's nick + tap "🔍 Szukaj".
            const searchInput = primaryPage.locator('.friends__add-input');
            await searchInput.tap();
            await searchInput.fill(secondaryNick);
            const searchBtn = primaryPage.locator('.friends__add-btn');
            await expect(searchBtn).toBeEnabled();
            await searchBtn.tap();

            // 6. `.friends__lookup-result` renders with secondary's meta.
            //    Friends.tsx line 267-289 shows the lookup result card
            //    with icon + nick + "Lv N <class>" + online dot + "➕ Dodaj"
            //    CTA. The CTA only renders when `lookupResult !== null`,
            //    proving `friendsApi.findByName` returned a hit.
            const lookupResult = primaryPage.locator('.friends__lookup-result');
            await expect(lookupResult).toBeVisible({ timeout: 10_000 });
            await expect(lookupResult.locator('.friends__lookup-name'))
                .toHaveText(secondaryNick);
            await expect(lookupResult.locator('.friends__lookup-meta'))
                .toContainText(/Lv\s*10/i);
            await expect(lookupResult.locator('.friends__lookup-meta'))
                .toContainText(/Mage/i);

            // 7. Tap "➕ Dodaj" → confirmAdd() → addFriend + lookup clears.
            const addBtn = lookupResult.locator('.friends__lookup-add');
            await expect(addBtn).toBeVisible();
            await addBtn.tap();

            // Lookup card clears after add (Friends.tsx confirmAdd line
            // 129-135 sets lookupResult/query to null/'').
            await expect(lookupResult).toBeHidden({ timeout: 5_000 });

            // 8. Tab counter flips to (1) — the row landed in the
            //    friends slice via `addFriend(name)`.
            await expect(friendsTab).toContainText(/Znajomi\s*\(1\)/, { timeout: 10_000 });

            // 9. The friends list shows a row scoped to secondary's nick
            //    with the 3 standard action buttons.
            const friendRow = primaryPage.locator('.friends__row', {
                has: primaryPage.locator('.friends__row-name', { hasText: secondaryNick }),
            });
            await expect(friendRow).toBeVisible({ timeout: 10_000 });
            await expect(friendRow.locator('.friends__action--pm')).toBeVisible();
            await expect(friendRow.locator('.friends__action--block')).toBeVisible();
            await expect(friendRow.locator('.friends__action--remove')).toBeVisible();
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            } else {
                const { cleanupCharacterById } = await import('../../fixtures/cleanup');
                const idsToWipe = [primaryCharId, secondaryCharId].filter(
                    (id): id is string => id !== null,
                );
                if (idsToWipe.length > 0) {
                    await Promise.all(idsToWipe.map((id) => cleanupCharacterById(id)));
                }
            }
        }
    });
});
