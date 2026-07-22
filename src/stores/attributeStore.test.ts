import { describe, it, expect, beforeEach } from 'vitest';
import { useAttributeStore, ATTRIBUTE_MIGRATION_VERSION } from './attributeStore';
import { ATTRIBUTE_POINT_PCT, getMaxDefensePoints } from '../systems/attributeSystem';

beforeEach(() => {
    useAttributeStore.setState({ attackPoints: 0, hpPoints: 0, defensePoints: 0, migrationVersion: 0 });
});

describe('attributeStore.allocate', () => {
    it('adds points to attack and hp without any cap', () => {
        expect(useAttributeStore.getState().allocate('attack', 250, 'Mage')).toBe(250);
        expect(useAttributeStore.getState().allocate('hp', 40, 'Mage')).toBe(40);
        expect(useAttributeStore.getState().attackPoints).toBe(250);
        expect(useAttributeStore.getState().hpPoints).toBe(40);
    });

    it('returns the number of points actually consumed when defense hits the class cap', () => {
        const cap = getMaxDefensePoints('Mage');
        expect(useAttributeStore.getState().allocate('defense', cap + 50, 'Mage')).toBe(cap);
        expect(useAttributeStore.getState().defensePoints).toBe(cap);
        expect(useAttributeStore.getState().allocate('defense', 10, 'Mage')).toBe(0);
        expect(useAttributeStore.getState().defensePoints).toBe(cap);
    });

    it('lets Knight invest strictly more defense points than Mage', () => {
        expect(getMaxDefensePoints('Knight')).toBeGreaterThan(getMaxDefensePoints('Mage'));
    });

    it('ignores non-positive requests', () => {
        expect(useAttributeStore.getState().allocate('attack', 0, 'Knight')).toBe(0);
        expect(useAttributeStore.getState().allocate('attack', -7, 'Knight')).toBe(0);
        expect(useAttributeStore.getState().attackPoints).toBe(0);
    });

    it('floors fractional requests', () => {
        expect(useAttributeStore.getState().allocate('hp', 3.9, 'Bard')).toBe(3);
        expect(useAttributeStore.getState().hpPoints).toBe(3);
    });
});

describe('attributeStore.getMultipliers', () => {
    it('reflects the current allocation', () => {
        useAttributeStore.getState().allocate('attack', 20, 'Archer');
        expect(useAttributeStore.getState().getMultipliers('Archer').attack)
            .toBeCloseTo(1 + 20 * ATTRIBUTE_POINT_PCT / 100, 10);
    });
});

describe('attributeStore.resetAllocation', () => {
    it('zeroes every pool but leaves the migration stamp alone', () => {
        useAttributeStore.setState({ migrationVersion: ATTRIBUTE_MIGRATION_VERSION });
        useAttributeStore.getState().allocate('attack', 5, 'Knight');
        useAttributeStore.getState().allocate('defense', 5, 'Knight');
        useAttributeStore.getState().resetAllocation();
        expect(useAttributeStore.getState().getAllocation()).toEqual({ attackPoints: 0, hpPoints: 0, defensePoints: 0 });
        expect(useAttributeStore.getState().migrationVersion).toBe(ATTRIBUTE_MIGRATION_VERSION);
    });
});
