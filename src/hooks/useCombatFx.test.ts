import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCombatFx } from './useCombatFx';

/**
 * useCombatFx — pure local hook with per-slot float / skill / summon
 * state and timeout-based cleanup. We test the public surface end-to-end
 * with fake timers so the auto-expiry of floats and skill anims is
 * deterministic.
 *
 * Note: `triggerEnemySkillAnim` / `triggerAllySkillAnim` resolve the
 * animation through `getSkillAnimation`. Unknown skill IDs return
 * undefined → the hook silently no-ops, so we use real skill IDs
 * (e.g. `fireball`) for those tests.
 */

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useCombatFx — floats', () => {
    it('initial state has empty maps', () => {
        const { result } = renderHook(() => useCombatFx());
        expect(result.current.enemyFloats).toEqual({});
        expect(result.current.allyFloats).toEqual({});
    });

    it('pushEnemyFloat appends a float on the requested slot', () => {
        const { result } = renderHook(() => useCombatFx());
        act(() => {
            result.current.pushEnemyFloat(0, 42, 'basic');
        });
        expect(result.current.enemyFloats[0]).toHaveLength(1);
        expect(result.current.enemyFloats[0][0].value).toBe(42);
        expect(result.current.enemyFloats[0][0].kind).toBe('basic');
    });

    it('multiple floats accumulate on the same slot', () => {
        const { result } = renderHook(() => useCombatFx());
        act(() => {
            result.current.pushEnemyFloat(0, 10, 'basic');
            result.current.pushEnemyFloat(0, 20, 'spell', { isCrit: true });
            result.current.pushEnemyFloat(0, 30, 'basic');
        });
        expect(result.current.enemyFloats[0]).toHaveLength(3);
        expect(result.current.enemyFloats[0][1].isCrit).toBe(true);
    });

    it('floats land on independent slots without interfering', () => {
        const { result } = renderHook(() => useCombatFx());
        act(() => {
            result.current.pushEnemyFloat(0, 10, 'basic');
            result.current.pushEnemyFloat(2, 20, 'basic');
        });
        expect(result.current.enemyFloats[0]).toHaveLength(1);
        expect(result.current.enemyFloats[2]).toHaveLength(1);
        expect(result.current.enemyFloats[1]).toBeUndefined();
    });

    it('floats auto-expire after 1500ms', () => {
        const { result } = renderHook(() => useCombatFx());
        act(() => {
            result.current.pushEnemyFloat(0, 5, 'basic');
        });
        expect(result.current.enemyFloats[0]).toHaveLength(1);
        act(() => {
            vi.advanceTimersByTime(1600);
        });
        expect(result.current.enemyFloats[0] ?? []).toHaveLength(0);
    });

    it('pushAllyFloat behaves identically on ally side', () => {
        const { result } = renderHook(() => useCombatFx());
        act(() => {
            result.current.pushAllyFloat(1, 99, 'monster');
        });
        expect(result.current.allyFloats[1]).toHaveLength(1);
        expect(result.current.allyFloats[1][0].kind).toBe('monster');
        act(() => {
            vi.advanceTimersByTime(1600);
        });
        expect(result.current.allyFloats[1] ?? []).toHaveLength(0);
    });

    it('records label override (for stun / paralyze etc.)', () => {
        const { result } = renderHook(() => useCombatFx());
        act(() => {
            result.current.pushEnemyFloat(0, 0, 'spell', { label: 'STUN' });
        });
        expect(result.current.enemyFloats[0][0].label).toBe('STUN');
    });
});

describe('useCombatFx — skill anims', () => {
    it('triggerEnemySkillAnim sets state for a known skill', () => {
        const { result } = renderHook(() => useCombatFx());
        act(() => {
            result.current.triggerEnemySkillAnim(0, 'fireball');
        });
        expect(result.current.enemySkill[0]).toBeDefined();
        expect(result.current.enemySkill[0].cssClass).toMatch(/skill-anim--fire/);
    });

    it('silently no-ops for unknown skill IDs', () => {
        const { result } = renderHook(() => useCombatFx());
        act(() => {
            result.current.triggerEnemySkillAnim(0, 'definitely_not_a_real_skill');
        });
        expect(result.current.enemySkill[0]).toBeUndefined();
    });

    it('triggerAllySkillAnim mirrors the enemy path on the ally state', () => {
        const { result } = renderHook(() => useCombatFx());
        act(() => {
            result.current.triggerAllySkillAnim(1, 'ice_lance');
        });
        expect(result.current.allySkill[1]).toBeDefined();
        expect(result.current.allySkill[1].cssClass).toMatch(/skill-anim--ice/);
    });

    it('expires the anim entry after the configured duration', () => {
        const { result } = renderHook(() => useCombatFx());
        act(() => {
            result.current.triggerEnemySkillAnim(0, 'fireball'); // 900ms
        });
        expect(result.current.enemySkill[0]).toBeDefined();
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        // After expiry, slot is cleared to undefined.
        expect(result.current.enemySkill[0]).toBeUndefined();
    });
});

describe('useCombatFx — summon spawn (necromancer)', () => {
    it('triggers a summon overlay and clears it after 2s', () => {
        const { result } = renderHook(() => useCombatFx());
        act(() => {
            result.current.triggerAllySummonSpawn(2, 'skeleton');
        });
        expect(result.current.allySummonSpawn[2]).toBeDefined();
        expect(result.current.allySummonSpawn[2].type).toBe('skeleton');
        act(() => {
            vi.advanceTimersByTime(2100);
        });
        expect(result.current.allySummonSpawn[2]).toBeUndefined();
    });
});

describe('useCombatFx — reset helpers', () => {
    it('resetFx wipes every per-slot state', () => {
        const { result } = renderHook(() => useCombatFx());
        act(() => {
            result.current.pushEnemyFloat(0, 1, 'basic');
            result.current.pushAllyFloat(1, 2, 'monster');
            result.current.triggerEnemySkillAnim(0, 'fireball');
            result.current.triggerAllySkillAnim(1, 'ice_lance');
            result.current.triggerAllySummonSpawn(2, 'ghost');
        });
        act(() => {
            result.current.resetFx();
        });
        expect(result.current.enemyFloats).toEqual({});
        expect(result.current.allyFloats).toEqual({});
        expect(result.current.enemySkill).toEqual({});
        expect(result.current.allySkill).toEqual({});
        expect(result.current.allySummonSpawn).toEqual({});
    });

    it('resetAllyFx clears only ally-side state, leaves enemy state intact', () => {
        const { result } = renderHook(() => useCombatFx());
        act(() => {
            result.current.pushEnemyFloat(0, 1, 'basic');
            result.current.pushAllyFloat(1, 2, 'monster');
            result.current.triggerAllySkillAnim(1, 'ice_lance');
            result.current.triggerAllySummonSpawn(0, 'demon');
        });
        act(() => {
            result.current.resetAllyFx();
        });
        // Enemy untouched
        expect(result.current.enemyFloats[0]).toHaveLength(1);
        // Ally-side cleared
        expect(result.current.allyFloats).toEqual({});
        expect(result.current.allySkill).toEqual({});
        expect(result.current.allySummonSpawn).toEqual({});
    });
});
