import { useEffect, useRef } from 'react';
import { chatApi, type IMessage } from '../api/v1/chatApi';
import { useCharacterStore } from '../stores/characterStore';
import { useChatTabsStore } from '../stores/chatTabsStore';
import { useFriendsStore } from '../stores/friendsStore';
import { useGuildStore } from '../stores/guildStore';
import { usePartyStore } from '../stores/partyStore';

export const useChatUnreadSubscription = (): void => {
    const tabs = useChatTabsStore((s) => s.tabs);
    const incrementUnread = useChatTabsStore((s) => s.incrementUnread);
    const ensurePmTab = useChatTabsStore((s) => s.ensurePmTab);
    const raiseNotification = useChatTabsStore((s) => s.raiseNotification);
    const character = useCharacterStore((s) => s.character);
    const myName = character?.name ?? '';
    const guildId = useGuildStore((s) => s.guild?.id ?? null);
    const partyId = usePartyStore((s) => s.party?.id ?? null);

    const seenRef = useRef<Map<string, Set<string>>>(new Map());

    const handleMessage = (
        channel: string,
        msg: IMessage,
        isInitialBackfill: boolean,
    ) => {
        if (msg.character_name === myName) return;
        const seen = seenRef.current.get(channel) ?? new Set<string>();
        if (seen.has(msg.id)) return;
        seen.add(msg.id);
        seenRef.current.set(channel, seen);
        if (isInitialBackfill) return;
        incrementUnread(channel);
        raiseNotification();
    };

    const wireChannel = (channel: string): (() => void) => {
        let cancelled = false;
        void chatApi.getMessages(channel).then((rows) => {
            if (cancelled) return;
            for (const m of rows) handleMessage(channel, m, true);
        }).catch(() => { });

        const unsubRealtime = chatApi.subscribe(channel, (msg) => {
            if (cancelled) return;
            handleMessage(channel, msg, false);
        });

        const pollId = window.setInterval(() => {
            if (cancelled) return;
            void chatApi.getMessages(channel).then((rows) => {
                if (cancelled) return;
                for (const m of rows) handleMessage(channel, m, false);
            }).catch(() => { });
        }, 4000);

        return () => {
            cancelled = true;
            unsubRealtime();
            window.clearInterval(pollId);
        };
    };

    useEffect(() => {
        if (!myName) return;
        return wireChannel('system');
    }, [myName]);

    useEffect(() => {
        if (!myName || !guildId) return;
        return wireChannel(`guild_${guildId}`);
    }, [myName, guildId]);

    useEffect(() => {
        if (!myName || !partyId) return;
        return wireChannel(`party_${partyId}`);
    }, [myName, partyId]);

    useEffect(() => {
        if (!myName) return;
        const unsubs: Array<() => void> = [];
        for (const tab of tabs) {
            if (tab.type !== 'pm') continue;
            unsubs.push(wireChannel(tab.channel));
        }
        return () => { unsubs.forEach((u) => u()); };
    }, [tabs, myName]);

    useEffect(() => {
        if (!myName) return;
        const myLower = myName.toLowerCase();
        const unsub = chatApi.subscribeAll((msg) => {
            if (!msg.channel.startsWith('pm_')) return;
            if (msg.character_name === myName) return;
            const tail = msg.channel.slice(3);
            const parts = tail.split('_');
            if (parts.length < 2) return;
            const lower = tail.toLowerCase();
            if (!lower.includes(myLower)) return;
            if (msg.character_name && useFriendsStore.getState().isBlocked(msg.character_name)) {
                return;
            }
            const seen = seenRef.current.get(msg.channel) ?? new Set<string>();
            if (seen.has(msg.id)) return;
            seen.add(msg.id);
            seenRef.current.set(msg.channel, seen);
            const other = msg.character_name && msg.character_name !== myName
                ? msg.character_name
                : (parts[0].toLowerCase() === myLower ? parts.slice(1).join('_') : parts[0]);
            const channelId = ensurePmTab(myName, other);
            const focusedOnThisTab =
                window.location.pathname === '/chat'
                && useChatTabsStore.getState().activeId === channelId;
            if (!focusedOnThisTab) {
                incrementUnread(channelId);
                raiseNotification();
            }
        });
        return unsub;
    }, [myName, ensurePmTab, incrementUnread, raiseNotification]);
};
