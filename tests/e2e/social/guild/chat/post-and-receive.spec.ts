/**
 * Multi-context E2E — guild chat broadcast (BACKLOG 4.8).
 *
 * Spec ("Napisz na chacie gildii"): primary + secondary are already
 * members of the same guild. Primary writes a message in the guild
 * chat input -> submits. Secondary's Chat panel (per-guild channel
 * `guild_${guildId}`) receives the message via Supabase Realtime and
 * renders it in the message list.
 *
 * This is the canonical Realtime test for the guild chat path. A
 * single-context test could only verify the local optimistic render —
 * to prove Realtime propagation, we MUST observe the message land on
 * the OTHER context's screen.
 *
 * Setup strategy: pre-seed both characters as members of the same
 * guild via `seedGuild` (direct INSERT into `guilds` + `guild_members`
 * by service_role). Skips the UI flow of create-guild -> apply ->
 * accept which is already covered by `join-requests/accept.spec.ts`.
 * Both contexts navigate to /guild and land on the home view (because
 * `hydrateForCharacter` finds the membership row on mount).
 *
 * Realtime timing:
 *   - Primary's `chatApi.sendMessage` POSTs to /messages with
 *     `channel = 'guild_<guildId>'` and `Prefer: return=representation`.
 *   - Postgres INSERT triggers a Realtime broadcast on table=messages.
 *   - Secondary's `chat:guild_<guildId>:...` channel subscription fires
 *     the `INSERT` handler with the new row -> message appended to local
 *     state -> re-render.
 *   - End-to-end latency: typically 1-3s in dev, with brittle p99
 *     bursts to 8-10s during connection storm. 30s headroom on the
 *     expect.toBeVisible() catches both.
 *
 * Cleanup: characters + the seeded guild (CASCADE -> guild_members).
 *   Chat messages on the `guild_${guildId}` channel are also wiped
 *   via `cleanupGuildsByLeaderIds`'s optional `channelsToClean` arg —
 *   guild_${id} messages are orphaned post-guild-delete so cleaning
 *   keeps the `messages` table small.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { openMultiContext } from '../../../fixtures/multiContext';
import { seedGuild } from '../../../fixtures/seedGuild';
import { cleanupGuildsByLeaderIds } from '../../../fixtures/guildCleanup';

test.describe('Social › Guild', { tag: '@guild' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary writes guild chat message -> secondary receives it via Realtime', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'A');
        const guildName = `E2E G ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        // Unique message so a leftover from a prior test doesn't false-positive.
        const message = `E2E msg ${Math.random().toString(36).slice(2, 8)}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let guildId: string | null = null;
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

            // 2. Seed game_saves (no gold needed — guild is direct-seeded).
            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({ characterId: primaryCharId, userId: primaryUserId });
            await seedGameSave({ characterId: secondaryCharId, userId: secondaryUserId });

            // 3. Direct-seed the guild with both characters already members.
            //    Primary is the leader by being first in the array.
            const seededGuild = await seedGuild({
                name: guildName,
                tag,
                memberCharacterIds: [primaryCharId, secondaryCharId],
            });
            guildId = seededGuild.id;

            // 4. Open both contexts + parallel login.
            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            // 5. Both pick characters -> Town.
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

            // 6. Both navigate Town -> Społeczność -> Gildia. Both should
            //    land on the home view because `hydrateForCharacter`
            //    finds their guild_members row on mount.
            const navToGuildHome = async (page: Page): Promise<void> => {
                await page.getByRole('button', { name: /^Społeczność$/i }).tap();
                await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
                await page.locator('.social__tile--gildia').tap();
                await expect(page).toHaveURL(/\/guild$/, { timeout: 10_000 });
                // Home view confirms membership was hydrated. List view
                // would mean hydration race / failure.
                await expect(page.locator('.guild__home-banner')).toBeVisible({ timeout: 20_000 });
                await expect(page.locator('.guild__home-name')).toContainText(guildName);
            };
            await Promise.all([
                navToGuildHome(primaryPage),
                navToGuildHome(secondaryPage),
            ]);

            // 7. Both pages have a `.guild__chat` block that hosts the
            //    Chat component bound to `guild_<guildId>`. Wait for the
            //    chat input to be reachable on both before we send.
            const primaryChat = primaryPage.locator('.guild__chat .chat');
            const secondaryChat = secondaryPage.locator('.guild__chat .chat');
            await expect(primaryChat).toBeVisible({ timeout: 15_000 });
            await expect(secondaryChat).toBeVisible({ timeout: 15_000 });

            // 8. PRIMARY: type message into chat input + send.
            //    Use type-then-tap-send instead of pressEnter — keypad
            //    "Enter" on mobile WebKit doesn't always fire the
            //    onKeyDown handler reliably.
            const primaryInput = primaryChat.locator('.chat__input');
            const primarySend = primaryChat.locator('.chat__send');
            await primaryInput.fill(message);
            await expect(primarySend).toBeEnabled();
            await primarySend.tap();

            // 9. PRIMARY: own message renders locally via optimistic
            //    push (chatApi.sendMessage returns the row + the chat
            //    state appends it). This proves the write succeeded.
            await expect(primaryChat.locator('.chat__msg-text', { hasText: message }))
                .toBeVisible({ timeout: 10_000 });

            // 10. SECONDARY: critical Realtime assertion. The message
            //     lands via the postgres_changes INSERT handler on the
            //     guild chat channel sub. 45s ceiling — the cross-context
            //     broadcast can take 15-25s under full-suite load.
            await expect(secondaryChat.locator('.chat__msg-text', { hasText: message }))
                .toBeVisible({ timeout: 45_000 });

            // 11. Final sanity: secondary's chat (not just the message
            //     text) shows primary's character name in the visible
            //     `.chat__msg-name` button rendered for the sender. The
            //     button text is formatted as `[TAG] Name:` when the
            //     sender belongs to a guild (Chat.tsx ~344) — we just
            //     check for the nick substring, the formatting around
            //     it can vary across the guild-tag prefetch race.
            //     We use a top-level locator (not scoped to the msg row)
            //     because the .chat__msg-name button hangs off the
            //     parent `.chat__msg` flex container, and Playwright's
            //     has-filter chaining can be flaky with re-renders.
            await expect(secondaryChat.locator('.chat__msg-name', { hasText: primaryNick }))
                .toBeVisible({ timeout: 10_000 });
        } finally {
            // Order: guild (CASCADE -> guild_members), chat channel,
            // then characters via fixture cleanup.
            const channels = guildId ? [`guild_${guildId}`] : [];
            await cleanupGuildsByLeaderIds([primaryCharId, secondaryCharId], channels);
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            }
        }
    });
});
