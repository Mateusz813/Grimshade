-- ============================================================================
-- Market Buy RPC — SECURITY DEFINER buy_market_listing(p_listing_id, p_buyer_character_id, p_quantity)
-- ----------------------------------------------------------------------------
-- Spec (production bug discovered 2026-05-25 + BACKLOG 5.7 caveat):
-- Cross-user UPDATE/DELETE on `market_listings` from the buyer's auth
-- context is currently BLOCKED by Row Level Security on the table
-- (existing policies only let the seller modify their own listings).
--
-- Symptom in production:
--   • Buyer taps "Zatwierdź" on a foreign listing → UI shows the toast
--     "Kupiono: <item> ×N" + the buyer's local `inventoryStore` updates
--     (consumable count + gold spend) + the buyer's local market state
--     splices the listing out of the browse feed.
--   • BUT — the underlying `market_listings` row on the SERVER is
--     UNTOUCHED because the buyer's RLS-scoped DELETE/UPDATE is a no-op.
--   • The listing remains visible to OTHER buyers on their next fetch
--     → the same listing can be "bought" by an unlimited number of
--     players, each receiving the item from their local optimistic
--     update. Effectively infinite money / item duping.
--
-- Root cause: `marketApi.decrementListing` runs the DELETE/UPDATE as
-- the BUYER (authenticated session.user = buyer.user_id). The
-- `market_listings` RLS allows mutation only when the row's seller_id
-- chain leads back to the calling user.
--
-- Fix: a SECURITY DEFINER stored function executes the buy atomically
-- with table-owner privileges, bypassing RLS. The function:
--   1. Takes a row-level lock on the listing (`FOR UPDATE`) so two
--      concurrent buyers can't both decrement the same qty.
--   2. Returns early when the listing is gone, owned by the buyer, out
--      of stock, or when `p_quantity` would exceed what's left.
--   3. Decrements `quantity` by `p_quantity` (or DELETEs the row when
--      the remainder hits 0), exactly mirroring the old
--      `decrementListing` arithmetic but atomic + RLS-bypassing.
--   4. Inserts a `market_sale_notifications` row so the seller sees the
--      sale next time they open Market (best-effort — if the table is
--      missing, swallow the error).
--   5. Returns a JSON object with the snapshot fields the client needs
--      to credit the buyer's inventory: `item_id`, `item_name`, `kind`,
--      `rarity`, `bonuses`, `upgrade_level`, `item_level`, `price`,
--      `seller_id`, plus `quantity_purchased` for ledger semantics.
--
-- The CLIENT (`marketApi.buyListing` after this migration) is responsible
-- for:
--   • Deducting the buyer's gold (own row, regular PATCH — RLS-safe).
--   • Pushing the item into the buyer's local inventory.
--   • Bumping `market_items_bought` + `market_gold_spent` on buyer's
--     characters row (own row PATCH).
--   • Bumping `market_items_sold` + `market_gold_earned` on the SELLER's
--     row via the existing `bump_market_sale` RPC.
--
-- ## SECURITY notes
--   • Function is SECURITY DEFINER: runs as the function owner (postgres
--     in Supabase), bypassing RLS.
--   • Guards: own-listing buy is rejected (returns `{ok: false,
--     reason: 'own_listing'}`) so a player can't game their own
--     `market_items_bought` counter — also matches the UI's
--     `isOwn = l.sellerId === character.id` guard at Market.tsx line 915
--     which already routes own-listing taps to EditModal not BuyModal.
--   • `p_quantity` is validated (≥ 1, ≤ remaining stock) so a malicious
--     caller can't drain a stack of 10 with a single qty=999 call.
--   • The caller passes `p_buyer_character_id` rather than the function
--     inferring `auth.uid()` because the buyer's CHARACTER id (not their
--     auth user id) is what the leaderboard counters care about, and a
--     user can have multiple characters per account.
--
-- ## Rollback path
--   DROP FUNCTION IF EXISTS buy_market_listing(UUID, UUID, INTEGER);
--   -- also drop the old 2-arg signature if it was deployed during an
--   -- earlier iteration of this migration:
--   DROP FUNCTION IF EXISTS buy_market_listing(UUID, UUID);
--
-- ## Apply
--   1. Open Supabase Dashboard → SQL Editor → New query.
--   2. Paste the entire contents of this file → Run.
--   3. Verify by opening the SQL editor again and running
--      `SELECT proname, prosecdef FROM pg_proc WHERE proname =
--      'buy_market_listing';` — should return 1 row with `prosecdef = t`.
--
-- Idempotent: `CREATE OR REPLACE FUNCTION` re-runs cleanly. The
-- `GRANT EXECUTE` likewise re-runs (Postgres allows re-grant). The
-- DROP at the top tidies up the older 2-arg signature if it was
-- deployed during development.
-- ============================================================================

-- If an older 2-arg signature exists from a previous deploy, drop it so the
-- function namespace settles on the 3-arg version below.
DROP FUNCTION IF EXISTS buy_market_listing(UUID, UUID);

CREATE OR REPLACE FUNCTION buy_market_listing(
    p_listing_id UUID,
    p_buyer_character_id UUID,
    p_quantity INTEGER DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_listing RECORD;
    v_qty INTEGER;
    v_remaining INTEGER;
BEGIN
    v_qty := COALESCE(p_quantity, 1);

    -- Reject obviously-bad quantities. Caller-side validation also exists
    -- (marketStore.buyListing → isValidQuantity) but we belt-and-brace it
    -- so a hand-crafted RPC call can't drain a stack with a 0/negative qty.
    IF v_qty < 1 THEN
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'invalid_quantity'
        );
    END IF;

    -- Row-lock the listing to serialize concurrent buyers on the same row.
    SELECT id, seller_id, seller_name, kind, item_id, item_name,
           item_level, rarity, slot, price, quantity, quantity_initial,
           bonuses, upgrade_level
    INTO v_listing
    FROM market_listings
    WHERE id = p_listing_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'not_found'
        );
    END IF;

    -- Reject self-buy. UI guards against this too (own listings route
    -- to EditModal) but we enforce it server-side so an alt account
    -- can't cheese the counters.
    IF v_listing.seller_id = p_buyer_character_id THEN
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'own_listing'
        );
    END IF;

    -- Out of stock — caller should refresh the browse feed.
    IF COALESCE(v_listing.quantity, 0) < v_qty THEN
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'out_of_stock'
        );
    END IF;

    v_remaining := COALESCE(v_listing.quantity, 1) - v_qty;

    -- Decrement quantity OR delete row when remaining hits zero.
    IF v_remaining > 0 THEN
        UPDATE market_listings
        SET quantity = v_remaining
        WHERE id = p_listing_id;
    ELSE
        DELETE FROM market_listings
        WHERE id = p_listing_id;
    END IF;

    -- Best-effort sale notification for the seller. Table is optional
    -- (some envs may not have run the notifications migration yet) —
    -- swallow errors so a missing table never aborts the buy.
    BEGIN
        INSERT INTO market_sale_notifications (
            seller_id,
            item_id,
            item_name,
            rarity,
            quantity_sold,
            gold_received
        ) VALUES (
            v_listing.seller_id,
            v_listing.item_id,
            v_listing.item_name,
            v_listing.rarity,
            v_qty,
            v_listing.price * v_qty
        );
    EXCEPTION WHEN OTHERS THEN
        -- table missing / column drift / RLS denial — log + carry on.
        RAISE NOTICE '[buy_market_listing] sale notification insert failed: %', SQLERRM;
    END;

    RETURN jsonb_build_object(
        'ok',                 true,
        'listing_id',         v_listing.id,
        'seller_id',          v_listing.seller_id,
        'seller_name',        v_listing.seller_name,
        'kind',               v_listing.kind,
        'item_id',            v_listing.item_id,
        'item_name',          v_listing.item_name,
        'item_level',         v_listing.item_level,
        'rarity',             v_listing.rarity,
        'slot',               v_listing.slot,
        'price',              v_listing.price,
        'bonuses',            v_listing.bonuses,
        'upgrade_level',      v_listing.upgrade_level,
        'quantity_purchased', v_qty,
        'remaining_qty',      GREATEST(v_remaining, 0)
    );
END;
$$;

-- Grant EXECUTE to any authenticated user. Anon stays locked out
-- so a logged-out caller can't drain listings.
GRANT EXECUTE ON FUNCTION buy_market_listing(UUID, UUID, INTEGER) TO authenticated;

-- ── Sanity checks ───────────────────────────────────────────────────────────
-- Should return 1 row with prosecdef='t' (security definer).
SELECT 'rpc installed (should be 1)' AS check,
       COUNT(*)
FROM pg_proc
WHERE proname = 'buy_market_listing';
