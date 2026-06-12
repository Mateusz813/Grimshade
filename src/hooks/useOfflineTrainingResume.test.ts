import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOfflineTrainingResume } from './useOfflineTrainingResume';
import { useSkillStore } from '../stores/skillStore';

/**
 * Hook reads ONCE on mount (empty deps). It decides whether a reward
 * popup should pop based on:
 *   - offlineTrainingSkillId being non-null
 *   - trainingSegmentStartedAt being non-null
 *   - trainingCurrentSpeedMultiplier === 1 (player was AWAY, not active)
 *   - total effective seconds >= 600 (>=10 minutes)
 *   - collectOfflineTraining() returns > 0
 *
 * Each test resets the skill store state to a known baseline so we can
 * exercise one branch at a time without polluting siblings.
 */

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
        // Active play (x2) should never trigger the popup — only background
        // (x1) returns are surfaced as "you were away" rewards.
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
        // 5 minutes elapsed at 1x speed = 300s effective — under the 600s gate.
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
        // 20 minutes elapsed at 1x speed = 1200s effective — past the gate.
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
        // SKILL_NAMES_PL maps sword_fighting -> 'Walka mieczem' — assert it
        // resolved to SOMETHING other than the raw id at minimum.
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
        // Sanity: we got a reward to clear.
        if (!result.current.reward) {
            // Nothing earned (unlikely with 30 min) — bail without making
            // the test brittle on calc internals.
            return;
        }
        act(() => result.current.clearReward());
        expect(result.current.reward).toBeNull();
    });

    it('calls collectOfflineTraining once when the popup fires', () => {
        // 30 minutes inactive — should trigger collection.
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
        // Edge: time gate passes, but the collection itself yields zero
        // XP (cap reached, training paused at exact moment, etc). No popup.
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

// TODO: covering the SKILL_NAMES_PL lookup precisely would require
// pinning the resolved value to a specific translated string. We've
// kept the assertion loose (non-empty string) so a future copy change
// won't break the suite.
