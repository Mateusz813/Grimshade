import { create } from 'zustand';

interface ICombatHudStore {
    active: boolean;
    setActive: (v: boolean) => void;
    compact: boolean;
    setCompact: (v: boolean) => void;
}

export const useCombatHudStore = create<ICombatHudStore>((set) => ({
    active: false,
    setActive: (v) => set({ active: v }),
    compact: false,
    setCompact: (v) => set({ compact: v }),
}));
