import { create } from 'zustand';


interface IPartyDamageState {
    damage: Record<string, number>;
    sessionStart: string;

    addDamage: (memberId: string, amount: number) => void;
    setMemberDamage: (memberId: string, total: number) => void;
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
