import { describe, it, expect, beforeEach } from 'vitest';
import { usePartyDamageStore } from './partyDamageStore';

/**
 * Damage tracker for the floating PartyWidget. Three setters, all simple
 * — no realtime, no API, no cross-store. Each test resets to a known
 * baseline so `addDamage` invariants (skip non-finite / non-positive
 * amounts, never overwrite — accumulate) are tested in isolation.
 */

const resetStore = (): void => {
    usePartyDamageStore.setState({
        damage: {},
        sessionStart: '2026-05-21T00:00:00.000Z',
    });
};

beforeEach(() => {
    resetStore();
});

// ── addDamage ────────────────────────────────────────────────────────────────

describe('addDamage', () => {
    it('records a first hit for a brand-new member', () => {
        usePartyDamageStore.getState().addDamage('char-1', 100);
        expect(usePartyDamageStore.getState().damage['char-1']).toBe(100);
    });

    it('accumulates damage on repeated calls for the same member', () => {
        const store = usePartyDamageStore.getState();
        store.addDamage('char-1', 50);
        store.addDamage('char-1', 75);
        store.addDamage('char-1', 25);
        expect(usePartyDamageStore.getState().damage['char-1']).toBe(150);
    });

    it('keeps per-member buckets independent', () => {
        const store = usePartyDamageStore.getState();
        store.addDamage('char-1', 100);
        store.addDamage('char-2', 250);
        store.addDamage('char-1', 50);
        const state = usePartyDamageStore.getState();
        expect(state.damage['char-1']).toBe(150);
        expect(state.damage['char-2']).toBe(250);
    });

    it('ignores empty memberId (defensive — never seed an empty key)', () => {
        usePartyDamageStore.getState().addDamage('', 100);
        expect(usePartyDamageStore.getState().damage).toEqual({});
    });

    it('ignores zero damage', () => {
        usePartyDamageStore.getState().addDamage('char-1', 0);
        expect(usePartyDamageStore.getState().damage['char-1']).toBeUndefined();
    });

    it('ignores negative damage', () => {
        usePartyDamageStore.getState().addDamage('char-1', -50);
        expect(usePartyDamageStore.getState().damage['char-1']).toBeUndefined();
    });

    it('ignores NaN amounts', () => {
        usePartyDamageStore.getState().addDamage('char-1', Number.NaN);
        expect(usePartyDamageStore.getState().damage['char-1']).toBeUndefined();
    });

    it('ignores Infinity amounts (defensive: !Number.isFinite)', () => {
        usePartyDamageStore.getState().addDamage('char-1', Number.POSITIVE_INFINITY);
        expect(usePartyDamageStore.getState().damage['char-1']).toBeUndefined();
    });

    it('does not clobber an existing bucket when called with an invalid amount', () => {
        // Seed a real value first…
        usePartyDamageStore.getState().addDamage('char-1', 200);
        // …then try a bad input. The bucket should stay at 200.
        usePartyDamageStore.getState().addDamage('char-1', -10);
        usePartyDamageStore.getState().addDamage('char-1', Number.NaN);
        expect(usePartyDamageStore.getState().damage['char-1']).toBe(200);
    });

    it('handles a large series of small hits without losing precision (sum stays integer-ish)', () => {
        const store = usePartyDamageStore.getState();
        for (let i = 0; i < 100; i++) store.addDamage('char-1', 1);
        expect(usePartyDamageStore.getState().damage['char-1']).toBe(100);
    });
});

// ── setMemberDamage ──────────────────────────────────────────────────────────

describe('setMemberDamage', () => {
    it('writes an absolute total for a member (replaces, does not add)', () => {
        const store = usePartyDamageStore.getState();
        store.addDamage('char-1', 50);
        store.setMemberDamage('char-1', 1000);
        expect(usePartyDamageStore.getState().damage['char-1']).toBe(1000);
    });

    it('floors fractional totals (realtime payload could be a float)', () => {
        usePartyDamageStore.getState().setMemberDamage('char-1', 123.9);
        expect(usePartyDamageStore.getState().damage['char-1']).toBe(123);
    });

    it('clamps negatives to 0 (defensive: a bad realtime packet must not show "-50")', () => {
        usePartyDamageStore.getState().setMemberDamage('char-1', -50);
        expect(usePartyDamageStore.getState().damage['char-1']).toBe(0);
    });

    it('accepts 0 explicitly (used to reset a single member without clearing all)', () => {
        usePartyDamageStore.getState().addDamage('char-1', 500);
        usePartyDamageStore.getState().setMemberDamage('char-1', 0);
        expect(usePartyDamageStore.getState().damage['char-1']).toBe(0);
    });

    it('ignores an empty memberId', () => {
        usePartyDamageStore.getState().setMemberDamage('', 999);
        expect(usePartyDamageStore.getState().damage).toEqual({});
    });

    it('does not touch other members when setting one absolute value', () => {
        const store = usePartyDamageStore.getState();
        store.addDamage('char-1', 100);
        store.addDamage('char-2', 200);
        store.setMemberDamage('char-1', 999);
        const state = usePartyDamageStore.getState();
        expect(state.damage['char-1']).toBe(999);
        expect(state.damage['char-2']).toBe(200);
    });
});

// ── reset ────────────────────────────────────────────────────────────────────

describe('reset', () => {
    it('wipes every member bucket', () => {
        const store = usePartyDamageStore.getState();
        store.addDamage('char-1', 100);
        store.addDamage('char-2', 200);
        store.addDamage('char-3', 300);
        store.reset();
        expect(usePartyDamageStore.getState().damage).toEqual({});
    });

    it('refreshes the sessionStart timestamp to a current ISO string', () => {
        const before = usePartyDamageStore.getState().sessionStart;
        // Force a stale baseline so the timestamp must change to pass.
        usePartyDamageStore.setState({ sessionStart: '1999-01-01T00:00:00.000Z' });
        usePartyDamageStore.getState().reset();
        const after = usePartyDamageStore.getState().sessionStart;
        // Either same as the seeded baseline (vanishingly unlikely) or a
        // newer ISO timestamp — strictly: must not match the 1999 baseline.
        expect(after).not.toBe('1999-01-01T00:00:00.000Z');
        // Parses back into a finite Date.
        expect(Number.isNaN(new Date(after).getTime())).toBe(false);
        // And the reset's timestamp is >= the test's beforeEach baseline.
        expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    });

    it('is safe to call on an already-empty store', () => {
        expect(() => usePartyDamageStore.getState().reset()).not.toThrow();
        expect(usePartyDamageStore.getState().damage).toEqual({});
    });
});

// ── Initial state ────────────────────────────────────────────────────────────

describe('initial state', () => {
    it('exposes an empty damage map + a parseable sessionStart on boot', () => {
        const s = usePartyDamageStore.getState();
        expect(s.damage).toEqual({});
        expect(typeof s.sessionStart).toBe('string');
        expect(Number.isNaN(new Date(s.sessionStart).getTime())).toBe(false);
    });
});
