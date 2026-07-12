import { create } from 'zustand';
import type { IMonster } from '../types/monster';
import { useCombatStore } from './combatStore';
import { useSkillStore } from './skillStore';


export const OFFLINE_HUNT_BASE_SECONDS_PER_KILL = 10;

export const OFFLINE_HUNT_MAX_SECONDS = 12 * 60 * 60;

export interface IOfflineHuntState {
    isActive: boolean;
    startedAt: string | null;
    targetMonster: IMonster | null;
    trainedSkillId: string | null;
}

interface IOfflineHuntStore extends IOfflineHuntState {
    startHunt: (monster: IMonster, skillId: string) => void;
    stopHunt: () => void;
    resetHunt: () => void;
}

export const useOfflineHuntStore = create<IOfflineHuntStore>((set) => ({
    isActive: false,
    startedAt: null,
    targetMonster: null,
    trainedSkillId: null,

    startHunt: (monster, skillId) => {
        useCombatStore.getState().resetCombat();
        useSkillStore.getState().collectOfflineTraining();
        useSkillStore.getState().pauseTraining();
        set({
            isActive: true,
            startedAt: new Date().toISOString(),
            targetMonster: monster,
            trainedSkillId: skillId,
        });
    },

    stopHunt: () => {
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

(globalThis as unknown as { __offlineHuntStore: typeof useOfflineHuntStore }).__offlineHuntStore = useOfflineHuntStore;

export const getOfflineHuntSpeedMultiplier = (masteryLevel: number): number => {
    if (masteryLevel >= 20) return 4;
    if (masteryLevel >= 12) return 3;
    if (masteryLevel >= 5) return 2;
    return 1;
};
