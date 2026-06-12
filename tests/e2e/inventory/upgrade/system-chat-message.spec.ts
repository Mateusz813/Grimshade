/**
 * Atomic E2E — item upgrade milestone broadcast renders in /chat System tab.
 *
 * Spec (BACKLOG 6.11 + 2026-05-19 v14 chat-system extension): when a
 * player upgrades an item to a milestone level (+5, +7, +10, or any
 * level ≥ +10), the client posts a structured payload to the `system`
 * channel via `chatApi.postSystemEvent`. The System tab in /chat then
 * parses the payload (`parseSystemMessage` in
 * `src/systems/systemChatMessages.ts`) and renders a rich row with an
 * ItemIcon (rarity-tinted frame + upgrade glow) + Polish formatted line
 * "ulepszył(a) <name> do +<lvl>!".
 *
 * Source path (production):
 *   Inventory.tsx line ~1000 ->
 *   isUpgradeMilestone(nextLevel) -> true ->
 *   formatSystemMessage({ type: 'upgrade', itemId, rarity, upgradeLevel, itemName })
 *     -> '[SYS]{"type":"upgrade",...}' (line ~1007)
 *   chatApi.postSystemEvent(name, class, level, content) ->
 *     INSERT INTO messages(channel='system', content=...)
 *   GlobalChat /chat -> System tab -> Chat.tsx line 382 parseSystemMessage ->
 *     line 397-416 renders `.chat__msg-text--rarity-<rarity>` row with
 *     ItemIcon + body text.
 *
 * ## Test strategy — seed the broadcast directly (skip upgrade animation)
 *
 * The pattern mirrors `skills/upgrade/system-chat-message.spec.ts` (BACKLOG
 * 12.7) which seeds the same kind of payload for skill upgrades. Reasoning
 * is identical: running the actual upgrade UI flow requires (a) 5 separate
 * successful Math.random rolls (each can fail), (b) ~1.8s animation per
 * attempt, (c) stone + gold pre-seeding for 5 retries. Far simpler to
 * insert the canonical `[SYS]{...upgrade...}` row directly — the CONTRACT
 * under test is "if a properly formatted upgrade payload lands on
 * channel='system', the chat renders the rich icon+text row", not the
 * rolling logic (covered by `itemSystem.ts` enhancement unit tests).
 *
 * ## Why we use the SECONDARY account
 *
 * Suite runs concurrent on primary account — directive in task brief.
 * Secondary (test2@grimshade.pl) is the free slot for parallel work.
 *
 * ## Test flow
 *
 *  1. Seed Knight lvl 25 on SECONDARY account.
 *  2. Insert a 'system' channel message via admin:
 *     `[SYS]{"type":"upgrade","itemId":"iron_sword","rarity":"rare",
 *     "upgradeLevel":10,"itemName":"Żelazny Miecz E2E_IUP_..."}`
 *     The unique anchor goes inside `itemName` so the row is findable
 *     via `hasText` filter and never collides with other system messages.
 *  3. Login -> pick char -> /chat.
 *  4. Click System tab (always present per chatTabsStore line 117 default).
 *  5. Find seeded row by anchor.
 *  6. Assertions:
 *     a. The text row uses the RARITY-tinted class
 *        (`.chat__msg-text--rarity-rare`) — proves parseSystemMessage
 *        matched the `upgrade` variant (Chat.tsx line 398).
 *     b. First <strong> contains item name + anchor (line 410).
 *     c. Second <strong> = "+10" (line 412).
 *     d. Body matches /ulepszył\(a\)/i (line 409).
 *     e. Icon container `.chat__msg-sys-icon` rendered (proves ItemIcon
 *        mounted — line 399-407).
 *     f. No skill-upgrade modifier (regression guard — payload type
 *        was `upgrade`, NOT `skillUpgrade`).
 *
 * ## Cleanup
 *
 * Same as 12.7: `messages` is not in CHARACTER_CHILD_TABLES, so explicit
 * `admin.from('messages').delete().eq('id', seededMsgId)` in finally.
 * Character cleanup via `cleanupCharacterById`.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { getAdminClient, findUserIdByEmail } from '../../fixtures/adminClient';

test.describe('Inventory › Upgrade', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('item upgrade milestone broadcast renders rich rarity-tinted row in /chat System tab', async ({ page }) => {
        const nick = generateTestCharacterName();
        // Unique anchor — survives parallel runs + leftover seeded rows
        // from earlier sessions. Match pattern from sibling
        // `skills/upgrade/system-chat-message.spec.ts`.
        const anchor = `E2E_IUP_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        // Item payload — values must match what Inventory.tsx would
        // produce. iron_sword is a stable Knight-class items.json entry;
        // rarity 'rare' gives a clearly distinct CSS class for the
        // .chat__msg-text--rarity-* assertion (proves the rarity branch
        // round-trips, not just "common" default).
        const itemId = 'iron_sword';
        const itemBaseName = 'Żelazny Miecz';
        const rarity = 'rare';
        const upgradeLevel = 10;
        // Anchor routed via itemName — same trick as 12.7. Keeps JSON
        // parseable (appending to the wire string would break JSON.parse
        // because the `[SYS]` parser slices to end of string).
        const itemNameWithAnchor = `${itemBaseName} ${anchor}`;
        const content = `[SYS]${JSON.stringify({
            type: 'upgrade',
            itemId,
            rarity,
            upgradeLevel,
            itemName: itemNameWithAnchor,
        })}`;

        let createdId: string | null = null;
        let seededMsgId: string | null = null;

        try {
            // -- Step 1: seed Knight on SECONDARY --------------------------
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // -- Step 2: insert the system message via admin ---------------
            const admin = getAdminClient();
            const userId = await findUserIdByEmail(testUsers.secondary.email);
            if (!userId) throw new Error('[test 6.11] secondary userId not found');

            const { data: msgRow, error: insertErr } = await admin
                .from('messages')
                .insert({
                    channel: 'system',
                    character_name: nick,
                    character_class: 'Knight',
                    character_level: 25,
                    content, // [SYS]{...upgrade...}
                    user_id: userId,
                })
                .select('id')
                .single();
            if (insertErr) throw new Error(`[test 6.11] message insert failed: ${insertErr.message}`);
            seededMsgId = msgRow.id as string;

            // -- Step 3: login + character pick ----------------------------
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // -- Step 4: navigate to /chat + activate System tab -----------
            await page.goto('/chat');
            await expect(page.locator('.global-chat')).toBeVisible({ timeout: 10_000 });

            // System tab is always present (chatTabsStore line 117 default
            // SYSTEM_TAB.title = ":warning: System").
            const systemTab = page.locator('.global-chat__tab-btn', { hasText: /System/i });
            await expect(systemTab).toBeVisible({ timeout: 5_000 });
            await systemTab.tap();
            // Wait for tab to become active — `.global-chat__tab--active`
            // modifier flips when `t.id === activeId`.
            const activeTab = page.locator('.global-chat__tab--active');
            await expect(activeTab).toContainText(/System/i, { timeout: 5_000 });

            // -- Step 5: find seeded row by unique anchor ------------------
            const myMsg = page.locator('.chat__msg', { hasText: anchor }).first();
            await expect(myMsg).toBeVisible({ timeout: 15_000 });

            // -- Step 6: assertions on rich-render output ------------------

            // 6a. The rarity-tinted text class is present — proves
            //     parseSystemMessage hit the `upgrade` branch (Chat.tsx
            //     line 398) and the rarity string round-tripped. Use the
            //     specific rarity (`rare`) instead of any-rarity wildcard
            //     so a regression that defaults to "common" is caught.
            await expect(myMsg.locator('.chat__msg-text--rarity-rare')).toBeVisible();

            // 6b. Item name in first <strong> contains both the anchor +
            //     the original Polish base name. Chat.tsx line 410:
            //     `<strong>{sys.itemName}</strong>`.
            const strongs = myMsg.locator('.chat__msg-text--rarity-rare strong');
            // First <strong> = item name, second <strong> = "+10".
            await expect(strongs.first()).toContainText(itemBaseName);
            await expect(strongs.first()).toContainText(anchor);

            // 6c. Upgrade level "+10" in second <strong>. Chat.tsx line
            //     412: `<strong>+{sys.upgradeLevel}</strong>`.
            await expect(strongs.nth(1)).toHaveText('+10');

            // 6d. Body phrase "ulepszył(a)" — proves Chat.tsx line 409
            //     ran. Note: ITEM variant says "ulepszył(a) <itemName>",
            //     SKILL variant says "ulepszył(a) skill <skillName>" —
            //     we want JUST "ulepszył(a)" not followed by "skill".
            await expect(myMsg.locator('.chat__msg-sys-body')).toContainText(/ulepszył\(a\)/i);

            // 6e. Icon container rendered — proves ItemIcon mounted
            //     (Chat.tsx line 399-407). We don't assert the exact
            //     icon src because getItemDisplayInfo + Vite hashing can
            //     mutate URLs per build.
            await expect(myMsg.locator('.chat__msg-sys-icon')).toBeVisible();

            // 6f. NEGATIVE regression — payload was `type: 'upgrade'`
            //     (item), NOT `skillUpgrade`. If someone swaps the
            //     branches in parseSystemMessage, the skill-upgrade
            //     modifier would render and this assertion would catch it.
            await expect(myMsg.locator('.chat__msg-text--skill')).toHaveCount(0);
        } finally {
            if (seededMsgId) {
                try {
                    await getAdminClient().from('messages').delete().eq('id', seededMsgId);
                } catch {
                    // Best-effort — unique anchor means orphans don't collide.
                }
            }
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
