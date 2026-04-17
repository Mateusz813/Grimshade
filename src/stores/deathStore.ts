import { create } from 'zustand';

export interface IDeathEvent {
  /** Name of the monster/boss/source that killed the player */
  killedBy: string;
  /** Level of the source */
  sourceLevel: number;
  /** Old level before penalty */
  oldLevel: number;
  /** New level after penalty */
  newLevel: number;
  /** Levels lost */
  levelsLost: number;
  /** XP % preserved */
  xpPercent: number;
  /** Whether death protection was used */
  protectionUsed: boolean;
  /** Source type: 'monster' | 'dungeon' | 'boss' | 'transform' */
  source: string;
}

interface IDeathStore {
  event: IDeathEvent | null;
  triggerDeath: (ev: IDeathEvent) => void;
  clearDeath: () => void;
}

export const useDeathStore = create<IDeathStore>((set) => ({
  event: null,
  triggerDeath: (ev) => set({ event: ev }),
  clearDeath: () => set({ event: null }),
}));
