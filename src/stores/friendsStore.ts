import { create } from 'zustand';


interface IFriendsStore {
    friends: string[];
    favorites: string[];
    blocked: string[];

    addFriend: (name: string) => void;
    removeFriend: (name: string) => void;
    toggleFavorite: (name: string) => void;
    blockUser: (name: string) => void;
    unblockUser: (name: string) => void;

    isFriend: (name: string) => boolean;
    isFavorite: (name: string) => boolean;
    isBlocked: (name: string) => boolean;

    resetFriends: () => void;
}

const normalize = (name: string): string => name.trim();

export const useFriendsStore = create<IFriendsStore>((set, get) => ({
    friends: [],
    favorites: [],
    blocked: [],

    addFriend: (name) => {
        const clean = normalize(name);
        if (!clean) return;
        set((s) => {
            if (s.friends.includes(clean)) return s;
            return { friends: [...s.friends, clean] };
        });
    },

    removeFriend: (name) => {
        const clean = normalize(name);
        set((s) => ({
            friends: s.friends.filter((n) => n !== clean),
            favorites: s.favorites.filter((n) => n !== clean),
        }));
    },

    toggleFavorite: (name) => {
        const clean = normalize(name);
        set((s) => {
            if (!s.friends.includes(clean)) return s;
            if (s.favorites.includes(clean)) {
                return { favorites: s.favorites.filter((n) => n !== clean) };
            }
            return { favorites: [...s.favorites, clean] };
        });
    },

    blockUser: (name) => {
        const clean = normalize(name);
        if (!clean) return;
        set((s) => {
            if (s.blocked.includes(clean)) return s;
            return { blocked: [...s.blocked, clean] };
        });
    },

    unblockUser: (name) => {
        const clean = normalize(name);
        set((s) => ({ blocked: s.blocked.filter((n) => n !== clean) }));
    },

    isFriend: (name) => get().friends.includes(normalize(name)),
    isFavorite: (name) => get().favorites.includes(normalize(name)),
    isBlocked: (name) => get().blocked.includes(normalize(name)),

    resetFriends: () => set({ friends: [], favorites: [], blocked: [] }),
}));
