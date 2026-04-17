import { create } from 'zustand';

/**
 * Global chat notifications store.
 *
 * Tracks how many unread messages the player has on the city channel so a
 * badge can be shown on the floating chat icon regardless of which screen
 * the player is on. The store is deliberately character-agnostic (lives in
 * memory for the active session only) — unread count resets on reload.
 *
 * A single global subscription lives in `useGlobalChatNotifications` and
 * feeds `incrementUnread` every time a new city message arrives for anyone
 * other than the current player. Visiting `/chat` calls `markAllRead`.
 */

interface IChatNotificationsStore {
    /** Number of unread city messages since last markAllRead. */
    unreadCount: number;
    /** Bump the unread counter by one. No-op if we're already on /chat. */
    incrementUnread: () => void;
    /** Reset the unread counter to zero. Called when entering /chat. */
    markAllRead: () => void;
}

export const useChatNotificationsStore = create<IChatNotificationsStore>((set) => ({
    unreadCount: 0,
    incrementUnread: () => set((s) => ({ unreadCount: s.unreadCount + 1 })),
    markAllRead: () => set({ unreadCount: 0 }),
}));
