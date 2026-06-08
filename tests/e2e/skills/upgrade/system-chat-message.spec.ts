/**
 * Atomic E2E — skill upgrade milestone broadcast renders in System tab.
 *
 * Spec (BACKLOG 12.7 + 2026-05-20 chat-system extension): when a player
 * upgrades an active skill to a milestone level (+5, +7, +10, or any
 * level ≥ +10), the client posts a structured payload to the `system`
 * channel via `chatApi.postSystemEvent`. The System tab in /chat then
 * parses the payload (`parseSystemMessage` in
 * `src/systems/systemChatMessages.ts`) and renders a rich row with the
 * spell icon + Polish formatted line "ulepszył(a) skill <name> do +<lvl>!".
 *
 * Source path (production):
 *   Inventory.tsx line 2181 →
 *   isUpgradeMilestone(newLevel) → true →
 *   formatSystemMessage({ type: 'skillUpgrade', skillId, skillName, upgradeLevel })
 *     → '[SYS]{"type":"skillUpgrade",...}' (Inventory.tsx line 2185)
 *   chatApi.postSystemEvent(name, class, level, content) →
 *     INSERT INTO messages(channel='system', content=...)
 *   GlobalChat /chat → System tab → Chat.tsx line 358 parseSystemMessage →
 *     line 359-381 renders `.chat__msg-text--skill` row with icon + body.
 *
 * ## Test strategy — seed the broadcast directly (skip combat trigger)
 *
 * Full UI flow ("login → /inventory → tap Skille → tap +1 button on
 * tier-1 spell → wait through 1.8 s animation → upgrade succeeds → row
 * fires → System tab updates") has too many failure modes for an atomic
 * test:
 *   • Upgrade success is randomized (`rollSkillUpgrade(targetLevel)` in
 *     `skillStore.ts` line 477) — a roll fail leaves the skill at
 *     current level and no broadcast fires. Stubbing Math.random in
 *     Playwright is brittle because the upgrade roll happens inside a
 *     dynamic import that runs after a setTimeout.
 *   • Reaching milestone +5 from +0 requires 5 successful rolls — even
 *     with a generous probability, statistical odds of 5 wins in a row
 *     are low enough to flake.
 *   • Gold + spell chest cost would need pre-seeding for 5 attempts.
 *
 * Pragmatic alternative: seed the SAME exact `messages` row directly
 * via service_role (bypasses RLS, matches what `postSystemEvent` would
 * produce in production). The CONTRACT under test is "if a properly
 * formatted [SYS]{...skillUpgrade...} payload lands on channel='system',
 * the chat renders the rich icon+text row" — not the rolling logic
 * (already covered by `skillStore.test.ts` upgradeActiveSkill unit
 * tests, lines 286-380).
 *
 * Mirrors the pattern from `chat/city/level-pill-reflects-character-level.spec.ts`
 * (BACKLOG 15.8) which seeds directly to avoid full level-up flow.
 *
 * ## Test flow
 *
 *  1. Seed Knight lvl 25 (any level ≥ 5 works — upgradeLevel in payload
 *     drives rendering, not character level).
 *  2. Insert a 'system' channel message via admin:
 *     `[SYS]{"type":"skillUpgrade","skillId":"shield_bash","skillName":
 *     "Uderzenie Tarczą","upgradeLevel":10}` (10 is the canonical
 *     milestone; +5 / +7 / +11 would also work). `shield_bash` is the
 *     Knight tier-1 active spell — guaranteed to have a getSkillIcon
 *     mapping. Anchor on a UNIQUE content suffix so we can find the row
 *     deterministically among other system messages in the feed.
 *  3. Login → pick char → /chat.
 *  4. Click System tab (it's always present; CITY_TAB + SYSTEM_TAB are
 *     seeded by default in chatTabsStore.ts line 179).
 *  5. Find our seeded row by content anchor (`hasText` filter).
 *  6. Assertions:
 *     a. The row text uses the SKILL upgrade class
 *        (`.chat__msg-text--skill`) — proves parseSystemMessage matched
 *        the skillUpgrade variant, not the item upgrade fallback.
 *     b. Contains skill name "Uderzenie Tarczą" wrapped in <strong>.
 *     c. Contains "+10" wrapped in <strong>.
 *     d. Contains the "ulepszył(a) skill" phrase from Chat.tsx line 373.
 *     e. Spell icon container `.chat__msg-sys-icon` rendered (proves
 *        getSkillIcon → TinyIcon mounted).
 *
 * ## Why we don't anchor on skill icon CSS — fragile across builds
 *
 * Spell icons are loaded via `getSkillIcon(skillId)` → Vite-hashed URLs
 * that change per build. Testing the exact icon src would flake on every
 * dev rebuild. We assert that the icon CONTAINER is present (proves the
 * conditional render branch ran) but not the specific icon URL.
 *
 * ## Cleanup
 *
 * Same as 15.8: `messages` is not in CHARACTER_CHILD_TABLES, so explicit
 * `admin.from('messages').delete().eq('id', seededMsgId)` in finally.
 * Character cleanup via `cleanupCharacterById`.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { getAdminClient, findUserIdByEmail } from '../../fixtures/adminClient';

test.describe('Skills › Upgrade', { tag: '@skills' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('milestone broadcast renders rich skill-upgrade row in /chat System tab', async ({ page }) => {
        const nick = generateTestCharacterName();
        // Unique anchor — survives parallel runs + leftover seeded rows
        // from earlier sessions. Date.now() + random matches the pattern
        // in chat/city/level-pill-reflects-character-level.spec.ts.
        const anchor = `E2E_SKILL_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        // Skill payload — values must match what Inventory.tsx would
        // produce. `shield_bash` is the Knight tier-1 spell (unlocks at
        // lvl 5; getSkillIcon mapping guaranteed). Polish name matches
        // `src/data/skills.json` shield_bash.name_pl ("Uderzenie Tarczą").
        const skillId = 'shield_bash';
        const skillName = 'Uderzenie Tarczą';
        const upgradeLevel = 10;
        const payload = {
            type: 'skillUpgrade',
            skillId,
            skillName,
            upgradeLevel,
        };
        // `[SYS]` marker + JSON body (= formatSystemMessage output).
        // Appended unique anchor at end so parseSystemMessage stops at
        // the JSON terminator and treats the rest as noise — actually,
        // appending breaks JSON.parse. So we route the unique anchor
        // through the SKILL NAME field which is part of the payload.
        const uniqueSkillName = `${skillName} ${anchor}`;
        const content = `[SYS]${JSON.stringify({
            ...payload,
            skillName: uniqueSkillName,
        })}`;

        let createdId: string | null = null;
        let seededMsgId: string | null = null;

        try {
            // ── Step 1: seed Knight on primary ────────────────────────────
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // ── Step 2: insert the system message via admin ───────────────
            const admin = getAdminClient();
            const userId = await findUserIdByEmail(testUsers.primary.email);
            if (!userId) throw new Error('[test 12.7] primary userId not found');

            const { data: msgRow, error: insertErr } = await admin
                .from('messages')
                .insert({
                    channel: 'system',
                    character_name: nick,
                    character_class: 'Knight',
                    character_level: 25,
                    content, // [SYS]{...skillUpgrade...}
                    user_id: userId,
                })
                .select('id')
                .single();
            if (insertErr) throw new Error(`[test 12.7] message insert failed: ${insertErr.message}`);
            seededMsgId = msgRow.id as string;

            // ── Step 3: login + character pick ────────────────────────────
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // ── Step 4: navigate to /chat + activate System tab ───────────
            await page.goto('/chat');
            await expect(page.locator('.global-chat')).toBeVisible({ timeout: 10_000 });

            // System tab is always present (chatTabsStore line 179 default).
            // Click it to switch active. The tab button label includes
            // the SYSTEM_TAB.title from chatTabsStore line 117: "⚠️ System".
            const systemTab = page.locator('.global-chat__tab-btn', { hasText: /System/i });
            await expect(systemTab).toBeVisible({ timeout: 5_000 });
            await systemTab.tap();
            // Wait for tab to become active — `.global-chat__tab--active`
            // modifier appears on the parent div when `t.id === activeId`.
            const activeTab = page.locator('.global-chat__tab--active');
            await expect(activeTab).toContainText(/System/i, { timeout: 5_000 });

            // ── Step 5: find seeded row by unique anchor ──────────────────
            // The seeded payload's skillName contains the anchor — when
            // Chat.tsx renders the row, the anchor appears inside the
            // <strong> tag wrapping skillName. We anchor `.chat__msg` by
            // the anchor text (unique enough to never collide with other
            // system messages in the feed).
            const myMsg = page.locator('.chat__msg', { hasText: anchor }).first();
            await expect(myMsg).toBeVisible({ timeout: 15_000 });

            // ── Step 6: assertions on rich-render output ──────────────────

            // 6a. The skill-upgrade-specific text class is present —
            //     proves parseSystemMessage hit the skillUpgrade branch
            //     (not the item upgrade branch or plain text fallback).
            await expect(myMsg.locator('.chat__msg-text--skill')).toBeVisible();

            // 6b. Skill name in <strong> contains our anchor + the
            //     original Polish name. Chat.tsx line 374:
            //     `<strong>{sys.skillName}</strong>`.
            const strongs = myMsg.locator('.chat__msg-text--skill strong');
            // First <strong> = skill name, second <strong> = "+10".
            await expect(strongs.first()).toContainText('Uderzenie Tarczą');
            await expect(strongs.first()).toContainText(anchor);

            // 6c. Upgrade level "+10" in second <strong>.
            //     Chat.tsx line 376: `<strong>+{sys.upgradeLevel}</strong>`.
            await expect(strongs.nth(1)).toHaveText('+10');

            // 6d. Body phrase "ulepszył(a) skill" — proves Chat.tsx
            //     line 373 ran. The exact phrase is the contract per
            //     2026-05-20 spec — if someone changes the wording
            //     ("ulepszył" → "polepszył"), regression flagged.
            await expect(myMsg.locator('.chat__msg-sys-body')).toContainText(/ulepszył\(a\)\s+skill/i);

            // 6e. Icon container rendered — proves getSkillIcon →
            //     TinyIcon mounted (Chat.tsx line 369-371). We don't
            //     assert the exact icon src URL because Vite hashing
            //     mutates it per build (flake risk).
            await expect(myMsg.locator('.chat__msg-sys-icon')).toBeVisible();
        } finally {
            if (seededMsgId) {
                try {
                    await getAdminClient().from('messages').delete().eq('id', seededMsgId);
                } catch {
                    // Best-effort — orphan rows are harmless (unique
                    // anchor means no future-run collision).
                }
            }
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
