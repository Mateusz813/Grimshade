import { describe, it, expect, beforeEach } from 'vitest';
import { useAppRouteStore } from './appRouteStore';

beforeEach(() => {
    // Restore the documented initial state. The store has no built-in reset
    // helper so we use Zustand's `setState` directly — same approach as
    // `deathStore.test.ts` / `connectivityStore.test.ts`.
    useAppRouteStore.setState({ isCharacterless: false });
});

describe('initial state', () => {
    it('defaults `isCharacterless` to false', () => {
        // AppShell flips this true only on the auth/character-pick flows; a
        // freshly-created store mirroring an active gameplay route must start
        // false so background combat ticks aren't pre-emptively suppressed.
        expect(useAppRouteStore.getState().isCharacterless).toBe(false);
    });

    it('exposes `setIsCharacterless` as a function', () => {
        expect(typeof useAppRouteStore.getState().setIsCharacterless).toBe('function');
    });
});

describe('setIsCharacterless', () => {
    it('flips the flag from false to true', () => {
        useAppRouteStore.getState().setIsCharacterless(true);
        expect(useAppRouteStore.getState().isCharacterless).toBe(true);
    });

    it('flips the flag from true back to false', () => {
        useAppRouteStore.setState({ isCharacterless: true });
        useAppRouteStore.getState().setIsCharacterless(false);
        expect(useAppRouteStore.getState().isCharacterless).toBe(false);
    });

    it('is idempotent — setting the same value twice keeps the same final state', () => {
        useAppRouteStore.getState().setIsCharacterless(true);
        useAppRouteStore.getState().setIsCharacterless(true);
        expect(useAppRouteStore.getState().isCharacterless).toBe(true);
    });

    it('only mutates the targeted slice (no other keys exist, but verify shape)', () => {
        // Defensive: if anyone ever adds another field, this test ensures the
        // setter shouldn't accidentally erase it (zustand `set({ ... })` does
        // a partial merge by default — confirming the contract).
        useAppRouteStore.setState({ isCharacterless: false } as never);
        useAppRouteStore.getState().setIsCharacterless(true);
        const state = useAppRouteStore.getState();
        expect(state.isCharacterless).toBe(true);
        expect(typeof state.setIsCharacterless).toBe('function');
    });
});

// TODO: this store is a tiny mirror with no async / side effects, so coverage
// is essentially complete. If AppShell ever gains a subscriber-side effect
// (e.g. flushing a save when the player leaves character-select), add a
// subscription test here using `useAppRouteStore.subscribe(...)`.
