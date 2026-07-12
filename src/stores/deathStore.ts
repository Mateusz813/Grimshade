import { create } from 'zustand';

export type TPenaltyKind = 'death' | 'flee';

export interface IDeathEvent {
  kind?: TPenaltyKind;
  killedBy: string;
  sourceLevel: number;
  oldLevel: number;
  newLevel: number;
  levelsLost: number;
  xpPercent: number;
  skillXpLossPercent?: number;
  protectionUsed: boolean;
  source: string;
}

interface IDeathStore {
  event: IDeathEvent | null;
  triggerDeath: (ev: IDeathEvent) => void;
  clearDeath: () => void;
}

export const useDeathStore = create<IDeathStore>((set) => ({
  event: null,
  triggerDeath: (ev) => set({ event: { kind: 'death', ...ev } }),
  clearDeath: () => set({ event: null }),
}));
