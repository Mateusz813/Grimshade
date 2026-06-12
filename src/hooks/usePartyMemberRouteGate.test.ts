import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIsPartyMemberLocked, usePartyMemberRouteGate } from './usePartyMemberRouteGate';
import { useCharacterStore } from '../stores/characterStore';
import { usePartyStore } from '../stores/partyStore';
import type { ICharacter } from '../api/v1/characterApi';
import type { IPartyInfo, IPartyMember } from '../systems/partySystem';

/**
 * Two exports here:
 *
 *   - `usePartyMemberRouteGate` is the legacy no-op kept for AppShell —
 *     just verify it returns void and doesn't blow up.
 *
 *   - `useIsPartyMemberLocked` is the real predicate, returning true
 *     when the local player is a non-leader member of a multi-human
 *     party. Boss/raid/trainer tiles use this to disable click on
 *     non-leader members per the 2026-05-12 spec.
 */

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

describe('useIsPartyMemberLocked', () => {
    it('returns false when there is no character (defensive)', () => {
        usePartyStore.setState({ party: makeParty('leader-1', [makeMember('leader-1'), makeMember('me-1')]) });
        const { result } = renderHook(() => useIsPartyMemberLocked());
        expect(result.current).toBe(false);
    });

    it('returns false when not in a party (solo)', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        const { result } = renderHook(() => useIsPartyMemberLocked());
        expect(result.current).toBe(false);
    });

    it('returns false when the party only has the local player', () => {
        // Single-member party — no other humans -> no lock.
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({ party: makeParty('me-1', [makeMember('me-1')]) });
        const { result } = renderHook(() => useIsPartyMemberLocked());
        expect(result.current).toBe(false);
    });

    it('returns false when the party has only bots besides me', () => {
        // Bots don't count as "other humans" — lock stays off.
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({
            party: makeParty('me-1', [makeMember('me-1'), makeMember('bot-1', true), makeMember('bot-2', true)]),
        });
        const { result } = renderHook(() => useIsPartyMemberLocked());
        expect(result.current).toBe(false);
    });

    it('returns false when I am the leader of a multi-human party', () => {
        // Leaders pick the fight — they're never locked out.
        useCharacterStore.setState({ character: makeCharacter({ id: 'leader-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('other-human')]),
        });
        const { result } = renderHook(() => useIsPartyMemberLocked());
        expect(result.current).toBe(false);
    });

    it('returns TRUE when I am a non-leader member of a multi-human party', () => {
        // The whole point of the hook — disable the click.
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('me-1')]),
        });
        const { result } = renderHook(() => useIsPartyMemberLocked());
        expect(result.current).toBe(true);
    });

    it('returns false when a multi-human party includes me as leader plus a bot', () => {
        // Mixed humans+bots case: there's another HUMAN, but I'm the leader.
        useCharacterStore.setState({ character: makeCharacter({ id: 'leader-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('other-human'), makeMember('bot-1', true)]),
        });
        const { result } = renderHook(() => useIsPartyMemberLocked());
        expect(result.current).toBe(false);
    });

    it('returns true when multiple other humans exist and I am a non-leader', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [
                makeMember('leader-1'),
                makeMember('me-1'),
                makeMember('other-2'),
                makeMember('bot-1', true),
            ]),
        });
        const { result } = renderHook(() => useIsPartyMemberLocked());
        expect(result.current).toBe(true);
    });

    it('reacts when the leader id flips to me (e.g. promotion)', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('me-1')]),
        });
        const { result, rerender } = renderHook(() => useIsPartyMemberLocked());
        expect(result.current).toBe(true);
        // Promote me to leader.
        usePartyStore.setState({
            party: makeParty('me-1', [makeMember('leader-1'), makeMember('me-1')]),
        });
        rerender();
        expect(result.current).toBe(false);
    });
});

describe('usePartyMemberRouteGate (legacy no-op)', () => {
    it('returns void and does not throw', () => {
        // Sanity: the legacy export is intentionally empty per the
        // 2026-05-12 spec switch from redirect-on-enter to disable-on-click.
        const { result } = renderHook(() => usePartyMemberRouteGate());
        expect(result.current).toBeUndefined();
    });

    it('does not crash when party / character are present', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('me-1')]),
        });
        expect(() => renderHook(() => usePartyMemberRouteGate())).not.toThrow();
    });
});
