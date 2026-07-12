import { describe, it, expect } from 'vitest';
import {
    shouldDieOnDisconnect,
    shouldLeavePartyOnDisconnect,
    resolveDisconnectSource,
    DISCONNECT_COMBAT_ROUTES,
    DISCONNECT_ARENA_ROUTES,
    type IDisconnectContext,
} from './disconnectPolicy';


const ctx = (over: Partial<IDisconnectContext>): IDisconnectContext => ({
    inParty: false,
    inCombat: false,
    inArena: false,
    ...over,
});

describe('shouldDieOnDisconnect — the #17 spec quadrants', () => {
    it('party + combat -> DIE', () => {
        expect(shouldDieOnDisconnect(ctx({ inParty: true, inCombat: true }))).toBe(true);
    });

    it('solo + combat -> does NOT die (combat continues offline)', () => {
        expect(shouldDieOnDisconnect(ctx({ inParty: false, inCombat: true }))).toBe(false);
    });

    it('arena WITH a party -> DIE', () => {
        expect(shouldDieOnDisconnect(ctx({ inParty: true, inArena: true }))).toBe(true);
    });

    it('arena SOLO -> DIE (arena abandonment is always a loss)', () => {
        expect(shouldDieOnDisconnect(ctx({ inParty: false, inArena: true }))).toBe(true);
    });

    it('party + non-combat -> does NOT die', () => {
        expect(shouldDieOnDisconnect(ctx({ inParty: true, inCombat: false, inArena: false }))).toBe(false);
    });

    it('solo + non-combat -> does NOT die', () => {
        expect(shouldDieOnDisconnect(ctx({}))).toBe(false);
    });

    it('arena flag dominates even without combat flag', () => {
        expect(shouldDieOnDisconnect(ctx({ inParty: false, inCombat: false, inArena: true }))).toBe(true);
    });
});

describe('shouldLeavePartyOnDisconnect — drop party iff in one', () => {
    it('in a party -> leave (combat case)', () => {
        expect(shouldLeavePartyOnDisconnect(ctx({ inParty: true, inCombat: true }))).toBe(true);
    });

    it('in a party -> leave (non-combat case — teammates not stalled)', () => {
        expect(shouldLeavePartyOnDisconnect(ctx({ inParty: true }))).toBe(true);
    });

    it('solo -> nothing to leave', () => {
        expect(shouldLeavePartyOnDisconnect(ctx({ inParty: false, inCombat: true }))).toBe(false);
    });
});

describe('die + leave-party combined contract (full quadrant matrix)', () => {
    interface ICase {
        name: string;
        c: IDisconnectContext;
        die: boolean;
        leave: boolean;
    }
    const cases: ICase[] = [
        { name: 'party + combat', c: ctx({ inParty: true, inCombat: true }), die: true, leave: true },
        { name: 'party + arena', c: ctx({ inParty: true, inArena: true }), die: true, leave: true },
        { name: 'solo + arena', c: ctx({ inArena: true }), die: true, leave: false },
        { name: 'solo + combat', c: ctx({ inCombat: true }), die: false, leave: false },
        { name: 'party + non-combat', c: ctx({ inParty: true }), die: false, leave: true },
        { name: 'solo + non-combat', c: ctx({}), die: false, leave: false },
    ];

    for (const { name, c, die, leave } of cases) {
        it(`${name} -> die=${die}, leaveParty=${leave}`, () => {
            expect(shouldDieOnDisconnect(c)).toBe(die);
            expect(shouldLeavePartyOnDisconnect(c)).toBe(leave);
        });
    }
});

describe('resolveDisconnectSource — route -> death source', () => {
    it('/boss -> boss', () => {
        expect(resolveDisconnectSource('/boss', false)).toBe('boss');
    });

    it('/dungeon -> dungeon', () => {
        expect(resolveDisconnectSource('/dungeon', false)).toBe('dungeon');
    });

    it('/raid -> raid', () => {
        expect(resolveDisconnectSource('/raid', false)).toBe('raid');
    });

    it('/transform -> transform', () => {
        expect(resolveDisconnectSource('/transform', false)).toBe('transform');
    });

    it('/combat -> monster', () => {
        expect(resolveDisconnectSource('/combat', false)).toBe('monster');
    });

    it('arena route -> boss (arena has no own source enum)', () => {
        expect(resolveDisconnectSource('/arena/match', true)).toBe('boss');
    });

    it('inArena flag wins even if the route string is unknown', () => {
        expect(resolveDisconnectSource('/whatever', true)).toBe('boss');
    });

    it('unknown non-arena route falls back to monster', () => {
        expect(resolveDisconnectSource('/inventory', false)).toBe('monster');
    });

    it('every combat route resolves to a defined (non-fallback) source', () => {
        const explicit: Record<string, string> = {
            '/boss': 'boss',
            '/dungeon': 'dungeon',
            '/raid': 'raid',
            '/transform': 'transform',
            '/combat': 'monster',
        };
        for (const route of DISCONNECT_COMBAT_ROUTES) {
            expect(resolveDisconnectSource(route, false)).toBe(explicit[route]);
        }
    });
});

describe('route sets — membership sanity', () => {
    it('combat set has the 5 combat screens', () => {
        expect([...DISCONNECT_COMBAT_ROUTES].sort()).toEqual(
            ['/boss', '/combat', '/dungeon', '/raid', '/transform'],
        );
    });

    it('arena set has both arena routes', () => {
        expect([...DISCONNECT_ARENA_ROUTES].sort()).toEqual(['/arena', '/arena/match']);
    });

    it('combat and arena route sets are disjoint', () => {
        for (const r of DISCONNECT_ARENA_ROUTES) {
            expect(DISCONNECT_COMBAT_ROUTES.has(r)).toBe(false);
        }
    });
});
