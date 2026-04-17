import { describe, it, expect } from 'vitest';
import {
  getAllTransforms,
  getTransformById,
  getTransformMonsters,
  getTransformMonsterCount,
  calculateTransformRewards,
  getTransformColor,
  getTransformBonuses,
  getCumulativeTransformBonuses,
  isLevelSufficient,
  getNextAvailableTransform,
  getHighestCompletedTransform,
  getActiveAvatar,
  applyTransformBossStats,
  TRANSFORM_COUNT,
  TRANSFORM_BOSS_MULTIPLIER,
} from './transformSystem';
import type { IMonster } from '../types/monster';

describe('transformSystem', () => {
  describe('getAllTransforms', () => {
    it('should return all 11 transforms', () => {
      const transforms = getAllTransforms();
      expect(transforms).toHaveLength(11);
    });

    it('should have transforms in order 1 to 11', () => {
      const transforms = getAllTransforms();
      for (let i = 0; i < transforms.length; i++) {
        expect(transforms[i].id).toBe(i + 1);
      }
    });
  });

  describe('TRANSFORM_COUNT', () => {
    it('should be 11', () => {
      expect(TRANSFORM_COUNT).toBe(11);
    });
  });

  describe('getTransformById', () => {
    it('should return transform 1 with level 30', () => {
      const t = getTransformById(1);
      expect(t).toBeDefined();
      expect(t!.level).toBe(30);
      expect(t!.color).toBe('#e53935');
    });

    it('should return transform 8 with gradient colors', () => {
      const t = getTransformById(8);
      expect(t).toBeDefined();
      expect(t!.gradientColors).toEqual(['#ffc107', '#212121']);
      expect(t!.color).toBeNull();
    });

    it('should return undefined for invalid ID', () => {
      expect(getTransformById(0)).toBeUndefined();
      expect(getTransformById(12)).toBeUndefined();
      expect(getTransformById(-1)).toBeUndefined();
    });
  });

  describe('getTransformMonsters', () => {
    it('should return monsters in level range 1-30 for transform 1', () => {
      const monsters = getTransformMonsters(1);
      expect(monsters.length).toBeGreaterThan(0);
      for (const m of monsters) {
        expect(m.level).toBeGreaterThanOrEqual(1);
        expect(m.level).toBeLessThanOrEqual(30);
      }
    });

    it('should return monsters in level range 30-50 for transform 2', () => {
      const monsters = getTransformMonsters(2);
      expect(monsters.length).toBeGreaterThan(0);
      for (const m of monsters) {
        expect(m.level).toBeGreaterThanOrEqual(30);
        expect(m.level).toBeLessThanOrEqual(50);
      }
    });

    it('should return empty array for invalid transform ID', () => {
      expect(getTransformMonsters(0)).toEqual([]);
      expect(getTransformMonsters(99)).toEqual([]);
    });

    it('should not have overlapping monsters between T1 and T2 except boundary', () => {
      const t1 = getTransformMonsters(1);
      const t2 = getTransformMonsters(2);
      // lvl 30 monster (demon_imp) should be in T1 (range 1-30) AND T2 (range 30-50)
      const t1Ids = new Set(t1.map((m) => m.id));
      const t2Ids = new Set(t2.map((m) => m.id));
      const overlap = [...t1Ids].filter((id) => t2Ids.has(id));
      // Overlap should only be monsters at exactly level 30
      for (const id of overlap) {
        const monster = t1.find((m) => m.id === id);
        expect(monster?.level).toBe(30);
      }
    });
  });

  describe('getTransformMonsterCount', () => {
    it('should return a positive number for valid transforms', () => {
      for (let i = 1; i <= 11; i++) {
        expect(getTransformMonsterCount(i)).toBeGreaterThan(0);
      }
    });

    it('should return 0 for invalid transform', () => {
      expect(getTransformMonsterCount(0)).toBe(0);
    });
  });

  describe('calculateTransformRewards', () => {
    it('should generate a mythic weapon for Knight', () => {
      const rewards = calculateTransformRewards(1, 'Knight');
      expect(rewards.weapon).not.toBeNull();
      expect(rewards.weapon!.rarity).toBe('mythic');
      expect(rewards.weapon!.itemId).toContain('sword');
    });

    it('should generate a mythic weapon for Mage', () => {
      const rewards = calculateTransformRewards(3, 'Mage');
      expect(rewards.weapon).not.toBeNull();
      expect(rewards.weapon!.rarity).toBe('mythic');
      expect(rewards.weapon!.itemId).toContain('staff');
    });

    it('should include consumable rewards', () => {
      const rewards = calculateTransformRewards(1, 'Knight');
      expect(rewards.consumables.length).toBeGreaterThan(0);
      const xpElixir = rewards.consumables.find((c) => c.id === 'premium_xp_elixir');
      expect(xpElixir).toBeDefined();
      expect(xpElixir!.count).toBe(5);
    });

    it('should include permanent bonuses', () => {
      const rewards = calculateTransformRewards(1, 'Knight');
      expect(rewards.permanentBonuses.hpPercent).toBe(3);
      expect(rewards.permanentBonuses.attack).toBe(2);
      expect(rewards.permanentBonuses.defense).toBe(2);
      expect(rewards.permanentBonuses.classSkillBonus).toBe(1);
    });

    it('should return zero bonuses for invalid transform', () => {
      const rewards = calculateTransformRewards(0, 'Knight');
      expect(rewards.weapon).toBeNull();
      expect(rewards.permanentBonuses.hpPercent).toBe(0);
    });
  });

  describe('getTransformColor', () => {
    it('should return solid color for transform 1', () => {
      const color = getTransformColor(1);
      expect(color.solid).toBe('#e53935');
      expect(color.gradient).toBeNull();
      expect(color.css).toBe('#e53935');
    });

    it('should return gradient for transform 8', () => {
      const color = getTransformColor(8);
      expect(color.solid).toBeNull();
      expect(color.gradient).toEqual(['#ffc107', '#212121']);
      expect(color.css).toContain('linear-gradient');
    });

    it('should return fallback for invalid transform', () => {
      const color = getTransformColor(0);
      expect(color.css).toBe('#9e9e9e');
    });
  });

  describe('getTransformBonuses', () => {
    it('should return per-transform bonuses', () => {
      const bonuses = getTransformBonuses(1);
      expect(bonuses.hpPercent).toBe(3);
      expect(bonuses.mpPercent).toBe(3);
      expect(bonuses.hpRegen).toBe(0.05);
      expect(bonuses.mpRegen).toBe(0.05);
      expect(bonuses.attack).toBe(2);
      expect(bonuses.defense).toBe(2);
      expect(bonuses.classSkillBonus).toBe(1);
    });

    it('should return zeros for invalid transform', () => {
      const bonuses = getTransformBonuses(0);
      expect(bonuses.hpPercent).toBe(0);
      expect(bonuses.attack).toBe(0);
    });
  });

  describe('getCumulativeTransformBonuses', () => {
    it('should return zeros for no completed transforms', () => {
      const bonuses = getCumulativeTransformBonuses([]);
      expect(bonuses.hpPercent).toBe(0);
      expect(bonuses.attack).toBe(0);
    });

    it('should accumulate bonuses from multiple transforms', () => {
      const bonuses = getCumulativeTransformBonuses([1, 2, 3]);
      expect(bonuses.hpPercent).toBe(9); // 3 * 3
      expect(bonuses.attack).toBe(6); // 3 * 2
      expect(bonuses.defense).toBe(6);
      expect(bonuses.classSkillBonus).toBe(3);
    });

    it('should accumulate all 11 transforms correctly', () => {
      const allIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      const bonuses = getCumulativeTransformBonuses(allIds);
      expect(bonuses.hpPercent).toBe(33); // 11 * 3
      expect(bonuses.attack).toBe(22); // 11 * 2
      expect(bonuses.hpRegen).toBeCloseTo(0.55); // 11 * 0.05
    });
  });

  describe('isLevelSufficient', () => {
    it('should return true when level meets requirement', () => {
      expect(isLevelSufficient(30, 1)).toBe(true);
      expect(isLevelSufficient(100, 1)).toBe(true);
    });

    it('should return false when level is too low', () => {
      expect(isLevelSufficient(29, 1)).toBe(false);
      expect(isLevelSufficient(1, 2)).toBe(false);
    });

    it('should return false for invalid transform', () => {
      expect(isLevelSufficient(1000, 0)).toBe(false);
    });
  });

  describe('getNextAvailableTransform', () => {
    it('should return transform 1 when none completed and level sufficient', () => {
      const next = getNextAvailableTransform([], 30);
      expect(next).not.toBeNull();
      expect(next!.id).toBe(1);
    });

    it('should return null when level too low for next transform', () => {
      const next = getNextAvailableTransform([], 10);
      expect(next).toBeNull();
    });

    it('should return transform 2 when transform 1 is completed', () => {
      const next = getNextAvailableTransform([1], 50);
      expect(next).not.toBeNull();
      expect(next!.id).toBe(2);
    });

    it('should return null when all transforms completed', () => {
      const allIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      const next = getNextAvailableTransform(allIds, 1000);
      expect(next).toBeNull();
    });

    it('should respect order – cannot skip to T3 without T1+T2', () => {
      // Even at lvl 1000 with T1 completed, next is T2
      const next = getNextAvailableTransform([1], 1000);
      expect(next!.id).toBe(2);
    });
  });

  describe('getHighestCompletedTransform', () => {
    it('should return 0 for no completed transforms', () => {
      expect(getHighestCompletedTransform([])).toBe(0);
    });

    it('should return highest ID', () => {
      expect(getHighestCompletedTransform([1, 2, 3])).toBe(3);
      expect(getHighestCompletedTransform([1])).toBe(1);
    });
  });

  describe('getActiveAvatar', () => {
    it('should return null when no transforms completed', () => {
      expect(getActiveAvatar('Knight', [])).toBeNull();
    });

    it('should return correct avatar filename', () => {
      expect(getActiveAvatar('Knight', [1])).toBe('knight-1.png');
      expect(getActiveAvatar('Mage', [1, 2, 3])).toBe('mage-3.png');
      expect(getActiveAvatar('Archer', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe('archer-11.png');
    });
  });

  describe('applyTransformBossStats', () => {
    it('should multiply HP, ATK, DEF by 8', () => {
      const monster: IMonster = {
        id: 'test',
        name_pl: 'Test',
        name_en: 'Test',
        level: 10,
        hp: 100,
        attack: 20,
        defense: 10,
        speed: 5,
        xp: 50,
        gold: [5, 10] as [number, number],
        dropTable: [],
        sprite: '',
      };

      const boss = applyTransformBossStats(monster);
      expect(boss.hp).toBe(800);
      expect(boss.attack).toBe(160);
      expect(boss.defense).toBe(80);
      // Other stats unchanged
      expect(boss.speed).toBe(5);
      expect(boss.xp).toBe(50);
      expect(boss.id).toBe('test');
    });

    it('should not mutate the original monster', () => {
      const original: IMonster = {
        id: 'orig',
        name_pl: 'O',
        name_en: 'O',
        level: 1,
        hp: 30,
        attack: 7,
        defense: 2,
        speed: 5,
        xp: 3,
        gold: [1, 3] as [number, number],
        dropTable: [],
        sprite: '',
      };

      applyTransformBossStats(original);
      expect(original.hp).toBe(30);
      expect(original.attack).toBe(7);
      expect(original.defense).toBe(2);
    });
  });

  describe('TRANSFORM_BOSS_MULTIPLIER', () => {
    it('should be x8 for all stats', () => {
      expect(TRANSFORM_BOSS_MULTIPLIER.hp).toBe(8.0);
      expect(TRANSFORM_BOSS_MULTIPLIER.atk).toBe(8.0);
      expect(TRANSFORM_BOSS_MULTIPLIER.def).toBe(8.0);
    });
  });
});
