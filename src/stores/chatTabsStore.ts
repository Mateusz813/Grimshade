import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildPmChannel } from '../api/v1/friendsApi';

/**
 * Chat tabs store — lets GlobalChat display multiple open conversations
 * (the city chat + any number of PMs) as tabs you can switch between.
 *
 * The city tab is always present and cannot be closed. PM tabs are created
 * on demand (from the chat row context menu) and can be closed individually.
 *
 * Unread counts are tracked here too so Town's 💬 tile can render a badge
 * and each tab button can show how many new messages arrived while it was
 * inactive.
 */

export interface IChatTab {
  id: string;               // equals channel
  type: 'city' | 'pm';
  channel: string;
  title: string;            // displayed label
  targetName?: string;      // for PM tabs
  unread: number;
}

interface IChatTabsState {
  tabs: IChatTab[];
  activeId: string;

  /** Called once by GlobalChat on mount to guarantee the city tab exists. */
  ensureCityTab: () => void;

  /** Open (or focus) a PM with `targetName`. `myName` is the current char name. */
  openPm: (myName: string, targetName: string) => void;

  /**
   * Silently add a PM tab without stealing focus. Used by the global PM
   * notification subscription so an incoming PM creates the tab in the
   * background — the recipient sees it next time they open /chat.
   */
  ensurePmTab: (myName: string, targetName: string) => string;

  /** Close a tab by id (no-op for the city tab). Switches to city if closing the active one. */
  closeTab: (id: string) => void;

  /** Switch which tab is currently shown. Clears that tab's unread count. */
  setActive: (id: string) => void;

  /** Called when a new message arrives — increments unread if tab isn't active. */
  incrementUnread: (tabId: string) => void;

  /** Zero out unread for a tab (used on focus / read). */
  markRead: (tabId: string) => void;
}

const CITY_TAB: IChatTab = {
  id: 'city',
  type: 'city',
  channel: 'city',
  title: '🌆 Miasto',
  unread: 0,
};

export const useChatTabsStore = create<IChatTabsState>()(
  persist(
    (set, get) => ({
      tabs: [CITY_TAB],
      activeId: 'city',

      ensureCityTab: () => {
        const { tabs } = get();
        if (tabs.some((t) => t.id === 'city')) return;
        set({ tabs: [CITY_TAB, ...tabs] });
      },

      openPm: (myName, targetName) => {
        const channel = buildPmChannel(myName, targetName);
        const { tabs } = get();
        const existing = tabs.find((t) => t.id === channel);
        if (existing) {
          set({ activeId: channel, tabs: tabs.map((t) => t.id === channel ? { ...t, unread: 0 } : t) });
          return;
        }
        const newTab: IChatTab = {
          id: channel,
          type: 'pm',
          channel,
          title: `💌 ${targetName}`,
          targetName,
          unread: 0,
        };
        set({ tabs: [...tabs, newTab], activeId: channel });
      },

      ensurePmTab: (myName, targetName) => {
        const channel = buildPmChannel(myName, targetName);
        const { tabs } = get();
        if (tabs.some((t) => t.id === channel)) return channel;
        const newTab: IChatTab = {
          id: channel,
          type: 'pm',
          channel,
          title: `💌 ${targetName}`,
          targetName,
          unread: 0,
        };
        // Background-add: do NOT change activeId, so the recipient keeps
        // reading whatever tab they had open (or stays on their current page
        // entirely if /chat isn't mounted).
        set({ tabs: [...tabs, newTab] });
        return channel;
      },

      closeTab: (id) => {
        if (id === 'city') return;
        const { tabs, activeId } = get();
        const next = tabs.filter((t) => t.id !== id);
        const nextActive = activeId === id ? 'city' : activeId;
        set({ tabs: next, activeId: nextActive });
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
    }),
    {
      name: 'grimshade:chat-tabs',
      // Only persist the list of open PM tabs, not live unread counts.
      partialize: (s) => ({
        tabs: s.tabs.map((t) => ({ ...t, unread: 0 })),
        activeId: s.activeId,
      }),
    },
  ),
);
