import { describe, it, expect, beforeEach } from 'vitest';
import { useDungeonStore } from './dungeonStore';

const resetStore = (): void => {
    useDungeonStore.setState({
        dailyAttempts: {},
        clearedDungeonIds: {},
        lastResult: null,
    });
};

beforeEach(() => {
    resetStore();
});


describe('setDungeonCompleted', () => {
    it('records a fresh attempt with `used = 1` + today as date', () => {
        useDungeonStore.getState().setDungeonCompleted('dungeon_1');
        const entry = useDungeonStore.getState().dailyAttempts['dungeon_1'];
        expect(entry.used).toBe(1);
        expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('also flips `clearedDungeonIds[id]` to true on the first clear', () => {
        useDungeonStore.getState().setDungeonCompleted('dungeon_1');
        expect(useDungeonStore.getState().clearedDungeonIds['dungeon_1']).toBe(true);
    });

    it('idempotent — re-clearing the same dungeon leaves clearedDungeonIds intact', () => {
        const store = useDungeonStore.getState();
        store.setDungeonCompleted('dungeon_1');
        store.setDungeonCompleted('dungeon_1');
        expect(useDungeonStore.getState().clearedDungeonIds['dungeon_1']).toBe(true);
    });

    it('increments `used` for repeated clears on the same day', () => {
        const store = useDungeonStore.getState();
        store.setDungeonCompleted('dungeon_1');
        store.setDungeonCompleted('dungeon_1');
        store.setDungeonCompleted('dungeon_1');
        expect(useDungeonStore.getState().dailyAttempts['dungeon_1'].used).toBe(3);
    });

    it('resets `used` to 1 when the previous entry is from another day', () => {
        useDungeonStore.setState({
            dailyAttempts: { dungeon_1: { used: 5, date: '1999-01-01' } },
            clearedDungeonIds: {},
            lastResult: null,
        });
        useDungeonStore.getState().setDungeonCompleted('dungeon_1');
        expect(useDungeonStore.getState().dailyAttempts['dungeon_1'].used).toBe(1);
    });

    it('tracks attempts per-dungeon independently', () => {
        const store = useDungeonStore.getState();
        store.setDungeonCompleted('dungeon_1');
        store.setDungeonCompleted('dungeon_8');
        store.setDungeonCompleted('dungeon_8');
        const state = useDungeonStore.getState();
        expect(state.dailyAttempts['dungeon_1'].used).toBe(1);
        expect(state.dailyAttempts['dungeon_8'].used).toBe(2);
        expect(state.clearedDungeonIds['dungeon_1']).toBe(true);
        expect(state.clearedDungeonIds['dungeon_8']).toBe(true);
    });
});


describe('setLastResult', () => {
    it('stores the result reference verbatim', () => {
        const dummy = { victory: true } as never;
        useDungeonStore.getState().setLastResult(dummy);
        expect(useDungeonStore.getState().lastResult).toBe(dummy);
    });

    it('accepts null to clear', () => {
        useDungeonStore.setState({ lastResult: { victory: true } as never });
        useDungeonStore.getState().setLastResult(null);
        expect(useDungeonStore.getState().lastResult).toBeNull();
    });
});


describe('getAttemptsUsed', () => {
    it('returns 0 when no record exists', () => {
        expect(useDungeonStore.getState().getAttemptsUsed('dungeon_unknown')).toBe(0);
    });

    it('returns 0 when the existing record is stale (different day)', () => {
        useDungeonStore.setState({
            dailyAttempts: { dungeon_1: { used: 5, date: '1999-12-31' } },
            clearedDungeonIds: {},
            lastResult: null,
        });
        expect(useDungeonStore.getState().getAttemptsUsed('dungeon_1')).toBe(0);
    });

    it('returns today\'s live count', () => {
        useDungeonStore.getState().setDungeonCompleted('dungeon_1');
        useDungeonStore.getState().setDungeonCompleted('dungeon_1');
        expect(useDungeonStore.getState().getAttemptsUsed('dungeon_1')).toBe(2);
    });
});

describe('getAttemptsMax', () => {
    it('returns 5 — the dungeon daily cap per CLAUDE.md', () => {
        expect(useDungeonStore.getState().getAttemptsMax()).toBe(5);
    });
});


describe('canEnter', () => {
    it('returns true on a fresh dungeon', () => {
        expect(useDungeonStore.getState().canEnter('dungeon_unknown')).toBe(true);
    });

    it('returns true when stale (yesterday\'s entry no longer counts)', () => {
        useDungeonStore.setState({
            dailyAttempts: { dungeon_1: { used: 100, date: '1999-12-31' } },
            clearedDungeonIds: {},
            lastResult: null,
        });
        expect(useDungeonStore.getState().canEnter('dungeon_1')).toBe(true);
    });

    it('returns true while under the 5-attempt cap', () => {
        const store = useDungeonStore.getState();
        for (let i = 0; i < 4; i++) store.setDungeonCompleted('dungeon_1');
        expect(useDungeonStore.getState().canEnter('dungeon_1')).toBe(true);
    });

    it('returns false once 5 attempts have been spent today', () => {
        const store = useDungeonStore.getState();
        for (let i = 0; i < 5; i++) store.setDungeonCompleted('dungeon_1');
        expect(useDungeonStore.getState().canEnter('dungeon_1')).toBe(false);
    });
});


describe('isDungeonCleared', () => {
    it('returns false for an untouched dungeon', () => {
        expect(useDungeonStore.getState().isDungeonCleared('dungeon_1')).toBe(false);
    });

    it('returns true after the first clear', () => {
        useDungeonStore.getState().setDungeonCompleted('dungeon_1');
        expect(useDungeonStore.getState().isDungeonCleared('dungeon_1')).toBe(true);
    });

    it('stays true even after daily-attempts rollover', () => {
        useDungeonStore.setState({
            dailyAttempts: { dungeon_1: { used: 1, date: '1999-12-31' } },
            clearedDungeonIds: { dungeon_1: true },
            lastResult: null,
        });
        expect(useDungeonStore.getState().getAttemptsUsed('dungeon_1')).toBe(0);
        expect(useDungeonStore.getState().isDungeonCleared('dungeon_1')).toBe(true);
    });
});
