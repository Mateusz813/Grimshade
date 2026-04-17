import { describe, it, expect } from 'vitest';
import {
  MAX_PARTY_SIZE,
  calculateDropMultiplier,
  calculateDifficultyMultiplier,
  canJoinParty,
  isFull,
  getHumanCount,
  getBotCount,
  shouldSuggestBot,
  createBotHelper,
  getXpShare,
  getGoldShare,
  getPartySummary,
  generatePartyId,
  getPartyBuffs,
  applyPartyBuffs,
  hasOptimalComposition,
  getCompositionBonus,
  calculateHelpDamage,
  type IPartyMember,
  type IPartyInfo,
} from './partySystem';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeHuman = (id: string, cls: IPartyMember['class'] = 'Knight', level = 10): IPartyMember => ({
  id, name: `Player${id}`, class: cls, level, hp: 200, maxHp: 200, isBot: false, isOnline: true,
});

const makeBot = (): IPartyMember => ({
  id: 'bot1', name: 'Bot Pancerny', class: 'Knight', level: 10, hp: 200, maxHp: 200, isBot: true, isOnline: true,
});

// ── calculateDropMultiplier ───────────────────────────────────────────────────

describe('calculateDropMultiplier', () => {
  it('returns 1.0 for solo (party size 1)', () => {
    expect(calculateDropMultiplier(1)).toBe(1.0);
  });

  it('returns 1.15 for 2 players', () => {
    expect(calculateDropMultiplier(2)).toBeCloseTo(1.15);
  });

  it('returns 1.45 for max party (4)', () => {
    expect(calculateDropMultiplier(4)).toBeCloseTo(1.45);
  });

  it('clamps at MAX_PARTY_SIZE', () => {
    expect(calculateDropMultiplier(100)).toBe(calculateDropMultiplier(MAX_PARTY_SIZE));
  });

  it('clamps minimum at 1 for invalid input', () => {
    expect(calculateDropMultiplier(0)).toBe(1.0);
    expect(calculateDropMultiplier(-5)).toBe(1.0);
  });
});

// ── calculateDifficultyMultiplier ─────────────────────────────────────────────

describe('calculateDifficultyMultiplier', () => {
  it('returns 1.0 for solo', () => {
    expect(calculateDifficultyMultiplier(1)).toBe(1.0);
  });

  it('returns 1.2 for 2 players', () => {
    expect(calculateDifficultyMultiplier(2)).toBeCloseTo(1.2);
  });

  it('returns 1.6 for max party (4)', () => {
    expect(calculateDifficultyMultiplier(4)).toBeCloseTo(1.6);
  });

  it('is always >= drop multiplier for the same size', () => {
    for (let s = 1; s <= 4; s++) {
      expect(calculateDifficultyMultiplier(s)).toBeGreaterThanOrEqual(calculateDropMultiplier(s));
    }
  });
});

// ── canJoinParty / isFull ─────────────────────────────────────────────────────

describe('canJoinParty', () => {
  it('allows joining below max size', () => {
    expect(canJoinParty(0)).toBe(true);
    expect(canJoinParty(3)).toBe(true);
  });

  it('blocks joining at or above max size', () => {
    expect(canJoinParty(4)).toBe(false);
    expect(canJoinParty(10)).toBe(false);
  });
});

describe('isFull', () => {
  const makeParty = (size: number): IPartyInfo => ({
    id: 'p1', leaderId: '1', createdAt: '',
    members: Array.from({ length: size }, (_, i) => makeHuman(String(i))),
  });

  it('is not full below max', () => {
    expect(isFull(makeParty(3))).toBe(false);
  });

  it('is full at max', () => {
    expect(isFull(makeParty(4))).toBe(true);
  });
});

// ── getHumanCount / getBotCount ───────────────────────────────────────────────

describe('getHumanCount / getBotCount', () => {
  it('counts humans and bots correctly', () => {
    const members = [makeHuman('1'), makeHuman('2'), makeBot()];
    expect(getHumanCount(members)).toBe(2);
    expect(getBotCount(members)).toBe(1);
  });

  it('returns 0 for empty party', () => {
    expect(getHumanCount([])).toBe(0);
    expect(getBotCount([])).toBe(0);
  });
});

// ── shouldSuggestBot ──────────────────────────────────────────────────────────

describe('shouldSuggestBot', () => {
  it('suggests bot when solo', () => {
    expect(shouldSuggestBot([makeHuman('1')])).toBe(true);
  });

  it('does not suggest when 2+ humans', () => {
    expect(shouldSuggestBot([makeHuman('1'), makeHuman('2')])).toBe(false);
  });

  it('suggests bot for empty party', () => {
    expect(shouldSuggestBot([])).toBe(true);
  });
});

// ── createBotHelper ───────────────────────────────────────────────────────────

describe('createBotHelper', () => {
  it('returns a valid party member', () => {
    const bot = createBotHelper([makeHuman('1')]);
    expect(bot.isBot).toBe(true);
    expect(bot.id).toContain('bot_');
    expect(bot.hp).toBeGreaterThan(0);
    expect(bot.level).toBeGreaterThan(0);
  });

  it('picks Cleric when no healer in party', () => {
    const members = [makeHuman('1', 'Knight'), makeHuman('2', 'Archer')];
    const bot = createBotHelper(members);
    expect(bot.class).toBe('Cleric');
  });

  it('picks Knight when no tank in party', () => {
    const members = [makeHuman('1', 'Cleric'), makeHuman('2', 'Mage')];
    const bot = createBotHelper(members);
    expect(bot.class).toBe('Knight');
  });

  it('scales level to party average', () => {
    const members = [
      makeHuman('1', 'Knight', 20),
      makeHuman('2', 'Cleric', 30),
    ];
    const bot = createBotHelper(members);
    expect(bot.level).toBe(25); // avg of 20 and 30
  });
});

// ── getXpShare / getGoldShare ─────────────────────────────────────────────────

describe('getXpShare', () => {
  it('returns full XP for solo', () => {
    expect(getXpShare(1000, 1)).toBe(1000);
  });

  it('splits XP equally', () => {
    expect(getXpShare(1000, 4)).toBe(250);
  });

  it('floors the result', () => {
    expect(getXpShare(100, 3)).toBe(33);
  });

  it('handles size 0 safely', () => {
    expect(getXpShare(1000, 0)).toBe(1000);
  });
});

describe('getGoldShare', () => {
  it('splits gold equally', () => {
    expect(getGoldShare(300, 3)).toBe(100);
  });
});

// ── getPartySummary ───────────────────────────────────────────────────────────

describe('getPartySummary', () => {
  it('returns correct summary for mixed party', () => {
    const members = [makeHuman('1', 'Knight', 10), makeHuman('2', 'Cleric', 20), makeBot()];
    const s = getPartySummary(members);
    expect(s.totalMembers).toBe(3);
    expect(s.humanMembers).toBe(2);
    expect(s.botMembers).toBe(1);
    expect(s.avgLevel).toBe(Math.floor((10 + 20 + 10) / 3));
    expect(s.dropMultiplier).toBeGreaterThan(1);
    expect(s.difficultyMultiplier).toBeGreaterThan(1);
  });

  it('returns baseline for empty party', () => {
    const s = getPartySummary([]);
    expect(s.totalMembers).toBe(0);
    expect(s.dropMultiplier).toBe(1.0);
    expect(s.difficultyMultiplier).toBe(1.0);
  });
});

// ── generatePartyId ───────────────────────────────────────────────────────────

describe('generatePartyId', () => {
  it('generates a non-empty uppercase string', () => {
    const id = generatePartyId();
    expect(id.length).toBeGreaterThan(0);
    expect(id).toBe(id.toUpperCase());
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generatePartyId()));
    expect(ids.size).toBe(20);
  });
});

// ── getPartyBuffs ────────────────────────────────────────────────────────────

describe('getPartyBuffs', () => {
  it('returns buff for Cleric', () => {
    const buffs = getPartyBuffs(['Cleric']);
    expect(buffs.length).toBe(1);
    expect(buffs[0].effect).toBe('heal');
  });

  it('returns multiple buffs for diverse party', () => {
    const buffs = getPartyBuffs(['Cleric', 'Bard', 'Knight']);
    expect(buffs.length).toBe(3);
  });

  it('returns empty for classes without party buffs', () => {
    const buffs = getPartyBuffs(['Mage', 'Archer']);
    expect(buffs.length).toBe(0);
  });
});

// ── applyPartyBuffs ──────────────────────────────────────────────────────────

describe('applyPartyBuffs', () => {
  it('increases attack with atk_boost buff', () => {
    const buffs = getPartyBuffs(['Bard']);
    const result = applyPartyBuffs(100, 50, 500, buffs);
    expect(result.attack).toBeGreaterThan(100);
  });

  it('increases defense with def_boost buff', () => {
    const buffs = getPartyBuffs(['Knight']);
    const result = applyPartyBuffs(100, 50, 500, buffs);
    expect(result.defense).toBeGreaterThan(50);
  });

  it('provides heal with Cleric buff', () => {
    const buffs = getPartyBuffs(['Cleric']);
    const result = applyPartyBuffs(100, 50, 500, buffs);
    expect(result.healPerRound).toBeGreaterThan(0);
  });

  it('returns unchanged stats with no buffs', () => {
    const result = applyPartyBuffs(100, 50, 500, []);
    expect(result.attack).toBe(100);
    expect(result.defense).toBe(50);
    expect(result.healPerRound).toBe(0);
  });
});

// ── hasOptimalComposition ────────────────────────────────────────────────────

describe('hasOptimalComposition', () => {
  it('returns true for 3+ unique classes', () => {
    expect(hasOptimalComposition(['Knight', 'Mage', 'Cleric'])).toBe(true);
  });

  it('returns false for 2 unique classes', () => {
    expect(hasOptimalComposition(['Knight', 'Knight'])).toBe(false);
  });

  it('returns true for 4 unique classes', () => {
    expect(hasOptimalComposition(['Knight', 'Mage', 'Cleric', 'Archer'])).toBe(true);
  });
});

// ── getCompositionBonus ──────────────────────────────────────────────────────

describe('getCompositionBonus', () => {
  it('returns 1.0 for same class party', () => {
    expect(getCompositionBonus(['Knight', 'Knight'])).toBe(1.0);
  });

  it('returns 1.10 for 3 unique classes', () => {
    expect(getCompositionBonus(['Knight', 'Mage', 'Cleric'])).toBe(1.10);
  });

  it('returns 1.20 for 4 unique classes', () => {
    expect(getCompositionBonus(['Knight', 'Mage', 'Cleric', 'Archer'])).toBe(1.20);
  });
});

// ── calculateHelpDamage ──────────────────────────────────────────────────────

describe('calculateHelpDamage', () => {
  it('returns 50% of finished member attack', () => {
    expect(calculateHelpDamage(100, 50)).toBe(50);
  });

  it('floors the result', () => {
    expect(calculateHelpDamage(101, 50)).toBe(50);
  });

  it('returns 0 for 0 attack', () => {
    expect(calculateHelpDamage(0, 50)).toBe(0);
  });
});
