import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';


export interface IPartyMemberSnapshot {
    id: string;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    transformTier: number;
    maxUnlockedMonsterLevel?: number;
    skillMode?: 'auto' | 'manual';
    currentRoute?: string;
    summons?: Array<{ type: 'skeleton' | 'ghost' | 'demon' | 'lich'; hp: number; maxHp: number; mp: number; maxMp: number }>;
    attack?: number;
    defense?: number;
    receivedAt: number;
}

interface IPartyPresenceState {
    byMember: Record<string, IPartyMemberSnapshot>;
    channel: RealtimeChannel | null;
    partyId: string | null;

    subscribe: (partyId: string) => () => void;
    publish: (snapshot: Omit<IPartyMemberSnapshot, 'receivedAt'>) => void;
    clear: () => void;
}

const STALE_MS = 30_000;
const MIN_PUBLISH_INTERVAL_MS = 500;

let lastPublishAt = 0;
let pendingSnapshot: Omit<IPartyMemberSnapshot, 'receivedAt'> | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

export const usePartyPresenceStore = create<IPartyPresenceState>()((set, get) => ({
    byMember: {},
    channel: null,
    partyId: null,

    subscribe: (partyId) => {
        const current = get();
        if (current.partyId === partyId && current.channel) {
            return () => {};
        }
        if (current.channel) {
            try { void supabase.removeChannel(current.channel); } catch { }
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
                try { void supabase.removeChannel(c); } catch { }
            }
            set({ channel: null, partyId: null, byMember: {} });
        };
    },

    publish: (snapshot) => {
        const now = Date.now();
        const { channel } = get();
        if (!channel) return;

        set((s) => ({
            byMember: { ...s.byMember, [snapshot.id]: { ...snapshot, receivedAt: now } },
        }));

        const sinceLast = now - lastPublishAt;
        if (sinceLast >= MIN_PUBLISH_INTERVAL_MS) {
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
            try { void supabase.removeChannel(channel); } catch { }
        }
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        pendingSnapshot = null;
        lastPublishAt = 0;
        set({ channel: null, partyId: null, byMember: {} });
    },
}));
