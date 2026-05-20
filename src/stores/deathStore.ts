import { create } from 'zustand';

/**
 * `death` — full penalty (level loss, big XP loss, skill XP loss).
 * `flee`  — soft penalty (~1/10 of death; no level lost). Used by the
 *           shared "Ucieknij" button in non-hunting combat.
 */
export type TPenaltyKind = 'death' | 'flee';

export interface IDeathEvent {
  /** Discriminator between full death and a soft flee. Defaults to 'death'
   *  for callers that haven't been migrated. */
  kind?: TPenaltyKind;
  /** Name of the monster/boss/source that killed the player (or '—' for flee). */
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
  /** Skill XP % lost — used by the unified penalty overlay. */
  skillXpLossPercent?: number;
  /** Whether death protection was used */
  protectionUsed: boolean;
  /** Source type: 'monster' | 'dungeon' | 'boss' | 'transform' | 'raid' | 'flee' */
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
