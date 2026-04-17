import { create } from 'zustand';
import { marketApi } from '../api/v1/marketApi';
import {
    isValidPrice,
    type IMarketListing,
} from '../systems/marketSystem';

interface IMarketState {
    /** All market listings (fetched from Supabase) */
    listings: IMarketListing[];
    /** Player's own listings */
    myListings: IMarketListing[];
    /** Loading state */
    isLoading: boolean;
    /** Error message */
    error: string | null;
}

interface IMarketStore extends IMarketState {
    /** Fetch all listings from Supabase */
    fetchListings: () => Promise<void>;
    /** Fetch only my listings from Supabase */
    fetchMyListings: (sellerId: string) => Promise<void>;
    /** List an item for sale (writes to Supabase) */
    listItem: (listing: Omit<IMarketListing, 'id' | 'listedAt'>) => Promise<string | null>;
    /** Cancel a listing (deletes from Supabase, returns listing data) */
    cancelListing: (listingId: string) => Promise<IMarketListing | null>;
    /** Buy a listing (deletes from Supabase, returns listing data) */
    buyListing: (listingId: string) => Promise<IMarketListing | null>;
    /** Clear error */
    clearError: () => void;
}

const INITIAL_STATE: IMarketState = {
    listings: [],
    myListings: [],
    isLoading: false,
    error: null,
};

export const useMarketStore = create<IMarketStore>()((set, get) => ({
    ...INITIAL_STATE,

    fetchListings: async () => {
        set({ isLoading: true, error: null });
        try {
            const listings = await marketApi.getListings();
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

    listItem: async (listing) => {
        if (!isValidPrice(listing.price)) return null;

        set({ isLoading: true, error: null });
        try {
            const created = await marketApi.createListing(listing);
            set((state) => ({
                listings: [created, ...state.listings],
                myListings: [created, ...state.myListings],
                isLoading: false,
            }));
            return created.id;
        } catch {
            set({ isLoading: false, error: 'Nie udalo sie wystawic przedmiotu' });
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

    buyListing: async (listingId) => {
        set({ isLoading: true, error: null });
        try {
            // Verify listing still exists before buying
            const listing = await marketApi.getListing(listingId);
            if (!listing) {
                set({ isLoading: false, error: 'Oferta juz nie istnieje' });
                return null;
            }

            // Delete listing from Supabase (simulates purchase)
            await marketApi.deleteListing(listingId);

            set((state) => ({
                listings: state.listings.filter((l) => l.id !== listingId),
                myListings: state.myListings.filter((l) => l.id !== listingId),
                isLoading: false,
            }));

            return listing;
        } catch {
            set({ isLoading: false, error: 'Nie udalo sie kupic przedmiotu' });
            return null;
        }
    },

    clearError: () => set({ error: null }),
}));
