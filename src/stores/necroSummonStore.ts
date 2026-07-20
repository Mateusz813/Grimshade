import { create } from 'zustand';

export type NecroSummonType = 'skeleton' | 'ghost' | 'demon' | 'lich';

export interface INecroSummon {
    id: string;
    type: NecroSummonType;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    dmgMult: number;
}

interface IState {
    summons: Record<string, INecroSummon[]>;
}

interface IActions {
    spawn: (
        necroId: string,
        type: NecroSummonType,
        count: number,
        necroAttack: number,
        necroMaxHp: number,
        necroMaxMp?: number,
    ) => number;
    healAllPct: (necroId: string, pct: number) => void;
    damageFirst: (necroId: string, dmg: number) => { dmgConsumed: number; queueEmpty: boolean };
    damageAll: (necroId: string, dmg: number) => void;
    count: (necroId: string) => number;
    totalAttackBonus: (necroId: string, necroAttack: number) => number;
    clear: (necroId: string) => void;
    clearAll: () => void;
    despawnOne: (necroId: string, type: NecroSummonType) => boolean;
}

const CAPS: Record<NecroSummonType, number> = {
    skeleton: 10,
    ghost:    6,
    demon:    2,
    lich:     2,
};

const DMG_MULT: Record<NecroSummonType, number> = {
    skeleton: 0.10,
    ghost:    0.18,
    demon:    0.35,
    lich:     0.50,
};

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

    spawn: (necroId, type, count, _necroAttack, necroMaxHp, necroMaxMp = 0) => {
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
        const idx = cur.findIndex((sm) => sm.type === type);
        if (idx === -1) return false;
        const next = [...cur];
        next.splice(idx, 1);
        set((s) => ({ summons: { ...s.summons, [necroId]: next } }));
        return true;
    },
}));
