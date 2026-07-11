import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setPendingCommitFlusher, flushPendingCommit } from './pendingCommit';

beforeEach(() => {
    setPendingCommitFlusher(null);
});

describe('pendingCommit', () => {
    it('flushPendingCommit() is a no-op when no flusher is registered', async () => {
        await expect(flushPendingCommit()).resolves.toBeUndefined();
    });

    it('calls the registered flusher', async () => {
        const flusher = vi.fn().mockResolvedValue(undefined);
        setPendingCommitFlusher(flusher);
        await flushPendingCommit();
        expect(flusher).toHaveBeenCalledTimes(1);
    });

    it('swallows flusher errors (best-effort — akcja i tak przechodzi)', async () => {
        setPendingCommitFlusher(vi.fn().mockRejectedValue(new Error('offline')));
        await expect(flushPendingCommit()).resolves.toBeUndefined();
    });

    it('setPendingCommitFlusher(null) unregisters the flusher', async () => {
        const flusher = vi.fn().mockResolvedValue(undefined);
        setPendingCommitFlusher(flusher);
        setPendingCommitFlusher(null);
        await flushPendingCommit();
        expect(flusher).not.toHaveBeenCalled();
    });
});
