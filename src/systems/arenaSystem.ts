
import {
    ARENA_LEAGUES,
    type ArenaLeague,
    type IArenaCompetitor,
    type IArenaRewardBucket,
} from '../types/arena';
import type { TCharacterClass } from '../types/character';
import skillsData from '../data/skills.json';


interface ILeagueBoundary {
    promotedTop: number | null;
    relegatedBottom: number | null;
}

export const LEAGUE_BOUNDARIES: Record<ArenaLeague, ILeagueBoundary> = {
    bronze:       { promotedTop: 40, relegatedBottom: null },
    silver:       { promotedTop: 35, relegatedBottom: 20 },
    gold:         { promotedTop: 33, relegatedBottom: 30 },
    platinum:     { promotedTop: 20, relegatedBottom: 40 },
    emerald:      { promotedTop: 17, relegatedBottom: 45 },
    diamond:      { promotedTop: 15, relegatedBottom: 50 },
    master:       { promotedTop: 10, relegatedBottom: 60 },
    grand_master: { promotedTop: 5,  relegatedBottom: 70 },
    legend:       { promotedTop: null, relegatedBottom: null },
};

export const getLeagueMultiplier = (league: ArenaLeague): number =>
    ARENA_LEAGUES.indexOf(league) + 1;

export const getNextLeague = (league: ArenaLeague): ArenaLeague => {
    const idx = ARENA_LEAGUES.indexOf(league);
    if (idx < 0) return league;
    return ARENA_LEAGUES[Math.min(ARENA_LEAGUES.length - 1, idx + 1)];
};

export const getPreviousLeague = (league: ArenaLeague): ArenaLeague => {
    const idx = ARENA_LEAGUES.indexOf(league);
    if (idx < 0) return league;
    return ARENA_LEAGUES[Math.max(0, idx - 1)];
};


export interface IArenaMatchReward {
    arenaPoints: number;
    leaguePoints: number;
}

export const getMatchReward = (won: boolean, attackerIsHigher: boolean): {
    attacker: IArenaMatchReward;
    defender: IArenaMatchReward;
} => {
    if (won) {
        if (attackerIsHigher) {
            return {
                attacker: { arenaPoints: 200, leaguePoints: 2 },
                defender: { arenaPoints: 0,   leaguePoints: 0 },
            };
        }
        return {
            attacker: { arenaPoints: 100, leaguePoints: 1 },
            defender: { arenaPoints: 0,   leaguePoints: 0 },
        };
    }
    if (attackerIsHigher) {
        return {
            attacker: { arenaPoints: 0,   leaguePoints: 0 },
            defender: { arenaPoints: 250, leaguePoints: 1 },
        };
    }
    return {
        attacker: { arenaPoints: 0,   leaguePoints: 0 },
        defender: { arenaPoints: 250, leaguePoints: 2 },
    };
};


export const ARENA_DAMAGE_MULTIPLIER = 0.2;


export interface IArenaSkill {
    id: string;
    unlockLevel: number;
    mpCost: number;
    cooldown: number;
    damage: number;
    effect?: string;
}

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


export const rankCompetitors = (
    competitors: IArenaCompetitor[],
): Array<{ competitor: IArenaCompetitor; rank: number }> => {
    const sorted = [...competitors].sort((a, b) => {
        if (b.leaguePoints !== a.leaguePoints) return b.leaguePoints - a.leaguePoints;
        if (b.level !== a.level) return b.level - a.level;
        const ta = Date.parse(a.leaguePointsAchievedAt) || 0;
        const tb = Date.parse(b.leaguePointsAchievedAt) || 0;
        return ta - tb;
    });
    return sorted.map((c, idx) => ({ competitor: c, rank: idx + 1 }));
};

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
        const c = ranked[i].competitor;
        const origIdx = competitors.findIndex((x) => x.id === c.id);
        if (origIdx >= 0) out.push(origIdx);
    }
    return out;
};


export type ArenaSeasonOutcome =
    | { type: 'promote'; toLeague: ArenaLeague }
    | { type: 'stay' }
    | { type: 'relegate'; toLeague: ArenaLeague };

export const getSeasonOutcome = (
    league: ArenaLeague,
    finalRank: number,
): ArenaSeasonOutcome => {
    const b = LEAGUE_BOUNDARIES[league];
    if (b.promotedTop !== null && finalRank <= b.promotedTop) {
        return { type: 'promote', toLeague: getNextLeague(league) };
    }
    if (b.relegatedBottom !== null) {
        const lo = 100 - b.relegatedBottom + 1;
        if (finalRank >= lo) {
            return { type: 'relegate', toLeague: getPreviousLeague(league) };
        }
    }
    return { type: 'stay' };
};


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

export const findRewardBucket = (rank: number): IArenaRewardBucket | null => {
    return REWARD_BUCKETS.find((b) => rank >= b.range[0] && rank <= b.range[1]) ?? null;
};

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
        pctHpPotion:     bucket.pctHpPotion     * m,
        pctMpPotion:     bucket.pctMpPotion     * m,
    };
};


const BOT_NAMES: string[] = [
    'Krwawy Cień', 'Ostry Pazur', 'Mroźna Strzała', 'Pieklny Kowal', 'Stalowy Łowca',
    'Cichy Wilk', 'Burzowy Mag', 'Złoty Strażnik', 'Karmazyn', 'Szmaragd',
    'Bursztyn', 'Lazur', 'Onyks', 'Ametyst', 'Topaz',
    'Rubin', 'Szafir', 'Diament', 'Perła', 'Kwarc',
];

const randInRange = (rng: () => number, min: number, max: number): number =>
    Math.floor(min + rng() * (max - min + 1));

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

export const generateBotsForArena = (
    league: ArenaLeague,
    count: number,
    seed: number,
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
                skillSlots: getDefaultBotSkillSlots(cls, lvl),
                snapshotAt: new Date().toISOString(),
            },
        });
    }
    return out;
};


export const getSeasonStart = (now: Date = new Date()): Date => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dow = d.getUTCDay();
    const offsetToMonday = (dow + 6) % 7;
    d.setUTCDate(d.getUTCDate() - offsetToMonday);
    return d;
};

export const getSeasonEnd = (now: Date = new Date()): Date => {
    const start = getSeasonStart(now);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return end;
};

export const getSeasonMsRemaining = (now: Date = new Date()): number =>
    Math.max(0, getSeasonEnd(now).getTime() - now.getTime());

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
