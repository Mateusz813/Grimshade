import { useEffect, useRef } from 'react';

/**
 * Keep the screen awake while the game is running (Screen Wake Lock API).
 *
 * Grimshade is an idle/auto-combat PWA — fights tick on their own, so the phone
 * auto-locking mid-hunt is annoying. While `enabled` is true we hold a screen
 * wake lock so the display never dims/locks.
 *
 * Lifecycle quirks handled here:
 *  - Feature detection: `navigator.wakeLock` is absent on older browsers
 *    (pre-iOS 16.4, some desktops) — we no-op gracefully.
 *  - The OS auto-RELEASES the sentinel whenever the page is hidden (tab switch,
 *    manual lock). We listen for `visibilitychange` and re-acquire when the page
 *    becomes visible again, so returning to the app re-arms the lock.
 *  - `request()` can reject (e.g. low battery, not user-focused) — swallowed.
 *  - Released on unmount or when `enabled` flips to false.
 *
 * Typed against a minimal local interface so we don't depend on the (still
 * patchy) lib.dom WakeLock typings.
 */

interface IWakeLockSentinel {
    readonly released: boolean;
    release: () => Promise<void>;
    addEventListener: (type: 'release', listener: () => void) => void;
}

interface IWakeLockNavigator {
    wakeLock?: { request: (type: 'screen') => Promise<IWakeLockSentinel> };
}

export const isWakeLockSupported = (): boolean =>
    typeof navigator !== 'undefined' && 'wakeLock' in navigator;

export const useWakeLock = (enabled: boolean): void => {
    const sentinelRef = useRef<IWakeLockSentinel | null>(null);

    useEffect(() => {
        if (!enabled || !isWakeLockSupported()) return;
        const wakeLock = (navigator as unknown as IWakeLockNavigator).wakeLock;
        if (!wakeLock) return;

        let cancelled = false;

        const acquire = async (): Promise<void> => {
            if (cancelled || sentinelRef.current) return;
            // request() only succeeds while the document is visible.
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            try {
                const sentinel = await wakeLock.request('screen');
                if (cancelled) {
                    void sentinel.release().catch(() => { /* noop */ });
                    return;
                }
                sentinelRef.current = sentinel;
                // The OS clears the lock when the page hides — keep our ref honest.
                sentinel.addEventListener('release', () => {
                    if (sentinelRef.current === sentinel) sentinelRef.current = null;
                });
            } catch {
                // NotAllowedError / unsupported policy — ignore, screen just locks normally.
            }
        };

        const onVisibility = (): void => {
            if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
                void acquire();
            }
        };

        void acquire();
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibility);
        }

        return () => {
            cancelled = true;
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisibility);
            }
            const held = sentinelRef.current;
            sentinelRef.current = null;
            if (held) void held.release().catch(() => { /* noop */ });
        };
    }, [enabled]);
};
