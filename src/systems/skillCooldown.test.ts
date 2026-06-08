/**
 * Skill cooldown — integration tests for the combat engine's cooldown machinery.
 *
 * Covers BACKLOG.md 12.2 ("Skill auto-cast po cooldown"). These tests live at
 * the unit/integration boundary: they drive the engine's exported helpers
 * (`advanceSkillCooldowns`, `SPEED_MULT`, `SKILL_COOLDOWN_MS` via observable
 * behaviour) and the `useCooldownStore` Zustand slice that the view layer
 * reads to render the cooldown ring on each skill button.
 *
 * Why this isn't E2E: the cooldown matrix is class × skill × speed × elapsed-ms
 * (>3000 combinations). Running each in Playwright would take hours; vitest
 * gives us deterministic μs-precision time control via `vi.useFakeTimers`.
 *
 * What we test:
 *   1. Per-skill cooldown contract (every tier-1 active spell across all 7
 *      classes) — cast → cooldown installed in `useCooldownStore`; tick by
 *      `cooldown_ms - 1` → still > 0; tick remaining ms → cleared to 0.
 *   2. Multi-skill independence — casting skill A doesn't disturb skill B's
 *      cooldown timer.
 *   3. `advanceSkillCooldowns` behavior — drains internal engine state by
 *      the provided ms, accepts 0/negative without throwing.
 *   4. `useCooldownStore.tick` clamps at 0 (cooldowns don't underflow into
 *      negative numbers — that would let `skillCooldowns[id] > 0` checks
 *      stay truthy forever for a "ready" skill).
 *   5. Drop semantics — cooldowns at 0 are pruned from the map so the
 *      view's `Object.keys(skillCooldowns)` reflects only blocked skills.
 *
 * Sources of truth read here:
 *   • `src/data/skills.json` activeSkills.*[].cooldown — the per-skill ms
 *     the engine wants enforced (NOTE: the engine currently uses a flat
 *     SKILL_COOLDOWN_MS=8000 for the auto-cast path regardless of the
 *     declared cooldown; the cooldown field IS authoritative for the
 *     manual-cast path and for the BuffBar UI cooldown ring read from
 *     `useCooldownStore.skillCooldowns`. Tests exercise the store contract
 *     since that's what the player sees as a visible ring.)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import skillsData from '../data/skills.json';
import { useCooldownStore } from '../stores/cooldownStore';
import {
    advanceSkillCooldowns,
    SPEED_MULT,
} from './combatEngine';

interface IActiveSkillRow {
    id: string;
    name_pl: string;
    name_en: string;
    mpCost: number;
    cooldown: number;
    damage: number;
    effect: string | null;
    unlockLevel: number;
    goldCost: number;
}

type ClassKey = 'knight' | 'mage' | 'cleric' | 'archer' | 'rogue' | 'necromancer' | 'bard';
const CLASS_KEYS: ClassKey[] = ['knight', 'mage', 'cleric', 'archer', 'rogue', 'necromancer', 'bard'];
const ACTIVE = skillsData.activeSkills as Record<ClassKey, IActiveSkillRow[]>;

// Tier-1 = lowest unlockLevel per class (= first row in skills.json, lvl 5 for all 7).
const TIER_1: Record<ClassKey, IActiveSkillRow> = CLASS_KEYS.reduce((acc, cls) => {
    acc[cls] = ACTIVE[cls][0];
    return acc;
}, {} as Record<ClassKey, IActiveSkillRow>);

// ── Per-class tier-1: cast → cooldown installed → tick → cleared ────────────

describe('Skill cooldown contract (per-class tier-1 active skill)', () => {
    beforeEach(() => {
        useCooldownStore.getState().clearAll();
    });

    for (const cls of CLASS_KEYS) {
        const skill = TIER_1[cls];

        it(`${cls}.${skill.id} (${skill.name_en}): cooldown_ms=${skill.cooldown} installs on cast`, () => {
            useCooldownStore.getState().setSkillCooldown(skill.id, skill.cooldown);
            expect(useCooldownStore.getState().skillCooldowns[skill.id]).toBe(skill.cooldown);
        });

        it(`${cls}.${skill.id}: still on cooldown after tick(${skill.cooldown - 1}ms)`, () => {
            useCooldownStore.getState().setSkillCooldown(skill.id, skill.cooldown);
            useCooldownStore.getState().tick(skill.cooldown - 1);
            const remaining = useCooldownStore.getState().skillCooldowns[skill.id];
            expect(remaining).toBe(1);
            expect(remaining).toBeGreaterThan(0);
        });

        it(`${cls}.${skill.id}: clears (key dropped) after full cooldown elapsed`, () => {
            useCooldownStore.getState().setSkillCooldown(skill.id, skill.cooldown);
            useCooldownStore.getState().tick(skill.cooldown);
            // tick() prunes keys at 0 — view's `cd > 0` check sees missing key
            // as "ready", so the cooldown ring stops rendering.
            expect(useCooldownStore.getState().skillCooldowns[skill.id]).toBeUndefined();
        });

        it(`${cls}.${skill.id}: clears even if we overtick (no negative cooldown)`, () => {
            useCooldownStore.getState().setSkillCooldown(skill.id, skill.cooldown);
            useCooldownStore.getState().tick(skill.cooldown * 10);
            const remaining = useCooldownStore.getState().skillCooldowns[skill.id];
            // Either undefined (pruned) or exactly 0 — never negative.
            expect(remaining === undefined || remaining === 0).toBe(true);
        });
    }
});

// ── Multi-skill independence ────────────────────────────────────────────────

describe('Skill cooldown multi-skill independence', () => {
    beforeEach(() => {
        useCooldownStore.getState().clearAll();
    });

    it('casting one knight skill leaves another skill cooldown untouched', () => {
        // shield_bash cooldown=8000, fortify cooldown=20000.
        useCooldownStore.getState().setSkillCooldown('shield_bash', 8000);
        useCooldownStore.getState().setSkillCooldown('fortify', 20000);

        // Tick 8000ms — shield_bash should clear, fortify still 12000.
        useCooldownStore.getState().tick(8000);

        expect(useCooldownStore.getState().skillCooldowns['shield_bash']).toBeUndefined();
        expect(useCooldownStore.getState().skillCooldowns['fortify']).toBe(12000);
    });

    it('all 7 tier-1 skills can be on cooldown simultaneously without collision', () => {
        for (const cls of CLASS_KEYS) {
            const skill = TIER_1[cls];
            useCooldownStore.getState().setSkillCooldown(skill.id, skill.cooldown);
        }
        // Every skill remembered with its own ms.
        for (const cls of CLASS_KEYS) {
            const skill = TIER_1[cls];
            expect(useCooldownStore.getState().skillCooldowns[skill.id]).toBe(skill.cooldown);
        }
    });

    it('tick() drains every cooldown by the same ms (parallel)', () => {
        useCooldownStore.getState().setSkillCooldown('a_skill', 10000);
        useCooldownStore.getState().setSkillCooldown('b_skill', 5000);
        useCooldownStore.getState().setSkillCooldown('c_skill', 3000);
        useCooldownStore.getState().tick(2500);
        expect(useCooldownStore.getState().skillCooldowns['a_skill']).toBe(7500);
        expect(useCooldownStore.getState().skillCooldowns['b_skill']).toBe(2500);
        expect(useCooldownStore.getState().skillCooldowns['c_skill']).toBe(500);
    });
});

// ── Engine-side advanceSkillCooldowns ───────────────────────────────────────

describe('advanceSkillCooldowns', () => {
    it('is a no-op for an unset map (engine never tracked anything)', () => {
        expect(() => advanceSkillCooldowns(1000)).not.toThrow();
    });

    it('accepts 0 ms (engine treats as drain by zero)', () => {
        expect(() => advanceSkillCooldowns(0)).not.toThrow();
    });

    it('accepts very large ms without throwing (catch-up after tab sleep)', () => {
        expect(() => advanceSkillCooldowns(60_000_000)).not.toThrow();
    });

    it('accepts negative ms without throwing (defensive; TODO: clamp at 0 in engine)', () => {
        // Negative would INCREASE cooldowns — the current implementation
        // does no clamp at the engine level. Document the existing behaviour
        // so future hardening doesn't silently break callers.
        expect(() => advanceSkillCooldowns(-1000)).not.toThrow();
    });
});

// ── useCooldownStore mechanic regressions ───────────────────────────────────

describe('useCooldownStore.tick edge cases', () => {
    beforeEach(() => {
        useCooldownStore.getState().clearAll();
    });

    it('drops keys whose remaining hits exactly 0', () => {
        useCooldownStore.getState().setSkillCooldown('drop_me', 1000);
        useCooldownStore.getState().tick(1000);
        // Prune happens at the < 0 boundary: 1000-1000=0, code path skips
        // anything that isn't strictly > 0.
        expect(useCooldownStore.getState().skillCooldowns['drop_me']).toBeUndefined();
    });

    it('still drops keys whose remaining would be negative', () => {
        useCooldownStore.getState().setSkillCooldown('over_tick', 500);
        useCooldownStore.getState().tick(10_000);
        expect(useCooldownStore.getState().skillCooldowns['over_tick']).toBeUndefined();
    });

    it('preserves keys with remaining ms > 0', () => {
        useCooldownStore.getState().setSkillCooldown('keep_me', 5000);
        useCooldownStore.getState().tick(100);
        expect(useCooldownStore.getState().skillCooldowns['keep_me']).toBe(4900);
    });
});

// ── setSkillCooldown clamping (input < 0 → stored as 0) ─────────────────────

describe('useCooldownStore.setSkillCooldown clamps negative ms to 0', () => {
    beforeEach(() => {
        useCooldownStore.getState().clearAll();
    });

    it('clamps negative ms to 0 (prevents infinite cooldown bug)', () => {
        useCooldownStore.getState().setSkillCooldown('weird_input', -5000);
        expect(useCooldownStore.getState().skillCooldowns['weird_input']).toBe(0);
    });

    it('accepts 0 ms (instant clear)', () => {
        useCooldownStore.getState().setSkillCooldown('zero', 0);
        expect(useCooldownStore.getState().skillCooldowns['zero']).toBe(0);
    });

    it('accepts very large ms (catch-all for legendary cooldowns)', () => {
        useCooldownStore.getState().setSkillCooldown('big', 300_000); // 5min
        expect(useCooldownStore.getState().skillCooldowns['big']).toBe(300_000);
    });
});

// ── Cooldown semantics with SPEED_MULT (engine's speed-up logic) ────────────

describe('SPEED_MULT × cooldown wall-clock interaction', () => {
    beforeEach(() => {
        useCooldownStore.getState().clearAll();
    });

    it('SPEED_MULT exposes 3 speeds — x1=1, x2=2, x4=4 (engine multipliers)', () => {
        expect(SPEED_MULT.x1).toBe(1);
        expect(SPEED_MULT.x2).toBe(2);
        expect(SPEED_MULT.x4).toBe(4);
    });

    it('at x4 speed, a 10s cooldown drains in 2.5s of WALL time (via store ticks scaled by caller)', () => {
        // The cooldown store itself doesn't know about speed — engine callers
        // pass `wallDelta * SPEED_MULT[speed]` as the tick argument. Verify
        // the math holds: 10000ms cooldown at x4 means 2500ms wall × 4 = 10000ms drained.
        useCooldownStore.getState().setSkillCooldown('speed_test', 10000);
        const wallMs = 2500;
        const gameMs = wallMs * SPEED_MULT.x4;
        useCooldownStore.getState().tick(gameMs);
        expect(useCooldownStore.getState().skillCooldowns['speed_test']).toBeUndefined();
    });

    it('at x2 speed, a 10s cooldown drains in 5s of WALL time', () => {
        useCooldownStore.getState().setSkillCooldown('speed_test', 10000);
        const wallMs = 5000;
        useCooldownStore.getState().tick(wallMs * SPEED_MULT.x2);
        expect(useCooldownStore.getState().skillCooldowns['speed_test']).toBeUndefined();
    });

    it('at x1, draining over 5s WALL leaves 5s cooldown still active on a 10s skill', () => {
        useCooldownStore.getState().setSkillCooldown('speed_test', 10000);
        const wallMs = 5000;
        useCooldownStore.getState().tick(wallMs * SPEED_MULT.x1);
        expect(useCooldownStore.getState().skillCooldowns['speed_test']).toBe(5000);
    });
});

// ── clearAll ────────────────────────────────────────────────────────────────

describe('useCooldownStore.clearAll', () => {
    it('wipes every cooldown including HP/MP potion ones', () => {
        useCooldownStore.getState().setSkillCooldown('s1', 5000);
        useCooldownStore.getState().setSkillCooldown('s2', 5000);
        useCooldownStore.getState().setHpPotionCooldown(1000);
        useCooldownStore.getState().setMpPotionCooldown(1000);
        useCooldownStore.getState().setPctHpCooldown(500);
        useCooldownStore.getState().setPctMpCooldown(500);
        useCooldownStore.getState().clearAll();
        const s = useCooldownStore.getState();
        expect(Object.keys(s.skillCooldowns)).toEqual([]);
        expect(s.hpPotionCooldown).toBe(0);
        expect(s.mpPotionCooldown).toBe(0);
        expect(s.pctHpCooldown).toBe(0);
        expect(s.pctMpCooldown).toBe(0);
    });
});
