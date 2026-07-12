
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

const TIER_1: Record<ClassKey, IActiveSkillRow> = CLASS_KEYS.reduce((acc, cls) => {
    acc[cls] = ACTIVE[cls][0];
    return acc;
}, {} as Record<ClassKey, IActiveSkillRow>);


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
            expect(useCooldownStore.getState().skillCooldowns[skill.id]).toBeUndefined();
        });

        it(`${cls}.${skill.id}: clears even if we overtick (no negative cooldown)`, () => {
            useCooldownStore.getState().setSkillCooldown(skill.id, skill.cooldown);
            useCooldownStore.getState().tick(skill.cooldown * 10);
            const remaining = useCooldownStore.getState().skillCooldowns[skill.id];
            expect(remaining === undefined || remaining === 0).toBe(true);
        });
    }
});


describe('Skill cooldown multi-skill independence', () => {
    beforeEach(() => {
        useCooldownStore.getState().clearAll();
    });

    it('casting one knight skill leaves another skill cooldown untouched', () => {
        useCooldownStore.getState().setSkillCooldown('shield_bash', 8000);
        useCooldownStore.getState().setSkillCooldown('fortify', 20000);

        useCooldownStore.getState().tick(8000);

        expect(useCooldownStore.getState().skillCooldowns['shield_bash']).toBeUndefined();
        expect(useCooldownStore.getState().skillCooldowns['fortify']).toBe(12000);
    });

    it('all 7 tier-1 skills can be on cooldown simultaneously without collision', () => {
        for (const cls of CLASS_KEYS) {
            const skill = TIER_1[cls];
            useCooldownStore.getState().setSkillCooldown(skill.id, skill.cooldown);
        }
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
        expect(() => advanceSkillCooldowns(-1000)).not.toThrow();
    });
});


describe('useCooldownStore.tick edge cases', () => {
    beforeEach(() => {
        useCooldownStore.getState().clearAll();
    });

    it('drops keys whose remaining hits exactly 0', () => {
        useCooldownStore.getState().setSkillCooldown('drop_me', 1000);
        useCooldownStore.getState().tick(1000);
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
        useCooldownStore.getState().setSkillCooldown('big', 300_000);
        expect(useCooldownStore.getState().skillCooldowns['big']).toBe(300_000);
    });
});


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
