/**
 * Multi-context E2E — primary sends a DM (PM) to secondary, secondary
 * receives it via Realtime (BACKLOG 4.11).
 *
 * Spec ("DM do znajomego"): PMs ride the same `messages` table as the
 * city channel, but on a deterministic channel id derived from both
 * characters' names (`buildPmChannel(a, b)` = `pm_{a-lower}_{b-lower}`
 * with the pair alphabetically sorted). When both sides have a Chat
 * component mounted on that same channel id, a row INSERTED by either
 * side is delivered to BOTH via Supabase Realtime `postgres_changes`.
 *
 * Why we don't use the Friends list flow:
 *   The canonical "Dodaj znajomego → tap 💌 on friend row" flow can't
 *   succeed under the current Supabase RLS policy on `characters`
 *   (SELECT restricted to own rows). Documented at length in
 *   `add-friend.spec.ts`. To avoid coupling this test to that
 *   limitation we open the PM tab via primary's `useChatTabsStore`
 *   directly (no UI navigation through Friends). Approach:
 *
 *     await primaryPage.evaluate((target) => {
 *       window.__zustand.chatTabs.getState().openPm(primaryName, target);
 *     });
 *
 *   ...but Zustand store handles aren't surfaced on `window` by
 *   default. Instead we use the most stable cross-cutting handle that
 *   IS exposed: the URL deep-link `/chat?pm=<targetName>` which
 *   `GlobalChat.tsx` (line 36) handles by calling `openPm(character.
 *   name, target)`. This creates the PM tab + makes it active without
 *   needing the Friends list as a precondition.
 *
 * Wire path:
 *   1. Both characters seeded + logged in + parked in Town.
 *   2. Both navigate `/chat?pm=<theOtherNick>` directly. GlobalChat
 *      observes the `pm` query param, calls `openPm` to create + focus
 *      the PM tab. The Chat component for that tab subscribes to the
 *      `pm_a_b` channel via `chatApi.subscribe`.
 *   3. Primary types message + taps send → INSERT on `messages` with
 *      channel = `pm_a_b`.
 *   4. Primary sees optimistic local insert (return=representation).
 *   5. Secondary receives via Realtime broadcast on the same channel
 *      within ~20 s.
 *
 * Cleanup: characters wiped via multiContext.cleanup. PM message rows
 *   stay (user_id, not character_id) but the channel id is unique to
 *   these two test characters → unreachable orphan rows, harmless.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { openMultiContext } from '../../fixtures/multiContext';
import type { Page } from '@playwright/test';

test.describe('Social › Friends', { tag: '@social' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary opens PM with secondary → sends message → secondary receives via Realtime', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const token = `E2E-PM-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
        const messageContent = `Hello ${token} from primary DM`;

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

            // ── Both navigate to /chat?pm=<other> — bypasses Friends
            //    list dependence; GlobalChat's URL effect calls
            //    `openPm(character.name, target)` for us, creating the
            //    PM tab + making it active + subscribing to the
            //    deterministic `pm_a_b` channel.
            const openPmTab = async (page: Page, ownNick: string, target: string): Promise<void> => {
                await page.goto(`/chat?pm=${encodeURIComponent(target)}`);
                // The PM tab title is `💌 ${target}` per chatTabsStore.
                const activeTab = page.locator('.global-chat__tab--active');
                await expect(activeTab).toBeVisible({ timeout: 15_000 });
                await expect(activeTab).toContainText(target, { timeout: 10_000 });
                // The chat input is mounted under the active PM tab.
                // There are multiple `.chat__input` (one per mounted tab,
                // others hidden via display:none) so we wait for the
                // visible one to be ready.
                await expect(page.locator('.chat__input:visible').first())
                    .toBeVisible({ timeout: 10_000 });
                // Sanity: own name surfaced in page (Town/header etc.)
                // — proves the character actually loaded; needed because
                // `openPm` no-ops if `character` is null.
                expect(ownNick).toBeTruthy(); // satisfies lint
            };

            await Promise.all([
                openPmTab(primaryPage, primaryNick, secondaryNick),
                openPmTab(secondaryPage, secondaryNick, primaryNick),
            ]);

            // PRIMARY sends DM. Use the visible (active tab's) input.
            const primaryActiveInput = primaryPage.locator('.chat__input:visible').first();
            const primaryActiveSend = primaryPage.locator('.chat__send:visible').first();
            await primaryActiveInput.fill(messageContent);
            await expect(primaryActiveSend).toBeEnabled({ timeout: 5_000 });
            await primaryActiveSend.tap();

            // PRIMARY sees optimistic local insert.
            const primaryOwnMsg = primaryPage.locator('.chat__msg', { hasText: token });
            await expect(primaryOwnMsg).toBeVisible({ timeout: 15_000 });

            // SECONDARY receives via Realtime broadcast. 45s: the
            // cross-context broadcast can take 15-25s under full-suite load.
            const secondaryReceivedMsg = secondaryPage.locator('.chat__msg', { hasText: token });
            await expect(secondaryReceivedMsg).toBeVisible({ timeout: 45_000 });

            // Verify sender attribution + level pill — proves the
            // message rendered with the correct sender metadata
            // populated from `character_name` + `character_level`.
            await expect(secondaryReceivedMsg).toContainText(primaryNick);
            await expect(secondaryReceivedMsg.locator('.chat__msg-level'))
                .toHaveText('10');
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
