import { describe, it, expect } from 'vitest';
import {
    GUILD_INITIAL_MEMBER_CAP,
    GUILD_CREATE_COST_GOLD,
    GUILD_MAX_LEVEL,
    GUILD_BOSS_MAX_TIER,
    GUILD_TREASURY_SLOTS,
    GUILD_BOSS_HEROIC_MAX_CHANCE,
    GUILD_BOSS_BLOCK_PCT,
    clampGuildBossTier,
    guildXpToNextLevel,
    guildXpForLevel,
    guildMemberCap,
    applyGuildXp,
    getGuildBossMaxHp,
    computeGuildBossDamage,
    getCurrentWeekStartIso,
    isGuildBossClaimDay,
    getTodayIso,
    contributionMultiplier,
} from './guildSystem';


describe('guild constants', () => {
    it('initial member cap = 20', () => {
        expect(GUILD_INITIAL_MEMBER_CAP).toBe(20);
    });

    it('create cost = 1,000,000 gold (10 cc)', () => {
        expect(GUILD_CREATE_COST_GOLD).toBe(1_000_000);
    });

    it('max level is infinity (no cap per spec)', () => {
        expect(GUILD_MAX_LEVEL).toBe(Number.POSITIVE_INFINITY);
    });

    it('max boss tier = 50', () => {
        expect(GUILD_BOSS_MAX_TIER).toBe(50);
    });

    it('treasury has 1000 slots', () => {
        expect(GUILD_TREASURY_SLOTS).toBe(1000);
    });

    it('heroic drop max chance is 1%', () => {
        expect(GUILD_BOSS_HEROIC_MAX_CHANCE).toBe(0.01);
    });

    it('per-attack block gate is 10%', () => {
        expect(GUILD_BOSS_BLOCK_PCT).toBe(0.10);
    });
});


describe('clampGuildBossTier', () => {
    it('returns 1 for tier 0 or below', () => {
        expect(clampGuildBossTier(0)).toBe(1);
        expect(clampGuildBossTier(-5)).toBe(1);
    });

    it('passes through valid in-range tiers', () => {
        expect(clampGuildBossTier(1)).toBe(1);
        expect(clampGuildBossTier(10)).toBe(10);
        expect(clampGuildBossTier(25)).toBe(25);
        expect(clampGuildBossTier(50)).toBe(50);
    });

    it('clamps tiers above 50 to 50', () => {
        expect(clampGuildBossTier(51)).toBe(50);
        expect(clampGuildBossTier(100)).toBe(50);
        expect(clampGuildBossTier(99999)).toBe(50);
    });

    it('floors fractional tiers', () => {
        expect(clampGuildBossTier(3.7)).toBe(3);
        expect(clampGuildBossTier(10.1)).toBe(10);
    });

    it('returns 1 for NaN or Infinity', () => {
        expect(clampGuildBossTier(Number.NaN)).toBe(1);
        expect(clampGuildBossTier(Number.POSITIVE_INFINITY)).toBe(1);
        expect(clampGuildBossTier(Number.NEGATIVE_INFINITY)).toBe(1);
    });
});


describe('getGuildBossMaxHp', () => {
    it('tier 1 = 2M HP', () => {
        expect(getGuildBossMaxHp(1)).toBe(2_000_000);
    });

    it('treats tier <= 0 as tier 1', () => {
        expect(getGuildBossMaxHp(0)).toBe(2_000_000);
        expect(getGuildBossMaxHp(-3)).toBe(2_000_000);
    });

    it('tier 2 = 2M × 1.25 = 2.5M', () => {
        expect(getGuildBossMaxHp(2)).toBe(Math.floor(2_000_000 * 1.25));
    });

    it('is strictly increasing with tier', () => {
        for (let t = 1; t < 20; t++) {
            expect(getGuildBossMaxHp(t + 1)).toBeGreaterThan(getGuildBossMaxHp(t));
        }
    });

    it('follows the 1.25^(tier-1) growth curve', () => {
        const expected = Math.floor(2_000_000 * Math.pow(1.25, 4));
        expect(getGuildBossMaxHp(5)).toBe(expected);
    });
});


describe('guildXpToNextLevel', () => {
    it('returns 0 for level 0 (no progression below level 1)', () => {
        expect(guildXpToNextLevel(0)).toBe(0);
        expect(guildXpToNextLevel(-5)).toBe(0);
    });

    it('level 1 -> 2 needs 1 × tier-1 boss HP = 2M XP', () => {
        expect(guildXpToNextLevel(1)).toBe(2_000_000);
    });

    it('level 2 -> 3 needs 2 × tier-2 boss HP', () => {
        const expected = Math.floor(2 * getGuildBossMaxHp(2));
        expect(guildXpToNextLevel(2)).toBe(expected);
    });

    it('level 3 -> 4 needs 3 × tier-3 boss HP', () => {
        const expected = Math.floor(3 * getGuildBossMaxHp(3));
        expect(guildXpToNextLevel(3)).toBe(expected);
    });

    it('is strictly increasing across levels 1..30', () => {
        for (let l = 1; l < 30; l++) {
            expect(guildXpToNextLevel(l + 1)).toBeGreaterThan(guildXpToNextLevel(l));
        }
    });

    it('keeps climbing after boss tier cap (uses level × tier-50 HP)', () => {
        const tier50Hp = getGuildBossMaxHp(50);
        expect(guildXpToNextLevel(100)).toBe(100 * tier50Hp);
    });
});


describe('guildXpForLevel', () => {
    it('returns 0 for level 1 (base)', () => {
        expect(guildXpForLevel(1)).toBe(0);
    });

    it('level 2 = xpToNextLevel(1)', () => {
        expect(guildXpForLevel(2)).toBe(guildXpToNextLevel(1));
    });

    it('cumulates xpToNextLevel across all prior steps', () => {
        const sum = guildXpToNextLevel(1) + guildXpToNextLevel(2) + guildXpToNextLevel(3);
        expect(guildXpForLevel(4)).toBe(sum);
    });

    it('is monotonically non-decreasing', () => {
        for (let l = 1; l < 15; l++) {
            expect(guildXpForLevel(l + 1)).toBeGreaterThanOrEqual(guildXpForLevel(l));
        }
    });
});


describe('guildMemberCap', () => {
    it('returns 20 at level 1', () => {
        expect(guildMemberCap(1)).toBe(20);
    });

    it('adds 1 per level above 1', () => {
        expect(guildMemberCap(2)).toBe(21);
        expect(guildMemberCap(10)).toBe(29);
        expect(guildMemberCap(100)).toBe(119);
    });

    it('never returns less than the initial 20 cap', () => {
        expect(guildMemberCap(1)).toBeGreaterThanOrEqual(20);
        expect(guildMemberCap(0)).toBeGreaterThanOrEqual(20);
        expect(guildMemberCap(-5)).toBe(20);
    });
});


describe('applyGuildXp', () => {
    it('accumulates XP without levelling up', () => {
        const result = applyGuildXp(1, 0, 1000);
        expect(result.level).toBe(1);
        expect(result.xp).toBe(1000);
        expect(result.leveledUp).toBe(false);
    });

    it('levels up exactly when threshold reached', () => {
        const needed = guildXpToNextLevel(1);
        const result = applyGuildXp(1, 0, needed);
        expect(result.level).toBe(2);
        expect(result.xp).toBe(0);
        expect(result.leveledUp).toBe(true);
    });

    it('rolls multiple levels in a single big gain', () => {
        const xp = guildXpToNextLevel(1) + guildXpToNextLevel(2) + guildXpToNextLevel(3);
        const result = applyGuildXp(1, 0, xp);
        expect(result.level).toBe(4);
        expect(result.leveledUp).toBe(true);
    });

    it('carries over excess XP correctly', () => {
        const needed = guildXpToNextLevel(1);
        const result = applyGuildXp(1, 0, needed + 12345);
        expect(result.level).toBe(2);
        expect(result.xp).toBe(12345);
    });

    it('treats negative gain as 0 (no XP loss)', () => {
        const result = applyGuildXp(5, 500, -999);
        expect(result.level).toBe(5);
        expect(result.xp).toBe(500);
        expect(result.leveledUp).toBe(false);
    });

    it('preserves level + xp when gain = 0', () => {
        const result = applyGuildXp(3, 1500, 0);
        expect(result.level).toBe(3);
        expect(result.xp).toBe(1500);
        expect(result.leveledUp).toBe(false);
    });

    it('does not lose precision across stacked level-ups', () => {
        const result = applyGuildXp(1, 0, getGuildBossMaxHp(1));
        expect(result.level).toBe(2);
        expect(result.leveledUp).toBe(true);
    });
});


describe('computeGuildBossDamage', () => {
    it('returns at least 1 damage even at low character stats', () => {
        expect(computeGuildBossDamage(0, 1, 1)).toBeGreaterThanOrEqual(1);
        expect(computeGuildBossDamage(-50, -100, 1)).toBeGreaterThanOrEqual(1);
    });

    it('scales with character attack', () => {
        const low = computeGuildBossDamage(10, 50, 1);
        const high = computeGuildBossDamage(100, 50, 1);
        expect(high).toBeGreaterThan(low);
    });

    it('scales with character level (gently)', () => {
        const lvl1   = computeGuildBossDamage(100, 1, 1);
        const lvl400 = computeGuildBossDamage(100, 400, 1);
        expect(lvl400).toBeGreaterThan(lvl1);
    });

    it('caps single-hit damage at 5% of boss max HP', () => {
        const bossMax = getGuildBossMaxHp(1);
        const cap = Math.floor(bossMax * 0.05);
        const dmg = computeGuildBossDamage(1_000_000_000, 1000, 1);
        expect(dmg).toBeLessThanOrEqual(cap);
    });

    it('per-swing damage scales UP with tier (2026-06-18 balance: was DOWN)', () => {
        const tier1 = computeGuildBossDamage(100, 100, 1);
        const tier10 = computeGuildBossDamage(100, 100, 10);
        expect(tier10).toBeGreaterThan(tier1);
    });

    it('treats tier <= 0 as tier 1', () => {
        const tier0 = computeGuildBossDamage(50, 50, 0);
        const tier1 = computeGuildBossDamage(50, 50, 1);
        expect(tier0).toBe(tier1);
    });

    it('high tier stays CLEARABLE (regression: old ÷1.15^tier curve diverged → trillions of swings)', () => {
        const hp = getGuildBossMaxHp(50);
        const dmg = computeGuildBossDamage(50_000_000, 1000, 50);
        expect(hp / dmg).toBeLessThan(1000);
    });
});


describe('getCurrentWeekStartIso', () => {
    it('returns ISO date format (YYYY-MM-DD)', () => {
        const iso = getCurrentWeekStartIso(new Date('2026-05-20T14:30:00.000Z'));
        expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns the Monday for a Wednesday', () => {
        const iso = getCurrentWeekStartIso(new Date('2026-05-20T14:30:00.000Z'));
        expect(iso).toBe('2026-05-18');
    });

    it('returns same date for a Monday', () => {
        const iso = getCurrentWeekStartIso(new Date('2026-05-18T08:00:00.000Z'));
        expect(iso).toBe('2026-05-18');
    });

    it('returns the previous Monday for a Sunday', () => {
        const iso = getCurrentWeekStartIso(new Date('2026-05-24T23:00:00.000Z'));
        expect(iso).toBe('2026-05-18');
    });

    it('returns the previous Monday for a Friday', () => {
        const iso = getCurrentWeekStartIso(new Date('2026-05-22T12:00:00.000Z'));
        expect(iso).toBe('2026-05-18');
    });
});


describe('isGuildBossClaimDay', () => {
    it('returns true on Sunday', () => {
        expect(isGuildBossClaimDay(new Date('2026-05-24T10:00:00.000Z'))).toBe(true);
    });

    it('returns false on Monday', () => {
        expect(isGuildBossClaimDay(new Date('2026-05-18T10:00:00.000Z'))).toBe(false);
    });

    it('returns false on weekdays', () => {
        expect(isGuildBossClaimDay(new Date('2026-05-20T10:00:00.000Z'))).toBe(false);
        expect(isGuildBossClaimDay(new Date('2026-05-22T10:00:00.000Z'))).toBe(false);
    });
});


describe('getTodayIso', () => {
    it('returns YYYY-MM-DD slice of given date', () => {
        const ref = new Date('2026-05-21T15:45:00.000Z');
        expect(getTodayIso(ref)).toBe('2026-05-21');
    });

    it('returns today by default', () => {
        const expected = new Date().toISOString().slice(0, 10);
        expect(getTodayIso()).toBe(expected);
    });

    it('format matches YYYY-MM-DD regex', () => {
        expect(getTodayIso(new Date('2026-01-01T00:00:00.000Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});


describe('contributionMultiplier', () => {
    it('returns 0 when bossMaxHp <= 0', () => {
        expect(contributionMultiplier(100, 0)).toBe(0);
        expect(contributionMultiplier(100, -50)).toBe(0);
    });

    it('returns 0.1 at the floor (0% damage)', () => {
        expect(contributionMultiplier(0, 1000)).toBe(0.1);
    });

    it('returns 2.0 when one member soloed the boss', () => {
        expect(contributionMultiplier(1000, 1000)).toBe(2.0);
    });

    it('caps share at 1.0 (over-damage does not boost beyond 2.0)', () => {
        expect(contributionMultiplier(2000, 1000)).toBe(2.0);
    });

    it('scales linearly between 0.1 and 2.0 across share', () => {
        const half = contributionMultiplier(500, 1000);
        expect(half).toBeCloseTo(1.05, 4);
    });

    it('respects the 0.05 floor (defensive)', () => {
        expect(contributionMultiplier(0, 1)).toBeGreaterThanOrEqual(0.05);
    });

    it('returns higher multiplier for higher share', () => {
        const low  = contributionMultiplier(100, 1000);
        const mid  = contributionMultiplier(500, 1000);
        const high = contributionMultiplier(900, 1000);
        expect(mid).toBeGreaterThan(low);
        expect(high).toBeGreaterThan(mid);
    });
});
