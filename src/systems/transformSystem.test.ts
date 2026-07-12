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
  resolveActiveOpponentSlot,
} from './transformSystem';
import { SPELL_CHEST_LEVELS } from './skillSystem';
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
      const t1Ids = new Set(t1.map((m) => m.id));
      const t2Ids = new Set(t2.map((m) => m.id));
      const overlap = [...t1Ids].filter((id) => t2Ids.has(id));
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

    describe('spell chest drop snaps to a REAL spell level', () => {
      const spellChestOf = (transformId: number): string | undefined =>
        calculateTransformRewards(transformId, 'Knight').consumables
          .map((c) => c.id)
          .find((id) => id.startsWith('spell_chest_'));

      it('level-200 transform (id 5) drops spell_chest_300, NOT spell_chest_200', () => {
        expect(spellChestOf(5)).toBe('spell_chest_300');
      });

      it('orphan transforms snap to the next valid level (500->600, 700->800, 900->1000)', () => {
        expect(spellChestOf(7)).toBe('spell_chest_600');
        expect(spellChestOf(8)).toBe('spell_chest_800');
        expect(spellChestOf(10)).toBe('spell_chest_1000');
      });

      it('valid-level transforms are unchanged (30/50/100/150/300/800/1000)', () => {
        expect(spellChestOf(1)).toBe('spell_chest_30');
        expect(spellChestOf(2)).toBe('spell_chest_50');
        expect(spellChestOf(3)).toBe('spell_chest_100');
        expect(spellChestOf(4)).toBe('spell_chest_150');
        expect(spellChestOf(6)).toBe('spell_chest_300');
        expect(spellChestOf(9)).toBe('spell_chest_800');
        expect(spellChestOf(11)).toBe('spell_chest_1000');
      });

      it('every transform that drops a spell chest uses a level in SPELL_CHEST_LEVELS', () => {
        for (let id = 1; id <= TRANSFORM_COUNT; id++) {
          const chest = spellChestOf(id);
          if (!chest) continue;
          const level = Number(chest.replace('spell_chest_', ''));
          expect(SPELL_CHEST_LEVELS).toContain(level);
        }
      });
    });

    it('should include permanent bonuses scaled per class (Knight T1 baseline)', () => {
      const rewards = calculateTransformRewards(1, 'Knight');
      const b = rewards.permanentBonuses;
      expect(b.hpPercent).toBe(4);
      expect(b.defPercent).toBe(3);
      expect(b.dmgPercent).toBe(3);
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

    it('accumulates 3 Knight transforms (T1+T2+T3)', () => {
      const bonuses = getCumulativeTransformBonuses([1, 2, 3], 'Knight');
      expect(bonuses.hpPercent).toBe(12);
      expect(bonuses.attack).toBe(34);
      expect(bonuses.defense).toBe(61);
      expect(bonuses.flatHp).toBe(1638);
    });

    it('accumulates all 11 Knight transforms', () => {
      const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      const bonuses = getCumulativeTransformBonuses(all, 'Knight');
      expect(bonuses.hpPercent).toBe(44);
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
    it('should multiply HP by 5, ATK & DEF by 3 (2026-06-20: boss is the tankiest slot)', () => {
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
      expect(boss.hp).toBe(500);
      expect(boss.attack).toBe(60);
      expect(boss.defense).toBe(30);
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
    it('should be HP x5, ATK x3, DEF x3', () => {
      expect(TRANSFORM_BOSS_MULTIPLIER.hp).toBe(5.0);
      expect(TRANSFORM_BOSS_MULTIPLIER.atk).toBe(3.0);
      expect(TRANSFORM_BOSS_MULTIPLIER.def).toBe(3.0);
    });
  });


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


describe('resolveActiveOpponentSlot', () => {
  const e = (currentHp: number) => ({ currentHp });

  it('targets the first alive escort (slot 0) when all escorts live', () => {
    expect(resolveActiveOpponentSlot([e(100), e(100), e(100)])).toBe(0);
  });

  it('advances to slot 1 once slot 0 is dead', () => {
    expect(resolveActiveOpponentSlot([e(0), e(100), e(100)])).toBe(1);
  });

  it('advances to slot 2 once slots 0 and 1 are dead', () => {
    expect(resolveActiveOpponentSlot([e(0), e(0), e(100)])).toBe(2);
  });

  it('REGRESSION: returns an escort (NOT the boss=3) while any escort is alive — DOT must not leak onto the boss', () => {
    expect(resolveActiveOpponentSlot([e(0), e(0), e(5)])).not.toBe(3);
    expect(resolveActiveOpponentSlot([e(0), e(0), e(5)])).toBe(2);
  });

  it('falls through to the boss (slot 3) only when every escort is dead', () => {
    expect(resolveActiveOpponentSlot([e(0), e(0), e(0)])).toBe(3);
  });

  it('skips null (already-cleared) escort slots', () => {
    expect(resolveActiveOpponentSlot([null, e(100), null])).toBe(1);
    expect(resolveActiveOpponentSlot([null, null, null])).toBe(3);
  });
});
