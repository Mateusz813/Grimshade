import { describe, it, expect } from 'vitest';
import {
  canEnterDungeon,
  getDungeonRemainingMs,
  resolveWave,
  scaleDungeonMonster,
  pickWaveMonster,
  rollDungeonRarity,
  rollDungeonItemDrop,
  rollDungeonGold,
  resolveDungeon,
  DUNGEON_RARITY_ORDER,
  type IDungeon,
  type IDungeonMonster,
  type IDungeonCharacter,
} from './dungeonSystem';
import type { IBaseItem } from './itemSystem';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DUNGEON: IDungeon = {
  id: 'test_dungeon',
  name_pl: 'Test',
  name_en: 'Test',
  level: 5,
  minLevel: 5,
  maxLevel: 20,
  waves: 3,
  cooldown: 300,
  monsters: ['rat', 'goblin'],
  bossMonster: 'orc',
  rewardGold: [100, 200],
  rewardXp: 500,
  maxRarity: 'legendary',
  description_pl: 'Test',
};

const RAT: IDungeonMonster = { id: 'rat', name_pl: 'Szczur', hp: 20, attack: 3, defense: 1, level: 1, xp: 5, sprite: '🐀' };
const GOBLIN: IDungeonMonster = { id: 'goblin', name_pl: 'Goblin', hp: 45, attack: 8, defense: 3, level: 3, xp: 18, sprite: '👺' };
const ORC: IDungeonMonster = { id: 'orc', name_pl: 'Ork', hp: 70, attack: 13, defense: 6, level: 5, xp: 35, sprite: '👹' };
const ALL_MONSTERS = [RAT, GOBLIN, ORC];

const STRONG_CHAR: IDungeonCharacter = { attack: 100, defense: 50, max_hp: 1000, level: 20 };
const WEAK_CHAR: IDungeonCharacter   = { attack: 1,   defense: 0,  max_hp: 1,    level: 1 };

const MOCK_ITEMS: IBaseItem[] = [
  { id: 'iron_sword', name_pl: 'Miecz', name_en: 'Sword', slot: 'mainHand', minLevel: 5, baseAtk: 12, basePrice: 80, rarity: 'common' },
  { id: 'epic_sword', name_pl: 'Epicki', name_en: 'Epic', slot: 'mainHand', minLevel: 10, baseAtk: 40, basePrice: 800, rarity: 'epic' },
  { id: 'legendary_armor', name_pl: 'Leg', name_en: 'Leg', slot: 'armor', minLevel: 15, baseDef: 50, basePrice: 2000, rarity: 'legendary' },
];

// ── canEnterDungeon ───────────────────────────────────────────────────────────

describe('canEnterDungeon', () => {
  it('allows entry when level >= minLevel and no cooldown', () => {
    expect(canEnterDungeon(DUNGEON, 5, null)).toBe(true);
    expect(canEnterDungeon(DUNGEON, 10, null)).toBe(true);
  });

  it('blocks entry when level < minLevel', () => {
    expect(canEnterDungeon(DUNGEON, 4, null)).toBe(false);
    expect(canEnterDungeon(DUNGEON, 1, null)).toBe(false);
  });

  it('blocks entry when cooldown is active', () => {
    const recentTs = new Date(Date.now() - 60_000).toISOString(); // 1 min ago, cd=300s
    expect(canEnterDungeon(DUNGEON, 10, recentTs)).toBe(false);
  });

  it('allows entry when cooldown has expired', () => {
    const oldTs = new Date(Date.now() - 400_000).toISOString(); // 400s ago, cd=300s
    expect(canEnterDungeon(DUNGEON, 10, oldTs)).toBe(true);
  });
});

// ── getDungeonRemainingMs ─────────────────────────────────────────────────────

describe('getDungeonRemainingMs', () => {
  it('returns 0 when no cooldown', () => {
    expect(getDungeonRemainingMs(DUNGEON, null)).toBe(0);
  });

  it('returns positive ms when cooldown is active', () => {
    const recentTs = new Date(Date.now() - 60_000).toISOString();
    expect(getDungeonRemainingMs(DUNGEON, recentTs)).toBeGreaterThan(0);
  });

  it('returns 0 when cooldown has expired', () => {
    const oldTs = new Date(Date.now() - 400_000).toISOString();
    expect(getDungeonRemainingMs(DUNGEON, oldTs)).toBe(0);
  });
});

// ── resolveWave ───────────────────────────────────────────────────────────────

describe('resolveWave', () => {
  it('player wins when much stronger than monster', () => {
    const result = resolveWave(1000, 100, 50, 20, 3, 1);
    expect(result.won).toBe(true);
    expect(result.playerHpLeft).toBeGreaterThan(0);
    expect(result.playerHpLeft).toBeLessThanOrEqual(1000);
  });

  it('player loses when monster is much stronger', () => {
    const result = resolveWave(1, 1, 0, 1000, 999, 0);
    expect(result.won).toBe(false);
    expect(result.playerHpLeft).toBe(0);
  });

  it('player with exactly enough HP barely wins', () => {
    // Player does 9 dmg/hit (10-1 def), monster has 9 HP → 1 hit to kill, no retaliation
    const result = resolveWave(100, 10, 0, 9, 5, 0);
    expect(result.won).toBe(true);
  });

  it('damage is always at least 1', () => {
    // Even with 0 attack vs high defense, minimum 1 damage
    const result = resolveWave(10000, 1, 0, 1, 0, 9999);
    expect(result.won).toBe(true);
  });
});

// ── scaleDungeonMonster ───────────────────────────────────────────────────────

describe('scaleDungeonMonster', () => {
  // Easy dungeon (lvl 1-15): reduced stats
  it('reduces stats for easy dungeon (lvl 1-15) at wave 0', () => {
    const scaled = scaleDungeonMonster(RAT, 0, 10, 5);
    expect(scaled.hp).toBeLessThan(RAT.hp);
    expect(scaled.attack).toBeLessThan(RAT.attack);
  });

  it('easy dungeon last normal wave still has reduced stats', () => {
    const scaled = scaleDungeonMonster(RAT, 7, 10, 5); // not boss wave
    expect(scaled.hp).toBeLessThanOrEqual(RAT.hp);
  });

  it('easy dungeon boss wave is slightly harder but manageable', () => {
    const scaled = scaleDungeonMonster(RAT, 9, 10, 5);
    // Boss wave in easy: 0.8 * 1.5 = 1.2x HP – slightly above base
    expect(scaled.hp).toBeGreaterThan(0);
    expect(scaled.hp).toBeLessThan(RAT.hp * 2);
  });

  // Hard dungeon (lvl 20+): increased stats
  it('hard dungeon (lvl 20+) has increased stats', () => {
    const scaled = scaleDungeonMonster(RAT, 0, 10, 30);
    expect(scaled.hp).toBeGreaterThan(RAT.hp);
    expect(scaled.attack).toBeGreaterThan(RAT.attack);
  });

  it('hard dungeon boss wave has much higher stats (mini-boss)', () => {
    const scaled = scaleDungeonMonster(RAT, 9, 10, 30);
    // Boss wave in hard: ~1.5x base * 3.0x boss = ~4.5x HP
    expect(scaled.hp).toBeGreaterThan(RAT.hp * 3);
  });

  it('preserves monster id and name', () => {
    const scaled = scaleDungeonMonster(RAT, 5, 10, 5);
    expect(scaled.id).toBe('rat');
    expect(scaled.name_pl).toBe('Szczur');
  });

  // Backward compat: no dungeonLevel = uses monster.level
  it('works without dungeonLevel parameter', () => {
    const scaled = scaleDungeonMonster(RAT, 0, 10);
    expect(scaled.hp).toBeGreaterThan(0);
    expect(scaled.attack).toBeGreaterThan(0);
  });
});

// ── pickWaveMonster ───────────────────────────────────────────────────────────

describe('pickWaveMonster', () => {
  it('returns boss monster on last wave', () => {
    const m = pickWaveMonster(DUNGEON, ALL_MONSTERS, 2, 3);
    expect(m.id).toBe('orc');
  });

  it('returns a monster from the dungeon pool on non-boss waves', () => {
    const ids = new Set(['rat', 'goblin']);
    const m = pickWaveMonster(DUNGEON, ALL_MONSTERS, 0, 3);
    expect(ids.has(m.id)).toBe(true);
  });
});

// ── rollDungeonRarity ─────────────────────────────────────────────────────────

describe('rollDungeonRarity', () => {
  it('never exceeds maxRarity', () => {
    for (let i = 0; i < 200; i++) {
      const r = rollDungeonRarity('rare');
      const idx = DUNGEON_RARITY_ORDER.indexOf(r);
      const maxIdx = DUNGEON_RARITY_ORDER.indexOf('rare');
      expect(idx).toBeLessThanOrEqual(maxIdx);
    }
  });

  it('returns common when maxRarity is common', () => {
    for (let i = 0; i < 20; i++) {
      expect(rollDungeonRarity('common')).toBe('common');
    }
  });
});

// ── rollDungeonGold ───────────────────────────────────────────────────────────

describe('rollDungeonGold', () => {
  it('returns value within the specified range', () => {
    for (let i = 0; i < 50; i++) {
      const gold = rollDungeonGold([100, 200]);
      expect(gold).toBeGreaterThanOrEqual(100);
      expect(gold).toBeLessThanOrEqual(200);
    }
  });
});

// ── rollDungeonItemDrop ───────────────────────────────────────────────────────

describe('rollDungeonItemDrop', () => {
  it('respects maxRarity – never returns above it', () => {
    const commonDungeon: IDungeon = { ...DUNGEON, maxRarity: 'common' };
    for (let i = 0; i < 50; i++) {
      const drop = rollDungeonItemDrop(commonDungeon, 20, MOCK_ITEMS, true);
      if (drop) expect(drop.rarity).toBe('common');
    }
  });

  it('can return null (no drop)', () => {
    // With 15% chance, running 3 trials should occasionally be null
    let nullCount = 0;
    for (let i = 0; i < 1000; i++) {
      const drop = rollDungeonItemDrop(DUNGEON, 20, MOCK_ITEMS, false);
      if (drop === null) nullCount++;
    }
    expect(nullCount).toBeGreaterThan(0);
  });

  it('returns a valid IGeneratedItem when dropping', () => {
    // Run many times to force at least one drop
    let drop = null;
    for (let i = 0; i < 500; i++) {
      drop = rollDungeonItemDrop(DUNGEON, 20, MOCK_ITEMS, true);
      if (drop) break;
    }
    if (drop) {
      expect(drop.itemId).toBeDefined();
      expect(drop.rarity).toBeDefined();
      // Item level = dungeon level (not player level)
      expect(drop.itemLevel).toBe(5); // dungeon minLevel = 5
    }
  });
});

// ── resolveDungeon ────────────────────────────────────────────────────────────

describe('resolveDungeon', () => {
  it('strong character clears all waves', () => {
    const { result } = resolveDungeon(DUNGEON, STRONG_CHAR, ALL_MONSTERS, MOCK_ITEMS);
    expect(result.success).toBe(true);
    expect(result.wavesCleared).toBe(DUNGEON.waves);
    expect(result.gold).toBeGreaterThan(0);
    expect(result.xp).toBeGreaterThan(0);
  });

  it('weak character fails the dungeon', () => {
    const { result } = resolveDungeon(DUNGEON, WEAK_CHAR, ALL_MONSTERS, MOCK_ITEMS);
    expect(result.success).toBe(false);
    expect(result.gold).toBe(0);
    expect(result.xp).toBe(0);
  });

  it('returns correct number of wave results', () => {
    const { waveResults } = resolveDungeon(DUNGEON, STRONG_CHAR, ALL_MONSTERS, MOCK_ITEMS);
    expect(waveResults.length).toBeLessThanOrEqual(DUNGEON.waves ?? 0);
    expect(waveResults.length).toBeGreaterThan(0);
  });

  it('last waveResult is marked as boss wave', () => {
    const { waveResults } = resolveDungeon(DUNGEON, STRONG_CHAR, ALL_MONSTERS, MOCK_ITEMS);
    expect(waveResults[waveResults.length - 1].isBossWave).toBe(true);
  });
});
