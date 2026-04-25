import { create } from 'zustand';
import itemTemplates from '../data/itemTemplates.json';
import { generateWeapon, generateOffhand, generateArmor, generateAccessory } from '../systems/itemGenerator';
import type { Rarity, EquipmentSlot } from '../systems/itemSystem';
import { CLASS_WEAPON_TYPES, CLASS_OFFHAND_TYPES, CLASS_ARMOR_TYPES, RARITY_LABELS } from '../systems/itemSystem';
import { useInventoryStore } from './inventoryStore';
import type { ICharacter } from './characterStore';

// ── Elixir definitions (always available in shop) ─────────────────────────────

export interface IElixir {
  id: string;
  name_pl: string;
  name_en: string;
  description_pl: string;
  price: number;
  effect: string;
  icon: string;
  minLevel?: number;
}

export const ELIXIRS: IElixir[] = [
  // ── HP Potions ──
  { id: 'hp_potion_sm', name_pl: 'Maly Eliksir HP', name_en: 'Small Health Potion', description_pl: 'Przywraca 50 HP.', price: 30, effect: 'heal_hp_50', icon: '❤️', minLevel: 1 },
  { id: 'hp_potion_md', name_pl: 'Eliksir HP', name_en: 'Health Potion', description_pl: 'Przywraca 150 HP.', price: 150, effect: 'heal_hp_150', icon: '❤️', minLevel: 20 },
  { id: 'hp_potion_lg', name_pl: 'Silny Eliksir HP', name_en: 'Strong Health Potion', description_pl: 'Przywraca 400 HP.', price: 600, effect: 'heal_hp_400', icon: '❤️', minLevel: 50 },
  { id: 'hp_potion_mega', name_pl: 'Mega Eliksir HP', name_en: 'Mega Health Elixir', description_pl: 'Natychmiast przywraca 1000 HP.', price: 15000, effect: 'heal_hp_1000', icon: '❤️‍🔥', minLevel: 100 },
  { id: 'hp_potion_great', name_pl: 'Wielki Eliksir HP', name_en: 'Great Health Potion', description_pl: 'Przywraca 20% maks. HP.', price: 2000, effect: 'heal_hp_pct_20', icon: '❤️', minLevel: 100 },
  { id: 'hp_potion_super', name_pl: 'Super Eliksir HP', name_en: 'Super Health Potion', description_pl: 'Przywraca 35% maks. HP.', price: 7500, effect: 'heal_hp_pct_35', icon: '❤️', minLevel: 200 },
  { id: 'hp_potion_ultimate', name_pl: 'Ultimatywny Eliksir HP', name_en: 'Ultimate Health Potion', description_pl: 'Przywraca 50% maks. HP.', price: 30000, effect: 'heal_hp_pct_50', icon: '❤️', minLevel: 400 },
  { id: 'hp_potion_divine', name_pl: 'Boski Eliksir HP', name_en: 'Divine Health Potion', description_pl: 'Przywraca 100% maks. HP.', price: 150000, effect: 'heal_hp_pct_100', icon: '❤️', minLevel: 600 },
  // ── MP Potions ──
  { id: 'mp_potion_sm', name_pl: 'Maly Eliksir MP', name_en: 'Small Mana Potion', description_pl: 'Przywraca 30 MP.', price: 30, effect: 'heal_mp_30', icon: '💧', minLevel: 1 },
  { id: 'mp_potion_md', name_pl: 'Eliksir MP', name_en: 'Mana Potion', description_pl: 'Przywraca 100 MP.', price: 150, effect: 'heal_mp_100', icon: '💧', minLevel: 20 },
  { id: 'mp_potion_lg', name_pl: 'Silny Eliksir MP', name_en: 'Strong Mana Potion', description_pl: 'Przywraca 300 MP.', price: 600, effect: 'heal_mp_300', icon: '💧', minLevel: 50 },
  { id: 'mp_potion_mega', name_pl: 'Mega Eliksir MP', name_en: 'Mega Mana Elixir', description_pl: 'Natychmiast przywraca 1000 MP.', price: 15000, effect: 'heal_mp_1000', icon: '💎', minLevel: 100 },
  { id: 'mp_potion_great', name_pl: 'Wielki Eliksir MP', name_en: 'Great Mana Potion', description_pl: 'Przywraca 20% maks. MP.', price: 2000, effect: 'heal_mp_pct_20', icon: '💧', minLevel: 100 },
  { id: 'mp_potion_super', name_pl: 'Super Eliksir MP', name_en: 'Super Mana Potion', description_pl: 'Przywraca 35% maks. MP.', price: 7500, effect: 'heal_mp_pct_35', icon: '💧', minLevel: 200 },
  { id: 'mp_potion_ultimate', name_pl: 'Ultimatywny Eliksir MP', name_en: 'Ultimate Mana Potion', description_pl: 'Przywraca 50% maks. MP.', price: 30000, effect: 'heal_mp_pct_50', icon: '💧', minLevel: 400 },
  { id: 'mp_potion_divine', name_pl: 'Boski Eliksir MP', name_en: 'Divine Mana Potion', description_pl: 'Przywraca 100% maks. MP.', price: 150000, effect: 'heal_mp_pct_100', icon: '💧', minLevel: 600 },
  // ── Buff Elixirs ──
  { id: 'xp_boost', name_pl: 'Dopalacz XP', name_en: 'XP Boost', description_pl: '+50% XP przez 1 godzine.', price: 18000, effect: 'xp_boost_1h', icon: '⭐', minLevel: 1 },
  { id: 'skill_xp_boost', name_pl: 'Dopalacz Skilli', name_en: 'Skill XP Boost', description_pl: '+50% XP skillow przez 1 godzine.', price: 18000, effect: 'skill_xp_boost_1h', icon: '✨', minLevel: 1 },
  { id: 'attack_speed_elixir', name_pl: 'Eliksir Szybkosci', name_en: 'Attack Speed Elixir', description_pl: '+20% predkosci ataku przez 15 min (czas biegnie TYLKO w walce).', price: 8000, effect: 'attack_speed_0.20_15m_pausable', icon: '⚡', minLevel: 1 },
  { id: 'cd_reduction_elixir', name_pl: 'Eliksir Skupienia', name_en: 'Cooldown Reduction', description_pl: '-20% cooldowny przez 30 min.', price: 12000, effect: 'cooldown_reduction_0.20_30m', icon: '🌀', minLevel: 1 },
  // ── Reset Elixirs ──
  { id: 'dungeon_reset', name_pl: 'Reset Dungeonu', name_en: 'Dungeon Reset', description_pl: 'Resetuje proby wybranego dungeonu (+5 prob).', price: 37500, effect: 'dungeon_reset', icon: '🏰', minLevel: 1 },
  { id: 'boss_reset', name_pl: 'Reset Bossa', name_en: 'Boss Reset', description_pl: 'Resetuje proby wybranego bossa (+3 proby).', price: 52500, effect: 'boss_reset', icon: '👹', minLevel: 1 },
  // ── Death Protection ──
  { id: 'death_protection', name_pl: 'Eliksir Ochrony przed Smiercia', name_en: 'Death Protection Potion', description_pl: 'Zapobiega utracie statystyk i poziomu przy smierci (1 uzycie). Cena zalezy od poziomu postaci.', price: 0, effect: 'death_protection', icon: '🛡️', minLevel: 1 },
  { id: 'amulet_of_loss', name_pl: 'Amulet of Loss', name_en: 'Amulet of Loss', description_pl: 'Chroni Twoje przedmioty (plecak + ekwipunek) przed utrata przy smierci. Pęka po jednym uzyciu. NIE chroni przed utrata poziomu. Cena zalezy od poziomu postaci.', price: 0, effect: 'amulet_of_loss', icon: '🔱', minLevel: 1 },
  // ── Stat Reset ──
  { id: 'stat_reset', name_pl: 'Eliksir Resetu Statystyk', name_en: 'Stat Reset Elixir', description_pl: 'Resetuje wszystkie rozdane punkty statystyk i pozwala je rozdac ponownie.', price: 500000, effect: 'stat_reset', icon: '🔄', minLevel: 1 },
  // ── Training / Combat Elixirs ──
  { id: 'offline_training_boost', name_pl: 'Eliksir Treningu x2', name_en: 'Training Elixir x2', description_pl: 'Podwaja XP z treningu offline przez 1h (czas biegnie TYLKO podczas aktywnego treningu). Mozna stackowac czas.', price: 3000, effect: 'offline_training_boost', icon: '🏋️', minLevel: 1 },
  { id: 'utamo_vita', name_pl: 'Utamo Vita', name_en: 'Utamo Vita (Magic Shield)', description_pl: '50% otrzymywanego dmg idzie w MP zamiast HP przez 10 min. Tarcza peka gdy MP spadnie do 0.', price: 7500, effect: 'utamo_vita', icon: '🔵', minLevel: 1 },
  { id: 'premium_xp_boost', name_pl: 'Premium Eliksir XP', name_en: 'Premium XP Elixir', description_pl: 'x2 XP z walki z potworami przez 12h (czas biegnie TYLKO podczas aktywnej walki z potworami). Stackuje sie z normalnym XP boostem.', price: 75000, effect: 'premium_xp_boost', icon: '💎', minLevel: 1 },
  // ── Combat Elixirs (pausable, 15 min, tick down only in combat) ──
  { id: 'atk_dmg_elixir_25', name_pl: 'Eliksir Ataku I', name_en: 'Attack Damage Elixir I', description_pl: '+25% obrazen z ataku przez 15 min (czas biegnie TYLKO w walce).', price: 1500, effect: 'atk_dmg_25_15m', icon: '⚔️', minLevel: 1 },
  { id: 'atk_dmg_elixir_50', name_pl: 'Eliksir Ataku II', name_en: 'Attack Damage Elixir II', description_pl: '+50% obrazen z ataku przez 15 min (czas biegnie TYLKO w walce).', price: 5000, effect: 'atk_dmg_50_15m', icon: '⚔️', minLevel: 30 },
  { id: 'atk_dmg_elixir_100', name_pl: 'Eliksir Ataku III', name_en: 'Attack Damage Elixir III', description_pl: '+100% obrazen z ataku przez 15 min (czas biegnie TYLKO w walce).', price: 15000, effect: 'atk_dmg_100_15m', icon: '⚔️', minLevel: 80 },
  { id: 'spell_dmg_elixir_25', name_pl: 'Eliksir Magii I', name_en: 'Spell Damage Elixir I', description_pl: '+25% obrazen ze spelli przez 15 min (czas biegnie TYLKO w walce).', price: 1500, effect: 'spell_dmg_25_15m', icon: '🔮', minLevel: 1 },
  { id: 'spell_dmg_elixir_50', name_pl: 'Eliksir Magii II', name_en: 'Spell Damage Elixir II', description_pl: '+50% obrazen ze spelli przez 15 min (czas biegnie TYLKO w walce).', price: 5000, effect: 'spell_dmg_50_15m', icon: '🔮', minLevel: 30 },
  { id: 'spell_dmg_elixir_100', name_pl: 'Eliksir Magii III', name_en: 'Spell Damage Elixir III', description_pl: '+100% obrazen ze spelli przez 15 min (czas biegnie TYLKO w walce).', price: 15000, effect: 'spell_dmg_100_15m', icon: '🔮', minLevel: 80 },
  { id: 'hp_boost_elixir', name_pl: 'Eliksir Witalnosci', name_en: 'Vitality Elixir', description_pl: '+500 Max HP przez 15 min (czas biegnie TYLKO w walce).', price: 2000, effect: 'hp_boost_500_15m', icon: '🩸', minLevel: 1 },
  { id: 'mp_boost_elixir', name_pl: 'Eliksir Many', name_en: 'Mana Elixir', description_pl: '+500 Max MP przez 15 min (czas biegnie TYLKO w walce).', price: 2000, effect: 'mp_boost_500_15m', icon: '🔷', minLevel: 1 },
  { id: 'atk_boost_elixir', name_pl: 'Eliksir Sily', name_en: 'Strength Elixir', description_pl: '+50 Attack przez 15 min (czas biegnie TYLKO w walce).', price: 3000, effect: 'atk_boost_50_15m', icon: '💪', minLevel: 1 },
  { id: 'def_boost_elixir', name_pl: 'Eliksir Zelaza', name_en: 'Iron Elixir', description_pl: '+50 Defense przez 15 min (czas biegnie TYLKO w walce).', price: 3000, effect: 'def_boost_50_15m', icon: '🛡️', minLevel: 1 },
  // ── Premium HP/MP Elixirs (expensive, pausable, only tick in combat) ──
  { id: 'hp_pct_elixir_25', name_pl: 'Eliksir Kolosa', name_en: 'Colossus Elixir', description_pl: '+25% Max HP przez 15 min (czas biegnie TYLKO w walce). Drogi, ale potezny.', price: 75000, effect: 'hp_pct_25_15m', icon: '❤️‍🔥', minLevel: 50 },
  { id: 'mp_pct_elixir_25', name_pl: 'Eliksir Arcymaga', name_en: 'Archmage Elixir', description_pl: '+25% Max MP przez 15 min (czas biegnie TYLKO w walce). Drogi, ale potezny.', price: 75000, effect: 'mp_pct_25_15m', icon: '💠', minLevel: 50 },
];

// ── Dynamic pricing for death-protection items ──────────────────────────────
// AOL cost    = gold from task of killing 2500 monsters at player's level
// Elixir cost = gold from task of killing 10000 monsters at player's level
//
// Uses the real task reward formula: maxGold * killCount * 3
// where maxGold comes from the closest monster to the player's level.

import monstersRaw from '../data/monsters.json';
import { computeTaskRewards, type IMonsterRewardSource } from '../systems/taskRewards';

const _monstersForPricing = (monstersRaw as Array<{ level: number; xp: number; gold: number[] }>)
    .map((m) => ({ level: m.level, xp: m.xp, gold: m.gold as [number, number] }))
    .sort((a, b) => a.level - b.level);

/** Find the monster closest to (but not above) the given character level. */
const findMonsterForLevel = (charLevel: number): IMonsterRewardSource => {
    let best = _monstersForPricing[0];
    for (const m of _monstersForPricing) {
        if (m.level <= charLevel) best = m;
        else break;
    }
    return best;
};

/** Get the actual price of an elixir, accounting for level-scaled items. */
export const getElixirPrice = (elixir: IElixir, characterLevel: number): number => {
    if (elixir.id === 'amulet_of_loss') {
        const monster = findMonsterForLevel(Math.max(1, characterLevel));
        const reward = computeTaskRewards(monster, 2500);
        return Math.max(1000, reward.rewardGold);
    }
    if (elixir.id === 'death_protection') {
        const monster = findMonsterForLevel(Math.max(1, characterLevel));
        const reward = computeTaskRewards(monster, 10000);
        return Math.max(5000, reward.rewardGold);
    }
    return elixir.price;
};

// ── Dynamic shop item interface ───────────────────────────────────────────────

export interface IShopItem {
  id: string;
  name_pl: string;
  name_en: string;
  icon: string;
  slot: string;
  type: string;
  rarity: Rarity;
  level: number;
  baseAtk: number;
  baseDef: number;
  price: number;
  templateType: 'weapon' | 'offhand' | 'armor' | 'accessory';
  armorPrefix?: string;
}

// ── Pricing formula ──────────────────────────────────────────────────────────

const CATEGORY_BASE_MULT: Record<string, number> = {
  weapon: 30,
  offhand: 25,
  armor: 20,
  accessory: 16,
};

const RARITY_PRICE_MULT: Record<string, number> = {
  common: 1,
  rare: 12,
};

const calculateShopPrice = (level: number, rarity: Rarity, category: string): number => {
  const base = (CATEGORY_BASE_MULT[category] ?? 10) * level + 20;
  return Math.floor(base * (RARITY_PRICE_MULT[rarity] ?? 1));
};

// ── Stat estimation (deterministic preview for the shop display) ─────────────

interface IScaling {
  baseMin: number;
  baseMax: number;
  perLevel: number;
}

interface IRarityMult {
  statMultiplier: number;
  priceMultiplier: number;
}

const estimateBaseStat = (scaling: IScaling, level: number, rarityMult: number): number => {
  const avgBase = Math.floor((scaling.baseMin + scaling.baseMax) / 2);
  const levelBonus = Math.floor(level * scaling.perLevel);
  return Math.max(1, Math.floor((avgBase + levelBonus) * rarityMult));
};

// ── Slot sort order ──────────────────────────────────────────────────────────

const SLOT_SORT_ORDER: Record<string, number> = {
  mainHand: 0,
  offHand: 1,
  helmet: 2,
  armor: 3,
  pants: 4,
  boots: 5,
  shoulders: 6,
  gloves: 7,
  ring1: 8,
  necklace: 9,
  earrings: 10,
};

// ── Generate dynamic shop items ──────────────────────────────────────────────

interface IWeaponTemplate {
  type: string;
  name_pl: string;
  name_en: string;
  slot: string;
  icon: string;
  allowedClasses: string[];
  baseStatType: string;
  scaling: IScaling;
}

interface IArmorPiece {
  slot: string;
  name_pl: string;
  name_en: string;
  icon: string;
  scaling: IScaling;
}

interface IArmorCategory {
  allowedClasses: string[];
  prefix_pl: string;
  prefix_en: string;
  pieces: IArmorPiece[];
}

/** Maximum item level the shop will ever generate, regardless of character level. */
export const SHOP_ITEM_LEVEL_CAP = 100;

export const generateShopItems = (characterClass: string, level: number): IShopItem[] => {
  // Cap shop equipment level — high-level players still see lvl-100 max gear.
  level = Math.min(level, SHOP_ITEM_LEVEL_CAP);
  const items: IShopItem[] = [];
  const rarities: Rarity[] = ['common', 'rare'];

  const weapons = itemTemplates.weapons as IWeaponTemplate[];
  const offhands = itemTemplates.offhands as IWeaponTemplate[];
  const armorMap = itemTemplates.armor as Record<string, IArmorCategory>;
  const accessories = itemTemplates.accessories as IWeaponTemplate[];
  const rarityMults = itemTemplates.rarityMultipliers as Record<string, IRarityMult>;

  // Find weapon for this class
  const allowedWeaponTypes = CLASS_WEAPON_TYPES[characterClass] ?? [];
  const weapon = weapons.find((w) => allowedWeaponTypes.includes(w.type));

  // Find offhand for this class
  const allowedOffhandTypes = CLASS_OFFHAND_TYPES[characterClass] ?? [];
  const offhand = offhands.find((o) => allowedOffhandTypes.includes(o.type));

  // Find armor prefix for this class
  const armorPrefix = CLASS_ARMOR_TYPES[characterClass];
  const armorCategory = armorPrefix ? armorMap[armorPrefix] : undefined;

  for (const rarity of rarities) {
    const mult = rarityMults[rarity]?.statMultiplier ?? 1.0;
    const rarityLabel = RARITY_LABELS[rarity] ?? rarity;

    // Weapon
    if (weapon) {
      const baseAtk = estimateBaseStat(weapon.scaling, level, mult);
      items.push({
        id: `shop_${weapon.type}_${level}_${rarity}`,
        name_pl: rarity === 'rare' ? `${rarityLabel} ${weapon.name_pl}` : weapon.name_pl,
        name_en: rarity === 'rare' ? `Rare ${weapon.name_en}` : weapon.name_en,
        icon: weapon.icon,
        slot: weapon.slot,
        type: weapon.type,
        rarity,
        level,
        baseAtk,
        baseDef: 0,
        price: calculateShopPrice(level, rarity, 'weapon'),
        templateType: 'weapon',
      });
    }

    // Offhand
    if (offhand && allowedOffhandTypes.length > 0) {
      const baseStat = estimateBaseStat(offhand.scaling, level, mult);
      const isDefense = offhand.baseStatType === 'defense';
      items.push({
        id: `shop_${offhand.type}_${level}_${rarity}`,
        name_pl: rarity === 'rare' ? `${rarityLabel} ${offhand.name_pl}` : offhand.name_pl,
        name_en: rarity === 'rare' ? `Rare ${offhand.name_en}` : offhand.name_en,
        icon: offhand.icon,
        slot: offhand.slot,
        type: offhand.type,
        rarity,
        level,
        baseAtk: isDefense ? 0 : baseStat,
        baseDef: isDefense ? baseStat : 0,
        price: calculateShopPrice(level, rarity, 'offhand'),
        templateType: 'offhand',
      });
    }

    // Armor pieces
    if (armorCategory && armorPrefix) {
      for (const piece of armorCategory.pieces) {
        const baseDef = estimateBaseStat(piece.scaling, level, mult);
        items.push({
          id: `shop_${armorPrefix}_${piece.slot}_${level}_${rarity}`,
          name_pl: rarity === 'rare'
            ? `${rarityLabel} ${armorCategory.prefix_pl} ${piece.name_pl}`
            : `${armorCategory.prefix_pl} ${piece.name_pl}`,
          name_en: rarity === 'rare'
            ? `Rare ${armorCategory.prefix_en} ${piece.name_en}`
            : `${armorCategory.prefix_en} ${piece.name_en}`,
          icon: piece.icon,
          slot: piece.slot,
          type: `${armorPrefix}_${piece.slot}`,
          rarity,
          level,
          baseAtk: 0,
          baseDef,
          price: calculateShopPrice(level, rarity, 'armor'),
          templateType: 'armor',
          armorPrefix,
        });
      }
    }

    // Accessories
    for (const acc of accessories) {
      void estimateBaseStat(acc.scaling, level, mult); // stat used in price calculation
      items.push({
        id: `shop_${acc.type}_${level}_${rarity}`,
        name_pl: rarity === 'rare' ? `${rarityLabel} ${acc.name_pl}` : acc.name_pl,
        name_en: rarity === 'rare' ? `Rare ${acc.name_en}` : acc.name_en,
        icon: acc.icon,
        slot: acc.slot,
        type: acc.type,
        rarity,
        level,
        baseAtk: 0,
        baseDef: 0,
        price: calculateShopPrice(level, rarity, 'accessory'),
        templateType: 'accessory',
      });
    }
  }

  // Sort: weapons first, then offhands, then armor by slot order, then accessories; common before rare within same slot
  items.sort((a, b) => {
    const slotA = SLOT_SORT_ORDER[a.slot] ?? 99;
    const slotB = SLOT_SORT_ORDER[b.slot] ?? 99;
    if (slotA !== slotB) return slotA - slotB;
    // Same slot: common before rare
    const rarityOrdA = a.rarity === 'common' ? 0 : 1;
    const rarityOrdB = b.rarity === 'common' ? 0 : 1;
    return rarityOrdA - rarityOrdB;
  });

  return items;
};

// ── Buy result ────────────────────────────────────────────────────────────────

export type BuyResult = 'ok' | 'no_gold' | 'bag_full' | 'level_too_low';

// ── Store ─────────────────────────────────────────────────────────────────────

interface IShopStore {
  lastNotification: string | null;
  clearNotification: () => void;

  buyShopItem: (shopItem: IShopItem, character: ICharacter) => BuyResult;
  buyElixir: (elixir: IElixir, character?: ICharacter) => BuyResult;
}

export const useShopStore = create<IShopStore>()((set) => ({
  lastNotification: null,

  clearNotification: () => set({ lastNotification: null }),

  buyShopItem: (shopItem, character) => {
    void character; // reserved for class/level checks
    const inv = useInventoryStore.getState();
    const spent = inv.spendGold(shopItem.price);
    if (!spent) return 'no_gold';

    let generated = null;

    switch (shopItem.templateType) {
      case 'weapon':
        generated = generateWeapon(shopItem.type, shopItem.level, shopItem.rarity);
        break;
      case 'offhand':
        generated = generateOffhand(shopItem.type, shopItem.level, shopItem.rarity);
        break;
      case 'armor':
        generated = generateArmor(
          shopItem.armorPrefix ?? '',
          shopItem.slot as EquipmentSlot,
          shopItem.level,
          shopItem.rarity,
        );
        break;
      case 'accessory':
        generated = generateAccessory(shopItem.type, shopItem.level, shopItem.rarity);
        break;
    }

    if (!generated) {
      inv.addGold(shopItem.price); // refund
      return 'bag_full';
    }

    const added = inv.addItem(generated);
    if (!added) {
      inv.addGold(shopItem.price); // refund
      return 'bag_full';
    }

    set({ lastNotification: `Kupiono: ${shopItem.name_pl}` });
    return 'ok';
  },

  buyElixir: (elixir, character) => {
    if (character && elixir.minLevel && character.level < elixir.minLevel) return 'level_too_low';
    const inv = useInventoryStore.getState();
    const spent = inv.spendGold(elixir.price);
    if (!spent) return 'no_gold';
    inv.addConsumable(elixir.id);
    set({ lastNotification: `Kupiono: ${elixir.name_pl}` });
    return 'ok';
  },
}));
