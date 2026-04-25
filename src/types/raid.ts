import type { TCharacterClass } from './character';

export type RaidPhase = 'lobby' | 'countdown' | 'fighting' | 'victory' | 'wipe';

export interface IRaid {
    id: string;
    name_pl: string;
    level: number;
    waves: number;
    dailyAttempts: number;
    /** Dungeon this raid mirrors (for drop table inspiration). */
    sourceDungeonId: string;
}

export interface IRaidBossState {
    id: string;
    baseId: string;
    name: string;
    sprite: string;
    maxHp: number;
    currentHp: number;
    attack: number;
    defense: number;
    isDead: boolean;
    waveIdx: number;
    slotIdx: number;
}

export interface IRaidMemberState {
    id: string;
    name: string;
    class: TCharacterClass;
    level: number;
    maxHp: number;
    hp: number;
    maxMp: number;
    mp: number;
    attack: number;
    defense: number;
    isDead: boolean;
    isBot: boolean;
    /** Character has escaped mid-raid (left party). Counts as failed run. */
    hasEscaped: boolean;
    /** Gradient/solid color for member card accents. */
    color: string;
    /** Ablaze tier (0 = none). */
    transformTier: number;
}

export interface IRaidDropLine {
    kind: 'xp' | 'gold' | 'item' | 'spell_chest' | 'potion' | 'upgrade_stone';
    memberId: string;
    label: string;
    rarity?: string;
    amount?: number;
    itemId?: string;
}

export interface IRaidAttemptRecord {
    /** Map raidId → ISO date string (YYYY-MM-DD) → count used that day */
    [raidId: string]: { day: string; count: number };
}

/** Event payload broadcast over Supabase realtime to other party members. */
export type RaidRealtimeEvent =
    | { t: 'attack'; memberId: string; slotIdx: number; dmg: number; crit?: boolean }
    | { t: 'skill'; memberId: string; skillId: string; targets: number[]; dmg: number }
    | { t: 'boss-attack'; slotIdx: number; targetId: string; dmg: number }
    | { t: 'member-hp'; memberId: string; hp: number }
    | { t: 'member-mp'; memberId: string; mp: number }
    | { t: 'boss-hp'; slotIdx: number; hp: number; isDead: boolean }
    | { t: 'wave-advance'; waveIdx: number }
    | { t: 'end'; result: 'victory' | 'wipe' }
    | { t: 'escape'; memberId: string }
    | { t: 'start'; raidId: string; seed: number };
