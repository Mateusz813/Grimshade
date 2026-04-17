import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { chatApi } from '../api/v1/chatApi';
import { useCharacterStore } from '../stores/characterStore';
import { useChatNotificationsStore } from '../stores/chatNotificationsStore';

/**
 * Globally subscribes to the city chat channel so the floating nav badge
 * reflects unread messages regardless of which screen the player is on.
 *
 * - Mounted once at the router level (above all routes).
 * - Increments `unreadCount` on each incoming city message that is NOT from
 *   the current character.
 * - Automatically resets the counter while the player is on `/chat` (and
 *   again on every incoming message while on /chat — so fresh visits keep
 *   the counter at zero).
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

    // Subscribe to the city channel for the whole session.
    useEffect(() => {
        if (!characterName) return;
        const unsub = chatApi.subscribe('city', (msg) => {
            // Ignore own messages – otherwise the player's own chat would
            // ping itself and feel broken.
            if (msg.character_name === characterName) return;
            // If the player is already reading the chat, we do not bump
            // the counter – visiting /chat already marked everything read.
            if (window.location.pathname === '/chat') {
                markAllRead();
                return;
            }
            incrementUnread();
        });
        return unsub;
    }, [characterName, incrementUnread, markAllRead]);
};
