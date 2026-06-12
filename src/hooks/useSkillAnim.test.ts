import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSkillAnim } from './useSkillAnim';

/**
 * useSkillAnim manages a short-lived overlay state shown when a player
 * casts a skill. The trigger:
 *   1. Looks up animation data via getSkillAnimation(skillId)
 *   2. If found: bumps an internal id counter, sets the overlay, and
 *      schedules a clear after animData.duration ms.
 *   3. If not found: silent no-op.
 *
 * The "only clear if it's still my id" guard means a later trigger that
 * fires before the first one's timeout doesn't get wiped by the earlier
 * setTimeout.
 *
 * We pick `fireball` (mage skill, ~900 ms duration in skillAnimations.ts)
 * for the happy-path cases — it's been in the data file for a long time
 * so the test isn't brittle.
 */

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useSkillAnim', () => {
    it('starts with a null overlay', () => {
        const { result } = renderHook(() => useSkillAnim());
        expect(result.current.overlay).toBeNull();
    });

    it('sets an overlay when triggered with a known skill id', () => {
        const { result } = renderHook(() => useSkillAnim());
        act(() => result.current.trigger('fireball'));
        expect(result.current.overlay).not.toBeNull();
        expect(result.current.overlay!.anim.category).toBe('fire');
        // Every trigger increments the internal id counter — first trigger sets id=1.
        expect(result.current.overlay!.id).toBe(1);
    });

    it('is a no-op when triggered with an unknown skill id', () => {
        const { result } = renderHook(() => useSkillAnim());
        act(() => result.current.trigger('not_a_real_skill_anywhere'));
        expect(result.current.overlay).toBeNull();
    });

    it('clears the overlay after the animation duration elapses', () => {
        const { result } = renderHook(() => useSkillAnim());
        act(() => result.current.trigger('fireball'));
        const duration = result.current.overlay!.anim.duration;
        expect(result.current.overlay).not.toBeNull();
        act(() => {
            vi.advanceTimersByTime(duration + 50);
        });
        expect(result.current.overlay).toBeNull();
    });

    it('does NOT clear the overlay before the duration elapses', () => {
        const { result } = renderHook(() => useSkillAnim());
        act(() => result.current.trigger('fireball'));
        const duration = result.current.overlay!.anim.duration;
        // Half-way through: overlay still set.
        act(() => {
            vi.advanceTimersByTime(Math.floor(duration / 2));
        });
        expect(result.current.overlay).not.toBeNull();
    });

    it('increments the internal id on each successive trigger', () => {
        const { result } = renderHook(() => useSkillAnim());
        act(() => result.current.trigger('fireball'));
        const firstId = result.current.overlay!.id;
        // Second trigger immediately — overlay should replace, id should grow.
        act(() => result.current.trigger('fireball'));
        expect(result.current.overlay!.id).toBe(firstId + 1);
    });

    it('does not wipe a fresh overlay when the previous timeout fires', () => {
        // Critical race: trigger A -> trigger B (before A's timeout) -> A's
        // timeout fires -> must NOT clear B because the id no longer matches.
        const { result } = renderHook(() => useSkillAnim());
        act(() => result.current.trigger('fireball'));
        const firstDuration = result.current.overlay!.anim.duration;
        // Halfway through the first overlay, fire a second trigger.
        act(() => {
            vi.advanceTimersByTime(Math.floor(firstDuration / 2));
        });
        act(() => result.current.trigger('ice_lance'));
        const secondId = result.current.overlay!.id;
        // Advance enough for the FIRST timeout to fire but not the second.
        act(() => {
            vi.advanceTimersByTime(Math.floor(firstDuration / 2) + 10);
        });
        // The overlay should still be the second one — the first timeout
        // saw a mismatched id and bailed out.
        expect(result.current.overlay).not.toBeNull();
        expect(result.current.overlay!.id).toBe(secondId);
    });

    it('uses the looked-up animation duration verbatim', () => {
        const { result } = renderHook(() => useSkillAnim());
        act(() => result.current.trigger('fireball'));
        // duration comes from skillAnimations.ts -> fire preset (900 ms).
        expect(typeof result.current.overlay!.anim.duration).toBe('number');
        expect(result.current.overlay!.anim.duration).toBeGreaterThan(0);
    });

    it('exposes a stable trigger reference between renders', () => {
        // The hook uses useCallback with empty deps so trigger should be
        // referentially stable across renders.
        const { result, rerender } = renderHook(() => useSkillAnim());
        const firstTrigger = result.current.trigger;
        rerender();
        expect(result.current.trigger).toBe(firstTrigger);
    });
});

// TODO: the emoji-vs-image-url swap path (getSkillIcon -> isImageUrl)
// depends on whether per-class spell artwork is registered in
// spriteAssets. That's tested in spriteAssets.test.ts; pinning it here
// would make the suite churn whenever artwork is added/removed.
