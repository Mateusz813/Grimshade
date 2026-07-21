import { describe, it, expect } from 'vitest';
import {
    calculateDamage,
    calculateDualWieldDamage,
    calculateSkillDamage,
    calculateSkillDamageWithMlvl,
    calculateAttackInterval,
    calculateDeathPenalty,
    applyDeathPenalty,
    applyMonsterRarity,
    getSpeedMultiplier,
    getSpeedScaledCooldownMs,
    resolveSkillRecastMs,
    REAL_COOLDOWN_SKILL_IDS,
    KILL_XP_TTK_MULT,
    compressPlayerDamage,
    defMitigation,
    DMG_COMPRESS_K,
    DMG_COMPRESS_P,
    DEF_BASE,
} from './combat';
import skillsData from '../data/skills.json';

describe('compressPlayerDamage (sub-linear player-damage compression)', () => {
    it('is the power curve K·raw^P (K=2.3, P=0.80)', () => {
        expect(DMG_COMPRESS_K).toBe(2.3);
        expect(DMG_COMPRESS_P).toBe(0.80);
        expect(compressPlayerDamage(1000)).toBeCloseTo(DMG_COMPRESS_K * Math.pow(1000, DMG_COMPRESS_P), 6);
    });

    it('keeps low-level hits VISIBLE (a ~17 raw hit compresses to a legible number, not floored to 1)', () => {
        const lowHit = Math.floor(compressPlayerDamage(17));
        expect(lowHit).toBeGreaterThanOrEqual(15);
        expect(lowHit).toBeLessThan(30);
    });

    it('still bounds the top: a ~23000 raw endgame hit compresses to ~7k (not millions)', () => {
        const topHit = Math.floor(compressPlayerDamage(23000));
        expect(topHit).toBeGreaterThan(6000);
        expect(topHit).toBeLessThan(8000);
    });

    it('is monotonic — bigger raw always compresses to bigger (or equal) output', () => {
        for (let x = 1; x < 5000; x += 137) {
            expect(compressPlayerDamage(x + 137)).toBeGreaterThan(compressPlayerDamage(x));
        }
    });
});

describe('defMitigation with DEF_BASE (low-level DEF fix)', () => {
    it('DEF_BASE is 25', () => {
        expect(DEF_BASE).toBe(25);
    });

    it('a rat DEF 1 at level 1 mitigates ~4%, NOT 50% (the old def/(def+level) explosion)', () => {
        const mit = defMitigation(1, 1);
        expect(mit).toBeCloseTo(1 / (1 + 1 + 25), 6);
        expect(mit).toBeLessThan(0.06);
    });

    it('high-level tanks stay tanky (DEF_BASE is negligible when def+level >> 25)', () => {
        const mit = defMitigation(2118, 1000);
        expect(mit).toBeGreaterThan(0.6);
    });
});


describe('KILL_XP_TTK_MULT', () => {
    it('is 1.75 (per-kill hunt XP compensation for the longer post-rebalance TTK)', () => {
        expect(KILL_XP_TTK_MULT).toBe(1.75);
    });
});

describe('calculateDamage', () => {
    it('should return minimum 1 damage', () => {
        const result = calculateDamage({ baseAtk: 5, weaponAtk: 0, skillBonus: 0, classModifier: 1, enemyDefense: 100, attackerLevel: 1, isCrit: false });
        expect(result.finalDamage).toBe(1);
    });

    it('should double damage on crit (default critDmg = 2.0)', () => {
        const result = calculateDamage({ baseAtk: 50, weaponAtk: 0, skillBonus: 0, classModifier: 1, enemyDefense: 0, isCrit: true });
        expect(result.finalDamage).toBe(100);
    });

    it('should use custom critDmg multiplier', () => {
        const result = calculateDamage({ baseAtk: 50, weaponAtk: 0, skillBonus: 0, classModifier: 1, enemyDefense: 0, isCrit: true, critDmg: 3.0 });
        expect(result.finalDamage).toBe(150);
    });

    it('mitigates by percentage: def == level + DEF_BASE -> 50% reduction', () => {
        const result = calculateDamage({ baseAtk: 100, weaponAtk: 0, skillBonus: 0, classModifier: 1, enemyDefense: 100, attackerLevel: 75, isCrit: false });
        expect(result.finalDamage).toBe(50);
    });

    it('caps mitigation at DEF_CAP (0.75) -> 25% damage gets through', () => {
        const result = calculateDamage({ baseAtk: 100, weaponAtk: 0, skillBonus: 0, classModifier: 1, enemyDefense: 100000, attackerLevel: 1, isCrit: false });
        expect(result.finalDamage).toBe(25);
    });

    it('no mitigation when enemyDefense is 0', () => {
        const result = calculateDamage({ baseAtk: 100, weaponAtk: 0, skillBonus: 0, classModifier: 1, enemyDefense: 0, isCrit: false });
        expect(result.finalDamage).toBe(100);
    });

    it('should apply class modifier', () => {
        const result = calculateDamage({ baseAtk: 100, weaponAtk: 0, skillBonus: 0, classModifier: 1.3, enemyDefense: 0, isCrit: false });
        expect(result.finalDamage).toBe(130);
    });

    it('should include weaponAtk and skillBonus', () => {
        const result = calculateDamage({ baseAtk: 10, weaponAtk: 20, skillBonus: 5, classModifier: 1, enemyDefense: 0, isCrit: false });
        expect(result.finalDamage).toBe(35);
    });

    it('should cap crit chance at maxCritChance', () => {
        const result = calculateDamage({ baseAtk: 50, weaponAtk: 0, skillBonus: 0, classModifier: 1, enemyDefense: 0, critChance: 1.0, maxCritChance: 0.0 });
        expect(result.isCrit).toBe(false);
    });

    it('should never return NaN', () => {
        const result = calculateDamage({ baseAtk: undefined as unknown as number, weaponAtk: null as unknown as number, skillBonus: 0, classModifier: 1, enemyDefense: 0 });
        expect(result.finalDamage).not.toBeNaN();
        expect(result.damage).not.toBeNaN();
    });
});


describe('calculateDualWieldDamage', () => {
    it('should return two hits', () => {
        const result = calculateDualWieldDamage({ baseAtk: 50, weaponAtk: 100, offHandAtk: 100, skillBonus: 0, classModifier: 1, enemyDefense: 0, isCrit: false });
        expect(result.hit1).toBeDefined();
        expect(result.hit2).toBeDefined();
    });

    it('should use 60% weapon ATK for each hit independently', () => {
        const result = calculateDualWieldDamage({ baseAtk: 0, weaponAtk: 100, offHandAtk: 80, skillBonus: 0, classModifier: 1, enemyDefense: 0, isCrit: false });
        expect(result.hit1.finalDamage).toBe(60);
        expect(result.hit2.finalDamage).toBe(48);
        expect(result.totalDamage).toBe(108);
    });

    it('should use same weapon for both if offHand equals mainHand', () => {
        const result = calculateDualWieldDamage({ baseAtk: 0, weaponAtk: 100, offHandAtk: 100, skillBonus: 0, classModifier: 1, enemyDefense: 0, isCrit: false });
        expect(result.hit1.finalDamage).toBe(60);
        expect(result.hit2.finalDamage).toBe(60);
        expect(result.totalDamage).toBe(120);
    });

    it('should have separate crit rolls for each hit', () => {
        const result = calculateDualWieldDamage({ baseAtk: 50, weaponAtk: 100, offHandAtk: 100, skillBonus: 0, classModifier: 1, enemyDefense: 0, isCrit: true });
        expect(result.hit1.isCrit).toBe(true);
        expect(result.hit2.isCrit).toBe(true);
    });
});



describe('calculateSkillDamage', () => {
    it('should multiply base attack by skill multiplier', () => {
        expect(calculateSkillDamage(50, 2.0, 0, 1.0)).toBe(100);
    });

    it('should return minimum 1', () => {
        expect(calculateSkillDamage(1, 0.1, 1000, 1.0)).toBe(1);
    });
});


describe('calculateSkillDamageWithMlvl', () => {
    it('should scale with MLVL (2% per level)', () => {
        expect(calculateSkillDamageWithMlvl(100, 10, 0, 1)).toBe(120);
    });

    it('should apply class modifier', () => {
        expect(calculateSkillDamageWithMlvl(100, 0, 0, 1.3)).toBe(130);
    });

    it('should return minimum 1', () => {
        expect(calculateSkillDamageWithMlvl(1, 0, 1000, 1.0)).toBe(1);
    });
});


describe('calculateAttackInterval', () => {
    it('should return 2000ms at speed 1', () => {
        expect(calculateAttackInterval(1)).toBe(2000);
    });

    it('should halve interval at speed 2', () => {
        expect(calculateAttackInterval(2)).toBe(1000);
    });

    it('should not go below 500ms', () => {
        expect(calculateAttackInterval(100)).toBe(500);
    });
});


describe('calculateDeathPenalty', () => {
    it('should not lose level at level 1', () => {
        const result = calculateDeathPenalty(1, 500, 1000, 200);
        expect(result.newLevel).toBe(1);
        expect(result.levelsLost).toBe(0);
        expect(result.newXp).toBe(250);
    });

    it('should lose 1 level at level 5 (75% XP kept)', () => {
        const result = calculateDeathPenalty(5, 500, 1000, 200);
        expect(result.newLevel).toBe(4);
        expect(result.levelsLost).toBe(1);
        expect(result.xpPercent).toBe(75);
        expect(result.newXp).toBe(750);
    });

    it('should lose 1 level at level 50 (30% XP kept)', () => {
        const result = calculateDeathPenalty(50, 500, 5000, 200);
        expect(result.newLevel).toBe(49);
        expect(result.levelsLost).toBe(1);
        expect(result.xpPercent).toBe(30);
    });

    it('should lose 3 levels at level 100 (15% XP kept)', () => {
        const result = calculateDeathPenalty(100, 5000, 10000, 1000);
        expect(result.levelsLost).toBe(3);
        expect(result.newLevel).toBe(97);
        expect(result.xpPercent).toBe(15);
        expect(result.newXp).toBe(1500);
    });

    it('should lose 20 levels at level 500 (5% XP kept)', () => {
        const result = calculateDeathPenalty(500, 0, 200000, 1000);
        expect(result.levelsLost).toBe(20);
        expect(result.newLevel).toBe(480);
        expect(result.xpPercent).toBe(5);
        expect(result.newXp).toBe(10000);
    });

    it('caps skill XP loss at ~3% for high level', () => {
        const result = calculateDeathPenalty(1000, 0, 1000, 100000);
        expect(result.skillXpLoss).toBe(Math.floor(100000 * 0.03));
    });
});


describe('applyDeathPenalty (legacy)', () => {
    it('should reduce XP by 10%', () => {
        const result = applyDeathPenalty(500, 1000, 200);
        expect(result.newXp).toBe(400);
    });

    it('should reduce skill XP by 5%', () => {
        const result = applyDeathPenalty(500, 1000, 200);
        expect(result.newSkillXp).toBe(190);
    });

    it('should not go below 0 XP', () => {
        const result = applyDeathPenalty(50, 1000, 10);
        expect(result.newXp).toBe(0);
    });
});


describe('applyMonsterRarity', () => {
    const baseStats = { hp: 100, attack: 10, defense: 5, xp: 50, gold: [10, 20] as [number, number] };

    it('should return unchanged stats for normal rarity', () => {
        const result = applyMonsterRarity(baseStats, 'normal');
        expect(result.hp).toBe(100);
        expect(result.attack).toBe(10);
    });

    it('should multiply HP by 1.5 and ATK by 1.4 for strong rarity', () => {
        const result = applyMonsterRarity(baseStats, 'strong');
        expect(result.hp).toBe(150);
        expect(result.attack).toBe(14);
        expect(result.defense).toBe(6);
        expect(result.xp).toBe(90);
        expect(result.goldMin).toBe(20);
        expect(result.goldMax).toBe(40);
    });

    it('should multiply HP by 8.0 and gold by 15.0 for boss rarity', () => {
        const result = applyMonsterRarity(baseStats, 'boss');
        expect(result.hp).toBe(800);
        expect(result.attack).toBe(50);
        expect(result.defense).toBe(10);
        expect(result.xp).toBe(500);
        expect(result.goldMin).toBe(150);
        expect(result.goldMax).toBe(300);
    });
});


describe('getSpeedMultiplier', () => {
    it('should return 1 for x1', () => {
        expect(getSpeedMultiplier('x1')).toBe(1);
    });

    it('should return 4 for x4', () => {
        expect(getSpeedMultiplier('x4')).toBe(4);
    });

    it('should return Infinity for SKIP', () => {
        expect(getSpeedMultiplier('SKIP')).toBe(Infinity);
    });
});


describe('getSpeedScaledCooldownMs', () => {
    it('returns the full cooldown at x1', () => {
        expect(getSpeedScaledCooldownMs(5000, 1)).toBe(5000);
    });

    it('halves the cooldown at x2 and quarters it at x4', () => {
        expect(getSpeedScaledCooldownMs(5000, 2)).toBe(2500);
        expect(getSpeedScaledCooldownMs(5000, 4)).toBe(1250);
    });

    it('scales other base cooldowns too (8s engine CD, 1.2s guild throttle)', () => {
        expect(getSpeedScaledCooldownMs(8000, 2)).toBe(4000);
        expect(getSpeedScaledCooldownMs(8000, 4)).toBe(2000);
        expect(getSpeedScaledCooldownMs(1200, 2)).toBe(600);
        expect(getSpeedScaledCooldownMs(1200, 4)).toBe(300);
    });

    it('clamps the multiplier to ≥1 so a bad value never LENGTHENS the cooldown', () => {
        expect(getSpeedScaledCooldownMs(5000, 0)).toBe(5000);
        expect(getSpeedScaledCooldownMs(5000, -3)).toBe(5000);
        expect(getSpeedScaledCooldownMs(5000, 0.5)).toBe(5000);
    });

    it('floors fractional results', () => {
        expect(getSpeedScaledCooldownMs(5000, 3)).toBe(1666);
    });
});

describe('resolveSkillRecastMs (per-skill recast override)', () => {
    it('shadow_step has a 40s (40000ms) cooldown in skills.json', () => {
        const archer = (skillsData as { activeSkills: Record<string, Array<{ id: string; cooldown: number }>> })
            .activeSkills.archer;
        const shadowStep = archer.find((s) => s.id === 'shadow_step');
        expect(shadowStep?.cooldown).toBe(40000);
    });

    it('honors shadow_step real cooldown (returns the LONGER of flat vs real)', () => {
        expect(resolveSkillRecastMs('shadow_step', 5000)).toBe(40000);
        expect(resolveSkillRecastMs('shadow_step', 8000)).toBe(40000);
    });

    it('never SHORTENS below the flat recast', () => {
        expect(resolveSkillRecastMs('shadow_step', 25000)).toBe(40000);
    });

    it('returns the flat value unchanged for non-honored skills', () => {
        expect(resolveSkillRecastMs('fireball', 5000)).toBe(5000);
        expect(resolveSkillRecastMs('some_unknown_skill', 8000)).toBe(8000);
    });

    it('REAL_COOLDOWN_SKILL_IDS contains shadow_step', () => {
        expect(REAL_COOLDOWN_SKILL_IDS.has('shadow_step')).toBe(true);
    });
});
