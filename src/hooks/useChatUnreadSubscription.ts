import { useEffect, useRef } from 'react';
import { chatApi, type IMessage } from '../api/v1/chatApi';
import { useCharacterStore } from '../stores/characterStore';
import { useChatTabsStore } from '../stores/chatTabsStore';

/**
 * Global subscription that keeps unread counts ticking up for every open
 * chat tab — even when the user is off the GlobalChat screen. It also
 * auto-opens a PM tab the first time a message arrives from a stranger,
 * so the recipient actually sees the badge without having to manually
 * open the conversation first.
 *
 * GlobalChat's own Chat instances also subscribe to their tab's channel.
 * Both paths dedupe by message id so double-fires never double-count.
 * `incrementUnread` is a no-op when the target tab is already active, so
 * switching between views doesn't produce false unread increments.
 */
export const useChatUnreadSubscription = (): void => {
    const tabs = useChatTabsStore((s) => s.tabs);
    const incrementUnread = useChatTabsStore((s) => s.incrementUnread);
    const ensurePmTab = useChatTabsStore((s) => s.ensurePmTab);
    const activeId = useChatTabsStore((s) => s.activeId);
    const character = useCharacterStore((s) => s.character);
    const myName = character?.name ?? '';

    // Track already-seen message ids per channel so we don't double-count
    // between realtime + polling + Chat.tsx's own subscription.
    const seenRef = useRef<Map<string, Set<string>>>(new Map());

    // Per-tab subscriptions for the tabs the user already has open.
    useEffect(() => {
        if (!myName) return;
        const unsubs: Array<() => void> = [];
        for (const tab of tabs) {
            const channel = tab.channel;
            if (!seenRef.current.has(channel)) seenRef.current.set(channel, new Set());
            const seen = seenRef.current.get(channel)!;
            const onMsg = (msg: IMessage) => {
                if (seen.has(msg.id)) return;
                seen.add(msg.id);
                if (msg.character_name === myName) return;
                incrementUnread(tab.id);
            };
            unsubs.push(chatApi.subscribe(channel, onMsg));
        }
        return () => { unsubs.forEach((u) => u()); };
    }, [tabs, myName, incrementUnread]);

    // Global catch-all — handles PMs sent to us from someone we've never
    // opened a tab with. When we see a pm_* message whose channel names us,
    // auto-open the tab (which also joins the per-tab subscription above
    // on the next render) so the badge fires exactly once.
    useEffect(() => {
        if (!myName) return;
        const myLower = myName.toLowerCase();
        const unsub = chatApi.subscribeAll((msg) => {
            if (!msg.channel.startsWith('pm_')) return;
            // Don't self-notify.
            if (msg.character_name === myName) return;
            // Channel format: `pm_${nameA}_${nameB}` (case-preserving, lower-sorted).
            // Make sure our name is one of the two participants.
            const tail = msg.channel.slice(3); // strip "pm_"
            const parts = tail.split('_');
            if (parts.length < 2) return;
            const lower = tail.toLowerCase();
            if (!lower.includes(myLower)) return;
            // Dedupe with whatever the per-tab subscription might also see.
            const seen = seenRef.current.get(msg.channel) ?? new Set<string>();
            if (seen.has(msg.id)) return;
            seen.add(msg.id);
            seenRef.current.set(msg.channel, seen);
            // Figure out the OTHER participant's name (the sender, usually).
            const other = msg.character_name && msg.character_name !== myName
                ? msg.character_name
                : (parts[0].toLowerCase() === myLower ? parts.slice(1).join('_') : parts[0]);
            // Silent add: ensurePmTab creates the tab without stealing focus,
            // so the recipient's chat icon badge can light up without yanking
            // them away from whatever screen they're currently using.
            const channelId = ensurePmTab(myName, other);
            const focusedOnThisTab =
                window.location.pathname === '/chat'
                && useChatTabsStore.getState().activeId === channelId;
            if (!focusedOnThisTab) {
                incrementUnread(channelId);
            }
        });
        return unsub;
    }, [myName, ensurePmTab, incrementUnread, activeId]);
};
