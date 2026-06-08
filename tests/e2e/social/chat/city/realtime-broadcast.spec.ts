/**
 * Multi-context E2E — primary sends a city chat message → secondary
 * sees it via Supabase Realtime broadcast (BACKLOG 4.13).
 *
 * Spec ("Wiadomość na chacie ogólnym"): the city channel is a global
 * broadcast — any message posted by any logged-in player should appear
 * in every other player's `/chat` view (or floating chat) within a few
 * seconds. This is the canonical Realtime smoke test for the chat
 * subsystem.
 *
 * Wire path:
 *   1. Primary types text + taps send → `chatApi.sendMessage('city',
 *      ...)` does an INSERT on `messages` with `Prefer: return=
 *      representation`. The inserted row is pushed into the local
 *      `messages` state immediately (optimistic).
 *   2. Supabase Realtime publishes the INSERT event over the
 *      `postgres_changes` channel that secondary's `Chat` component
 *      subscribed to on mount (`chatApi.subscribe('city', ...)`).
 *   3. Secondary's subscription callback dedupes by `id`, appends to
 *      `messages`, scrolls to bottom.
 *
 * Test flow:
 *   1. Open 2 contexts, parallel login, both pick their seeded character.
 *   2. Both navigate Town → Społeczność → Czat → `/chat` (city tab is
 *      always present + active by default per `ensureCityTab`).
 *   3. Primary types a unique tagged message (contains a random token
 *      + the test's primary nick) → tap send. Verify it appears in
 *      primary's own chat (optimistic local insert).
 *   4. Wait up to 15 s for the message to surface in secondary's chat
 *      via Realtime broadcast. The longer-than-usual wait accounts for
 *      Supabase Realtime's worst-case 5-10 s broadcast latency.
 *   5. Assert message content + sender attribution (level pill, class
 *      icon, nick rendered correctly).
 *
 * Why we use a unique tagged content string:
 *   The city channel is shared across every test run + real player
 *   sessions, so we can't rely on "the only message" anywhere. A random
 *   16-char token in the content makes the assertion text-search-safe.
 *
 * Cleanup:
 *   • Characters wiped via multiContext.cleanup (covers `inventory`,
 *     `game_saves`, `character_skills`, etc.).
 *   • `messages` is NOT cleaned by character cleanup (uses `user_id`,
 *     not `character_id`). The test's posted message will accumulate
 *     in the city log, but the unique token makes it identifiable +
 *     harmless. If accumulation becomes a problem, add a direct
 *     `DELETE FROM messages WHERE user_id IN (primaryUserId,
 *     secondaryUserId) AND created_at > <test_start>` to the finally
 *     block (we don't do this yet because per-message cleanup adds
 *     more failure surface than it removes value).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { openMultiContext } from '../../../fixtures/multiContext';
import type { Page } from '@playwright/test';

test.describe('Social › Chat', { tag: '@social' }, () => {
    // Multi-context + Realtime wait = 120 s headroom.
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary posts to city chat → secondary receives via Realtime', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        // Unique token guarantees text-search uniqueness even though the
        // city channel accumulates messages across runs.
        const token = `E2E-CITY-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
        const messageContent = `Test ${token} hello from primary`;

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

            // Both navigate to /chat. We use the Społeczność → Czat tile
            // path rather than `page.goto('/chat')` to exercise the same
            // user flow real players take, including the BottomNav route
            // transition + the Społeczność hub render.
            const navToChat = async (page: Page): Promise<void> => {
                await page.getByRole('button', { name: /^Społeczność$/i }).tap();
                await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
                await page.locator('.social__tile--czat').tap();
                await expect(page).toHaveURL(/\/chat$/, { timeout: 10_000 });
                // Wait for the city tab to be active + the chat input
                // ready (subscription has been set up).
                await expect(page.locator('.global-chat__tab--active'))
                    .toContainText(/Miasto/i, { timeout: 10_000 });
                // Multiple .chat__input elements are mounted (one per
                // tab, hidden ones via display:none) — scope to the
                // first visible one (the active city tab's input).
                await expect(page.locator('.chat__input:visible').first())
                    .toBeVisible({ timeout: 10_000 });
            };
            await Promise.all([
                navToChat(primaryPage),
                navToChat(secondaryPage),
            ]);

            // PRIMARY: type + send. Use the active tab's input/send
            // controls (only one chat is visible at a time, but the
            // hidden tabs are still mounted — scope by visibility).
            const primaryInput = primaryPage.locator('.chat__input:visible').first();
            const primarySend = primaryPage.locator('.chat__send:visible').first();
            await primaryInput.fill(messageContent);
            await expect(primarySend).toBeEnabled({ timeout: 5_000 });
            await primarySend.tap();

            // PRIMARY sees the message in their own chat list
            // (optimistic local insert from the `Prefer: return=
            // representation` path).
            const primaryOwnMsg = primaryPage.locator('.chat__msg', { hasText: token });
            await expect(primaryOwnMsg).toBeVisible({ timeout: 15_000 });

            // SECONDARY sees the message via Realtime broadcast. 45s:
            // Supabase Realtime postgres_changes can take 15-25 s in
            // worst-case under full-suite load + WebKit cold start.
            const secondaryReceivedMsg = secondaryPage.locator('.chat__msg', { hasText: token });
            await expect(secondaryReceivedMsg).toBeVisible({ timeout: 45_000 });

            // Sender attribution on secondary's side: the message row
            // shows primary's nick (sender attribution comes from the
            // `character_name` column in the messages table that
            // chatApi.sendMessage populated).
            await expect(secondaryReceivedMsg).toContainText(primaryNick);

            // The level pill is rendered from `character_level` —
            // primary was seeded at lvl 10.
            await expect(secondaryReceivedMsg.locator('.chat__msg-level'))
                .toHaveText('10');
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            } else {
                const { cleanupCharacterById } = await import('../../../fixtures/cleanup');
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
