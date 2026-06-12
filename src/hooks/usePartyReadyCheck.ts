import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePartyStore } from '../stores/partyStore';
import {
    usePartyReadyCheckStore,
    type ReadyDestination,
} from '../stores/partyReadyCheckStore';
import { useCharacterStore } from '../stores/characterStore';

/**
 * Mounted once near the top of the app shell. Two responsibilities:
 *   1. Open the broadcast channel `party-ready-<partyId>` whenever the
 *      player is in a party so READY-CHECK events flow.
 *   2. When the `go` event fires, navigate the local client to the
 *      destination route. The leader's view is responsible for firing
 *      `requestPartyCombatStart` (helper below) when they pick a
 *      specific fight; we don't intercept hub-route navigation
 *      because the spec is "popup pojawia się DOPIERO po wybraniu
 *      konkretnej walki" — clicking the /combat hub itself should
 *      stay free.
 */

export const usePartyReadyCheck = (): void => {
    const location = useLocation();
    const navigate = useNavigate();
    const party = usePartyStore((s) => s.party);
    const subscribe = usePartyReadyCheckStore((s) => s.subscribe);
    const destination = usePartyReadyCheckStore((s) => s.destination);
    const open = usePartyReadyCheckStore((s) => s.open);

    // 1. Subscribe to the party's ready channel.
    useEffect(() => {
        if (!party?.id) return;
        const cleanup = subscribe(party.id);
        return cleanup;
    }, [party?.id, subscribe]);

    // 2. After `go` fires, every client receives `destination` set +
    //    `open` cleared. Navigate the local view there ONCE, then
    //    consume the destination so subsequent navigations (player
    //    leaving combat to go to town etc.) aren't bounced back.
    useEffect(() => {
        if (open) return;
        if (!destination) return;
        if (location.pathname === destination) {
            // Already on it — just consume the destination so future
            // route changes are free.
            usePartyReadyCheckStore.getState().consumeDestination();
            return;
        }
        navigate(destination, { replace: false });
        // Drop the slot immediately — the post-navigate render will
        // see `destination: null` and the effect won't re-fire even
        // when the user navigates away from `destination` later.
        usePartyReadyCheckStore.getState().consumeDestination();
    }, [open, destination, location.pathname, navigate]);
};

/**
 * Imperative helper for views ("Walcz" buttons on hunt/boss/raid/dungeon/
 * trainer screens). Call this BEFORE actually starting combat:
 *   - Solo player or party with only bots -> runs `onConfirmed` immediately.
 *   - Multi-human party + you ARE the leader -> fires the ready-check
 *     broadcast (with the fight `payload` so members can replicate the
 *     same monster/boss). Modal opens for everyone. NOTHING happens
 *     locally yet — the leader's combat doesn't start until the `go`
 *     event fires after all confirm. At that point a global go-handler
 *     (registered via `useReadyCheckGoHandler` below) runs on every
 *     client with the payload.
 *   - Multi-human party + you're NOT the leader -> returns `false`; only
 *     the leader picks the fight per spec.
 *
 * Returns `true` when the action was triggered (either ran immediately
 * for solo, or broadcasts the check), `false` when blocked.
 */
export const requestPartyCombatStart = (params: {
    destination: ReadyDestination;
    label?: string;
    /** Opaque payload broadcast to every member so they can replicate
     *  the leader's exact fight on `go` (e.g. the monster JSON for
     *  hunt fights, the boss id for boss fights, etc.). */
    payload?: unknown;
    /** Action to run on `go` for THIS client. Solo callers also run
     *  this immediately. Multi-human-party leader: this is queued
     *  for the `go` event — does NOT run on click. */
    onConfirmed: () => void;
}): boolean => {
    const character = useCharacterStore.getState().character;
    const party = usePartyStore.getState().party;
    const store = usePartyReadyCheckStore.getState();

    if (!character) return false;

    // 2026-05-12 spec ("nawet solo lider startuje walke -> party znika"):
    // any combat start by a player IN a party locks the party from the
    // public browser. Fires BEFORE the solo / multi-human branching
    // below so a leader alone in their party (no other humans yet)
    // still triggers the lock — invitations after combat start are
    // not allowed by spec.
    if (party && party.leaderId === character.id) {
        void (async () => {
            try {
                const { partyApi } = await import('../api/v1/partyApi');
                await partyApi.updatePartyMeta(party.id, { is_public: false });
            } catch {
                /* non-fatal: leaves party joinable, but isn't a blocker */
            }
        })();
    }

    // Solo / no other humans -> run immediately, no popup.
    const otherHumans = party?.members.filter((m) => m.id !== character.id && !m.isBot) ?? [];
    if (!party || otherHumans.length === 0) {
        params.onConfirmed();
        return true;
    }

    // Non-leader: spec says only the leader picks the fight.
    if (party.leaderId !== character.id) {
        return false;
    }

    // Multi-human party + leader: queue the leader's action so it runs
    // ON `go` (not immediately) — this is what makes the spec
    // "everyone enters the fight together" actually work.
    pendingGoAction = params.onConfirmed;

    const memberIds = party.members.filter((m) => !m.isBot).map((m) => m.id);
    store.start({
        destination: params.destination,
        requesterId: character.id,
        memberIds,
        payload: params.payload,
        label: params.label,
    });

    return true;
};

/** Global "run this on go" slot. Set by `requestPartyCombatStart` for
 *  the leader, consumed by `useReadyCheckGoHandler` below. Members
 *  don't set this — they run their own go-handler keyed on
 *  destination/payload (registered per-view). */
let pendingGoAction: (() => void) | null = null;

/**
 * Skip the ready-check popup and broadcast a `go`-equivalent
 * immediately. Use for leader-initiated retries / chains where the
 * party already confirmed once and asking again would be friction.
 * Solo flow runs `onConfirmed` directly (no broadcast). Member flow
 * (rare — usually only the leader calls this) is a silent no-op.
 *
 * 2026-05-13 spec ("Jak lider klika Walcz ponownie to wszyscy nie
 * powinni potwierdzac jej tylko od razu powinno im ekran przekierowywac
 * do walki z bossem ale wczesniej animacja"): leader passes a callback
 * that plays the entry animation locally; members run the registered
 * replicator on receipt of the broadcast.
 */
export const triggerPartyCombatGo = (params: {
    destination: ReadyDestination;
    label?: string;
    payload?: unknown;
    onConfirmed: () => void;
}): boolean => {
    const character = useCharacterStore.getState().character;
    const party = usePartyStore.getState().party;

    if (!character) return false;

    // Lock the public-party browser the same way requestPartyCombatStart
    // does — any combat start hides the party from joiners.
    if (party && party.leaderId === character.id) {
        void (async () => {
            try {
                const { partyApi } = await import('../api/v1/partyApi');
                await partyApi.updatePartyMeta(party.id, { is_public: false });
            } catch { /* non-fatal */ }
        })();
    }

    const otherHumans = party?.members.filter((m) => m.id !== character.id && !m.isBot) ?? [];
    if (!party || otherHumans.length === 0) {
        // Solo or alone-in-party: just run the action locally, no broadcast.
        params.onConfirmed();
        return true;
    }
    if (party.leaderId !== character.id) {
        // Only the leader can chain fights — guard for safety.
        return false;
    }

    // Queue the leader's action so `useReadyCheckGoEffect` runs it when
    // the `instant-go` channel event lands locally (same path as the
    // ready-check `go` flow, just without the popup).
    pendingGoAction = params.onConfirmed;
    usePartyReadyCheckStore.getState().instantStart({
        destination: params.destination,
        payload: params.payload,
        label: params.label,
    });
    return true;
};

/**
 * Mounted in the app shell. Listens for `go` events from the
 * ready-check store and:
 *   - Runs the leader's pending action (queued by `requestPartyCombatStart`).
 *   - For non-leader members, runs whatever fight-replication handler
 *     is registered for the destination via `registerGoReplicator`.
 */
export const useReadyCheckGoEffect = (): void => {
    const open = usePartyReadyCheckStore((s) => s.open);
    const destination = usePartyReadyCheckStore((s) => s.destination);
    const payload = usePartyReadyCheckStore((s) => s.payload);
    const character = useCharacterStore.getState().character;
    const party = usePartyStore.getState().party;

    useEffect(() => {
        // `go` was fired -> store sets open=false, keeps destination set.
        if (open) return;
        if (!destination) return;
        // Leader: run the queued action. Drop the slot so a stale
        // action can't fire on a later go.
        if (character && party?.leaderId === character.id && pendingGoAction) {
            const action = pendingGoAction;
            pendingGoAction = null;
            try { action(); } catch (e) { console.error('[readyCheck] leader go-action failed:', e); }
            return;
        }
        // Member: look up the per-destination replicator.
        const replicator = goReplicators[destination];
        if (replicator) {
            try { replicator(payload); } catch (e) { console.error('[readyCheck] member go-replicator failed:', e); }
        }
    // We re-evaluate only when the modal closes (open flips false)
    // with a destination set — that's the moment `go` fired.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, destination]);
};

/**
 * Per-destination handler each view can register so non-leader
 * members can replicate the leader's fight on `go`. Example:
 *   registerGoReplicator('/combat', (payload) => {
 *       const monster = payload as IMonster;
 *       engineStartNewFight(monster);
 *   });
 */
type GoReplicator = (payload: unknown) => void;
const goReplicators: Partial<Record<ReadyDestination, GoReplicator>> = {};

export const registerGoReplicator = (
    destination: ReadyDestination,
    fn: GoReplicator,
): void => {
    goReplicators[destination] = fn;
};
