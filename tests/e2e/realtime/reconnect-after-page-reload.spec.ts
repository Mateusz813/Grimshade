/**
 * Multi-context E2E — Realtime channel re-subscribes after a page reload
 * while the user is in the chat city context (BACKLOG 15.4 smoke variant).
 *
 * ## What we're proving
 *
 * Spec ("Realtime: dropped WebSocket -> auto-reconnect -> state restored"):
 * the canonical "resilience" check is that broken WebSocket connections
 * heal themselves and the user keeps receiving updates. Simulating a
 * real WebSocket disconnect from the test (`page.route` to block ws://,
 * offline toggle, etc.) is brittle on WebKit + opaque to debug.
 *
 * Pragmatic smoke: **page reload mid-session** exercises the same
 * underlying contract — that subscriptions re-establish cleanly after
 * the channel is torn down. On a hard reload:
 *   1. React unmounts (Chat.tsx `useEffect` cleanup runs ->
 *      `supabase.removeChannel(sub)` for every active channel).
 *   2. JS env resets — no leftover sockets, no stale subscriber state.
 *   3. React re-mounts after page load -> `Chat.tsx useEffect` re-runs ->
 *      `chatApi.subscribe('city', onMessage)` creates a fresh
 *      `supabase.channel(...).on('postgres_changes', ...).subscribe()`.
 *   4. Subsequent INSERTs on the `messages` table land via the NEW
 *      channel sub.
 *
 * If any step in 1-4 regresses (e.g. cleanup leaves a zombie sub, or the
 * re-mount fires `subscribe` before authState restores), this test
 * catches it: the post-reload broadcast either never arrives (timeout)
 * or arrives via the wrong channel (mismatched text).
 *
 * ## Test flow
 *
 *   1. Open 2 contexts, parallel login, both pick characters -> Town.
 *   2. Both navigate Town -> Społeczność -> Czat -> /chat (city tab).
 *   3. PRIMARY sends message #1. SECONDARY receives via initial WS sub.
 *      Sanity check that the channel is healthy before we tear it down.
 *   4. SECONDARY `page.reload()` — kills the entire JS env + WebSocket.
 *      Browser navigates back to /chat (the URL persists) but every
 *      store + channel + ref hits its constructor again from scratch.
 *   5. SECONDARY waits for /chat to re-mount + city tab to be active
 *      again (Chat.tsx subscription `useEffect` fires on mount). Wait
 *      explicitly for the input to be visible so we know the chat
 *      panel re-rendered.
 *   6. PRIMARY sends message #2 (unique token). SECONDARY MUST receive
 *      it via the FRESH WS sub created during the re-mount.
 *
 * ## Why two messages (not one)
 *
 * Message #1 proves the initial subscription works — without it, a
 * regression in step 1 setup would make message #2 a false-positive
 * (we'd attribute the failure to "reconnect broken" when really the
 * subscription was never set up in the first place). Message #2 is
 * what proves the reconnect actually re-subscribed. Two messages,
 * separated by reload, isolate the two failure modes.
 *
 * ## What this does NOT cover (intentional)
 *
 *   - Real WebSocket disconnect (network drop, server restart) —
 *     simulating these from a Playwright test is too brittle. The
 *     reload covers the SAME underlying re-subscribe path.
 *   - Persistent state restoration (chat history, message catch-up
 *     during downtime). Chat is ephemeral by design — messages sent
 *     while the secondary was reloading are lost (no message buffer
 *     between unmount and re-mount). That's a separate test if needed
 *     (would have to query DB for messages WHERE created_at >
 *     disconnect_time AND channel='city' and assert UI shows them on
 *     re-mount).
 *   - Multiple reload cycles. One reload exercises the full path; N+1
 *     reloads test the same code N more times for no extra coverage.
 *
 * ## Timing
 *
 *   - Initial sub + broadcast: typically 1-3 s, up to 15 s on cold
 *     WebKit. We give 20 s.
 *   - page.reload + chat re-mount + new sub: ~3-5 s. We give 25 s for
 *     mobile-chrome cold paths.
 *   - Post-reload broadcast: 20 s like the initial wait. The full test
 *     budget needs ~60-90 s on the slowest profile — 180 s in
 *     `test.describe.configure` is comfortable.
 *
 * Cleanup: characters via multiContext fixture. `messages` rows are not
 * cleaned (per README convention — messages.user_id ≠ character_id so
 * cleanup doesn't cascade). The unique token in each message makes them
 * harmless even if they linger.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../fixtures/seedGameSave';
import { openMultiContext } from '../fixtures/multiContext';

test.describe('Realtime › Reconnect', { tag: '@realtime' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('multi-context: secondary page.reload mid-chat -> still receives subsequent primary message via Realtime', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        // Two unique tokens — one per message — so the assertions can
        // distinguish the pre-reload and post-reload deliveries.
        const tokenBefore = `E2E-RC-PRE-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
        const tokenAfter = `E2E-RC-POST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
        const messageBefore = `Reconnect test ${tokenBefore} (pre-reload)`;
        const messageAfter = `Reconnect test ${tokenAfter} (post-reload)`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            // 1. Seed characters.
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

            // 2. Seed game_saves.
            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({ characterId: primaryCharId, userId: primaryUserId });
            await seedGameSave({ characterId: secondaryCharId, userId: secondaryUserId });

            // 3. Open multi-context + parallel login.
            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            // 4. Both pick characters -> Town.
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

            // 5. Both navigate Town -> Społeczność -> Czat -> /chat (city
            //    tab active by default per `ensureCityTab` in chatStore).
            const navToChat = async (page: Page): Promise<void> => {
                await page.getByRole('button', { name: /^Społeczność$/i }).tap();
                await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
                await page.locator('.social__tile--czat').tap();
                await expect(page).toHaveURL(/\/chat$/, { timeout: 10_000 });
                await expect(page.locator('.global-chat__tab--active'))
                    .toContainText(/Miasto/i, { timeout: 10_000 });
                // Visible input + send button = subscription established
                // + Chat panel rendered. Multiple .chat__input mounted (1
                // per tab) — scope to visible.
                await expect(page.locator('.chat__input:visible').first())
                    .toBeVisible({ timeout: 10_000 });
            };
            await Promise.all([
                navToChat(primaryPage),
                navToChat(secondaryPage),
            ]);

            // 6. Helper to type+send a message on a given page's city chat.
            const sendInChat = async (page: Page, text: string): Promise<void> => {
                const input = page.locator('.chat__input:visible').first();
                const send = page.locator('.chat__send:visible').first();
                await input.fill(text);
                await expect(send).toBeEnabled({ timeout: 5_000 });
                await send.tap();
            };

            // 7. PRE-RELOAD broadcast: primary sends message #1.
            //    Secondary's initial subscription should deliver it via
            //    Realtime within 20 s. This is the sanity check that
            //    the channel is healthy before we tear it down.
            await sendInChat(primaryPage, messageBefore);

            // PRIMARY's own message renders locally (optimistic insert).
            await expect(primaryPage.locator('.chat__msg', { hasText: tokenBefore }))
                .toBeVisible({ timeout: 15_000 });

            // SECONDARY receives via initial Realtime sub. 45s: the
            // cross-context broadcast can take 15-25s under full-suite load.
            await expect(secondaryPage.locator('.chat__msg', { hasText: tokenBefore }))
                .toBeVisible({ timeout: 45_000 });

            // 8. SECONDARY: trigger reconnect by reloading the page. This:
            //    - Unmounts every component (Chat.tsx useEffect cleanup
            //      fires -> `supabase.removeChannel` on every active sub).
            //    - Throws away the entire JS env (no state survives).
            //    - After reload, App.tsx re-runs `getSession()` against
            //      localStorage — the Supabase session is preserved across
            //      reload (stored in localStorage), so the user stays
            //      logged in + character pick state survives.
            //
            //    `page.reload()` with `waitUntil: 'load'` blocks until the
            //    initial HTML + JS have finished evaluating — by then
            //    React has begun mounting but may not have hit our chat
            //    `useEffect` yet. We follow with explicit waits to ensure
            //    the new subscription is up before sending message #2.
            await secondaryPage.reload({ waitUntil: 'load' });

            // 9. SECONDARY: wait for the post-reload session re-hydrate
            //    flow. Supabase reads its session from localStorage on
            //    mount, character picker re-runs, and either the user
            //    lands back on /chat (URL persisted) or gets bounced to
            //    `/character-select` if the session didn't restore.
            //
            //    Browser preserves the URL across reload, but the App
            //    router needs a character to render /chat (otherwise
            //    redirects to /character-select). Since the character
            //    state for the active session lives in localStorage too
            //    (`grimshade-active-character-{userId}` per
            //    characterScope.ts), the active character flag should
            //    survive and Chat should re-mount.
            //
            //    Safety net: if for any reason the secondary lands on
            //    /character-select after reload, re-pick the character.
            const postReloadUrl = secondaryPage.url();
            if (/\/character-select/.test(postReloadUrl)) {
                await pickCharacter(secondaryPage, secondaryNick);
                // After pick, manually nav back to /chat.
                await secondaryPage.goto('/chat');
            }

            // Wait for /chat to be re-mounted + city tab visible + input
            // re-rendered. The visible chat input is the proxy for "chat
            // panel mounted + useEffect ran + subscription established".
            await expect(secondaryPage).toHaveURL(/\/chat$/, { timeout: 25_000 });
            await expect(secondaryPage.locator('.global-chat__tab--active'))
                .toContainText(/Miasto/i, { timeout: 15_000 });
            await expect(secondaryPage.locator('.chat__input:visible').first())
                .toBeVisible({ timeout: 15_000 });

            // 10. Settle window — let the subscription `.subscribe()`
            //     finish its handshake. Without this we sometimes see
            //     the post-reload broadcast race the channel's joined-
            //     state on slow WebKit + mobile-chrome under cumulative
            //     runs. 4 s is comfortable above the typical 1-2 s
            //     handshake latency.
            await secondaryPage.waitForTimeout(4_000);

            // 11. POST-RELOAD broadcast: primary sends message #2. The
            //     FRESH secondary subscription should deliver it.
            await sendInChat(primaryPage, messageAfter);

            // PRIMARY's own message renders locally.
            await expect(primaryPage.locator('.chat__msg', { hasText: tokenAfter }))
                .toBeVisible({ timeout: 15_000 });

            // 12. CRITICAL ASSERTION: secondary receives message #2 via
            //     the post-reload subscription. If reconnect is broken,
            //     this times out (no broadcast lands).
            //
            //     45 s headroom — covers (a) Supabase Realtime worst
            //     case 5-10 s broadcast latency, (b) WebKit / Chromium
            //     cold WS handshake on the post-reload sub, (c) cumulative-
            //     run latency on mobile-chrome where the WS layer can
            //     take 15-20 s when the suite is hammering Realtime.
            await expect(secondaryPage.locator('.chat__msg', { hasText: tokenAfter }))
                .toBeVisible({ timeout: 45_000 });

            // 13. Sanity: secondary's chat shows primary's nick on the
            //     post-reload message (full IMessage payload made it
            //     across, not just a stub).
            const postReloadMsg = secondaryPage.locator('.chat__msg', { hasText: tokenAfter });
            await expect(postReloadMsg).toContainText(primaryNick, { timeout: 10_000 });
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            }
        }
    });
});
