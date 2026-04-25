import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { chatApi } from '../api/v1/chatApi';
import { useCharacterStore } from '../stores/characterStore';
import { useChatNotificationsStore } from '../stores/chatNotificationsStore';

/**
 * Globally subscribes to chat activity so the floating nav badge reflects
 * unread city + PM messages regardless of which screen the player is on.
 *
 * - Mounted once at the router level (above all routes).
 * - City: bumps a session-only unread counter on each incoming message that
 *   is NOT from the current character.
 * - PMs: when an incoming `pm_*` channel involves the current character but
 *   the sender isn't the current character, auto-create a tab in the
 *   background (without stealing focus) and bump that tab's unread counter.
 *   That makes the floating `ChatUnreadBadge` light up so the recipient
 *   knows they have a new private message.
 * - Automatically resets the city counter while the player is on `/chat`.
 */
export const useGlobalChatNotifications = (): void => {
    const characterName = useCharacterStore((s) => s.character?.name ?? null);
    const location = useLocation();
    const incrementUnread = useChatNotificationsStore((s) => s.incrementUnread);
    const markAllRead = useChatNotificationsStore((s) => s.markAllRead);

    // Reset the counter the moment the player navigates into /chat.
    useEffect(() => {
        if (location.pathname === '/chat') {
            markAllRead();
        }
    }, [location.pathname, markAllRead]);

    // Single global subscription for all messages — filter client-side.
    useEffect(() => {
        if (!characterName) return;
        const unsub = chatApi.subscribeAll((msg) => {
            // Ignore own messages – otherwise the player's own chat would
            // ping itself and feel broken.
            if (msg.character_name === characterName) return;

            if (msg.channel === 'city') {
                // If the player is already reading the chat, we do not bump
                // the counter – visiting /chat already marked everything read.
                if (window.location.pathname === '/chat') {
                    markAllRead();
                    return;
                }
                incrementUnread();
                return;
            }
            // PM notifications are handled by useChatUnreadSubscription so we
            // don't double-bump the badge here.
        });
        return unsub;
    }, [characterName, incrementUnread, markAllRead]);
};
