import { describe, it, expect } from 'vitest';
import {
    sortListings,
    filterBySlot,
    filterByRarity,
    isValidPrice,
    calculateMarketTax,
    generateListingId,
    type IMarketListing,
} from './marketSystem';

const MOCK_LISTINGS: IMarketListing[] = [
    { id: '1', sellerId: 'u1', sellerName: 'Player1', itemId: 'sword_1', itemName: 'Iron Sword', itemLevel: 10, rarity: 'common', slot: 'mainHand', price: 500, bonuses: {}, upgradeLevel: 0, listedAt: '2024-01-01T00:00:00Z' },
    { id: '2', sellerId: 'u2', sellerName: 'Player2', itemId: 'epic_staff', itemName: 'Epic Staff', itemLevel: 50, rarity: 'epic', slot: 'mainHand', price: 10000, bonuses: { attack: 20 }, upgradeLevel: 3, listedAt: '2024-01-02T00:00:00Z' },
    { id: '3', sellerId: 'u3', sellerName: 'Player3', itemId: 'ring_hp', itemName: 'HP Ring', itemLevel: 20, rarity: 'rare', slot: 'ring', price: 2000, bonuses: { hp: 50 }, upgradeLevel: 0, listedAt: '2024-01-03T00:00:00Z' },
];

describe('sortListings', () => {
    it('sorts by price ascending', () => {
        const sorted = sortListings(MOCK_LISTINGS, 'price_asc');
        expect(sorted[0].price).toBe(500);
        expect(sorted[2].price).toBe(10000);
    });

    it('sorts by price descending', () => {
        const sorted = sortListings(MOCK_LISTINGS, 'price_desc');
        expect(sorted[0].price).toBe(10000);
    });

    it('sorts by level ascending', () => {
        const sorted = sortListings(MOCK_LISTINGS, 'level_asc');
        expect(sorted[0].itemLevel).toBe(10);
        expect(sorted[2].itemLevel).toBe(50);
    });

    it('sorts by level descending', () => {
        const sorted = sortListings(MOCK_LISTINGS, 'level_desc');
        expect(sorted[0].itemLevel).toBe(50);
    });

    it('sorts by newest', () => {
        const sorted = sortListings(MOCK_LISTINGS, 'newest');
        expect(sorted[0].id).toBe('3');
    });

    it('does not mutate original array', () => {
        const original = [...MOCK_LISTINGS];
        sortListings(MOCK_LISTINGS, 'price_desc');
        expect(MOCK_LISTINGS).toEqual(original);
    });
});

describe('filterBySlot', () => {
    it('returns all when slot is all', () => {
        expect(filterBySlot(MOCK_LISTINGS, 'all').length).toBe(3);
    });

    it('filters by ring slot', () => {
        const filtered = filterBySlot(MOCK_LISTINGS, 'ring');
        expect(filtered.length).toBe(1);
        expect(filtered[0].slot).toBe('ring');
    });

    it('filters by mainHand slot', () => {
        const filtered = filterBySlot(MOCK_LISTINGS, 'mainHand');
        expect(filtered.length).toBe(2);
    });

    it('returns empty array when no match', () => {
        expect(filterBySlot(MOCK_LISTINGS, 'boots').length).toBe(0);
    });
});

describe('filterByRarity', () => {
    it('returns all when rarity is all', () => {
        expect(filterByRarity(MOCK_LISTINGS, 'all').length).toBe(3);
    });

    it('filters by epic rarity', () => {
        const filtered = filterByRarity(MOCK_LISTINGS, 'epic');
        expect(filtered.length).toBe(1);
        expect(filtered[0].rarity).toBe('epic');
    });

    it('returns empty array when no match', () => {
        expect(filterByRarity(MOCK_LISTINGS, 'legendary').length).toBe(0);
    });
});

describe('isValidPrice', () => {
    it('accepts valid prices', () => {
        expect(isValidPrice(1)).toBe(true);
        expect(isValidPrice(100000)).toBe(true);
        expect(isValidPrice(999999999)).toBe(true);
    });

    it('rejects zero', () => {
        expect(isValidPrice(0)).toBe(false);
    });

    it('rejects negative', () => {
        expect(isValidPrice(-1)).toBe(false);
    });

    it('rejects non-integer', () => {
        expect(isValidPrice(1.5)).toBe(false);
    });

    it('rejects price above max', () => {
        expect(isValidPrice(1_000_000_000)).toBe(false);
    });
});

describe('calculateMarketTax', () => {
    it('calculates 5% tax', () => {
        expect(calculateMarketTax(1000)).toBe(50);
        expect(calculateMarketTax(100)).toBe(5);
    });

    it('floors fractional tax', () => {
        expect(calculateMarketTax(33)).toBe(1);
    });

    it('returns 0 for very small prices', () => {
        expect(calculateMarketTax(1)).toBe(0);
    });
});

describe('generateListingId', () => {
    it('returns unique IDs', () => {
        const a = generateListingId();
        const b = generateListingId();
        expect(a).not.toBe(b);
    });

    it('starts with ml_', () => {
        expect(generateListingId().startsWith('ml_')).toBe(true);
    });
});
