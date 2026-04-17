import { describe, it, expect } from 'vitest';
import {
    skillXpToNextLevel,
    skillXpPerHit,
    skillXpPerCast,
    calculateOfflineSkillXp,
    processSkillXp,
    applySkillDeathPenalty,
    getSkillDamageBonus,
    getClassWeaponSkills,
    skillXpProgress,
    shieldingXpPerBlock,
    getShieldingDefBonus,
    getShieldingBlockBonus,
    mlvlXpPerAttack,
    mlvlXpPerSkillUse,
    doesClassGainMlvlFromAttacks,
    MAX_OFFLINE_TRAINING_SECONDS,
    getSkillUpgradeCost,
    getSkillUpgradeBonus,
    rollSkillUpgrade,
} from './skillSystem';

// ── skillXpToNextLevel ────────────────────────────────────────────────────────

describe('skillXpToNextLevel', () => {
    it('returns 100 for level 0', () => {
        expect(skillXpToNextLevel(0)).toBe(100);
    });

    it('is strictly increasing', () => {
        for (let l = 1; l < 100; l++) {
            expect(skillXpToNextLevel(l + 1)).toBeGreaterThan(skillXpToNextLevel(l));
        }
    });
});

// ── skillXpPerHit & skillXpPerCast ────────────────────────────────────────────

describe('skillXpPerHit', () => {
    it('returns at least 1', () => {
        expect(skillXpPerHit(0)).toBeGreaterThanOrEqual(1);
        expect(skillXpPerHit(100)).toBeGreaterThanOrEqual(1);
    });

    it('gives more XP per hit at low skill levels', () => {
        expect(skillXpPerHit(1)).toBeGreaterThan(skillXpPerHit(50));
    });
});

describe('skillXpPerCast', () => {
    it('returns at least 1', () => {
        expect(skillXpPerCast(0)).toBeGreaterThanOrEqual(1);
        expect(skillXpPerCast(100)).toBeGreaterThanOrEqual(1);
    });

    it('gives more than hit XP (spells are harder to find)', () => {
        expect(skillXpPerCast(0)).toBeGreaterThan(skillXpPerHit(0));
    });
});

// ── calculateOfflineSkillXp ───────────────────────────────────────────────────

describe('calculateOfflineSkillXp', () => {
    it('returns 0 for 0 seconds', () => {
        expect(calculateOfflineSkillXp(0, 5)).toBe(0);
    });

    it('returns positive XP for non-zero time', () => {
        expect(calculateOfflineSkillXp(3600, 5)).toBeGreaterThan(0);
    });

    it('gives less XP at higher skill levels (diminishing returns)', () => {
        const low  = calculateOfflineSkillXp(3600, 5);
        const high = calculateOfflineSkillXp(3600, 90);
        expect(low).toBeGreaterThan(high);
    });

    it('caps at 24 hours of training', () => {
        const at24h = calculateOfflineSkillXp(MAX_OFFLINE_TRAINING_SECONDS, 5);
        const at48h = calculateOfflineSkillXp(MAX_OFFLINE_TRAINING_SECONDS * 2, 5);
        expect(at24h).toBe(at48h);
    });
});

// ── processSkillXp ────────────────────────────────────────────────────────────

describe('processSkillXp', () => {
    it('accumulates XP without levelling up', () => {
        const result = processSkillXp(1, 0, 10);
        expect(result.newLevel).toBe(1);
        expect(result.remainingXp).toBe(10);
        expect(result.levelsGained).toBe(0);
    });

    it('levels up when threshold is reached', () => {
        const needed = skillXpToNextLevel(1);
        const result = processSkillXp(1, 0, needed);
        expect(result.newLevel).toBe(2);
        expect(result.remainingXp).toBe(0);
        expect(result.levelsGained).toBe(1);
    });

    it('handles multiple level-ups', () => {
        const xp = skillXpToNextLevel(0) + skillXpToNextLevel(1) + skillXpToNextLevel(2);
        const result = processSkillXp(0, 0, xp);
        expect(result.levelsGained).toBe(3);
    });

    it('carries over excess XP', () => {
        const result = processSkillXp(1, 0, skillXpToNextLevel(1) + 7);
        expect(result.remainingXp).toBe(7);
    });

    it('has no level cap (can go beyond 100)', () => {
        const needed = skillXpToNextLevel(100);
        const result = processSkillXp(100, 0, needed);
        expect(result.newLevel).toBe(101);
    });
});

// ── applySkillDeathPenalty ────────────────────────────────────────────────────

describe('applySkillDeathPenalty', () => {
    it('reduces XP by 5% of current level requirement', () => {
        const penalty = Math.floor(skillXpToNextLevel(10) * 0.05);
        expect(applySkillDeathPenalty(500, 10)).toBe(500 - penalty);
    });

    it('does not go below 0', () => {
        expect(applySkillDeathPenalty(0, 10)).toBe(0);
        expect(applySkillDeathPenalty(1, 10)).toBeGreaterThanOrEqual(0);
    });
});

// ── getSkillDamageBonus ───────────────────────────────────────────────────────

describe('getSkillDamageBonus', () => {
    it('returns 0 at skill level 0', () => {
        expect(getSkillDamageBonus(0, 0.05)).toBe(0);
    });

    it('scales linearly with level and damageBonus', () => {
        expect(getSkillDamageBonus(10, 0.05)).toBeCloseTo(0.5);
        expect(getSkillDamageBonus(20, 0.05)).toBeCloseTo(1.0);
    });
});

// ── getClassWeaponSkills ──────────────────────────────────────────────────────

describe('getClassWeaponSkills', () => {
    it('returns sword_fighting AND shielding for Knight', () => {
        const skills = getClassWeaponSkills('Knight');
        expect(skills).toContain('sword_fighting');
        expect(skills).toContain('shielding');
        expect(skills).toHaveLength(2);
    });

    it('returns magic_level for Mage', () => {
        expect(getClassWeaponSkills('Mage')).toEqual(['magic_level']);
    });

    it('returns dagger_fighting for Rogue', () => {
        expect(getClassWeaponSkills('Rogue')).toContain('dagger_fighting');
    });

    it('returns bard_level for Bard', () => {
        expect(getClassWeaponSkills('Bard')).toContain('bard_level');
    });
});

// ── Shielding system ─────────────────────────────────────────────────────────

describe('shieldingXpPerBlock', () => {
    it('returns at least 1 at any level', () => {
        expect(shieldingXpPerBlock(0)).toBeGreaterThanOrEqual(1);
        expect(shieldingXpPerBlock(100)).toBeGreaterThanOrEqual(1);
    });

    it('gives more XP at lower shielding levels', () => {
        expect(shieldingXpPerBlock(1)).toBeGreaterThan(shieldingXpPerBlock(50));
    });
});

describe('getShieldingDefBonus', () => {
    it('returns 0 at level 0', () => {
        expect(getShieldingDefBonus(0)).toBe(0);
    });

    it('returns 1 DEF per 2 levels', () => {
        expect(getShieldingDefBonus(2)).toBe(1);
        expect(getShieldingDefBonus(10)).toBe(5);
        expect(getShieldingDefBonus(20)).toBe(10);
    });
});

describe('getShieldingBlockBonus', () => {
    it('returns 0 at level 0', () => {
        expect(getShieldingBlockBonus(0)).toBe(0);
    });

    it('returns 0.5% per level', () => {
        expect(getShieldingBlockBonus(10)).toBeCloseTo(0.05, 4);
        expect(getShieldingBlockBonus(20)).toBeCloseTo(0.10, 4);
    });
});

// ── MLVL system ──────────────────────────────────────────────────────────────

describe('doesClassGainMlvlFromAttacks', () => {
    it('returns true for Mage, Cleric, Necromancer', () => {
        expect(doesClassGainMlvlFromAttacks('Mage')).toBe(true);
        expect(doesClassGainMlvlFromAttacks('Cleric')).toBe(true);
        expect(doesClassGainMlvlFromAttacks('Necromancer')).toBe(true);
    });

    it('returns false for Knight, Archer, Rogue, Bard', () => {
        expect(doesClassGainMlvlFromAttacks('Knight')).toBe(false);
        expect(doesClassGainMlvlFromAttacks('Archer')).toBe(false);
        expect(doesClassGainMlvlFromAttacks('Rogue')).toBe(false);
        expect(doesClassGainMlvlFromAttacks('Bard')).toBe(false);
    });
});

describe('mlvlXpPerAttack', () => {
    it('returns at least 1 at any MLVL', () => {
        expect(mlvlXpPerAttack(0)).toBeGreaterThanOrEqual(1);
        expect(mlvlXpPerAttack(100)).toBeGreaterThanOrEqual(1);
    });

    it('decreases with higher MLVL', () => {
        expect(mlvlXpPerAttack(0)).toBeGreaterThan(mlvlXpPerAttack(50));
    });
});

describe('mlvlXpPerSkillUse', () => {
    it('gives more XP for magic classes', () => {
        const mageXp = mlvlXpPerSkillUse(10, 'Mage');
        const knightXp = mlvlXpPerSkillUse(10, 'Knight');
        expect(mageXp).toBeGreaterThan(knightXp);
    });

    it('gives at least 1 XP for non-magic classes', () => {
        expect(mlvlXpPerSkillUse(100, 'Knight')).toBeGreaterThanOrEqual(1);
        expect(mlvlXpPerSkillUse(100, 'Archer')).toBeGreaterThanOrEqual(1);
    });

    it('non-magic classes get roughly 1/3 of magic class rate', () => {
        const mageXp = mlvlXpPerSkillUse(0, 'Mage');
        const knightXp = mlvlXpPerSkillUse(0, 'Knight');
        expect(knightXp).toBeLessThanOrEqual(Math.ceil(mageXp / 3) + 1);
    });
});

// ── skillXpProgress ───────────────────────────────────────────────────────────

describe('skillXpProgress', () => {
    it('returns 0 with no XP', () => {
        expect(skillXpProgress(0, 5)).toBe(0);
    });

    it('returns 1 when XP equals requirement', () => {
        expect(skillXpProgress(skillXpToNextLevel(5), 5)).toBe(1);
    });

    it('is clamped to 1', () => {
        expect(skillXpProgress(999_999, 1)).toBe(1);
    });
});

// ── Active Skill Upgrade System ──────────────────────────────────────────────

describe('getSkillUpgradeCost', () => {
    it('returns 100% success rate for +1', () => {
        const cost = getSkillUpgradeCost(1);
        expect(cost.successRate).toBe(100);
        expect(cost.gold).toBe(1000); // 1000 * 1^2.2 = 1000
    });

    it('returns 90% success rate for +2', () => {
        const cost = getSkillUpgradeCost(2);
        expect(cost.successRate).toBe(90);
    });

    it('returns 3% success rate for +10', () => {
        const cost = getSkillUpgradeCost(10);
        expect(cost.successRate).toBe(3);
    });

    it('returns formula-based values for +11 and beyond', () => {
        const cost11 = getSkillUpgradeCost(11);
        expect(cost11.gold).toBeGreaterThan(getSkillUpgradeCost(10).gold);
        expect(cost11.successRate).toBeLessThan(getSkillUpgradeCost(10).successRate);
    });

    it('never goes below 0.1% success rate', () => {
        const cost = getSkillUpgradeCost(50);
        expect(cost.successRate).toBeGreaterThanOrEqual(0.1);
    });

    it('has strictly increasing gold cost', () => {
        for (let l = 1; l < 15; l++) {
            expect(getSkillUpgradeCost(l + 1).gold).toBeGreaterThan(getSkillUpgradeCost(l).gold);
        }
    });
});

describe('getSkillUpgradeBonus', () => {
    it('returns 0 at upgrade level 0', () => {
        expect(getSkillUpgradeBonus(0)).toBe(0);
    });

    it('follows the 1.15^level enhancement curve', () => {
        expect(getSkillUpgradeBonus(1)).toBeCloseTo(0.15, 2);
        expect(getSkillUpgradeBonus(5)).toBeCloseTo(Math.pow(1.15, 5) - 1, 2);
        expect(getSkillUpgradeBonus(10)).toBeCloseTo(Math.pow(1.15, 10) - 1, 2);
    });

    it('continues at 1.08^(level-10) beyond +10', () => {
        const base = Math.pow(1.15, 10);
        expect(getSkillUpgradeBonus(15)).toBeCloseTo(base * Math.pow(1.08, 5) - 1, 2);
        expect(getSkillUpgradeBonus(20)).toBeCloseTo(base * Math.pow(1.08, 10) - 1, 2);
    });
});

describe('rollSkillUpgrade', () => {
    it('+1 always succeeds (100%)', () => {
        for (let i = 0; i < 100; i++) {
            expect(rollSkillUpgrade(1)).toBe(true);
        }
    });
});
