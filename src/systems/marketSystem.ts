import type { Rarity } from './itemSystem';

export interface IMarketListing {
    id: string;
    sellerId: string;
    sellerName: string;
    itemId: string;
    itemName: string;
    itemLevel: number;
    rarity: Rarity;
    slot: string;
    price: number;
    bonuses: Record<string, number>;
    upgradeLevel: number;
    listedAt: string;
}

export type MarketSortBy = 'price_asc' | 'price_desc' | 'level_asc' | 'level_desc' | 'newest';
export type MarketFilterSlot = 'all' | 'mainHand' | 'offHand' | 'helmet' | 'armor' | 'pants' | 'boots' | 'shoulders' | 'gloves' | 'ring' | 'necklace' | 'earrings';

/** Sort market listings */
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

/** Filter listings by slot */
export const filterBySlot = (
    listings: IMarketListing[],
    slot: MarketFilterSlot,
): IMarketListing[] => {
    if (slot === 'all') return listings;
    return listings.filter((l) => l.slot === slot);
};

/** Filter listings by rarity */
export const filterByRarity = (
    listings: IMarketListing[],
    rarity: Rarity | 'all',
): IMarketListing[] => {
    if (rarity === 'all') return listings;
    return listings.filter((l) => l.rarity === rarity);
};

/** Filter listings by class (checks if item slot is usable by class) */
export const filterByClass = (
    listings: IMarketListing[],
    characterClass: string | 'all',
): IMarketListing[] => {
    if (characterClass === 'all') return listings;
    // For now, return all listings (class filtering will be enhanced later)
    return listings;
};

/** Validate listing price */
export const isValidPrice = (price: number): boolean => {
    return Number.isInteger(price) && price >= 1 && price <= 999_999_999;
};

/** Calculate market tax (5% of sale price) */
export const calculateMarketTax = (price: number): number => {
    return Math.floor(price * 0.05);
};

/** Generate a unique listing ID */
export const generateListingId = (): string => {
    return `ml_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};
