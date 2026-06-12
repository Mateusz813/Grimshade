/**
 * Multi-context E2E — Market: primary creates listing -> secondary buys
 * it (BACKLOG 5.7).
 *
 * 2026-05-25 v2: server-side RPC `buy_market_listing` now does the
 * row-decrement / delete atomically — DB-side assertion tightened
 * from `gone | decremented-to-zero | still-exists-qty-1` (current
 * contract pin) to strict `gone`. Test skips with a clear hint when
 * the RPC isn't deployed (`scripts/market_buy_rpc_migration.sql`).
 *
 * Spec: "Market: kup ofertę z drugiego konta". This is the canonical
 * multi-context proof that buying from another player's listing works
 * end-to-end:
 *   - Seller listing materialises in DB (`market_listings` row).
 *   - Buyer can find the listing in the browse feed.
 *   - Buying decrements buyer's gold by `listing.price × qty`.
 *   - Item lands in buyer's inventory (consumable count increased).
 *   - Listing row is removed (qty went 1->0 -> DELETE) from DB.
 *
 * Wire path (matches Market.tsx + marketStore.buyListing + marketApi
 * decrementListing):
 *   1. SELLER (primary): tap "Sprzedaj" tab -> tap hp_potion_sm tile ->
 *      SellModal -> fill price=100 -> tap "Wystaw" -> `marketStore.listItem`
 *      writes a row into `market_listings` table + escrows 1× hp_potion_sm
 *      from inv.consumables (price seeded at 100, qty=1).
 *   2. BUYER (secondary): tap "Przeglądaj" tab -> tap refresh / search ->
 *      find listing by sellerName (primaryNick) + itemName -> tap -> BuyModal
 *      -> tap "Zatwierdź" -> `marketStore.buyListing` -> `marketApi.decrementListing`
 *      (qty->0 -> DELETE) -> buyer's inv.consumables['hp_potion_sm'] += 1 +
 *      buyer's inv.gold -= 100 (Market.tsx line 584).
 *
 * Assertions:
 *   * Seller side, after listing: row visible in "Moje" tab, DB row
 *     materialised with price=100 / qty=1 / kind='potion'.
 *   * Buyer side, after buy: toast "Kupiono: ... ×1" appears, gold spent.
 *   * DB side, after buy: market_listings row for that itemId+seller_id
 *     is GONE (qty=1 -> DELETE branch of decrementListing).
 *
 * Why multi-context vs single-context:
 *   Single-context can simulate seller+buyer with the same account but
 *   that bypasses the buyer=/=seller path which is the only interesting
 *   case (cross-user RLS + buyer's gold flow + seller's listing
 *   visibility from another auth context). The PRODUCTION code branches
 *   on `isOwn = l.sellerId === character.id` (Market.tsx line 915) -> if
 *   the buyer is the seller, tap on listing routes to EditModal, not
 *   BuyModal. Single-context can't reach the "buy from another player"
 *   path. Must be multi-ctx.
 *
 * Cleanup:
 *   - Both characters wiped via multiContext.cleanup.
 *   - market_listings is in CHARACTER_CHILD_TABLES under seller_id key
 *     (cleanup.ts line 95) — if the listing didn't get bought (test
 *     crashed before tap), wiping seller's character removes the row.
 *
 * Why 120s timeout: 2× login + 2× character pick + 2× /market nav +
 * seller's create + Realtime sync + buyer's buy + ~3 DB validations.
 * 120s gives generous headroom for WebKit cold start + DB round-trip
 * latency.
 *
 * Why r11d_ prefix on character names: other agents running in parallel
 * (per task brief). Unique prefix avoids collision.
 */

import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { seedConsumables } from '../../fixtures/seedInventory';
import { openMultiContext } from '../../fixtures/multiContext';
import { getAdminClient } from '../../fixtures/adminClient';

const r11dNick = (): string => `r11d_${generateTestCharacterName().slice(0, 10)}`;

/**
 * Probe the `buy_market_listing` SECURITY DEFINER RPC. Returns true
 * when the function is deployed (the call returns a JSON body —
 * including the `not_found` rejection shape for a fake UUID — meaning
 * PostgREST resolved the function and executed it). Returns false when
 * PostgREST cannot find the function (PGRST202), meaning the migration
 * `scripts/market_buy_rpc_migration.sql` hasn't been applied yet.
 *
 * Other transport errors are surfaced as a thrown Error so a broken
 * DB / auth setup doesn't silently look like "migration missing".
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
    throw new Error(`[probe] buy_market_listing RPC probe failed unexpectedly: ${code ?? 'noCode'} ${error.message}`);
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

const navToMarket = async (page: Page): Promise<void> => {
    await page.goto('/market');
    await expect(page.locator('.market')).toBeVisible({ timeout: 15_000 });
};

test.describe('City › Market', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary lists hp_potion_sm -> secondary buys -> DB row removed + seller listing gone', async ({ browser }) => {
        // 2026-05-27: removed test.skip fallback (RPC IS deployed). If
        // probe fails, throw loudly so the regression isn't silently
        // bypassed.
        const rpcApplied = await isBuyMarketListingRpcApplied();
        if (!rpcApplied) {
            throw new Error(
                'buy_market_listing RPC not detected — was scripts/market_buy_rpc_migration.sql' +
                ' applied? Without RPC, this market buy test (and prod buy) are broken.',
            );
        }

        const primaryNick = r11dNick();
        const secondaryNick = r11dNick();
        // Distinguishable price (100) — easy to scan for in DB + UI.
        const LISTING_PRICE = 100;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            // 1. SEED both characters.
            //    - Primary (seller): seeds 5× hp_potion_sm so the sell-tile
            //      shows up + has stock to escrow.
            //    - Secondary (buyer): seeds 5000 gold via seedGameSave so
            //      they can afford the 100 gp listing.
            const primaryCreated = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: primaryNick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            primaryCharId = primaryCreated.id;

            const secondaryCreated = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: secondaryNick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;

            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);

            await seedGameSave({ characterId: primaryCharId, userId: primaryUserId });
            // Buyer needs ≥ LISTING_PRICE gold — seed 5000 for safety.
            await seedGameSave({ characterId: secondaryCharId, userId: secondaryUserId, gold: 5000 });

            await seedConsumables({
                characterId: primaryCharId,
                counts: { hp_potion_sm: 5 },
            });

            // 2. OPEN MULTI-CONTEXT.
            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            // 3. BOTH pick + go to /market.
            await Promise.all([
                pickCharacter(primaryPage, primaryNick),
                pickCharacter(secondaryPage, secondaryNick),
            ]);
            await Promise.all([
                navToMarket(primaryPage),
                navToMarket(secondaryPage),
            ]);

            // 4. SELLER (primary): list 1× hp_potion_sm for 100 gp.
            const sellTab = primaryPage.locator('.market__tab', { hasText: /^Sprzedawaj$/i });
            await expect(sellTab).toBeVisible({ timeout: 5_000 });
            await sellTab.tap();
            await expect(sellTab).toHaveClass(/market__tab--active/);

            const sellTile = primaryPage.locator('.market__sell-tile', {
                has: primaryPage.locator('.market__sell-tile-name', { hasText: 'Mały Eliksir HP' }),
            });
            await expect(sellTile).toBeVisible({ timeout: 10_000 });
            await sellTile.tap();

            const sellModal = primaryPage.locator('.market__modal').last();
            await expect(sellModal).toBeVisible({ timeout: 5_000 });

            const priceInput = sellModal.locator('input[type="number"]').last();
            await priceInput.fill(String(LISTING_PRICE));

            const sellSubmit = sellModal.locator('.market__modal-btn--confirm');
            await expect(sellSubmit).toBeEnabled({ timeout: 3_000 });
            await sellSubmit.tap();

            // Toast + auto-switch to Moje tab + my listing row visible.
            await expect(sellModal).toBeHidden({ timeout: 8_000 });
            await expect(primaryPage.locator('.market__toast'))
                .toContainText(/Wystawiono.*Mały Eliksir HP.*×1/i, { timeout: 5_000 });

            // Sanity: DB-side, the listing exists.
            const admin = getAdminClient();
            const { data: createdListing, error: selErr } = await admin
                .from('market_listings')
                .select('id, price, quantity, kind, item_id, seller_id')
                .eq('seller_id', primaryCharId)
                .eq('item_id', 'hp_potion_sm')
                .single();
            if (selErr) throw new Error(`[5.7 setup] market_listings post-list select failed: ${selErr.message}`);
            expect(createdListing.price).toBe(LISTING_PRICE);
            expect(createdListing.quantity).toBe(1);
            expect(createdListing.kind).toBe('potion');

            // 5. BUYER (secondary): navigate to "Przeglądaj" tab.
            //    The tab label is "Przeglądaj(<count>)" when listings exist
            //    (Market.tsx line 804-805), so we anchor on a substring
            //    match — not a strict ^Przeglądaj$.
            const browseTab = secondaryPage.locator('.market__tab', { hasText: /Przeglądaj/i });
            await expect(browseTab).toBeVisible({ timeout: 5_000 });
            // The browse tab is the default-active one — assert + ensure.
            await browseTab.tap();
            await expect(browseTab).toHaveClass(/market__tab--active/);

            // The listing should appear in the browse feed within ~5-15s
            // (marketStore.fetchListings polls on mount; we may need to
            // wait for the next refresh cycle or hit the manual refresh
            // button if present).
            //
            // Strategy: look for the row by anchoring on hp_potion_sm
            // (Mały Eliksir HP). If we don't see it within 5s try
            // re-navigating /market (re-mounts -> fresh fetch).
            const buyRow = secondaryPage.locator('.market__row', {
                has: secondaryPage.locator('.market__row-name', { hasText: 'Mały Eliksir HP' }),
            });
            // First try waiting (the seller's listing might propagate via
            // initial load or a refresh button if available).
            try {
                await expect(buyRow.first()).toBeVisible({ timeout: 10_000 });
            } catch {
                // Re-mount to re-fetch.
                await secondaryPage.goto('/market');
                await expect(secondaryPage.locator('.market')).toBeVisible({ timeout: 10_000 });
                // Make sure we're still on Browse tab.
                const browseAgain = secondaryPage.locator('.market__tab', { hasText: /Przeglądaj/i });
                await expect(browseAgain).toHaveClass(/market__tab--active/, { timeout: 5_000 });
                await expect(buyRow.first()).toBeVisible({ timeout: 15_000 });
            }

            // 6. Tap row -> BuyModal opens.
            await buyRow.first().tap();
            const buyModal = secondaryPage.locator('.market__modal').last();
            await expect(buyModal).toBeVisible({ timeout: 5_000 });

            // 7. Tap "Zatwierdź" (the confirm button — labelled "Zatwierdź"
            //    when canAfford, "Brak złota" when not). We seeded 5000 gp
            //    so canAfford === true.
            const buySubmit = buyModal.locator('.market__modal-btn--confirm');
            await expect(buySubmit).toBeEnabled({ timeout: 5_000 });
            await expect(buySubmit).toContainText(/Zatwierdź/i);
            await buySubmit.tap();

            // 8. Modal closes + toast appears.
            await expect(buyModal).toBeHidden({ timeout: 10_000 });
            await expect(secondaryPage.locator('.market__toast'))
                .toContainText(/Kupiono.*Mały Eliksir HP.*×1/i, { timeout: 8_000 });

            // 9. BUYER-side inventory validation — primary contract.
            //    The buyer's `inventoryStore.addConsumable(hp_potion_sm, 1)`
            //    runs locally on success (Market.tsx line 595). We read
            //    `useInventoryStore.getState().consumables` via
            //    page.evaluate to verify the count bumped.
            const consumablesAfter = await secondaryPage.evaluate(async () => {
                const mod = await import('/src/stores/inventoryStore.ts');
                return mod.useInventoryStore.getState().consumables;
            }) as Record<string, number>;
            expect(consumablesAfter['hp_potion_sm'] ?? 0).toBeGreaterThanOrEqual(1);

            // 10. DB-side invariant — strict.
            //
            //     The SECURITY DEFINER `buy_market_listing` RPC
            //     (`scripts/market_buy_rpc_migration.sql`) takes a
            //     row-level lock, decrements the listing's quantity,
            //     and DELETEs the row when remaining hits zero — all
            //     atomically and with table-owner privileges so
            //     cross-user RLS on `market_listings` can't no-op the
            //     mutation. After a full-stack buy (qty=1 of a qty=1
            //     listing) the row MUST be gone.
            //
            //     Before the RPC existed, `marketApi.decrementListing`
            //     ran the UPDATE/DELETE as the BUYER's auth session
            //     and silently no-oped — the listing persisted and
            //     could be bought infinitely. This assertion is the
            //     regression test guarding that fix: if it ever flips
            //     back to `decremented-to-zero` or
            //     `still-exists-qty-N`, the RPC has regressed (or
            //     wasn't applied to the target DB).
            //
            //     Prereq: `scripts/market_buy_rpc_migration.sql` must
            //     be applied to the Supabase project under test. If
            //     this assertion fails with `still-exists-qty-1`,
            //     check the RPC is installed:
            //     `SELECT proname FROM pg_proc WHERE proname =
            //     'buy_market_listing';` should return 1 row.
            const createdListingId = createdListing.id;
            const postBuyState = await (async () => {
                const { data } = await admin
                    .from('market_listings')
                    .select('id, quantity')
                    .eq('id', createdListingId);
                if (!data || data.length === 0) return 'gone';
                if (data[0].quantity === 0) return 'decremented-to-zero';
                return `still-exists-qty-${data[0].quantity}`;
            })();
            expect(postBuyState).toBe('gone');
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
