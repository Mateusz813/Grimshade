import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';


vi.mock('../api/v1/chatApi', () => {
    const subscribe = vi.fn();
    const subscribeAll = vi.fn();
    const getMessages = vi.fn();
    return {
        chatApi: {
            subscribe,
            subscribeAll,
            getMessages,
        },
    };
});

import { useChatUnreadSubscription } from './useChatUnreadSubscription';
import { chatApi, type IMessage } from '../api/v1/chatApi';
import { useChatTabsStore } from '../stores/chatTabsStore';
import { useCharacterStore, type ICharacter } from '../stores/characterStore';
import { useFriendsStore } from '../stores/friendsStore';
import { useGuildStore } from '../stores/guildStore';
import { usePartyStore } from '../stores/partyStore';

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
    channel: 'system',
    character_name: 'Stranger',
    character_class: 'Mage',
    character_level: 10,
    content: 'hi',
    created_at: new Date().toISOString(),
    ...overrides,
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (chatApi.getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (chatApi.subscribe as ReturnType<typeof vi.fn>).mockReturnValue(() => undefined);
    (chatApi.subscribeAll as ReturnType<typeof vi.fn>).mockReturnValue(() => undefined);

    useChatTabsStore.setState({
        tabs: [
            { id: 'city', type: 'city', channel: 'city', title: 'Miasto', unread: 0, closable: false },
            { id: 'system', type: 'system', channel: 'system', title: 'System', unread: 0, closable: false },
        ],
        activeId: 'city',
        hasNotification: false,
    });
    useCharacterStore.setState({ character: makeChar(), isLoading: false });
    useGuildStore.setState({ guild: null });
    usePartyStore.setState({ party: null });
    useFriendsStore.setState({ friends: [], favorites: [], blocked: [] });
});

afterEach(() => {
    vi.useRealTimers();
});

const getRealtimeCallback = (channel: string): ((msg: IMessage) => void) | null => {
    const call = (chatApi.subscribe as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === channel,
    );
    return call ? (call[1] as (msg: IMessage) => void) : null;
};

describe('useChatUnreadSubscription — wiring', () => {
    it('subscribes to system channel when character is loaded', () => {
        renderHook(() => useChatUnreadSubscription());
        expect(chatApi.subscribe).toHaveBeenCalledWith('system', expect.any(Function), expect.any(Function));
    });

    it('does NOT subscribe when there is no character name', () => {
        useCharacterStore.setState({ character: null });
        renderHook(() => useChatUnreadSubscription());
        expect(chatApi.subscribe).not.toHaveBeenCalledWith('system', expect.any(Function));
    });

    it('subscribes to guild channel when player is in a guild', () => {
        useGuildStore.setState({
            guild: {
                id: 'g-1', name: 'Test', tag: 'T', logo: '', color: '#fff',
                leader_id: 'char-1', level: 1, xp: 0, boss_tier: 0,
                member_cap: 30, created_at: '', updated_at: '',
            },
        });
        renderHook(() => useChatUnreadSubscription());
        expect(chatApi.subscribe).toHaveBeenCalledWith('guild_g-1', expect.any(Function), expect.any(Function));
    });

    it('subscribes to party channel when player is in a party', () => {
        usePartyStore.setState({
            party: {
                id: 'p-1', leaderId: 'char-1', members: [], createdAt: '',
                name: 'P', description: '', hasPassword: false, isPublic: true,
                maxMembers: 4, minJoinLevel: 1,
            },
        });
        renderHook(() => useChatUnreadSubscription());
        expect(chatApi.subscribe).toHaveBeenCalledWith('party_p-1', expect.any(Function), expect.any(Function));
    });

    it('opens a global PM catch-all subscription via subscribeAll', () => {
        renderHook(() => useChatUnreadSubscription());
        expect(chatApi.subscribeAll).toHaveBeenCalled();
    });
});

describe('useChatUnreadSubscription — incoming messages', () => {
    it('increments unread on a foreign message for the channel', () => {
        renderHook(() => useChatUnreadSubscription());
        const cb = getRealtimeCallback('system');
        expect(cb).not.toBeNull();
        act(() => {
            cb!(makeMsg({ id: 'm1', channel: 'system', character_name: 'Stranger' }));
        });
        const tab = useChatTabsStore.getState().tabs.find((t) => t.id === 'system');
        expect(tab?.unread).toBe(1);
        expect(useChatTabsStore.getState().hasNotification).toBe(true);
    });

    it('ignores messages sent by the current character', () => {
        renderHook(() => useChatUnreadSubscription());
        const cb = getRealtimeCallback('system');
        act(() => {
            cb!(makeMsg({ id: 'm1', channel: 'system', character_name: 'Hero' }));
        });
        const tab = useChatTabsStore.getState().tabs.find((t) => t.id === 'system');
        expect(tab?.unread).toBe(0);
        expect(useChatTabsStore.getState().hasNotification).toBe(false);
    });

    it('dedupes duplicate message ids across realtime + polling', () => {
        renderHook(() => useChatUnreadSubscription());
        const cb = getRealtimeCallback('system');
        const dup = makeMsg({ id: 'dup', channel: 'system', character_name: 'Stranger' });
        act(() => {
            cb!(dup);
            cb!(dup);
            cb!(dup);
        });
        const tab = useChatTabsStore.getState().tabs.find((t) => t.id === 'system');
        expect(tab?.unread).toBe(1);
    });

    it('tears down realtime + polling on unmount', () => {
        const unsubRealtime = vi.fn();
        (chatApi.subscribe as ReturnType<typeof vi.fn>).mockReturnValue(unsubRealtime);
        const { unmount } = renderHook(() => useChatUnreadSubscription());
        unmount();
        expect(unsubRealtime).toHaveBeenCalled();
    });
});

describe('useChatUnreadSubscription — global PM catch-all', () => {
    it('auto-opens a PM tab when a stranger DMs the player', () => {
        renderHook(() => useChatUnreadSubscription());
        const allCb = (chatApi.subscribeAll as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
            | ((msg: IMessage) => void)
            | undefined;
        expect(allCb).toBeDefined();
        act(() => {
            allCb!(makeMsg({
                id: 'pm1',
                channel: 'pm_hero_stranger',
                character_name: 'Stranger',
            }));
        });
        const tabs = useChatTabsStore.getState().tabs;
        const pm = tabs.find((t) => t.type === 'pm');
        expect(pm).toBeDefined();
        expect(pm?.channel).toBe('pm_Hero_Stranger');
        expect(useChatTabsStore.getState().hasNotification).toBe(true);
    });

    it('ignores PMs that do not involve the current character', () => {
        renderHook(() => useChatUnreadSubscription());
        const allCb = (chatApi.subscribeAll as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
            | ((msg: IMessage) => void)
            | undefined;
        const beforeTabs = useChatTabsStore.getState().tabs.length;
        act(() => {
            allCb!(makeMsg({
                id: 'pm-other',
                channel: 'pm_alice_bob',
                character_name: 'Alice',
            }));
        });
        expect(useChatTabsStore.getState().tabs.length).toBe(beforeTabs);
    });

    it('drops messages from blocked senders without raising the dot', () => {
        useFriendsStore.setState({
            friends: [],
            favorites: [],
            blocked: ['Stranger'],
        });
        renderHook(() => useChatUnreadSubscription());
        const allCb = (chatApi.subscribeAll as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
            | ((msg: IMessage) => void)
            | undefined;
        act(() => {
            allCb!(makeMsg({
                id: 'pm-blocked',
                channel: 'pm_hero_stranger',
                character_name: 'Stranger',
            }));
        });
        expect(useChatTabsStore.getState().hasNotification).toBe(false);
    });

    it('ignores non-PM channels in the catch-all subscriber', () => {
        renderHook(() => useChatUnreadSubscription());
        const allCb = (chatApi.subscribeAll as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
            | ((msg: IMessage) => void)
            | undefined;
        act(() => {
            allCb!(makeMsg({ id: 'sys-msg', channel: 'system', character_name: 'Stranger' }));
        });
        expect(useChatTabsStore.getState().hasNotification).toBe(false);
    });
});

describe('useChatUnreadSubscription — initial backfill', () => {
    it('seeds seenRef from getMessages without raising the dot', async () => {
        (chatApi.getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
            makeMsg({ id: 'pre1', channel: 'system', character_name: 'Stranger' }),
        ]);
        renderHook(() => useChatUnreadSubscription());
        await act(async () => {
            await Promise.resolve();
        });
        expect(useChatTabsStore.getState().hasNotification).toBe(false);
        const tab = useChatTabsStore.getState().tabs.find((t) => t.id === 'system');
        expect(tab?.unread).toBe(0);
    });
});
