import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Mulberry32 } from '../../src/systems/rng/mulberry32';
import {
    generateWeapon,
    generateOffhand,
    generateArmor,
    generateAccessory,
    generateRandomItemForClass,
    generateStarterWeapon,
    getItemDisplayInfo,
} from '../../src/systems/itemGenerator';
import itemTemplates from '../../src/data/itemTemplates.json';
import type { Rarity, EquipmentSlot, IInventoryItem } from '../../src/systems/itemSystem';

// GOLDEN dla itemGenerator.ts — podzbiór PORTOWALNY:
//  - rarity 'common' → RARITY_BONUS_SLOTS=0 → generateBonusStats wraca {} BEZ
//    konsumowania RNG (early return przed shuffle) → pełny seeded parytet.
//  - wyższe rarity używają sort(()=>Math.random()-0.5) → NIEPORTOWALNE bit-w-bit
//    (PHP testuje własnościowo).
//  - uuid zawiera Date.now() → WYCINANY z porównania (strip).
// Regeneracja:
//   UPDATE_GOLDEN=1 npx vitest run tests/integration/itemGenerator.golden.test.ts
//   cp golden/itemGenerator.json ../grimshade-backend/tests/Golden/fixtures/

const strip = (item: IInventoryItem | null) =>
    item === null ? null : { itemId: item.itemId, rarity: item.rarity, bonuses: item.bonuses, itemLevel: item.itemLevel, upgradeLevel: item.upgradeLevel };

const withSeed = <T>(seed: number, fn: () => T): T => {
    const rng = new Mulberry32(seed);
    const orig = Math.random;
    Math.random = () => rng.nextFloat();
    try { return fn(); } finally { Math.random = orig; }
};

type TTemplate = { type: string };
const WEAPON_TYPES = (itemTemplates.weapons as TTemplate[]).map((w) => w.type);
const OFFHAND_TYPES = (itemTemplates.offhands as TTemplate[]).map((o) => o.type);
const ARMOR_PREFIXES = Object.keys(itemTemplates.armor as Record<string, unknown>);
const ACCESSORY_TYPES = ['ring', 'necklace', 'earrings'];
const CLASSES = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'];
const ARMOR_SLOTS: EquipmentSlot[] = ['helmet', 'armor', 'pants', 'boots', 'shoulders', 'gloves'];
const LEVELS = [1, 50, 250];
const SEEDS = [1, 42, 777];
const COMMON: Rarity = 'common';

const buildGolden = (): Record<string, unknown> => ({
    system: 'itemGenerator',
    note: 'Podzbiór portowalny (common = zero bonus-slotów = brak shuffle). uuid wycięty. NIE edytuj ręcznie.',
    generateWeapon: WEAPON_TYPES.flatMap((t) => LEVELS.map((lvl) => ({
        type: t, lvl, seed: 1, result: withSeed(1, () => strip(generateWeapon(t, lvl, COMMON))),
    }))),
    generateOffhand: OFFHAND_TYPES.flatMap((t) => SEEDS.map((seed) => ({
        type: t, lvl: 100, seed, result: withSeed(seed, () => strip(generateOffhand(t, 100, COMMON))),
    }))),
    generateArmor: ARMOR_PREFIXES.flatMap((p) => ARMOR_SLOTS.map((slot) => ({
        prefix: p, slot, lvl: 100, seed: 7, result: withSeed(7, () => strip(generateArmor(p, slot, 100, COMMON))),
    }))),
    generateAccessory: ACCESSORY_TYPES.flatMap((t) => SEEDS.map((seed) => ({
        type: t, lvl: 100, seed, result: withSeed(seed, () => strip(generateAccessory(t, 100, COMMON))),
    }))),
    generateRandomItemForClass: CLASSES.flatMap((cls) => SEEDS.map((seed) => ({
        cls, lvl: 100, seed, result: withSeed(seed, () => strip(generateRandomItemForClass(cls, 100, COMMON))),
    }))),
    generateStarterWeapon: CLASSES.map((cls) => ({ cls, result: strip(generateStarterWeapon(cls)) })),
    getItemDisplayInfo: [
        'sword_lvl50_common', 'staff_lvl100_epic', 'heavy_armor_lvl50_rare', 'light_boots_lvl250_mythic',
        'ring_lvl10_common', 'necklace_lvl99_legendary', 'shield_lvl20_common', 'sword_of_beginnings',
        'lute', 'nonsense_id',
    ].map((id) => {
        const info = getItemDisplayInfo(id);
        return { id, result: info ? { name_pl: info.name_pl, name_en: info.name_en, type: info.type, slot: info.slot } : null };
    }),
});

const outPath = resolve(process.cwd(), 'golden/itemGenerator.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('itemGenerator golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current itemGenerator output', () => {
        expect(existsSync(outPath), 'brak golden/itemGenerator.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
