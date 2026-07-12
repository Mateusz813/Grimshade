
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

    IF v_qty < 1 THEN
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'invalid_quantity'
        );
    END IF;

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

    IF v_listing.seller_id = p_buyer_character_id THEN
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'own_listing'
        );
    END IF;

    IF COALESCE(v_listing.quantity, 0) < v_qty THEN
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'out_of_stock'
        );
    END IF;

    v_remaining := COALESCE(v_listing.quantity, 1) - v_qty;

    IF v_remaining > 0 THEN
        UPDATE market_listings
        SET quantity = v_remaining
        WHERE id = p_listing_id;
    ELSE
        DELETE FROM market_listings
        WHERE id = p_listing_id;
    END IF;

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

GRANT EXECUTE ON FUNCTION buy_market_listing(UUID, UUID, INTEGER) TO authenticated;

SELECT 'rpc installed (should be 1)' AS check,
       COUNT(*)
FROM pg_proc
WHERE proname = 'buy_market_listing';
