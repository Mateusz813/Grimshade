import { describe, it, expect } from 'vitest';
import {
  buildItem,
  getItemStats,
  getTotalEquipmentStats,
  getEquippedGearLevel,
  getGearGapMultiplier,
  getSellPrice,
  canEquip,
  RARITY_COLORS,
  flattenItemsData,
  EMPTY_EQUIPMENT,
  getRequiredStoneType,
  getEnhancementCost,
  getEnhancementMultiplier,
  getUpgradedBaseStat,
  getEnhancedBaseStats,
  getBaseStatKeysForSlot,
  isBaseStatKey,
  getEnhancementRefund,
  findBaseItem,
  getItemSlot,
  getItemSlotSafe,
  getItemSlotGroup,
  getItemType,
  getItemIcon,
  canClassEquip,
  getEquipTargetSlot,
  isSlotCompatible,
  getClassSkillBonus,
  formatItemName,
  clearGenInfoCache,
  STONE_FOR_RARITY,
  STONE_CONVERSION_CHAIN,
  CLASS_WEAPON_TYPES,
  CLASS_ARMOR_TYPES,
  RARITY_ORDER,
  RARITY_BONUS_SLOTS,
} from './itemSystem';
import type { IBaseItem, IInventoryItem, IEquipment } from './itemSystem';


const baseSword: IBaseItem = {
  id: 'iron_sword',
  name_pl: 'Żelazny Miecz',
  name_en: 'Iron Sword',
  slot: 'mainHand',
  minLevel: 5,
  baseAtk: 12,
  basePrice: 80,
  rarity: 'common',
};

const baseHelmet: IBaseItem = {
  id: 'iron_helmet',
  name_pl: 'Żelazny Hełm',
  name_en: 'Iron Helmet',
  slot: 'helmet',
  minLevel: 5,
  baseDef: 8,
  basePrice: 120,
  rarity: 'common',
};

const allItems: IBaseItem[] = [baseSword, baseHelmet];

const makeItem = (overrides?: Partial<IInventoryItem>): IInventoryItem => ({
  uuid: 'test-uuid',
  itemId: 'iron_sword',
  rarity: 'common',
  bonuses: {},
  itemLevel: 5,
  ...overrides,
});


describe('buildItem', () => {
  it('should generate unique UUIDs for each call', () => {
    const gen = { itemId: 'iron_sword', rarity: 'common' as const, bonuses: {}, itemLevel: 5 };
    const a = buildItem(gen);
    const b = buildItem(gen);
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('should preserve rarity, bonuses and itemLevel', () => {
    const gen = { itemId: 'dark_staff', rarity: 'epic' as const, bonuses: { attack: 10 }, itemLevel: 20 };
    const item = buildItem(gen);
    expect(item.rarity).toBe('epic');
    expect(item.bonuses.attack).toBe(10);
    expect(item.itemLevel).toBe(20);
  });
});


describe('getItemStats', () => {
  it('should return base attack when no bonuses', () => {
    const stats = getItemStats(makeItem(), baseSword);
    expect(stats.attack).toBe(12);
    expect(stats.defense).toBe(0);
  });

  it('should add bonus attack on top of base', () => {
    const stats = getItemStats(makeItem({ bonuses: { attack: 5 } }), baseSword);
    expect(stats.attack).toBe(17);
  });

  it('should ignore unknown bonus keys', () => {
    const stats = getItemStats(makeItem({ bonuses: { unknown_stat: 999 } }), baseSword);
    expect(stats.attack).toBe(12);
  });

  it('should return base defense for armor', () => {
    const stats = getItemStats(makeItem({ itemId: 'iron_helmet' }), baseHelmet);
    expect(stats.defense).toBe(8);
  });
});


describe('getTotalEquipmentStats', () => {
  it('should return zeros for empty equipment', () => {
    const total = getTotalEquipmentStats(EMPTY_EQUIPMENT, allItems);
    expect(total.attack).toBe(0);
    expect(total.defense).toBe(0);
  });

  it('should sum stats from multiple slots', () => {
    const eq = {
      ...EMPTY_EQUIPMENT,
      mainHand: makeItem({ bonuses: { attack: 3 } }),
      helmet:   makeItem({ itemId: 'iron_helmet', bonuses: { defense: 2 } }),
    };
    const total = getTotalEquipmentStats(eq, allItems);
    expect(total.attack).toBe(15);
    expect(total.defense).toBe(10);
  });

  it('should skip slots with null', () => {
    const eq = { ...EMPTY_EQUIPMENT, mainHand: null };
    const total = getTotalEquipmentStats(eq, allItems);
    expect(total.attack).toBe(0);
  });
});


describe('getSellPrice', () => {
  it('should be less than base price', () => {
    expect(getSellPrice(makeItem({ rarity: 'common' }), baseSword)).toBeLessThan(80);
  });

  it('should be at least 1 gold', () => {
    const cheapItem: IBaseItem = { ...baseSword, basePrice: 1 };
    expect(getSellPrice(makeItem({ rarity: 'common' }), cheapItem)).toBeGreaterThanOrEqual(1);
  });

  it('should scale with rarity (legendary > common)', () => {
    const common    = getSellPrice(makeItem({ rarity: 'common' }),    baseSword);
    const legendary = getSellPrice(makeItem({ rarity: 'legendary' }), baseSword);
    expect(legendary).toBeGreaterThan(common);
  });

  it('should give 100% sell for heroic', () => {
    expect(getSellPrice(makeItem({ rarity: 'heroic' }), baseSword)).toBe(80);
  });
});


describe('canEquip', () => {
  it('should allow equip at exact required level', () => {
    expect(canEquip(makeItem(), 5, allItems)).toBe(true);
  });

  it('should allow equip above required level', () => {
    expect(canEquip(makeItem(), 99, allItems)).toBe(true);
  });

  it('should deny equip below required level', () => {
    expect(canEquip(makeItem(), 4, allItems)).toBe(false);
  });

  it('should deny equip for unknown item', () => {
    expect(canEquip(makeItem({ itemId: 'nonexistent' }), 99, allItems)).toBe(false);
  });
});


describe('RARITY_COLORS', () => {
  it('should have correct hex for common', () => {
    expect(RARITY_COLORS.common).toBe('#9e9e9e');
  });

  it('should have correct hex for legendary (red)', () => {
    expect(RARITY_COLORS.legendary).toBe('#f44336');
  });

  it('should have correct hex for mythic (yellow)', () => {
    expect(RARITY_COLORS.mythic).toBe('#ffc107');
  });

  it('should have correct hex for heroic (purple)', () => {
    expect(RARITY_COLORS.heroic).toBe('#9c27b0');
  });
});


describe('flattenItemsData', () => {
  it('should combine all item categories into one array', () => {
    const json = {
      weapons:     [baseSword],
      armor:       [baseHelmet],
      accessories: [],
    };
    const flat = flattenItemsData(json);
    expect(flat.length).toBe(2);
    expect(flat.map((i) => i.id)).toContain('iron_sword');
    expect(flat.map((i) => i.id)).toContain('iron_helmet');
  });

  it('should handle missing categories gracefully', () => {
    expect(flattenItemsData({})).toEqual([]);
  });
});


describe('getRequiredStoneType', () => {
  it('maps every rarity to its matching stone tier', () => {
    expect(getRequiredStoneType('common')).toBe('common_stone');
    expect(getRequiredStoneType('rare')).toBe('rare_stone');
    expect(getRequiredStoneType('epic')).toBe('epic_stone');
    expect(getRequiredStoneType('legendary')).toBe('legendary_stone');
    expect(getRequiredStoneType('mythic')).toBe('mythic_stone');
    expect(getRequiredStoneType('heroic')).toBe('heroic_stone');
  });
});

describe('getEnhancementCost', () => {
  it('returns the +1 table entry with default common stone', () => {
    const cost = getEnhancementCost(1);
    expect(cost.gold).toBe(100);
    expect(cost.stones).toBe(1);
    expect(cost.successRate).toBe(100);
    expect(cost.stoneType).toBe('common_stone');
  });

  it('returns the +20 entry with mythic stone when itemRarity is mythic', () => {
    const cost = getEnhancementCost(20, 'mythic');
    expect(cost.gold).toBe(200000000);
    expect(cost.stones).toBe(580);
    expect(cost.successRate).toBe(0.01);
    expect(cost.stoneType).toBe('mythic_stone');
  });

  it('extrapolates beyond +20 with exponential growth and decay', () => {
    const at20 = getEnhancementCost(20);
    const at21 = getEnhancementCost(21);
    expect(at21.gold).toBeGreaterThan(at20.gold);
    expect(at21.stones).toBeGreaterThan(at20.stones);
    expect(at21.successRate).toBeLessThan(at20.successRate);
  });

  it('floors successRate at 0.001 (extreme upgrades)', () => {
    const farPast20 = getEnhancementCost(30);
    expect(farPast20.successRate).toBeGreaterThanOrEqual(0.001);
  });
});

describe('getEnhancementMultiplier', () => {
  it('returns 1 for no upgrade', () => {
    expect(getEnhancementMultiplier(0)).toBe(1);
    expect(getEnhancementMultiplier(-5)).toBe(1);
  });

  it('grows +0.10 per level (linear) — 2026-06-20 kill-rate spec: +1 upgrade ≈ +10% kills', () => {
    expect(getEnhancementMultiplier(1)).toBeCloseTo(1.10, 4);
    expect(getEnhancementMultiplier(5)).toBeCloseTo(1.50, 4);
    expect(getEnhancementMultiplier(10)).toBeCloseTo(2.00, 4);
    for (let u = 1; u <= 10; u += 1) {
      expect(getEnhancementMultiplier(u)).toBeGreaterThan(getEnhancementMultiplier(u - 1));
    }
  });

  it('stays linear +0.10 per level beyond 10', () => {
    const at10 = getEnhancementMultiplier(10);
    const at15 = getEnhancementMultiplier(15);
    const at20 = getEnhancementMultiplier(20);
    const at30 = getEnhancementMultiplier(30);
    expect(at10).toBeCloseTo(2.00, 4);
    expect(at15).toBeCloseTo(2.50, 4);
    expect(at20).toBeCloseTo(3.00, 4);
    expect(at30).toBeCloseTo(4.00, 4);
    expect((at30 - at20) / 10).toBeCloseTo(0.10, 4);
  });
});

describe('getUpgradedBaseStat / getEnhancedBaseStats alias', () => {
  it('returns base value when upgradeLevel <= 0 or baseValue <= 0', () => {
    expect(getUpgradedBaseStat(10, 0)).toBe(10);
    expect(getUpgradedBaseStat(0, 5)).toBe(0);
    expect(getUpgradedBaseStat(-2, 5)).toBe(-2);
  });

  it('guarantees at least +N per upgrade level (flat floor) for tiny base stats', () => {
    expect(getUpgradedBaseStat(2, 5)).toBe(7);
  });

  it('takes the multiplied value when it exceeds the flat floor', () => {
    const value = getUpgradedBaseStat(100, 5);
    expect(value).toBeGreaterThan(100 + 5);
    expect(value).toBe(Math.round(100 * getEnhancementMultiplier(5)));
  });

  it('exports the legacy alias getEnhancedBaseStats with identical output', () => {
    expect(getEnhancedBaseStats(50, 3)).toBe(getUpgradedBaseStat(50, 3));
  });
});

describe('getBaseStatKeysForSlot / isBaseStatKey', () => {
  it('weapons scale dmg_min, dmg_max, attack, defense', () => {
    const main = getBaseStatKeysForSlot('mainHand');
    expect(main).toContain('dmg_min');
    expect(main).toContain('dmg_max');
    expect(main).toContain('attack');
    expect(main).toContain('defense');
  });

  it('armor pieces (excluding gloves) scale hp', () => {
    expect(getBaseStatKeysForSlot('helmet')).toEqual(['hp']);
    expect(getBaseStatKeysForSlot('armor')).toEqual(['hp']);
    expect(getBaseStatKeysForSlot('pants')).toEqual(['hp']);
    expect(getBaseStatKeysForSlot('shoulders')).toEqual(['hp']);
    expect(getBaseStatKeysForSlot('boots')).toEqual(['hp']);
  });

  it('gloves and rings scale attack; necklace/earrings scale defense', () => {
    expect(getBaseStatKeysForSlot('gloves')).toEqual(['attack']);
    expect(getBaseStatKeysForSlot('ring1')).toEqual(['attack']);
    expect(getBaseStatKeysForSlot('ring2')).toEqual(['attack']);
    expect(getBaseStatKeysForSlot('necklace')).toEqual(['defense']);
    expect(getBaseStatKeysForSlot('earrings')).toEqual(['defense']);
  });

  it('isBaseStatKey returns false for null slot', () => {
    expect(isBaseStatKey(null, 'hp')).toBe(false);
  });

  it('isBaseStatKey honours per-slot base-stat list', () => {
    expect(isBaseStatKey('helmet', 'hp')).toBe(true);
    expect(isBaseStatKey('helmet', 'attack')).toBe(false);
    expect(isBaseStatKey('mainHand', 'dmg_min')).toBe(true);
    expect(isBaseStatKey('mainHand', 'critChance')).toBe(false);
  });
});

describe('getEnhancementRefund', () => {
  it('returns zero refund when no upgrade', () => {
    expect(getEnhancementRefund(0)).toEqual({ gold: 0, stones: 0, stoneType: '' });
    expect(getEnhancementRefund(-3)).toEqual({ gold: 0, stones: 0, stoneType: '' });
  });

  it('sums all enhancement costs from +1 to target level', () => {
    const refund = getEnhancementRefund(3, 'rare');
    expect(refund.gold).toBe(100 + 500 + 2000);
    expect(refund.stones).toBe(1 + 1 + 2);
    expect(refund.stoneType).toBe('rare_stone');
  });
});


describe('findBaseItem / getItemSlot / getItemSlotSafe', () => {
  it('findBaseItem locates by id', () => {
    expect(findBaseItem('iron_sword', allItems)?.id).toBe('iron_sword');
    expect(findBaseItem('does_not_exist', allItems)).toBeUndefined();
  });

  it('getItemSlot returns null when missing', () => {
    expect(getItemSlot('iron_sword', allItems)).toBe('mainHand');
    expect(getItemSlot('unknown', allItems)).toBeNull();
  });

  it('getItemSlotSafe falls back to generated-item info for unknown legacy items', () => {
    expect(getItemSlotSafe('iron_sword', allItems)).toBe('mainHand');
    expect(getItemSlotSafe('totally_garbage_id', allItems)).toBeNull();
  });
});

describe('getItemSlotGroup', () => {
  it('returns weapon for mainHand/offHand', () => {
    expect(getItemSlotGroup('mainHand')).toBe('weapon');
    expect(getItemSlotGroup('offHand')).toBe('weapon');
  });

  it('returns armor for body-armor slots', () => {
    for (const s of ['helmet', 'armor', 'pants', 'gloves', 'shoulders', 'boots'] as const) {
      expect(getItemSlotGroup(s)).toBe('armor');
    }
  });

  it('returns jewelry for ring/necklace/earrings', () => {
    expect(getItemSlotGroup('ring1')).toBe('jewelry');
    expect(getItemSlotGroup('ring2')).toBe('jewelry');
    expect(getItemSlotGroup('necklace')).toBe('jewelry');
    expect(getItemSlotGroup('earrings')).toBe('jewelry');
  });

  it('returns unknown for null', () => {
    expect(getItemSlotGroup(null)).toBe('unknown');
  });
});

describe('canClassEquip', () => {
  const knightSword: IBaseItem = {
    id: 'kn_sword',
    name_pl: 'k',
    name_en: 'k',
    slot: 'mainHand',
    minLevel: 1,
    basePrice: 1,
    rarity: 'common',
    type: 'sword',
  };
  const bow: IBaseItem = {
    id: 'archer_bow',
    name_pl: 'b',
    name_en: 'b',
    slot: 'mainHand',
    minLevel: 1,
    basePrice: 1,
    rarity: 'common',
    type: 'bow',
  };
  const shield: IBaseItem = {
    id: 'kn_shield',
    name_pl: 's',
    name_en: 's',
    slot: 'offHand',
    minLevel: 1,
    basePrice: 1,
    rarity: 'common',
    type: 'shield',
  };
  const itemList = [knightSword, bow, shield];

  it('allows Knight to equip sword, denies bow', () => {
    expect(canClassEquip('kn_sword', 'mainHand', 'Knight', itemList)).toBe(true);
    expect(canClassEquip('archer_bow', 'mainHand', 'Knight', itemList)).toBe(false);
  });

  it('allows Knight to equip shield in offHand, denies for Archer', () => {
    expect(canClassEquip('kn_shield', 'offHand', 'Knight', itemList)).toBe(true);
    expect(canClassEquip('kn_shield', 'offHand', 'Archer', itemList)).toBe(false);
  });

  it('returns true when item type is unknown (defensive)', () => {
    expect(canClassEquip('mystery_item', 'mainHand', 'Knight', itemList)).toBe(true);
  });

  it('returns true for accessory slots (no class restriction)', () => {
    expect(canClassEquip('any_ring', 'ring1', 'Knight', itemList)).toBe(true);
    expect(canClassEquip('any_ring', 'necklace', 'Bard', itemList)).toBe(true);
  });

  it('rejects armor without recognised prefix (legacy armor)', () => {
    const legacyArmor: IBaseItem = {
      id: 'leather_armor',
      name_pl: 'l',
      name_en: 'l',
      slot: 'armor',
      minLevel: 1,
      basePrice: 1,
      rarity: 'common',
      type: 'leather_armor',
    };
    expect(canClassEquip('leather_armor', 'armor', 'Archer', [...itemList, legacyArmor])).toBe(false);
  });
});

describe('canEquip with class restriction', () => {
  const swordItem: IBaseItem = {
    id: 'magic_sword',
    name_pl: 'm',
    name_en: 'm',
    slot: 'mainHand',
    minLevel: 1,
    basePrice: 1,
    rarity: 'common',
    type: 'sword',
  };
  const items = [swordItem];

  it('rejects when characterClass cannot equip', () => {
    const item = { uuid: 'u', itemId: 'magic_sword', rarity: 'common' as const, bonuses: {}, itemLevel: 1 };
    expect(canEquip(item, 100, items, 'Mage')).toBe(false);
    expect(canEquip(item, 100, items, 'Knight')).toBe(true);
  });
});


describe('getEquipTargetSlot', () => {
  const emptyEq: IEquipment = { ...EMPTY_EQUIPMENT };
  const ringItem: IInventoryItem = { uuid: 'r', itemId: 'gold_ring', rarity: 'common', bonuses: {}, itemLevel: 1 };
  const daggerItem: IInventoryItem = { uuid: 'd', itemId: 'rusty_dagger', rarity: 'common', bonuses: {}, itemLevel: 1 };

  it('returns native ring slot when empty', () => {
    expect(getEquipTargetSlot('ring1', 'gold_ring', 'Knight', emptyEq, [])).toBe('ring1');
  });

  it('falls back to other ring slot when native occupied', () => {
    const eq = { ...emptyEq, ring1: ringItem };
    expect(getEquipTargetSlot('ring1', 'gold_ring', 'Knight', eq, [])).toBe('ring2');
  });

  it('returns base when both ring slots occupied (swap path)', () => {
    const eq = { ...emptyEq, ring1: ringItem, ring2: ringItem };
    expect(getEquipTargetSlot('ring1', 'gold_ring', 'Knight', eq, [])).toBe('ring1');
  });

  it('Rogue dagger goes mainHand -> offHand when main occupied', () => {
    const daggerBase: IBaseItem = { id: 'rusty_dagger', name_pl: 'd', name_en: 'd', slot: 'mainHand', minLevel: 1, basePrice: 1, rarity: 'common', type: 'dagger' };
    const eq = { ...emptyEq, mainHand: daggerItem };
    expect(getEquipTargetSlot('mainHand', 'rusty_dagger', 'Rogue', eq, [daggerBase])).toBe('offHand');
  });

  it('Rogue dagger from offHand -> mainHand when offHand occupied and mainHand empty', () => {
    const daggerBase: IBaseItem = { id: 'rusty_dagger', name_pl: 'd', name_en: 'd', slot: 'mainHand', minLevel: 1, basePrice: 1, rarity: 'common', type: 'dagger' };
    const eq = { ...emptyEq, offHand: daggerItem };
    expect(getEquipTargetSlot('offHand', 'rusty_dagger', 'Rogue', eq, [daggerBase])).toBe('mainHand');
  });

  it('non-Rogue uses default slot even with dagger', () => {
    const daggerBase: IBaseItem = { id: 'rusty_dagger', name_pl: 'd', name_en: 'd', slot: 'mainHand', minLevel: 1, basePrice: 1, rarity: 'common', type: 'dagger' };
    expect(getEquipTargetSlot('mainHand', 'rusty_dagger', 'Knight', emptyEq, [daggerBase])).toBe('mainHand');
  });

  it('non-ring non-dagger items pass through their base slot', () => {
    expect(getEquipTargetSlot('helmet', 'iron_helmet', 'Knight', emptyEq, allItems)).toBe('helmet');
  });
});

describe('isSlotCompatible', () => {
  it('returns true for identical base and target slots', () => {
    expect(isSlotCompatible('helmet', 'helmet', 'iron_helmet', 'Knight', allItems)).toBe(true);
  });

  it('allows ring1 <-> ring2 transposition', () => {
    expect(isSlotCompatible('ring1', 'ring2', 'gold_ring', 'Knight', [])).toBe(true);
    expect(isSlotCompatible('ring2', 'ring1', 'gold_ring', 'Knight', [])).toBe(true);
  });

  it('allows Rogue dagger across mainHand <-> offHand', () => {
    const daggerBase: IBaseItem = { id: 'rusty_dagger', name_pl: 'd', name_en: 'd', slot: 'mainHand', minLevel: 1, basePrice: 1, rarity: 'common', type: 'dagger' };
    expect(isSlotCompatible('mainHand', 'offHand', 'rusty_dagger', 'Rogue', [daggerBase])).toBe(true);
  });

  it('rejects Knight dagger across slots (only Rogue can dual)', () => {
    const daggerBase: IBaseItem = { id: 'rusty_dagger', name_pl: 'd', name_en: 'd', slot: 'mainHand', minLevel: 1, basePrice: 1, rarity: 'common', type: 'dagger' };
    expect(isSlotCompatible('mainHand', 'offHand', 'rusty_dagger', 'Knight', [daggerBase])).toBe(false);
  });

  it('rejects helmet -> boots (incompatible)', () => {
    expect(isSlotCompatible('helmet', 'boots', 'iron_helmet', 'Knight', allItems)).toBe(false);
  });
});


describe('getClassSkillBonus', () => {
  it('Knight scales by sword_fighting level × 0.5', () => {
    const b = getClassSkillBonus('Knight', { sword_fighting: 100 });
    expect(b.skillBonus).toBe(50);
    expect(b.extraCritChance).toBe(0);
  });

  it('Mage/Necromancer scale by magic_level × 0.8', () => {
    expect(getClassSkillBonus('Mage', { magic_level: 50 }).skillBonus).toBe(40);
    expect(getClassSkillBonus('Necromancer', { magic_level: 50 }).skillBonus).toBe(40);
  });

  it('Cleric scales by magic_level × 0.6', () => {
    expect(getClassSkillBonus('Cleric', { magic_level: 50 }).skillBonus).toBe(30);
  });

  it('Archer scales by distance_fighting × 0.4 + crit', () => {
    const b = getClassSkillBonus('Archer', { distance_fighting: 100 });
    expect(b.skillBonus).toBe(40);
    expect(b.extraCritChance).toBeCloseTo(0.3, 4);
  });

  it('Rogue scales by dagger_fighting × 0.3 + crit', () => {
    const b = getClassSkillBonus('Rogue', { dagger_fighting: 100 });
    expect(b.skillBonus).toBe(30);
    expect(b.extraCritChance).toBeCloseTo(0.5, 4);
  });

  it('Bard scales by bard_level × 0.5', () => {
    expect(getClassSkillBonus('Bard', { bard_level: 80 }).skillBonus).toBe(40);
  });

  it('unknown class returns zeros', () => {
    expect(getClassSkillBonus('Unknown', { magic_level: 100 })).toEqual({ skillBonus: 0, extraCritChance: 0 });
  });

  it('falls back to 0 for missing skill entries', () => {
    expect(getClassSkillBonus('Knight', {}).skillBonus).toBe(0);
  });
});


describe('getItemType (legacy id fallback)', () => {
  it('detects sword family by name', () => {
    expect(getItemType('iron_sword', [])).toBe('sword');
    expect(getItemType('sword_of_beginnings', [])).toBe('sword');
  });

  it('detects mage staves and dead_staff', () => {
    expect(getItemType('apprentice_staff', [])).toBe('staff');
    expect(getItemType('dead_staff', [])).toBe('dead_staff');
  });

  it('detects bow / dagger / harp / wand', () => {
    expect(getItemType('short_bow', [])).toBe('bow');
    expect(getItemType('rusty_dagger', [])).toBe('dagger');
    expect(getItemType('lute', [])).toBe('harp');
    expect(getItemType('holy_wand', [])).toBe('holy_wand');
  });

  it('detects offhands', () => {
    expect(getItemType('iron_shield', [])).toBe('shield');
    expect(getItemType('magic_spellbook', [])).toBe('spellbook');
    expect(getItemType('holy_cross', [])).toBe('holy_cross');
    expect(getItemType('leather_quiver', [])).toBe('quiver');
    expect(getItemType('voodoo_doll', [])).toBe('voodoo_doll');
    expect(getItemType('lucky_talisman', [])).toBe('talisman');
  });

  it('detects armor prefixes', () => {
    expect(getItemType('heavy_helmet', [])).toBe('heavy_helmet');
    expect(getItemType('magic_armor', [])).toBe('magic_armor');
    expect(getItemType('light_boots', [])).toBe('light_boots');
  });

  it('returns null when truly unknown', () => {
    expect(getItemType('totally_unknown_garbage', [])).toBeNull();
  });

  it('prefers base-item type field when supplied', () => {
    const custom: IBaseItem = {
      id: 'custom_id',
      name_pl: 'c',
      name_en: 'c',
      slot: 'mainHand',
      minLevel: 1,
      basePrice: 1,
      rarity: 'common',
      type: 'CUSTOM_TYPE',
    };
    expect(getItemType('custom_id', [custom])).toBe('CUSTOM_TYPE');
  });
});

describe('getItemIcon', () => {
  it('returns potion emoji for hp_potion ids without art', () => {
    expect(getItemIcon('hp_potion_sm', '', [])).toBe('red-heart');
    expect(getItemIcon('mp_potion_mega', '', [])).toBe('droplet');
  });

  it('returns elixir emoji for boost ids', () => {
    expect(getItemIcon('xp_elixir', '', [])).toBe('alembic');
    expect(getItemIcon('skill_boost_potion', '', [])).toBe('alembic');
  });

  it('returns icon string (emoji or asset URL) for weapon name fallbacks', () => {
    const swordIcon = getItemIcon('runic_blade', '', []);
    expect(swordIcon.length).toBeGreaterThan(0);
    expect(swordIcon).not.toBe('package');
    const wandIcon = getItemIcon('crystal_wand', '', []);
    expect(wandIcon.length).toBeGreaterThan(0);
    expect(wandIcon).not.toBe('package');
  });

  it('falls back to slot icon when type, art and name detection all miss', () => {
    expect(getItemIcon('mystery_gear', 'helmet', [])).toBe('rescue-worker-s-helmet');
  });

  it('returns :package: for fully unknown slot', () => {
    expect(getItemIcon('mystery_thing', 'unknown_slot', [])).toBe('package');
  });
});


describe('formatItemName', () => {
  it('converts snake_case to Title Case', () => {
    expect(formatItemName('iron_helmet')).toBe('Iron Helmet');
    expect(formatItemName('greater_health_potion')).toBe('Greater Health Potion');
  });

  it('handles single word', () => {
    expect(formatItemName('sword')).toBe('Sword');
  });
});

describe('STONE_CONVERSION_CHAIN + STONE_FOR_RARITY', () => {
  it('lower stone converts to next-tier stone', () => {
    expect(STONE_CONVERSION_CHAIN['common_stone']).toBe('rare_stone');
    expect(STONE_CONVERSION_CHAIN['legendary_stone']).toBe('mythic_stone');
    expect(STONE_CONVERSION_CHAIN['mythic_stone']).toBe('heroic_stone');
  });

  it('heroic stone has no conversion target (top tier)', () => {
    expect(STONE_CONVERSION_CHAIN['heroic_stone']).toBeUndefined();
  });

  it('STONE_FOR_RARITY mirrors RARITY_ORDER 1-to-1', () => {
    expect(Object.keys(STONE_FOR_RARITY)).toEqual(['common', 'rare', 'epic', 'legendary', 'mythic', 'heroic']);
  });
});

describe('CLASS_* maps and RARITY_BONUS_SLOTS exports', () => {
  it('every class has a primary weapon and armor prefix', () => {
    const classes = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'];
    for (const c of classes) {
      expect(CLASS_WEAPON_TYPES[c]?.length).toBeGreaterThan(0);
      expect(CLASS_ARMOR_TYPES[c]).toBeDefined();
    }
  });

  it('RARITY_BONUS_SLOTS increases with rarity (with heroic being top at 5)', () => {
    expect(RARITY_BONUS_SLOTS.common).toBe(0);
    expect(RARITY_BONUS_SLOTS.heroic).toBe(5);
    expect(RARITY_BONUS_SLOTS.legendary).toBeGreaterThan(RARITY_BONUS_SLOTS.epic);
    expect(RARITY_BONUS_SLOTS.mythic).toBeGreaterThan(RARITY_BONUS_SLOTS.legendary);
    expect(RARITY_BONUS_SLOTS.heroic).toBeGreaterThan(RARITY_BONUS_SLOTS.mythic);
  });

  it('RARITY_ORDER lists rarities lowest to highest', () => {
    expect(RARITY_ORDER[0]).toBe('common');
    expect(RARITY_ORDER[RARITY_ORDER.length - 1]).toBe('heroic');
  });
});


describe('clearGenInfoCache', () => {
  it('does not throw and can be invoked repeatedly', () => {
    expect(() => clearGenInfoCache()).not.toThrow();
    expect(() => clearGenInfoCache()).not.toThrow();
  });
});


describe('getGearGapMultiplier', () => {
  it('returns 1 when gear level >= content level (fully geared)', () => {
    expect(getGearGapMultiplier(100, 100)).toBe(1);
    expect(getGearGapMultiplier(120, 100)).toBe(1);
  });

  it('returns (gear/content)^2 = 0.25 when gear is half the content level', () => {
    expect(getGearGapMultiplier(50, 100)).toBeCloseTo(0.25, 10);
  });

  it('floors at 0.05 when gear is far below content (gear = content x0.1)', () => {
    expect(getGearGapMultiplier(10, 100)).toBe(0.05);
  });

  it('returns 1 (no penalty) when content level is 0 or negative', () => {
    expect(getGearGapMultiplier(1, 0)).toBe(1);
    expect(getGearGapMultiplier(50, -5)).toBe(1);
  });
});

describe('getEquippedGearLevel', () => {
  const genItem = (itemId: string, itemLevel: number): IInventoryItem => ({
    uuid: `u-${itemId}`,
    itemId,
    rarity: 'common',
    bonuses: {},
    itemLevel,
  });

  it('averages the parsed item levels of equipped generated items (rounded)', () => {
    const equipment: Partial<IEquipment> = {
      mainHand: genItem('sword_lvl10_rare', 10),
      helmet: genItem('heavy_helmet_lvl20_epic', 20),
    };
    expect(getEquippedGearLevel(equipment)).toBe(15);
  });

  it('rounds the average to the nearest integer', () => {
    const equipment: Partial<IEquipment> = {
      mainHand: genItem('sword_lvl10_rare', 10),
      offHand: genItem('shield_lvl11_rare', 11),
    };
    expect(getEquippedGearLevel(equipment)).toBe(11);
  });

  it('returns 1 for empty equipment', () => {
    expect(getEquippedGearLevel({})).toBe(1);
    expect(getEquippedGearLevel(EMPTY_EQUIPMENT)).toBe(1);
  });

  it('ignores null slots and non-generated (legacy) item ids', () => {
    const equipment: Partial<IEquipment> = {
      mainHand: genItem('sword_lvl30_legendary', 30),
      offHand: genItem('iron_sword', 5),
      helmet: null,
    };
    expect(getEquippedGearLevel(equipment)).toBe(30);
  });
});
