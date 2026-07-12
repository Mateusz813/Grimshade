import { create } from 'zustand';
import { marketApi } from '../api/v1/marketApi';
import { useCharacterStore } from './characterStore';
import {
    isValidPrice,
    isValidQuantity,
    type IMarketListing,
    type IMarketSaleNotification,
} from '../systems/marketSystem';


interface IMarketState {
    listings: IMarketListing[];
    myListings: IMarketListing[];
    saleNotifications: IMarketSaleNotification[];
    isLoading: boolean;
    error: string | null;
}

interface IBuyResult {
    listing: IMarketListing;
    quantity: number;
    totalPaid: number;
}

interface IMarketStore extends IMarketState {
    fetchListings: () => Promise<void>;
    fetchMyListings: (sellerId: string) => Promise<void>;
    fetchSaleNotifications: (sellerId: string) => Promise<void>;
    listItem: (
        listing: Omit<IMarketListing, 'id' | 'listedAt'>,
    ) => Promise<string | null>;
    editListing: (
        listingId: string,
        patch: { price?: number; quantity?: number },
    ) => Promise<IMarketListing | null>;
    cancelListing: (listingId: string) => Promise<IMarketListing | null>;
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
        }
    },

    fetchSaleNotifications: async (sellerId) => {
        try {
            const saleNotifications = await marketApi.getSaleNotifications(sellerId);
            set({ saleNotifications });
        } catch {
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
        const buyerCharacterId = useCharacterStore.getState().character?.id;
        if (!buyerCharacterId) {
            set({ isLoading: false, error: 'Brak postaci — zaloguj się ponownie.' });
            return null;
        }

        set({ isLoading: true, error: null });
        let result: Awaited<ReturnType<typeof marketApi.buyListing>>;
        try {
            result = await marketApi.buyListing(listingId, buyerCharacterId, qty);
        } catch (e) {
            const msg = (e as { message?: string })?.message;
            set({
                isLoading: false,
                error: msg ? `Nie udało się kupić: ${msg}` : 'Nie udało się kupić przedmiotu',
            });
            return null;
        }

        if (!result.ok) {
            const reason = result.reason;
            const errorMsg =
                reason === 'rpc_missing'
                    ? 'Nie udało się kupić: serwerowa funkcja "buy_market_listing" '
                      + 'nie jest jeszcze zainstalowana. Zastosuj migrację '
                      + 'scripts/market_buy_rpc_migration.sql.'
                    : reason === 'not_found'
                        ? 'Oferta już nie istnieje.'
                        : reason === 'own_listing'
                            ? 'Nie możesz kupić własnej oferty.'
                            : reason === 'out_of_stock'
                                ? 'Oferta już się skończyła.'
                                : reason === 'invalid_quantity'
                                    ? 'Nieprawidłowa ilość.'
                                    : `Nie udało się kupić: ${reason}`;
            set({ isLoading: false, error: errorMsg });
            return null;
        }

        const unitsBought = result.quantityPurchased;
        const listing: IMarketListing = {
            id: result.listingId,
            sellerId: result.sellerId,
            sellerName: result.sellerName,
            kind: result.kind,
            itemId: result.itemId,
            itemName: result.itemName,
            itemLevel: result.itemLevel,
            rarity: result.rarity,
            slot: result.slot,
            price: result.price,
            quantity: result.remainingQty,
            quantityInitial: result.remainingQty + unitsBought,
            bonuses: result.bonuses,
            upgradeLevel: result.upgradeLevel,
            listedAt: '',
        };
        const totalPaid = listing.price * unitsBought;

        set((state) => ({
            listings: result.ok && result.remainingQty > 0
                ? state.listings.map((l) => (l.id === listingId ? { ...l, quantity: result.remainingQty } : l))
                : state.listings.filter((l) => l.id !== listingId),
            myListings: result.ok && result.remainingQty > 0
                ? state.myListings.map((l) => (l.id === listingId ? { ...l, quantity: result.remainingQty } : l))
                : state.myListings.filter((l) => l.id !== listingId),
            isLoading: false,
        }));

        return { listing, quantity: unitsBought, totalPaid };
    },

    dismissNotification: async (id) => {
        await marketApi.dismissSaleNotification(id);
        set((state) => ({
            saleNotifications: state.saleNotifications.filter((n) => n.id !== id),
        }));
    },

    clearError: () => set({ error: null }),
}));
