import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';


const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

import Social from './Social';
import { useCharacterStore } from '../../stores/characterStore';
import { useTransformStore } from '../../stores/transformStore';
import type { ICharacter } from '../../api/v1/characterApi';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 10,
    xp: 0,
    hp: 100, max_hp: 100, mp: 30, max_mp: 30,
    attack: 15, defense: 12, attack_speed: 2.0,
    crit_chance: 3, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 10,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

const renderSocial = () =>
    render(
        <MemoryRouter>
            <Social />
        </MemoryRouter>,
    );

beforeEach(() => {
    navigateMock.mockClear();
    useCharacterStore.setState({ character: makeChar() });
    useTransformStore.setState({ completedTransforms: [] });
});

afterEach(() => {
    cleanup();
});

describe('Social — smoke', () => {
    it('renders the root .social container', () => {
        const { container } = renderSocial();
        expect(container.querySelector('.social')).not.toBeNull();
    });

    it('renders 4 tile buttons (Party / Gildia / Znajomi / Czat)', () => {
        const { container } = renderSocial();
        const tiles = container.querySelectorAll('.social__tile');
        expect(tiles.length).toBe(4);
    });

    it('exposes correct aria-labels on the tiles', () => {
        const { container } = renderSocial();
        const labels = Array.from(container.querySelectorAll('.social__tile')).map(
            (t) => t.getAttribute('aria-label'),
        );
        expect(labels).toEqual(['Party', 'Gildia', 'Znajomi', 'Czat']);
    });

    it('renders the inner wrapper', () => {
        const { container } = renderSocial();
        expect(container.querySelector('.social__inner')).not.toBeNull();
    });
});

describe('Social — navigation', () => {
    it('navigates to /party when the Party tile is clicked', () => {
        const { container } = renderSocial();
        const partyTile = container.querySelector('.social__tile--party') as HTMLButtonElement;
        fireEvent.click(partyTile);
        expect(navigateMock).toHaveBeenCalledWith('/party');
    });

    it('navigates to /guild when the Gildia tile is clicked', () => {
        const { container } = renderSocial();
        const guildTile = container.querySelector('.social__tile--gildia') as HTMLButtonElement;
        fireEvent.click(guildTile);
        expect(navigateMock).toHaveBeenCalledWith('/guild');
    });

    it('navigates to /friends when the Znajomi tile is clicked', () => {
        const { container } = renderSocial();
        const friendsTile = container.querySelector('.social__tile--znajomi') as HTMLButtonElement;
        fireEvent.click(friendsTile);
        expect(navigateMock).toHaveBeenCalledWith('/friends');
    });

    it('navigates to /chat when the Czat tile is clicked', () => {
        const { container } = renderSocial();
        const chatTile = container.querySelector('.social__tile--czat') as HTMLButtonElement;
        fireEvent.click(chatTile);
        expect(navigateMock).toHaveBeenCalledWith('/chat');
    });
});

describe('Social — edge cases', () => {
    it('still renders the root + 4 tiles when character is null (fallback accent)', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderSocial();
        expect(container.querySelector('.social')).not.toBeNull();
        expect(container.querySelectorAll('.social__tile').length).toBe(4);
    });

    it('renders for a Mage character (purple class accent path)', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Mage' }) });
        const { container } = renderSocial();
        expect(container.querySelector('.social')).not.toBeNull();
        expect(container.querySelectorAll('.social__tile').length).toBe(4);
    });

    it('renders for an Archer character', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Archer' }) });
        const { container } = renderSocial();
        expect(container.querySelectorAll('.social__tile').length).toBe(4);
    });

    it('renders for a Necromancer character', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Necromancer' }) });
        const { container } = renderSocial();
        expect(container.querySelectorAll('.social__tile').length).toBe(4);
    });
});

