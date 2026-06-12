import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Ready-check coordinator for party combat entries.
 *
 * Spec: when the leader clicks Walka / Boss / Raid / Trainer while the
 * party has at least one non-bot ally, EVERY member (incl. leader) gets
 * a "Gotowy?" popup. Once everyone confirms, the leader's
 * destination route is broadcast to all members and they navigate
 * together.
 *
 * Realtime is implemented over a dedicated Supabase broadcast channel
 * `party-ready-<partyId>`:
 *   - leader sends `start { destination, requesterId }` to open the check
 *   - each member replies with `ready { memberId }` when they confirm
 *   - leader watches the ready-set; when it covers every member, sends
 *     `go { destination }` and clears its own state. Members react to
 *     `go` by navigating to the destination.
 *   - any member can send `cancel { memberId }` to abort (leader closes
 *     the modal for everyone).
 *
 * No DB writes — channel is ephemeral. If a member's tab closes, their
 * ready state never arrives and the leader's modal sits open with the
 * timeout (60 s) auto-cancelling.
 */

export type ReadyDestination = '/combat' | '/boss' | '/raid' | '/trainer';

interface IReadyCheckState {
    /** True while a check is in progress for this client. */
    open: boolean;
    /** The route everyone will navigate to once all-ready. */
    destination: ReadyDestination | null;
    /** Character id that started the check (usually the leader). */
    requesterId: string | null;
    /** Set of memberIds that have confirmed (includes self when readied). */
    readyIds: string[];
    /** Set of memberIds expected to confirm (snapshot taken at start). */
    requiredIds: string[];
    /** Opaque payload (e.g. monster JSON) so receiving clients can
     *  replicate the exact fight when the `go` event fires. */
    payload: unknown;
    /** Human-readable label shown in the modal ("Smok Cienia Lv 50"). */
    label: string | null;

    /** Active broadcast channel for the current party. */
    channel: RealtimeChannel | null;
    partyId: string | null;

    /** Leader-only: open the check + broadcast `start`. */
    start: (params: {
        destination: ReadyDestination;
        requesterId: string;
        memberIds: string[];
        payload?: unknown;
        label?: string;
    }) => void;
    /** Any member: confirm ready + broadcast `ready`. */
    ready: (memberId: string) => void;
    /** Any member: cancel + broadcast `cancel`. */
    cancel: (memberId: string) => void;
    /** Subscribe / re-subscribe to a party's ready-check channel. */
    subscribe: (partyId: string) => () => void;
    /** Drop everything. */
    clear: () => void;
    /** Internal: leader-only close + tell members to navigate. */
    fireGo: () => void;
    /** Skip the ready-check popup entirely and just broadcast `go`-style
     *  navigation + payload. Used for leader retries ("Walcz ponownie")
     *  when the party already confirmed the original fight — no point
     *  asking again. Members navigate immediately + their registered
     *  replicator fires. */
    instantStart: (params: {
        destination: ReadyDestination;
        payload?: unknown;
        label?: string;
    }) => void;
    /** Consume the post-`go` destination — call once the local view has
     *  navigated to it. Without this the route guard would keep
     *  bouncing the user back to /combat every time they tried to
     *  leave. */
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
            try { void supabase.removeChannel(current.channel); } catch { /* ignore */ }
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
                // The requester is auto-readied so leaders don't have to
                // hit "Gotowy" twice (once to start, once to confirm).
                readyIds: [requesterId],
            });
            // 2026-05-14 spec ("na przywolywanym popupie zrob redirect
            // na /boss, jak ktos anuluje cofnij go do miasta"): pre-
            // navigate non-requesters to the destination so the popup
            // overlays the fight screen instead of their previous view.
            // On `go` they're already there -> animation triggers in
            // place; on `cancel` they go back to /. The requester (the
            // leader who initiated) stays on whatever page they were on
            // (typically already /boss).
            try {
                const { useCharacterStore } = await import('./characterStore');
                const meId = useCharacterStore.getState().character?.id;
                if (meId && meId !== requesterId && destination && window.location.pathname !== destination) {
                    window.history.pushState({}, '', destination);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                }
            } catch { /* ignore */ }
            // Auto-cancel after the timeout if not everyone responds.
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
            // 2026-05-14: undo the pre-navigation. If we (non-requester)
            // are still on the destination route and the popup was
            // cancelled, send us home. The requester (typically the
            // leader) stays where they were.
            try {
                const { useCharacterStore } = await import('./characterStore');
                const meId = useCharacterStore.getState().character?.id;
                if (meId && meId !== prevRequesterId
                    && prevDestination
                    && window.location.pathname === prevDestination) {
                    window.history.pushState({}, '', '/');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                }
            } catch { /* ignore */ }
        });
        channel.on('broadcast', { event: 'go' }, ({ payload }) => {
            const { destination } = payload as { destination: ReadyDestination };
            clearTimeoutHandle();
            // Don't clear `destination` — consumers (App-level guard) read
            // it on navigate. We DO clear `open` so the modal closes.
            set({ open: false, readyIds: [], requiredIds: [], destination });
            // Best-effort navigation. The router-level guard will pick this
            // up via state. We use window.location to avoid pulling the
            // navigate hook into a zustand store.
            try {
                window.history.pushState({}, '', destination);
                window.dispatchEvent(new PopStateEvent('popstate'));
            } catch { /* ignore */ }
        });
        channel.on('broadcast', { event: 'instant-go' }, ({ payload }) => {
            // 2026-05-13 spec ("Jak lider klika Walcz ponownie to wszyscy
            // musza znowu potwierdzic gotowosc a nie powinni potwierdzac
            // jej tylko od razu powinno im ekran przekierowywac do walki
            // z bossem"): skip the ready-check entirely. Set destination
            // + payload + label + immediately navigate. The receiver
            // side's useReadyCheckGoEffect picks up the destination
            // change and runs the registered replicator (member) or the
            // pendingGoAction (leader, set before broadcasting).
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
            } catch { /* ignore */ }
        });
        channel.subscribe();
        set({ channel, partyId });
        return () => {
            const c = get().channel;
            if (c) {
                try { void supabase.removeChannel(c); } catch { /* ignore */ }
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
        // Optimistic local update so the modal updates instantly even if
        // the broadcast round-trip lags.
        set((s) => (s.readyIds.includes(memberId) ? s : { readyIds: [...s.readyIds, memberId] }));
        void channel.send({
            type: 'broadcast',
            event: 'ready',
            payload: { memberId },
        });
        // If everyone is now ready and the local client is the requester,
        // fire the `go` event automatically.
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
            try { void supabase.removeChannel(channel); } catch { /* ignore */ }
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

// -- Auto-fire `go` when leader's local readyIds covers all required --
// (Only the requester runs fireGo.)
usePartyReadyCheckStore.subscribe((s, prev) => {
    if (!s.open) return;
    if (s.readyIds.length === prev.readyIds.length) return;
    if (!s.requesterId) return;
    if (s.requiredIds.length === 0) return;
    const allReady = s.requiredIds.every((id) => s.readyIds.includes(id));
    if (!allReady) return;
    // Only the requester broadcasts `go` — others have it as a no-op
    // because they don't know who the requester is until the start
    // event lands. Use the channel to detect "am I the requester".
    // The simplest gate: requester's snapshot includes own id, and we
    // store partyStore.party.leaderId locally — but here we just rely
    // on the convention that the requester has their character id ===
    // requesterId. Defer the actual gate to the consumer (Hook below).
    void s; // no-op; ReadyCheckModal handles fireGo from leader side.
});
