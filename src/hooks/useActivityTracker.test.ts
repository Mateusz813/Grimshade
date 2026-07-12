import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useActivityTracker } from './useActivityTracker';
import { useSkillStore } from '../stores/skillStore';


const SKILL_INITIAL_STATE = {
    skillLevels: {},
    skillXp: {},
    activeSkillSlots: [null, null, null, null] as [
        string | null, string | null, string | null, string | null,
    ],
    skillUpgradeLevels: {},
    unlockedSkills: {},
    offlineTrainingSkillId: null,
    trainingSegmentStartedAt: null,
    trainingAccumulatedEffectiveSeconds: 0,
    trainingCurrentSpeedMultiplier: 2,
};

let onActivityChangeSpy: ReturnType<typeof vi.fn>;
let collectOfflineTrainingSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.useFakeTimers();
    onActivityChangeSpy = vi.fn();
    collectOfflineTrainingSpy = vi.fn();
    useSkillStore.setState({
        ...SKILL_INITIAL_STATE,
        onActivityChange: onActivityChangeSpy,
        collectOfflineTraining: collectOfflineTrainingSpy,
    } as unknown as ReturnType<typeof useSkillStore.getState>);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('useActivityTracker', () => {
    it('flips training to active (2x) on mount', () => {
        renderHook(() => useActivityTracker());
        expect(onActivityChangeSpy).toHaveBeenCalledWith(true);
    });

    it('marks training inactive (1x) after 10 minutes of no activity', () => {
        renderHook(() => useActivityTracker());
        onActivityChangeSpy.mockClear();
        act(() => {
            vi.advanceTimersByTime(10 * 60 * 1000 + 100);
        });
        expect(onActivityChangeSpy).toHaveBeenCalledWith(false);
    });

    it('does NOT spam onActivityChange on every mousemove when already at 2x', () => {
        renderHook(() => useActivityTracker());
        onActivityChangeSpy.mockClear();
        act(() => {
            window.dispatchEvent(new Event('mousemove'));
            window.dispatchEvent(new Event('mousemove'));
            window.dispatchEvent(new Event('mousemove'));
        });
        expect(onActivityChangeSpy).not.toHaveBeenCalled();
    });

    it('re-asserts 2x on activity when current multiplier is 1', () => {
        useSkillStore.setState({ trainingCurrentSpeedMultiplier: 1 });
        renderHook(() => useActivityTracker());
        onActivityChangeSpy.mockClear();
        act(() => {
            window.dispatchEvent(new Event('mousedown'));
        });
        expect(onActivityChangeSpy).toHaveBeenCalledWith(true);
    });

    it('calls collectOfflineTraining every 30s when training is active', () => {
        useSkillStore.setState({
            offlineTrainingSkillId: 'sword_fighting',
            trainingSegmentStartedAt: new Date().toISOString(),
        });
        renderHook(() => useActivityTracker());
        act(() => {
            vi.advanceTimersByTime(30_000);
        });
        expect(collectOfflineTrainingSpy).toHaveBeenCalledTimes(1);
        act(() => {
            vi.advanceTimersByTime(30_000);
        });
        expect(collectOfflineTrainingSpy).toHaveBeenCalledTimes(2);
    });

    it('does NOT collect XP when no skill is being trained', () => {
        renderHook(() => useActivityTracker());
        act(() => {
            vi.advanceTimersByTime(30_000 * 3);
        });
        expect(collectOfflineTrainingSpy).not.toHaveBeenCalled();
    });

    it('flips to 1x on visibility hidden', () => {
        renderHook(() => useActivityTracker());
        onActivityChangeSpy.mockClear();
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'hidden',
        });
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(onActivityChangeSpy).toHaveBeenLastCalledWith(false);
    });

    it('flips back to 2x on visibility visible', () => {
        renderHook(() => useActivityTracker());
        onActivityChangeSpy.mockClear();
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'visible',
        });
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(onActivityChangeSpy).toHaveBeenLastCalledWith(true);
    });

    it('flushes 1x on beforeunload (user leaving)', () => {
        renderHook(() => useActivityTracker());
        onActivityChangeSpy.mockClear();
        act(() => {
            window.dispatchEvent(new Event('beforeunload'));
        });
        expect(onActivityChangeSpy).toHaveBeenLastCalledWith(false);
    });

    it('removes listeners on unmount (no calls after unmount)', () => {
        const { unmount } = renderHook(() => useActivityTracker());
        unmount();
        onActivityChangeSpy.mockClear();
        collectOfflineTrainingSpy.mockClear();
        act(() => {
            window.dispatchEvent(new Event('mousedown'));
            window.dispatchEvent(new Event('beforeunload'));
            document.dispatchEvent(new Event('visibilitychange'));
            vi.advanceTimersByTime(60_000);
        });
        expect(onActivityChangeSpy).not.toHaveBeenCalled();
        expect(collectOfflineTrainingSpy).not.toHaveBeenCalled();
    });

    it('inactivity timer is reset whenever activity is detected', () => {
        renderHook(() => useActivityTracker());
        onActivityChangeSpy.mockClear();
        act(() => {
            vi.advanceTimersByTime(9 * 60 * 1000);
            useSkillStore.setState({ trainingCurrentSpeedMultiplier: 1 });
            window.dispatchEvent(new Event('keydown'));
        });
        onActivityChangeSpy.mockClear();
        act(() => {
            vi.advanceTimersByTime(5 * 60 * 1000);
        });
        const calledFalse = onActivityChangeSpy.mock.calls.some((c) => c[0] === false);
        expect(calledFalse).toBe(false);
    });
});
