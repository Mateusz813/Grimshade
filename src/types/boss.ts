export interface IBossDropEntry {
    itemId: string;
    chance: number;
    rarity: string;
    /** Optional UI metadata - may not be in JSON */
    name_pl?: string;
    name_en?: string;
    slot?: string;
    bonuses?: Record<string, number>;
}

/** Legacy alias used in Boss.tsx result display */
export type IBossUniqueItem = IBossDropEntry & {
    bonuses: Record<string, number>;
};

export interface IBoss {
    id: string;
    name_pl: string;
    name_en: string;
    level: number;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    xp: number;
    gold: [number, number];
    /** Cooldown in seconds. Falls back to dailyAttempts-derived value. */
    cooldown?: number;
    /** Daily attempts (used to derive cooldown when cooldown missing) */
    dailyAttempts?: number;
    sprite: string;
    /** uniqueDrops OR dropTable - both accepted */
    uniqueDrops?: IBossDropEntry[];
    dropTable?: IBossDropEntry[];
    heroicDropChance?: number;
    abilities?: string[];
    description_pl: string;
}

export interface IBossResult {
    won: boolean;
    playerHpLeft: number;
    turns: number;
    drops: IBossUniqueItem[];
    gold: number;
    xp: number;
}
