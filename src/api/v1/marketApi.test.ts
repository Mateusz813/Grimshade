/**
 * Tests for marketApi — listings + sale notifications via supabase-js.
 *
 * Unlike the other APIs, marketApi uses the `supabase.from(...)` chain
 * directly rather than BaseApi/PostgREST URLs. We build a per-test
 * chain mock that records the calls and lets us script the resolved
 * value of the terminal awaitable.
 *
 * Key behaviours under test:
 * - getListings / getMyListings: order by listed_at desc, map rows to
 *   the IMarketListing shape with default fills.
 * - createListing: snake_case column names from camelCase input.
 * - updateListing: returns null for empty patches, otherwise patches
 *   price + quantity.
 * - decrementListing: deletes when remaining <= 0, otherwise updates.
 * - deleteListing / getListing: trivial passthroughs.
 * - Sale notifications: best-effort — return [] / no-op on error.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supabase } from '../../lib/supabase';
import { marketApi } from './marketApi';

/**
 * Build a chainable mock of `supabase.from(...)`. Every awaited call
 * resolves to `result`; method calls return `this`. `maybeSingle` and
 * `single` are await-able terminal nodes.
 */
const buildChain = (result: { data: unknown; error: unknown }) => {
    const chain: Record<string, unknown> = {};
    const methods = ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit', 'in', 'is'];
    for (const m of methods) chain[m] = vi.fn(() => chain);
    chain.single = vi.fn().mockResolvedValue(result);
    chain.maybeSingle = vi.fn().mockResolvedValue(result);
    // For non-terminal chains we also want `.then` to make `await chain` work.
    chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return chain as Record<string, ReturnType<typeof vi.fn> | ((..._: unknown[]) => unknown)> & {
        single: ReturnType<typeof vi.fn>;
        maybeSingle: ReturnType<typeof vi.fn>;
    };
};

beforeEach(() => {
    vi.clearAllMocks();
});

const makeDbRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'L1',
    seller_id: 's1',
    seller_name: 'Mateusz',
    kind: 'item',
    item_id: 'sword_of_power',
    item_name: 'Sword of Power',
    item_level: 25,
    rarity: 'epic',
    slot: 'mainHand',
    price: 5000,
    quantity: 1,
    quantity_initial: 1,
    bonuses: { dmg: 10 },
    upgrade_level: 3,
    listed_at: '2026-05-21T00:00:00Z',
    ...overrides,
});

describe('marketApi.getListings', () => {
    it('orders by listed_at desc and maps DB rows to IMarketListing', async () => {
        const rows = [makeDbRow(), makeDbRow({ id: 'L2' })];
        const chain = buildChain({ data: rows, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);

        const result = await marketApi.getListings();

        expect(supabase.from).toHaveBeenCalledWith('market_listings');
        expect(chain.select).toHaveBeenCalledWith('*');
        expect(chain.order).toHaveBeenCalledWith('listed_at', { ascending: false });
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
            id: 'L1',
            sellerId: 's1',
            sellerName: 'Mateusz',
            kind: 'item',
            itemId: 'sword_of_power',
            price: 5000,
        });
    });

    it('returns [] when data is null', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        const result = await marketApi.getListings();
        expect(result).toEqual([]);
    });

    it('throws when supabase returns an error', async () => {
        const err = new Error('Database unavailable');
        const chain = buildChain({ data: null, error: err });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await expect(marketApi.getListings()).rejects.toBe(err);
    });

    it('fills sane defaults for missing optional columns', async () => {
        const minimalRow = {
            id: 'L1',
            seller_id: 's1',
            seller_name: 'X',
            item_id: 'i',
            item_name: 'I',
            rarity: 'common',
            price: 10,
            listed_at: '2026-05-21',
            // missing: kind, quantity, quantity_initial, item_level, slot, bonuses, upgrade_level
        };
        const chain = buildChain({ data: [minimalRow], error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        const result = await marketApi.getListings();
        expect(result[0]).toMatchObject({
            kind: 'item',
            quantity: 1,
            quantityInitial: 1,
            itemLevel: 1,
            slot: '',
            bonuses: {},
            upgradeLevel: 0,
        });
    });
});

describe('marketApi.getMyListings', () => {
    it('filters by seller_id and orders by listed_at desc', async () => {
        const chain = buildChain({ data: [makeDbRow()], error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);

        await marketApi.getMyListings('s1');

        expect(supabase.from).toHaveBeenCalledWith('market_listings');
        expect(chain.eq).toHaveBeenCalledWith('seller_id', 's1');
        expect(chain.order).toHaveBeenCalledWith('listed_at', { ascending: false });
    });

    it('throws when supabase returns an error', async () => {
        const err = new Error('Permission denied');
        const chain = buildChain({ data: null, error: err });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await expect(marketApi.getMyListings('s1')).rejects.toBe(err);
    });
});

describe('marketApi.createListing', () => {
    it('converts camelCase input to snake_case insert payload', async () => {
        const inserted = makeDbRow({ id: 'L-new' });
        const chain = buildChain({ data: inserted, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);

        const result = await marketApi.createListing({
            sellerId: 's1',
            sellerName: 'Mateusz',
            kind: 'item',
            itemId: 'sword',
            itemName: 'Sword',
            itemLevel: 10,
            rarity: 'rare',
            slot: 'mainHand',
            price: 1000,
            quantity: 1,
            quantityInitial: 1,
            bonuses: { dmg: 5 },
            upgradeLevel: 0,
        });

        const insertPayload = vi.mocked(chain.insert).mock.calls[0][0];
        expect(insertPayload).toMatchObject({
            seller_id: 's1',
            seller_name: 'Mateusz',
            kind: 'item',
            item_id: 'sword',
            item_name: 'Sword',
            item_level: 10,
            rarity: 'rare',
            slot: 'mainHand',
            price: 1000,
            quantity: 1,
            quantity_initial: 1,
            bonuses: { dmg: 5 },
            upgrade_level: 0,
        });
        expect(result.id).toBe('L-new');
    });

    it('throws when supabase rejects the insert', async () => {
        const err = new Error('CHECK constraint failed');
        const chain = buildChain({ data: null, error: err });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await expect(
            marketApi.createListing({
                sellerId: 's1', sellerName: 'X', kind: 'item', itemId: 'i', itemName: 'I',
                itemLevel: 1, rarity: 'common', slot: '', price: 0, quantity: 1,
                quantityInitial: 1, bonuses: {}, upgradeLevel: 0,
            }),
        ).rejects.toBe(err);
    });
});

describe('marketApi.updateListing', () => {
    it('returns null when patch is empty (no-op)', async () => {
        const result = await marketApi.updateListing('L1', {});
        expect(result).toBeNull();
        // Should not even hit supabase.
        expect(supabase.from).not.toHaveBeenCalled();
    });

    it('builds a price-only update payload', async () => {
        const chain = buildChain({ data: makeDbRow({ price: 999 }), error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await marketApi.updateListing('L1', { price: 999 });
        const updatePayload = vi.mocked(chain.update).mock.calls[0][0];
        expect(updatePayload).toEqual({ price: 999 });
        expect(chain.eq).toHaveBeenCalledWith('id', 'L1');
    });

    it('includes both price and quantity when both supplied', async () => {
        const chain = buildChain({ data: makeDbRow(), error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await marketApi.updateListing('L1', { price: 500, quantity: 3 });
        const updatePayload = vi.mocked(chain.update).mock.calls[0][0];
        expect(updatePayload).toEqual({ price: 500, quantity: 3 });
    });

    it('returns null when supabase returns no row', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        const result = await marketApi.updateListing('L1', { price: 100 });
        expect(result).toBeNull();
    });

    it('throws when supabase returns an error', async () => {
        const err = new Error('Failed');
        const chain = buildChain({ data: null, error: err });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await expect(marketApi.updateListing('L1', { price: 1 })).rejects.toBe(err);
    });
});

describe('marketApi.decrementListing', () => {
    it('deletes when the buy quantity hits the remaining count', async () => {
        // fetchChain returns current quantity = 2, then we decrement by 2.
        const fetchChain = buildChain({ data: makeDbRow({ quantity: 2 }), error: null });
        const deleteChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from)
            .mockReturnValueOnce(fetchChain as never)
            .mockReturnValueOnce(deleteChain as never);

        const result = await marketApi.decrementListing('L1', 2);

        // Delete path was used, not update.
        expect(deleteChain.delete).toHaveBeenCalled();
        expect(deleteChain.eq).toHaveBeenCalledWith('id', 'L1');
        // Returned snapshot has quantity = 0.
        expect(result?.quantity).toBe(0);
    });

    it('updates remaining quantity when buy < available', async () => {
        const fetchChain = buildChain({ data: makeDbRow({ quantity: 5 }), error: null });
        const updateChain = buildChain({
            data: makeDbRow({ quantity: 3 }),
            error: null,
        });
        vi.mocked(supabase.from)
            .mockReturnValueOnce(fetchChain as never)
            .mockReturnValueOnce(updateChain as never);

        const result = await marketApi.decrementListing('L1', 2);
        const updatePayload = vi.mocked(updateChain.update).mock.calls[0][0];
        expect(updatePayload).toEqual({ quantity: 3 });
        expect(result?.quantity).toBe(3);
    });

    it('returns null when the listing row no longer exists', async () => {
        const fetchChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(fetchChain as never);
        const result = await marketApi.decrementListing('vanished', 1);
        expect(result).toBeNull();
    });

    it('throws when the initial fetch fails', async () => {
        const err = new Error('Network');
        const fetchChain = buildChain({ data: null, error: err });
        vi.mocked(supabase.from).mockReturnValueOnce(fetchChain as never);
        await expect(marketApi.decrementListing('L1', 1)).rejects.toBe(err);
    });

    it('treats missing quantity column as 1 (legacy listings)', async () => {
        const fetchChain = buildChain({ data: makeDbRow({ quantity: null }), error: null });
        const deleteChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from)
            .mockReturnValueOnce(fetchChain as never)
            .mockReturnValueOnce(deleteChain as never);
        // qty=1, decrement by 1 → delete path.
        await marketApi.decrementListing('L1', 1);
        expect(deleteChain.delete).toHaveBeenCalled();
    });
});

describe('marketApi.buyListing (RPC)', () => {
    it('passes (listingId, buyerCharacterId, qty) + returns hydrated fields when RPC succeeds', async () => {
        const rpcReturn = {
            ok: true,
            listing_id: 'L1',
            seller_id: 's1',
            seller_name: 'Alice',
            kind: 'item',
            item_id: 'sword',
            item_name: 'Sword',
            item_level: 10,
            rarity: 'rare',
            slot: 'mainHand',
            price: 1000,
            bonuses: { dmg: 5 },
            upgrade_level: 2,
            quantity_purchased: 1,
            remaining_qty: 0,
        };
        vi.mocked(supabase.rpc).mockResolvedValue({ data: rpcReturn, error: null } as never);
        const res = await marketApi.buyListing('L1', 'buyer-1', 1);
        expect(supabase.rpc).toHaveBeenCalledWith('buy_market_listing', {
            p_listing_id: 'L1',
            p_buyer_character_id: 'buyer-1',
            p_quantity: 1,
        });
        if (!res.ok) throw new Error('expected ok');
        expect(res.itemId).toBe('sword');
        expect(res.itemName).toBe('Sword');
        expect(res.upgradeLevel).toBe(2);
        expect(res.bonuses).toEqual({ dmg: 5 });
        expect(res.quantityPurchased).toBe(1);
        expect(res.remainingQty).toBe(0);
    });

    it('forwards a qty > 1 stack buy to the RPC', async () => {
        vi.mocked(supabase.rpc).mockResolvedValue({
            data: {
                ok: true,
                listing_id: 'L1',
                seller_id: 's1',
                seller_name: 'Alice',
                kind: 'potion',
                item_id: 'hp_potion_sm',
                item_name: 'Mały Eliksir HP',
                item_level: 1,
                rarity: 'common',
                slot: '',
                price: 100,
                bonuses: {},
                upgrade_level: 0,
                quantity_purchased: 3,
                remaining_qty: 7,
            },
            error: null,
        } as never);
        const res = await marketApi.buyListing('L1', 'buyer-1', 3);
        expect(supabase.rpc).toHaveBeenCalledWith('buy_market_listing', {
            p_listing_id: 'L1',
            p_buyer_character_id: 'buyer-1',
            p_quantity: 3,
        });
        if (!res.ok) throw new Error('expected ok');
        expect(res.quantityPurchased).toBe(3);
        expect(res.remainingQty).toBe(7);
    });

    it('defaults qty to 1 when omitted', async () => {
        vi.mocked(supabase.rpc).mockResolvedValue({
            data: { ok: false, reason: 'not_found' },
            error: null,
        } as never);
        await marketApi.buyListing('L1', 'buyer-1');
        expect(supabase.rpc).toHaveBeenCalledWith('buy_market_listing', {
            p_listing_id: 'L1',
            p_buyer_character_id: 'buyer-1',
            p_quantity: 1,
        });
    });

    it('propagates ok=false / reason when RPC returns the function-side rejection shape', async () => {
        vi.mocked(supabase.rpc).mockResolvedValue({
            data: { ok: false, reason: 'own_listing' },
            error: null,
        } as never);
        const res = await marketApi.buyListing('L1', 'seller-1');
        expect(res.ok).toBe(false);
        if (res.ok) throw new Error('expected !ok');
        expect(res.reason).toBe('own_listing');
    });

    it('reports rpc_missing when PostgREST cannot find the function (PGRST202)', async () => {
        vi.mocked(supabase.rpc).mockResolvedValue({
            data: null,
            error: { code: 'PGRST202', message: 'Could not find the function' },
        } as never);
        const res = await marketApi.buyListing('L1', 'buyer-1');
        expect(res.ok).toBe(false);
        if (res.ok) throw new Error('expected !ok');
        expect(res.reason).toBe('rpc_missing');
    });

    it('reports rpc_error for any other Supabase error', async () => {
        vi.mocked(supabase.rpc).mockResolvedValue({
            data: null,
            error: { code: '500', message: 'network down' },
        } as never);
        const res = await marketApi.buyListing('L1', 'buyer-1');
        if (res.ok) throw new Error('expected !ok');
        expect(res.reason).toBe('rpc_error');
        expect(res.error).toMatch(/network down/);
    });
});

describe('marketApi.deleteListing', () => {
    it('deletes by id', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await marketApi.deleteListing('L1');
        expect(chain.delete).toHaveBeenCalled();
        expect(chain.eq).toHaveBeenCalledWith('id', 'L1');
    });

    it('throws when supabase returns an error', async () => {
        const err = new Error('RLS denied');
        const chain = buildChain({ data: null, error: err });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await expect(marketApi.deleteListing('L1')).rejects.toBe(err);
    });
});

describe('marketApi.getListing', () => {
    it('returns the mapped listing when found', async () => {
        const chain = buildChain({ data: makeDbRow(), error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        const result = await marketApi.getListing('L1');
        expect(result?.id).toBe('L1');
        expect(chain.eq).toHaveBeenCalledWith('id', 'L1');
    });

    it('returns null when no row found', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        const result = await marketApi.getListing('vanished');
        expect(result).toBeNull();
    });
});

describe('marketApi.getSaleNotifications', () => {
    it('returns [] (degrades gracefully) when the table is missing / RLS denies', async () => {
        const chain = buildChain({
            data: null,
            error: { message: 'relation does not exist' },
        });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        const result = await marketApi.getSaleNotifications('s1');
        expect(result).toEqual([]);
    });

    it('maps notification rows on success', async () => {
        const rows = [
            {
                id: 'n1',
                seller_id: 's1',
                item_id: 'sword',
                item_name: 'Sword',
                rarity: 'rare',
                quantity_sold: 2,
                gold_received: 1000,
                sold_at: '2026-05-21T00:00:00Z',
                seen: false,
            },
        ];
        const chain = buildChain({ data: rows, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);

        const result = await marketApi.getSaleNotifications('s1');

        expect(chain.eq).toHaveBeenCalledWith('seller_id', 's1');
        expect(chain.eq).toHaveBeenCalledWith('seen', false);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            id: 'n1',
            sellerId: 's1',
            itemId: 'sword',
            quantitySold: 2,
            goldReceived: 1000,
        });
    });

    it('returns [] when data is null but no error', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        const result = await marketApi.getSaleNotifications('s1');
        expect(result).toEqual([]);
    });
});

describe('marketApi.createSaleNotification', () => {
    it('inserts a notification with snake_case column names', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await marketApi.createSaleNotification({
            sellerId: 's1',
            itemId: 'sword',
            itemName: 'Sword',
            rarity: 'rare',
            quantitySold: 1,
            goldReceived: 500,
        });
        expect(supabase.from).toHaveBeenCalledWith('market_sale_notifications');
        const payload = vi.mocked(chain.insert).mock.calls[0][0];
        expect(payload).toMatchObject({
            seller_id: 's1',
            item_id: 'sword',
            item_name: 'Sword',
            rarity: 'rare',
            quantity_sold: 1,
            gold_received: 500,
        });
    });

    it('swallows errors silently (best-effort)', async () => {
        vi.mocked(supabase.from).mockImplementationOnce(() => {
            throw new Error('table missing');
        });
        await expect(
            marketApi.createSaleNotification({
                sellerId: 's', itemId: 'i', itemName: 'I', rarity: 'common',
                quantitySold: 1, goldReceived: 0,
            }),
        ).resolves.toBeUndefined();
    });
});

describe('marketApi.dismissSaleNotification', () => {
    it('updates seen=true by notification id', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await marketApi.dismissSaleNotification('n1');
        const payload = vi.mocked(chain.update).mock.calls[0][0];
        expect(payload).toEqual({ seen: true });
        expect(chain.eq).toHaveBeenCalledWith('id', 'n1');
    });

    it('swallows errors silently (best-effort)', async () => {
        vi.mocked(supabase.from).mockImplementationOnce(() => {
            throw new Error('table missing');
        });
        await expect(marketApi.dismissSaleNotification('n1')).resolves.toBeUndefined();
    });
});

// TODO: the mapDbToListing/mapDbToSale helpers are exercised indirectly
// through every getListings / getListing / getSaleNotifications path
// above. Direct unit testing of them would require exporting them, but
// the public-method coverage above covers every fallback default.
