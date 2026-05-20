import type { Rarity } from './itemSystem';

/**
 * 2026-05-08 v2: market overhaul per spec.
 *
 * Listings now support both EQUIPMENT (single, generated armor/weapon
 * with random bonuses) and STACK kinds (potions / elixirs / stones /
 * arena points where the seller picks a quantity and a per-unit price,
 * and buyers can take a partial slice).
 *
 * The `kind` discriminator drives every code path that needs to know
 * whether the listing is unique or splittable.
 */
export type MarketKind = 'item' | 'potion' | 'elixir' | 'stone' | 'arena_points' | 'spell_chest';

export interface IMarketListing {
    id: string;
    sellerId: string;
    sellerName: string;
    /** Kind discriminator. Equipment items default to `'item'` for
     *  backward-compat with existing rows that don't have a kind set. */
    kind: MarketKind;
    itemId: string;
    itemName: string;
    itemLevel: number;
    rarity: Rarity;
    slot: string;
    /** Per-unit price for stack kinds; full sale price for `'item'`. */
    price: number;
    /** Stack size remaining on the listing. 1 for `'item'` kind. */
    quantity: number;
    /** Initial stack size at listing time (used by My listings for "0/N sold"). */
    quantityInitial: number;
    bonuses: Record<string, number>;
    upgradeLevel: number;
    listedAt: string;
}

/**
 * Sale notification — generated when a buyer takes part or all of a
 * listing. Stored in a separate Supabase table so the seller can pull
 * it next time they open the market (or via a poll/realtime subscribe).
 */
export interface IMarketSaleNotification {
    id: string;
    sellerId: string;
    /** Snapshot of the listing at sale-time so the notification reads
     *  even after the source row is deleted. */
    itemId: string;
    itemName: string;
    rarity: Rarity;
    quantitySold: number;
    /** Total gold the seller received (already net of any tax). */
    goldReceived: number;
    soldAt: string;
    /** Set to true once the seller dismisses the popup. */
    seen: boolean;
}

export type MarketSortBy = 'price_asc' | 'price_desc' | 'level_asc' | 'level_desc' | 'newest';

/** All possible filter buckets — covers equipment AND stack kinds. */
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

/** Filter listings by category bucket — slot for equipment, kind for stacks. */
export const filterByCategory = (
    listings: IMarketListing[],
    category: MarketFilterCategory,
): IMarketListing[] => {
    if (category === 'all') return listings;
    return listings.filter((l) => {
        // Stack-kind buckets first
        if (category === 'potions') return l.kind === 'potion';
        if (category === 'elixirs') return l.kind === 'elixir';
        if (category === 'stones') return l.kind === 'stone';
        if (category === 'arena_points') return l.kind === 'arena_points';
        if (category === 'spell_chests') return l.kind === 'spell_chest';
        // Equipment slot match — `ring` bucket covers ring1/ring2.
        if (category === 'ring') return l.slot === 'ring1' || l.slot === 'ring2';
        return l.slot === category && l.kind === 'item';
    });
};

/** Filter listings by rarity */
export const filterByRarity = (
    listings: IMarketListing[],
    rarity: Rarity | 'all',
): IMarketListing[] => {
    if (rarity === 'all') return listings;
    return listings.filter((l) => l.rarity === rarity);
};

/** Filter listings by min/max item level */
export const filterByLevelRange = (
    listings: IMarketListing[],
    minLevel: number,
    maxLevel: number,
): IMarketListing[] => {
    return listings.filter((l) => l.itemLevel >= minLevel && l.itemLevel <= maxLevel);
};

/** Filter listings by name search (case-insensitive substring). */
export const filterByName = (
    listings: IMarketListing[],
    query: string,
): IMarketListing[] => {
    const q = query.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter((l) => l.itemName.toLowerCase().includes(q));
};

/** Validate listing per-unit price */
export const isValidPrice = (price: number): boolean => {
    return Number.isInteger(price) && price >= 1 && price <= 999_999_999;
};

/** Validate listing quantity (1..max). Used both at listing time AND
 *  at buy time so partial buys can't request more than what's left. */
export const isValidQuantity = (qty: number, max = 999_999): boolean => {
    return Number.isInteger(qty) && qty >= 1 && qty <= max;
};

/** Calculate market tax (5% of sale price) */
export const calculateMarketTax = (price: number): number => {
    return Math.floor(price * 0.05);
};

/** Generate a unique listing ID */
export const generateListingId = (): string => {
    return `ml_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

/** True when the listing kind allows partial buys (stack with qty > 1). */
export const isStackKind = (kind: MarketKind): boolean =>
    kind === 'potion' || kind === 'elixir' || kind === 'stone' || kind === 'arena_points' || kind === 'spell_chest';
