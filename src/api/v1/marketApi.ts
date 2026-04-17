import { supabase } from '../../lib/supabase';
import type { IMarketListing } from '../../systems/marketSystem';

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
    createListing: async (listing: Omit<IMarketListing, 'id' | 'listedAt'>): Promise<IMarketListing> => {
        const { data, error } = await supabase
            .from('market_listings')
            .insert({
                seller_id: listing.sellerId,
                seller_name: listing.sellerName,
                item_id: listing.itemId,
                item_name: listing.itemName,
                item_level: listing.itemLevel,
                rarity: listing.rarity,
                slot: listing.slot,
                price: listing.price,
                bonuses: listing.bonuses,
                upgrade_level: listing.upgradeLevel,
            })
            .select()
            .single();

        if (error) throw error;
        return mapDbToListing(data);
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
};

/** Map Supabase row to IMarketListing */
const mapDbToListing = (row: Record<string, unknown>): IMarketListing => ({
    id: row.id as string,
    sellerId: row.seller_id as string,
    sellerName: row.seller_name as string,
    itemId: row.item_id as string,
    itemName: row.item_name as string,
    itemLevel: (row.item_level as number) ?? 1,
    rarity: row.rarity as IMarketListing['rarity'],
    slot: row.slot as string,
    price: row.price as number,
    bonuses: (row.bonuses as Record<string, number>) ?? {},
    upgradeLevel: (row.upgrade_level as number) ?? 0,
    listedAt: row.listed_at as string,
});
