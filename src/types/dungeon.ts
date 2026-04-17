import type { TRarity } from './item';

export interface IDungeonDropEntry {
    itemId: string;
    chance: number;
    rarity: TRarity;
}

export interface IDungeon {
    id: string;
    name_pl: string;
    name_en: string;
    /** Minimum character level required */
    level: number;
    /** Alias for level, used by older code */
    minLevel?: number;
    /** Max character level (optional) */
    maxLevel?: number;
    /** Number of waves. Derived from level if not set. */
    waves?: number;
    /** Cooldown in seconds. Derived from dailyAttempts if not set. */
    cooldown?: number;
    /** Daily attempts allowed */
    dailyAttempts?: number;
    /** Monster IDs for regular waves (optional) */
    monsters?: string[];
    /** Monster ID for final boss wave (optional) */
    bossMonster?: string;
    /** Gold reward range */
    rewardGold?: [number, number];
    /** XP reward */
    rewardXp?: number;
    maxRarity: TRarity;
    description_pl: string;
    dropTable?: IDungeonDropEntry[];
}

export interface IDungeonMonster {
    id: string;
    name_pl: string;
    hp: number;
    attack: number;
    defense: number;
    level: number;
    xp: number;
    sprite: string;
}

export interface IDungeonResult {
    success: boolean;
    wavesCleared: number;
    playerHpLeft: number;
    gold: number;
    xp: number;
    items: import('./loot').IGeneratedItem[];
}
