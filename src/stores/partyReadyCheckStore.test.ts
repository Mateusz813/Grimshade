import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePartyReadyCheckStore } from './partyReadyCheckStore';
import { supabase } from '../lib/supabase';

/**
 * Coordinator store for the "Gotowy?" modal. Realtime is wired through
 * a Supabase broadcast channel — the global vitest setup already
 * stubs `supabase.channel(...)` but the default stub omits `.send`,
 * so we override the factory below to add a no-op send. The dynamic
 * import to `./characterStore` inside the `start` channel handler is
 * only hit when a real broadcast arrives; this test exercises the
 * PUBLIC actions (start / ready / cancel / fireGo / instantStart /
 * consumeDestination / subscribe / clear), all of which are
 * synchronous against the local state.
 */

const installChannelMock = (): void => {
    vi.mocked(supabase.channel).mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
        send: vi.fn().mockResolvedValue(undefined),
    } as never);
};

const baseState = {
    open: false,
    destination: null as null,
    requesterId: null as null,
    readyIds: [] as string[],
    requiredIds: [] as string[],
    payload: null as unknown,
    label: null as null,
    channel: null as null,
    partyId: null as null,
};

beforeEach(() => {
    // Cancel any active timeout + scrub state. We don't call `clear()`
    // here because it relies on the supabase mock — `setState` is the
    // surgical reset path for unit testing.
    usePartyReadyCheckStore.setState({ ...baseState });
    installChannelMock();
});

afterEach(() => {
    // Some tests subscribe to a channel; tear down so the next test
    // starts clean.
    try { usePartyReadyCheckStore.getState().clear(); } catch { /* ignore */ }
});

// ── subscribe (smoke) ────────────────────────────────────────────────────────

describe('subscribe', () => {
    it('opens a channel + records the partyId on first call', () => {
        const unsub = usePartyReadyCheckStore.getState().subscribe('party-1');
        const state = usePartyReadyCheckStore.getState();
        expect(state.partyId).toBe('party-1');
        expect(state.channel).not.toBeNull();
        unsub();
    });

    it('is idempotent for the same partyId (re-subscribe is a no-op)', () => {
        const unsub1 = usePartyReadyCheckStore.getState().subscribe('party-1');
        const channelA = usePartyReadyCheckStore.getState().channel;
        const unsub2 = usePartyReadyCheckStore.getState().subscribe('party-1');
        const channelB = usePartyReadyCheckStore.getState().channel;
        expect(channelB).toBe(channelA);
        unsub1();
        unsub2();
    });

    it('cleanup wipes channel + partyId + open + readyIds + requiredIds + destination + payload', () => {
        const unsub = usePartyReadyCheckStore.getState().subscribe('party-1');
        // Seed an in-progress check so we can verify it gets cleared.
        usePartyReadyCheckStore.setState({
            open: true,
            destination: '/combat',
            requesterId: 'char-1',
            readyIds: ['char-1'],
            requiredIds: ['char-1', 'char-2'],
            payload: { monster: { id: 'rat' } },
            label: 'Rat',
            channel: usePartyReadyCheckStore.getState().channel,
            partyId: 'party-1',
        });
        unsub();
        const state = usePartyReadyCheckStore.getState();
        expect(state.channel).toBeNull();
        expect(state.partyId).toBeNull();
        expect(state.open).toBe(false);
        expect(state.destination).toBeNull();
        expect(state.requesterId).toBeNull();
        expect(state.readyIds).toEqual([]);
        expect(state.requiredIds).toEqual([]);
        expect(state.payload).toBeNull();
        expect(state.label).toBeNull();
    });
});

// ── start ───────────────────────────────────────────────────────────────────

describe('start', () => {
    it('is a no-op when no channel is open (early return)', () => {
        // No subscribe before this call → channel is null → start exits.
        usePartyReadyCheckStore.getState().start({
            destination: '/combat',
            requesterId: 'char-1',
            memberIds: ['char-1', 'char-2'],
        });
        // open stays false: the store waits for the broadcast echo to
        // populate state (the global supabase mock here is a no-op).
        expect(usePartyReadyCheckStore.getState().open).toBe(false);
    });

    it('does not throw when channel is open and called with the minimum payload', () => {
        const unsub = usePartyReadyCheckStore.getState().subscribe('party-1');
        expect(() => {
            usePartyReadyCheckStore.getState().start({
                destination: '/boss',
                requesterId: 'char-1',
                memberIds: ['char-1', 'char-2'],
            });
        }).not.toThrow();
        unsub();
    });

    it('accepts the optional payload + label fields without error', () => {
        const unsub = usePartyReadyCheckStore.getState().subscribe('party-1');
        expect(() => {
            usePartyReadyCheckStore.getState().start({
                destination: '/raid',
                requesterId: 'char-1',
                memberIds: ['char-1'],
                payload: { boss: 'dragon' },
                label: 'Smok Cienia Lv 50',
            });
        }).not.toThrow();
        unsub();
    });
});

// ── ready ───────────────────────────────────────────────────────────────────

describe('ready', () => {
    it('is a no-op when no channel is open', () => {
        usePartyReadyCheckStore.getState().ready('char-1');
        // No optimistic state change either, because the action exits before
        // touching state when channel is null.
        expect(usePartyReadyCheckStore.getState().readyIds).toEqual([]);
    });

    it('optimistically appends the memberId to readyIds (UI updates without round-trip)', () => {
        const unsub = usePartyReadyCheckStore.getState().subscribe('party-1');
        usePartyReadyCheckStore.setState({
            open: true,
            destination: '/combat',
            requesterId: 'char-leader',
            readyIds: [],
            requiredIds: ['char-1', 'char-leader'],
            payload: null,
            label: null,
            channel: usePartyReadyCheckStore.getState().channel,
            partyId: 'party-1',
        });
        usePartyReadyCheckStore.getState().ready('char-1');
        expect(usePartyReadyCheckStore.getState().readyIds).toContain('char-1');
        unsub();
    });

    it('deduplicates: a member can\'t double-ready (clicking the button twice in a row)', () => {
        const unsub = usePartyReadyCheckStore.getState().subscribe('party-1');
        usePartyReadyCheckStore.setState({
            open: true,
            destination: '/combat',
            requesterId: 'char-leader',
            readyIds: ['char-1'],
            requiredIds: ['char-1', 'char-leader'],
            payload: null,
            label: null,
            channel: usePartyReadyCheckStore.getState().channel,
            partyId: 'party-1',
        });
        usePartyReadyCheckStore.getState().ready('char-1');
        // Still just one entry.
        expect(usePartyReadyCheckStore.getState().readyIds.filter((id) => id === 'char-1')).toHaveLength(1);
        unsub();
    });

    it('preserves other ready ids when the same member re-clicks ready', () => {
        const unsub = usePartyReadyCheckStore.getState().subscribe('party-1');
        usePartyReadyCheckStore.setState({
            open: true,
            destination: '/combat',
            requesterId: 'char-leader',
            readyIds: ['char-a', 'char-b'],
            requiredIds: ['char-a', 'char-b', 'char-leader'],
            payload: null,
            label: null,
            channel: usePartyReadyCheckStore.getState().channel,
            partyId: 'party-1',
        });
        usePartyReadyCheckStore.getState().ready('char-a');
        expect(usePartyReadyCheckStore.getState().readyIds).toEqual(['char-a', 'char-b']);
        unsub();
    });
});

// ── cancel ──────────────────────────────────────────────────────────────────

describe('cancel', () => {
    it('is a no-op when no channel is open', () => {
        expect(() => usePartyReadyCheckStore.getState().cancel('char-1')).not.toThrow();
    });

    it('does not throw when channel is open and a memberId is passed', () => {
        const unsub = usePartyReadyCheckStore.getState().subscribe('party-1');
        expect(() => usePartyReadyCheckStore.getState().cancel('char-1')).not.toThrow();
        unsub();
    });
});

// ── fireGo ──────────────────────────────────────────────────────────────────

describe('fireGo', () => {
    it('is a no-op when destination is null even with an open channel', () => {
        const unsub = usePartyReadyCheckStore.getState().subscribe('party-1');
        // destination is null in the baseline state → fireGo short-circuits.
        expect(() => usePartyReadyCheckStore.getState().fireGo()).not.toThrow();
        unsub();
    });

    it('is a no-op when channel is null even with destination set', () => {
        usePartyReadyCheckStore.setState({
            ...baseState,
            destination: '/combat',
        });
        // No channel — early return.
        expect(() => usePartyReadyCheckStore.getState().fireGo()).not.toThrow();
    });

    it('does not throw when destination + channel are both set', () => {
        const unsub = usePartyReadyCheckStore.getState().subscribe('party-1');
        usePartyReadyCheckStore.setState({
            open: true,
            destination: '/combat',
            requesterId: 'char-leader',
            readyIds: ['char-leader'],
            requiredIds: ['char-leader'],
            payload: null,
            label: null,
            channel: usePartyReadyCheckStore.getState().channel,
            partyId: 'party-1',
        });
        expect(() => usePartyReadyCheckStore.getState().fireGo()).not.toThrow();
        unsub();
    });
});

// ── instantStart ────────────────────────────────────────────────────────────

describe('instantStart', () => {
    it('is a no-op when no channel is open', () => {
        expect(() => {
            usePartyReadyCheckStore.getState().instantStart({
                destination: '/boss',
                payload: { boss: 'dragon' },
                label: 'Smok Cienia',
            });
        }).not.toThrow();
    });

    it('does not throw when channel is open + all fields supplied', () => {
        const unsub = usePartyReadyCheckStore.getState().subscribe('party-1');
        expect(() => {
            usePartyReadyCheckStore.getState().instantStart({
                destination: '/boss',
                payload: { boss: 'dragon' },
                label: 'Smok Cienia',
            });
        }).not.toThrow();
        unsub();
    });

    it('accepts a minimal payload (only destination)', () => {
        const unsub = usePartyReadyCheckStore.getState().subscribe('party-1');
        expect(() => {
            usePartyReadyCheckStore.getState().instantStart({ destination: '/combat' });
        }).not.toThrow();
        unsub();
    });
});

// ── consumeDestination ──────────────────────────────────────────────────────

describe('consumeDestination', () => {
    it('clears destination + payload + label (called after navigation lands)', () => {
        usePartyReadyCheckStore.setState({
            ...baseState,
            destination: '/combat',
            payload: { foo: 1 },
            label: 'Test Monster',
        });
        usePartyReadyCheckStore.getState().consumeDestination();
        const state = usePartyReadyCheckStore.getState();
        expect(state.destination).toBeNull();
        expect(state.payload).toBeNull();
        expect(state.label).toBeNull();
    });

    it('does not touch other fields (open / requesterId / readyIds / requiredIds stay put)', () => {
        usePartyReadyCheckStore.setState({
            ...baseState,
            open: true,
            destination: '/combat',
            requesterId: 'char-1',
            readyIds: ['char-1'],
            requiredIds: ['char-1', 'char-2'],
            payload: { foo: 1 },
            label: 'Rat',
        });
        usePartyReadyCheckStore.getState().consumeDestination();
        const state = usePartyReadyCheckStore.getState();
        // These are owned by other code paths (modal close, cancel echo).
        expect(state.open).toBe(true);
        expect(state.requesterId).toBe('char-1');
        expect(state.readyIds).toEqual(['char-1']);
        expect(state.requiredIds).toEqual(['char-1', 'char-2']);
    });

    it('is safe to call on a fresh store with nothing to consume', () => {
        expect(() => usePartyReadyCheckStore.getState().consumeDestination()).not.toThrow();
        const state = usePartyReadyCheckStore.getState();
        expect(state.destination).toBeNull();
        expect(state.payload).toBeNull();
    });
});

// ── clear ───────────────────────────────────────────────────────────────────

describe('clear', () => {
    it('wipes every public field back to the initial baseline', () => {
        const unsub = usePartyReadyCheckStore.getState().subscribe('party-1');
        usePartyReadyCheckStore.setState({
            open: true,
            destination: '/combat',
            requesterId: 'char-1',
            readyIds: ['char-1', 'char-2'],
            requiredIds: ['char-1', 'char-2', 'char-3'],
            payload: { foo: 1 },
            label: 'Rat',
            channel: usePartyReadyCheckStore.getState().channel,
            partyId: 'party-1',
        });
        usePartyReadyCheckStore.getState().clear();
        const state = usePartyReadyCheckStore.getState();
        expect(state.open).toBe(false);
        expect(state.destination).toBeNull();
        expect(state.requesterId).toBeNull();
        expect(state.readyIds).toEqual([]);
        expect(state.requiredIds).toEqual([]);
        expect(state.payload).toBeNull();
        expect(state.label).toBeNull();
        expect(state.channel).toBeNull();
        expect(state.partyId).toBeNull();
        unsub();
    });

    it('is safe to call on a fresh store (no channel ever opened)', () => {
        expect(() => usePartyReadyCheckStore.getState().clear()).not.toThrow();
    });
});

// ── Initial state ────────────────────────────────────────────────────────────

describe('initial state', () => {
    it('boots with everything null / empty / closed', () => {
        const state = usePartyReadyCheckStore.getState();
        expect(state.open).toBe(false);
        expect(state.destination).toBeNull();
        expect(state.requesterId).toBeNull();
        expect(state.readyIds).toEqual([]);
        expect(state.requiredIds).toEqual([]);
        expect(state.payload).toBeNull();
        expect(state.label).toBeNull();
        expect(state.channel).toBeNull();
        expect(state.partyId).toBeNull();
    });
});

// TODO: channel-handler paths (`start` / `ready` / `cancel` / `go` /
// `instant-go` broadcast events) drive the cross-client UX. The global
// supabase mock used by `tests/vitest.setup.ts` returns a chain of no-op
// methods, so we can't synthesize an inbound broadcast event from a
// unit test — that needs a custom mock that captures `channel.on(...)`
// callbacks and replays payloads. Best done as integration coverage
// against the real Supabase Realtime layer.
//
// TODO: the 60-s auto-cancel timeout fired from the `start` handler is
// also gated behind that channel-handler path. Same caveat — covered
// indirectly by the unit guarantees above.
//
// TODO: the leader-side auto-fireGo wiring (the standalone
// `usePartyReadyCheckStore.subscribe(...)` block at the bottom of the
// module) is intentionally a no-op for now — the comment in the source
// defers the actual gate to the consumer (ReadyCheckModal). No unit
// test for now; covered when the deferred gate lands.
