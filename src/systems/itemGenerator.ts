import type { Rarity, IInventoryItem, EquipmentSlot } from './itemSystem';
import { RARITY_BONUS_SLOTS, getBaseStatKeysForSlot } from './itemSystem';
import { getItemImage } from './spriteAssets';
import itemTemplates from '../data/itemTemplates.json';


interface IItemTemplate {
    type: string;
    name_pl: string;
    name_en: string;
    slot: string;
    icon: string;
    allowedClasses: string[];
    baseStatType: string;
    scaling: { baseMin: number; baseMax: number; perLevel: number };
}

interface IArmorPiece {
    slot: string;
    name_pl: string;
    name_en: string;
    icon: string;
    scaling: { baseMin: number; baseMax: number; perLevel: number };
}

interface IArmorCategory {
    allowedClasses: string[];
    prefix_pl: string;
    prefix_en: string;
    pieces: IArmorPiece[];
}

interface IRarityMultiplier {
    statMultiplier: number;
    priceMultiplier: number;
}


const BONUS_STAT_POOL = ['hp', 'mp', 'attack', 'defense', 'speed', 'critChance', 'critDmg'];

const BONUS_STAT_RANGES: Record<Rarity, { min: number; max: number }> = {
    common:    { min: 1, max: 5 },
    rare:      { min: 3, max: 12 },
    epic:      { min: 5, max: 18 },
    legendary: { min: 10, max: 35 },
    mythic:    { min: 20, max: 60 },
    heroic:    { min: 40, max: 100 },
};


const randInt = (min: number, max: number): number =>
    min + Math.floor(Math.random() * (max - min + 1));


const calculateBaseStat = (
    scaling: { baseMin: number; baseMax: number; perLevel: number },
    level: number,
    rarity: Rarity,
): number => {
    const rarityMult = (itemTemplates.rarityMultipliers as Record<string, IRarityMultiplier>)[rarity];
    const mult = rarityMult?.statMultiplier ?? 1.0;

    const baseValue = randInt(scaling.baseMin, scaling.baseMax);
    const levelBonus = Math.floor(level * scaling.perLevel);
    const total = Math.floor((baseValue + levelBonus) * mult);

    return Math.max(1, total);
};


const STAT_RANGE_MULTIPLIER: Record<string, number> = {
    hp:        1.0,
    mp:        1.0,
    attack:    1.0,
    defense:   1.0,
    speed:     1.0,
    critChance: 0.3,
    critDmg:   1.5,
};

const generateBonusStats = (rarity: Rarity, excludeStats: string[] = []): Record<string, number> => {
    const numBonuses = RARITY_BONUS_SLOTS[rarity];
    if (numBonuses === 0) return {};

    const range = BONUS_STAT_RANGES[rarity];
    const bonuses: Record<string, number> = {};
    const pool = BONUS_STAT_POOL.filter((s) => !excludeStats.includes(s));
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, numBonuses);

    for (const stat of selected) {
        const mult = STAT_RANGE_MULTIPLIER[stat] ?? 1.0;
        bonuses[stat] = Math.max(1, Math.round(randInt(range.min, range.max) * mult));
    }

    return bonuses;
};


interface IWeaponDamageScaling {
    min: number;
    max: number;
}

const getWeaponBaseDamage = (
    scaling: { baseMin: number; baseMax: number; perLevel: number },
    level: number,
    rarity: Rarity,
): IWeaponDamageScaling => {
    const rarityMult = (itemTemplates.rarityMultipliers as Record<string, IRarityMultiplier>)[rarity];
    const mult = rarityMult?.statMultiplier ?? 1.0;

    const baseMin = scaling.baseMin;
    const baseMax = scaling.baseMax;
    const levelBonus = level * scaling.perLevel;

    const rolledMin = Math.max(1, Math.floor((baseMin + levelBonus) * mult));
    const rolledMax = Math.max(rolledMin + 1, Math.floor((baseMax + levelBonus * 1.15) * mult));

    return { min: rolledMin, max: rolledMax };
};


export const generateWeapon = (
    weaponType: string,
    level: number,
    rarity: Rarity,
): IInventoryItem | null => {
    const template = (itemTemplates.weapons as IItemTemplate[]).find(
        (w) => w.type === weaponType,
    );
    if (!template) return null;

    const dmg = getWeaponBaseDamage(template.scaling, level, rarity);
    const bonuses = generateBonusStats(rarity, ['attack']);

    bonuses['dmg_min'] = dmg.min;
    bonuses['dmg_max'] = dmg.max;

    const itemId = `${weaponType}_lvl${level}_${rarity}`;

    return {
        uuid: `${itemId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        itemId,
        rarity,
        bonuses,
        itemLevel: level,
        upgradeLevel: 0,
    };
};


export const generateOffhand = (
    offhandType: string,
    level: number,
    rarity: Rarity,
): IInventoryItem | null => {
    const template = (itemTemplates.offhands as IItemTemplate[]).find(
        (o) => o.type === offhandType,
    );
    if (!template) return null;

    const isRogueDualWield = template.type === 'dagger' || template.slot === 'offHand' && template.baseStatType === 'attack' && template.allowedClasses.includes('Rogue');
    if (isRogueDualWield) {
        const dmg = getWeaponBaseDamage(template.scaling, level, rarity);
        const bonuses = generateBonusStats(rarity, ['attack']);
        bonuses['dmg_min'] = dmg.min;
        bonuses['dmg_max'] = dmg.max;
        const itemId = `${offhandType}_lvl${level}_${rarity}`;
        return {
            uuid: `${itemId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            itemId,
            rarity,
            bonuses,
            itemLevel: level,
            upgradeLevel: 0,
        };
    }

    const baseStat = calculateBaseStat(template.scaling, level, rarity);
    const baseKey = template.baseStatType === 'defense' ? 'defense' : 'attack';
    const bonuses = generateBonusStats(rarity, [baseKey]);
    bonuses[baseKey] = (bonuses[baseKey] ?? 0) + baseStat;

    const itemId = `${offhandType}_lvl${level}_${rarity}`;

    return {
        uuid: `${itemId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        itemId,
        rarity,
        bonuses,
        itemLevel: level,
        upgradeLevel: 0,
    };
};


const ARMOR_SLOT_BASE_STAT: Record<string, 'hp' | 'attack'> = {
    helmet:    'hp',
    armor:     'hp',
    pants:     'hp',
    shoulders: 'hp',
    boots:     'hp',
    gloves:    'attack',
};

const ARMOR_HP_MULTIPLIER = 6;


export const generateArmor = (
    armorPrefix: string,
    slot: EquipmentSlot,
    level: number,
    rarity: Rarity,
): IInventoryItem | null => {
    const armorCategory = (itemTemplates.armor as Record<string, IArmorCategory>)[armorPrefix];
    if (!armorCategory) return null;

    const piece = armorCategory.pieces.find((p) => p.slot === slot);
    if (!piece) return null;

    const rawBase = calculateBaseStat(piece.scaling, level, rarity);
    const baseStatKey = ARMOR_SLOT_BASE_STAT[slot] ?? 'hp';

    const bonuses = generateBonusStats(rarity, [baseStatKey]);

    if (baseStatKey === 'hp') {
        bonuses['hp'] = (bonuses['hp'] ?? 0) + rawBase * ARMOR_HP_MULTIPLIER;
    } else {
        bonuses['attack'] = (bonuses['attack'] ?? 0) + rawBase;
    }

    const itemId = `${armorPrefix}_${slot}_lvl${level}_${rarity}`;

    return {
        uuid: `${itemId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        itemId,
        rarity,
        bonuses,
        itemLevel: level,
        upgradeLevel: 0,
    };
};


const ACCESSORY_SLOT_BASE_STAT: Record<string, 'attack' | 'defense'> = {
    ring1:    'attack',
    ring2:    'attack',
    necklace: 'defense',
    earrings: 'defense',
};


export const generateAccessory = (
    accessoryType: string,
    level: number,
    rarity: Rarity,
): IInventoryItem | null => {
    const template = (itemTemplates.accessories as IItemTemplate[]).find(
        (a) => a.type === accessoryType,
    );
    if (!template) return null;

    const baseStat = calculateBaseStat(template.scaling, level, rarity);

    const slotKey = template.type === 'ring' ? 'ring1' : template.slot;
    const baseStatKey = ACCESSORY_SLOT_BASE_STAT[slotKey] ?? 'defense';

    const bonuses = generateBonusStats(rarity, [baseStatKey]);
    bonuses[baseStatKey] = (bonuses[baseStatKey] ?? 0) + baseStat;

    const itemId = `${accessoryType}_lvl${level}_${rarity}`;

    return {
        uuid: `${itemId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        itemId,
        rarity,
        bonuses,
        itemLevel: level,
        upgradeLevel: 0,
    };
};


export type TItemCategory = 'weapon' | 'offhand' | 'armor' | 'accessory';

const ITEM_CATEGORY_WEIGHTS: Record<TItemCategory, number> = {
    weapon:    0.20,
    offhand:   0.15,
    armor:     0.45,
    accessory: 0.20,
};

const ARMOR_SLOTS: EquipmentSlot[] = ['helmet', 'armor', 'pants', 'boots', 'shoulders', 'gloves'];

export const generateRandomItemForClass = (
    characterClass: string,
    level: number,
    rarity: Rarity,
): IInventoryItem | null => {
    const roll = Math.random();
    let cumulative = 0;
    let category: TItemCategory = 'armor';

    for (const [cat, weight] of Object.entries(ITEM_CATEGORY_WEIGHTS)) {
        cumulative += weight;
        if (roll < cumulative) {
            category = cat as TItemCategory;
            break;
        }
    }

    switch (category) {
        case 'weapon': {
            const weaponTemplate = (itemTemplates.weapons as IItemTemplate[]).find(
                (w) => w.allowedClasses.includes(characterClass),
            );
            if (!weaponTemplate) return null;
            return generateWeapon(weaponTemplate.type, level, rarity);
        }
        case 'offhand': {
            const offhandTemplate = (itemTemplates.offhands as IItemTemplate[]).find(
                (o) => o.allowedClasses.includes(characterClass),
            );
            if (!offhandTemplate) return null;
            return generateOffhand(offhandTemplate.type, level, rarity);
        }
        case 'armor': {
            const armorEntries = Object.entries(itemTemplates.armor as Record<string, IArmorCategory>);
            const armorMatch = armorEntries.find(([_, cat]) =>
                cat.allowedClasses.includes(characterClass),
            );
            if (!armorMatch) return null;
            const [prefix] = armorMatch;
            const randomSlot = ARMOR_SLOTS[Math.floor(Math.random() * ARMOR_SLOTS.length)];
            return generateArmor(prefix, randomSlot, level, rarity);
        }
        case 'accessory': {
            const types = ['ring', 'necklace', 'earrings'];
            const randomType = types[Math.floor(Math.random() * types.length)];
            return generateAccessory(randomType, level, rarity);
        }
    }

    return null;
};


export const generateRandomItem = (
    level: number,
    rarity: Rarity,
): IInventoryItem | null => {
    const allClasses = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'];
    const randomClass = allClasses[Math.floor(Math.random() * allClasses.length)];
    return generateRandomItemForClass(randomClass, level, rarity);
};


export interface IItemDisplayInfo {
    name_pl: string;
    name_en: string;
    icon: string;
    type: string;
    slot: EquipmentSlot;
}

export const getItemDisplayInfo = (itemId: string): IItemDisplayInfo | null => {
    const parts = itemId.split('_lvl');
    if (parts.length < 2) {
        return resolveImageIcon(itemId, getLegacyItemInfo(itemId));
    }

    const typePart = parts[0];

    for (const w of itemTemplates.weapons as IItemTemplate[]) {
        if (w.type === typePart) {
            return resolveImageIcon(itemId, {
                name_pl: w.name_pl,
                name_en: w.name_en,
                icon: w.icon,
                type: w.type,
                slot: w.slot as EquipmentSlot,
            });
        }
    }

    for (const o of itemTemplates.offhands as IItemTemplate[]) {
        if (o.type === typePart) {
            return resolveImageIcon(itemId, {
                name_pl: o.name_pl,
                name_en: o.name_en,
                icon: o.icon,
                type: o.type,
                slot: o.slot as EquipmentSlot,
            });
        }
    }

    for (const [prefix, category] of Object.entries(itemTemplates.armor as Record<string, IArmorCategory>)) {
        for (const piece of category.pieces) {
            const armorType = `${prefix}_${piece.slot}`;
            if (typePart === armorType) {
                return resolveImageIcon(itemId, {
                    name_pl: `${category.prefix_pl} ${piece.name_pl}`,
                    name_en: `${category.prefix_en} ${piece.name_en}`,
                    icon: piece.icon,
                    type: armorType,
                    slot: piece.slot as EquipmentSlot,
                });
            }
        }
    }

    for (const a of itemTemplates.accessories as IItemTemplate[]) {
        if (a.type === typePart) {
            return resolveImageIcon(itemId, {
                name_pl: a.name_pl,
                name_en: a.name_en,
                icon: a.icon,
                type: a.type,
                slot: a.slot as EquipmentSlot,
            });
        }
    }

    return null;
};

const resolveImageIcon = (itemId: string, info: IItemDisplayInfo | null): IItemDisplayInfo | null => {
    if (!info) return null;
    const img = getItemImage(itemId, info.slot, info.type);
    if (img) return { ...info, icon: img };
    return info;
};


const getLegacyItemInfo = (itemId: string): IItemDisplayInfo | null => {
    const legacyMap: Record<string, IItemDisplayInfo> = {
        sword_of_beginnings: { name_pl: 'Miecz Poczatku', name_en: 'Sword of Beginnings', icon: 'crossed-swords', type: 'sword', slot: 'mainHand' },
        apprentice_staff:    { name_pl: 'Kostur Ucznia', name_en: 'Apprentice Staff', icon: 'magic-wand', type: 'staff', slot: 'mainHand' },
        wooden_mace:         { name_pl: 'Drewniana Bulawa', name_en: 'Wooden Mace', icon: 'sparkles', type: 'holy_wand', slot: 'mainHand' },
        short_bow:           { name_pl: 'Krotki Luk', name_en: 'Short Bow', icon: 'bow-and-arrow', type: 'bow', slot: 'mainHand' },
        rusty_dagger:        { name_pl: 'Zardzewialy Sztylet', name_en: 'Rusty Dagger', icon: 'dagger', type: 'dagger', slot: 'mainHand' },
        bone_staff:          { name_pl: 'Kostur Kosciany', name_en: 'Bone Staff', icon: 'skull', type: 'dead_staff', slot: 'mainHand' },
        lute:                { name_pl: 'Lutnia', name_en: 'Lute', icon: 'musical-note', type: 'harp', slot: 'mainHand' },
    };

    return legacyMap[itemId] ?? null;
};


export const generateStarterWeapon = (characterClass: string): IInventoryItem | null => {
    const starterData = (itemTemplates.starterWeapons as Record<string, {
        type: string;
        name_pl: string;
        name_en: string;
        baseAtk: number;
    }>)[characterClass];

    if (!starterData) return null;

    const itemId = `starter_${starterData.type}`;

    const dmgMin = Math.max(1, Math.floor(starterData.baseAtk * 0.8));
    const dmgMax = Math.max(dmgMin + 1, Math.floor(starterData.baseAtk * 1.2));

    return {
        uuid: `${itemId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        itemId,
        rarity: 'common' as Rarity,
        bonuses: { dmg_min: dmgMin, dmg_max: dmgMax },
        itemLevel: 1,
        upgradeLevel: 0,
    };
};

export const rerollItemBonuses = (
    item: IInventoryItem,
    slot: EquipmentSlot | null,
): Record<string, number> => {
    if (!slot) return { ...item.bonuses };

    const baseKeys = getBaseStatKeysForSlot(slot);

    const baseStats: Record<string, number> = {};
    for (const key of baseKeys) {
        if (key in item.bonuses) {
            baseStats[key] = item.bonuses[key];
        }
    }

    const newRandomBonuses = generateBonusStats(item.rarity, [...baseKeys]);

    return { ...baseStats, ...newRandomBonuses };
};
