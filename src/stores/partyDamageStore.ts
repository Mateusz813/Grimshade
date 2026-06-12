import { create } from 'zustand';

/**
 * Party damage tracker — accumulates damage dealt by each party member
 * during the current activity (hunt / boss / dungeon / raid). The
 * floating PartyWidget reads from here to render the "ile zadali dmg
 * podczas danej aktywności party" column.
 *
 * For now only the local player's damage is tracked (no cross-client
 * realtime broadcast yet) — remote allies show 0 damage until a peer
 * sync layer lands. The store is also reset whenever a new activity
 * starts (`reset()`), so the widget always shows numbers for the
 * current fight rather than the player's whole session total.
 */

interface IPartyDamageState {
    /** memberId -> damage dealt so far in this activity. */
    damage: Record<string, number>;
    /** ISO timestamp of when the current activity started; used for UI. */
    sessionStart: string;

    /** Add damage for a member (called from combat tick handlers). */
    addDamage: (memberId: string, amount: number) => void;
    /** Set absolute damage for a member (used by realtime peer sync). */
    setMemberDamage: (memberId: string, total: number) => void;
    /** Reset the entire session — call when a new fight begins. */
    reset: () => void;
}

export const usePartyDamageStore = create<IPartyDamageState>()((set) => ({
    damage: {},
    sessionStart: new Date().toISOString(),

    addDamage: (memberId, amount) => {
        if (!memberId || !Number.isFinite(amount) || amount <= 0) return;
        set((s) => ({
            damage: { ...s.damage, [memberId]: (s.damage[memberId] ?? 0) + amount },
        }));
    },

    setMemberDamage: (memberId, total) => {
        if (!memberId) return;
        set((s) => ({
            damage: { ...s.damage, [memberId]: Math.max(0, Math.floor(total)) },
        }));
    },

    reset: () => {
        set({ damage: {}, sessionStart: new Date().toISOString() });
    },
}));
