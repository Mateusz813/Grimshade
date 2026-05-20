import { type Rarity, RARITY_ORDER, RARITY_BONUS_SLOTS } from './itemSystem';
import { SPELL_CHEST_LEVELS } from './skillSystem';
import { getSpellChestImage } from './spriteAssets';

export type { Rarity };

export type TMonsterRarity = 'normal' | 'strong' | 'epic' | 'legendary' | 'boss';

export interface IDropTableEntry {
    itemId: string;
    chance: number;
    rarity: Rarity;
}

export interface IGeneratedItem {
    itemId: string;
    rarity: Rarity;
    bonuses: Record<string, number>;
    itemLevel: number;
}

export interface ILootResult {
    items: IGeneratedItem[];
    gold: number;
    xp: number;
    stones: { type: string; count: number }[];
}

// ── Monster rarity encounter system ────────────────────────────────────────────

export const MONSTER_RARITY_CHANCES: Record<TMonsterRarity, number> = {
    normal:    0.90,
    strong:    0.07,
    epic:      0.015,
    legendary: 0.01,
    boss:      0.005,
};

export const MONSTER_RARITY_MULTIPLIERS: Record<TMonsterRarity, { hp: number; atk: number; def: number; xp: number; gold: number }> = {
    normal:    { hp: 1.0,  atk: 1.0,  def: 1.0,  xp: 1.0,  gold: 1.0 },
    strong:    { hp: 1.5,  atk: 1.2, def: 1.3,  xp: 2.0,  gold: 2.0 },
    epic:      { hp: 2.5,  atk: 1.6, def: 1.5,  xp: 4.0,  gold: 4.0 },
    legendary: { hp: 5.0,  atk: 1.8, def: 1.8,  xp: 10.0, gold: 10.0 },
    boss:      { hp: 10.0, atk: 2.5, def: 2.0,  xp: 30.0, gold: 30.0 },
};

/** How many task kills each rarity counts as */
export const MONSTER_RARITY_TASK_KILLS: Record<TMonsterRarity, number> = {
    normal:    1,
    strong:    3,
    epic:      10,
    legendary: 50,
    boss:      200,
};

// Monster rarity → max item rarity it can drop
export const MONSTER_RARITY_DROP_MAP: Record<TMonsterRarity, Rarity> = {
    normal:    'common',
    strong:    'rare',
    epic:      'epic',
    legendary: 'legendary',
    boss:      'mythic',
};

// Monster rarity → stone type it drops
export const MONSTER_RARITY_STONE_MAP: Record<TMonsterRarity, string> = {
    normal:    'common_stone',
    strong:    'rare_stone',
    epic:      'epic_stone',
    legendary: 'legendary_stone',
    boss:      'mythic_stone',
};

export interface IMasteryRarityBonuses {
    strong: number;
    epic: number;
    legendary: number;
    mythic: number;
    heroic: number;
}

/**
 * Roll monster rarity with optional mastery bonuses.
 * Mastery bonuses are added as percentage-point increases to rare spawn rates.
 * The bonuses reduce the normal spawn chance to keep total at 100%.
 */
export const rollMonsterRarity = (
    isSkipMode: boolean = false,
    masteryBonuses?: IMasteryRarityBonuses,
): TMonsterRarity => {
    // SKIP mode = only Normal monsters
    if (isSkipMode) return 'normal';

    // Calculate effective chances with mastery bonuses
    const bonuses = masteryBonuses ?? { strong: 0, epic: 0, legendary: 0, mythic: 0, heroic: 0 };
    const strongChance = MONSTER_RARITY_CHANCES.strong + bonuses.strong / 100;
    const epicChance = MONSTER_RARITY_CHANCES.epic + bonuses.epic / 100;
    const legendaryChance = MONSTER_RARITY_CHANCES.legendary + bonuses.legendary / 100;
    const bossChance = MONSTER_RARITY_CHANCES.boss + bonuses.mythic / 100;
    // Normal absorbs the remaining probability
    const normalChance = Math.max(0.01, 1 - strongChance - epicChance - legendaryChance - bossChance);

    const roll = Math.random();
    let cumulative = 0;

    const chances: [TMonsterRarity, number][] = [
        ['normal', normalChance],
        ['strong', strongChance],
        ['epic', epicChance],
        ['legendary', legendaryChance],
        ['boss', bossChance],
    ];

    for (const [rarity, chance] of chances) {
        cumulative += chance;
        if (roll < cumulative) return rarity;
    }
    return 'normal';
};

/**
 * Compute the effective spawn chance of each monster rarity given mastery
 * bonuses. Returns an object where each entry has:
 *   base  – the base spawn chance (as a fraction 0–1)
 *   bonus – extra spawn chance granted by mastery (as a fraction 0–1)
 *   total – base + bonus, clamped
 * Normal "absorbs" whatever mass the other tiers take from it, so its
 * effective total shrinks as mastery increases.
 */
export interface IRarityChanceBreakdown {
    base: number;
    bonus: number;
    total: number;
}

export const getEffectiveRarityChances = (
    masteryBonuses?: IMasteryRarityBonuses,
): Record<TMonsterRarity, IRarityChanceBreakdown> => {
    const b = masteryBonuses ?? { strong: 0, epic: 0, legendary: 0, mythic: 0, heroic: 0 };
    const strongBonus = b.strong / 100;
    const epicBonus = b.epic / 100;
    const legendaryBonus = b.legendary / 100;
    const bossBonus = b.mythic / 100;

    const strongTotal = MONSTER_RARITY_CHANCES.strong + strongBonus;
    const epicTotal = MONSTER_RARITY_CHANCES.epic + epicBonus;
    const legendaryTotal = MONSTER_RARITY_CHANCES.legendary + legendaryBonus;
    const bossTotal = MONSTER_RARITY_CHANCES.boss + bossBonus;
    const normalTotal = Math.max(0, 1 - strongTotal - epicTotal - legendaryTotal - bossTotal);
    // Normal "loses" the total bonus given to rarer tiers.
    const normalBonus = -(strongBonus + epicBonus + legendaryBonus + bossBonus);

    return {
        normal:    { base: MONSTER_RARITY_CHANCES.normal,    bonus: normalBonus,    total: normalTotal },
        strong:    { base: MONSTER_RARITY_CHANCES.strong,    bonus: strongBonus,    total: strongTotal },
        epic:      { base: MONSTER_RARITY_CHANCES.epic,      bonus: epicBonus,      total: epicTotal },
        legendary: { base: MONSTER_RARITY_CHANCES.legendary, bonus: legendaryBonus, total: legendaryTotal },
        boss:      { base: MONSTER_RARITY_CHANCES.boss,      bonus: bossBonus,      total: bossTotal },
    };
};

/** Format a rarity chance breakdown as a display string:
 *  "0.5%" if no bonus, or "0.5% + 0.2%" when mastery adds to it,
 *  or "90.0% − 1.85%" when mastery takes away from normal. */
export const formatRarityChance = (b: IRarityChanceBreakdown): string => {
    const base = (b.base * 100).toFixed(b.base < 0.1 ? 2 : 1);
    if (Math.abs(b.bonus) < 0.00005) return `${base}%`;
    if (b.bonus > 0) {
        const bonus = (b.bonus * 100).toFixed(b.bonus < 0.001 ? 2 : 1);
        return `${base}% + ${bonus}%`;
    }
    const bonus = (Math.abs(b.bonus) * 100).toFixed(Math.abs(b.bonus) < 0.001 ? 2 : 1);
    return `${base}% − ${bonus}%`;
};

export const MONSTER_RARITY_COLORS: Record<TMonsterRarity, string> = {
    normal:    'transparent',
    strong:    'rgba(33,150,243,0.12)',
    epic:      'rgba(76,175,80,0.12)',
    legendary: 'rgba(244,67,54,0.12)',
    boss:      'rgba(255,193,7,0.12)',
};

export const MONSTER_RARITY_LABELS: Record<TMonsterRarity, string> = {
    normal:    'Normal',
    strong:    'Strong',
    epic:      'Epic',
    legendary: 'Legendary',
    boss:      'Boss',
};

// ── Bonus stat generation ──────────────────────────────────────────────────────

const RARITY_BONUS_RANGES: Record<Rarity, { min: number; max: number }> = {
    common:    { min: 1, max: 5 },
    rare:      { min: 5, max: 15 },
    epic:      { min: 8, max: 20 },
    legendary: { min: 15, max: 40 },
    mythic:    { min: 30, max: 70 },
    heroic:    { min: 50, max: 100 },
};

const STAT_POOL = ['attack', 'defense', 'hp', 'mp', 'speed', 'critChance', 'critDmg'];

/**
 * Stat-specific multipliers for bonus ranges. critChance is scaled down
 * (values are raw % points), critDmg is scaled up (values are used * 0.01).
 */
const LOOT_STAT_MULT: Record<string, number> = {
    hp: 1.0, mp: 1.0, attack: 1.0, defense: 1.0, speed: 1.0,
    critChance: 0.3,   // mythic 30-70 * 0.3 = 9-21% crit chance max
    critDmg:    1.5,    // mythic 30-70 * 1.5 = 45-105 (→ +0.45-1.05 multiplier)
};

export const generateBonuses = (rarity: Rarity): Record<string, number> => {
    const numBonuses = RARITY_BONUS_SLOTS[rarity];
    if (numBonuses === 0) return {};

    const range = RARITY_BONUS_RANGES[rarity];
    const bonuses: Record<string, number> = {};
    const selected = [...STAT_POOL].sort(() => Math.random() - 0.5).slice(0, numBonuses);

    for (const stat of selected) {
        const mult = LOOT_STAT_MULT[stat] ?? 1.0;
        const raw = range.min + Math.floor(Math.random() * (range.max - range.min + 1));
        bonuses[stat] = Math.max(1, Math.round(raw * mult));
    }
    return bonuses;
};

// ── Rarity roll ──────────────────────────────────────────────────────────────

/**
 * Scale the base heroic drop rate by monster level.
 * Lower-level bosses give closer to the base rate (0.5%),
 * higher-level bosses are significantly rarer.
 *   lvl 1-100:   100% of base rate  (0.5%)
 *   lvl 200:     ~70% of base       (0.35%)
 *   lvl 500:     ~40% of base       (0.20%)
 *   lvl 800+:    ~20% of base       (0.10%)
 */
export const scaleHeroicDropRate = (baseRate: number, monsterLevel: number): number => {
    if (baseRate <= 0) return 0;
    if (monsterLevel <= 100) return baseRate;
    // Linear decay from 100% at lvl 100 to 20% at lvl 1000
    const scaleFactor = Math.max(0.20, 1.0 - (monsterLevel - 100) * 0.00089);
    return baseRate * scaleFactor;
};

/**
 * Roll item rarity from a killed monster.
 * @param monsterRarity - the rarity variant of the monster (normal/strong/epic/legendary/boss)
 * @param heroicDropRate - if > 0, boss-rarity monsters can drop heroic items at this rate (0-1).
 *   This should already be level-scaled via scaleHeroicDropRate before passing here.
 */
export const rollRarity = (monsterRarity: TMonsterRarity, heroicDropRate: number = 0): Rarity => {
    // Heroic items: only from boss-rarity monsters when mastery is maxed
    if (monsterRarity === 'boss' && heroicDropRate > 0 && Math.random() < heroicDropRate) {
        return 'heroic';
    }

    const maxRarity = MONSTER_RARITY_DROP_MAP[monsterRarity];
    const maxIndex = RARITY_ORDER.indexOf(maxRarity);

    // Weight distribution (higher rarity = rarer)
    const thresholds = [0.55, 0.25, 0.12, 0.05, 0.025, 0.005];
    const roll = Math.random();
    let cumulative = 0;

    for (let i = 0; i <= maxIndex; i++) {
        cumulative += thresholds[i];
        if (roll < cumulative) return RARITY_ORDER[i];
    }
    return RARITY_ORDER[maxIndex];
};

// ── New dynamic loot system ──────────────────────────────────────────────────

// Number of drop rolls based on monster rarity
const ROLL_COUNTS: Record<TMonsterRarity, number> = {
    normal:    2,
    strong:    3,
    epic:      4,
    legendary: 5,
    boss:      6,
};

// Base drop chance per roll (each roll may or may not produce an item)
const BASE_DROP_CHANCES: Record<TMonsterRarity, number> = {
    normal:    0.08,
    strong:    0.12,
    epic:      0.15,
    legendary: 0.20,
    boss:      0.30,
};

/**
 * Roll loot dynamically based on monster level and rarity.
 * No longer uses dropTable from monsters.json – all items are generated.
 * @param heroicDropRate - base heroic item drop chance (0-1), will be scaled by monster level.
 *   Only applies to boss-rarity monsters with max mastery.
 */
export const rollLoot = (
    monsterLevel: number,
    monsterRarity: TMonsterRarity,
    heroicDropRate: number = 0,
): IGeneratedItem[] => {
    const items: IGeneratedItem[] = [];
    const numRolls = ROLL_COUNTS[monsterRarity];
    const dropChance = BASE_DROP_CHANCES[monsterRarity];
    // Scale heroic rate by monster level (higher level = rarer heroic)
    const scaledHeroicRate = scaleHeroicDropRate(heroicDropRate, monsterLevel);

    for (let i = 0; i < numRolls; i++) {
        if (Math.random() < dropChance) {
            const rarity = rollRarity(monsterRarity, scaledHeroicRate);
            items.push({
                itemId: `generated_${rarity}_lvl${monsterLevel}`,
                rarity,
                bonuses: generateBonuses(rarity),
                itemLevel: monsterLevel,
            });
        }
    }

    // Max 5 items per kill
    return items.slice(0, 5);
};

// ── Legacy rollDropTable (kept for backward compat) ──────────────────────────

export const rollDropTable = (
    dropTable: IDropTableEntry[],
    monsterLevel: number,
    monsterRarity: TMonsterRarity = 'normal',
    heroicDropRate: number = 0,
): IGeneratedItem[] => {
    // Delegate to new rollLoot – dropTable ignored (kept for API compat)
    void dropTable;
    return rollLoot(monsterLevel, monsterRarity, heroicDropRate);
};

// ── Stone drops ──────────────────────────────────────────────────────────────

// Stone drop chance per monster rarity
// Better stones are HARDER to get (mythic stone much rarer than common)
const BASE_STONE_DROP_CHANCE: Record<TMonsterRarity, number> = {
    normal:    0.10,
    strong:    0.07,
    epic:      0.04,
    legendary: 0.02,
    boss:      0.01,
};

export const rollStoneDrop = (
    monsterLevel: number,
    monsterRarity: TMonsterRarity,
): { type: string; count: number } | null => {
    void monsterLevel; // reserved for level-scaled stone drops
    const chance = BASE_STONE_DROP_CHANCE[monsterRarity];

    if (Math.random() < chance) {
        const stoneType = MONSTER_RARITY_STONE_MAP[monsterRarity];
        return { type: stoneType, count: 1 };
    }
    return null;
};

export const calculateGoldDrop = (goldRange: [number, number], partySize: number = 1): number => {
    const [min, max] = goldRange;
    const base = min + Math.floor(Math.random() * (max - min + 1));
    const multiplier = 1 + (partySize - 1) * 0.15;
    return Math.floor(base * multiplier);
};

// ── Sell price for generated items ───────────────────────────────────────────

const SELL_MULT: Record<string, number> = {
    common: 5, rare: 20, epic: 60, legendary: 150, mythic: 400, heroic: 800,
};

const BASE_PRICE: Record<string, number> = {
    common: 10, rare: 50, epic: 200, legendary: 500, mythic: 2000, heroic: 5000,
};

export const getGeneratedSellPrice = (rarity: string, level: number): number => {
    return Math.floor((SELL_MULT[rarity] ?? 5) * level + (BASE_PRICE[rarity] ?? 10));
};

// ── Helper: Get max rarity for monster level (legacy compat) ──────────────────

export const getMaxRarityForLevel = (monsterLevel: number): Rarity => {
    if (monsterLevel <= 30) return 'common';
    if (monsterLevel <= 60) return 'rare';
    if (monsterLevel <= 100) return 'epic';
    return 'epic';
};

// ── Potion drops from monsters ──────────────────────────────────────────────

/**
 * Drop chances per potion tier (intentionally low — potions are powerful).
 *   - Flat-heal tiers (sm / md / lg, monsters lvl < 100): 0.4%
 *   - Percentage-regen tiers (great / super / ultimate / divine, lvl 100+): 0.1%
 *   - Mega elixir bonus (lvl 100+, +1000 flat): 0.4%
 * All values are < 0.5% so potions stay scarce.
 */
export const POTION_FLAT_DROP_CHANCE = 0.004;
export const POTION_PCT_DROP_CHANCE = 0.001;
export const POTION_MEGA_DROP_CHANCE = 0.004;

/**
 * Roll potion drops based on monster level.
 * Potion tier scales with monster level. Mega elixirs are a bonus roll for
 * monsters level 100+ (matches the `minLevel` of `hp_potion_mega` in the shop).
 */
export const rollPotionDrop = (monsterLevel: number): { potionId: string; count: number }[] => {
    const drops: { potionId: string; count: number }[] = [];

    // Determine potion tier by monster level
    let hpPotionId: string;
    let mpPotionId: string;
    let mainChance: number;

    if (monsterLevel >= 600) { hpPotionId = 'hp_potion_divine'; mpPotionId = 'mp_potion_divine'; mainChance = POTION_PCT_DROP_CHANCE; }
    else if (monsterLevel >= 400) { hpPotionId = 'hp_potion_ultimate'; mpPotionId = 'mp_potion_ultimate'; mainChance = POTION_PCT_DROP_CHANCE; }
    else if (monsterLevel >= 200) { hpPotionId = 'hp_potion_super'; mpPotionId = 'mp_potion_super'; mainChance = POTION_PCT_DROP_CHANCE; }
    else if (monsterLevel >= 100) { hpPotionId = 'hp_potion_great'; mpPotionId = 'mp_potion_great'; mainChance = POTION_PCT_DROP_CHANCE; }
    else if (monsterLevel >= 50) { hpPotionId = 'hp_potion_lg'; mpPotionId = 'mp_potion_lg'; mainChance = POTION_FLAT_DROP_CHANCE; }
    else if (monsterLevel >= 20) { hpPotionId = 'hp_potion_md'; mpPotionId = 'mp_potion_md'; mainChance = POTION_FLAT_DROP_CHANCE; }
    else { hpPotionId = 'hp_potion_sm'; mpPotionId = 'mp_potion_sm'; mainChance = POTION_FLAT_DROP_CHANCE; }

    if (Math.random() < mainChance) drops.push({ potionId: hpPotionId, count: 1 });
    if (Math.random() < mainChance) drops.push({ potionId: mpPotionId, count: 1 });

    // Mega elixirs: rare bonus drop from monsters level 100+ (matches shop minLevel)
    if (monsterLevel >= 100) {
        if (Math.random() < POTION_MEGA_DROP_CHANCE) drops.push({ potionId: 'hp_potion_mega', count: 1 });
        if (Math.random() < POTION_MEGA_DROP_CHANCE) drops.push({ potionId: 'mp_potion_mega', count: 1 });
    }

    return drops;
};

// ── Potion drop info for display (MonsterList / Combat / Boss / Dungeon) ────

/**
 * @deprecated Drop chance now varies per tier — read `IPotionDropInfo.hpChance`
 *  / `mpChance` from `getPotionDropInfo` instead. Kept as a fallback default
 *  pointing at the flat-tier rate.
 */
export const HP_POTION_DROP_CHANCE = POTION_FLAT_DROP_CHANCE;
/** @deprecated See `HP_POTION_DROP_CHANCE`. */
export const MP_POTION_DROP_CHANCE = POTION_FLAT_DROP_CHANCE;

export interface IPotionMegaDropInfo {
    hpPotionId: string;
    hpLabel: string;
    hpHeal: string;
    mpPotionId: string;
    mpLabel: string;
    mpHeal: string;
    chance: number;
}

export interface IPotionDropInfo {
    hpPotionId: string;
    hpLabel: string;
    hpHeal: string;
    /** Drop chance for the HP potion at this tier (0–1). */
    hpChance: number;
    mpPotionId: string;
    mpLabel: string;
    mpHeal: string;
    /** Drop chance for the MP potion at this tier (0–1). */
    mpChance: number;
    /** Mega-elixir bonus drop info (only present for monsters lvl 100+). */
    mega?: IPotionMegaDropInfo;
}

const MEGA_INFO: IPotionMegaDropInfo = {
    hpPotionId: 'hp_potion_mega',
    hpLabel: 'Mega HP',
    hpHeal: '+1000 HP',
    mpPotionId: 'mp_potion_mega',
    mpLabel: 'Mega MP',
    mpHeal: '+1000 MP',
    chance: POTION_MEGA_DROP_CHANCE,
};

export const getPotionDropInfo = (monsterLevel: number): IPotionDropInfo => {
    const mega = monsterLevel >= 100 ? MEGA_INFO : undefined;
    const pct = POTION_PCT_DROP_CHANCE;
    const flat = POTION_FLAT_DROP_CHANCE;

    if (monsterLevel >= 600) return { hpPotionId: 'hp_potion_divine',   hpLabel: 'Divine HP',   hpHeal: '100% HP', hpChance: pct,  mpPotionId: 'mp_potion_divine',   mpLabel: 'Divine MP',   mpHeal: '100% MP', mpChance: pct,  mega };
    if (monsterLevel >= 400) return { hpPotionId: 'hp_potion_ultimate', hpLabel: 'Ultimate HP', hpHeal: '50% HP',  hpChance: pct,  mpPotionId: 'mp_potion_ultimate', mpLabel: 'Ultimate MP', mpHeal: '50% MP',  mpChance: pct,  mega };
    if (monsterLevel >= 200) return { hpPotionId: 'hp_potion_super',    hpLabel: 'Super HP',    hpHeal: '35% HP',  hpChance: pct,  mpPotionId: 'mp_potion_super',    mpLabel: 'Super MP',    mpHeal: '35% MP',  mpChance: pct,  mega };
    if (monsterLevel >= 100) return { hpPotionId: 'hp_potion_great',    hpLabel: 'Great HP',    hpHeal: '20% HP',  hpChance: pct,  mpPotionId: 'mp_potion_great',    mpLabel: 'Great MP',    mpHeal: '20% MP',  mpChance: pct,  mega };
    if (monsterLevel >= 50)  return { hpPotionId: 'hp_potion_lg',       hpLabel: 'Strong HP',   hpHeal: '+400',    hpChance: flat, mpPotionId: 'mp_potion_lg',       mpLabel: 'Strong MP',   mpHeal: '+300',    mpChance: flat };
    if (monsterLevel >= 20)  return { hpPotionId: 'hp_potion_md',       hpLabel: 'HP Potion',   hpHeal: '+150',    hpChance: flat, mpPotionId: 'mp_potion_md',       mpLabel: 'MP Potion',   mpHeal: '+100',    mpChance: flat };
    return                          { hpPotionId: 'hp_potion_sm',       hpLabel: 'Small HP',    hpHeal: '+50',     hpChance: flat, mpPotionId: 'mp_potion_sm',       mpLabel: 'Small MP',    mpHeal: '+30',     mpChance: flat };
};

// ── Spell Chest Drops ──────────────────────────────────────────────────────

export interface ISpellChestDrop {
    chestLevel: number;
    count: number;
}

/** Base drop chance per eligible spell chest level, keyed by monster rarity. */
export const SPELL_CHEST_BASE_CHANCE: Record<TMonsterRarity, number> = {
    normal:    0.001,   // 0.1%
    strong:    0.005,   // 0.5%
    epic:      0.010,   // 1%
    legendary: 0.015,   // 1.5%
    boss:      0.020,   // 2%
};

/**
 * Bonus drop chance for "Heroic" spell chests — only rolls on boss-rarity
 * monsters that the player has fully mastered (25/25). Independent roll on
 * top of the boss-rarity chest, so a single kill can yield both. Display
 * for this tier should be hidden until the player actually unlocks mastery.
 */
export const SPELL_CHEST_HEROIC_BASE_CHANCE = 0.05; // 5%

/** Display label / order key for the synthetic "heroic" chest tier. */
export type TSpellChestRarityTier = TMonsterRarity | 'heroic';

/**
 * Roll spell chest drops from a monster kill.
 * Each eligible chest level (where chestLevel <= monsterLevel) is rolled independently.
 * Monsters level 1-4 never drop spell chests.
 * @param isDungeon - dungeon monsters get 1.5x drop chance
 * @param isBoss - boss encounters get 2.0x drop chance
 * @param hasMaxMastery - if true and monster is boss-rarity, also rolls the
 *   heroic-tier chest at `SPELL_CHEST_HEROIC_BASE_CHANCE` per eligible level.
 */
export const rollSpellChestDrop = (
    monsterLevel: number,
    monsterRarity: TMonsterRarity,
    isDungeon: boolean = false,
    isBoss: boolean = false,
    hasMaxMastery: boolean = false,
): ISpellChestDrop[] => {
    // No drops from monsters level 1-4
    if (monsterLevel < 5) return [];

    const baseChance = SPELL_CHEST_BASE_CHANCE[monsterRarity] ?? SPELL_CHEST_BASE_CHANCE.normal;
    let multiplier = 1.0;
    if (isDungeon) multiplier *= 1.5;
    if (isBoss) multiplier *= 2.0;

    const heroicEligible = hasMaxMastery && monsterRarity === 'boss';
    const heroicChance = heroicEligible ? SPELL_CHEST_HEROIC_BASE_CHANCE * multiplier : 0;

    const drops: ISpellChestDrop[] = [];

    for (const chestLevel of SPELL_CHEST_LEVELS) {
        if (chestLevel > monsterLevel) break; // Only drop chests for levels up to monster's level
        const chance = baseChance * multiplier;
        if (Math.random() < chance) {
            drops.push({ chestLevel, count: 1 });
        }
        // Heroic bonus roll: independent extra chest of the same level when the
        // player has fully mastered this monster.
        if (heroicChance > 0 && Math.random() < heroicChance) {
            drops.push({ chestLevel, count: 1 });
        }
    }

    return drops;
};

export interface ISpellChestRateBreakdown {
    /** 'normal' | 'strong' | 'epic' | 'legendary' | 'boss' | 'heroic' */
    tier: TSpellChestRarityTier;
    /** Base chance (0–1) per eligible chest level. */
    chance: number;
}

/**
 * Get spell chest drop info for display in monster list / drop table.
 * Returns the eligible chest levels and a breakdown of per-rarity chances.
 * The heroic tier is included only when `hasMaxMastery` is true (so the UI
 * can hide it for players who haven't fully mastered the monster yet).
 */
export const getSpellChestDropInfo = (
    monsterLevel: number,
    hasMaxMastery: boolean = false,
): { levels: number[]; baseChance: number; rates: ISpellChestRateBreakdown[] } => {
    if (monsterLevel < 5) return { levels: [], baseChance: 0, rates: [] };
    const levels = SPELL_CHEST_LEVELS.filter((lvl) => lvl <= monsterLevel);
    const rates: ISpellChestRateBreakdown[] = [
        { tier: 'normal',    chance: SPELL_CHEST_BASE_CHANCE.normal },
        { tier: 'strong',    chance: SPELL_CHEST_BASE_CHANCE.strong },
        { tier: 'epic',      chance: SPELL_CHEST_BASE_CHANCE.epic },
        { tier: 'legendary', chance: SPELL_CHEST_BASE_CHANCE.legendary },
        { tier: 'boss',      chance: SPELL_CHEST_BASE_CHANCE.boss },
    ];
    if (hasMaxMastery) {
        rates.push({ tier: 'heroic', chance: SPELL_CHEST_HEROIC_BASE_CHANCE });
    }
    return { levels, baseChance: SPELL_CHEST_BASE_CHANCE.normal, rates };
};

/**
 * Get spell chest key for inventory storage.
 * Format: spell_chest_5, spell_chest_10, etc.
 */
export const getSpellChestKey = (level: number): string => `spell_chest_${level}`;

/**
 * Get the display name for a spell chest.
 */
export const getSpellChestDisplayName = (level: number): string => `Spell Chest (Lvl ${level})`;

/**
 * 2026-05: returns the PNG art for a spell chest at the given level
 * (`/assets/images/spell-chest/spell-chest-{N}.png`, N = 1..15) or the
 * legacy emoji as a last-resort fallback. Consumers rendering inline
 * should branch on `isImageUrl()` (or use `<TinyIcon>`). Plain-text
 * contexts (combat log, drop name strings) should call
 * `getSpellChestEmoji()` instead — that one always returns a glyph.
 */
export const getSpellChestIcon = (level: number): string => {
    const url = getSpellChestImage(level);
    if (url) return url;
    return level >= 100 ? '🎁' : '📦';
};

/** Plain-text-safe fallback for combat-log lines / drop-name strings
 *  that get joined and rendered as text (no <img> support). Always
 *  returns the legacy emoji glyph. */
export const getSpellChestEmoji = (level: number): string =>
    level >= 100 ? '🎁' : '📦';
