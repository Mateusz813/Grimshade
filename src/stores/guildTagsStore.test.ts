import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted Supabase mock ────────────────────────────────────────────────────
// The store reads `guild_members` via the Supabase JS client. The default
// global mock in `tests/vitest.setup.ts` returns `{ data: null }`, so we
// override it locally with a tiny query-builder that resolves with whatever
// `setMockResponse` was last given.

const { fromMock, supabaseModule, setMockResponse } = vi.hoisted(() => {
    const state: { data: Array<Record<string, unknown>> | null; error: unknown } = {
        data: [],
        error: null,
    };
    const inFn = vi.fn();
    inFn.mockImplementation(() => Promise.resolve({ data: state.data, error: state.error }));
    const selectFn = vi.fn().mockReturnValue({ in: inFn });
    const fromFn = vi.fn().mockReturnValue({ select: selectFn });
    return {
        fromMock: fromFn,
        supabaseModule: { supabase: { from: fromFn } },
        setMockResponse: (
            data: Array<Record<string, unknown>> | null,
            error: unknown = null,
        ): void => {
            state.data = data;
            state.error = error;
        },
    };
});

vi.mock('../lib/supabase', () => supabaseModule);

import { useGuildTagsStore, formatNameWithTag } from './guildTagsStore';

beforeEach(() => {
    useGuildTagsStore.setState({ tags: {}, tagsByName: {} });
    fromMock.mockClear();
    setMockResponse([]);
});

// ── Initial state ────────────────────────────────────────────────────────────

describe('guildTagsStore — initial state', () => {
    it('starts with empty tag caches', () => {
        const s = useGuildTagsStore.getState();
        expect(s.tags).toEqual({});
        expect(s.tagsByName).toEqual({});
    });
});

// ── resolveTags (by character id) ────────────────────────────────────────────

describe('resolveTags', () => {
    it('returns an empty record when called with no ids', async () => {
        const r = await useGuildTagsStore.getState().resolveTags([]);
        expect(r).toEqual({});
        expect(fromMock).not.toHaveBeenCalled();
    });

    it('strips falsy ids before querying', async () => {
        const r = await useGuildTagsStore.getState().resolveTags(['', null as unknown as string, undefined as unknown as string]);
        expect(r).toEqual({});
        expect(fromMock).not.toHaveBeenCalled();
    });

    it('fetches and formats tags for misses', async () => {
        setMockResponse([
            { character_id: 'c1', guilds: { tag: 'ABC' } },
            { character_id: 'c2', guilds: { tag: 'XYZ' } },
        ]);
        const r = await useGuildTagsStore.getState().resolveTags(['c1', 'c2']);
        expect(r).toEqual({ c1: '[ABC]', c2: '[XYZ]' });
        // Cache populated for future sync reads.
        expect(useGuildTagsStore.getState().getTagSync('c1')).toBe('[ABC]');
        expect(useGuildTagsStore.getState().getTagSync('c2')).toBe('[XYZ]');
    });

    it('caches empty tag for ids missing from the API response', async () => {
        setMockResponse([{ character_id: 'c1', guilds: { tag: 'ABC' } }]);
        const r = await useGuildTagsStore.getState().resolveTags(['c1', 'c2']);
        expect(r.c1).toBe('[ABC]');
        expect(r.c2).toBe('');
    });

    it('skips Supabase when every id is already fresh in cache', async () => {
        const now = Date.now();
        useGuildTagsStore.setState({
            tags: {
                c1: { tag: '[ABC]', fetchedAt: now },
                c2: { tag: '', fetchedAt: now },
            },
            tagsByName: {},
        });
        const r = await useGuildTagsStore.getState().resolveTags(['c1', 'c2']);
        expect(r).toEqual({ c1: '[ABC]', c2: '' });
        expect(fromMock).not.toHaveBeenCalled();
    });

    it('refetches entries older than the TTL', async () => {
        useGuildTagsStore.setState({
            tags: { c1: { tag: '[OLD]', fetchedAt: 0 } },
            tagsByName: {},
        });
        setMockResponse([{ character_id: 'c1', guilds: { tag: 'NEW' } }]);
        const r = await useGuildTagsStore.getState().resolveTags(['c1']);
        expect(r.c1).toBe('[NEW]');
    });

    it('returns the fresh subset when Supabase errors out', async () => {
        const now = Date.now();
        useGuildTagsStore.setState({
            tags: { c1: { tag: '[ABC]', fetchedAt: now } },
            tagsByName: {},
        });
        setMockResponse(null, { message: 'offline' });
        const r = await useGuildTagsStore.getState().resolveTags(['c1', 'c2']);
        expect(r).toEqual({ c1: '[ABC]' });
    });

    it('deduplicates incoming ids', async () => {
        setMockResponse([{ character_id: 'c1', guilds: { tag: 'ABC' } }]);
        const r = await useGuildTagsStore.getState().resolveTags(['c1', 'c1', 'c1']);
        expect(Object.keys(r)).toEqual(['c1']);
    });

    it('treats null guild relationship as empty tag (no guild)', async () => {
        setMockResponse([{ character_id: 'c1', guilds: null }]);
        const r = await useGuildTagsStore.getState().resolveTags(['c1']);
        expect(r.c1).toBe('');
    });
});

// ── resolveTagsByName ────────────────────────────────────────────────────────

describe('resolveTagsByName', () => {
    it('returns empty when called with no names', async () => {
        const r = await useGuildTagsStore.getState().resolveTagsByName([]);
        expect(r).toEqual({});
    });

    it('fetches and formats tags for unknown names', async () => {
        setMockResponse([
            { character_name: 'Alice', guilds: { tag: 'ABC' } },
        ]);
        const r = await useGuildTagsStore.getState().resolveTagsByName(['Alice']);
        expect(r).toEqual({ Alice: '[ABC]' });
        expect(useGuildTagsStore.getState().getTagByNameSync('Alice')).toBe('[ABC]');
    });

    it('returns an empty tag for names with no guild', async () => {
        setMockResponse([]);
        const r = await useGuildTagsStore.getState().resolveTagsByName(['Bob']);
        expect(r.Bob).toBe('');
    });

    it('does not call Supabase when all names are cached and fresh', async () => {
        const now = Date.now();
        useGuildTagsStore.setState({
            tags: {},
            tagsByName: { Alice: { tag: '[ABC]', fetchedAt: now } },
        });
        const r = await useGuildTagsStore.getState().resolveTagsByName(['Alice']);
        expect(r.Alice).toBe('[ABC]');
        expect(fromMock).not.toHaveBeenCalled();
    });
});

// ── getTagSync / getTagByNameSync ────────────────────────────────────────────

describe('getTagSync', () => {
    it('returns empty string for unknown characterId', () => {
        expect(useGuildTagsStore.getState().getTagSync('unknown')).toBe('');
    });

    it('returns empty string for empty characterId', () => {
        expect(useGuildTagsStore.getState().getTagSync('')).toBe('');
    });

    it('returns the cached tag', () => {
        useGuildTagsStore.setState({
            tags: { c1: { tag: '[ABC]', fetchedAt: Date.now() } },
            tagsByName: {},
        });
        expect(useGuildTagsStore.getState().getTagSync('c1')).toBe('[ABC]');
    });
});

describe('getTagByNameSync', () => {
    it('returns empty for empty name', () => {
        expect(useGuildTagsStore.getState().getTagByNameSync('')).toBe('');
    });

    it('returns empty for unknown name', () => {
        expect(useGuildTagsStore.getState().getTagByNameSync('Nobody')).toBe('');
    });

    it('returns the cached tag', () => {
        useGuildTagsStore.setState({
            tags: {},
            tagsByName: { Alice: { tag: '[GLD]', fetchedAt: Date.now() } },
        });
        expect(useGuildTagsStore.getState().getTagByNameSync('Alice')).toBe('[GLD]');
    });
});

// ── invalidate ───────────────────────────────────────────────────────────────

describe('invalidate', () => {
    it('clears EVERY cache entry when called with no arguments', () => {
        const now = Date.now();
        useGuildTagsStore.setState({
            tags: { c1: { tag: '[ABC]', fetchedAt: now } },
            tagsByName: { Alice: { tag: '[ABC]', fetchedAt: now } },
        });
        useGuildTagsStore.getState().invalidate();
        const s = useGuildTagsStore.getState();
        expect(s.tags).toEqual({});
        expect(s.tagsByName).toEqual({});
    });

    it('removes only the requested ids when given a list', () => {
        const now = Date.now();
        useGuildTagsStore.setState({
            tags: {
                c1: { tag: '[A]', fetchedAt: now },
                c2: { tag: '[B]', fetchedAt: now },
            },
            tagsByName: {},
        });
        useGuildTagsStore.getState().invalidate(['c1']);
        const s = useGuildTagsStore.getState();
        expect(s.tags.c1).toBeUndefined();
        expect(s.tags.c2).toBeDefined();
    });

    it('is safe with an unknown id list', () => {
        const now = Date.now();
        useGuildTagsStore.setState({
            tags: { c1: { tag: '[A]', fetchedAt: now } },
            tagsByName: {},
        });
        useGuildTagsStore.getState().invalidate(['nope']);
        expect(useGuildTagsStore.getState().tags.c1).toBeDefined();
    });
});

// ── formatNameWithTag helper ─────────────────────────────────────────────────

describe('formatNameWithTag', () => {
    it('returns the raw name when characterId is missing', () => {
        expect(formatNameWithTag('Alice')).toBe('Alice');
        expect(formatNameWithTag('Alice', null)).toBe('Alice');
    });

    it('returns the raw name when no tag is cached', () => {
        expect(formatNameWithTag('Alice', 'c1')).toBe('Alice');
    });

    it('prepends the cached tag with a space separator', () => {
        useGuildTagsStore.setState({
            tags: { c1: { tag: '[ABC]', fetchedAt: Date.now() } },
            tagsByName: {},
        });
        expect(formatNameWithTag('Alice', 'c1')).toBe('[ABC] Alice');
    });
});
