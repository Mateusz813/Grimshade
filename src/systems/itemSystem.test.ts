import { describe, it, expect } from 'vitest';
import {
  buildItem,
  getItemStats,
  getTotalEquipmentStats,
  getSellPrice,
  canEquip,
  RARITY_COLORS,
  flattenItemsData,
  EMPTY_EQUIPMENT,
} from './itemSystem';
import type { IBaseItem, IInventoryItem } from './itemSystem';

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

// ── buildItem ─────────────────────────────────────────────────────────────────

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

// ── getItemStats ──────────────────────────────────────────────────────────────

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

// ── getTotalEquipmentStats ────────────────────────────────────────────────────

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
    expect(total.attack).toBe(15);   // 12 base + 3 bonus
    expect(total.defense).toBe(10);  // 8 base + 2 bonus
  });

  it('should skip slots with null', () => {
    const eq = { ...EMPTY_EQUIPMENT, mainHand: null };
    const total = getTotalEquipmentStats(eq, allItems);
    expect(total.attack).toBe(0);
  });
});

// ── getSellPrice ──────────────────────────────────────────────────────────────

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

// ── canEquip ──────────────────────────────────────────────────────────────────

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

// ── RARITY_COLORS ─────────────────────────────────────────────────────────────

describe('RARITY_COLORS', () => {
  it('should have correct hex for common', () => {
    expect(RARITY_COLORS.common).toBe('#9e9e9e');
  });

  it('should have correct hex for legendary', () => {
    expect(RARITY_COLORS.legendary).toBe('#ffc107');
  });

  it('should have correct hex for mythic', () => {
    expect(RARITY_COLORS.mythic).toBe('#f44336');
  });
});

// ── flattenItemsData ──────────────────────────────────────────────────────────

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
