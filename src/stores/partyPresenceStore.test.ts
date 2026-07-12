import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePartyPresenceStore, type IPartyMemberSnapshot } from './partyPresenceStore';
import { supabase } from '../lib/supabase';


const installChannelMock = (): ReturnType<typeof vi.fn> => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(supabase.channel).mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
        send: sendMock,
    } as never);
    return sendMock;
};

const makeSnapshot = (overrides?: Partial<Omit<IPartyMemberSnapshot, 'receivedAt'>>): Omit<IPartyMemberSnapshot, 'receivedAt'> => ({
    id: 'char-1',
    hp: 200,
    maxHp: 200,
    mp: 50,
    maxMp: 50,
    transformTier: 0,
    ...overrides,
});

beforeEach(() => {
    usePartyPresenceStore.getState().clear();
    installChannelMock();
});

afterEach(() => {
    vi.useRealTimers();
});


describe('subscribe', () => {
    it('opens a channel + stores the partyId on first subscribe', () => {
        const unsub = usePartyPresenceStore.getState().subscribe('party-1');
        const state = usePartyPresenceStore.getState();
        expect(state.partyId).toBe('party-1');
        expect(state.channel).not.toBeNull();
        unsub();
    });

    it('is a no-op when called again with the same partyId (re-subscribe is idempotent)', () => {
        const unsub1 = usePartyPresenceStore.getState().subscribe('party-1');
        const channelBefore = usePartyPresenceStore.getState().channel;
        const unsub2 = usePartyPresenceStore.getState().subscribe('party-1');
        const channelAfter = usePartyPresenceStore.getState().channel;
        expect(channelAfter).toBe(channelBefore);
        unsub1();
        unsub2();
    });

    it('tears down the previous channel + resets byMember when switching parties', () => {
        const unsub1 = usePartyPresenceStore.getState().subscribe('party-1');
        usePartyPresenceStore.setState({
            byMember: { 'char-9': { ...makeSnapshot({ id: 'char-9' }), receivedAt: Date.now() } },
            channel: usePartyPresenceStore.getState().channel,
            partyId: 'party-1',
        });
        usePartyPresenceStore.getState().subscribe('party-2');
        const state = usePartyPresenceStore.getState();
        expect(state.partyId).toBe('party-2');
        expect(state.byMember).toEqual({});
        unsub1();
    });

    it('returns a cleanup function that clears channel + partyId + byMember', () => {
        const unsub = usePartyPresenceStore.getState().subscribe('party-1');
        usePartyPresenceStore.setState({
            byMember: { 'char-9': { ...makeSnapshot({ id: 'char-9' }), receivedAt: Date.now() } },
            channel: usePartyPresenceStore.getState().channel,
            partyId: 'party-1',
        });
        unsub();
        const state = usePartyPresenceStore.getState();
        expect(state.channel).toBeNull();
        expect(state.partyId).toBeNull();
        expect(state.byMember).toEqual({});
    });
});


describe('publish', () => {
    it('is a no-op when no channel is open (no subscribe yet)', () => {
        usePartyPresenceStore.getState().publish(makeSnapshot({ id: 'char-1', hp: 100 }));
        expect(usePartyPresenceStore.getState().byMember).toEqual({});
    });

    it('updates the local mirror immediately with the broadcaster\'s own snapshot', () => {
        const unsub = usePartyPresenceStore.getState().subscribe('party-1');
        usePartyPresenceStore.getState().publish(makeSnapshot({ id: 'char-1', hp: 150 }));
        const entry = usePartyPresenceStore.getState().byMember['char-1'];
        expect(entry).toBeDefined();
        expect(entry.hp).toBe(150);
        expect(typeof entry.receivedAt).toBe('number');
        expect(entry.receivedAt).toBeGreaterThan(0);
        unsub();
    });

    it('overwrites previous own-snapshot with the freshest values (local mirror is single-slot per id)', () => {
        const unsub = usePartyPresenceStore.getState().subscribe('party-1');
        usePartyPresenceStore.getState().publish(makeSnapshot({ id: 'char-1', hp: 200 }));
        usePartyPresenceStore.getState().publish(makeSnapshot({ id: 'char-1', hp: 50 }));
        expect(usePartyPresenceStore.getState().byMember['char-1'].hp).toBe(50);
        unsub();
    });

    it('throttle: a 2nd rapid publish within the window does NOT lose the local mirror update', () => {
        const unsub = usePartyPresenceStore.getState().subscribe('party-1');
        usePartyPresenceStore.getState().publish(makeSnapshot({ id: 'char-1', hp: 200 }));
        usePartyPresenceStore.getState().publish(makeSnapshot({ id: 'char-1', hp: 1 }));
        expect(usePartyPresenceStore.getState().byMember['char-1'].hp).toBe(1);
        unsub();
    });

    it('accepts snapshots for multiple member ids on the same channel (each stored in its own slot)', () => {
        const unsub = usePartyPresenceStore.getState().subscribe('party-1');
        usePartyPresenceStore.getState().publish(makeSnapshot({ id: 'char-1', hp: 200 }));
        usePartyPresenceStore.getState().publish(makeSnapshot({ id: 'char-2', hp: 80 }));
        const map = usePartyPresenceStore.getState().byMember;
        expect(map['char-1'].hp).toBe(200);
        expect(map['char-2'].hp).toBe(80);
        unsub();
    });

    it('preserves optional fields (skillMode, currentRoute, summons) on the local mirror', () => {
        const unsub = usePartyPresenceStore.getState().subscribe('party-1');
        usePartyPresenceStore.getState().publish(makeSnapshot({
            id: 'char-necro',
            skillMode: 'manual',
            currentRoute: '/trainer',
            summons: [{ type: 'skeleton', hp: 100, maxHp: 100, mp: 0, maxMp: 0 }],
        }));
        const entry = usePartyPresenceStore.getState().byMember['char-necro'];
        expect(entry.skillMode).toBe('manual');
        expect(entry.currentRoute).toBe('/trainer');
        expect(entry.summons).toHaveLength(1);
        expect(entry.summons![0].type).toBe('skeleton');
        unsub();
    });

    it('preserves real effective combat stats (attack, defense) on the local mirror', () => {
        const unsub = usePartyPresenceStore.getState().subscribe('party-1');
        usePartyPresenceStore.getState().publish(makeSnapshot({
            id: 'char-geared',
            attack: 4200,
            defense: 1800,
        }));
        const entry = usePartyPresenceStore.getState().byMember['char-geared'];
        expect(entry.attack).toBe(4200);
        expect(entry.defense).toBe(1800);
        unsub();
    });

    it('leaves attack/defense undefined for older-client snapshots (leader falls back to bot formula)', () => {
        const unsub = usePartyPresenceStore.getState().subscribe('party-1');
        usePartyPresenceStore.getState().publish(makeSnapshot({ id: 'char-old' }));
        const entry = usePartyPresenceStore.getState().byMember['char-old'];
        expect(entry.attack).toBeUndefined();
        expect(entry.defense).toBeUndefined();
        unsub();
    });
});


describe('clear', () => {
    it('drops everything: channel, partyId, byMember', () => {
        const unsub = usePartyPresenceStore.getState().subscribe('party-1');
        usePartyPresenceStore.getState().publish(makeSnapshot({ id: 'char-1' }));
        expect(usePartyPresenceStore.getState().byMember['char-1']).toBeDefined();
        usePartyPresenceStore.getState().clear();
        const state = usePartyPresenceStore.getState();
        expect(state.channel).toBeNull();
        expect(state.partyId).toBeNull();
        expect(state.byMember).toEqual({});
        unsub();
    });

    it('is safe to call when no channel has ever opened (defensive: clear must not throw)', () => {
        expect(() => usePartyPresenceStore.getState().clear()).not.toThrow();
        expect(usePartyPresenceStore.getState().byMember).toEqual({});
    });

    it('clears any queued pending timer (re-call clear, then publish — fresh state, no stale broadcast)', () => {
        const unsub = usePartyPresenceStore.getState().subscribe('party-1');
        usePartyPresenceStore.getState().publish(makeSnapshot({ id: 'char-1', hp: 200 }));
        usePartyPresenceStore.getState().publish(makeSnapshot({ id: 'char-1', hp: 1 }));
        usePartyPresenceStore.getState().clear();
        expect(usePartyPresenceStore.getState().byMember).toEqual({});
        unsub();
    });
});


describe('subscribe -> publish -> unsubscribe lifecycle', () => {
    it('local mirror persists across publishes until the cleanup is invoked', () => {
        const unsub = usePartyPresenceStore.getState().subscribe('party-1');
        usePartyPresenceStore.getState().publish(makeSnapshot({ id: 'char-1', hp: 200 }));
        usePartyPresenceStore.getState().publish(makeSnapshot({ id: 'char-2', hp: 80 }));
        expect(Object.keys(usePartyPresenceStore.getState().byMember).sort()).toEqual(['char-1', 'char-2']);
        unsub();
        expect(usePartyPresenceStore.getState().byMember).toEqual({});
    });

    it('re-subscribing to a DIFFERENT party blanks the previous mirror so old allies don\'t leak in', () => {
        const unsub1 = usePartyPresenceStore.getState().subscribe('party-1');
        usePartyPresenceStore.getState().publish(makeSnapshot({ id: 'char-1', hp: 200 }));
        usePartyPresenceStore.getState().subscribe('party-2');
        expect(usePartyPresenceStore.getState().byMember).toEqual({});
        unsub1();
    });
});

