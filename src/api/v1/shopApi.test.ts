/**
 * Tests for shopApi — read shop_items + RPC-style buyItem call.
 *
 * Both methods are thin BaseApi wrappers; we mock axiosInstance.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    },
}));

import api from './axiosInstance';
import { shopApi } from './shopApi';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockApi = api as unknown as Record<string, any>;
const mkRes = <T>(data: T) => ({ data });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('shopApi.getShopItems', () => {
    it('GETs /rest/v1/shop_items with select=*', async () => {
        const items = [
            { id: '1', item_id: 'hp_potion', name_pl: 'Mikstura HP', name_en: 'HP Potion', price: 10, rarity: 'common', type: 'potion', quantity: null },
        ];
        mockApi.get.mockResolvedValueOnce(mkRes(items));

        const result = await shopApi.getShopItems();

        expect(mockApi.get).toHaveBeenCalledWith('/rest/v1/shop_items?select=*', expect.any(Object));
        expect(result).toBe(items);
    });

    it('returns [] when the shop is empty', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const result = await shopApi.getShopItems();
        expect(result).toEqual([]);
    });
});

describe('shopApi.buyItem', () => {
    it('POSTs to /rest/v1/rpc/buy_item with character_id + item_id', async () => {
        mockApi.post.mockResolvedValueOnce(mkRes(undefined));
        await shopApi.buyItem('c1', 'hp_potion');
        const [url, body] = mockApi.post.mock.calls[0];
        expect(url).toBe('/rest/v1/rpc/buy_item');
        expect(body).toEqual({ character_id: 'c1', item_id: 'hp_potion' });
    });

    it('rejects (propagates) when the RPC throws', async () => {
        mockApi.post.mockRejectedValueOnce(new Error('Insufficient gold'));
        await expect(shopApi.buyItem('c1', 'epic_sword')).rejects.toThrow('Insufficient gold');
    });
});

// TODO: This API will likely grow a `sellItem`/`refund` RPC in the
// future — the new methods will need their own tests when added.
