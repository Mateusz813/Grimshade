import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createElement, type ReactNode } from 'react';
import { usePartyCombatSync } from './usePartyCombatSync';
import { useCharacterStore } from '../stores/characterStore';
import { usePartyStore } from '../stores/partyStore';
import { usePartyCombatSyncStore } from '../stores/partyCombatSyncStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { ICharacter } from '../api/v1/characterApi';
import type { IPartyInfo, IPartyMember } from '../systems/partySystem';

/**
 * usePartyCombatSync is the leader-authoritative wiring for shared party
 * combat. The hook has SIX nested effects, all gated by whether the local
 * client is in a party with another human. The tests below verify the
 * gate logic — channel subscribe/unsubscribe, leader vs member branching
 * — rather than the full broadcast pipeline (which lives in the
 * partyCombatSyncStore unit tests).
 */

// Suppress combatEngine side-effects: the hook's broadcasts are no-ops
// when the channel mock returns null/undefined, but importing the engine
// inside the test would pull in too much state. Mock the three symbols
// the hook calls.
vi.mock('../systems/combatEngine', () => ({
    handleMonsterDeath:                vi.fn(),
    applyMonsterKillRewardsForMember:  vi.fn(),
    stopCombat:                        vi.fn(),
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
    useSettingsStore.setState({ combatSpeed: 'x1' });
    // Reset only the fields that the hook touches — leave function refs intact.
    usePartyCombatSyncStore.setState({
        lastAttackAction: null,
        lastMemberHit: null,
        lastMonsterKilled: null,
        lastCombatEndAt: 0,
    });
});

describe('usePartyCombatSync — gates', () => {
    it('is a no-op when there is no character', () => {
        usePartyStore.setState({ party: makeParty('me-1', [makeMember('me-1'), makeMember('other')]) });
        const subscribeSpy = vi.spyOn(usePartyCombatSyncStore.getState(), 'subscribe');
        renderHook(() => usePartyCombatSync(), { wrapper });
        // No character -> guard returns immediately, clear() called, never subscribes.
        expect(subscribeSpy).not.toHaveBeenCalled();
    });

    it('is a no-op when not in a party (solo player)', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        usePartyStore.setState({ party: null });
        const subscribeSpy = vi.spyOn(usePartyCombatSyncStore.getState(), 'subscribe');
        renderHook(() => usePartyCombatSync(), { wrapper });
        expect(subscribeSpy).not.toHaveBeenCalled();
    });

    it('is a no-op when the party has only bots besides me', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({
            party: makeParty('me-1', [makeMember('me-1'), makeMember('bot-1', true), makeMember('bot-2', true)]),
        });
        const subscribeSpy = vi.spyOn(usePartyCombatSyncStore.getState(), 'subscribe');
        renderHook(() => usePartyCombatSync(), { wrapper });
        expect(subscribeSpy).not.toHaveBeenCalled();
    });

    it('subscribes to the party-combat channel when at least one other human is in the party', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({
            party: makeParty('me-1', [makeMember('me-1'), makeMember('other-human')]),
        });
        const cleanup = vi.fn();
        const subscribeSpy = vi.spyOn(usePartyCombatSyncStore.getState(), 'subscribe').mockReturnValue(cleanup);
        renderHook(() => usePartyCombatSync(), { wrapper });
        expect(subscribeSpy).toHaveBeenCalledWith('party-1');
    });

    it('runs cleanup on unmount when subscribed', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({
            party: makeParty('me-1', [makeMember('me-1'), makeMember('other-human')]),
        });
        const cleanup = vi.fn();
        vi.spyOn(usePartyCombatSyncStore.getState(), 'subscribe').mockReturnValue(cleanup);
        const { unmount } = renderHook(() => usePartyCombatSync(), { wrapper });
        unmount();
        // The hook's main effect returns a cleanup that invokes the subscribe-returned fn.
        // It MAY also be called more than once due to extra effects firing on unmount;
        // what we care about is "was it called at least once".
        expect(cleanup).toHaveBeenCalled();
    });
});

describe('usePartyCombatSync — leader broadcasts', () => {
    it('publishes the initial combat snapshot when leader has other humans', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'leader-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('member-1')]),
        });
        const publishSpy = vi.spyOn(usePartyCombatSyncStore.getState(), 'publishState');
        renderHook(() => usePartyCombatSync(), { wrapper });
        // Leader's effect calls sendCurrent() immediately on mount.
        expect(publishSpy).toHaveBeenCalled();
        const arg = publishSpy.mock.calls[0]![0];
        expect(arg.senderId).toBe('leader-1');
    });

    it('does NOT broadcast combat state when the local player is a member (not leader)', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'member-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('member-1')]),
        });
        const publishSpy = vi.spyOn(usePartyCombatSyncStore.getState(), 'publishState');
        renderHook(() => usePartyCombatSync(), { wrapper });
        expect(publishSpy).not.toHaveBeenCalled();
    });

    it('broadcasts combat speed on mount for the leader', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'leader-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('member-1')]),
        });
        useSettingsStore.setState({ combatSpeed: 'x4' });
        const speedSpy = vi.spyOn(usePartyCombatSyncStore.getState(), 'publishCombatSpeed');
        renderHook(() => usePartyCombatSync(), { wrapper });
        expect(speedSpy).toHaveBeenCalledWith('x4');
    });
});
