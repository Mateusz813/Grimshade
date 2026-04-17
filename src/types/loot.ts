import type { TRarity } from './item';

export interface IDropTableEntry {
    itemId: string;
    chance: number;
    rarity: TRarity;
}

export interface IGeneratedItem {
    itemId: string;
    rarity: TRarity;
    bonuses: Record<string, number>;
    itemLevel: number;
}

export interface ILootResult {
    items: IGeneratedItem[];
    gold: number;
    xp: number;
}
