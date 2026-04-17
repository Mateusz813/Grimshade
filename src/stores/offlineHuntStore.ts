import { create } from 'zustand';
import type { IMonster } from '../types/monster';
import { useCombatStore } from './combatStore';
import { useSkillStore } from './skillStore';

/**
 * Offline Hunt – passive kill accumulation while player is away or busy.
 *
 * Model:
 *  - Player picks a trainable skill + target monster → hunt starts.
 *  - Base rate: 1 kill per 5 seconds. Mastery level of that monster
 *    accelerates the rate (x1 → x2 → x3 → x4). Max mastery = x4.
 *  - Timestamp-based: `startedAt` ISO string captured on start. On claim
 *    we compute `elapsedMs = now - startedAt`, cap at 12h, derive kills,
 *    and apply rewards in bulk.
 *  - Claim stops the hunt. A new hunt can then be started.
 *
 * All reward logic (XP, gold, skill XP, mastery, task/quest progress)
 * runs in `offlineHuntSystem.claimOfflineHunt()`; this store only holds
 * the lightweight state and actions.
 */

/** Base rate: 1 kill every 10 seconds. */
export const OFFLINE_HUNT_BASE_SECONDS_PER_KILL = 10;

/** Max hunt duration in seconds (12 hours). */
export const OFFLINE_HUNT_MAX_SECONDS = 12 * 60 * 60;

export interface IOfflineHuntState {
    /** Whether a hunt is currently running. */
    isActive: boolean;
    /** ISO timestamp of when the hunt started. */
    startedAt: string | null;
    /** Snapshot of the target monster (so reference data doesn't drift). */
    targetMonster: IMonster | null;
    /** Skill being trained during the hunt (weapon skill / MLvl / general stat). */
    trainedSkillId: string | null;
}

interface IOfflineHuntStore extends IOfflineHuntState {
    /** Start a new hunt. Overwrites any active hunt. */
    startHunt: (monster: IMonster, skillId: string) => void;
    /** Stop the hunt without claiming rewards (soft cancel). */
    stopHunt: () => void;
    /** Reset all hunt state (used on character switch or full reset). */
    resetHunt: () => void;
}

export const useOfflineHuntStore = create<IOfflineHuntStore>((set) => ({
    isActive: false,
    startedAt: null,
    targetMonster: null,
    trainedSkillId: null,

    startHunt: (monster, skillId) => {
        // Mutual exclusion: stop any background combat and flush any
        // accumulated active-training XP so the player gets credit for
        // training done BEFORE the hunt, then zero the timer. Offline hunt
        // is the ONLY active system while running.
        useCombatStore.getState().resetCombat();
        // Flush pending active-training XP (adds to skill, resets counters)
        useSkillStore.getState().collectOfflineTraining();
        // Pause: no new segment will accrue while hunt runs
        useSkillStore.getState().pauseTraining();
        set({
            isActive: true,
            startedAt: new Date().toISOString(),
            targetMonster: monster,
            trainedSkillId: skillId,
        });
    },

    stopHunt: () => {
        // Resume active training if a training skill was previously selected
        useSkillStore.getState().resumeTraining();
        set({
            isActive: false,
            startedAt: null,
            targetMonster: null,
            trainedSkillId: null,
        });
    },

    resetHunt: () => set({
        isActive: false,
        startedAt: null,
        targetMonster: null,
        trainedSkillId: null,
    }),
}));

// Register on globalThis so skillStore can probe hunt state without creating
// a circular import (skillStore → offlineHuntStore → skillStore).
(globalThis as unknown as { __offlineHuntStore: typeof useOfflineHuntStore }).__offlineHuntStore = useOfflineHuntStore;

/**
 * Compute kills-per-second multiplier based on mastery level of the target monster.
 *  mastery 0-4   → x1 (1 kill / 10s)
 *  mastery 5-11  → x2 (1 kill / 5s)
 *  mastery 12-19 → x3 (1 kill / ~3.33s)
 *  mastery 20+   → x4 (1 kill / 2.5s)
 */
export const getOfflineHuntSpeedMultiplier = (masteryLevel: number): number => {
    if (masteryLevel >= 20) return 4;
    if (masteryLevel >= 12) return 3;
    if (masteryLevel >= 5) return 2;
    return 1;
};
