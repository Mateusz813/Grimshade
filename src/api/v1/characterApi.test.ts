/**
 * Tests for characterApi — REST/PostgREST helpers + Supabase RPC bumps.
 *
 * The REST methods (getCharacter, getCharacters, createCharacter,
 * updateCharacter, deleteCharacter, bumpArenaStats, bumpStat) hit
 * `api.get/post/patch/delete` from BaseApi, which calls the shared axios
 * instance. We mock that instance so we can assert URL/payload/config
 * shape without touching the network.
 *
 * The RPC methods (bumpArenaDeathRpc, bumpArenaKillRpc,
 * bumpMarketSaleRpc) call `supabase.rpc(...)` — the supabase mock is
 * provided by the global setup file.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock axiosInstance BEFORE importing characterApi so BaseApi picks up the mock.
vi.mock('./axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    },
}));

import { supabase } from '../../lib/supabase';
import api from './axiosInstance';
import { characterApi } from './characterApi';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockApi = api as unknown as Record<string, any>;

beforeEach(() => {
    vi.clearAllMocks();
});

// ── Helpers ────────────────────────────────────────────────────────────────
const mkRes = <T>(data: T) => ({ data });

describe('characterApi.getCharacter', () => {
    it('queries by user_id and returns first row', async () => {
        const char = { id: 'c1', user_id: 'u1', name: 'Knight1' };
        mockApi.get.mockResolvedValueOnce(mkRes([char]));
        const result = await characterApi.getCharacter('u1');
        expect(mockApi.get).toHaveBeenCalledWith(
            '/rest/v1/characters?user_id=eq.u1&select=*&limit=1',
            expect.any(Object),
        );
        expect(result).toBe(char);
    });

    it('returns undefined when no character exists for the user', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const result = await characterApi.getCharacter('lonely');
        expect(result).toBeUndefined();
    });
});

describe('characterApi.getCharacters', () => {
    it('returns the full character list ordered by created_at asc', async () => {
        const list = [{ id: 'a' }, { id: 'b' }];
        mockApi.get.mockResolvedValueOnce(mkRes(list));
        const result = await characterApi.getCharacters('u42');
        expect(mockApi.get).toHaveBeenCalledWith(
            '/rest/v1/characters?user_id=eq.u42&select=*&order=created_at.asc',
            expect.any(Object),
        );
        expect(result).toBe(list);
    });
});

describe('characterApi.createCharacter', () => {
    it('posts payload+user_id and returns the inserted row', async () => {
        const inserted = { id: 'new', user_id: 'u1', name: 'Mage1', class: 'Mage' };
        mockApi.post.mockResolvedValueOnce(mkRes([inserted]));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await characterApi.createCharacter('u1', { name: 'Mage1', class: 'Mage' } as any);
        const [url, body, config] = mockApi.post.mock.calls[0];
        expect(url).toBe('/rest/v1/characters');
        expect(body).toMatchObject({ name: 'Mage1', class: 'Mage', user_id: 'u1' });
        // SUPABASE_RETURN_HEADERS — needed for the row to come back.
        expect(config.headers.Prefer).toBe('return=representation');
        expect(result).toBe(inserted);
    });
});

describe('characterApi.updateCharacter', () => {
    it('patches by id, attaches updated_at, and returns the first row', async () => {
        const before = vi.useFakeTimers();
        before.setSystemTime(new Date('2026-05-21T10:00:00.000Z'));
        const updated = { id: 'c1', level: 5 };
        mockApi.patch.mockResolvedValueOnce(mkRes([updated]));
        const result = await characterApi.updateCharacter('c1', { level: 5 });
        const [url, body, config] = mockApi.patch.mock.calls[0];
        expect(url).toBe('/rest/v1/characters?id=eq.c1');
        expect(body.level).toBe(5);
        expect(body.updated_at).toBe('2026-05-21T10:00:00.000Z');
        expect(config.headers.Prefer).toBe('return=representation');
        expect(result).toBe(updated);
        vi.useRealTimers();
    });
});

describe('characterApi.deleteCharacter', () => {
    it('issues DELETE filtered by id', async () => {
        mockApi.delete.mockResolvedValueOnce(mkRes(undefined));
        await characterApi.deleteCharacter('to-yeet');
        expect(mockApi.delete).toHaveBeenCalledWith(
            '/rest/v1/characters?id=eq.to-yeet',
            expect.any(Object),
        );
    });
});

describe('characterApi.bumpArenaStats', () => {
    it('reads current counters then patches with added deltas + new league snapshot', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{ arena_kills: 10, arena_deaths: 4 }]));
        mockApi.patch.mockResolvedValueOnce(mkRes([{ arena_kills: 13, arena_deaths: 5 }]));
        const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

        await characterApi.bumpArenaStats({
            characterId: 'c1',
            winDelta: 3,
            lossDelta: 1,
            league: 'gold',
            leaguePoints: 1250,
        });

        const getUrl = mockApi.get.mock.calls[0][0] as string;
        expect(getUrl).toContain('characters?id=eq.c1');
        expect(getUrl).toContain('select=arena_kills,arena_deaths');

        const [patchUrl, patchBody] = mockApi.patch.mock.calls[0];
        expect(patchUrl).toBe('/rest/v1/characters?id=eq.c1');
        expect(patchBody.arena_kills).toBe(13);
        expect(patchBody.arena_deaths).toBe(5);
        expect(patchBody.arena_league).toBe('gold');
        expect(patchBody.arena_league_points).toBe(1250);
        expect(consoleLog).toHaveBeenCalled();
        consoleLog.mockRestore();
    });

    it('treats missing row as zeroes (no-op start) and floors negative deltas at 0', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([])); // no row
        mockApi.patch.mockResolvedValueOnce(mkRes([{}]));
        vi.spyOn(console, 'log').mockImplementation(() => {});

        await characterApi.bumpArenaStats({
            characterId: 'x',
            winDelta: -5, // floored to 0
            lossDelta: 2,
            league: 'silver',
            leaguePoints: 500,
        });
        const body = mockApi.patch.mock.calls[0][1];
        expect(body.arena_kills).toBe(0); // 0 + max(0, -5) = 0
        expect(body.arena_deaths).toBe(2);
    });

    it('swallows errors and console.warns', async () => {
        mockApi.get.mockRejectedValueOnce(new Error('boom'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await characterApi.bumpArenaStats({
            characterId: 'c1',
            winDelta: 1,
            lossDelta: 0,
            league: 'bronze',
            leaguePoints: 0,
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('[arena-sync]'), expect.anything());
        warn.mockRestore();
    });
});

describe('characterApi.bumpStat', () => {
    it('mode=add: reads current value then patches with sum', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{ market_items_sold: 7 }]));
        mockApi.patch.mockResolvedValueOnce(mkRes([{}]));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await characterApi.bumpStat({ characterId: 'c1', column: 'market_items_sold' as any, value: 3, mode: 'add' });
        const patchBody = mockApi.patch.mock.calls[0][1];
        expect(patchBody.market_items_sold).toBe(10);
    });

    it('mode=max: skips patch when new value not greater', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{ best_dps5: 100 }]));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await characterApi.bumpStat({ characterId: 'c1', column: 'best_dps5' as any, value: 50, mode: 'max' });
        expect(mockApi.patch).not.toHaveBeenCalled();
    });

    it('mode=max: patches when new value beats current', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{ best_dps5: 100 }]));
        mockApi.patch.mockResolvedValueOnce(mkRes([{}]));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await characterApi.bumpStat({ characterId: 'c1', column: 'best_dps5' as any, value: 200, mode: 'max' });
        const patchBody = mockApi.patch.mock.calls[0][1];
        expect(patchBody.best_dps5).toBe(200);
    });

    it('mode=set: skips the read and just patches', async () => {
        mockApi.patch.mockResolvedValueOnce(mkRes([{}]));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await characterApi.bumpStat({ characterId: 'c1', column: 'mastery_points' as any, value: 99, mode: 'set' });
        expect(mockApi.get).not.toHaveBeenCalled();
        const patchBody = mockApi.patch.mock.calls[0][1];
        expect(patchBody.mastery_points).toBe(99);
    });

    it('default mode is "add"', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{ quests_done: 5 }]));
        mockApi.patch.mockResolvedValueOnce(mkRes([{}]));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await characterApi.bumpStat({ characterId: 'c1', column: 'quests_done' as any, value: 2 });
        const patchBody = mockApi.patch.mock.calls[0][1];
        expect(patchBody.quests_done).toBe(7);
    });

    it('handles null current values by treating them as 0', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{ market_items_sold: null }]));
        mockApi.patch.mockResolvedValueOnce(mkRes([{}]));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await characterApi.bumpStat({ characterId: 'c1', column: 'market_items_sold' as any, value: 4 });
        const patchBody = mockApi.patch.mock.calls[0][1];
        expect(patchBody.market_items_sold).toBe(4);
    });

    it('swallows errors and console.warns', async () => {
        mockApi.get.mockRejectedValueOnce(new Error('boom'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await characterApi.bumpStat({ characterId: 'c1', column: 'foo' as any, value: 1 });
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('characterApi RPC helpers', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpcMock = vi.fn().mockResolvedValue({ error: null }) as any;

    beforeEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).rpc = rpcMock;
        rpcMock.mockClear();
    });

    describe('bumpArenaDeathRpc', () => {
        it('calls bump_arena_death RPC with target id', async () => {
            await characterApi.bumpArenaDeathRpc('victim-1');
            expect(rpcMock).toHaveBeenCalledWith('bump_arena_death', {
                target_character_id: 'victim-1',
            });
        });

        it('console.warns on RPC error but does not throw', async () => {
            rpcMock.mockResolvedValueOnce({ error: { message: 'boom' } });
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            await expect(characterApi.bumpArenaDeathRpc('v')).resolves.toBeUndefined();
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
        });

        it('swallows thrown errors', async () => {
            rpcMock.mockRejectedValueOnce(new Error('network'));
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            await expect(characterApi.bumpArenaDeathRpc('v')).resolves.toBeUndefined();
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
        });
    });

    describe('bumpArenaKillRpc', () => {
        it('calls bump_arena_kill RPC with target id', async () => {
            await characterApi.bumpArenaKillRpc('killer-1');
            expect(rpcMock).toHaveBeenCalledWith('bump_arena_kill', {
                target_character_id: 'killer-1',
            });
        });
    });

    describe('bumpMarketSaleRpc', () => {
        it('passes seller id + quantity + gold to bump_market_sale', async () => {
            await characterApi.bumpMarketSaleRpc({
                sellerCharacterId: 's1',
                quantity: 3,
                goldAmount: 1500,
            });
            expect(rpcMock).toHaveBeenCalledWith('bump_market_sale', {
                seller_character_id: 's1',
                quantity: 3,
                gold_amount: 1500,
            });
        });

        it('logs and swallows on error', async () => {
            rpcMock.mockResolvedValueOnce({ error: { message: 'denied' } });
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            await characterApi.bumpMarketSaleRpc({
                sellerCharacterId: 's',
                quantity: 1,
                goldAmount: 1,
            });
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
        });
    });
});

// TODO: We don't directly cover the auth-token interceptor here (that
// lives in axiosInstance.test.ts). The other concrete URL-construction
// edge cases (special characters in user_id) get exercised live by the
// integration suites under tests/integration/.
