import itemTemplates from '../data/itemTemplates.json';

// ── Generated-item info (parsed from itemId, avoids circular import with itemGenerator) ──

interface IGenItemInfo {
    type: string;
    slot: EquipmentSlot;
}

const _genInfoCache = new Map<string, IGenItemInfo | null>();

/** Clear the generated item info cache (useful after hot-reloading data) */
export const clearGenInfoCache = (): void => {
    _genInfoCache.clear();
};

/**
 * Parse a generated item ID like "sword_lvl5_rare" or "heavy_helmet_lvl3_epic"
 * and return the item type and equipment slot.  Works for weapons, offhands,
 * armor, accessories and starter weapons.  Returns null for legacy IDs that
 * don't follow the generated format.
 */
export const getGeneratedItemInfo = (itemId: string): IGenItemInfo | null => {
    if (_genInfoCache.has(itemId)) return _genInfoCache.get(itemId)!;

    const parts = itemId.split('_lvl');
    // Starter weapons: "starter_sword" (no _lvl part)
    const isStarter = itemId.startsWith('starter_') && parts.length < 2;
    const typePart = isStarter ? itemId.replace('starter_', '') : (parts.length >= 2 ? parts[0] : null);

    if (!typePart) {
        _genInfoCache.set(itemId, null);
        return null;
    }

    // Weapons
    for (const w of (itemTemplates.weapons as { type: string; slot: string }[])) {
        if (w.type === typePart) {
            const info: IGenItemInfo = { type: w.type, slot: w.slot as EquipmentSlot };
            _genInfoCache.set(itemId, info);
            return info;
        }
    }

    // Offhands
    for (const o of (itemTemplates.offhands as { type: string; slot: string }[])) {
        if (o.type === typePart) {
            const info: IGenItemInfo = { type: o.type, slot: o.slot as EquipmentSlot };
            _genInfoCache.set(itemId, info);
            return info;
        }
    }

    // Armor (format: prefix_slot)
    for (const [prefix, category] of Object.entries(itemTemplates.armor as Record<string, { pieces: { slot: string }[] }>)) {
        for (const piece of category.pieces) {
            const armorType = `${prefix}_${piece.slot}`;
            if (typePart === armorType) {
                const info: IGenItemInfo = { type: armorType, slot: piece.slot as EquipmentSlot };
                _genInfoCache.set(itemId, info);
                return info;
            }
        }
    }

    // Accessories
    for (const a of (itemTemplates.accessories as { type: string; slot: string }[])) {
        if (a.type === typePart) {
            const info: IGenItemInfo = { type: a.type, slot: a.slot as EquipmentSlot };
            _genInfoCache.set(itemId, info);
            return info;
        }
    }

    _genInfoCache.set(itemId, null);
    return null;
};

// ── Types ─────────────────────────────────────────────────────────────────────

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

// Order matters – rendered in a 2-column grid, row by row:
// Row 1: mainHand   | offHand
// Row 2: helmet     | shoulders
// Row 3: armor      | gloves
// Row 4: pants      | boots
// Row 5: ring1      | ring2
// Row 6: necklace   | earrings
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
    helmet:    '⛑️',
    armor:     '🦺',
    pants:     '👖',
    gloves:    '🧤',
    shoulders: '🎖️',
    boots:     '👢',
    mainHand:  '⚔️',
    offHand:   '🛡️',
    ring1:     '💍',
    ring2:     '💍',
    earrings:  '✨',
    necklace:  '📿',
};

/** Maps item `type` field to a specific emoji icon.
 *  Use this for more precise icons (e.g. staff vs sword vs bow). */
export const ITEM_TYPE_ICONS: Record<string, string> = {
    // Weapons (mainHand)
    sword:      '⚔️',
    staff:      '🪄',
    mace:       '🔨',
    bow:        '🏹',
    dagger:     '🗡️',
    harp:       '🎵',
    axe:        '🪓',
    club:       '🏏',
    dead_staff: '💀',
    holy_wand:  '✨',
    // Offhands
    shield:     '🛡️',
    magic_book: '📕',
    spellbook:  '📕',
    holy:       '✝️',
    holy_cross: '✝️',
    quiver:     '🏹',
    tome:       '📗',
    voodoo_doll:'💀',
    talisman:   '🔮',
    // Heavy armor (Knight)
    heavy_helmet:    '⛑️',
    heavy_armor:     '🦺',
    heavy_pants:     '👖',
    heavy_boots:     '👢',
    heavy_shoulders: '🎖️',
    heavy_gloves:    '🧤',
    // Magic armor (Mage, Cleric, Necromancer)
    magic_helmet:    '🎩',
    magic_armor:     '🧙',
    magic_pants:     '👖',
    magic_boots:     '🥾',
    magic_shoulders: '🎗️',
    magic_gloves:    '🧤',
    // Light armor (Archer, Rogue, Bard)
    light_helmet:    '🪖',
    light_armor:     '👘',
    light_pants:     '👖',
    light_boots:     '👟',
    light_shoulders: '🎖️',
    light_gloves:    '🧤',
    // Accessories
    ring:       '💍',
    necklace:   '📿',
    earrings:   '✨',
    // Stones
    stone:      '💎',
    // Consumables
    heal_hp:    '❤️',
    heal_mp:    '💧',
    xp_boost:   '⚗️',
    skill_boost:'⚗️',
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
    critDmg: number;
}

export type IEquipment = Record<EquipmentSlot, IInventoryItem | null>;

export const EMPTY_EQUIPMENT: IEquipment = {
    helmet: null, armor: null, pants: null, gloves: null, shoulders: null,
    boots: null, mainHand: null, offHand: null, ring1: null, ring2: null,
    earrings: null, necklace: null,
};

// ── Rarity helpers ─────────────────────────────────────────────────────────────

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic', 'heroic'];

export const RARITY_COLORS: Record<Rarity, string> = {
    common:    '#9e9e9e',
    rare:      '#2196f3',
    epic:      '#4caf50',
    legendary: '#f44336',
    mythic:    '#ffc107',
    heroic:    '#9c27b0',
};

export const RARITY_BG_COLORS: Record<Rarity, string> = {
    common:    'rgba(255,255,255,0.08)',
    rare:      'rgba(33,150,243,0.08)',
    epic:      'rgba(76,175,80,0.08)',
    legendary: 'rgba(244,67,54,0.08)',
    mythic:    'rgba(255,193,7,0.08)',
    heroic:    'rgba(156,39,176,0.08)',
};

export const RARITY_LABELS: Record<Rarity, string> = {
    common:    'Zwykly',
    rare:      'Rzadki',
    epic:      'Epicki',
    legendary: 'Legendarny',
    mythic:    'Mityczny',
    heroic:    'Heroiczny',
};

// Number of bonus stats per rarity
export const RARITY_BONUS_SLOTS: Record<Rarity, number> = {
    common:    0,
    rare:      1,
    epic:      1,
    legendary: 2,
    mythic:    3,
    heroic:    5,
};

// ── Weapon type icons ──────────────────────────────────────────────────────────

export const WEAPON_TYPE_ICONS: Record<string, string> = {
    sword:       '⚔️',
    staff:       '🪄',
    holy_wand:   '✨',
    bow:         '🏹',
    dagger:      '🗡️',
    dead_staff:  '💀',
    harp:        '🎵',
    shield:      '🛡️',
    spellbook:   '📕',
    holy_cross:  '✝️',
    quiver:      '🏹',
    voodoo_doll: '🪆',
    talisman:    '🔮',
};

export const ARMOR_TYPE_ICONS: Record<string, string> = {
    heavy_helmet:    '⛑️',
    heavy_armor:     '🦺',
    heavy_legs:      '👖',
    heavy_boots:     '👢',
    heavy_shoulders: '🎖️',
    heavy_gloves:    '🧤',
    magic_helmet:    '🎩',
    magic_armor:     '🧙',
    magic_legs:      '👖',
    magic_boots:     '🥾',
    magic_shoulders: '🎗️',
    magic_gloves:    '🧤',
    light_helmet:    '🪖',
    light_armor:     '👘',
    light_legs:      '👖',
    light_boots:     '👟',
    light_shoulders: '🎖️',
    light_gloves:    '🧤',
    ring:            '💍',
    necklace:        '📿',
    earrings:        '✨',
};

// ── Class weapon restrictions ─────────────────────────────────────────────────

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

// Maps character class → allowed armor prefix
export const CLASS_ARMOR_TYPES: Record<string, string> = {
    Knight:      'heavy',
    Mage:        'magic',
    Cleric:      'magic',
    Archer:      'light',
    Rogue:       'light',
    Necromancer: 'magic',
    Bard:        'light',
};

// ── Class colors ──────────────────────────────────────────────────────────────

export const CLASS_COLORS: Record<string, string> = {
    Knight:      '#e53935',
    Mage:        '#7b1fa2',
    Cleric:      '#ffc107',
    Archer:      '#4caf50',
    Rogue:       '#212121',
    Necromancer: '#795548',
    Bard:        '#ff9800',
};

// ── Sell prices ───────────────────────────────────────────────────────────────

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

// ── Enhancement system ────────────────────────────────────────────────────────

export interface IEnhancementCost {
    stones: number;
    gold: number;
    successRate: number;
    stoneType: string;
}

/**
 * Returns the required stone type for enhancing an item of the given rarity.
 * Common items need Common Stones, Rare items need Rare Stones, etc.
 */
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

    // Formula for +21 and beyond
    const prevCost = table[20];
    const levelsAbove20 = targetLevel - 20;
    return {
        stones: Math.ceil(prevCost.stones * Math.pow(1.3, levelsAbove20)),
        gold: Math.ceil(prevCost.gold * Math.pow(1.5, levelsAbove20)),
        successRate: Math.max(0.001, prevCost.successRate * Math.pow(0.5, levelsAbove20)),
        stoneType,
    };
};

/**
 * Enhancement multiplier curve.
 * Designed so upgrades feel meaningful:
 *   +1  → 1.15x    +2  → 1.32x    +3  → 1.52x    +4  → 1.75x    +5  → 2.01x
 *   +6  → 2.31x    +7  → 2.66x    +8  → 3.06x    +9  → 3.52x    +10 → 4.05x
 *   +15 → ~5.94x   +20 → ~8.74x
 *
 * Levels 1-10 use 1.15^level; levels 11+ continue from that base at 1.08^(level-10).
 */
export const getEnhancementMultiplier = (upgradeLevel: number): number => {
    if (upgradeLevel <= 0) return 1;
    if (upgradeLevel <= 10) return Math.pow(1.15, upgradeLevel);
    return Math.pow(1.15, 10) * Math.pow(1.08, upgradeLevel - 10);
};

// Enhancement boosts base stats along the curve above AND guarantees at least +1 per level
// (otherwise a small base like 2 ATK could round down and show no progression)
export const getUpgradedBaseStat = (baseValue: number, upgradeLevel: number): number => {
    if (baseValue <= 0 || upgradeLevel <= 0) return baseValue;
    const multiplied = Math.round(baseValue * getEnhancementMultiplier(upgradeLevel));
    const flatFloor = baseValue + upgradeLevel;
    return Math.max(multiplied, flatFloor);
};

// Legacy alias – kept so existing callers still work
export const getEnhancedBaseStats = (baseValue: number, upgradeLevel: number): number =>
    getUpgradedBaseStat(baseValue, upgradeLevel);

/**
 * Returns the bonus keys that represent the "base" stat for a given equipment slot.
 * Only these keys are scaled by upgradeLevel; random bonuses (extra HP on a ring,
 * crit on pants, etc.) are NOT scaled.
 *
 * Per spec:
 *   - mainHand / offHand  → weapons scale dmg_min / dmg_max
 *   - helmet/armor/pants/shoulders/boots → hp
 *   - gloves → attack
 *   - ring1 / ring2 → attack
 *   - necklace / earrings → defense
 */
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

/**
 * Returns true if `key` is the base stat for an item equipped in `slot`.
 * Used to decide whether the upgrade multiplier should apply to a given bonus.
 */
export const isBaseStatKey = (slot: EquipmentSlot | null, key: string): boolean => {
    if (!slot) return false;
    return getBaseStatKeysForSlot(slot).includes(key);
};

// ── Enhancement stone types ───────────────────────────────────────────────────

export const STONE_FOR_RARITY: Record<Rarity, string> = {
    common:    'common_stone',
    rare:      'rare_stone',
    epic:      'epic_stone',
    legendary: 'legendary_stone',
    mythic:    'mythic_stone',
    heroic:    'heroic_stone',
};

export const STONE_ICONS: Record<string, string> = {
    common_stone:    '💎',
    rare_stone:      '💎',
    epic_stone:      '💎',
    legendary_stone: '💎',
    mythic_stone:    '💎',
    heroic_stone:    '💎',
};

export const STONE_NAMES: Record<string, string> = {
    common_stone:    'Zwykly Kamien',
    rare_stone:      'Rzadki Kamien',
    epic_stone:      'Epicki Kamien',
    legendary_stone: 'Legendarny Kamien',
    mythic_stone:    'Mityczny Kamien',
    heroic_stone:    'Heroiczny Kamien',
};

// ── Stone conversion chain (100 lower → 1 higher, cost 1000g) ────────────────

export const STONE_CONVERSION_CHAIN: Record<string, string> = {
    common_stone:    'rare_stone',
    rare_stone:      'epic_stone',
    epic_stone:      'legendary_stone',
    legendary_stone: 'mythic_stone',
    mythic_stone:    'heroic_stone',
};

export const STONE_CONVERSION_COST = 100; // stones needed
export const STONE_CONVERSION_GOLD = 1000; // gold needed

// ── Core functions ─────────────────────────────────────────────────────────────

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

/**
 * Resolve an item's slot using both the static base-items list and the
 * generated-item encoder. Returns null for items we truly can't classify.
 * Used by inventory/deposit slot filters.
 */
export const getItemSlotSafe = (itemId: string, allItems: IBaseItem[]): EquipmentSlot | null => {
    const baseSlot = getItemSlot(itemId, allItems);
    if (baseSlot) return baseSlot;
    const gen = getGeneratedItemInfo(itemId);
    return gen?.slot ?? null;
};

/** Coarse item-type groups used by the inventory / deposit slot filters. */
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
    // Legacy items: baseAtk/baseDef are the base stat for that slot, so they scale.
    const stats: IItemStats = {
        attack:    getUpgradedBaseStat(baseData.baseAtk ?? 0, upgradeLevel),
        defense:   getUpgradedBaseStat(baseData.baseDef ?? 0, upgradeLevel),
        hp:        0,
        mp:        0,
        speed:     0,
        critChance: 0,
        critDmg:   0,
    };
    // Random bonuses on legacy items are NOT scaled by upgrade.
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
    const total: IItemStats = { attack: 0, defense: 0, hp: 0, mp: 0, speed: 0, critChance: 0, critDmg: 0 };
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

        // Generated item – stats come from bonuses only (no base item entry).
        // Upgrade ONLY scales the base stat for that slot (e.g. hp on armor,
        // attack on ring, dmg_min/dmg_max on weapon). Random extras stay flat.
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

/**
 * Calculate the total gold & stones invested in enhancements from +0 to given level.
 * Returns 100% of stones AND 100% of gold invested — when selling or
 * disassembling, the player gets back everything they put in on top of the
 * item's base value. This guarantees upgrades never make the item a net loss.
 */
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
        gold: totalGold,     // 100% gold refund – upgrades must not be a trap
        stones: totalStones, // 100% stone refund – stones are valuable
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
    // Add enhancement refund (100% of invested gold + 100% of stones).
    // Stones are converted to gold value here for the sell price; the
    // inventory sell flow also returns the raw stones via the item drop.
    const enhanceRefund = getEnhancementRefund(item.upgradeLevel ?? 0, item.rarity);
    return basePrice + enhanceRefund.gold;
};

export const canEquip = (
    item: IInventoryItem,
    characterLevel: number,
    allItems: IBaseItem[],
    characterClass?: string,
): boolean => {
    // Try legacy items first
    const base = findBaseItem(item.itemId, allItems);
    if (base) {
        if (characterLevel < base.minLevel) return false;
        if (characterClass && !canClassEquip(item.itemId, base.slot, characterClass, allItems)) return false;
        return true;
    }

    // Try generated items (from itemGenerator)
    const genInfo = getGeneratedItemInfo(item.itemId);
    if (genInfo) {
        // Item level check
        if (characterLevel < (item.itemLevel || 1)) return false;
        // Class restriction check for generated items
        if (characterClass && !canClassEquip(item.itemId, genInfo.slot, characterClass, allItems)) return false;
        return true;
    }

    return false;
};

// Helper to get item type - checks base item type field, generated items, then derives from itemId
export const getItemType = (itemId: string, allItems: IBaseItem[]): string | null => {
    const base = findBaseItem(itemId, allItems);
    if (base && base.type) return base.type;

    // Check generated item format (e.g. "sword_lvl5_rare", "starter_dagger")
    const genInfo = getGeneratedItemInfo(itemId);
    if (genInfo) return genInfo.type;

    // Derive from known item IDs (legacy fallback)
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

    // Armor type detection
    if (itemId.startsWith('heavy_')) return itemId;
    if (itemId.startsWith('magic_')) return itemId;
    if (itemId.startsWith('light_')) return itemId;

    return null;
};

/** Get the best emoji icon for an item, checking type first then falling back to slot. */
export const getItemIcon = (itemId: string, slot: string, allItems: IBaseItem[]): string => {
    const itemType = getItemType(itemId, allItems);
    if (itemType && ITEM_TYPE_ICONS[itemType]) {
        return ITEM_TYPE_ICONS[itemType];
    }

    // Name-based detection for items without a type field (e.g. items.json armor)
    const id = itemId.toLowerCase();

    // Consumables / potions / stones
    if (id.includes('hp_potion') || id.includes('health_potion') || id.includes('heal_hp')) return '❤️';
    if (id.includes('mp_potion') || id.includes('mana_potion') || id.includes('heal_mp')) return '💧';
    if (id.includes('elixir') || id.includes('boost') || id.includes('eliksir')) return '⚗️';
    if (id.includes('enhancement_stone') || (id.includes('_stone') && !id.includes('stone_sword') && !id.includes('stone_armor'))) return '💎';

    // Weapon name detection (for legacy items without type)
    if (id.includes('sword') || id.includes('blade') || id.includes('saber') || id.includes('claymore')) return '⚔️';
    if (id.includes('staff') || id.includes('wand') || id.includes('rod')) return '🪄';
    if (id.includes('mace') || id.includes('hammer') || id.includes('flail')) return '🔨';
    if (id.includes('bow') || id.includes('crossbow')) return '🏹';
    if (id.includes('dagger') || id.includes('knife') || id.includes('stiletto')) return '🗡️';
    if (id.includes('harp') || id.includes('lute') || id.includes('flute') || id.includes('fiddle')) return '🎵';
    if (id.includes('axe') || id.includes('hatchet')) return '🪓';
    if (id.includes('club') || id.includes('cudgel')) return '🏏';

    // Offhand name detection
    if (id.includes('shield') || id.includes('buckler')) return '🛡️';
    if (id.includes('spellbook') || id.includes('magic_book') || id.includes('grimoire')) return '📕';
    if (id.includes('holy_cross') || id.includes('crucifix')) return '✝️';
    if (id.includes('quiver')) return '🏹';
    if (id.includes('tome')) return '📗';
    if (id.includes('voodoo')) return '💀';
    if (id.includes('talisman')) return '🔮';

    // Armor name detection (for items.json armor entries like leather_cap, iron_helmet)
    if (slot === 'helmet' || id.includes('helmet') || id.includes('cap') || id.includes('hat') || id.includes('hood') || id.includes('crown')) return '⛑️';
    if (slot === 'armor' || id.includes('armor') || id.includes('plate') || id.includes('robe') || id.includes('cloak') || (id.includes('leather') && !id.includes('pants') && !id.includes('glove') && !id.includes('boot') && !id.includes('pauldron'))) return '🦺';
    if (slot === 'pants' || id.includes('pants') || id.includes('legs') || id.includes('legguard') || id.includes('greaves')) return '👖';
    if (slot === 'gloves' || id.includes('glove') || id.includes('gauntlet') || id.includes('mitt')) return '🧤';
    if (slot === 'boots' || id.includes('boot') || id.includes('sandal') || id.includes('shoe')) return '👢';
    if (slot === 'shoulders' || id.includes('shoulder') || id.includes('pauldron') || id.includes('epaulet')) return '🎖️';

    // Accessory detection
    if (slot === 'ring1' || slot === 'ring2' || id.includes('ring') || id.includes('band')) return '💍';
    if (slot === 'necklace' || id.includes('necklace') || id.includes('amulet') || id.includes('pendant') || id.includes('chain')) return '📿';
    if (slot === 'earrings' || id.includes('earring')) return '✨';

    return SLOT_ICONS[slot as EquipmentSlot] ?? '📦';
};

/** Check if a character class can use a specific item */
export const canClassEquip = (
    itemId: string,
    slot: EquipmentSlot,
    characterClass: string,
    allItems: IBaseItem[],
): boolean => {
    // Only restrict mainHand, offHand, and armor slots
    const itemType = getItemType(itemId, allItems);
    if (!itemType) return true;

    // Weapon restrictions
    if (slot === 'mainHand') {
        const allowed = CLASS_WEAPON_TYPES[characterClass];
        if (!allowed) return true;
        return allowed.includes(itemType);
    }

    // Offhand restrictions
    if (slot === 'offHand') {
        const allowed = CLASS_OFFHAND_TYPES[characterClass];
        if (!allowed) return true;
        return allowed.includes(itemType);
    }

    // Armor restrictions (helmet, armor, pants, gloves, shoulders, boots)
    const armorSlots: EquipmentSlot[] = ['helmet', 'armor', 'pants', 'gloves', 'shoulders', 'boots'];
    if (armorSlots.includes(slot)) {
        const allowedPrefix = CLASS_ARMOR_TYPES[characterClass];
        if (!allowedPrefix) return true;

        // For generated items, also check allowedClasses from itemTemplates directly
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

        // Check if item type starts with any armor prefix
        if (itemType.startsWith('heavy_') || itemType.startsWith('magic_') || itemType.startsWith('light_')) {
            return itemType.startsWith(allowedPrefix + '_');
        }
        // Legacy armor items (leather_armor, etc.) without heavy/magic/light prefix
        // → reject unless the item has no known armor prefix (truly generic)
        return false;
    }

    // Accessories (rings, necklace, earrings) - all classes
    return true;
};

// ── Smart slot resolution (rings → ring1/ring2, Rogue daggers → mainHand/offHand) ──

/**
 * Determines the best equipment slot for an item, considering what is already equipped.
 * - Rings (slot ring1 or ring2) can go in either ring slot; prefers the item's native slot,
 *   falls back to the other ring slot if the native one is occupied.
 * - Daggers for Rogue can go in both mainHand and offHand (dual wield).
 *   If base slot (mainHand) is occupied, tries offHand.
 */
export const getEquipTargetSlot = (
    baseSlot: EquipmentSlot,
    itemId: string,
    characterClass: string,
    equipment: IEquipment,
    allItems: IBaseItem[],
): EquipmentSlot => {
    // Ring logic: ring1 ↔ ring2
    if (baseSlot === 'ring1' || baseSlot === 'ring2') {
        if (!equipment[baseSlot]) return baseSlot;
        const otherRing: EquipmentSlot = baseSlot === 'ring1' ? 'ring2' : 'ring1';
        if (!equipment[otherRing]) return otherRing;
        return baseSlot; // both occupied – swap the native slot
    }

    // Rogue dagger dual-wield: mainHand ↔ offHand
    if (characterClass === 'Rogue') {
        const itemType = getItemType(itemId, allItems);
        if (itemType === 'dagger') {
            if (baseSlot === 'mainHand') {
                if (!equipment.mainHand) return 'mainHand';
                if (!equipment.offHand) return 'offHand';
                return 'mainHand'; // both occupied – swap mainHand
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

// ── Slot compatibility check ──────────────────────────────────────────────────

/**
 * Checks if an item with the given base slot can validly be placed in a target slot.
 * Allows ring1 ↔ ring2, and dagger mainHand ↔ offHand for Rogue.
 */
export const isSlotCompatible = (
    baseSlot: EquipmentSlot,
    targetSlot: EquipmentSlot,
    itemId: string,
    characterClass: string,
    allItems: IBaseItem[],
): boolean => {
    if (baseSlot === targetSlot) return true;

    // Rings are interchangeable between ring1 and ring2
    if ((baseSlot === 'ring1' || baseSlot === 'ring2') && (targetSlot === 'ring1' || targetSlot === 'ring2')) {
        return true;
    }

    // Rogue daggers can go in mainHand or offHand
    if (characterClass === 'Rogue') {
        const itemType = getItemType(itemId, allItems);
        if (itemType === 'dagger' && (targetSlot === 'mainHand' || targetSlot === 'offHand')) {
            return true;
        }
    }

    return false;
};

// ── Class-based damage scaling ─────────────────────────────────────────────────

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

// ── Format item ID from snake_case to Title Case ──────────────────────────────

export const formatItemName = (key: string): string =>
    key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// ── Flatten items.json into a single lookup array ─────────────────────────────

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
