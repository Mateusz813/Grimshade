import { supabase } from '../../lib/supabase';
import type {
    IMarketListing,
    IMarketSaleNotification,
    MarketKind,
} from '../../systems/marketSystem';

/**
 * 2026-05-08 v2: extended for stack-kind listings (potion/elixir/stone/AP)
 * and sale notifications.
 *
 * 2026-05-25 v3: introduced server-side `buyListing` via the
 * `buy_market_listing` SECURITY DEFINER RPC. Previously
 * `marketStore.buyListing` chained
 * `getListing()` + `decrementListing()` — the latter ran an UPDATE/DELETE
 * as the BUYER's auth session, which RLS on `market_listings` silently
 * NO-OPed for cross-user rows. UI showed success but the listing
 * persisted → same listing could be bought infinitely (production bug).
 *
 * The fix: the new `buyListing(p_listing_id, p_buyer_character_id)` RPC
 * (see `scripts/market_buy_rpc_migration.sql`) takes a row-level lock,
 * validates not-self / not-empty, decrements (or deletes) the row, and
 * inserts the sale notification atomically with table-owner privileges.
 * The client only needs to credit the buyer's inventory + gold + bumps
 * locally afterwards.
 *
 * Fallback policy: if the RPC isn't deployed yet (e.g. fresh dev env),
 * `buyListing` returns `{ ok: false, reason: 'rpc_missing' }` and the
 * caller can decide whether to abort or fall back to the legacy
 * `decrementListing` (which the store now does NOT — production bug
 * was bad enough that we'd rather fail loudly than silently lose
 * listing-deletes again).
 *
 * NOTE on schema migration — the new fields (`kind`, `quantity`,
 * `quantity_initial`) and the `market_sale_notifications` table need
 * Supabase migrations to land in production. Until they do:
 *   • SELECT calls fall back to safe defaults (`kind='item'`, qty=1)
 *   • INSERT calls only send the new fields when present, so existing
 *     rows continue to validate
 *   • Sale notification calls return [] / no-op when the table is
 *     missing so the UI degrades gracefully.
 */

/** Buy-RPC result — discriminated union. Mirrors what
 *  `buy_market_listing` returns as `jsonb`. */
export type IMarketBuyRpcResult =
    | {
        ok: true;
        listingId: string;
        sellerId: string;
        sellerName: string;
        kind: MarketKind;
        itemId: string;
        itemName: string;
        itemLevel: number;
        rarity: IMarketListing['rarity'];
        slot: string;
        price: number;
        bonuses: Record<string, number>;
        upgradeLevel: number;
        /** Units transferred to the buyer (== `qty` arg on success). */
        quantityPurchased: number;
        /** Remaining stack size on the listing after this buy. */
        remainingQty: number;
    }
    | {
        ok: false;
        /** `not_found` | `own_listing` | `out_of_stock` | `invalid_quantity` | `rpc_missing` | `rpc_error` */
        reason: string;
        /** Raw error message when transport fails (for surfacing in UI). */
        error?: string;
    };

export const marketApi = {
    /** Fetch all active listings */
    getListings: async (): Promise<IMarketListing[]> => {
        const { data, error } = await supabase
            .from('market_listings')
            .select('*')
            .order('listed_at', { ascending: false });

        if (error) throw error;
        return (data ?? []).map(mapDbToListing);
    },

    /** Fetch listings by seller */
    getMyListings: async (sellerId: string): Promise<IMarketListing[]> => {
        const { data, error } = await supabase
            .from('market_listings')
            .select('*')
            .eq('seller_id', sellerId)
            .order('listed_at', { ascending: false });

        if (error) throw error;
        return (data ?? []).map(mapDbToListing);
    },

    /** Create a new listing */
    createListing: async (
        listing: Omit<IMarketListing, 'id' | 'listedAt'>,
    ): Promise<IMarketListing> => {
        const { data, error } = await supabase
            .from('market_listings')
            .insert({
                seller_id: listing.sellerId,
                seller_name: listing.sellerName,
                kind: listing.kind,
                item_id: listing.itemId,
                item_name: listing.itemName,
                item_level: listing.itemLevel,
                rarity: listing.rarity,
                slot: listing.slot,
                price: listing.price,
                quantity: listing.quantity,
                quantity_initial: listing.quantityInitial,
                bonuses: listing.bonuses,
                upgrade_level: listing.upgradeLevel,
            })
            .select()
            .single();

        if (error) throw error;
        return mapDbToListing(data);
    },

    /** Update a listing — used by the "edit price" path on My Listings. */
    updateListing: async (
        listingId: string,
        patch: Partial<Pick<IMarketListing, 'price' | 'quantity'>>,
    ): Promise<IMarketListing | null> => {
        const update: Record<string, unknown> = {};
        if (patch.price !== undefined) update.price = patch.price;
        if (patch.quantity !== undefined) update.quantity = patch.quantity;
        if (Object.keys(update).length === 0) return null;
        const { data, error } = await supabase
            .from('market_listings')
            .update(update)
            .eq('id', listingId)
            .select()
            .single();
        if (error) throw error;
        return data ? mapDbToListing(data) : null;
    },

    /**
     * Server-side buy via the `buy_market_listing` SECURITY DEFINER RPC.
     * Single source of truth for the buyer-takes-N-units flow —
     * runs atomically (row-lock + decrement-or-delete + sale-notification
     * insert) with table-owner privileges so cross-user RLS on
     * `market_listings` doesn't silently no-op the mutation.
     *
     * Returns a discriminated union. On success, the caller credits the
     * buyer's inventory + gold + bumps locally. On failure with
     * `reason='rpc_missing'`, the RPC hasn't been applied yet
     * (`scripts/market_buy_rpc_migration.sql`) — caller should surface
     * an actionable error.
     */
    buyListing: async (
        listingId: string,
        buyerCharacterId: string,
        qty = 1,
    ): Promise<IMarketBuyRpcResult> => {
        const { data, error } = await supabase.rpc('buy_market_listing', {
            p_listing_id: listingId,
            p_buyer_character_id: buyerCharacterId,
            p_quantity: qty,
        });
        if (error) {
            // PGRST202 = "Could not find the function" → RPC not deployed.
            // Surface a distinct reason so the UI can prompt for migration.
            const code = (error as { code?: string }).code;
            if (code === 'PGRST202') {
                return { ok: false, reason: 'rpc_missing', error: error.message };
            }
            return { ok: false, reason: 'rpc_error', error: error.message };
        }
        // PostgREST returns the JSON body as `data`. When the function
        // returned `ok=false` (own_listing / not_found / out_of_stock)
        // we propagate that, otherwise we hydrate the success shape.
        if (!data || typeof data !== 'object') {
            return { ok: false, reason: 'rpc_error', error: 'empty response' };
        }
        const row = data as Record<string, unknown>;
        if (row.ok !== true) {
            return {
                ok: false,
                reason: (row.reason as string | undefined) ?? 'unknown',
            };
        }
        return {
            ok: true,
            listingId: row.listing_id as string,
            sellerId: row.seller_id as string,
            sellerName: (row.seller_name as string) ?? '',
            kind: ((row.kind as MarketKind | null) ?? 'item'),
            itemId: row.item_id as string,
            itemName: (row.item_name as string) ?? '',
            itemLevel: (row.item_level as number) ?? 1,
            rarity: row.rarity as IMarketListing['rarity'],
            slot: (row.slot as string) ?? '',
            price: row.price as number,
            bonuses: (row.bonuses as Record<string, number>) ?? {},
            upgradeLevel: (row.upgrade_level as number) ?? 0,
            // `quantity_purchased` was added in the 3-arg signature.
            // Pre-3-arg deploys won't return it — fall back to `qty`.
            quantityPurchased: (row.quantity_purchased as number) ?? qty,
            remainingQty: (row.remaining_qty as number) ?? 0,
        };
    },

    /**
     * @deprecated 2026-05-25 — RLS-unsafe for cross-user buys. Kept for
     * the seller-side `cancelListing` path which IS RLS-safe (seller
     * mutating their own row). The buy flow MUST use `buyListing` above.
     *
     * Decrement listing quantity by `qty` (partial buy). When the result
     * hits 0 the listing is deleted so it stops appearing in Browse.
     * Returns the updated row (or null if the row vanished mid-transaction).
     */
    decrementListing: async (
        listingId: string,
        qty: number,
    ): Promise<IMarketListing | null> => {
        const { data: current, error: fetchErr } = await supabase
            .from('market_listings')
            .select('*')
            .eq('id', listingId)
            .maybeSingle();
        if (fetchErr) throw fetchErr;
        if (!current) return null;
        const remaining = ((current.quantity as number | null) ?? 1) - qty;
        if (remaining <= 0) {
            const { error: delErr } = await supabase
                .from('market_listings')
                .delete()
                .eq('id', listingId);
            if (delErr) throw delErr;
            return mapDbToListing({ ...current, quantity: 0 });
        }
        const { data: updated, error: updErr } = await supabase
            .from('market_listings')
            .update({ quantity: remaining })
            .eq('id', listingId)
            .select()
            .single();
        if (updErr) throw updErr;
        return updated ? mapDbToListing(updated) : null;
    },

    /** Delete a listing (cancel or after purchase) */
    deleteListing: async (listingId: string): Promise<void> => {
        const { error } = await supabase
            .from('market_listings')
            .delete()
            .eq('id', listingId);

        if (error) throw error;
    },

    /** Get a single listing by ID (to verify it still exists before buying) */
    getListing: async (listingId: string): Promise<IMarketListing | null> => {
        const { data, error } = await supabase
            .from('market_listings')
            .select('*')
            .eq('id', listingId)
            .maybeSingle();

        if (error) throw error;
        return data ? mapDbToListing(data) : null;
    },

    // ── Sale notifications ────────────────────────────────────────────
    /** Fetch unseen sale notifications for a seller. Best-effort — if
     *  the table doesn't exist yet (pre-migration env), returns []. */
    getSaleNotifications: async (sellerId: string): Promise<IMarketSaleNotification[]> => {
        const { data, error } = await supabase
            .from('market_sale_notifications')
            .select('*')
            .eq('seller_id', sellerId)
            .eq('seen', false)
            .order('sold_at', { ascending: false });
        if (error) {
            // Table missing or RLS denied — log silently and degrade.
            return [];
        }
        return (data ?? []).map(mapDbToSale);
    },

    /** Insert a sale notification. Best-effort — silently swallows
     *  errors so a missing table never blocks the buy flow. */
    createSaleNotification: async (
        n: Omit<IMarketSaleNotification, 'id' | 'soldAt' | 'seen'>,
    ): Promise<void> => {
        try {
            await supabase
                .from('market_sale_notifications')
                .insert({
                    seller_id: n.sellerId,
                    item_id: n.itemId,
                    item_name: n.itemName,
                    rarity: n.rarity,
                    quantity_sold: n.quantitySold,
                    gold_received: n.goldReceived,
                });
        } catch {
            // Pre-migration: ignore.
        }
    },

    /** Mark a single notification as seen (or delete it). */
    dismissSaleNotification: async (notificationId: string): Promise<void> => {
        try {
            await supabase
                .from('market_sale_notifications')
                .update({ seen: true })
                .eq('id', notificationId);
        } catch {
            // Best-effort.
        }
    },
};

/** Map Supabase row to IMarketListing — fills new fields with safe
 *  defaults when the migration hasn't landed (kind='item', qty=1). */
const mapDbToListing = (row: Record<string, unknown>): IMarketListing => {
    const quantity = (row.quantity as number | null) ?? 1;
    const quantityInitial = (row.quantity_initial as number | null) ?? quantity;
    const kind = ((row.kind as MarketKind | null) ?? 'item');
    return {
        id: row.id as string,
        sellerId: row.seller_id as string,
        sellerName: row.seller_name as string,
        kind,
        itemId: row.item_id as string,
        itemName: row.item_name as string,
        itemLevel: (row.item_level as number) ?? 1,
        rarity: row.rarity as IMarketListing['rarity'],
        slot: (row.slot as string) ?? '',
        price: row.price as number,
        quantity,
        quantityInitial,
        bonuses: (row.bonuses as Record<string, number>) ?? {},
        upgradeLevel: (row.upgrade_level as number) ?? 0,
        listedAt: row.listed_at as string,
    };
};

const mapDbToSale = (row: Record<string, unknown>): IMarketSaleNotification => ({
    id: row.id as string,
    sellerId: row.seller_id as string,
    itemId: row.item_id as string,
    itemName: row.item_name as string,
    rarity: row.rarity as IMarketSaleNotification['rarity'],
    quantitySold: (row.quantity_sold as number) ?? 1,
    goldReceived: (row.gold_received as number) ?? 0,
    soldAt: row.sold_at as string,
    seen: (row.seen as boolean) ?? false,
});
