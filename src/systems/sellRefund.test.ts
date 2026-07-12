
import { describe, it, expect } from 'vitest';
import {
    getSellPrice,
    getEnhancementRefund,
    getEnhancementCost,
} from './itemSystem';
import type { IBaseItem, IInventoryItem } from './itemSystem';


const baseMace: IBaseItem = {
    id: 'iron_mace',
    name_pl: 'Żelazna Buława',
    name_en: 'Iron Mace',
    slot: 'mainHand',
    minLevel: 5,
    baseAtk: 12,
    basePrice: 80,
    rarity: 'common',
};

const makeItem = (overrides?: Partial<IInventoryItem>): IInventoryItem => ({
    uuid: 'sell-refund-fixture',
    itemId: 'iron_mace',
    rarity: 'common',
    bonuses: {},
    itemLevel: 1,
    upgradeLevel: 0,
    ...overrides,
});


describe('sellRefundForUpgradedItem (composed contract)', () => {
    it('common item +0 -> base sell price only, NO refund, NO stones', () => {
        const item = makeItem({ rarity: 'common', upgradeLevel: 0 });
        const refund = getEnhancementRefund(0, 'common');
        expect(getSellPrice(item, baseMace)).toBe(16);
        expect(refund.gold).toBe(0);
        expect(refund.stones).toBe(0);
        expect(refund.stoneType).toBe('');
    });

    it('common item +2 -> base sell + 100% gold refund (16 + 600 = 616g), 2 common_stones', () => {
        const item = makeItem({ rarity: 'common', upgradeLevel: 2 });
        const refund = getEnhancementRefund(2, 'common');
        expect(getSellPrice(item, baseMace)).toBe(616);
        expect(refund.gold).toBe(600);
        expect(refund.stones).toBe(2);
        expect(refund.stoneType).toBe('common_stone');
    });

    it('rare item +2 -> rarity-scaled base sell + 100% refund (gold same, stoneType rare)', () => {
        const item = makeItem({ rarity: 'rare', upgradeLevel: 2 });
        const refund = getEnhancementRefund(2, 'rare');
        expect(getSellPrice(item, baseMace)).toBe(628);
        expect(refund.gold).toBe(600);
        expect(refund.stones).toBe(2);
        expect(refund.stoneType).toBe('rare_stone');
    });

    it('stones refunded == sum of per-level stones spent across upgrade chain', () => {
        for (const lvl of [1, 2, 3, 4, 5, 10]) {
            const refund = getEnhancementRefund(lvl, 'common');
            let expectedStones = 0;
            for (let i = 1; i <= lvl; i++) {
                expectedStones += getEnhancementCost(i, 'common').stones;
            }
            expect(refund.stones).toBe(expectedStones);
        }
    });

    it('getSellPrice equals base + refund.gold across rarity × upgrade combos', () => {
        const rarities = ['common', 'rare', 'epic'] as const;
        const baseSell: Record<typeof rarities[number], number> = {
            common: 16,
            rare:   28,
            epic:   40,
        };
        for (const rarity of rarities) {
            for (const lvl of [0, 1, 2, 3]) {
                const item = makeItem({ rarity, upgradeLevel: lvl });
                const refund = getEnhancementRefund(lvl, rarity);
                expect(getSellPrice(item, baseMace)).toBe(baseSell[rarity] + refund.gold);
            }
        }
    });
});
