import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';


export type ReadyDestination = '/combat' | '/boss' | '/raid' | '/trainer';

interface IReadyCheckState {
    open: boolean;
    destination: ReadyDestination | null;
    requesterId: string | null;
    readyIds: string[];
    requiredIds: string[];
    payload: unknown;
    label: string | null;

    channel: RealtimeChannel | null;
    partyId: string | null;

    start: (params: {
        destination: ReadyDestination;
        requesterId: string;
        memberIds: string[];
        payload?: unknown;
        label?: string;
    }) => void;
    ready: (memberId: string) => void;
    cancel: (memberId: string) => void;
    subscribe: (partyId: string) => () => void;
    clear: () => void;
    fireGo: () => void;
    instantStart: (params: {
        destination: ReadyDestination;
        payload?: unknown;
        label?: string;
    }) => void;
    consumeDestination: () => void;
}

const READY_TIMEOUT_MS = 60_000;
let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

const clearTimeoutHandle = () => {
    if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
    }
};

export const usePartyReadyCheckStore = create<IReadyCheckState>()((set, get) => ({
    open: false,
    destination: null,
    requesterId: null,
    readyIds: [],
    requiredIds: [],
    payload: null,
    label: null,
    channel: null,
    partyId: null,

    subscribe: (partyId) => {
        const current = get();
        if (current.partyId === partyId && current.channel) return () => {};
        if (current.channel) {
            try { void supabase.removeChannel(current.channel); } catch { }
        }
        const channel = supabase.channel(`party-ready-${partyId}`, {
            config: { broadcast: { self: true } },
        });
        channel.on('broadcast', { event: 'start' }, async ({ payload }) => {
            const { destination, requesterId, memberIds, fightPayload, label } = payload as {
                destination: ReadyDestination;
                requesterId: string;
                memberIds: string[];
                fightPayload?: unknown;
                label?: string;
            };
            clearTimeoutHandle();
            set({
                open: true,
                destination,
                requesterId,
                requiredIds: memberIds,
                payload: fightPayload ?? null,
                label: label ?? null,
                readyIds: [requesterId],
            });
            try {
                const { useCharacterStore } = await import('./characterStore');
                const meId = useCharacterStore.getState().character?.id;
                if (meId && meId !== requesterId && destination && window.location.pathname !== destination) {
                    window.history.pushState({}, '', destination);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                }
            } catch { }
            timeoutHandle = setTimeout(() => {
                if (get().open) get().cancel(requesterId);
            }, READY_TIMEOUT_MS);
        });
        channel.on('broadcast', { event: 'ready' }, ({ payload }) => {
            const { memberId } = payload as { memberId: string };
            set((s) => {
                if (!s.open) return s;
                if (s.readyIds.includes(memberId)) return s;
                return { readyIds: [...s.readyIds, memberId] };
            });
        });
        channel.on('broadcast', { event: 'cancel' }, async () => {
            const prevDestination = get().destination;
            const prevRequesterId = get().requesterId;
            clearTimeoutHandle();
            set({
                open: false,
                destination: null,
                requesterId: null,
                readyIds: [],
                requiredIds: [],
                payload: null,
                label: null,
            });
            try {
                const { useCharacterStore } = await import('./characterStore');
                const meId = useCharacterStore.getState().character?.id;
                if (meId && meId !== prevRequesterId
                    && prevDestination
                    && window.location.pathname === prevDestination) {
                    window.history.pushState({}, '', '/');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                }
            } catch { }
        });
        channel.on('broadcast', { event: 'go' }, ({ payload }) => {
            const { destination } = payload as { destination: ReadyDestination };
            clearTimeoutHandle();
            set({ open: false, readyIds: [], requiredIds: [], destination });
            try {
                window.history.pushState({}, '', destination);
                window.dispatchEvent(new PopStateEvent('popstate'));
            } catch { }
        });
        channel.on('broadcast', { event: 'instant-go' }, ({ payload }) => {
            const { destination, fightPayload, label } = payload as {
                destination: ReadyDestination;
                fightPayload?: unknown;
                label?: string;
            };
            clearTimeoutHandle();
            set({
                open: false,
                destination,
                payload: fightPayload ?? null,
                label: label ?? null,
                readyIds: [],
                requiredIds: [],
            });
            try {
                window.history.pushState({}, '', destination);
                window.dispatchEvent(new PopStateEvent('popstate'));
            } catch { }
        });
        channel.subscribe();
        set({ channel, partyId });
        return () => {
            const c = get().channel;
            if (c) {
                try { void supabase.removeChannel(c); } catch { }
            }
            clearTimeoutHandle();
            set({
                channel: null, partyId: null, open: false,
                readyIds: [], requiredIds: [],
                destination: null, requesterId: null,
                payload: null, label: null,
            });
        };
    },

    start: ({ destination, requesterId, memberIds, payload, label }) => {
        const { channel } = get();
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'start',
            payload: { destination, requesterId, memberIds, fightPayload: payload, label },
        });
    },

    ready: (memberId) => {
        const { channel } = get();
        if (!channel) return;
        set((s) => (s.readyIds.includes(memberId) ? s : { readyIds: [...s.readyIds, memberId] }));
        void channel.send({
            type: 'broadcast',
            event: 'ready',
            payload: { memberId },
        });
        const { readyIds, requiredIds, requesterId } = get();
        if (
            requesterId &&
            memberId === requesterId &&
            requiredIds.length > 0 &&
            requiredIds.every((id) => readyIds.includes(id) || id === memberId)
        ) {
            get().fireGo();
        }
    },

    cancel: (memberId) => {
        const { channel } = get();
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'cancel',
            payload: { memberId },
        });
    },

    fireGo: () => {
        const { channel, destination } = get();
        if (!channel || !destination) return;
        void channel.send({
            type: 'broadcast',
            event: 'go',
            payload: { destination },
        });
    },

    instantStart: ({ destination, payload, label }) => {
        const { channel } = get();
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'instant-go',
            payload: { destination, fightPayload: payload, label },
        });
    },

    consumeDestination: () => {
        set({ destination: null, payload: null, label: null });
    },

    clear: () => {
        clearTimeoutHandle();
        const { channel } = get();
        if (channel) {
            try { void supabase.removeChannel(channel); } catch { }
        }
        set({
            channel: null,
            partyId: null,
            open: false,
            destination: null,
            requesterId: null,
            readyIds: [],
            requiredIds: [],
            payload: null,
            label: null,
        });
    },
}));

usePartyReadyCheckStore.subscribe((s, prev) => {
    if (!s.open) return;
    if (s.readyIds.length === prev.readyIds.length) return;
    if (!s.requesterId) return;
    if (s.requiredIds.length === 0) return;
    const allReady = s.requiredIds.every((id) => s.readyIds.includes(id));
    if (!allReady) return;
    void s;
});
