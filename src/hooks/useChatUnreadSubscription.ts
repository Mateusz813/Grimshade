import { useEffect, useRef } from 'react';
import { chatApi, type IMessage } from '../api/v1/chatApi';
import { useCharacterStore } from '../stores/characterStore';
import { useChatTabsStore } from '../stores/chatTabsStore';
import { useFriendsStore } from '../stores/friendsStore';
import { useGuildStore } from '../stores/guildStore';
import { usePartyStore } from '../stores/partyStore';

/**
 * Global subscription that keeps unread counts ticking up for every open
 * chat tab — even when the user is off the GlobalChat screen. Also drives
 * the notification dot on the floating chat icon.
 *
 * 2026-05-19 v12 spec ("napisal do mnie ktos i nie widze tej kropki ...
 * zrob to na Websocketach czy cos i wyswietl mi ta jebana kropke jak
 * ktos napisze"): the realtime-only path (`chatApi.subscribe`) was
 * silently dropping messages on this Supabase deployment. Mirroring
 * Chat.tsx's belt-and-braces pattern: realtime subscription **PLUS**
 * a 4-second polling fallback over `chatApi.getMessages`. Whichever
 * fires first wins via the shared `seenRef` dedupe — guaranteed to
 * deliver the dot regardless of realtime publication health.
 *
 * Channels we watch:
 *   - `system`                  — always.
 *   - `guild_${myGuildId}`      — whenever the player is in a guild.
 *   - `party_${myPartyId}`      — whenever the player is in a party.
 *   - `pm_*` (via subscribeAll) — kept for first-time PM auto-open;
 *     once a PM tab exists the per-channel subscription below picks
 *     it up.
 */
export const useChatUnreadSubscription = (): void => {
    const tabs = useChatTabsStore((s) => s.tabs);
    const incrementUnread = useChatTabsStore((s) => s.incrementUnread);
    const ensurePmTab = useChatTabsStore((s) => s.ensurePmTab);
    const raiseNotification = useChatTabsStore((s) => s.raiseNotification);
    const character = useCharacterStore((s) => s.character);
    const myName = character?.name ?? '';
    const guildId = useGuildStore((s) => s.guild?.id ?? null);
    const partyId = usePartyStore((s) => s.party?.id ?? null);

    // Track already-seen message ids per channel so we don't double-count
    // between realtime + polling + Chat.tsx's own subscription.
    const seenRef = useRef<Map<string, Set<string>>>(new Map());

    /**
     * Handle one incoming message for a channel: dedupe, bump unread,
     * raise notification. Used by every subscription path (realtime +
     * polling for system / guild / party / open PM tabs).
     *
     * `isInitialBackfill` is true when we're seeding seenRef from the
     * INITIAL fetch on (re)subscribe — those messages were already in
     * the channel before we attached, so we silence the notification
     * dot for them and just record their ids.
     */
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

    /**
     * Wire a channel (system / guild_X / party_Y / pm tab) with the
     * full belt-and-braces flow:
     *   1. Pull current messages -> seed `seenRef` so we don't fire
     *      the dot for chatter the player already had on screen.
     *   2. Open the realtime subscription for fast delivery.
     *   3. Poll every 4s as the fallback for setups where realtime
     *      isn't publishing the messages table reliably.
     * Returns a cleanup that tears down realtime + polling together.
     */
    const wireChannel = (channel: string): (() => void) => {
        let cancelled = false;
        // 1. Initial backfill — populate seenRef without raising the dot.
        void chatApi.getMessages(channel).then((rows) => {
            if (cancelled) return;
            for (const m of rows) handleMessage(channel, m, true);
        }).catch(() => { /* offline */ });

        // 2. Realtime subscription.
        const unsubRealtime = chatApi.subscribe(channel, (msg) => {
            if (cancelled) return;
            handleMessage(channel, msg, false);
        });

        // 3. Polling fallback. Same cadence as Chat.tsx (4s).
        const pollId = window.setInterval(() => {
            if (cancelled) return;
            void chatApi.getMessages(channel).then((rows) => {
                if (cancelled) return;
                for (const m of rows) handleMessage(channel, m, false);
            }).catch(() => { /* offline – skip tick */ });
        }, 4000);

        return () => {
            cancelled = true;
            unsubRealtime();
            window.clearInterval(pollId);
        };
    };

    // System broadcast channel — always wired once we know who we are.
    useEffect(() => {
        if (!myName) return;
        return wireChannel('system');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [myName]);

    // Guild channel — re-wires when the player joins a different guild.
    useEffect(() => {
        if (!myName || !guildId) return;
        return wireChannel(`guild_${guildId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [myName, guildId]);

    // Party channel.
    useEffect(() => {
        if (!myName || !partyId) return;
        return wireChannel(`party_${partyId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [myName, partyId]);

    // PM tabs the player already has open — wire each with the same
    // realtime+polling combo so DMs also light up the dot reliably.
    useEffect(() => {
        if (!myName) return;
        const unsubs: Array<() => void> = [];
        for (const tab of tabs) {
            if (tab.type !== 'pm') continue;
            unsubs.push(wireChannel(tab.channel));
        }
        return () => { unsubs.forEach((u) => u()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tabs, myName]);

    // Global PM catch-all — auto-opens a PM tab the first time a message
    // arrives from a stranger we haven't talked to yet. Keeps using
    // `subscribeAll` for the auto-open path since we don't know channels
    // in advance; the per-PM-tab wiring above takes over once the tab
    // exists.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [myName, ensurePmTab, incrementUnread, raiseNotification]);
};
