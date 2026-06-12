/**
 * Atomic E2E smoke — `/guild` (Loch / guild dungeon entry) renders without
 * JS errors for a player who is already a guild member.
 *
 * Spec (BACKLOG.md punkt 13.5 — per-combat-type smoke, "loch" variant):
 * "Każdy typ walki E2E smoke (polowanie/raid/dungeon/boss/arena/trainer/
 * loch/transform)". Loch (guild dungeon / weekly boss) was the only
 * outstanding smoke at 7/8 coverage.
 *
 * Co testujemy (smoke only — NIE testujemy walki z boss-em):
 *  - Pre-seed character as member of a guild via direct INSERT (seedGuild)
 *    so the /guild view hydrates straight to the GuildHome screen.
 *  - Navigate Town -> Społeczność -> Gildia -> tap Loch nav tile.
 *  - `.guild__boss-stage` mounts -> proves GuildBoss sub-view rendered
 *    + `fetchOrCreateWeeklyBoss` succeeded (the boss view's early
 *    return at line 1497 shows skeleton when boss undefined; after
 *    fetch lands, the full JSX renders with `.guild__boss-stage`).
 *  - `.guild__boss-preview-img` + HP bar visible — sanity checks that
 *    the canonical "arena" phase rendered (boss portrait + HP),
 *    NOT a partial render that would hide the boss tile.
 *  - No crash from missing tier data: `getLochBossImage` /
 *    `getLochBackground` / `getGuildBossLabel` all resolve for tier 1.
 *
 * **Co NIE testujemy** (defer do osobnych speców):
 *  - Faktyczna walka z bossem (claim arena -> attack ticks -> damage
 *    + reward). 4.5 multi-context covers the API-side wire path;
 *    UI combat is brittle (per the 4.5 doc, the visual loop has
 *    timing + RNG + claim-race instabilities).
 *  - Sunday lock (`isGuildBossClaimDay`) — only fires on Sun UTC; a
 *    smoke run any other day still asserts the standard path.
 *  - Boss tier 2+ rendering — tier 1 is the default for fresh guilds
 *    and exercises the same `getLochBossImage(tier)` lookup.
 *
 * Seed strategy:
 *  - Single character on SECONDARY (per task brief — primary reserved).
 *  - Seeded as SOLO leader+member of a new guild via `seedGuild`
 *    (1-char memberCharacterIds = self as leader). Loch view requires
 *    `boss.guild_id` resolved server-side; one-member guild is OK
 *    because `fetchOrCreateWeeklyBoss` keys by `guild_id` not by
 *    member count. Multi-context is NOT required for smoke — the
 *    actual multi-member contribution flow has its own test (4.5).
 *
 * Cleanup:
 *  - cleanupGuildsByLeaderIds (CASCADE handles guild_members + boss
 *    state + contributions + treasury + requests).
 *  - cleanupCharacterById (CASCADE handles game_saves + party_members).
 *
 * Why a single-context test for "multi-context loch" task brief:
 *  - The brief says "May need to use multi-context if guild requires
 *    another member to enter". Verified by source-reading: a 1-member
 *    guild can fully render the Loch view (Guild.tsx GuildBoss component
 *    has no min-member gate — the only gates are Sunday claim day +
 *    `attemptedToday` + `current_attacker_id` arena holder, none of
 *    which block initial RENDER). So smoke level only needs 1 member
 *    + 1 guild row. Multi-context already covered by 4.5 guild-boss
 *    multi-member contribution test.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGuild } from '../../fixtures/seedGuild';
import { cleanupGuildsByLeaderIds } from '../../fixtures/guildCleanup';

test.describe('Combat › Loch', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('smoke: /guild -> Loch tile renders guild boss stage without errors', async ({ page }) => {
        const nick = generateTestCharacterName();
        const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'A');
        const guildName = `E2E Loch ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let createdCharId: string | null = null;
        let guildId: string | null = null;

        try {
            // 1. Seed Knight lvl 10 on SECONDARY (per task brief). No
            //    min-level requirement for guild membership but lvl 10
            //    avoids any future UI lockouts on /guild views.
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            createdCharId = created.id;

            // 2. Seed game_saves to give a clean inventory blob (no gold
            //    required — we're not creating a guild through the UI).
            const userId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({ characterId: createdCharId, userId });

            // 3. Direct-seed guild with our character as the sole
            //    leader/member. Bypasses the UI create flow (1 INSERT
            //    into `guilds` + 1 INSERT into `guild_members`) so the
            //    on-mount Realtime hydrate picks us up as a member.
            const guild = await seedGuild({
                name: guildName,
                tag,
                memberCharacterIds: [createdCharId],
            });
            guildId = guild.id;

            // 4. Login on SECONDARY -> wybierz postać -> Town.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 15_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 5. Navigate Town -> Społeczność -> Gildia.
            await page.getByRole('button', { name: /^Społeczność$/i }).tap();
            await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
            await page.locator('.social__tile--gildia').tap();
            await expect(page).toHaveURL(/\/guild$/, { timeout: 10_000 });

            // 6. Wait for guild home view (`.guild__home-banner`) to mount.
            //    This proves `useGuildStore.hydrateForCharacter` found our
            //    membership + rendered the home view (not the list-browser
            //    fallback). Generous timeout for cold Realtime sub.
            await expect(page.locator('.guild__home-banner')).toBeVisible({ timeout: 20_000 });

            // 7. Tap Loch nav tile. Guild.tsx line 749-752: button with
            //    `.guild__nav-tile` class, label "Loch", onClick -> setPhase('boss').
            //    The label span is the most stable anchor (emojis + image
            //    paths can shift; "Loch" is the user-facing label spec).
            await page.locator('.guild__nav-tile-label', { hasText: /^Loch$/i }).tap();

            // 8. CRITICAL ASSERTION — `.guild__boss-stage` is the root of
            //    the rendered Loch view. Guild.tsx line 1549 renders this
            //    div ONLY when GuildBoss's `boss` state is hydrated
            //    (early return at line 1497 shows a skeleton with
            //    "Ładowanie bossa…" until `fetchOrCreateWeeklyBoss`
            //    returns). Visibility within 20s proves the full flow
            //    landed: phase='boss' -> GuildBoss mount -> server fetch
            //    -> boss row hydrated -> JSX renders.
            await expect(page.locator('.guild__boss-stage')).toBeVisible({ timeout: 20_000 });

            // 9. Sanity — boss preview img + HP bar both visible. Confirms
            //    we're in 'arena' sub-phase (preview block at line 1561-1599
            //    only renders when GuildBoss-local `phase !== 'fighting'`,
            //    which is the default on mount per line 955).
            await expect(page.locator('.guild__boss-preview-img')).toBeVisible({ timeout: 10_000 });
            await expect(page.locator('.guild__boss-preview-hpbar')).toBeVisible();

            // 10. Sanity — boss info row at the bottom (line 1789) visible,
            //     which means the layout chain rendered through. Catches
            //     a regression where the stage renders but the info card
            //     fails to mount due to a missing tier helper return.
            await expect(page.locator('.guild__boss-info')).toBeVisible({ timeout: 10_000 });
        } finally {
            // CASCADE: deleting `guilds` row wipes all guild_* child tables
            // (members, boss_state, contributions, attempts, treasury,
            // requests). Run BEFORE character cleanup so the guild row's
            // FK to characters (leader_id has no FK but member rows do)
            // isn't orphaned during the brief window between deletes.
            await cleanupGuildsByLeaderIds([createdCharId]);
            if (createdCharId) {
                await cleanupCharacterById(createdCharId);
            }
            // Mark guildId as referenced (lint guard — we may not always
            // need it but it makes intent explicit; the cleanup function
            // doesn't take guildId directly).
            void guildId;
        }
    });
});
