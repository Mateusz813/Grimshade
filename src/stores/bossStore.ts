import { create } from 'zustand';
import type { IBossResult } from '../systems/bossSystem';

interface IDailyAttempts {
  used: number;
  date: string; // YYYY-MM-DD
}

interface IBossStore {
  dailyAttempts: Record<string, IDailyAttempts>;
  lastResult: IBossResult | null;

  setBossDefeated: (bossId: string) => void;
  setLastResult: (result: IBossResult | null) => void;
  getAttemptsUsed: (bossId: string) => number;
  getAttemptsMax: () => number;
  canChallenge: (bossId: string) => boolean;
}

const getTodayStr = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const MAX_DAILY_ATTEMPTS = 3;

export const useBossStore = create<IBossStore>()(
    (set, get) => ({
      dailyAttempts: {},
      lastResult: null,

      setBossDefeated: (bossId) =>
        set((s) => {
          const today = getTodayStr();
          const current = s.dailyAttempts[bossId];
          const isToday = current?.date === today;
          return {
            dailyAttempts: {
              ...s.dailyAttempts,
              [bossId]: {
                used: isToday ? (current?.used ?? 0) + 1 : 1,
                date: today,
              },
            },
          };
        }),

      setLastResult: (lastResult) => set({ lastResult }),

      getAttemptsUsed: (bossId) => {
        const today = getTodayStr();
        const entry = get().dailyAttempts[bossId];
        if (!entry || entry.date !== today) return 0;
        return entry.used;
      },

      getAttemptsMax: () => MAX_DAILY_ATTEMPTS,

      canChallenge: (bossId) => {
        const today = getTodayStr();
        const entry = get().dailyAttempts[bossId];
        if (!entry || entry.date !== today) return true;
        return entry.used < MAX_DAILY_ATTEMPTS;
      },
    }),
);
