import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * ChatUnreadBadge — fixed-corner chat button + notification dot.
 * Hidden until a character is loaded, on characterless routes, and in
 * offline mode. Toggles the ChatPopup; ChatPopup is stubbed here so we
 * isolate the badge's own gating + interactions.
 */

vi.mock('./ChatPopup', () => ({
    __esModule: true,
    default: ({ open, onClose }: { open: boolean; onClose: () => void }) => (
        open ? (
            <div data-testid="chat-popup">
                <button onClick={onClose}>close-popup</button>
            </div>
        ) : null
    ),
}));

import ChatUnreadBadge from './ChatUnreadBadge';
import { useCharacterStore } from '../../../stores/characterStore';
import { useChatTabsStore } from '../../../stores/chatTabsStore';
import { useTransformStore } from '../../../stores/transformStore';
import { useConnectivityStore } from '../../../stores/connectivityStore';
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

const renderAt = (path: string) =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <ChatUnreadBadge />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useChatTabsStore.setState({ hasNotification: false });
    useConnectivityStore.setState({ mode: 'online' });
    // Reset transform store to default (no completed transforms → no color).
    useTransformStore.setState({ completedTransforms: [] });
});

afterEach(() => {
    cleanup();
});

describe('ChatUnreadBadge — visibility', () => {
    it('renders nothing when no character is loaded', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderAt('/inventory');
        expect(container.querySelector('.chat-unread-badge')).toBeNull();
    });

    it('renders nothing on /login (characterless route)', () => {
        const { container } = renderAt('/login');
        expect(container.querySelector('.chat-unread-badge')).toBeNull();
    });

    it('renders nothing on /character-select', () => {
        const { container } = renderAt('/character-select');
        expect(container.querySelector('.chat-unread-badge')).toBeNull();
    });

    it('renders nothing in offline mode', () => {
        useConnectivityStore.setState({ mode: 'offline' });
        const { container } = renderAt('/inventory');
        expect(container.querySelector('.chat-unread-badge')).toBeNull();
    });

    it('renders the badge on a regular in-game route', () => {
        renderAt('/inventory');
        expect(document.querySelector('.chat-unread-badge')).toBeTruthy();
    });
});

describe('ChatUnreadBadge — notification dot', () => {
    it('renders no dot by default', () => {
        renderAt('/inventory');
        expect(document.querySelector('.chat-unread-badge__dot')).toBeNull();
    });

    it('renders the dot when chatTabsStore.hasNotification is true', () => {
        useChatTabsStore.setState({ hasNotification: true });
        renderAt('/inventory');
        expect(document.querySelector('.chat-unread-badge__dot')).toBeTruthy();
    });
});

describe('ChatUnreadBadge — popup toggle', () => {
    it('opens the popup on click', () => {
        renderAt('/inventory');
        // Popup closed initially.
        expect(screen.queryByTestId('chat-popup')).toBeNull();
        fireEvent.click(document.querySelector('.chat-unread-badge')!);
        expect(screen.getByTestId('chat-popup')).toBeTruthy();
    });

    it('clears the notification flag when icon is clicked', () => {
        useChatTabsStore.setState({ hasNotification: true });
        const clearSpy = vi.spyOn(useChatTabsStore.getState(), 'clearNotification');
        renderAt('/inventory');
        fireEvent.click(document.querySelector('.chat-unread-badge')!);
        expect(clearSpy).toHaveBeenCalled();
        clearSpy.mockRestore();
    });
});
