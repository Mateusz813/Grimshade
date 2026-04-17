import { create } from 'zustand';

/**
 * Friends store — local-only social graph per character.
 *
 * Maintains three sets keyed by character name:
 *   - `friends`    → players the user has added
 *   - `favorites`  → subset of friends pinned to the top of the list
 *   - `blocked`    → players whose chat messages should be hidden
 *
 * Persistence goes through `characterScope.ts` (baseKey: `friends`) so each
 * character has its own list. The store intentionally uses character *names*
 * rather than UUIDs — friends are public characters, and name lookups on the
 * `characters` table work fine for display, PM channels and online checks.
 *
 * This is a fully local (client-side) store for now. True multiplayer
 * persistence would require a Supabase `friends` table with RLS; until that
 * migration lands we keep the data in per-character localStorage so at least
 * the UI and flow work end-to-end against live chat.
 */

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
            // Adding a blocked user implicitly unblocks them.
            const blocked = s.blocked.filter((n) => n !== clean);
            return { friends: [...s.friends, clean], blocked };
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
            // Blocking removes from friends/favorites to keep the graph consistent.
            return {
                blocked: [...s.blocked, clean],
                friends: s.friends.filter((n) => n !== clean),
                favorites: s.favorites.filter((n) => n !== clean),
            };
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
