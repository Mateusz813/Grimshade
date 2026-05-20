import { create } from 'zustand';

/**
 * In-memory bookkeeping for necromancer summons during a combat session.
 *
 * Summons stack on top of the necromancer's avatar — they don't get their
 * own ally slot. The store keeps a list per necro id; the view renders a
 * count badge + iterates the list when applying damage so:
 *
 *   • Single-target hits on the necro consume the FIRST summon's HP first.
 *     When the summon dies it's spliced out and the next one becomes the
 *     active "shield". Once all summons are dead, the necro takes hits.
 *   • AOE hits split across every summon AND the necro (each takes the
 *     full hit, like normal AOE — summons are independent entities under
 *     the same icon).
 *   • On the attack tick, summons swing alongside the necro — each summon
 *     deals a fraction of the necro's attack (skeleton 25%, ghost 50%,
 *     demon 120%, lich 200%).
 */
export type NecroSummonType = 'skeleton' | 'ghost' | 'demon' | 'lich';

export interface INecroSummon {
    id: string;
    type: NecroSummonType;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    /** Damage as a multiplier of the necro's `attack` stat. */
    dmgMult: number;
}

interface IState {
    /** necro-id → ordered list of live summons (head = oldest). */
    summons: Record<string, INecroSummon[]>;
}

interface IActions {
    /**
     * Spawn `count` summons of `type` for the given necro. Honours per-type
     * caps (skeleton 10, ghost 6, demon 2, lich 2). Returns how many were
     * actually spawned.
     */
    spawn: (
        necroId: string,
        type: NecroSummonType,
        count: number,
        necroAttack: number,
        necroMaxHp: number,
        necroMaxMp?: number,
    ) => number;
    /** Heal every alive summon by `pct%` of their own maxHp. Used by
     *  Cleric heal_party_pct / Niebiańskie Leczenie etc. so summons
     *  benefit from party-wide heals just like real allies. */
    healAllPct: (necroId: string, pct: number) => void;
    /** Apply damage to the front-of-queue summon. Returns the actual HP
     *  consumed and a flag for whether the queue is now empty (so the
     *  caller forwards the leftover damage to the necro). */
    damageFirst: (necroId: string, dmg: number) => { dmgConsumed: number; queueEmpty: boolean };
    /** Apply AOE damage across every summon in the queue. */
    damageAll: (necroId: string, dmg: number) => void;
    /** Number of live summons for this necro. */
    count: (necroId: string) => number;
    /** Total bonus damage every tick from the summons (for display). */
    totalAttackBonus: (necroId: string, necroAttack: number) => number;
    /** Wipe all summons for one necro (e.g. raid wipe / scene reset). */
    clear: (necroId: string) => void;
    /** Wipe everything. */
    clearAll: () => void;
    /** 2026-05 v7: dismiss one summon of `type` (head-of-queue —
     *  oldest first). Used by the AllyCard's per-type badge click
     *  handler so the player can manually free up summon slots
     *  before re-summoning. Returns true if a summon was actually
     *  despawned. */
    despawnOne: (necroId: string, type: NecroSummonType) => boolean;
}

const CAPS: Record<NecroSummonType, number> = {
    skeleton: 10,
    ghost:    6,
    demon:    2,
    lich:     2,
};

const DMG_MULT: Record<NecroSummonType, number> = {
    skeleton: 0.25,
    ghost:    0.50,
    demon:    1.20,
    lich:     2.00,
};

// Per-spec HP/MP fractions of the necromancer's own pool. Skeletons
// are throwaway meat shields, lich is a heavy-hitter so gets MORE
// HP than the necro herself.
const HP_FRAC_OF_NECRO: Record<NecroSummonType, number> = {
    skeleton: 0.25,
    ghost:    0.50,
    demon:    1.00,
    lich:     2.00,
};
const MP_FRAC_OF_NECRO: Record<NecroSummonType, number> = {
    skeleton: 0.25,
    ghost:    0.50,
    demon:    1.00,
    lich:     2.00,
};

export const useNecroSummonStore = create<IState & IActions>()((set, get) => ({
    summons: {},

    spawn: (necroId, type, count, necroAttack, necroMaxHp, necroMaxMp = 0) => {
        const cap = CAPS[type];
        const cur = get().summons[necroId] ?? [];
        const sameType = cur.filter((s) => s.type === type).length;
        const room = Math.max(0, cap - sameType);
        const toSpawn = Math.min(count, room);
        if (toSpawn <= 0) return 0;
        const next = [...cur];
        for (let i = 0; i < toSpawn; i++) {
            const hp = Math.max(1, Math.floor(necroMaxHp * HP_FRAC_OF_NECRO[type]));
            const mp = Math.max(0, Math.floor(necroMaxMp * MP_FRAC_OF_NECRO[type]));
            next.push({
                id: `${necroId}_${type}_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}`,
                type,
                hp,
                maxHp: hp,
                mp,
                maxMp: mp,
                dmgMult: DMG_MULT[type],
            });
        }
        set((s) => ({ summons: { ...s.summons, [necroId]: next } }));
        return toSpawn;
    },

    healAllPct: (necroId, pct) => {
        const cur = get().summons[necroId] ?? [];
        if (cur.length === 0 || pct <= 0) return;
        const next = cur.map((s) => {
            const heal = Math.max(1, Math.floor(s.maxHp * (pct / 100)));
            return { ...s, hp: Math.min(s.maxHp, s.hp + heal) };
        });
        set((s) => ({ summons: { ...s.summons, [necroId]: next } }));
    },

    damageFirst: (necroId, dmg) => {
        const cur = get().summons[necroId] ?? [];
        if (cur.length === 0) return { dmgConsumed: 0, queueEmpty: true };
        // 2026-05 v6: damage-soak order is TYPE-prioritised, not
        // chronological — the user's spec "zawsze jako pierwszy
        // dostaje dmg szkielet, potem duch, potem demon, na koncu
        // lisz". Skeletons are cheap meat shields, lich is the big
        // bad we want to keep alive longest. Within the same type
        // the oldest summon dies first (FIFO), so a fresh re-summon
        // doesn't immediately tank the next hit.
        const TYPE_ORDER: Record<NecroSummonType, number> = {
            skeleton: 0, ghost: 1, demon: 2, lich: 3,
        };
        let frontIdx = 0;
        let bestRank = TYPE_ORDER[cur[0].type];
        for (let i = 1; i < cur.length; i++) {
            const r = TYPE_ORDER[cur[i].type];
            if (r < bestRank) {
                bestRank = r;
                frontIdx = i;
            }
        }
        const next = [...cur];
        const front = { ...next[frontIdx] };
        const consumed = Math.min(front.hp, dmg);
        front.hp -= consumed;
        if (front.hp <= 0) {
            next.splice(frontIdx, 1);
        } else {
            next[frontIdx] = front;
        }
        set((s) => ({ summons: { ...s.summons, [necroId]: next } }));
        return { dmgConsumed: consumed, queueEmpty: next.length === 0 };
    },

    damageAll: (necroId, dmg) => {
        const cur = get().summons[necroId] ?? [];
        if (cur.length === 0) return;
        const next = cur
            .map((s) => ({ ...s, hp: Math.max(0, s.hp - dmg) }))
            .filter((s) => s.hp > 0);
        set((s) => ({ summons: { ...s.summons, [necroId]: next } }));
    },

    count: (necroId) => (get().summons[necroId] ?? []).length,

    totalAttackBonus: (necroId, necroAttack) => {
        const cur = get().summons[necroId] ?? [];
        return cur.reduce((sum, s) => sum + Math.floor(necroAttack * s.dmgMult), 0);
    },

    clear: (necroId) => set((s) => {
        const next = { ...s.summons };
        delete next[necroId];
        return { summons: next };
    }),

    clearAll: () => set({ summons: {} }),

    despawnOne: (necroId, type) => {
        const cur = get().summons[necroId] ?? [];
        // Find the oldest summon of the requested type (FIFO = head of queue).
        const idx = cur.findIndex((sm) => sm.type === type);
        if (idx === -1) return false;
        const next = [...cur];
        next.splice(idx, 1);
        set((s) => ({ summons: { ...s.summons, [necroId]: next } }));
        return true;
    },
}));
