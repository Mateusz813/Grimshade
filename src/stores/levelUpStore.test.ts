import { describe, it, expect, beforeEach } from 'vitest';
import { useLevelUpStore, type ILevelUpEvent } from './levelUpStore';

const baseEvent: ILevelUpEvent = {
    newLevel: 11,
    levelsGained: 1,
    statPointsGained: 2,
    inCombat: false,
};

beforeEach(() => {
    useLevelUpStore.setState({ event: null });
});

describe('initial state', () => {
    it('starts with `event` as null (no banner visible)', () => {
        expect(useLevelUpStore.getState().event).toBeNull();
    });

    it('exposes both action functions', () => {
        const s = useLevelUpStore.getState();
        expect(typeof s.triggerLevelUp).toBe('function');
        expect(typeof s.clearLevelUp).toBe('function');
    });
});

describe('triggerLevelUp', () => {
    it('writes the event into the store', () => {
        useLevelUpStore.getState().triggerLevelUp(baseEvent);
        expect(useLevelUpStore.getState().event).toEqual(baseEvent);
    });

    it('preserves all required scalar fields', () => {
        useLevelUpStore.getState().triggerLevelUp({
            newLevel: 50,
            levelsGained: 3,
            statPointsGained: 6,
            inCombat: true,
        });
        const ev = useLevelUpStore.getState().event!;
        expect(ev.newLevel).toBe(50);
        expect(ev.levelsGained).toBe(3);
        expect(ev.statPointsGained).toBe(6);
        expect(ev.inCombat).toBe(true);
    });

    it('passes through optional gold milestone payload', () => {
        useLevelUpStore.getState().triggerLevelUp({
            ...baseEvent,
            newLevel: 100,
            goldGained: 50_000,
            goldMilestoneLevels: [25, 50, 100],
        });
        const ev = useLevelUpStore.getState().event!;
        expect(ev.goldGained).toBe(50_000);
        expect(ev.goldMilestoneLevels).toEqual([25, 50, 100]);
    });

    it('overwrites a previous event rather than queueing (latest-wins)', () => {
        useLevelUpStore.getState().triggerLevelUp({ ...baseEvent, newLevel: 5 });
        useLevelUpStore.getState().triggerLevelUp({ ...baseEvent, newLevel: 6 });
        expect(useLevelUpStore.getState().event!.newLevel).toBe(6);
    });

    it('allows level-up triggered while in combat (subtle animation flag)', () => {
        useLevelUpStore.getState().triggerLevelUp({ ...baseEvent, inCombat: true });
        expect(useLevelUpStore.getState().event!.inCombat).toBe(true);
    });

    it('keeps `goldGained` undefined when omitted (no milestone crossed)', () => {
        useLevelUpStore.getState().triggerLevelUp(baseEvent);
        const ev = useLevelUpStore.getState().event!;
        expect(ev.goldGained).toBeUndefined();
        expect(ev.goldMilestoneLevels).toBeUndefined();
    });
});

describe('clearLevelUp', () => {
    it('resets the event back to null', () => {
        useLevelUpStore.getState().triggerLevelUp(baseEvent);
        useLevelUpStore.getState().clearLevelUp();
        expect(useLevelUpStore.getState().event).toBeNull();
    });

    it('is a no-op when no event is present', () => {
        expect(() => useLevelUpStore.getState().clearLevelUp()).not.toThrow();
        expect(useLevelUpStore.getState().event).toBeNull();
    });

    it('can be called repeatedly without ill effect', () => {
        useLevelUpStore.getState().triggerLevelUp(baseEvent);
        useLevelUpStore.getState().clearLevelUp();
        useLevelUpStore.getState().clearLevelUp();
        expect(useLevelUpStore.getState().event).toBeNull();
    });
});

