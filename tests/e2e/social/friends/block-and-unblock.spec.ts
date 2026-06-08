/**
 * Multi-context E2E — primary blocks secondary via the chat context
 * menu → secondary's messages stop rendering on primary's side; then
 * primary unblocks via /friends Zablokowani tab → subsequent messages
 * flow through (BACKLOG 4.12).
 *
 * Spec ("Zablokuj + odblokuj znajomego"): blocking is CLIENT-SIDE —
 * the blocked user's messages still hit the `messages` table + are
 * delivered to the blocker's `Chat` component via Realtime, but the
 * render layer drops them via:
 *
 *   if (isBlocked(msg.character_name) && msg.character_name !== characterName) {
 *       return null;
 *   }
 *
 * (Chat.tsx ~line 310). Block state is local-per-character (persisted
 * via `characterScope` into the `blocked` slice of `game_saves`), so
 * the secondary doesn't know they were blocked and keeps posting
 * freely. The blocker simply doesn't see those rows.
 *
 * Why we don't use the Friends list to add secondary first:
 *   Under current Supabase RLS (`characters` SELECT limited to own
 *   rows), `friendsApi.findByName` cannot find another user's
 *   character — so the "add friend → tap 🚫 on friend row" flow is
 *   impossible cross-user. The chat context menu provides an
 *   alternative path: tap the sender name on any city-chat message
 *   → menu → "🚫 Zablokuj gracza". This works regardless of RLS
 *   because the menu reads sender metadata straight from the message
 *   row (not from `characters` table).
 *
 * Test flow:
 *   1. Both characters seeded + logged in + parked in Town.
 *   2. Both navigate to /chat → city tab.
 *   3. Secondary posts "before-block" message → primary sees it
 *      (proves Realtime healthy pre-block).
 *   4. Primary taps secondary's nick in the chat row → menu opens →
 *      tap "🚫 Zablokuj gracza". `blockUser` mutates local store.
 *   5. The "before-block" message disappears from primary's DOM
 *      (filtered out by isBlocked guard on next render).
 *   6. Secondary posts "during-block" message → primary still doesn't
 *      see it after waiting beyond the normal Realtime delivery
 *      window.
 *   7. Primary navigates /friends → Zablokowani tab → tap "🔓
 *      Odblokuj" → confirm modal → confirm.
 *   8. Primary navigates back to /chat → secondary posts "after-
 *      unblock" message → primary now sees it.
 *
 * The 3-phase coverage (before / during / after) proves:
 *   • Realtime pipe works at baseline.
 *   • Block filter actually drops rows from DOM.
 *   • Unblock mutation is observed by the same `useFriendsStore.
 *     isBlocked` subscription that the message map reads — i.e. the
 *     filter is NOT a one-shot snapshot.
 *
 * Cleanup: characters wiped via multiContext. Messages stay in the
 *   city log but unique tokens make them harmless.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { openMultiContext } from '../../fixtures/multiContext';
import type { Page } from '@playwright/test';

test.describe('Social › Friends', { tag: '@social' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary blocks secondary → messages hidden; unblock → messages visible again', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const tokenBefore = `E2E-BLOCK-BEFORE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const tokenDuring = `E2E-BLOCK-DURING-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const tokenAfter = `E2E-BLOCK-AFTER-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
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
            await seedGameSave({ characterId: primaryCharId, userId: primaryUserId });
            await seedGameSave({ characterId: secondaryCharId, userId: secondaryUserId });

            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

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

            // Both navigate to /chat (city tab is the default active
            // tab via ensureCityTab in GlobalChat).
            const navToChat = async (page: Page): Promise<void> => {
                await page.getByRole('button', { name: /^Społeczność$/i }).tap();
                await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
                await page.locator('.social__tile--czat').tap();
                await expect(page).toHaveURL(/\/chat$/, { timeout: 10_000 });
                await expect(page.locator('.global-chat__tab--active'))
                    .toContainText(/Miasto/i, { timeout: 10_000 });
                await expect(page.locator('.chat__input:visible').first())
                    .toBeVisible({ timeout: 10_000 });
            };
            await Promise.all([
                navToChat(primaryPage),
                navToChat(secondaryPage),
            ]);

            const secondaryInput = secondaryPage.locator('.chat__input:visible').first();
            const secondarySend = secondaryPage.locator('.chat__send:visible').first();

            // ── Step 1: secondary posts BEFORE-block message; primary
            //    must see it (proves Realtime works pre-block).
            await secondaryInput.fill(`Pre-block ${tokenBefore}`);
            await expect(secondarySend).toBeEnabled({ timeout: 5_000 });
            await secondarySend.tap();

            // 45s: the cross-context broadcast can take 15-25s under
            // full-suite load.
            const beforeMsgOnPrimary = primaryPage.locator('.chat__msg', { hasText: tokenBefore });
            await expect(beforeMsgOnPrimary).toBeVisible({ timeout: 45_000 });
            await expect(beforeMsgOnPrimary).toContainText(secondaryNick);

            // ── Step 2: primary opens chat menu on secondary's message
            //    by tapping the sender-name button → menu pops up →
            //    tap "🚫 Zablokuj gracza".
            //    The .chat__msg-name button has onClick → openMenu (chat
            //    context menu equivalent) — both touch + click open the
            //    same menu rendered through a Portal at document.body.
            await beforeMsgOnPrimary.locator('.chat__msg-name').click();
            const chatMenu = primaryPage.locator('.chat__menu');
            await expect(chatMenu).toBeVisible({ timeout: 5_000 });
            await chatMenu.getByRole('button', { name: /Zablokuj gracza/i }).click();
            await expect(chatMenu).toBeHidden({ timeout: 5_000 });

            // ── Step 3: after block, the BEFORE-block message MUST be
            //    filtered out (the message stays in `messages[]` but
            //    the render maps it to null via `isBlocked` guard).
            await expect(beforeMsgOnPrimary).toBeHidden({ timeout: 10_000 });

            // ── Step 4: secondary posts DURING-block message; primary
            //    must NOT see it. We wait beyond the normal Realtime
            //    delivery window (12 s — city test sees worst-case
            //    5-10 s) and then assert the row never rendered.
            await secondaryInput.fill(`During-block ${tokenDuring}`);
            await expect(secondarySend).toBeEnabled({ timeout: 5_000 });
            await secondarySend.tap();

            // Sanity on secondary's own side: they see their own send
            // (optimistic insert). Proves the send actually succeeded.
            await expect(secondaryPage.locator('.chat__msg', { hasText: tokenDuring }))
                .toBeVisible({ timeout: 15_000 });

            // Wait beyond Realtime delivery window.
            await primaryPage.waitForTimeout(12_000);
            await expect(primaryPage.locator('.chat__msg', { hasText: tokenDuring }))
                .toHaveCount(0);

            // ── Step 5: primary navigates /friends → Zablokowani tab
            //    → tap "🔓 Odblokuj" on secondary's row → confirm modal
            //    → confirm.
            //    Why not unblock via chat menu: the chat menu only
            //    opens on a visible message, but secondary's messages
            //    are filtered out (isBlocked=true) — there are no
            //    rendered rows to tap. /friends Zablokowani is the
            //    designed-recovery path.
            await primaryPage.getByRole('button', { name: /^Społeczność$/i }).tap();
            await expect(primaryPage).toHaveURL(/\/social$/, { timeout: 10_000 });
            await primaryPage.locator('.social__tile--znajomi').tap();
            await expect(primaryPage).toHaveURL(/\/friends$/, { timeout: 10_000 });

            const blockedTab = primaryPage.locator('.friends__tab', { hasText: /Zablokowani/i });
            await expect(blockedTab).toContainText(/Zablokowani\s*\(1\)/, { timeout: 10_000 });
            await blockedTab.tap();

            const blockedRow = primaryPage.locator('.friends__row--blocked', {
                has: primaryPage.locator('.friends__row-name', { hasText: secondaryNick }),
            });
            await expect(blockedRow).toBeVisible({ timeout: 10_000 });

            await blockedRow.locator('.friends__action--unblock').tap();
            const confirmModal = primaryPage.locator('.friends__confirm-modal');
            await expect(confirmModal).toBeVisible({ timeout: 5_000 });
            await confirmModal.getByRole('button', { name: /^Odblokuj$/i }).tap();
            await expect(confirmModal).toBeHidden({ timeout: 5_000 });
            await expect(blockedTab).toContainText(/Zablokowani\s*\(0\)/, { timeout: 5_000 });

            // ── Step 6: navigate back to /chat (city tab), secondary
            //    posts AFTER-unblock message, primary sees it now.
            await primaryPage.goto('/chat');
            await expect(primaryPage.locator('.global-chat__tab--active'))
                .toContainText(/Miasto/i, { timeout: 10_000 });
            await expect(primaryPage.locator('.chat__input:visible').first())
                .toBeVisible({ timeout: 10_000 });

            await secondaryInput.fill(`After-unblock ${tokenAfter}`);
            await expect(secondarySend).toBeEnabled({ timeout: 5_000 });
            await secondarySend.tap();

            // 45s: the cross-context broadcast can take 15-25s under
            // full-suite load (post-unblock re-render).
            const afterMsgOnPrimary = primaryPage.locator('.chat__msg', { hasText: tokenAfter });
            await expect(afterMsgOnPrimary).toBeVisible({ timeout: 45_000 });
            await expect(afterMsgOnPrimary).toContainText(secondaryNick);
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
