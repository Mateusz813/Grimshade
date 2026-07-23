import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    commitStateToBackend,
    commitStateViaKeepalive,
    retryPendingCommit,
    readPendingCommit,
    clearPendingCommit,
    readBaseUpdatedAt,
} from './commit';
import { backendApi } from './backendApi';

vi.mock('../../config/backendMode', () => ({
    isBackendMode: vi.fn(() => true),
    getBackendBaseUrl: vi.fn(() => 'http://localhost:8088'),
}));
vi.mock('./backendApi', () => ({
    backendApi: { commitState: vi.fn() },
}));
vi.mock('./authToken', () => ({ getAuthToken: vi.fn(() => 'jwt') }));
const syncMock = vi.fn().mockResolvedValue(undefined);
vi.mock('./syncState', () => ({ syncFromBackend: (...a: unknown[]) => syncMock(...a) }));

const CHAR = 'char-queue-1';
const SAVE_KEY = `dungeon_rpg_save_char_${CHAR}`;
const mockCommit = backendApi.commitState as unknown as ReturnType<typeof vi.fn>;

const seedLocalSave = (level: number, updatedAt: string): void => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
        state: { _characterStats: { level, highest_level: level } },
        updated_at: updatedAt,
    }));
};

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
});

describe('pending commit queue — nothing is ever silently dropped', () => {
    it('keeps the state locally when the network call fails, instead of losing it', async () => {
        seedLocalSave(362, '2026-07-22T09:00:00Z');
        mockCommit.mockRejectedValueOnce(new Error('network down'));

        const ok = await commitStateToBackend(CHAR);

        expect(ok).toBe(false);
        const pending = readPendingCommit(CHAR);
        expect(pending).not.toBeNull();
        expect(pending?.reason).toBe('network');
        expect((pending?.state._characterStats as { level: number }).level).toBe(362);
    });

    it('on a 409 stale-base conflict DROPS the stale blob and resyncs from the server (never queues it for replay)', async () => {
        seedLocalSave(362, '2026-07-22T09:00:00Z');
        mockCommit.mockRejectedValueOnce({ response: { status: 409, data: { reason: 'stale_base' } } });

        const ok = await commitStateToBackend(CHAR);

        expect(ok).toBe(false);
        expect(readPendingCommit(CHAR)).toBeNull();
        await vi.waitFor(() => expect(syncMock).toHaveBeenCalledWith(CHAR));
    });

    it('resends the queued state on the next retry and clears the queue on success', async () => {
        seedLocalSave(362, '2026-07-22T09:00:00Z');
        mockCommit.mockRejectedValueOnce(new Error('boom'));
        await commitStateToBackend(CHAR);
        expect(readPendingCommit(CHAR)).not.toBeNull();

        mockCommit.mockResolvedValueOnce({});
        const retried = await retryPendingCommit(CHAR);

        expect(retried).toBe(true);
        expect(readPendingCommit(CHAR)).toBeNull();
        const [, sentState] = mockCommit.mock.calls[1];
        expect((sentState as { _characterStats: { level: number } })._characterStats.level).toBe(362);
    });

    it('replays with the base captured AT QUEUE TIME, never a fresh one — a stale blob cannot impersonate the latest state', async () => {
        seedLocalSave(362, '2026-07-22T09:00:00Z');
        mockCommit.mockRejectedValueOnce(new Error('boom'));
        await commitStateToBackend(CHAR);

        seedLocalSave(370, '2026-07-22T11:00:00Z');
        mockCommit.mockResolvedValueOnce({});
        await retryPendingCommit(CHAR);

        expect(mockCommit.mock.calls[1][3]).toBe('2026-07-22T09:00:00Z');
    });

    it('a queued replay that hits 409 is DROPPED and triggers a server resync — yesterday\'s state can never overwrite today', async () => {
        seedLocalSave(362, '2026-07-22T09:00:00Z');
        mockCommit.mockRejectedValueOnce(new Error('boom'));
        await commitStateToBackend(CHAR);
        expect(readPendingCommit(CHAR)).not.toBeNull();

        mockCommit.mockRejectedValueOnce({ response: { status: 409 } });
        const retried = await retryPendingCommit(CHAR);

        expect(retried).toBe(false);
        expect(readPendingCommit(CHAR)).toBeNull();
        await vi.waitFor(() => expect(syncMock).toHaveBeenCalledWith(CHAR));
    });

    it('keeps the entry queued when the retry also fails, and counts attempts', async () => {
        seedLocalSave(362, '2026-07-22T09:00:00Z');
        mockCommit.mockRejectedValue(new Error('still down'));

        await commitStateToBackend(CHAR);
        await retryPendingCommit(CHAR);

        expect(readPendingCommit(CHAR)).not.toBeNull();
        expect(readPendingCommit(CHAR)?.attempts).toBeGreaterThanOrEqual(1);
    });

    it('clears the queue after a successful direct commit', async () => {
        seedLocalSave(362, '2026-07-22T09:00:00Z');
        mockCommit.mockRejectedValueOnce(new Error('boom'));
        await commitStateToBackend(CHAR);
        expect(readPendingCommit(CHAR)).not.toBeNull();

        mockCommit.mockResolvedValueOnce({});
        await commitStateToBackend(CHAR);

        expect(readPendingCommit(CHAR)).toBeNull();
    });

    it('is a no-op when there is nothing queued', async () => {
        await expect(retryPendingCommit(CHAR)).resolves.toBe(false);
        expect(mockCommit).not.toHaveBeenCalled();
    });

    it('sends the local base version so the server can detect a stale write', async () => {
        seedLocalSave(362, '2026-07-22T09:00:00Z');
        mockCommit.mockResolvedValueOnce({});

        await commitStateToBackend(CHAR);

        expect(readBaseUpdatedAt(CHAR)).toBe('2026-07-22T09:00:00Z');
        expect(mockCommit.mock.calls[0][3]).toBe('2026-07-22T09:00:00Z');
    });

    it('queues the state BEFORE the exit request, so a killed unload still gets retried', () => {
        seedLocalSave(362, '2026-07-22T09:00:00Z');
        const fetchMock = vi.fn(() => new Promise(() => {}));
        vi.stubGlobal('fetch', fetchMock);

        commitStateViaKeepalive(CHAR);

        const pending = readPendingCommit(CHAR);
        expect(pending).not.toBeNull();
        expect((pending?.state._characterStats as { level: number }).level).toBe(362);
        expect(pending?.baseUpdatedAt).toBe('2026-07-22T09:00:00Z');
        expect(fetchMock).toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('marks an oversized blob so it is obvious the unload request could not use keepalive', () => {
        const fat = { _characterStats: { level: 362 }, filler: 'x'.repeat(70_000) };
        localStorage.setItem(SAVE_KEY, JSON.stringify({ state: fat, updated_at: '2026-07-22T09:00:00Z' }));
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

        commitStateViaKeepalive(CHAR);

        expect(readPendingCommit(CHAR)?.reason).toBe('keepalive_oversized');
        vi.unstubAllGlobals();
    });

    it('drops a legacy queue entry that has no stored base version instead of replaying it unchecked', async () => {
        localStorage.setItem(`dungeon_rpg_pending_commit_${CHAR}`, JSON.stringify({
            state: { _characterStats: { level: 346 } }, reason: 'keepalive', queuedAt: 'old', attempts: 1,
        }));

        const retried = await retryPendingCommit(CHAR);

        expect(retried).toBe(false);
        expect(readPendingCommit(CHAR)).toBeNull();
        expect(mockCommit).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(syncMock).toHaveBeenCalledWith(CHAR));
    });

    it('clearPendingCommit removes the entry', () => {
        seedLocalSave(1, 'x');
        localStorage.setItem(`dungeon_rpg_pending_commit_${CHAR}`, JSON.stringify({ state: {}, reason: 'x', queuedAt: 'y', attempts: 1, baseUpdatedAt: null }));
        clearPendingCommit(CHAR);
        expect(readPendingCommit(CHAR)).toBeNull();
    });
});
