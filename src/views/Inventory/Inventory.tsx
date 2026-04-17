import { memo, useRef, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useCharacterStore } from '../../stores/characterStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useBuffStore } from '../../stores/buffStore';
import {
  EQUIPMENT_SLOTS,
  SLOT_LABELS,
  SLOT_ICONS,
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
  type IInventoryItem,
  getBaseStatKeysForSlot,
  RARITY_BONUS_SLOTS,
  type EquipmentSlot,
  getEnhancementRefund,
  getItemSlotSafe,
} from '../../systems/itemSystem';
import { useSkillStore } from '../../stores/skillStore';
import { getTrainingBonuses } from '../../systems/skillSystem';
import { statPointsForLevelUp, BASE_HP_PER_LEVEL, BASE_MP_PER_LEVEL } from '../../systems/levelSystem';
// TCharacterClass used for class-based filtering
import type { Rarity } from '../../systems/lootSystem';
import { getSpellChestIcon, getSpellChestDisplayName } from '../../systems/lootSystem';
import itemsRaw from '../../data/items.json';
import { getItemDisplayInfo, rerollItemBonuses } from '../../systems/itemGenerator';
import { ELIXIRS } from '../../stores/shopStore';
import { POTION_CONVERSIONS, checkConversionAvailability, getMaxConversions } from '../../systems/potionConversion';
import ItemIcon from '../../components/ui/ItemIcon/ItemIcon';
import { getCharacterAvatar } from '../../data/classAvatars';
import { useTransformStore } from '../../stores/transformStore';
import './Inventory.scss';

const ALL_ITEMS = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);

// ── Stat display names (Polish) ──────────────────────────────────────────────
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

// ── Upgrade indicator logic ────────────────────────────────────────────────

type UpgradeIndicator = 'upgrade' | 'equal' | 'maybe' | null;

const RARITY_RANK: Record<string, number> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
  mythic: 4,
  heroic: 5,
};

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

// ── Slot filter ────────────────────────────────────────────────────────────
// "all" = no slot filter, otherwise filter by specific equipment slot.
type TSlotFilter =
    | 'all'
    | 'weapons' | 'armor' | 'jewelry'
    | EquipmentSlot;

interface ISlotFilterDef { id: TSlotFilter; label: string; icon: string }

const SLOT_FILTERS: ISlotFilterDef[] = [
    { id: 'all',        label: 'Wszystkie',  icon: '🎒' },
    { id: 'weapons',    label: 'Bronie',     icon: '⚔️' },
    { id: 'armor',      label: 'Zbroja',     icon: '🛡️' },
    { id: 'jewelry',    label: 'Biżuteria',  icon: '💍' },
    { id: 'mainHand',   label: 'Główna',     icon: '⚔️' },
    { id: 'offHand',    label: 'Pomocnicza', icon: '🛡️' },
    { id: 'helmet',     label: 'Hełm',       icon: '⛑️' },
    { id: 'shoulders',  label: 'Naramienniki', icon: '🎖️' },
    { id: 'armor',      label: 'Napierśnik', icon: '🦺' },
    { id: 'gloves',     label: 'Rękawice',   icon: '🧤' },
    { id: 'pants',      label: 'Spodnie',    icon: '👖' },
    { id: 'boots',      label: 'Buty',       icon: '👢' },
    { id: 'necklace',   label: 'Naszyjnik',  icon: '📿' },
    { id: 'earrings',   label: 'Kolczyki',   icon: '✨' },
    { id: 'ring1',      label: 'Pierścienie', icon: '💍' },
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

const PAGE_SIZE = 500;

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Memoized bag tile ────────────────────────────────────────────────────────
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
          {isChecked ? '✓' : ''}
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
  attack:     { icon: '⚔️', label: 'ATK',  color: '#ffc107' },
  defense:    { icon: '🛡️', label: 'DEF',  color: '#64b5f6' },
  hp:         { icon: '❤️', label: 'HP',   color: '#e57373' },
  mp:         { icon: '💧', label: 'MP',   color: '#64b5f6' },
  speed:      { icon: '🏃', label: 'SPD',  color: '#81c784' },
  critChance: { icon: '🎯', label: 'CRIT', color: '#ffb74d' },
  critDmg:    { icon: '💥', label: 'CDMG', color: '#ff8a65' },
  dmgMin:     { icon: '⚔️', label: 'DMG',  color: '#ffc107' },
  dmgMax:     { icon: '⚔️', label: 'DMG',  color: '#ffc107' },
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

  // Calculate total stat points ever earned (levels 1 → highest_level)
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

// ── Detail panel ────────────────────────────────────────────────────────────
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
  const { equipItem, unequipItem, sellItem, removeItem, upgradeItem, updateItemBonuses, gold, spendGold, useStones, addStones } = useInventoryStore();
  const stones = useInventoryStore((s) => s.stones);
  const character = useCharacterStore((s) => s.character);
  const [enhanceResult, setEnhanceResult] = useState<'success' | 'fail' | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [disassembleResult, setDisassembleResult] = useState<'success' | 'fail' | null>(null);
  const [disassembling, setDisassembling] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);

  // ── Bonus Reroll state ──────────────────────────────────────────────────────
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

  // ── Bonus Reroll logic ────────────────────────────────────────────────────
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
    setRerollPhase('rolling');

    // Rolling animation (2s) then show preview
    setTimeout(() => {
      const newBonuses = rerollItemBonuses(item, rerollSlot);
      setRerolledBonuses(newBonuses);
      setRerollPhase('preview');
    }, 2000);
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

  return (
    <>
      <motion.div
        className="inventory__overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => { if (!disassembling && !disassembleResult) onClose(); }}
      />
      <motion.div
        className="inventory__detail"
        style={{ '--rarity-color': color } as React.CSSProperties}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', duration: 0.22 }}
      >
        <button
          className="inventory__detail-close"
          onClick={() => { if (!disassembling && !disassembleResult) onClose(); }}
        >✕</button>

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
                    ⚔️ Atak: {weaponDmg.min}–{weaponDmg.max}
                  </span>
                );
              }
              if (!displayStats || !itemSlot) return null;
              const baseKey = BASE_STAT_BY_SLOT[itemSlot];
              if (!baseKey) return null;
              const baseVal = displayStats[baseKey];
              if (!baseVal) return null;
              const meta = BASE_STAT_META[baseKey];
              return (
                <span className="inventory__detail-dmg-range" style={{ color: meta.color }}>
                  {meta.icon} +{baseVal} {meta.label}
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
            const v = displayStats[k];
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

        {/* ── Item comparison with equipped item ──────────────────────── */}
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
                    {(Object.keys(STAT_LABELS) as (keyof IStatValues)[]).map((key) => {
                      const newVal = newStats[key];
                      const oldVal = eqStats[key];
                      const diff = newVal - oldVal;
                      if (newVal === 0 && oldVal === 0) return null;
                      return (
                        <div key={key} className="inventory__comparison-row">
                          <span className="inventory__comparison-stat-name">{STAT_LABELS[key]}</span>
                          <span className="inventory__comparison-old">{oldVal > 0 ? `+${oldVal}` : oldVal}</span>
                          <span className="inventory__comparison-arrow">&rarr;</span>
                          <span className="inventory__comparison-new">{newVal > 0 ? `+${newVal}` : newVal}</span>
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
          Cena sprzedazy: <strong>{sellPrice}g</strong>
          {enhanceRefund.stones > 0 && (
            <span style={{ fontSize: '0.85em', opacity: 0.8, marginLeft: 8 }}>
              +{enhanceRefund.stones} 💎
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
            setEnhancing(true);
            setEnhanceResult(null);
            const success = Math.random() * 100 < cost.successRate;
            spendGold(cost.gold);
            useStones(cost.stoneType, cost.stones);
            // Show result after progress bar animation (1.8s)
            setTimeout(() => {
              if (success) {
                upgradeItem(item.uuid);
                setEnhanceResult('success');
              } else {
                setEnhanceResult('fail');
              }
              setEnhancing(false);
              setTimeout(() => setEnhanceResult(null), 3000);
            }, 1800);
          };

          return (
            <div className={`inventory__detail-enhance${enhanceResult === 'success' ? ' inventory__detail-enhance--success-glow' : ''}${enhanceResult === 'fail' ? ' inventory__detail-enhance--fail-shake' : ''}`}>
              <div className="inventory__detail-enhance-title">
                Ulepszenie +{currentLevel} &rarr; +{nextLevel}
              </div>
              <div className="inventory__detail-enhance-info">
                <span>Szansa: <strong>{cost.successRate}%</strong></span>
                <span>Koszt: <strong>{cost.gold.toLocaleString('pl-PL')}g</strong></span>
                <span>
                  💎 {stoneName}: <strong style={{ color: hasEnoughStones ? '#4caf50' : '#f44336' }}>
                    {ownedStones}/{cost.stones}
                  </strong>
                </span>
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
                {enhancing ? '⏳ Ulepszanie...' : !canAffordGold ? 'Za malo zlota' : !hasEnoughStones ? `Brak ${stoneName}` : `Ulepsz (+${nextLevel})`}
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
                    <span className="inventory__enhance-result-icon">🎉</span>
                    <span>Sukces! Przedmiot ulepszony do +{(item.upgradeLevel ?? 0)}</span>
                    <span className="inventory__enhance-result-sparkles">✨✨✨</span>
                  </motion.div>
                )}
                {enhanceResult === 'fail' && (
                  <motion.div
                    className="inventory__enhance-result inventory__enhance-result--fail"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    <span className="inventory__enhance-result-icon">💔</span>
                    <span>Niepowodzenie! Stracono {cost.gold.toLocaleString('pl-PL')}g i {cost.stones}x {stoneName}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })()}

        <div className="inventory__detail-actions">
          {isEquipped ? (
            <button className="inventory__action-btn inventory__action-btn--unequip" onClick={handleUnequip}>
              Zdejmij
            </button>
          ) : itemSlot ? (
            needsSlotChoice && canEq ? (
              <div className="inventory__slot-choice">
                {isRingSlot ? (
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
                )}
              </div>
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
          {!isEquipped && (
            <button
              className="inventory__action-btn inventory__action-btn--sell"
              onClick={handleSell}
              disabled={actionInProgress}
            >
              Sprzedaj ({sellPrice}g{enhanceRefund.stones > 0 ? ` +${enhanceRefund.stones}💎` : ''})
            </button>
          )}
          {!isEquipped && !disassembleResult && (
            <button
              className="inventory__action-btn inventory__action-btn--disassemble"
              onClick={handleDisassemble}
              disabled={actionInProgress || disassembling}
            >
              {disassembling ? '⏳ Rozkladanie...' : `🔨 Rozloz (20% na 💎 ${disassembleStoneName})`}
            </button>
          )}
        </div>

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
              <span className="inventory__disassemble-result-icon">🎉</span>
              <span>Otrzymano: 💎 {disassembleStoneName} x1</span>
              <span className="inventory__disassemble-result-sparkles">✨✨✨</span>
            </motion.div>
          )}
          {disassembleResult === 'fail' && (
            <motion.div
              className="inventory__disassemble-result inventory__disassemble-result--fail"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
            >
              <span className="inventory__disassemble-result-icon">💔</span>
              <span>Nie otrzymano kamienia</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Bonus Reroll Section ─────────────────────────────────── */}
        {item.rarity !== 'common' && RARITY_BONUS_SLOTS[item.rarity] > 0 && rerollPhase === 'idle' && !disassembling && !disassembleResult && (
          <div className="inventory__reroll-section">
            <button
              className="inventory__action-btn inventory__action-btn--reroll"
              disabled={!canReroll || actionInProgress}
              onClick={handleStartReroll}
            >
              🎲 Zmiana Bonusu ({REROLL_STONE_COST}× 💎 {rerollStoneName})
            </button>
            <span className="inventory__reroll-stone-info">
              Posiadasz: {rerollStoneCount} 💎 {rerollStoneName}
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
                <div className="inventory__reroll-dice">🎲</div>
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
                <div className="inventory__reroll-preview-title">🎲 Nowe Bonusy</div>
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
                  <span className="inventory__reroll-vs">→</span>
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
                    ✅ Przyjmij nowe
                  </button>
                  <button
                    className="inventory__reroll-again"
                    disabled={(useInventoryStore.getState().stones[rerollStoneType] ?? 0) < REROLL_STONE_COST}
                    onClick={handleStartReroll}
                  >
                    🎲 Losuj ponownie ({REROLL_STONE_COST}× 💎)
                  </button>
                  <button className="inventory__reroll-reject" onClick={handleRejectReroll}>
                    ❌ Zostaw obecne
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
};

// ── Main screen ─────────────────────────────────────────────────────────────
type BulkMode = 'none' | 'sell' | 'disassemble';

const Inventory = () => {
  const navigate = useNavigate();
  const { bag, equipment, gold, sellMultiple, disassembleMultiple, consumables, stones, convertStones } = useInventoryStore();
  const { autoSellCommon, autoSellRare, autoSellEpic, autoSellLegendary, autoSellMythic, setAutoSellCommon, setAutoSellRare, setAutoSellEpic, setAutoSellLegendary, setAutoSellMythic } = useSettingsStore();
  const character = useCharacterStore((s) => s.character);
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

  // ── Stone conversion popup state ──────────────────────────────────────────
  const [stoneConvertId, setStoneConvertId] = useState<string | null>(null);
  const [stoneConvertResult, setStoneConvertResult] = useState<'success' | 'fail' | null>(null);

  const handleStoneConvert = useCallback((stoneId: string) => {
    const success = convertStones(stoneId);
    setStoneConvertResult(success ? 'success' : 'fail');
    setTimeout(() => setStoneConvertResult(null), 2000);
  }, [convertStones]);

  // ── Alchemy (potion conversion) state ─────────────────────────────────────
  const [alchemyOpen, setAlchemyOpen] = useState(false);
  const [alchemyToast, setAlchemyToast] = useState<string | null>(null);
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

  // ── Multi-sell / disassemble state ─────────────────────────────────────────
  const [bulkMode, setBulkMode] = useState<BulkMode>('none');
  const multiSellMode = bulkMode !== 'none';
  const [selectedUuids, setSelectedUuids] = useState<Set<string>>(new Set());

  // ── Disassemble animation state ────────────────────────────────────────────
  const [disassembleAnimating, setDisassembleAnimating] = useState(false);
  const [disassembleProgress, setDisassembleProgress] = useState(0);
  const [disassembleTotalItems, setDisassembleTotalItems] = useState(0);
  const [disassembleCurrentItem, setDisassembleCurrentItem] = useState<string | null>(null);

  // Point 3: stable reference so memoized BagTile doesn't re-render when
  // unrelated parent state (DetailPanel open, stone popup, etc.) changes.
  // The ref pattern keeps the callback identity stable across bulkMode changes
  // — only re-renders of BagTile will be driven by its own props (isChecked /
  // multiSellMode), not by callback identity churn.
  // NOTE: We inline the toggle logic here (instead of calling `toggleSelect`)
  // because `toggleSelect` is declared later in the component — referencing it
  // in the deps array would cause a TDZ ReferenceError at mount time.
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
        if (slotFilter === 'weapons') return slot === 'mainHand' || slot === 'offHand';
        if (slotFilter === 'armor')   return slot === 'helmet' || slot === 'armor' || slot === 'pants'
                                          || slot === 'gloves' || slot === 'shoulders' || slot === 'boots';
        if (slotFilter === 'jewelry') return slot === 'ring1' || slot === 'ring2' || slot === 'necklace' || slot === 'earrings';
        // ring1 filter matches both ring1 and ring2
        if (slotFilter === 'ring1')   return slot === 'ring1' || slot === 'ring2';
        return slot === slotFilter;
      });
    }
    return out;
  }, [sortedBag, rarityFilter, slotFilter]);

  // ── Pagination ─────────────────────────────────────────────────────────────
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

  // ── Multi-sell helpers ──────────────────────────────────────────────────────

  const toggleSelect = useCallback((uuid: string) => {
    setSelectedUuids((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) {
        next.delete(uuid);
      } else {
        next.add(uuid);
      }
      return next;
    });
  }, []);

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

  // ── Mass Disassemble (dedicated mode with animation) ───────────────────────
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

  // ── Disassemble summary for footer ─────────────────────────────────────────
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

  return (
    <div className="inventory">
      <header className="inventory__header">
        <button className="inventory__back" onClick={() => navigate('/')}>← Miasto</button>
        <h1 className="inventory__title">Ekwipunek</h1>
        <span className="inventory__gold">💰 {gold}g</span>
      </header>

      {/* ── Paperdoll: avatar + equipment overlay ─────────────────────── */}
      {character && (() => {
          const eqS = getTotalEquipmentStats(equipment, ALL_ITEMS);
          const tb = getTrainingBonuses(useSkillStore.getState().skillLevels, character.class);
          const effMaxHp = character.max_hp + (eqS.hp ?? 0) + (tb.max_hp ?? 0);
          const effMaxMp = character.max_mp + (eqS.mp ?? 0) + (tb.max_mp ?? 0);
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
                      <div className="inventory__paperdoll-avatar">
                          <img
                              src={playerAvatarSrc}
                              alt={character.class}
                              className="inventory__paperdoll-avatar-img"
                          />
                          <div className="inventory__paperdoll-avatar-overlay">
                              <span className="inventory__paperdoll-avatar-name">{character.class}</span>
                              <span className="inventory__paperdoll-avatar-level">Lvl {character.level}</span>
                          </div>
                      </div>

                      {EQUIPMENT_SLOTS.map((slot) => {
                          const item = equipment[slot];
                          const color = item ? RARITY_COLORS[item.rarity] : undefined;
                          return (
                              <button
                                  key={slot}
                                  className={`inventory__doll-slot inventory__doll-slot--${slot}${item ? ' inventory__doll-slot--filled' : ''}`}
                                  style={color ? ({ '--rarity-color': color } as React.CSSProperties) : undefined}
                                  onClick={() => item && selectEquippedItem(item, slot)}
                                  aria-label={SLOT_LABELS[slot]}
                              >
                                  {item ? (
                                      <ItemIcon
                                          icon={slotEmoji(item.itemId)}
                                          rarity={item.rarity}
                                          upgradeLevel={item.upgradeLevel}
                                          itemLevel={item.itemLevel || 1}
                                          size="md"
                                          showTooltip={false}
                                      />
                                  ) : (
                                      <span className="inventory__doll-slot-icon">{SLOT_ICONS[slot]}</span>
                                  )}
                              </button>
                          );
                      })}
                  </div>
              </div>
          );
      })()}

      <hr className="inventory__separator" />

      {/* ── Enhancement Stones summary ────────────────────────────────────── */}
      {(() => {
        const stoneEntries = RARITY_ORDER.map((rarity) => {
          const stoneId = STONE_FOR_RARITY[rarity];
          const count = stones[stoneId] ?? 0;
          return { rarity, stoneId, count };
        });
        const hasAnyStones = stoneEntries.some((e) => e.count > 0);
        if (!hasAnyStones) return null;
        return (
          <div className="inventory__stones">
            <div className="inventory__stones-title">Kamienie ulepszenia (kliknij aby zamienic)</div>
            <div className="inventory__stones-grid">
              {stoneEntries.map(({ rarity, stoneId, count }) => (
                <button
                  key={stoneId}
                  className={`inventory__stone-chip${count > 0 ? ' inventory__stone-chip--clickable' : ' inventory__stone-chip--empty'}`}
                  style={{ '--stone-color': RARITY_COLORS[rarity] } as React.CSSProperties}
                  onClick={() => count > 0 && setStoneConvertId(stoneId)}
                >
                  <span className="inventory__stone-icon">{STONE_ICONS[stoneId] ?? '💎'}</span>
                  <span className="inventory__stone-name">{STONE_NAMES[stoneId]}</span>
                  <span className="inventory__stone-count">{count}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Stone Conversion Popup ───────────────────────────────────────── */}
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
                  ✕
                </button>
                <h3 className="inventory__stone-popup-title">Zamiana kamieni</h3>

                <div className="inventory__stone-popup-current">
                  <span className="inventory__stone-popup-gem" style={{ color: currentColor }}>💎</span>
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
                      <span className="inventory__stone-popup-gem" style={{ color: higherColor }}>💎</span>
                      <span className="inventory__stone-popup-name" style={{ color: higherColor }}>{higherName}</span>
                      <span className="inventory__stone-popup-count">x{higherCount}</span>
                    </div>

                    <div className="inventory__stone-popup-cost">
                      Koszt: <strong>{STONE_CONVERSION_GOLD.toLocaleString('pl-PL')}g</strong>
                      <span className="inventory__stone-popup-gold-status" style={{ color: gold >= STONE_CONVERSION_GOLD ? '#4caf50' : '#f44336' }}>
                        {' '}(masz: {gold.toLocaleString('pl-PL')}g)
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

      {/* ── Bag section ───────────────────────────────────────────────────── */}
      <div className="inventory__bag-header">
        <span className="inventory__bag-count">Plecak: {bag.length} / 1000</span>
        {bulkMode !== 'none' ? (
          <button
            className="inventory__multi-sell-toggle inventory__multi-sell-toggle--active"
            onClick={exitMultiSell}
          >
            ✕ Anuluj
          </button>
        ) : (
          <>
            <button
              className="inventory__multi-sell-toggle"
              onClick={() => setBulkMode('sell')}
            >
              Sprzedaz masowa
            </button>
            <button
              className="inventory__multi-sell-toggle inventory__multi-sell-toggle--disassemble"
              onClick={() => setBulkMode('disassemble')}
            >
              🔨 Rozloz masowo
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
            Zwykle {autoSellCommon ? '✓' : '✗'}
          </button>
          <button
            className={`inventory__auto-sell-btn inventory__auto-sell-btn--rare${autoSellRare ? ' inventory__auto-sell-btn--active' : ''}`}
            onClick={() => setAutoSellRare(!autoSellRare)}
            title="Automatycznie sprzedawaj Rare przedmioty"
          >
            Rzadkie {autoSellRare ? '✓' : '✗'}
          </button>
          <button
            className={`inventory__auto-sell-btn inventory__auto-sell-btn--epic${autoSellEpic ? ' inventory__auto-sell-btn--active' : ''}`}
            onClick={() => setAutoSellEpic(!autoSellEpic)}
            title="Automatycznie sprzedawaj Epic przedmioty"
          >
            Epickie {autoSellEpic ? '✓' : '✗'}
          </button>
          <button
            className={`inventory__auto-sell-btn inventory__auto-sell-btn--legendary${autoSellLegendary ? ' inventory__auto-sell-btn--active' : ''}`}
            onClick={() => setAutoSellLegendary(!autoSellLegendary)}
            title="Automatycznie sprzedawaj Legendary przedmioty"
          >
            Legendarne {autoSellLegendary ? '✓' : '✗'}
          </button>
          <button
            className={`inventory__auto-sell-btn inventory__auto-sell-btn--mythic${autoSellMythic ? ' inventory__auto-sell-btn--active' : ''}`}
            onClick={() => setAutoSellMythic(!autoSellMythic)}
            title="Automatycznie sprzedawaj Mythic przedmioty"
          >
            Mityczne {autoSellMythic ? '✓' : '✗'}
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
        {SLOT_FILTER_BUTTONS.map((f) => (
          <button
            key={f.id}
            className={`inventory__filter-btn inventory__filter-btn--slot${slotFilter === f.id ? ' inventory__filter-btn--active' : ''}`}
            onClick={() => setSlotFilter(f.id)}
            title={f.label}
          >
            <span className="inventory__filter-btn-icon">{f.icon}</span>
            <span className="inventory__filter-btn-label">{f.label}</span>
          </button>
        ))}
      </div>

      {/* Multi-sell / disassemble controls */}
      {bulkMode !== 'none' && (
        <div className="inventory__multi-controls">
          <span className={`inventory__bulk-mode-label${bulkMode === 'disassemble' ? ' inventory__bulk-mode-label--disassemble' : ''}`}>
            {bulkMode === 'sell' ? '💰 Tryb sprzedazy' : '🔨 Tryb rozkladania'}
          </span>
          <button className="inventory__multi-btn" onClick={selectAll}>Zaznacz wszystkie</button>
          <button className="inventory__multi-btn" onClick={deselectAll}>Odznacz wszystkie</button>
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

      {/* Consumables (potions/elixirs) */}
      {!multiSellMode && (() => {
        const ownedConsumables = ELIXIRS.filter((e) => (consumables[e.id] ?? 0) > 0);
        if (ownedConsumables.length === 0) return null;
        const BUFF_CONFIG: Record<string, { id: string; name: string; icon: string; effect: string; durationMs: number; pausable?: boolean }> = {
            'xp_boost_1h': { id: 'xp_boost', name: 'XP +50%', icon: '⭐', effect: 'xp_boost', durationMs: 3600000, pausable: true },
            'skill_xp_boost_1h': { id: 'skill_xp_boost', name: 'Skill XP +50%', icon: '✨', effect: 'skill_xp_boost', durationMs: 3600000, pausable: true },
            'attack_speed_0.20_15m_pausable': { id: 'attack_speed', name: 'AS +20%', icon: '⚡', effect: 'attack_speed', durationMs: 900000, pausable: true },
            'cooldown_reduction_0.20_30m': { id: 'cooldown_reduction', name: 'CD -20%', icon: '🌀', effect: 'cooldown_reduction', durationMs: 1800000 },
            'hp_pct_25_15m': { id: 'hp_pct_25', name: 'Max HP +25%', icon: '❤️‍🔥', effect: 'hp_pct_25', durationMs: 900000, pausable: true },
            'mp_pct_25_15m': { id: 'mp_pct_25', name: 'Max MP +25%', icon: '💠', effect: 'mp_pct_25', durationMs: 900000, pausable: true },
            'offline_training_boost': { id: 'offline_training_boost', name: 'Trening x2', icon: '🏋️', effect: 'offline_training_boost', durationMs: 3600000, pausable: true },
            'utamo_vita': { id: 'utamo_vita', name: 'Utamo Vita', icon: '🔵', effect: 'utamo_vita', durationMs: 600000 },
            'premium_xp_boost': { id: 'premium_xp_boost', name: 'Premium XP x2', icon: '💎', effect: 'premium_xp_boost', durationMs: 43200000, pausable: true },
            'atk_dmg_25_15m': { id: 'atk_dmg_25', name: 'ATK DMG +25%', icon: '⚔️', effect: 'atk_dmg_25', durationMs: 900000, pausable: true },
            'atk_dmg_50_15m': { id: 'atk_dmg_50', name: 'ATK DMG +50%', icon: '⚔️', effect: 'atk_dmg_50', durationMs: 900000, pausable: true },
            'atk_dmg_100_15m': { id: 'atk_dmg_100', name: 'ATK DMG +100%', icon: '⚔️', effect: 'atk_dmg_100', durationMs: 900000, pausable: true },
            'spell_dmg_25_15m': { id: 'spell_dmg_25', name: 'SPELL DMG +25%', icon: '🔮', effect: 'spell_dmg_25', durationMs: 900000, pausable: true },
            'spell_dmg_50_15m': { id: 'spell_dmg_50', name: 'SPELL DMG +50%', icon: '🔮', effect: 'spell_dmg_50', durationMs: 900000, pausable: true },
            'spell_dmg_100_15m': { id: 'spell_dmg_100', name: 'SPELL DMG +100%', icon: '🔮', effect: 'spell_dmg_100', durationMs: 900000, pausable: true },
            'hp_boost_500_15m': { id: 'hp_boost_500', name: '+500 Max HP', icon: '🩸', effect: 'hp_boost_500', durationMs: 900000, pausable: true },
            'mp_boost_500_15m': { id: 'mp_boost_500', name: '+500 Max MP', icon: '🔷', effect: 'mp_boost_500', durationMs: 900000, pausable: true },
            'atk_boost_50_15m': { id: 'atk_boost_50', name: '+50 ATK', icon: '💪', effect: 'atk_boost_50', durationMs: 900000, pausable: true },
            'def_boost_50_15m': { id: 'def_boost_50', name: '+50 DEF', icon: '🛡️', effect: 'def_boost_50', durationMs: 900000, pausable: true },
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
            <div className="inventory__consumables-title">Potiony i Eliksiry</div>
            <div className="inventory__consumables-grid">
              {ownedConsumables.map((elixir) => {
                const count = consumables[elixir.id] ?? 0;
                const effect = elixir.effect;
                let tileClass = 'inventory__consumable-tile';
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
                      const buffData = { id: cfg.id, name: cfg.name, icon: cfg.icon, effect: cfg.effect };
                      if (cfg.pausable) {
                        useBuffStore.getState().addPausableBuff(buffData, cfg.durationMs);
                      } else {
                        useBuffStore.getState().addBuff(buffData, cfg.durationMs);
                      }
                      useInventoryStore.getState().addConsumable(elixir.id, -1);
                    };
                  }
                } else {
                  const isHpPotion = effect.startsWith('heal_hp');
                  const isMpPotion = effect.startsWith('heal_mp');
                  if (isHpPotion || isMpPotion) {
                    const char = useCharacterStore.getState().character;
                    if (char) {
                      const eqS = getTotalEquipmentStats(equipment, ALL_ITEMS);
                      const tb = getTrainingBonuses(useSkillStore.getState().skillLevels, char.class);
                      const effMaxHp = char.max_hp + (eqS.hp ?? 0) + (tb.max_hp ?? 0);
                      const effMaxMp = char.max_mp + (eqS.mp ?? 0) + (tb.max_mp ?? 0);
                      const isFull = isHpPotion ? char.hp >= effMaxHp : char.mp >= effMaxMp;
                      disabled = isFull || count <= 0;
                      title = isFull
                        ? (isHpPotion ? 'HP jest pelne' : 'MP jest pelne')
                        : `Uzyj ${elixir.name_pl}`;
                      onUse = () => {
                        const freshChar = useCharacterStore.getState().character;
                        if (!freshChar) return;
                        const eqS2 = getTotalEquipmentStats(equipment, ALL_ITEMS);
                        const tb2 = getTrainingBonuses(useSkillStore.getState().skillLevels, freshChar.class);
                        const curMaxHp = freshChar.max_hp + (eqS2.hp ?? 0) + (tb2.max_hp ?? 0);
                        const curMaxMp = freshChar.max_mp + (eqS2.mp ?? 0) + (tb2.max_mp ?? 0);
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
                    <span className="inventory__consumable-tile-icon">{elixir.icon}</span>
                    <span className="inventory__consumable-tile-name">{elixir.name_pl}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Spell Chests (stackable consumables, not in ELIXIRS list) */}
      {!multiSellMode && (() => {
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
            <div className="inventory__consumables-title">Spell Chesty</div>
            <div className="inventory__consumables-grid">
              {chestEntries.map(({ key, level, count }) => (
                <div
                  key={key}
                  className="inventory__consumable-tile inventory__consumable-tile--chest"
                  title={`${getSpellChestDisplayName(level)} — uzywany do odblokowywania i ulepszania skilli Lvl ${level}+`}
                >
                  <span className="inventory__consumable-tile-count">×{count}</span>
                  <span className="inventory__consumable-tile-icon">{getSpellChestIcon(level)}</span>
                  <span className="inventory__consumable-tile-name">{getSpellChestDisplayName(level)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Alchemy (potion conversion) */}
      {!multiSellMode && (
        <div className="inventory__alchemy">
          <button
            className="inventory__alchemy-toggle"
            onClick={() => setAlchemyOpen((v) => !v)}
          >
            <span>🧪 Alchemia</span>
            <span className="inventory__alchemy-chevron">{alchemyOpen ? '▲' : '▼'}</span>
          </button>
          {alchemyOpen && (
            <div className="inventory__alchemy-panel">
              <p className="inventory__alchemy-hint">
                Zamieniaj slabsze eliksiry na mocniejsze. Bez kosztu – plac tylko potionami!
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
                        <span className="inventory__alchemy-icon">{conv.inputIcon}</span>
                        <div className="inventory__alchemy-texts">
                          <span className="inventory__alchemy-name">{conv.inputName}</span>
                          <span className="inventory__alchemy-owned">Posiadasz: {owned}</span>
                        </div>
                      </div>
                      <span className="inventory__alchemy-arrow">→</span>
                      <div className="inventory__alchemy-output">
                        <span className="inventory__alchemy-icon">{conv.outputIcon}</span>
                        <div className="inventory__alchemy-texts">
                          <span className="inventory__alchemy-name">{conv.outputName}</span>
                          <span className="inventory__alchemy-owned">Masz: {outputOwned}</span>
                        </div>
                      </div>
                      <div className="inventory__alchemy-ratio">
                        {conv.inputCount}:1
                      </div>
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
                          {levelTooLow ? `Wymagany lvl ${conv.outputMinLevel}` : canConvert ? `${totalInput} → ${amount}` : 'Za malo'}
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
                        🧪 Przetworz
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {filteredBag.length === 0 ? (
        <p className="inventory__empty">
          {bag.length === 0
            ? 'Plecak jest pusty. Idz walczyc!'
            : 'Brak przedmiotow dla wybranego filtra.'}
        </p>
      ) : (
        <>
          {/* Pagination top bar (only shown if >1 page) */}
          {totalPages > 1 && (
            <div className="inventory__pagination">
              <button
                className="inventory__pagination-btn"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
              >
                ← Poprzednia
              </button>
              <span className="inventory__pagination-info">
                Strona {safePage + 1} / {totalPages}
                <span className="inventory__pagination-range">
                  {' '}({safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filteredBag.length)} z {filteredBag.length})
                </span>
              </span>
              <button
                className="inventory__pagination-btn"
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
              >
                Następna →
              </button>
            </div>
          )}
          <div className="inventory__bag-grid">
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
          {/* Pagination bottom bar (duplicate for long pages) */}
          {totalPages > 1 && (
            <div className="inventory__pagination">
              <button
                className="inventory__pagination-btn"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
              >
                ← Poprzednia
              </button>
              <span className="inventory__pagination-info">
                Strona {safePage + 1} / {totalPages}
              </span>
              <button
                className="inventory__pagination-btn"
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
              >
                Następna →
              </button>
            </div>
          )}
        </>
      )}

      {/* Multi-sell footer */}
      {bulkMode === 'sell' && multiSellSummary.count > 0 && (
        <div className="inventory__multi-footer">
          <button className="inventory__multi-sell-btn" onClick={handleMultiSell}>
            💰 Sprzedaj ({multiSellSummary.count} szt. za {multiSellSummary.totalGold}g)
          </button>
        </div>
      )}

      {/* Mass disassemble footer */}
      {bulkMode === 'disassemble' && disassembleSummary.count > 0 && !disassembleAnimating && (
        <div className="inventory__multi-footer">
          <div className="inventory__disassemble-preview">
            {Object.entries(disassembleSummary.stonesByRarity).map(([stoneId, count]) => (
              <span key={stoneId} className="inventory__disassemble-preview-stone">
                💎 {STONE_NAMES[stoneId] ?? stoneId}: <strong>x{count}</strong>
              </span>
            ))}
          </div>
          <button className="inventory__mass-disassemble-btn" onClick={handleMassDisassemble}>
            🔨 Rozloz zaznaczone ({disassembleSummary.count} szt.)
          </button>
        </div>
      )}

      {/* Disassemble progress overlay */}
      {disassembleAnimating && (
        <div className="inventory__disassemble-anim-overlay">
          <div className="inventory__disassemble-anim-box">
            <h3 className="inventory__disassemble-anim-title">🔨 Rozkladanie przedmiotow...</h3>
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
                    if (!item) return '📦';
                    return (
                      <span style={{ color: RARITY_COLORS[item.rarity] }}>
                        {slotEmoji(item.itemId)} {getItemDisplayName(item)}
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
            <h3 className="inventory__bulk-result-title">🔨 Rozkladanie zakonczone!</h3>
            <div className="inventory__bulk-result-summary">
              <div>Rozlozono przedmiotow: <strong>{bulkDisassembleResult.total}</strong></div>
            </div>
            {Object.keys(bulkDisassembleResult.stones).length > 0 && (
              <div className="inventory__bulk-result-stones">
                <div className="inventory__bulk-result-stones-title">Otrzymane kamienie:</div>
                {Object.entries(bulkDisassembleResult.stones).map(([stoneType, count]) => (
                  <div key={stoneType} className="inventory__bulk-result-stone">
                    💎 {STONE_NAMES[stoneType] ?? stoneType}: <strong>x{count}</strong>
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

      {/* ── Detail panel ──────────────────────────────────────────────────── */}
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
