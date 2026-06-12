/**
 * Tests for friendsApi — character lookups + PM channel builder.
 *
 * The class exposes `findByName` (ILIKE prefix match) and
 * `findManyByName` (IN(...) batch lookup). Both decorate raw rows with
 * an `online` heuristic (true if updated_at < 5 minutes ago).
 *
 * The free function `buildPmChannel` builds a deterministic channel id
 * for two character names.
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
import { friendsApi, buildPmChannel } from './friendsApi';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockApi = api as unknown as Record<string, any>;
const mkRes = <T>(data: T) => ({ data });

beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
});

const makeRow = (overrides = {}) => ({
    id: 'c1',
    name: 'Knight1',
    class: 'Knight',
    level: 10,
    updated_at: new Date().toISOString(),
    ...overrides,
});

describe('friendsApi.findByName', () => {
    it('returns null when the search input is empty (no whitespace)', async () => {
        await expect(friendsApi.findByName('')).resolves.toBeNull();
        await expect(friendsApi.findByName('   ')).resolves.toBeNull();
        expect(mockApi.get).not.toHaveBeenCalled();
    });

    it('encodes the ILIKE pattern with a wildcard suffix', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([makeRow({ name: 'Knight' })]));
        await friendsApi.findByName('Knigh');
        const url = mockApi.get.mock.calls[0][0] as string;
        // `clean+*` then encodeURIComponent — `*` survives, `Knigh*` becomes Knigh*
        expect(url).toContain('name=ilike.' + encodeURIComponent('Knigh*'));
        expect(url).toContain('limit=5');
        expect(url).toContain('order=name.asc');
    });

    it('returns null when no candidates match', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const result = await friendsApi.findByName('Ghost');
        expect(result).toBeNull();
    });

    it('prefers an EXACT case-insensitive name match over the first alphabetical hit', async () => {
        // Alphabetical first hit would be "Knight2", but query was "Knight"
        const rows = [makeRow({ id: 'b', name: 'Knight2' }), makeRow({ id: 'a', name: 'Knight' })];
        mockApi.get.mockResolvedValueOnce(mkRes(rows));
        const result = await friendsApi.findByName('Knight');
        expect(result?.id).toBe('a'); // exact match wins
    });

    it('falls back to first alphabetical when no exact match exists', async () => {
        const rows = [makeRow({ id: 'b', name: 'Knight2' }), makeRow({ id: 'c', name: 'Knight3' })];
        mockApi.get.mockResolvedValueOnce(mkRes(rows));
        const result = await friendsApi.findByName('Kn');
        expect(result?.id).toBe('b'); // first in response
    });

    it('marks a character as online when updated_at < 5 minutes ago', async () => {
        const recent = new Date(Date.now() - 60_000).toISOString();
        mockApi.get.mockResolvedValueOnce(mkRes([makeRow({ updated_at: recent })]));
        const result = await friendsApi.findByName('Knight1');
        expect(result?.online).toBe(true);
    });

    it('marks a character as offline when updated_at > 5 minutes ago', async () => {
        const stale = new Date(Date.now() - 10 * 60_000).toISOString();
        mockApi.get.mockResolvedValueOnce(mkRes([makeRow({ updated_at: stale })]));
        const result = await friendsApi.findByName('Knight1');
        expect(result?.online).toBe(false);
    });

    it('marks online=false for an unparseable updated_at', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([makeRow({ updated_at: 'not-a-date' })]));
        const result = await friendsApi.findByName('Knight1');
        expect(result?.online).toBe(false);
    });
});

describe('friendsApi.findManyByName', () => {
    it('returns [] for empty input', async () => {
        await expect(friendsApi.findManyByName([])).resolves.toEqual([]);
        await expect(friendsApi.findManyByName(['', '  '])).resolves.toEqual([]);
        expect(mockApi.get).not.toHaveBeenCalled();
    });

    it('deduplicates + trims names and builds a quoted IN list', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await friendsApi.findManyByName(['Alice ', 'Bob', 'alice', 'Alice']);
        const url = mockApi.get.mock.calls[0][0] as string;
        // Dedupe is case-sensitive on the raw value but trims whitespace.
        // We expect "Alice", "Bob", "alice" in the IN list (3 distinct values).
        const inMatch = url.match(/name=in\.\(([^)]+)\)/);
        expect(inMatch).toBeTruthy();
        const inList = decodeURIComponent(inMatch![1]);
        expect(inList).toContain('"Alice"');
        expect(inList).toContain('"Bob"');
        expect(inList).toContain('"alice"');
    });

    it('escapes embedded double quotes in names', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await friendsApi.findManyByName(['Knight"X']);
        const url = mockApi.get.mock.calls[0][0] as string;
        // The internal quoting escapes "X with backslash before URL-encoding.
        expect(decodeURIComponent(url)).toContain('"Knight\\"X"');
    });

    it('decorates every row with online status', async () => {
        const stale = new Date(Date.now() - 10 * 60_000).toISOString();
        const fresh = new Date(Date.now() - 60_000).toISOString();
        mockApi.get.mockResolvedValueOnce(
            mkRes([
                { id: 'a', name: 'Alice', class: 'Mage', level: 5, updated_at: fresh },
                { id: 'b', name: 'Bob', class: 'Knight', level: 7, updated_at: stale },
            ]),
        );
        const result = await friendsApi.findManyByName(['Alice', 'Bob']);
        expect(result[0].online).toBe(true);
        expect(result[1].online).toBe(false);
    });
});

describe('buildPmChannel', () => {
    it('produces the same channel id regardless of argument order', () => {
        expect(buildPmChannel('Alice', 'Bob')).toBe(buildPmChannel('Bob', 'Alice'));
    });

    it('sorts case-insensitively', () => {
        // 'alice' < 'BOB' case-insensitively -> alice first.
        expect(buildPmChannel('BOB', 'alice')).toBe('pm_alice_BOB');
    });

    it('preserves original casing of names', () => {
        // Order is decided by lower-case sort, but the strings keep their case.
        expect(buildPmChannel('Knight', 'Mage')).toBe('pm_Knight_Mage');
    });

    it('trims whitespace from inputs', () => {
        expect(buildPmChannel('  Alice ', ' Bob')).toBe('pm_Alice_Bob');
    });
});

// TODO: no test exercises the actual case-insensitive collator over
// locale-specific characters (e.g. Polish ł). Left for an i18n pass —
// the current implementation uses default `localeCompare` so it should
// behave correctly for the small set of allowed characters in player
// nicknames.
