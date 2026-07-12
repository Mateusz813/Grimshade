import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSkillAnim } from './useSkillAnim';


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
        act(() => {
            vi.advanceTimersByTime(Math.floor(duration / 2));
        });
        expect(result.current.overlay).not.toBeNull();
    });

    it('increments the internal id on each successive trigger', () => {
        const { result } = renderHook(() => useSkillAnim());
        act(() => result.current.trigger('fireball'));
        const firstId = result.current.overlay!.id;
        act(() => result.current.trigger('fireball'));
        expect(result.current.overlay!.id).toBe(firstId + 1);
    });

    it('does not wipe a fresh overlay when the previous timeout fires', () => {
        const { result } = renderHook(() => useSkillAnim());
        act(() => result.current.trigger('fireball'));
        const firstDuration = result.current.overlay!.anim.duration;
        act(() => {
            vi.advanceTimersByTime(Math.floor(firstDuration / 2));
        });
        act(() => result.current.trigger('ice_lance'));
        const secondId = result.current.overlay!.id;
        act(() => {
            vi.advanceTimersByTime(Math.floor(firstDuration / 2) + 10);
        });
        expect(result.current.overlay).not.toBeNull();
        expect(result.current.overlay!.id).toBe(secondId);
    });

    it('uses the looked-up animation duration verbatim', () => {
        const { result } = renderHook(() => useSkillAnim());
        act(() => result.current.trigger('fireball'));
        expect(typeof result.current.overlay!.anim.duration).toBe('number');
        expect(result.current.overlay!.anim.duration).toBeGreaterThan(0);
    });

    it('exposes a stable trigger reference between renders', () => {
        const { result, rerender } = renderHook(() => useSkillAnim());
        const firstTrigger = result.current.trigger;
        rerender();
        expect(result.current.trigger).toBe(firstTrigger);
    });
});

