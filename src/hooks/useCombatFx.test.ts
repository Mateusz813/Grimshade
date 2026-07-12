import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCombatFx } from './useCombatFx';
import skillsData from '../data/skills.json';


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
            result.current.triggerEnemySkillAnim(0, 'fireball');
        });
        expect(result.current.enemySkill[0]).toBeDefined();
        act(() => {
            vi.advanceTimersByTime(1000);
        });
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
        expect(result.current.enemyFloats[0]).toHaveLength(1);
        expect(result.current.allyFloats).toEqual({});
        expect(result.current.allySkill).toEqual({});
        expect(result.current.allySummonSpawn).toEqual({});
    });
});

const ALL_ACTIVE_SKILL_IDS: string[] = Object.values(
    skillsData.activeSkills as Record<string, Array<{ id: string }>>,
).flat().map((s) => s.id);

describe('useCombatFx — #14 every skill renders on own + ally screen', () => {
    it('there are 105 active skill ids to exercise', () => {
        expect(ALL_ACTIVE_SKILL_IDS.length).toBe(105);
    });

    it('triggerEnemySkillAnim (own screen) sets a non-empty overlay for ALL 105 skills', () => {
        const { result } = renderHook(() => useCombatFx());
        for (const id of ALL_ACTIVE_SKILL_IDS) {
            act(() => {
                result.current.triggerEnemySkillAnim(0, id);
            });
            const s = result.current.enemySkill[0];
            expect(s, `own-screen (enemy slot) overlay missing for skill "${id}"`).toBeDefined();
            expect(s.emoji.length, `own-screen overlay glyph empty for "${id}"`).toBeGreaterThan(0);
            expect(s.cssClass).toMatch(/^skill-anim--/);
        }
    });

    it('triggerAllySkillAnim (ally screen) sets a non-empty overlay for ALL 105 skills', () => {
        const { result } = renderHook(() => useCombatFx());
        for (const id of ALL_ACTIVE_SKILL_IDS) {
            act(() => {
                result.current.triggerAllySkillAnim(1, id);
            });
            const s = result.current.allySkill[1];
            expect(s, `ally-screen (ally slot) overlay missing for skill "${id}"`).toBeDefined();
            expect(s.emoji.length, `ally-screen overlay glyph empty for "${id}"`).toBeGreaterThan(0);
            expect(s.cssClass).toMatch(/^skill-anim--/);
        }
    });
});
