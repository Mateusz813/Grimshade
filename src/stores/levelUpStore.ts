import { create } from 'zustand';

export interface ILevelUpEvent {
  newLevel: number;
  levelsGained: number;
  statPointsGained: number;
  /** true when player is in combat/dungeon/boss — show subtle animation */
  inCombat: boolean;
  /** Total gold awarded from milestone level rewards (0 if none crossed). */
  goldGained?: number;
  /** Specific milestone levels that triggered the gold reward (for UI listing). */
  goldMilestoneLevels?: number[];
}

interface ILevelUpStore {
  event: ILevelUpEvent | null;
  triggerLevelUp: (ev: ILevelUpEvent) => void;
  clearLevelUp: () => void;
}

export const useLevelUpStore = create<ILevelUpStore>((set) => ({
  event: null,
  triggerLevelUp: (ev) => set({ event: ev }),
  clearLevelUp: () => set({ event: null }),
}));
