import { describe, it, expect, beforeEach, vi } from 'vitest';


const { resetCombatMock, collectOfflineTrainingMock, pauseTrainingMock, resumeTrainingMock } = vi.hoisted(() => ({
    resetCombatMock: vi.fn(),
    collectOfflineTrainingMock: vi.fn().mockReturnValue(0),
    pauseTrainingMock: vi.fn(),
    resumeTrainingMock: vi.fn(),
}));

vi.mock('./combatStore', () => ({
    useCombatStore: {
        getState: () => ({ resetCombat: resetCombatMock }),
    },
}));

vi.mock('./skillStore', () => ({
    useSkillStore: {
        getState: () => ({
            collectOfflineTraining: collectOfflineTrainingMock,
            pauseTraining: pauseTrainingMock,
            resumeTraining: resumeTrainingMock,
        }),
    },
}));

import {
    useOfflineHuntStore,
    getOfflineHuntSpeedMultiplier,
    OFFLINE_HUNT_BASE_SECONDS_PER_KILL,
    OFFLINE_HUNT_MAX_SECONDS,
} from './offlineHuntStore';
import type { IMonster } from '../types/monster';

const makeMonster = (overrides?: Partial<IMonster>): IMonster => ({
    id: 'rat',
    name_pl: 'Szczur',
    name_en: 'Rat',
    level: 1,
    sprite: 'rat',
    hp: 27,
    attack: 4,
    defense: 1,
    speed: 2,
    xpReward: 17,
    goldMin: 1,
    goldMax: 3,
    icon: 'rat',
    drops: [],
    ...overrides,
} as unknown as IMonster);

beforeEach(() => {
    useOfflineHuntStore.setState({
        isActive: false,
        startedAt: null,
        targetMonster: null,
        trainedSkillId: null,
    });
    resetCombatMock.mockClear();
    collectOfflineTrainingMock.mockClear();
    pauseTrainingMock.mockClear();
    resumeTrainingMock.mockClear();
});


describe('startHunt', () => {
    it('sets isActive=true, records target + skill + a fresh ISO startedAt', () => {
        const monster = makeMonster();
        useOfflineHuntStore.getState().startHunt(monster, 'sword_fighting');
        const state = useOfflineHuntStore.getState();
        expect(state.isActive).toBe(true);
        expect(state.targetMonster).toBe(monster);
        expect(state.trainedSkillId).toBe('sword_fighting');
        expect(state.startedAt).not.toBeNull();
        expect(Number.isNaN(new Date(state.startedAt as string).getTime())).toBe(false);
    });

    it('flushes active training + pauses + resets background combat before flipping the flag', () => {
        useOfflineHuntStore.getState().startHunt(makeMonster(), 'magic_level');
        expect(resetCombatMock).toHaveBeenCalledTimes(1);
        expect(collectOfflineTrainingMock).toHaveBeenCalledTimes(1);
        expect(pauseTrainingMock).toHaveBeenCalledTimes(1);
        expect(resumeTrainingMock).not.toHaveBeenCalled();
    });

    it('overwrites any previous hunt — calling startHunt twice keeps only the latest target', () => {
        const first = makeMonster({ id: 'rat' });
        const second = makeMonster({ id: 'goblin' });
        useOfflineHuntStore.getState().startHunt(first, 'sword_fighting');
        useOfflineHuntStore.getState().startHunt(second, 'magic_level');
        const state = useOfflineHuntStore.getState();
        expect(state.targetMonster).toBe(second);
        expect(state.trainedSkillId).toBe('magic_level');
    });
});


describe('stopHunt', () => {
    it('clears every hunt field and resumes active training', () => {
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date().toISOString(),
            targetMonster: makeMonster(),
            trainedSkillId: 'sword_fighting',
        });
        useOfflineHuntStore.getState().stopHunt();
        const state = useOfflineHuntStore.getState();
        expect(state.isActive).toBe(false);
        expect(state.startedAt).toBeNull();
        expect(state.targetMonster).toBeNull();
        expect(state.trainedSkillId).toBeNull();
        expect(resumeTrainingMock).toHaveBeenCalledTimes(1);
    });

    it('is safe to call when no hunt is active — still resumes training, still clears', () => {
        expect(() => useOfflineHuntStore.getState().stopHunt()).not.toThrow();
        expect(resumeTrainingMock).toHaveBeenCalledTimes(1);
        const state = useOfflineHuntStore.getState();
        expect(state.isActive).toBe(false);
        expect(state.targetMonster).toBeNull();
    });
});


describe('resetHunt', () => {
    it('wipes the hunt without resuming training (character-switch path)', () => {
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date().toISOString(),
            targetMonster: makeMonster(),
            trainedSkillId: 'sword_fighting',
        });
        useOfflineHuntStore.getState().resetHunt();
        const state = useOfflineHuntStore.getState();
        expect(state.isActive).toBe(false);
        expect(state.startedAt).toBeNull();
        expect(state.targetMonster).toBeNull();
        expect(state.trainedSkillId).toBeNull();
        expect(resumeTrainingMock).not.toHaveBeenCalled();
    });
});


describe('module side effects', () => {
    it('registers itself on globalThis as __offlineHuntStore (skillStore probe path)', () => {
        const reg = (globalThis as unknown as { __offlineHuntStore?: unknown }).__offlineHuntStore;
        expect(reg).toBe(useOfflineHuntStore);
    });
});


describe('getOfflineHuntSpeedMultiplier', () => {
    it('returns x1 for mastery levels below 5', () => {
        expect(getOfflineHuntSpeedMultiplier(0)).toBe(1);
        expect(getOfflineHuntSpeedMultiplier(4)).toBe(1);
    });

    it('returns x2 for mastery 5-11', () => {
        expect(getOfflineHuntSpeedMultiplier(5)).toBe(2);
        expect(getOfflineHuntSpeedMultiplier(11)).toBe(2);
    });

    it('returns x3 for mastery 12-19', () => {
        expect(getOfflineHuntSpeedMultiplier(12)).toBe(3);
        expect(getOfflineHuntSpeedMultiplier(19)).toBe(3);
    });

    it('returns x4 at mastery 20+', () => {
        expect(getOfflineHuntSpeedMultiplier(20)).toBe(4);
        expect(getOfflineHuntSpeedMultiplier(25)).toBe(4);
        expect(getOfflineHuntSpeedMultiplier(999)).toBe(4);
    });
});


describe('constants', () => {
    it('base rate is 10 seconds per kill', () => {
        expect(OFFLINE_HUNT_BASE_SECONDS_PER_KILL).toBe(10);
    });

    it('max hunt duration is 12 hours (in seconds)', () => {
        expect(OFFLINE_HUNT_MAX_SECONDS).toBe(12 * 60 * 60);
    });
});
