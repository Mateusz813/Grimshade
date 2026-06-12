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
  applyTransformTierStats,
  getTransformTierMultiplier,
  getTransformWaveLineup,
  TRANSFORM_COUNT,
  TRANSFORM_BOSS_MULTIPLIER,
  TRANSFORM_TIER_MULTIPLIERS,
  TRANSFORM_SLOT_TIERS,
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

    // 2026-05-21: replaces deleted test "should include permanent bonuses" — now tests current logic
    // Per-transform bonuses are now CLASS-SPECIFIC (CLASS_TRANSFORM_BONUSES) and
    // scale by tier multiplier (1.0 at T1, +0.3 per tier). For Knight T1 the
    // baseline bonuses are: hpPercent=4, defPercent=3, dmgPercent=3, flatHp=420,
    // flatMp=70, attack=9, defense=16, hpRegenFlat=0.5, mpRegenFlat=0.1.
    it('should include permanent bonuses scaled per class (Knight T1 baseline)', () => {
      const rewards = calculateTransformRewards(1, 'Knight');
      const b = rewards.permanentBonuses;
      // Percent bonuses do NOT scale with tier — they're flat per tier.
      expect(b.hpPercent).toBe(4);
      expect(b.defPercent).toBe(3);
      expect(b.dmgPercent).toBe(3);
      // Flat rewards at T1 mult=1.0 equal the baseline values.
      expect(b.flatHp).toBe(420);
      expect(b.flatMp).toBe(70);
      expect(b.attack).toBe(9);
      expect(b.defense).toBe(16);
      expect(b.hpRegenFlat).toBeCloseTo(0.5, 4);
      expect(b.mpRegenFlat).toBeCloseTo(0.1, 4);
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
    // 2026-05-21: replaces deleted test "per-transform bonuses" — now tests current logic
    // The function is now class-aware: with no class passed it returns EMPTY_BONUSES.
    // With a class it returns getClassTransformBonuses(class, tid) — same as the rewards path.
    it('returns class-specific bonuses when class is provided (Knight T1)', () => {
      const b = getTransformBonuses(1, 'Knight');
      expect(b.hpPercent).toBe(4);
      expect(b.flatHp).toBe(420);
      expect(b.attack).toBe(9);
      expect(b.defense).toBe(16);
    });

    it('returns zero bonuses when class is omitted', () => {
      const b = getTransformBonuses(1);
      expect(b.hpPercent).toBe(0);
      expect(b.attack).toBe(0);
      expect(b.flatHp).toBe(0);
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

    // 2026-05-21: replaces deleted test "accumulates 3 transforms correctly" — now tests current logic
    // Cumulative path: for each completed transform id, call
    // getClassTransformBonuses(class, tid) and sum the fields. Tier multiplier
    // grows by 0.3 per tier (T1=1.0, T2=1.3, T3=1.6). floor() is applied PER
    // tier to flat fields, so the cumulative sum is the sum of floors —
    // not the floor of the sum. Percent fields don't scale by tier.
    it('accumulates 3 Knight transforms (T1+T2+T3)', () => {
      const bonuses = getCumulativeTransformBonuses([1, 2, 3], 'Knight');
      // hpPercent: 4 + 4 + 4 = 12 (no tier scaling on percent fields)
      expect(bonuses.hpPercent).toBe(12);
      // attack: floor(9*1.0) + floor(9*1.3) + floor(9*1.6) = 9 + 11 + 14 = 34
      expect(bonuses.attack).toBe(34);
      // defense: floor(16*1.0) + floor(16*1.3) + floor(16*1.6) = 16 + 20 + 25 = 61
      expect(bonuses.defense).toBe(61);
      // flatHp: 420 + floor(420*1.3) + floor(420*1.6) = 420 + 546 + 672 = 1638
      expect(bonuses.flatHp).toBe(1638);
    });

    // 2026-05-21: replaces deleted test "accumulates all 11 transforms" — now tests current logic
    it('accumulates all 11 Knight transforms', () => {
      const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      const bonuses = getCumulativeTransformBonuses(all, 'Knight');
      // hpPercent: 4 * 11 = 44
      expect(bonuses.hpPercent).toBe(44);
      // attack: sum of floor(9 * mult) for mult ∈ {1.0,1.3,...,4.0} = 243
      // (9+11+14+17+19+22+25+27+30+33+36 = 243)
      expect(bonuses.attack).toBe(243);
    });

    it('returns zeros when class is omitted (even with completed transforms)', () => {
      const bonuses = getCumulativeTransformBonuses([1, 2, 3]);
      expect(bonuses.hpPercent).toBe(0);
      expect(bonuses.attack).toBe(0);
      expect(bonuses.flatHp).toBe(0);
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

  // -- Coverage push 2026-05-26 — tier multiplier + wave lineup ------------

  describe('getTransformTierMultiplier', () => {
    it('returns 1.0 for transform 1', () => {
      expect(getTransformTierMultiplier(1)).toBeCloseTo(1.0, 4);
    });

    it('grows by 0.3 per tier', () => {
      expect(getTransformTierMultiplier(2)).toBeCloseTo(1.3, 4);
      expect(getTransformTierMultiplier(6)).toBeCloseTo(2.5, 4);
      expect(getTransformTierMultiplier(11)).toBeCloseTo(4.0, 4);
    });

    it('returns 1.0 for invalid ids (0, negative)', () => {
      expect(getTransformTierMultiplier(0)).toBe(1.0);
      expect(getTransformTierMultiplier(-1)).toBe(1.0);
    });
  });

  describe('TRANSFORM_TIER_MULTIPLIERS', () => {
    it('escalates Normal < Strong < Epic in HP and atk', () => {
      expect(TRANSFORM_TIER_MULTIPLIERS.Strong.hp).toBeGreaterThan(TRANSFORM_TIER_MULTIPLIERS.Normal.hp);
      expect(TRANSFORM_TIER_MULTIPLIERS.Epic.hp).toBeGreaterThan(TRANSFORM_TIER_MULTIPLIERS.Strong.hp);
      expect(TRANSFORM_TIER_MULTIPLIERS.Boss.hp).toBe(TRANSFORM_BOSS_MULTIPLIER.hp);
    });

    it('lists 4 wave tiers (Normal/Strong/Epic/Boss)', () => {
      expect(TRANSFORM_SLOT_TIERS).toEqual(['Normal', 'Strong', 'Epic', 'Boss']);
    });
  });

  describe('applyTransformTierStats', () => {
    const sampleMonster: IMonster = {
      id: 'sample',
      name_pl: 'S',
      name_en: 'S',
      level: 10,
      hp: 100,
      attack: 20,
      defense: 5,
      speed: 10,
      xp: 50,
      gold: [10, 20] as [number, number],
      dropTable: [],
      sprite: '',
    };

    it('Normal tier leaves stats unchanged', () => {
      const r = applyTransformTierStats(sampleMonster, 'Normal');
      expect(r.hp).toBe(100);
      expect(r.attack).toBe(20);
      expect(r.defense).toBe(5);
    });

    it('Strong tier multiplies stats accordingly', () => {
      const r = applyTransformTierStats(sampleMonster, 'Strong');
      expect(r.hp).toBe(200);
      expect(r.attack).toBe(30);
      expect(r.defense).toBe(6);
    });

    it('Epic tier multiplies stats accordingly', () => {
      const r = applyTransformTierStats(sampleMonster, 'Epic');
      expect(r.hp).toBe(400);
      expect(r.attack).toBe(50);
      expect(r.defense).toBe(9);
    });

    it('always returns attack_min/max >= 1', () => {
      const tinyMon: IMonster = { ...sampleMonster, attack: 0 };
      const r = applyTransformTierStats(tinyMon, 'Normal');
      expect(r.attack_min).toBeGreaterThanOrEqual(1);
      expect(r.attack_max).toBeGreaterThanOrEqual(1);
    });

    it('does not mutate the original monster object', () => {
      const original = { ...sampleMonster };
      applyTransformTierStats(sampleMonster, 'Strong');
      expect(sampleMonster).toEqual(original);
    });
  });

  describe('getTransformWaveLineup', () => {
    const bossMonster: IMonster = {
      id: 'wave_boss',
      name_pl: 'B',
      name_en: 'B',
      level: 30,
      hp: 1000,
      attack: 100,
      defense: 20,
      speed: 5,
      xp: 300,
      gold: [50, 100] as [number, number],
      dropTable: [],
      sprite: '',
    };

    it('returns 4 slots in order 0..3 with tiers Normal/Strong/Epic/Boss', () => {
      const wave = getTransformWaveLineup(bossMonster, 30);
      expect(wave.length).toBe(4);
      expect(wave[0].slot).toBe(0);
      expect(wave[0].tier).toBe('Normal');
      expect(wave[3].tier).toBe('Boss');
    });

    it('boss slot returns the passed boss monster unchanged in monster ref', () => {
      const wave = getTransformWaveLineup(bossMonster, 30);
      expect(wave[3].monster).toBe(bossMonster);
    });

    it('escort slots get stamped with unique slot prefixes', () => {
      const wave = getTransformWaveLineup(bossMonster, 30);
      for (let i = 0; i < 3; i++) {
        expect(wave[i].monster.id).toContain(`__slot${i}_`);
        expect(wave[i].monster.level).toBe(30);
      }
    });

    it('boss slot has null spriteImageUrl (uses pre-rendered sprite)', () => {
      const wave = getTransformWaveLineup(bossMonster, 30);
      expect(wave[3].spriteImageUrl).toBeNull();
    });
  });
});
