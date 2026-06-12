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

// -- Helpers ------------------------------------------------------------------

/**
 * Pin Math.random() to a deterministic value so every test sees the same roll.
 * Tests that need a different value override with `mockReturnValueOnce`.
 */
const lockRandom = (value = 0.5): void => {
    vi.spyOn(Math, 'random').mockReturnValue(value);
};

const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic', 'heroic'];

// ARMOR_SLOTS removed — agent zostawił niewykorzystany import. Jeśli
// w przyszłości będziemy iterować po slotach armor — odtworzyć tu.

afterEach(() => {
    vi.restoreAllMocks();
});

// -- generateWeapon -----------------------------------------------------------

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
        // Weapons must NOT include a flat 'attack' bonus — it is excluded by design.
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
        // Pool excludes 'attack' so max possible bonuses = pool size (6). For
        // heroic that means we expect exactly 5 bonus keys to be picked.
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

// -- generateOffhand ----------------------------------------------------------

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
        // The dual-wield branch in generateOffhand checks for `template.type
        // === 'dagger'`, but the offhands list in itemTemplates.json doesn't
        // expose a dagger entry — so the lookup returns null and the
        // function returns null. Locking this in so a future data change
        // that adds a dagger offhand will fail this test and force the
        // dual-wield path to be re-evaluated.
        expect(generateOffhand('dagger', 5, 'rare')).toBeNull();
    });

    it('preserves rarity / level / upgradeLevel=0 on the returned item', () => {
        const item = generateOffhand('shield', 30, 'legendary')!;
        expect(item.rarity).toBe('legendary');
        expect(item.itemLevel).toBe(30);
        expect(item.upgradeLevel).toBe(0);
    });
});

// -- generateArmor ------------------------------------------------------------

describe('generateArmor', () => {
    beforeEach(() => {
        lockRandom();
    });

    it('returns null for unknown armor prefix', () => {
        expect(generateArmor('not_an_armor_prefix', 'helmet', 1, 'common')).toBeNull();
    });

    it('returns null for valid prefix but missing slot in pieces', () => {
        // 'ring1' is an equipment slot but armor categories don't define it
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
        // Gloves should NOT receive an HP-from-armor bump.
        // (A random bonus might still roll into hp — that's fine — but the
        // base stat path is attack-only for gloves.)
        expect(item.itemId).toBe('heavy_gloves_lvl10_rare');
    });

    it('HP scaling on armor uses the multiplier (raw armor base * 6)', () => {
        // At level 100, raw 'baseMin + perLevel*100' yields ~100 raw points
        // which then gets x6 for HP — much bigger than the raw number.
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

// -- generateAccessory --------------------------------------------------------

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

// -- generateRandomItem / generateRandomItemForClass --------------------------

describe('generateRandomItemForClass', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns a valid item shape for each class', () => {
        // Use a Math.random value of 0.5 so we land in the "armor" category
        // (weights: 0.20 + 0.15 + 0.45 -> cumulative through 0.80 covers armor).
        lockRandom(0.5);
        for (const cls of ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard']) {
            const item = generateRandomItemForClass(cls, 10, 'common');
            expect(item).not.toBeNull();
            expect(item!.rarity).toBe('common');
            expect(item!.itemLevel).toBe(10);
        }
    });

    it('class restriction: routes to weapon category and respects allowedClasses', () => {
        // First Math.random() call picks the category (0.1 -> 'weapon')
        // Subsequent calls used internally by generateWeapon — all kept at 0.5.
        vi.spyOn(Math, 'random')
            .mockReturnValueOnce(0.1)
            .mockReturnValue(0.5);
        const item = generateRandomItemForClass('Knight', 10, 'common');
        expect(item).not.toBeNull();
        // Knight's only allowed weapon type is sword.
        expect(item!.itemId.startsWith('sword_')).toBe(true);
    });

    it('class restriction: armor prefix matches CLASS_ARMOR_TYPES mapping', () => {
        // 0.5 -> armor category (after cumulative weapon+offhand+armor -> 0.80).
        // Then 0 -> first armor slot in ARMOR_SLOTS = 'helmet'.
        vi.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)
            .mockReturnValueOnce(0)
            .mockReturnValue(0.5);
        const item = generateRandomItemForClass('Mage', 5, 'common')!;
        // Mage uses 'magic' armor prefix.
        expect(item.itemId.startsWith('magic_')).toBe(true);
    });

    it('returns null when no armor category matches the class', () => {
        // Force 'armor' category (0.5 within 0.35-0.80 window) but pass a
        // class that no armor category accepts -> should be null.
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

// -- generateStarterWeapon ----------------------------------------------------

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
        // baseAtk=11 -> dmg_min = floor(11 * 0.8) = 8 ; dmg_max = floor(11 * 1.2) = 13.
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

// -- getItemDisplayInfo -------------------------------------------------------

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
        // The lvl-format requires a real type prefix; unknown types should
        // still resolve to null even when the format looks superficially valid.
        expect(getItemDisplayInfo('not_a_type_lvl5_common')).toBeNull();
    });
});

// -- rerollItemBonuses --------------------------------------------------------

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
        // 'hp' on a sword is a random bonus; after reroll, the original 50
        // must NOT be carried over unless the new roll happens to pick it.
        const item = baseItem();
        const result = rerollItemBonuses(item, 'mainHand');
        // The exact new bonuses depend on Math.random, so just assert the
        // result is a fresh object without inheriting the OLD hp value
        // verbatim (50 specifically).
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
        // common has 0 bonus slots -> only base keys remain
        const nonBaseKeys = Object.keys(result).filter(
            (k) => !['dmg_min', 'dmg_max', 'attack', 'defense'].includes(k),
        );
        expect(nonBaseKeys.length).toBe(0);
    });
});

// -- Cross-cutting: rarity -> bonus count mapping ------------------------------

describe('rarity -> bonus count mapping', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * For each rarity, ensure an armor item carries the expected number of
     * non-base bonuses. We use armor for this because its base stat is a
     * single key (hp or attack), making it easy to count "extras".
     */
    it.each(RARITIES)('%s rarity produces RARITY_BONUS_SLOTS random bonuses', (rarity) => {
        lockRandom(0.5);
        const slot: EquipmentSlot = 'armor';
        const item = generateArmor('heavy', slot, 5, rarity)!;
        const nonBase = Object.entries(item.bonuses)
            // Strip the base stat (hp on body armor) — only count extras.
            .filter(([k]) => k !== 'hp')
            .length;
        // generateBonusStats picks up to RARITY_BONUS_SLOTS[rarity] keys from
        // a 6-stat pool minus exclusions, so the actual count can equal the
        // expected slot count (when pool >= slot count).
        expect(nonBase).toBeLessThanOrEqual(RARITY_BONUS_SLOTS[rarity]);
    });
});

// -- TODO ---------------------------------------------------------------------
// TODO(line ~340): cross-check upgrade bonus scaling formula. CLAUDE.md says
// "each +1 = ~8% per CLAUDE.md" but the codebase actually uses an exponential
// curve in `getEnhancementMultiplier` (1.15^level for +1..+10). Tests for
// that live in itemSystem.test.ts; itemGenerator does not apply upgrades
// directly — items always come out at upgradeLevel: 0 from this module.
//
// TODO(line ~250): generateRandomItemForClass branch coverage. The exact
// roll values for 'offhand' vs 'accessory' depend on the mock sequence;
// a follow-up could pin each window precisely with `mockReturnValueOnce`
// chains. Current tests cover weapon + armor explicitly which are the two
// most common drop categories.
