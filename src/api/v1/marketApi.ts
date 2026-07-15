import { supabase } from '../../lib/supabase';
import type {
    IMarketListing,
    IMarketSaleNotification,
    MarketKind,
} from '../../systems/marketSystem';
import { cachedRead, invalidateQueryCache } from '../../lib/queryCache';

const MARKET_LISTINGS_TTL_MS = 30_000;
const invalidateMarketCache = (): void => invalidateQueryCache((k) => k.startsWith('market:'));


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
        quantityPurchased: number;
        remainingQty: number;
    }
    | {
        ok: false;
        reason: string;
        error?: string;
    };

export const marketApi = {
    getListings: async (): Promise<IMarketListing[]> => {
        return cachedRead('market:listings', MARKET_LISTINGS_TTL_MS, async () => {
            const { data, error } = await supabase
                .from('market_listings')
                .select('*')
                .order('listed_at', { ascending: false })
                .limit(500);

            if (error) throw error;
            return (data ?? []).map(mapDbToListing);
        });
    },

    getMyListings: async (sellerId: string): Promise<IMarketListing[]> => {
        const { data, error } = await supabase
            .from('market_listings')
            .select('*')
            .eq('seller_id', sellerId)
            .order('listed_at', { ascending: false });

        if (error) throw error;
        return (data ?? []).map(mapDbToListing);
    },

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
        invalidateMarketCache();
        return mapDbToListing(data);
    },

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
        invalidateMarketCache();
        return data ? mapDbToListing(data) : null;
    },

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
            const code = (error as { code?: string }).code;
            if (code === 'PGRST202') {
                return { ok: false, reason: 'rpc_missing', error: error.message };
            }
            return { ok: false, reason: 'rpc_error', error: error.message };
        }
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
        invalidateMarketCache();
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
            quantityPurchased: (row.quantity_purchased as number) ?? qty,
            remainingQty: (row.remaining_qty as number) ?? 0,
        };
    },

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
            invalidateMarketCache();
            return mapDbToListing({ ...current, quantity: 0 });
        }
        const { data: updated, error: updErr } = await supabase
            .from('market_listings')
            .update({ quantity: remaining })
            .eq('id', listingId)
            .select()
            .single();
        if (updErr) throw updErr;
        invalidateMarketCache();
        return updated ? mapDbToListing(updated) : null;
    },

    deleteListing: async (listingId: string): Promise<void> => {
        const { error } = await supabase
            .from('market_listings')
            .delete()
            .eq('id', listingId);

        if (error) throw error;
        invalidateMarketCache();
    },

    getListing: async (listingId: string): Promise<IMarketListing | null> => {
        const { data, error } = await supabase
            .from('market_listings')
            .select('*')
            .eq('id', listingId)
            .maybeSingle();

        if (error) throw error;
        return data ? mapDbToListing(data) : null;
    },

    getSaleNotifications: async (sellerId: string): Promise<IMarketSaleNotification[]> => {
        const { data, error } = await supabase
            .from('market_sale_notifications')
            .select('*')
            .eq('seller_id', sellerId)
            .eq('seen', false)
            .order('sold_at', { ascending: false });
        if (error) {
            return [];
        }
        return (data ?? []).map(mapDbToSale);
    },

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
        }
    },

    dismissSaleNotification: async (notificationId: string): Promise<void> => {
        try {
            await supabase
                .from('market_sale_notifications')
                .update({ seen: true })
                .eq('id', notificationId);
        } catch {
        }
    },
};

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
