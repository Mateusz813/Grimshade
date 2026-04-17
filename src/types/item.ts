export type TRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'heroic';

export type TEquipmentSlot =
    | 'helmet'
    | 'armor'
    | 'pants'
    | 'gloves'
    | 'shoulders'
    | 'mainHand'
    | 'offHand'
    | 'ring1'
    | 'ring2'
    | 'earrings'
    | 'necklace';

export interface IBaseItem {
    id: string;
    name_pl: string;
    name_en: string;
    slot: TEquipmentSlot;
    minLevel: number;
    baseAtk?: number;
    baseDef?: number;
    basePrice: number;
    rarity: TRarity;
    type?: string;
}

export interface IInventoryItem {
    uuid: string;
    itemId: string;
    rarity: TRarity;
    bonuses: Record<string, number>;
    itemLevel: number;
}

export interface IItemStats {
    attack: number;
    defense: number;
    hp: number;
    mp: number;
    speed: number;
    critChance: number;
}

export type IEquipment = Record<TEquipmentSlot, IInventoryItem | null>;
