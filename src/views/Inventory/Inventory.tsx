import { memo, useRef, useState, useMemo, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useInventoryStore, MAX_DEPOSIT_SIZE } from '../../stores/inventoryStore';
import { useCharacterStore } from '../../stores/characterStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useBuffStore } from '../../stores/buffStore';
import {
  EQUIPMENT_SLOTS,
  SLOT_LABELS,
  RARITY_COLORS,
  RARITY_LABELS,
  getItemStats,
  getSellPrice,
  getEnhancementCost,
  canEquip,
  canClassEquip,
  findBaseItem,
  flattenItemsData,
  formatItemName,
  getEquipTargetSlot,
  getGeneratedItemInfo,
  getItemType,
  STONE_NAMES,
  STONE_ICONS,
  RARITY_ORDER,
  STONE_FOR_RARITY,
  STONE_CONVERSION_CHAIN,
  STONE_CONVERSION_COST,
  STONE_CONVERSION_GOLD,
  getEnhancementMultiplier,
  getUpgradedBaseStat,
  isBaseStatKey,
  getTotalEquipmentStats,
  getItemIcon,
  getClassSkillBonus,
  type IInventoryItem,
  getBaseStatKeysForSlot,
  RARITY_BONUS_SLOTS,
  type EquipmentSlot,
  getEnhancementRefund,
  getItemSlotSafe,
} from '../../systems/itemSystem';
import { useSkillStore } from '../../stores/skillStore';
import { useOfflineHuntStore } from '../../stores/offlineHuntStore';
import {
  getTrainingBonuses,
  skillXpToNextLevel,
  getSkillUpgradeBonus,
  getSpellChestUnlockCost,
  getSpellChestUpgradeCost,
  getTrainableStatsForClass,
  GENERAL_TRAINABLE_STATS,
  SKILL_NAMES_PL,
  offlineXpRateForStat,
} from '../../systems/skillSystem';
import { getElixirHpBonus, getElixirMpBonus } from '../../systems/combatElixirs';
import { getLiveTransformBreakdown } from '../../systems/transformBonuses';
import { getSkillIcon } from '../../data/skillIcons';
import { isUpgradeMilestone } from '../../systems/systemChatMessages';
import skillsRaw from '../../data/skills.json';
import { getItemFile, getStoneImage, getSpellChestImage, getPotionImage, getElixirImage } from '../../systems/spriteAssets';
import { getEffectiveChar as engineGetEffectiveChar } from '../../systems/combatEngine';
import { useCombatStore } from '../../stores/combatStore';
import { statPointsForLevelUp, BASE_HP_PER_LEVEL, BASE_MP_PER_LEVEL } from '../../systems/levelSystem';
// TCharacterClass used for class-based filtering
import type { Rarity } from '../../systems/lootSystem';
import { getSpellChestIcon, getSpellChestDisplayName } from '../../systems/lootSystem';
import itemsRaw from '../../data/items.json';
import { getItemDisplayInfo, rerollItemBonuses } from '../../systems/itemGenerator';
import { ELIXIRS } from '../../stores/shopStore';
import { POTION_CONVERSIONS, checkConversionAvailability } from '../../systems/potionConversion';
import {
  FLAT_HP_POTIONS,
  FLAT_MP_POTIONS,
  PCT_HP_POTIONS,
  PCT_MP_POTIONS,
} from '../../systems/potionSystem';
import ItemIcon from '../../components/ui/ItemIcon/ItemIcon';
import TinyIcon from '../../components/ui/TinyIcon/TinyIcon';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import EmojiText from '../../components/atoms/Twemoji/EmojiText';
import Icon from '../../components/atoms/Icon/Icon';
import { getCharacterAvatar } from '../../data/classAvatars';
import { useTransformStore } from '../../stores/transformStore';
import { formatGoldShort } from '../../systems/goldFormat';
import './Inventory.scss';

const ALL_ITEMS = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);

// -- Stat display names (Polish) ----------------------------------------------
const STAT_DISPLAY_NAMES: Record<string, string> = {
  hp: 'HP',
  mp: 'MP',
  attack: 'Atak',
  defense: 'Obrona',
  speed: 'Szybkosc',
  critChance: 'Szansa Crit',
  critDmg: 'Obrazenia Crit',
  dmg_min: 'DMG Min',
  dmg_max: 'DMG Max',
};

// -- Upgrade indicator logic ------------------------------------------------

type UpgradeIndicator = 'upgrade' | 'equal' | 'maybe' | null;

/**
 * Returns the slot an inventory item belongs to (checking both base items and generated items).
 * Local helper that accepts an IInventoryItem directly (vs. the exported `getItemSlotSafe`
 * from itemSystem which takes an itemId + items list).
 */
const getInventoryItemSlot = (item: IInventoryItem): EquipmentSlot | null => {
  const base = findBaseItem(item.itemId, ALL_ITEMS);
  if (base) return base.slot;
  const genInfo = getGeneratedItemInfo(item.itemId);
  if (genInfo) return genInfo.slot;
  return null;
};

/**
 * Determines the upgrade indicator badge for a backpack item.
 * - 'upgrade': item is better (higher level or rarity) than equipped, or slot is empty
 * - 'equal': same level and rarity as equipped
 * - 'maybe': equippable by class but not clearly better
 * - null: not equippable by this class (no indicator shown)
 */
const getUpgradeIndicator = (
  item: IInventoryItem,
  characterClass: string,
  equipment: Record<EquipmentSlot, IInventoryItem | null>,
): UpgradeIndicator => {
  const itemSlot = getInventoryItemSlot(item);
  if (!itemSlot) return null;

  // Check if the character class can equip this item
  if (!canClassEquip(item.itemId, itemSlot, characterClass, ALL_ITEMS)) return null;

  // For ring items, compare against both ring slots and pick the best comparison
  const slotsToCompare: EquipmentSlot[] =
    (itemSlot === 'ring1' || itemSlot === 'ring2') ? ['ring1', 'ring2'] : [itemSlot];

  // For Rogue daggers, also compare against offHand
  if (characterClass === 'Rogue') {
    const iType = getItemType(item.itemId, ALL_ITEMS);
    if (iType === 'dagger' && itemSlot === 'mainHand' && !slotsToCompare.includes('offHand')) {
      slotsToCompare.push('offHand');
    }
  }

  // Check if any of the comparable slots is empty
  const hasEmptySlot = slotsToCompare.some((s) => !equipment[s]);
  if (hasEmptySlot) return 'upgrade';

  // Score an item by summing weighted stat values, so comparisons reflect
  // actual power rather than just itemLevel/rarity tier.
  const scoreItem = (it: IInventoryItem): number => {
    const s = getItemStatValues(it);
    return (
      s.attack * 2 +
      s.defense * 2 +
      s.dmgMin * 1.5 +
      s.dmgMax * 1.5 +
      s.hp * 0.25 +
      s.mp * 0.25 +
      s.speed * 10 +
      s.critChance * 3 +
      s.critDmg * 1
    );
  };

  const itemScore = scoreItem(item);
  let bestResult: UpgradeIndicator = 'maybe';

  for (const slot of slotsToCompare) {
    const equipped = equipment[slot];
    if (!equipped) continue;

    const equippedScore = scoreItem(equipped);

    if (itemScore > equippedScore + 0.01) {
      return 'upgrade';
    }
    if (Math.abs(itemScore - equippedScore) <= 0.01) {
      bestResult = 'equal';
    }
    // If itemScore < equippedScore in this slot, keep looking (ring1 vs ring2).
  }

  return bestResult;
};

type RarityFilter = Rarity | 'all';

const CLASS_AVATAR_COLORS: Record<string, string> = {
  Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
  Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

const hexToRgbAvatar = (hex: string): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
};

const RARITY_FILTERS: RarityFilter[] = ['all', 'common', 'rare', 'epic', 'legendary', 'mythic', 'heroic'];
const RARITY_SELECT_FILTERS: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic', 'heroic'];

// -- Slot filter ------------------------------------------------------------
// "all" = no slot filter, otherwise filter by specific equipment slot.
// Spec 4: extra filter targets for stackable items in the bag.
type TSlotFilter =
    | 'all'
    | 'weapons' | 'armor' | 'jewelry'
    | 'potions' | 'chests' | 'stones'
    | EquipmentSlot;

interface ISlotFilterDef { id: TSlotFilter; label: string; icon: string }

// Spec 3: slot-filter row uses the in-app PNG icons (light variants are the
// most universal-looking) instead of the legacy emoji ladder. The "icon"
// field accepts either a URL (rendered as <img>) or an emoji glyph
// (rendered as text) — see the JSX below for the branch.
const ICON_HELMET   = getItemFile('helmet-lekki') ?? 'rescue-worker-s-helmet';
const ICON_ARMOR    = getItemFile('armor-lekki') ?? 'safety-vest';
const ICON_PANTS    = getItemFile('legs-lekki') ?? 'jeans';
const ICON_BOOTS    = getItemFile('boots-lekki') ?? 'woman-s-boot';
const ICON_GLOVES   = getItemFile('glove-lekki') ?? 'gloves';
const ICON_SHOULDER = getItemFile('shoulder-lekki') ?? 'military-medal';
const ICON_SWORD    = getItemFile('miecz') ?? 'crossed-swords';
const ICON_SHIELD   = getItemFile('tarcza') ?? 'shield';
const ICON_RING     = getItemFile('ring') ?? 'ring';
const ICON_NECK     = getItemFile('nackle') ?? 'prayer-beads';
const ICON_EARRINGS = getItemFile('earrings') ?? 'sparkles';

// 2026-05-08: per spec ("Sortowanie po zbroi nie dziala, filtruje tez
// helmy itp") the broad `armor` group filter that bundled helmet +
// chest + pants + gloves + shoulders + boots is GONE — it shadowed
// the per-slot Napierśnik filter via dedup so "Zbroja" was actually
// "any armor piece". Now `id: 'armor'` is exclusively the chest-slot
// filter labelled "Zbroja". The remaining slot pills (Hełm, Spodnie,
// Buty, etc.) handle the other armor types one-for-one.
const SLOT_FILTERS: ISlotFilterDef[] = [
    { id: 'all',        label: 'Wszystkie',    icon: 'backpack' },
    { id: 'weapons',    label: 'Bronie',       icon: ICON_SWORD },
    { id: 'jewelry',    label: 'Biżuteria',    icon: ICON_NECK },
    { id: 'mainHand',   label: 'Główna',       icon: ICON_SWORD },
    { id: 'offHand',    label: 'Pomocnicza',   icon: ICON_SHIELD },
    { id: 'helmet',     label: 'Hełm',         icon: ICON_HELMET },
    { id: 'shoulders',  label: 'Naramienniki', icon: ICON_SHOULDER },
    { id: 'armor',      label: 'Zbroja',       icon: ICON_ARMOR },
    { id: 'gloves',     label: 'Rękawice',     icon: ICON_GLOVES },
    { id: 'pants',      label: 'Spodnie',      icon: ICON_PANTS },
    { id: 'boots',      label: 'Buty',         icon: ICON_BOOTS },
    { id: 'necklace',   label: 'Naszyjnik',    icon: ICON_NECK },
    { id: 'earrings',   label: 'Kolczyki',     icon: ICON_EARRINGS },
    { id: 'ring1',      label: 'Pierścienie',  icon: ICON_RING },
    // Spec 4: stackable filters for items now living in the bag grid.
    // 2026-05: icons swapped from emoji glyphs to the player's PNG art so
    // these three pills match the gear-filter pills next to them. Generic
    // tier picks (universal +50 HP potion / level-15 chest / generic
    // stone-7) keep them representative without committing to a specific
    // sub-tier when the filter spans many items.
    { id: 'potions',    label: 'Potiony',      icon: getPotionImage(null) ?? 'test-tube' },
    { id: 'chests',     label: 'Spell Chesty', icon: getSpellChestImage(1000) ?? 'package' },
    { id: 'stones',     label: 'Kamienie',     icon: getStoneImage(null) ?? 'gem-stone' },
];

// De-duplicated by id to avoid duplicate keys (the "armor" id overlaps between
// the coarse "armor" group and the specific chest-slot entry). The group
// wins because it comes first.
const SLOT_FILTER_BUTTONS: ISlotFilterDef[] = (() => {
    const seen = new Set<string>();
    return SLOT_FILTERS.filter((f) => {
        if (seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
    });
})();

// Postać-spec item 14 + later revision: 50 items per page (was 100, was 500).
// Tighter pages = shorter scroll on mobile + faster filtered re-renders for
// players carrying near-1000 items.
const PAGE_SIZE = 50;

// -- Helpers ------------------------------------------------------------------

const getItemDisplayName = (item: IInventoryItem): string => {
  const base = findBaseItem(item.itemId, ALL_ITEMS);
  if (base) return base.name_pl;
  const genInfo = getItemDisplayInfo(item.itemId);
  if (genInfo) return genInfo.name_pl;
  return formatItemName(item.itemId);
};

const slotEmoji = (itemId: string, slot?: string): string => {
  // 1) Generated items (gen_xxx) – use display info from itemGenerator
  const genInfo = getItemDisplayInfo(itemId);
  if (genInfo) return genInfo.icon;
  // 2) Base items from items.json
  const base = findBaseItem(itemId, ALL_ITEMS);
  if (base) return getItemIcon(itemId, base.slot, ALL_ITEMS);
  // 3) Name-based resolution (starter weapons, etc.)
  return getItemIcon(itemId, slot ?? 'mainHand', ALL_ITEMS);
};

const getItemSellPrice = (item: IInventoryItem): number => {
  const base = findBaseItem(item.itemId, ALL_ITEMS);
  return getSellPrice(item, base);
};

interface IStatValues {
  attack: number;
  defense: number;
  hp: number;
  mp: number;
  speed: number;
  critChance: number;
  critDmg: number;
  dmgMin: number;
  dmgMax: number;
}

const EMPTY_STATS: IStatValues = { attack: 0, defense: 0, hp: 0, mp: 0, speed: 0, critChance: 0, critDmg: 0, dmgMin: 0, dmgMax: 0 };

const getItemStatValues = (item: IInventoryItem): IStatValues => {
  const base = findBaseItem(item.itemId, ALL_ITEMS);
  const upgradeLevel = item.upgradeLevel ?? 0;
  if (base) {
    // Legacy item: getItemStats already applies the upgrade to base stats only.
    const s = getItemStats(item, base);
    const result = s ? { ...EMPTY_STATS, ...s } : { ...EMPTY_STATS };
    // Starter weapons store dmg_min/dmg_max in bonuses — treat these as the base stat.
    if (item.bonuses['dmg_min'] !== undefined) {
      result.dmgMin = getUpgradedBaseStat(item.bonuses['dmg_min'] ?? 0, upgradeLevel);
    }
    if (item.bonuses['dmg_max'] !== undefined) {
      result.dmgMax = getUpgradedBaseStat(item.bonuses['dmg_max'] ?? 0, upgradeLevel);
    }
    return result;
  }
  const genInfo = getGeneratedItemInfo(item.itemId);
  if (genInfo) {
    const s = { ...EMPTY_STATS };
    const slot = genInfo.slot;
    for (const [key, val] of Object.entries(item.bonuses)) {
      const isBase = isBaseStatKey(slot, key);
      const scaled = isBase ? getUpgradedBaseStat(val, upgradeLevel) : val;
      if (key === 'dmg_min') {
        s.dmgMin = scaled;
      } else if (key === 'dmg_max') {
        s.dmgMax = scaled;
      } else if (key in s) {
        (s as Record<string, number>)[key] += scaled;
      }
    }
    return s;
  }
  return { ...EMPTY_STATS };
};

/** Returns the effective damage range for a weapon item, or null if not a weapon. */
const getWeaponDmgRange = (item: IInventoryItem): { min: number; max: number } | null => {
  const upgradeLevel = item.upgradeLevel ?? 0;
  const rawMin = item.bonuses['dmg_min'];
  const rawMax = item.bonuses['dmg_max'];
  if (rawMin === undefined || rawMax === undefined) return null;
  return {
    min: getUpgradedBaseStat(rawMin, upgradeLevel),
    max: getUpgradedBaseStat(rawMax, upgradeLevel),
  };
};

// -- Memoized bag tile --------------------------------------------------------
// Point 3: Each bag tile does non-trivial work (icon lookup, dmg range calc,
// upgrade indicator). With 3500 items, re-running that on every parent render
// (e.g. opening the DetailPanel) made the slide-up animation stutter. Wrapping
// in `memo` + stable prop identity keeps the grid still during panel opens.
interface IBagTileProps {
  item: IInventoryItem;
  isChecked: boolean;
  multiSellMode: boolean;
  indicator: UpgradeIndicator;
  onSelect: (item: IInventoryItem) => void;
}

const BagTile = memo(({ item, isChecked, multiSellMode, indicator, onSelect }: IBagTileProps) => {
  const color = RARITY_COLORS[item.rarity];
  const dmg = getWeaponDmgRange(item);
  const displayName = getItemDisplayName(item);
  const sellPrice = getItemSellPrice(item);
  const icon = slotEmoji(item.itemId);

  return (
    <div
      className={`inventory__bag-tile${isChecked ? ' inventory__bag-tile--selected' : ''}`}
    >
      {multiSellMode && (
        <span className={`inventory__bag-check${isChecked ? ' inventory__bag-check--on' : ''}`}>
          {isChecked ? <GameIcon name="check-mark-button" /> : ''}
        </span>
      )}
      {indicator && (
        <span className={`inventory__upgrade-badge inventory__upgrade-badge--${indicator}`}>
          {indicator === 'upgrade' ? '\u2191' : indicator === 'equal' ? '=' : '?'}
        </span>
      )}
      <ItemIcon
        icon={icon}
        rarity={item.rarity}
        upgradeLevel={item.upgradeLevel}
        itemLevel={item.itemLevel || 1}
        size="md"
        onClick={() => onSelect(item)}
        tooltip={`${displayName} Lvl${item.itemLevel || 1} - ${sellPrice}g`}
      />
      {dmg && (
        <span className="inventory__bag-tile-dmg">{dmg.min}–{dmg.max}</span>
      )}
      <span className="inventory__bag-tile-name" style={{ color }}>{displayName}</span>
      <span className="inventory__bag-tile-level">Lv {item.itemLevel || 1}</span>
    </div>
  );
});
BagTile.displayName = 'BagTile';

const STAT_LABELS: Record<keyof IStatValues, string> = {
  attack: 'Atak',
  defense: 'Obrona',
  hp: 'HP',
  mp: 'MP',
  speed: 'Szybkosc',
  critChance: 'Kryty %',
  critDmg: 'Kryty DMG',
  dmgMin: 'Atak min',
  dmgMax: 'Atak max',
};

/** For each equipment slot, which stat is considered the "base" stat (shown in header, hidden from the extras grid). */
const BASE_STAT_BY_SLOT: Partial<Record<EquipmentSlot, keyof IStatValues>> = {
  mainHand: 'attack',
  offHand: 'attack',
  helmet: 'hp',
  armor: 'hp',
  pants: 'hp',
  shoulders: 'hp',
  boots: 'hp',
  gloves: 'attack',
  ring1: 'attack',
  ring2: 'attack',
  necklace: 'defense',
  earrings: 'defense',
};

const BASE_STAT_META: Record<keyof IStatValues, { icon: string; label: string; color: string }> = {
  attack:     { icon: 'crossed-swords', label: 'ATK',  color: '#ffc107' },
  defense:    { icon: 'shield', label: 'DEF',  color: '#64b5f6' },
  hp:         { icon: 'red-heart', label: 'HP',   color: '#e57373' },
  mp:         { icon: 'droplet', label: 'MP',   color: '#64b5f6' },
  speed:      { icon: 'person-running', label: 'SPD',  color: '#81c784' },
  critChance: { icon: 'bullseye', label: 'CRIT', color: '#ffb74d' },
  critDmg:    { icon: 'collision', label: 'CDMG', color: '#ff8a65' },
  dmgMin:     { icon: 'crossed-swords', label: 'DMG',  color: '#ffc107' },
  dmgMax:     { icon: 'crossed-swords', label: 'DMG',  color: '#ffc107' },
};

// Base stats per class (for stat reset calculation)
const CLASS_BASE_STATS: Record<string, { attack: number; defense: number; max_hp: number; max_mp: number }> = {
  Knight:      { attack: 10, defense: 5,  max_hp: 120, max_mp: 30 },
  Mage:        { attack: 6,  defense: 2,  max_hp: 80,  max_mp: 200 },
  Cleric:      { attack: 7,  defense: 4,  max_hp: 100, max_mp: 150 },
  Archer:      { attack: 10, defense: 3,  max_hp: 100, max_mp: 80 },
  Rogue:       { attack: 9,  defense: 3,  max_hp: 90,  max_mp: 60 },
  Necromancer: { attack: 6,  defense: 2,  max_hp: 85,  max_mp: 180 },
  Bard:        { attack: 8,  defense: 3,  max_hp: 95,  max_mp: 120 },
};

const handleStatReset = () => {
  const char = useCharacterStore.getState().character;
  if (!char) return;

  const base = CLASS_BASE_STATS[char.class];
  if (!base) return;

  const hpPerLevel = BASE_HP_PER_LEVEL[char.class] ?? 4;
  const mpPerLevel = BASE_MP_PER_LEVEL[char.class] ?? 3;

  // Calculate total stat points ever earned (levels 1 -> highest_level)
  const highestLevel = char.highest_level ?? char.level;
  const levelsGained = Math.max(0, highestLevel - 1);
  const pointsPerLevel = statPointsForLevelUp(char.class);
  const totalEarned = levelsGained * pointsPerLevel;

  // Calculate base stats at current level (base + level-up HP/MP gains)
  const levelHpGain = levelsGained * hpPerLevel;
  const levelMpGain = levelsGained * mpPerLevel;
  const resetMaxHp = base.max_hp + levelHpGain;
  const resetMaxMp = base.max_mp + levelMpGain;

  useCharacterStore.getState().updateCharacter({
    attack: base.attack,
    defense: base.defense,
    max_hp: resetMaxHp,
    max_mp: resetMaxMp,
    hp: Math.min(char.hp, resetMaxHp),
    mp: Math.min(char.mp, resetMaxMp),
    stat_points: totalEarned,
  });

  useInventoryStore.getState().useConsumable('stat_reset');
};

// -- Detail panel ------------------------------------------------------------
interface IDetailPanelProps {
  item: IInventoryItem;
  isEquipped: boolean;
  equippedSlot: EquipmentSlot | null;
  onClose: () => void;
  onDisassembleStateChange?: (active: boolean) => void;
}

const RARITY_STONE_MAP: Record<string, string> = {
  common: 'common_stone',
  rare: 'rare_stone',
  epic: 'epic_stone',
  legendary: 'legendary_stone',
  mythic: 'mythic_stone',
  heroic: 'heroic_stone',
};

const DetailPanel = ({ item, isEquipped, equippedSlot, onClose, onDisassembleStateChange }: IDetailPanelProps) => {
  const { equipItem, unequipItem, sellItem, removeItem, upgradeItem, updateItemBonuses, gold, spendGold, useStones, addStones, depositItem } = useInventoryStore();
  const stones = useInventoryStore((s) => s.stones);
  const depositLength = useInventoryStore((s) => s.deposit.length);
  const character = useCharacterStore((s) => s.character);
  const [enhanceResult, setEnhanceResult] = useState<'success' | 'fail' | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [disassembleResult, setDisassembleResult] = useState<'success' | 'fail' | null>(null);
  const [disassembling, setDisassembling] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);
  // 2026-05 v2 spec: per-action "skip animation" toggles. When checked,
  // Ulepsz / Zmiana Bonusu resolve INSTANTLY instead of running the
  // 1.8s / 2s progress-bar animation. Saved per-DetailPanel-instance
  // (resets when the popup closes — fine for now).
  const [skipEnhanceAnim, setSkipEnhanceAnim] = useState(false);
  const [skipRerollAnim, setSkipRerollAnim] = useState(false);
  // Spec 15: feedback toast for the "Do depozytu" button — shows brief
  // success ("Wpłacono!") or failure ("Depozyt pełny") message after click.
  const [depositToast, setDepositToast] = useState<'ok' | 'full' | null>(null);

  // -- Bonus Reroll state ------------------------------------------------------
  const [rerollPhase, setRerollPhase] = useState<'idle' | 'rolling' | 'preview'>('idle');
  const [rerolledBonuses, setRerolledBonuses] = useState<Record<string, number> | null>(null);

  const base = findBaseItem(item.itemId, ALL_ITEMS);
  const genInfo = !base ? getGeneratedItemInfo(item.itemId) : null;
  const itemSlot = base?.slot ?? genInfo?.slot ?? null;
  const isWeapon = itemSlot === 'mainHand' || itemSlot === 'offHand';
  const weaponDmg = isWeapon ? getWeaponDmgRange(item) : null;
  const stats = base ? getItemStats(item, base) : null;
  // For generated items, build stats from bonuses
  const genStats = !base && genInfo ? (() => {
    const upgradeLevel = item.upgradeLevel ?? 0;
    const upgradeMult = getEnhancementMultiplier(upgradeLevel);
    const s = { attack: 0, defense: 0, hp: 0, mp: 0, speed: 0, critChance: 0, critDmg: 0, dmgMin: 0, dmgMax: 0 };
    for (const [key, val] of Object.entries(item.bonuses)) {
      if (key === 'dmg_min') {
        s.dmgMin = Math.floor(val * upgradeMult);
      } else if (key === 'dmg_max') {
        s.dmgMax = Math.floor(val * upgradeMult);
      } else if (key in s) {
        (s as Record<string, number>)[key] += Math.floor(val * upgradeMult);
      }
    }
    return s;
  })() : null;
  const displayStats = stats ?? genStats;
  const sellPrice = getItemSellPrice(item);
  const canEq = !!character && canEquip(item, character.level, ALL_ITEMS, character.class);
  const classBlocked = !!character && !!itemSlot && !canClassEquip(item.itemId, itemSlot, character.class, ALL_ITEMS);
  const color = RARITY_COLORS[item.rarity];

  const equipment = useInventoryStore.getState().equipment;

  // Check if item needs slot selection (rings or Rogue daggers)
  const needsSlotChoice = (() => {
    if (!itemSlot || !character) return false;
    if (itemSlot === 'ring1' || itemSlot === 'ring2') return true;
    if (character.class === 'Rogue') {
      const iType = getItemType(item.itemId, ALL_ITEMS);
      if (iType === 'dagger') return true;
    }
    return false;
  })();

  const isRingSlot = itemSlot === 'ring1' || itemSlot === 'ring2';

  const handleEquip = () => {
    if (!character || !itemSlot) return;
    const targetSlot = getEquipTargetSlot(itemSlot, item.itemId, character.class, equipment, ALL_ITEMS);
    equipItem(item.uuid, targetSlot);
    onClose();
  };

  const handleEquipToSlot = (slot: EquipmentSlot) => {
    if (!character) return;
    equipItem(item.uuid, slot);
    onClose();
  };

  const handleUnequip = () => {
    if (!equippedSlot) return;
    unequipItem(equippedSlot);
    onClose();
  };

  const enhanceRefund = getEnhancementRefund(item.upgradeLevel ?? 0, item.rarity);

  const handleSell = () => {
    if (actionInProgress) return;
    setActionInProgress(true);
    sellItem(item.uuid, sellPrice);
    // Return stones from enhancement refund
    if (enhanceRefund.stones > 0 && enhanceRefund.stoneType) {
      addStones(enhanceRefund.stoneType, enhanceRefund.stones);
    }
    onClose();
  };

  // Spec 15: send the item straight to the deposit (warehouse) without
  // having to walk to /deposit. Closes the panel on success; flashes a
  // "Depozyt pełny" toast for ~1.4s if it failed (deposit is at MAX_DEPOSIT_SIZE).
  const handleDeposit = () => {
    if (actionInProgress) return;
    setActionInProgress(true);
    const ok = depositItem(item.uuid);
    if (ok) {
      setDepositToast('ok');
      setTimeout(onClose, 250);
    } else {
      setDepositToast('full');
      setActionInProgress(false);
      setTimeout(() => setDepositToast(null), 1400);
    }
  };

  const disassembleStoneType = RARITY_STONE_MAP[item.rarity] ?? 'common_stone';
  const disassembleStoneName = STONE_NAMES[disassembleStoneType] ?? disassembleStoneType;

  const handleDisassemble = () => {
    if (actionInProgress || disassembling) return;
    setActionInProgress(true);
    setDisassembling(true);
    setDisassembleResult(null);
    onDisassembleStateChange?.(true);

    // After progress bar animation (1.5s), determine result
    setTimeout(() => {
      const gotStone = Math.random() < 0.20;
      removeItem(item.uuid);
      if (gotStone) {
        addStones(disassembleStoneType, 1);
        setDisassembleResult('success');
      } else {
        setDisassembleResult('fail');
      }
      setDisassembling(false);

      // Close panel after 2.5s showing the result
      setTimeout(() => {
        setDisassembleResult(null);
        onDisassembleStateChange?.(false);
        onClose();
      }, 2500);
    }, 1500);
  };

  // -- Bonus Reroll logic ----------------------------------------------------
  const rerollStoneType = RARITY_STONE_MAP[item.rarity] ?? 'common_stone';
  const rerollStoneName = STONE_NAMES[rerollStoneType] ?? rerollStoneType;
  const rerollStoneCount = stones[rerollStoneType] ?? 0;
  const REROLL_STONE_COST = 2;
  const canReroll = item.rarity !== 'common'
    && RARITY_BONUS_SLOTS[item.rarity] > 0
    && rerollStoneCount >= REROLL_STONE_COST
    && rerollPhase === 'idle';

  // Determine slot for this item
  const rerollSlot: EquipmentSlot | null = (() => {
    if (equippedSlot) return equippedSlot;
    const base = findBaseItem(item.itemId, ALL_ITEMS);
    if (base?.slot) return base.slot as EquipmentSlot;
    const gen = getItemDisplayInfo(item.itemId);
    return gen?.slot ?? null;
  })();

  const baseKeys = rerollSlot ? getBaseStatKeysForSlot(rerollSlot) : [];

  // Get only the random bonus keys (not base stats)
  const getRandomBonusKeys = (bonuses: Record<string, number>) =>
    Object.keys(bonuses).filter((k) => !baseKeys.includes(k));

  const handleStartReroll = () => {
    if (!rerollSlot) return;
    const currentStones = useInventoryStore.getState().stones[rerollStoneType] ?? 0;
    if (currentStones < REROLL_STONE_COST) return;
    if (!useStones(rerollStoneType, REROLL_STONE_COST)) return;
    const finishReroll = () => {
      const newBonuses = rerollItemBonuses(item, rerollSlot);
      setRerolledBonuses(newBonuses);
      setRerollPhase('preview');
    };
    // Spec 3 (2026-05 v2): skip the 2s rolling animation when the
    // checkbox is on and jump straight to the preview phase.
    if (skipRerollAnim) {
      setRerollPhase('preview');
      finishReroll();
    } else {
      setRerollPhase('rolling');
      setTimeout(finishReroll, 2000);
    }
  };

  const handleAcceptReroll = () => {
    if (!rerolledBonuses) return;
    updateItemBonuses(item.uuid, rerolledBonuses);
    setRerollPhase('idle');
    setRerolledBonuses(null);
  };

  const handleRejectReroll = () => {
    setRerollPhase('idle');
    setRerolledBonuses(null);
  };

  // Spec 12: pick the currently-equipped item to compare the clicked item
  // against. For rings + Rogue dual-wield daggers we pick the FIRST relevant
  // slot's occupant (ring1 / mainHand) as a sensible default; the player can
  // see at-a-glance what they'd be swapping out.
  const compareSlot: EquipmentSlot | null = (() => {
    if (!itemSlot || isEquipped) return null;
    if (itemSlot === 'ring1' || itemSlot === 'ring2') {
      return equipment.ring1 ? 'ring1' : (equipment.ring2 ? 'ring2' : 'ring1');
    }
    return itemSlot;
  })();
  const equippedToCompare = compareSlot ? equipment[compareSlot] : null;

  return (
    <motion.div
      className="inventory__overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => { if (!disassembling && !disassembleResult) onClose(); }}
    >
      <motion.div
        className={`inventory__detail${equippedToCompare ? ' inventory__detail--comparing' : ''}`}
        style={{ '--rarity-color': color } as React.CSSProperties}
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ type: 'tween', duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="inventory__detail-close"
          onClick={() => { if (!disassembling && !disassembleResult) onClose(); }}
        ><Icon name="x" /></button>

        {/* Spec 12: when an equipped item exists for the same slot, the panel
            splits into two columns — NEW (left, the clicked item) vs
            EQUIPPED (right). Body markup below stays in the LEFT column. */}
        <div className="inventory__detail-cols">
          <div className="inventory__detail-col inventory__detail-col--new">
            {equippedToCompare && <div className="inventory__detail-col-tag">Nowy</div>}

        <div className="inventory__detail-icon-row">
          <ItemIcon
            icon={slotEmoji(item.itemId)}
            rarity={item.rarity}
            upgradeLevel={item.upgradeLevel}
            size="lg"
            showTooltip={false}
          />
          <div className="inventory__detail-name-block">
            <h2 className="inventory__detail-name" style={{ color }}>
              {getItemDisplayName(item)}
            </h2>
            {(() => {
              // Show base stat next to item name based on slot
              if (weaponDmg) {
                return (
                  <span className="inventory__detail-dmg-range" style={{ color: '#ffc107' }}>
                    <GameIcon name="crossed-swords" /> Atak: {weaponDmg.min}–{weaponDmg.max}
                  </span>
                );
              }
              if (!displayStats || !itemSlot) return null;
              const baseKey = BASE_STAT_BY_SLOT[itemSlot];
              if (!baseKey) return null;
              const baseVal = (displayStats as Partial<IStatValues>)[baseKey] ?? 0;
              if (!baseVal) return null;
              const meta = BASE_STAT_META[baseKey];
              return (
                <span className="inventory__detail-dmg-range" style={{ color: meta.color }}>
                  <GameIcon name={meta.icon} /> +{baseVal} {meta.label}
                </span>
              );
            })()}
          </div>
        </div>
        <div>
          <span className="inventory__detail-rarity" style={{ color }}>
            {RARITY_LABELS[item.rarity]}
          </span>
          <span className="inventory__detail-level">
            {' '}· Lvl {item.itemLevel || 1}
            {itemSlot ? <> · {SLOT_LABELS[itemSlot]}</> : <> · Materiał</>}
          </span>
          {(item.upgradeLevel ?? 0) > 0 && (
            <span className="inventory__detail-upgrade" style={{ color: '#ffc107' }}>
              {' '}+{item.upgradeLevel}
            </span>
          )}
        </div>

        {displayStats && (() => {
          // Base stat already displayed in header – filter it out here
          const baseKey = itemSlot ? BASE_STAT_BY_SLOT[itemSlot] ?? null : null;
          const isWeaponSlot = itemSlot === 'mainHand' || itemSlot === 'offHand';
          const skipKeys = new Set<keyof IStatValues>();
          if (isWeaponSlot) {
            skipKeys.add('dmgMin');
            skipKeys.add('dmgMax');
            skipKeys.add('attack');
          } else if (baseKey) {
            skipKeys.add(baseKey);
          }
          const rows: Array<{ key: keyof IStatValues; value: number; suffix?: string }> = [];
          const pushRow = (k: keyof IStatValues, suffix?: string) => {
            if (skipKeys.has(k)) return;
            const v = (displayStats as Partial<IStatValues>)[k] ?? 0;
            if (v > 0) rows.push({ key: k, value: v, suffix });
          };
          pushRow('attack');
          pushRow('defense');
          pushRow('hp');
          pushRow('mp');
          pushRow('speed');
          pushRow('critChance');
          pushRow('critDmg', '%');
          if (rows.length === 0) return null;
          return (
            <div className="inventory__detail-stats">
              {rows.map((r) => (
                <div key={r.key} className="inventory__detail-stat">
                  <span className="inventory__detail-stat-label">{STAT_LABELS[r.key]}</span>
                  <span className="inventory__detail-stat-value">+{r.value}{r.suffix ?? ''}</span>
                </div>
              ))}
            </div>
          );
        })()}

        {/* -- Item comparison with equipped item ------------------------ */}
        {!isEquipped && itemSlot && (() => {
          const resolvedSlots: EquipmentSlot[] = (() => {
            if (itemSlot === 'ring1' || itemSlot === 'ring2') return ['ring1', 'ring2'] as EquipmentSlot[];
            if (character?.class === 'Rogue') {
              const iType = getItemType(item.itemId, ALL_ITEMS);
              if (iType === 'dagger') return ['mainHand', 'offHand'] as EquipmentSlot[];
            }
            const slot = itemSlot as EquipmentSlot;
            return [slot as EquipmentSlot];
          })();

          const newStats = getItemStatValues(item);
          const comparisons = resolvedSlots.map((slot) => {
            const eqItem = equipment[slot] ?? null;
            const eqStats = eqItem ? getItemStatValues(eqItem) : EMPTY_STATS;
            return { slot, eqItem, eqStats };
          }).filter((c) => c.eqItem !== null);

          if (comparisons.length === 0) return null;

          return (
            <div className="inventory__comparison">
              <div className="inventory__comparison-title">Porownanie z ekwipunkiem</div>
              {comparisons.map(({ slot, eqItem, eqStats }) => (
                <div key={slot} className="inventory__comparison-block">
                  {comparisons.length > 1 && eqItem && (
                    <div className="inventory__comparison-slot-label">
                      vs {getItemDisplayName(eqItem)} ({SLOT_LABELS[slot]})
                    </div>
                  )}
                  {eqItem && comparisons.length <= 1 && (
                    <div className="inventory__comparison-slot-label">
                      vs {getItemDisplayName(eqItem)}
                    </div>
                  )}
                  <div className="inventory__comparison-grid">
                    {/* Spec 4 (2026-05 v2): explicit header row + raw values
                        in the Założony / Nowy columns (no +/- prefix).
                        Porównanie column keeps the sign so the change
                        direction reads at a glance. */}
                    <div className="inventory__comparison-row inventory__comparison-row--head">
                      <span className="inventory__comparison-stat-name">&nbsp;</span>
                      <span className="inventory__comparison-old">Założony</span>
                      <span className="inventory__comparison-arrow">&nbsp;</span>
                      <span className="inventory__comparison-new">Nowy</span>
                      <span className="inventory__comparison-diff">Porównanie</span>
                    </div>
                    {(Object.keys(STAT_LABELS) as (keyof IStatValues)[]).map((key) => {
                      const newVal = newStats[key];
                      const oldVal = eqStats[key];
                      const diff = newVal - oldVal;
                      if (newVal === 0 && oldVal === 0) return null;
                      return (
                        <div key={key} className="inventory__comparison-row">
                          <span className="inventory__comparison-stat-name">{STAT_LABELS[key]}</span>
                          <span className="inventory__comparison-old">{oldVal}</span>
                          <span className="inventory__comparison-arrow">&rarr;</span>
                          <span className="inventory__comparison-new">{newVal}</span>
                          <span className={`inventory__comparison-diff${diff > 0 ? ' inventory__comparison-diff--positive' : diff < 0 ? ' inventory__comparison-diff--negative' : ''}`}>
                            {diff > 0 ? `+${diff}` : diff === 0 ? '=' : `${diff}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        <div className="inventory__detail-price">
          Cena sprzedazy: <strong>{formatGoldShort(sellPrice)}</strong>
          {enhanceRefund.stones > 0 && (
            <span style={{ fontSize: '0.85em', opacity: 0.8, marginLeft: 8 }}>
              +{enhanceRefund.stones} <GameIcon name="gem-stone" />
            </span>
          )}
        </div>

        {/* Enhancement section */}
        {(base || genInfo) && (() => {
          const currentLevel = item.upgradeLevel ?? 0;
          const nextLevel = currentLevel + 1;
          const cost = getEnhancementCost(nextLevel, item.rarity);
          const ownedStones = stones[cost.stoneType] ?? 0;
          const canAffordGold = gold >= cost.gold;
          const hasEnoughStones = ownedStones >= cost.stones;
          const canEnhance = canAffordGold && hasEnoughStones && !enhancing;
          const stoneName = STONE_NAMES[cost.stoneType] ?? cost.stoneType;

          const handleEnhance = () => {
            if (!canEnhance) return;
            // 2026-05-26 bug fix (caught przez E2E inventory/upgrade test
            // flake gdzie success animation pokazywała się ale gold/stones
            // nie były odjęte): canEnhance check używa wartości z React
            // render-time, ale rapid-tap lub state race może spowodować
            // że gold/stones się zmienią między render a spend.
            // spendGold + useStones zwracają boolean — POPRZEDNIO ignorowane.
            // Teraz: jeśli któryś zwróci false -> bail bez success animation
            // + bez upgrade itemu. Zapobiega "darmowemu" upgrade'owi gdy
            // race condition zostawi dane niespójne.
            const goldOk = spendGold(cost.gold);
            if (!goldOk) return;
            const stonesOk = useStones(cost.stoneType, cost.stones);
            if (!stonesOk) {
              // Rollback gold spend — nie było stones, więc gold MUSI wrócić.
              const inv = useInventoryStore.getState();
              inv.addGold(cost.gold);
              return;
            }
            const success = Math.random() * 100 < cost.successRate;
            const finishUp = () => {
              if (success) {
                upgradeItem(item.uuid);
                setEnhanceResult('success');
                // 2026-05-19 v16 spec ("ile razy zrobilem ulepszenie
                // przedmiotu ktore sie udalo nie wazne czy na +1 czy
                // wiecej kazde wbicie na +1 to jeden punkt"): bump
                // the global item-upgrade counter for the leaderboard.
                if (character) {
                  void import('../../api/v1/characterApi').then(({ characterApi }) => {
                    void characterApi.bumpStat({
                      characterId: character.id,
                      column: 'item_upgrades_done',
                      value: 1,
                      mode: 'add',
                    });
                  }).catch(() => { /* offline */ });
                }
                // 2026-05-19 v14 spec ("Chat system brak zdjecia
                // przedmiotu oraz dodawaj odpowiednie tlo z rarity"):
                // post a STRUCTURED payload so the System tab can
                // render the item icon + rarity-coloured frame. The
                // old plain-text version leaked the raw `/src/.../luk.png`
                // path into chat. Fire-and-forget — chat outage
                // shouldn't crash the upgrade flow.
                //
                // 2026-05-20 spec ("pokazywalo jak ktos wbije +5, +7,
                // +10 i potem co jeden kazdy w nieskonczonosc"): the
                // fixed `[5,7,10,15,20,25,30]` list is replaced with
                // `isUpgradeMilestone` so every level from +10 onward
                // posts (+11, +12, …) — see the helper for the rule.
                if (character && isUpgradeMilestone(nextLevel)) {
                  const info = getItemDisplayInfo(item.itemId);
                  const itemName = info?.name_pl ?? item.itemId;
                  void Promise.all([
                    import('../../api/v1/chatApi'),
                    import('../../systems/systemChatMessages'),
                  ]).then(([{ chatApi }, { formatSystemMessage }]) => {
                    const content = formatSystemMessage({
                      type: 'upgrade',
                      itemId: item.itemId,
                      rarity: item.rarity,
                      upgradeLevel: nextLevel,
                      itemName,
                    });
                    void chatApi.postSystemEvent(
                      character.name,
                      character.class,
                      character.level,
                      content,
                    ).catch(() => { /* offline — fine */ });
                  }).catch(() => { /* offline */ });
                }
              } else {
                setEnhanceResult('fail');
              }
              setEnhancing(false);
              setTimeout(() => setEnhanceResult(null), 3000);
            };
            // Spec 2 (2026-05 v2): when "Wylacz animacje" is on, skip the
            // 1.8s progress bar and resolve the upgrade instantly.
            if (skipEnhanceAnim) {
              setEnhancing(false);
              setEnhanceResult(null);
              finishUp();
            } else {
              setEnhancing(true);
              setEnhanceResult(null);
              setTimeout(finishUp, 1800);
            }
          };

          return (
            <div className={`inventory__detail-enhance${enhanceResult === 'success' ? ' inventory__detail-enhance--success-glow' : ''}${enhanceResult === 'fail' ? ' inventory__detail-enhance--fail-shake' : ''}`}>
              <div className="inventory__detail-enhance-title">
                Ulepszenie +{currentLevel} &rarr; +{nextLevel}
              </div>
              <div className="inventory__detail-enhance-info">
                <span>Szansa: <strong>{cost.successRate}%</strong></span>
                <span>Koszt: <strong>{formatGoldShort(cost.gold)}</strong></span>
                <span>
                  <TinyIcon icon={STONE_ICONS[cost.stoneType] ?? 'gem-stone'} size="sm" /> {stoneName}: <strong style={{ color: hasEnoughStones ? '#4caf50' : '#f44336' }}>
                    {ownedStones}/{cost.stones}
                  </strong>
                </span>
                {/* Spec 2 (2026-05 v2): skip-animation toggle for impatient
                    spam-upgrade sessions. */}
                <label className="inventory__skip-anim-toggle">
                  <input
                    type="checkbox"
                    checked={skipEnhanceAnim}
                    onChange={(e) => setSkipEnhanceAnim(e.target.checked)}
                  />
                  <span>Wyłącz animację</span>
                </label>
              </div>

              {/* Progress bar during enhancement */}
              {enhancing && (
                <div className="inventory__enhance-progress">
                  <div className="inventory__enhance-progress-bar" />
                  <span className="inventory__enhance-progress-text">Ulepszanie...</span>
                </div>
              )}

              <button
                className="inventory__action-btn inventory__action-btn--enhance"
                disabled={!canEnhance || enhancing}
                onClick={handleEnhance}
              >
                {enhancing ? <><GameIcon name="hourglass-not-done" /> Ulepszanie...</> : !canAffordGold ? 'Za malo zlota' : !hasEnoughStones ? `Brak ${stoneName}` : `Ulepsz (+${nextLevel})`}
              </button>

              <AnimatePresence>
                {enhanceResult === 'success' && (
                  <motion.div
                    className="inventory__enhance-result inventory__enhance-result--success"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                  >
                    <span className="inventory__enhance-result-icon"><GameIcon name="party-popper" /></span>
                    <span>Sukces! Przedmiot ulepszony do +{(item.upgradeLevel ?? 0)}</span>
                    <span className="inventory__enhance-result-sparkles"><GameIcon name="sparkles" /><GameIcon name="sparkles" /><GameIcon name="sparkles" /></span>
                  </motion.div>
                )}
                {enhanceResult === 'fail' && (
                  <motion.div
                    className="inventory__enhance-result inventory__enhance-result--fail"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    <span className="inventory__enhance-result-icon"><GameIcon name="broken-heart" /></span>
                    <span>Niepowodzenie! Stracono {formatGoldShort(cost.gold)} i {cost.stones}x {stoneName}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })()}

        {/* Spec 1 (2026-05 v2): action buttons split into 2 rows.
            ROW 1: Zaloz / Do depozytu (or Zdejmij when equipped).
            ROW 2: Sprzedaj / Rozloz (only when not equipped). Each row
            uses a 2-col grid so the buttons stay balanced. */}
        <div className="inventory__detail-actions-block">
          <div className="inventory__detail-actions">
            {isEquipped ? (
              <button className="inventory__action-btn inventory__action-btn--unequip" onClick={handleUnequip}>
                Zdejmij
              </button>
            ) : itemSlot ? (
              needsSlotChoice && canEq ? (
                isRingSlot ? (
                  <>
                    <button className="inventory__action-btn inventory__action-btn--equip" onClick={() => handleEquipToSlot('ring1')}>
                      Zaloz (Pierscien I)
                    </button>
                    <button className="inventory__action-btn inventory__action-btn--equip" onClick={() => handleEquipToSlot('ring2')}>
                      Zaloz (Pierscien II)
                    </button>
                  </>
                ) : (
                  <>
                    <button className="inventory__action-btn inventory__action-btn--equip" onClick={() => handleEquipToSlot('mainHand')}>
                      Zaloz (Prawa reka)
                    </button>
                    <button className="inventory__action-btn inventory__action-btn--equip" onClick={() => handleEquipToSlot('offHand')}>
                      Zaloz (Lewa reka)
                    </button>
                  </>
                )
              ) : (
                <button
                  className="inventory__action-btn inventory__action-btn--equip"
                  onClick={handleEquip}
                  disabled={!canEq}
                  title={classBlocked ? `Tylko dla odpowiedniej klasy` : !canEq ? `Wymagany poziom ${item.itemLevel || 1}` : undefined}
                >
                  {classBlocked ? 'Nie dla Twojej klasy' : canEq ? 'Zaloz' : `Lvl ${base?.minLevel ?? item.itemLevel ?? '?'} wymagany`}
                </button>
              )
            ) : null}
            {!isEquipped && !disassembling && !disassembleResult && (
              <button
                className="inventory__action-btn inventory__action-btn--deposit"
                onClick={handleDeposit}
                disabled={actionInProgress}
                title={`Wpłać do depozytu (${depositLength}/${MAX_DEPOSIT_SIZE})`}
              >
                <GameIcon name="bank" /> Do depozytu
              </button>
            )}
          </div>
          {!isEquipped && (
            <div className="inventory__detail-actions">
              <button
                className="inventory__action-btn inventory__action-btn--sell"
                onClick={handleSell}
                disabled={actionInProgress}
              >
                Sprzedaj ({formatGoldShort(sellPrice)}{enhanceRefund.stones > 0 ? <> +{enhanceRefund.stones}<GameIcon name="gem-stone" /></> : ''})
              </button>
              {!disassembleResult && (
                <button
                  className="inventory__action-btn inventory__action-btn--disassemble"
                  onClick={handleDisassemble}
                  disabled={actionInProgress || disassembling}
                >
                  {disassembling ? <><GameIcon name="hourglass-not-done" /> Rozkladanie...</> : <><GameIcon name="hammer" /> Rozloz (20% na <TinyIcon icon={STONE_ICONS[disassembleStoneType] ?? 'gem-stone'} size="sm" /> {disassembleStoneName})</>}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Toast row for the deposit action — green tick on success,
            red badge on failure. AnimatePresence so it slides in/out. */}
        <AnimatePresence>
          {depositToast === 'ok' && (
            <motion.div
              key="dep-ok"
              className="inventory__deposit-toast inventory__deposit-toast--ok"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <GameIcon name="check-mark-button" /> Wpłacono do depozytu
            </motion.div>
          )}
          {depositToast === 'full' && (
            <motion.div
              key="dep-full"
              className="inventory__deposit-toast inventory__deposit-toast--full"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <Icon name="x" /> Depozyt pełny ({depositLength}/{MAX_DEPOSIT_SIZE})
            </motion.div>
          )}
        </AnimatePresence>

        {/* Disassemble progress bar */}
        {disassembling && (
          <div className="inventory__disassemble-progress">
            <div className="inventory__disassemble-progress-bar" />
            <span className="inventory__disassemble-progress-text">Rozkladanie...</span>
          </div>
        )}

        <AnimatePresence>
          {disassembleResult === 'success' && (
            <motion.div
              className="inventory__disassemble-result inventory__disassemble-result--success"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ type: 'spring', stiffness: 300, damping: 15 }}
            >
              <span className="inventory__disassemble-result-icon"><GameIcon name="party-popper" /></span>
              <span>Otrzymano: <TinyIcon icon={STONE_ICONS[disassembleStoneType] ?? 'gem-stone'} size="sm" /> {disassembleStoneName} x1</span>
              <span className="inventory__disassemble-result-sparkles"><GameIcon name="sparkles" /><GameIcon name="sparkles" /><GameIcon name="sparkles" /></span>
            </motion.div>
          )}
          {disassembleResult === 'fail' && (
            <motion.div
              className="inventory__disassemble-result inventory__disassemble-result--fail"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
            >
              <span className="inventory__disassemble-result-icon"><GameIcon name="broken-heart" /></span>
              <span>Nie otrzymano kamienia</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* -- Bonus Reroll Section ----------------------------------- */}
        {item.rarity !== 'common' && RARITY_BONUS_SLOTS[item.rarity] > 0 && rerollPhase === 'idle' && !disassembling && !disassembleResult && (
          <div className="inventory__reroll-section">
            {/* Spec 3 (2026-05 v2): skip-animation toggle for the bonus
                reroll — same UX as the Ulepsz checkbox above. */}
            <label className="inventory__skip-anim-toggle">
              <input
                type="checkbox"
                checked={skipRerollAnim}
                onChange={(e) => setSkipRerollAnim(e.target.checked)}
              />
              <span>Wyłącz animację</span>
            </label>
            <button
              className="inventory__action-btn inventory__action-btn--reroll"
              disabled={!canReroll || actionInProgress}
              onClick={handleStartReroll}
            >
              <GameIcon name="game-die" /> Zmiana Bonusu ({REROLL_STONE_COST}× <TinyIcon icon={STONE_ICONS[rerollStoneType] ?? 'gem-stone'} size="sm" /> {rerollStoneName})
            </button>
            <span className="inventory__reroll-stone-info">
              Posiadasz: {rerollStoneCount} <TinyIcon icon={STONE_ICONS[rerollStoneType] ?? 'gem-stone'} size="sm" /> {rerollStoneName}
            </span>
          </div>
        )}

        {/* Reroll rolling animation */}
        <AnimatePresence>
          {rerollPhase === 'rolling' && (
            <motion.div
              className="inventory__reroll-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="inventory__reroll-rolling">
                <div className="inventory__reroll-dice"><GameIcon name="game-die" /></div>
                <div className="inventory__reroll-sparks">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <span
                      key={i}
                      className="inventory__reroll-spark"
                      style={{
                        '--spark-angle': `${i * 18}deg`,
                        '--spark-delay': `${Math.random() * 0.8}s`,
                        '--spark-dist': `${40 + Math.random() * 60}px`,
                      } as React.CSSProperties}
                    />
                  ))}
                </div>
                <span className="inventory__reroll-rolling-text">Losowanie bonusów...</span>
                <div className="inventory__reroll-progress">
                  <div className="inventory__reroll-progress-bar" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Reroll preview — compare old vs new */}
        <AnimatePresence>
          {rerollPhase === 'preview' && rerolledBonuses && (
            <motion.div
              className="inventory__reroll-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="inventory__reroll-preview"
                initial={{ scale: 0.8, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              >
                <div className="inventory__reroll-preview-title"><GameIcon name="game-die" /> Nowe Bonusy</div>
                <div className="inventory__reroll-compare">
                  {/* Old bonuses */}
                  <div className="inventory__reroll-col inventory__reroll-col--old">
                    <span className="inventory__reroll-col-title">Obecne</span>
                    {getRandomBonusKeys(item.bonuses).length > 0 ? (
                      getRandomBonusKeys(item.bonuses).map((k) => (
                        <div key={k} className="inventory__reroll-stat">
                          <span className="inventory__reroll-stat-name">{STAT_DISPLAY_NAMES[k] ?? k}</span>
                          <span className="inventory__reroll-stat-val">+{item.bonuses[k]}</span>
                        </div>
                      ))
                    ) : (
                      <span className="inventory__reroll-empty">Brak</span>
                    )}
                  </div>
                  <span className="inventory__reroll-vs"><Icon name="arrowRight" /></span>
                  {/* New bonuses */}
                  <div className="inventory__reroll-col inventory__reroll-col--new">
                    <span className="inventory__reroll-col-title">Nowe</span>
                    {getRandomBonusKeys(rerolledBonuses).length > 0 ? (
                      getRandomBonusKeys(rerolledBonuses).map((k) => {
                        const oldVal = item.bonuses[k] ?? 0;
                        const newVal = rerolledBonuses[k];
                        const diff = newVal - oldVal;
                        return (
                          <motion.div
                            key={k}
                            className="inventory__reroll-stat"
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.1 }}
                          >
                            <span className="inventory__reroll-stat-name">{STAT_DISPLAY_NAMES[k] ?? k}</span>
                            <span className={`inventory__reroll-stat-val${diff > 0 ? ' inventory__reroll-stat-val--better' : diff < 0 ? ' inventory__reroll-stat-val--worse' : ''}`}>
                              +{newVal}
                              {diff !== 0 && (
                                <span className="inventory__reroll-stat-diff">
                                  ({diff > 0 ? '+' : ''}{diff})
                                </span>
                              )}
                            </span>
                          </motion.div>
                        );
                      })
                    ) : (
                      <span className="inventory__reroll-empty">Brak</span>
                    )}
                  </div>
                </div>
                <div className="inventory__reroll-actions">
                  <button className="inventory__reroll-accept" onClick={handleAcceptReroll}>
                    <GameIcon name="check-mark-button" /> Przyjmij nowe
                  </button>
                  <button
                    className="inventory__reroll-again"
                    disabled={(useInventoryStore.getState().stones[rerollStoneType] ?? 0) < REROLL_STONE_COST}
                    onClick={handleStartReroll}
                  >
                    <GameIcon name="game-die" /> Losuj ponownie ({REROLL_STONE_COST}× <GameIcon name="gem-stone" />)
                  </button>
                  <button className="inventory__reroll-reject" onClick={handleRejectReroll}>
                    <GameIcon name="cross-mark" /> Zostaw obecne
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
          </div>{/* /inventory__detail-col--new */}

          {/* Spec 12: comparison column — shows the currently equipped item
              for the same slot so the player can see exactly what they'd
              swap out. Stat diffs use ^/v arrows + green/red colours so
              "is this an upgrade?" reads at a glance. */}
          {equippedToCompare && (
            <EquippedComparisonColumn newItem={item} equippedItem={equippedToCompare} />
          )}
        </div>{/* /inventory__detail-cols */}
      </motion.div>
    </motion.div>
  );
};

// -- Spec 12: equipped-item comparison column --------------------------------
//
// Renders inside the DetailPanel's right column whenever a non-equipped item
// is being viewed AND the player has something equipped in the same slot.
// Shows the equipped item's icon, rarity, base stat, and a stat-by-stat
// diff (^ green = upgrade, v red = downgrade) against the clicked item.

interface IEquippedComparisonProps {
  newItem: IInventoryItem;
  equippedItem: IInventoryItem;
}

const buildItemStats = (item: IInventoryItem): Record<string, number> => {
  const base = findBaseItem(item.itemId, ALL_ITEMS);
  if (base) return getItemStats(item, base) as unknown as Record<string, number>;
  const genInfo = getGeneratedItemInfo(item.itemId);
  if (!genInfo) return {};
  const upgradeMult = getEnhancementMultiplier(item.upgradeLevel ?? 0);
  const stats: Record<string, number> = {};
  for (const [k, v] of Object.entries(item.bonuses)) {
    stats[k] = Math.floor(v * upgradeMult);
  }
  return stats;
};

const EquippedComparisonColumn = ({ newItem, equippedItem }: IEquippedComparisonProps) => {
  const eqColor = RARITY_COLORS[equippedItem.rarity];
  const eqWeaponDmg = (() => {
    const base = findBaseItem(equippedItem.itemId, ALL_ITEMS);
    if (!base) return null;
    if (base.slot !== 'mainHand' && base.slot !== 'offHand') return null;
    return getWeaponDmgRange(equippedItem);
  })();
  const newStats = buildItemStats(newItem);
  const eqStats = buildItemStats(equippedItem);
  const allKeys = Array.from(new Set([...Object.keys(newStats), ...Object.keys(eqStats)]));

  // Stat-key ordering — keep main combat stats first.
  const STAT_ORDER = ['attack', 'defense', 'hp', 'mp', 'speed', 'critChance', 'critDmg', 'dmg_min', 'dmg_max'];
  const sortedKeys = allKeys.sort((a, b) => {
    const ai = STAT_ORDER.indexOf(a); const bi = STAT_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const eqSlot = (() => {
    const base = findBaseItem(equippedItem.itemId, ALL_ITEMS);
    if (base) return base.slot;
    return getGeneratedItemInfo(equippedItem.itemId)?.slot ?? null;
  })();

  return (
    <div
      className="inventory__detail-col inventory__detail-col--equipped"
      style={{ '--rarity-color': eqColor } as React.CSSProperties}
    >
      <div className="inventory__detail-col-tag inventory__detail-col-tag--equipped">Założony</div>

      <div className="inventory__detail-icon-row">
        <ItemIcon
          icon={slotEmoji(equippedItem.itemId)}
          rarity={equippedItem.rarity}
          upgradeLevel={equippedItem.upgradeLevel}
          size="lg"
          showTooltip={false}
        />
        <div className="inventory__detail-name-block">
          <h2 className="inventory__detail-name" style={{ color: eqColor }}>
            {getItemDisplayName(equippedItem)}
          </h2>
          {eqWeaponDmg && (
            <span className="inventory__detail-dmg-range" style={{ color: '#ffc107' }}>
              <GameIcon name="crossed-swords" /> Atak: {eqWeaponDmg.min}–{eqWeaponDmg.max}
            </span>
          )}
        </div>
      </div>

      <div>
        <span className="inventory__detail-rarity" style={{ color: eqColor }}>
          {RARITY_LABELS[equippedItem.rarity]}
        </span>
        <span className="inventory__detail-level">
          {' '}· Lvl {equippedItem.itemLevel || 1}
          {eqSlot ? <> · {SLOT_LABELS[eqSlot]}</> : null}
        </span>
        {(equippedItem.upgradeLevel ?? 0) > 0 && (
          <span className="inventory__detail-upgrade" style={{ color: '#ffc107' }}>
            {' '}+{equippedItem.upgradeLevel}
          </span>
        )}
      </div>

      {/* Stat diff list — each row shows the stat name, equipped value,
          and the delta. Green ^ = better, red v = worse. */}
      <div className="inventory__compare-stats">
        {sortedKeys.map((key) => {
          const newVal = newStats[key] ?? 0;
          const eqVal = eqStats[key] ?? 0;
          const delta = newVal - eqVal;
          const label = STAT_DISPLAY_NAMES[key] ?? key;
          const better = delta > 0;
          const worse = delta < 0;
          return (
            <div key={key} className="inventory__compare-stat">
              <span className="inventory__compare-stat-label">{label}</span>
              <span className="inventory__compare-stat-eq">{eqVal}</span>
              {delta !== 0 && (
                <span className={`inventory__compare-stat-delta inventory__compare-stat-delta--${better ? 'better' : 'worse'}`}>
                  {better ? <Icon name="arrowUp" /> : worse ? <Icon name="arrowDown" /> : null} {delta > 0 ? '+' : ''}{delta}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// -- Postać popup bodies (specs 7, 8, 10) ------------------------------------
//
// Each body is a self-contained sub-component rendered inside the shared
// `inventory__popup` shell. They subscribe to their own stores so the main
// Inventory component stays slim. Memoised with `memo` because the parent
// re-renders every time the bag changes — we don't need to recompute stats
// just because a goblin dropped a sword.
//
// Stats popup (spec 7) — same combat-stats grid + damage estimates + weapon
// skill XP bar that lives in CharacterStats today, repackaged for the popup
// surface. We call the same getEffectiveChar / getTrainingBonuses / transform
// breakdown helpers so numbers stay 1:1 with the legacy /stats route.

const CLASS_MODIFIER_INV: Record<string, number> = {
  Knight: 1.0, Mage: 1.3, Cleric: 1.0,
  Archer: 1.2, Rogue: 1.0, Necromancer: 1.2, Bard: 1.0,
};
const SKILL_BOJOWY_NAMES_PL: Record<string, string> = {
  sword_fighting: 'Walka Mieczem',
  distance_fighting: 'Walka Dystansowa',
  dagger_fighting: 'Walka Sztyletem',
  magic_level: 'Poziom Magii',
  bard_level: 'Poziom Barda',
};
const CLASS_MAIN_SKILL_INV: Record<string, string> = {
  Knight: 'sword_fighting',
  Mage: 'magic_level',
  Cleric: 'magic_level',
  Archer: 'distance_fighting',
  Rogue: 'dagger_fighting',
  Necromancer: 'magic_level',
  Bard: 'bard_level',
};
interface IActiveSkillDefInv {
  id: string;
  name_pl: string;
  damage: number;
  mpCost: number;
  cooldown: number;
  effect: string | null;
  unlockLevel: number;
}
const ACTIVE_SKILLS_BY_CLASS_INV: Record<string, IActiveSkillDefInv[]> =
  (skillsRaw as { activeSkills: Record<string, IActiveSkillDefInv[]> }).activeSkills;

const StatsPopupBody = memo(() => {
  const character = useCharacterStore((s) => s.character);
  const equipment = useInventoryStore((s) => s.equipment);
  const skillLevels = useSkillStore((s) => s.skillLevels);
  const skillXp = useSkillStore((s) => s.skillXp);
  const activeSkillSlots = useSkillStore((s) => s.activeSkillSlots);
  const skillUpgradeLevels = useSkillStore((s) => s.skillUpgradeLevels);
  if (!character) return null;

  const eqStats = getTotalEquipmentStats(equipment, ALL_ITEMS);
  const tb = getTrainingBonuses(skillLevels, character.class);
  const tBreakdown = getLiveTransformBreakdown();
  const tfActive = tBreakdown.active;
  const tfFlatHp  = tfActive ? tBreakdown.flatHp      : 0;
  const tfFlatMp  = tfActive ? tBreakdown.flatMp      : 0;
  const tfFlatAtk = tfActive ? tBreakdown.flatAttack  : 0;
  const tfFlatDef = tfActive ? tBreakdown.flatDefense : 0;
  const tfHpPct   = tfActive ? tBreakdown.hpPercent   : 0;
  const tfMpPct   = tfActive ? tBreakdown.mpPercent   : 0;
  const tfDefPct  = tfActive ? tBreakdown.defPercent  : 0;
  const tfAtkPct  = tfActive ? tBreakdown.atkPercent  : 0;
  const tfHpRegen = tfActive ? tBreakdown.hpRegenFlat : 0;
  const tfMpRegen = tfActive ? tBreakdown.mpRegenFlat : 0;
  const tfDmgPct  = tfActive ? tBreakdown.dmgPercent  : 0;

  const rawAtk = character.attack + eqStats.attack + tfFlatAtk;
  const effAtk = Math.floor(rawAtk * (1 + tfAtkPct / 100));
  const rawDef = character.defense + eqStats.defense + tb.defense + tfFlatDef;
  const effDef = Math.floor(rawDef * (1 + tfDefPct / 100));
  const rawHp  = character.max_hp + eqStats.hp + tb.max_hp + getElixirHpBonus() + tfFlatHp;
  const rawMp  = character.max_mp + eqStats.mp + tb.max_mp + getElixirMpBonus() + tfFlatMp;
  const effMaxHp = Math.floor(rawHp * (1 + tfHpPct / 100));
  const effMaxMp = Math.floor(rawMp * (1 + tfMpPct / 100));
  const effAS = (character.attack_speed ?? 10) + eqStats.speed * 0.01 + tb.attack_speed;
  const effCrit = Math.min(50, Math.round((character.crit_chance ?? 0.05) * 100) + eqStats.critChance + tb.crit_chance * 100);
  const effCritDmg = (character.crit_damage ?? 2.0) + eqStats.critDmg * 0.01 + tb.crit_dmg;
  const effHpRegen = (character.hp_regen ?? 0) + tb.hp_regen + tfHpRegen;
  const effMpRegen = (character.mp_regen ?? 0) + tb.mp_regen + tfMpRegen;

  const mainSkillId = CLASS_MAIN_SKILL_INV[character.class] ?? 'sword_fighting';
  const weaponSkillLevel = skillLevels[mainSkillId] ?? 0;
  const weaponSkillXp = skillXp[mainSkillId] ?? 0;
  const xpToNext = skillXpToNextLevel(weaponSkillLevel);
  const skillPct = xpToNext > 0 ? (weaponSkillXp / xpToNext) * 100 : 0;

  // Damage estimates
  const classMod = CLASS_MODIFIER_INV[character.class] ?? 1.0;
  const classBonus = getClassSkillBonus(character.class, skillLevels);
  const mainHandItem = equipment.mainHand;
  const wepMin = mainHandItem ? (mainHandItem.bonuses.dmg_min ?? mainHandItem.bonuses.attack ?? 0) : 0;
  const wepMax = mainHandItem ? (mainHandItem.bonuses.dmg_max ?? wepMin) : 0;
  const isRogue = character.class === 'Rogue';
  const dual = isRogue ? 0.6 : 1.0;
  const basicMin = Math.max(1, Math.floor((character.attack + wepMin + classBonus.skillBonus) * classMod * dual));
  const basicMax = Math.max(1, Math.floor((character.attack + wepMax + classBonus.skillBonus) * classMod * dual));
  const critMin = Math.max(1, Math.floor(basicMin * effCritDmg));
  const critMax = Math.max(1, Math.floor(basicMax * effCritDmg));
  const rogueBasicMinTotal = isRogue ? basicMin * 2 : basicMin;
  const rogueBasicMaxTotal = isRogue ? basicMax * 2 : basicMax;

  const classKey = character.class.toLowerCase();
  const allClassSkills = ACTIVE_SKILLS_BY_CLASS_INV[classKey] ?? [];
  const activeSkillIds = activeSkillSlots.filter((s): s is string => s !== null);
  const activeSkillDamages = activeSkillIds.map((skillId) => {
    const def = allClassSkills.find((s) => s.id === skillId);
    if (!def || def.damage <= 0) return null;
    const upgradeLevel = skillUpgradeLevels[skillId] ?? 0;
    const upgradeBonus = 1 + getSkillUpgradeBonus(upgradeLevel);
    const skillBonus = Math.floor(character.attack * 0.5);
    const dmgMin = Math.max(1, Math.floor((character.attack + wepMin + skillBonus) * classMod * def.damage * upgradeBonus));
    const dmgMax = Math.max(1, Math.floor((character.attack + wepMax + skillBonus) * classMod * def.damage * upgradeBonus));
    return { id: skillId, name: def.name_pl, upgradeLevel, dmgMin, dmgMax, emoji: getSkillIcon(skillId) };
  }).filter((s): s is NonNullable<typeof s> => s !== null);

  return (
    <div className="inventory__stats-popup-body">
      {/* Combat stats grid */}
      <div className="inventory__stats-section">
        <h3 className="inventory__stats-section-title"><GameIcon name="crossed-swords" /> Statystyki Walki</h3>
        {/* Spec 4 (2026-05 v3): every combat stat shows its full
            contribution breakdown so the player can see exactly
            where each number comes from. Helper builds a non-zero
            contribution list per stat. */}
        {(() => {
          const elixirHp = getElixirHpBonus();
          const elixirMp = getElixirMpBonus();
          // Compact "+N" line (skipped when contribution = 0).
          const line = (label: string, val: number, fmt?: (v: number) => string): IStatBreakdownLine | null =>
            val === 0 ? null : { label, value: fmt ? fmt(val) : (val > 0 ? `+${val}` : `${val}`) };
          const buildLines = (...lines: (IStatBreakdownLine | null)[]): IStatBreakdownLine[] =>
            lines.filter((l): l is IStatBreakdownLine => l !== null);
          // Atak: base + eq + tf flat + tf %
          const atkLines = buildLines(
            { label: 'Baza', value: `${character.attack}` },
            line('Eq', eqStats.attack),
            line('TF flat', tfFlatAtk),
            tfAtkPct > 0 ? { label: 'TF %', value: `+${tfAtkPct}% (${effAtk - rawAtk})` } : null,
          );
          // Obrona: base + eq + train + tf flat + tf %
          const defLines = buildLines(
            { label: 'Baza', value: `${character.defense}` },
            line('Eq', eqStats.defense),
            line('Trening', tb.defense),
            line('TF flat', tfFlatDef),
            tfDefPct > 0 ? { label: 'TF %', value: `+${tfDefPct}% (${effDef - rawDef})` } : null,
          );
          // Attack speed
          const asBase = character.attack_speed ?? 10;
          const asLines = buildLines(
            { label: 'Baza', value: `${asBase.toFixed(1)}` },
            eqStats.speed > 0 ? { label: 'Eq', value: `+${(eqStats.speed * 0.01).toFixed(2)}` } : null,
            tb.attack_speed > 0 ? { label: 'Trening', value: `+${tb.attack_speed.toFixed(2)}` } : null,
          );
          // Max HP
          const hpLines = buildLines(
            { label: 'Baza', value: `${character.max_hp}` },
            line('Eq', eqStats.hp),
            line('Trening', tb.max_hp),
            line('Eliksir', elixirHp),
            line('TF flat', tfFlatHp),
            tfHpPct > 0 ? { label: 'TF %', value: `+${tfHpPct}% (${effMaxHp - rawHp})` } : null,
          );
          // Max MP
          const mpLines = buildLines(
            { label: 'Baza', value: `${character.max_mp}` },
            line('Eq', eqStats.mp),
            line('Trening', tb.max_mp),
            line('Eliksir', elixirMp),
            line('TF flat', tfFlatMp),
            tfMpPct > 0 ? { label: 'TF %', value: `+${tfMpPct}% (${effMaxMp - rawMp})` } : null,
          );
          // Crit %
          const baseCritPct = Math.round((character.crit_chance ?? 0.05) * 100);
          const critLines = buildLines(
            { label: 'Baza', value: `${baseCritPct}%` },
            eqStats.critChance > 0 ? { label: 'Eq', value: `+${eqStats.critChance}%` } : null,
            tb.crit_chance > 0 ? { label: 'Trening', value: `+${(tb.crit_chance * 100).toFixed(1)}%` } : null,
          );
          // Crit DMG
          const baseCritDmg = character.crit_damage ?? 2.0;
          const critDmgLines = buildLines(
            { label: 'Baza', value: `x${baseCritDmg.toFixed(1)}` },
            eqStats.critDmg > 0 ? { label: 'Eq', value: `+${(eqStats.critDmg * 0.01).toFixed(2)}` } : null,
            tb.crit_dmg > 0 ? { label: 'Trening', value: `+${tb.crit_dmg.toFixed(2)}` } : null,
          );
          // HP/MP regen
          const hpRegenLines = buildLines(
            { label: 'Baza', value: `${(character.hp_regen ?? 0).toFixed(1)}/s` },
            tb.hp_regen > 0 ? { label: 'Trening', value: `+${tb.hp_regen.toFixed(1)}/s` } : null,
            tfHpRegen > 0 ? { label: 'Transform', value: `+${tfHpRegen.toFixed(1)}/s` } : null,
          );
          const mpRegenLines = buildLines(
            { label: 'Baza', value: `${(character.mp_regen ?? 0).toFixed(1)}/s` },
            tb.mp_regen > 0 ? { label: 'Trening', value: `+${tb.mp_regen.toFixed(1)}/s` } : null,
            tfMpRegen > 0 ? { label: 'Transform', value: `+${tfMpRegen.toFixed(1)}/s` } : null,
          );
          return (
            <div className="inventory__stats-grid">
              <StatBox label="Atak"           value={effAtk}                     breakdown={atkLines} />
              <StatBox label="Obrona"         value={effDef}                     breakdown={defLines} />
              <StatBox label="Predkosc Ataku" value={effAS.toFixed(1)}           breakdown={asLines} />
              <StatBox label="Max HP"         value={effMaxHp}                   breakdown={hpLines} />
              <StatBox label="Max MP"         value={effMaxMp}                   breakdown={mpLines} />
              <StatBox label="Kryty %"        value={`${effCrit}%`}              breakdown={critLines} />
              <StatBox label="Kryty DMG"      value={`x${effCritDmg.toFixed(1)}`} breakdown={critDmgLines} />
              <StatBox label="HP Regen"       value={`${effHpRegen.toFixed(1)}/s`} breakdown={hpRegenLines} />
              <StatBox label="MP Regen"       value={`${effMpRegen.toFixed(1)}/s`} breakdown={mpRegenLines} />
              {tfDmgPct > 0 && (
                <StatBox label="DMG Transform" value={`+${tfDmgPct}%`} breakdown={[
                  { label: 'Mnoznik', value: 'Caly DMG' },
                ]} />
              )}
            </div>
          );
        })()}
      </div>

      {/* Damage estimates */}
      <div className="inventory__stats-section">
        <h3 className="inventory__stats-section-title"><GameIcon name="collision" /> Obrazenia w Walce</h3>
        <div className="inventory__stats-dmg">
          <div className="inventory__stats-dmg-row">
            <span className="inventory__stats-dmg-icon"><GameIcon name="crossed-swords" /></span>
            <span className="inventory__stats-dmg-label">Atak podstawowy</span>
            <span className="inventory__stats-dmg-value">
              {isRogue ? <>{basicMin}-{basicMax} ×2 = <strong>{rogueBasicMinTotal}-{rogueBasicMaxTotal}</strong> DMG</> : <><strong>{basicMin}-{basicMax}</strong> DMG</>}
            </span>
          </div>
          <div className="inventory__stats-dmg-row inventory__stats-dmg-row--crit">
            <span className="inventory__stats-dmg-icon"><GameIcon name="high-voltage" /></span>
            <span className="inventory__stats-dmg-label">Atak krytyczny</span>
            <span className="inventory__stats-dmg-value">
              <strong>{critMin}-{critMax}</strong>{isRogue ? ' ×2' : ''} DMG
            </span>
          </div>
          {activeSkillDamages.length > 0 && <div className="inventory__stats-dmg-sep" />}
          {activeSkillDamages.map((s) => (
            <div key={s.id} className="inventory__stats-dmg-row inventory__stats-dmg-row--skill">
              <span className="inventory__stats-dmg-icon"><TinyIcon icon={s.emoji} size={32} /></span>
              <span className="inventory__stats-dmg-label">
                {s.name}{s.upgradeLevel > 0 && <span className="inventory__stats-dmg-upgrade"> (+{s.upgradeLevel})</span>}
              </span>
              <span className="inventory__stats-dmg-value"><strong>{s.dmgMin}-{s.dmgMax}</strong> DMG</span>
            </div>
          ))}
          {activeSkillDamages.length === 0 && activeSkillIds.length === 0 && (
            <div className="inventory__stats-dmg-empty">Brak aktywnych skilli bojowych</div>
          )}
        </div>
        <div className="inventory__stats-dmg-note">Przed redukcja obrony wroga</div>
      </div>

      {/* Weapon skill XP */}
      <div className="inventory__stats-section">
        <h3 className="inventory__stats-section-title"><GameIcon name="bullseye" /> Skill Bojowy</h3>
        <div className="inventory__stats-skill-row">
          <span className="inventory__stats-skill-name">{SKILL_BOJOWY_NAMES_PL[mainSkillId] ?? mainSkillId}</span>
          <span className="inventory__stats-skill-level">Poziom {weaponSkillLevel}</span>
        </div>
        <div className="inventory__stats-skill-bar">
          <div className="inventory__stats-skill-bar-fill" style={{ width: `${Math.min(100, skillPct)}%` }} />
        </div>
        <div className="inventory__stats-skill-xp">{weaponSkillXp} / {xpToNext} XP</div>
      </div>
    </div>
  );
});
StatsPopupBody.displayName = 'StatsPopupBody';

// Spec 4 (2026-05 v3): every combat stat shows its full breakdown
// underneath the headline value — base / eq / training / transform /
// elixir / attribute contributions, each on its own line so the
// player can audit "where does my 6260 HP come from".
interface IStatBreakdownLine {
  /** Short label — "Baza" / "Eq" / "TF" / "Trening" / "Eliksir" / "Atrybuty" */
  label: string;
  /** Already-formatted contribution string, e.g. "+200" / "+25% (320)" */
  value: string;
}
const StatBox = ({ label, value, breakdown }: {
  label: string;
  value: string | number;
  breakdown?: IStatBreakdownLine[];
}) => (
  <div className="inventory__stats-box">
    <span className="inventory__stats-box-label">{label}</span>
    <span className="inventory__stats-box-value">{value}</span>
    {breakdown && breakdown.length > 0 && (
      <ul className="inventory__stats-box-breakdown">
        {breakdown.map((row, i) => (
          <li key={i} className="inventory__stats-box-breakdown-row">
            <span className="inventory__stats-box-breakdown-label">{row.label}</span>
            <span className="inventory__stats-box-breakdown-value">{row.value}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

// Training popup (spec 8) — replicates Skills' "offline" tab. Shows every
// trainable stat for the player's class with a click-to-train button. Each
// row shows the per-level bonus (e.g. "+0.1 attack speed / level") in the
// bottom-right per the spec's "ile + nam daje ten poziom skilla" ask.

// Per-level bonus formulas — read from getTrainingBonuses by simulating
// "what would my bonus be at level (current+1) minus my current bonus".
const trainingPerLevelLabel = (skillId: string, currentLevel: number, characterClass: string): string => {
  const cur = getTrainingBonuses({ [skillId]: currentLevel }, characterClass);
  const next = getTrainingBonuses({ [skillId]: currentLevel + 1 }, characterClass);
  const map: Record<string, { key: keyof typeof cur; suffix: string; precision: number }> = {
    attack_skill: { key: 'attack_speed', suffix: ' AS', precision: 2 },
    attack_speed: { key: 'attack_speed', suffix: ' AS', precision: 2 },
    shielding: { key: 'defense', suffix: ' DEF', precision: 0 },
    defense: { key: 'defense', suffix: ' DEF', precision: 0 },
    fishing: { key: 'max_hp', suffix: ' HP', precision: 0 },
    crit_chance: { key: 'crit_chance', suffix: '% Crit', precision: 1 },
    crit_dmg: { key: 'crit_dmg', suffix: '× Crit DMG', precision: 2 },
    hp_regen: { key: 'hp_regen', suffix: ' HP/s', precision: 1 },
    mp_regen: { key: 'mp_regen', suffix: ' MP/s', precision: 1 },
    max_hp: { key: 'max_hp', suffix: ' HP', precision: 0 },
    max_mp: { key: 'max_mp', suffix: ' MP', precision: 0 },
  };
  const entry = map[skillId];
  if (!entry) return '';
  const delta = (next[entry.key] as number) - (cur[entry.key] as number);
  if (delta === 0) return '';
  const value = entry.key === 'crit_chance' ? delta * 100 : delta;
  return `+${value.toFixed(entry.precision)}${entry.suffix} / poziom`;
};

const TrainingPopupBody = memo(() => {
  const character = useCharacterStore((s) => s.character);
  const skillLevels = useSkillStore((s) => s.skillLevels);
  const skillXp = useSkillStore((s) => s.skillXp);
  const offlineTrainingSkillId = useSkillStore((s) => s.offlineTrainingSkillId);
  const trainingSegmentStartedAt = useSkillStore((s) => s.trainingSegmentStartedAt);
  const trainingCurrentSpeedMultiplier = useSkillStore((s) => s.trainingCurrentSpeedMultiplier);
  const selectTrainingStat = useSkillStore((s) => s.selectTrainingStat);
  const huntIsActive = useOfflineHuntStore((s) => s.isActive);
  // Spec 3 (2026-05 v4): tick once a second so the in-progress XP bar
  // for the active training stat updates LIVE while the popup is open.
  // Engine commits XP only on segment-end / claim, so we compute the
  // pending segment XP locally from elapsed seconds × xp-rate.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!offlineTrainingSkillId || !trainingSegmentStartedAt) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [offlineTrainingSkillId, trainingSegmentStartedAt]);
  if (!character) return null;

  const isTrainingActive = !!offlineTrainingSkillId && !!trainingSegmentStartedAt;
  const isPausedByHunt = !!offlineTrainingSkillId && huntIsActive && !trainingSegmentStartedAt;
  const isActiveSpeed = trainingCurrentSpeedMultiplier === 2;

  // Combine class-specific weapon-skill list + general trainable stats
  const classStats = getTrainableStatsForClass(character.class as Parameters<typeof getTrainableStatsForClass>[0]);
  const allStats = [...classStats, ...GENERAL_TRAINABLE_STATS];
  const uniqueStats = Array.from(new Set(allStats));

  return (
    <div className="inventory__training-popup-body">
      <div className="inventory__training-status">
        {isTrainingActive ? (
          <span className="inventory__training-status-pill inventory__training-status-pill--active">
            <GameIcon name="green-circle" /> Aktywne · {isActiveSpeed ? '×2' : '×1'} szybkosc · trenuje: <strong>{SKILL_NAMES_PL[offlineTrainingSkillId ?? ''] ?? offlineTrainingSkillId}</strong>
          </span>
        ) : isPausedByHunt ? (
          <span className="inventory__training-status-pill inventory__training-status-pill--paused">
            <GameIcon name="pause-button" /> Wstrzymane (aktywna hunta)
          </span>
        ) : (
          <span className="inventory__training-status-pill">
            <GameIcon name="white-circle" /> Brak aktywnego treningu
          </span>
        )}
      </div>

      <div className="inventory__training-list">
        {uniqueStats.map((skillId) => {
          const level = skillLevels[skillId] ?? 0;
          const baseXp = skillXp[skillId] ?? 0;
          const xpNext = skillXpToNextLevel(level);
          const isSelected = offlineTrainingSkillId === skillId;
          // Spec 3 (2026-05 v4): for the actively-trained skill, add the
          // pending segment XP (elapsed seconds × xp-rate × speed) on
          // top of the stored XP so the bar fills LIVE every second.
          const isLiveTraining = isSelected && !!trainingSegmentStartedAt;
          let xp = baseXp;
          if (isLiveTraining) {
            const segSecs = Math.max(0, (Date.now() - new Date(trainingSegmentStartedAt!).getTime()) / 1000);
            const ratePerSec = offlineXpRateForStat(level, skillId);
            xp = Math.floor(baseXp + segSecs * ratePerSec * trainingCurrentSpeedMultiplier);
          }
          const pct = xpNext > 0 ? (xp / xpNext) * 100 : 0;
          const bonusLabel = trainingPerLevelLabel(skillId, level, character.class);
          return (
            <button
              key={skillId}
              type="button"
              onClick={() => selectTrainingStat(isSelected ? null : skillId)}
              className={`inventory__training-card${isSelected ? ' inventory__training-card--selected' : ''}`}
            >
              <div className="inventory__training-card-head">
                <span className="inventory__training-card-name">{SKILL_NAMES_PL[skillId] ?? skillId}</span>
                <span className="inventory__training-card-level">Lv {level}</span>
              </div>
              <div className="inventory__training-card-bar">
                <div className="inventory__training-card-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <div className="inventory__training-card-foot">
                <span className="inventory__training-card-xp">{xp} / {xpNext} XP</span>
                {bonusLabel && <span className="inventory__training-card-bonus">{bonusLabel}</span>}
              </div>
              {isSelected && <span className="inventory__training-card-badge">Wybrano</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
});
TrainingPopupBody.displayName = 'TrainingPopupBody';

// Active skills popup (spec 10) — slot grid + skill cards from Skills' "active"
// tab. Click a skill icon to assign / unassign it to the next free slot.

// Spec 5/6 (2026-05 v4): plain-Polish translator for the skill `effect`
// vocabulary. Mirrors `describeSkillEffect` from Skills.tsx in compact
// form — covers the most-frequent stun / DOT / heal / buff tags.
/**
 * Render a skill's `effect` string as one or more plain-Polish sentences.
 *
 * Supports the v2 colon-separated tag set used in `skills.json` and
 * combines multiple tags (joined by `;` in the JSON) into a single line
 * separated by " · ".  Returns `null` when the effect is empty so the
 * caller can suppress the row.
 *
 * Examples:
 *   "stun:3000"                  -> "Ogłusza wroga na 3s"
 *   "dot:5000:5"                 -> "Trucizna przez 5s (5 ticków)"
 *   "aoe;def_pen:80;heal_party_pct:30"
 *                                -> "Atak obszarowy · Ignoruje 80% obrony · Leczy drużynę o 30% maks. HP"
 *   "summon:skeleton:5"          -> "Przyzywa 5 szkieletów"
 *
 * Quick fix (2026-05): old impl used outdated underscore tags
 * (`stun_3000`, `burn_chance_…`) which never matched the actual
 * `effect` strings in skills.json — so almost every spell card
 * silently rendered with NO effect description. This rewrite walks the
 * actual tag set we ship.
 */
const describeSkillEffectInv = (effect: string | null): string | null => {
  if (!effect) return null;
  const sec = (ms: number): string => (ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1) + 's';
  const pct = (raw: number): string => `${raw.toFixed(0)}%`;
  const summonName = (type: string, count: number): string => {
    const map: Record<string, [string, string, string]> = {
      // [1, few (2-4), many (5+)]
      skeleton: ['szkieleta',    'szkielety',    'szkieletów'],
      ghost:    ['ducha',        'duchy',        'duchów'],
      demon:    ['demona',       'demony',       'demonów'],
      lich:     ['licza',        'licze',        'liczy'],
    };
    const forms = map[type] ?? [type, type, type];
    if (count === 1) return `1 ${forms[0]}`;
    if (count >= 2 && count <= 4) return `${count} ${forms[1]}`;
    return `${count} ${forms[2]}`;
  };
  const describeOne = (raw: string): string | null => {
    const e = raw.trim().toLowerCase();
    if (!e) return null;
    const parts = e.split(':');
    const head = parts[0];
    const p1 = parts[1] ?? '';
    const p2 = parts[2] ?? '';
    const p3 = parts[3] ?? '';
    const n1 = parseFloat(p1);
    const n2 = parseFloat(p2);
    const n3 = parseFloat(p3);
    switch (head) {
      case 'aoe':              return 'Atak obszarowy (trafia wszystkich wrogów)';
      case 'aggro_steal':      return 'Przejmuje agresję wszystkich wrogów (wycelowane w gracza ataki teraz idą w niego)';
      case 'def_pen':          return `Ignoruje ${pct(n1)} obrony celu`;
      case 'dot':              return `Trucizna / DOT przez ${sec(n1)} (${n2} ticków)`;
      case 'stun':             return `Ogłusza wroga na ${sec(n1)} (blokuje ataki i spelle)`;
      case 'stun_chance':      return `Szansa ${pct(n1)} na ogłuszenie na ${sec(n2)} (blokuje ataki i spelle)`;
      case 'paralyze':         return `Paraliżuje wroga na ${sec(n1)} (blokuje ataki i spelle)`;
      case 'execute_below':    return `Natychmiastowe zabicie wroga z HP poniżej ${pct(n1)}`;
      case 'instant_kill_chance': return `Szansa ${pct(n1)} na natychmiastowe zabicie wroga`;
      case 'multistrike':      return `Atakuje ${n1} razy w jednej akcji`;
      case 'crit_buff':        return `+${pct(n1)} szansy na crit przez ${sec(n2)}`;
      case 'crit_buff_next':   return `Następny atak z +${pct(n1)} szansą na crit (gwarantowany jeśli ≥100%)`;
      case 'crit_next':        return n2 >= 1
        ? `Następne ${n1} ataków podstawowych zawsze crit`
        : `Następne ${n1} ataków z +${(n2 * 100).toFixed(0)}% szansą na crit`;
      case 'attack_up':        return `+${pct(n1)} ATK przez ${sec(n2)}`;
      case 'enemy_atk_down':   return `Wróg ma −${pct(n1)} ATK przez ${sec(n2)}`;
      case 'enemy_no_heal':    return `Wszyscy wrogowie nie mogą się leczyć przez ${sec(n1)} (AOE)`;
      case 'mark_no_heal':     return `Cel oznaczony — nie może się leczyć przez ${sec(n1)}`;
      case 'mark_heal_to_dmg': return `Cel oznaczony — każde leczenie obraca się w obrażenia (100% wartości) przez ${sec(n1)}`;
      case 'mark_amp':         return `Każdy kolejny atak na cel zadaje +${(n1 * 100).toFixed(0)}% DMG (max ${n2} stacków, ${sec(n3)})`;
      case 'mark_amp_all':     return `Wszyscy wrogowie otrzymują +${(n1 * 100).toFixed(0)}% DMG przez ${sec(n2)}`;
      case 'dmg_amp_next':     return `Następne ${n2} ataków zadaje × ${n1} DMG`;
      case 'dodge_buff':       return `+${pct(n1)} szansy na unik przez ${sec(n2)}`;
      case 'dodge_next':       {
        const isNonMagic = p2 === 'non_magic';
        return isNonMagic
          ? `100% unik na następne ${n1} ataków podstawowych (NIE działa na spelle ani na klasy magiczne — Mage / Cleric / Necromancer)`
          : `100% unik na następne ${n1} ataków`;
      }
      case 'immortal':         return `Niewrażliwość na obrażenia przez ${sec(n1)}`;
      case 'mana_shield':      return `Tarcza Many: przez ${sec(n1)} obrażenia idą najpierw w MP (100%), HP traci tylko nadmiar gdy MP się skończy. Tylko na siebie.`;
      case 'party_immortal':   return `Cała drużyna niewrażliwa na obrażenia przez ${sec(n1)}`;
      case 'block_next_party': return `Sojusznicy blokują następne ${n1} ataków`;
      case 'revive_party':     return n1 > 0
        ? `Wskrzesza poległych po ${sec(n1)} z ${sec(n2)} HP`
        : `Wskrzesza poległych członków drużyny`;
      case 'heal_party_pct':   return `Leczy całą drużynę o ${pct(n1)} maks. HP`;
      case 'heal_party_dot':   return `Regeneracja drużyny przez ${sec(n1)} (${n2} ticków)`;
      case 'heal_lowest_ally_pct': return `Leczy sojusznika z najniższym HP o ${pct(n1)} maks. HP`;
      case 'heal_self_pct_dmg':    return `Leczy się o ${pct(n1)} zadanych obrażeń`;
      case 'next_ally_heal':       return `Następne ${n2} ataków sojusznika leczy ${n1}× obrażeń`;
      case 'party_attack_up':      return `+${pct(n1)} ATK całej drużyny przez ${sec(n2)}`;
      case 'party_defense_up':     return `+${pct(n1)} DEF całej drużyny przez ${sec(n2)}`;
      case 'party_def_pen':        return `Drużyna ignoruje ${pct(n1)} obrony przez ${sec(n2)}`;
      case 'party_as_up':          return `× ${n1} prędkości ataku drużyny przez ${sec(n2)}`;
      case 'party_crit_up':        return `+${pct(n1)} szansy na crit drużyny przez ${sec(n2)}`;
      case 'party_lifesteal_next': return `Następne ${n2} ataków drużyny ma ${pct(n1)} lifesteal`;
      case 'party_instant_kill_chance_next': return `Następne ${n2} ataków drużyny ma ${pct(n1)} szansy na natychmiastowe zabicie`;
      case 'summon':           return `Przyzywa ${summonName(p1, parseInt(p2 || '1', 10) || 1)}`;
      case 'death_apocalypse': return 'Apokalipsa Śmierci — tracisz HP do 20% maks. (lub do 2% gdy już poniżej 20%) i zadajesz 50% maks. HP przeciwnika';
      case 'dark_ritual':      return `Mroczny rytuał — po ${sec(n1)} przeciwnik traci ${n2}% maks. HP`;
      default: return null;
    }
  };
  // Tags are joined with `;` in JSON. Render each piece, drop empties,
  // and join with " · " for a clean inline read.
  const pieces = effect.split(';').map(describeOne).filter((p): p is string => p !== null);
  if (pieces.length === 0) return null;
  return pieces.join(' · ');
};

const ActiveSkillsPopupBody = memo(() => {
  const character = useCharacterStore((s) => s.character);
  const activeSkillSlots = useSkillStore((s) => s.activeSkillSlots);
  const setActiveSkillSlot = useSkillStore((s) => s.setActiveSkillSlot);
  const skillUpgradeLevels = useSkillStore((s) => s.skillUpgradeLevels);
  const unlockedSkills = useSkillStore((s) => s.unlockedSkills);
  const unlockSkillFn = useSkillStore((s) => s.unlockSkill);
  const upgradeActiveSkillFn = useSkillStore((s) => s.upgradeActiveSkill);
  const gold = useInventoryStore((s) => s.gold);
  const spendGold = useInventoryStore((s) => s.spendGold);
  const useSpellChests = useInventoryStore((s) => s.useSpellChests);
  const getSpellChestCount = useInventoryStore((s) => s.getSpellChestCount);
  // Quick fix 2 (2026-05 v6): pull the equipped main-hand so we can show
  // the SAME damage estimate the stats popup shows. The previous
  // formula (`attack × skill.damage`) ignored weapon DMG + class
  // modifier and produced a number ~5× lower than the in-combat reality.
  const equipment = useInventoryStore((s) => s.equipment);
  // Spec 4 (2026-05 v5): clicking ANY skill (even with empty slots) opens
  // the slot picker so the player always controls the destination.
  const [swapTarget, setSwapTarget] = useState<string | null>(null);
  // Spec 5/6: per-action modal state — `upgrade` shows the Ulepsz flow
  // for the picked skill, `unlock` shows the Odblokuj flow.
  const [upgradeTarget, setUpgradeTarget] = useState<string | null>(null);
  const [unlockTarget, setUnlockTarget] = useState<string | null>(null);
  // Result toast after upgrade/unlock attempt — auto-clears after 2.5s.
  const [actionResult, setActionResult] = useState<{ skillId: string; ok: boolean; msg: string } | null>(null);
  // Spec 2 (2026-05 v6): in-popup animation state for the Ulepsz flow.
  // 'idle' -> ready, 'rolling' -> progress bar filling, 'done' -> result
  // panel (success / fail) shown until the player closes the modal.
  const [upgradePhase, setUpgradePhase] = useState<'idle' | 'rolling' | 'done'>('idle');
  const [upgradeOutcome, setUpgradeOutcome] = useState<{ ok: boolean; newLevel: number } | null>(null);
  // Spec 3: skip-animation toggle for the upgrade popup. Stored across
  // attempts so the player can spam-upgrade with the same setting.
  const [skipUpgradeAnim, setSkipUpgradeAnim] = useState(false);
  if (!character) return null;

  const classKey = character.class.toLowerCase();
  const myActiveSkills = ACTIVE_SKILLS_BY_CLASS_INV[classKey] ?? [];

  // Quick fix 2: per-skill DMG estimate that matches the stats popup +
  // engine. Engine uses `(atk + weapon + 0.5×atk) × classMod` for the
  // base hit; we additionally fold in `skill.damage` and the upgrade
  // bonus so the player can see how much the skill scales the basic
  // hit. Same formula as `activeSkillDamages` in StatsPopupBody.
  const classModForSkill = CLASS_MODIFIER_INV[character.class] ?? 1.0;
  const mainHandForSkill = equipment.mainHand;
  const wepMinForSkill = mainHandForSkill ? (mainHandForSkill.bonuses.dmg_min ?? mainHandForSkill.bonuses.attack ?? 0) : 0;
  const wepMaxForSkill = mainHandForSkill ? (mainHandForSkill.bonuses.dmg_max ?? wepMinForSkill) : 0;
  const innateSkillBonus = Math.floor((character.attack ?? 0) * 0.5);

  // Spec 4 (2026-05 v5): clicking anywhere on an unlocked skill ALWAYS
  // opens the slot picker — even if a slot is empty. Player chooses
  // exactly which slot the skill lands in (or which one it replaces).
  const openSlotPicker = (skillId: string) => {
    if (!unlockedSkills[skillId]) return;
    setSwapTarget(skillId);
  };
  const resolveSwap = (slotIdx: 0 | 1 | 2 | 3) => {
    if (!swapTarget) return;
    // If clicking the slot already holding the same skill -> unequip.
    if (activeSkillSlots[slotIdx] === swapTarget) {
      setActiveSkillSlot(slotIdx, null);
    } else {
      // Clear any other slot holding this skill (so a skill can't occupy
      // two slots at once) then place it on the chosen slot.
      const existingIdx = activeSkillSlots.indexOf(swapTarget);
      if (existingIdx !== -1) setActiveSkillSlot(existingIdx as 0 | 1 | 2 | 3, null);
      setActiveSkillSlot(slotIdx, swapTarget);
    }
    setSwapTarget(null);
  };

  // Spec 5/6/7: confirm + apply for upgrade / unlock.
  const confirmUnlock = (skillId: string) => {
    const skill = myActiveSkills.find((s) => s.id === skillId);
    if (!skill) return;
    const cost = getSpellChestUnlockCost(skill.unlockLevel);
    const ok = unlockSkillFn(skillId, cost.gold, spendGold, cost.chestLevel, useSpellChests);
    setActionResult({ skillId, ok, msg: ok ? 'Skill odblokowany!' : 'Brak zasobów.' });
    setUnlockTarget(null);
    setTimeout(() => setActionResult(null), 2500);
  };
  // Spec 2/3 (2026-05 v6): upgrade triggers an inline progress-bar
  // animation INSIDE the popup (it stays open). Skip-animation
  // checkbox jumps straight to the result. Player closes the popup
  // manually via Anuluj / Zamknij after each attempt.
  const confirmUpgrade = (skillId: string) => {
    const skill = myActiveSkills.find((s) => s.id === skillId);
    if (!skill) return;
    // Spec 7: post-death rollback guard.
    if (character.level < skill.unlockLevel) {
      setActionResult({ skillId, ok: false, msg: `Wymagany poziom ${skill.unlockLevel} (masz ${character.level}).` });
      setTimeout(() => setActionResult(null), 2500);
      return;
    }
    const runAttempt = () => {
      const result = upgradeActiveSkillFn(skillId, gold, spendGold, skill.unlockLevel, useSpellChests, getSpellChestCount);
      setUpgradeOutcome({ ok: result.success, newLevel: result.newLevel });
      setUpgradePhase('done');
      // 2026-05-20 spec ("pokazywalo jak ktos wbije +5, +7, +10 i potem
      // co jeden kazdy w nieskonczonosc i skille i przedmioty"): mirror
      // the item-upgrade System broadcast for active-skill upgrades.
      // Same milestone rule, same payload shape (different type so the
      // renderer picks the spell icon via getSkillIcon). Fire-and-forget.
      if (result.success && isUpgradeMilestone(result.newLevel)) {
        void Promise.all([
          import('../../api/v1/chatApi'),
          import('../../systems/systemChatMessages'),
        ]).then(([{ chatApi }, { formatSystemMessage }]) => {
          const content = formatSystemMessage({
            type: 'skillUpgrade',
            skillId,
            skillName: skill.name_pl,
            upgradeLevel: result.newLevel,
          });
          void chatApi.postSystemEvent(
            character.name,
            character.class,
            character.level,
            content,
          ).catch(() => { /* offline — fine */ });
        }).catch(() => { /* offline */ });
      }
    };
    if (skipUpgradeAnim) {
      runAttempt();
    } else {
      setUpgradePhase('rolling');
      // Match the item-enhance progress-bar duration (1.8s).
      setTimeout(runAttempt, 1800);
    }
  };
  // Reset upgrade modal state when target changes / closes.
  const closeUpgradeModal = () => {
    setUpgradeTarget(null);
    setUpgradePhase('idle');
    setUpgradeOutcome(null);
  };

  return (
    <div className="inventory__skills-popup-body">
      {/* Slot overview — Spec 7: all 4 slots same width via grid 1fr×4. */}
      <div className="inventory__skills-slots">
        {activeSkillSlots.map((slotId, i) => {
          const skill = myActiveSkills.find((s) => s.id === slotId);
          const icon = skill ? getSkillIcon(skill.id) : '';
          return (
            <div key={i} className={`inventory__skills-slot${skill ? ' inventory__skills-slot--filled' : ''}`}>
              <span className="inventory__skills-slot-label">Slot {i + 1}</span>
              {skill ? (
                <span className="inventory__skills-slot-skill">
                  <TinyIcon icon={icon} size={28} />
                  <span className="inventory__skills-slot-name">{skill.name_pl}</span>
                </span>
              ) : <span className="inventory__skills-slot-empty">—</span>}
            </div>
          );
        })}
      </div>

      {/* Spec 8: removed the "Pełna sekcja skilli..." hint. */}

      {/* Skill cards — Spec 5+6: vertical layout (icon+name+stats top,
          description middle, action buttons bottom). Spec 4: clicking
          anywhere on the card opens the slot picker. */}
      <div className="inventory__skills-list">
        {myActiveSkills.map((skill) => {
          const isEquipped = activeSkillSlots.includes(skill.id);
          const isLevelLocked = character.level < skill.unlockLevel;
          const isPurchased = unlockedSkills[skill.id] === true;
          const needsPurchase = !isLevelLocked && !isPurchased;
          const upgradeLevel = skillUpgradeLevels[skill.id] ?? 0;
          const currentBonus = getSkillUpgradeBonus(upgradeLevel);
          const chestUnlockCost = getSpellChestUnlockCost(skill.unlockLevel);
          const icon = getSkillIcon(skill.id);
          const effectDesc = describeSkillEffectInv(skill.effect);
          // Spec 8: rich description shown above the action buttons.
          // Combines damage line ("Zadaje obrażenia ~XYZ dmg") + the
          // effect description so the player knows exactly what fires.
          // Quick fix 2 (2026-05 v6): mirror the formula used in
          // StatsPopupBody.activeSkillDamages so the number a player
          // sees here matches the per-skill DMG box on the stats
          // popup (and the actual in-combat hit). Old formula
          // (attack × skill.damage) ignored weapon DMG + classMod and
          // under-reported by 4-5×.
          const upgradeMult = 1 + currentBonus;
          const dmgMinEst = Math.max(1, Math.floor((character.attack + wepMinForSkill + innateSkillBonus) * classModForSkill * skill.damage * upgradeMult));
          const dmgMaxEst = Math.max(1, Math.floor((character.attack + wepMaxForSkill + innateSkillBonus) * classModForSkill * skill.damage * upgradeMult));
          const dmgLine = skill.damage > 0
            ? `Zadaje obrażenia ~${dmgMinEst.toLocaleString('pl-PL')}–${dmgMaxEst.toLocaleString('pl-PL')} dmg (mnożnik ${(skill.damage * upgradeMult).toFixed(2)}× bazowy + broń)`
            : 'Skill wsparcia — nie zadaje bezpośrednich obrażeń';
          const showResult = actionResult?.skillId === skill.id;
          return (
            <div
              key={skill.id}
              className={`inventory__skills-card${isEquipped ? ' inventory__skills-card--equipped' : ''}${isLevelLocked ? ' inventory__skills-card--locked' : ''}${needsPurchase ? ' inventory__skills-card--needs-purchase' : ''}`}
              role={isPurchased ? 'button' : undefined}
              tabIndex={isPurchased ? 0 : -1}
              onClick={() => isPurchased && openSlotPicker(skill.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' && isPurchased) openSlotPicker(skill.id); }}
            >
              {/* Top row — icon + name + status badges + stats. */}
              <div className="inventory__skills-card-top">
                <div className="inventory__skills-card-icon">
                  <TinyIcon icon={icon} size={40} />
                  {upgradeLevel > 0 && <span className="inventory__skills-card-badge">+{upgradeLevel}</span>}
                </div>
                <div className="inventory__skills-card-details">
                  <div className="inventory__skills-card-head">
                    <span className="inventory__skills-card-name">{skill.name_pl}</span>
                    {/* Spec 5 (2026-05 v6): always show the unlock-level
                        chip next to the name, tinted with the live
                        transform colour so it reads as a tier marker.
                        When the player is below that level the chip
                        also gets a :locked: prefix. */}
                    <span className={`inventory__skills-card-lvl${isLevelLocked ? ' inventory__skills-card-lvl--locked' : ''}`}>
                      {isLevelLocked ? <><GameIcon name="locked" /> </> : ''}Lv {skill.unlockLevel}
                    </span>
                    {needsPurchase && <span className="inventory__skills-card-lock"><GameIcon name="old-key" /> ×{chestUnlockCost.chests} + {formatGoldShort(chestUnlockCost.gold)}</span>}
                    {isEquipped && <span className="inventory__skills-card-active">Aktywny</span>}
                  </div>
                  <div className="inventory__skills-card-stats">
                    <span>MP {skill.mpCost}</span>
                    <span>CD {(skill.cooldown / 1000).toFixed(1)}s</span>
                    {skill.damage > 0 && <span>×{(skill.damage * (1 + currentBonus)).toFixed(2)} DMG{upgradeLevel > 0 && <span className="inventory__skills-card-bonus"> +{(currentBonus * 100).toFixed(0)}%</span>}</span>}
                  </div>
                </div>
              </div>

              {/* Spec 5+8: damage + effect description above the buttons. */}
              <div className="inventory__skills-card-desc">
                <div className="inventory__skills-card-desc-line"><GameIcon name="crossed-swords" /> {dmgLine}</div>
                {effectDesc && (
                  <div className="inventory__skills-card-desc-line"><GameIcon name="bullseye" /> {effectDesc}</div>
                )}
              </div>

              {/* Spec 6: action buttons row. */}
              <div className="inventory__skills-card-actions" onClick={(e) => e.stopPropagation()}>
                {/* Spec 4 (2026-05 v6): equipped -> "Zdejmij" (unequips
                    immediately from the slot the skill currently sits in);
                    not equipped -> "Załóż" (opens the slot picker). */}
                {isPurchased && isEquipped && (
                  <button
                    type="button"
                    className="inventory__skills-card-btn inventory__skills-card-btn--unequip"
                    onClick={() => {
                      const i = activeSkillSlots.indexOf(skill.id);
                      if (i !== -1) setActiveSkillSlot(i as 0 | 1 | 2 | 3, null);
                    }}
                  >
                    <Icon name="x" /> Zdejmij
                  </button>
                )}
                {isPurchased && !isEquipped && (
                  <button
                    type="button"
                    className="inventory__skills-card-btn inventory__skills-card-btn--equip"
                    onClick={() => openSlotPicker(skill.id)}
                    disabled={isLevelLocked}
                  >
                    <GameIcon name="sparkles" /> Załóż
                  </button>
                )}
                {isPurchased && (
                  <button
                    type="button"
                    className="inventory__skills-card-btn inventory__skills-card-btn--upgrade"
                    onClick={() => setUpgradeTarget(skill.id)}
                    /* Spec 7: lock upgrade when the player is below the
                       skill's unlock level (post-death rollback). */
                    disabled={isLevelLocked}
                    title={isLevelLocked ? `Wymagany poziom ${skill.unlockLevel}` : 'Ulepsz skill'}
                  >
                    <GameIcon name="wrench" /> Ulepsz
                  </button>
                )}
                {needsPurchase && (
                  <button
                    type="button"
                    className="inventory__skills-card-btn inventory__skills-card-btn--unlock"
                    onClick={() => setUnlockTarget(skill.id)}
                  >
                    <GameIcon name="old-key" /> Odblokuj
                  </button>
                )}
              </div>

              {/* Result toast (per-skill) — fades in after upgrade/unlock. */}
              {showResult && (
                <div className={`inventory__skills-card-toast inventory__skills-card-toast--${actionResult.ok ? 'ok' : 'fail'}`}>
                  {actionResult.msg}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Spec 5: Ulepsz modal — chest + gold cost preview, success-rate,
          confirm button. Spec 2: in-popup progress animation. Spec 3:
          skip-animation checkbox. Popup stays open until player closes
          it manually (Anuluj / Zamknij). */}
      {upgradeTarget && (() => {
        const skill = myActiveSkills.find((s) => s.id === upgradeTarget);
        if (!skill) return null;
        const currentLevel = skillUpgradeLevels[skill.id] ?? 0;
        const targetLevel = currentLevel + 1;
        const cost = getSpellChestUpgradeCost(targetLevel, skill.unlockLevel);
        const playerChests = getSpellChestCount(cost.chestLevel);
        const enoughChests = cost.chests === 0 || playerChests >= cost.chests;
        const enoughGold = gold >= cost.gold;
        const levelOk = character.level >= skill.unlockLevel;
        // canUpgrade is true in both 'idle' and 'done' phases — that
        // way the "done" state acts as a one-click "try again" button
        // (player no longer has to click "Ulepsz ponownie" to arm the
        // attempt + click again to fire it).
        const canUpgrade = enoughChests && enoughGold && levelOk && upgradePhase !== 'rolling';
        return (
          <div className="inventory__skills-swap" onClick={() => upgradePhase !== 'rolling' && closeUpgradeModal()}>
            <div className="inventory__skills-swap-modal" onClick={(e) => e.stopPropagation()}>
              <div className="inventory__skills-swap-title">
                <GameIcon name="wrench" /> Ulepsz: <strong>{skill.name_pl}</strong>
              </div>
              <div className="inventory__skills-swap-hint">
                +{currentLevel} <Icon name="arrowRight" /> +{targetLevel} · szansa <strong>{cost.successRate}%</strong>
              </div>
              <ul className="inventory__skills-cost-list">
                <li>Koszt gold: <strong style={{ color: enoughGold ? '#81c784' : '#ef5350' }}>{formatGoldShort(cost.gold)}</strong> (masz: {formatGoldShort(gold)})</li>
                {cost.chests > 0 && (
                  <li>
                    <TinyIcon icon={getSpellChestIcon(cost.chestLevel)} size={64} /> Spell Chest Lv{cost.chestLevel}: <strong style={{ color: enoughChests ? '#81c784' : '#ef5350' }}>{cost.chests}</strong> (masz: {playerChests})
                  </li>
                )}
                {!levelOk && (
                  <li style={{ color: '#ef5350' }}><GameIcon name="warning" /> Wymagany poziom <strong>{skill.unlockLevel}</strong> (masz {character.level})</li>
                )}
              </ul>

              {/* Spec 3: skip-animation toggle. */}
              <label className="inventory__skip-anim-toggle">
                <input
                  type="checkbox"
                  checked={skipUpgradeAnim}
                  onChange={(e) => setSkipUpgradeAnim(e.target.checked)}
                />
                <span>Wyłącz animację</span>
              </label>

              {/* Spec 2: rolling progress bar (1.8s). */}
              {upgradePhase === 'rolling' && (
                <div className="inventory__enhance-progress">
                  <div className="inventory__enhance-progress-bar" />
                  <span className="inventory__enhance-progress-text">Ulepszanie...</span>
                </div>
              )}

              {/* Spec 2: result panel — stays visible until the player
                  closes the modal. "Próbuj ponownie" lets them spam
                  attempts without re-opening from the card. */}
              {upgradePhase === 'done' && upgradeOutcome && (
                <div className={`inventory__skills-result inventory__skills-result--${upgradeOutcome.ok ? 'ok' : 'fail'}`}>
                  {upgradeOutcome.ok
                    ? <><GameIcon name="party-popper" /> Sukces! Skill ulepszony do <strong>+{upgradeOutcome.newLevel}</strong>.</>
                    : <><GameIcon name="broken-heart" /> Próba nie powiodła się. Materiały zostały zużyte.</>
                  }
                </div>
              )}

              <div className="inventory__skills-swap-actions">
                <button
                  type="button"
                  className="inventory__skills-swap-cancel"
                  onClick={closeUpgradeModal}
                  disabled={upgradePhase === 'rolling'}
                >
                  {upgradePhase === 'done' ? 'Zamknij' : 'Anuluj'}
                </button>
                <button
                  type="button"
                  className="inventory__skills-swap-confirm"
                  disabled={!canUpgrade}
                  onClick={() => {
                    // One-click upgrade — even from the 'done' phase
                    // we kick off another attempt directly. confirmUpgrade
                    // overwrites phase ('rolling' or jumps to 'done' if
                    // skipUpgradeAnim is on) so no manual reset needed.
                    confirmUpgrade(skill.id);
                  }}
                >
                  {upgradePhase === 'rolling'
                    ? <><GameIcon name="hourglass-not-done" /> Ulepszanie...</>
                    : <><GameIcon name="wrench" /> Ulepsz (+{targetLevel})</>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Spec 6: Odblokuj modal — same shape as Ulepsz. */}
      {unlockTarget && (() => {
        const skill = myActiveSkills.find((s) => s.id === unlockTarget);
        if (!skill) return null;
        const cost = getSpellChestUnlockCost(skill.unlockLevel);
        const playerChests = getSpellChestCount(cost.chestLevel);
        const enoughChests = playerChests >= cost.chests;
        const enoughGold = gold >= cost.gold;
        const canUnlock = enoughChests && enoughGold;
        return (
          <div className="inventory__skills-swap" onClick={() => setUnlockTarget(null)}>
            <div className="inventory__skills-swap-modal" onClick={(e) => e.stopPropagation()}>
              <div className="inventory__skills-swap-title">
                <GameIcon name="old-key" /> Odblokuj: <strong>{skill.name_pl}</strong>
              </div>
              <div className="inventory__skills-swap-hint">
                Skill Lv{skill.unlockLevel} — koszt jednorazowy.
              </div>
              <ul className="inventory__skills-cost-list">
                <li>Koszt gold: <strong style={{ color: enoughGold ? '#81c784' : '#ef5350' }}>{formatGoldShort(cost.gold)}</strong> (masz: {formatGoldShort(gold)})</li>
                <li>
                  <TinyIcon icon={getSpellChestIcon(cost.chestLevel)} size={64} /> Spell Chest Lv{cost.chestLevel}: <strong style={{ color: enoughChests ? '#81c784' : '#ef5350' }}>{cost.chests}</strong> (masz: {playerChests})
                </li>
              </ul>
              <div className="inventory__skills-swap-actions">
                <button
                  type="button"
                  className="inventory__skills-swap-cancel"
                  onClick={() => setUnlockTarget(null)}
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  className="inventory__skills-swap-confirm"
                  disabled={!canUnlock}
                  onClick={() => confirmUnlock(skill.id)}
                >
                  <GameIcon name="old-key" /> Odblokuj
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Spec 4: slot-swap modal — opened when player clicks an unequipped
          skill while all 4 slots are full. Pick a slot to replace. */}
      {swapTarget && (() => {
        const incoming = myActiveSkills.find((s) => s.id === swapTarget);
        if (!incoming) return null;
        return (
          <div className="inventory__skills-swap" onClick={() => setSwapTarget(null)}>
            <div className="inventory__skills-swap-modal" onClick={(e) => e.stopPropagation()}>
              <div className="inventory__skills-swap-title">
                Wymień skill — <strong>{incoming.name_pl}</strong>
              </div>
              <div className="inventory__skills-swap-hint">
                Wybierz slot do podmiany. Skill w klikniętym slocie zostanie zastąpiony.
              </div>
              <div className="inventory__skills-swap-slots">
                {activeSkillSlots.map((slotId, i) => {
                  const cur = myActiveSkills.find((s) => s.id === slotId);
                  const curIcon = cur ? getSkillIcon(cur.id) : '';
                  return (
                    <button
                      key={i}
                      type="button"
                      className="inventory__skills-swap-slot"
                      onClick={() => resolveSwap(i as 0 | 1 | 2 | 3)}
                    >
                      <span className="inventory__skills-swap-slot-label">Slot {i + 1}</span>
                      {cur ? (
                        <span className="inventory__skills-swap-slot-skill">
                          <TinyIcon icon={curIcon} size={28} />
                          <span>{cur.name_pl}</span>
                        </span>
                      ) : (
                        <span className="inventory__skills-swap-slot-empty">—</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="inventory__skills-swap-cancel"
                onClick={() => setSwapTarget(null)}
              >
                Anuluj
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
});
ActiveSkillsPopupBody.displayName = 'ActiveSkillsPopupBody';

// -- Spec 2: BUFF_CONFIG + isBuffEffect (module-level so the use-popup can
// reach them without recreating the table per render). Maps an elixir's
// `effect` field to the buff data the buffStore needs to spawn it.
interface IBuffConfig {
  id: string;
  name: string;
  icon: string;
  effect: string;
  durationMs: number;
  pausable?: boolean;
}
const BUFF_CONFIG: Record<string, IBuffConfig> = {
  'xp_boost_1h':                      { id: 'xp_boost',              name: 'XP +50%',         icon: 'star',  effect: 'xp_boost',              durationMs: 3600000, pausable: true },
  'xp_boost_100_1h':                  { id: 'xp_boost_100',          name: 'XP +100%',        icon: 'glowing-star', effect: 'xp_boost_100',          durationMs: 3600000, pausable: true },
  'skill_xp_boost_1h':                { id: 'skill_xp_boost',        name: 'Skill XP +50%',   icon: 'sparkles',  effect: 'skill_xp_boost',        durationMs: 3600000, pausable: true },
  'skill_xp_boost_100_1h':            { id: 'skill_xp_boost_100',    name: 'Skill XP +100%',  icon: 'bright-button', effect: 'skill_xp_boost_100',    durationMs: 3600000, pausable: true },
  'attack_speed_0.20_15m_pausable':   { id: 'attack_speed',          name: 'AS +20%',         icon: 'high-voltage',  effect: 'attack_speed',          durationMs: 900000,  pausable: true },
  'cooldown_reduction_0.20_30m':      { id: 'cooldown_reduction',    name: 'CD -20%',         icon: 'cyclone',  effect: 'cooldown_reduction',    durationMs: 1800000 },
  'hp_pct_25_15m':                    { id: 'hp_pct_25',             name: 'Max HP +25%',     icon: 'heart-on-fire', effect: 'hp_pct_25',     durationMs: 900000,  pausable: true },
  'mp_pct_25_15m':                    { id: 'mp_pct_25',             name: 'Max MP +25%',     icon: 'diamond-with-a-dot',  effect: 'mp_pct_25',             durationMs: 900000,  pausable: true },
  'offline_training_boost':           { id: 'offline_training_boost',name: 'Trening x2',      icon: 'person-lifting-weights', effect: 'offline_training_boost',durationMs: 3600000, pausable: true },
  'utamo_vita':                       { id: 'utamo_vita',            name: 'Utamo Vita',      icon: 'blue-circle',  effect: 'utamo_vita',            durationMs: 600000 },
  'premium_xp_boost':                 { id: 'premium_xp_boost',      name: 'Premium XP x2',   icon: 'gem-stone',  effect: 'premium_xp_boost',      durationMs: 43200000,pausable: true },
  'atk_dmg_25_15m':                   { id: 'atk_dmg_25',            name: 'ATK DMG +25%',    icon: 'crossed-swords',  effect: 'atk_dmg_25',            durationMs: 900000,  pausable: true },
  'atk_dmg_50_15m':                   { id: 'atk_dmg_50',            name: 'ATK DMG +50%',    icon: 'crossed-swords',  effect: 'atk_dmg_50',            durationMs: 900000,  pausable: true },
  'atk_dmg_100_15m':                  { id: 'atk_dmg_100',           name: 'ATK DMG +100%',   icon: 'crossed-swords',  effect: 'atk_dmg_100',           durationMs: 900000,  pausable: true },
  'spell_dmg_25_15m':                 { id: 'spell_dmg_25',          name: 'SPELL DMG +25%',  icon: 'crystal-ball',  effect: 'spell_dmg_25',          durationMs: 900000,  pausable: true },
  'spell_dmg_50_15m':                 { id: 'spell_dmg_50',          name: 'SPELL DMG +50%',  icon: 'crystal-ball',  effect: 'spell_dmg_50',          durationMs: 900000,  pausable: true },
  'spell_dmg_100_15m':                { id: 'spell_dmg_100',         name: 'SPELL DMG +100%', icon: 'crystal-ball',  effect: 'spell_dmg_100',         durationMs: 900000,  pausable: true },
  'hp_boost_500_15m':                 { id: 'hp_boost_500',          name: '+500 Max HP',     icon: 'drop-of-blood',  effect: 'hp_boost_500',          durationMs: 900000,  pausable: true },
  'mp_boost_500_15m':                 { id: 'mp_boost_500',          name: '+500 Max MP',     icon: 'large-blue-diamond',  effect: 'mp_boost_500',          durationMs: 900000,  pausable: true },
  'atk_boost_50_15m':                 { id: 'atk_boost_50',          name: '+50 ATK',         icon: 'flexed-biceps',  effect: 'atk_boost_50',          durationMs: 900000,  pausable: true },
  'def_boost_50_15m':                 { id: 'def_boost_50',          name: '+50 DEF',         icon: 'shield', effect: 'def_boost_50',          durationMs: 900000,  pausable: true },
};
const isBuffEffect = (effect: string): boolean => (
  effect === 'xp_boost_1h'
    || effect === 'xp_boost_100_1h'
    || effect === 'skill_xp_boost_1h'
    || effect === 'skill_xp_boost_100_1h'
    || effect.startsWith('attack_speed_')
    || effect.startsWith('cooldown_reduction_')
    || effect === 'offline_training_boost'
    || effect === 'utamo_vita'
    || effect === 'premium_xp_boost'
    || effect.startsWith('atk_dmg_')
    || effect.startsWith('spell_dmg_')
    || effect.startsWith('hp_boost_')
    || effect.startsWith('mp_boost_')
    || effect.startsWith('atk_boost_')
    || effect.startsWith('def_boost_')
    || effect.startsWith('hp_pct_')
    || effect.startsWith('mp_pct_')
);

// -- Main screen -------------------------------------------------------------
type BulkMode = 'none' | 'sell' | 'disassemble';

const Inventory = () => {
  const { bag, equipment, gold, sellMultiple, disassembleMultiple, consumables, stones, convertStones } = useInventoryStore();
  const {
    autoSellCommon, autoSellRare, autoSellEpic, autoSellLegendary, autoSellMythic,
    setAutoSellCommon, setAutoSellRare, setAutoSellEpic, setAutoSellLegendary, setAutoSellMythic,
    // Postać-spec item 9: auto-potion config now also lives in the merged
    // Postać view via the potion-icon popup. Pulled in here so the new
    // popup body can render the existing 4-slot panel without owning its
    // own store wiring.
    autoPotionHpEnabled, autoPotionMpEnabled,
    autoPotionHpThreshold, autoPotionMpThreshold,
    autoPotionHpId, autoPotionMpId,
    setAutoPotionHpEnabled, setAutoPotionMpEnabled,
    setAutoPotionHpThreshold, setAutoPotionMpThreshold,
    setAutoPotionHpId, setAutoPotionMpId,
    autoPotionPctHpEnabled, autoPotionPctMpEnabled,
    autoPotionPctHpThreshold, autoPotionPctMpThreshold,
    autoPotionPctHpId, autoPotionPctMpId,
    setAutoPotionPctHpEnabled, setAutoPotionPctMpEnabled,
    setAutoPotionPctHpThreshold, setAutoPotionPctMpThreshold,
    setAutoPotionPctHpId, setAutoPotionPctMpId,
  } = useSettingsStore();
  const character = useCharacterStore((s) => s.character);
  // 2026-05 v6: Postać view now hosts the stat-point distribution tiles
  // (above the Skille/Potion/Trening/Stats action row). The legacy /stats
  // page has been retired so every "+N statystyk do rozdania" call-to-action
  // lands here instead.
  // 2026-05 v6: stat-point spending — default is 1-pt per click; the
  // "wszystkie naraz" toggle below the tiles flips the click handler to
  // dump EVERY available point in one shot. Lets a careful player pace
  // their build but a power-leveler can clear hundreds of points fast.
  const spendStatPoint = useCharacterStore((s) => s.spendStatPoint);
  const spendAllStatPoints = useCharacterStore((s) => s.spendAllStatPoints);
  const [statAllocAllAtOnce, setStatAllocAllAtOnce] = useState(false);
  const completedTransforms = useTransformStore((s) => s.completedTransforms);
  const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
  const playerAvatarSrc = character ? getCharacterAvatar(character.class, completedTransforms) : '';

  // Transform color replaces class color everywhere the avatar accent appears
  // once the player completes their first transform tier.
  const transformColor = getHighestTransformColor();
  const classFallback = character ? (CLASS_AVATAR_COLORS[character.class] ?? '#e94560') : '#e94560';
  const accentColor = (() => {
    if (!transformColor) return classFallback;
    if (transformColor.solid) return transformColor.solid;
    if (transformColor.gradient) return transformColor.gradient[0];
    return classFallback;
  })();
  const accentColorRgb = hexToRgbAvatar(accentColor);
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>('all');
  const [slotFilter, setSlotFilter] = useState<TSlotFilter>('all');
  const [currentPage, setCurrentPage] = useState(0);
  const [selected, setSelected] = useState<{
    item: IInventoryItem;
    isEquipped: boolean;
    slot: EquipmentSlot | null;
  } | null>(null);

  // -- Stone conversion popup state ------------------------------------------
  const [stoneConvertId, setStoneConvertId] = useState<string | null>(null);
  // Postać-spec items 4, 5, 7-10: single state machine for the row of icons
  // under the paperdoll. Only one popup is open at a time; null = closed.
  // 'avatar' is opened by clicking the avatar itself (item 4); the other
  // four are the icon row (item 5).
  const [popupKey, setPopupKey] = useState<
    null | 'avatar' | 'stats' | 'training' | 'potion' | 'skills'
  >(null);
  // Spec 13c: Auto-potion popup gets a 2-tab layout — Auto (the existing
  // 4-slot threshold panel) and Alchemia (potion conversion). Tab state
  // lives outside `popupKey` so we can deep-open the alchemia tab from a
  // potion-tile click in the consumables grid (spec 13b).
  const [potionTab, setPotionTab] = useState<'auto' | 'alchemy'>('auto');
  const closePopup = () => setPopupKey(null);
  // Helper used by the consumables grid to deep-link a potion click
  // straight into the alchemia tab so the player lands where they can
  // convert/use the stack.
  const openPotionAlchemy = useCallback(() => {
    setPotionTab('alchemy');
    setPopupKey('potion');
  }, []);
  const [stoneConvertResult, setStoneConvertResult] = useState<'success' | 'fail' | null>(null);

  const handleStoneConvert = useCallback((stoneId: string) => {
    const success = convertStones(stoneId);
    setStoneConvertResult(success ? 'success' : 'fail');
    setTimeout(() => setStoneConvertResult(null), 2000);
  }, [convertStones]);

  // -- Alchemy (potion conversion) state -------------------------------------
  // `alchemyOpen` retired — the Alchemia surface now lives inside the
  // Potion popup (spec 13c) so it doesn't need its own collapsed/open
  // state in the main view.
  const [alchemyToast, setAlchemyToast] = useState<string | null>(null);
  // Spec 2 (2026-05): per-potion use popup. When `usePotionId` is set we
  // render a confirm-modal asking how many doses to drink (1, 5, MAX, or
  // "auto-fill HP/MP up to max") before actually consuming the stack.
  const [usePotionId, setUsePotionId] = useState<string | null>(null);
  const [usePotionAmount, setUsePotionAmount] = useState<number>(1);

  // Spec 2: applies one dose of the elixir, mirroring the legacy
  // consumables-section logic (heal HP/MP, activate buff, stat reset).
  // Returns true on success so the popup can decide whether to close.
  const applyElixirDose = useCallback((elixirId: string): boolean => {
    const elixir = ELIXIRS.find((e) => e.id === elixirId);
    if (!elixir) return false;
    const currentCount = useInventoryStore.getState().consumables[elixirId] ?? 0;
    if (currentCount <= 0) return false;
    const effect = elixir.effect;

    // 1. Stat reset (special: confirm + reset stat points)
    if (effect === 'stat_reset') {
      handleStatReset();
      return true;
    }
    // 2026-05-08: Eliksir Siły — combined +50 ATK + +50 DEF buff. Spec
    // says "+50 atk DEF koszt 80k" -> one purchase, two buffs. The
    // BUFF_CONFIG can't model a one-effect->two-buffs relation cleanly,
    // so we fan out manually here before the generic isBuffEffect path.
    if (effect === 'atk_def_boost_50_15m') {
      const dur = 900000; // 15 min
      // 2026-05-08: prefer the new elixir art (eliksir-sily.png) for
      // both halves of this combined buff. Falls back to emoji when
      // no PNG exists in the registry.
      const sily = getElixirImage('atk_boost_50') ?? getElixirImage('atk_boost_elixir');
      useBuffStore.getState().addPausableBuff(
        { id: 'atk_boost_50', name: '+50 ATK', icon: sily ?? 'flexed-biceps', effect: 'atk_boost_50' },
        dur,
      );
      useBuffStore.getState().addPausableBuff(
        { id: 'def_boost_50', name: '+50 DEF', icon: sily ?? 'shield', effect: 'def_boost_50' },
        dur,
      );
      useInventoryStore.getState().addConsumable(elixirId, -1);
      return true;
    }
    // 2. Buff elixirs (XP, AS, premium, etc)
    if (isBuffEffect(effect)) {
      const cfg = BUFF_CONFIG[effect];
      if (!cfg) return false;
      // 2026-05-08: lift the active-buff icon to the new PNG when
      // available — the BuffBar / BuffPopover both render via
      // <TinyIcon> which understands URL icons. Fall back to the
      // emoji declared in BUFF_CONFIG when no art is registered.
      const artIcon = getElixirImage(cfg.effect) ?? getElixirImage(elixirId) ?? cfg.icon;
      const buffData = { id: cfg.id, name: cfg.name, icon: artIcon, effect: cfg.effect };
      if (cfg.pausable) {
        useBuffStore.getState().addPausableBuff(buffData, cfg.durationMs);
      } else {
        useBuffStore.getState().addBuff(buffData, cfg.durationMs);
      }
      useInventoryStore.getState().addConsumable(elixirId, -1);
      // Max HP/MP elixirs: heal up to the new effective cap.
      if (cfg.effect === 'hp_boost_500' || cfg.effect === 'hp_pct_25'
          || cfg.effect === 'mp_boost_500' || cfg.effect === 'mp_pct_25') {
        const freshChar = useCharacterStore.getState().character;
        if (freshChar) {
          const eff = engineGetEffectiveChar(freshChar);
          const newMaxHp = eff?.max_hp ?? freshChar.max_hp;
          const newMaxMp = eff?.max_mp ?? freshChar.max_mp;
          useCharacterStore.getState().updateCharacter({ hp: newMaxHp, mp: newMaxMp });
        }
      }
      return true;
    }
    // 3. HP/MP heal potions (heal_hp_X, heal_mp_X, heal_hp_pct_X, heal_mp_pct_X)
    const isHp = effect.startsWith('heal_hp');
    const isMp = effect.startsWith('heal_mp');
    if (isHp || isMp) {
      const freshChar = useCharacterStore.getState().character;
      if (!freshChar) return false;
      const eff = engineGetEffectiveChar(freshChar);
      const curMaxHp = eff?.max_hp ?? freshChar.max_hp;
      const curMaxMp = eff?.max_mp ?? freshChar.max_mp;
      // Refuse if already full (avoid wasting a potion)
      if (isHp && freshChar.hp >= curMaxHp) return false;
      if (isMp && freshChar.mp >= curMaxMp) return false;
      let healAmount = 0;
      if (isHp) {
        const flatMatch = effect.match(/^heal_hp_(\d+)$/);
        const pctMatch  = effect.match(/^heal_hp_pct_(\d+)$/);
        if (flatMatch) healAmount = parseInt(flatMatch[1], 10);
        else if (pctMatch) healAmount = Math.floor(curMaxHp * parseInt(pctMatch[1], 10) / 100);
        const newHp = Math.min(curMaxHp, freshChar.hp + healAmount);
        useCharacterStore.getState().updateCharacter({ hp: newHp });
      } else {
        const flatMatch = effect.match(/^heal_mp_(\d+)$/);
        const pctMatch  = effect.match(/^heal_mp_pct_(\d+)$/);
        if (flatMatch) healAmount = parseInt(flatMatch[1], 10);
        else if (pctMatch) healAmount = Math.floor(curMaxMp * parseInt(pctMatch[1], 10) / 100);
        const newMp = Math.min(curMaxMp, freshChar.mp + healAmount);
        useCharacterStore.getState().updateCharacter({ mp: newMp });
      }
      useInventoryStore.getState().addConsumable(elixirId, -1);
      return true;
    }
    return false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply N doses sequentially. Stops early if a dose fails (e.g. HP full).
  const useElixirN = useCallback((elixirId: string, n: number): number => {
    let used = 0;
    for (let i = 0; i < n; i++) {
      if (!applyElixirDose(elixirId)) break;
      used++;
    }
    return used;
  }, [applyElixirDose]);

  // For HP/MP potions: drink as many as needed to fill HP (or until empty).
  const useElixirToFull = useCallback((elixirId: string): number => {
    const elixir = ELIXIRS.find((e) => e.id === elixirId);
    if (!elixir) return 0;
    const isHp = elixir.effect.startsWith('heal_hp');
    const isMp = elixir.effect.startsWith('heal_mp');
    if (!isHp && !isMp) return 0;
    let used = 0;
    while (true) {
      const stack = useInventoryStore.getState().consumables[elixirId] ?? 0;
      if (stack <= 0) break;
      const ch = useCharacterStore.getState().character;
      if (!ch) break;
      const eff = engineGetEffectiveChar(ch);
      const maxHp = eff?.max_hp ?? ch.max_hp;
      const maxMp = eff?.max_mp ?? ch.max_mp;
      if (isHp && ch.hp >= maxHp) break;
      if (isMp && ch.mp >= maxMp) break;
      if (!applyElixirDose(elixirId)) break;
      used++;
      if (used > 999) break; // safety
    }
    return used;
  }, [applyElixirDose]);
  const [alchemyAmounts, setAlchemyAmounts] = useState<Record<string, number>>({});

  const getAlchemyKey = (conv: { family: string; tier: number }) => `${conv.family}-${conv.tier}`;

  const handlePotionConvert = useCallback((inputId: string, outputId: string, outputName: string, inputCount: number, batches: number) => {
      if (batches <= 0) return;
      const inv = useInventoryStore.getState();
      const owned = inv.consumables[inputId] ?? 0;
      const totalNeeded = inputCount * batches;
      if (owned < totalNeeded) return;
      inv.addConsumable(inputId, -totalNeeded);
      inv.addConsumable(outputId, batches);
      setAlchemyToast(`Przetworzono: +${batches} ${outputName}`);
      setTimeout(() => setAlchemyToast(null), 2200);
  }, []);

  // -- Multi-sell / disassemble state -----------------------------------------
  const [bulkMode, setBulkMode] = useState<BulkMode>('none');
  const multiSellMode = bulkMode !== 'none';
  const [selectedUuids, setSelectedUuids] = useState<Set<string>>(new Set());

  // -- Disassemble animation state --------------------------------------------
  const [disassembleAnimating, setDisassembleAnimating] = useState(false);
  const [disassembleProgress, setDisassembleProgress] = useState(0);
  const [disassembleTotalItems, setDisassembleTotalItems] = useState(0);
  const [disassembleCurrentItem, setDisassembleCurrentItem] = useState<string | null>(null);

  // Point 3: stable reference so memoized BagTile doesn't re-render when
  // unrelated parent state (DetailPanel open, stone popup, etc.) changes.
  // The ref pattern keeps the callback identity stable across bulkMode changes
  // — only re-renders of BagTile will be driven by its own props (isChecked /
  // multiSellMode), not by callback identity churn.
  // NOTE: the selection-toggle logic is inlined here (rather than extracted
  // into a separate callback declared later in the component) so the deps
  // array never references a not-yet-initialised binding (TDZ at mount).
  const bulkModeRef = useRef(bulkMode);
  bulkModeRef.current = bulkMode;
  const selectBagItem = useCallback((item: IInventoryItem) => {
    if (bulkModeRef.current !== 'none') {
      setSelectedUuids((prev) => {
        const next = new Set(prev);
        if (next.has(item.uuid)) {
          next.delete(item.uuid);
        } else {
          next.add(item.uuid);
        }
        return next;
      });
      return;
    }
    setSelected({ item, isEquipped: false, slot: null });
  }, []);

  const selectEquippedItem = (item: IInventoryItem, slot: EquipmentSlot) =>
    setSelected({ item, isEquipped: true, slot });

  // Keep selected item in sync with store (after upgrade, sell, etc.)
  // Track whether disassemble is active to prevent premature panel close
  const [disassembleActive, setDisassembleActive] = useState(false);

  const freshSelected = useMemo(() => {
    if (!selected) return null;
    const uuid = selected.item.uuid;
    if (selected.isEquipped && selected.slot) {
      const eqItem = equipment[selected.slot];
      if (eqItem && eqItem.uuid === uuid) {
        return { ...selected, item: eqItem };
      }
      // Item was unequipped or replaced
      return null;
    }
    const bagItem = bag.find((i) => i.uuid === uuid);
    if (bagItem) {
      return { ...selected, item: bagItem };
    }
    // Item was sold or removed — but keep panel open during disassemble
    if (disassembleActive) return selected;
    return null;
  }, [selected, bag, equipment, disassembleActive]);

  const RARITY_SORT_ORDER: Record<string, number> = {
    heroic: 6, mythic: 5, legendary: 4, epic: 3, rare: 2, common: 1,
  };
  const sortedBag = useMemo(() => {
    const copy = [...bag];
    copy.sort((a, b) => {
      // Sort by item level DESC first
      const lvlDiff = (b.itemLevel || 1) - (a.itemLevel || 1);
      if (lvlDiff !== 0) return lvlDiff;
      // Then by rarity DESC
      return (RARITY_SORT_ORDER[b.rarity] ?? 0) - (RARITY_SORT_ORDER[a.rarity] ?? 0);
    });
    return copy;
  }, [bag]); // eslint-disable-line react-hooks/exhaustive-deps
  const filteredBag = useMemo(() => {
    let out = sortedBag;
    if (rarityFilter !== 'all') {
      out = out.filter((i) => i.rarity === rarityFilter);
    }
    if (slotFilter !== 'all') {
      out = out.filter((i) => {
        const slot = getItemSlotSafe(i.itemId, ALL_ITEMS);
        if (!slot) return false;
        // 2026-05-08: `armor` is now ONLY the chest-armor slot per
        // spec — no longer a coarse "any armor piece" group. Helmet,
        // pants, gloves, etc. each have their own pill.
        if (slotFilter === 'weapons') return slot === 'mainHand' || slot === 'offHand';
        if (slotFilter === 'jewelry') return slot === 'ring1' || slot === 'ring2' || slot === 'necklace' || slot === 'earrings';
        // ring1 filter matches both ring1 and ring2
        if (slotFilter === 'ring1')   return slot === 'ring1' || slot === 'ring2';
        return slot === slotFilter;
      });
    }
    return out;
  }, [sortedBag, rarityFilter, slotFilter]);

  // -- Spec 4: stackable items as bag tiles ----------------------------------
  // Potions, spell chests and enhancement stones used to live in their own
  // sections (Potiony i Eliksiry / Spell Chesty / Kamienie). The 2026-05
  // spec folds them into the bag grid as "stack tiles" — one tile per
  // distinct stack with a count badge. Each click opens the appropriate
  // popup (potion -> potion popup -> alchemia tab; chest -> skills popup;
  // stone -> stone conversion popup).
  interface IStackTile {
    id: string;
    icon: string;
    name: string;
    count: number;
    rarity: Rarity;
    type: 'potion' | 'chest' | 'stone';
    onClick: () => void;
  }
  const stackTiles = useMemo<IStackTile[]>(() => {
    const tiles: IStackTile[] = [];
    // Potion / elixir stacks — every owned consumable from ELIXIRS list.
    for (const elixir of ELIXIRS) {
      const count = consumables[elixir.id] ?? 0;
      if (count <= 0) continue;
      // 2026-05 spec: HP/MP potion tiers cycle the rarity ladder so the
      // bag visually scales with the potion's strength:
      //   - sm  / md       -> common  (gray)
      //   - lg  / great    -> rare    (blue)
      //   - super          -> epic    (green)
      //   - ultimate       -> legendary (red)
      //   - divine         -> mythic  (yellow)
      //   - mega           -> heroic  (purple)
      // Buff elixirs keep the legacy "epic by default, legendary for
      // premium / +100% combat boosts" rule.
      const fx = elixir.effect ?? '';
      const id = elixir.id;
      const POTION_TIER_RARITY: Record<string, Rarity> = {
        // HP
        hp_potion_sm: 'common', hp_potion_md: 'common',
        hp_potion_lg: 'rare',   hp_potion_great: 'rare',
        hp_potion_super: 'epic',
        hp_potion_ultimate: 'legendary',
        hp_potion_divine: 'mythic',
        hp_potion_mega: 'heroic',
        // MP — same ladder
        mp_potion_sm: 'common', mp_potion_md: 'common',
        mp_potion_lg: 'rare',   mp_potion_great: 'rare',
        mp_potion_super: 'epic',
        mp_potion_ultimate: 'legendary',
        mp_potion_divine: 'mythic',
        mp_potion_mega: 'heroic',
      };
      let rarity: Rarity = 'common';
      if (POTION_TIER_RARITY[id]) {
        rarity = POTION_TIER_RARITY[id];
      } else if (fx === 'premium_xp_boost' || /_dmg_100_/.test(fx)) {
        rarity = 'legendary';
      } else if (fx.startsWith('atk_dmg_') || fx.startsWith('spell_dmg_') || fx.includes('boost_') || fx.includes('pct_25')) {
        rarity = 'epic';
      }
      tiles.push({
        id: `potion-${elixir.id}`,
        icon: elixir.icon,
        name: elixir.name_pl,
        count,
        rarity,
        type: 'potion',
        // Spec 2: click pops the per-potion use confirm modal first
        // (rather than activating immediately) so the player can pick
        // how many doses to drink, or fill to max HP/MP.
        onClick: () => { setUsePotionId(elixir.id); setUsePotionAmount(1); },
      });
    }
    // Spell chest stacks — keys like `spell_chest_1`, `spell_chest_2`...
    // 2026-05 spec: chest rarity follows the 15-tier art ladder so the
    // border colour matches the chest art itself (1-4 gray / 5-8 blue /
    // 9-10 green / 11-12 red / 13-14 yellow / 15 purple). Mapping uses
    // the game's chest-level -> art-tier table from spriteAssets.
    const CHEST_LEVEL_TO_TIER_INV: Record<number, number> = {
      5: 1, 10: 2, 20: 3, 30: 4, 40: 5, 50: 6, 60: 7, 70: 8,
      80: 9, 100: 10, 150: 11, 300: 12, 600: 13, 800: 14, 1000: 15,
    };
    const CHEST_TIER_RARITY: Record<number, Rarity> = {
      1: 'common',  2: 'common', 3: 'common',  4: 'common',
      5: 'rare',    6: 'rare',   7: 'rare',    8: 'rare',
      9: 'epic',    10: 'epic',
      11: 'legendary', 12: 'legendary',
      13: 'mythic', 14: 'mythic',
      15: 'heroic',
    };
    for (const [key, rawCount] of Object.entries(consumables)) {
      if (!key.startsWith('spell_chest_')) continue;
      const count = rawCount ?? 0;
      if (count <= 0) continue;
      const level = parseInt(key.replace('spell_chest_', ''), 10) || 0;
      const tier = CHEST_LEVEL_TO_TIER_INV[level] ?? 15;
      const rarity: Rarity = CHEST_TIER_RARITY[tier] ?? 'common';
      tiles.push({
        id: `chest-${key}`,
        icon: getSpellChestIcon(level),
        name: getSpellChestDisplayName(level),
        count,
        rarity,
        type: 'chest',
        onClick: () => setPopupKey('skills'),
      });
    }
    // Stone stacks — one per rarity tier (only show non-zero stacks).
    for (const rarity of RARITY_ORDER) {
      const stoneId = STONE_FOR_RARITY[rarity];
      const count = stones[stoneId] ?? 0;
      if (count <= 0) continue;
      tiles.push({
        id: `stone-${stoneId}`,
        icon: STONE_ICONS[stoneId] ?? 'gem-stone',
        name: STONE_NAMES[stoneId] ?? stoneId,
        count,
        rarity,
        type: 'stone',
        onClick: () => setStoneConvertId(stoneId),
      });
    }
    return tiles;
  }, [consumables, stones]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter stack tiles based on the active slotFilter. 'all' shows all,
  // 'potions'/'chests'/'stones' shows only that type, any other slot
  // filter hides them entirely (the player narrowed to gear-only).
  const filteredStackTiles = useMemo<IStackTile[]>(() => {
    if (rarityFilter !== 'all') return []; // rarity filter hides stacks
    if (slotFilter === 'all') return stackTiles;
    if (slotFilter === 'potions') return stackTiles.filter((t) => t.type === 'potion');
    if (slotFilter === 'chests') return stackTiles.filter((t) => t.type === 'chest');
    if (slotFilter === 'stones') return stackTiles.filter((t) => t.type === 'stone');
    return [];
  }, [stackTiles, slotFilter, rarityFilter]);

  // -- Pagination -------------------------------------------------------------
  const totalPages = Math.max(1, Math.ceil(filteredBag.length / PAGE_SIZE));
  // Clamp current page when filters shrink the list
  const safePage = Math.min(currentPage, totalPages - 1);
  const pagedBag = useMemo(
    () => filteredBag.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [filteredBag, safePage],
  );
  // Reset to page 0 whenever filters change
  const prevFilterKey = useRef(`${rarityFilter}:${slotFilter}`);
  if (prevFilterKey.current !== `${rarityFilter}:${slotFilter}`) {
    prevFilterKey.current = `${rarityFilter}:${slotFilter}`;
    if (currentPage !== 0) {
      // Defer state update so React doesn't complain about setting during render
      queueMicrotask(() => setCurrentPage(0));
    }
  }

  // -- Multi-sell helpers ------------------------------------------------------

  const selectAll = useCallback(() => {
    setSelectedUuids(new Set(filteredBag.map((i) => i.uuid)));
  }, [filteredBag]);

  const deselectAll = useCallback(() => {
    setSelectedUuids(new Set());
  }, []);

  const selectByRarity = useCallback((rarity: Rarity) => {
    const matching = bag.filter((i) => i.rarity === rarity).map((i) => i.uuid);
    setSelectedUuids((prev) => {
      const next = new Set(prev);
      for (const uuid of matching) {
        next.add(uuid);
      }
      return next;
    });
  }, [bag]);

  const multiSellSummary = useMemo(() => {
    const items = bag.filter((i) => selectedUuids.has(i.uuid));
    const totalGold = items.reduce((sum, item) => sum + getItemSellPrice(item), 0);
    return { count: items.length, totalGold };
  }, [bag, selectedUuids]);

  const handleMultiSell = () => {
    if (selectedUuids.size === 0) return;
    sellMultiple(Array.from(selectedUuids), getItemSellPrice);
    setSelectedUuids(new Set());
    setBulkMode('none');
  };

  // -- Mass Disassemble (dedicated mode with animation) -----------------------
  const [bulkDisassembleResult, setBulkDisassembleResult] = useState<{
    total: number; stones: Record<string, number>;
  } | null>(null);

  const handleMassDisassemble = () => {
    if (selectedUuids.size === 0 || disassembleAnimating) return;
    const itemsToDisassemble = bag.filter((i) => selectedUuids.has(i.uuid));
    const totalCount = itemsToDisassemble.length;
    if (totalCount === 0) return;

    setDisassembleAnimating(true);
    setDisassembleProgress(0);
    setDisassembleTotalItems(totalCount);

    // Point 4: fixed ~1200ms total animation driven by requestAnimationFrame.
    // The previous impl used per-item setTimeout chains — browsers clamp nested
    // timers to ~4ms so 500+ item batches took 10s+, and every tick re-rendered
    // the whole 3500-tile grid. rAF syncs to the display's refresh rate, caps
    // the render spam at ~60 updates/s, and finishes in a predictable window.
    const TOTAL_ANIM_MS = 1200;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / TOTAL_ANIM_MS);
      const processed = Math.min(totalCount, Math.ceil(progress * totalCount));
      setDisassembleProgress(processed);
      // Cycle the "current item" label at ~6 steps/s so it reads as motion
      // rather than an unreadable blur.
      const stepIdx = Math.min(
        totalCount - 1,
        Math.floor((elapsed / 160) % Math.max(1, totalCount)),
      );
      const stepItem = itemsToDisassemble[stepIdx];
      if (stepItem) setDisassembleCurrentItem(stepItem.uuid);

      if (progress < 1) {
        requestAnimationFrame(tick);
        return;
      }

      // Animation complete — do the actual disassemble in ONE store update.
      const stonesEarned = disassembleMultiple(
        Array.from(selectedUuids),
        (item: IInventoryItem) => item.rarity,
      );
      setTimeout(() => {
        setDisassembleAnimating(false);
        setDisassembleProgress(0);
        setDisassembleTotalItems(0);
        setDisassembleCurrentItem(null);
        setBulkDisassembleResult({ total: totalCount, stones: stonesEarned });
        setSelectedUuids(new Set());
        setBulkMode('none');
      }, 250);
    };

    requestAnimationFrame(tick);
  };

  // -- Disassemble summary for footer -----------------------------------------
  const disassembleSummary = useMemo(() => {
    if (bulkMode !== 'disassemble') return { count: 0, stonesByRarity: {} as Record<string, number> };
    const items = bag.filter((i) => selectedUuids.has(i.uuid));
    const stonesByRarity: Record<string, number> = {};
    for (const item of items) {
      const stoneId = STONE_FOR_RARITY[item.rarity as Rarity] ?? 'common_stone';
      stonesByRarity[stoneId] = (stonesByRarity[stoneId] ?? 0) + 1;
    }
    return { count: items.length, stonesByRarity };
  }, [bag, selectedUuids, bulkMode]);

  const exitMultiSell = () => {
    setBulkMode('none');
    setSelectedUuids(new Set());
  };

  // Postać-spec item 9: derived helpers for the auto-potion popup body.
  // Same shape CharacterStats uses — kept inline (rather than in a hook)
  // because it's a few cheap finds/divisions and avoids cross-file churn
  // until the dedicated AutoPotionPanel component lands.
  const flatHpSliderPct = (autoPotionHpThreshold / 99) * 100;
  const flatMpSliderPct = (autoPotionMpThreshold / 99) * 100;
  const pctHpSliderPct = (autoPotionPctHpThreshold / 99) * 100;
  const pctMpSliderPct = (autoPotionPctMpThreshold / 99) * 100;
  const selectedFlatHpPotion = ELIXIRS.find((e) => e.id === autoPotionHpId);
  const selectedFlatMpPotion = ELIXIRS.find((e) => e.id === autoPotionMpId);
  const selectedPctHpPotion = ELIXIRS.find((e) => e.id === autoPotionPctHpId);
  const selectedPctMpPotion = ELIXIRS.find((e) => e.id === autoPotionPctMpId);
  const flatHpPotionCount = consumables[autoPotionHpId] ?? 0;
  const flatMpPotionCount = consumables[autoPotionMpId] ?? 0;
  const pctHpPotionCount = consumables[autoPotionPctHpId] ?? 0;
  const pctMpPotionCount = consumables[autoPotionPctMpId] ?? 0;

  return (
    <div
      className="inventory"
      style={{
        // Spec 2: every "selected" surface in this view (multi-select tiles,
        // slot filter active state, "Zaznacz wszystkie" pill, etc.) reads in
        // the player's live transform colour. Dropping the var on the root
        // means every nested rule can pick it up via `var(--tx-accent)`.
        '--tx-accent': accentColor,
        '--tx-accent-rgb': accentColorRgb,
      } as React.CSSProperties}
    >
      {/* Postać-spec items 1 + 3: the old page header (back button + ":backpack:
          Ekwipunek" title + gold pill) is gone. The Postać tab now lands
          straight on this view, so a redundant header would just push the
          paperdoll down. Gold and navigation live in the bottom nav and
          the paperdoll chrome. */}

      {/* -- Paperdoll: avatar + equipment overlay ----------------------- */}
      {character && (() => {
          const eff = engineGetEffectiveChar(character);
          const effMaxHp = eff?.max_hp ?? character.max_hp;
          const effMaxMp = eff?.max_mp ?? character.max_mp;
          const hpPct = Math.max(0, Math.min(100, (character.hp / Math.max(1, effMaxHp)) * 100));
          const mpPct = Math.max(0, Math.min(100, (character.mp / Math.max(1, effMaxMp)) * 100));
          return (
              <div
                  className="inventory__paperdoll"
                  style={{
                      '--avatar-class-color': accentColor,
                      '--avatar-class-rgb': accentColorRgb,
                  } as React.CSSProperties}
              >
                  <div className="inventory__paperdoll-bars">
                      <div className="inventory__paperdoll-bar inventory__paperdoll-bar--hp">
                          <span className="inventory__paperdoll-bar-label">HP</span>
                          <div className="inventory__paperdoll-bar-track">
                              <div className="inventory__paperdoll-bar-fill" style={{ width: `${hpPct}%` }} />
                          </div>
                          <span className="inventory__paperdoll-bar-value">{character.hp}/{effMaxHp}</span>
                      </div>
                      <div className="inventory__paperdoll-bar inventory__paperdoll-bar--mp">
                          <span className="inventory__paperdoll-bar-label">MP</span>
                          <div className="inventory__paperdoll-bar-track">
                              <div className="inventory__paperdoll-bar-fill" style={{ width: `${mpPct}%` }} />
                          </div>
                          <span className="inventory__paperdoll-bar-value">{character.mp}/{effMaxMp}</span>
                      </div>
                  </div>

                  <div className="inventory__paperdoll-stage">
                      {/* Postać-spec item 4: avatar is now a button —
                          clicking opens the zoom popup with the enlarged
                          portrait + name + class + level. */}
                      <button
                          type="button"
                          className="inventory__paperdoll-avatar inventory__paperdoll-avatar--clickable"
                          onClick={() => setPopupKey('avatar')}
                          aria-label={`Powiększ awatar — ${character.class}`}
                      >
                          <img
                              src={playerAvatarSrc}
                              alt={character.class}
                              className="inventory__paperdoll-avatar-img"
                          />
                          <div className="inventory__paperdoll-avatar-overlay">
                              <span className="inventory__paperdoll-avatar-name">{character.class}</span>
                              <span className="inventory__paperdoll-avatar-level">Lvl {character.level}</span>
                          </div>
                      </button>

                      {EQUIPMENT_SLOTS.map((slot) => {
                          const item = equipment[slot];
                          const color = item ? RARITY_COLORS[item.rarity] : undefined;
                          return (
                              <button
                                  key={slot}
                                  className={`inventory__doll-slot inventory__doll-slot--${slot}${item ? ' inventory__doll-slot--filled' : ' inventory__doll-slot--empty'}`}
                                  style={color ? ({ '--rarity-color': color } as React.CSSProperties) : undefined}
                                  onClick={() => item && selectEquippedItem(item, slot)}
                                  aria-label={SLOT_LABELS[slot]}
                              >
                                  {/* Spec 1 (2026-05): empty slots render nothing —
                                      no fallback emoji glyph. The slot frame still
                                      reserves space so the paperdoll grid stays
                                      stable, but the dimmed icon placeholder is
                                      gone per the cleaner-look spec. */}
                                  {item && (
                                      <ItemIcon
                                          icon={slotEmoji(item.itemId)}
                                          rarity={item.rarity}
                                          upgradeLevel={item.upgradeLevel}
                                          itemLevel={item.itemLevel || 1}
                                          size="md"
                                          showTooltip={false}
                                      />
                                  )}
                              </button>
                          );
                      })}
                  </div>

                  {/* 2026-05 v6: stat-point distribution tiles. Visible
                      ONLY when `character.stat_points > 0`. By default a
                      click spends ONE point (matching the legacy /stats
                      flow so a careful player can split the build). The
                      "wszystkie naraz" checkbox flips the click handler
                      to `spendAllStatPoints` so a power-leveler can dump
                      hundreds of points in 4 clicks. The four stats
                      mirror `STAT_POINT_BONUSES` in characterStore:
                      HP/MP +5 each, ATK/DEF +1 each. */}
                  {character && (character.stat_points ?? 0) > 0 && (() => {
                      const pts = character.stat_points ?? 0;
                      // When the toggle is on the tile bonus shows the
                      // FULL spend (×N); otherwise just the per-click
                      // increment so the number matches what one tap does.
                      const hpBonus = statAllocAllAtOnce ? pts * 5 : 5;
                      const mpBonus = statAllocAllAtOnce ? pts * 5 : 5;
                      const atkBonus = statAllocAllAtOnce ? pts : 1;
                      const defBonus = statAllocAllAtOnce ? pts : 1;
                      const tooltip = (statName: string, bonus: number, unit: string) =>
                          statAllocAllAtOnce
                              ? `Włóż wszystkie ${pts} pkt w ${statName} (+${bonus} ${unit})`
                              : `Włóż 1 pkt w ${statName} (+${bonus} ${unit})`;
                      const handleClick = (stat: 'max_hp' | 'max_mp' | 'attack' | 'defense') =>
                          statAllocAllAtOnce ? spendAllStatPoints(stat) : spendStatPoint(stat);
                      return (
                          <div className="inventory__stat-alloc">
                              <div className="inventory__stat-alloc-header">
                                  <span className="inventory__stat-alloc-title">Punkty do rozdania</span>
                                  <span className="inventory__stat-alloc-count">{pts}</span>
                              </div>
                              <label className="inventory__stat-alloc-toggle">
                                  <input
                                      type="checkbox"
                                      checked={statAllocAllAtOnce}
                                      onChange={(e) => setStatAllocAllAtOnce(e.target.checked)}
                                  />
                                  <span>Rozdaj wszystkie naraz jednym kliknięciem</span>
                              </label>
                              <div className="inventory__stat-alloc-grid">
                                  <button
                                      type="button"
                                      className="inventory__stat-alloc-tile"
                                      onClick={() => handleClick('max_hp')}
                                      title={tooltip('HP', hpBonus, 'HP')}
                                  >
                                      <span className="inventory__stat-alloc-tile-icon"><GameIcon name="red-heart" /></span>
                                      <span className="inventory__stat-alloc-tile-name">HP</span>
                                      <span className="inventory__stat-alloc-tile-bonus">+{hpBonus}</span>
                                  </button>
                                  <button
                                      type="button"
                                      className="inventory__stat-alloc-tile"
                                      onClick={() => handleClick('max_mp')}
                                      title={tooltip('MP', mpBonus, 'MP')}
                                  >
                                      <span className="inventory__stat-alloc-tile-icon"><GameIcon name="droplet" /></span>
                                      <span className="inventory__stat-alloc-tile-name">MP</span>
                                      <span className="inventory__stat-alloc-tile-bonus">+{mpBonus}</span>
                                  </button>
                                  <button
                                      type="button"
                                      className="inventory__stat-alloc-tile"
                                      onClick={() => handleClick('attack')}
                                      title={tooltip('Atak', atkBonus, 'ATK')}
                                  >
                                      <span className="inventory__stat-alloc-tile-icon"><GameIcon name="crossed-swords" /></span>
                                      <span className="inventory__stat-alloc-tile-name">Atak</span>
                                      <span className="inventory__stat-alloc-tile-bonus">+{atkBonus}</span>
                                  </button>
                                  <button
                                      type="button"
                                      className="inventory__stat-alloc-tile"
                                      onClick={() => handleClick('defense')}
                                      title={tooltip('Obrona', defBonus, 'DEF')}
                                  >
                                      <span className="inventory__stat-alloc-tile-icon"><GameIcon name="shield" /></span>
                                      <span className="inventory__stat-alloc-tile-name">Obrona</span>
                                      <span className="inventory__stat-alloc-tile-bonus">+{defBonus}</span>
                                  </button>
                              </div>
                          </div>
                      );
                  })()}

                  {/* Postać-spec item 5: four-icon action row under the
                      paperdoll. Stats / Training / Skills currently route
                      to the existing pages — they'll convert to in-place
                      popups once the derivation hook lands. The Potion
                      icon already opens its dedicated popup right here. */}
                  <div className="inventory__paperdoll-actions">
                      <button
                          type="button"
                          className="inventory__paperdoll-action"
                          onClick={() => setPopupKey('skills')}
                          aria-label="Aktywne skille"
                          title="Aktywne skille"
                      >
                          <span className="inventory__paperdoll-action-icon"><GameIcon name="sparkles" /></span>
                          <span className="inventory__paperdoll-action-label">Skille</span>
                      </button>
                      <button
                          type="button"
                          className="inventory__paperdoll-action"
                          onClick={() => setPopupKey('potion')}
                          aria-label="Auto-potion"
                          title="Auto-potion"
                      >
                          <span className="inventory__paperdoll-action-icon">
                              <TinyIcon icon={getPotionImage('hp_potion_sm') ?? 'test-tube'} size="lg" />
                          </span>
                          <span className="inventory__paperdoll-action-label">Potion</span>
                      </button>
                      <button
                          type="button"
                          className="inventory__paperdoll-action"
                          onClick={() => setPopupKey('training')}
                          aria-label="Trening skilli"
                          title="Trening skilli"
                      >
                          <span className="inventory__paperdoll-action-icon"><GameIcon name="books" /></span>
                          <span className="inventory__paperdoll-action-label">Trening</span>
                      </button>
                      <button
                          type="button"
                          className="inventory__paperdoll-action"
                          onClick={() => setPopupKey('stats')}
                          aria-label="Statystyki"
                          title="Statystyki"
                      >
                          <span className="inventory__paperdoll-action-icon"><GameIcon name="bar-chart" /></span>
                          <span className="inventory__paperdoll-action-label">Stats</span>
                      </button>
                  </div>
              </div>
          );
      })()}

      {/* -- Postać popups: avatar zoom + auto-potion config -------------
          Single AnimatePresence stack — only one popup is open at a time
          (see `popupKey` state). Backdrop click closes; modal content
          stops propagation so an inner click doesn't dismiss. */}
      {character && (
          <AnimatePresence>
              {popupKey === 'avatar' && (
                  <motion.div
                      key="avatar-pop"
                      className="inventory__popup-overlay"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      onClick={closePopup}
                  >
                      <motion.div
                          className="inventory__popup inventory__popup--avatar"
                          style={{
                              '--avatar-class-color': accentColor,
                              '--avatar-class-rgb': accentColorRgb,
                          } as React.CSSProperties}
                          initial={{ scale: 0.85, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.85, opacity: 0 }}
                          transition={{ duration: 0.22, ease: 'easeOut' }}
                          onClick={(e) => e.stopPropagation()}
                      >
                          <button
                              className="inventory__popup-close"
                              onClick={closePopup}
                              aria-label="Zamknij"
                          >
                              ×
                          </button>
                          <img
                              src={playerAvatarSrc}
                              alt={character.class}
                              className="inventory__popup-avatar-img"
                          />
                          <div className="inventory__popup-avatar-info">
                              <span className="inventory__popup-avatar-name">{character.name}</span>
                              <span className="inventory__popup-avatar-class">
                                  {character.class} · Poziom {character.level}
                              </span>
                          </div>
                      </motion.div>
                  </motion.div>
              )}

              {popupKey === 'potion' && (
                  <motion.div
                      key="potion-pop"
                      className="inventory__popup-overlay"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      onClick={closePopup}
                  >
                      <motion.div
                          className="inventory__popup inventory__popup--potion"
                          initial={{ y: 24, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          exit={{ y: 24, opacity: 0 }}
                          transition={{ duration: 0.22, ease: 'easeOut' }}
                          onClick={(e) => e.stopPropagation()}
                      >
                          <header className="inventory__popup-header">
                              <h2 className="inventory__popup-title"><GameIcon name="test-tube" /> Potiony</h2>
                              <button
                                  className="inventory__popup-close"
                                  onClick={closePopup}
                                  aria-label="Zamknij"
                              >
                                  ×
                              </button>
                          </header>

                          {/* Spec 13c: tab strip lets the popup host both the
                              auto-potion config AND the alchemia conversion
                              UI without doubling the surface chrome. */}
                          <div className="inventory__popup-tabs">
                              <button
                                  type="button"
                                  className={`inventory__popup-tab${potionTab === 'auto' ? ' inventory__popup-tab--active' : ''}`}
                                  onClick={() => setPotionTab('auto')}
                              >
                                  <GameIcon name="gear" /> Auto-potion
                              </button>
                              <button
                                  type="button"
                                  className={`inventory__popup-tab${potionTab === 'alchemy' ? ' inventory__popup-tab--active' : ''}`}
                                  onClick={() => setPotionTab('alchemy')}
                              >
                                  <GameIcon name="test-tube" /> Alchemia
                              </button>
                          </div>

                          <div className="inventory__popup-body">
                              {potionTab === 'auto' && <>
                              {/* Block 1: Flat HP */}
                              <div className={`inventory__potion-setting${!autoPotionHpEnabled ? ' inventory__potion-setting--disabled' : ''}`}>
                                  <div className="inventory__potion-row">
                                      <label className="inventory__potion-toggle">
                                          <input
                                              type="checkbox"
                                              checked={autoPotionHpEnabled}
                                              onChange={(e) => setAutoPotionHpEnabled(e.target.checked)}
                                              className="inventory__potion-checkbox"
                                          />
                                          <span className="inventory__potion-icon">
                                              <TinyIcon icon={selectedFlatHpPotion?.icon ?? 'red-heart'} size="lg" />
                                          </span>
                                          <span className="inventory__potion-label">Auto HP Potion</span>
                                      </label>
                                      <span className="inventory__potion-value">
                                          {autoPotionHpEnabled ? `${autoPotionHpThreshold}%` : 'WYL'}
                                      </span>
                                  </div>
                                  <input
                                      type="range"
                                      min={0}
                                      max={99}
                                      step={1}
                                      value={autoPotionHpThreshold}
                                      onChange={(e) => setAutoPotionHpThreshold(Number(e.target.value))}
                                      disabled={!autoPotionHpEnabled}
                                      className="inventory__potion-slider inventory__potion-slider--hp"
                                      style={{ '--val': `${flatHpSliderPct}%` } as React.CSSProperties}
                                  />
                                  <div className="inventory__potion-select">
                                      <select
                                          className="inventory__potion-dropdown"
                                          value={autoPotionHpId}
                                          onChange={(e) => setAutoPotionHpId(e.target.value)}
                                          disabled={!autoPotionHpEnabled}
                                      >
                                          {FLAT_HP_POTIONS.map((p) => (
                                              <option key={p.id} value={p.id}>
                                                  {p.name_pl} (x{consumables[p.id] ?? 0})
                                              </option>
                                          ))}
                                      </select>
                                      <span className="inventory__potion-count">
                                          {flatHpPotionCount}× {selectedFlatHpPotion?.name_pl ?? '---'}
                                      </span>
                                  </div>
                              </div>

                              {/* Block 2: Flat MP */}
                              <div className={`inventory__potion-setting${!autoPotionMpEnabled ? ' inventory__potion-setting--disabled' : ''}`}>
                                  <div className="inventory__potion-row">
                                      <label className="inventory__potion-toggle">
                                          <input
                                              type="checkbox"
                                              checked={autoPotionMpEnabled}
                                              onChange={(e) => setAutoPotionMpEnabled(e.target.checked)}
                                              className="inventory__potion-checkbox"
                                          />
                                          <span className="inventory__potion-icon">
                                              <TinyIcon icon={selectedFlatMpPotion?.icon ?? 'droplet'} size="lg" />
                                          </span>
                                          <span className="inventory__potion-label">Auto MP Potion</span>
                                      </label>
                                      <span className="inventory__potion-value">
                                          {autoPotionMpEnabled ? `${autoPotionMpThreshold}%` : 'WYL'}
                                      </span>
                                  </div>
                                  <input
                                      type="range"
                                      min={0}
                                      max={99}
                                      step={1}
                                      value={autoPotionMpThreshold}
                                      onChange={(e) => setAutoPotionMpThreshold(Number(e.target.value))}
                                      disabled={!autoPotionMpEnabled}
                                      className="inventory__potion-slider inventory__potion-slider--mp"
                                      style={{ '--val': `${flatMpSliderPct}%` } as React.CSSProperties}
                                  />
                                  <div className="inventory__potion-select">
                                      <select
                                          className="inventory__potion-dropdown"
                                          value={autoPotionMpId}
                                          onChange={(e) => setAutoPotionMpId(e.target.value)}
                                          disabled={!autoPotionMpEnabled}
                                      >
                                          {FLAT_MP_POTIONS.map((p) => (
                                              <option key={p.id} value={p.id}>
                                                  {p.name_pl} (x{consumables[p.id] ?? 0})
                                              </option>
                                          ))}
                                      </select>
                                      <span className="inventory__potion-count">
                                          {flatMpPotionCount}× {selectedFlatMpPotion?.name_pl ?? '---'}
                                      </span>
                                  </div>
                              </div>

                              {/* Block 3: Percentage HP */}
                              <div className={`inventory__potion-setting${!autoPotionPctHpEnabled ? ' inventory__potion-setting--disabled' : ''}`}>
                                  <div className="inventory__potion-row">
                                      <label className="inventory__potion-toggle">
                                          <input
                                              type="checkbox"
                                              checked={autoPotionPctHpEnabled}
                                              onChange={(e) => setAutoPotionPctHpEnabled(e.target.checked)}
                                              className="inventory__potion-checkbox"
                                          />
                                          <span className="inventory__potion-icon">
                                              <TinyIcon icon={selectedPctHpPotion?.icon ?? 'drop-of-blood'} size="lg" />
                                          </span>
                                          <span className="inventory__potion-label">Auto % HP Potion</span>
                                      </label>
                                      <span className="inventory__potion-value">
                                          {autoPotionPctHpEnabled ? `${autoPotionPctHpThreshold}%` : 'WYL'}
                                      </span>
                                  </div>
                                  <input
                                      type="range"
                                      min={0}
                                      max={99}
                                      step={1}
                                      value={autoPotionPctHpThreshold}
                                      onChange={(e) => setAutoPotionPctHpThreshold(Number(e.target.value))}
                                      disabled={!autoPotionPctHpEnabled}
                                      className="inventory__potion-slider inventory__potion-slider--hp"
                                      style={{ '--val': `${pctHpSliderPct}%` } as React.CSSProperties}
                                  />
                                  <div className="inventory__potion-select">
                                      <select
                                          className="inventory__potion-dropdown"
                                          value={autoPotionPctHpId}
                                          onChange={(e) => setAutoPotionPctHpId(e.target.value)}
                                          disabled={!autoPotionPctHpEnabled}
                                      >
                                          {PCT_HP_POTIONS.map((p) => (
                                              <option key={p.id} value={p.id}>
                                                  {p.name_pl} (x{consumables[p.id] ?? 0})
                                              </option>
                                          ))}
                                      </select>
                                      <span className="inventory__potion-count">
                                          {pctHpPotionCount}× {selectedPctHpPotion?.name_pl ?? '---'}
                                      </span>
                                  </div>
                              </div>

                              {/* Block 4: Percentage MP */}
                              <div className={`inventory__potion-setting${!autoPotionPctMpEnabled ? ' inventory__potion-setting--disabled' : ''}`}>
                                  <div className="inventory__potion-row">
                                      <label className="inventory__potion-toggle">
                                          <input
                                              type="checkbox"
                                              checked={autoPotionPctMpEnabled}
                                              onChange={(e) => setAutoPotionPctMpEnabled(e.target.checked)}
                                              className="inventory__potion-checkbox"
                                          />
                                          <span className="inventory__potion-icon">
                                              <TinyIcon icon={selectedPctMpPotion?.icon ?? 'gem-stone'} size="lg" />
                                          </span>
                                          <span className="inventory__potion-label">Auto % MP Potion</span>
                                      </label>
                                      <span className="inventory__potion-value">
                                          {autoPotionPctMpEnabled ? `${autoPotionPctMpThreshold}%` : 'WYL'}
                                      </span>
                                  </div>
                                  <input
                                      type="range"
                                      min={0}
                                      max={99}
                                      step={1}
                                      value={autoPotionPctMpThreshold}
                                      onChange={(e) => setAutoPotionPctMpThreshold(Number(e.target.value))}
                                      disabled={!autoPotionPctMpEnabled}
                                      className="inventory__potion-slider inventory__potion-slider--mp"
                                      style={{ '--val': `${pctMpSliderPct}%` } as React.CSSProperties}
                                  />
                                  <div className="inventory__potion-select">
                                      <select
                                          className="inventory__potion-dropdown"
                                          value={autoPotionPctMpId}
                                          onChange={(e) => setAutoPotionPctMpId(e.target.value)}
                                          disabled={!autoPotionPctMpEnabled}
                                      >
                                          {PCT_MP_POTIONS.map((p) => (
                                              <option key={p.id} value={p.id}>
                                                  {p.name_pl} (x{consumables[p.id] ?? 0})
                                              </option>
                                          ))}
                                      </select>
                                      <span className="inventory__potion-count">
                                          {pctMpPotionCount}× {selectedPctMpPotion?.name_pl ?? '---'}
                                      </span>
                                  </div>
                              </div>
                              </>}

                              {/* Spec 13c: Alchemia tab — full conversion grid
                                  moved into the popup. Same handler / same
                                  state as the standalone panel, just rendered
                                  inside the popup body. */}
                              {potionTab === 'alchemy' && (
                                <div className="inventory__alchemy-tab">
                                  <p className="inventory__alchemy-hint">
                                    Zamieniaj slabsze eliksiry na mocniejsze. Bez kosztu — placisz tylko potionami!
                                  </p>
                                  {alchemyToast && (
                                    <div className="inventory__alchemy-toast">{alchemyToast}</div>
                                  )}
                                  <div className="inventory__alchemy-grid">
                                    {POTION_CONVERSIONS.map((conv) => {
                                      const key = getAlchemyKey(conv);
                                      const owned = consumables[conv.inputId] ?? 0;
                                      const outputOwned = consumables[conv.outputId] ?? 0;
                                      const { canConvert, maxBatches } = checkConversionAvailability(conv, owned);
                                      const levelTooLow = !!(character && conv.outputMinLevel && character.level < conv.outputMinLevel);
                                      const selectedAmount = alchemyAmounts[key] ?? 1;
                                      const amount = Math.min(selectedAmount, maxBatches);
                                      const totalInput = conv.inputCount * amount;
                                      return (
                                        <div
                                          key={key}
                                          className={`inventory__alchemy-row inventory__alchemy-row--${conv.family}`}
                                        >
                                          <div className="inventory__alchemy-input">
                                            <span className="inventory__alchemy-icon"><TinyIcon icon={conv.inputIcon} size="md" /></span>
                                            <div className="inventory__alchemy-texts">
                                              <span className="inventory__alchemy-name">{conv.inputName}</span>
                                              <span className="inventory__alchemy-owned">Posiadasz: {owned}</span>
                                            </div>
                                          </div>
                                          {/* Spec 2 (2026-05 v3): arrow direction set via SCSS
                                              `::before` (v on mobile, -> on desktop) so the layout
                                              swaps cleanly between vertical and horizontal flow. */}
                                          <span className="inventory__alchemy-arrow" aria-hidden="true" />
                                          <div className="inventory__alchemy-output">
                                            <span className="inventory__alchemy-icon"><TinyIcon icon={conv.outputIcon} size="md" /></span>
                                            <div className="inventory__alchemy-texts">
                                              <span className="inventory__alchemy-name">{conv.outputName}</span>
                                              <span className="inventory__alchemy-owned">Masz: {outputOwned}</span>
                                            </div>
                                          </div>
                                          <div className="inventory__alchemy-ratio">{conv.inputCount}:1</div>
                                          <div className="inventory__alchemy-controls">
                                            <div className="inventory__alchemy-amount-row">
                                              <button
                                                className="inventory__alchemy-amt-btn"
                                                disabled={!canConvert || amount <= 1}
                                                onClick={() => setAlchemyAmounts((p) => ({ ...p, [key]: Math.max(1, (p[key] ?? 1) - 1) }))}
                                              >−</button>
                                              <span className="inventory__alchemy-amt-value">{canConvert ? amount : 0}</span>
                                              <button
                                                className="inventory__alchemy-amt-btn"
                                                disabled={!canConvert || amount >= maxBatches}
                                                onClick={() => setAlchemyAmounts((p) => ({ ...p, [key]: Math.min(maxBatches, (p[key] ?? 1) + 1) }))}
                                              >+</button>
                                              <button
                                                className="inventory__alchemy-max-btn"
                                                disabled={!canConvert}
                                                onClick={() => setAlchemyAmounts((p) => ({ ...p, [key]: maxBatches }))}
                                              >MAX</button>
                                            </div>
                                            <span className="inventory__alchemy-summary">
                                              {levelTooLow ? `Wymagany lvl ${conv.outputMinLevel}` : canConvert ? `${totalInput} -> ${amount}` : 'Za malo'}
                                            </span>
                                          </div>
                                          <button
                                            className="inventory__alchemy-btn"
                                            disabled={!canConvert || levelTooLow}
                                            onClick={() => {
                                              handlePotionConvert(conv.inputId, conv.outputId, conv.outputName, conv.inputCount, amount);
                                              setAlchemyAmounts((p) => ({ ...p, [key]: 1 }));
                                            }}
                                          >
                                            <GameIcon name="test-tube" /> Przetworz
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                          </div>
                      </motion.div>
                  </motion.div>
              )}

              {/* Spec 7: combat stats popup */}
              {popupKey === 'stats' && (
                  <motion.div
                      key="stats-pop"
                      className="inventory__popup-overlay"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      onClick={closePopup}
                  >
                      <motion.div
                          className="inventory__popup inventory__popup--stats"
                          initial={{ y: 24, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          exit={{ y: 24, opacity: 0 }}
                          transition={{ duration: 0.22, ease: 'easeOut' }}
                          onClick={(e) => e.stopPropagation()}
                      >
                          <header className="inventory__popup-header">
                              <h2 className="inventory__popup-title"><GameIcon name="bar-chart" /> Statystyki</h2>
                              <button className="inventory__popup-close" onClick={closePopup} aria-label="Zamknij">×</button>
                          </header>
                          <div className="inventory__popup-body">
                              <StatsPopupBody />
                          </div>
                      </motion.div>
                  </motion.div>
              )}

              {/* Spec 8: training popup */}
              {popupKey === 'training' && (
                  <motion.div
                      key="training-pop"
                      className="inventory__popup-overlay"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      onClick={closePopup}
                  >
                      <motion.div
                          className="inventory__popup inventory__popup--training"
                          initial={{ y: 24, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          exit={{ y: 24, opacity: 0 }}
                          transition={{ duration: 0.22, ease: 'easeOut' }}
                          onClick={(e) => e.stopPropagation()}
                      >
                          <header className="inventory__popup-header">
                              <h2 className="inventory__popup-title"><GameIcon name="books" /> Trening Skilli</h2>
                              <button className="inventory__popup-close" onClick={closePopup} aria-label="Zamknij">×</button>
                          </header>
                          <div className="inventory__popup-body">
                              <TrainingPopupBody />
                          </div>
                      </motion.div>
                  </motion.div>
              )}

              {/* Spec 10: active skills popup */}
              {popupKey === 'skills' && (
                  <motion.div
                      key="skills-pop"
                      className="inventory__popup-overlay"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      onClick={closePopup}
                  >
                      <motion.div
                          className="inventory__popup inventory__popup--skills"
                          initial={{ y: 24, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          exit={{ y: 24, opacity: 0 }}
                          transition={{ duration: 0.22, ease: 'easeOut' }}
                          onClick={(e) => e.stopPropagation()}
                      >
                          <header className="inventory__popup-header">
                              <h2 className="inventory__popup-title"><GameIcon name="sparkles" /> Aktywne Skille</h2>
                              <button className="inventory__popup-close" onClick={closePopup} aria-label="Zamknij">×</button>
                          </header>
                          <div className="inventory__popup-body">
                              <ActiveSkillsPopupBody />
                          </div>
                      </motion.div>
                  </motion.div>
              )}
          </AnimatePresence>
      )}

      {/* Spec 2: per-potion use popup — confirms how many doses to drink
          (or auto-fill HP/MP) before consuming the stack. Lives in its
          own AnimatePresence so it can layer above the other popups. */}
      <AnimatePresence>
        {usePotionId && (() => {
          const elixir = ELIXIRS.find((e) => e.id === usePotionId);
          if (!elixir) return null;
          const stack = consumables[usePotionId] ?? 0;
          const fx = elixir.effect ?? '';
          const isHp = fx.startsWith('heal_hp');
          const isMp = fx.startsWith('heal_mp');
          const isHeal = isHp || isMp;
          const isBuff = isBuffEffect(fx);
          const isReset = fx === 'stat_reset';
          const close = () => { setUsePotionId(null); setUsePotionAmount(1); };
          const max = stack;
          const amount = Math.min(usePotionAmount, max);
          return (
            <motion.div
              key="use-potion"
              className="inventory__popup-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={close}
            >
              <motion.div
                className="inventory__popup inventory__popup--use-potion"
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.92, opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={(e) => e.stopPropagation()}
              >
                <header className="inventory__popup-header">
                  <h2 className="inventory__popup-title"><TinyIcon icon={elixir.icon} size="lg" /> {elixir.name_pl}</h2>
                  <button className="inventory__popup-close" onClick={close} aria-label="Zamknij">×</button>
                </header>
                <div className="inventory__popup-body">
                  <p className="inventory__use-potion-desc">{elixir.description_pl}</p>
                  <p className="inventory__use-potion-stock">Posiadasz: <strong>×{stack}</strong></p>

                  {/* Heal potions: amount + auto-fill row */}
                  {isHeal && (
                    <>
                      <div className="inventory__use-potion-amount">
                        <span className="inventory__use-potion-amount-label">Ile uzyc?</span>
                        <div className="inventory__use-potion-amount-row">
                          <button
                            className="inventory__use-potion-amt-btn"
                            disabled={amount <= 1}
                            onClick={() => setUsePotionAmount(Math.max(1, amount - 1))}
                          >−</button>
                          <span className="inventory__use-potion-amt-value">{amount}</span>
                          <button
                            className="inventory__use-potion-amt-btn"
                            disabled={amount >= max}
                            onClick={() => setUsePotionAmount(Math.min(max, amount + 1))}
                          >+</button>
                          <button
                            className="inventory__use-potion-max-btn"
                            disabled={max <= 0}
                            onClick={() => setUsePotionAmount(max)}
                          >MAX ({max})</button>
                        </div>
                      </div>
                      {/* Spec 5 (2026-05): show why a heal might no-op so the
                          user understands the silent-fail when HP/MP is full. */}
                      {(() => {
                        const ch = character;
                        if (!ch) return null;
                        const eff = engineGetEffectiveChar(ch);
                        const maxHp = eff?.max_hp ?? ch.max_hp;
                        const maxMp = eff?.max_mp ?? ch.max_mp;
                        const full = (isHp && ch.hp >= maxHp) || (isMp && ch.mp >= maxMp);
                        return full ? (
                          <p className="inventory__use-potion-warn">
                            <GameIcon name="information" /> {isHp ? 'HP' : 'MP'} jest juz pelne — eliksir nie zostanie uzyty.
                          </p>
                        ) : null;
                      })()}
                      <div className="inventory__use-potion-actions">
                        <button
                          className="inventory__use-potion-btn inventory__use-potion-btn--use"
                          disabled={amount <= 0}
                          onClick={() => { useElixirN(usePotionId, amount); close(); }}
                        >
                          <TinyIcon icon={elixir.icon} size="sm" /> Uzyj ×{amount}
                        </button>
                        <button
                          className="inventory__use-potion-btn inventory__use-potion-btn--fill"
                          disabled={max <= 0}
                          onClick={() => { useElixirToFull(usePotionId); close(); }}
                        >
                          <GameIcon name="up-arrow" /> Uzyj do max {isHp ? 'HP' : 'MP'}
                        </button>
                      </div>
                    </>
                  )}

                  {/* Buff elixirs: simple confirm */}
                  {isBuff && (
                    <div className="inventory__use-potion-actions">
                      <button
                        className="inventory__use-potion-btn inventory__use-potion-btn--use"
                        disabled={stack <= 0}
                        onClick={() => { applyElixirDose(usePotionId); close(); }}
                      >
                        <GameIcon name="sparkles" /> Aktywuj buff
                      </button>
                    </div>
                  )}

                  {/* Stat reset */}
                  {isReset && (
                    <div className="inventory__use-potion-actions">
                      <button
                        className="inventory__use-potion-btn inventory__use-potion-btn--reset"
                        disabled={stack <= 0}
                        onClick={() => {
                          if (window.confirm('Na pewno chcesz zresetowac wszystkie rozdane statystyki? Punkty wroca do puli.')) {
                            applyElixirDose(usePotionId);
                            close();
                          }
                        }}
                      >
                        <GameIcon name="warning" /> Resetuj statystyki
                      </button>
                    </div>
                  )}

                  {/* Spec 1 (2026-05 v3): protection-style elixirs (AOL,
                      death-protection) and reset elixirs (dungeon/boss)
                      are CHARGE-BASED — every item in your bag is one
                      "use", consumed automatically by the engine when
                      the trigger fires (death / dungeon defeat / boss
                      defeat). No timer, no manual activation needed —
                      just keep them in the bag.
                      The popup explains this so the player knows their
                      protection counter equals their stack count. */}
                  {!isHeal && !isBuff && !isReset && (() => {
                    let infoLabel = '';
                    if (fx === 'amulet_of_loss') {
                      infoLabel = `:shield: Posiadasz ${stack} amuletów = ${stack} ochron przedmiotów. Każda śmierć automatycznie zużywa 1 sztukę i ratuje plecak + ekwipunek.`;
                    } else if (fx === 'death_protection') {
                      infoLabel = `:shield: Posiadasz ${stack} eliksirów = ${stack} ochron statystyk i poziomu. Każda śmierć automatycznie zużywa 1 sztukę.`;
                    } else if (fx === 'dungeon_reset') {
                      infoLabel = `:castle: Posiadasz ${stack} resetów. Użyj na ekranie konkretnego dungeonu — przycisk "Reset" pojawia się gdy próby się skończą.`;
                    } else if (fx === 'boss_reset') {
                      infoLabel = `:ogre: Posiadasz ${stack} resetów. Użyj na ekranie konkretnego bossa — przycisk "Reset" pojawia się gdy próby się skończą.`;
                    } else {
                      infoLabel = `:information: Posiadasz ${stack} sztuk. Eliksir aktywuje się automatycznie w odpowiedniej sytuacji.`;
                    }
                    return (
                      <p className="inventory__use-potion-warn">
                        <EmojiText>{infoLabel}</EmojiText>
                      </p>
                    );
                  })()}
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      <hr className="inventory__separator" />

      {/* Spec 4: standalone "Kamienie ulepszenia" panel removed — every
          stone now appears as its own bag tile (one per rarity, with a
          stack count) inside the bag grid below. Click a stone tile to
          open the same conversion popup as before. */}

      {/* -- Stone Conversion Popup ----------------------------------------- */}
      <AnimatePresence>
        {stoneConvertId && (() => {
          const higherStone = STONE_CONVERSION_CHAIN[stoneConvertId];
          const currentCount = stones[stoneConvertId] ?? 0;
          const higherCount = higherStone ? (stones[higherStone] ?? 0) : 0;
          const currentName = STONE_NAMES[stoneConvertId] ?? stoneConvertId;
          const higherName = higherStone ? (STONE_NAMES[higherStone] ?? higherStone) : null;
          const canConvert = !!higherStone && currentCount >= STONE_CONVERSION_COST && gold >= STONE_CONVERSION_GOLD;
          const isMaxTier = !higherStone;

          // Find rarity for colors
          const currentRarity = RARITY_ORDER.find((r) => STONE_FOR_RARITY[r] === stoneConvertId);
          const higherRarity = higherStone ? RARITY_ORDER.find((r) => STONE_FOR_RARITY[r] === higherStone) : null;
          const currentColor = currentRarity ? RARITY_COLORS[currentRarity] : '#fff';
          const higherColor = higherRarity ? RARITY_COLORS[higherRarity] : '#fff';

          return (
            <>
              <motion.div
                className="inventory__overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => { setStoneConvertId(null); setStoneConvertResult(null); }}
              />
              <motion.div
                className="inventory__stone-popup"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ type: 'spring', stiffness: 300, damping: 22 }}
              >
                <button className="inventory__stone-popup-close" onClick={() => { setStoneConvertId(null); setStoneConvertResult(null); }}>
                  <Icon name="x" />
                </button>
                <h3 className="inventory__stone-popup-title">Zamiana kamieni</h3>

                <div className="inventory__stone-popup-current">
                  <span className="inventory__stone-popup-gem" style={{ color: currentColor }}>
                    <TinyIcon icon={STONE_ICONS[stoneConvertId] ?? 'gem-stone'} size="lg" />
                  </span>
                  <span className="inventory__stone-popup-name" style={{ color: currentColor }}>{currentName}</span>
                  <span className="inventory__stone-popup-count">x{currentCount}</span>
                </div>

                {isMaxTier ? (
                  <div className="inventory__stone-popup-max">
                    To najwyzszy tier kamieni. Nie mozna zamienic wyzej.
                  </div>
                ) : (
                  <>
                    <div className="inventory__stone-popup-arrow">
                      Zamien {STONE_CONVERSION_COST}x {currentName} na 1x {higherName}
                    </div>

                    <div className="inventory__stone-popup-target">
                      <span className="inventory__stone-popup-gem" style={{ color: higherColor }}>
                        <TinyIcon icon={higherStone ? (STONE_ICONS[higherStone] ?? 'gem-stone') : 'gem-stone'} size="lg" />
                      </span>
                      <span className="inventory__stone-popup-name" style={{ color: higherColor }}>{higherName}</span>
                      <span className="inventory__stone-popup-count">x{higherCount}</span>
                    </div>

                    <div className="inventory__stone-popup-cost">
                      Koszt: <strong>{formatGoldShort(STONE_CONVERSION_GOLD)}</strong>
                      <span className="inventory__stone-popup-gold-status" style={{ color: gold >= STONE_CONVERSION_GOLD ? '#4caf50' : '#f44336' }}>
                        {' '}(masz: {formatGoldShort(gold)})
                      </span>
                    </div>

                    <div className="inventory__stone-popup-req">
                      Wymagane kamienie: <strong style={{ color: currentCount >= STONE_CONVERSION_COST ? '#4caf50' : '#f44336' }}>
                        {currentCount} / {STONE_CONVERSION_COST}
                      </strong>
                    </div>

                    <button
                      className="inventory__stone-popup-btn"
                      disabled={!canConvert}
                      onClick={() => handleStoneConvert(stoneConvertId)}
                    >
                      {currentCount < STONE_CONVERSION_COST
                        ? `Za malo kamieni (${currentCount}/${STONE_CONVERSION_COST})`
                        : gold < STONE_CONVERSION_GOLD
                          ? 'Za malo zlota'
                          : `Zamien ${STONE_CONVERSION_COST}x na 1x ${higherName}`}
                    </button>

                    <AnimatePresence>
                      {stoneConvertResult === 'success' && (
                        <motion.div
                          className="inventory__stone-popup-result inventory__stone-popup-result--success"
                          initial={{ opacity: 0, scale: 0.5 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.5 }}
                        >
                          Zamieniono! +1x {higherName}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </motion.div>
            </>
          );
        })()}
      </AnimatePresence>

      {/* -- Bag section ----------------------------------------------------- */}
      <div className="inventory__bag-header">
        <span className="inventory__bag-count">Plecak: {bag.length} / 1000</span>
        {bulkMode !== 'none' ? (
          <button
            className="inventory__multi-sell-toggle inventory__multi-sell-toggle--active"
            onClick={exitMultiSell}
          >
            <Icon name="x" /> Anuluj
          </button>
        ) : (
          <>
            <button
              className="inventory__multi-sell-toggle inventory__multi-sell-toggle--sell"
              onClick={() => setBulkMode('sell')}
            >
              <GameIcon name="money-bag" /> Sprzedaj
            </button>
            <button
              className="inventory__multi-sell-toggle inventory__multi-sell-toggle--disassemble"
              onClick={() => setBulkMode('disassemble')}
            >
              <GameIcon name="hammer" /> Rozloz
            </button>
          </>
        )}
        <div className="inventory__auto-sell">
          <span className="inventory__auto-sell-label">Auto-sell:</span>
          <button
            className={`inventory__auto-sell-btn${autoSellCommon ? ' inventory__auto-sell-btn--active' : ''}`}
            onClick={() => setAutoSellCommon(!autoSellCommon)}
            title="Automatycznie sprzedawaj Common przedmioty"
          >
            Zwykle {autoSellCommon ? <GameIcon name="check-mark-button" /> : <GameIcon name="cross-mark" />}
          </button>
          <button
            className={`inventory__auto-sell-btn inventory__auto-sell-btn--rare${autoSellRare ? ' inventory__auto-sell-btn--active' : ''}`}
            onClick={() => setAutoSellRare(!autoSellRare)}
            title="Automatycznie sprzedawaj Rare przedmioty"
          >
            Rzadkie {autoSellRare ? <GameIcon name="check-mark-button" /> : <GameIcon name="cross-mark" />}
          </button>
          <button
            className={`inventory__auto-sell-btn inventory__auto-sell-btn--epic${autoSellEpic ? ' inventory__auto-sell-btn--active' : ''}`}
            onClick={() => setAutoSellEpic(!autoSellEpic)}
            title="Automatycznie sprzedawaj Epic przedmioty"
          >
            Epickie {autoSellEpic ? <GameIcon name="check-mark-button" /> : <GameIcon name="cross-mark" />}
          </button>
          <button
            className={`inventory__auto-sell-btn inventory__auto-sell-btn--legendary${autoSellLegendary ? ' inventory__auto-sell-btn--active' : ''}`}
            onClick={() => setAutoSellLegendary(!autoSellLegendary)}
            title="Automatycznie sprzedawaj Legendary przedmioty"
          >
            Legendarne {autoSellLegendary ? <GameIcon name="check-mark-button" /> : <GameIcon name="cross-mark" />}
          </button>
          <button
            className={`inventory__auto-sell-btn inventory__auto-sell-btn--mythic${autoSellMythic ? ' inventory__auto-sell-btn--active' : ''}`}
            onClick={() => setAutoSellMythic(!autoSellMythic)}
            title="Automatycznie sprzedawaj Mythic przedmioty"
          >
            Mityczne {autoSellMythic ? <GameIcon name="check-mark-button" /> : <GameIcon name="cross-mark" />}
          </button>
        </div>
      </div>

      {/* Rarity filters */}
      <div className="inventory__filter-row">
        {RARITY_FILTERS.map((r) => (
          <button
            key={r}
            className={`inventory__filter-btn${rarityFilter === r ? ' inventory__filter-btn--active' : ''}`}
            style={
              r !== 'all'
                ? ({ '--rarity-color': RARITY_COLORS[r as Rarity] } as React.CSSProperties)
                : undefined
            }
            onClick={() => setRarityFilter(r)}
          >
            {r === 'all' ? 'Wszystkie' : RARITY_LABELS[r as Rarity]}
          </button>
        ))}
      </div>

      {/* Slot filters */}
      <div className="inventory__filter-row inventory__filter-row--slots">
        {SLOT_FILTER_BUTTONS.map((f) => {
          /* Spec 3: icons can be either a PNG URL (slot variants) or an
             emoji glyph (potions / chests / stones). Render as <img>
             when the value looks like a URL, otherwise inline text. */
          const isImg = typeof f.icon === 'string' && (f.icon.startsWith('/') || f.icon.startsWith('http') || f.icon.includes('.png'));
          return (
            <button
              key={f.id}
              className={`inventory__filter-btn inventory__filter-btn--slot${slotFilter === f.id ? ' inventory__filter-btn--active' : ''}`}
              onClick={() => setSlotFilter(f.id)}
              title={f.label}
            >
              <span className="inventory__filter-btn-icon">
                {isImg ? <img src={f.icon} alt="" draggable={false} /> : <GameIcon name={f.icon} />}
              </span>
              <span className="inventory__filter-btn-label">{f.label}</span>
            </button>
          );
        })}
      </div>

      {/* Multi-sell / disassemble controls */}
      {bulkMode !== 'none' && (
        <div className="inventory__multi-controls">
          <span className={`inventory__bulk-mode-label${bulkMode === 'disassemble' ? ' inventory__bulk-mode-label--disassemble' : ''}`}>
            {bulkMode === 'sell' ? <><GameIcon name="money-bag" /> Tryb sprzedazy</> : <><GameIcon name="hammer" /> Tryb rozkladania</>}
          </span>
          {/* Spec 2: select-all / deselect-all read in the live transform
              colour (not the legacy red) so the action chrome matches the
              player's tier. The rarity-coloured buttons below stay in
              their per-rarity hue. */}
          <button className="inventory__multi-btn inventory__multi-btn--tx" onClick={selectAll}>Zaznacz wszystkie</button>
          <button className="inventory__multi-btn inventory__multi-btn--tx" onClick={deselectAll}>Odznacz wszystkie</button>
          {RARITY_SELECT_FILTERS.map((r) => (
            <button
              key={r}
              className="inventory__multi-btn"
              style={{ '--rarity-color': RARITY_COLORS[r] } as React.CSSProperties}
              onClick={() => selectByRarity(r)}
            >
              + {RARITY_LABELS[r]}
            </button>
          ))}
        </div>
      )}

      {/* Spec 4: standalone Consumables section removed — all potions /
          elixirs are now rendered as `stackTiles` inside the bag grid
          below. Click a potion tile in the bag to open the Potion popup
          (Alchemia tab) for conversion. */}
      {/* eslint-disable-next-line @typescript-eslint/no-unused-expressions, no-constant-binary-expression */}
      {false && !multiSellMode && (() => {
        const ownedConsumables = ELIXIRS.filter((e) => (consumables[e.id] ?? 0) > 0);
        if (ownedConsumables.length === 0) return null;
        const BUFF_CONFIG: Record<string, { id: string; name: string; icon: string; effect: string; durationMs: number; pausable?: boolean }> = {
            'xp_boost_1h': { id: 'xp_boost', name: 'XP +50%', icon: 'star', effect: 'xp_boost', durationMs: 3600000, pausable: true },
            'skill_xp_boost_1h': { id: 'skill_xp_boost', name: 'Skill XP +50%', icon: 'sparkles', effect: 'skill_xp_boost', durationMs: 3600000, pausable: true },
            'attack_speed_0.20_15m_pausable': { id: 'attack_speed', name: 'AS +20%', icon: 'high-voltage', effect: 'attack_speed', durationMs: 900000, pausable: true },
            'cooldown_reduction_0.20_30m': { id: 'cooldown_reduction', name: 'CD -20%', icon: 'cyclone', effect: 'cooldown_reduction', durationMs: 1800000 },
            'hp_pct_25_15m': { id: 'hp_pct_25', name: 'Max HP +25%', icon: 'heart-on-fire', effect: 'hp_pct_25', durationMs: 900000, pausable: true },
            'mp_pct_25_15m': { id: 'mp_pct_25', name: 'Max MP +25%', icon: 'diamond-with-a-dot', effect: 'mp_pct_25', durationMs: 900000, pausable: true },
            'offline_training_boost': { id: 'offline_training_boost', name: 'Trening x2', icon: 'person-lifting-weights', effect: 'offline_training_boost', durationMs: 3600000, pausable: true },
            'utamo_vita': { id: 'utamo_vita', name: 'Utamo Vita', icon: 'blue-circle', effect: 'utamo_vita', durationMs: 600000 },
            'premium_xp_boost': { id: 'premium_xp_boost', name: 'Premium XP x2', icon: 'gem-stone', effect: 'premium_xp_boost', durationMs: 43200000, pausable: true },
            'atk_dmg_25_15m': { id: 'atk_dmg_25', name: 'ATK DMG +25%', icon: 'crossed-swords', effect: 'atk_dmg_25', durationMs: 900000, pausable: true },
            'atk_dmg_50_15m': { id: 'atk_dmg_50', name: 'ATK DMG +50%', icon: 'crossed-swords', effect: 'atk_dmg_50', durationMs: 900000, pausable: true },
            'atk_dmg_100_15m': { id: 'atk_dmg_100', name: 'ATK DMG +100%', icon: 'crossed-swords', effect: 'atk_dmg_100', durationMs: 900000, pausable: true },
            'spell_dmg_25_15m': { id: 'spell_dmg_25', name: 'SPELL DMG +25%', icon: 'crystal-ball', effect: 'spell_dmg_25', durationMs: 900000, pausable: true },
            'spell_dmg_50_15m': { id: 'spell_dmg_50', name: 'SPELL DMG +50%', icon: 'crystal-ball', effect: 'spell_dmg_50', durationMs: 900000, pausable: true },
            'spell_dmg_100_15m': { id: 'spell_dmg_100', name: 'SPELL DMG +100%', icon: 'crystal-ball', effect: 'spell_dmg_100', durationMs: 900000, pausable: true },
            'hp_boost_500_15m': { id: 'hp_boost_500', name: '+500 Max HP', icon: 'drop-of-blood', effect: 'hp_boost_500', durationMs: 900000, pausable: true },
            'mp_boost_500_15m': { id: 'mp_boost_500', name: '+500 Max MP', icon: 'large-blue-diamond', effect: 'mp_boost_500', durationMs: 900000, pausable: true },
            'atk_boost_50_15m': { id: 'atk_boost_50', name: '+50 ATK', icon: 'flexed-biceps', effect: 'atk_boost_50', durationMs: 900000, pausable: true },
            'def_boost_50_15m': { id: 'def_boost_50', name: '+50 DEF', icon: 'shield', effect: 'def_boost_50', durationMs: 900000, pausable: true },
        };
        const isBuffEffect = (effect: string): boolean => (
          effect === 'xp_boost_1h'
            || effect === 'skill_xp_boost_1h'
            || effect.startsWith('attack_speed_')
            || effect.startsWith('cooldown_reduction_')
            || effect === 'offline_training_boost'
            || effect === 'utamo_vita'
            || effect === 'premium_xp_boost'
            || effect.startsWith('atk_dmg_')
            || effect.startsWith('spell_dmg_')
            || effect.startsWith('hp_boost_')
            || effect.startsWith('mp_boost_')
            || effect.startsWith('atk_boost_')
            || effect.startsWith('def_boost_')
            || effect.startsWith('hp_pct_')
            || effect.startsWith('mp_pct_')
        );
        return (
          <div className="inventory__consumables">
            <div className="inventory__consumables-title">
              Potiony i Eliksiry
              {/* Spec 13c: quick link to the Alchemia tab in the Potion popup
                  for one-click access to the conversion grid. */}
              <button
                type="button"
                className="inventory__consumables-alchemy-link"
                onClick={openPotionAlchemy}
                title="Otwórz Alchemię (zamiana eliksirów)"
              >
                <GameIcon name="test-tube" /> Alchemia <Icon name="arrowRight" />
              </button>
            </div>
            <div className="inventory__consumables-grid">
              {ownedConsumables.map((elixir) => {
                const count = consumables[elixir.id] ?? 0;
                const effect = elixir.effect;
                // 2026-05-08 v3 spec ("eliksiry maja taki sam border
                // wszedzie") — utility / buff elixirs (anything that's
                // NOT an HP/MP heal potion) gets the gold->purple
                // gradient border. HP/MP potions keep their normal
                // tile chrome since they live in the "Potiony" family.
                const isHealPotion = effect.startsWith('heal_hp') || effect.startsWith('heal_mp');
                let tileClass = 'inventory__consumable-tile';
                if (!isHealPotion) tileClass += ' inventory__consumable-tile--elixir';
                let disabled = count <= 0;
                let title = `Uzyj ${elixir.name_pl}`;
                let onUse: (() => void) | null = null;

                if (effect === 'stat_reset') {
                  tileClass += ' inventory__consumable-tile--reset';
                  title = 'Resetuje wszystkie rozdane punkty statystyk';
                  onUse = () => {
                    if (window.confirm('Na pewno chcesz zresetowac wszystkie rozdane statystyki? Punkty wroca do puli.')) {
                      handleStatReset();
                    }
                  };
                } else if (isBuffEffect(effect)) {
                  const cfg = BUFF_CONFIG[effect];
                  if (cfg) {
                    const alreadyActive = useBuffStore.getState().hasBuff(cfg.effect);
                    tileClass += ' inventory__consumable-tile--buff';
                    title = alreadyActive ? 'Buff juz aktywny (nadpisze czas)' : `Aktywuj ${elixir.name_pl}`;
                    onUse = () => {
                      // 2026-05-08: same URL-icon lift as the popup-handler
                      // path so consumables used from the grid carry PNG
                      // art into the BuffBar / BuffPopover.
                      const artIcon = getElixirImage(cfg.effect) ?? getElixirImage(elixir.id) ?? cfg.icon;
                      const buffData = { id: cfg.id, name: cfg.name, icon: artIcon, effect: cfg.effect };
                      if (cfg.pausable) {
                        useBuffStore.getState().addPausableBuff(buffData, cfg.durationMs);
                      } else {
                        useBuffStore.getState().addBuff(buffData, cfg.durationMs);
                      }
                      useInventoryStore.getState().addConsumable(elixir.id, -1);
                      // Max HP/MP elixirs raise effective cap — heal up to new effMax
                      // so HP bar and auto-potion treat the player as "full" rather
                      // than permanently sub-max until the next heal.
                      if (cfg.effect === 'hp_boost_500' || cfg.effect === 'hp_pct_25'
                          || cfg.effect === 'mp_boost_500' || cfg.effect === 'mp_pct_25') {
                        const freshChar = useCharacterStore.getState().character;
                        if (freshChar) {
                          const eff = engineGetEffectiveChar(freshChar);
                          const newMaxHp = eff?.max_hp ?? freshChar.max_hp;
                          const newMaxMp = eff?.max_mp ?? freshChar.max_mp;
                          useCharacterStore.getState().updateCharacter({ hp: newMaxHp, mp: newMaxMp });
                          const cs = useCombatStore.getState();
                          if (cs.phase === 'fighting') {
                            cs.setHps(cs.monsterCurrentHp, newMaxHp);
                            cs.healPlayerMp(newMaxMp, newMaxMp);
                          }
                        }
                      }
                    };
                  }
                } else {
                  const isHpPotion = effect.startsWith('heal_hp');
                  const isMpPotion = effect.startsWith('heal_mp');
                  if (isHpPotion || isMpPotion) {
                    const char = useCharacterStore.getState().character;
                    if (char) {
                      const eff = engineGetEffectiveChar(char);
                      const effMaxHp = eff?.max_hp ?? char.max_hp;
                      const effMaxMp = eff?.max_mp ?? char.max_mp;
                      const isFull = isHpPotion ? char.hp >= effMaxHp : char.mp >= effMaxMp;
                      disabled = isFull || count <= 0;
                      title = isFull
                        ? (isHpPotion ? 'HP jest pelne' : 'MP jest pelne')
                        : `Uzyj ${elixir.name_pl}`;
                      onUse = () => {
                        const freshChar = useCharacterStore.getState().character;
                        if (!freshChar) return;
                        const eff2 = engineGetEffectiveChar(freshChar);
                        const curMaxHp = eff2?.max_hp ?? freshChar.max_hp;
                        const curMaxMp = eff2?.max_mp ?? freshChar.max_mp;
                        if (isHpPotion) {
                          const flatMatch = effect.match(/^heal_hp_(\d+)$/);
                          const pctMatch = effect.match(/^heal_hp_pct_(\d+)$/);
                          let healAmount = 0;
                          if (flatMatch) healAmount = parseInt(flatMatch[1], 10);
                          else if (pctMatch) healAmount = Math.floor(curMaxHp * parseInt(pctMatch[1], 10) / 100);
                          const newHp = Math.min(curMaxHp, freshChar.hp + healAmount);
                          useCharacterStore.getState().updateCharacter({ hp: newHp });
                        } else {
                          const flatMatch = effect.match(/^heal_mp_(\d+)$/);
                          const pctMatch = effect.match(/^heal_mp_pct_(\d+)$/);
                          let healAmount = 0;
                          if (flatMatch) healAmount = parseInt(flatMatch[1], 10);
                          else if (pctMatch) healAmount = Math.floor(curMaxMp * parseInt(pctMatch[1], 10) / 100);
                          const newMp = Math.min(curMaxMp, freshChar.mp + healAmount);
                          useCharacterStore.getState().updateCharacter({ mp: newMp });
                        }
                        useInventoryStore.getState().addConsumable(elixir.id, -1);
                      };
                    }
                  }
                }

                return (
                  <button
                    key={elixir.id}
                    type="button"
                    className={tileClass}
                    disabled={disabled || !onUse}
                    title={`${elixir.name_pl} — ${elixir.description_pl}\n${title}`}
                    onClick={() => onUse?.()}
                  >
                    <span className="inventory__consumable-tile-count">×{count}</span>
                    <span className="inventory__consumable-tile-icon">
                      <TinyIcon icon={elixir.icon} size={32} />
                    </span>
                    <span className="inventory__consumable-tile-name">{elixir.name_pl}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Spec 4: standalone Spell Chests section removed — every chest
          is now a stack tile in the bag grid below; click opens the
          Skills popup so the chest can be spent on unlocks/upgrades. */}
      {/* eslint-disable-next-line @typescript-eslint/no-unused-expressions, no-constant-binary-expression */}
      {false && !multiSellMode && (() => {
        const chestEntries = Object.entries(consumables)
          .filter(([key, count]) => key.startsWith('spell_chest_') && (count ?? 0) > 0)
          .map(([key, count]) => {
            const level = parseInt(key.replace('spell_chest_', ''), 10) || 0;
            return { key, level, count: count ?? 0 };
          })
          .sort((a, b) => a.level - b.level);
        if (chestEntries.length === 0) return null;
        return (
          <div className="inventory__consumables">
            <div className="inventory__consumables-title">Spell Chesty (kliknij aby otworzyc skille)</div>
            <div className="inventory__consumables-grid">
              {chestEntries.map(({ key, level, count }) => (
                <button
                  key={key}
                  type="button"
                  className="inventory__consumable-tile inventory__consumable-tile--chest"
                  /* Spec 13b: clicking a chest deep-links into the active
                     skills popup so the player can spend the chest on
                     unlocking / upgrading the skill that needs it. */
                  onClick={() => setPopupKey('skills')}
                  title={`${getSpellChestDisplayName(level)} — kliknij aby otworzyc skille (uzywany do odblokowywania i ulepszania skilli Lvl ${level}+)`}
                >
                  <span className="inventory__consumable-tile-count">×{count}</span>
                  <span className="inventory__consumable-tile-icon"><TinyIcon icon={getSpellChestIcon(level)} /></span>
                  <span className="inventory__consumable-tile-name">{getSpellChestDisplayName(level)}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Spec 13c: standalone alchemia panel removed — moved into the
          Auto-potion popup as the "Alchemia" tab. Click :test-tube: Potion in
          the action row, or click any potion tile in the consumables
          grid above, to deep-link there. */}

      {/* Spec 3 (2026-05): pagination strip is ALWAYS visible — even
          for a single page, even for an empty bag. Shows "Strona 1/1"
          and disables both arrows when there's no other page to fly to. */}
      <div className="inventory__pagination">
        <button
          className="inventory__pagination-btn"
          onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
          disabled={safePage === 0}
        >
          <Icon name="arrowLeft" /> Poprzednia
        </button>
        <span className="inventory__pagination-info">
          Strona {safePage + 1} / {Math.max(1, totalPages)}
          {filteredBag.length > 0 && (
            <span className="inventory__pagination-range">
              {' '}({safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filteredBag.length)} z {filteredBag.length})
            </span>
          )}
        </span>
        <button
          className="inventory__pagination-btn"
          onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
          disabled={safePage >= totalPages - 1}
        >
          Następna <Icon name="arrowRight" />
        </button>
      </div>

      {filteredBag.length === 0 && filteredStackTiles.length === 0 ? (
        <p className="inventory__empty">
          {bag.length === 0 && stackTiles.length === 0
            ? 'Brak przedmiotow'
            : 'Brak przedmiotow dla wybranego filtra.'}
        </p>
      ) : (
        <>
          <div className="inventory__bag-grid">
            {/* Spec 4 + spec 1: stackable items (potions / chests / stones)
                sit BEFORE the unique gear items, only on page 0 (subsequent
                pages just show paged gear). Use the SAME `ItemIcon`
                component + `inventory__bag-tile` shell as gear tiles so
                they read as one continuous grid — only the count badge
                (via ItemIcon's `quantity` prop) tells you it's a stack. */}
            {safePage === 0 && filteredStackTiles.map((t) => (
              <div key={t.id} className="inventory__bag-tile">
                <ItemIcon
                  icon={t.icon}
                  rarity={t.rarity}
                  size="md"
                  quantity={t.count}
                  onClick={t.onClick}
                  tooltip={`${t.name} ×${t.count}`}
                />
                <span className="inventory__bag-tile-name" style={{ color: RARITY_COLORS[t.rarity] }}>{t.name}</span>
              </div>
            ))}
            {pagedBag.map((item) => {
              const isChecked = selectedUuids.has(item.uuid);
              const indicator = character ? getUpgradeIndicator(item, character.class, equipment) : null;
              return (
                <BagTile
                  key={item.uuid}
                  item={item}
                  isChecked={isChecked}
                  multiSellMode={multiSellMode}
                  indicator={indicator}
                  onSelect={selectBagItem}
                />
              );
            })}
          </div>
          {/* Pagination bottom bar — only when more than 1 page (avoids
              duplicating the always-on top strip on a single-page list). */}
          {totalPages > 1 && (
            <div className="inventory__pagination">
              <button
                className="inventory__pagination-btn"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
              >
                <Icon name="arrowLeft" /> Poprzednia
              </button>
              <span className="inventory__pagination-info">
                Strona {safePage + 1} / {totalPages}
              </span>
              <button
                className="inventory__pagination-btn"
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
              >
                Następna <Icon name="arrowRight" />
              </button>
            </div>
          )}
        </>
      )}

      {/* Multi-sell footer */}
      {bulkMode === 'sell' && multiSellSummary.count > 0 && (
        <div className="inventory__multi-footer">
          <button className="inventory__multi-sell-btn" onClick={handleMultiSell}>
            <GameIcon name="money-bag" /> Sprzedaj ({multiSellSummary.count} szt. za {formatGoldShort(multiSellSummary.totalGold)})
          </button>
        </div>
      )}

      {/* Mass disassemble footer */}
      {bulkMode === 'disassemble' && disassembleSummary.count > 0 && !disassembleAnimating && (
        <div className="inventory__multi-footer">
          <div className="inventory__disassemble-preview">
            {Object.entries(disassembleSummary.stonesByRarity).map(([stoneId, count]) => (
              <span key={stoneId} className="inventory__disassemble-preview-stone">
                <TinyIcon icon={STONE_ICONS[stoneId] ?? 'gem-stone'} size="sm" /> {STONE_NAMES[stoneId] ?? stoneId}: <strong>x{count}</strong>
              </span>
            ))}
          </div>
          <button className="inventory__mass-disassemble-btn" onClick={handleMassDisassemble}>
            <GameIcon name="hammer" /> Rozloz zaznaczone ({disassembleSummary.count} szt.)
          </button>
        </div>
      )}

      {/* Disassemble progress overlay */}
      {disassembleAnimating && (
        <div className="inventory__disassemble-anim-overlay">
          <div className="inventory__disassemble-anim-box">
            <h3 className="inventory__disassemble-anim-title"><GameIcon name="hammer" /> Rozkladanie przedmiotow...</h3>
            <div className="inventory__disassemble-anim-counter">
              {disassembleProgress} / {disassembleTotalItems}
            </div>
            <div className="inventory__disassemble-anim-bar-wrap">
              <div
                className="inventory__disassemble-anim-bar-fill"
                style={{ width: `${disassembleTotalItems > 0 ? (disassembleProgress / disassembleTotalItems) * 100 : 0}%` }}
              />
            </div>
            <AnimatePresence mode="wait">
              {disassembleCurrentItem && (
                <motion.div
                  key={disassembleCurrentItem}
                  className="inventory__disassemble-anim-item"
                  initial={{ opacity: 1, scale: 1 }}
                  animate={{ opacity: 0, scale: 0.3, y: -20 }}
                  transition={{ duration: 0.15 }}
                >
                  {(() => {
                    const item = bag.find((i) => i.uuid === disassembleCurrentItem);
                    if (!item) return <GameIcon name="package" />;
                    return (
                      <span style={{ color: RARITY_COLORS[item.rarity] }}>
                        <GameIcon name={slotEmoji(item.itemId)} /> {getItemDisplayName(item)}
                      </span>
                    );
                  })()}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Disassemble result popup */}
      {bulkDisassembleResult && (
        <div className="inventory__bulk-result-overlay" onClick={() => setBulkDisassembleResult(null)}>
          <motion.div
            className="inventory__bulk-result"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <h3 className="inventory__bulk-result-title"><GameIcon name="hammer" /> Rozkladanie zakonczone!</h3>
            <div className="inventory__bulk-result-summary">
              <div>Rozlozono przedmiotow: <strong>{bulkDisassembleResult.total}</strong></div>
            </div>
            {Object.keys(bulkDisassembleResult.stones).length > 0 && (
              <div className="inventory__bulk-result-stones">
                <div className="inventory__bulk-result-stones-title">Otrzymane kamienie:</div>
                {Object.entries(bulkDisassembleResult.stones).map(([stoneType, count]) => (
                  <div key={stoneType} className="inventory__bulk-result-stone">
                    <TinyIcon icon={STONE_ICONS[stoneType] ?? 'gem-stone'} size="sm" /> {STONE_NAMES[stoneType] ?? stoneType}: <strong>x{count}</strong>
                  </div>
                ))}
              </div>
            )}
            <button className="inventory__bulk-result-close" onClick={() => setBulkDisassembleResult(null)}>
              OK
            </button>
          </motion.div>
        </div>
      )}

      {/* -- Detail panel ---------------------------------------------------- */}
      <AnimatePresence>
        {freshSelected && (
          <DetailPanel
            key={freshSelected.item.uuid}
            item={freshSelected.item}
            isEquipped={freshSelected.isEquipped}
            equippedSlot={freshSelected.slot}
            onClose={() => { setSelected(null); setDisassembleActive(false); }}
            onDisassembleStateChange={setDisassembleActive}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default Inventory;
