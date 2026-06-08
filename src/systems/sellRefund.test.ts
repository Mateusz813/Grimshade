/**
 * Unit tests — sell-refund combo for upgraded items.
 *
 * BACKLOG 6.10 closure: pin the exact math that `Inventory.tsx
 * handleSell` (line 625-634) leans on when a player sells an
 * upgrade-touched item. The contract is:
 *
 *   total_gold_returned = getSellPrice(item, baseData)
 *                       = base_sell + getEnhancementRefund(level, rarity).gold
 *   total_stones_returned = getEnhancementRefund(level, rarity).stones
 *
 * Both helpers already have isolated unit coverage in `itemSystem.test.ts`
 * (`getSellPrice` describe at line 148, `getEnhancementRefund` at line
 * 356) but those tests check each function alone. The E2E (`tests/e2e/
 * inventory/upgrade/refund-on-sell.spec.ts`) walks the full UI path but
 * is RNG-free only because we seed `upgradeLevel: 2` directly — the
 * underlying MATH still needs an isolated unit so a regression in one
 * of the two helpers gets caught even when the other still works.
 *
 * The cases below mirror the variants asked for in the task brief plus
 * a stones-return invariant that the E2E spec sanity-checks via DOM.
 *
 * Why this file lives next to `itemSystem.ts` (not folded inline):
 *   `itemSystem.test.ts` is already 28+ KB and growing. A separate
 *   file keeps the sell+refund contract reviewable and unblocks future
 *   work (e.g. partial-refund variants for cursed items) without
 *   re-scrolling the giant file.
 */

import { describe, it, expect } from 'vitest';
import {
    getSellPrice,
    getEnhancementRefund,
    getEnhancementCost,
} from './itemSystem';
import type { IBaseItem, IInventoryItem } from './itemSystem';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * Iron Mace baseline — `items.json` line 10. `basePrice = 80` is the
 * canonical "common weapon" anchor used in the E2E sell-refund test;
 * keeping the same item here means a regression that breaks one test
 * breaks both (so the contract drifts get spotted faster).
 */
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

// ── sellRefundForUpgradedItem (composed via getSellPrice + getEnhancementRefund) ──

describe('sellRefundForUpgradedItem (composed contract)', () => {
    /**
     * +0 baseline — refund chain must return ZERO so the sell price
     * collapses to the rarity-multiplied base. Catches a regression
     * where `getEnhancementRefund(0)` would accidentally credit
     * stones (would let players farm free stones by selling +0 gear).
     */
    it('common item +0 → base sell price only, NO refund, NO stones', () => {
        const item = makeItem({ rarity: 'common', upgradeLevel: 0 });
        const refund = getEnhancementRefund(0, 'common');
        // `RARITY_SELL_MULTIPLIER.common = 0.20` → 80 * 0.20 = 16.
        expect(getSellPrice(item, baseMace)).toBe(16);
        expect(refund.gold).toBe(0);
        expect(refund.stones).toBe(0);
        // stoneType is empty string when no refund (itemSystem.ts line 682).
        expect(refund.stoneType).toBe('');
    });

    /**
     * +2 common — the exact case the E2E test seeds (`refund-on-sell.spec.ts`
     * line 78-84). Numbers MUST match the docstring math in the E2E:
     *   base sell = floor(80 * 0.20) = 16
     *   refund(2, 'common') = lvl1(100g+1s) + lvl2(500g+1s) = 600g + 2s
     *   total gold = 16 + 600 = 616
     *   total stones = 2
     * If this asserts diverge from `refund-on-sell.spec.ts` step 7+10,
     * one of the two tests is wrong — investigate before commit.
     */
    it('common item +2 → base sell + 100% gold refund (16 + 600 = 616g), 2 common_stones', () => {
        const item = makeItem({ rarity: 'common', upgradeLevel: 2 });
        const refund = getEnhancementRefund(2, 'common');
        expect(getSellPrice(item, baseMace)).toBe(616);
        expect(refund.gold).toBe(600); // 100 + 500
        expect(refund.stones).toBe(2);  // 1 + 1
        expect(refund.stoneType).toBe('common_stone');
    });

    /**
     * Rare item +2 — exercises the rarity-scaled SELL side (mult flips
     * from 0.20 → 0.35) while the refund side stays identical because
     * `getEnhancementCost` is RARITY-AGNOSTIC for gold/stones (only the
     * `stoneType` changes). This guard catches a regression where someone
     * "fixes" the cost table to scale by rarity — the refund would jump
     * and silently double-credit the player.
     *
     * Math:
     *   base sell = floor(80 * 0.35) = 28
     *   refund(2, 'rare') = 600g + 2 stones (same gold/stones as common!)
     *                       but stoneType = 'rare_stone'
     *   total gold = 28 + 600 = 628
     */
    it('rare item +2 → rarity-scaled base sell + 100% refund (gold same, stoneType rare)', () => {
        const item = makeItem({ rarity: 'rare', upgradeLevel: 2 });
        const refund = getEnhancementRefund(2, 'rare');
        expect(getSellPrice(item, baseMace)).toBe(628); // 28 + 600
        expect(refund.gold).toBe(600);
        expect(refund.stones).toBe(2);
        expect(refund.stoneType).toBe('rare_stone');
    });

    /**
     * Stone-count invariant: stones refunded MUST equal the per-level
     * stones spent reading from the cost table (no double-count, no
     * silent off-by-one in the loop bounds). The E2E asserts the count
     * badge "x2" — this unit pins WHY that's 2 (sum of cost(1).stones
     * + cost(2).stones), independent of the SELL price.
     *
     * Spot-check covers the LOW end (+1) where stones=1 and a mid-tier
     * (+5) where the cost table starts scaling stones up.
     */
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

    /**
     * SELL price MUST equal base sell + refund.gold for every rarity x
     * upgrade combo. Regression guard against `getSellPrice` and
     * `getEnhancementRefund` diverging — e.g. if someone changes the
     * sell formula to apply a 0.5x refund "penalty" without updating
     * the docstring contract.
     */
    it('getSellPrice equals base + refund.gold across rarity × upgrade combos', () => {
        const rarities = ['common', 'rare', 'epic'] as const;
        const baseSell: Record<typeof rarities[number], number> = {
            common: 16,  // floor(80 * 0.20)
            rare:   28,  // floor(80 * 0.35)
            epic:   40,  // floor(80 * 0.50)
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
