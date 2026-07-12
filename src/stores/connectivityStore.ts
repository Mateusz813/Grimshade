
import { create } from 'zustand';

export type TPlayMode = 'online' | 'offline';

export interface IOfflineSnapshot {
    characterId: string;
    capturedAt: string;
    level: number;
    xp: number;
    hp: number;
    mp: number;
    gold: number;
    itemCount: number;
    storesBlob: Record<string, unknown> | null;
}

const SNAPSHOT_STORAGE_KEY = 'grimshade.offlineSnapshot';
const EXPLICIT_OFFLINE_STORAGE_KEY = 'grimshade.userExplicitlyOffline';

const readStoredSnapshot = (): IOfflineSnapshot | null => {
    try {
        const raw = sessionStorage.getItem(SNAPSHOT_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as IOfflineSnapshot;
    } catch {
        return null;
    }
};

const writeStoredSnapshot = (snap: IOfflineSnapshot | null): void => {
    try {
        if (snap === null) sessionStorage.removeItem(SNAPSHOT_STORAGE_KEY);
        else sessionStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snap));
    } catch {
    }
};

const readStoredExplicit = (): boolean => {
    try {
        return sessionStorage.getItem(EXPLICIT_OFFLINE_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
};

const writeStoredExplicit = (flag: boolean): void => {
    try {
        if (flag) sessionStorage.setItem(EXPLICIT_OFFLINE_STORAGE_KEY, '1');
        else sessionStorage.removeItem(EXPLICIT_OFFLINE_STORAGE_KEY);
    } catch {
    }
};

interface IConnectivityState {
    mode: TPlayMode;
    userExplicitlyOffline: boolean;
    isNetworkUp: boolean;
    snapshot: IOfflineSnapshot | null;
    setMode: (mode: TPlayMode, opts?: { explicit?: boolean }) => void;
    setIsNetworkUp: (up: boolean) => void;
    setSnapshot: (snap: IOfflineSnapshot | null) => void;
}

const _initialSnapshot = readStoredSnapshot();
const _initialExplicit = readStoredExplicit();
const _initialMode: TPlayMode = _initialSnapshot ? 'offline' : 'online';

export const useConnectivityStore = create<IConnectivityState>((set) => ({
    mode: _initialMode,
    userExplicitlyOffline: _initialExplicit,
    isNetworkUp: typeof navigator !== 'undefined' ? navigator.onLine : true,
    snapshot: _initialSnapshot,
    setMode: (mode, opts) => {
        set((state) => {
            const nextExplicit =
                mode === 'offline'
                    ? (opts?.explicit ?? state.userExplicitlyOffline)
                    : false;
            writeStoredExplicit(nextExplicit);
            return { mode, userExplicitlyOffline: nextExplicit };
        });
    },
    setIsNetworkUp: (isNetworkUp) => set({ isNetworkUp }),
    setSnapshot: (snapshot) => {
        writeStoredSnapshot(snapshot);
        set({ snapshot });
    },
}));

export const isOfflineMode = (): boolean =>
    useConnectivityStore.getState().mode === 'offline';
