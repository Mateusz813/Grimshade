import { useEffect, useRef } from 'react';


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
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            try {
                const sentinel = await wakeLock.request('screen');
                if (cancelled) {
                    void sentinel.release().catch(() => { });
                    return;
                }
                sentinelRef.current = sentinel;
                sentinel.addEventListener('release', () => {
                    if (sentinelRef.current === sentinel) sentinelRef.current = null;
                });
            } catch {
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
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', onVisibility);
        }

        return () => {
            cancelled = true;
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisibility);
            }
            if (typeof window !== 'undefined') {
                window.removeEventListener('focus', onVisibility);
            }
            const held = sentinelRef.current;
            sentinelRef.current = null;
            if (held) void held.release().catch(() => { });
        };
    }, [enabled]);
};
