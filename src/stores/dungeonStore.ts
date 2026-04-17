import { create } from 'zustand';
import type { IDungeonResult } from '../systems/dungeonSystem';

interface IDailyAttempts {
  used: number;
  date: string; // YYYY-MM-DD
}

interface IDungeonStore {
  dailyAttempts: Record<string, IDailyAttempts>;
  lastResult: IDungeonResult | null;

  setDungeonCompleted: (dungeonId: string) => void;
  setLastResult: (result: IDungeonResult | null) => void;
  getAttemptsUsed: (dungeonId: string) => number;
  getAttemptsMax: () => number;
  canEnter: (dungeonId: string) => boolean;
}

const getTodayStr = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const MAX_DAILY_ATTEMPTS = 5;

export const useDungeonStore = create<IDungeonStore>()(
    (set, get) => ({
      dailyAttempts: {},
      lastResult: null,

      setDungeonCompleted: (dungeonId) =>
        set((s) => {
          const today = getTodayStr();
          const current = s.dailyAttempts[dungeonId];
          const isToday = current?.date === today;
          return {
            dailyAttempts: {
              ...s.dailyAttempts,
              [dungeonId]: {
                used: isToday ? (current?.used ?? 0) + 1 : 1,
                date: today,
              },
            },
          };
        }),

      setLastResult: (lastResult) => set({ lastResult }),

      getAttemptsUsed: (dungeonId) => {
        const today = getTodayStr();
        const entry = get().dailyAttempts[dungeonId];
        if (!entry || entry.date !== today) return 0;
        return entry.used;
      },

      getAttemptsMax: () => MAX_DAILY_ATTEMPTS,

      canEnter: (dungeonId) => {
        const today = getTodayStr();
        const entry = get().dailyAttempts[dungeonId];
        if (!entry || entry.date !== today) return true;
        return entry.used < MAX_DAILY_ATTEMPTS;
      },
    }),
);
