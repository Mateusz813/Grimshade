/**
 * Tests for deathsApi — POST to character_deaths + read recent deaths.
 *
 * Both methods are non-throwing: failures should be logged and the
 * caller gets back `null` / `[]` instead of an exception so the death
 * flow never breaks because of a missing table / RLS error.
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
import { deathsApi } from './deathsApi';
import type { IDeathPayload } from './deathsApi';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockApi = api as unknown as Record<string, any>;
const mkRes = <T>(data: T) => ({ data });

beforeEach(() => {
    vi.clearAllMocks();
});

const makePayload = (overrides: Partial<IDeathPayload> = {}): IDeathPayload => ({
    character_id: 'c1',
    character_name: 'Knight1',
    character_class: 'Knight',
    character_level: 10,
    source: 'monster',
    source_name: 'Wolf',
    source_level: 8,
    result: 'killed',
    ...overrides,
});

describe('deathsApi.logDeath', () => {
    it('posts to /rest/v1/character_deaths with return=representation', async () => {
        const inserted = { id: 'd1', ...makePayload(), died_at: '2026-05-21T00:00:00Z' };
        mockApi.post.mockResolvedValueOnce(mkRes([inserted]));

        const result = await deathsApi.logDeath(makePayload());

        const [url, body, config] = mockApi.post.mock.calls[0];
        expect(url).toBe('/rest/v1/character_deaths');
        expect(body).toMatchObject({ character_id: 'c1', source: 'monster' });
        expect(config.headers.Prefer).toBe('return=representation');
        expect(result).toBe(inserted);
    });

    it('returns null when supabase returns an empty array (no row inserted)', async () => {
        mockApi.post.mockResolvedValueOnce(mkRes([]));
        const result = await deathsApi.logDeath(makePayload());
        expect(result).toBeNull();
    });

    it('returns null on error and logs a warning instead of throwing', async () => {
        mockApi.post.mockRejectedValueOnce(new Error('table missing'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await deathsApi.logDeath(makePayload());
        expect(result).toBeNull();
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('[deathsApi]'),
            expect.anything(),
        );
        warn.mockRestore();
    });

    it.each(['monster', 'dungeon', 'boss', 'transform', 'raid'] as const)(
        'accepts source=%s as a valid death source',
        async (source) => {
            mockApi.post.mockResolvedValueOnce(mkRes([{ id: 'd1' }]));
            await deathsApi.logDeath(makePayload({ source }));
            const body = mockApi.post.mock.calls[0][1];
            expect(body.source).toBe(source);
        },
    );

    it.each(['killed', 'fled'] as const)(
        'forwards result=%s in the payload',
        async (result) => {
            mockApi.post.mockResolvedValueOnce(mkRes([{ id: 'd1' }]));
            await deathsApi.logDeath(makePayload({ result }));
            const body = mockApi.post.mock.calls[0][1];
            expect(body.result).toBe(result);
        },
    );
});

describe('deathsApi.listRecentDeaths', () => {
    it('fetches the deaths feed ordered by died_at desc with default limit 100', async () => {
        const rows = [{ id: '1' }, { id: '2' }];
        mockApi.get.mockResolvedValueOnce(mkRes(rows));

        const result = await deathsApi.listRecentDeaths();

        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain('/rest/v1/character_deaths');
        expect(url).toContain('order=died_at.desc');
        expect(url).toContain('limit=100');
        expect(result).toBe(rows);
    });

    it('honours a custom limit', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await deathsApi.listRecentDeaths(25);
        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain('limit=25');
    });

    it('returns [] on error and logs a warning instead of throwing', async () => {
        mockApi.get.mockRejectedValueOnce(new Error('network'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await deathsApi.listRecentDeaths();
        expect(result).toEqual([]);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

// TODO: no tests for the RLS policy in this file — that's the territory
// of the SQL migration test in scripts/. The unit tests here exercise
// the wire shape + fallback behaviour, which is all the helper owns.
