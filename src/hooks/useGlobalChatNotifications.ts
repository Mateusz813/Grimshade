import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { chatApi } from '../api/v1/chatApi';
import { useCharacterStore } from '../stores/characterStore';
import { useChatNotificationsStore } from '../stores/chatNotificationsStore';
import { useChatTabsStore } from '../stores/chatTabsStore';

export const useGlobalChatNotifications = (): void => {
    const characterName = useCharacterStore((s) => s.character?.name ?? null);
    const location = useLocation();
    const incrementUnread = useChatNotificationsStore((s) => s.incrementUnread);
    const markAllRead = useChatNotificationsStore((s) => s.markAllRead);

    useEffect(() => {
        if (location.pathname === '/chat') {
            markAllRead();
            useChatTabsStore.getState().clearNotification();
        }
    }, [location.pathname, markAllRead]);

    useEffect(() => {
        if (!characterName) return;
        const unsub = chatApi.subscribeAll((msg) => {
            if (msg.character_name === characterName) return;

            if (msg.channel === 'city') {
                if (window.location.pathname === '/chat') {
                    markAllRead();
                    return;
                }
                incrementUnread();
                return;
            }
        });
        return unsub;
    }, [characterName, incrementUnread, markAllRead]);
};
