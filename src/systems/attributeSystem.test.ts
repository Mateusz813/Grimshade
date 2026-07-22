import { describe, it, expect } from 'vitest';
import {
    ATTRIBUTE_POINT_PCT,
    ATTRIBUTE_LEVEL_INTERVAL,
    ATTRIBUTE_DEF_CAP_PCT,
    EMPTY_ATTRIBUTE_ALLOCATION,
    getAttributePointsForLevel,
    getMaxDefensePoints,
    getAttributeMultipliers,
    getSpentAttributePoints,
    getClassBaseStats,
} from './attributeSystem';
import type { TCharacterClass } from '../types/character';

const ALL_CLASSES: TCharacterClass[] = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'];

describe('getAttributePointsForLevel', () => {
    it('awards one point per ATTRIBUTE_LEVEL_INTERVAL levels', () => {
        expect(getAttributePointsForLevel(1)).toBe(0);
        expect(getAttributePointsForLevel(ATTRIBUTE_LEVEL_INTERVAL - 1)).toBe(0);
        expect(getAttributePointsForLevel(ATTRIBUTE_LEVEL_INTERVAL)).toBe(1);
        expect(getAttributePointsForLevel(ATTRIBUTE_LEVEL_INTERVAL * 35)).toBe(35);
        expect(getAttributePointsForLevel(1000)).toBe(100);
    });

    it('never goes negative for degenerate levels', () => {
        expect(getAttributePointsForLevel(0)).toBe(0);
        expect(getAttributePointsForLevel(-50)).toBe(0);
    });
});

describe('getMaxDefensePoints', () => {
    it('converts the per-class % cap into a point budget', () => {
        for (const cls of ALL_CLASSES) {
            expect(getMaxDefensePoints(cls)).toBe(Math.round(ATTRIBUTE_DEF_CAP_PCT[cls] / ATTRIBUTE_POINT_PCT));
        }
    });

    it('gives Knight the highest defense cap and Mage the lowest', () => {
        const caps = ALL_CLASSES.map((c) => ATTRIBUTE_DEF_CAP_PCT[c]);
        expect(ATTRIBUTE_DEF_CAP_PCT.Knight).toBe(Math.max(...caps));
        expect(ATTRIBUTE_DEF_CAP_PCT.Mage).toBe(Math.min(...caps));
    });
});

describe('getAttributeMultipliers', () => {
    it('returns neutral multipliers for an empty allocation', () => {
        const m = getAttributeMultipliers(EMPTY_ATTRIBUTE_ALLOCATION, 'Knight');
        expect(m).toEqual({ attack: 1, hp: 1, defense: 1 });
    });

    it('scales attack and hp linearly by ATTRIBUTE_POINT_PCT per point', () => {
        const m = getAttributeMultipliers({ attackPoints: 40, hpPoints: 10, defensePoints: 0 }, 'Mage');
        expect(m.attack).toBeCloseTo(1 + 40 * ATTRIBUTE_POINT_PCT / 100, 10);
        expect(m.hp).toBeCloseTo(1 + 10 * ATTRIBUTE_POINT_PCT / 100, 10);
    });

    it('clamps defense at the per-class cap', () => {
        for (const cls of ALL_CLASSES) {
            const m = getAttributeMultipliers({ attackPoints: 0, hpPoints: 0, defensePoints: 10_000 }, cls);
            expect(m.defense).toBeCloseTo(1 + ATTRIBUTE_DEF_CAP_PCT[cls] / 100, 10);
        }
    });

    it('treats negative allocations as zero (no NaN, no shrinking)', () => {
        const m = getAttributeMultipliers({ attackPoints: -5, hpPoints: -5, defensePoints: -5 }, 'Rogue');
        expect(m).toEqual({ attack: 1, hp: 1, defense: 1 });
    });

    it('caps the full L1000 budget at the point budget x ATTRIBUTE_POINT_PCT in a single stat', () => {
        const budget = getAttributePointsForLevel(1000);
        const m = getAttributeMultipliers({ attackPoints: budget, hpPoints: 0, defensePoints: 0 }, 'Archer');
        expect(m.attack).toBeCloseTo(1 + budget * ATTRIBUTE_POINT_PCT / 100, 10);
    });

    it('keeps every per-class defense cap reachable within the L1000 point budget', () => {
        const budget = getAttributePointsForLevel(1000);
        for (const cls of ALL_CLASSES) {
            expect(getMaxDefensePoints(cls)).toBeLessThanOrEqual(budget);
        }
    });
});

describe('getSpentAttributePoints', () => {
    it('sums all three pools and ignores negatives', () => {
        expect(getSpentAttributePoints({ attackPoints: 3, hpPoints: 4, defensePoints: 5 })).toBe(12);
        expect(getSpentAttributePoints({ attackPoints: -3, hpPoints: 4, defensePoints: 0 })).toBe(4);
    });
});

describe('getClassBaseStats', () => {
    it('returns positive attack/defense for every class', () => {
        for (const cls of ALL_CLASSES) {
            const b = getClassBaseStats(cls);
            expect(b.attack).toBeGreaterThan(0);
            expect(b.defense).toBeGreaterThan(0);
        }
    });
});
