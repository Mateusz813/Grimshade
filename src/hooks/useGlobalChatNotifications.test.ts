import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';


vi.mock('../api/v1/chatApi', () => ({
    chatApi: {
        subscribeAll: vi.fn(),
    },
}));

import { useGlobalChatNotifications } from './useGlobalChatNotifications';
import { chatApi, type IMessage } from '../api/v1/chatApi';
import { useChatNotificationsStore } from '../stores/chatNotificationsStore';
import { useChatTabsStore } from '../stores/chatTabsStore';
import { useCharacterStore, type ICharacter } from '../stores/characterStore';

const makeChar = (name = 'Hero'): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name,
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

const makeMsg = (overrides: Partial<IMessage> = {}): IMessage => ({
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    channel: 'city',
    character_name: 'Stranger',
    character_class: 'Mage',
    character_level: 10,
    content: 'hi',
    created_at: new Date().toISOString(),
    ...overrides,
});

const renderWithRouter = (initialPath: string) =>
    renderHook(() => useGlobalChatNotifications(), {
        wrapper: ({ children }) =>
            React.createElement(MemoryRouter, { initialEntries: [initialPath] }, children),
    });

beforeEach(() => {
    vi.clearAllMocks();
    (chatApi.subscribeAll as ReturnType<typeof vi.fn>).mockReturnValue(() => undefined);
    useChatNotificationsStore.setState({ unreadCount: 0 });
    useChatTabsStore.setState({
        tabs: [
            { id: 'city', type: 'city', channel: 'city', title: 'Miasto', unread: 0, closable: false },
        ],
        activeId: 'city',
        hasNotification: false,
    });
    useCharacterStore.setState({ character: makeChar(), isLoading: false });
});

describe('useGlobalChatNotifications', () => {
    it('opens a single global subscription via subscribeAll', () => {
        renderWithRouter('/town');
        expect(chatApi.subscribeAll).toHaveBeenCalledTimes(1);
    });

    it('does NOT subscribe when there is no character', () => {
        useCharacterStore.setState({ character: null });
        renderWithRouter('/town');
        expect(chatApi.subscribeAll).not.toHaveBeenCalled();
    });

    it('increments unread on foreign city messages while NOT on /chat', () => {
        renderWithRouter('/town');
        const cb = (chatApi.subscribeAll as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
            | ((msg: IMessage) => void)
            | undefined;
        expect(cb).toBeDefined();
        act(() => {
            cb!(makeMsg({ channel: 'city', character_name: 'Stranger' }));
        });
        expect(useChatNotificationsStore.getState().unreadCount).toBe(1);
    });

    it('ignores messages sent by the current character', () => {
        renderWithRouter('/town');
        const cb = (chatApi.subscribeAll as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
            | ((msg: IMessage) => void)
            | undefined;
        act(() => {
            cb!(makeMsg({ channel: 'city', character_name: 'Hero' }));
        });
        expect(useChatNotificationsStore.getState().unreadCount).toBe(0);
    });

    it('does NOT bump unread for non-city channels (PM path handled elsewhere)', () => {
        renderWithRouter('/town');
        const cb = (chatApi.subscribeAll as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
            | ((msg: IMessage) => void)
            | undefined;
        act(() => {
            cb!(makeMsg({ channel: 'pm_hero_stranger', character_name: 'Stranger' }));
            cb!(makeMsg({ channel: 'system', character_name: 'Stranger' }));
        });
        expect(useChatNotificationsStore.getState().unreadCount).toBe(0);
    });

    it('clears unread and the floating chat dot when on /chat route', () => {
        useChatNotificationsStore.setState({ unreadCount: 5 });
        useChatTabsStore.setState({ hasNotification: true });
        renderWithRouter('/chat');
        expect(useChatNotificationsStore.getState().unreadCount).toBe(0);
        expect(useChatTabsStore.getState().hasNotification).toBe(false);
    });

    it('does NOT bump unread when on /chat (the mount effect markAllRead has run)', () => {
        useChatNotificationsStore.setState({ unreadCount: 7 });
        renderWithRouter('/chat');
        expect(useChatNotificationsStore.getState().unreadCount).toBe(0);
    });

    it('returns the unsub from subscribeAll on unmount', () => {
        const unsub = vi.fn();
        (chatApi.subscribeAll as ReturnType<typeof vi.fn>).mockReturnValue(unsub);
        const { unmount } = renderWithRouter('/town');
        unmount();
        expect(unsub).toHaveBeenCalled();
    });
});
