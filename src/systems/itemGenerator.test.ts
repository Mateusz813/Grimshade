import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    generateWeapon,
    generateOffhand,
    generateArmor,
    generateAccessory,
    generateRandomItem,
    generateRandomItemForClass,
    generateStarterWeapon,
    getItemDisplayInfo,
    rerollItemBonuses,
} from './itemGenerator';
import { RARITY_BONUS_SLOTS } from './itemSystem';
import type { IInventoryItem, Rarity, EquipmentSlot } from './itemSystem';


const lockRandom = (value = 0.5): void => {
    vi.spyOn(Math, 'random').mockReturnValue(value);
};

const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic', 'heroic'];


afterEach(() => {
    vi.restoreAllMocks();
});


describe('generateWeapon', () => {
    beforeEach(() => {
        lockRandom();
    });

    it('returns a valid inventory item for a known weapon type', () => {
        const item = generateWeapon('sword', 1, 'common');
        expect(item).not.toBeNull();
        expect(item!.itemId).toBe('sword_lvl1_common');
        expect(item!.itemLevel).toBe(1);
        expect(item!.rarity).toBe('common');
        expect(item!.upgradeLevel).toBe(0);
        expect(typeof item!.uuid).toBe('string');
        expect(item!.uuid.length).toBeGreaterThan(0);
    });

    it('returns null for unknown weapon types', () => {
        expect(generateWeapon('not_a_weapon', 1, 'common')).toBeNull();
        expect(generateWeapon('', 5, 'rare')).toBeNull();
    });

    it('always writes dmg_min and dmg_max bonuses (range, not flat attack)', () => {
        const item = generateWeapon('dagger', 10, 'rare')!;
        expect(item.bonuses['dmg_min']).toBeGreaterThanOrEqual(1);
        expect(item.bonuses['dmg_max']).toBeGreaterThan(item.bonuses['dmg_min']);
        expect(item.bonuses['attack']).toBeUndefined();
    });

    it('scales damage with level', () => {
        const low = generateWeapon('sword', 1, 'common')!;
        const high = generateWeapon('sword', 100, 'common')!;
        expect(high.bonuses['dmg_min']).toBeGreaterThan(low.bonuses['dmg_min']);
        expect(high.bonuses['dmg_max']).toBeGreaterThan(low.bonuses['dmg_max']);
    });

    it('scales damage with rarity (higher rarity = bigger numbers at same level)', () => {
        const common = generateWeapon('sword', 50, 'common')!;
        const heroic = generateWeapon('sword', 50, 'heroic')!;
        expect(heroic.bonuses['dmg_max']).toBeGreaterThan(common.bonuses['dmg_max']);
    });

    it('rarity -> bonus count: common = 0 bonus stats (apart from dmg_min/max)', () => {
        const item = generateWeapon('sword', 5, 'common')!;
        const bonusKeys = Object.keys(item.bonuses).filter((k) => k !== 'dmg_min' && k !== 'dmg_max');
        expect(bonusKeys.length).toBe(RARITY_BONUS_SLOTS.common);
    });

    it('rarity -> bonus count: heroic should add up to 5 random bonuses', () => {
        const item = generateWeapon('sword', 5, 'heroic')!;
        const bonusKeys = Object.keys(item.bonuses).filter((k) => k !== 'dmg_min' && k !== 'dmg_max');
        expect(bonusKeys.length).toBe(RARITY_BONUS_SLOTS.heroic);
    });

    it('handles extreme item levels (level 0 / negative falls back to >=1 base stat)', () => {
        const zero = generateWeapon('sword', 0, 'common')!;
        expect(zero.bonuses['dmg_min']).toBeGreaterThanOrEqual(1);
        expect(zero.bonuses['dmg_max']).toBeGreaterThan(zero.bonuses['dmg_min']);
    });

    it('handles level > 1000 without throwing', () => {
        const huge = generateWeapon('sword', 2000, 'mythic');
        expect(huge).not.toBeNull();
        expect(Number.isFinite(huge!.bonuses['dmg_min'])).toBe(true);
        expect(Number.isFinite(huge!.bonuses['dmg_max'])).toBe(true);
    });
});


describe('generateOffhand', () => {
    beforeEach(() => {
        lockRandom();
    });

    it('returns null for unknown offhand types', () => {
        expect(generateOffhand('unknown_offhand', 1, 'common')).toBeNull();
    });

    it('shield (defense baseStat) writes a defense bonus', () => {
        const item = generateOffhand('shield', 10, 'rare')!;
        expect(item).not.toBeNull();
        expect(item.bonuses['defense']).toBeGreaterThanOrEqual(1);
        expect(item.itemId).toBe('shield_lvl10_rare');
    });

    it('spellbook (attack baseStat caster) writes an attack bonus', () => {
        const item = generateOffhand('spellbook', 10, 'rare')!;
        expect(item.bonuses['attack']).toBeGreaterThanOrEqual(1);
    });

    it('dagger is not a valid offhand type in current data (Rogue dual-wields via mainHand alias)', () => {
        expect(generateOffhand('dagger', 5, 'rare')).toBeNull();
    });

    it('preserves rarity / level / upgradeLevel=0 on the returned item', () => {
        const item = generateOffhand('shield', 30, 'legendary')!;
        expect(item.rarity).toBe('legendary');
        expect(item.itemLevel).toBe(30);
        expect(item.upgradeLevel).toBe(0);
    });
});


describe('generateArmor', () => {
    beforeEach(() => {
        lockRandom();
    });

    it('returns null for unknown armor prefix', () => {
        expect(generateArmor('not_an_armor_prefix', 'helmet', 1, 'common')).toBeNull();
    });

    it('returns null for valid prefix but missing slot in pieces', () => {
        expect(generateArmor('heavy', 'ring1', 1, 'common')).toBeNull();
    });

    it('helmet / armor / pants / shoulders / boots all add an HP bonus', () => {
        for (const slot of ['helmet', 'armor', 'pants', 'shoulders', 'boots'] as EquipmentSlot[]) {
            const item = generateArmor('heavy', slot, 10, 'rare')!;
            expect(item.bonuses['hp']).toBeGreaterThanOrEqual(1);
            expect(item.itemId).toBe(`heavy_${slot}_lvl10_rare`);
        }
    });

    it('gloves add a flat attack bonus instead of HP', () => {
        const item = generateArmor('heavy', 'gloves', 10, 'rare')!;
        expect(item.bonuses['attack']).toBeGreaterThanOrEqual(1);
        expect(item.itemId).toBe('heavy_gloves_lvl10_rare');
    });

    it('HP scaling on armor uses the multiplier (raw armor base * 6)', () => {
        const lowLevel = generateArmor('heavy', 'armor', 1, 'common')!;
        const highLevel = generateArmor('heavy', 'armor', 100, 'common')!;
        expect(highLevel.bonuses['hp']).toBeGreaterThan(lowLevel.bonuses['hp']);
    });

    it('rarity scales the HP bonus through statMultiplier', () => {
        const common = generateArmor('magic', 'armor', 20, 'common')!;
        const heroic = generateArmor('magic', 'armor', 20, 'heroic')!;
        expect(heroic.bonuses['hp']).toBeGreaterThan(common.bonuses['hp']);
    });
});


describe('generateAccessory', () => {
    beforeEach(() => {
        lockRandom();
    });

    it('returns null for unknown accessory types', () => {
        expect(generateAccessory('unknown', 1, 'common')).toBeNull();
    });

    it('ring writes an attack bonus (ring1 slot mapping)', () => {
        const item = generateAccessory('ring', 10, 'rare')!;
        expect(item.bonuses['attack']).toBeGreaterThanOrEqual(1);
    });

    it('necklace writes a defense bonus', () => {
        const item = generateAccessory('necklace', 10, 'rare')!;
        expect(item.bonuses['defense']).toBeGreaterThanOrEqual(1);
    });

    it('earrings write a defense bonus', () => {
        const item = generateAccessory('earrings', 10, 'rare')!;
        expect(item.bonuses['defense']).toBeGreaterThanOrEqual(1);
    });
});


describe('generateRandomItemForClass', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns a valid item shape for each class', () => {
        lockRandom(0.5);
        for (const cls of ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard']) {
            const item = generateRandomItemForClass(cls, 10, 'common');
            expect(item).not.toBeNull();
            expect(item!.rarity).toBe('common');
            expect(item!.itemLevel).toBe(10);
        }
    });

    it('class restriction: routes to weapon category and respects allowedClasses', () => {
        vi.spyOn(Math, 'random')
            .mockReturnValueOnce(0.1)
            .mockReturnValue(0.5);
        const item = generateRandomItemForClass('Knight', 10, 'common');
        expect(item).not.toBeNull();
        expect(item!.itemId.startsWith('sword_')).toBe(true);
    });

    it('class restriction: armor prefix matches CLASS_ARMOR_TYPES mapping', () => {
        vi.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)
            .mockReturnValueOnce(0)
            .mockReturnValue(0.5);
        const item = generateRandomItemForClass('Mage', 5, 'common')!;
        expect(item.itemId.startsWith('magic_')).toBe(true);
    });

    it('returns null when no armor category matches the class', () => {
        vi.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)
            .mockReturnValue(0.5);
        expect(generateRandomItemForClass('NotAClass', 10, 'common')).toBeNull();
    });
});

describe('generateRandomItem', () => {
    it('returns null only when an internal generator does — happy path returns an item', () => {
        lockRandom(0.5);
        const item = generateRandomItem(10, 'rare');
        expect(item).not.toBeNull();
        expect(item!.itemLevel).toBe(10);
        expect(item!.rarity).toBe('rare');
    });

    it('produces items for every rarity tier', () => {
        for (const rarity of RARITIES) {
            lockRandom(0.5);
            const item = generateRandomItem(20, rarity);
            expect(item).not.toBeNull();
            expect(item!.rarity).toBe(rarity);
            vi.restoreAllMocks();
        }
    });
});


describe('generateStarterWeapon', () => {
    beforeEach(() => {
        lockRandom();
    });

    it('returns null for unknown class', () => {
        expect(generateStarterWeapon('Druid')).toBeNull();
    });

    it('returns common-rarity, item-level-1 weapon for every supported class', () => {
        for (const cls of ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard']) {
            const w = generateStarterWeapon(cls)!;
            expect(w).not.toBeNull();
            expect(w.rarity).toBe('common');
            expect(w.itemLevel).toBe(1);
            expect(w.upgradeLevel).toBe(0);
            expect(w.bonuses['dmg_min']).toBeGreaterThanOrEqual(1);
            expect(w.bonuses['dmg_max']).toBeGreaterThan(w.bonuses['dmg_min']);
            expect(w.itemId.startsWith('starter_')).toBe(true);
        }
    });

    it('Knight starter weapon = sword_of_beginnings-equivalent DMG range', () => {
        const w = generateStarterWeapon('Knight')!;
        expect(w.bonuses['dmg_min']).toBe(8);
        expect(w.bonuses['dmg_max']).toBe(13);
    });

    it('Cleric starter weapon (lowest baseAtk=6) still respects min >= 1 floor', () => {
        const w = generateStarterWeapon('Cleric')!;
        expect(w.bonuses['dmg_min']).toBeGreaterThanOrEqual(1);
        expect(w.bonuses['dmg_max']).toBeGreaterThan(w.bonuses['dmg_min']);
    });
});


describe('getItemDisplayInfo', () => {
    it('returns weapon display info for a generated itemId', () => {
        const info = getItemDisplayInfo('sword_lvl5_rare');
        expect(info).not.toBeNull();
        expect(info!.type).toBe('sword');
        expect(info!.slot).toBe('mainHand');
    });

    it('returns armor display info for a generated armor itemId', () => {
        const info = getItemDisplayInfo('heavy_armor_lvl3_common');
        expect(info).not.toBeNull();
        expect(info!.slot).toBe('armor');
        expect(info!.type).toBe('heavy_armor');
        expect(info!.name_pl.length).toBeGreaterThan(0);
        expect(info!.name_en.length).toBeGreaterThan(0);
    });

    it('returns accessory display info for a generated itemId', () => {
        const info = getItemDisplayInfo('necklace_lvl12_epic');
        expect(info).not.toBeNull();
        expect(info!.slot).toBe('necklace');
    });

    it('returns offhand display info for a generated itemId', () => {
        const info = getItemDisplayInfo('shield_lvl2_common');
        expect(info).not.toBeNull();
        expect(info!.slot).toBe('offHand');
        expect(info!.type).toBe('shield');
    });

    it('falls back to the legacy map for known starter ids', () => {
        const info = getItemDisplayInfo('sword_of_beginnings');
        expect(info).not.toBeNull();
        expect(info!.type).toBe('sword');
        expect(info!.slot).toBe('mainHand');
    });

    it('returns null for an unknown / malformed item id', () => {
        expect(getItemDisplayInfo('total_garbage_id')).toBeNull();
        expect(getItemDisplayInfo('not_a_type_lvl5_common')).toBeNull();
    });
});


describe('rerollItemBonuses', () => {
    beforeEach(() => {
        lockRandom(0.5);
    });

    const baseItem = (overrides?: Partial<IInventoryItem>): IInventoryItem => ({
        uuid: 'uuid-1',
        itemId: 'sword_lvl5_rare',
        rarity: 'rare',
        bonuses: { dmg_min: 10, dmg_max: 20, hp: 50, defense: 5 },
        itemLevel: 5,
        upgradeLevel: 0,
        ...overrides,
    });

    it('returns a copy of the bonuses untouched when slot is null', () => {
        const item = baseItem();
        const result = rerollItemBonuses(item, null);
        expect(result).toEqual(item.bonuses);
    });

    it('preserves weapon base stats (dmg_min / dmg_max) when rerolling', () => {
        const item = baseItem();
        const result = rerollItemBonuses(item, 'mainHand');
        expect(result['dmg_min']).toBe(10);
        expect(result['dmg_max']).toBe(20);
    });

    it('drops random bonuses that are no longer in the new pool', () => {
        const item = baseItem();
        const result = rerollItemBonuses(item, 'mainHand');
        if ('hp' in result) {
            expect(result['hp']).not.toBe(50);
        }
    });

    it('preserves armor base stat (hp) when rerolling a helmet', () => {
        const item = baseItem({ itemId: 'heavy_helmet_lvl5_rare', bonuses: { hp: 100, attack: 5 } });
        const result = rerollItemBonuses(item, 'helmet');
        expect(result['hp']).toBe(100);
    });

    it('preserves accessory base stat (defense on necklace) when rerolling', () => {
        const item = baseItem({ itemId: 'necklace_lvl5_rare', bonuses: { defense: 12, critChance: 5 } });
        const result = rerollItemBonuses(item, 'necklace');
        expect(result['defense']).toBe(12);
    });

    it('common rarity reroll = 0 random bonuses (only base stats survive)', () => {
        const item = baseItem({
            rarity: 'common',
            bonuses: { dmg_min: 10, dmg_max: 20, hp: 50 },
        });
        const result = rerollItemBonuses(item, 'mainHand');
        const nonBaseKeys = Object.keys(result).filter(
            (k) => !['dmg_min', 'dmg_max', 'attack', 'defense'].includes(k),
        );
        expect(nonBaseKeys.length).toBe(0);
    });
});


describe('rarity -> bonus count mapping', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each(RARITIES)('%s rarity produces RARITY_BONUS_SLOTS random bonuses', (rarity) => {
        lockRandom(0.5);
        const slot: EquipmentSlot = 'armor';
        const item = generateArmor('heavy', slot, 5, rarity)!;
        const nonBase = Object.entries(item.bonuses)
            .filter(([k]) => k !== 'hp')
            .length;
        expect(nonBase).toBeLessThanOrEqual(RARITY_BONUS_SLOTS[rarity]);
    });
});

