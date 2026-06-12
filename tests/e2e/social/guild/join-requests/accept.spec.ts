/**
 * Multi-context E2E — secondary requests join, primary (leader) accepts (BACKLOG 4.7).
 *
 * Spec ("Zaakceptuj prośbę dołączenia do gildii"): two browser contexts
 * logged in as different accounts. Primary founds a guild; secondary
 * navigates to /guild, taps the :handshake: apply icon on primary's row, then
 * confirms the modal. Primary opens the "Prośby" sub-screen, sees the
 * pending request from secondary, and taps "v Przyjmij". After accept:
 *   - Primary's roster grows from 1 -> 2 members (secondary joins).
 *   - Secondary's /guild view auto-switches from "list browser" to
 *     "home view" (Realtime postgres_changes on guild_members flips the
 *     store).
 *
 * Multi-context flow:
 *   1. Pre-seed primary character + 2M gp gold (covers the 1M guild cost).
 *   2. Pre-seed secondary character (no gold needed — they just apply).
 *   3. Open 2 contexts via `openMultiContext`; parallel login.
 *   4. Both pick their characters -> Town.
 *   5. Primary navigates Town -> Społeczność -> Gildia, creates a guild.
 *   6. Secondary navigates Town -> Społeczność -> Gildia, sees the guild
 *      in the list, taps :handshake:, confirms apply modal.
 *   7. Primary opens "Prośby" sub-screen, sees secondary's pending
 *      request, taps "v Przyjmij".
 *   8. Both rosters should show 2 members (Realtime sync).
 *
 * Realtime sync notes:
 *   - Primary's `guild_members` channel sub fires on the INSERT done
 *     during `acceptRequest` -> roster auto-refreshes.
 *   - Secondary's `useGuildStore.hydrateForCharacter` re-runs on the
 *     next /guild mount; but we don't need to navigate them — we
 *     verify the request shows up in primary's view, accept it, then
 *     re-navigate secondary to /guild for a final sanity check.
 *
 * Cleanup: BOTH characters + the founded guild row. Done via the multi-
 *   context fixture's cleanup + an explicit guild-by-leader-id delete.
 *
 * Timeout 120_000 — same justification as the party-join multi-ctx test
 *   (12+ network ops, Realtime waits, 2× login).
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { openMultiContext } from '../../../fixtures/multiContext';
import { cleanupGuildsByLeaderIds } from '../../../fixtures/guildCleanup';

test.describe('Social › Guild', { tag: '@guild' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary founds guild -> secondary applies -> primary accepts -> both rosters show 2 members', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'A');
        const guildName = `E2E G ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            // 1. Seed characters BEFORE opening contexts so pickers find them.
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

            // 2. Seed game_saves. Primary needs gold for the create cost;
            //    secondary doesn't (apply is free).
            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: primaryCharId,
                userId: primaryUserId,
                gold: 2_000_000,
            });
            await seedGameSave({
                characterId: secondaryCharId,
                userId: secondaryUserId,
            });

            // 3. Open 2 browser contexts + parallel login.
            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            // 4. Both pick characters -> Town (parallel).
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

            // 5. Both navigate Town -> Społeczność -> Gildia.
            const navToGuild = async (page: Page): Promise<void> => {
                await page.getByRole('button', { name: /^Społeczność$/i }).tap();
                await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
                await page.locator('.social__tile--gildia').tap();
                await expect(page).toHaveURL(/\/guild$/, { timeout: 10_000 });
            };
            await Promise.all([
                navToGuild(primaryPage),
                navToGuild(secondaryPage),
            ]);

            // 6. PRIMARY: create the guild. Wait for the list-create
            //    button before tap — it only renders once the list
            //    fetch resolves.
            await expect(primaryPage.locator('.guild__list-create')).toBeVisible({ timeout: 15_000 });
            await primaryPage.locator('.guild__list-create').tap();
            await expect(primaryPage.locator('.guild__modal-title', { hasText: /Stwórz gildię/i }))
                .toBeVisible({ timeout: 5_000 });
            await primaryPage.locator('#guild-name').fill(guildName);
            await primaryPage.locator('#guild-tag').fill(tag);
            const primarySubmit = primaryPage.locator('.guild__btn-primary', { hasText: /Stwórz gildię/i });
            await expect(primarySubmit).toBeEnabled({ timeout: 10_000 });
            await primarySubmit.tap();

            // 7. PRIMARY: home view appears with our banner.
            await expect(primaryPage.locator('.guild__home-banner')).toBeVisible({ timeout: 15_000 });
            await expect(primaryPage.locator('.guild__home-name')).toContainText(guildName);

            // 8. SECONDARY: list now has primary's new guild. May need a
            //    refresh because the list is fetched on mount — the
            //    secondary mounted /guild BEFORE primary created the
            //    guild, so we explicitly re-navigate to trigger refetch.
            //    (Realtime on `guilds` isn't subscribed by the list view —
            //    only home view subscribes to UPDATEs on its own guild.)
            await secondaryPage.goto('/guild');
            await expect(secondaryPage.locator('.guild__list-create')).toBeVisible({ timeout: 15_000 });

            // The new guild's row is keyed by name in the list-name span.
            // Search the box rendered above — once Postgres returns the
            // row (15s timeout for slow Supabase).
            const guildRow = secondaryPage.locator('.guild__list-row', {
                has: secondaryPage.locator('.guild__list-name', { hasText: guildName }),
            });
            await expect(guildRow).toBeVisible({ timeout: 15_000 });

            // 9. SECONDARY: tap apply :handshake: -> confirm modal -> submit.
            await guildRow.locator('.guild__list-apply').tap();
            await expect(secondaryPage.locator('.guild__modal-title', { hasText: /Aplikuj do gildii/i }))
                .toBeVisible({ timeout: 5_000 });
            const applyBtn = secondaryPage.locator('.guild__btn-primary', { hasText: /^Aplikuj$/i });
            await expect(applyBtn).toBeEnabled({ timeout: 10_000 });
            await applyBtn.tap();
            // Modal closes after submit — wait for it to detach so the
            // next assertion isn't blocked by an in-flight close anim.
            await expect(secondaryPage.locator('.guild__modal-title', { hasText: /Aplikuj do gildii/i }))
                .toBeHidden({ timeout: 10_000 });

            // 10. PRIMARY: open "Prośby" sub-screen. Realtime on
            //     `guild_join_requests` already updated `requests` in
            //     the store, so the nav tile label includes "(1)".
            //     45s — the cross-context broadcast (secondary's apply
            //     reaching primary) can take 15-25s under full-suite load.
            const requestsTile = primaryPage.locator('.guild__nav-tile-label', { hasText: /Prośby/i });
            await expect(requestsTile).toContainText(/\(1\)/, { timeout: 45_000 });
            await requestsTile.tap();

            // 11. PRIMARY: request row visible with secondary's name. Tap
            //     "v Przyjmij". After accept, the requests list shrinks
            //     to 0 (purgeRequestsForCharacter removes it).
            const requestRow = primaryPage.locator('.guild__request-row', {
                has: primaryPage.locator('.guild__member-name', { hasText: secondaryNick }),
            });
            await expect(requestRow).toBeVisible({ timeout: 10_000 });
            const acceptBtn = requestRow.locator('.guild__btn-ok', { hasText: /Przyjmij/i });
            await expect(acceptBtn).toBeEnabled();
            await acceptBtn.tap();
            await expect(requestRow).toBeHidden({ timeout: 15_000 });

            // 12. PRIMARY: go back to guild home, verify member count = 2
            //     and secondary's row visible.
            await primaryPage.locator('.guild__nav-back', { hasText: /Gildia/i }).tap();
            await expect(primaryPage.locator('.guild__home-banner')).toBeVisible({ timeout: 10_000 });
            await expect(primaryPage.locator('.guild__home-level'))
                .toContainText(/Członkowie 2\/\d+/i, { timeout: 20_000 });
            await expect(primaryPage.locator('.guild__member-name', { hasText: secondaryNick }))
                .toBeVisible({ timeout: 15_000 });

            // 13. SECONDARY: navigate to /guild again — should land on
            //     the home view now (no longer in the list). The store
            //     hydrate fires on mount, finds the membership, flips
            //     the screen to 'home'.
            await secondaryPage.goto('/guild');
            await expect(secondaryPage.locator('.guild__home-banner')).toBeVisible({ timeout: 20_000 });
            await expect(secondaryPage.locator('.guild__home-name')).toContainText(guildName);
            await expect(secondaryPage.locator('.guild__home-level'))
                .toContainText(/Członkowie 2\/\d+/i, { timeout: 15_000 });
        } finally {
            // Order: guild rows first (CASCADE -> child tables), then
            // character cleanup. The multi-context fixture also handles
            // parties cleanup — we don't have a party here but it's a
            // no-op when leader_id matches nothing.
            await cleanupGuildsByLeaderIds([primaryCharId, secondaryCharId]);
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            }
        }
    });
});
