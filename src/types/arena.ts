import type { TCharacterClass } from './character';

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

export interface IArenaCompetitor {
    id: string;
    name: string;
    class: TCharacterClass;
    level: number;
    avatarUrl?: string;
    color: string;
    leaguePoints: number;
    leaguePointsAchievedAt: string;
    seasonArenaPoints: number;
    isBot: boolean;
    defense: IArenaDefenseSnapshot;
    completedTransforms?: number[];
}

export interface IArenaDefenseSnapshot {
    maxHp: number;
    maxMp: number;
    attack: number;
    defense: number;
    skillSlots: Array<string | null>;
    snapshotAt: string;
}

export interface IArenaInstance {
    id: string;
    league: ArenaLeague;
    competitors: IArenaCompetitor[];
}

export interface IArenaMatchLogEntry {
    id: string;
    at: string;
    role: 'attacker' | 'defender';
    opponentName: string;
    opponentClass: TCharacterClass;
    opponentLevel: number;
    won: boolean;
    arenaPointsDelta: number;
    leaguePointsDelta: number;
}

export interface IArenaRewardBucket {
    positionLabel: string;
    range: [number, number];
    arenaPoints: number;
    gold: number;
    mythicStones: number;
    legendaryStones: number;
    epicStones: number;
    rareStones: number;
    commonStones: number;
    pctHpPotion: number;
    pctMpPotion: number;
}
