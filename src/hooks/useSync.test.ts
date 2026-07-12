import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSync } from './useSync';
import { useSyncStore } from '../stores/syncStore';


const syncToCloudMock = vi.fn().mockResolvedValue(undefined);
const saveStoresMock = vi.fn().mockResolvedValue(undefined);
const getActiveCharacterIdMock = vi.fn();

vi.mock('../storage/gameStorage', () => ({
    syncToCloud: (...args: unknown[]) => syncToCloudMock(...args),
}));

vi.mock('../stores/characterScope', () => ({
    getActiveCharacterId: () => getActiveCharacterIdMock(),
    saveCurrentCharacterStores: () => saveStoresMock(),
}));

beforeEach(() => {
    useSyncStore.setState({
        isOnline: true,
        lastSynced: null,
        isSyncing: false,
    });
    syncToCloudMock.mockClear();
    saveStoresMock.mockClear();
    getActiveCharacterIdMock.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useSync — initial', () => {
    it('returns current sync state from the store', () => {
        useSyncStore.setState({
            isOnline: false,
            isSyncing: true,
            lastSynced: '2026-01-01T00:00:00.000Z',
        });
        const { result } = renderHook(() => useSync());
        expect(result.current.isOnline).toBe(false);
        expect(result.current.isSyncing).toBe(true);
        expect(result.current.lastSynced).toBe('2026-01-01T00:00:00.000Z');
    });

    it('exposes a callable doSync function', () => {
        const { result } = renderHook(() => useSync());
        expect(typeof result.current.doSync).toBe('function');
    });
});

describe('useSync — doSync', () => {
    it('is a no-op when offline', async () => {
        useSyncStore.setState({ isOnline: false });
        const { result } = renderHook(() => useSync());
        await act(async () => {
            await result.current.doSync();
        });
        expect(syncToCloudMock).not.toHaveBeenCalled();
        expect(saveStoresMock).not.toHaveBeenCalled();
    });

    it('is a no-op when already syncing', async () => {
        useSyncStore.setState({ isOnline: true, isSyncing: true });
        const { result } = renderHook(() => useSync());
        await act(async () => {
            await result.current.doSync();
        });
        expect(syncToCloudMock).not.toHaveBeenCalled();
    });

    it('is a no-op when there is no active character', async () => {
        getActiveCharacterIdMock.mockReturnValue(null);
        const { result } = renderHook(() => useSync());
        await act(async () => {
            await result.current.doSync();
        });
        expect(saveStoresMock).not.toHaveBeenCalled();
        expect(syncToCloudMock).not.toHaveBeenCalled();
    });

    it('saves stores then pushes to Supabase when conditions are met', async () => {
        getActiveCharacterIdMock.mockReturnValue('char-1');
        const { result } = renderHook(() => useSync());
        await act(async () => {
            await result.current.doSync();
        });
        expect(saveStoresMock).toHaveBeenCalledTimes(1);
        expect(syncToCloudMock).toHaveBeenCalledWith('char-1');
        expect(useSyncStore.getState().lastSynced).not.toBeNull();
    });

    it('always clears the isSyncing flag, even on error', async () => {
        getActiveCharacterIdMock.mockReturnValue('char-1');
        syncToCloudMock.mockRejectedValueOnce(new Error('network'));
        const { result } = renderHook(() => useSync());
        await act(async () => {
            await result.current.doSync();
        });
        expect(useSyncStore.getState().isSyncing).toBe(false);
    });
});

describe('useSync — 5-minute interval', () => {
    it('does not fire sync immediately on mount via the interval (only on tick)', () => {
        vi.useFakeTimers();
        getActiveCharacterIdMock.mockReturnValue('char-1');
        renderHook(() => useSync());
        expect(syncToCloudMock).not.toHaveBeenCalled();
    });

    it('fires doSync after the interval elapses', async () => {
        vi.useFakeTimers();
        getActiveCharacterIdMock.mockReturnValue('char-1');
        renderHook(() => useSync());
        syncToCloudMock.mockClear();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
        });
        expect(syncToCloudMock).toHaveBeenCalled();
    });

    it('does not crash when unmounted and timers advance', async () => {
        vi.useFakeTimers();
        getActiveCharacterIdMock.mockReturnValue('char-1');
        const { unmount } = renderHook(() => useSync());
        unmount();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
        });
        expect(true).toBe(true);
    });
});

describe('useSync — reconnect', () => {
    it('triggers a sync when isOnline flips to true with no prior sync', async () => {
        useSyncStore.setState({ isOnline: false, lastSynced: null });
        getActiveCharacterIdMock.mockReturnValue('char-1');
        const { rerender } = renderHook(() => useSync());
        await act(async () => {
            useSyncStore.setState({ isOnline: true });
            rerender();
            await Promise.resolve();
            await Promise.resolve();
        });
        await waitFor(() => {
            expect(syncToCloudMock).toHaveBeenCalled();
        });
    });

    it('does NOT trigger sync if last sync is within the reconnect gap (30s)', async () => {
        const recent = new Date(Date.now() - 5_000).toISOString();
        useSyncStore.setState({ isOnline: false, lastSynced: recent });
        getActiveCharacterIdMock.mockReturnValue('char-1');
        const { rerender } = renderHook(() => useSync());
        await act(async () => {
            useSyncStore.setState({ isOnline: true });
            rerender();
            await Promise.resolve();
        });
        expect(syncToCloudMock).not.toHaveBeenCalled();
    });
});
