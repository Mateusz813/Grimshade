import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createElement, type ReactNode } from 'react';
import { usePartyPresence } from './usePartyPresence';
import { useCharacterStore } from '../stores/characterStore';
import { usePartyStore } from '../stores/partyStore';
import { usePartyPresenceStore } from '../stores/partyPresenceStore';
import type { ICharacter } from '../api/v1/characterApi';
import type { IPartyInfo, IPartyMember } from '../systems/partySystem';


vi.mock('../systems/combatEngine', () => ({
    getEffectiveChar: vi.fn().mockReturnValue(null),
}));

vi.mock('../systems/progression', () => ({
    getMonsterUnlockStatus: vi.fn().mockReturnValue({ unlocked: false }),
}));

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, null, children);

const makeCharacter = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'me-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 1,
    xp: 0,
    xp_to_next: 100,
    hp: 100,
    max_hp: 100,
    mp: 30,
    max_mp: 30,
    hp_regen: 0,
    mp_regen: 0,
    attack: 10,
    defense: 5,
    attack_speed: 2,
    crit_chance: 5,
    crit_damage: 200,
    magic_level: 0,
    stat_points: 0,
    gold: 0,
    ...overrides,
} as ICharacter);

const makeMember = (id: string, isBot = false): IPartyMember => ({
    id, name: id, class: 'Knight', level: 1, hp: 100, maxHp: 100, isOnline: true, isBot,
});

const makeParty = (leaderId: string, members: IPartyMember[]): IPartyInfo => ({
    id: 'party-1', leaderId, members, createdAt: new Date().toISOString(), maxMembers: 4,
});

beforeEach(() => {
    useCharacterStore.setState({ character: null });
    usePartyStore.setState({ party: null });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('usePartyPresence — gates', () => {
    it('does NOT subscribe when there is no character', () => {
        usePartyStore.setState({ party: makeParty('me-1', [makeMember('me-1')]) });
        const subSpy = vi.spyOn(usePartyPresenceStore.getState(), 'subscribe');
        const clearSpy = vi.spyOn(usePartyPresenceStore.getState(), 'clear');
        renderHook(() => usePartyPresence(), { wrapper });
        expect(subSpy).not.toHaveBeenCalled();
        expect(clearSpy).toHaveBeenCalled();
    });

    it('does NOT subscribe when there is no party (solo)', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        const subSpy = vi.spyOn(usePartyPresenceStore.getState(), 'subscribe');
        const clearSpy = vi.spyOn(usePartyPresenceStore.getState(), 'clear');
        renderHook(() => usePartyPresence(), { wrapper });
        expect(subSpy).not.toHaveBeenCalled();
        expect(clearSpy).toHaveBeenCalled();
    });

    it('subscribes to the presence channel when both character and party exist', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({ party: makeParty('me-1', [makeMember('me-1')]) });
        const subSpy = vi.spyOn(usePartyPresenceStore.getState(), 'subscribe').mockReturnValue(() => {});
        renderHook(() => usePartyPresence(), { wrapper });
        expect(subSpy).toHaveBeenCalledWith('party-1');
    });

    it('runs subscribe cleanup on unmount', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({ party: makeParty('me-1', [makeMember('me-1')]) });
        const cleanup = vi.fn();
        vi.spyOn(usePartyPresenceStore.getState(), 'subscribe').mockReturnValue(cleanup);
        const { unmount } = renderHook(() => usePartyPresence(), { wrapper });
        unmount();
        expect(cleanup).toHaveBeenCalled();
    });
});

describe('usePartyPresence — initial publish', () => {
    it('publishes a snapshot immediately on mount when party is set', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({ party: makeParty('me-1', [makeMember('me-1')]) });
        const pubSpy = vi.spyOn(usePartyPresenceStore.getState(), 'publish');
        vi.spyOn(usePartyPresenceStore.getState(), 'subscribe').mockReturnValue(() => {});
        renderHook(() => usePartyPresence(), { wrapper });
        expect(pubSpy).toHaveBeenCalled();
        const firstArg = pubSpy.mock.calls[0]![0];
        expect(firstArg.id).toBe('me-1');
        expect(firstArg.maxHp).toBeGreaterThan(0);
    });
});

describe('usePartyPresence — heartbeat', () => {
    it('publishes again after every 2000ms interval', () => {
        vi.useFakeTimers();
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({ party: makeParty('me-1', [makeMember('me-1')]) });
        vi.spyOn(usePartyPresenceStore.getState(), 'subscribe').mockReturnValue(() => {});
        const pubSpy = vi.spyOn(usePartyPresenceStore.getState(), 'publish');
        renderHook(() => usePartyPresence(), { wrapper });
        const initialCalls = pubSpy.mock.calls.length;
        vi.advanceTimersByTime(2_000);
        expect(pubSpy.mock.calls.length).toBeGreaterThan(initialCalls);
    });

    it('calls the subscribe cleanup on unmount', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({ party: makeParty('me-1', [makeMember('me-1')]) });
        const cleanup = vi.fn();
        vi.spyOn(usePartyPresenceStore.getState(), 'subscribe').mockReturnValue(cleanup);
        const { unmount } = renderHook(() => usePartyPresence(), { wrapper });
        unmount();
        expect(cleanup).toHaveBeenCalled();
    });
});

