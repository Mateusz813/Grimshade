/**
 * Regression E2E — same `market_listings` row can be bought AT MOST ONCE
 * (production-bug fix discovered 2026-05-25).
 *
 * ## Bug recap
 *
 * Before `scripts/market_buy_rpc_migration.sql` shipped, the buy flow
 * chained `marketApi.getListing()` + `marketApi.decrementListing()`.
 * The decrement step ran an UPDATE/DELETE under the BUYER's auth
 * session — RLS on `market_listings` only permits the SELLER to mutate
 * the row, so the call SILENTLY no-oped on the server. The buyer's UI
 * showed success (toast + local inventory bump + local listing splice)
 * and the same row could be "bought" infinitely by different buyers,
 * each pocketing the item from their own optimistic update.
 *
 * The fix: a SECURITY DEFINER `buy_market_listing(p_listing_id,
 * p_buyer_character_id, p_quantity)` RPC takes a row-level lock,
 * decrements (or deletes) the row, and inserts the sale notification
 * atomically with table-owner privileges. The client calls the RPC
 * ONCE and credits the buyer's inventory + gold afterwards.
 *
 * ## Test flow
 *
 * Test runs entirely server-side via the `marketApi.buyListing` JS
 * client — we don't need to drive Playwright's UI through two full
 * buy interactions. The risky behaviour is purely DB-side
 * (row-availability after buy #1), and the JS client + the RPC are
 * the single load-bearing surface. Saves ~30s vs a full multi-context
 * UI walk-through and tests the contract more precisely.
 *
 *  1. Seed primary (seller) with 1× hp_potion_sm + create a market
 *     listing via service_role admin (bypass the UI seller flow).
 *  2. Seed secondary (buyer) with no UI state needed; we drive
 *     `marketApi.buyListing` via `page.evaluate` against an
 *     authenticated secondary session.
 *  3. Buyer calls `marketApi.buyListing(listingId, secondaryCharId, 1)`
 *     -> expect `{ ok: true, … }`. Service_role probe: listing row is
 *     GONE (`market_listings WHERE id = ?` returns 0 rows).
 *  4. Buyer calls `marketApi.buyListing` AGAIN on the same id ->
 *     expect `{ ok: false, reason: 'not_found' }`. Proves the row
 *     can't be double-spent.
 *
 * ## Why server-side simulation (not UI taps)
 *
 *  - The vulnerable surface is `decrementListing` -> `buyListing` RPC;
 *    every UI tap funnels through the same JS call. We test the JS
 *    contract directly so the test runs in seconds and isn't subject
 *    to mobile-WebKit modal animation jitter.
 *  - The sibling `buy-from-secondary-account.spec.ts` covers the
 *    full UI walk-through (toast, inventory bump, gold spend) for
 *    one buy. This test adds the SECOND-buy assertion that proves
 *    the bug is fixed.
 *
 * ## Skip when RPC not deployed
 *
 *  We probe `buy_market_listing` at the start of the test. If the
 *  function isn't installed (PGRST202), the test SKIPS with a hint
 *  pointing to the migration. Once the migration is applied the
 *  test auto-enables.
 *
 * ## Cleanup
 *
 *  - Both characters wiped via `cleanupCharacterById`.
 *  - Any leftover market_listings row by primary's seller_id is
 *    cascaded via CHARACTER_CHILD_TABLES.
 */

import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedConsumables } from '../../fixtures/seedInventory';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { getAdminClient } from '../../fixtures/adminClient';
import { loginViaUI } from '../../fixtures/login';

const r12dNick = (): string => `r12d_${generateTestCharacterName().slice(0, 10)}`;

/**
 * Probe for `buy_market_listing` RPC. Returns true if PostgREST can
 * resolve + execute the function (even rejecting on a fake UUID is a
 * success signal — the function ran). Returns false on PGRST202
 * (function missing in schema cache).
 */
const isBuyMarketListingRpcApplied = async (): Promise<boolean> => {
    const admin = getAdminClient();
    const { error } = await admin.rpc('buy_market_listing', {
        p_listing_id: '00000000-0000-0000-0000-000000000000',
        p_buyer_character_id: '00000000-0000-0000-0000-000000000000',
        p_quantity: 1,
    });
    if (!error) return true;
    const code = (error as { code?: string }).code;
    if (code === 'PGRST202') return false;
    throw new Error(`[probe] buy_market_listing RPC probe failed: ${code ?? 'noCode'} ${error.message}`);
};

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

test.describe('City › Market', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('regression: same listing cannot be bought twice (RPC row-lock + delete)', async ({ page }) => {
        // -- Step 0: probe RPC presence ------------------------------------
        // 2026-05-27: removed test.skip fallback (RPC IS deployed). If
        // probe fails, throw loudly so the regression isn't silently
        // bypassed in future.
        const rpcApplied = await isBuyMarketListingRpcApplied();
        if (!rpcApplied) {
            throw new Error(
                'buy_market_listing RPC not detected — was scripts/market_buy_rpc_migration.sql' +
                ' applied? Without RPC, this regression test (and prod market buy) are broken.',
            );
        }

        const primaryNick = r12dNick();
        const secondaryNick = r12dNick();

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let listingId: string | null = null;
        const admin = getAdminClient();

        try {
            // 1. Seed SELLER (primary) char + consumable + market listing
            //    via service_role. No UI needed — we're testing the
            //    server-side double-buy contract.
            const primaryCreated = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: primaryNick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            primaryCharId = primaryCreated.id;
            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({ characterId: primaryCharId, userId: primaryUserId });
            await seedConsumables({
                characterId: primaryCharId,
                counts: { hp_potion_sm: 1 },
            });

            // Insert the listing directly with service_role so we
            // control the row shape + skip the UI seller flow.
            const { data: createdRow, error: insertErr } = await admin
                .from('market_listings')
                .insert({
                    seller_id: primaryCharId,
                    seller_name: primaryNick,
                    kind: 'potion',
                    item_id: 'hp_potion_sm',
                    item_name: 'Mały Eliksir HP',
                    item_level: 1,
                    rarity: 'common',
                    slot: '',
                    price: 50,
                    quantity: 1,
                    quantity_initial: 1,
                    bonuses: {},
                    upgrade_level: 0,
                })
                .select('id')
                .single();
            if (insertErr) throw new Error(`[setup] market_listings insert failed: ${insertErr.message}`);
            listingId = createdRow.id as string;

            // 2. Seed BUYER (secondary) char + gold so the RPC's path
            //    isn't blocked by the (server-side) own_listing guard
            //    or the (client-side) gold guard if we were going via UI.
            //    The RPC itself only checks not-self + in-stock; gold
            //    is a client-side concern.
            const secondaryCreated = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: secondaryNick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({ characterId: secondaryCharId, userId: secondaryUserId, gold: 5000 });

            // 3. Log in as SECONDARY through the UI so the page has an
            //    authenticated supabase session. Then we drive the JS
            //    client `marketApi.buyListing` via page.evaluate —
            //    same JS contract every UI tap would funnel through.
            await loginViaUI(page, testUsers.secondary);
            await pickCharacter(page, secondaryNick);

            // 4. FIRST buy — expect ok: true.
            const firstBuyResult = await page.evaluate(async ({ lId, charId }) => {
                const mod = await import('/src/api/v1/marketApi.ts');
                return mod.marketApi.buyListing(lId, charId, 1);
            }, { lId: listingId, charId: secondaryCharId }) as { ok: boolean; reason?: string };
            expect(firstBuyResult.ok).toBe(true);

            // 5. DB-side invariant: row is GONE.
            const { data: postFirstBuy } = await admin
                .from('market_listings')
                .select('id')
                .eq('id', listingId);
            expect(postFirstBuy ?? []).toHaveLength(0);

            // 6. SECOND buy on the same listing id — expect ok: false
            //    with reason: 'not_found'. THIS is the regression
            //    guard: before the fix, the second buy would also
            //    "succeed" locally because the JS client's optimistic
            //    update didn't reflect what the server actually did.
            const secondBuyResult = await page.evaluate(async ({ lId, charId }) => {
                const mod = await import('/src/api/v1/marketApi.ts');
                return mod.marketApi.buyListing(lId, charId, 1);
            }, { lId: listingId, charId: secondaryCharId }) as { ok: boolean; reason?: string };
            expect(secondBuyResult.ok).toBe(false);
            expect(secondBuyResult.reason).toBe('not_found');

            // 7. DB-side invariant (post-second-buy): still no row.
            //    Belt-and-braces — make sure the second call didn't
            //    accidentally re-insert anything.
            const { data: postSecondBuy } = await admin
                .from('market_listings')
                .select('id')
                .eq('id', listingId);
            expect(postSecondBuy ?? []).toHaveLength(0);
        } finally {
            // Defensive: if the listing was somehow left behind (e.g.
            // RPC didn't actually delete), wipe it directly so the
            // STABLE test account doesn't accumulate orphans.
            if (listingId) {
                await admin.from('market_listings').delete().eq('id', listingId);
            }
            const idsToWipe = [primaryCharId, secondaryCharId].filter(
                (id): id is string => id !== null,
            );
            if (idsToWipe.length > 0) {
                await Promise.all(idsToWipe.map((id) => cleanupCharacterById(id)));
            }
        }
    });
});
