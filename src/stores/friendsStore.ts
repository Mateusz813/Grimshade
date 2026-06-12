import { create } from 'zustand';

/**
 * Friends store — local-only social graph per character.
 *
 * Maintains three sets keyed by character name:
 *   - `friends`    -> players the user has added
 *   - `favorites`  -> subset of friends pinned to the top of the list
 *   - `blocked`    -> players whose chat messages should be hidden
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
            // 2026-05-19 spec: adding now leaves the block list alone
            // — friends + blocked can coexist for the same name.
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

    // 2026-05-19 spec ("Jak mam kogoś w liście znajomych i zablokuje
    // to jest na obu listach naraz i mogę pisać tylko ja do niego
    // kiedy chce a nie będę od niego otrzymywać wiadomości."):
    // blocking no longer removes from friends/favorites — the two
    // lists coexist for the same name. Chat already filters incoming
    // messages from blocked users (Chat.tsx isBlocked guard) while
    // outgoing PMs remain unrestricted, matching the spec.
    blockUser: (name) => {
        const clean = normalize(name);
        if (!clean) return;
        set((s) => {
            if (s.blocked.includes(clean)) return s;
            return { blocked: [...s.blocked, clean] };
        });
    },

    // 2026-05-19 spec ("I jak mam kogoś w znajomych i zablokuje a
    // potem odblokuje to nie powinien kasować się ze znajomych
    // tylko wrócić do znajomych. Jeżeli kogoś nie mam w znajomych a
    // zablokuje to wtedy nie wraca do znajomych."): friend membership
    // is untouched by block / unblock, so unblocking inherently
    // restores the friend state if they were a friend before block
    // (they never left the friends list) and does nothing for
    // strangers who were blocked from a chat message.
    unblockUser: (name) => {
        const clean = normalize(name);
        set((s) => ({ blocked: s.blocked.filter((n) => n !== clean) }));
    },

    isFriend: (name) => get().friends.includes(normalize(name)),
    isFavorite: (name) => get().favorites.includes(normalize(name)),
    isBlocked: (name) => get().blocked.includes(normalize(name)),

    resetFriends: () => set({ friends: [], favorites: [], blocked: [] }),
}));
