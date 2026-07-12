import { describe, it, expect, beforeEach, vi } from 'vitest';


const { getRaidByIdMock, todayIsoMock } = vi.hoisted(() => ({
    getRaidByIdMock: vi.fn(),
    todayIsoMock: vi.fn(() => '2026-05-21'),
}));

vi.mock('../systems/raidSystem', () => ({
    getRaidById: getRaidByIdMock,
    todayIso: todayIsoMock,
}));

import { useRaidStore } from './raidStore';

const RAID = {
    id: 'raid_1',
    name_pl: 'Test Raid',
    level: 1,
    waves: 3,
    dailyAttempts: 5,
    sourceDungeonId: 'dungeon_1',
};

const resetStore = (): void => {
    useRaidStore.setState({ attempts: {}, activeRaidId: null });
};

beforeEach(() => {
    resetStore();
    getRaidByIdMock.mockReset();
    todayIsoMock.mockReset();
    todayIsoMock.mockReturnValue('2026-05-21');
    getRaidByIdMock.mockImplementation((id: string) => (id === 'raid_1' ? RAID : null));
});


describe('setActiveRaid', () => {
    it('stores the raid id (entering the raid view)', () => {
        useRaidStore.getState().setActiveRaid('raid_1');
        expect(useRaidStore.getState().activeRaidId).toBe('raid_1');
    });

    it('accepts null to clear (leaving the raid)', () => {
        useRaidStore.setState({ attempts: {}, activeRaidId: 'raid_1' });
        useRaidStore.getState().setActiveRaid(null);
        expect(useRaidStore.getState().activeRaidId).toBeNull();
    });

    it('overwrites without merging (player swapped raids mid-session)', () => {
        useRaidStore.getState().setActiveRaid('raid_1');
        useRaidStore.getState().setActiveRaid('raid_2');
        expect(useRaidStore.getState().activeRaidId).toBe('raid_2');
    });
});


describe('attemptsRemaining', () => {
    it('returns 0 for an unknown raid id (defensive: never hand out attempts for missing data)', () => {
        expect(useRaidStore.getState().attemptsRemaining('raid_unknown')).toBe(0);
    });

    it('returns full dailyAttempts when no attempts have been recorded', () => {
        expect(useRaidStore.getState().attemptsRemaining('raid_1')).toBe(5);
    });

    it('returns full dailyAttempts when the record is from a previous day (stale roll-over)', () => {
        useRaidStore.setState({
            attempts: { raid_1: { day: '1999-12-31', count: 99 } },
            activeRaidId: null,
        });
        expect(useRaidStore.getState().attemptsRemaining('raid_1')).toBe(5);
    });

    it('subtracts today\'s used count from the daily cap', () => {
        useRaidStore.setState({
            attempts: { raid_1: { day: '2026-05-21', count: 2 } },
            activeRaidId: null,
        });
        expect(useRaidStore.getState().attemptsRemaining('raid_1')).toBe(3);
    });

    it('clamps to 0 when used exceeds the daily cap (data drift guard)', () => {
        useRaidStore.setState({
            attempts: { raid_1: { day: '2026-05-21', count: 10 } },
            activeRaidId: null,
        });
        expect(useRaidStore.getState().attemptsRemaining('raid_1')).toBe(0);
    });
});


describe('consumeAttempt', () => {
    it('returns false and writes nothing for an unknown raid', () => {
        const ok = useRaidStore.getState().consumeAttempt('raid_unknown');
        expect(ok).toBe(false);
        expect(useRaidStore.getState().attempts).toEqual({});
    });

    it('records the first attempt with count = 1 + today as day', () => {
        const ok = useRaidStore.getState().consumeAttempt('raid_1');
        expect(ok).toBe(true);
        expect(useRaidStore.getState().attempts['raid_1']).toEqual({ day: '2026-05-21', count: 1 });
    });

    it('increments the existing same-day count', () => {
        useRaidStore.setState({
            attempts: { raid_1: { day: '2026-05-21', count: 2 } },
            activeRaidId: null,
        });
        useRaidStore.getState().consumeAttempt('raid_1');
        expect(useRaidStore.getState().attempts['raid_1'].count).toBe(3);
    });

    it('resets count to 1 when the existing record is from yesterday (day rollover)', () => {
        useRaidStore.setState({
            attempts: { raid_1: { day: '1999-12-31', count: 99 } },
            activeRaidId: null,
        });
        const ok = useRaidStore.getState().consumeAttempt('raid_1');
        expect(ok).toBe(true);
        expect(useRaidStore.getState().attempts['raid_1']).toEqual({ day: '2026-05-21', count: 1 });
    });

    it('rejects (returns false) once the daily cap is hit, and leaves count untouched', () => {
        useRaidStore.setState({
            attempts: { raid_1: { day: '2026-05-21', count: 5 } },
            activeRaidId: null,
        });
        const ok = useRaidStore.getState().consumeAttempt('raid_1');
        expect(ok).toBe(false);
        expect(useRaidStore.getState().attempts['raid_1'].count).toBe(5);
    });

    it('tracks raids independently — consuming one does not bump another', () => {
        getRaidByIdMock.mockImplementation((id: string) => ({ ...RAID, id }));
        useRaidStore.getState().consumeAttempt('raid_a');
        useRaidStore.getState().consumeAttempt('raid_b');
        useRaidStore.getState().consumeAttempt('raid_b');
        const state = useRaidStore.getState();
        expect(state.attempts['raid_a'].count).toBe(1);
        expect(state.attempts['raid_b'].count).toBe(2);
    });
});


describe('refundAttempt', () => {
    it('is a no-op for a raid the player has never tried today', () => {
        useRaidStore.getState().refundAttempt('raid_1');
        expect(useRaidStore.getState().attempts).toEqual({});
    });

    it('is a no-op when the record is stale (different day)', () => {
        useRaidStore.setState({
            attempts: { raid_1: { day: '1999-12-31', count: 4 } },
            activeRaidId: null,
        });
        useRaidStore.getState().refundAttempt('raid_1');
        expect(useRaidStore.getState().attempts['raid_1']).toEqual({ day: '1999-12-31', count: 4 });
    });

    it('decrements today\'s count by 1', () => {
        useRaidStore.setState({
            attempts: { raid_1: { day: '2026-05-21', count: 3 } },
            activeRaidId: null,
        });
        useRaidStore.getState().refundAttempt('raid_1');
        expect(useRaidStore.getState().attempts['raid_1'].count).toBe(2);
    });

    it('clamps to 0 — refunding below zero is forbidden (spec: "nigdy ponizej zera")', () => {
        useRaidStore.setState({
            attempts: { raid_1: { day: '2026-05-21', count: 0 } },
            activeRaidId: null,
        });
        useRaidStore.getState().refundAttempt('raid_1');
        expect(useRaidStore.getState().attempts['raid_1'].count).toBe(0);
    });

    it('does not touch other raids when refunding one', () => {
        useRaidStore.setState({
            attempts: {
                raid_1: { day: '2026-05-21', count: 3 },
                raid_2: { day: '2026-05-21', count: 5 },
            },
            activeRaidId: null,
        });
        useRaidStore.getState().refundAttempt('raid_1');
        const state = useRaidStore.getState();
        expect(state.attempts['raid_1'].count).toBe(2);
        expect(state.attempts['raid_2'].count).toBe(5);
    });
});


describe('resetDay', () => {
    it('wipes every raid\'s daily counter', () => {
        useRaidStore.setState({
            attempts: {
                raid_1: { day: '2026-05-21', count: 3 },
                raid_2: { day: '2026-05-21', count: 5 },
            },
            activeRaidId: null,
        });
        useRaidStore.getState().resetDay();
        expect(useRaidStore.getState().attempts).toEqual({});
    });

    it('does NOT clear `activeRaidId` (player can keep mid-raid even after a force-reset)', () => {
        useRaidStore.setState({
            attempts: { raid_1: { day: '2026-05-21', count: 3 } },
            activeRaidId: 'raid_1',
        });
        useRaidStore.getState().resetDay();
        expect(useRaidStore.getState().activeRaidId).toBe('raid_1');
    });

    it('is safe to call on an already-empty store', () => {
        expect(() => useRaidStore.getState().resetDay()).not.toThrow();
        expect(useRaidStore.getState().attempts).toEqual({});
    });
});


describe('consumeAttempt + refundAttempt + attemptsRemaining', () => {
    it('round-trips: consume 3 -> 2 left; refund 1 -> 3 left', () => {
        const store = useRaidStore.getState();
        store.consumeAttempt('raid_1');
        store.consumeAttempt('raid_1');
        store.consumeAttempt('raid_1');
        expect(useRaidStore.getState().attemptsRemaining('raid_1')).toBe(2);
        store.refundAttempt('raid_1');
        expect(useRaidStore.getState().attemptsRemaining('raid_1')).toBe(3);
    });

    it('refusing the 6th attempt does not leak the day key for an unused raid', () => {
        for (let i = 0; i < 5; i++) useRaidStore.getState().consumeAttempt('raid_1');
        const sixth = useRaidStore.getState().consumeAttempt('raid_1');
        expect(sixth).toBe(false);
        expect(useRaidStore.getState().attempts['raid_1'].count).toBe(5);
    });

    it('day-rollover via todayIso bump resets the budget on the next consume', () => {
        for (let i = 0; i < 5; i++) useRaidStore.getState().consumeAttempt('raid_1');
        expect(useRaidStore.getState().attemptsRemaining('raid_1')).toBe(0);
        todayIsoMock.mockReturnValue('2026-05-22');
        expect(useRaidStore.getState().attemptsRemaining('raid_1')).toBe(5);
        const ok = useRaidStore.getState().consumeAttempt('raid_1');
        expect(ok).toBe(true);
        expect(useRaidStore.getState().attempts['raid_1']).toEqual({ day: '2026-05-22', count: 1 });
    });
});

