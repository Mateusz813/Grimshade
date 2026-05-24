import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * FloatingNav — bottom-right bubble nav (Home + Chat). Hidden on auth /
 * character-select routes and when no character is selected. Home bubble
 * disappears when on Town; Chat bubble disappears when on /chat. Chat
 * unread badge surfaces from useChatNotificationsStore.
 */

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

import FloatingNav from './FloatingNav';
import { useCharacterStore } from '../../../stores/characterStore';
import { useChatNotificationsStore } from '../../../stores/chatNotificationsStore';
import type { ICharacter } from '../../../api/v1/characterApi';

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

beforeEach(() => {
    navigateMock.mockReset();
    useCharacterStore.setState({ character: makeChar() });
    useChatNotificationsStore.setState({ unreadCount: 0 });
});

afterEach(() => {
    cleanup();
});

const renderAt = (path: string) =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <FloatingNav />
        </MemoryRouter>,
    );

describe('FloatingNav — visibility', () => {
    it('renders nothing when there is no character', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderAt('/');
        expect(container.querySelector('.floating-nav')).toBeNull();
    });

    it('renders nothing on /login (characterless route)', () => {
        const { container } = renderAt('/login');
        expect(container.querySelector('.floating-nav')).toBeNull();
    });

    it('renders nothing on /character-select', () => {
        const { container } = renderAt('/character-select');
        expect(container.querySelector('.floating-nav')).toBeNull();
    });

    it('hides the Home button when already on Town', () => {
        renderAt('/');
        expect(screen.queryByTitle('Miasto')).toBeNull();
        expect(screen.getByTitle('Czat')).toBeTruthy();
    });

    it('hides the Chat button when already on /chat', () => {
        renderAt('/chat');
        expect(screen.queryByTitle('Czat')).toBeNull();
        expect(screen.getByTitle('Miasto')).toBeTruthy();
    });

    it('shows both buttons on a generic in-game route', () => {
        renderAt('/inventory');
        expect(screen.getByTitle('Miasto')).toBeTruthy();
        expect(screen.getByTitle('Czat')).toBeTruthy();
    });
});

describe('FloatingNav — interactions', () => {
    it('navigates to / when Home button is clicked', () => {
        renderAt('/inventory');
        fireEvent.click(screen.getByTitle('Miasto'));
        expect(navigateMock).toHaveBeenCalledWith('/');
    });

    it('navigates to /chat when Chat button is clicked', () => {
        renderAt('/inventory');
        fireEvent.click(screen.getByTitle('Czat'));
        expect(navigateMock).toHaveBeenCalledWith('/chat');
    });
});

describe('FloatingNav — unread badge', () => {
    it('renders the unread count when chat has notifications', () => {
        useChatNotificationsStore.setState({ unreadCount: 3 });
        renderAt('/inventory');
        expect(screen.getByText('3')).toBeTruthy();
    });

    it('clamps the badge to 99+ when unreadCount exceeds 99', () => {
        useChatNotificationsStore.setState({ unreadCount: 150 });
        renderAt('/inventory');
        expect(screen.getByText('99+')).toBeTruthy();
    });

    it('does not render the badge when unreadCount is 0', () => {
        renderAt('/inventory');
        expect(document.querySelector('.floating-nav__badge')).toBeNull();
    });
});
