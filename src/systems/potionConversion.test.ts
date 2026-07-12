
import { describe, it, expect } from 'vitest';
import {
    POTION_CONVERSIONS,
    getMaxConversions,
    checkConversionAvailability,
    type IPotionConversion,
} from './potionConversion';
import { getPotionMinLevel } from './potionGating';
import { ELIXIRS } from '../stores/shopStore';

const SHOP_PRICE: Map<string, number> = new Map(ELIXIRS.map((e) => [e.id, e.price]));

describe('alchemy levels match the shop/drink gate (potionGating)', () => {
    for (const conv of POTION_CONVERSIONS) {
        it(`${conv.outputId}: outputMinLevel === getPotionMinLevel`, () => {
            expect(conv.outputMinLevel).toBe(getPotionMinLevel(conv.outputId));
        });
    }
});

const findConv = (
    family: 'hp' | 'mp',
    inputId: string,
    outputId: string,
): IPotionConversion | undefined =>
    POTION_CONVERSIONS.find(
        (c) => c.family === family && c.inputId === inputId && c.outputId === outputId,
    );


describe('POTION_CONVERSIONS table', () => {
    it('lists 14 conversions total (6 main HP + 1 mega HP + 6 main MP + 1 mega MP)', () => {
        expect(POTION_CONVERSIONS).toHaveLength(14);
    });

    it('every entry has a non-empty input / output ID', () => {
        for (const c of POTION_CONVERSIONS) {
            expect(c.inputId).toBeTruthy();
            expect(c.outputId).toBeTruthy();
            expect(c.inputId).not.toBe(c.outputId);
        }
    });

    it('every entry consumes a positive integer number of inputs per batch', () => {
        for (const c of POTION_CONVERSIONS) {
            expect(Number.isInteger(c.inputCount)).toBe(true);
            expect(c.inputCount).toBeGreaterThanOrEqual(1);
        }
    });

    it('tier values are 1..7 (1..6 main chain, 7 for the alt mega branch)', () => {
        for (const c of POTION_CONVERSIONS) {
            expect(c.tier).toBeGreaterThanOrEqual(1);
            expect(c.tier).toBeLessThanOrEqual(7);
        }
    });

    it('main HP chain (2026-06-24 anti-exploit counts): 5×sm->md, 4×md->lg, 334×lg->great, 2×great->super, 2×super->ultimate, 2×ultimate->divine', () => {
        expect(findConv('hp', 'hp_potion_sm', 'hp_potion_md')?.inputCount).toBe(5);
        expect(findConv('hp', 'hp_potion_md', 'hp_potion_lg')?.inputCount).toBe(4);
        expect(findConv('hp', 'hp_potion_lg', 'hp_potion_great')?.inputCount).toBe(334);
        expect(findConv('hp', 'hp_potion_great', 'hp_potion_super')?.inputCount).toBe(2);
        expect(findConv('hp', 'hp_potion_super', 'hp_potion_ultimate')?.inputCount).toBe(2);
        expect(findConv('hp', 'hp_potion_ultimate', 'hp_potion_divine')?.inputCount).toBe(2);
    });

    it('main MP chain mirrors HP chain (same ratios)', () => {
        expect(findConv('mp', 'mp_potion_sm', 'mp_potion_md')?.inputCount).toBe(5);
        expect(findConv('mp', 'mp_potion_md', 'mp_potion_lg')?.inputCount).toBe(4);
        expect(findConv('mp', 'mp_potion_lg', 'mp_potion_great')?.inputCount).toBe(334);
        expect(findConv('mp', 'mp_potion_great', 'mp_potion_super')?.inputCount).toBe(2);
        expect(findConv('mp', 'mp_potion_super', 'mp_potion_ultimate')?.inputCount).toBe(2);
        expect(findConv('mp', 'mp_potion_ultimate', 'mp_potion_divine')?.inputCount).toBe(2);
    });

    it('alternate mega branch: 25×lg -> mega for both families', () => {
        const hpMega = findConv('hp', 'hp_potion_lg', 'hp_potion_mega');
        const mpMega = findConv('mp', 'mp_potion_lg', 'mp_potion_mega');
        expect(hpMega).toBeDefined();
        expect(mpMega).toBeDefined();
        expect(hpMega?.inputCount).toBe(25);
        expect(mpMega?.inputCount).toBe(25);
        expect(hpMega?.tier).toBe(7);
        expect(mpMega?.tier).toBe(7);
    });

    it('outputMinLevel is monotonically non-decreasing along the main chain', () => {
        const hpMain = POTION_CONVERSIONS.filter((c) => c.family === 'hp' && c.tier <= 6).sort((a, b) => a.tier - b.tier);
        for (let i = 1; i < hpMain.length; i++) {
            expect(hpMain[i].outputMinLevel).toBeGreaterThanOrEqual(hpMain[i - 1].outputMinLevel);
        }
    });

    it('matches the canonical shop level gates: 20 / 50 / 200 / 350 / 500 / 700', () => {
        const expected = [20, 50, 200, 350, 500, 700];
        const hpMain = POTION_CONVERSIONS.filter((c) => c.family === 'hp' && c.tier <= 6)
            .sort((a, b) => a.tier - b.tier)
            .map((c) => c.outputMinLevel);
        expect(hpMain).toEqual(expected);
        const mpMain = POTION_CONVERSIONS.filter((c) => c.family === 'mp' && c.tier <= 6)
            .sort((a, b) => a.tier - b.tier)
            .map((c) => c.outputMinLevel);
        expect(mpMain).toEqual(expected);
    });

    it('every conversion has a non-empty display name and icon for both input and output', () => {
        for (const c of POTION_CONVERSIONS) {
            expect(c.inputName).toBeTruthy();
            expect(c.outputName).toBeTruthy();
            expect(c.inputIcon).toBeTruthy();
            expect(c.outputIcon).toBeTruthy();
        }
    });
});

describe('alchemy is not cheaper than buying (price-driven invariant)', () => {
    it('shop prices exist for every conversion input + output', () => {
        for (const c of POTION_CONVERSIONS) {
            expect(SHOP_PRICE.get(c.inputId)).toBeGreaterThan(0);
            expect(SHOP_PRICE.get(c.outputId)).toBeGreaterThan(0);
        }
    });

    it('every recipe: craft cost (inputCount × price_in) >= shop price of output', () => {
        for (const c of POTION_CONVERSIONS) {
            const priceIn = SHOP_PRICE.get(c.inputId)!;
            const priceOut = SHOP_PRICE.get(c.outputId)!;
            expect(c.inputCount * priceIn).toBeGreaterThanOrEqual(priceOut);
        }
    });

    it('every recipe uses the MINIMAL fair count: inputCount === ceil(price_out / price_in)', () => {
        for (const c of POTION_CONVERSIONS) {
            const priceIn = SHOP_PRICE.get(c.inputId)!;
            const priceOut = SHOP_PRICE.get(c.outputId)!;
            expect(c.inputCount).toBe(Math.ceil(priceOut / priceIn));
        }
    });

    it('regression: the old exploitable counts are gone (lg->great no longer 4, lg->mega no longer 4)', () => {
        expect(findConv('hp', 'hp_potion_lg', 'hp_potion_great')?.inputCount).not.toBe(4);
        expect(findConv('hp', 'hp_potion_lg', 'hp_potion_mega')?.inputCount).not.toBe(4);
    });
});

describe('alchemy display order (HP-first, output-level-ascending)', () => {
    it('all HP recipes precede all MP recipes', () => {
        const families = POTION_CONVERSIONS.map((c) => c.family);
        const lastHp = families.lastIndexOf('hp');
        const firstMp = families.indexOf('mp');
        expect(lastHp).toBeLessThan(firstMp);
    });

    it('within each family, outputMinLevel is non-decreasing (mega is no longer last)', () => {
        for (const fam of ['hp', 'mp'] as const) {
            const slice = POTION_CONVERSIONS.filter((c) => c.family === fam);
            for (let i = 1; i < slice.length; i++) {
                expect(slice[i].outputMinLevel).toBeGreaterThanOrEqual(slice[i - 1].outputMinLevel);
            }
        }
    });

    it('exact HP output order: md, lg, MEGA, great, super, ultimate, divine', () => {
        const hp = POTION_CONVERSIONS.filter((c) => c.family === 'hp').map((c) => c.outputId);
        expect(hp).toEqual([
            'hp_potion_md', 'hp_potion_lg', 'hp_potion_mega', 'hp_potion_great',
            'hp_potion_super', 'hp_potion_ultimate', 'hp_potion_divine',
        ]);
    });

    it('mega renders 3rd in the HP group (right after lg), not dead-last', () => {
        const hp = POTION_CONVERSIONS.filter((c) => c.family === 'hp');
        expect(hp[2].outputId).toBe('hp_potion_mega');
    });
});


describe('getMaxConversions', () => {
    const conv5 = findConv('hp', 'hp_potion_sm', 'hp_potion_md')!;
    const conv4 = findConv('hp', 'hp_potion_md', 'hp_potion_lg')!;

    it('floors owned / inputCount', () => {
        expect(getMaxConversions(conv5, 0)).toBe(0);
        expect(getMaxConversions(conv5, 4)).toBe(0);
        expect(getMaxConversions(conv5, 5)).toBe(1);
        expect(getMaxConversions(conv5, 9)).toBe(1);
        expect(getMaxConversions(conv5, 10)).toBe(2);
        expect(getMaxConversions(conv5, 100)).toBe(20);
    });

    it('works for the 4-input recipes too', () => {
        expect(getMaxConversions(conv4, 3)).toBe(0);
        expect(getMaxConversions(conv4, 4)).toBe(1);
        expect(getMaxConversions(conv4, 12)).toBe(3);
    });

    it('returns 0 for negative inventory (defensive)', () => {
        expect(getMaxConversions(conv5, -1)).toBeLessThanOrEqual(0);
    });
});


describe('checkConversionAvailability', () => {
    const conv = findConv('hp', 'hp_potion_sm', 'hp_potion_md')!;

    it('canConvert is true only when at least one full batch is available', () => {
        expect(checkConversionAvailability(conv, 4).canConvert).toBe(false);
        expect(checkConversionAvailability(conv, 5).canConvert).toBe(true);
    });

    it('reports the same maxBatches as getMaxConversions', () => {
        for (const owned of [0, 4, 5, 10, 25, 100]) {
            const a = checkConversionAvailability(conv, owned);
            expect(a.maxBatches).toBe(getMaxConversions(conv, owned));
        }
    });

    it('returns canConvert=false with maxBatches=0 for empty inventory', () => {
        expect(checkConversionAvailability(conv, 0)).toMatchObject({
            canConvert: false,
            maxBatches: 0,
            levelLocked: false,
        });
    });

    it('blocks the conversion when character level is below the output unlock level', () => {
        const a = checkConversionAvailability(conv, 100, conv.outputMinLevel - 1);
        expect(a.levelLocked).toBe(true);
        expect(a.canConvert).toBe(false);
        expect(a.maxBatches).toBeGreaterThan(0);
        expect(a.requiredLevel).toBeGreaterThan(0);
    });

    it('allows the conversion at/above the output unlock level (given inputs)', () => {
        const req = checkConversionAvailability(conv, conv.inputCount).requiredLevel;
        const ok = checkConversionAvailability(conv, conv.inputCount, req);
        expect(ok.levelLocked).toBe(false);
        expect(ok.canConvert).toBe(true);
    });
});
