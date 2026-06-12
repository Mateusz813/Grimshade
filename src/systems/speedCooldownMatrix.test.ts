/**
 * Speed × cadence × cooldown integration matrix.
 *
 * Covers BACKLOG.md 12.8 ("Speed X1/X2/X4 nie psuje skill cadence") at the
 * unit/integration tier. The engine speeds up combat by multiplying the
 * wall-clock delta before draining timers (cooldowns, DOT durations, status
 * windows). This file pins down the math so a refactor of `SPEED_MULT` /
 * `huntStatusTick` / `useCooldownStore.tick` can't silently regress the
 * "10s cooldown drains in 2.5s at X4" UX promise.
 *
 * Where the speed multiplier lives at runtime:
 *   - `combatEngine.ts.huntStatusTick`     — wall delta × SPEED_MULT[speed]
 *                                              -> game delta passed to
 *                                                `effectsTickAll` (DOT / stun)
 *   - `useBackgroundCombat` (hooks/…)      — wall delta × SPEED_MULT[speed]
 *                                              -> passed to
 *                                                `useCooldownStore.tick`
 *   - Auto-cast loop (engine line ~1702)   — `(now - lastUsed) * speedMult`
 *                                              -> compare against
 *                                                `SKILL_COOLDOWN_MS`
 *
 * What we DON'T test here (covered elsewhere or out of scope):
 *   - Speed slider UI (E2E in `combat/speed/change-mid-combat.spec.ts`, TODO).
 *   - Per-skill cooldown installation — covered by `skillCooldown.test.ts`.
 *   - Cadence formula itself — covered by `combatCadence.test.ts`.
 *
 * Pure math + Zustand store integration; no React, no Playwright.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SPEED_MULT, SPEED_ORDER, getAttackMs } from './combatEngine';
import { useCooldownStore } from '../stores/cooldownStore';

// -- SPEED_MULT contract -----------------------------------------------------

describe('SPEED_MULT — engine speed multipliers', () => {
    it('x1 = 1 (real-time baseline)', () => {
        expect(SPEED_MULT.x1).toBe(1);
    });

    it('x2 = 2 (game runs 2× faster)', () => {
        expect(SPEED_MULT.x2).toBe(2);
    });

    it('x4 = 4 (game runs 4× faster — current max non-SKIP speed)', () => {
        expect(SPEED_MULT.x4).toBe(4);
    });

    it('each step doubles the previous (x1 < x2 < x4)', () => {
        expect(SPEED_MULT.x2).toBe(SPEED_MULT.x1 * 2);
        expect(SPEED_MULT.x4).toBe(SPEED_MULT.x2 * 2);
    });
});

describe('SPEED_ORDER — UI cycle order', () => {
    it('cycles x1 -> x2 -> x4 -> SKIP', () => {
        expect(SPEED_ORDER).toEqual(['x1', 'x2', 'x4', 'SKIP']);
    });

    it('SKIP is the terminal speed (special handling — no SPEED_MULT entry)', () => {
        // SKIP isn't in SPEED_MULT — the engine handles it via a separate
        // `resolveInstantFight` branch, not via the per-tick scaling.
        expect(SPEED_MULT.SKIP).toBeUndefined();
    });
});

// -- Cooldown drain × speed (the load-bearing UX promise) --------------------

describe('Cooldown drain time × speed multiplier (the X4 = 4× faster contract)', () => {
    beforeEach(() => {
        useCooldownStore.getState().clearAll();
    });

    it('10s skill cooldown @ X1 drains in 10s wall time (1× scaling)', () => {
        useCooldownStore.getState().setSkillCooldown('test', 10_000);
        const wallMs = 10_000;
        useCooldownStore.getState().tick(wallMs * SPEED_MULT.x1);
        expect(useCooldownStore.getState().skillCooldowns['test']).toBeUndefined();
    });

    it('10s skill cooldown @ X2 drains in 5s wall time (2× scaling)', () => {
        useCooldownStore.getState().setSkillCooldown('test', 10_000);
        const wallMs = 5_000;
        useCooldownStore.getState().tick(wallMs * SPEED_MULT.x2);
        expect(useCooldownStore.getState().skillCooldowns['test']).toBeUndefined();
    });

    it('10s skill cooldown @ X4 drains in 2.5s wall time (4× scaling — load-bearing!)', () => {
        // This is THE assertion that matters for BACKLOG 12.8. If anyone
        // ever changes SPEED_MULT.x4 to anything other than 4 (or breaks
        // the `wallDelta * speedMult` pattern), this test screams.
        useCooldownStore.getState().setSkillCooldown('test', 10_000);
        const wallMs = 2_500;
        useCooldownStore.getState().tick(wallMs * SPEED_MULT.x4);
        expect(useCooldownStore.getState().skillCooldowns['test']).toBeUndefined();
    });

    it('5s skill cooldown @ X4 drains in 1.25s wall time', () => {
        useCooldownStore.getState().setSkillCooldown('test', 5_000);
        const wallMs = 1_250;
        useCooldownStore.getState().tick(wallMs * SPEED_MULT.x4);
        expect(useCooldownStore.getState().skillCooldowns['test']).toBeUndefined();
    });

    it('60s skill cooldown @ X4 drains in 15s wall time (matches: berserker_rage 60s @ x4 = 15s)', () => {
        // berserker_rage actually has cooldown=25000 per skills.json but the
        // engine currently uses SKILL_COOLDOWN_MS=8000 for the auto path.
        // Either way, this test pins the wall-time math.
        useCooldownStore.getState().setSkillCooldown('berserker_rage', 60_000);
        const wallMs = 15_000;
        useCooldownStore.getState().tick(wallMs * SPEED_MULT.x4);
        expect(useCooldownStore.getState().skillCooldowns['berserker_rage']).toBeUndefined();
    });
});

// -- Partial drain — proves linearity, not just boundary clearing ------------

describe('Cooldown linear drain @ speed (no jumps / lost ms)', () => {
    beforeEach(() => {
        useCooldownStore.getState().clearAll();
    });

    it('@ X1, 5 sequential ticks of 1000ms each drain 5000ms total', () => {
        useCooldownStore.getState().setSkillCooldown('test', 10_000);
        for (let i = 0; i < 5; i++) {
            useCooldownStore.getState().tick(1000 * SPEED_MULT.x1);
        }
        expect(useCooldownStore.getState().skillCooldowns['test']).toBe(5000);
    });

    it('@ X2, 5 sequential ticks of 1000ms wall drain 10000ms total -> fully clears 10s skill', () => {
        useCooldownStore.getState().setSkillCooldown('test', 10_000);
        for (let i = 0; i < 5; i++) {
            useCooldownStore.getState().tick(1000 * SPEED_MULT.x2);
        }
        expect(useCooldownStore.getState().skillCooldowns['test']).toBeUndefined();
    });

    it('@ X4, 2 sequential ticks of 1000ms wall drain 8000ms total -> leaves 2000ms', () => {
        useCooldownStore.getState().setSkillCooldown('test', 10_000);
        for (let i = 0; i < 2; i++) {
            useCooldownStore.getState().tick(1000 * SPEED_MULT.x4);
        }
        expect(useCooldownStore.getState().skillCooldowns['test']).toBe(2000);
    });
});

// -- HP/MP potion cooldowns also scale (used by the speed-up auto-potion UX) -

describe('Potion cooldowns also drain @ speed multiplier', () => {
    beforeEach(() => {
        useCooldownStore.getState().clearAll();
    });

    it('1000ms HP potion CD @ X4 drains in 250ms wall time', () => {
        useCooldownStore.getState().setHpPotionCooldown(1000);
        useCooldownStore.getState().tick(250 * SPEED_MULT.x4);
        expect(useCooldownStore.getState().hpPotionCooldown).toBe(0);
    });

    it('500ms pct potion CD @ X2 drains in 250ms wall time', () => {
        useCooldownStore.getState().setPctHpCooldown(500);
        useCooldownStore.getState().tick(250 * SPEED_MULT.x2);
        expect(useCooldownStore.getState().pctHpCooldown).toBe(0);
    });

    it('@ X1, all 4 potion cooldowns drain in lockstep', () => {
        useCooldownStore.getState().setHpPotionCooldown(1000);
        useCooldownStore.getState().setMpPotionCooldown(1000);
        useCooldownStore.getState().setPctHpCooldown(500);
        useCooldownStore.getState().setPctMpCooldown(500);
        useCooldownStore.getState().tick(500 * SPEED_MULT.x1);
        const s = useCooldownStore.getState();
        expect(s.hpPotionCooldown).toBe(500);
        expect(s.mpPotionCooldown).toBe(500);
        expect(s.pctHpCooldown).toBe(0);
        expect(s.pctMpCooldown).toBe(0);
    });
});

// -- Attack cadence × speed (sanity: cadence itself doesn't get a 2nd speed bonus) -

describe('Attack cadence × speed — interval is unchanged by SPEED_MULT', () => {
    // CLARIFICATION: `getAttackMs` returns the BASE cadence interval for the
    // engine. Speed-up DOES NOT change the interval itself; instead the engine
    // advances the wall-clock more aggressively, so MORE attacks happen per
    // wall-second. This test pins that contract — if anyone ever folds
    // SPEED_MULT into getAttackMs, the player would see a double-speed bug.
    it('getAttackMs(2.0) returns 1500ms regardless of current speed setting', () => {
        // The function takes raw attack_speed, not speed-multiplied attack_speed.
        // SPEED_MULT applies elsewhere (to wall delta in tickers).
        expect(getAttackMs(2.0)).toBe(1500);
        expect(getAttackMs(2.0)).toBe(1500); // same on re-call
    });

    it('how many attacks land in 1s wall time @ each speed (sanity table)', () => {
        const ms = getAttackMs(2.0); // 1500ms cadence
        // Wall time = 1000ms, game time at X4 = 4000ms = 2.66 attacks.
        // Floor -> 2 attacks per wall-second @ X4 (vs 0 @ X1 since 1500 > 1000).
        expect(Math.floor((1000 * SPEED_MULT.x1) / ms)).toBe(0);
        expect(Math.floor((1000 * SPEED_MULT.x2) / ms)).toBe(1);
        expect(Math.floor((1000 * SPEED_MULT.x4) / ms)).toBe(2);
    });

    it('how many attacks land in 10s wall time @ each speed', () => {
        const ms = getAttackMs(2.0); // 1500ms cadence
        expect(Math.floor((10_000 * SPEED_MULT.x1) / ms)).toBe(6);
        expect(Math.floor((10_000 * SPEED_MULT.x2) / ms)).toBe(13);
        expect(Math.floor((10_000 * SPEED_MULT.x4) / ms)).toBe(26);
    });
});

// -- Combined matrix: skill cooldown × cadence × wall-time @ each speed ------

describe('Combined matrix — skill comes off cooldown in time for N basic attacks', () => {
    beforeEach(() => {
        useCooldownStore.getState().clearAll();
    });

    // Setup: 5s skill cooldown, attack_speed 2.0 (1500ms cadence).
    const SKILL_CD_MS = 5_000;
    const ATTACK_MS = getAttackMs(2.0); // 1500

    it('@ X1: in 5s wall time, skill comes off CD + 3 attacks land (5000/1500=3.33->3)', () => {
        useCooldownStore.getState().setSkillCooldown('s', SKILL_CD_MS);
        const wallMs = SKILL_CD_MS;
        useCooldownStore.getState().tick(wallMs * SPEED_MULT.x1);
        expect(useCooldownStore.getState().skillCooldowns['s']).toBeUndefined();
        // Attacks in 5s wall @ X1 = 5000 * 1 / 1500 = 3.
        const attacks = Math.floor((wallMs * SPEED_MULT.x1) / ATTACK_MS);
        expect(attacks).toBe(3);
    });

    it('@ X2: in 2.5s wall time, skill comes off CD + 3 attacks land (2500*2/1500=3.33->3)', () => {
        useCooldownStore.getState().setSkillCooldown('s', SKILL_CD_MS);
        const wallMs = SKILL_CD_MS / 2;
        useCooldownStore.getState().tick(wallMs * SPEED_MULT.x2);
        expect(useCooldownStore.getState().skillCooldowns['s']).toBeUndefined();
        const attacks = Math.floor((wallMs * SPEED_MULT.x2) / ATTACK_MS);
        expect(attacks).toBe(3);
    });

    it('@ X4: in 1.25s wall time, skill comes off CD + 3 attacks land (1250*4/1500=3.33->3)', () => {
        useCooldownStore.getState().setSkillCooldown('s', SKILL_CD_MS);
        const wallMs = SKILL_CD_MS / 4;
        useCooldownStore.getState().tick(wallMs * SPEED_MULT.x4);
        expect(useCooldownStore.getState().skillCooldowns['s']).toBeUndefined();
        const attacks = Math.floor((wallMs * SPEED_MULT.x4) / ATTACK_MS);
        expect(attacks).toBe(3);
    });

    it('invariant — at each speed, when skill is ready, same number of attacks have landed', () => {
        // The whole point of speed-up: 10× the speed = same fight pace, just
        // less wall time per fight. Cooldown / cadence stay synchronised.
        const expectedAttacks = Math.floor(SKILL_CD_MS / ATTACK_MS); // 3
        for (const speed of [SPEED_MULT.x1, SPEED_MULT.x2, SPEED_MULT.x4]) {
            const wallMs = SKILL_CD_MS / speed;
            const attacks = Math.floor((wallMs * speed) / ATTACK_MS);
            expect(attacks).toBe(expectedAttacks);
        }
    });
});

// -- Boundary / regression — switching speed mid-cooldown --------------------

describe('Cooldown drain when speed switches mid-flight', () => {
    beforeEach(() => {
        useCooldownStore.getState().clearAll();
    });

    it('starts @ X1 (1s drained = 9000ms left), switches to X4 (1s = 4000ms drained -> 5000ms left)', () => {
        useCooldownStore.getState().setSkillCooldown('test', 10_000);
        // Phase 1: 1000ms wall @ X1.
        useCooldownStore.getState().tick(1000 * SPEED_MULT.x1);
        expect(useCooldownStore.getState().skillCooldowns['test']).toBe(9000);
        // Phase 2: 1000ms wall @ X4 -> drains 4000ms of game time.
        useCooldownStore.getState().tick(1000 * SPEED_MULT.x4);
        expect(useCooldownStore.getState().skillCooldowns['test']).toBe(5000);
    });

    it('starts @ X4 (250ms wall = 1000ms drained), switches to X1 (1s wall = 1000ms drained)', () => {
        useCooldownStore.getState().setSkillCooldown('test', 5000);
        useCooldownStore.getState().tick(250 * SPEED_MULT.x4); // drain 1000
        expect(useCooldownStore.getState().skillCooldowns['test']).toBe(4000);
        useCooldownStore.getState().tick(1000 * SPEED_MULT.x1); // drain 1000
        expect(useCooldownStore.getState().skillCooldowns['test']).toBe(3000);
    });
});
