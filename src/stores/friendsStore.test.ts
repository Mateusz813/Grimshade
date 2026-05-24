import { describe, it, expect, beforeEach } from 'vitest';
import { useFriendsStore } from './friendsStore';

// ── Reset helper ─────────────────────────────────────────────────────────────
// friendsStore is a plain Zustand store (no persist, no api) — set lists back
// to empty before each test so state from prior tests can't leak.

beforeEach(() => {
    useFriendsStore.setState({ friends: [], favorites: [], blocked: [] });
});

// ── Initial state ────────────────────────────────────────────────────────────

describe('friendsStore — initial state', () => {
    it('starts with empty friends, favorites and blocked lists', () => {
        const s = useFriendsStore.getState();
        expect(s.friends).toEqual([]);
        expect(s.favorites).toEqual([]);
        expect(s.blocked).toEqual([]);
    });
});

// ── addFriend ────────────────────────────────────────────────────────────────

describe('addFriend', () => {
    it('appends a friend to the friends list', () => {
        useFriendsStore.getState().addFriend('Alice');
        expect(useFriendsStore.getState().friends).toEqual(['Alice']);
    });

    it('trims whitespace from the name', () => {
        useFriendsStore.getState().addFriend('  Bob  ');
        expect(useFriendsStore.getState().friends).toEqual(['Bob']);
    });

    it('ignores empty or whitespace-only names', () => {
        useFriendsStore.getState().addFriend('');
        useFriendsStore.getState().addFriend('   ');
        expect(useFriendsStore.getState().friends).toEqual([]);
    });

    it('refuses to add a duplicate friend', () => {
        useFriendsStore.getState().addFriend('Alice');
        useFriendsStore.getState().addFriend('Alice');
        expect(useFriendsStore.getState().friends).toEqual(['Alice']);
    });

    it('leaves the blocked list alone (friend + blocked can coexist)', () => {
        useFriendsStore.setState({ blocked: ['Alice'] });
        useFriendsStore.getState().addFriend('Alice');
        const s = useFriendsStore.getState();
        expect(s.friends).toContain('Alice');
        expect(s.blocked).toContain('Alice');
    });
});

// ── removeFriend ─────────────────────────────────────────────────────────────

describe('removeFriend', () => {
    it('removes a friend from the list', () => {
        useFriendsStore.setState({ friends: ['Alice', 'Bob'] });
        useFriendsStore.getState().removeFriend('Alice');
        expect(useFriendsStore.getState().friends).toEqual(['Bob']);
    });

    it('also removes the friend from favorites', () => {
        useFriendsStore.setState({ friends: ['Alice'], favorites: ['Alice'] });
        useFriendsStore.getState().removeFriend('Alice');
        const s = useFriendsStore.getState();
        expect(s.friends).toEqual([]);
        expect(s.favorites).toEqual([]);
    });

    it('is a no-op for unknown names', () => {
        useFriendsStore.setState({ friends: ['Bob'] });
        useFriendsStore.getState().removeFriend('Nobody');
        expect(useFriendsStore.getState().friends).toEqual(['Bob']);
    });

    it('trims whitespace when matching', () => {
        useFriendsStore.setState({ friends: ['Alice'] });
        useFriendsStore.getState().removeFriend('  Alice  ');
        expect(useFriendsStore.getState().friends).toEqual([]);
    });
});

// ── toggleFavorite ───────────────────────────────────────────────────────────

describe('toggleFavorite', () => {
    it('adds a friend to favorites when not yet favorited', () => {
        useFriendsStore.setState({ friends: ['Alice'] });
        useFriendsStore.getState().toggleFavorite('Alice');
        expect(useFriendsStore.getState().favorites).toEqual(['Alice']);
    });

    it('removes from favorites when already favorited', () => {
        useFriendsStore.setState({ friends: ['Alice'], favorites: ['Alice'] });
        useFriendsStore.getState().toggleFavorite('Alice');
        expect(useFriendsStore.getState().favorites).toEqual([]);
    });

    it('refuses to favorite a non-friend', () => {
        useFriendsStore.getState().toggleFavorite('Stranger');
        expect(useFriendsStore.getState().favorites).toEqual([]);
    });

    it('trims whitespace when matching', () => {
        useFriendsStore.setState({ friends: ['Alice'] });
        useFriendsStore.getState().toggleFavorite('  Alice  ');
        expect(useFriendsStore.getState().favorites).toEqual(['Alice']);
    });
});

// ── blockUser ────────────────────────────────────────────────────────────────

describe('blockUser', () => {
    it('adds a user to the blocked list', () => {
        useFriendsStore.getState().blockUser('Mallory');
        expect(useFriendsStore.getState().blocked).toEqual(['Mallory']);
    });

    it('ignores empty or whitespace-only names', () => {
        useFriendsStore.getState().blockUser('');
        useFriendsStore.getState().blockUser('   ');
        expect(useFriendsStore.getState().blocked).toEqual([]);
    });

    it('does not duplicate blocked entries', () => {
        useFriendsStore.getState().blockUser('Mallory');
        useFriendsStore.getState().blockUser('Mallory');
        expect(useFriendsStore.getState().blocked).toEqual(['Mallory']);
    });

    it('leaves friend status untouched (friend + blocked coexist per spec)', () => {
        useFriendsStore.setState({ friends: ['Alice'], favorites: ['Alice'] });
        useFriendsStore.getState().blockUser('Alice');
        const s = useFriendsStore.getState();
        expect(s.friends).toContain('Alice');
        expect(s.favorites).toContain('Alice');
        expect(s.blocked).toContain('Alice');
    });

    it('trims whitespace from blocked names', () => {
        useFriendsStore.getState().blockUser('  Mallory  ');
        expect(useFriendsStore.getState().blocked).toEqual(['Mallory']);
    });
});

// ── unblockUser ──────────────────────────────────────────────────────────────

describe('unblockUser', () => {
    it('removes the name from the blocked list', () => {
        useFriendsStore.setState({ blocked: ['Mallory', 'Eve'] });
        useFriendsStore.getState().unblockUser('Mallory');
        expect(useFriendsStore.getState().blocked).toEqual(['Eve']);
    });

    it('preserves the friend list per spec (no auto-add or auto-remove)', () => {
        // Stranger unblocked → does NOT enter friends
        useFriendsStore.setState({ blocked: ['Stranger'] });
        useFriendsStore.getState().unblockUser('Stranger');
        const s = useFriendsStore.getState();
        expect(s.blocked).toEqual([]);
        expect(s.friends).toEqual([]);
    });

    it('keeps friends untouched when unblocking a friend', () => {
        useFriendsStore.setState({ friends: ['Alice'], blocked: ['Alice'] });
        useFriendsStore.getState().unblockUser('Alice');
        expect(useFriendsStore.getState().friends).toEqual(['Alice']);
        expect(useFriendsStore.getState().blocked).toEqual([]);
    });

    it('is a no-op for an unknown name', () => {
        useFriendsStore.setState({ blocked: ['Mallory'] });
        useFriendsStore.getState().unblockUser('Nobody');
        expect(useFriendsStore.getState().blocked).toEqual(['Mallory']);
    });
});

// ── isFriend / isFavorite / isBlocked ───────────────────────────────────────

describe('selectors (isFriend / isFavorite / isBlocked)', () => {
    beforeEach(() => {
        useFriendsStore.setState({
            friends: ['Alice', 'Bob'],
            favorites: ['Alice'],
            blocked: ['Mallory'],
        });
    });

    it('isFriend returns true for friends', () => {
        expect(useFriendsStore.getState().isFriend('Alice')).toBe(true);
        expect(useFriendsStore.getState().isFriend('Bob')).toBe(true);
    });

    it('isFriend returns false for non-friends', () => {
        expect(useFriendsStore.getState().isFriend('Mallory')).toBe(false);
    });

    it('isFavorite returns true for favorited friends', () => {
        expect(useFriendsStore.getState().isFavorite('Alice')).toBe(true);
    });

    it('isFavorite returns false for non-favorited friends', () => {
        expect(useFriendsStore.getState().isFavorite('Bob')).toBe(false);
    });

    it('isBlocked returns true for blocked names', () => {
        expect(useFriendsStore.getState().isBlocked('Mallory')).toBe(true);
    });

    it('selectors normalize whitespace', () => {
        expect(useFriendsStore.getState().isFriend('  Alice  ')).toBe(true);
        expect(useFriendsStore.getState().isFavorite('  Alice  ')).toBe(true);
        expect(useFriendsStore.getState().isBlocked('  Mallory  ')).toBe(true);
    });
});

// ── resetFriends ─────────────────────────────────────────────────────────────

describe('resetFriends', () => {
    it('clears all three lists', () => {
        useFriendsStore.setState({
            friends: ['Alice', 'Bob'],
            favorites: ['Alice'],
            blocked: ['Mallory'],
        });
        useFriendsStore.getState().resetFriends();
        const s = useFriendsStore.getState();
        expect(s.friends).toEqual([]);
        expect(s.favorites).toEqual([]);
        expect(s.blocked).toEqual([]);
    });

    it('is safe to call when already empty', () => {
        useFriendsStore.getState().resetFriends();
        const s = useFriendsStore.getState();
        expect(s.friends).toEqual([]);
        expect(s.favorites).toEqual([]);
        expect(s.blocked).toEqual([]);
    });
});

// ── Integration: friend + block lifecycle ────────────────────────────────────

describe('friend + block lifecycle', () => {
    it('block then unblock keeps friend status intact', () => {
        useFriendsStore.getState().addFriend('Alice');
        useFriendsStore.getState().toggleFavorite('Alice');
        useFriendsStore.getState().blockUser('Alice');
        useFriendsStore.getState().unblockUser('Alice');
        const s = useFriendsStore.getState();
        expect(s.friends).toContain('Alice');
        expect(s.favorites).toContain('Alice');
        expect(s.blocked).not.toContain('Alice');
    });

    it('block then unblock a stranger does NOT add them to friends', () => {
        useFriendsStore.getState().blockUser('Stranger');
        useFriendsStore.getState().unblockUser('Stranger');
        const s = useFriendsStore.getState();
        expect(s.friends).not.toContain('Stranger');
        expect(s.blocked).not.toContain('Stranger');
    });
});
