import type { TCharacterClass } from './character';

/** Nine-tier league ladder. Bronze = lowest, Legend = top. */
export type ArenaLeague =
    | 'bronze'
    | 'silver'
    | 'gold'
    | 'platinum'
    | 'emerald'
    | 'diamond'
    | 'master'
    | 'grand_master'
    | 'legend';

/** Ordered list — index = "league number" (1-based) used as the reward
 *  multiplier (bronze=1, ..., legend=9). */
export const ARENA_LEAGUES: ArenaLeague[] = [
    'bronze',
    'silver',
    'gold',
    'platinum',
    'emerald',
    'diamond',
    'master',
    'grand_master',
    'legend',
];

/** Display label per league. */
export const ARENA_LEAGUE_LABELS: Record<ArenaLeague, string> = {
    bronze:       'Bronze',
    silver:       'Silver',
    gold:         'Gold',
    platinum:     'Platinum',
    emerald:      'Emerald',
    diamond:      'Diamond',
    master:       'Master',
    grand_master: 'Grand Master',
    legend:       'Legend',
};

/** Hex accent per league — used for the icon ring + table chrome. */
export const ARENA_LEAGUE_COLORS: Record<ArenaLeague, string> = {
    bronze:       '#cd7f32',
    silver:       '#c0c0c0',
    gold:         '#ffc107',
    platinum:     '#6cd3e7',
    emerald:      '#50c878',
    diamond:      '#b9f2ff',
    master:       '#9c27b0',
    grand_master: '#e91e63',
    legend:       '#ff5722',
};

/** Emoji icon shown next to the league name. */
export const ARENA_LEAGUE_ICONS: Record<ArenaLeague, string> = {
    bronze:       '3rd-place-medal',
    silver:       '2nd-place-medal',
    gold:         '1st-place-medal',
    platinum:     'diamond-with-a-dot',
    emerald:      'green-circle',
    diamond:      'gem-stone',
    master:       'trophy',
    grand_master: 'crown',
    legend:       'high-voltage',
};

/**
 * One competitor in an arena leaderboard. May be a real player snapshot
 * or a bot — same shape so the list / match-up logic doesn't have to
 * branch.
 */
export interface IArenaCompetitor {
    /** Stable id: `player_<characterId>` for humans, `bot_<league>_<n>` for bots. */
    id: string;
    /** Display name. */
    name: string;
    class: TCharacterClass;
    level: number;
    /** Current avatar URL — uses the same getCharacterAvatar() registry as the rest of the app. */
    avatarUrl?: string;
    /** Class accent color or transform color hex. */
    color: string;
    /** League points (used for ranking + promotion). Cannot decrease. */
    leaguePoints: number;
    /** ISO timestamp marking when this competitor first reached their
     *  current `leaguePoints` total. Drives the secondary tiebreak —
     *  on identical LP + identical level, whoever climbed there first
     *  ranks higher. Refreshed by `finalizeMatch` every time LP grows. */
    leaguePointsAchievedAt: string;
    /** Lifetime arena points earned this season. Used as tiebreaker. */
    seasonArenaPoints: number;
    /** Bot flag — bots respawn at season start; humans persist across seasons. */
    isBot: boolean;
    /** Defense snapshot: combat stats the OPPONENT will see when attacking us. */
    defense: IArenaDefenseSnapshot;
    /** List of completed transform tier ids — drives the leaderboard
     *  avatar render (so an alt's transform card art shows up next to
     *  their name even though they're "offline"). Empty / omitted on bots
     *  and on alts who never unlocked a transform. */
    completedTransforms?: number[];
}

/**
 * Frozen combat snapshot — what an attacker fights when they hit us. The
 * snapshot is updated when the player presses "Confirm" on the defense
 * screen; until then, opponents see our previous version (so swapping
 * gear / skills mid-day doesn't punish defenders for unfinished builds).
 */
export interface IArenaDefenseSnapshot {
    /** Effective max HP (with equip + training, NO elixirs/transform). */
    maxHp: number;
    maxMp: number;
    attack: number;
    defense: number;
    /** Skill loadout — 4 active slot ids snapshotted at submit time. */
    skillSlots: Array<string | null>;
    /** Captured at: ISO timestamp. */
    snapshotAt: string;
}

/** Arena = a slice of one league with up to 100 players. Multiple arenas
 *  exist when a single league fills past 100; players are bucketed at
 *  season start (and on promotion/relegation). */
export interface IArenaInstance {
    id: string; // e.g. "bronze_1", "bronze_2"
    league: ArenaLeague;
    /** Sorted descending by leaguePoints; ties keep the same rank. */
    competitors: IArenaCompetitor[];
}

/** Win/loss/defeat record for the per-season attack log (max ~100 entries). */
export interface IArenaMatchLogEntry {
    id: string;
    /** ISO. */
    at: string;
    /** Who initiated the attack. */
    role: 'attacker' | 'defender';
    opponentName: string;
    opponentClass: TCharacterClass;
    opponentLevel: number;
    won: boolean;
    arenaPointsDelta: number;
    leaguePointsDelta: number;
}

/** Per-position reward bucket (per-league multiplier applies on top). */
export interface IArenaRewardBucket {
    /** "1", "2", "3", "4-5", "6-10", "11-50", "51-100". */
    positionLabel: string;
    /** Inclusive 1-based position bounds (`[hi, lo]`, hi <= lo). */
    range: [number, number];
    arenaPoints: number;
    gold: number;
    mythicStones: number;
    legendaryStones: number;
    epicStones: number;
    rareStones: number;
    commonStones: number;
    /** % HP potion granted (e.g. `100` = 100% HP, `25` = 25%). 0 = none. */
    pctHpPotion: number;
    pctMpPotion: number;
}
