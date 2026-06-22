/**
 * Arena season + ranking utilities.
 *
 * Pure functions only — no React, no Zustand, no DOM. Everything operates
 * on the data shapes from `types/arena.ts` so the store + view + bot
 * generator can share the rules without duplicating constants.
 */

import {
    ARENA_LEAGUES,
    type ArenaLeague,
    type IArenaCompetitor,
    type IArenaRewardBucket,
} from '../types/arena';
import type { TCharacterClass } from '../types/character';
import skillsData from '../data/skills.json';

// -- League promotion / relegation thresholds --------------------------------
//
// `[promotedTop, relegatedBottom]` — both 1-based, inclusive, both clamped
// to the 100-player arena. Bronze has no relegation (already lowest), Legend
// has no promotion (already highest).

interface ILeagueBoundary {
    promotedTop: number | null;     // top N positions promote — null for Legend
    relegatedBottom: number | null; // bottom N positions relegate — null for Bronze
}

export const LEAGUE_BOUNDARIES: Record<ArenaLeague, ILeagueBoundary> = {
    bronze:       { promotedTop: 40, relegatedBottom: null },
    silver:       { promotedTop: 35, relegatedBottom: 20 },  // 81-100 (bottom 20)
    gold:         { promotedTop: 33, relegatedBottom: 30 },  // 71-100 (bottom 30)
    platinum:     { promotedTop: 20, relegatedBottom: 40 },  // 61-100 (bottom 40)
    emerald:      { promotedTop: 17, relegatedBottom: 45 },  // interpolated — between platinum and diamond
    diamond:      { promotedTop: 15, relegatedBottom: 50 },  // 51-100 (bottom 50)
    master:       { promotedTop: 10, relegatedBottom: 60 },  // 41-100 (bottom 60)
    grand_master: { promotedTop: 5,  relegatedBottom: 70 },  // 31-100 (bottom 70)
    legend:       { promotedTop: null, relegatedBottom: null }, // top league — no promo, no relegation
};

/** Reward multiplier = league index + 1 (bronze=1, ..., legend=9). */
export const getLeagueMultiplier = (league: ArenaLeague): number =>
    ARENA_LEAGUES.indexOf(league) + 1;

/** Next league up (or same when at top). */
export const getNextLeague = (league: ArenaLeague): ArenaLeague => {
    const idx = ARENA_LEAGUES.indexOf(league);
    if (idx < 0) return league;
    return ARENA_LEAGUES[Math.min(ARENA_LEAGUES.length - 1, idx + 1)];
};

/** Previous league down (or same when at bottom). */
export const getPreviousLeague = (league: ArenaLeague): ArenaLeague => {
    const idx = ARENA_LEAGUES.indexOf(league);
    if (idx < 0) return league;
    return ARENA_LEAGUES[Math.max(0, idx - 1)];
};

// -- Match reward math ------------------------------------------------------

export interface IArenaMatchReward {
    arenaPoints: number;
    leaguePoints: number;
}

/**
 * Compute arena + league points awarded after a match. Loser of an attack
 * never loses points (per spec), so the negative side is always 0/0 — the
 * winner gets the full payout.
 *
 * @param won            true if `attacker` won
 * @param attackerHigher true if attacker's rank is BELOW (i.e. weaker rank
 *                       number) than defender's, meaning attacker is
 *                       reaching UP the table. Higher rank attacks UP.
 */
export const getMatchReward = (won: boolean, attackerIsHigher: boolean): {
    attacker: IArenaMatchReward;
    defender: IArenaMatchReward;
} => {
    if (won) {
        if (attackerIsHigher) {
            // Attacking up + winning the match: classic upset — biggest payout.
            return {
                attacker: { arenaPoints: 200, leaguePoints: 2 },
                defender: { arenaPoints: 0,   leaguePoints: 0 },
            };
        }
        // Attacking down + winning: smaller payout (favoured matchup).
        return {
            attacker: { arenaPoints: 100, leaguePoints: 1 },
            defender: { arenaPoints: 0,   leaguePoints: 0 },
        };
    }
    // Lost match — defender pays out, attacker gets nothing.
    if (attackerIsHigher) {
        // Defender held off an attack from below them: smaller bonus.
        return {
            attacker: { arenaPoints: 0,   leaguePoints: 0 },
            defender: { arenaPoints: 250, leaguePoints: 1 },
        };
    }
    // Defender held off an attack from above them: bigger upset bonus.
    return {
        attacker: { arenaPoints: 0,   leaguePoints: 0 },
        defender: { arenaPoints: 250, leaguePoints: 2 },
    };
};

// -- Damage scaling ----------------------------------------------------------

/** Arena attacks deal 80% LESS damage than the regular world combat
 *  formulas would produce. The earlier 0.4 (= -60%) still let crit-heavy
 *  duels finish in 2-3 swings; 0.2 stretches even the fastest match into
 *  ~10+ exchanges so the player gets to see the per-round visuals. */
export const ARENA_DAMAGE_MULTIPLIER = 0.2;

// -- Castable skills (equipped loadout only) --------------------------------

export interface IArenaSkill {
    id: string;
    unlockLevel: number;
    mpCost: number;
    cooldown: number;
    damage: number;
    effect?: string;
}

/**
 * The active skills a combatant may cast in an arena match.
 *
 * 2026-06-21 bug fix: a combatant casts ONLY the skills currently EQUIPPED in
 * their skill slots — NOT every class skill they happen to be high enough level
 * to use. A brand-new character with empty slots has nothing to cast, so they
 * fall back to basic attacks (player report: "atakując kogoś uderzam go
 * skillami których nawet nie mam odblokowanych").
 *
 * Filters: equipped (id ∈ skillSlots) ∩ class-active catalog ∩ level-unlocked ∩
 * actually does something (damage or effect). MP / cooldown gating is applied
 * later per-tick by the caller.
 */
export const getArenaCastableSkills = (
    characterClass: string,
    skillSlots: ReadonlyArray<string | null>,
    level: number,
): IArenaSkill[] => {
    const equipped = new Set(skillSlots.filter((s): s is string => !!s));
    if (equipped.size === 0) return [];
    const key = characterClass.toLowerCase() as keyof typeof skillsData.activeSkills;
    const classSkills = (skillsData.activeSkills[key] ?? []) as IArenaSkill[];
    return classSkills.filter(
        (s) => equipped.has(s.id) && s.unlockLevel <= level && (s.damage > 0 || !!s.effect),
    );
};

/**
 * A sensible default equipped loadout for a generated arena BOT: up to 4 of its
 * class's active skills that are unlocked at the bot's level (strongest/highest-
 * tier first), padded to 4 slots. Because the arena now only casts EQUIPPED
 * skills (getArenaCastableSkills), bots need an actual loadout or they'd throw
 * nothing but basic attacks. A level-1 bot has no unlocked skills → empty slots
 * → basics only, exactly like a fresh human at that level.
 */
export const getDefaultBotSkillSlots = (
    characterClass: string,
    level: number,
): Array<string | null> => {
    const key = characterClass.toLowerCase() as keyof typeof skillsData.activeSkills;
    const classSkills = (skillsData.activeSkills[key] ?? []) as IArenaSkill[];
    const ids = classSkills
        .filter((s) => s.unlockLevel <= level && (s.damage > 0 || !!s.effect))
        .sort((a, b) => b.unlockLevel - a.unlockLevel)
        .slice(0, 4)
        .map((s) => s.id);
    const slots: Array<string | null> = [...ids];
    while (slots.length < 4) slots.push(null);
    return slots;
};

// -- Position computation ---------------------------------------------------

/**
 * Strict total ordering — every competitor gets a UNIQUE 1-based rank.
 * Ties are impossible because the comparator chains three keys:
 *   1. League points (desc) — primary score
 *   2. Level (desc)         — higher-level character wins identical LP
 *   3. `leaguePointsAchievedAt` (asc) — whoever reached the LP total
 *      first ranks higher (rewards the early climber).
 * Dense / Olympic ranking is gone per the 2026-05 spec update: the
 * leaderboard is meant to feel like a competitive ladder, not a
 * tournament bracket.
 */
export const rankCompetitors = (
    competitors: IArenaCompetitor[],
): Array<{ competitor: IArenaCompetitor; rank: number }> => {
    const sorted = [...competitors].sort((a, b) => {
        if (b.leaguePoints !== a.leaguePoints) return b.leaguePoints - a.leaguePoints;
        if (b.level !== a.level) return b.level - a.level;
        // Earlier ISO timestamp ranks higher (whoever climbed first wins).
        const ta = Date.parse(a.leaguePointsAchievedAt) || 0;
        const tb = Date.parse(b.leaguePointsAchievedAt) || 0;
        return ta - tb;
    });
    return sorted.map((c, idx) => ({ competitor: c, rank: idx + 1 }));
};

/**
 * Returns the indices that the player can attack (±2 ranks), filtering
 * out the player themselves. Uses the dense rank ordering so two-way ties
 * still let the player attack across them.
 */
export const getAttackableIndices = (
    competitors: IArenaCompetitor[],
    myCompetitorId: string,
): number[] => {
    const ranked = rankCompetitors(competitors);
    const meIdx = ranked.findIndex((r) => r.competitor.id === myCompetitorId);
    if (meIdx < 0) return [];
    const out: number[] = [];
    for (let i = Math.max(0, meIdx - 2); i <= Math.min(ranked.length - 1, meIdx + 2); i++) {
        if (i === meIdx) continue;
        // Map back to the original `competitors` array index.
        const c = ranked[i].competitor;
        const origIdx = competitors.findIndex((x) => x.id === c.id);
        if (origIdx >= 0) out.push(origIdx);
    }
    return out;
};

// -- Promotion / relegation --------------------------------------------------

export type ArenaSeasonOutcome =
    | { type: 'promote'; toLeague: ArenaLeague }
    | { type: 'stay' }
    | { type: 'relegate'; toLeague: ArenaLeague };

/**
 * Resolve a single competitor's end-of-season outcome based on their
 * final rank in the arena. Tied competitors at the boundary all receive
 * the same outcome (per-spec: "może awansować więcej osób niż przewidziane").
 */
export const getSeasonOutcome = (
    league: ArenaLeague,
    finalRank: number,
): ArenaSeasonOutcome => {
    const b = LEAGUE_BOUNDARIES[league];
    if (b.promotedTop !== null && finalRank <= b.promotedTop) {
        return { type: 'promote', toLeague: getNextLeague(league) };
    }
    if (b.relegatedBottom !== null) {
        const lo = 100 - b.relegatedBottom + 1; // first relegated rank
        if (finalRank >= lo) {
            return { type: 'relegate', toLeague: getPreviousLeague(league) };
        }
    }
    return { type: 'stay' };
};

// -- Reward table -----------------------------------------------------------

const REWARD_BUCKETS: IArenaRewardBucket[] = [
    {
        positionLabel: '1',
        range: [1, 1],
        arenaPoints: 1000, gold: 100_000,
        mythicStones: 10, legendaryStones: 20, epicStones: 30, rareStones: 40, commonStones: 50,
        pctHpPotion: 100, pctMpPotion: 100,
    },
    {
        positionLabel: '2',
        range: [2, 2],
        arenaPoints: 800, gold: 80_000,
        mythicStones: 8, legendaryStones: 15, epicStones: 20, rareStones: 30, commonStones: 40,
        pctHpPotion: 50, pctMpPotion: 50,
    },
    {
        positionLabel: '3',
        range: [3, 3],
        arenaPoints: 500, gold: 50_000,
        mythicStones: 5, legendaryStones: 10, epicStones: 15, rareStones: 20, commonStones: 30,
        pctHpPotion: 25, pctMpPotion: 25,
    },
    {
        positionLabel: '4-5',
        range: [4, 5],
        arenaPoints: 300, gold: 30_000,
        mythicStones: 1, legendaryStones: 5, epicStones: 10, rareStones: 15, commonStones: 20,
        pctHpPotion: 0, pctMpPotion: 0,
    },
    {
        positionLabel: '6-10',
        range: [6, 10],
        arenaPoints: 200, gold: 20_000,
        mythicStones: 0, legendaryStones: 0, epicStones: 10, rareStones: 15, commonStones: 20,
        pctHpPotion: 0, pctMpPotion: 0,
    },
    {
        positionLabel: '11-50',
        range: [11, 50],
        arenaPoints: 100, gold: 10_000,
        mythicStones: 0, legendaryStones: 0, epicStones: 0, rareStones: 10, commonStones: 15,
        pctHpPotion: 0, pctMpPotion: 0,
    },
    {
        positionLabel: '51-100',
        range: [51, 100],
        arenaPoints: 50, gold: 5_000,
        mythicStones: 0, legendaryStones: 0, epicStones: 0, rareStones: 5, commonStones: 10,
        pctHpPotion: 0, pctMpPotion: 0,
    },
];

export const getRewardBuckets = (): IArenaRewardBucket[] => [...REWARD_BUCKETS];

/** Find the bucket that covers `rank` (1-based). null when out-of-range. */
export const findRewardBucket = (rank: number): IArenaRewardBucket | null => {
    return REWARD_BUCKETS.find((b) => rank >= b.range[0] && rank <= b.range[1]) ?? null;
};

/** Apply the league multiplier to a bucket. All counts scale linearly. */
export const applyLeagueMultiplier = (
    bucket: IArenaRewardBucket,
    league: ArenaLeague,
): IArenaRewardBucket => {
    const m = getLeagueMultiplier(league);
    return {
        ...bucket,
        arenaPoints:     bucket.arenaPoints     * m,
        gold:            bucket.gold            * m,
        mythicStones:    bucket.mythicStones    * m,
        legendaryStones: bucket.legendaryStones * m,
        epicStones:      bucket.epicStones      * m,
        rareStones:      bucket.rareStones      * m,
        commonStones:    bucket.commonStones    * m,
        pctHpPotion:     bucket.pctHpPotion     * m, // count grant — see spec wording: "100% HP POTION × liga"
        pctMpPotion:     bucket.pctMpPotion     * m,
    };
};

// -- Bot generation ---------------------------------------------------------

const BOT_NAMES: string[] = [
    'Krwawy Cień', 'Ostry Pazur', 'Mroźna Strzała', 'Pieklny Kowal', 'Stalowy Łowca',
    'Cichy Wilk', 'Burzowy Mag', 'Złoty Strażnik', 'Karmazyn', 'Szmaragd',
    'Bursztyn', 'Lazur', 'Onyks', 'Ametyst', 'Topaz',
    'Rubin', 'Szafir', 'Diament', 'Perła', 'Kwarc',
];

/** Pseudo-random (deterministic per seed) integer in [min, max]. */
const randInRange = (rng: () => number, min: number, max: number): number =>
    Math.floor(min + rng() * (max - min + 1));

/** Tiny seedable RNG (mulberry32) — one instance per arena gen. */
const seededRng = (seed: number): (() => number) => {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/**
 * Build a roster of bots to fill an arena up to 100 slots. Stat scaling
 * roughly matches the league tier so bronze bots are easy and legend
 * bots are no-jokes. League points within the arena are spread between
 * 0 and `100 + leagueIdx * 25` so the leaderboard isn't a flat zero
 * band on day one.
 */
export const generateBotsForArena = (
    league: ArenaLeague,
    count: number,
    /** Seed for deterministic generation per arena id (so reloading
     *  doesn't reroll the bot roster). */
    seed: number,
    /** Player level reference (bots scale around the league + player tier
     *  so low-level players in high leagues — rare but possible — still
     *  see fightable opponents). */
    playerLevel: number,
): IArenaCompetitor[] => {
    const rng = seededRng(seed);
    const leagueIdx = ARENA_LEAGUES.indexOf(league);
    const classes: TCharacterClass[] = [
        'Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard',
    ];
    const out: IArenaCompetitor[] = [];
    const baseLevel = Math.max(1, Math.floor(playerLevel + (leagueIdx - 4) * 8));
    const topLp = 100 + leagueIdx * 25;

    // Bots get a synthetic "earlier-the-higher-LP" climb timestamp so
    // that on identical-LP+level matchups they fall naturally beneath
    // any human climber who hits the same score later. Spread between
    // an hour ago and a week ago, biased so high-LP bots tend to have
    // earlier timestamps (rewards the established veterans).
    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < count; i++) {
        const cls = classes[Math.floor(rng() * classes.length)];
        const lvl = Math.max(1, baseLevel + randInRange(rng, -10, 10));
        const lp = randInRange(rng, 0, topLp);
        const sap = randInRange(rng, 0, lp * 100);
        const hp = 200 + lvl * 35 + leagueIdx * 25;
        const mp = 80 + lvl * 12 + leagueIdx * 10;
        const atk = 8 + lvl * 2 + leagueIdx * 3;
        const def = 4 + lvl * 1 + leagueIdx * 2;
        // Higher LP -> older achievement timestamp.
        const lpFraction = topLp > 0 ? lp / topLp : 0;
        const ageMs = Math.floor(SEVEN_DAYS_MS * lpFraction * (0.6 + rng() * 0.8));
        const achievedAt = new Date(now - ageMs).toISOString();
        out.push({
            id: `bot_${league}_${seed}_${i}`,
            name: `${BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)]} ${i + 1}`,
            class: cls,
            level: lvl,
            color: '#888',
            leaguePoints: lp,
            leaguePointsAchievedAt: achievedAt,
            seasonArenaPoints: sap,
            isBot: true,
            defense: {
                maxHp: hp,
                maxMp: mp,
                attack: atk,
                defense: def,
                // 2026-06-21: give bots a real equipped loadout (their class's
                // unlocked skills for their level) — the arena only casts
                // EQUIPPED skills now, so empty slots would make bots throw only
                // basic attacks.
                skillSlots: getDefaultBotSkillSlots(cls, lvl),
                snapshotAt: new Date().toISOString(),
            },
        });
    }
    return out;
};

// -- Season clock -----------------------------------------------------------

/**
 * Computes the start-of-week (Monday 00:00 UTC) for the week that
 * contains `now`. Seasons run Mon -> Sun; rewards are claimable Monday.
 */
export const getSeasonStart = (now: Date = new Date()): Date => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dow = d.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const offsetToMonday = (dow + 6) % 7; // 0 = Mon, 6 = Sun
    d.setUTCDate(d.getUTCDate() - offsetToMonday);
    return d;
};

/** End of current season (next Monday 00:00 UTC). */
export const getSeasonEnd = (now: Date = new Date()): Date => {
    const start = getSeasonStart(now);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return end;
};

/** ms remaining in the current season. */
export const getSeasonMsRemaining = (now: Date = new Date()): number =>
    Math.max(0, getSeasonEnd(now).getTime() - now.getTime());

/** Format ms as "Xd Yh" / "Yh Zm" — used for the countdown above the leaderboard. */
export const formatSeasonRemaining = (ms: number): string => {
    if (ms <= 0) return 'Sezon zakończony';
    const totalMin = Math.floor(ms / 60_000);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const minutes = totalMin % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
};
