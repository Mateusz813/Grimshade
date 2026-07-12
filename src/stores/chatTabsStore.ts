import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildPmChannel } from '../api/v1/friendsApi';


export type TChatTabType = 'city' | 'system' | 'party' | 'guild' | 'pm';

export interface IChatTab {
    id: string;
    type: TChatTabType;
    channel: string;
    title: string;
    targetName?: string;
    unread: number;
    closable?: boolean;
}

interface IChatTabsState {
    tabs: IChatTab[];
    activeId: string;
    hasNotification: boolean;

    ensureCityTab: () => void;

    ensureSystemTab: () => void;

    openPm: (myName: string, targetName: string) => string;

    ensurePmTab: (myName: string, targetName: string) => string;

    syncPartyTab: (partyId: string | null) => void;

    syncGuildTab: (guildId: string | null) => void;

    closeTab: (id: string) => void;

    setActive: (id: string) => void;

    incrementUnread: (tabId: string) => void;

    markRead: (tabId: string) => void;

    raiseNotification: () => void;

    clearNotification: () => void;
}

const CITY_TAB: IChatTab = {
    id: 'city',
    type: 'city',
    channel: 'city',
    title: ':cityscape-at-dusk: Miasto',
    unread: 0,
    closable: false,
};

const SYSTEM_TAB: IChatTab = {
    id: 'system',
    type: 'system',
    channel: 'system',
    title: ':warning: System',
    unread: 0,
    closable: false,
};

const partyTabFor = (partyId: string): IChatTab => ({
    id: `party_${partyId}`,
    type: 'party',
    channel: `party_${partyId}`,
    title: ':shield: Drużyna',
    unread: 0,
    closable: false,
});

const guildTabFor = (guildId: string): IChatTab => ({
    id: `guild_${guildId}`,
    type: 'guild',
    channel: `guild_${guildId}`,
    title: ':castle: Gildia',
    unread: 0,
    closable: false,
});

const sortTabs = (tabs: IChatTab[]): IChatTab[] => {
    const orderFor = (t: IChatTab): number => {
        switch (t.type) {
            case 'city': return 0;
            case 'guild': return 1;
            case 'party': return 2;
            case 'system': return 3;
            case 'pm':
            default: return 4;
        }
    };
    return [...tabs].sort((a, b) => {
        const oa = orderFor(a);
        const ob = orderFor(b);
        if (oa !== ob) return oa - ob;
        return 0;
    });
};

const normaliseTab = (t: IChatTab): IChatTab => ({
    ...t,
    closable: typeof t.closable === 'boolean' ? t.closable : t.type === 'pm',
});

export const useChatTabsStore = create<IChatTabsState>()(
    persist(
        (set, get) => ({
            tabs: [CITY_TAB, SYSTEM_TAB],
            activeId: 'city',
            hasNotification: false,

            ensureCityTab: () => {
                const { tabs } = get();
                if (tabs.some((t) => t.id === 'city')) return;
                set({ tabs: sortTabs([CITY_TAB, ...tabs]) });
            },

            ensureSystemTab: () => {
                const { tabs } = get();
                if (tabs.some((t) => t.id === 'system')) return;
                set({ tabs: sortTabs([...tabs, SYSTEM_TAB]) });
            },

            openPm: (myName, targetName) => {
                const channel = buildPmChannel(myName, targetName);
                const { tabs } = get();
                const existing = tabs.find((t) => t.id === channel);
                if (existing) {
                    set({
                        activeId: channel,
                        tabs: tabs.map((t) => t.id === channel ? { ...t, unread: 0 } : t),
                    });
                    return channel;
                }
                const newTab: IChatTab = {
                    id: channel,
                    type: 'pm',
                    channel,
                    title: `:love-letter: ${targetName}`,
                    targetName,
                    unread: 0,
                    closable: true,
                };
                set({ tabs: sortTabs([...tabs, newTab]), activeId: channel });
                return channel;
            },

            ensurePmTab: (myName, targetName) => {
                const channel = buildPmChannel(myName, targetName);
                const { tabs } = get();
                if (tabs.some((t) => t.id === channel)) return channel;
                const newTab: IChatTab = {
                    id: channel,
                    type: 'pm',
                    channel,
                    title: `:love-letter: ${targetName}`,
                    targetName,
                    unread: 0,
                    closable: true,
                };
                set({ tabs: sortTabs([...tabs, newTab]) });
                return channel;
            },

            syncPartyTab: (partyId) => {
                const { tabs, activeId } = get();
                const existing = tabs.find((t) => t.type === 'party');
                if (!partyId) {
                    if (!existing) return;
                    const next = tabs.filter((t) => t.type !== 'party');
                    const nextActive = activeId === existing.id ? 'city' : activeId;
                    set({ tabs: sortTabs(next), activeId: nextActive });
                    return;
                }
                const expected = partyTabFor(partyId);
                if (existing && existing.id === expected.id) return;
                const stripped = tabs.filter((t) => t.type !== 'party');
                set({ tabs: sortTabs([...stripped, expected]) });
            },

            syncGuildTab: (guildId) => {
                const { tabs, activeId } = get();
                const existing = tabs.find((t) => t.type === 'guild');
                if (!guildId) {
                    if (!existing) return;
                    const next = tabs.filter((t) => t.type !== 'guild');
                    const nextActive = activeId === existing.id ? 'city' : activeId;
                    set({ tabs: sortTabs(next), activeId: nextActive });
                    return;
                }
                const expected = guildTabFor(guildId);
                if (existing && existing.id === expected.id) return;
                const stripped = tabs.filter((t) => t.type !== 'guild');
                set({ tabs: sortTabs([...stripped, expected]) });
            },

            closeTab: (id) => {
                const { tabs, activeId } = get();
                const target = tabs.find((t) => t.id === id);
                if (!target || target.closable === false) return;
                const next = tabs.filter((t) => t.id !== id);
                const nextActive = activeId === id ? 'city' : activeId;
                set({ tabs: sortTabs(next), activeId: nextActive });
            },

            setActive: (id) => {
                const { tabs } = get();
                if (!tabs.some((t) => t.id === id)) return;
                set({
                    activeId: id,
                    tabs: tabs.map((t) => t.id === id ? { ...t, unread: 0 } : t),
                });
            },

            incrementUnread: (tabId) => {
                const { tabs, activeId } = get();
                if (activeId === tabId) return;
                set({
                    tabs: tabs.map((t) => t.id === tabId ? { ...t, unread: t.unread + 1 } : t),
                });
            },

            markRead: (tabId) => {
                const { tabs } = get();
                set({
                    tabs: tabs.map((t) => t.id === tabId ? { ...t, unread: 0 } : t),
                });
            },

            raiseNotification: () => {
                if (get().hasNotification) return;
                set({ hasNotification: true });
            },

            clearNotification: () => {
                if (!get().hasNotification) return;
                set({ hasNotification: false });
            },
        }),
        {
            name: 'grimshade:chat-tabs',
            partialize: (s) => ({
                tabs: s.tabs.map((t) => ({ ...t, unread: 0 })),
                activeId: s.activeId,
            }),
            merge: (persisted, current) => {
                if (!persisted || typeof persisted !== 'object') return current;
                const next = { ...current, ...(persisted as Partial<IChatTabsState>) };
                const rawTabs = Array.isArray(next.tabs) ? next.tabs : [];
                const tabs = rawTabs
                    .filter((t) => t.type !== 'party' && t.type !== 'guild')
                    .map(normaliseTab);
                const hasCity = tabs.some((t) => t.id === 'city');
                const hasSystem = tabs.some((t) => t.id === 'system');
                const merged = [
                    ...(hasCity ? [] : [CITY_TAB]),
                    ...(hasSystem ? [] : [SYSTEM_TAB]),
                    ...tabs,
                ];
                return { ...next, tabs: sortTabs(merged) };
            },
        },
    ),
);
