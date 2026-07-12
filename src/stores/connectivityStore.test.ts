import { describe, it, expect, beforeEach } from 'vitest';
import {
    useConnectivityStore,
    isOfflineMode,
    type IOfflineSnapshot,
} from './connectivityStore';

const makeSnapshot = (overrides?: Partial<IOfflineSnapshot>): IOfflineSnapshot => ({
    characterId: 'char-test',
    capturedAt: '2026-05-21T00:00:00.000Z',
    level: 10,
    xp: 1000,
    hp: 200,
    mp: 50,
    gold: 500,
    itemCount: 12,
    storesBlob: null,
    ...overrides,
});

beforeEach(() => {
    useConnectivityStore.setState({
        mode: 'online',
        userExplicitlyOffline: false,
        isNetworkUp: true,
        snapshot: null,
    });
    if (typeof window !== 'undefined') {
        window.sessionStorage.clear();
    }
});


describe('setMode', () => {
    it('flips mode to offline and records `explicit: true` when the player toggled it', () => {
        useConnectivityStore.getState().setMode('offline', { explicit: true });
        const state = useConnectivityStore.getState();
        expect(state.mode).toBe('offline');
        expect(state.userExplicitlyOffline).toBe(true);
    });

    it('writes `userExplicitlyOffline` to sessionStorage when explicit=true', () => {
        useConnectivityStore.getState().setMode('offline', { explicit: true });
        expect(window.sessionStorage.getItem('grimshade.userExplicitlyOffline')).toBe('1');
    });

    it('flips mode to offline WITHOUT marking explicit when the DC watcher auto-flips', () => {
        useConnectivityStore.getState().setMode('offline', { explicit: false });
        const state = useConnectivityStore.getState();
        expect(state.mode).toBe('offline');
        expect(state.userExplicitlyOffline).toBe(false);
    });

    it('preserves the existing explicit flag when called without `explicit` option', () => {
        useConnectivityStore.setState({
            mode: 'online',
            userExplicitlyOffline: true,
            isNetworkUp: true,
            snapshot: null,
        });
        useConnectivityStore.getState().setMode('offline');
        expect(useConnectivityStore.getState().userExplicitlyOffline).toBe(true);
    });

    it('ALWAYS clears `userExplicitlyOffline` when flipping back to online', () => {
        useConnectivityStore.getState().setMode('offline', { explicit: true });
        useConnectivityStore.getState().setMode('online');
        const state = useConnectivityStore.getState();
        expect(state.mode).toBe('online');
        expect(state.userExplicitlyOffline).toBe(false);
        expect(window.sessionStorage.getItem('grimshade.userExplicitlyOffline')).toBeNull();
    });

    it('clears the explicit flag even when going online from an explicit-offline state', () => {
        useConnectivityStore.setState({
            mode: 'offline',
            userExplicitlyOffline: true,
            isNetworkUp: true,
            snapshot: null,
        });
        useConnectivityStore.getState().setMode('online');
        expect(useConnectivityStore.getState().userExplicitlyOffline).toBe(false);
    });
});


describe('setIsNetworkUp', () => {
    it('mirrors the network flag without touching mode/snapshot', () => {
        useConnectivityStore.setState({
            mode: 'online',
            userExplicitlyOffline: false,
            isNetworkUp: true,
            snapshot: null,
        });
        useConnectivityStore.getState().setIsNetworkUp(false);
        const state = useConnectivityStore.getState();
        expect(state.isNetworkUp).toBe(false);
        expect(state.mode).toBe('online');
        expect(state.snapshot).toBeNull();
    });

    it('toggles both ways', () => {
        useConnectivityStore.getState().setIsNetworkUp(false);
        expect(useConnectivityStore.getState().isNetworkUp).toBe(false);
        useConnectivityStore.getState().setIsNetworkUp(true);
        expect(useConnectivityStore.getState().isNetworkUp).toBe(true);
    });
});


describe('setSnapshot', () => {
    it('writes the snapshot into state', () => {
        const snap = makeSnapshot({ level: 25, gold: 5000 });
        useConnectivityStore.getState().setSnapshot(snap);
        expect(useConnectivityStore.getState().snapshot).toEqual(snap);
    });

    it('persists the snapshot to sessionStorage', () => {
        const snap = makeSnapshot({ characterId: 'char-blob' });
        useConnectivityStore.getState().setSnapshot(snap);
        const raw = window.sessionStorage.getItem('grimshade.offlineSnapshot');
        expect(raw).not.toBeNull();
        expect(JSON.parse(raw as string)).toEqual(snap);
    });

    it('null wipes the sessionStorage key + clears in-memory state', () => {
        useConnectivityStore.getState().setSnapshot(makeSnapshot());
        useConnectivityStore.getState().setSnapshot(null);
        expect(useConnectivityStore.getState().snapshot).toBeNull();
        expect(window.sessionStorage.getItem('grimshade.offlineSnapshot')).toBeNull();
    });

    it('overwrites previous snapshot with a newer one (no merging / no queueing)', () => {
        useConnectivityStore.getState().setSnapshot(makeSnapshot({ characterId: 'A' }));
        useConnectivityStore.getState().setSnapshot(makeSnapshot({ characterId: 'B' }));
        expect(useConnectivityStore.getState().snapshot!.characterId).toBe('B');
    });
});


describe('isOfflineMode', () => {
    it('returns false when mode is "online"', () => {
        useConnectivityStore.setState({
            mode: 'online',
            userExplicitlyOffline: false,
            isNetworkUp: true,
            snapshot: null,
        });
        expect(isOfflineMode()).toBe(false);
    });

    it('returns true when mode is "offline" (regardless of network up/down)', () => {
        useConnectivityStore.setState({
            mode: 'offline',
            userExplicitlyOffline: true,
            isNetworkUp: true,
            snapshot: null,
        });
        expect(isOfflineMode()).toBe(true);
        useConnectivityStore.setState({
            mode: 'offline',
            userExplicitlyOffline: false,
            isNetworkUp: false,
            snapshot: null,
        });
        expect(isOfflineMode()).toBe(true);
    });
});

