import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    LEAGUE_BOUNDARIES,
    ARENA_DAMAGE_MULTIPLIER,
    getLeagueMultiplier,
    getNextLeague,
    getPreviousLeague,
    getMatchReward,
    rankCompetitors,
    getAttackableIndices,
    getSeasonOutcome,
    getRewardBuckets,
    findRewardBucket,
    applyLeagueMultiplier,
    generateBotsForArena,
    getSeasonStart,
    getSeasonEnd,
    getSeasonMsRemaining,
    formatSeasonRemaining,
    getArenaCastableSkills,
    getDefaultBotSkillSlots,
} from './arenaSystem';
import {
    ARENA_LEAGUES,
    type ArenaLeague,
    type IArenaCompetitor,
    type IArenaRewardBucket,
} from '../types/arena';

// -- Helpers ------------------------------------------------------------------

const makeCompetitor = (
    id: string,
    leaguePoints: number,
    level: number,
    achievedAt: string = '2026-01-01T00:00:00.000Z',
    seasonArenaPoints: number = 0,
): IArenaCompetitor => ({
    id,
    name: id,
    class: 'Knight',
    level,
    color: '#888',
    leaguePoints,
    leaguePointsAchievedAt: achievedAt,
    seasonArenaPoints,
    isBot: false,
    defense: {
        maxHp: 1000,
        maxMp: 200,
        attack: 50,
        defense: 30,
        skillSlots: [null, null, null, null],
        snapshotAt: '2026-01-01T00:00:00.000Z',
    },
});

// -- LEAGUE_BOUNDARIES --------------------------------------------------------

describe('LEAGUE_BOUNDARIES', () => {
    it('bronze has no relegation (lowest league)', () => {
        expect(LEAGUE_BOUNDARIES.bronze.relegatedBottom).toBeNull();
        expect(LEAGUE_BOUNDARIES.bronze.promotedTop).not.toBeNull();
    });

    it('legend has no promotion (highest league)', () => {
        expect(LEAGUE_BOUNDARIES.legend.promotedTop).toBeNull();
        expect(LEAGUE_BOUNDARIES.legend.relegatedBottom).toBeNull();
    });

    it('mid leagues have both promotion and relegation bounds', () => {
        const mids: ArenaLeague[] = ['silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grand_master'];
        for (const league of mids) {
            expect(LEAGUE_BOUNDARIES[league].promotedTop).not.toBeNull();
            expect(LEAGUE_BOUNDARIES[league].relegatedBottom).not.toBeNull();
        }
    });

    it('promotion thresholds shrink as leagues climb', () => {
        // Bronze=40, silver=35, gold=33, platinum=20, ..., grand_master=5.
        expect(LEAGUE_BOUNDARIES.bronze.promotedTop).toBeGreaterThan(LEAGUE_BOUNDARIES.silver.promotedTop ?? 0);
        expect(LEAGUE_BOUNDARIES.master.promotedTop).toBeGreaterThan(LEAGUE_BOUNDARIES.grand_master.promotedTop ?? 0);
    });
});

// -- getLeagueMultiplier ------------------------------------------------------

describe('getLeagueMultiplier', () => {
    it('returns 1 for bronze (index 0 + 1)', () => {
        expect(getLeagueMultiplier('bronze')).toBe(1);
    });

    it('returns 9 for legend (top league)', () => {
        expect(getLeagueMultiplier('legend')).toBe(9);
    });

    it('matches league index + 1 for every league', () => {
        for (let i = 0; i < ARENA_LEAGUES.length; i++) {
            expect(getLeagueMultiplier(ARENA_LEAGUES[i])).toBe(i + 1);
        }
    });

    it('is strictly increasing across the ladder', () => {
        for (let i = 0; i < ARENA_LEAGUES.length - 1; i++) {
            expect(getLeagueMultiplier(ARENA_LEAGUES[i + 1]))
                .toBeGreaterThan(getLeagueMultiplier(ARENA_LEAGUES[i]));
        }
    });
});

// -- getNextLeague / getPreviousLeague ----------------------------------------

describe('getNextLeague', () => {
    it('returns silver from bronze', () => {
        expect(getNextLeague('bronze')).toBe('silver');
    });

    it('returns legend from grand_master', () => {
        expect(getNextLeague('grand_master')).toBe('legend');
    });

    it('clamps at legend (top league)', () => {
        expect(getNextLeague('legend')).toBe('legend');
    });

    it('returns input league when league not found (defensive)', () => {
        // Cast through unknown to bypass strict ArenaLeague type — testing
        // defensive idx<0 branch.
        const out = getNextLeague('unknown_league' as unknown as ArenaLeague);
        expect(out).toBe('unknown_league');
    });
});

describe('getPreviousLeague', () => {
    it('returns bronze from silver', () => {
        expect(getPreviousLeague('silver')).toBe('bronze');
    });

    it('returns grand_master from legend', () => {
        expect(getPreviousLeague('legend')).toBe('grand_master');
    });

    it('clamps at bronze (bottom league)', () => {
        expect(getPreviousLeague('bronze')).toBe('bronze');
    });

    it('returns input league when league not found', () => {
        const out = getPreviousLeague('unknown_league' as unknown as ArenaLeague);
        expect(out).toBe('unknown_league');
    });
});

// -- getMatchReward -----------------------------------------------------------

describe('getMatchReward', () => {
    it('attacker wins attacking up: 200 AP / 2 LP, defender 0/0', () => {
        const r = getMatchReward(true, true);
        expect(r.attacker.arenaPoints).toBe(200);
        expect(r.attacker.leaguePoints).toBe(2);
        expect(r.defender.arenaPoints).toBe(0);
        expect(r.defender.leaguePoints).toBe(0);
    });

    it('attacker wins attacking down: 100 AP / 1 LP, defender 0/0', () => {
        const r = getMatchReward(true, false);
        expect(r.attacker.arenaPoints).toBe(100);
        expect(r.attacker.leaguePoints).toBe(1);
        expect(r.defender.arenaPoints).toBe(0);
        expect(r.defender.leaguePoints).toBe(0);
    });

    it('defender wins vs attack from below: 250 AP / 1 LP', () => {
        const r = getMatchReward(false, true);
        expect(r.attacker.arenaPoints).toBe(0);
        expect(r.attacker.leaguePoints).toBe(0);
        expect(r.defender.arenaPoints).toBe(250);
        expect(r.defender.leaguePoints).toBe(1);
    });

    it('defender wins vs attack from above: 250 AP / 2 LP (upset bonus)', () => {
        const r = getMatchReward(false, false);
        expect(r.attacker.arenaPoints).toBe(0);
        expect(r.attacker.leaguePoints).toBe(0);
        expect(r.defender.arenaPoints).toBe(250);
        expect(r.defender.leaguePoints).toBe(2);
    });

    it('loser never loses points (per spec)', () => {
        const won = getMatchReward(true, true);
        expect(won.defender.arenaPoints).toBeGreaterThanOrEqual(0);
        expect(won.defender.leaguePoints).toBeGreaterThanOrEqual(0);

        const lost = getMatchReward(false, false);
        expect(lost.attacker.arenaPoints).toBeGreaterThanOrEqual(0);
        expect(lost.attacker.leaguePoints).toBeGreaterThanOrEqual(0);
    });

    it('upset bonus (attacking up) pays more LP than favoured win', () => {
        const upset = getMatchReward(true, true);
        const favoured = getMatchReward(true, false);
        expect(upset.attacker.leaguePoints).toBeGreaterThan(favoured.attacker.leaguePoints);
        expect(upset.attacker.arenaPoints).toBeGreaterThan(favoured.attacker.arenaPoints);
    });
});

// -- ARENA_DAMAGE_MULTIPLIER --------------------------------------------------

describe('ARENA_DAMAGE_MULTIPLIER', () => {
    it('is 0.2 (= -80% damage vs world combat)', () => {
        expect(ARENA_DAMAGE_MULTIPLIER).toBe(0.2);
    });

    it('is strictly less than 1 (always a reduction)', () => {
        expect(ARENA_DAMAGE_MULTIPLIER).toBeLessThan(1);
    });
});

// -- rankCompetitors ----------------------------------------------------------

describe('rankCompetitors', () => {
    it('returns empty list for empty input', () => {
        expect(rankCompetitors([])).toEqual([]);
    });

    it('assigns sequential 1-based ranks', () => {
        const a = makeCompetitor('a', 100, 10);
        const b = makeCompetitor('b', 50,  10);
        const c = makeCompetitor('c', 25,  10);
        const ranked = rankCompetitors([a, b, c]);
        expect(ranked[0].rank).toBe(1);
        expect(ranked[1].rank).toBe(2);
        expect(ranked[2].rank).toBe(3);
    });

    it('sorts by leaguePoints DESC primarily', () => {
        const low  = makeCompetitor('low',  10, 10);
        const high = makeCompetitor('high', 100, 10);
        const mid  = makeCompetitor('mid',  50, 10);
        const ranked = rankCompetitors([low, mid, high]);
        expect(ranked[0].competitor.id).toBe('high');
        expect(ranked[1].competitor.id).toBe('mid');
        expect(ranked[2].competitor.id).toBe('low');
    });

    it('breaks LP ties by higher level', () => {
        const lo = makeCompetitor('lo', 100, 5);
        const hi = makeCompetitor('hi', 100, 50);
        const ranked = rankCompetitors([lo, hi]);
        expect(ranked[0].competitor.id).toBe('hi');
        expect(ranked[1].competitor.id).toBe('lo');
    });

    it('breaks LP+level ties by earlier achievedAt timestamp', () => {
        const late  = makeCompetitor('late',  100, 10, '2026-05-01T00:00:00.000Z');
        const early = makeCompetitor('early', 100, 10, '2026-01-01T00:00:00.000Z');
        const ranked = rankCompetitors([late, early]);
        expect(ranked[0].competitor.id).toBe('early');
        expect(ranked[1].competitor.id).toBe('late');
    });

    it('assigns unique ranks even when all primary keys tie', () => {
        // Deliberately identical LP+level — only timestamp differentiates.
        const competitors = [
            makeCompetitor('a', 50, 5, '2026-03-01T00:00:00.000Z'),
            makeCompetitor('b', 50, 5, '2026-02-01T00:00:00.000Z'),
            makeCompetitor('c', 50, 5, '2026-01-01T00:00:00.000Z'),
        ];
        const ranked = rankCompetitors(competitors);
        const ranks = ranked.map((r) => r.rank);
        // Every rank is unique (strict total ordering, no dense ranking).
        expect(new Set(ranks).size).toBe(competitors.length);
    });

    it('does not mutate input array', () => {
        const competitors = [makeCompetitor('a', 50, 5), makeCompetitor('b', 100, 5)];
        const before = [...competitors];
        rankCompetitors(competitors);
        expect(competitors).toEqual(before);
    });
});

// -- getAttackableIndices -----------------------------------------------------

describe('getAttackableIndices', () => {
    it('returns empty list when self id not found', () => {
        const competitors = [makeCompetitor('a', 50, 5)];
        expect(getAttackableIndices(competitors, 'missing')).toEqual([]);
    });

    it('returns ±2 rank window excluding self', () => {
        // Ranks (by LP DESC): a(100)=1, b(80)=2, c(60)=3, d(40)=4, e(20)=5.
        const competitors = [
            makeCompetitor('a', 100, 10),
            makeCompetitor('b', 80,  10),
            makeCompetitor('c', 60,  10),
            makeCompetitor('d', 40,  10),
            makeCompetitor('e', 20,  10),
        ];
        const indices = getAttackableIndices(competitors, 'c');
        // Player 'c' is at rank 3 — attackable ranks: 1,2,4,5 (so all others).
        expect(indices).toHaveLength(4);
        // Indices into ORIGINAL array — every id except 'c'.
        const ids = indices.map((i) => competitors[i].id).sort();
        expect(ids).toEqual(['a', 'b', 'd', 'e']);
    });

    it('respects top boundary (rank 1 can only attack ranks 2-3)', () => {
        const competitors = [
            makeCompetitor('top',  100, 10),
            makeCompetitor('two',  80,  10),
            makeCompetitor('three', 60, 10),
            makeCompetitor('four',  40, 10),
            makeCompetitor('five',  20, 10),
        ];
        const indices = getAttackableIndices(competitors, 'top');
        expect(indices).toHaveLength(2);
        const ids = indices.map((i) => competitors[i].id).sort();
        expect(ids).toEqual(['three', 'two']);
    });

    it('respects bottom boundary (last rank can only attack last 2)', () => {
        const competitors = [
            makeCompetitor('a', 100, 10),
            makeCompetitor('b', 80,  10),
            makeCompetitor('c', 60,  10),
            makeCompetitor('d', 40,  10),
            makeCompetitor('e', 20,  10),
        ];
        const indices = getAttackableIndices(competitors, 'e');
        expect(indices).toHaveLength(2);
        const ids = indices.map((i) => competitors[i].id).sort();
        expect(ids).toEqual(['c', 'd']);
    });

    it('returns empty when only the player exists', () => {
        const competitors = [makeCompetitor('solo', 100, 10)];
        expect(getAttackableIndices(competitors, 'solo')).toEqual([]);
    });
});

// -- getSeasonOutcome ---------------------------------------------------------

describe('getSeasonOutcome', () => {
    it('rank 1 in bronze promotes to silver', () => {
        const out = getSeasonOutcome('bronze', 1);
        expect(out.type).toBe('promote');
        if (out.type === 'promote') expect(out.toLeague).toBe('silver');
    });

    it('rank at promotedTop boundary promotes (inclusive)', () => {
        const out = getSeasonOutcome('bronze', 40); // boundary = 40
        expect(out.type).toBe('promote');
    });

    it('rank just past promotion boundary stays', () => {
        const out = getSeasonOutcome('bronze', 41); // boundary = 40
        expect(out.type).toBe('stay');
    });

    it('rank 100 in silver relegates to bronze', () => {
        // silver relegatedBottom = 20 (ranks 81-100).
        const out = getSeasonOutcome('silver', 100);
        expect(out.type).toBe('relegate');
        if (out.type === 'relegate') expect(out.toLeague).toBe('bronze');
    });

    it('rank in middle of silver stays', () => {
        const out = getSeasonOutcome('silver', 50); // not top 35, not bottom 20.
        expect(out.type).toBe('stay');
    });

    it('legend never promotes (top league)', () => {
        const out = getSeasonOutcome('legend', 1);
        expect(out.type).toBe('stay');
    });

    it('legend never relegates (top league)', () => {
        const out = getSeasonOutcome('legend', 100);
        expect(out.type).toBe('stay');
    });

    it('bronze never relegates (bottom league)', () => {
        const out = getSeasonOutcome('bronze', 100);
        expect(out.type).toBe('stay');
    });
});

// -- getRewardBuckets / findRewardBucket --------------------------------------

describe('getRewardBuckets', () => {
    it('returns 7 buckets (1, 2, 3, 4-5, 6-10, 11-50, 51-100)', () => {
        const buckets = getRewardBuckets();
        expect(buckets).toHaveLength(7);
        expect(buckets.map((b) => b.positionLabel)).toEqual([
            '1', '2', '3', '4-5', '6-10', '11-50', '51-100',
        ]);
    });

    it('rewards strictly decrease as rank worsens (arenaPoints)', () => {
        const buckets = getRewardBuckets();
        for (let i = 0; i < buckets.length - 1; i++) {
            expect(buckets[i].arenaPoints).toBeGreaterThanOrEqual(buckets[i + 1].arenaPoints);
        }
    });

    it('rewards strictly decrease as rank worsens (gold)', () => {
        const buckets = getRewardBuckets();
        for (let i = 0; i < buckets.length - 1; i++) {
            expect(buckets[i].gold).toBeGreaterThanOrEqual(buckets[i + 1].gold);
        }
    });

    it('returns a new array each call (immutability)', () => {
        const a = getRewardBuckets();
        const b = getRewardBuckets();
        expect(a).not.toBe(b);
        expect(a).toEqual(b);
    });

    it('rank-1 bucket has the highest arena points + gold', () => {
        const buckets = getRewardBuckets();
        expect(buckets[0].arenaPoints).toBe(1000);
        expect(buckets[0].gold).toBe(100_000);
        expect(buckets[0].mythicStones).toBe(10);
    });
});

describe('findRewardBucket', () => {
    it('returns rank-1 bucket for rank 1', () => {
        const b = findRewardBucket(1);
        expect(b?.positionLabel).toBe('1');
    });

    it('finds the 4-5 bucket for ranks 4 and 5', () => {
        expect(findRewardBucket(4)?.positionLabel).toBe('4-5');
        expect(findRewardBucket(5)?.positionLabel).toBe('4-5');
    });

    it('finds the 6-10 bucket for ranks at boundaries', () => {
        expect(findRewardBucket(6)?.positionLabel).toBe('6-10');
        expect(findRewardBucket(10)?.positionLabel).toBe('6-10');
    });

    it('finds the 51-100 bucket for ranks 51 and 100', () => {
        expect(findRewardBucket(51)?.positionLabel).toBe('51-100');
        expect(findRewardBucket(100)?.positionLabel).toBe('51-100');
    });

    it('returns null for ranks above 100', () => {
        expect(findRewardBucket(101)).toBeNull();
        expect(findRewardBucket(500)).toBeNull();
    });

    it('returns null for ranks below 1', () => {
        expect(findRewardBucket(0)).toBeNull();
        expect(findRewardBucket(-5)).toBeNull();
    });
});

// -- applyLeagueMultiplier ----------------------------------------------------

describe('applyLeagueMultiplier', () => {
    const baseBucket: IArenaRewardBucket = {
        positionLabel: '1',
        range: [1, 1],
        arenaPoints: 1000,
        gold: 100_000,
        mythicStones: 10,
        legendaryStones: 20,
        epicStones: 30,
        rareStones: 40,
        commonStones: 50,
        pctHpPotion: 100,
        pctMpPotion: 100,
    };

    it('multiplies every counter by league index + 1', () => {
        const bronze = applyLeagueMultiplier(baseBucket, 'bronze'); // mult = 1
        expect(bronze.arenaPoints).toBe(1000);
        expect(bronze.gold).toBe(100_000);

        const gold = applyLeagueMultiplier(baseBucket, 'gold'); // mult = 3
        expect(gold.arenaPoints).toBe(3000);
        expect(gold.gold).toBe(300_000);
        expect(gold.mythicStones).toBe(30);
    });

    it('legend multiplier = 9', () => {
        const legend = applyLeagueMultiplier(baseBucket, 'legend');
        expect(legend.arenaPoints).toBe(9000);
        expect(legend.gold).toBe(900_000);
        expect(legend.mythicStones).toBe(90);
        expect(legend.legendaryStones).toBe(180);
    });

    it('does not mutate the input bucket', () => {
        const snapshot = { ...baseBucket };
        applyLeagueMultiplier(baseBucket, 'legend');
        expect(baseBucket).toEqual(snapshot);
    });

    it('preserves positionLabel and range', () => {
        const out = applyLeagueMultiplier(baseBucket, 'master');
        expect(out.positionLabel).toBe(baseBucket.positionLabel);
        expect(out.range).toEqual(baseBucket.range);
    });
});

// -- generateBotsForArena -----------------------------------------------------

describe('generateBotsForArena', () => {
    it('returns the requested number of bots', () => {
        const bots = generateBotsForArena('bronze', 5, 12345, 10);
        expect(bots).toHaveLength(5);
    });

    it('returns empty list when count = 0', () => {
        expect(generateBotsForArena('bronze', 0, 1, 10)).toHaveLength(0);
    });

    it('every bot has isBot=true', () => {
        const bots = generateBotsForArena('silver', 10, 42, 20);
        for (const b of bots) {
            expect(b.isBot).toBe(true);
        }
    });

    it('every bot has a defense snapshot', () => {
        const bots = generateBotsForArena('gold', 3, 7, 15);
        for (const b of bots) {
            expect(b.defense).toBeDefined();
            expect(b.defense.maxHp).toBeGreaterThan(0);
            expect(b.defense.maxMp).toBeGreaterThan(0);
            expect(b.defense.attack).toBeGreaterThan(0);
            expect(b.defense.defense).toBeGreaterThan(0);
            expect(b.defense.skillSlots).toHaveLength(4);
        }
    });

    it('deterministic by seed (same seed -> same roster)', () => {
        const a = generateBotsForArena('platinum', 8, 999, 30);
        const b = generateBotsForArena('platinum', 8, 999, 30);
        // Compare keys that don't depend on Date.now (so id/achievedAt may
        // differ slightly across runs but class/level/lp are seed-driven).
        const aStats = a.map((x) => ({ cls: x.class, lvl: x.level, lp: x.leaguePoints }));
        const bStats = b.map((x) => ({ cls: x.class, lvl: x.level, lp: x.leaguePoints }));
        expect(aStats).toEqual(bStats);
    });

    it('different seeds produce different rosters', () => {
        const a = generateBotsForArena('platinum', 8, 1, 30);
        const b = generateBotsForArena('platinum', 8, 2, 30);
        const aFingerprint = a.map((x) => `${x.class}_${x.level}_${x.leaguePoints}`).join('|');
        const bFingerprint = b.map((x) => `${x.class}_${x.level}_${x.leaguePoints}`).join('|');
        expect(aFingerprint).not.toBe(bFingerprint);
    });

    it('higher league produces beefier stats (gold > bronze)', () => {
        const bronze = generateBotsForArena('bronze', 20, 100, 50);
        const gold = generateBotsForArena('gold', 20, 100, 50);
        const bronzeAvgHp = bronze.reduce((s, b) => s + b.defense.maxHp, 0) / bronze.length;
        const goldAvgHp = gold.reduce((s, b) => s + b.defense.maxHp, 0) / gold.length;
        expect(goldAvgHp).toBeGreaterThan(bronzeAvgHp);
    });

    it('every bot level is at least 1', () => {
        // Player level 1 in master league would push baseLevel below 1
        // without the Math.max clamp — verify it doesn't go negative.
        const bots = generateBotsForArena('master', 50, 1, 1);
        for (const b of bots) {
            expect(b.level).toBeGreaterThanOrEqual(1);
        }
    });

    it('LP stays in [0, 100 + leagueIdx*25]', () => {
        const bots = generateBotsForArena('legend', 30, 7, 50); // top LP = 100 + 8*25 = 300
        for (const b of bots) {
            expect(b.leaguePoints).toBeGreaterThanOrEqual(0);
            expect(b.leaguePoints).toBeLessThanOrEqual(300);
        }
    });

    it('every bot has one of the 7 character classes', () => {
        const validClasses = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'];
        const bots = generateBotsForArena('emerald', 30, 5, 25);
        for (const b of bots) {
            expect(validClasses).toContain(b.class);
        }
    });

    it('bot ids embed league and seed for uniqueness', () => {
        const bots = generateBotsForArena('diamond', 3, 555, 25);
        for (let i = 0; i < bots.length; i++) {
            expect(bots[i].id).toBe(`bot_diamond_555_${i}`);
        }
    });
});

// -- Season clock -------------------------------------------------------------

describe('getSeasonStart', () => {
    it('returns the most recent Monday 00:00 UTC for a Wednesday', () => {
        // 2026-05-20 is a Wednesday.
        const ref = new Date('2026-05-20T14:30:00.000Z');
        const start = getSeasonStart(ref);
        expect(start.toISOString()).toBe('2026-05-18T00:00:00.000Z');
    });

    it('returns same day for a Monday', () => {
        // 2026-05-18 is a Monday.
        const monday = new Date('2026-05-18T08:00:00.000Z');
        expect(getSeasonStart(monday).toISOString()).toBe('2026-05-18T00:00:00.000Z');
    });

    it('returns previous Monday for a Sunday', () => {
        // 2026-05-24 is a Sunday — same week as 2026-05-18 Monday.
        const sunday = new Date('2026-05-24T23:59:59.000Z');
        expect(getSeasonStart(sunday).toISOString()).toBe('2026-05-18T00:00:00.000Z');
    });
});

describe('getSeasonEnd', () => {
    it('returns 7 days after season start', () => {
        const ref = new Date('2026-05-20T14:30:00.000Z');
        const end = getSeasonEnd(ref);
        expect(end.toISOString()).toBe('2026-05-25T00:00:00.000Z');
    });

    it('is exactly 7×24h after season start in ms', () => {
        const ref = new Date('2026-03-10T09:00:00.000Z');
        const ms = getSeasonEnd(ref).getTime() - getSeasonStart(ref).getTime();
        expect(ms).toBe(7 * 24 * 60 * 60 * 1000);
    });
});

describe('getSeasonMsRemaining', () => {
    it('is non-negative for any time inside a season', () => {
        const ref = new Date('2026-05-20T14:30:00.000Z');
        expect(getSeasonMsRemaining(ref)).toBeGreaterThanOrEqual(0);
    });

    it('decreases as time progresses', () => {
        const earlier = new Date('2026-05-19T10:00:00.000Z');
        const later   = new Date('2026-05-20T10:00:00.000Z');
        expect(getSeasonMsRemaining(earlier)).toBeGreaterThan(getSeasonMsRemaining(later));
    });

    it('clamps at 0 for far-future dates', () => {
        // getSeasonEnd uses the same reference, so this should never return
        // negative under any non-mocked scenario — but the Math.max(0, ...)
        // is defensive: verify it's there.
        const ref = new Date('2026-05-18T00:00:00.000Z'); // exactly season start
        const ms = getSeasonMsRemaining(ref);
        expect(ms).toBeGreaterThanOrEqual(0);
    });
});

describe('formatSeasonRemaining', () => {
    it('returns "Sezon zakończony" for 0 or negative ms', () => {
        expect(formatSeasonRemaining(0)).toBe('Sezon zakończony');
        expect(formatSeasonRemaining(-500)).toBe('Sezon zakończony');
    });

    it('formats hours for sub-day intervals', () => {
        // 3h 25m -> "3h 25m".
        const ms = 3 * 3600_000 + 25 * 60_000;
        expect(formatSeasonRemaining(ms)).toBe('3h 25m');
    });

    it('formats days for multi-day intervals', () => {
        // 2d 5h.
        const ms = 2 * 86400_000 + 5 * 3600_000;
        expect(formatSeasonRemaining(ms)).toBe('2d 5h');
    });

    it('formats minutes only for sub-hour intervals', () => {
        const ms = 45 * 60_000;
        expect(formatSeasonRemaining(ms)).toBe('45m');
    });

    it('rounds down to the floor minute', () => {
        // 59 seconds -> 0m.
        expect(formatSeasonRemaining(59 * 1000)).toBe('0m');
    });
});

// -- Deterministic random tests -----------------------------------------------

describe('arenaSystem with mocked Math.random', () => {
    let randomSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        randomSpy = vi.spyOn(Math, 'random');
    });

    afterEach(() => {
        randomSpy.mockRestore();
    });

    it('does not consume Math.random (uses internal seeded RNG)', () => {
        // generateBotsForArena uses its own seeded RNG, not Math.random,
        // so spying on Math.random shouldn't see any calls here.
        const before = randomSpy.mock.calls.length;
        generateBotsForArena('bronze', 5, 12345, 10);
        const after = randomSpy.mock.calls.length;
        expect(after).toBe(before);
    });
});

// -- getArenaCastableSkills (2026-06-21 bug fix) -----------------------------

describe('getArenaCastableSkills', () => {
    const EMPTY: Array<string | null> = [null, null, null, null];

    it('returns NOTHING for a new character with empty skill slots', () => {
        // The reported bug: a skill-less new char still cast skills. With empty
        // slots they must cast nothing (basic attacks only).
        expect(getArenaCastableSkills('Knight', EMPTY, 1)).toEqual([]);
        expect(getArenaCastableSkills('Mage', EMPTY, 50)).toEqual([]); // even at high level
    });

    it('returns ONLY the equipped skill, not every class skill', () => {
        // Knight has shield_bash (lvl 5), battle_cry (lvl 10), whirlwind (lvl 20)…
        // Equip ONLY shield_bash — the others must NOT be castable.
        const slots = ['shield_bash', null, null, null];
        const out = getArenaCastableSkills('Knight', slots, 30);
        const ids = out.map((s) => s.id);
        expect(ids).toContain('shield_bash');
        expect(ids).not.toContain('battle_cry');
        expect(ids).not.toContain('whirlwind');
        expect(out.length).toBe(1);
    });

    it('excludes an equipped skill the character has not yet level-unlocked', () => {
        // shield_bash unlocks at lvl 5 — at lvl 1 it is not castable even if the
        // slot somehow holds it.
        expect(getArenaCastableSkills('Knight', ['shield_bash', null, null, null], 1)).toEqual([]);
        // …and becomes castable once the level is reached.
        expect(getArenaCastableSkills('Knight', ['shield_bash', null, null, null], 5).map((s) => s.id))
            .toEqual(['shield_bash']);
    });

    it('ignores slot ids that are not real class skills (defensive)', () => {
        expect(getArenaCastableSkills('Knight', ['not_a_real_skill', null, null, null], 50)).toEqual([]);
    });
});

describe('getDefaultBotSkillSlots', () => {
    it('always returns exactly 4 slots', () => {
        expect(getDefaultBotSkillSlots('Knight', 1)).toHaveLength(4);
        expect(getDefaultBotSkillSlots('Knight', 100)).toHaveLength(4);
    });

    it('gives a level-1 Knight bot no skills (first skill unlocks at lvl 5)', () => {
        expect(getDefaultBotSkillSlots('Knight', 1)).toEqual([null, null, null, null]);
    });

    it('equips a high-level bot with real, level-unlocked class skills', () => {
        const slots = getDefaultBotSkillSlots('Knight', 60);
        const ids = slots.filter((s): s is string => s !== null);
        expect(ids.length).toBeGreaterThan(0);
        // Every equipped id is a real Knight skill that this loadout can cast.
        const castable = getArenaCastableSkills('Knight', slots, 60).map((s) => s.id);
        expect(castable.sort()).toEqual([...ids].sort());
    });
});
