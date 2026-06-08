/**
 * Multi-context E2E — guild boss happy path: two members both deal
 * damage to the same weekly boss, both end up with their own
 * `guild_boss_contributions` row (BACKLOG 4.5).
 *
 * Spec ("Loch gildii — happy path"): two members of the same guild
 * each fight the weekly boss; both should land a damage record AND a
 * weekly contribution row. The boss UI ends in Sunday-locked claim
 * mode (`isGuildBossClaimDay`), but the underlying mechanic we're
 * proving is:
 *
 *   1. `guildApi.applyBossDamage` clamps the boss row's `boss_current_hp`
 *      and flips `boss_killed` when HP hits 0 (Guild.tsx pulls this
 *      via per-tick damage in the combat loop).
 *   2. `guildApi.addContribution` upserts a per-character weekly row in
 *      `guild_boss_contributions` (1 row per character per week).
 *   3. `guildApi.logAttempt` writes a per-day attempt row in
 *      `guild_boss_attempts` (1 row per character per day for the
 *      scrolling log feed).
 *
 * Each member's contribution is INDEPENDENT (per `character_id` + per
 * `week_start`), so 2 members fighting the same week's boss should
 * produce 2 rows in `guild_boss_contributions` plus 2 rows in
 * `guild_boss_attempts` (one per character per day).
 *
 * ## Why this is hybrid UI + page.evaluate (not full UI combat)
 *
 * The full UI flow ("Atakuj bossa" → "claim arena" → run the basic-tick
 * + spell-tick + boss-tick loops at the chosen speed multiplier → ~10-
 * 30 attacks → "Zakończ walkę") would be brittle: it depends on
 * (a) timing of the per-tick interval (1500 ms / speed mult), (b) RNG
 * cooldowns for spells, (c) winning the `claimBossArena` race between
 * the two contexts, (d) the boss surviving long enough for the second
 * member's turn (Sunday lock would 1-shot the test if it ticked over
 * mid-run).
 *
 * Instead — we navigate both contexts to /guild → Loch (so each context
 * gets the live `useGuildStore` + `boss_state` row hydrated), then
 * use `page.evaluate` to call `guildApi.applyBossDamage` +
 * `guildApi.addContribution` + `guildApi.logAttempt` DIRECTLY on each
 * side. Same wire as the in-combat loop (each context POSTs from its
 * own session — bypasses the visual ticker but exercises the EXACT
 * same multi-member contribution path).
 *
 * The "happy path" being verified:
 *   • Both members can register damage against the same `guild_boss_state`
 *     row (proves no global lock or RLS gating that would block one).
 *   • Each member's contribution lands in their OWN `guild_boss_contributions`
 *     row keyed by `(guild_id, character_id, week_start)`.
 *   • Both contributions are positive — the per-member entry isn't
 *     overwriting the other (regression guard against a bug where one
 *     member's `addContribution` zeroes the other's row).
 *
 * Setup strategy: pre-seed both characters as members of the same guild
 * via `seedGuild` (skips create+apply+accept dance).
 *
 * Cleanup:
 *   • cleanupGuildsByLeaderIds — CASCADE wipes guild_boss_state,
 *     guild_boss_contributions, guild_boss_attempts via FK on guild_id.
 *   • characters cleaned via multiContext.cleanup.
 *
 * ## Sunday guard
 *
 * `isGuildBossClaimDay()` returns true on Sunday UTC and the UI shows
 * "🌅 Niedziela — atakowanie zablokowane." This test does NOT cover
 * that branch (it's a UI-only render check). Run any day Mon-Sat to
 * hit the assertion path. If a CI run happens to start on Sunday and
 * the UI loaded a different week's boss row, the test still passes
 * because we drive the API directly (no UI button gating).
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { openMultiContext } from '../../../fixtures/multiContext';
import { seedGuild } from '../../../fixtures/seedGuild';
import { cleanupGuildsByLeaderIds } from '../../../fixtures/guildCleanup';
import { getAdminClient } from '../../../fixtures/adminClient';

test.describe('Social › Guild', { tag: '@guild' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('multi-context: 2 members deal boss damage → both rows in guild_boss_contributions', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'A');
        const guildName = `E2E G ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        // Each member contributes a different damage value so we can
        // distinguish them in the contribution rows below.
        const primaryDamage = 50_000;
        const secondaryDamage = 30_000;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let guildId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            // 1. Seed characters at lvl 10 (no level gate on boss view).
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

            // 3. Direct-seed guild with both as members (primary = leader).
            const seededGuild = await seedGuild({
                name: guildName,
                tag,
                memberCharacterIds: [primaryCharId, secondaryCharId],
            });
            guildId = seededGuild.id;

            // 4. Open multi-context + parallel login.
            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            // 5. Both pick characters → Town.
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

            // 6. Both navigate Town → Społeczność → Gildia → Loch (boss).
            //    The boss view fetches/creates the weekly boss row on
            //    mount via `fetchOrCreateWeeklyBoss`. We need this so
            //    `guildApi.applyBossDamage` has a row to clamp against
            //    AND so `boss.week_start` is consistent across both
            //    contexts (server uses `getCurrentWeekStartIso()` —
            //    deterministic per UTC week).
            const navToBoss = async (page: Page): Promise<void> => {
                await page.getByRole('button', { name: /^Społeczność$/i }).tap();
                await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
                await page.locator('.social__tile--gildia').tap();
                await expect(page).toHaveURL(/\/guild$/, { timeout: 10_000 });
                await expect(page.locator('.guild__home-banner')).toBeVisible({ timeout: 20_000 });
                // Tap "Loch" nav tile → GuildBoss sub-screen.
                await page.locator('.guild__nav-tile-label', { hasText: /^Loch$/i }).tap();
                // GuildBoss renders `.guild__boss-stage` — wait for it.
                await expect(page.locator('.guild__boss-stage'))
                    .toBeVisible({ timeout: 20_000 });
            };
            await Promise.all([
                navToBoss(primaryPage),
                navToBoss(secondaryPage),
            ]);

            // 7. Drive damage via direct API calls on each side. We use
            //    `page.evaluate` to dynamic-import `guildApi` from the
            //    Vite dev server (same module instance the UI uses), so
            //    every call lands with the SAME auth token + same
            //    `weekStart` the live boss row is keyed by.
            //
            //    Strategy: each member reads the live `weekStart` from
            //    `useGuildStore`'s loaded `boss` state via the guildApi
            //    `fetchOrCreateWeeklyBoss` (idempotent — returns
            //    existing row), then calls `applyBossDamage` +
            //    `addContribution` + `logAttempt` in that order.
            const driveDamage = async (
                page: Page,
                guildIdLocal: string,
                charId: string,
                charName: string,
                damage: number,
            ): Promise<void> => {
                await page.evaluate(async ({ guildIdLocal, charId, charName, damage }) => {
                    // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                    const guildMod = await import('/src/api/v1/guildApi.ts');
                    // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                    const guildSysMod = await import('/src/systems/guildSystem.ts');
                    const guildApi = (guildMod as {
                        guildApi: {
                            fetchOrCreateWeeklyBoss: (p: { guildId: string; bossTier: number }) => Promise<{ week_start: string; boss_current_hp: number }>;
                            applyBossDamage: (p: { guildId: string; weekStart: string; damage: number }) => Promise<unknown>;
                            addContribution: (p: { guildId: string; characterId: string; weekStart: string; damageAdd: number }) => Promise<unknown>;
                            logAttempt: (p: { guildId: string; characterId: string; characterName: string; damageDealt: number }) => Promise<unknown>;
                        };
                    }).guildApi;
                    const clampGuildBossTier = (guildSysMod as {
                        clampGuildBossTier: (t: number) => number;
                    }).clampGuildBossTier;
                    // Tier 1 is the default boss tier for a fresh guild.
                    const boss = await guildApi.fetchOrCreateWeeklyBoss({
                        guildId: guildIdLocal,
                        bossTier: clampGuildBossTier(1),
                    });
                    await guildApi.applyBossDamage({
                        guildId: guildIdLocal,
                        weekStart: boss.week_start,
                        damage,
                    });
                    await guildApi.addContribution({
                        guildId: guildIdLocal,
                        characterId: charId,
                        weekStart: boss.week_start,
                        damageAdd: damage,
                    });
                    await guildApi.logAttempt({
                        guildId: guildIdLocal,
                        characterId: charId,
                        characterName: charName,
                        damageDealt: damage,
                    });
                }, { guildIdLocal, charId, charName, damage });
            };

            // Primary attacks first. Sequenced (not parallel) — the boss
            // HP UPDATE is a single-row UPDATE so back-to-back avoids any
            // race in the SQL transaction layer.
            await driveDamage(primaryPage, guildId, primaryCharId, primaryNick, primaryDamage);
            await driveDamage(secondaryPage, guildId, secondaryCharId, secondaryNick, secondaryDamage);

            // 8. DB validation via service_role:
            //    • guild_boss_contributions: 2 rows, one per character.
            //    • Each row's `total_damage` matches what we sent.
            //    • guild_boss_state: HP decreased by primary+secondary (or
            //      reached 0 if boss too weak — we use tier 1's 15M HP which
            //      our 50k+30k attacks won't dent past ~0.5%).
            const admin = getAdminClient();
            const { data: contribRows, error: contribErr } = await admin
                .from('guild_boss_contributions')
                .select('character_id, total_damage')
                .eq('guild_id', guildId);
            expect(contribErr).toBeNull();
            const contribs = (contribRows ?? []) as Array<{
                character_id: string;
                total_damage: number;
            }>;
            expect(contribs).toHaveLength(2);
            const primaryContrib = contribs.find((c) => c.character_id === primaryCharId);
            const secondaryContrib = contribs.find((c) => c.character_id === secondaryCharId);
            expect(primaryContrib).toBeTruthy();
            expect(primaryContrib!.total_damage).toBe(primaryDamage);
            expect(secondaryContrib).toBeTruthy();
            expect(secondaryContrib!.total_damage).toBe(secondaryDamage);

            // Sanity: boss state row's HP dropped by the sum.
            const { data: bossRows } = await admin
                .from('guild_boss_state')
                .select('boss_max_hp, boss_current_hp')
                .eq('guild_id', guildId);
            expect(bossRows ?? []).toHaveLength(1);
            const bossState = bossRows![0] as { boss_max_hp: number; boss_current_hp: number };
            const expectedHpAfter = bossState.boss_max_hp - primaryDamage - secondaryDamage;
            // applyBossDamage clamps at >=0 so even if max_hp < sum we'd
            // see 0 — but tier 1's 15M HP guarantees this stays positive.
            expect(bossState.boss_current_hp).toBe(expectedHpAfter);

            // Attempts log has 2 rows (one per character for today).
            const { data: attemptRows } = await admin
                .from('guild_boss_attempts')
                .select('character_id, damage_dealt')
                .eq('guild_id', guildId);
            const attempts = (attemptRows ?? []) as Array<{
                character_id: string;
                damage_dealt: number;
            }>;
            expect(attempts).toHaveLength(2);
            const primaryAttempt = attempts.find((a) => a.character_id === primaryCharId);
            const secondaryAttempt = attempts.find((a) => a.character_id === secondaryCharId);
            expect(primaryAttempt?.damage_dealt).toBe(primaryDamage);
            expect(secondaryAttempt?.damage_dealt).toBe(secondaryDamage);

            // 9. UI verification — refresh the boss view on both sides
            //    via re-navigation (the in-place `useEffect` polls every
            //    4 s but we don't want to wait two cycles). After re-nav,
            //    each member's own contribution shows in the "Twoje
            //    obrażenia tej tury" row.
            const verifyOwnContribUI = async (page: Page, expectedDmg: number): Promise<void> => {
                await page.goto('/guild');
                await expect(page.locator('.guild__home-banner')).toBeVisible({ timeout: 15_000 });
                await page.locator('.guild__nav-tile-label', { hasText: /^Loch$/i }).tap();
                await expect(page.locator('.guild__boss-info')).toBeVisible({ timeout: 20_000 });
                // The "Twoje obrażenia" row format: `Twoje obrażenia tej
                // tury: <strong>{n.toLocaleString('pl-PL')}</strong>`.
                // We just check that the formatted number is present
                // (Polish locale separator is non-breaking space ` `).
                const expectedFmt = expectedDmg.toLocaleString('pl-PL');
                await expect(page.locator('.guild__boss-info'))
                    .toContainText(expectedFmt, { timeout: 10_000 });
            };
            await verifyOwnContribUI(primaryPage, primaryDamage);
            await verifyOwnContribUI(secondaryPage, secondaryDamage);
        } finally {
            // CASCADE: guilds delete wipes guild_boss_state +
            // guild_boss_contributions + guild_boss_attempts + members.
            await cleanupGuildsByLeaderIds([primaryCharId, secondaryCharId]);
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            }
        }
    });
});
