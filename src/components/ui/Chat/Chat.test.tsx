import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Chat tests — message log + send box + context menu. Cross-store
 * dependencies (friends, guild) are state-driven so the tests can drive
 * them through stores directly. The chatApi is mocked completely so no
 * real network is hit.
 */

const getMessagesMock = vi.fn();
const sendMessageMock = vi.fn();
const subscribeMock = vi.fn();
const unsubscribeMock = vi.fn();

vi.mock('../../../api/v1/chatApi', () => ({
    chatApi: {
        getMessages: (...args: unknown[]) => getMessagesMock(...args),
        sendMessage: (...args: unknown[]) => sendMessageMock(...args),
        subscribe: (...args: unknown[]) => {
            subscribeMock(...args);
            return unsubscribeMock;
        },
    },
    // The interface re-import is satisfied at runtime by our shape;
    // TS uses `import type`, so the runtime mock just needs the value.
}));

vi.mock('../../../api/v1/friendsApi', () => ({
    buildPmChannel: (a: string, b: string) => `pm_${[a, b].sort().join('_')}`,
}));

vi.mock('../../../systems/systemChatMessages', () => ({
    parseSystemMessage: () => null,
}));

vi.mock('../ItemIcon/ItemIcon', () => ({
    __esModule: true,
    default: () => <div data-testid="item-icon-stub" />,
}));

vi.mock('../TinyIcon/TinyIcon', () => ({
    __esModule: true,
    default: ({ icon }: { icon: string }) => <span data-testid="tiny-icon">{icon}</span>,
}));

vi.mock('../../../data/skillIcons', () => ({
    getSkillIcon: () => 'sparkles',
}));

import Chat from './Chat';
import { useFriendsStore } from '../../../stores/friendsStore';
import { useGuildStore } from '../../../stores/guildStore';
import { useGuildTagsStore } from '../../../stores/guildTagsStore';

const baseMessage = (overrides: Partial<{
    id: string;
    channel: string;
    character_name: string;
    character_class: string;
    character_level: number;
    content: string;
    created_at: string;
}> = {}) => ({
    id: 'm1',
    channel: 'city',
    character_name: 'Alice',
    character_class: 'Mage',
    character_level: 10,
    content: 'hi there',
    created_at: '2026-05-22T10:00:00.000Z',
    ...overrides,
});

const renderChat = (props: Partial<Parameters<typeof Chat>[0]> = {}) =>
    render(
        <MemoryRouter>
            <Chat
                channel="city"
                characterName="Hero"
                characterClass="Knight"
                characterLevel={5}
                {...props}
            />
        </MemoryRouter>,
    );

beforeEach(() => {
    getMessagesMock.mockReset();
    sendMessageMock.mockReset();
    subscribeMock.mockReset();
    unsubscribeMock.mockReset();
    getMessagesMock.mockResolvedValue([]);
    sendMessageMock.mockResolvedValue(null);
    useFriendsStore.setState({ friends: [], favorites: [], blocked: [] });
    useGuildStore.setState({ guild: null, members: [], requests: [], loading: false, guildIdByCharacter: {}, channel: null });
    useGuildTagsStore.setState({ tags: {}, tagsByName: {} });
});

afterEach(() => {
    cleanup();
});

describe('Chat — smoke', () => {
    it('renders the title and the empty placeholder when no messages', async () => {
        renderChat({ title: 'City' });
        expect(screen.getByText('City')).toBeTruthy();
        // Empty-state copy renders synchronously before the async getMessages
        // promise resolves (with []).
        expect(screen.getByText(/Brak wiadomości/)).toBeTruthy();
        // Sanity: getMessages was kicked off on mount.
        await waitFor(() => expect(getMessagesMock).toHaveBeenCalledWith('city', undefined));
    });

    it('renders the input + send button (disabled while empty)', () => {
        renderChat();
        const input = document.querySelector('.chat__input') as HTMLInputElement;
        const sendBtn = document.querySelector('.chat__send') as HTMLButtonElement;
        expect(input).toBeTruthy();
        expect(sendBtn.disabled).toBe(true);
    });

    it('subscribes to the channel on mount and unsubscribes on unmount', () => {
        const { unmount } = renderChat();
        expect(subscribeMock).toHaveBeenCalled();
        unmount();
        expect(unsubscribeMock).toHaveBeenCalled();
    });
});

describe('Chat — message rendering', () => {
    it('renders messages returned by chatApi.getMessages', async () => {
        getMessagesMock.mockResolvedValueOnce([
            baseMessage({ id: '1', content: 'hello world', character_name: 'Alice' }),
        ]);
        renderChat();
        await waitFor(() => {
            expect(screen.getByText('hello world')).toBeTruthy();
        });
    });

    it('hides messages from blocked users (but not the player themselves)', async () => {
        getMessagesMock.mockResolvedValueOnce([
            baseMessage({ id: 'blocked', character_name: 'Troll', content: 'spam spam' }),
            baseMessage({ id: 'visible', character_name: 'Hero', content: 'my own line' }),
        ]);
        useFriendsStore.setState({ blocked: ['Troll'], friends: [], favorites: [] });
        renderChat();
        await waitFor(() => {
            expect(screen.queryByText('spam spam')).toBeNull();
            expect(screen.getByText('my own line')).toBeTruthy();
        });
    });

    it('marks own messages with the me modifier class', async () => {
        getMessagesMock.mockResolvedValueOnce([
            baseMessage({ id: '1', character_name: 'Hero', content: 'mine' }),
            baseMessage({ id: '2', character_name: 'Alice', content: 'theirs' }),
        ]);
        renderChat();
        await waitFor(() => {
            expect(screen.getByText('mine')).toBeTruthy();
        });
        const meMsg = screen.getByText('mine').closest('.chat__msg');
        expect(meMsg?.className.includes('chat__msg--me')).toBe(true);
    });
});

describe('Chat — sending', () => {
    it('sends typed text and clears the input on success', async () => {
        sendMessageMock.mockResolvedValueOnce(
            baseMessage({ id: 'sent', character_name: 'Hero', content: 'hello' }),
        );
        renderChat();
        const input = document.querySelector('.chat__input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'hello' } });
        // Send button enables.
        const btn = document.querySelector('.chat__send') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
        await act(async () => {
            fireEvent.click(btn);
        });
        await waitFor(() => {
            expect(sendMessageMock).toHaveBeenCalledWith('city', 'hello', 'Hero', 'Knight', 5);
            expect(input.value).toBe('');
        });
    });

    it('sends on Enter keypress (without shift)', async () => {
        sendMessageMock.mockResolvedValueOnce(
            baseMessage({ id: 'sent', character_name: 'Hero', content: 'enter-msg' }),
        );
        renderChat();
        const input = document.querySelector('.chat__input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'enter-msg' } });
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
        });
        await waitFor(() => {
            expect(sendMessageMock).toHaveBeenCalled();
        });
    });

    it('shows an error message when sendMessage rejects', async () => {
        sendMessageMock.mockRejectedValueOnce(new Error('boom'));
        renderChat();
        const input = document.querySelector('.chat__input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'x' } });
        await act(async () => {
            fireEvent.click(document.querySelector('.chat__send')!);
        });
        await waitFor(() => {
            expect(screen.getByText(/Nie udało się wysłać/)).toBeTruthy();
        });
    });
});

describe('Chat — load failure', () => {
    it('renders a load error when chatApi.getMessages rejects', async () => {
        getMessagesMock.mockRejectedValueOnce(new Error('network down'));
        renderChat();
        await waitFor(() => {
            expect(screen.getByText(/Błąd ładowania wiadomości/)).toBeTruthy();
        });
    });
});

describe('Chat — context menu (other-player nick)', () => {
    it('opens a context menu when another player nick is clicked', async () => {
        getMessagesMock.mockResolvedValueOnce([
            baseMessage({ id: '1', character_name: 'Alice', content: 'hi' }),
        ]);
        renderChat();
        await waitFor(() => {
            expect(screen.getByText('hi')).toBeTruthy();
        });
        // Nick button (other player) — the disambiguator is the "Alice:" prefix.
        const nickBtn = screen.getByText(/Alice:/);
        fireEvent.click(nickBtn);
        // Menu portal renders into document.body — verify by anchor item label.
        expect(screen.getByText(/Dodaj do znajomych/)).toBeTruthy();
    });
});
