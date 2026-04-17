import { create } from 'zustand';

interface IBossKillEntry {
  count: number;
  lastKill: string;
}

interface IBossScoreStore {
  totalScore: number;
  bossKills: Record<string, IBossKillEntry>;
  addBossKill: (bossId: string, bossLevel: number) => void;
  getTotalScore: () => number;
  getBossKillCount: (bossId: string) => number;
}

const calculateScore = (bossLevel: number): number =>
  Math.floor(bossLevel * 10 + (bossLevel / 100) * bossLevel);

export const useBossScoreStore = create<IBossScoreStore>()(
    (set, get) => ({
      totalScore: 0,
      bossKills: {},

      addBossKill: (bossId, bossLevel) =>
        set((s) => {
          const score = calculateScore(bossLevel);
          const existing = s.bossKills[bossId];
          return {
            totalScore: s.totalScore + score,
            bossKills: {
              ...s.bossKills,
              [bossId]: {
                count: (existing?.count ?? 0) + 1,
                lastKill: new Date().toISOString(),
              },
            },
          };
        }),

      getTotalScore: () => get().totalScore,

      getBossKillCount: (bossId) => get().bossKills[bossId]?.count ?? 0,
    }),
);
