import { describe, it, expect } from 'vitest';
import {
    calculateDamage,
    calculateDualWieldDamage,
    calculateBlockChance,
    calculateDodgeChance,
    calculateSkillDamage,
    calculateSkillDamageWithMlvl,
    calculateAttackInterval,
    calculateDeathPenalty,
    applyDeathPenalty,
    applyMonsterRarity,
    getSpeedMultiplier,
} from './combat';

// ── calculateDamage ──────────────────────────────────────────────────────────

describe('calculateDamage', () => {
    it('should return minimum 1 damage', () => {
        const result = calculateDamage({ baseAtk: 5, weaponAtk: 0, skillBonus: 0, classModifier: 1, enemyDefense: 100, isCrit: false, isBlocked: false, isDodged: false });
        expect(result.finalDamage).toBe(1);
    });

    it('should double damage on crit (default critDmg = 2.0)', () => {
        const result = calculateDamage({ baseAtk: 50, weaponAtk: 0, skillBonus: 0, classModifier: 1, enemyDefense: 0, isCrit: true, isBlocked: false, isDodged: false });
        expect(result.finalDamage).toBe(100);
    });

    it('should use custom critDmg multiplier', () => {
        const result = calculateDamage({ baseAtk: 50, weaponAtk: 0, skillBonus: 0, classModifier: 1, enemyDefense: 0, isCrit: true, isBlocked: false, isDodged: false, critDmg: 3.0 });
        expect(result.finalDamage).toBe(150);
    });

    it('should halve damage when blocked', () => {
        const result = calculateDamage({ baseAtk: 100, weaponAtk: 0, skillBonus: 0, classModifier: 1, enemyDefense: 0, isCrit: false, isBlocked: true, isDodged: false });
        expect(result.finalDamage).toBe(50);
    });

    it('should return 0 finalDamage when dodged', () => {
        const result = calculateDamage({ baseAtk: 100, weaponAtk: 0, skillBonus: 0, classModifier: 1, enemyDefense: 0, isCrit: false, isBlocked: false, isDodged: true });
        expect(result.finalDamage).toBe(0);
        expect(result.isDodged).toBe(true);
        expect(result.isCrit).toBe(false);
    });

    it('should apply class modifier', () => {
        const result = calculateDamage({ baseAtk: 100, weaponAtk: 0, skillBonus: 0, classModifier: 1.3, enemyDefense: 0, isCrit: false, isBlocked: false, isDodged: false });
        expect(result.finalDamage).toBe(130);
    });

    it('should include weaponAtk and skillBonus', () => {
        const result = calculateDamage({ baseAtk: 10, weaponAtk: 20, skillBonus: 5, classModifier: 1, enemyDefense: 0, isCrit: false, isBlocked: false, isDodged: false });
        expect(result.finalDamage).toBe(35);
    });

    it('should cap crit chance at maxCritChance', () => {
        // With critChance=1.0 but maxCritChance=0.0, should never crit
        const result = calculateDamage({ baseAtk: 50, weaponAtk: 0, skillBonus: 0, classModifier: 1, enemyDefense: 0, critChance: 1.0, maxCritChance: 0.0 });
        // Since maxCrit caps at 0, Math.random() < 0 is always false
        expect(result.isCrit).toBe(false);
    });

    it('should never return NaN', () => {
        const result = calculateDamage({ baseAtk: undefined as any, weaponAtk: null as any, skillBonus: 0, classModifier: 1, enemyDefense: 0 });
        expect(result.finalDamage).not.toBeNaN();
        expect(result.damage).not.toBeNaN();
    });
});

// ── calculateDualWieldDamage ─────────────────────────────────────────────────

describe('calculateDualWieldDamage', () => {
    it('should return two hits', () => {
        const result = calculateDualWieldDamage({ baseAtk: 50, weaponAtk: 100, offHandAtk: 100, skillBonus: 0, classModifier: 1, enemyDefense: 0, isCrit: false, isBlocked: false, isDodged: false });
        expect(result.hit1).toBeDefined();
        expect(result.hit2).toBeDefined();
    });

    it('should use 60% weapon ATK for each hit independently', () => {
        // mainHand = 100 (60% = 60), offHand = 80 (60% = 48). baseAtk=0
        const result = calculateDualWieldDamage({ baseAtk: 0, weaponAtk: 100, offHandAtk: 80, skillBonus: 0, classModifier: 1, enemyDefense: 0, isCrit: false, isBlocked: false, isDodged: false });
        expect(result.hit1.finalDamage).toBe(60);
        expect(result.hit2.finalDamage).toBe(48);
        expect(result.totalDamage).toBe(108);
    });

    it('should use same weapon for both if offHand equals mainHand', () => {
        const result = calculateDualWieldDamage({ baseAtk: 0, weaponAtk: 100, offHandAtk: 100, skillBonus: 0, classModifier: 1, enemyDefense: 0, isCrit: false, isBlocked: false, isDodged: false });
        expect(result.hit1.finalDamage).toBe(60);
        expect(result.hit2.finalDamage).toBe(60);
        expect(result.totalDamage).toBe(120);
    });

    it('should have separate crit rolls for each hit', () => {
        // Force crit on both hits
        const result = calculateDualWieldDamage({ baseAtk: 50, weaponAtk: 100, offHandAtk: 100, skillBonus: 0, classModifier: 1, enemyDefense: 0, isCrit: true, isBlocked: false, isDodged: false });
        expect(result.hit1.isCrit).toBe(true);
        expect(result.hit2.isCrit).toBe(true);
    });
});

// ── calculateBlockChance ─────────────────────────────────────────────────────

describe('calculateBlockChance', () => {
    it('should return 5% base at shielding 0', () => {
        expect(calculateBlockChance(0)).toBe(0.05);
    });

    it('should scale with shielding level', () => {
        expect(calculateBlockChance(10)).toBeCloseTo(0.10, 4);
    });

    it('should cap at 25%', () => {
        expect(calculateBlockChance(1000)).toBe(0.25);
    });

    it('should return 0 for non-physical attacks', () => {
        expect(calculateBlockChance(100, false)).toBe(0);
    });
});

// ── calculateDodgeChance ─────────────────────────────────────────────────────

describe('calculateDodgeChance', () => {
    it('should return 5% base for Archer at agility 0', () => {
        expect(calculateDodgeChance('Archer', 0)).toBe(0.05);
    });

    it('should return 5% base for Rogue at agility 0', () => {
        expect(calculateDodgeChance('Rogue', 0)).toBe(0.05);
    });

    it('should cap Archer at 20%', () => {
        expect(calculateDodgeChance('Archer', 1000)).toBe(0.20);
    });

    it('should cap Bard at 15%', () => {
        expect(calculateDodgeChance('Bard', 1000)).toBe(0.15);
    });

    it('should return 0 for Knight (no dodge)', () => {
        expect(calculateDodgeChance('Knight', 100)).toBe(0);
    });

    it('should return 0 for Mage (no dodge)', () => {
        expect(calculateDodgeChance('Mage', 100)).toBe(0);
    });

    it('should return 0 for non-physical attacks', () => {
        expect(calculateDodgeChance('Archer', 100, false)).toBe(0);
    });
});

// ── calculateSkillDamage ─────────────────────────────────────────────────────

describe('calculateSkillDamage', () => {
    it('should multiply base attack by skill multiplier', () => {
        expect(calculateSkillDamage(50, 2.0, 0, 1.0)).toBe(100);
    });

    it('should return minimum 1', () => {
        expect(calculateSkillDamage(1, 0.1, 1000, 1.0)).toBe(1);
    });
});

// ── calculateSkillDamageWithMlvl ─────────────────────────────────────────────

describe('calculateSkillDamageWithMlvl', () => {
    it('should scale with MLVL (2% per level)', () => {
        // baseSkillDmg=100, mlvl=10, no def, classMod=1 → 100 * (1 + 10*0.02) = 120
        expect(calculateSkillDamageWithMlvl(100, 10, 0, 1)).toBe(120);
    });

    it('should apply class modifier', () => {
        // baseSkillDmg=100, mlvl=0, no def, classMod=1.3 → 130
        expect(calculateSkillDamageWithMlvl(100, 0, 0, 1.3)).toBe(130);
    });

    it('should return minimum 1', () => {
        expect(calculateSkillDamageWithMlvl(1, 0, 1000, 1.0)).toBe(1);
    });
});

// ── calculateAttackInterval ──────────────────────────────────────────────────

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

// ── calculateDeathPenalty (new level-loss system) ────────────────────────────

describe('calculateDeathPenalty', () => {
    it('should not lose level at level 1', () => {
        const result = calculateDeathPenalty(1, 500, 1000, 200);
        expect(result.newLevel).toBe(1);
        expect(result.levelsLost).toBe(0);
        expect(result.newXp).toBe(250); // 50% of 500
    });

    it('should lose 1 level at level 5 (75% XP kept)', () => {
        const result = calculateDeathPenalty(5, 500, 1000, 200);
        expect(result.newLevel).toBe(4);
        expect(result.levelsLost).toBe(1);
        expect(result.xpPercent).toBe(75);
        expect(result.newXp).toBe(750); // 75% of xpToNext=1000
    });

    it('should lose 1 level at level 50 (30% XP kept)', () => {
        const result = calculateDeathPenalty(50, 500, 5000, 200);
        expect(result.newLevel).toBe(49);
        expect(result.levelsLost).toBe(1);
        expect(result.xpPercent).toBe(30);
    });

    it('should lose 1 level at level 100 (10% XP kept)', () => {
        const result = calculateDeathPenalty(100, 500, 10000, 200);
        expect(result.newLevel).toBe(99);
        expect(result.xpPercent).toBe(10);
    });

    it('should lose 1 level at level 500 (5% XP kept)', () => {
        const result = calculateDeathPenalty(500, 500, 50000, 200);
        expect(result.newLevel).toBe(499);
        expect(result.xpPercent).toBe(5);
    });

    it('should apply 5% skill XP loss', () => {
        const result = calculateDeathPenalty(10, 500, 1000, 200);
        expect(result.skillXpLoss).toBe(10); // 5% of 200
    });
});

// ── applyDeathPenalty (legacy) ───────────────────────────────────────────────

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

// ── applyMonsterRarity ───────────────────────────────────────────────────────

describe('applyMonsterRarity', () => {
    const baseStats = { hp: 100, attack: 10, defense: 5, xp: 50, gold: [10, 20] as [number, number] };

    it('should return unchanged stats for normal rarity', () => {
        const result = applyMonsterRarity(baseStats, 'normal');
        expect(result.hp).toBe(100);
        expect(result.attack).toBe(10);
    });

    it('should scale stats for strong rarity (x1.5)', () => {
        const result = applyMonsterRarity(baseStats, 'strong');
        expect(result.hp).toBe(150);
        expect(result.attack).toBe(15);
    });

    it('should scale stats for boss rarity (x8.0)', () => {
        const result = applyMonsterRarity(baseStats, 'boss');
        expect(result.hp).toBe(800);
        expect(result.attack).toBe(80);
        expect(result.xp).toBe(500);
    });
});

// ── getSpeedMultiplier ───────────────────────────────────────────────────────

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
