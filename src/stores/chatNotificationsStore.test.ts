import { describe, it, expect, beforeEach } from 'vitest';
import { useChatNotificationsStore } from './chatNotificationsStore';


beforeEach(() => {
    useChatNotificationsStore.setState({ unreadCount: 0 });
});


describe('chatNotificationsStore — initial state', () => {
    it('starts with zero unread messages', () => {
        expect(useChatNotificationsStore.getState().unreadCount).toBe(0);
    });

    it('exposes incrementUnread and markAllRead actions', () => {
        const s = useChatNotificationsStore.getState();
        expect(typeof s.incrementUnread).toBe('function');
        expect(typeof s.markAllRead).toBe('function');
    });
});


describe('incrementUnread', () => {
    it('bumps unreadCount by one', () => {
        useChatNotificationsStore.getState().incrementUnread();
        expect(useChatNotificationsStore.getState().unreadCount).toBe(1);
    });

    it('is additive across multiple calls', () => {
        const inc = useChatNotificationsStore.getState().incrementUnread;
        inc(); inc(); inc(); inc(); inc();
        expect(useChatNotificationsStore.getState().unreadCount).toBe(5);
    });

    it('respects existing non-zero counts (no reset to 1)', () => {
        useChatNotificationsStore.setState({ unreadCount: 7 });
        useChatNotificationsStore.getState().incrementUnread();
        expect(useChatNotificationsStore.getState().unreadCount).toBe(8);
    });
});


describe('markAllRead', () => {
    it('zeroes the counter when there are unread messages', () => {
        useChatNotificationsStore.setState({ unreadCount: 12 });
        useChatNotificationsStore.getState().markAllRead();
        expect(useChatNotificationsStore.getState().unreadCount).toBe(0);
    });

    it('is a no-op when already at zero', () => {
        useChatNotificationsStore.getState().markAllRead();
        expect(useChatNotificationsStore.getState().unreadCount).toBe(0);
    });

    it('clears unread count regardless of how high it climbed', () => {
        useChatNotificationsStore.setState({ unreadCount: 9999 });
        useChatNotificationsStore.getState().markAllRead();
        expect(useChatNotificationsStore.getState().unreadCount).toBe(0);
    });
});


describe('increment then markAllRead', () => {
    it('after several increments, markAllRead resets to zero', () => {
        const { incrementUnread, markAllRead } = useChatNotificationsStore.getState();
        incrementUnread();
        incrementUnread();
        incrementUnread();
        expect(useChatNotificationsStore.getState().unreadCount).toBe(3);
        markAllRead();
        expect(useChatNotificationsStore.getState().unreadCount).toBe(0);
    });

    it('new increments after markAllRead start fresh from 1', () => {
        useChatNotificationsStore.getState().incrementUnread();
        useChatNotificationsStore.getState().incrementUnread();
        useChatNotificationsStore.getState().markAllRead();
        useChatNotificationsStore.getState().incrementUnread();
        expect(useChatNotificationsStore.getState().unreadCount).toBe(1);
    });
});
