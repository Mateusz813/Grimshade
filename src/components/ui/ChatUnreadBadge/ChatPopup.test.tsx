import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * ChatPopup — floating mini-chat dialog driven by useChatTabsStore.
 * The heavy Chat child is stubbed so we focus on tab management:
 * close button, tab switching, Escape, outside click, no-character bail.
 */

vi.mock('../Chat/Chat', () => ({
    __esModule: true,
    default: ({ active, title, channel }: { active: boolean; title: string; channel: string }) => (
        <div
            data-testid={`chat-stub-${channel}`}
            data-active={active ? 'true' : 'false'}
        >
            {title}
        </div>
    ),
}));

import ChatPopup from './ChatPopup';
import { useCharacterStore } from '../../../stores/characterStore';
import { useChatTabsStore } from '../../../stores/chatTabsStore';
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

const renderOpen = (onClose = () => undefined) =>
    render(
        <MemoryRouter>
            <ChatPopup open onClose={onClose} />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    // Reset to the two default tabs (city + system) and the city tab active.
    useChatTabsStore.setState({
        tabs: [
            { id: 'city', type: 'city', channel: 'city', title: '🌆 Miasto', unread: 0, closable: false },
            { id: 'system', type: 'system', channel: 'system', title: '⚠️ System', unread: 0, closable: false },
        ],
        activeId: 'city',
        hasNotification: false,
    });
});

afterEach(() => {
    cleanup();
});

describe('ChatPopup — visibility', () => {
    it('renders nothing when open is false', () => {
        const { container } = render(
            <MemoryRouter>
                <ChatPopup open={false} onClose={() => undefined} />
            </MemoryRouter>,
        );
        expect(container.querySelector('.chat-popup')).toBeNull();
    });

    it('renders nothing when there is no character', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderOpen();
        expect(container.querySelector('.chat-popup')).toBeNull();
    });

    it('renders the dialog header and city + system tabs', () => {
        renderOpen();
        expect(screen.getByRole('dialog', { name: 'Czat' })).toBeTruthy();
        // Tabs render the title text — Chat stub also echoes it inside the
        // body, so use the role=tab anchor to disambiguate.
        const tabs = screen.getAllByRole('tab');
        expect(tabs.length).toBe(2);
        expect(tabs.some((t) => t.textContent?.includes('Miasto'))).toBe(true);
        expect(tabs.some((t) => t.textContent?.includes('System'))).toBe(true);
    });

    it('mounts the Chat child for every tab, marking only one active', () => {
        renderOpen();
        const city = screen.getByTestId('chat-stub-city');
        const system = screen.getByTestId('chat-stub-system');
        expect(city.getAttribute('data-active')).toBe('true');
        expect(system.getAttribute('data-active')).toBe('false');
    });
});

describe('ChatPopup — interactions', () => {
    it('calls onClose when the X button is clicked', () => {
        const onClose = vi.fn();
        renderOpen(onClose);
        fireEvent.click(screen.getByLabelText('Zamknij czat'));
        expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when Escape is pressed', () => {
        const onClose = vi.fn();
        renderOpen(onClose);
        act(() => {
            const evt = new KeyboardEvent('keydown', { key: 'Escape' });
            window.dispatchEvent(evt);
        });
        expect(onClose).toHaveBeenCalled();
    });

    it('switches the active tab when another tab button is clicked', () => {
        renderOpen();
        const systemTab = screen.getAllByRole('tab').find((t) => t.textContent?.includes('System'))!;
        fireEvent.click(systemTab);
        // The store's setActive marks the clicked tab active + zeros unread.
        expect(useChatTabsStore.getState().activeId).toBe('system');
    });

    it('renders unread counter when a tab has unread > 0', () => {
        useChatTabsStore.setState({
            tabs: [
                { id: 'city', type: 'city', channel: 'city', title: '🌆 Miasto', unread: 7, closable: false },
                { id: 'system', type: 'system', channel: 'system', title: '⚠️ System', unread: 0, closable: false },
            ],
            activeId: 'system',
        });
        renderOpen();
        expect(screen.getByText('7')).toBeTruthy();
    });

    it('clamps unread badge text at 99+', () => {
        useChatTabsStore.setState({
            tabs: [
                { id: 'city', type: 'city', channel: 'city', title: '🌆 Miasto', unread: 250, closable: false },
                { id: 'system', type: 'system', channel: 'system', title: '⚠️ System', unread: 0, closable: false },
            ],
            activeId: 'system',
        });
        renderOpen();
        expect(screen.getByText('99+')).toBeTruthy();
    });

    it('shows close button on closable tabs only', () => {
        useChatTabsStore.setState({
            tabs: [
                { id: 'city', type: 'city', channel: 'city', title: '🌆 Miasto', unread: 0, closable: false },
                { id: 'pm_x', type: 'pm', channel: 'pm_x', title: 'PM Foo', unread: 0, closable: true, targetName: 'Foo' },
            ],
            activeId: 'city',
        });
        renderOpen();
        // Only the PM tab gets the close-rozmowę button.
        const closeButtons = document.querySelectorAll('.chat-popup__tab-close');
        expect(closeButtons.length).toBe(1);
    });
});
