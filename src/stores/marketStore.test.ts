import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IMarketListing } from '../systems/marketSystem';

// -- Hoisted mocks ------------------------------------------------------------
// marketStore wraps `marketApi` 1:1. Each method is a `vi.fn` we configure per
// test, so no network round-trip and no `setTimeout(8000)` race for the
// fetchListings timeout path.

const {
    getListingsMock,
    getMyListingsMock,
    getSaleNotificationsMock,
    createListingMock,
    updateListingMock,
    deleteListingMock,
    decrementListingMock,
    getListingMock,
    createSaleNotificationMock,
    dismissSaleNotificationMock,
    buyListingMock,
} = vi.hoisted(() => ({
    getListingsMock: vi.fn(),
    getMyListingsMock: vi.fn(),
    getSaleNotificationsMock: vi.fn(),
    createListingMock: vi.fn(),
    updateListingMock: vi.fn(),
    deleteListingMock: vi.fn().mockResolvedValue(undefined),
    decrementListingMock: vi.fn(),
    getListingMock: vi.fn(),
    createSaleNotificationMock: vi.fn().mockResolvedValue(undefined),
    dismissSaleNotificationMock: vi.fn().mockResolvedValue(undefined),
    buyListingMock: vi.fn(),
}));

vi.mock('../api/v1/marketApi', () => ({
    marketApi: {
        getListings: getListingsMock,
        getMyListings: getMyListingsMock,
        getSaleNotifications: getSaleNotificationsMock,
        createListing: createListingMock,
        updateListing: updateListingMock,
        deleteListing: deleteListingMock,
        decrementListing: decrementListingMock,
        getListing: getListingMock,
        createSaleNotification: createSaleNotificationMock,
        dismissSaleNotification: dismissSaleNotificationMock,
        buyListing: buyListingMock,
    },
}));

import { useMarketStore } from './marketStore';
import { useCharacterStore } from './characterStore';

// -- Fixtures -----------------------------------------------------------------

const makeListing = (overrides: Partial<IMarketListing> = {}): IMarketListing => ({
    id: 'ml_1',
    sellerId: 'seller-1',
    sellerName: 'Alice',
    kind: 'item',
    itemId: 'sword',
    itemName: 'Sword',
    itemLevel: 10,
    rarity: 'rare',
    slot: 'mainHand',
    price: 1000,
    quantity: 1,
    quantityInitial: 1,
    bonuses: {},
    upgradeLevel: 0,
    listedAt: '2026-05-21T00:00:00Z',
    ...overrides,
});

beforeEach(() => {
    useMarketStore.setState({
        listings: [],
        myListings: [],
        saleNotifications: [],
        isLoading: false,
        error: null,
    });
    // Seed a fake character so buyListing has a buyerCharacterId. Tests
    // that explicitly want the "no character" path override this.
    useCharacterStore.setState({
        character: { id: 'buyer-char-1', name: 'Buyer', class: 'Knight' } as never,
    });
    getListingsMock.mockReset();
    getMyListingsMock.mockReset();
    getSaleNotificationsMock.mockReset();
    createListingMock.mockReset();
    updateListingMock.mockReset();
    deleteListingMock.mockReset().mockResolvedValue(undefined);
    decrementListingMock.mockReset();
    getListingMock.mockReset();
    createSaleNotificationMock.mockReset().mockResolvedValue(undefined);
    dismissSaleNotificationMock.mockReset().mockResolvedValue(undefined);
    buyListingMock.mockReset();
});

// -- Initial state ------------------------------------------------------------

describe('marketStore — initial state', () => {
    it('starts with empty listings + flags', () => {
        const s = useMarketStore.getState();
        expect(s.listings).toEqual([]);
        expect(s.myListings).toEqual([]);
        expect(s.saleNotifications).toEqual([]);
        expect(s.isLoading).toBe(false);
        expect(s.error).toBeNull();
    });
});

// -- fetchListings ------------------------------------------------------------

describe('fetchListings', () => {
    it('populates the listings array on success', async () => {
        const data = [makeListing(), makeListing({ id: 'ml_2' })];
        getListingsMock.mockResolvedValue(data);
        await useMarketStore.getState().fetchListings();
        const s = useMarketStore.getState();
        expect(s.listings).toEqual(data);
        expect(s.isLoading).toBe(false);
        expect(s.error).toBeNull();
    });

    it('keeps isLoading false during the initial silent populate', async () => {
        // listings.length === 0 -> don't flip the global spinner.
        getListingsMock.mockImplementation(async () => {
            // Snapshot state mid-flight.
            expect(useMarketStore.getState().isLoading).toBe(false);
            return [];
        });
        await useMarketStore.getState().fetchListings();
    });

    it('flips isLoading on for an active refetch when listings already populated', async () => {
        useMarketStore.setState({ listings: [makeListing()] });
        let observedLoading = false;
        getListingsMock.mockImplementation(async () => {
            observedLoading = useMarketStore.getState().isLoading;
            return [];
        });
        await useMarketStore.getState().fetchListings();
        expect(observedLoading).toBe(true);
        expect(useMarketStore.getState().isLoading).toBe(false);
    });

    it('sets an error message when the API throws', async () => {
        getListingsMock.mockRejectedValue(new Error('boom'));
        await useMarketStore.getState().fetchListings();
        const s = useMarketStore.getState();
        expect(s.isLoading).toBe(false);
        expect(s.error).toMatch(/Nie/);
    });
});

// -- fetchMyListings ----------------------------------------------------------

describe('fetchMyListings', () => {
    it('populates myListings on success', async () => {
        const data = [makeListing({ sellerId: 'seller-1' })];
        getMyListingsMock.mockResolvedValue(data);
        await useMarketStore.getState().fetchMyListings('seller-1');
        expect(useMarketStore.getState().myListings).toEqual(data);
    });

    it('silently swallows API failure (no error state, falls back to public listings)', async () => {
        getMyListingsMock.mockRejectedValue(new Error('offline'));
        await useMarketStore.getState().fetchMyListings('seller-1');
        const s = useMarketStore.getState();
        expect(s.error).toBeNull();
        expect(s.myListings).toEqual([]);
    });
});

// -- fetchSaleNotifications ---------------------------------------------------

describe('fetchSaleNotifications', () => {
    it('populates saleNotifications on success', async () => {
        getSaleNotificationsMock.mockResolvedValue([
            { id: 'sn1', sellerId: 'seller-1', itemId: 'sword', itemName: 'Sword', rarity: 'rare', quantitySold: 1, goldReceived: 1000, soldAt: '2026-05-21T00:00:00Z', seen: false },
        ]);
        await useMarketStore.getState().fetchSaleNotifications('seller-1');
        expect(useMarketStore.getState().saleNotifications).toHaveLength(1);
    });

    it('silently swallows API failure (no error state)', async () => {
        getSaleNotificationsMock.mockRejectedValue(new Error('table missing'));
        await useMarketStore.getState().fetchSaleNotifications('seller-1');
        expect(useMarketStore.getState().error).toBeNull();
    });
});

// -- listItem -----------------------------------------------------------------

describe('listItem', () => {
    const payload: Omit<IMarketListing, 'id' | 'listedAt'> = {
        sellerId: 'seller-1',
        sellerName: 'Alice',
        kind: 'item',
        itemId: 'sword',
        itemName: 'Sword',
        itemLevel: 10,
        rarity: 'rare',
        slot: 'mainHand',
        price: 1000,
        quantity: 1,
        quantityInitial: 1,
        bonuses: {},
        upgradeLevel: 0,
    };

    it('returns null and skips the API when the price is invalid', async () => {
        const id = await useMarketStore.getState().listItem({ ...payload, price: 0 });
        expect(id).toBeNull();
        expect(createListingMock).not.toHaveBeenCalled();
    });

    it('returns null when the quantity is invalid', async () => {
        const id = await useMarketStore.getState().listItem({ ...payload, quantity: 0 });
        expect(id).toBeNull();
        expect(createListingMock).not.toHaveBeenCalled();
    });

    it('returns null when the initial quantity is invalid', async () => {
        const id = await useMarketStore.getState().listItem({ ...payload, quantityInitial: 0 });
        expect(id).toBeNull();
        expect(createListingMock).not.toHaveBeenCalled();
    });

    it('returns the listing id and prepends to both lists on success', async () => {
        const created = makeListing({ id: 'ml_new' });
        createListingMock.mockResolvedValue(created);
        const id = await useMarketStore.getState().listItem(payload);
        expect(id).toBe('ml_new');
        const s = useMarketStore.getState();
        expect(s.listings[0].id).toBe('ml_new');
        expect(s.myListings[0].id).toBe('ml_new');
        expect(s.isLoading).toBe(false);
    });

    it('sets a user-facing error message when the API throws', async () => {
        createListingMock.mockRejectedValue(new Error('boom'));
        const id = await useMarketStore.getState().listItem(payload);
        expect(id).toBeNull();
        const s = useMarketStore.getState();
        expect(s.isLoading).toBe(false);
        expect(s.error).toContain('boom');
    });
});

// -- editListing --------------------------------------------------------------

describe('editListing', () => {
    it('returns null when the listing is not in myListings', async () => {
        const r = await useMarketStore.getState().editListing('unknown', { price: 100 });
        expect(r).toBeNull();
        expect(updateListingMock).not.toHaveBeenCalled();
    });

    it('rejects invalid price patches', async () => {
        useMarketStore.setState({ myListings: [makeListing({ id: 'ml_x' })] });
        const r = await useMarketStore.getState().editListing('ml_x', { price: 0 });
        expect(r).toBeNull();
        expect(updateListingMock).not.toHaveBeenCalled();
    });

    it('rejects invalid quantity patches', async () => {
        useMarketStore.setState({ myListings: [makeListing({ id: 'ml_x' })] });
        const r = await useMarketStore.getState().editListing('ml_x', { quantity: 0 });
        expect(r).toBeNull();
        expect(updateListingMock).not.toHaveBeenCalled();
    });

    it('replaces the listing in both lists on success', async () => {
        const old = makeListing({ id: 'ml_x', price: 100 });
        const fresh = makeListing({ id: 'ml_x', price: 200 });
        useMarketStore.setState({ listings: [old], myListings: [old] });
        updateListingMock.mockResolvedValue(fresh);

        const r = await useMarketStore.getState().editListing('ml_x', { price: 200 });
        expect(r?.price).toBe(200);
        const s = useMarketStore.getState();
        expect(s.listings[0].price).toBe(200);
        expect(s.myListings[0].price).toBe(200);
    });

    it('sets an error when the API rejects', async () => {
        useMarketStore.setState({ myListings: [makeListing({ id: 'ml_x' })] });
        updateListingMock.mockRejectedValue(new Error('boom'));
        const r = await useMarketStore.getState().editListing('ml_x', { price: 200 });
        expect(r).toBeNull();
        expect(useMarketStore.getState().error).toBeTruthy();
    });

    it('returns null when the API resolves with null (no patch applied)', async () => {
        useMarketStore.setState({ myListings: [makeListing({ id: 'ml_x' })] });
        updateListingMock.mockResolvedValue(null);
        const r = await useMarketStore.getState().editListing('ml_x', { price: 200 });
        expect(r).toBeNull();
    });
});

// -- cancelListing ------------------------------------------------------------

describe('cancelListing', () => {
    it('returns null when listing is not in myListings', async () => {
        const r = await useMarketStore.getState().cancelListing('unknown');
        expect(r).toBeNull();
    });

    it('drops the listing from both lists on success', async () => {
        const listing = makeListing({ id: 'ml_x' });
        useMarketStore.setState({ listings: [listing], myListings: [listing] });
        const r = await useMarketStore.getState().cancelListing('ml_x');
        expect(r?.id).toBe('ml_x');
        const s = useMarketStore.getState();
        expect(s.listings).toEqual([]);
        expect(s.myListings).toEqual([]);
    });

    it('sets an error when the API throws', async () => {
        const listing = makeListing({ id: 'ml_x' });
        useMarketStore.setState({ myListings: [listing] });
        deleteListingMock.mockRejectedValueOnce(new Error('boom'));
        const r = await useMarketStore.getState().cancelListing('ml_x');
        expect(r).toBeNull();
        expect(useMarketStore.getState().error).toBeTruthy();
    });
});

// -- buyListing ---------------------------------------------------------------
//
// Tests target the 2026-05-25 v3 contract: `marketStore.buyListing` calls
// the SECURITY DEFINER `marketApi.buyListing(listingId, buyerCharacterId)`
// RPC for each unit, never `getListing()` or `decrementListing()`.

/** Build a successful RPC return shape. */
const makeRpcOk = (overrides: Partial<{ remainingQty: number; quantityPurchased: number; sellerId: string; itemId: string; itemName: string; kind: IMarketListing['kind']; price: number; rarity: IMarketListing['rarity']; itemLevel: number; slot: string; bonuses: Record<string, number>; upgradeLevel: number; sellerName: string; listingId: string }> = {}) => ({
    ok: true as const,
    listingId: 'ml_1',
    sellerId: 'seller-1',
    sellerName: 'Alice',
    kind: 'item' as IMarketListing['kind'],
    itemId: 'sword',
    itemName: 'Sword',
    itemLevel: 10,
    rarity: 'rare' as IMarketListing['rarity'],
    slot: 'mainHand',
    price: 1000,
    bonuses: {},
    upgradeLevel: 0,
    quantityPurchased: 1,
    remainingQty: 0,
    ...overrides,
});

describe('buyListing', () => {
    it('returns null for invalid quantity', async () => {
        const r = await useMarketStore.getState().buyListing('ml_x', 0);
        expect(r).toBeNull();
        expect(buyListingMock).not.toHaveBeenCalled();
    });

    it('returns null + error when no character is loaded', async () => {
        useCharacterStore.setState({ character: null });
        const r = await useMarketStore.getState().buyListing('ml_x', 1);
        expect(r).toBeNull();
        expect(useMarketStore.getState().error).toMatch(/zaloguj/i);
        expect(buyListingMock).not.toHaveBeenCalled();
    });

    it('surfaces a user-facing message when the RPC is missing (migration not applied)', async () => {
        buyListingMock.mockResolvedValue({ ok: false, reason: 'rpc_missing', error: 'fn missing' });
        const r = await useMarketStore.getState().buyListing('ml_1', 1);
        expect(r).toBeNull();
        expect(useMarketStore.getState().error).toMatch(/buy_market_listing/);
    });

    it('returns null + error when RPC reports listing not_found', async () => {
        buyListingMock.mockResolvedValue({ ok: false, reason: 'not_found' });
        const r = await useMarketStore.getState().buyListing('ml_1', 1);
        expect(r).toBeNull();
        expect(useMarketStore.getState().error).toMatch(/nie istnieje/i);
    });

    it('returns null + error when RPC reports own_listing', async () => {
        buyListingMock.mockResolvedValue({ ok: false, reason: 'own_listing' });
        const r = await useMarketStore.getState().buyListing('ml_1', 1);
        expect(r).toBeNull();
        expect(useMarketStore.getState().error).toMatch(/własn/i);
    });

    it('returns null + error when RPC reports out_of_stock', async () => {
        buyListingMock.mockResolvedValue({ ok: false, reason: 'out_of_stock' });
        const r = await useMarketStore.getState().buyListing('ml_1', 1);
        expect(r).toBeNull();
        expect(useMarketStore.getState().error).toMatch(/skończ/i);
    });

    it('full-buy: drops the listing locally + returns listing metadata', async () => {
        const listing = makeListing({ id: 'ml_1', quantity: 1, price: 1000 });
        useMarketStore.setState({ listings: [listing], myListings: [listing] });
        buyListingMock.mockResolvedValue(makeRpcOk({ remainingQty: 0, price: 1000 }));

        const r = await useMarketStore.getState().buyListing('ml_1', 1);
        expect(r).not.toBeNull();
        expect(r?.quantity).toBe(1);
        expect(r?.totalPaid).toBe(1000);
        const s = useMarketStore.getState();
        expect(s.listings).toEqual([]);
        expect(s.myListings).toEqual([]);
        // RPC inserts the sale notification server-side — the store no
        // longer fires the JS-side `createSaleNotification` call.
        expect(createSaleNotificationMock).not.toHaveBeenCalled();
    });

    it('partial buy: passes qty to RPC + updates remaining quantity locally', async () => {
        const listing = makeListing({ id: 'ml_1', quantity: 10, kind: 'potion', price: 100 });
        useMarketStore.setState({ listings: [listing], myListings: [listing] });
        // Single RPC call decrements the whole stack of N units. The
        // function returns remaining_qty after the buy.
        buyListingMock.mockResolvedValue(makeRpcOk({
            remainingQty: 7,
            quantityPurchased: 3,
            kind: 'potion',
            price: 100,
            itemId: 'sword',
        }));

        const r = await useMarketStore.getState().buyListing('ml_1', 3);
        expect(buyListingMock).toHaveBeenCalledTimes(1);
        // The store passes (listingId, buyerCharacterId, qty) to the RPC.
        expect(buyListingMock).toHaveBeenCalledWith('ml_1', 'buyer-char-1', 3);
        expect(r?.quantity).toBe(3);
        expect(r?.totalPaid).toBe(300);
        const s = useMarketStore.getState();
        expect(s.listings[0].quantity).toBe(7);
        expect(s.myListings[0].quantity).toBe(7);
    });

    it('reports out_of_stock when RPC rejects a qty larger than available', async () => {
        // qty=5 requested but listing only has 2 left -> server returns
        // out_of_stock atomically (no partial buys at the RPC layer —
        // either we get all qty units or nothing).
        const listing = makeListing({ id: 'ml_1', quantity: 2, kind: 'potion', price: 50 });
        useMarketStore.setState({ listings: [listing], myListings: [listing] });
        buyListingMock.mockResolvedValue({ ok: false, reason: 'out_of_stock' });

        const r = await useMarketStore.getState().buyListing('ml_1', 5);
        expect(r).toBeNull();
        expect(useMarketStore.getState().error).toMatch(/skończ/i);
    });

    it('surfaces a transport-layer error message in the state error', async () => {
        buyListingMock.mockRejectedValue(new Error('network down'));
        const r = await useMarketStore.getState().buyListing('ml_1', 1);
        expect(r).toBeNull();
        expect(useMarketStore.getState().error).toContain('network down');
    });
});

// -- dismissNotification ------------------------------------------------------

describe('dismissNotification', () => {
    it('removes the notification from the store and calls the API', async () => {
        useMarketStore.setState({
            saleNotifications: [
                { id: 'n1', sellerId: 'seller-1', itemId: 'x', itemName: 'X', rarity: 'rare', quantitySold: 1, goldReceived: 100, soldAt: '', seen: false },
                { id: 'n2', sellerId: 'seller-1', itemId: 'y', itemName: 'Y', rarity: 'rare', quantitySold: 1, goldReceived: 100, soldAt: '', seen: false },
            ],
        });
        await useMarketStore.getState().dismissNotification('n1');
        expect(dismissSaleNotificationMock).toHaveBeenCalledWith('n1');
        expect(useMarketStore.getState().saleNotifications.map((n) => n.id)).toEqual(['n2']);
    });
});

// -- clearError ---------------------------------------------------------------

describe('clearError', () => {
    it('resets error to null', () => {
        useMarketStore.setState({ error: 'oh no' });
        useMarketStore.getState().clearError();
        expect(useMarketStore.getState().error).toBeNull();
    });
});
