import type { TCharacterClass } from './character';

export type RaidPhase = 'lobby' | 'countdown' | 'fighting' | 'victory' | 'wipe';

export interface IRaid {
    id: string;
    name_pl: string;
    level: number;
    waves: number;
    dailyAttempts: number;
    sourceDungeonId: string;
}

export interface IRaidBossState {
    id: string;
    baseId: string;
    level: number;
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
    hasEscaped: boolean;
    color: string;
    transformTier: number;
}

export interface IRaidDropLine {
    kind: 'xp' | 'gold' | 'item' | 'spell_chest' | 'potion' | 'upgrade_stone';
    memberId: string;
    label: string;
    rarity?: string;
    amount?: number;
    itemId?: string;
    isBonus?: boolean;
}

export interface IRaidAttemptRecord {
    [raidId: string]: { day: string; count: number };
}
