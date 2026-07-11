/**
 * Tests for per-character game-save storage.
 *
 * The module persists to BOTH localStorage (instant, works offline)
 * AND Supabase (`game_saves` table). Newest `updated_at` wins on
 * load conflict. Supabase is mocked globally in
 * `tests/vitest.setup.ts` — every call is a no-op returning
 * `{ data: null, error: null }` unless we override the mock here.
 *
 * What we cover per export:
 *   - saveGame    — writes localStorage; calls supabase.upsert iff
 *                   a session exists; swallows storage errors.
 *   - loadGame    — pulls cloud + local; resolves newest-wins;
 *                   mirrors cloud back to localStorage when cloud
 *                   is newer; returns null when both are empty.
 *   - syncToCloud — pushes localStorage payload to Supabase;
 *                   no-op when localStorage is empty / no session.
 *   - deleteGameSave — removes localStorage; deletes Supabase row
 *                   when a session exists; no-op when not.
 *
 * Each test cleans the global mocks via the `afterEach` hook in
 * `vitest.setup.ts` so tests are independent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    saveGame,
    loadGame,
    syncToCloud,
    deleteGameSave,
} from './gameStorage';
import { supabase } from '../lib/supabase';
import { isBackendMode } from '../config/backendMode';
import { commitStateToBackend } from '../api/backend/commit';

vi.mock('../config/backendMode', () => ({
    isBackendMode: vi.fn(() => false),
}));
// W trybie backendu zapis idzie autorytatywnym commitem do backendu (nie do
// Supabase). Mockujemy go, żeby test był izolowany (bez realnego axiosa).
vi.mock('../api/backend/commit', () => ({
    commitStateToBackend: vi.fn().mockResolvedValue(undefined),
}));

const CHAR_ID = 'char-test-1';
const STORAGE_KEY = `dungeon_rpg_save_char_${CHAR_ID}`;

const withSession = (): void => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { session: { user: { id: 'user-1' } } as any },
        error: null,
    });
};

const withoutSession = (): void => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: null },
        error: null,
    });
};

/**
 * Installs an awaitable chain on supabase.from so the `await supabase.from(...).upsert(...)`
 * pattern in gameStorage resolves cleanly. The global setup chain has a `.then` that
 * returns a promise but never invokes the await protocol's resolve callback, so we override
 * here. Each terminal method (upsert/delete) returns a real Promise.
 */
const installAwaitableChain = (): void => {
    const terminal = (): Promise<{ data: null; error: null }> =>
        Promise.resolve({ data: null, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn(terminal),
        update: vi.fn(terminal),
        upsert: vi.fn(terminal),
        delete: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        in: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        // `await chain` calls then(onFulfilled, onRejected) — invoke directly.
        then: (onFulfilled: (v: { data: null; error: null }) => unknown) => {
            return Promise.resolve({ data: null, error: null }).then(onFulfilled);
        },
    };
    vi.mocked(supabase.from).mockReturnValue(chain);
};

beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    // Domyślnie tryb backendu WYŁĄCZONY — istniejące zachowanie (zapis do chmury) bez zmian.
    vi.mocked(isBackendMode).mockReturnValue(false);
});

// -- saveGame ----------------------------------------------------------------

describe('saveGame', () => {
    it('writes the state + ISO timestamp into localStorage', async () => {
        withoutSession();
        await saveGame(CHAR_ID, { hp: 100 });

        const raw = window.localStorage.getItem(STORAGE_KEY);
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!) as { state: Record<string, unknown>; updated_at: string };
        expect(parsed.state).toEqual({ hp: 100 });
        // ISO 8601 ends with "Z" (UTC) in Node/happy-dom.
        expect(parsed.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('uses a per-character localStorage key', async () => {
        withoutSession();
        await saveGame('char-a', { x: 1 });
        await saveGame('char-b', { x: 2 });

        expect(window.localStorage.getItem('dungeon_rpg_save_char_char-a')).toContain('"x":1');
        expect(window.localStorage.getItem('dungeon_rpg_save_char_char-b')).toContain('"x":2');
    });

    it('does NOT call supabase.from when there is no session', async () => {
        withoutSession();
        await saveGame(CHAR_ID, { hp: 100 });
        expect(supabase.from).not.toHaveBeenCalled();
    });

    it('calls supabase.from("game_saves").upsert when a session exists', async () => {
        withSession();
        installAwaitableChain();
        await saveGame(CHAR_ID, { hp: 100 });
        expect(supabase.from).toHaveBeenCalledWith('game_saves');
    });

    it('swallows localStorage errors silently (quota full)', async () => {
        withoutSession();
        const original = window.localStorage.setItem.bind(window.localStorage);
        const spy = vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });

        // Must not throw even though setItem blows up.
        await expect(saveGame(CHAR_ID, { hp: 100 })).resolves.toBeUndefined();

        spy.mockRestore();
        // restore real implementation for downstream tests
        void original;
    });
});

// -- loadGame ----------------------------------------------------------------

describe('loadGame', () => {
    it('returns null when nothing exists locally and no session is present', async () => {
        withoutSession();
        const result = await loadGame(CHAR_ID);
        expect(result).toBeNull();
    });

    it('returns the localStorage payload when only local data exists', async () => {
        withoutSession();
        const payload = { state: { hp: 50 }, updated_at: new Date().toISOString() };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

        const result = await loadGame(CHAR_ID);
        expect(result).toEqual({ hp: 50 });
    });

    it('returns null when localStorage holds corrupt JSON and no session', async () => {
        withoutSession();
        window.localStorage.setItem(STORAGE_KEY, '{not valid json}');
        const result = await loadGame(CHAR_ID);
        expect(result).toBeNull();
    });

    it('handles a localStorage entry missing `updated_at` (legacy save)', async () => {
        withoutSession();
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ state: { legacy: true } }),
        );
        // No timestamp -> localUpdated = 0; without cloud data we still
        // return the local state (it's better than null).
        const result = await loadGame(CHAR_ID);
        expect(result).toEqual({ legacy: true });
    });
});

// -- syncToCloud -------------------------------------------------------------

describe('syncToCloud', () => {
    it('is a no-op when localStorage has no data for the character', async () => {
        withSession();
        await syncToCloud(CHAR_ID);
        // Never reached the auth check because the early return fires first.
        expect(supabase.auth.getSession).not.toHaveBeenCalled();
        expect(supabase.from).not.toHaveBeenCalled();
    });

    it('is a no-op when localStorage has data but no session is present', async () => {
        withoutSession();
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ state: { x: 1 }, updated_at: new Date().toISOString() }),
        );
        await syncToCloud(CHAR_ID);
        // It DID check the session, but bailed out before calling .from
        expect(supabase.auth.getSession).toHaveBeenCalled();
        expect(supabase.from).not.toHaveBeenCalled();
    });

    it('uploads the localStorage payload to game_saves when authenticated', async () => {
        withSession();
        installAwaitableChain();
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ state: { x: 1 }, updated_at: '2026-05-21T10:00:00.000Z' }),
        );
        await syncToCloud(CHAR_ID);
        expect(supabase.from).toHaveBeenCalledWith('game_saves');
    });

    it('swallows JSON.parse errors when localStorage is corrupt', async () => {
        withSession();
        window.localStorage.setItem(STORAGE_KEY, '{not valid');
        // Inner try/catch on supabase.* swallows the parse exception too.
        await expect(syncToCloud(CHAR_ID)).resolves.toBeUndefined();
    });
});

// -- deleteGameSave ----------------------------------------------------------

describe('deleteGameSave', () => {
    it('removes the localStorage entry', async () => {
        withoutSession();
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: {}, updated_at: '' }));
        await deleteGameSave(CHAR_ID);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('does NOT touch supabase when no session is present', async () => {
        withoutSession();
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: {}, updated_at: '' }));
        await deleteGameSave(CHAR_ID);
        expect(supabase.from).not.toHaveBeenCalled();
    });

    it('calls supabase.from("game_saves").delete when a session exists', async () => {
        withSession();
        installAwaitableChain();
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: {}, updated_at: '' }));
        await deleteGameSave(CHAR_ID);
        expect(supabase.from).toHaveBeenCalledWith('game_saves');
    });

    it('is safe to call when no save exists locally', async () => {
        withoutSession();
        await expect(deleteGameSave(CHAR_ID)).resolves.toBeUndefined();
    });
});

// -- backend mode (server is the sole writer) --------------------------------

describe('backend mode (isBackendMode)', () => {
    it('saveGame keeps the localStorage cache and commits to the backend (not Supabase)', async () => {
        vi.mocked(isBackendMode).mockReturnValue(true);
        vi.mocked(commitStateToBackend).mockClear();
        withSession();

        await saveGame(CHAR_ID, { hp: 100 });

        // Local cache still written (offline UX, instant reads)…
        expect(window.localStorage.getItem(STORAGE_KEY)).toContain('"hp":100');
        // …stan idzie autorytatywnym commitem do backendu (jedyny zapisujący)…
        expect(commitStateToBackend).toHaveBeenCalledWith(CHAR_ID);
        // …a NIE bezpośrednim zapisem do Supabase (brak furtki client-write).
        expect(supabase.from).not.toHaveBeenCalled();
    });

    it('syncToCloud commits to the backend when backend mode is on (no Supabase upsert)', async () => {
        vi.mocked(isBackendMode).mockReturnValue(true);
        vi.mocked(commitStateToBackend).mockClear();
        withSession();
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ state: { x: 1 }, updated_at: new Date().toISOString() }),
        );

        await syncToCloud(CHAR_ID);

        expect(commitStateToBackend).toHaveBeenCalledWith(CHAR_ID);
        expect(supabase.from).not.toHaveBeenCalled();
    });

    it('deleteGameSave clears the localStorage cache but does NOT DELETE from Supabase', async () => {
        vi.mocked(isBackendMode).mockReturnValue(true);
        withSession();
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: {}, updated_at: '' }));

        await deleteGameSave(CHAR_ID);

        // Local cache is still purged (this browser forgets the character)…
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
        // …but the server owns the game_saves row (deleted in its delete txn) —
        // no direct client DELETE, so no bypass of the authoritative path.
        expect(supabase.auth.getSession).not.toHaveBeenCalled();
        expect(supabase.from).not.toHaveBeenCalled();
    });
});
