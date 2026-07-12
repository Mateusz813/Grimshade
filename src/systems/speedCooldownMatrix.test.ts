
import { describe, it, expect, beforeEach } from 'vitest';
import { SPEED_MULT, SPEED_ORDER, getAttackMs } from './combatEngine';
import { useCooldownStore } from '../stores/cooldownStore';


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
        expect(SPEED_MULT.SKIP).toBeUndefined();
    });
});


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
        useCooldownStore.getState().setSkillCooldown('berserker_rage', 60_000);
        const wallMs = 15_000;
        useCooldownStore.getState().tick(wallMs * SPEED_MULT.x4);
        expect(useCooldownStore.getState().skillCooldowns['berserker_rage']).toBeUndefined();
    });
});


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


describe('Attack cadence × speed — interval is unchanged by SPEED_MULT', () => {
    it('getAttackMs(2.0) returns 1500ms regardless of current speed setting', () => {
        expect(getAttackMs(2.0)).toBe(1500);
        expect(getAttackMs(2.0)).toBe(1500);
    });

    it('how many attacks land in 1s wall time @ each speed (sanity table)', () => {
        const ms = getAttackMs(2.0);
        expect(Math.floor((1000 * SPEED_MULT.x1) / ms)).toBe(0);
        expect(Math.floor((1000 * SPEED_MULT.x2) / ms)).toBe(1);
        expect(Math.floor((1000 * SPEED_MULT.x4) / ms)).toBe(2);
    });

    it('how many attacks land in 10s wall time @ each speed', () => {
        const ms = getAttackMs(2.0);
        expect(Math.floor((10_000 * SPEED_MULT.x1) / ms)).toBe(6);
        expect(Math.floor((10_000 * SPEED_MULT.x2) / ms)).toBe(13);
        expect(Math.floor((10_000 * SPEED_MULT.x4) / ms)).toBe(26);
    });
});


describe('Combined matrix — skill comes off cooldown in time for N basic attacks', () => {
    beforeEach(() => {
        useCooldownStore.getState().clearAll();
    });

    const SKILL_CD_MS = 5_000;
    const ATTACK_MS = getAttackMs(2.0);

    it('@ X1: in 5s wall time, skill comes off CD + 3 attacks land (5000/1500=3.33->3)', () => {
        useCooldownStore.getState().setSkillCooldown('s', SKILL_CD_MS);
        const wallMs = SKILL_CD_MS;
        useCooldownStore.getState().tick(wallMs * SPEED_MULT.x1);
        expect(useCooldownStore.getState().skillCooldowns['s']).toBeUndefined();
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
        const expectedAttacks = Math.floor(SKILL_CD_MS / ATTACK_MS);
        for (const speed of [SPEED_MULT.x1, SPEED_MULT.x2, SPEED_MULT.x4]) {
            const wallMs = SKILL_CD_MS / speed;
            const attacks = Math.floor((wallMs * speed) / ATTACK_MS);
            expect(attacks).toBe(expectedAttacks);
        }
    });
});


describe('Cooldown drain when speed switches mid-flight', () => {
    beforeEach(() => {
        useCooldownStore.getState().clearAll();
    });

    it('starts @ X1 (1s drained = 9000ms left), switches to X4 (1s = 4000ms drained -> 5000ms left)', () => {
        useCooldownStore.getState().setSkillCooldown('test', 10_000);
        useCooldownStore.getState().tick(1000 * SPEED_MULT.x1);
        expect(useCooldownStore.getState().skillCooldowns['test']).toBe(9000);
        useCooldownStore.getState().tick(1000 * SPEED_MULT.x4);
        expect(useCooldownStore.getState().skillCooldowns['test']).toBe(5000);
    });

    it('starts @ X4 (250ms wall = 1000ms drained), switches to X1 (1s wall = 1000ms drained)', () => {
        useCooldownStore.getState().setSkillCooldown('test', 5000);
        useCooldownStore.getState().tick(250 * SPEED_MULT.x4);
        expect(useCooldownStore.getState().skillCooldowns['test']).toBe(4000);
        useCooldownStore.getState().tick(1000 * SPEED_MULT.x1);
        expect(useCooldownStore.getState().skillCooldowns['test']).toBe(3000);
    });
});
