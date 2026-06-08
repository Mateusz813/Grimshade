/**
 * Atomic E2E — Market: create listing (sell a consumable stack).
 *
 * Spec (BACKLOG 5.6): "Market: wystaw ofertę". Verifies the full sell
 * happy path:
 *   1. Pre-seed a player with a stackable consumable.
 *   2. Open Market → Sprzedaj tab → tap the consumable tile.
 *   3. Fill price + tap Wystaw.
 *   4. Verify: My listings (Sprzedaż) tab now has the row + the
 *      inventory consumable count decreased by `qty`.
 *
 * Source path (production):
 *   Market.tsx tab='sell' → renders `.market__sell-tile` per sellable
 *     stack (consumables / stones / arena points / bag equipment).
 *   onClick → setSellTarget(tile) → opens `<SellModal>` (line 1289).
 *   SellModal → user fills qty (consumable max picker default = 1) +
 *     priceStr → tap "Wystaw" (line 1386) → calls onConfirm(price, qty).
 *   handleConfirmSell (line 652) → listItem({...}) via marketStore → on
 *     success: setTab('my') + showToast("Wystawiono: ...") and the
 *     escrow `inv.addConsumable(consumableId, -qty)` already deducted
 *     stock pre-listing (line 703).
 *
 * ## Stackable kind chosen: potion (hp_potion_sm)
 *
 * Stackable consumables are simpler than bag equipment for this contract
 * test:
 *   • `isStackKind('potion')` = true (marketSystem.ts line 174), so the
 *     sell modal renders a quantity picker (one explicit "qty = 1" tap
 *     ramp before pricing).
 *   • Inventory tile renders with kind='potion' → no rarity reroll math
 *     to set up.
 *   • Price floor = 1 (isValidPrice line 153 — Number.isInteger ≥ 1).
 *
 * MIN_PRICE: 1 gp (isValidPrice). We list for 100 gp / unit, qty=1.
 *
 * ## Why SECONDARY account
 *
 * Suite runs concurrent on primary. Secondary slot is free per task
 * directive.
 *
 * ## Setup
 *
 *  1. Seed Knight lvl 25 on SECONDARY (any level — market access is
 *     not level-gated; lvl 25 matches sibling test conventions).
 *  2. Seed `consumables: { hp_potion_sm: 5 }` — enough to verify
 *     decrement and still leave 4 in inventory post-listing.
 *
 * ## Flow + assertions
 *
 *  1. Login → pick character → Town.
 *  2. /market → wait for `.market` view.
 *  3. Tap "Sprzedaj" tab → tab becomes active.
 *  4. Find the hp_potion_sm sell-tile by name "Mały Eliksir HP" (the
 *     ELIXIRS table maps hp_potion_sm → name_pl 'Mały Eliksir HP').
 *  5. Tap tile → SellModal opens (`.market__modal` visible).
 *  6. Type price '100' into the price input.
 *  7. Tap "Wystaw" → modal closes → tab auto-switches to 'my'
 *     (handleConfirmSell line 720) → toast "Wystawiono: ..." appears.
 *  8. Verify: row visible under `.market__row` filtered by the item
 *     name, price formatted (formatGoldShort(100) = "100").
 *  9. Verify: DB-side via service_role — `market_listings` has 1 row
 *     for this seller with itemId=hp_potion_sm, price=100, quantity=1.
 * 10. Cleanup deletes the row via cleanupCharacterById (market_listings
 *     is in CHARACTER_CHILD_TABLES under seller_id, cleanup.ts line 95).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedConsumables } from '../../fixtures/seedInventory';
import { getAdminClient } from '../../fixtures/adminClient';

test.describe('City › Market', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('list 1× Mały Eliksir HP for 100g shows row in My listings + decrements consumable + writes market_listings row', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight on SECONDARY.
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed 5× hp_potion_sm — enough to verify decrement leaving
            //    a remainder (catches off-by-one bugs where we accidentally
            //    drain the whole stack).
            await seedConsumables({
                characterId: created.id,
                counts: { hp_potion_sm: 5 },
            });

            // 3. Login → pick character → Town.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 4. /market — Market.tsx is gated by OnlineOnlyGuard but
            //    primary online mode is default fresh boot so it loads.
            await page.goto('/market');
            await expect(page.locator('.market')).toBeVisible({ timeout: 15_000 });

            // 5. Tap "Sprzedawaj" tab. Tab buttons render via Market.tsx
            //    line 799-822 — three buttons: Przeglądaj / Sprzedawaj /
            //    Moje, keyed by `market__tab` with `--active` modifier on
            //    current.
            const sellTab = page.locator('.market__tab', { hasText: /^Sprzedawaj$/i });
            await expect(sellTab).toBeVisible({ timeout: 5_000 });
            await sellTab.tap();
            await expect(sellTab).toHaveClass(/market__tab--active/);

            // 6. Find the hp_potion_sm sell-tile by name.
            //    consumableName('hp_potion_sm') = 'Mały Eliksir HP' per
            //    ELIXIRS table in shopStore — Market.tsx line 122 resolves
            //    via that table → consumableName helper line 482.
            //    Anchor on `.market__sell-tile-name` to match the tile by
            //    its rendered name string (avoid grabbing the tile by a
            //    secondary text element like the count badge).
            const sellTile = page.locator('.market__sell-tile', {
                has: page.locator('.market__sell-tile-name', { hasText: 'Mały Eliksir HP' }),
            });
            await expect(sellTile).toBeVisible({ timeout: 10_000 });

            // Sanity — qty badge shows ×5 (Market.tsx line 968-970).
            await expect(sellTile.locator('.market__sell-tile-qty')).toContainText('×5');

            // 7. Tap tile → opens SellModal.
            await sellTile.tap();
            const modal = page.locator('.market__modal').last();
            await expect(modal).toBeVisible({ timeout: 5_000 });

            // 8. Fill price = 100. SellModal has 1-2 number inputs:
            //    if stackable then `Ilość` + `Cena za sztukę`. Default qty=1
            //    (Market.tsx line 1291) so we only need to set price.
            //    Anchor on the second number input (price always last).
            const priceInput = modal.locator('input[type="number"]').last();
            await priceInput.fill('100');

            // 9. Tap Wystaw.
            const submitBtn = modal.locator('.market__modal-btn--confirm');
            await expect(submitBtn).toBeEnabled({ timeout: 3_000 });
            await submitBtn.tap();

            // 10. Modal closes + toast appears + tab auto-switches to 'my'
            //     (Market.tsx line 720-721). Toast text from line 721 is
            //     `Wystawiono: ${sellTarget.name} ×${qty}`.
            await expect(modal).toBeHidden({ timeout: 8_000 });
            await expect(page.locator('.market__toast'))
                .toContainText(/Wystawiono.*Mały Eliksir HP.*×1/i, { timeout: 5_000 });

            // 11. "Moje" (my listings) tab is now active.
            const myTab = page.locator('.market__tab', { hasText: /^Moje/i });
            await expect(myTab).toHaveClass(/market__tab--active/, { timeout: 5_000 });

            // 12. Listing row visible under My listings — `.market__row`
            //     filtered by the item name. PAGE_SIZE is 50 so a single
            //     listing is always on page 1.
            const myRow = page.locator('.market__row', {
                has: page.locator('.market__row-name', { hasText: 'Mały Eliksir HP' }),
            });
            await expect(myRow).toBeVisible({ timeout: 10_000 });
            // CTA label on my-tab rows = "Edytuj" (Market.tsx line 1155).
            await expect(myRow.locator('.market__row-cta')).toContainText(/Edytuj/i);

            // 13. DB-side validation — listing row materialised via
            //     service_role. Anchor by seller_id (own character) + itemId
            //     to ignore other test runs' leftovers.
            const admin = getAdminClient();
            const { data: dbRow, error: dbErr } = await admin
                .from('market_listings')
                .select('id, price, quantity, item_id, kind')
                .eq('seller_id', created.id)
                .eq('item_id', 'hp_potion_sm')
                .single();
            if (dbErr) throw new Error(`[test 5.6] market_listings select failed: ${dbErr.message}`);
            expect(dbRow.price).toBe(100);
            expect(dbRow.quantity).toBe(1);
            expect(dbRow.kind).toBe('potion');
        } finally {
            if (createdId) {
                // cleanup.ts wipes market_listings via seller_id key
                // (CHARACTER_CHILD_TABLES line 95).
                await cleanupCharacterById(createdId);
            }
        }
    });
});
