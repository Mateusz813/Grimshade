import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { todayIso, getRaidById } from '../systems/raidSystem';
import type { IRaidAttemptRecord } from '../types/raid';

interface IRaidStore {
    /** Per-raid attempts used today. Rolls over automatically when the day changes. */
    attempts: IRaidAttemptRecord;
    /** Raid the player is currently engaged in (null = lobby). */
    activeRaidId: string | null;
    setActiveRaid: (id: string | null) => void;
    /** How many attempts remain today for a given raid id. */
    attemptsRemaining: (raidId: string) => number;
    /** Consume one attempt for today. Returns false if no attempts left. */
    consumeAttempt: (raidId: string) => boolean;
    /** 2026-05-15 v11 spec ("Jezeli ucieklem z raidu a moi soujusznicy
     *  i tak go zrobili to nie zabieraj mi limitow robienia go"):
     *  decrement today's count for this raid by one, never going
     *  below zero. Called from Raid.tsx's flee handler so a leader
     *  who escapes (whether or not the rest of the party clears the
     *  raid afterwards) doesn't lose a daily attempt. */
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
