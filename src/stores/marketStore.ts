import { create } from 'zustand';
import { marketApi } from '../api/v1/marketApi';
import {
    isValidPrice,
    isValidQuantity,
    type IMarketListing,
    type IMarketSaleNotification,
} from '../systems/marketSystem';

/**
 * 2026-05-08 v2: Market store overhaul.
 *
 *  • Listings now carry a `quantity` (and `quantityInitial`) so the same
 *    row can serve multiple partial buyers.
 *  • `buyListing(id, qty)` decrements the row and returns the slice
 *    that was sold; the caller handles inventory + gold.
 *  • Sale notifications surface as a separate slice so the Browse tab
 *    can show a glowing notification button when someone bought one
 *    of the player's listings.
 */

interface IMarketState {
    listings: IMarketListing[];
    myListings: IMarketListing[];
    /** Unseen sale notifications for the current player. */
    saleNotifications: IMarketSaleNotification[];
    isLoading: boolean;
    error: string | null;
}

interface IBuyResult {
    /** The (snapshot of the) listing that was bought. */
    listing: IMarketListing;
    /** Quantity actually transferred (could equal listing.quantity for full buy). */
    quantity: number;
    /** Total gold the buyer paid (price × quantity). */
    totalPaid: number;
}

interface IMarketStore extends IMarketState {
    fetchListings: () => Promise<void>;
    fetchMyListings: (sellerId: string) => Promise<void>;
    fetchSaleNotifications: (sellerId: string) => Promise<void>;
    listItem: (
        listing: Omit<IMarketListing, 'id' | 'listedAt'>,
    ) => Promise<string | null>;
    /** Edit price (and/or remaining qty) of one of the seller's own listings. */
    editListing: (
        listingId: string,
        patch: { price?: number; quantity?: number },
    ) => Promise<IMarketListing | null>;
    /** Cancel listing — caller is responsible for returning the item to bag. */
    cancelListing: (listingId: string) => Promise<IMarketListing | null>;
    /** Buy `qty` units of a listing. Returns metadata so the caller can
     *  push the item(s) into inventory and deduct gold. */
    buyListing: (listingId: string, qty: number) => Promise<IBuyResult | null>;
    dismissNotification: (id: string) => Promise<void>;
    clearError: () => void;
}

const INITIAL_STATE: IMarketState = {
    listings: [],
    myListings: [],
    saleNotifications: [],
    isLoading: false,
    error: null,
};

export const useMarketStore = create<IMarketStore>()((set, get) => ({
    ...INITIAL_STATE,

    fetchListings: async () => {
        // 2026-05-08: don't gate the WHOLE view on this fetch. Only flip
        // isLoading: true when an ACTIVE refetch is requested mid-session
        // — the initial mount silently populates the list. Hard 8s timeout
        // ensures a hanging supabase call (offline, missing env, etc.)
        // can never pin the global spinner forever.
        const wasEmpty = get().listings.length === 0;
        if (!wasEmpty) set({ isLoading: true, error: null });
        try {
            const listings = await Promise.race([
                marketApi.getListings(),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 8000)),
            ]);
            set({ listings, isLoading: false });
        } catch {
            set({ isLoading: false, error: 'Nie udalo sie zaladowac ofert' });
        }
    },

    fetchMyListings: async (sellerId) => {
        try {
            const myListings = await marketApi.getMyListings(sellerId);
            set({ myListings });
        } catch {
            // silently fail – myListings from fetchListings as fallback
        }
    },

    fetchSaleNotifications: async (sellerId) => {
        try {
            const saleNotifications = await marketApi.getSaleNotifications(sellerId);
            set({ saleNotifications });
        } catch {
            // best-effort — table may not exist yet pre-migration.
        }
    },

    listItem: async (listing) => {
        if (!isValidPrice(listing.price)) return null;
        if (!isValidQuantity(listing.quantity)) return null;
        if (!isValidQuantity(listing.quantityInitial)) return null;

        set({ isLoading: true, error: null });
        try {
            const created = await marketApi.createListing(listing);
            set((state) => ({
                listings: [created, ...state.listings],
                myListings: [created, ...state.myListings],
                isLoading: false,
            }));
            return created.id;
        } catch (e) {
            const msg = (e as { message?: string })?.message;
            set({ isLoading: false, error: msg ? `Nie udało się wystawić: ${msg}` : 'Nie udało się wystawić przedmiotu' });
            return null;
        }
    },

    editListing: async (listingId, patch) => {
        const { myListings, listings } = get();
        const cur = myListings.find((l) => l.id === listingId);
        if (!cur) return null;
        if (patch.price !== undefined && !isValidPrice(patch.price)) return null;
        if (patch.quantity !== undefined && !isValidQuantity(patch.quantity)) return null;
        try {
            const updated = await marketApi.updateListing(listingId, patch);
            if (!updated) return null;
            set({
                listings: listings.map((l) => (l.id === listingId ? updated : l)),
                myListings: myListings.map((l) => (l.id === listingId ? updated : l)),
            });
            return updated;
        } catch {
            set({ error: 'Nie udalo sie zaktualizowac oferty' });
            return null;
        }
    },

    cancelListing: async (listingId) => {
        const { myListings, listings } = get();
        const listing = myListings.find((l) => l.id === listingId);
        if (!listing) return null;

        try {
            await marketApi.deleteListing(listingId);
            set({
                listings: listings.filter((l) => l.id !== listingId),
                myListings: myListings.filter((l) => l.id !== listingId),
            });
            return listing;
        } catch {
            set({ error: 'Nie udalo sie wycofac oferty' });
            return null;
        }
    },

    buyListing: async (listingId, qty) => {
        if (!isValidQuantity(qty)) return null;
        set({ isLoading: true, error: null });
        try {
            // Verify listing still exists + has enough remaining qty.
            const listing = await marketApi.getListing(listingId);
            if (!listing) {
                set({ isLoading: false, error: 'Oferta już nie istnieje' });
                return null;
            }
            if (qty > listing.quantity) {
                set({ isLoading: false, error: 'Nie ma już tylu sztuk na ofercie' });
                return null;
            }
            const totalPaid = listing.price * qty;
            // Decrement (or delete when stack hits 0).
            const after = await marketApi.decrementListing(listingId, qty);
            // Refresh local copy of all listings — easier than splicing.
            set((state) => ({
                listings: after && after.quantity > 0
                    ? state.listings.map((l) => (l.id === listingId ? after : l))
                    : state.listings.filter((l) => l.id !== listingId),
                myListings: after && after.quantity > 0
                    ? state.myListings.map((l) => (l.id === listingId ? after : l))
                    : state.myListings.filter((l) => l.id !== listingId),
                isLoading: false,
            }));
            // Best-effort sale notification for the seller (visible next
            // time they open the market).
            void marketApi.createSaleNotification({
                sellerId: listing.sellerId,
                itemId: listing.itemId,
                itemName: listing.itemName,
                rarity: listing.rarity,
                quantitySold: qty,
                goldReceived: totalPaid,
            });
            return { listing, quantity: qty, totalPaid };
        } catch (e) {
            // Surface the raw Supabase error so the player sees WHY.
            // Most common cause is RLS denying DELETE/UPDATE on rows
            // owned by another user — fix is a permissive market_listings
            // policy or a server-side RPC.
            const msg = (e as { message?: string })?.message;
            set({
                isLoading: false,
                error: msg ? `Nie udało się kupić: ${msg}` : 'Nie udało się kupić przedmiotu',
            });
            return null;
        }
    },

    dismissNotification: async (id) => {
        await marketApi.dismissSaleNotification(id);
        set((state) => ({
            saleNotifications: state.saleNotifications.filter((n) => n.id !== id),
        }));
    },

    clearError: () => set({ error: null }),
}));
