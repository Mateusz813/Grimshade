import { describe, it, expect } from 'vitest';
import {
    getMaxRarityForLevel,
    rollRarity,
    generateBonuses,
    calculateGoldDrop,
    rollLoot,
    rollStoneDrop,
    getGeneratedSellPrice,
} from './lootSystem';

describe('getMaxRarityForLevel', () => {
    it('should return common for level 1-30', () => {
        expect(getMaxRarityForLevel(1)).toBe('common');
        expect(getMaxRarityForLevel(30)).toBe('common');
    });

    it('should return rare for level 31-60', () => {
        expect(getMaxRarityForLevel(31)).toBe('rare');
        expect(getMaxRarityForLevel(60)).toBe('rare');
    });

    it('should return epic for level 61+', () => {
        expect(getMaxRarityForLevel(61)).toBe('epic');
        expect(getMaxRarityForLevel(200)).toBe('epic');
    });
});

describe('generateBonuses', () => {
    it('should return empty object for heroic rarity', () => {
        expect(generateBonuses('heroic')).toEqual({});
    });

    it('should return 1 stat for common rarity', () => {
        const bonuses = generateBonuses('common');
        expect(Object.keys(bonuses).length).toBe(1);
    });

    it('should return 2 stats for epic rarity', () => {
        const bonuses = generateBonuses('epic');
        expect(Object.keys(bonuses).length).toBe(2);
    });

    it('should return 3 stats for mythic rarity', () => {
        const bonuses = generateBonuses('mythic');
        expect(Object.keys(bonuses).length).toBe(3);
    });
});

describe('calculateGoldDrop', () => {
    it('should return gold within range for solo', () => {
        for (let i = 0; i < 20; i++) {
            const gold = calculateGoldDrop([10, 20], 1);
            expect(gold).toBeGreaterThanOrEqual(10);
            expect(gold).toBeLessThanOrEqual(20);
        }
    });

    it('should increase gold with party size', () => {
        const soloGold = calculateGoldDrop([100, 100], 1);
        const partyGold = calculateGoldDrop([100, 100], 4);
        expect(partyGold).toBeGreaterThan(soloGold);
    });
});

describe('rollLoot', () => {
    it('should return an array', () => {
        const result = rollLoot(5, 'normal');
        expect(Array.isArray(result)).toBe(true);
    });

    it('should return max 5 items', () => {
        // Run many times to verify the cap
        for (let i = 0; i < 50; i++) {
            const result = rollLoot(10, 'boss');
            expect(result.length).toBeLessThanOrEqual(5);
        }
    });

    it('should generate items with correct itemLevel matching monster level', () => {
        for (let i = 0; i < 100; i++) {
            const result = rollLoot(42, 'boss');
            for (const item of result) {
                expect(item.itemLevel).toBe(42);
            }
        }
    });

    it('should only drop common rarity from normal monsters', () => {
        for (let i = 0; i < 200; i++) {
            const result = rollLoot(10, 'normal');
            for (const item of result) {
                expect(item.rarity).toBe('common');
            }
        }
    });

    it('should never return NaN or undefined in bonuses', () => {
        for (let i = 0; i < 50; i++) {
            const result = rollLoot(50, 'epic');
            for (const item of result) {
                for (const val of Object.values(item.bonuses)) {
                    expect(val).not.toBeNaN();
                    expect(val).toBeDefined();
                }
            }
        }
    });

    it('should have itemId containing rarity and level', () => {
        for (let i = 0; i < 50; i++) {
            const result = rollLoot(25, 'strong');
            for (const item of result) {
                expect(item.itemId).toContain('generated_');
                expect(item.itemId).toContain('lvl25');
            }
        }
    });
});

describe('rollRarity', () => {
    it('should always return a valid rarity string', () => {
        const validRarities = ['common', 'rare', 'epic', 'legendary', 'mythic', 'heroic'];
        for (let i = 0; i < 100; i++) {
            const result = rollRarity('boss');
            expect(validRarities).toContain(result);
        }
    });

    it('should only return common for normal monster rarity', () => {
        for (let i = 0; i < 100; i++) {
            expect(rollRarity('normal')).toBe('common');
        }
    });
});

describe('rollStoneDrop', () => {
    it('should return null or a valid stone object', () => {
        for (let i = 0; i < 100; i++) {
            const result = rollStoneDrop(10, 'normal');
            if (result !== null) {
                expect(result.type).toBe('common_stone');
                expect(result.count).toBe(1);
            }
        }
    });

    it('should return correct stone type for boss rarity', () => {
        for (let i = 0; i < 100; i++) {
            const result = rollStoneDrop(100, 'boss');
            if (result !== null) {
                expect(result.type).toBe('mythic_stone');
            }
        }
    });
});

describe('getGeneratedSellPrice', () => {
    it('should return a positive number', () => {
        expect(getGeneratedSellPrice('common', 1)).toBeGreaterThan(0);
        expect(getGeneratedSellPrice('mythic', 100)).toBeGreaterThan(0);
    });

    it('should scale with level', () => {
        const low = getGeneratedSellPrice('rare', 1);
        const high = getGeneratedSellPrice('rare', 100);
        expect(high).toBeGreaterThan(low);
    });

    it('should scale with rarity', () => {
        const common = getGeneratedSellPrice('common', 50);
        const epic = getGeneratedSellPrice('epic', 50);
        const mythic = getGeneratedSellPrice('mythic', 50);
        expect(epic).toBeGreaterThan(common);
        expect(mythic).toBeGreaterThan(epic);
    });

    it('should never return NaN', () => {
        expect(getGeneratedSellPrice('unknown', 0)).not.toBeNaN();
        expect(getGeneratedSellPrice('common', 0)).not.toBeNaN();
    });
});
