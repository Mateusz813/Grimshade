import type { Rarity } from './itemSystem';

export type MarketKind = 'item' | 'potion' | 'elixir' | 'stone' | 'arena_points' | 'spell_chest';

export interface IMarketListing {
    id: string;
    sellerId: string;
    sellerName: string;
    kind: MarketKind;
    itemId: string;
    itemName: string;
    itemLevel: number;
    rarity: Rarity;
    slot: string;
    price: number;
    quantity: number;
    quantityInitial: number;
    bonuses: Record<string, number>;
    upgradeLevel: number;
    listedAt: string;
}

export interface IMarketSaleNotification {
    id: string;
    sellerId: string;
    itemId: string;
    itemName: string;
    rarity: Rarity;
    quantitySold: number;
    goldReceived: number;
    soldAt: string;
    seen: boolean;
}

export type MarketSortBy = 'price_asc' | 'price_desc' | 'level_asc' | 'level_desc' | 'newest';

export type MarketFilterCategory =
    | 'all'
    | 'mainHand'
    | 'offHand'
    | 'helmet'
    | 'armor'
    | 'pants'
    | 'boots'
    | 'shoulders'
    | 'gloves'
    | 'ring'
    | 'necklace'
    | 'earrings'
    | 'potions'
    | 'elixirs'
    | 'stones'
    | 'arena_points'
    | 'spell_chests';

export const sortListings = (
    listings: IMarketListing[],
    sortBy: MarketSortBy,
): IMarketListing[] => {
    const sorted = [...listings];
    switch (sortBy) {
        case 'price_asc':
            return sorted.sort((a, b) => a.price - b.price);
        case 'price_desc':
            return sorted.sort((a, b) => b.price - a.price);
        case 'level_asc':
            return sorted.sort((a, b) => a.itemLevel - b.itemLevel);
        case 'level_desc':
            return sorted.sort((a, b) => b.itemLevel - a.itemLevel);
        case 'newest':
            return sorted.sort((a, b) => new Date(b.listedAt).getTime() - new Date(a.listedAt).getTime());
        default:
            return sorted;
    }
};

export const filterByCategory = (
    listings: IMarketListing[],
    category: MarketFilterCategory,
): IMarketListing[] => {
    if (category === 'all') return listings;
    return listings.filter((l) => {
        if (category === 'potions') return l.kind === 'potion';
        if (category === 'elixirs') return l.kind === 'elixir';
        if (category === 'stones') return l.kind === 'stone';
        if (category === 'arena_points') return l.kind === 'arena_points';
        if (category === 'spell_chests') return l.kind === 'spell_chest';
        if (category === 'ring') return l.slot === 'ring1' || l.slot === 'ring2';
        return l.slot === category && l.kind === 'item';
    });
};

export const filterByRarity = (
    listings: IMarketListing[],
    rarity: Rarity | 'all',
): IMarketListing[] => {
    if (rarity === 'all') return listings;
    return listings.filter((l) => l.rarity === rarity);
};

export const filterByLevelRange = (
    listings: IMarketListing[],
    minLevel: number,
    maxLevel: number,
): IMarketListing[] => {
    return listings.filter((l) => l.itemLevel >= minLevel && l.itemLevel <= maxLevel);
};

export const filterByName = (
    listings: IMarketListing[],
    query: string,
): IMarketListing[] => {
    const q = query.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter((l) => l.itemName.toLowerCase().includes(q));
};

export const isValidPrice = (price: number): boolean => {
    return Number.isInteger(price) && price >= 1 && price <= 999_999_999;
};

export const isValidQuantity = (qty: number, max = 999_999): boolean => {
    return Number.isInteger(qty) && qty >= 1 && qty <= max;
};

export const calculateMarketTax = (price: number): number => {
    return Math.floor(price * 0.05);
};

export const generateListingId = (): string => {
    return `ml_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

export const isStackKind = (kind: MarketKind): boolean =>
    kind === 'potion' || kind === 'elixir' || kind === 'stone' || kind === 'arena_points' || kind === 'spell_chest';
