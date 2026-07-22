import itemTemplates from '../data/itemTemplates.json';
import { getItemImage, getStoneImage } from './spriteAssets';


interface IGenItemInfo {
    type: string;
    slot: EquipmentSlot;
    itemLevel?: number;
}

const _genInfoCache = new Map<string, IGenItemInfo | null>();

export const clearGenInfoCache = (): void => {
    _genInfoCache.clear();
};

export const getGeneratedItemInfo = (itemId: string): IGenItemInfo | null => {
    if (_genInfoCache.has(itemId)) return _genInfoCache.get(itemId)!;

    const parts = itemId.split('_lvl');
    const isStarter = itemId.startsWith('starter_') && parts.length < 2;
    const typePart = isStarter ? itemId.replace('starter_', '') : (parts.length >= 2 ? parts[0] : null);
    const parsedLevel = parts.length >= 2 ? parseInt(parts[1], 10) : NaN;
    const itemLevel = Number.isFinite(parsedLevel) && parsedLevel > 0 ? parsedLevel : undefined;

    if (!typePart) {
        _genInfoCache.set(itemId, null);
        return null;
    }

    for (const w of (itemTemplates.weapons as { type: string; slot: string }[])) {
        if (w.type === typePart) {
            const info: IGenItemInfo = { type: w.type, slot: w.slot as EquipmentSlot, itemLevel };
            _genInfoCache.set(itemId, info);
            return info;
        }
    }

    for (const o of (itemTemplates.offhands as { type: string; slot: string }[])) {
        if (o.type === typePart) {
            const info: IGenItemInfo = { type: o.type, slot: o.slot as EquipmentSlot, itemLevel };
            _genInfoCache.set(itemId, info);
            return info;
        }
    }

    for (const [prefix, category] of Object.entries(itemTemplates.armor as Record<string, { pieces: { slot: string }[] }>)) {
        for (const piece of category.pieces) {
            const armorType = `${prefix}_${piece.slot}`;
            if (typePart === armorType) {
                const info: IGenItemInfo = { type: armorType, slot: piece.slot as EquipmentSlot, itemLevel };
                _genInfoCache.set(itemId, info);
                return info;
            }
        }
    }

    for (const a of (itemTemplates.accessories as { type: string; slot: string }[])) {
        if (a.type === typePart) {
            const info: IGenItemInfo = { type: a.type, slot: a.slot as EquipmentSlot, itemLevel };
            _genInfoCache.set(itemId, info);
            return info;
        }
    }

    _genInfoCache.set(itemId, null);
    return null;
};


export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'heroic';

export type EquipmentSlot =
    | 'helmet'
    | 'armor'
    | 'pants'
    | 'gloves'
    | 'shoulders'
    | 'boots'
    | 'mainHand'
    | 'offHand'
    | 'ring1'
    | 'ring2'
    | 'earrings'
    | 'necklace';

export const EQUIPMENT_SLOTS: EquipmentSlot[] = [
    'mainHand',  'offHand',
    'helmet',    'shoulders',
    'armor',     'gloves',
    'pants',     'boots',
    'ring1',     'ring2',
    'necklace',  'earrings',
];

export const SLOT_LABELS: Record<EquipmentSlot, string> = {
    helmet:    'Helm',
    armor:     'Zbroja',
    pants:     'Spodnie',
    gloves:    'Rekawice',
    shoulders: 'Naramienniki',
    boots:     'Buty',
    mainHand:  'Bron glowna',
    offHand:   'Lewa reka',
    ring1:     'Pierscien I',
    ring2:     'Pierscien II',
    earrings:  'Kolczyki',
    necklace:  'Naszyjnik',
};

export const SLOT_ICONS: Record<EquipmentSlot, string> = {
    helmet:    'rescue-worker-s-helmet',
    armor:     'safety-vest',
    pants:     'jeans',
    gloves:    'gloves',
    shoulders: 'military-medal',
    boots:     'woman-s-boot',
    mainHand:  'crossed-swords',
    offHand:   'shield',
    ring1:     'ring',
    ring2:     'ring',
    earrings:  'sparkles',
    necklace:  'prayer-beads',
};

export const ITEM_TYPE_ICONS: Record<string, string> = {
    sword:      'crossed-swords',
    staff:      'magic-wand',
    mace:       'hammer',
    bow:        'bow-and-arrow',
    dagger:     'dagger',
    harp:       'musical-note',
    axe:        'axe',
    club:       'cricket-game',
    dead_staff: 'skull',
    holy_wand:  'sparkles',
    shield:     'shield',
    magic_book: 'closed-book',
    spellbook:  'closed-book',
    holy:       'latin-cross',
    holy_cross: 'latin-cross',
    quiver:     'bow-and-arrow',
    tome:       'green-book',
    voodoo_doll:'skull',
    talisman:   'crystal-ball',
    heavy_helmet:    'rescue-worker-s-helmet',
    heavy_armor:     'safety-vest',
    heavy_pants:     'jeans',
    heavy_boots:     'woman-s-boot',
    heavy_shoulders: 'military-medal',
    heavy_gloves:    'gloves',
    magic_helmet:    'top-hat',
    magic_armor:     'mage',
    magic_pants:     'jeans',
    magic_boots:     'hiking-boot',
    magic_shoulders: 'reminder-ribbon',
    magic_gloves:    'gloves',
    light_helmet:    'military-helmet',
    light_armor:     'kimono',
    light_pants:     'jeans',
    light_boots:     'running-shoe',
    light_shoulders: 'military-medal',
    light_gloves:    'gloves',
    ring:       'ring',
    necklace:   'prayer-beads',
    earrings:   'sparkles',
    stone:      'gem-stone',
    heal_hp:    'red-heart',
    heal_mp:    'droplet',
    xp_boost:   'alembic',
    skill_boost:'alembic',
};


export interface IBaseItem {
    id: string;
    name_pl: string;
    name_en: string;
    slot: EquipmentSlot;
    minLevel: number;
    baseAtk?: number;
    baseDef?: number;
    basePrice: number;
    rarity: Rarity;
    type?: string;
}

export interface IInventoryItem {
    uuid: string;
    itemId: string;
    rarity: Rarity;
    bonuses: Record<string, number>;
    itemLevel: number;
    upgradeLevel?: number;
}

export interface IItemStats {
    attack: number;
    defense: number;
    hp: number;
    mp: number;
    speed: number;
    critChance: number;
}

export type IEquipment = Record<EquipmentSlot, IInventoryItem | null>;

export const EMPTY_EQUIPMENT: IEquipment = {
    helmet: null, armor: null, pants: null, gloves: null, shoulders: null,
    boots: null, mainHand: null, offHand: null, ring1: null, ring2: null,
    earrings: null, necklace: null,
};


export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic', 'heroic'];

export const RARITY_COLORS: Record<Rarity, string> = {
    common:    '#9e9e9e',
    rare:      '#2196f3',
    epic:      '#4caf50',
    legendary: '#f44336',
    mythic:    '#ffc107',
    heroic:    '#9c27b0',
};

export const RARITY_LABELS: Record<Rarity, string> = {
    common:    'Zwykly',
    rare:      'Rzadki',
    epic:      'Epicki',
    legendary: 'Legendarny',
    mythic:    'Mityczny',
    heroic:    'Heroiczny',
};

export const RARITY_BONUS_SLOTS: Record<Rarity, number> = {
    common:    0,
    rare:      1,
    epic:      1,
    legendary: 2,
    mythic:    3,
    heroic:    5,
};



export const CLASS_WEAPON_TYPES: Record<string, string[]> = {
    Knight:      ['sword'],
    Mage:        ['staff'],
    Cleric:      ['holy_wand'],
    Archer:      ['bow'],
    Rogue:       ['dagger'],
    Necromancer: ['dead_staff'],
    Bard:        ['harp'],
};

export const CLASS_OFFHAND_TYPES: Record<string, string[]> = {
    Knight:      ['shield'],
    Mage:        ['spellbook'],
    Cleric:      ['holy_cross'],
    Archer:      ['quiver'],
    Rogue:       ['dagger'],
    Necromancer: ['voodoo_doll'],
    Bard:        ['talisman'],
};

export const CLASS_ARMOR_TYPES: Record<string, string> = {
    Knight:      'heavy',
    Mage:        'magic',
    Cleric:      'magic',
    Archer:      'light',
    Rogue:       'light',
    Necromancer: 'magic',
    Bard:        'light',
};


export const CLASS_COLORS: Record<string, string> = {
    Knight:      '#e53935',
    Mage:        '#7b1fa2',
    Cleric:      '#ffc107',
    Archer:      '#4caf50',
    Rogue:       '#212121',
    Necromancer: '#795548',
    Bard:        '#ff9800',
};


const RARITY_SELL_MULTIPLIER: Record<Rarity, number> = {
    common:    0.20,
    rare:      0.35,
    epic:      0.50,
    legendary: 0.65,
    mythic:    0.80,
    heroic:    1.00,
};

const SELL_PRICES: Record<string, (lvl: number) => number> = {
    common:    (lvl) => Math.floor(lvl * 5 + 10),
    rare:      (lvl) => Math.floor(lvl * 20 + 50),
    epic:      (lvl) => Math.floor(lvl * 60 + 200),
    legendary: (lvl) => Math.floor(lvl * 150 + 500),
    mythic:    (lvl) => Math.floor(lvl * 400 + 2000),
    heroic:    (lvl) => Math.floor(lvl * 800 + 5000),
};


export interface IEnhancementCost {
    stones: number;
    gold: number;
    successRate: number;
    stoneType: string;
}

export const getRequiredStoneType = (itemRarity: Rarity): string => {
    return STONE_FOR_RARITY[itemRarity];
};

export const getEnhancementCost = (targetLevel: number, itemRarity: Rarity = 'common'): IEnhancementCost => {
    const stoneType = getRequiredStoneType(itemRarity);

    const table: Record<number, Omit<IEnhancementCost, 'stoneType'>> = {
        1:  { stones: 1,   gold: 100,       successRate: 100 },
        2:  { stones: 1,   gold: 500,       successRate: 80 },
        3:  { stones: 2,   gold: 2000,      successRate: 60 },
        4:  { stones: 3,   gold: 5000,      successRate: 45 },
        5:  { stones: 5,   gold: 15000,     successRate: 30 },
        6:  { stones: 8,   gold: 50000,     successRate: 20 },
        7:  { stones: 12,  gold: 150000,    successRate: 15 },
        8:  { stones: 20,  gold: 500000,    successRate: 10 },
        9:  { stones: 35,  gold: 1500000,   successRate: 5 },
        10: { stones: 50,  gold: 5000000,   successRate: 2 },
        11: { stones: 65,  gold: 8000000,   successRate: 1.5 },
        12: { stones: 85,  gold: 12000000,  successRate: 1 },
        13: { stones: 110, gold: 18000000,  successRate: 0.7 },
        14: { stones: 140, gold: 25000000,  successRate: 0.5 },
        15: { stones: 180, gold: 35000000,  successRate: 0.3 },
        16: { stones: 230, gold: 50000000,  successRate: 0.2 },
        17: { stones: 290, gold: 70000000,  successRate: 0.12 },
        18: { stones: 370, gold: 100000000, successRate: 0.07 },
        19: { stones: 460, gold: 150000000, successRate: 0.03 },
        20: { stones: 580, gold: 200000000, successRate: 0.01 },
    };

    if (targetLevel <= 20) {
        const entry = table[targetLevel] ?? { stones: 1, gold: 100, successRate: 100 };
        return { ...entry, stoneType };
    }

    const prevCost = table[20];
    const levelsAbove20 = targetLevel - 20;
    return {
        stones: Math.ceil(prevCost.stones * Math.pow(1.3, levelsAbove20)),
        gold: Math.ceil(prevCost.gold * Math.pow(1.5, levelsAbove20)),
        successRate: Math.max(0.001, prevCost.successRate * Math.pow(0.5, levelsAbove20)),
        stoneType,
    };
};

export const getEnhancementMultiplier = (upgradeLevel: number): number => {
    if (upgradeLevel <= 0) return 1;
    return 1 + upgradeLevel * 0.10;
};

export const getUpgradedBaseStat = (baseValue: number, upgradeLevel: number): number => {
    if (baseValue <= 0 || upgradeLevel <= 0) return baseValue;
    const multiplied = Math.round(baseValue * getEnhancementMultiplier(upgradeLevel));
    const flatFloor = baseValue + upgradeLevel;
    return Math.max(multiplied, flatFloor);
};

export const getEnhancedBaseStats = (baseValue: number, upgradeLevel: number): number =>
    getUpgradedBaseStat(baseValue, upgradeLevel);

export const getBaseStatKeysForSlot = (slot: EquipmentSlot): readonly string[] => {
    switch (slot) {
        case 'mainHand':
        case 'offHand':
            return ['dmg_min', 'dmg_max', 'attack', 'defense'];
        case 'helmet':
        case 'armor':
        case 'pants':
        case 'shoulders':
        case 'boots':
            return ['hp'];
        case 'gloves':
            return ['attack'];
        case 'ring1':
        case 'ring2':
            return ['attack'];
        case 'necklace':
        case 'earrings':
            return ['defense'];
        default:
            return [];
    }
};

export const isBaseStatKey = (slot: EquipmentSlot | null, key: string): boolean => {
    if (!slot) return false;
    return getBaseStatKeysForSlot(slot).includes(key);
};


export const DISASSEMBLE_STONE_CHANCE = 0.25;

export const STONE_FOR_RARITY: Record<Rarity, string> = {
    common:    'common_stone',
    rare:      'rare_stone',
    epic:      'epic_stone',
    legendary: 'legendary_stone',
    mythic:    'mythic_stone',
    heroic:    'heroic_stone',
};

export const STONE_ICONS: Record<string, string> = {
    common_stone:    getStoneImage('common_stone')    ?? 'gem-stone',
    rare_stone:      getStoneImage('rare_stone')      ?? 'gem-stone',
    epic_stone:      getStoneImage('epic_stone')      ?? 'gem-stone',
    legendary_stone: getStoneImage('legendary_stone') ?? 'gem-stone',
    mythic_stone:    getStoneImage('mythic_stone')    ?? 'gem-stone',
    heroic_stone:    getStoneImage('heroic_stone')    ?? 'gem-stone',
};

export const STONE_GENERIC_ICON: string = getStoneImage(null) ?? 'gem-stone';

export const STONE_NAMES: Record<string, string> = {
    common_stone:    'Zwykly Kamien',
    rare_stone:      'Rzadki Kamien',
    epic_stone:      'Epicki Kamien',
    legendary_stone: 'Legendarny Kamien',
    mythic_stone:    'Mityczny Kamien',
    heroic_stone:    'Heroiczny Kamien',
};


export const STONE_CONVERSION_CHAIN: Record<string, string> = {
    common_stone:    'rare_stone',
    rare_stone:      'epic_stone',
    epic_stone:      'legendary_stone',
    legendary_stone: 'mythic_stone',
    mythic_stone:    'heroic_stone',
};

export const STONE_CONVERSION_COST = 100;
export const STONE_CONVERSION_GOLD = 1000;


export const buildItem = (generated: {
    itemId: string;
    rarity: Rarity;
    bonuses: Record<string, number>;
    itemLevel?: number;
}): IInventoryItem => ({
    uuid: `${generated.itemId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    itemId: generated.itemId,
    rarity: generated.rarity,
    bonuses: generated.bonuses,
    itemLevel: generated.itemLevel || 1,
    upgradeLevel: 0,
});

export const findBaseItem = (itemId: string, allItems: IBaseItem[]): IBaseItem | undefined =>
    allItems.find((i) => i.id === itemId);

export const getItemSlot = (itemId: string, allItems: IBaseItem[]): EquipmentSlot | null => {
    const base = findBaseItem(itemId, allItems);
    return base ? base.slot : null;
};

export const getItemSlotSafe = (itemId: string, allItems: IBaseItem[]): EquipmentSlot | null => {
    const baseSlot = getItemSlot(itemId, allItems);
    if (baseSlot) return baseSlot;
    const gen = getGeneratedItemInfo(itemId);
    return gen?.slot ?? null;
};

export type TSlotGroup = 'weapon' | 'armor' | 'jewelry' | 'unknown';

export const getItemSlotGroup = (slot: EquipmentSlot | null): TSlotGroup => {
    if (!slot) return 'unknown';
    if (slot === 'mainHand' || slot === 'offHand') return 'weapon';
    if (slot === 'helmet' || slot === 'armor' || slot === 'pants' || slot === 'gloves'
        || slot === 'shoulders' || slot === 'boots') return 'armor';
    if (slot === 'ring1' || slot === 'ring2' || slot === 'necklace' || slot === 'earrings') return 'jewelry';
    return 'unknown';
};

export const getItemStats = (item: IInventoryItem, baseData: IBaseItem): IItemStats => {
    const upgradeLevel = item.upgradeLevel ?? 0;
    const stats: IItemStats = {
        attack:    getUpgradedBaseStat(baseData.baseAtk ?? 0, upgradeLevel),
        defense:   getUpgradedBaseStat(baseData.baseDef ?? 0, upgradeLevel),
        hp:        0,
        mp:        0,
        speed:     0,
        critChance: 0,
    };
    for (const [key, val] of Object.entries(item.bonuses)) {
        if (key in stats) {
            (stats as unknown as Record<string, number>)[key] += val;
        }
    }
    return stats;
};

export const getTotalEquipmentStats = (
    equipment: Partial<IEquipment>,
    allItems: IBaseItem[],
): IItemStats => {
    const total: IItemStats = { attack: 0, defense: 0, hp: 0, mp: 0, speed: 0, critChance: 0 };
    for (const item of Object.values(equipment)) {
        if (!item) continue;
        const base = findBaseItem(item.itemId, allItems);
        if (base) {
            const stats = getItemStats(item, base);
            for (const key of Object.keys(total) as (keyof IItemStats)[]) {
                total[key] += stats[key];
            }
            continue;
        }

        const upgradeLevel = item.upgradeLevel ?? 0;
        const genInfo = getGeneratedItemInfo(item.itemId);
        const slot = genInfo?.slot ?? null;
        for (const [key, val] of Object.entries(item.bonuses)) {
            if (!(key in total)) continue;
            const isBase = isBaseStatKey(slot, key);
            const finalVal = isBase ? getUpgradedBaseStat(val, upgradeLevel) : val;
            (total as unknown as Record<string, number>)[key] += finalVal;
        }
    }
    return total;
};

export const getEquippedGearLevel = (equipment: Partial<IEquipment>): number => {
    const lv: number[] = [];
    for (const item of Object.values(equipment)) {
        if (!item) continue;
        const info = getGeneratedItemInfo(item.itemId);
        if (info?.itemLevel) lv.push(info.itemLevel);
    }
    return lv.length ? Math.round(lv.reduce((a, b) => a + b, 0) / lv.length) : 1;
};

export const getGearGapMultiplier = (gearLevel: number, contentLevel: number): number => {
    if (contentLevel <= 0 || gearLevel >= contentLevel) return 1;
    return Math.max(0.05, Math.pow(gearLevel / contentLevel, 2));
};

export const getEnhancementRefund = (enhanceLevel: number, itemRarity: Rarity = 'common'): { gold: number; stones: number; stoneType: string } => {
    if (!enhanceLevel || enhanceLevel <= 0) return { gold: 0, stones: 0, stoneType: '' };
    let totalGold = 0;
    let totalStones = 0;
    let stoneType = '';
    for (let lvl = 1; lvl <= enhanceLevel; lvl++) {
        const cost = getEnhancementCost(lvl, itemRarity);
        totalGold += cost.gold;
        totalStones += cost.stones;
        stoneType = cost.stoneType;
    }
    return {
        gold: totalGold,
        stones: totalStones,
        stoneType,
    };
};

export const getSellPrice = (item: IInventoryItem, baseData?: IBaseItem): number => {
    let basePrice: number;
    if (baseData && baseData.basePrice > 0) {
        const mult = RARITY_SELL_MULTIPLIER[item.rarity] ?? 0.2;
        const priceFromBase = Math.floor(baseData.basePrice * mult);
        basePrice = priceFromBase > 0 ? priceFromBase : 0;
    } else {
        basePrice = 0;
    }
    if (basePrice <= 0) {
        const level = item.itemLevel || 1;
        const priceFunc = SELL_PRICES[item.rarity];
        basePrice = priceFunc ? priceFunc(level) : Math.max(1, level * 5 + 10);
    }
    const enhanceRefund = getEnhancementRefund(item.upgradeLevel ?? 0, item.rarity);
    return basePrice + enhanceRefund.gold;
};

export const canEquip = (
    item: IInventoryItem,
    characterLevel: number,
    allItems: IBaseItem[],
    characterClass?: string,
): boolean => {
    const base = findBaseItem(item.itemId, allItems);
    if (base) {
        if (characterLevel < base.minLevel) return false;
        if (characterClass && !canClassEquip(item.itemId, base.slot, characterClass, allItems)) return false;
        return true;
    }

    const genInfo = getGeneratedItemInfo(item.itemId);
    if (genInfo) {
        if (characterLevel < (item.itemLevel || 1)) return false;
        if (characterClass && !canClassEquip(item.itemId, genInfo.slot, characterClass, allItems)) return false;
        return true;
    }

    return false;
};

export const getItemType = (itemId: string, allItems: IBaseItem[]): string | null => {
    const base = findBaseItem(itemId, allItems);
    if (base && base.type) return base.type;

    const genInfo = getGeneratedItemInfo(itemId);
    if (genInfo) return genInfo.type;

    if (itemId.includes('sword') || itemId === 'sword_of_beginnings') return 'sword';
    if (itemId.includes('dead_staff') || itemId === 'dead_staff') return 'dead_staff';
    if (itemId.includes('staff') || itemId === 'apprentice_staff') return 'staff';
    if (itemId.includes('holy_wand')) return 'holy_wand';
    if (itemId.includes('bow') || itemId === 'short_bow') return 'bow';
    if (itemId.includes('dagger') || itemId === 'rusty_dagger') return 'dagger';
    if (itemId.includes('harp') || itemId === 'lute') return 'harp';
    if (itemId.includes('shield')) return 'shield';
    if (itemId.includes('spellbook')) return 'spellbook';
    if (itemId === 'holy_cross' || itemId.includes('holy_cross')) return 'holy_cross';
    if (itemId.includes('quiver')) return 'quiver';
    if (itemId.includes('voodoo') || itemId === 'voodoo_doll') return 'voodoo_doll';
    if (itemId.includes('talisman')) return 'talisman';

    if (itemId.startsWith('heavy_')) return itemId;
    if (itemId.startsWith('magic_')) return itemId;
    if (itemId.startsWith('light_')) return itemId;

    return null;
};

export const getItemIcon = (itemId: string, slot: string, allItems: IBaseItem[]): string => {
    const itemType = getItemType(itemId, allItems);

    const imageUrl = getItemImage(itemId, slot, itemType ?? undefined);
    if (imageUrl) return imageUrl;

    if (itemType && ITEM_TYPE_ICONS[itemType]) {
        return ITEM_TYPE_ICONS[itemType];
    }

    const id = itemId.toLowerCase();

    if (id.includes('hp_potion') || id.includes('health_potion') || id.includes('heal_hp')) return 'red-heart';
    if (id.includes('mp_potion') || id.includes('mana_potion') || id.includes('heal_mp')) return 'droplet';
    if (id.includes('elixir') || id.includes('boost') || id.includes('eliksir')) return 'alembic';
    if (id.includes('enhancement_stone') || (id.includes('_stone') && !id.includes('stone_sword') && !id.includes('stone_armor'))) return 'gem-stone';

    if (id.includes('sword') || id.includes('blade') || id.includes('saber') || id.includes('claymore')) return 'crossed-swords';
    if (id.includes('staff') || id.includes('wand') || id.includes('rod')) return 'magic-wand';
    if (id.includes('mace') || id.includes('hammer') || id.includes('flail')) return 'hammer';
    if (id.includes('bow') || id.includes('crossbow')) return 'bow-and-arrow';
    if (id.includes('dagger') || id.includes('knife') || id.includes('stiletto')) return 'dagger';
    if (id.includes('harp') || id.includes('lute') || id.includes('flute') || id.includes('fiddle')) return 'musical-note';
    if (id.includes('axe') || id.includes('hatchet')) return 'axe';
    if (id.includes('club') || id.includes('cudgel')) return 'cricket-game';

    if (id.includes('shield') || id.includes('buckler')) return 'shield';
    if (id.includes('spellbook') || id.includes('magic_book') || id.includes('grimoire')) return 'closed-book';
    if (id.includes('holy_cross') || id.includes('crucifix')) return 'latin-cross';
    if (id.includes('quiver')) return 'bow-and-arrow';
    if (id.includes('tome')) return 'green-book';
    if (id.includes('voodoo')) return 'skull';
    if (id.includes('talisman')) return 'crystal-ball';

    if (slot === 'helmet' || id.includes('helmet') || id.includes('cap') || id.includes('hat') || id.includes('hood') || id.includes('crown')) return 'rescue-worker-s-helmet';
    if (slot === 'armor' || id.includes('armor') || id.includes('plate') || id.includes('robe') || id.includes('cloak') || (id.includes('leather') && !id.includes('pants') && !id.includes('glove') && !id.includes('boot') && !id.includes('pauldron'))) return 'safety-vest';
    if (slot === 'pants' || id.includes('pants') || id.includes('legs') || id.includes('legguard') || id.includes('greaves')) return 'jeans';
    if (slot === 'gloves' || id.includes('glove') || id.includes('gauntlet') || id.includes('mitt')) return 'gloves';
    if (slot === 'boots' || id.includes('boot') || id.includes('sandal') || id.includes('shoe')) return 'woman-s-boot';
    if (slot === 'shoulders' || id.includes('shoulder') || id.includes('pauldron') || id.includes('epaulet')) return 'military-medal';

    if (slot === 'ring1' || slot === 'ring2' || id.includes('ring') || id.includes('band')) return 'ring';
    if (slot === 'necklace' || id.includes('necklace') || id.includes('amulet') || id.includes('pendant') || id.includes('chain')) return 'prayer-beads';
    if (slot === 'earrings' || id.includes('earring')) return 'sparkles';

    return SLOT_ICONS[slot as EquipmentSlot] ?? 'package';
};

export const canClassEquip = (
    itemId: string,
    slot: EquipmentSlot,
    characterClass: string,
    allItems: IBaseItem[],
): boolean => {
    const itemType = getItemType(itemId, allItems);
    if (!itemType) return true;

    if (slot === 'mainHand') {
        const allowed = CLASS_WEAPON_TYPES[characterClass];
        if (!allowed) return true;
        return allowed.includes(itemType);
    }

    if (slot === 'offHand') {
        const allowed = CLASS_OFFHAND_TYPES[characterClass];
        if (!allowed) return true;
        return allowed.includes(itemType);
    }

    const armorSlots: EquipmentSlot[] = ['helmet', 'armor', 'pants', 'gloves', 'shoulders', 'boots'];
    if (armorSlots.includes(slot)) {
        const allowedPrefix = CLASS_ARMOR_TYPES[characterClass];
        if (!allowedPrefix) return true;

        const genInfo = getGeneratedItemInfo(itemId);
        if (genInfo) {
            const armorCategories = itemTemplates.armor as Record<string, { allowedClasses?: string[]; pieces: { slot: string }[] }>;
            for (const [prefix, category] of Object.entries(armorCategories)) {
                const armorType = `${prefix}_${genInfo.slot}`;
                if (genInfo.type === armorType && category.allowedClasses) {
                    return category.allowedClasses.includes(characterClass);
                }
            }
        }

        if (itemType.startsWith('heavy_') || itemType.startsWith('magic_') || itemType.startsWith('light_')) {
            return itemType.startsWith(allowedPrefix + '_');
        }
        return false;
    }

    return true;
};


export const getEquipTargetSlot = (
    baseSlot: EquipmentSlot,
    itemId: string,
    characterClass: string,
    equipment: IEquipment,
    allItems: IBaseItem[],
): EquipmentSlot => {
    if (baseSlot === 'ring1' || baseSlot === 'ring2') {
        if (!equipment[baseSlot]) return baseSlot;
        const otherRing: EquipmentSlot = baseSlot === 'ring1' ? 'ring2' : 'ring1';
        if (!equipment[otherRing]) return otherRing;
        return baseSlot;
    }

    if (characterClass === 'Rogue') {
        const itemType = getItemType(itemId, allItems);
        if (itemType === 'dagger') {
            if (baseSlot === 'mainHand') {
                if (!equipment.mainHand) return 'mainHand';
                if (!equipment.offHand) return 'offHand';
                return 'mainHand';
            }
            if (baseSlot === 'offHand') {
                if (!equipment.offHand) return 'offHand';
                if (!equipment.mainHand) return 'mainHand';
                return 'offHand';
            }
        }
    }

    return baseSlot;
};


export const isSlotCompatible = (
    baseSlot: EquipmentSlot,
    targetSlot: EquipmentSlot,
    itemId: string,
    characterClass: string,
    allItems: IBaseItem[],
): boolean => {
    if (baseSlot === targetSlot) return true;

    if ((baseSlot === 'ring1' || baseSlot === 'ring2') && (targetSlot === 'ring1' || targetSlot === 'ring2')) {
        return true;
    }

    if (characterClass === 'Rogue') {
        const itemType = getItemType(itemId, allItems);
        if (itemType === 'dagger' && (targetSlot === 'mainHand' || targetSlot === 'offHand')) {
            return true;
        }
    }

    return false;
};


export const getClassSkillBonus = (
    characterClass: string,
    skillLevels: Record<string, number>,
): { skillBonus: number; extraCritChance: number } => {
    let skillBonus = 0;
    let extraCritChance = 0;

    switch (characterClass) {
        case 'Knight': {
            const swordLevel = skillLevels['sword_fighting'] ?? 0;
            skillBonus = Math.floor(swordLevel * 0.5);
            break;
        }
        case 'Mage':
        case 'Necromancer': {
            const mlvl = skillLevels['magic_level'] ?? 0;
            skillBonus = Math.floor(mlvl * 0.8);
            break;
        }
        case 'Cleric': {
            const mlvl = skillLevels['magic_level'] ?? 0;
            skillBonus = Math.floor(mlvl * 0.6);
            break;
        }
        case 'Archer': {
            const distLevel = skillLevels['distance_fighting'] ?? 0;
            skillBonus = Math.floor(distLevel * 0.4);
            extraCritChance = distLevel * 0.003;
            break;
        }
        case 'Rogue': {
            const dagLevel = skillLevels['dagger_fighting'] ?? 0;
            skillBonus = Math.floor(dagLevel * 0.3);
            extraCritChance = dagLevel * 0.005;
            break;
        }
        case 'Bard': {
            const bardLevel = skillLevels['bard_level'] ?? 0;
            skillBonus = Math.floor(bardLevel * 0.5);
            break;
        }
    }

    return { skillBonus, extraCritChance };
};


export const formatItemName = (key: string): string =>
    key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');


export const flattenItemsData = (itemsJson: {
    weapons?: unknown[];
    offhands?: unknown[];
    armor?: unknown[];
    accessories?: unknown[];
}): IBaseItem[] => {
    return [
        ...(itemsJson.weapons     ?? []),
        ...(itemsJson.offhands    ?? []),
        ...(itemsJson.armor       ?? []),
        ...(itemsJson.accessories ?? []),
    ] as IBaseItem[];
};
