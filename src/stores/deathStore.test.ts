import { describe, it, expect, beforeEach } from 'vitest';
import { useDeathStore, type IDeathEvent } from './deathStore';

const baseEvent: Omit<IDeathEvent, 'kind'> = {
    killedBy: 'Goblin',
    sourceLevel: 5,
    oldLevel: 10,
    newLevel: 9,
    levelsLost: 1,
    xpPercent: 25,
    skillXpLossPercent: 5,
    protectionUsed: false,
    source: 'monster',
};

beforeEach(() => {
    useDeathStore.setState({ event: null });
});

describe('triggerDeath', () => {
    it('writes the event into the store', () => {
        useDeathStore.getState().triggerDeath(baseEvent);
        const stored = useDeathStore.getState().event;
        expect(stored).not.toBeNull();
        expect(stored!.killedBy).toBe('Goblin');
        expect(stored!.oldLevel).toBe(10);
        expect(stored!.newLevel).toBe(9);
    });

    it('defaults `kind` to "death" when the caller omits it', () => {
        useDeathStore.getState().triggerDeath(baseEvent);
        expect(useDeathStore.getState().event!.kind).toBe('death');
    });

    it('respects an explicit `kind: "flee"` override', () => {
        useDeathStore.getState().triggerDeath({ ...baseEvent, kind: 'flee', source: 'flee', killedBy: '—' });
        expect(useDeathStore.getState().event!.kind).toBe('flee');
        expect(useDeathStore.getState().event!.source).toBe('flee');
    });

    it('overwrites a previous event rather than queueing', () => {
        useDeathStore.getState().triggerDeath({ ...baseEvent, killedBy: 'Rat' });
        useDeathStore.getState().triggerDeath({ ...baseEvent, killedBy: 'Wolf' });
        // Only the latest write should be visible — there's no queue.
        expect(useDeathStore.getState().event!.killedBy).toBe('Wolf');
    });

    it('passes through full payload fields (skill XP loss, protection, sourceLevel)', () => {
        useDeathStore.getState().triggerDeath({
            ...baseEvent,
            skillXpLossPercent: 7.5,
            protectionUsed: true,
            sourceLevel: 99,
        });
        const ev = useDeathStore.getState().event!;
        expect(ev.skillXpLossPercent).toBe(7.5);
        expect(ev.protectionUsed).toBe(true);
        expect(ev.sourceLevel).toBe(99);
    });
});

describe('clearDeath', () => {
    it('resets the event to null', () => {
        useDeathStore.getState().triggerDeath(baseEvent);
        useDeathStore.getState().clearDeath();
        expect(useDeathStore.getState().event).toBeNull();
    });

    it('is a no-op when no event is present', () => {
        // Calling clear on already-null state must not throw and must stay null.
        expect(() => useDeathStore.getState().clearDeath()).not.toThrow();
        expect(useDeathStore.getState().event).toBeNull();
    });
});
