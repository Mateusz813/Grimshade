import { describe, it, expect } from 'vitest';
import {
  canChallengeBoss,
  getBossRemainingMs,
  rollBossLoot,
  getBossPhaseMultiplier,
  isBossEnraged,
  rollBossGold,
  resolveBoss,
  getScaledBossStats,
  BOSS_HP_MULTIPLIER,
  BOSS_ATK_MULTIPLIER,
  BOSS_DEF_MULTIPLIER,
  BOSS_REWARD_MULTIPLIER,
  getBossXp,
  type IBoss,
  type IBossCharacter,
} from './bossSystem';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BOSS: IBoss = {
  id: 'goblin_king',
  name_pl: 'Król Goblinów',
  name_en: 'Goblin King',
  level: 10,
  hp: 2000,
  attack: 40,
  defense: 20,
  speed: 9,
  xp: 5000,
  gold: [200, 500],
  cooldown: 3600,
  sprite: '👑',
  uniqueDrops: [
    {
      itemId: 'crown',
      chance: 1.0,   // guaranteed for testing
      rarity: 'heroic',
      name_pl: 'Korona',
      name_en: 'Crown',
      slot: 'helmet',
      bonuses: { defense: 15 },
    },
    {
      itemId: 'scepter',
      chance: 0.0,   // never drops
      rarity: 'heroic',
      name_pl: 'Berło',
      name_en: 'Scepter',
      slot: 'mainHand',
      bonuses: { attack: 25 },
    },
  ],
  abilities: [],
  description_pl: 'Test boss',
};

const STRONG_CHAR: IBossCharacter = { attack: 500, defense: 200, max_hp: 50000, level: 50 };
const WEAK_CHAR: IBossCharacter   = { attack: 1,   defense: 0,   max_hp: 1,     level: 1 };

// ── canChallengeBoss ──────────────────────────────────────────────────────────

describe('canChallengeBoss', () => {
  it('allows challenge when level >= boss.level and no cooldown', () => {
    expect(canChallengeBoss(BOSS, 10, null)).toBe(true);
    expect(canChallengeBoss(BOSS, 99, null)).toBe(true);
  });

  it('blocks challenge when level < boss.level', () => {
    expect(canChallengeBoss(BOSS, 9, null)).toBe(false);
    expect(canChallengeBoss(BOSS, 1, null)).toBe(false);
  });

  it('blocks challenge when cooldown is active (defeated 30 min ago)', () => {
    const ts = new Date(Date.now() - 1800_000).toISOString();
    expect(canChallengeBoss(BOSS, 15, ts)).toBe(false);
  });

  it('allows challenge when cooldown has expired (defeated 2 hours ago)', () => {
    const ts = new Date(Date.now() - 7200_000).toISOString();
    expect(canChallengeBoss(BOSS, 15, ts)).toBe(true);
  });
});

// ── getBossRemainingMs ────────────────────────────────────────────────────────

describe('getBossRemainingMs', () => {
  it('returns 0 with no lastDefeatedAt', () => {
    expect(getBossRemainingMs(BOSS, null)).toBe(0);
  });

  it('returns positive ms when recently defeated', () => {
    const ts = new Date(Date.now() - 600_000).toISOString(); // 10 min ago
    expect(getBossRemainingMs(BOSS, ts)).toBeGreaterThan(0);
  });

  it('returns 0 after cooldown expires', () => {
    const ts = new Date(Date.now() - 7200_000).toISOString();
    expect(getBossRemainingMs(BOSS, ts)).toBe(0);
  });
});

// ── getBossPhaseMultiplier ────────────────────────────────────────────────────

describe('getBossPhaseMultiplier', () => {
  it('returns 1.0 above 30% HP', () => {
    expect(getBossPhaseMultiplier(1.0)).toBe(1.0);
    expect(getBossPhaseMultiplier(0.5)).toBe(1.0);
    expect(getBossPhaseMultiplier(0.31)).toBe(1.0);
  });

  it('returns 1.5 below 30% HP (enraged)', () => {
    expect(getBossPhaseMultiplier(0.29)).toBe(1.5);
    expect(getBossPhaseMultiplier(0.1)).toBe(1.5);
    expect(getBossPhaseMultiplier(0.0)).toBe(1.5);
  });
});

// ── isBossEnraged ─────────────────────────────────────────────────────────────

describe('isBossEnraged', () => {
  it('is not enraged above 30%', () => {
    expect(isBossEnraged(700, 1000)).toBe(false);
    expect(isBossEnraged(300, 1000)).toBe(false);
  });

  it('is enraged below 30%', () => {
    expect(isBossEnraged(299, 1000)).toBe(true);
    expect(isBossEnraged(1, 1000)).toBe(true);
  });
});

// ── rollBossLoot ──────────────────────────────────────────────────────────────

describe('rollBossLoot', () => {
  it('drops guaranteed items (chance 1.0)', () => {
    const drops = rollBossLoot(BOSS);
    expect(drops.some((d) => d.itemId === 'crown')).toBe(true);
  });

  it('never drops items with chance 0.0', () => {
    for (let i = 0; i < 20; i++) {
      const drops = rollBossLoot(BOSS);
      expect(drops.some((d) => d.itemId === 'scepter')).toBe(false);
    }
  });

  it('returns empty array when all chances are 0', () => {
    const noBoss: IBoss = { ...BOSS, uniqueDrops: [{ ...BOSS.uniqueDrops![0], chance: 0 }, { ...BOSS.uniqueDrops![1], chance: 0 }] };
    expect(rollBossLoot(noBoss)).toHaveLength(0);
  });
});

// ── rollBossGold ──────────────────────────────────────────────────────────────

describe('rollBossGold', () => {
  it('stays within the boss gold range scaled by BOSS_REWARD_MULTIPLIER', () => {
    for (let i = 0; i < 50; i++) {
      const g = rollBossGold([200, 500]);
      expect(g).toBeGreaterThanOrEqual(200 * BOSS_REWARD_MULTIPLIER);
      expect(g).toBeLessThanOrEqual(500 * BOSS_REWARD_MULTIPLIER);
    }
  });
});

describe('getBossXp', () => {
  it('returns boss.xp multiplied by BOSS_REWARD_MULTIPLIER', () => {
    expect(getBossXp(BOSS)).toBe(BOSS.xp * BOSS_REWARD_MULTIPLIER);
  });
});

// ── getScaledBossStats (party balance) ────────────────────────────────────────

describe('getScaledBossStats', () => {
  it('multiplies HP by BOSS_HP_MULTIPLIER', () => {
    const scaled = getScaledBossStats(BOSS);
    expect(scaled.hp).toBe(Math.floor(BOSS.hp * BOSS_HP_MULTIPLIER));
  });

  it('multiplies ATK by BOSS_ATK_MULTIPLIER', () => {
    const scaled = getScaledBossStats(BOSS);
    expect(scaled.attack).toBe(Math.floor(BOSS.attack * BOSS_ATK_MULTIPLIER));
  });

  it('multiplies DEF by BOSS_DEF_MULTIPLIER', () => {
    const scaled = getScaledBossStats(BOSS);
    expect(scaled.defense).toBe(Math.floor(BOSS.defense * BOSS_DEF_MULTIPLIER));
  });

  it('scaled HP is ~3.5x the base HP', () => {
    const scaled = getScaledBossStats(BOSS);
    expect(scaled.hp / BOSS.hp).toBeCloseTo(BOSS_HP_MULTIPLIER, 1);
  });
});

// ── resolveBoss ───────────────────────────────────────────────────────────────

describe('resolveBoss', () => {
  it('strong character beats the boss', () => {
    const result = resolveBoss(BOSS, STRONG_CHAR);
    expect(result.won).toBe(true);
    expect(result.playerHpLeft).toBeGreaterThan(0);
    expect(result.xp).toBe(BOSS.xp * BOSS_REWARD_MULTIPLIER);
    expect(result.gold).toBeGreaterThan(0);
  });

  it('weak character loses to the boss', () => {
    const result = resolveBoss(BOSS, WEAK_CHAR);
    expect(result.won).toBe(false);
    expect(result.playerHpLeft).toBe(0);
    expect(result.xp).toBe(0);
    expect(result.gold).toBe(0);
  });

  it('winning includes unique drops from rollBossLoot', () => {
    const result = resolveBoss(BOSS, STRONG_CHAR);
    // chance-1.0 drop must appear
    expect(result.drops.some((d) => d.itemId === 'crown')).toBe(true);
  });

  it('losing yields no drops', () => {
    const result = resolveBoss(BOSS, WEAK_CHAR);
    expect(result.drops).toHaveLength(0);
  });
});
