import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useWakeLock, isWakeLockSupported } from './useWakeLock';

/**
 * useWakeLock tests — we stub `navigator.wakeLock` with a fake that records
 * request/release calls and lets us fire the OS-driven 'release' event +
 * visibilitychange so we can assert the re-acquire-on-visible behaviour.
 */

interface IFakeSentinel {
    released: boolean;
    release: ReturnType<typeof vi.fn>;
    addEventListener: (type: 'release', cb: () => void) => void;
    _fireRelease: () => void;
}

const makeSentinel = (): IFakeSentinel => {
    let cb: (() => void) | null = null;
    const s: IFakeSentinel = {
        released: false,
        release: vi.fn(async () => { s.released = true; }),
        addEventListener: (_t, fn) => { cb = fn; },
        _fireRelease: () => { s.released = true; cb?.(); },
    };
    return s;
};

let requestSpy: ReturnType<typeof vi.fn>;
let sentinels: IFakeSentinel[];
let originalWakeLock: unknown;
let visibility: DocumentVisibilityState;

const setVisibility = (v: DocumentVisibilityState) => {
    visibility = v;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
};

beforeEach(() => {
    sentinels = [];
    visibility = 'visible';
    setVisibility('visible');
    requestSpy = vi.fn(async () => { const s = makeSentinel(); sentinels.push(s); return s; });
    originalWakeLock = (navigator as unknown as Record<string, unknown>).wakeLock;
    Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: { request: requestSpy },
    });
});

afterEach(() => {
    cleanup();
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: originalWakeLock });
    vi.restoreAllMocks();
});

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('useWakeLock', () => {
    it('isWakeLockSupported reflects navigator.wakeLock presence', () => {
        expect(isWakeLockSupported()).toBe(true);
    });

    it('requests a screen wake lock when enabled', async () => {
        renderHook(() => useWakeLock(true));
        await flush();
        expect(requestSpy).toHaveBeenCalledWith('screen');
        expect(sentinels).toHaveLength(1);
    });

    it('does NOT request when disabled', async () => {
        renderHook(() => useWakeLock(false));
        await flush();
        expect(requestSpy).not.toHaveBeenCalled();
    });

    it('releases the lock on unmount', async () => {
        const { unmount } = renderHook(() => useWakeLock(true));
        await flush();
        const s = sentinels[0];
        unmount();
        await flush();
        expect(s.release).toHaveBeenCalled();
    });

    it('re-acquires after the OS releases it and the page becomes visible again', async () => {
        renderHook(() => useWakeLock(true));
        await flush();
        expect(requestSpy).toHaveBeenCalledTimes(1);

        // OS releases the sentinel (page hidden), then the user returns.
        sentinels[0]._fireRelease();
        setVisibility('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        await flush();

        expect(requestSpy).toHaveBeenCalledTimes(2);
    });

    it('does not request while the document is hidden', async () => {
        setVisibility('hidden');
        renderHook(() => useWakeLock(true));
        await flush();
        expect(requestSpy).not.toHaveBeenCalled();
    });

    it('no-ops (no throw) when the Wake Lock API is unavailable', async () => {
        Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
        expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
        await flush();
        expect(requestSpy).not.toHaveBeenCalled();
    });
});
