import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { todayIso, getRaidById } from '../systems/raidSystem';
import type { IRaidAttemptRecord } from '../types/raid';

interface IRaidStore {
    attempts: IRaidAttemptRecord;
    activeRaidId: string | null;
    setActiveRaid: (id: string | null) => void;
    attemptsRemaining: (raidId: string) => number;
    consumeAttempt: (raidId: string) => boolean;
    refundAttempt: (raidId: string) => void;
    resetDay: () => void;
}

export const useRaidStore = create<IRaidStore>()(
    persist(
        (set, get) => ({
            attempts: {},
            activeRaidId: null,
            setActiveRaid: (id) => set({ activeRaidId: id }),

            attemptsRemaining: (raidId) => {
                const raid = getRaidById(raidId);
                if (!raid) return 0;
                const rec = get().attempts[raidId];
                const today = todayIso();
                if (!rec || rec.day !== today) return raid.dailyAttempts;
                return Math.max(0, raid.dailyAttempts - rec.count);
            },

            consumeAttempt: (raidId) => {
                const raid = getRaidById(raidId);
                if (!raid) return false;
                const today = todayIso();
                const cur = get().attempts[raidId];
                const used = !cur || cur.day !== today ? 0 : cur.count;
                if (used >= raid.dailyAttempts) return false;
                set((s) => ({
                    attempts: {
                        ...s.attempts,
                        [raidId]: { day: today, count: used + 1 },
                    },
                }));
                return true;
            },

            refundAttempt: (raidId) => {
                const today = todayIso();
                const cur = get().attempts[raidId];
                if (!cur || cur.day !== today) return;
                const next = Math.max(0, cur.count - 1);
                set((s) => ({
                    attempts: {
                        ...s.attempts,
                        [raidId]: { day: today, count: next },
                    },
                }));
            },

            resetDay: () => set({ attempts: {} }),
        }),
        { name: 'grimshade-raid-store' },
    ),
);
