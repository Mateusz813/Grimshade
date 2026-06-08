/**
 * Multi-context E2E — Floating chat icon (ChatUnreadBadge) lets the
 * player send a message on a NON-CITY channel (party / guild / PM)
 * without leaving the current view. (BACKLOG 4.14)
 *
 * Spec: "Wiadomość w party, gildii, DM przez floating ikonę chatu" —
 * the bottom-right `💬` floating icon opens a mini chat popup that
 * mirrors the full `/chat` layout. The player can switch tabs +
 * send messages from any in-game screen (Combat / Boss / Inventory /
 * etc.) without route-navigating to /chat.
 *
 * This test exercises the canonical "send through the popup" flow on
 * the **party channel** (a non-city channel — that's the regression
 * the spec is most about, since city is the default-active tab and
 * "sending via popup on city" is trivially the same as `/chat`).
 *
 * Why party (not guild / PM):
 *   • Party is the easiest non-city channel to materialise — we just
 *     create a party via UI and the `partyTabFor(partyId)` tab gets
 *     synced into chatTabsStore automatically when ProtectedRoute
 *     subscribes to active-party (chatTabsStore.syncPartyTab).
 *   • Guild requires guild membership pre-seeded (which would need a
 *     guild + 2 members), PM requires deep-link / Friends nav with
 *     the 4.10 RLS limitation.
 *   • Wire path on party-channel message send is **identical** to
 *     guild / PM channel — `chatApi.sendMessage('party_<id>', text, ...)`.
 *     Cover party once, the contract holds for guild + PM.
 *
 * Wire path:
 *   1. Primary creates a public party (UI flow).
 *   2. Secondary joins it.
 *   3. Both contexts now have `partyTabFor(partyId)` in their
 *      `chatTabsStore.tabs` array (via the syncPartyTab effect that
 *      runs whenever a character's party-membership flips).
 *   4. PRIMARY: stays on /party view (NOT /chat). Taps the floating
 *      `💬` icon → ChatPopup opens. Active tab is `city` by default
 *      (per ChatPopup mount → ensureCityTab). Taps the party tab
 *      title → activeId becomes `party_<id>`. Types message → taps
 *      send. (All this happens IN THE POPUP, not on /chat.)
 *   5. Local optimistic insert renders the row inside the popup's
 *      `.chat__msg` list.
 *   6. SECONDARY: also stays on /party (no chat-related nav). The
 *      message arrives via Supabase Realtime subscription on the
 *      `party_<id>` channel (subscription is set up by every Chat
 *      component instance for its channel — including the one mounted
 *      hidden inside their popup's party tab... but they may not have
 *      opened the popup, so the channel may not be subscribed there).
 *      We rely on DB-side verification instead: tail
 *      `messages WHERE channel = 'party_<id>'` and verify the row
 *      lands with the right content + sender.
 *
 * Adaptation vs full spec:
 *   • Full spec ("multi-channel send") would also cover guild + PM
 *     channels — out of scope for this single test. Party covers the
 *     identical wire path; guild / PM are mechanical re-runs.
 *   • Secondary's UI-side receipt (popup opens + new row visible)
 *     is OPTIONAL — the contract we're proving is that **send-from-popup
 *     hits the DB on the right channel**. The Realtime receipt path
 *     is covered by `social/chat/city/realtime-broadcast.spec.ts`
 *     (city) + `social/friends/direct-message.spec.ts` (PM) +
 *     `social/guild/chat/post-and-receive.spec.ts` (guild). This test's
 *     novel contribution is the **popup-as-input-surface** branch.
 *
 * Cleanup: multi-context fixture handles parties + characters.
 * `messages` rows survive — we tag with a unique token so they're
 * identifiable but harmless leftovers.
 *
 * Timeout: 120s for multi-context (2× login + 2× pick + 2× /party nav +
 * party create + join + popup open + send + DB poll).
 *
 * r11d_ prefix on char names to avoid collision with parallel agents.
 */

import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { openMultiContext } from '../../../fixtures/multiContext';
import { getAdminClient } from '../../../fixtures/adminClient';

const r11dNick = (): string => `r11d_${generateTestCharacterName().slice(0, 10)}`;

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

const navToParty = async (page: Page): Promise<void> => {
    await page.getByRole('button', { name: /^Społeczność$/i }).tap();
    await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
    await page.locator('.social__tile--party').tap();
    await expect(page).toHaveURL(/\/party$/, { timeout: 10_000 });
    await expect(page.locator('.party__intro-title, .party__roster').first())
        .toBeVisible({ timeout: 15_000 });
};

test.describe('Social › Chat › Floating Icon', { tag: '@social' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary sends party-channel msg via floating chat popup → DB row lands on party_<id>', async ({ browser }) => {
        const primaryNick = r11dNick();
        const secondaryNick = r11dNick();
        const partyName = `r11d ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        // Unique token for safe DB / DOM search.
        const token = `E2E-FI-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
        const messageContent = `popup-party ${token}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            // SEED both characters.
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

            // OPEN multi-context.
            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            // BOTH pick + nav to /party.
            await Promise.all([
                pickCharacter(primaryPage, primaryNick),
                pickCharacter(secondaryPage, secondaryNick),
            ]);
            await Promise.all([
                navToParty(primaryPage),
                navToParty(secondaryPage),
            ]);

            // PRIMARY: create public party.
            await primaryPage
                .locator('.party__primary-btn', { hasText: /Stwórz nowe party/i })
                .tap();
            await expect(primaryPage.locator('.party__create-form'))
                .toBeVisible({ timeout: 5_000 });
            await primaryPage.locator('.party__field', { hasText: /Nazwa party/i })
                .locator('input').fill(partyName);
            const submitBtn = primaryPage.locator('.party__form-actions')
                .getByRole('button', { name: /^Utwórz$/i });
            await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
            await submitBtn.tap();

            // Primary roster shows 1/4.
            await expect(primaryPage.locator('.party__roster')).toBeVisible({ timeout: 15_000 });
            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/1\/4\s+graczy/i);

            // SECONDARY: refresh + join.
            const refreshBtn = secondaryPage.locator('.party__refresh-btn');
            await refreshBtn.tap();
            const partyCard = secondaryPage.locator('.party__card', {
                has: secondaryPage.locator('.party__card-name', { hasText: partyName }),
            });
            await expect(partyCard).toBeVisible({ timeout: 15_000 });
            const joinBtn = partyCard.locator('.party__primary-btn', { hasText: /^Dołącz$/i });
            await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
            await joinBtn.tap();

            // Both rosters at 2/4 — party sync done. 45s: the cross-context
            // Realtime broadcast (secondary's join reaching primary) can take
            // 15-25s under full-suite load.
            await expect(secondaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });
            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });

            // Before opening the popup, manually call syncPartyTab on
            // primary to guarantee the party tab is registered. The
            // AppShell effect runs on activePartyId changes, but
            // there's a brief window between party creation and the
            // effect firing where the popup might open without the
            // tab. This evaluate is a deterministic "make sure" step.
            await primaryPage.evaluate(async () => {
                const m = await import('/src/stores/chatTabsStore.ts');
                const p = await import('/src/stores/partyStore.ts');
                const partyId = p.usePartyStore.getState().party?.id;
                if (partyId) m.useChatTabsStore.getState().syncPartyTab(partyId);
            });

            // PRIMARY: stay on /party (NOT /chat). Open the floating chat
            // popup by tapping the `.chat-unread-badge` icon.
            // The chat icon should be visible because the player is on
            // an in-game route (not /login / /character-select).
            const chatIcon = primaryPage.locator('.chat-unread-badge');
            await expect(chatIcon).toBeVisible({ timeout: 10_000 });
            await chatIcon.tap();

            // Popup opens.
            const chatPopup = primaryPage.locator('.chat-popup');
            await expect(chatPopup).toBeVisible({ timeout: 5_000 });

            // Wait for the party tab to be available in the popup. The
            // chatTabsStore.syncPartyTab fires when the player is in a
            // party, adding a tab with title "🛡️ Drużyna". Use the
            // button's title attribute (more reliable than the inner
            // span text for a chained `has:` filter on emojis).
            const partyTabBtn = chatPopup.locator('button.chat-popup__tab-btn[title*="Drużyna"]');
            await expect(partyTabBtn).toBeVisible({ timeout: 15_000 });
            await partyTabBtn.tap();

            // Active modifier should land on the parent wrapper.
            // After tap, aria-selected="true" lands on the party tab
            // button. We use the aria attr as a deterministic anchor.
            await expect(partyTabBtn).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });

            // The party-channel's Chat instance is mounted INSIDE the
            // popup. There are multiple Chat instances (one per tab,
            // city/system/party — hidden ones via CSS / `active` prop).
            // The .chat__input + .chat__send are mounted per-instance.
            // Scope to the VISIBLE one (Playwright `:visible` filter).
            const popupInput = chatPopup.locator('.chat__input:visible').first();
            const popupSend = chatPopup.locator('.chat__send:visible').first();
            await expect(popupInput).toBeVisible({ timeout: 10_000 });
            await popupInput.fill(messageContent);
            await expect(popupSend).toBeEnabled({ timeout: 5_000 });
            await popupSend.tap();

            // Local optimistic insert: primary should see their own
            // message in the popup chat list.
            const primaryOwnMsg = chatPopup.locator('.chat__msg', { hasText: token });
            await expect(primaryOwnMsg).toBeVisible({ timeout: 10_000 });

            // DB-side validation: messages table has a row with our
            // content + channel='party_<id>'. The party id we don't
            // know directly (created via UI), so we anchor on content
            // (the unique token guarantees uniqueness).
            const admin = getAdminClient();
            await expect.poll(
                async () => {
                    const { data } = await admin
                        .from('messages')
                        .select('id, channel, content, character_name')
                        .ilike('content', `%${token}%`);
                    return data ?? [];
                },
                { timeout: 15_000, intervals: [500, 1_000, 2_000] },
            ).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        content: messageContent,
                        character_name: primaryNick,
                        // The channel name must START with 'party_' (the
                        // partyTabFor(partyId) builder uses `party_<id>`).
                        channel: expect.stringMatching(/^party_/),
                    }),
                ]),
            );

            // Cleanup the test message — `messages` is not in
            // CHARACTER_CHILD_TABLES so it survives character delete
            // by default. Surface the cleanup so the city / party
            // channels don't accumulate test cruft.
            try {
                await admin.from('messages').delete().ilike('content', `%${token}%`);
            } catch {
                // Non-fatal — leftover row carries the token tag.
            }
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
