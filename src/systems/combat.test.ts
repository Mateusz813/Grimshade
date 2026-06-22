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
    getSpeedScaledCooldownMs,
} from './combat';

// -- calculateDamage ----------------------------------------------------------

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

// -- calculateDualWieldDamage -------------------------------------------------

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

// -- calculateBlockChance -----------------------------------------------------

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

// -- calculateDodgeChance -----------------------------------------------------

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

// -- calculateSkillDamage -----------------------------------------------------

describe('calculateSkillDamage', () => {
    it('should multiply base attack by skill multiplier', () => {
        expect(calculateSkillDamage(50, 2.0, 0, 1.0)).toBe(100);
    });

    it('should return minimum 1', () => {
        expect(calculateSkillDamage(1, 0.1, 1000, 1.0)).toBe(1);
    });
});

// -- calculateSkillDamageWithMlvl ---------------------------------------------

describe('calculateSkillDamageWithMlvl', () => {
    it('should scale with MLVL (2% per level)', () => {
        // baseSkillDmg=100, mlvl=10, no def, classMod=1 -> 100 * (1 + 10*0.02) = 120
        expect(calculateSkillDamageWithMlvl(100, 10, 0, 1)).toBe(120);
    });

    it('should apply class modifier', () => {
        // baseSkillDmg=100, mlvl=0, no def, classMod=1.3 -> 130
        expect(calculateSkillDamageWithMlvl(100, 0, 0, 1.3)).toBe(130);
    });

    it('should return minimum 1', () => {
        expect(calculateSkillDamageWithMlvl(1, 0, 1000, 1.0)).toBe(1);
    });
});

// -- calculateAttackInterval --------------------------------------------------

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

// -- calculateDeathPenalty (new level-loss system) ----------------------------

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

// 2026-05-21: replaces deleted test "should lose 3 levels at level 100 (15% XP kept)"
    // — combat.ts uses tiered formula: floor(level * (0.03 + level * 0.00002)) for
    // levels lost, with bracketed xpPercent tiers (75/50/30/15/10/5).
    it('should lose 3 levels at level 100 (15% XP kept)', () => {
        const result = calculateDeathPenalty(100, 5000, 10000, 1000);
        // floor(100 * (0.03 + 100*0.00002)) = floor(100 * 0.032) = 3
        expect(result.levelsLost).toBe(3);
        expect(result.newLevel).toBe(97);
        // level <= 100 -> xpPercent = 15
        expect(result.xpPercent).toBe(15);
        expect(result.newXp).toBe(1500); // 15% of xpToNext=10000
    });

    // 2026-05-21: replaces deleted test "should lose ~20 levels at level 500 (5% XP kept)"
    it('should lose 20 levels at level 500 (5% XP kept)', () => {
        const result = calculateDeathPenalty(500, 0, 200000, 1000);
        // floor(500 * (0.03 + 500*0.00002)) = floor(500 * 0.04) = 20
        expect(result.levelsLost).toBe(20);
        expect(result.newLevel).toBe(480);
        // level > 300 -> xpPercent = 5
        expect(result.xpPercent).toBe(5);
        expect(result.newXp).toBe(10000); // 5% of 200000
    });

    // 2026-05-21: replaces deleted test "scales skill XP loss between 1-3%" —
    // current formula: skillLossPct = min(0.03, 0.01 + level * 0.00002).
    it('caps skill XP loss at ~3% for high level', () => {
        const result = calculateDeathPenalty(1000, 0, 1000, 100000);
        // skillLossPct = min(0.03, 0.01 + 1000*0.00002) = min(0.03, 0.03) = 0.03
        expect(result.skillXpLoss).toBe(Math.floor(100000 * 0.03));
    });
});

// -- applyDeathPenalty (legacy) -----------------------------------------------

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

// -- applyMonsterRarity -------------------------------------------------------

describe('applyMonsterRarity', () => {
    const baseStats = { hp: 100, attack: 10, defense: 5, xp: 50, gold: [10, 20] as [number, number] };

    it('should return unchanged stats for normal rarity', () => {
        const result = applyMonsterRarity(baseStats, 'normal');
        expect(result.hp).toBe(100);
        expect(result.attack).toBe(10);
    });

    // 2026-05-21: replaces deleted test "should multiply HP by 1.5 for strong" —
    // current MONSTER_STAT_MULTIPLIERS.strong = { hp: 1.5, atk: 1.2, def: 1.3, xp: 1.8, gold: 2.0 }.
    it('should multiply HP by 1.5 and ATK by 1.2 for strong rarity', () => {
        const result = applyMonsterRarity(baseStats, 'strong');
        expect(result.hp).toBe(150);            // 100 * 1.5
        expect(result.attack).toBe(12);         // floor(10 * 1.2)
        expect(result.defense).toBe(6);         // floor(5 * 1.3)
        expect(result.xp).toBe(90);             // floor(50 * 1.8)
        expect(result.goldMin).toBe(20);        // floor(10 * 2.0)
        expect(result.goldMax).toBe(40);        // floor(20 * 2.0)
    });

    // 2026-05-21: replaces deleted test "should multiply HP by 8.0 for boss" —
    // current MONSTER_STAT_MULTIPLIERS.boss = { hp: 10.0, atk: 2.5, def: 2.0, xp: 10.0, gold: 15.0 }.
    // The historic 8.0 multiplier has been re-tuned to 10.0 for HP.
    it('should multiply HP by 10.0 and gold by 15.0 for boss rarity', () => {
        const result = applyMonsterRarity(baseStats, 'boss');
        expect(result.hp).toBe(1000);           // 100 * 10.0
        expect(result.attack).toBe(25);         // floor(10 * 2.5)
        expect(result.defense).toBe(10);        // floor(5 * 2.0)
        expect(result.xp).toBe(500);            // floor(50 * 10.0)
        expect(result.goldMin).toBe(150);       // floor(10 * 15.0)
        expect(result.goldMax).toBe(300);       // floor(20 * 15.0)
    });
});

// -- getSpeedMultiplier -------------------------------------------------------

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

// -- getSpeedScaledCooldownMs (2026-06-21 auto-skill cadence fix) -------------

describe('getSpeedScaledCooldownMs', () => {
    // The recast gate in Transform/Boss/Dungeon/Guild-boss must shrink the
    // cooldown window with combat speed so skills fire as soon as the
    // (speed-scaled) bar empties — the reported bug was a fixed 5s window.
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
        expect(getSpeedScaledCooldownMs(5000, 3)).toBe(1666); // 1666.67 → 1666
    });
});
