import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOfflineTrainingResume } from './useOfflineTrainingResume';
import { useSkillStore } from '../stores/skillStore';


const INITIAL_SKILL_STATE = {
    skillLevels: {},
    skillXp: {},
    activeSkillSlots: [null, null, null, null] as [null, null, null, null],
    skillUpgradeLevels: {},
    unlockedSkills: {},
    offlineTrainingSkillId: null,
    trainingSegmentStartedAt: null,
    trainingAccumulatedEffectiveSeconds: 0,
    trainingCurrentSpeedMultiplier: 2,
};

beforeEach(() => {
    useSkillStore.setState(INITIAL_SKILL_STATE);
});

describe('useOfflineTrainingResume', () => {
    it('returns null reward when no training skill is selected', () => {
        const { result } = renderHook(() => useOfflineTrainingResume());
        expect(result.current.reward).toBeNull();
    });

    it('returns null reward when training segment was never started', () => {
        useSkillStore.setState({
            ...INITIAL_SKILL_STATE,
            offlineTrainingSkillId: 'sword_fighting',
            trainingSegmentStartedAt: null,
            trainingCurrentSpeedMultiplier: 1,
        });
        const { result } = renderHook(() => useOfflineTrainingResume());
        expect(result.current.reward).toBeNull();
    });

    it('returns null reward when speed multiplier is 2 (player was active)', () => {
        useSkillStore.setState({
            ...INITIAL_SKILL_STATE,
            offlineTrainingSkillId: 'sword_fighting',
            trainingSegmentStartedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            trainingCurrentSpeedMultiplier: 2,
        });
        const { result } = renderHook(() => useOfflineTrainingResume());
        expect(result.current.reward).toBeNull();
    });

    it('returns null reward when total effective time is under 10 minutes', () => {
        useSkillStore.setState({
            ...INITIAL_SKILL_STATE,
            offlineTrainingSkillId: 'sword_fighting',
            trainingSegmentStartedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
            trainingCurrentSpeedMultiplier: 1,
            trainingAccumulatedEffectiveSeconds: 0,
        });
        const { result } = renderHook(() => useOfflineTrainingResume());
        expect(result.current.reward).toBeNull();
    });

    it('shows a reward when player was inactive for 10+ minutes and XP > 0', () => {
        useSkillStore.setState({
            ...INITIAL_SKILL_STATE,
            offlineTrainingSkillId: 'sword_fighting',
            trainingSegmentStartedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
            trainingCurrentSpeedMultiplier: 1,
            trainingAccumulatedEffectiveSeconds: 0,
            skillLevels: { sword_fighting: 0 },
            skillXp: { sword_fighting: 0 },
        });
        const { result } = renderHook(() => useOfflineTrainingResume());
        expect(result.current.reward).not.toBeNull();
        expect(result.current.reward!.earnedXp).toBeGreaterThan(0);
        expect(result.current.reward!.timeElapsed).toBeGreaterThanOrEqual(600);
    });

    it('translates skill id to localized PL name when available', () => {
        useSkillStore.setState({
            ...INITIAL_SKILL_STATE,
            offlineTrainingSkillId: 'sword_fighting',
            trainingSegmentStartedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            trainingCurrentSpeedMultiplier: 1,
            skillLevels: { sword_fighting: 0 },
            skillXp: { sword_fighting: 0 },
        });
        const { result } = renderHook(() => useOfflineTrainingResume());
        expect(result.current.reward).not.toBeNull();
        expect(typeof result.current.reward!.skillName).toBe('string');
        expect(result.current.reward!.skillName.length).toBeGreaterThan(0);
    });

    it('falls back to the raw skill id when no PL translation exists', () => {
        useSkillStore.setState({
            ...INITIAL_SKILL_STATE,
            offlineTrainingSkillId: 'completely_unknown_skill_xyz',
            trainingSegmentStartedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            trainingCurrentSpeedMultiplier: 1,
            skillLevels: { completely_unknown_skill_xyz: 0 },
            skillXp: { completely_unknown_skill_xyz: 0 },
        });
        const { result } = renderHook(() => useOfflineTrainingResume());
        if (result.current.reward) {
            expect(result.current.reward.skillName).toBe('completely_unknown_skill_xyz');
        }
    });

    it('clearReward() resets the reward to null', () => {
        useSkillStore.setState({
            ...INITIAL_SKILL_STATE,
            offlineTrainingSkillId: 'sword_fighting',
            trainingSegmentStartedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            trainingCurrentSpeedMultiplier: 1,
            skillLevels: { sword_fighting: 0 },
            skillXp: { sword_fighting: 0 },
        });
        const { result } = renderHook(() => useOfflineTrainingResume());
        if (!result.current.reward) {
            return;
        }
        act(() => result.current.clearReward());
        expect(result.current.reward).toBeNull();
    });

    it('calls collectOfflineTraining once when the popup fires', () => {
        const collectSpy = vi.fn().mockReturnValue(123);
        useSkillStore.setState({
            ...INITIAL_SKILL_STATE,
            offlineTrainingSkillId: 'sword_fighting',
            trainingSegmentStartedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            trainingCurrentSpeedMultiplier: 1,
            collectOfflineTraining: collectSpy,
        } as Partial<ReturnType<typeof useSkillStore.getState>>);
        const { result } = renderHook(() => useOfflineTrainingResume());
        expect(collectSpy).toHaveBeenCalledTimes(1);
        expect(result.current.reward!.earnedXp).toBe(123);
    });

    it('does NOT pop the reward when collectOfflineTraining returns 0', () => {
        const collectSpy = vi.fn().mockReturnValue(0);
        useSkillStore.setState({
            ...INITIAL_SKILL_STATE,
            offlineTrainingSkillId: 'sword_fighting',
            trainingSegmentStartedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            trainingCurrentSpeedMultiplier: 1,
            collectOfflineTraining: collectSpy,
        } as Partial<ReturnType<typeof useSkillStore.getState>>);
        const { result } = renderHook(() => useOfflineTrainingResume());
        expect(collectSpy).toHaveBeenCalledTimes(1);
        expect(result.current.reward).toBeNull();
    });
});

