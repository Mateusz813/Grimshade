/**
 * Tests for inventoryApi — CRUD over /rest/v1/inventory.
 *
 * All four methods (getInventory, addItem, removeItem, updateItem) are
 * thin wrappers over BaseApi's get/post/patch/delete. We mock
 * axiosInstance and assert URL, payload, and config shape.
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
import { inventoryApi } from './inventoryApi';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockApi = api as unknown as Record<string, any>;
const mkRes = <T>(data: T) => ({ data });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('inventoryApi.getInventory', () => {
    it('queries inventory for the character ordered by slot_index', async () => {
        const items = [
            { id: 'i1', character_id: 'c1', slot_index: 0 },
            { id: 'i2', character_id: 'c1', slot_index: 1 },
        ];
        mockApi.get.mockResolvedValueOnce(mkRes(items));

        const result = await inventoryApi.getInventory('c1');

        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain('/rest/v1/inventory');
        expect(url).toContain('character_id=eq.c1');
        expect(url).toContain('order=slot_index.asc');
        expect(result).toBe(items);
    });

    it('returns an empty array verbatim for empty inventory', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const result = await inventoryApi.getInventory('c1');
        expect(result).toEqual([]);
    });
});

describe('inventoryApi.addItem', () => {
    it('attaches character_id, posts with return=representation, returns first row', async () => {
        const inserted = {
            id: 'i-new',
            character_id: 'c1',
            item_id: 'sword',
            rarity: 'rare',
            bonuses: { dmg: 5 },
            item_level: 10,
            quantity: 1,
            slot_index: 0,
            created_at: '2026-01-01T00:00:00Z',
        };
        mockApi.post.mockResolvedValueOnce(mkRes([inserted]));

        const result = await inventoryApi.addItem('c1', {
            // character_id gets overwritten by addItem; supply it just to
            // satisfy TInventoryItemCreate's type. Sentinel value to
            // catch any regression where the spread order changes.
            character_id: 'WILL_BE_OVERWRITTEN',
            item_id: 'sword',
            rarity: 'rare',
            bonuses: { dmg: 5 },
            item_level: 10,
            quantity: 1,
            slot_index: 0,
        });

        const [url, body, config] = mockApi.post.mock.calls[0];
        expect(url).toBe('/rest/v1/inventory');
        expect(body).toMatchObject({ character_id: 'c1', item_id: 'sword' });
        expect(config.headers.Prefer).toBe('return=representation');
        expect(result).toBe(inserted);
    });
});

describe('inventoryApi.removeItem', () => {
    it('issues DELETE filtered by id', async () => {
        mockApi.delete.mockResolvedValueOnce(mkRes(undefined));
        await inventoryApi.removeItem('i1');
        const url = mockApi.delete.mock.calls[0][0] as string;
        expect(url).toBe('/rest/v1/inventory?id=eq.i1');
    });
});

describe('inventoryApi.updateItem', () => {
    it('patches by id with the partial payload and returns first row', async () => {
        const updated = { id: 'i1', quantity: 5 };
        mockApi.patch.mockResolvedValueOnce(mkRes([updated]));
        const result = await inventoryApi.updateItem('i1', { quantity: 5 });
        const [url, body, config] = mockApi.patch.mock.calls[0];
        expect(url).toBe('/rest/v1/inventory?id=eq.i1');
        expect(body).toEqual({ quantity: 5 });
        expect(config.headers.Prefer).toBe('return=representation');
        expect(result).toBe(updated);
    });

    it('accepts an empty partial payload (no-op patch)', async () => {
        mockApi.patch.mockResolvedValueOnce(mkRes([{ id: 'i1' }]));
        await inventoryApi.updateItem('i1', {});
        const body = mockApi.patch.mock.calls[0][1];
        expect(body).toEqual({});
    });
});

// TODO: no test for the case where a removeItem call is made for an id
// that doesn't exist — PostgREST silently returns 204 No Content; the
// helper doesn't differentiate from a successful delete, which matches
// the intent (idempotent removal).
