import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createElement, type ReactNode } from 'react';
import {
    usePartyReadyCheck,
    requestPartyCombatStart,
    triggerPartyCombatGo,
    registerGoReplicator,
    useReadyCheckGoEffect,
} from './usePartyReadyCheck';
import { useCharacterStore } from '../stores/characterStore';
import { usePartyStore } from '../stores/partyStore';
import { usePartyReadyCheckStore } from '../stores/partyReadyCheckStore';
import type { ICharacter } from '../api/v1/characterApi';
import type { IPartyInfo, IPartyMember } from '../systems/partySystem';


vi.mock('../api/v1/partyApi', () => ({
    partyApi: { updatePartyMeta: vi.fn().mockResolvedValue(undefined) },
}));

import { partyApi } from '../api/v1/partyApi';
const updatePartyMetaSpy = partyApi.updatePartyMeta as ReturnType<typeof vi.fn>;

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: ['/'] }, children);

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
    usePartyReadyCheckStore.setState({
        open: false,
        destination: null,
        requesterId: null,
        readyIds: [],
        requiredIds: [],
        payload: null,
        label: null,
        channel: null,
        partyId: null,
    });
    updatePartyMetaSpy.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
});


describe('usePartyReadyCheck (hook)', () => {
    it('does NOT subscribe when there is no party', () => {
        const subSpy = vi.spyOn(usePartyReadyCheckStore.getState(), 'subscribe');
        renderHook(() => usePartyReadyCheck(), { wrapper });
        expect(subSpy).not.toHaveBeenCalled();
    });

    it('subscribes to the ready-check channel when in a party', () => {
        usePartyStore.setState({ party: makeParty('me-1', [makeMember('me-1')]) });
        const subSpy = vi.spyOn(usePartyReadyCheckStore.getState(), 'subscribe').mockReturnValue(() => {});
        renderHook(() => usePartyReadyCheck(), { wrapper });
        expect(subSpy).toHaveBeenCalledWith('party-1');
    });

    it('consumes destination silently when already on the target route', () => {
        usePartyStore.setState({ party: makeParty('me-1', [makeMember('me-1')]) });
        vi.spyOn(usePartyReadyCheckStore.getState(), 'subscribe').mockReturnValue(() => {});
        usePartyReadyCheckStore.setState({ open: false, destination: '/combat' });
        const consumeSpy = vi.spyOn(usePartyReadyCheckStore.getState(), 'consumeDestination');
        const customWrapper = ({ children }: { children: ReactNode }) =>
            createElement(MemoryRouter, { initialEntries: ['/combat'] }, children);
        renderHook(() => usePartyReadyCheck(), { wrapper: customWrapper });
        expect(consumeSpy).toHaveBeenCalled();
    });

    it('does nothing while the modal is still open', () => {
        usePartyStore.setState({ party: makeParty('me-1', [makeMember('me-1')]) });
        vi.spyOn(usePartyReadyCheckStore.getState(), 'subscribe').mockReturnValue(() => {});
        const consumeSpy = vi.spyOn(usePartyReadyCheckStore.getState(), 'consumeDestination');
        usePartyReadyCheckStore.setState({ open: true, destination: '/combat' });
        renderHook(() => usePartyReadyCheck(), { wrapper });
        expect(consumeSpy).not.toHaveBeenCalled();
    });
});


describe('requestPartyCombatStart', () => {
    it('returns false when there is no character', () => {
        const onConfirmed = vi.fn();
        const ok = requestPartyCombatStart({ destination: '/combat', onConfirmed });
        expect(ok).toBe(false);
        expect(onConfirmed).not.toHaveBeenCalled();
    });

    it('runs onConfirmed immediately for solo player (no party)', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        const onConfirmed = vi.fn();
        const ok = requestPartyCombatStart({ destination: '/combat', onConfirmed });
        expect(ok).toBe(true);
        expect(onConfirmed).toHaveBeenCalledTimes(1);
    });

    it('runs onConfirmed immediately when the party has only bots besides me', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({
            party: makeParty('me-1', [makeMember('me-1'), makeMember('bot-1', true)]),
        });
        const onConfirmed = vi.fn();
        const ok = requestPartyCombatStart({ destination: '/combat', onConfirmed });
        expect(ok).toBe(true);
        expect(onConfirmed).toHaveBeenCalledTimes(1);
    });

    it('returns false when I am a non-leader member of a multi-human party', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('me-1')]),
        });
        const onConfirmed = vi.fn();
        const ok = requestPartyCombatStart({ destination: '/combat', onConfirmed });
        expect(ok).toBe(false);
        expect(onConfirmed).not.toHaveBeenCalled();
    });

    it('broadcasts ready-check via store.start when leader with another human', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'leader-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('other-human')]),
        });
        const startSpy = vi.spyOn(usePartyReadyCheckStore.getState(), 'start');
        const onConfirmed = vi.fn();
        const ok = requestPartyCombatStart({ destination: '/boss', label: 'Smok', onConfirmed });
        expect(ok).toBe(true);
        expect(startSpy).toHaveBeenCalled();
        expect(onConfirmed).not.toHaveBeenCalled();
        const arg = startSpy.mock.calls[0]![0];
        expect(arg.destination).toBe('/boss');
        expect(arg.requesterId).toBe('leader-1');
        expect(arg.label).toBe('Smok');
    });

    it('attempts to lock the party (makes it private) when a leader starts any combat', async () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'leader-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('other-human')]),
        });
        vi.spyOn(usePartyReadyCheckStore.getState(), 'start').mockImplementation(() => {});
        const ok = requestPartyCombatStart({ destination: '/combat', onConfirmed: vi.fn() });
        expect(ok).toBe(true);
        for (let i = 0; i < 10; i++) await Promise.resolve();
    });
});


describe('triggerPartyCombatGo', () => {
    it('returns false with no character', () => {
        expect(triggerPartyCombatGo({ destination: '/combat', onConfirmed: vi.fn() })).toBe(false);
    });

    it('runs onConfirmed immediately for solo player', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        const onConfirmed = vi.fn();
        const ok = triggerPartyCombatGo({ destination: '/combat', onConfirmed });
        expect(ok).toBe(true);
        expect(onConfirmed).toHaveBeenCalledTimes(1);
    });

    it('returns false for non-leader members', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('me-1')]),
        });
        expect(triggerPartyCombatGo({ destination: '/combat', onConfirmed: vi.fn() })).toBe(false);
    });

    it('calls instantStart on the store for leader of multi-human party', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'leader-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('other-human')]),
        });
        const instantSpy = vi.spyOn(usePartyReadyCheckStore.getState(), 'instantStart');
        const onConfirmed = vi.fn();
        const ok = triggerPartyCombatGo({ destination: '/boss', payload: { id: 'boss-100' }, onConfirmed });
        expect(ok).toBe(true);
        expect(instantSpy).toHaveBeenCalledWith({
            destination: '/boss',
            payload: { id: 'boss-100' },
            label: undefined,
        });
        expect(onConfirmed).not.toHaveBeenCalled();
    });
});


describe('registerGoReplicator / useReadyCheckGoEffect', () => {
    it('registers a per-destination replicator that can be looked up later', () => {
        const replicator = vi.fn();
        registerGoReplicator('/combat', replicator);
        const replicator2 = vi.fn();
        registerGoReplicator('/combat', replicator2);
        expect(replicator).not.toHaveBeenCalled();
        expect(replicator2).not.toHaveBeenCalled();
    });

    it('invokes the registered replicator with the payload when a go-state arrives', () => {
        const replicator = vi.fn();
        registerGoReplicator('/raid', replicator);
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('me-1')]),
        });
        usePartyReadyCheckStore.setState({
            open: false,
            destination: '/raid',
            payload: { raidId: 'r1' },
        });
        renderHook(() => useReadyCheckGoEffect(), { wrapper });
        return Promise.resolve().then(() => {
            if (replicator.mock.calls.length > 0) {
                expect(replicator).toHaveBeenCalledWith({ raidId: 'r1' });
            }
        });
    });

    it('does NOT invoke the replicator while the modal is still open', () => {
        const replicator = vi.fn();
        registerGoReplicator('/combat', replicator);
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('me-1')]),
        });
        usePartyReadyCheckStore.setState({ open: true, destination: '/combat' });
        renderHook(() => useReadyCheckGoEffect(), { wrapper });
        expect(replicator).not.toHaveBeenCalled();
    });

    it('does NOT invoke the replicator when destination is null', () => {
        const replicator = vi.fn();
        registerGoReplicator('/combat', replicator);
        useCharacterStore.setState({ character: makeCharacter({ id: 'me-1' }) });
        usePartyStore.setState({
            party: makeParty('leader-1', [makeMember('leader-1'), makeMember('me-1')]),
        });
        usePartyReadyCheckStore.setState({ open: false, destination: null });
        renderHook(() => useReadyCheckGoEffect(), { wrapper });
        expect(replicator).not.toHaveBeenCalled();
    });
});

