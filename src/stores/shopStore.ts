import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import itemTemplates from '../data/itemTemplates.json';
import { generateWeapon, generateOffhand, generateArmor, generateAccessory } from '../systems/itemGenerator';
import type { Rarity, EquipmentSlot } from '../systems/itemSystem';
import { CLASS_WEAPON_TYPES, CLASS_OFFHAND_TYPES, CLASS_ARMOR_TYPES, RARITY_LABELS } from '../systems/itemSystem';
import { getPotionImage, getElixirImage } from '../systems/spriteAssets';
import { getPotionMinLevel } from '../systems/potionGating';
import { getTodayKey } from '../systems/dailyQuestSystem';
import { useInventoryStore } from './inventoryStore';
import type { ICharacter } from './characterStore';

// -- Elixir definitions (always available in shop) -----------------------------

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

// 2026-05: HP/MP potion icons swapped from emoji (:red-heart:/:droplet:) to the player's
// PNG art (`/assets/images/potions/<id>.png`). Buff/utility elixirs that
// have no dedicated art keep their emoji glyph. The fallback inside
// `getPotionImage` returns the +50 HP art for any unknown ID, so even an
// elixir we forget to map renders something visible.
const POTION_ICON = (id: string, fallback: string): string =>
  getPotionImage(id) ?? fallback;

// 2026-05-08: same idea for buff/utility elixirs — return the
// `eliksirs/` PNG when available, fall back to the legacy emoji.
const ELIXIR_ICON = (id: string, fallback: string): string =>
  getElixirImage(id) ?? fallback;

export const ELIXIRS: IElixir[] = [
  // --- HP POTIONS — Shop "Potiony" tab ------------------------------
  // 2026-05-08 v2: flat-heal tiers (sm/md/lg/mega) restored alongside
  // the % tiers. The player asked "co się stało ze wszystkimi
  // potionami +400 HP" — the answer is the full ladder (50/150/400/
  // 1000 flat HP heals) was missing. Both flat and % are sold in the
  // same Potiony tab, ordered cheapest -> strongest.
  { id: 'hp_potion_sm',       name_pl: 'Mały Eliksir HP',         name_en: 'Small Health Potion',     description_pl: 'Przywraca 50 HP.',          price: 30,      effect: 'heal_hp_50',        icon: POTION_ICON('hp_potion_sm',       'red-heart'), minLevel: 1 },
  { id: 'hp_potion_md',       name_pl: 'Eliksir HP',              name_en: 'Health Potion',           description_pl: 'Przywraca 150 HP.',         price: 150,     effect: 'heal_hp_150',       icon: POTION_ICON('hp_potion_md',       'red-heart'), minLevel: 20 },
  { id: 'hp_potion_lg',       name_pl: 'Silny Eliksir HP',        name_en: 'Strong Health Potion',    description_pl: 'Przywraca 400 HP.',         price: 600,     effect: 'heal_hp_400',       icon: POTION_ICON('hp_potion_lg',       'red-heart'), minLevel: 50 },
  { id: 'hp_potion_mega',     name_pl: 'Mega Eliksir HP',         name_en: 'Mega Health Elixir',      description_pl: 'Przywraca 1000 HP.',        price: 15000,   effect: 'heal_hp_1000',      icon: POTION_ICON('hp_potion_mega',     'heart-on-fire'), minLevel: 100 },
  { id: 'hp_potion_great',    name_pl: 'Wielki Eliksir HP',       name_en: 'Great Health Potion',     description_pl: 'Przywraca 20% maks. HP.',   price: 200000,  effect: 'heal_hp_pct_20',    icon: POTION_ICON('hp_potion_great',    'red-heart'), minLevel: 200 },
  { id: 'hp_potion_super',    name_pl: 'Super Eliksir HP',        name_en: 'Super Health Potion',     description_pl: 'Przywraca 35% maks. HP.',   price: 350000,  effect: 'heal_hp_pct_35',    icon: POTION_ICON('hp_potion_super',    'red-heart'), minLevel: 350 },
  { id: 'hp_potion_ultimate', name_pl: 'Ultimatywny Eliksir HP',  name_en: 'Ultimate Health Potion',  description_pl: 'Przywraca 50% maks. HP.',   price: 500000,  effect: 'heal_hp_pct_50',    icon: POTION_ICON('hp_potion_ultimate', 'red-heart'), minLevel: 500 },
  { id: 'hp_potion_divine',   name_pl: 'Boski Eliksir HP',        name_en: 'Divine Health Potion',    description_pl: 'Przywraca 100% maks. HP.',  price: 1000000, effect: 'heal_hp_pct_100',   icon: POTION_ICON('hp_potion_divine',   'red-heart'), minLevel: 700 },
  // --- MP POTIONS ----------------------------------------------------
  { id: 'mp_potion_sm',       name_pl: 'Mały Eliksir MP',         name_en: 'Small Mana Potion',       description_pl: 'Przywraca 30 MP.',          price: 30,      effect: 'heal_mp_30',        icon: POTION_ICON('mp_potion_sm',       'droplet'), minLevel: 1 },
  { id: 'mp_potion_md',       name_pl: 'Eliksir MP',              name_en: 'Mana Potion',             description_pl: 'Przywraca 100 MP.',         price: 150,     effect: 'heal_mp_100',       icon: POTION_ICON('mp_potion_md',       'droplet'), minLevel: 20 },
  { id: 'mp_potion_lg',       name_pl: 'Silny Eliksir MP',        name_en: 'Strong Mana Potion',      description_pl: 'Przywraca 300 MP.',         price: 600,     effect: 'heal_mp_300',       icon: POTION_ICON('mp_potion_lg',       'droplet'), minLevel: 50 },
  { id: 'mp_potion_mega',     name_pl: 'Mega Eliksir MP',         name_en: 'Mega Mana Elixir',        description_pl: 'Przywraca 1000 MP.',        price: 15000,   effect: 'heal_mp_1000',      icon: POTION_ICON('mp_potion_mega',     'gem-stone'), minLevel: 100 },
  { id: 'mp_potion_great',    name_pl: 'Wielki Eliksir MP',       name_en: 'Great Mana Potion',       description_pl: 'Przywraca 20% maks. MP.',   price: 200000,  effect: 'heal_mp_pct_20',    icon: POTION_ICON('mp_potion_great',    'droplet'), minLevel: 200 },
  { id: 'mp_potion_super',    name_pl: 'Super Eliksir MP',        name_en: 'Super Mana Potion',       description_pl: 'Przywraca 35% maks. MP.',   price: 350000,  effect: 'heal_mp_pct_35',    icon: POTION_ICON('mp_potion_super',    'droplet'), minLevel: 350 },
  { id: 'mp_potion_ultimate', name_pl: 'Ultimatywny Eliksir MP',  name_en: 'Ultimate Mana Potion',    description_pl: 'Przywraca 50% maks. MP.',   price: 500000,  effect: 'heal_mp_pct_50',    icon: POTION_ICON('mp_potion_ultimate', 'droplet'), minLevel: 500 },
  { id: 'mp_potion_divine',   name_pl: 'Boski Eliksir MP',        name_en: 'Divine Mana Potion',      description_pl: 'Przywraca 100% maks. MP.',  price: 1000000, effect: 'heal_mp_pct_100',   icon: POTION_ICON('mp_potion_divine',   'droplet'), minLevel: 700 },

  // --- XP BOOSTS — Hunt-only -----------------------------------------
  // Per spec: only fire on monster-kill XP in hunt. Tasks/quests/dungeons/
  // bosses/training don't accept the boost. 50% and 100% don't stack —
  // when both active, 100% drains its remaining time first, then 50%
  // takes over (enforced in buffStore consume path).
  { id: 'xp_boost', name_pl: 'Dopalacz XP', name_en: 'XP Boost +50%', description_pl: '+50% XP z polowania na potwory przez 1h (TYLKO polowanie — nie taski/questy/dungeony/bossy/trening).', price: 100000, effect: 'xp_boost_1h', icon: ELIXIR_ICON('xp_boost', 'star'), minLevel: 1 },
  { id: 'xp_boost_100', name_pl: 'Wielki Dopalacz XP', name_en: 'XP Boost +100%', description_pl: '+100% XP z polowania na potwory przez 1h (TYLKO polowanie). Zużywa się PRZED zwykłym +50% gdy oba aktywne.', price: 200000, effect: 'xp_boost_100_1h', icon: ELIXIR_ICON('xp_boost_100', 'glowing-star'), minLevel: 1 },

  // --- SKILL XP BOOSTS ----------------------------------------------
  // Affects basic-attack weapon-XP gain in combat AND active training
  // XP/sec (training tab). When offline-training is also running, only
  // combat-side gain receives the multiplier.
  { id: 'skill_xp_boost', name_pl: 'Dopalacz Skilli', name_en: 'Skill XP Boost +50%', description_pl: '+50% XP skilli (walka + trening aktywny) przez 1h.', price: 20000, effect: 'skill_xp_boost_1h', icon: ELIXIR_ICON('skill_xp_boost', 'sparkles'), minLevel: 1 },
  { id: 'skill_xp_boost_100', name_pl: 'Wielki Dopalacz Skilli', name_en: 'Skill XP Boost +100%', description_pl: '+100% XP skilli (walka + trening aktywny) przez 1h. Zużywa się PRZED +50% gdy oba aktywne.', price: 50000, effect: 'skill_xp_boost_100_1h', icon: ELIXIR_ICON('skill_xp_boost_100', 'bright-button'), minLevel: 1 },

  // --- COMBAT BUFFS (pausable — tick only during combat) ------------
  { id: 'attack_speed_elixir', name_pl: 'Eliksir Szybkości', name_en: 'Attack Speed Elixir', description_pl: '+20% prędkości ataku przez 15 min (TYLKO w walce).', price: 120000, effect: 'attack_speed_0.20_15m_pausable', icon: ELIXIR_ICON('attack_speed_elixir', 'high-voltage'), minLevel: 1 },
  { id: 'cd_reduction_elixir', name_pl: 'Eliksir Skupienia', name_en: 'Focus Elixir', description_pl: '-20% cooldowny spelli przez 30 min (TYLKO w walce).', price: 150000, effect: 'cooldown_reduction_0.20_30m', icon: ELIXIR_ICON('cd_reduction_elixir', 'cyclone'), minLevel: 1 },

  // --- ATK / SPELL DAMAGE (15 min, pausable, no stacking — highest first) -
  { id: 'atk_dmg_elixir_25', name_pl: 'Eliksir Ataku I', name_en: 'Attack Damage Elixir I', description_pl: '+25% obrażeń z ataku przez 15 min (TYLKO w walce). Nie stackuje z II/III — wyższy poziom zużywa się pierwszy.', price: 50000, effect: 'atk_dmg_25_15m', icon: ELIXIR_ICON('atk_dmg_elixir_25', 'crossed-swords'), minLevel: 1 },
  { id: 'atk_dmg_elixir_50', name_pl: 'Eliksir Ataku II', name_en: 'Attack Damage Elixir II', description_pl: '+50% obrażeń z ataku przez 15 min (TYLKO w walce). Zużywa się PRZED I gdy oba aktywne.', price: 150000, effect: 'atk_dmg_50_15m', icon: ELIXIR_ICON('atk_dmg_elixir_50', 'crossed-swords'), minLevel: 30 },
  { id: 'atk_dmg_elixir_100', name_pl: 'Eliksir Ataku III', name_en: 'Attack Damage Elixir III', description_pl: '+100% obrażeń z ataku przez 15 min (TYLKO w walce). Zużywa się PRZED II i I.', price: 500000, effect: 'atk_dmg_100_15m', icon: ELIXIR_ICON('atk_dmg_elixir_100', 'crossed-swords'), minLevel: 80 },
  { id: 'spell_dmg_elixir_25', name_pl: 'Eliksir Magii I', name_en: 'Spell Damage Elixir I', description_pl: '+25% obrażeń ze spelli przez 15 min (TYLKO w walce). Nie stackuje z II/III.', price: 50000, effect: 'spell_dmg_25_15m', icon: ELIXIR_ICON('spell_dmg_elixir_25', 'crystal-ball'), minLevel: 1 },
  { id: 'spell_dmg_elixir_50', name_pl: 'Eliksir Magii II', name_en: 'Spell Damage Elixir II', description_pl: '+50% obrażeń ze spelli przez 15 min (TYLKO w walce). Zużywa się PRZED I.', price: 150000, effect: 'spell_dmg_50_15m', icon: ELIXIR_ICON('spell_dmg_elixir_50', 'crystal-ball'), minLevel: 30 },
  { id: 'spell_dmg_elixir_100', name_pl: 'Eliksir Magii III', name_en: 'Spell Damage Elixir III', description_pl: '+100% obrażeń ze spelli przez 15 min (TYLKO w walce). Zużywa się PRZED II i I.', price: 500000, effect: 'spell_dmg_100_15m', icon: ELIXIR_ICON('spell_dmg_elixir_100', 'crystal-ball'), minLevel: 200 },

  // --- STAT BUFFS (combat-only, 15 min) -----------------------------
  // Vitality / Mana — flat +500 to MAX pool. Designed to be additive in
  // every view: TopHeader bar shows the new max, autopotion threshold
  // includes it, current HP rises with the cap so the player IS healed
  // for 500 on cast (handled in BuffStore.applyBuffSideEffects).
  { id: 'hp_boost_elixir', name_pl: 'Eliksir Witalności', name_en: 'Vitality Elixir', description_pl: '+500 Max HP przez 15 min (TYLKO w walce). Aktualne HP rośnie razem z capem — uwzględniane w autopotionach i HUD.', price: 5000, effect: 'hp_boost_500_15m', icon: ELIXIR_ICON('hp_boost_elixir', 'drop-of-blood'), minLevel: 1 },
  { id: 'mp_boost_elixir', name_pl: 'Eliksir Many', name_en: 'Mana Elixir', description_pl: '+500 Max MP przez 15 min (TYLKO w walce). Aktualne MP rośnie razem z capem.', price: 5000, effect: 'mp_boost_500_15m', icon: ELIXIR_ICON('mp_boost_elixir', 'large-blue-diamond'), minLevel: 1 },
  // Power Elixir — single combined +50 ATK and +50 DEF buff (replaces
  // the old separate Sily/Zelaza pair to match user spec "+50 atk DEF").
  { id: 'atk_boost_elixir', name_pl: 'Eliksir Siły', name_en: 'Strength Elixir', description_pl: '+50 ATK i +50 DEF przez 15 min (TYLKO w walce).', price: 80000, effect: 'atk_def_boost_50_15m', icon: ELIXIR_ICON('atk_boost_elixir', 'flexed-biceps'), minLevel: 1 },

  // --- PREMIUM HP/MP % (15 min, gated 100+ per spec) ----------------
  { id: 'hp_pct_elixir_25', name_pl: 'Eliksir Kolosa', name_en: 'Colossus Elixir', description_pl: '+25% Max HP przez 15 min (TYLKO w walce). Stackuje się z Witalności +500.', price: 350000, effect: 'hp_pct_25_15m', icon: ELIXIR_ICON('hp_pct_elixir_25', 'heart-on-fire'), minLevel: 100 },
  { id: 'mp_pct_elixir_25', name_pl: 'Eliksir Arcymaga', name_en: 'Archmage Elixir', description_pl: '+25% Max MP przez 15 min (TYLKO w walce). Stackuje się z Many +500.', price: 350000, effect: 'mp_pct_25_15m', icon: ELIXIR_ICON('mp_pct_elixir_25', 'diamond-with-a-dot'), minLevel: 100 },

  // --- RESET ELIXIRS (max 5 purchases per day) ----------------------
  { id: 'dungeon_reset', name_pl: 'Reset Dungeonu', name_en: 'Dungeon Reset', description_pl: 'Resetuje próby wybranego dungeonu. Max 5 zakupów dziennie.', price: 50000, effect: 'dungeon_reset', icon: ELIXIR_ICON('dungeon_reset', 'castle'), minLevel: 1 },
  { id: 'boss_reset', name_pl: 'Reset Bossa', name_en: 'Boss Reset', description_pl: 'Resetuje próby wybranego bossa. Max 5 zakupów dziennie.', price: 80000, effect: 'boss_reset', icon: ELIXIR_ICON('boss_reset', 'ogre'), minLevel: 1 },

  // --- DEATH PROTECTION (flat prices per spec) ----------------------
  { id: 'death_protection', name_pl: 'Eliksir Ochrony przed Śmiercią', name_en: 'Death Protection', description_pl: 'Zapobiega utracie poziomu i statystyk przy śmierci (1 użycie).', price: 5000000, effect: 'death_protection', icon: ELIXIR_ICON('death_protection', 'shield'), minLevel: 1 },
  { id: 'amulet_of_loss', name_pl: 'Amulet of Loss', name_en: 'Amulet of Loss', description_pl: 'Chroni przedmioty (plecak + ekwipunek) przed utratą przy śmierci. Pęka po jednym użyciu.', price: 500000, effect: 'amulet_of_loss', icon: ELIXIR_ICON('amulet_of_loss', 'trident-emblem'), minLevel: 1 },

  // --- RARE PURCHASES ------------------------------------------------
  { id: 'stat_reset', name_pl: 'Eliksir Resetu Statystyk', name_en: 'Stat Reset Elixir', description_pl: 'Resetuje wszystkie rozdane punkty statystyk i pozwala je rozdać ponownie.', price: 10000000, effect: 'stat_reset', icon: ELIXIR_ICON('stat_reset', 'counterclockwise-arrows-button'), minLevel: 1 },

  // --- TRAINING / COMBAT UTILITIES ----------------------------------
  // Replaces "Eliksir Treningu x2" — multiplies offline-training reward
  // claims (2× XP + 2× wall-clock effective hours per consumed elixir).
  { id: 'offline_training_boost', name_pl: 'Eliksir Treningu Offline', name_en: 'Offline Training Elixir', description_pl: 'Zwiększa nagrody z odbierania treningu offline (mnożnik godzin tylko dla skilli, nie potworów).', price: 50000, effect: 'offline_training_boost', icon: ELIXIR_ICON('offline_training_boost', 'person-lifting-weights'), minLevel: 1 },
  // Utamo Vita — combat-only, 200k per spec.
  { id: 'utamo_vita', name_pl: 'Utamo Vita', name_en: 'Utamo Vita (Magic Shield)', description_pl: 'Tarcza magiczna — 50% otrzymywanego dmg idzie w MP zamiast HP. Pęka gdy MP=0. Czas biegnie TYLKO w walce.', price: 200000, effect: 'utamo_vita', icon: ELIXIR_ICON('utamo_vita', 'blue-circle'), minLevel: 1 },

  // --- PREMIUM XP — Hunt-only, stacks with regular boosts -----------
  { id: 'premium_xp_boost', name_pl: 'Premium Eliksir XP', name_en: 'Premium XP Elixir', description_pl: '×2 XP z polowania na potwory przez 12h (TYLKO polowanie). Stackuje się z Dopalaczem XP.', price: 10000000, effect: 'premium_xp_boost', icon: ELIXIR_ICON('premium_xp_boost', 'gem-stone'), minLevel: 1 },
];

// -- Dynamic pricing for death-protection items ------------------------------
// AOL cost    = gold from task of killing 2500 monsters at player's level
// Elixir cost = gold from task of killing 10000 monsters at player's level
//
// Uses the real task reward formula: maxGold * killCount * 3
// where maxGold comes from the closest monster to the player's level.

import monstersRaw from '../data/monsters.json';
import { type IMonsterRewardSource } from '../systems/taskRewards';

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

/** Get the actual price of an elixir, accounting for level-scaled items.
 *  2026-05-08: AOL and death-protection now use flat prices per spec
 *  (500k / 5M). Helper kept for forward compat in case future elixirs
 *  scale dynamically again. The dynamic-pricing import block below is
 *  retained because other code imports `findMonsterForLevel`. */
export const getElixirPrice = (elixir: IElixir, characterLevel: number): number => {
    void characterLevel;
    void findMonsterForLevel;
    return elixir.price;
};

// -- Dynamic shop item interface -----------------------------------------------

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
  /**
   * 2026-05-08: deterministic preview of every bonus the generated item
   * will roll. Used by the shop to render a full attribute list AND to
   * compare against the player's currently-equipped piece in the same
   * slot. Real generated items roll within a range; this preview shows
   * the midpoint so the displayed numbers are stable across renders
   * (avoids the "stats keep flickering" bug a random preview would hit).
   */
  previewBonuses: Record<string, number>;
}

// -- Pricing formula ----------------------------------------------------------

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

// -- Stat estimation (deterministic preview for the shop display) -------------

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

/**
 * 2026-05-08 v3 — per spec ("pokazuj tylko bazowe w sklepie") the
 * preview is now strictly the BASE stat for each item. No random
 * pool, no "Losowe (N/M)" section. The base stat depends on the
 * slot, mirroring itemGenerator's ARMOR_SLOT_BASE_STAT and
 * ACCESSORY_SLOT_BASE_STAT tables:
 *   - helmet/armor/pants/shoulders/boots -> +HP (raw × ARMOR_HP_MULTIPLIER=6)
 *   - gloves -> +ATK
 *   - ring1/ring2 -> +ATK
 *   - necklace/earrings -> +DEF
 *   - mainHand weapons -> DMG MIN / DMG MAX
 *   - offhands -> +ATK or +DEF depending on baseStatType
 */
const ARMOR_HP_MULTIPLIER = 6;
const ARMOR_HP_SLOTS = new Set(['helmet', 'armor', 'pants', 'shoulders', 'boots']);
const ARMOR_ATK_SLOTS = new Set(['gloves']);
const ACCESSORY_ATK_SLOTS = new Set(['ring1', 'ring2']);
const ACCESSORY_DEF_SLOTS = new Set(['necklace', 'earrings']);

interface IPreviewContext {
  rarity: Rarity;
  level: number;
  /** Raw scaled base stat — what `estimateBaseStat` returned. */
  baseStat: number;
  templateType: 'weapon' | 'offhand' | 'armor' | 'accessory';
  /** Equipment slot the item lands in. Drives armor/accessory base-stat picks. */
  slot?: string;
  /** `'defense'` or `'attack'` for offhands — comes from itemTemplates. */
  offhandStatType?: string;
}

const buildPreviewBonuses = (ctx: IPreviewContext): Record<string, number> => {
  const { templateType, baseStat, slot, offhandStatType } = ctx;
  const bonuses: Record<string, number> = {};

  if (templateType === 'weapon' && baseStat > 0) {
    bonuses['dmg_min'] = Math.max(1, Math.floor(baseStat * 0.8));
    bonuses['dmg_max'] = Math.max(1, Math.floor(baseStat * 1.2));
    return bonuses;
  }

  if (templateType === 'offhand' && baseStat > 0) {
    if (offhandStatType === 'defense') bonuses['defense'] = baseStat;
    else bonuses['attack'] = baseStat;
    return bonuses;
  }

  if (templateType === 'armor' && baseStat > 0 && slot) {
    if (ARMOR_HP_SLOTS.has(slot)) {
      bonuses['hp'] = Math.max(1, baseStat * ARMOR_HP_MULTIPLIER);
    } else if (ARMOR_ATK_SLOTS.has(slot)) {
      bonuses['attack'] = baseStat;
    }
    return bonuses;
  }

  if (templateType === 'accessory' && baseStat > 0 && slot) {
    if (ACCESSORY_ATK_SLOTS.has(slot)) {
      bonuses['attack'] = baseStat;
    } else if (ACCESSORY_DEF_SLOTS.has(slot)) {
      bonuses['defense'] = baseStat;
    }
    return bonuses;
  }

  return bonuses;
};

// -- Slot sort order ----------------------------------------------------------

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

// -- Generate dynamic shop items ----------------------------------------------

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
        previewBonuses: buildPreviewBonuses({
          rarity, level, baseStat: baseAtk, templateType: 'weapon', slot: weapon.slot,
        }),
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
        previewBonuses: buildPreviewBonuses({
          rarity,
          level,
          baseStat,
          templateType: 'offhand',
          slot: offhand.slot,
          offhandStatType: offhand.baseStatType,
        }),
      });
    }

    // Armor pieces — base stat per slot:
    // helmet/armor/pants/shoulders/boots -> +HP (raw × ARMOR_HP_MULTIPLIER)
    // gloves -> +ATK
    if (armorCategory && armorPrefix) {
      for (const piece of armorCategory.pieces) {
        const rawBase = estimateBaseStat(piece.scaling, level, mult);
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
          baseDef: rawBase,
          price: calculateShopPrice(level, rarity, 'armor'),
          templateType: 'armor',
          previewBonuses: buildPreviewBonuses({
            rarity, level, baseStat: rawBase, templateType: 'armor', slot: piece.slot,
          }),
          armorPrefix,
        });
      }
    }

    // Accessories — base stat per slot: ring -> +ATK, necklace/earrings -> +DEF
    for (const acc of accessories) {
      const baseStat = estimateBaseStat(acc.scaling, level, mult);
      // The `ring` template uses slot 'ring1' canonically; future ring2
      // entries would still hit the +ATK branch via ACCESSORY_ATK_SLOTS.
      const slotKey = acc.type === 'ring' ? 'ring1' : acc.slot;
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
        previewBonuses: buildPreviewBonuses({
          rarity, level, baseStat, templateType: 'accessory', slot: slotKey,
        }),
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

// --- Arena Shop catalogue ----------------------------------------------------
// 2026-05-08: Arena tab inventory. All items are bought with arena points
// (not gold). Three buckets:
//   - stones — common->heroic upgrade stones (high-tier are very expensive)
//   - potions — premium % HP/MP heals at flat AP cost
//   - elixirs — every standard elixir also available for AP, ~10× the
//     gold price as a baseline
//   - mythic weapons — main + off-hand at the player's current level (cap
//     1000) at level × 1000 AP per piece, dynamic.
// All items show in the Arena tab; the buyer just spends AP via
// inventoryStore.spendArenaPoints. Mythic generation uses the same item
// generator as drop loot, just locked to rarity='mythic'.

export interface IArenaShopItem {
  id: string;
  name_pl: string;
  description_pl: string;
  icon: string;
  apPrice: number;
  /** What kind of inventory item this maps to. */
  kind: 'stone' | 'potion' | 'elixir' | 'mythic_weapon' | 'mythic_offhand';
  /** Specific consumable / stone id when kind is stone/potion/elixir. */
  payloadId?: string;
  /** When kind is `mythic_*`: dynamic price multiplier (level × 1000). */
  perLevel?: boolean;
}

// Stones — uses inventoryStore.addStones(stoneId, amount).
const ARENA_STONES: IArenaShopItem[] = [
  { id: 'arena_stone_common',    name_pl: 'Kamień (Common)',    description_pl: 'Kamień ulepszenia common.',    icon: 'white-circle', apPrice: 50,    kind: 'stone', payloadId: 'common_stone' },
  { id: 'arena_stone_rare',      name_pl: 'Kamień (Rare)',      description_pl: 'Kamień ulepszenia rare.',      icon: 'blue-circle', apPrice: 200,   kind: 'stone', payloadId: 'rare_stone' },
  { id: 'arena_stone_epic',      name_pl: 'Kamień (Epic)',      description_pl: 'Kamień ulepszenia epic.',      icon: 'purple-circle', apPrice: 800,   kind: 'stone', payloadId: 'epic_stone' },
  { id: 'arena_stone_legendary', name_pl: 'Kamień (Legendary)', description_pl: 'Kamień ulepszenia legendary.', icon: 'yellow-circle', apPrice: 3000,  kind: 'stone', payloadId: 'legendary_stone' },
  { id: 'arena_stone_heroic',    name_pl: 'Kamień (Heroic)',    description_pl: 'Bardzo rzadki kamień heroic.', icon: 'red-circle', apPrice: 12000, kind: 'stone', payloadId: 'heroic_stone' },
];

// Potions — % HP/MP, flat-priced in AP.
const ARENA_POTIONS: IArenaShopItem[] = [
  { id: 'arena_hp_25',  name_pl: 'Potion HP 25%',  description_pl: 'Przywraca 25% maks. HP.',  icon: 'red-heart', apPrice: 300,  kind: 'potion', payloadId: 'hp_potion_great' },
  { id: 'arena_hp_50',  name_pl: 'Potion HP 50%',  description_pl: 'Przywraca 50% maks. HP.',  icon: 'red-heart', apPrice: 800,  kind: 'potion', payloadId: 'hp_potion_ultimate' },
  { id: 'arena_hp_100', name_pl: 'Potion HP 100%', description_pl: 'Przywraca 100% maks. HP.', icon: 'red-heart', apPrice: 2000, kind: 'potion', payloadId: 'hp_potion_divine' },
  { id: 'arena_mp_25',  name_pl: 'Potion MP 25%',  description_pl: 'Przywraca 25% maks. MP.',  icon: 'droplet', apPrice: 300,  kind: 'potion', payloadId: 'mp_potion_great' },
  { id: 'arena_mp_50',  name_pl: 'Potion MP 50%',  description_pl: 'Przywraca 50% maks. MP.',  icon: 'droplet', apPrice: 800,  kind: 'potion', payloadId: 'mp_potion_ultimate' },
  { id: 'arena_mp_100', name_pl: 'Potion MP 100%', description_pl: 'Przywraca 100% maks. MP.', icon: 'droplet', apPrice: 2000, kind: 'potion', payloadId: 'mp_potion_divine' },
];

// Mythic weapons — both hands. Price is dynamic (per character level).
// 2026-05-08: descriptions reference "AP" (not "PA") to match the new
// arena UI banner. The actual weapon TYPE is chosen at buy time from
// CLASS_WEAPON_TYPES / CLASS_OFFHAND_TYPES so each class gets the
// right mythic (sword for Knight, bow for Archer, staff for Mage, …).
const ARENA_MYTHIC: IArenaShopItem[] = [
  { id: 'arena_mythic_main',    name_pl: 'Mityczna Broń (Główna)',  description_pl: 'Bron mityczna na Twoim poziomie. Cena = poziom × 1000 AP.', icon: 'crossed-swords', apPrice: 1000, kind: 'mythic_weapon',  perLevel: true },
  { id: 'arena_mythic_offhand', name_pl: 'Mityczna Broń (Offhand)', description_pl: 'Bron mityczna offhand na Twoim poziomie. Cena = poziom × 1000 AP.', icon: 'dagger', apPrice: 1000, kind: 'mythic_offhand', perLevel: true },
];

/** Returns full Arena shop catalogue plus dynamic AP-priced elixirs.
 *  Elixir AP price = gold × 10 ÷ 100 = gold ÷ 10 (so a 100k elixir costs
 *  10k AP — in the same "very expensive" range as the stones). */
export const getArenaShopCatalog = (): IArenaShopItem[] => {
  const elixirItems: IArenaShopItem[] = ELIXIRS
    .filter((e) => !(e.id.startsWith('hp_potion_') || e.id.startsWith('mp_potion_')))
    .map((e) => ({
      id: `arena_elixir_${e.id}`,
      name_pl: e.name_pl,
      description_pl: e.description_pl,
      icon: typeof e.icon === 'string' ? e.icon : 'test-tube',
      apPrice: Math.max(50, Math.floor(e.price / 10)),
      kind: 'elixir',
      payloadId: e.id,
    }));
  return [
    ...ARENA_MYTHIC,
    ...ARENA_STONES,
    ...ARENA_POTIONS,
    ...elixirItems,
  ];
};

/** Buy an arena-shop item using arena points. Returns the same BuyResult
 *  union as buyElixir; `no_gold` is repurposed to mean "not enough AP".
 *
 *  2026-05-08: when buying a mythic weapon/offhand we now look up the
 *  player's CLASS-CORRECT weapon type from CLASS_WEAPON_TYPES /
 *  CLASS_OFFHAND_TYPES — a Knight gets a sword + shield, a Mage gets
 *  a staff + spellbook, an Archer gets a bow + quiver, etc. Falling
 *  back to template[0] would always hand out a sword, which is wrong
 *  for every non-Knight class. */
export const buyArenaItem = (
  item: IArenaShopItem,
  characterLevel: number,
  characterClass?: string,
): BuyResult => {
  const inv = useInventoryStore.getState();
  // Mythic weapons price scales with level — cap at 1000 per spec.
  const lvl = Math.min(1000, Math.max(1, characterLevel));
  const price = item.perLevel ? item.apPrice * lvl : item.apPrice;
  // 2026-06-21: arena HP/MP potions are level-gated by the REAL potion they
  // pay out (payloadId). e.g. arena_hp_25 → hp_potion_great (unlock lvl 200),
  // arena_hp_50 → hp_potion_ultimate (500), arena_hp_100 → hp_potion_divine
  // (700). Block the purchase below that level BEFORE spending AP. (Drinking is
  // already gated in inventoryStore.useConsumable via the payload id.)
  if (item.kind === 'potion' && item.payloadId && characterLevel < getPotionMinLevel(item.payloadId)) {
    return 'level_too_low';
  }
  if (!inv.spendArenaPoints(price)) return 'no_gold';

  if (item.kind === 'stone') {
    inv.addStones(item.payloadId!, 1);
    return 'ok';
  }
  if (item.kind === 'potion' || item.kind === 'elixir') {
    inv.addConsumable(item.payloadId!, 1);
    return 'ok';
  }
  if (item.kind === 'mythic_weapon' || item.kind === 'mythic_offhand') {
    // Use the same item generator as drop loot, locked to mythic rarity
    // and the player's current level. Resolve the WEAPON TYPE from the
    // player's class so each class lands its proper mythic.
    const fallbackMain = (itemTemplates.weapons as Array<{ type: string }>)[0]?.type ?? 'sword';
    const fallbackOff = (itemTemplates.offhands as Array<{ type: string }>)[0]?.type ?? 'shield';
    const mainType = characterClass
      ? (CLASS_WEAPON_TYPES[characterClass]?.[0] ?? fallbackMain)
      : fallbackMain;
    const offType = characterClass
      ? (CLASS_OFFHAND_TYPES[characterClass]?.[0] ?? fallbackOff)
      : fallbackOff;
    const generated = item.kind === 'mythic_weapon'
      ? generateWeapon(mainType, lvl, 'mythic' as Rarity)
      : generateOffhand(offType, lvl, 'mythic' as Rarity);
    if (!generated) {
      inv.addArenaPoints(price); // refund
      return 'bag_full';
    }
    if (!inv.addItem(generated)) {
      inv.addArenaPoints(price); // refund
      return 'bag_full';
    }
    return 'ok';
  }
  return 'no_gold';
};

// -- Buy result ----------------------------------------------------------------

export type BuyResult = 'ok' | 'no_gold' | 'bag_full' | 'level_too_low' | 'daily_limit';

// -- Daily-purchase caps ------------------------------------------------------
// 2026-05-08: per spec, dungeon-reset and boss-reset elixirs are capped
// at 5 purchases per real day. The counter resets at midnight local
// time using the same `getTodayKey()` helper the daily-quest store uses.
export const DAILY_PURCHASE_CAPS: Record<string, number> = {
  dungeon_reset: 5,
  boss_reset: 5,
};

/** Returns true if `id` has a daily purchase cap (i.e. should be checked). */
export const hasDailyCap = (id: string): boolean => id in DAILY_PURCHASE_CAPS;

// -- Store ---------------------------------------------------------------------

interface IShopStore {
  lastNotification: string | null;
  clearNotification: () => void;

  /** Per-day count of purchases of capped-id elixirs (dungeon_reset, boss_reset).
   *  Auto-resets when `dayKey` flips at local midnight. */
  dayKey: string;
  dailyPurchases: Record<string, number>;
  /** How many of the capped elixir `id` were already purchased today. */
  getDailyPurchased: (id: string) => number;
  /** How many slots remain for `id` today (Infinity for non-capped). */
  getDailyRemaining: (id: string) => number;

  buyShopItem: (shopItem: IShopItem, character: ICharacter) => BuyResult;
  buyElixir: (elixir: IElixir, character?: ICharacter, qty?: number) => BuyResult;
}

export const useShopStore = create<IShopStore>()(persist((set, get) => ({
  lastNotification: null,

  // Daily-purchase counter — initialised to today's key on store creation.
  // Every read goes through `getDailyPurchased` which rolls the counter
  // when the day flips so we never accidentally count yesterday's buys.
  dayKey: getTodayKey(),
  dailyPurchases: {},

  getDailyPurchased: (id) => {
    const today = getTodayKey();
    const s = get();
    if (s.dayKey !== today) {
      // Roll the counter — fresh day, zero everything.
      set({ dayKey: today, dailyPurchases: {} });
      return 0;
    }
    return s.dailyPurchases[id] ?? 0;
  },

  getDailyRemaining: (id) => {
    const cap = DAILY_PURCHASE_CAPS[id];
    if (cap === undefined) return Number.POSITIVE_INFINITY;
    const used = get().getDailyPurchased(id);
    return Math.max(0, cap - used);
  },

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

    // 2026-05-19 v13 spec ("Kupilem w sklepie luk zwykly i nie dodalo
    // mi go do plecaka"): `inv.addItem` runs the auto-sell hook,
    // which silently auto-sells every incoming common item when the
    // player has "Autosprzedaj zwykłe" toggled on. That's correct
    // for drops, but a SHOP PURCHASE was just paid for — the player
    // wants the item, not a refund-minus-margin. Use `restoreItem`
    // which adds straight to the bag and skips the auto-sell guard.
    const added = inv.restoreItem(generated);
    if (!added) {
      inv.addGold(shopItem.price); // refund
      return 'bag_full';
    }

    set({ lastNotification: `Kupiono: ${shopItem.name_pl}` });
    return 'ok';
  },

  buyElixir: (elixir, character, qty = 1) => {
    if (character && elixir.minLevel && character.level < elixir.minLevel) return 'level_too_low';
    // 2026-05-08: daily-purchase cap (e.g. dungeon_reset, boss_reset
    // capped at 5/day). Honour the cap whether the buy is single-shot
    // or bulk; reject the WHOLE batch if it would push past today's
    // remaining slots so the player gets clean feedback.
    if (hasDailyCap(elixir.id)) {
      const remaining = get().getDailyRemaining(elixir.id);
      if (qty > remaining) return 'daily_limit';
    }
    const inv = useInventoryStore.getState();
    const totalPrice = elixir.price * qty;
    const spent = inv.spendGold(totalPrice);
    if (!spent) return 'no_gold';
    inv.addConsumable(elixir.id, qty);
    if (hasDailyCap(elixir.id)) {
      const today = getTodayKey();
      set((s) => ({
        dayKey: today,
        dailyPurchases: {
          ...(s.dayKey === today ? s.dailyPurchases : {}),
          [elixir.id]: (s.dayKey === today ? s.dailyPurchases[elixir.id] ?? 0 : 0) + qty,
        },
      }));
    }
    set({ lastNotification: `Kupiono: ${elixir.name_pl}` });
    return 'ok';
  },
}), {
  // Persist only the daily-purchase counter — notifications + day key
  // for cross-session continuity. localStorage rehydrate.
  name: 'grimshade.shop',
  partialize: (s) => ({ dayKey: s.dayKey, dailyPurchases: s.dailyPurchases }),
}));
