export interface IElixir {
    id: string;
    name_pl: string;
    name_en: string;
    description_pl: string;
    price: number;
    effect: string;
    icon: string;
    minLevel?: number;
}

export interface IShopItem {
    id: string;
    name_pl: string;
    name_en: string;
    slot: string;
    minLevel: number;
    baseAtk?: number;
    baseDef?: number;
    basePrice: number;
    rarity: string;
    type?: string;
}

export type TBuyResult = 'ok' | 'no_gold' | 'bag_full' | 'level_too_low';
