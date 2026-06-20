import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Cross-client presence layer for a party — pure realtime broadcast,
 * no DB schema changes. Each party member opens a Supabase channel
 * `party-live-<partyId>` and:
 *   - Sends their own snapshot (`{ id, hp, maxHp, mp, maxMp, transformTier }`)
 *     every 2 s while in a party, and immediately on connect.
 *   - Listens for other members' snapshots and stores the latest in
 *     `byMember[memberId]`.
 *
 * The PartyWidget renders ally HP/MP/avatar using `byMember[ally.id]`
 * with sane fallbacks — so even before a snapshot arrives, the widget
 * shows the class-icon fallback instead of empty bars.
 */

export interface IPartyMemberSnapshot {
    /** Character id (matches party_members.character_id). */
    id: string;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    /** Highest completed transform tier — picks the avatar PNG.
     *  0 means base class avatar. */
    transformTier: number;
    /** 2026-05-11: highest-level monster this member has unlocked
     *  (level gate + mastery prereq on previous monster). The leader's
     *  monster picker filters by `min(party members' value)` so it
     *  only shows monsters EVERY member can actually fight. Undefined
     *  on snapshots from older clients — treat as "no restriction". */
    maxUnlockedMonsterLevel?: number;
    /** 2026-05-14 spec ("w party kazdy sojusznik moze sam decydowac
     *  czy uzywa auto spelli czy nie"): the member's local
     *  `settingsStore.skillMode`. The leader-driven combat engine
     *  iterates every party member and decides whether to auto-cast a
     *  skill for them — without this broadcast, the engine always
     *  read the LEADER's `skillMode` so a member toggling auto-skills
     *  off had no effect on their own character. Undefined falls back
     *  to 'auto' (matches the engine's pre-fix default). */
    skillMode?: 'auto' | 'manual';
    /** 2026-05-15 v4 spec ("Jak ktos wychodzi z treningu nie wywala
     *  go na 2 ekranie u innych uczestnikow party"): pathname the
     *  member's local router is on (`/`, `/trainer`, `/raid`, etc.).
     *  Combat views filter their ally roster by this so a member
     *  who leaves trainer DISAPPEARS from the others' trainer card
     *  grid (without leaving the party). Undefined on older clients
     *  — treat as "not in trainer" so they don't ghost the layout
     *  with a phantom card. */
    currentRoute?: string;
    /** 2026-05-15 v16 spec ("Jako sojusznik party nie widze summonow
     *  necromanty a powinienem widziec, na trainerze, polowaniu,
     *  raidzie, bossie"): for Necromancer members this carries the
     *  live summon list so every other client renders the front-of-
     *  queue summon avatar + per-type badge counts on the necro's
     *  ally card. Undefined for non-necros / pre-v16 clients. */
    summons?: Array<{ type: 'skeleton' | 'ghost' | 'demon' | 'lich'; hp: number; maxHp: number; mp: number; maxMp: number }>;
    /** 2026-06-19 spec ("party damage ignoruje ekwipunek sojusznikow"):
     *  the member's REAL effective combat stats from `getEffectiveChar`
     *  (base + equipment + upgrades + training + elixirs + transform).
     *  The leader's Boss/Raid combat represents each human party-mate as
     *  an AI bot scaled to the LEADER's level with NO gear — so a fully
     *  geared friend dealt only bot-tier damage. Broadcasting the real
     *  `attack`/`defense` lets the leader override the bot slot so the
     *  friend hits with their actual power. Undefined on snapshots from
     *  older clients — the leader falls back to the bot formula (safe
     *  degrade, nothing breaks). */
    attack?: number;
    defense?: number;
    /** Local timestamp the snapshot was last received. Stale entries
     *  (>30 s old) are auto-cleared by the GC tick. */
    receivedAt: number;
}

interface IPartyPresenceState {
    /** memberId -> latest snapshot. */
    byMember: Record<string, IPartyMemberSnapshot>;
    /** Currently subscribed channel handle. */
    channel: RealtimeChannel | null;
    /** Active party id we're subscribed to. */
    partyId: string | null;

    /** Open / refresh the broadcast channel for the given party. Returns
     *  a cleanup function to call when the player leaves the party or
     *  disconnects. */
    subscribe: (partyId: string) => () => void;
    /** Send the local player's snapshot to the channel. Throttled
     *  internally — calling more often than once per 500 ms is a no-op. */
    publish: (snapshot: Omit<IPartyMemberSnapshot, 'receivedAt'>) => void;
    /** Drop everything (called on full party disconnect). */
    clear: () => void;
}

const STALE_MS = 30_000;
const MIN_PUBLISH_INTERVAL_MS = 500;

let lastPublishAt = 0;
/** 2026-05-11: queue for the latest pending snapshot when throttled.
 *  Previously a publish call within the throttle window was dropped
 *  entirely — meaning the moment after a heal/HP-change the broadcast
 *  could be silently lost and remote allies kept seeing stale (often
 *  hp=0) data until the next 2 s heartbeat. Now we ALWAYS apply the
 *  local mirror (so own UI is correct) and queue the broadcast to
 *  fire when the throttle window opens. */
let pendingSnapshot: Omit<IPartyMemberSnapshot, 'receivedAt'> | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

export const usePartyPresenceStore = create<IPartyPresenceState>()((set, get) => ({
    byMember: {},
    channel: null,
    partyId: null,

    subscribe: (partyId) => {
        const current = get();
        // Already subscribed to this party — no-op.
        if (current.partyId === partyId && current.channel) {
            return () => {};
        }
        // Different party (or no party) — tear down old channel first.
        if (current.channel) {
            try { void supabase.removeChannel(current.channel); } catch { /* ignore */ }
        }

        const channel = supabase.channel(`party-live-${partyId}`, {
            config: { broadcast: { self: false }, presence: { key: partyId } },
        });
        channel.on('broadcast', { event: 'snapshot' }, ({ payload }) => {
            const p = payload as Omit<IPartyMemberSnapshot, 'receivedAt'>;
            if (!p?.id) return;
            set((s) => ({
                byMember: { ...s.byMember, [p.id]: { ...p, receivedAt: Date.now() } },
            }));
        });
        channel.subscribe();

        set({ channel, partyId, byMember: {} });

        // GC: every 10 s, drop snapshots older than STALE_MS so the
        // widget's HP/MP bars stop showing stale data when an ally
        // closes their tab.
        const gc = setInterval(() => {
            const now = Date.now();
            set((s) => {
                const next: Record<string, IPartyMemberSnapshot> = {};
                let changed = false;
                for (const [id, snap] of Object.entries(s.byMember)) {
                    if (now - snap.receivedAt < STALE_MS) {
                        next[id] = snap;
                    } else {
                        changed = true;
                    }
                }
                return changed ? { byMember: next } : s;
            });
        }, 10_000);

        return () => {
            clearInterval(gc);
            const c = get().channel;
            if (c) {
                try { void supabase.removeChannel(c); } catch { /* ignore */ }
            }
            set({ channel: null, partyId: null, byMember: {} });
        };
    },

    publish: (snapshot) => {
        const now = Date.now();
        const { channel } = get();
        if (!channel) return;

        // ALWAYS update the local mirror — UI must reflect own state
        // immediately even when throttled. Without this the player's
        // own bars in the PartyWidget freeze during rapid HP swings.
        set((s) => ({
            byMember: { ...s.byMember, [snapshot.id]: { ...snapshot, receivedAt: now } },
        }));

        const sinceLast = now - lastPublishAt;
        if (sinceLast >= MIN_PUBLISH_INTERVAL_MS) {
            // Fire immediately + drop any queued snapshot.
            lastPublishAt = now;
            pendingSnapshot = null;
            if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
            void channel.send({
                type: 'broadcast',
                event: 'snapshot',
                payload: snapshot,
            });
            return;
        }

        // Inside throttle window — overwrite pending snapshot with the
        // freshest values and schedule the flush. Multiple rapid
        // publishes collapse into a single send carrying the latest
        // state, so allies never miss a heal / damage update.
        pendingSnapshot = snapshot;
        if (pendingTimer) return;
        const delay = MIN_PUBLISH_INTERVAL_MS - sinceLast;
        pendingTimer = setTimeout(() => {
            pendingTimer = null;
            const queued = pendingSnapshot;
            pendingSnapshot = null;
            const c = get().channel;
            if (!c || !queued) return;
            lastPublishAt = Date.now();
            void c.send({
                type: 'broadcast',
                event: 'snapshot',
                payload: queued,
            });
        }, delay);
    },

    clear: () => {
        const { channel } = get();
        if (channel) {
            try { void supabase.removeChannel(channel); } catch { /* ignore */ }
        }
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        pendingSnapshot = null;
        lastPublishAt = 0;
        set({ channel: null, partyId: null, byMember: {} });
    },
}));
