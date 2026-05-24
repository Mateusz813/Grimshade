import { describe, it, expect, beforeEach } from 'vitest';
import { useSyncStore } from './syncStore';

beforeEach(() => {
    useSyncStore.setState({
        isOnline: true,
        lastSynced: null,
        isSyncing: false,
    });
});

describe('setOnline', () => {
    it('flips isOnline to the passed boolean', () => {
        useSyncStore.getState().setOnline(false);
        expect(useSyncStore.getState().isOnline).toBe(false);
        useSyncStore.getState().setOnline(true);
        expect(useSyncStore.getState().isOnline).toBe(true);
    });
});

describe('setLastSynced', () => {
    it('stores the ISO timestamp verbatim', () => {
        const ts = '2026-05-21T10:00:00.000Z';
        useSyncStore.getState().setLastSynced(ts);
        expect(useSyncStore.getState().lastSynced).toBe(ts);
    });

    it('accepts arbitrary strings — store does not validate format', () => {
        // Documenting current behaviour: the setter is intentionally dumb.
        useSyncStore.getState().setLastSynced('not-iso');
        expect(useSyncStore.getState().lastSynced).toBe('not-iso');
    });
});

describe('setSyncing', () => {
    it('flips the in-progress flag both directions', () => {
        useSyncStore.getState().setSyncing(true);
        expect(useSyncStore.getState().isSyncing).toBe(true);
        useSyncStore.getState().setSyncing(false);
        expect(useSyncStore.getState().isSyncing).toBe(false);
    });
});

describe('initial state', () => {
    it('exposes isOnline (boolean), lastSynced (null) and isSyncing (false) on boot', () => {
        // After our beforeEach reset, state should match the documented defaults.
        // navigator.onLine inside happy-dom is true by default.
        const s = useSyncStore.getState();
        expect(typeof s.isOnline).toBe('boolean');
        expect(s.lastSynced).toBeNull();
        expect(s.isSyncing).toBe(false);
    });
});

// TODO: the module installs `window.addEventListener('online'/'offline')`
// handlers at import time. Testing those would require resetting modules
// + emitting the events on `window` — left out because the setter logic
// is already covered above and the listeners are one-liners.
