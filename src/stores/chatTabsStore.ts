import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildPmChannel } from '../api/v1/friendsApi';

/**
 * Chat tabs store — lets GlobalChat display multiple open conversations
 * (city / party / guild / system + any number of PMs) as tabs you can
 * switch between.
 *
 * Always-present:
 *   - :cityscape-at-dusk: Miasto      (city, global broadcast)
 *   - :warning: System       (server-wide gameplay milestones — +20 weapons etc.)
 *
 * Conditional:
 *   - :shield: Drużyna     (party, while in one)
 *   - :castle: Gildia       (guild, while in one)
 *
 * On-demand:
 *   - :love-letter: PM with `{name}` (per conversation)
 *
 * Unread counts are tracked here too so the chat icon can render a badge
 * and each tab button can show how many new messages arrived while it was
 * inactive.
 */

export type TChatTabType = 'city' | 'system' | 'party' | 'guild' | 'pm';

export interface IChatTab {
    id: string;               // equals channel
    type: TChatTabType;
    channel: string;
    title: string;            // displayed label
    targetName?: string;      // for PM tabs
    unread: number;
    /** Closable by the user (PM tabs only). Static tabs are pinned. */
    closable?: boolean;
}

interface IChatTabsState {
    tabs: IChatTab[];
    activeId: string;
    /**
     * 2026-05-19 v6 spec ("Jezeli ktos napisze na chacie gildi lub
     * party lub DM to powinna wyskakiwac mi ikonka taki czerwona
     * kropka ... znika jak klikam w ikonke chatu"): one-shot signal
     * the chat icon reads to decide whether to render the "you have
     * something new" dot. Flipped to `true` whenever a new message
     * arrives on a non-city channel (guild / party / system / pm).
     * Cleared the moment the player opens the chat popup or the
     * /chat route — even if the underlying per-tab `unread` counters
     * stay non-zero for tabs they haven't actually viewed yet.
     */
    hasNotification: boolean;

    /** Called once by GlobalChat on mount to guarantee the city tab exists. */
    ensureCityTab: () => void;

    /** Always-present global system feed for milestones (+20 weapons, etc.). */
    ensureSystemTab: () => void;

    /**
     * Open (or focus) a PM with `targetName`. `myName` is the current char
     * name. Returns the channel id.
     */
    openPm: (myName: string, targetName: string) => string;

    /**
     * Silently add a PM tab without stealing focus. Used by the global PM
     * notification subscription so an incoming PM creates the tab in the
     * background — the recipient sees it next time they open /chat.
     */
    ensurePmTab: (myName: string, targetName: string) => string;

    /** Add / remove the Party tab when the active party changes. */
    syncPartyTab: (partyId: string | null) => void;

    /** Add / remove the Guild tab when guild membership changes. */
    syncGuildTab: (guildId: string | null) => void;

    /** Close a tab by id (no-op for non-closable tabs). */
    closeTab: (id: string) => void;

    /** Switch which tab is currently shown. Clears that tab's unread count. */
    setActive: (id: string) => void;

    /** Called when a new message arrives — increments unread if tab isn't active. */
    incrementUnread: (tabId: string) => void;

    /** Zero out unread for a tab (used on focus / read). */
    markRead: (tabId: string) => void;

    /**
     * Raise the dot notification on the floating chat icon. Called by
     * the global PM / channel subscription when a new message lands
     * on any non-city channel.
     */
    raiseNotification: () => void;

    /** Clear the dot — fired when the player opens the chat popup or
     *  the /chat route. */
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

/**
 * Re-order tabs into the canonical layout (2026-05-19 v2 spec
 * "Zamien miejscami ma byc miasto, gildia, druzyna, system a potem
 * DM"): city -> guild -> party -> system -> pm-tabs (insertion order).
 * Keeps the user's mental model stable when party / guild membership
 * flips on and off.
 */
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

/**
 * Normalise a tab read from persistence — pre-v2 tabs lack `closable`
 * (only PMs are closable; static ones are pinned). Without this PM
 * tabs created before the field existed lose their close button.
 */
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
                // Background-add: do NOT change activeId, so the recipient
                // keeps reading whatever tab they had open (or stays on their
                // current page entirely if /chat isn't mounted).
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
                // Either no party tab yet, or it points at a stale party id —
                // drop the old one and add the fresh one.
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
            // Only persist the list of open tabs (and active), zero-ing live unread
            // counts so the badge doesn't lie when the app rehydrates.
            partialize: (s) => ({
                tabs: s.tabs.map((t) => ({ ...t, unread: 0 })),
                activeId: s.activeId,
            }),
            // Migrate older persisted state that doesn't yet have the system
            // tab. Without this, returning users would never see it because
            // the persisted list overwrites our `tabs: [CITY, SYSTEM]` initial.
            merge: (persisted, current) => {
                if (!persisted || typeof persisted !== 'object') return current;
                const next = { ...current, ...(persisted as Partial<IChatTabsState>) };
                const rawTabs = Array.isArray(next.tabs) ? next.tabs : [];
                // Strip stale party/guild tabs from persisted state — they
                // refer to the LAST party/guild the player belonged to, which
                // is meaningless without an active membership. The
                // syncPartyTab / syncGuildTab effects in AppShell add fresh
                // ones on hydration if the player is still in either.
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
