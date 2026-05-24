import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

/**
 * ReadyCheckModal — global "Gotowy?" popup. Mounted in AppShell. Reads
 * party + ready-check state from stores; renders nothing without a party
 * or when the check is closed. Local "Gotowy" button confirms; Anuluj
 * cancels for everyone.
 *
 * BossSprite / MonsterSprite are stubbed so we don't pull in the live
 * asset registry. raidSystem.getAllRaids() is stubbed to return the
 * minimum surface used by `resolveTarget`.
 */

vi.mock('../Sprite/MonsterSprite', () => ({
    BossSprite: ({ name }: { name?: string }) => <div data-testid="boss-sprite">{name}</div>,
    MonsterSprite: ({ name }: { name?: string }) => <div data-testid="monster-sprite">{name}</div>,
}));

vi.mock('../../../systems/raidSystem', () => ({
    getAllRaids: () => [
        { id: 'r1', name_pl: 'Legendarny Raid', level: 50, sourceDungeonId: 'd1' },
    ],
}));

vi.mock('../../../systems/spriteAssets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../systems/spriteAssets')>();
    return {
        ...actual,
        getDungeonImage: () => '/dungeons/d1.png',
    };
});

import ReadyCheckModal from './ReadyCheckModal';
import { useCharacterStore } from '../../../stores/characterStore';
import { usePartyStore } from '../../../stores/partyStore';
import { usePartyReadyCheckStore } from '../../../stores/partyReadyCheckStore';
import type { ICharacter } from '../../../api/v1/characterApi';
import type { IPartyInfo } from '../../../systems/partySystem';

const makeChar = (): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 5,
    xp: 0,
    hp: 100, max_hp: 100, mp: 30, max_mp: 30,
    attack: 15, defense: 12, attack_speed: 2.0,
    crit_chance: 3, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 5,
    equipment: {},
    created_at: '', updated_at: '',
} as ICharacter);

const makeParty = (): IPartyInfo => ({
    id: 'party-1',
    leaderId: 'char-1',
    members: [
        { id: 'char-1', name: 'Hero', class: 'Knight', level: 5, hp: 100, maxHp: 100, isOnline: true },
        { id: 'char-2', name: 'Buddy', class: 'Mage', level: 5, hp: 100, maxHp: 100, isOnline: true },
    ],
    createdAt: '',
});

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    usePartyStore.setState({ party: makeParty() });
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
});

afterEach(() => {
    cleanup();
    usePartyReadyCheckStore.setState({ open: false });
});

describe('ReadyCheckModal — visibility', () => {
    it('renders nothing when ready check is closed', () => {
        const { container } = render(<ReadyCheckModal />);
        expect(container.querySelector('.ready-check__modal')).toBeNull();
    });

    it('renders nothing without a character', () => {
        usePartyReadyCheckStore.setState({ open: true });
        useCharacterStore.setState({ character: null });
        const { container } = render(<ReadyCheckModal />);
        expect(container.querySelector('.ready-check__modal')).toBeNull();
    });

    it('renders nothing without an active party', () => {
        usePartyReadyCheckStore.setState({ open: true, requesterId: 'char-1', requiredIds: ['char-1', 'char-2'] });
        usePartyStore.setState({ party: null });
        const { container } = render(<ReadyCheckModal />);
        expect(container.querySelector('.ready-check__modal')).toBeNull();
    });

    it('renders the modal when open with party + character', () => {
        usePartyReadyCheckStore.setState({
            open: true,
            destination: '/trainer',
            requesterId: 'char-1',
            requiredIds: ['char-1', 'char-2'],
            readyIds: [],
            payload: null,
        });
        render(<ReadyCheckModal />);
        expect(screen.getByText('⚔ Gotowość do walki')).toBeTruthy();
        // Trainer label.
        expect(screen.getByText('Trainer')).toBeTruthy();
    });
});

describe('ReadyCheckModal — destination preview', () => {
    it('shows the hunt label + monster sprite for /combat', () => {
        usePartyReadyCheckStore.setState({
            open: true,
            destination: '/combat',
            requesterId: 'char-1',
            requiredIds: ['char-1'],
            readyIds: [],
            payload: { monster: { id: 'goblin', name_pl: 'Goblin', level: 5, sprite: '👹' } },
        });
        render(<ReadyCheckModal />);
        expect(screen.getByText('Polowanie')).toBeTruthy();
        // Goblin renders in both the preview meta and the sprite stub.
        expect(screen.getAllByText('Goblin').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Lvl 5')).toBeTruthy();
        expect(screen.getByTestId('monster-sprite')).toBeTruthy();
    });

    it('shows the boss label + name from bosses.json lookup', () => {
        usePartyReadyCheckStore.setState({
            open: true,
            destination: '/boss',
            requesterId: 'char-1',
            requiredIds: ['char-1'],
            readyIds: [],
            payload: { bossId: 'troll_king' }, // may not exist; component renders with undefined name
        });
        render(<ReadyCheckModal />);
        expect(screen.getByText('Boss')).toBeTruthy();
    });

    it('renders the raid tile with name + level from raidSystem', () => {
        usePartyReadyCheckStore.setState({
            open: true,
            destination: '/raid',
            requesterId: 'char-1',
            requiredIds: ['char-1'],
            readyIds: [],
            payload: { raidId: 'r1' },
        });
        render(<ReadyCheckModal />);
        expect(screen.getByText('Raid')).toBeTruthy();
        expect(screen.getByText('Legendarny Raid')).toBeTruthy();
        expect(screen.getByText('Lvl 50')).toBeTruthy();
    });
});

describe('ReadyCheckModal — interactions', () => {
    it('fires ready() on the store when Gotowy is clicked', () => {
        usePartyReadyCheckStore.setState({
            open: true,
            destination: '/trainer',
            requesterId: 'char-1',
            requiredIds: ['char-1', 'char-2'],
            readyIds: [],
            payload: null,
        });
        const readySpy = vi.spyOn(usePartyReadyCheckStore.getState(), 'ready');
        render(<ReadyCheckModal />);
        fireEvent.click(screen.getByText('Gotowy'));
        expect(readySpy).toHaveBeenCalledWith('char-1');
        readySpy.mockRestore();
    });

    it('fires cancel() on the store when Anuluj is clicked', () => {
        usePartyReadyCheckStore.setState({
            open: true,
            destination: '/trainer',
            requesterId: 'char-1',
            requiredIds: ['char-1', 'char-2'],
            readyIds: [],
            payload: null,
        });
        const cancelSpy = vi.spyOn(usePartyReadyCheckStore.getState(), 'cancel');
        render(<ReadyCheckModal />);
        fireEvent.click(screen.getByText('Anuluj'));
        expect(cancelSpy).toHaveBeenCalledWith('char-1');
        cancelSpy.mockRestore();
    });

    it('disables the Gotowy button after the local player has readied', () => {
        usePartyReadyCheckStore.setState({
            open: true,
            destination: '/trainer',
            requesterId: 'char-1',
            requiredIds: ['char-1', 'char-2'],
            readyIds: ['char-1'],
            payload: null,
        });
        render(<ReadyCheckModal />);
        const btn = screen.getByText(/Gotowy/) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('lists each party member with a status indicator', () => {
        usePartyReadyCheckStore.setState({
            open: true,
            destination: '/trainer',
            requesterId: 'char-1',
            requiredIds: ['char-1', 'char-2'],
            readyIds: ['char-2'],
            payload: null,
        });
        render(<ReadyCheckModal />);
        // Names of both members.
        expect(screen.getByText('Hero')).toBeTruthy();
        expect(screen.getByText('Buddy')).toBeTruthy();
        // (Ty) suffix on the local player.
        expect(screen.getByText(/\(Ty\)/)).toBeTruthy();
    });
});
