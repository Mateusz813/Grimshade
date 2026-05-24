import { describe, it, expect, beforeEach } from 'vitest';
import { useBossStore } from './bossStore';

// ── Initial state helper ─────────────────────────────────────────────────────
// `bossStore` doesn't export its initial values, so we mirror the literal
// shape declared in the create() body. Keep this in sync with bossStore.ts.

const resetStore = (): void => {
    useBossStore.setState({
        dailyAttempts: {},
        lastResult: null,
    });
};

beforeEach(() => {
    resetStore();
});

// ── setBossDefeated ──────────────────────────────────────────────────────────

describe('setBossDefeated', () => {
    it('records the first attempt with count = 1 + today as date', () => {
        useBossStore.getState().setBossDefeated('boss_25');
        const entry = useBossStore.getState().dailyAttempts['boss_25'];
        expect(entry).toBeDefined();
        expect(entry.used).toBe(1);
        // YYYY-MM-DD shape — explicit assertion that the helper used local date.
        expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('increments `used` on repeated kills the same day', () => {
        const store = useBossStore.getState();
        store.setBossDefeated('boss_25');
        store.setBossDefeated('boss_25');
        store.setBossDefeated('boss_25');
        expect(useBossStore.getState().dailyAttempts['boss_25'].used).toBe(3);
    });

    it('resets `used` back to 1 when the previous entry is from a different day', () => {
        // Seed with a stale entry from "yesterday".
        useBossStore.setState({
            dailyAttempts: {
                boss_50: { used: 7, date: '1999-01-01' },
            },
        });
        useBossStore.getState().setBossDefeated('boss_50');
        const entry = useBossStore.getState().dailyAttempts['boss_50'];
        expect(entry.used).toBe(1);
        expect(entry.date).not.toBe('1999-01-01');
    });

    it('tracks attempts per-boss independently (different ids do not collide)', () => {
        const store = useBossStore.getState();
        store.setBossDefeated('boss_25');
        store.setBossDefeated('boss_25');
        store.setBossDefeated('boss_100');
        const state = useBossStore.getState();
        expect(state.dailyAttempts['boss_25'].used).toBe(2);
        expect(state.dailyAttempts['boss_100'].used).toBe(1);
    });
});

// ── setLastResult ────────────────────────────────────────────────────────────

describe('setLastResult', () => {
    it('stores the result object as-is', () => {
        // bossResult shape is not asserted here — the store treats it opaquely.
        const dummy = { victory: true, gold: 123 } as unknown as Parameters<
            ReturnType<typeof useBossStore.getState>['setLastResult']
        >[0];
        useBossStore.getState().setLastResult(dummy);
        expect(useBossStore.getState().lastResult).toBe(dummy);
    });

    it('accepts null to clear the result', () => {
        useBossStore.setState({ lastResult: { victory: true } as never });
        useBossStore.getState().setLastResult(null);
        expect(useBossStore.getState().lastResult).toBeNull();
    });
});

// ── getAttemptsUsed ──────────────────────────────────────────────────────────

describe('getAttemptsUsed', () => {
    it('returns 0 when no entry exists for the boss', () => {
        expect(useBossStore.getState().getAttemptsUsed('boss_unknown')).toBe(0);
    });

    it('returns 0 when the existing entry is from a previous day (stale)', () => {
        useBossStore.setState({
            dailyAttempts: {
                boss_25: { used: 3, date: '2000-01-01' },
            },
        });
        expect(useBossStore.getState().getAttemptsUsed('boss_25')).toBe(0);
    });

    it('returns the live count for today', () => {
        useBossStore.getState().setBossDefeated('boss_25');
        useBossStore.getState().setBossDefeated('boss_25');
        expect(useBossStore.getState().getAttemptsUsed('boss_25')).toBe(2);
    });
});

// ── getAttemptsMax ───────────────────────────────────────────────────────────

describe('getAttemptsMax', () => {
    it('returns the hard cap (3) — boss daily limit per CLAUDE.md', () => {
        expect(useBossStore.getState().getAttemptsMax()).toBe(3);
    });
});

// ── canChallenge ─────────────────────────────────────────────────────────────

describe('canChallenge', () => {
    it('returns true when the boss has not been challenged today', () => {
        expect(useBossStore.getState().canChallenge('boss_unknown')).toBe(true);
    });

    it('returns true when the entry is stale (different day)', () => {
        useBossStore.setState({
            dailyAttempts: {
                boss_25: { used: 99, date: '2000-01-01' },
            },
        });
        expect(useBossStore.getState().canChallenge('boss_25')).toBe(true);
    });

    it('returns true while under the daily cap', () => {
        const store = useBossStore.getState();
        store.setBossDefeated('boss_25');
        expect(useBossStore.getState().canChallenge('boss_25')).toBe(true);
        store.setBossDefeated('boss_25');
        expect(useBossStore.getState().canChallenge('boss_25')).toBe(true);
    });

    it('returns false once the daily cap is reached', () => {
        const store = useBossStore.getState();
        // 3 = MAX_DAILY_ATTEMPTS in the source.
        store.setBossDefeated('boss_25');
        store.setBossDefeated('boss_25');
        store.setBossDefeated('boss_25');
        expect(useBossStore.getState().canChallenge('boss_25')).toBe(false);
    });
});
