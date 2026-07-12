import { create } from 'zustand';


interface IChatNotificationsStore {
    unreadCount: number;
    incrementUnread: () => void;
    markAllRead: () => void;
}

export const useChatNotificationsStore = create<IChatNotificationsStore>((set) => ({
    unreadCount: 0,
    incrementUnread: () => set((s) => ({ unreadCount: s.unreadCount + 1 })),
    markAllRead: () => set({ unreadCount: 0 }),
}));
