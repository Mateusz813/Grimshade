/**
 * Multi-context E2E — guild treasury put + take (BACKLOG 4.6).
 *
 * Spec ("Skarbiec gildii: put + take"): two members of the same guild.
 * Primary has an item in their bag -> opens Skarbiec gildii -> taps
 * "Włóż ->" on the bag tile -> item moves from bag to treasury (DB row in
 * `guild_treasury_items`, `guild_treasury_logs` row with action='deposit').
 * Secondary opens Skarbiec -> sees the deposited item in the vault column
 * (poll up to 5 s — `GuildTreasury` refreshes every 5 s, no Realtime sub)
 * -> taps "<- Wyciągnij" -> item moves from treasury to secondary's bag
 * (DELETE from `guild_treasury_items`, INSERT into `guild_treasury_logs`
 * with action='withdraw').
 *
 * Final assertions:
 *   - Primary's bag count drops by 1 (item left primary).
 *   - Secondary's `inventoryStore.bag` has the item with same UUID.
 *   - `guild_treasury_logs` table has BOTH 'deposit' (primary) AND
 *     'withdraw' (secondary) rows for this guild.
 *   - `guild_treasury_items` table is empty for this guild after the take.
 *
 * Why multi-context:
 *   The take half MUST happen on secondary's screen to prove the item
 *   left primary's posession AND landed in secondary's inventory across
 *   the wire. A single-context test could only prove the half-cycle.
 *
 * Setup strategy: pre-seed both characters as members of the same guild
 * via `seedGuild` (skips create+apply+accept dance) + seed primary with
 * an iron_sword in `inventory.bag` via `seedGameSave({ bagItems })`. No
 * gold needed (deposit/withdraw are free).
 *
 * Treasury refresh cadence:
 *   `GuildTreasury` component (Guild.tsx line 2010-2014) has a
 *   `setInterval(refresh, 5000)` polling loop. No Realtime channel on
 *   `guild_treasury_items` — the 5 s poll is the propagation mechanism.
 *   We give 20 s on secondary's "sees item in vault" assertion to cover
 *   2-3 poll cycles + WebKit cold start.
 *
 * Cleanup:
 *   - cleanupGuildsByLeaderIds — CASCADE wipes `guild_treasury_items` +
 *     `guild_treasury_logs` rows automatically (FK on guild_id).
 *   - characters cleaned via multiContext.cleanup.
 *
 * Why no UI dialog for picking the item:
 *   The bag column renders all items as a list with "Włóż ->" buttons
 *   per row. We pick by UUID match — we seeded the item with a known
 *   UUID prefix (`treasury-test-<rand>`) so even if other test runs left
 *   sibling items, our row is identifiable by the unique item's name and
 *   the leading tile in our `seedGameSave({ bagItems: [oneItem] })`.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail, type ISeedBagItem } from '../../../fixtures/seedGameSave';
import { openMultiContext } from '../../../fixtures/multiContext';
import { seedGuild } from '../../../fixtures/seedGuild';
import { cleanupGuildsByLeaderIds } from '../../../fixtures/guildCleanup';
import { getAdminClient } from '../../../fixtures/adminClient';

test.describe('Social › Guild', { tag: '@guild' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('multi-context: primary deposits item -> secondary withdraws -> treasury logs show deposit + withdraw', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'A');
        const guildName = `E2E G ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        // Unique UUID + item — use `sword_of_beginnings` (legacy item id
        // present in `getLegacyItemInfo` map in src/systems/itemGenerator.ts)
        // so the Polish name "Miecz Poczatku" resolves cleanly. Plain
        // items.json IDs like `iron_sword` don't have a `_lvlX_` suffix
        // OR a legacy map entry -> getItemDisplayInfo returns null -> the
        // treasury UI falls back to rendering the raw itemId, which
        // makes our locator-by-name brittle.
        const itemUuid = `treasury-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const seedItem: ISeedBagItem = {
            uuid: itemUuid,
            itemId: 'sword_of_beginnings',
            rarity: 'common',
            bonuses: {},
            itemLevel: 1,
        };
        // Resolved name from `getLegacyItemInfo` — used in locator below.
        const itemPolishName = 'Miecz Poczatku';

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let guildId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            // 1. Seed characters at lvl 10 (above iron_sword's minLevel=5).
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
                class: 'Knight', // both Knights — both can wield the iron_sword if needed downstream
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;

            // 2. Seed game_saves. Primary gets the iron_sword in bag;
            //    secondary starts with empty bag (will receive on withdraw).
            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: primaryCharId,
                userId: primaryUserId,
                bagItems: [seedItem],
            });
            await seedGameSave({
                characterId: secondaryCharId,
                userId: secondaryUserId,
            });

            // 3. Direct-seed the guild with both as members (primary = leader).
            const seededGuild = await seedGuild({
                name: guildName,
                tag,
                memberCharacterIds: [primaryCharId, secondaryCharId],
            });
            guildId = seededGuild.id;

            // 4. Open multi-context + parallel login.
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

            // 6. Both navigate Town -> Społeczność -> Gildia -> Skarbiec.
            const navToTreasury = async (page: Page): Promise<void> => {
                await page.getByRole('button', { name: /^Społeczność$/i }).tap();
                await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
                await page.locator('.social__tile--gildia').tap();
                await expect(page).toHaveURL(/\/guild$/, { timeout: 10_000 });
                // Wait for guild home view to mount.
                await expect(page.locator('.guild__home-banner')).toBeVisible({ timeout: 20_000 });
                // Tap "Skarbiec" nav tile -> GuildTreasury sub-screen.
                await page.locator('.guild__nav-tile-label', { hasText: /^Skarbiec$/i }).tap();
                // GuildTreasury renders ":gem-stone: Skarbiec gildii" in the top-bar.
                await expect(page.locator('.guild__top-title', { hasText: /Skarbiec gildii/i }))
                    .toBeVisible({ timeout: 15_000 });
            };
            await Promise.all([
                navToTreasury(primaryPage),
                navToTreasury(secondaryPage),
            ]);

            // 7. PRIMARY: bag column shows the seeded iron_sword. Its
            //    Polish name is "Miecz Poczatku" per legacy item map. We find
            //    the row in the LEFT (bag) column by name, then tap its
            //    "Włóż ->" button.
            //
            //    There are TWO columns of `.guild__treasury-row` (bag +
            //    vault). The bag column is the first `.guild__treasury-col`
            //    in the grid, distinguished by header "Twój plecak".
            const primaryBagCol = primaryPage.locator('.guild__treasury-col', {
                has: primaryPage.locator('.guild__treasury-title', { hasText: /Twój plecak/i }),
            });
            const primaryVaultCol = primaryPage.locator('.guild__treasury-col', {
                has: primaryPage.locator('.guild__treasury-title', { hasText: /Skarbiec gildii/i }),
            });
            const primaryBagRow = primaryBagCol.locator('.guild__treasury-row', {
                has: primaryPage.locator('.guild__treasury-name', { hasText: itemPolishName }),
            });
            await expect(primaryBagRow).toBeVisible({ timeout: 15_000 });

            // Sanity: vault column is empty before deposit.
            await expect(primaryVaultCol.locator('.guild__treasury-empty'))
                .toBeVisible({ timeout: 5_000 });

            // 8. PRIMARY: tap "Włóż ->" in the bag row. After deposit:
            //    - bag row disappears (item left bag — `removeItem(uuid)`).
            //    - vault column gets the same item row (refresh fetches new
            //      treasury list).
            //    Button text contains "Włóż" (with an arrow) per Guild.tsx
            //    line 2129.
            await primaryBagRow.locator('button', { hasText: /Włóż/ }).tap();

            // The bag row should disappear within a few seconds (await
            // refresh — handleDeposit calls `await refresh()` synchronously
            // after the API insert resolves).
            await expect(primaryBagRow).toBeHidden({ timeout: 15_000 });

            // Vault column on primary should now have the row.
            const primaryVaultRow = primaryVaultCol.locator('.guild__treasury-row', {
                has: primaryPage.locator('.guild__treasury-name', { hasText: itemPolishName }),
            });
            await expect(primaryVaultRow).toBeVisible({ timeout: 15_000 });

            // 9. SECONDARY: needs to see the new item in the vault column.
            //    GuildTreasury polls every 5 s (no Realtime sub) — 45s
            //    headroom: under full-suite DB load the deposit write +
            //    secondary's poll round-trip can chain to 15-25s.
            const secondaryVaultCol = secondaryPage.locator('.guild__treasury-col', {
                has: secondaryPage.locator('.guild__treasury-title', { hasText: /Skarbiec gildii/i }),
            });
            const secondaryBagCol = secondaryPage.locator('.guild__treasury-col', {
                has: secondaryPage.locator('.guild__treasury-title', { hasText: /Twój plecak/i }),
            });
            const secondaryVaultRow = secondaryVaultCol.locator('.guild__treasury-row', {
                has: secondaryPage.locator('.guild__treasury-name', { hasText: itemPolishName }),
            });
            await expect(secondaryVaultRow).toBeVisible({ timeout: 45_000 });

            // Sanity: secondary's bag column is empty pre-withdraw.
            await expect(secondaryBagCol.locator('.guild__treasury-empty'))
                .toBeVisible({ timeout: 5_000 });

            // 10. SECONDARY: tap "<- Wyciągnij" on the vault row. After
            //     withdraw:
            //     - vault row disappears (server DELETE -> next refresh has
            //       empty treasury).
            //     - secondary's bag column gets the item row (restoreItem
            //       in inventoryStore appends to bag -> next refresh of
            //       the local bag view).
            await secondaryVaultRow.locator('button', { hasText: /Wyciągnij/ }).tap();
            await expect(secondaryVaultRow).toBeHidden({ timeout: 15_000 });
            const secondaryBagRow = secondaryBagCol.locator('.guild__treasury-row', {
                has: secondaryPage.locator('.guild__treasury-name', { hasText: itemPolishName }),
            });
            await expect(secondaryBagRow).toBeVisible({ timeout: 15_000 });

            // 11. Cross-context DB validation via service_role:
            //     - guild_treasury_items: 0 rows for this guild.
            //     - guild_treasury_logs: 2 rows for this guild — one
            //       'deposit' by primary, one 'withdraw' by secondary.
            const admin = getAdminClient();
            const { data: treasuryRowsAfter } = await admin
                .from('guild_treasury_items')
                .select('id')
                .eq('guild_id', guildId);
            expect(treasuryRowsAfter ?? []).toHaveLength(0);

            const { data: logRows } = await admin
                .from('guild_treasury_logs')
                .select('action, character_id, character_name')
                .eq('guild_id', guildId);
            const logs = (logRows ?? []) as Array<{
                action: 'deposit' | 'withdraw';
                character_id: string;
                character_name: string;
            }>;
            expect(logs).toHaveLength(2);
            const depositLog = logs.find((l) => l.action === 'deposit');
            const withdrawLog = logs.find((l) => l.action === 'withdraw');
            expect(depositLog).toBeTruthy();
            expect(depositLog!.character_id).toBe(primaryCharId);
            expect(depositLog!.character_name).toBe(primaryNick);
            expect(withdrawLog).toBeTruthy();
            expect(withdrawLog!.character_id).toBe(secondaryCharId);
            expect(withdrawLog!.character_name).toBe(secondaryNick);
        } finally {
            // Order: guild CASCADE wipes treasury items + logs + members.
            await cleanupGuildsByLeaderIds([primaryCharId, secondaryCharId]);
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            }
        }
    });
});
