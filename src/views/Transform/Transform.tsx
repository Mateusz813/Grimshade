import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { getPotionImage, getSummonImage } from '../../systems/spriteAssets';
import { useSkillStore } from '../../stores/skillStore';
import { useTransformStore } from '../../stores/transformStore';
import { useNecroSummonStore } from '../../stores/necroSummonStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useBuffStore } from '../../stores/buffStore';
import { saveCurrentCharacterStores } from '../../stores/characterScope';
import { applyDeathPenalty, applyFleePenalty } from '../../systems/levelSystem';
import { consumeDeathProtection } from '../../systems/deathProtection';
import { applyCombatLeaveDeath } from '../../systems/combatLeavePenalty';
import { useCombatStore } from '../../stores/combatStore';
import { useDeathStore } from '../../stores/deathStore';
// Task / quest / mastery hooks — Transform kills now feed the same
// progression streams as hunting / dungeon / raid / boss kills so the
// player can grind out tasks while pushing transformation tiers.
import { useTaskStore } from '../../stores/taskStore';
import { useQuestStore } from '../../stores/questStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { useMasteryStore } from '../../stores/masteryStore';
import {
  CombatHudHost,
  CombatPotionDock,
  CombatArena,
  CombatTopControls,
  CombatSubControls,
  CombatActionBar,
  type ICombatEnemy,
  type ICombatAlly,
  type ICombatSkillSlot,
  type ICombatPotionSlot,
} from '../../components/organisms/CombatUI';
import '../../components/organisms/CombatUI/CombatUI.scss';
import { applySkillBuff, getSkillDef } from '../../systems/skillBuffs';
import {
  newCombatEffectsSession,
  ensureStatus,
  isCombatantStunned,
  castSkill as effectsCastSkill,
  tickAll as effectsTickAll,
  routeDamage as effectsRouteDamage,
  type ICombatEffectsSession,
} from '../../systems/combatEffectsHelpers';
import { consumeCasterBasicHitMods, consumeTargetMarkAmp } from '../../systems/skillEffectsV2';
import { syncCasterChargeConsume } from '../../systems/combatEngine';
import { useSkillAnim } from '../../hooks/useSkillAnim';
import { useCombatFx } from '../../hooks/useCombatFx';
import { useLevelUpRefill } from '../../hooks/useLevelUpRefill';
import { resolveAutoPotionElixir } from '../../systems/potionSystem';
import { canUsePotionAtLevel } from '../../systems/potionGating';
import { CLASS_COLORS } from '../../systems/itemSystem';
import { deathsApi } from '../../api/v1/deathsApi';
import {
  calculateDamage,
  calculateDualWieldDamage,
  calculateBlockChance,
  calculateDodgeChance,
  rollMonsterDamage,
  getSpeedScaledCooldownMs,
} from '../../systems/combat';
import {
  getClassSkillBonus,
  getTotalEquipmentStats,
  getEquippedGearLevel,
  getGearGapMultiplier,
  flattenItemsData,
} from '../../systems/itemSystem';
import { getItemDisplayInfo } from '../../systems/itemGenerator';
import { getTrainingBonuses, getCombatSkillUpgradeMultiplier } from '../../systems/skillSystem';
import {
  getAtkDamageMultiplier,
  getSpellDamageMultiplier,
  getElixirHpBonus,
  getElixirMpBonus,
  getElixirHpPctMultiplier,
  getElixirMpPctMultiplier,
  getElixirAtkBonus,
  getElixirDefBonus,
  getElixirAttackSpeedMultiplier,
  tickCombatElixirs,
} from '../../systems/combatElixirs';
import {
  getTransformDmgMultiplier,
  getTransformFlatHp,
  getTransformFlatMp,
  getTransformFlatAttack,
  getTransformFlatDefense,
  getTransformHpRegenFlat,
  getTransformMpRegenFlat,
  getTransformHpPctMultiplier,
  getTransformMpPctMultiplier,
  getTransformDefPctMultiplier,
  getTransformAtkPctMultiplier,
} from '../../systems/transformBonuses';
import {
  getAllTransforms,
  getTransformById,
  getTransformMonsters,
  getTransformColor,
  applyTransformBossStats,
  calculateTransformRewards,
  getTransformWaveLineup,
  resolveActiveOpponentSlot,
  type ITransformData,
  type ITransformRewards,
} from '../../systems/transformSystem';
import { getCharacterAvatar } from '../../data/classAvatars';
// MonsterSprite removed — the unified EnemyCard renders sprites internally.
import type { IMonster } from '../../types/monster';
import type { TMonsterRarity } from '../../systems/lootSystem';
import type { TCharacterClass } from '../../api/v1/characterApi';
import itemsData from '../../data/items.json';
import classesRaw from '../../data/classes.json';
import mageImg from '../../assets/images/classes/mage.png';
import knightImg from '../../assets/images/classes/knight.png';
import archerImg from '../../assets/images/classes/archer.png';
import clericImg from '../../assets/images/classes/cleric.png';
import bardImg from '../../assets/images/classes/bard.png';
import rogueImg from '../../assets/images/classes/rogue.png';
import necromancerImg from '../../assets/images/classes/necromancer.png';
// Transform avatar imports (1-11 per class)
import mage1 from '../../assets/images/classes/mage-1.png';
import mage2 from '../../assets/images/classes/mage-2.png';
import mage3 from '../../assets/images/classes/mage-3.png';
import mage4 from '../../assets/images/classes/mage-4.png';
import mage5 from '../../assets/images/classes/mage-5.png';
import mage6 from '../../assets/images/classes/mage-6.png';
import mage7 from '../../assets/images/classes/mage-7.png';
import mage8 from '../../assets/images/classes/mage-8.png';
import mage9 from '../../assets/images/classes/mage-9.png';
import mage10 from '../../assets/images/classes/mage-10.png';
import mage11 from '../../assets/images/classes/mage-11.png';
import knight1 from '../../assets/images/classes/knight-1.png';
import knight2 from '../../assets/images/classes/knight-2.png';
import knight3 from '../../assets/images/classes/knight-3.png';
import knight4 from '../../assets/images/classes/knight-4.png';
import knight5 from '../../assets/images/classes/knight-5.png';
import knight6 from '../../assets/images/classes/knight-6.png';
import knight7 from '../../assets/images/classes/knight-7.png';
import knight8 from '../../assets/images/classes/knight-8.png';
import knight9 from '../../assets/images/classes/knight-9.png';
import knight10 from '../../assets/images/classes/knight-10.png';
import knight11 from '../../assets/images/classes/knight-11.png';
import archer1 from '../../assets/images/classes/archer-1.png';
import archer2 from '../../assets/images/classes/archer-2.png';
import archer3 from '../../assets/images/classes/archer-3.png';
import archer4 from '../../assets/images/classes/archer-4.png';
import archer5 from '../../assets/images/classes/archer-5.png';
import archer6 from '../../assets/images/classes/archer-6.png';
import archer7 from '../../assets/images/classes/archer-7.png';
import archer8 from '../../assets/images/classes/archer-8.png';
import archer9 from '../../assets/images/classes/archer-9.png';
import archer10 from '../../assets/images/classes/archer-10.png';
import archer11 from '../../assets/images/classes/archer-11.png';
import cleric1 from '../../assets/images/classes/cleric-1.png';
import cleric2 from '../../assets/images/classes/cleric-2.png';
import cleric3 from '../../assets/images/classes/cleric-3.png';
import cleric4 from '../../assets/images/classes/cleric-4.png';
import cleric5 from '../../assets/images/classes/cleric-5.png';
import cleric6 from '../../assets/images/classes/cleric-6.png';
import cleric7 from '../../assets/images/classes/cleric-7.png';
import cleric8 from '../../assets/images/classes/cleric-8.png';
import cleric9 from '../../assets/images/classes/cleric-9.png';
import cleric10 from '../../assets/images/classes/cleric-10.png';
import cleric11 from '../../assets/images/classes/cleric-11.png';
import rogue1 from '../../assets/images/classes/rogue-1.png';
import rogue2 from '../../assets/images/classes/rogue-2.png';
import rogue3 from '../../assets/images/classes/rogue-3.png';
import rogue4 from '../../assets/images/classes/rogue-4.png';
import rogue5 from '../../assets/images/classes/rogue-5.png';
import rogue6 from '../../assets/images/classes/rogue-6.png';
import rogue7 from '../../assets/images/classes/rogue-7.png';
import rogue8 from '../../assets/images/classes/rogue-8.png';
import rogue9 from '../../assets/images/classes/rogue-9.png';
import rogue10 from '../../assets/images/classes/rogue-10.png';
import rogue11 from '../../assets/images/classes/rogue-11.png';
import necromancer1 from '../../assets/images/classes/necromancer-1.png';
import necromancer2 from '../../assets/images/classes/necromancer-2.png';
import necromancer3 from '../../assets/images/classes/necromancer-3.png';
import necromancer4 from '../../assets/images/classes/necromancer-4.png';
import necromancer5 from '../../assets/images/classes/necromancer-5.png';
import necromancer6 from '../../assets/images/classes/necromancer-6.png';
import necromancer7 from '../../assets/images/classes/necromancer-7.png';
import necromancer8 from '../../assets/images/classes/necromancer-8.png';
import necromancer9 from '../../assets/images/classes/necromancer-9.png';
import necromancer10 from '../../assets/images/classes/necromancer-10.png';
import necromancer11 from '../../assets/images/classes/necromancer-11.png';
import bard1 from '../../assets/images/classes/bard-1.png';
import bard2 from '../../assets/images/classes/bard-2.png';
import bard3 from '../../assets/images/classes/bard-3.png';
import bard4 from '../../assets/images/classes/bard-4.png';
import bard5 from '../../assets/images/classes/bard-5.png';
import bard6 from '../../assets/images/classes/bard-6.png';
import bard7 from '../../assets/images/classes/bard-7.png';
import bard8 from '../../assets/images/classes/bard-8.png';
import bard9 from '../../assets/images/classes/bard-9.png';
import bard10 from '../../assets/images/classes/bard-10.png';
import bard11 from '../../assets/images/classes/bard-11.png';
import { ELIXIRS } from '../../stores/shopStore';
import { getSkillIcon } from '../../data/skillIcons';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import TinyIcon from '../../components/ui/TinyIcon/TinyIcon';
import './Transform.scss';

// -- Constants ------------------------------------------------------------------

// CLASS_ICONS removed — the unified AllyCard handles class iconography.

const CLASS_MODIFIER: Record<string, number> = {
  Knight: 1.0, Mage: 1.3, Cleric: 1.0,
  Archer: 1.2, Rogue: 1.0, Necromancer: 1.2, Bard: 1.0,
};

interface IClassData {
  dualWield?: boolean;
  dualWieldDmgPercent?: number;
  canBlock?: boolean;
  canDodge?: boolean;
  maxCritChance?: number;
  mlvlFromAttacks?: boolean;
}

const classesData = classesRaw as unknown as Record<string, IClassData>;

const ALL_ITEMS = flattenItemsData(itemsData as Parameters<typeof flattenItemsData>[0]);

// Transform avatar lookup table
const TRANSFORM_AVATARS: Record<string, Record<number, string>> = {
  Knight: { 1: knight1, 2: knight2, 3: knight3, 4: knight4, 5: knight5, 6: knight6, 7: knight7, 8: knight8, 9: knight9, 10: knight10, 11: knight11 },
  Mage: { 1: mage1, 2: mage2, 3: mage3, 4: mage4, 5: mage5, 6: mage6, 7: mage7, 8: mage8, 9: mage9, 10: mage10, 11: mage11 },
  Cleric: { 1: cleric1, 2: cleric2, 3: cleric3, 4: cleric4, 5: cleric5, 6: cleric6, 7: cleric7, 8: cleric8, 9: cleric9, 10: cleric10, 11: cleric11 },
  Archer: { 1: archer1, 2: archer2, 3: archer3, 4: archer4, 5: archer5, 6: archer6, 7: archer7, 8: archer8, 9: archer9, 10: archer10, 11: archer11 },
  Rogue: { 1: rogue1, 2: rogue2, 3: rogue3, 4: rogue4, 5: rogue5, 6: rogue6, 7: rogue7, 8: rogue8, 9: rogue9, 10: rogue10, 11: rogue11 },
  Necromancer: { 1: necromancer1, 2: necromancer2, 3: necromancer3, 4: necromancer4, 5: necromancer5, 6: necromancer6, 7: necromancer7, 8: necromancer8, 9: necromancer9, 10: necromancer10, 11: necromancer11 },
  Bard: { 1: bard1, 2: bard2, 3: bard3, 4: bard4, 5: bard5, 6: bard6, 7: bard7, 8: bard8, 9: bard9, 10: bard10, 11: bard11 },
};

const BASE_AVATAR_IMAGES: Record<string, string> = {
  Knight: knightImg, Mage: mageImg, Cleric: clericImg, Archer: archerImg,
  Rogue: rogueImg, Necromancer: necromancerImg, Bard: bardImg,
};

const ATTACK_ANIM_DURATION: Record<string, number> = {
  Knight: 350, Mage: 400, Cleric: 400, Archer: 300, Rogue: 250, Necromancer: 450, Bard: 400,
};

const SKILL_COOLDOWN_MS = 5000;
const SKILL_MP_COST = 15;
const POTION_COOLDOWN_MS = 1000;
const PCT_POTION_CD_MS = 500;

// Pause between a transform monster dying and the next one being
// summoned. Drives the slim "next monster in…" bar pinned under the
// TopHeader so the player has a visible cue during the lull.
const MONSTER_SPAWN_DELAY_MS = 1000;

const hpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_hp') && !e.effect.includes('pct'));
const mpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_mp') && !e.effect.includes('pct'));
const pctHpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_hp_pct'));
const pctMpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_mp_pct'));

const formatSkillName = (id: string | null): string => {
  if (!id) return '—';
  const name = id.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return `${getSkillIcon(id)} ${name}`;
};

const getBestPotion = (
  potions: typeof ELIXIRS,
  consumables: Record<string, number>,
  characterLevel: number = Number.POSITIVE_INFINITY,
) => {
  const reversed = [...potions].reverse();
  // 2026-06-21: only pick a potion the character is high enough level to drink.
  return (
    reversed.find((e) => (consumables[e.id] ?? 0) > 0 && canUsePotionAtLevel(e.id, characterLevel))
    ?? reversed.find((e) => canUsePotionAtLevel(e.id, characterLevel))
    ?? null
  );
};

// getPotionLabel removed — the unified CombatActionBar / CombatSubControls
// render potion icons + counts internally.

/** Get the avatar image for a class + transform number. */
const getTransformAvatarImage = (cls: string, transformNumber: number): string => {
  return TRANSFORM_AVATARS[cls]?.[transformNumber] ?? BASE_AVATAR_IMAGES[cls] ?? mageImg;
};

// -- Transform card background images --------------------------------------
// Mirrors the boss-card-background pattern: the user drops PNGs named
// `transform-1.png`, `transform-2.png`, … into `src/assets/images/transforms/`
// and they map 1:1 to the transform tier id. Missing files leave that card
// with its existing chrome — the gradient border + shimmer still render
// on top of the empty slot, so this is strictly additive.
type TransformGlobModule = { default: string } | string;
const TRANSFORM_CARD_FILES = import.meta.glob(
  '../../assets/images/transforms/transform-*.png',
  { eager: true },
) as Record<string, TransformGlobModule>;

const TRANSFORM_CARD_IMG_BY_INDEX: Map<number, string> = (() => {
  const out = new Map<number, string>();
  for (const [path, mod] of Object.entries(TRANSFORM_CARD_FILES)) {
    const match = path.match(/\/transform-(\d+)\.png$/);
    if (!match) continue;
    const idx = Number(match[1]);
    if (!Number.isFinite(idx) || idx <= 0) continue;
    const url = typeof mod === 'string' ? mod : (mod as { default: string }).default;
    if (url) out.set(idx, url);
  }
  return out;
})();

const getTransformCardImage = (transformId: number): string | null =>
  TRANSFORM_CARD_IMG_BY_INDEX.get(transformId) ?? null;

/**
 * Convert a `#rrggbb` (or `#rgb`) hex string to its HSL hue (0–360).
 * Used to turn each tier's `getTransformColor()` solid hex into a value we
 * can hand to the combat arena's `--transform-hue` CSS variable so the
 * darkening overlay tints in the same family as the card border / pill.
 */
const hexToHue = (hex: string): number => {
  const stripped = hex.trim().replace(/^#/, '');
  const full = stripped.length === 3
    ? stripped.split('').map((c) => c + c).join('')
    : stripped;
  if (full.length !== 6) return 30;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 30;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return Math.round(h);
};

// -- Combat log entry ---------------------------------------------------------

interface ICombatLogEntry {
  id: number;
  text: string;
  type: 'player' | 'monster' | 'crit' | 'system' | 'block' | 'dodge' | 'dualwield';
}

let _logId = 0;

// -- Phases ------------------------------------------------------------------

type ScreenPhase = 'list' | 'entering' | 'fighting' | 'allDefeated' | 'transforming' | 'complete';

// Total length of the cinematic entry — mirrors the Dungeon entry overlay.
// Capped at 2s so veteran grinders aren't held hostage between transforms.
const ENTRY_ANIM_TOTAL_MS = 2000;
// Inside the entry animation, mount the combat panel + start the first
// boss fight at this offset so the AnimatePresence fade-in lines up with
// the "reveal" portion of the overlay (the last ~33%) rather than snapping
// in at the very end.
const ENTRY_ANIM_COMBAT_START_AT_MS = 1340;

// -- Helpers ------------------------------------------------------------------

const rollWeaponDamage = (): number => {
  const { equipment } = useInventoryStore.getState();
  const weapon = equipment.mainHand;
  if (!weapon) return 0;
  const dmgMin = weapon.bonuses.dmg_min ?? weapon.bonuses.attack ?? 0;
  const dmgMax = weapon.bonuses.dmg_max ?? dmgMin;
  if (dmgMax <= 0) return 0;
  return dmgMin + Math.floor(Math.random() * (dmgMax - dmgMin + 1));
};

const rollOffHandDamage = (): number => {
  const { equipment } = useInventoryStore.getState();
  const weapon = equipment.offHand ?? equipment.mainHand;
  if (!weapon) return 0;
  const dmgMin = weapon.bonuses.dmg_min ?? weapon.bonuses.attack ?? 0;
  const dmgMax = weapon.bonuses.dmg_max ?? dmgMin;
  if (dmgMax <= 0) return 0;
  return dmgMin + Math.floor(Math.random() * (dmgMax - dmgMin + 1));
};

/**
 * @param contentLevel  Level of the content being fought (the monster's level).
 *   When > 0 and the player is under-geared for it, a gear-gap penalty scales
 *   down the effective attack (dmg × (gearLvl/contentLvl)², floor 0.05) so
 *   low-level gear can't practically clear far-higher-level transforms. 0 (the
 *   default) = no penalty, used by max-HP/MP-only callers.
 */
const getEffectiveChar = (
  char: ReturnType<typeof useCharacterStore.getState>['character'],
  contentLevel = 0,
) => {
  if (!char) return null;
  const { equipment } = useInventoryStore.getState();
  const eq = getTotalEquipmentStats(equipment, ALL_ITEMS);
  const { skillLevels } = useSkillStore.getState();
  const tb = getTrainingBonuses(skillLevels, char.class);
  const baseAttackSpeed = char.attack_speed + eq.speed * 0.01 + tb.attack_speed;
  // Point 7: transform bonuses apply LIVE — flat added to raw pool, percent
  // multipliers stacked on top of (base + equip + training + elixir).
  const rawMaxHp = char.max_hp + eq.hp + tb.max_hp + getElixirHpBonus() + getTransformFlatHp();
  const rawMaxMp = char.max_mp + eq.mp + tb.max_mp + getElixirMpBonus() + getTransformFlatMp();
  const rawDefense = char.defense + eq.defense + tb.defense + getElixirDefBonus() + getTransformFlatDefense();
  const gearGapMult = getGearGapMultiplier(getEquippedGearLevel(equipment), contentLevel);
  const rawAttack = (char.attack + eq.attack + getElixirAtkBonus() + getTransformFlatAttack()) * gearGapMult;
  return {
    ...char,
    attack: Math.floor(rawAttack * getTransformAtkPctMultiplier()),
    defense: Math.floor(rawDefense * getTransformDefPctMultiplier()),
    max_hp: Math.floor(rawMaxHp * getElixirHpPctMultiplier() * getTransformHpPctMultiplier()),
    max_mp: Math.floor(rawMaxMp * getElixirMpPctMultiplier() * getTransformMpPctMultiplier()),
    attack_speed: baseAttackSpeed * getElixirAttackSpeedMultiplier(),
    crit_chance: Math.min(0.5, char.crit_chance + eq.critChance * 0.01 + tb.crit_chance),
    crit_damage: (char.crit_damage ?? 2.0) + eq.critDmg * 0.01 + tb.crit_dmg,
    hp_regen: (char.hp_regen ?? 0) + tb.hp_regen + getTransformHpRegenFlat(),
    mp_regen: (char.mp_regen ?? 0) + getTransformMpRegenFlat(),
  };
};

const getAttackMs = (speed: number): number =>
  Math.max(500, Math.floor(3000 / Math.max(1, speed || 1)));

// -- Component ----------------------------------------------------------------

const Transform = () => {
  const navigate = useNavigate();
  const character = useCharacterStore((s) => s.character);
  const { language } = useSettingsStore();
  const completedTransforms = useTransformStore((s) => s.completedTransforms);
  const currentQuest = useTransformStore((s) => s.currentTransformQuest);
  const pendingClaimTransformId = useTransformStore((s) => s.pendingClaimTransformId);
  // Necromancer summon stack — when the local player is a necro, this is
  // the live ordered list spawned by `useNecroSummonStore` and consumed
  // by AllyCard for the count badge + tooltip breakdown.
  const necroSummons = useNecroSummonStore((s) => s.summons);
  const consumables = useInventoryStore((s) => s.consumables);
  const { activeSkillSlots } = useSkillStore();
  const {
    skillMode,
    setSkillMode,
    autoPotionHpEnabled,
    autoPotionMpEnabled,
    autoPotionHpId,
    autoPotionMpId,
    autoPotionPctHpId,
    autoPotionPctMpId,
  } = useSettingsStore();
  // Bug 2: subscribe to buff changes so render-time effective stats (max HP/MP) refresh when elixirs apply/expire
  const _activeBuffs = useBuffStore((s) => s.allBuffs);
  void _activeBuffs;

  // Screen phase
  const [phase, setPhase] = useState<ScreenPhase>('list');

  // Combat state
  // `currentMonster` + `monsterHp` track the BOSS slot (slot 3, bottom-right).
  // The 3 escort slots (Normal / Strong / Epic — top-left / top-right /
  // bottom-left) live in `escortSlots` so each tile carries its own HP, sprite
  // and tier label. Player auto-attacks chain through the escorts in order
  // (slot 0 -> 1 -> 2) before reaching the boss; the wave clears only when all
  // four are dead. See `getTransformWaveLineup` for the per-tier scaling.
  const [currentMonster, setCurrentMonster] = useState<IMonster | null>(null);
  const [monsterHp, setMonsterHp] = useState(0);
  const [monsterMaxHp, setMonsterMaxHp] = useState(0);
  interface IEscortSlot {
    slot: 0 | 1 | 2;
    tier: 'Normal' | 'Strong' | 'Epic';
    monster: IMonster;
    currentHp: number;
    maxHp: number;
    /** Sprite URL captured from the ORIGINAL bestiary template's level —
     *  `getTransformWaveLineup` does this lookup before `stamp` rewrites the
     *  monster's level to `bossLevel`. We need it here because the sprite
     *  registry only ships art for levels 1-60, so a T2/T3 boss (level 60+)
     *  would miss every lookup if we relied on the post-stamp level inside
     *  `MonsterSprite`. Falls back to null when no PNG exists for the
     *  template's level — the card then drops to the emoji glyph as usual. */
    imageUrl: string | null;
  }
  const [escortSlots, setEscortSlots] = useState<Array<IEscortSlot | null>>([null, null, null]);
  // Mirror for setState-free reads inside attack handlers (same reasoning as
  // `playerHpRef` / `monsterHpRef` — React 19 strict mode runs setState
  // updaters twice, so side-effecting damage logic must use a ref pattern).
  const escortSlotsRef = useRef<Array<IEscortSlot | null>>([null, null, null]);
  // Track which escort slots have already been counted in the death effect so
  // the session-kill tally doesn't double-fire on re-renders. Cleared on
  // every fresh `startMonsterFight` invocation. Keyed by `${bossId}__slot${i}`
  // so leftover entries from one wave can't bleed into the next.
  const escortKillsCountedRef = useRef<Set<string>>(new Set());
  const [playerHp, setPlayerHp] = useState(0);
  const [playerMp, setPlayerMp] = useState(0);
  const [combatLog, setCombatLog] = useState<ICombatLogEntry[]>([]);
  // Pulse counters (not booleans) so the keyed flash overlays in EnemyCard /
  // AllyCard re-mount on EVERY hit. Critical for transform combat where the
  // player can hit twice in the same window (auto + skill cast) and the boss
  // can spam attacks faster than the 300ms flash duration.
  // Per-slot hit pulse — each slot keeps its own monotonic counter so a hit
  // on slot 0 doesn't flash slots 1/2/3 too. Mirrors the Dungeon view's
  // `monsterHitPulses` shape so the EnemyCard flash overlay re-mounts only on
  // the actually-hit tile.
  const [monsterHitPulses, setMonsterHitPulses] = useState<Record<number, number>>({});
  const [playerHitPulse, setPlayerHitPulse] = useState(0);
  const [playerAttacking, setPlayerAttacking] = useState(false);
  // monsterAttacking removed: AllyCard's `hitPulse` (driven by playerHitPulse)
  // now covers the "monster just hit you" flash via the unified CombatUI.

  // Skill & potion state
  const [skillCooldowns, setSkillCooldowns] = useState<Record<string, number>>({});
  const [hpPotionCooldown, setHpPotionCooldown] = useState(0);
  const [mpPotionCooldown, setMpPotionCooldown] = useState(0);
  const [pctHpCooldown, setPctHpCooldown] = useState(0);
  const [pctMpCooldown, setPctMpCooldown] = useState(0);

  // Skill animation overlay
  const { trigger: triggerSkillAnim } = useSkillAnim();

  // Per-slot floating numbers / per-slot themed skill animations.
  // The hook returns a NEW object every render (object literal), so depending
  // directly on `fx` inside any `useCallback` makes that callback recreate
  // every render. That cascades into the death-effect deps array below
  // (`startMonsterFight` is in those deps) and re-fires `addLog -> setCombatLog`
  // every render once `monsterHp <= 0`, exploding into "Maximum update depth
  // exceeded". Solution: keep `fx` itself for reactive JSX reads, but use
  // `fxRef.current.method(...)` inside callbacks so we depend on a stable ref
  // instead of the unstable wrapper object. The methods on `fx` are themselves
  // `useCallback`'d with `[]` so they're already stable references — we just
  // need to dodge the wrapper-object identity churn.
  const fx = useCombatFx();
  const fxRef = useRef(fx);
  useEffect(() => { fxRef.current = fx; });

  // Speed mode (x1 / x2 / x4, no SKIP)
  const [speedMode, setSpeedMode] = useState<'x1' | 'x2' | 'x4'>('x1');
  const speedMult = speedMode === 'x4' ? 4 : speedMode === 'x2' ? 2 : 1;
  const speedMultRef = useRef(1);
  useEffect(() => { speedMultRef.current = speedMult; }, [speedMult]);
  // 2026-05 v6: keep global BuffStore speed in sync.
  useEffect(() => {
    useBuffStore.getState().setCombatSpeedMult(speedMult);
    return () => useBuffStore.getState().setCombatSpeedMult(1);
  }, [speedMult]);

  const cycleSpeed = useCallback(() => {
    // Pure state transition. BuffStore.combatSpeedMult sync is handled
    // by the useEffect([speedMult]) above to avoid Zustand setState
    // firing inside React's reducer phase (which caused TopHeader to
    // try re-rendering mid-Transform-render).
    setSpeedMode((s) => (s === 'x1' ? 'x2' : s === 'x2' ? 'x4' : 'x1'));
  }, []);

  // Rewards / animation state
  const [rewards, setRewards] = useState<ITransformRewards | null>(null);
  const [showTransformAnimation, setShowTransformAnimation] = useState(false);
  const [showFullscreenAvatar, setShowFullscreenAvatar] = useState(false);
  const [activeTransformId, setActiveTransformId] = useState<number>(0);
  // Point N6: explicit "all monsters defeated" flag. Previously the view auto-
  // transitioned to phase='allDefeated' 1s after the last kill, which caused
  // the reward popup to briefly flash when the player clicked Uciekaj in that
  // window. Now the user must explicitly click "Zgarnij nagrody" to see the
  // reward popup — Uciekaj always returns to town without flashing.
  const [victoryReady, setVictoryReady] = useState(false);

  // Spawn-bar progress — flips ON the moment a monster dies and OFF when
  // the next monster spawns. While ON, an rAF loop fills `spawnProgress`
  // 0->1 over the speed-scaled `MONSTER_SPAWN_DELAY_MS`. The bar shares
  // the under-header pinned visual with hunting auto-fight + dungeon /
  // raid spawn timers so the player learns one cue across the app.
  const [waitingForSpawn, setWaitingForSpawn] = useState(false);
  const [spawnProgress, setSpawnProgress] = useState(0);
  const spawnStartRef = useRef<number>(0);
  const spawnDurationRef = useRef<number>(MONSTER_SPAWN_DELAY_MS);

  // -- Tile-zoom entry animation ---------------------------------------------
  // Mirrors Dungeon.tsx: when the player clicks Walcz on a transform card,
  // we capture the source card's bounding box + visual identity (hue + per-
  // tier phoenix image), animate a fixed overlay growing from that rect to
  // fullscreen, then flip phase to 'fighting'. The overlay holds at fullscreen
  // through the AnimatePresence cross-fade so the player never sees a blank
  // flash between the list and the combat panel. Click anywhere on the
  // overlay during the cinematic to skip — the combat starts immediately.
  const [enterAnim, setEnterAnim] = useState<
    | { x: number; y: number; w: number; h: number; hue: number; image: string; transformId: number }
    | null
  >(null);
  const enterAnimTimeoutsRef = useRef<number[]>([]);
  // The transform the cinematic is leading INTO — read by `skipEntryAnimation`
  // so a click during the intro can hand the right id to `handleStartQuest`
  // without waiting for the queued timeout. Reset to null on overlay teardown.
  const pendingTransformIdRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      enterAnimTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      enterAnimTimeoutsRef.current = [];
    };
  }, []);

  // Refs
  const combatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const monsterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Point 11: track the post-kill "spawn next / finalize quest" setTimeout and
  // the death-transition setTimeout so that Abandon/Uciekaj can cancel them.
  // Without this, clicking Abandon in the 1 s window after a monster dies
  // still lets the timer fire, which read an empty remaining-monster list and
  // triggered a bogus "allDefeated" reward popup for rewards the player never
  // actually earned.
  const postKillTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deathTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const playerHpRef = useRef(0);
  const playerMpRef = useRef(0);
  // Mirror of `monsterHp` so the attack handlers can read the previous HP
  // without using `setMonsterHp((prev) => …)` — putting side effects inside
  // a state-updater is illegal in React 19's strict mode (the updater runs
  // twice, firing every store-mutation / setState side-effect twice and
  // crashing with "Maximum update depth exceeded").
  const monsterHpRef = useRef(0);

  // Level-up HP/MP refill — characterStore.addXp refills hp/mp to max on
  // every level-up, but Transform keeps a LOCAL playerHp/playerMp useState
  // that doesn't see the store-side refill. Without this, leveling up
  // mid-boss-fight would leave the player's bars stuck at the pre-level-up
  // value until the next damage tick. We sync the local mirrors here.
  useLevelUpRefill(phase === 'fighting', useCallback((maxHp, maxMp) => {
    playerHpRef.current = maxHp;
    playerMpRef.current = maxMp;
    setPlayerHp(maxHp);
    setPlayerMp(maxMp);
  }, []));

  const skillCooldownRef = useRef<Map<string, number>>(new Map());
  const hpPotionCooldownRef = useRef(0);
  const mpPotionCooldownRef = useRef(0);
  const pctHpCooldownRef = useRef(0);
  const pctMpCooldownRef = useRef(0);
  const tryAutoPotionRef = useRef<() => void>(() => {});

  // Skill-effect session — shared status state across player + opponent for
  // DOTs, stuns, marks, immortality, dodges. Reset on every fresh boss in
  // the transform quest (see `startMonsterFight`). Transform aggregates the
  // entire enemy column into one combined opponent for stun/DOT purposes —
  // matches the existing "single opposed swing per tick" model.
  const effectsRef = useRef<ICombatEffectsSession>(newCombatEffectsSession());
  const PLAYER_FX_ID = 'player';
  const OPPONENT_FX_ID = 'opponent';

  const allTransforms = useMemo(() => getAllTransforms(), []);

  // -- Cleanup timers ----------------------------------------------------------
  const clearTimers = useCallback(() => {
    if (combatTimerRef.current) { clearInterval(combatTimerRef.current); combatTimerRef.current = null; }
    if (monsterTimerRef.current) { clearInterval(monsterTimerRef.current); monsterTimerRef.current = null; }
    // Point 11: also cancel pending post-kill / death transitions so Abandon
    // never resolves into a false "allDefeated" reward popup.
    if (postKillTimeoutRef.current) { clearTimeout(postKillTimeoutRef.current); postKillTimeoutRef.current = null; }
    if (deathTimeoutRef.current) { clearTimeout(deathTimeoutRef.current); deathTimeoutRef.current = null; }
  }, []);

  // Track phase in ref so cleanup can read current value
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // On unmount: clear timers + abandon quest if still fighting (prevents resume)
  useEffect(() => () => {
    clearTimers();
    if (phaseRef.current === 'fighting') {
      useTransformStore.getState().abandonTransformQuest();
    }
  }, [clearTimers]);

  // -- URL-leave / tab-close = death (anti-cheat) ---------------------------
  // Same anti-cheat guard as Dungeon/Boss/Raid. Transform fights have a
  // weird wrinkle: the monster CHANGES during a quest, so we need refs that
  // track BOTH the active transform meta AND the current monster so the
  // death log can name a real opponent (the one in front of the player when
  // they bailed).
  const leavePenaltyAppliedRef = useRef(false);
  const activeTransformIdRef = useRef(0);
  useEffect(() => { activeTransformIdRef.current = activeTransformId; }, [activeTransformId]);
  const currentMonsterRef = useRef<typeof currentMonster>(null);
  useEffect(() => { currentMonsterRef.current = currentMonster; }, [currentMonster]);
  useEffect(() => {
    const fire = () => {
      if (leavePenaltyAppliedRef.current) return;
      if (phaseRef.current !== 'fighting') return;
      const tfId = activeTransformIdRef.current;
      if (!tfId) return;
      const meta = getTransformById(tfId);
      const mon = currentMonsterRef.current;
      const monsterName = mon?.name_pl ?? mon?.name_en ?? 'Nieznany potwór';
      const transformName = meta?.name_pl ?? `Transform ${tfId}`;
      const transformLvl = meta?.level ?? 1;
      leavePenaltyAppliedRef.current = true;
      applyCombatLeaveDeath({
        source: 'transform',
        sourceName: `${transformName} – ${monsterName}`,
        sourceLevel: transformLvl,
      });
    };
    window.addEventListener('beforeunload', fire);
    return () => {
      window.removeEventListener('beforeunload', fire);
      fire();
    };
  }, []);

  // Bug 1 (2026-04): pending-reward recovery. If the user previously locked
  // in a victory but missclicked / refreshed before claiming consumables,
  // jump straight to the rewards screen on next entry. We only fire this
  // when the view is on the list (so it doesn't override an active quest)
  // and there's no quest currently in progress.
  useEffect(() => {
    if (!character) return;
    if (pendingClaimTransformId == null) return;
    if (currentQuest?.inProgress) return;
    if (phase !== 'list') return;

    const transformRewards = calculateTransformRewards(
      pendingClaimTransformId,
      character.class as TCharacterClass,
    );
    setActiveTransformId(pendingClaimTransformId);
    setRewards(transformRewards);
    setVictoryReady(false);
    // Clean win — disable the leave guard so claiming the rewards (or just
    // navigating away from the post-fight reward screen) doesn't punish a
    // player who actually beat all the monsters.
    leavePenaltyAppliedRef.current = true;
    setPhase('allDefeated');
  }, [character, currentQuest, pendingClaimTransformId, phase]);

  // Auto-scroll combat log
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [combatLog]);

  // Keep HP/MP refs in sync with state
  useEffect(() => { playerHpRef.current = playerHp; }, [playerHp]);
  useEffect(() => { playerMpRef.current = playerMp; }, [playerMp]);
  useEffect(() => { monsterHpRef.current = monsterHp; }, [monsterHp]);
  useEffect(() => { escortSlotsRef.current = escortSlots; }, [escortSlots]);

  // -- Live HP/MP mirror -> characterStore -----------------------------------
  // Same pattern as Dungeon/Boss — mirror local fight HP/MP into characterStore
  // every change so the global TopHeader bars stay live. Gated by 'fighting'
  // phase so the 0 initial state we hold before `startMonsterFight` runs
  // never overwrites the real character HP.
  //
  // Clamp uses EFFECTIVE max (base + equipment + training + active elixirs
  // + transform) so a potion that brings HP above the BASE max isn't
  // truncated when persisted to the store. Transform itself adds to max
  // HP, so this matters even more here than in the other views.
  useEffect(() => {
    if (phase !== 'fighting') return;
    const liveChar = useCharacterStore.getState().character;
    if (!liveChar) return;
    const eff = getEffectiveChar(liveChar);
    const effMaxHp = eff?.max_hp ?? liveChar.max_hp;
    const effMaxMp = eff?.max_mp ?? liveChar.max_mp;
    const safeHp = Math.max(0, Math.min(effMaxHp, playerHp));
    const safeMp = Math.max(0, Math.min(effMaxMp, playerMp));
    if (liveChar.hp === safeHp && liveChar.mp === safeMp) return;
    useCharacterStore.getState().updateCharacter({ hp: safeHp, mp: safeMp });
  }, [playerHp, playerMp, phase]);

  // -- Spawn-bar progress driver (rAF) ------------------------------------
  // While `waitingForSpawn` is true, fill `spawnProgress` 0->1 over the
  // duration captured when the post-kill timeout was armed. Cancelled on
  // unmount or when the flag flips off.
  useEffect(() => {
    if (!waitingForSpawn) return;
    let raf = 0;
    const tick = () => {
      const elapsed = Date.now() - spawnStartRef.current;
      const ratio = Math.min(1, elapsed / Math.max(1, spawnDurationRef.current));
      setSpawnProgress(ratio);
      if (ratio < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [waitingForSpawn]);

  // Reset the spawn-bar whenever the player leaves the fighting phase
  // (Uciekaj, death, claim). The setTimeout is best-effort and might
  // still resolve in the background — this guarantees the bar
  // disappears the moment the phase flips so it doesn't linger over
  // the result / list views.
  useEffect(() => {
    if (phase !== 'fighting') {
      setWaitingForSpawn(false);
      setSpawnProgress(0);
    }
  }, [phase]);

  // -- Cooldown tick (100ms, scaled by speedMult) ---------------------------
  useEffect(() => {
    if (phase !== 'fighting') return;
    const TICK_MS = 100;
    const DEC = TICK_MS * speedMult;
    const id = setInterval(() => {
      setSkillCooldowns((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const key of Object.keys(next)) {
          if (next[key] > 0) { next[key] = Math.max(0, next[key] - DEC); changed = true; }
        }
        return changed ? next : prev;
      });
      setHpPotionCooldown((v) => { const nv = Math.max(0, v - DEC); hpPotionCooldownRef.current = nv; return nv; });
      setMpPotionCooldown((v) => { const nv = Math.max(0, v - DEC); mpPotionCooldownRef.current = nv; return nv; });
      setPctHpCooldown((v) => { const nv = Math.max(0, v - DEC); pctHpCooldownRef.current = nv; return nv; });
      setPctMpCooldown((v) => { const nv = Math.max(0, v - DEC); pctMpCooldownRef.current = nv; return nv; });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [phase, speedMult]);

  // -- Add log helper ----------------------------------------------------------
  // Mirrors every entry to the shared combatStore session log so the unified
  // CombatLogsModal (popup persists across waves) sees the same feed every
  // other view sees. Local type is a strict subset of the store union — no
  // remapping needed.
  const addLog = useCallback((text: string, type: ICombatLogEntry['type']) => {
    setCombatLog((prev) => [...prev.slice(-49), { id: _logId++, text, type }]);
    useCombatStore.getState().addSessionLog(text, type);
  }, []);

  // -- Heal / cooldown helpers ---------------------------------------------
  const healPlayerHp = useCallback((amount: number, max: number) => {
    const newHp = Math.min(max, playerHpRef.current + amount);
    playerHpRef.current = newHp;
    setPlayerHp(newHp);
  }, []);

  const healPlayerMp = useCallback((amount: number, max: number) => {
    const newMp = Math.min(max, playerMpRef.current + amount);
    playerMpRef.current = newMp;
    setPlayerMp(newMp);
  }, []);

  const startHpCooldown = useCallback(() => {
    setHpPotionCooldown(POTION_COOLDOWN_MS);
    hpPotionCooldownRef.current = POTION_COOLDOWN_MS;
  }, []);

  const startMpCooldown = useCallback(() => {
    setMpPotionCooldown(POTION_COOLDOWN_MS);
    mpPotionCooldownRef.current = POTION_COOLDOWN_MS;
  }, []);

  // -- Auto-potion helper --------------------------------------------------
  const tryAutoPotion = useCallback(() => {
    const char = useCharacterStore.getState().character;
    if (!char) return;
    const eff = getEffectiveChar(char);
    if (!eff) return;
    const charMaxHp = eff.max_hp;
    const charMaxMp = eff.max_mp;
    const settings = useSettingsStore.getState();
    const inv = useInventoryStore.getState();
    const hp = playerHpRef.current;
    const mp = playerMpRef.current;

    const hpMissing = Math.max(0, charMaxHp - hp);
    const mpMissing = Math.max(0, charMaxMp - mp);
    const hpPct = charMaxHp > 0 ? (hp / charMaxHp) * 100 : 100;
    const mpPct = charMaxMp > 0 ? (mp / charMaxMp) * 100 : 100;

    // Hard safety: never fire a potion when HP/MP are already at (or above) max —
    // regardless of threshold. Guards against stale refs, transform-cap drift,
    // and floating-point rounding when the user sees "100%" in the UI.
    const hpAtFull = charMaxHp > 0 && hp >= charMaxHp;
    const mpAtFull = charMaxMp > 0 && mp >= charMaxMp;

    const resolveAmount = (
      elixirIdOrNull: string | null,
      kind: 'flat' | 'pct',
      hm: 'hp' | 'mp',
      maxVal: number,
    ) => {
      const elixir = resolveAutoPotionElixir(elixirIdOrNull ?? undefined, hm, kind, inv.consumables, character?.level ?? 1);
      if (!elixir) return null;
      const flatRe = hm === 'hp' ? /^heal_hp_(\d+)$/ : /^heal_mp_(\d+)$/;
      const pctRe = hm === 'hp' ? /^heal_hp_pct_(\d+)$/ : /^heal_mp_pct_(\d+)$/;
      const flat = elixir.effect.match(flatRe);
      const pct = elixir.effect.match(pctRe);
      if (flat) return { id: elixir.id, name: elixir.name_pl, amount: parseInt(flat[1], 10), pct: null as number | null };
      if (pct) { const p = parseInt(pct[1], 10); return { id: elixir.id, name: elixir.name_pl, amount: Math.floor(maxVal * p / 100), pct: p }; }
      return null;
    };

    // Flat HP
    if (!hpAtFull && settings.autoPotionHpEnabled && settings.autoPotionHpThreshold > 0 && hpPct <= settings.autoPotionHpThreshold && hpPotionCooldownRef.current <= 0) {
      const pot = resolveAmount(settings.autoPotionHpId, 'flat', 'hp', charMaxHp);
      if (pot && pot.amount > 0 && hpMissing >= pot.amount) {
        inv.useConsumable(pot.id);
        startHpCooldown();
        healPlayerHp(pot.amount, charMaxHp);
        addLog(`[Auto] ${pot.name} +${pot.amount} HP`, 'system');
      }
    }

    // Flat MP
    if (!mpAtFull && settings.autoPotionMpEnabled && settings.autoPotionMpThreshold > 0 && mpPct <= settings.autoPotionMpThreshold && mpPotionCooldownRef.current <= 0) {
      const pot = resolveAmount(settings.autoPotionMpId, 'flat', 'mp', charMaxMp);
      if (pot && pot.amount > 0 && mpMissing >= pot.amount) {
        inv.useConsumable(pot.id);
        startMpCooldown();
        healPlayerMp(pot.amount, charMaxMp);
        addLog(`[Auto] ${pot.name} +${pot.amount} MP`, 'system');
      }
    }

    // Pct HP
    if (!hpAtFull && settings.autoPotionPctHpEnabled && settings.autoPotionPctHpThreshold > 0 && hpPct <= settings.autoPotionPctHpThreshold && pctHpCooldownRef.current <= 0) {
      const pot = resolveAmount(settings.autoPotionPctHpId, 'pct', 'hp', charMaxHp);
      if (pot && pot.amount > 0 && hpMissing >= pot.amount) {
        inv.useConsumable(pot.id);
        setPctHpCooldown(PCT_POTION_CD_MS); pctHpCooldownRef.current = PCT_POTION_CD_MS;
        healPlayerHp(pot.amount, charMaxHp);
        const tag = pot.pct != null ? ` (${pot.pct}%)` : '';
        addLog(`[Auto%] ${pot.name} +${pot.amount} HP${tag}`, 'system');
      }
    }

    // Pct MP
    if (!mpAtFull && settings.autoPotionPctMpEnabled && settings.autoPotionPctMpThreshold > 0 && mpPct <= settings.autoPotionPctMpThreshold && pctMpCooldownRef.current <= 0) {
      const pot = resolveAmount(settings.autoPotionPctMpId, 'pct', 'mp', charMaxMp);
      if (pot && pot.amount > 0 && mpMissing >= pot.amount) {
        inv.useConsumable(pot.id);
        setPctMpCooldown(PCT_POTION_CD_MS); pctMpCooldownRef.current = PCT_POTION_CD_MS;
        healPlayerMp(pot.amount, charMaxMp);
        const tag = pot.pct != null ? ` (${pot.pct}%)` : '';
        addLog(`[Auto%] ${pot.name} +${pot.amount} MP${tag}`, 'system');
      }
    }
  }, [addLog, healPlayerHp, healPlayerMp, startHpCooldown, startMpCooldown]);

  useEffect(() => { tryAutoPotionRef.current = tryAutoPotion; }, [tryAutoPotion]);

  // Status / DOT tick — drains stun timers + applies DOT damage on a
  // separate cadence (every 250 ms scaled by speed) so paralysed combatants
  // recover in real-time and DOTs deal their per-second slice consistently.
  // Transform aggregates the enemy column into one OPPONENT_FX_ID; DOT on
  // that id routes to the boss slot's HP (which is the slot players
  // ultimately have to break through to clear the wave).
  useEffect(() => {
    if (phase !== 'fighting') return;
    const TICK_MS = 250;
    const id = setInterval(() => {
      const charLatest = useCharacterStore.getState().character;
      const effChar = charLatest ? getEffectiveChar(charLatest) : null;
      const charMaxHp = effChar?.max_hp ?? 1;
      // 2026-06-23 BUGFIX: the aggregated OPPONENT_FX_ID DOT must hit the
      // CURRENT active enemy (first alive escort, else boss), NOT always the
      // boss. The old code drained `monsterHpRef` every tick, so a DOT applied
      // while the player was clearing escorts made the boss "leak HP by itself"
      // — its bar emptied without the player ever attacking it.
      const oppSlot = resolveActiveOpponentSlot(escortSlotsRef.current);
      const readOppHp = (): number =>
        oppSlot === 3 ? monsterHpRef.current : (escortSlotsRef.current[oppSlot]?.currentHp ?? 0);
      const writeOppHp = (next: number): void => {
        if (oppSlot === 3) {
          monsterHpRef.current = next;
          setMonsterHp(next);
          return;
        }
        const cur = escortSlotsRef.current.slice();
        const e = cur[oppSlot];
        if (!e) return;
        cur[oppSlot] = { ...e, currentHp: next };
        escortSlotsRef.current = cur;
        setEscortSlots(cur);
      };
      const oppMaxHp = oppSlot === 3
        ? (monsterMaxHp || 1)
        : (escortSlotsRef.current[oppSlot]?.maxHp ?? 1);

      const dotResults = effectsTickAll(
        effectsRef.current,
        [
          { id: PLAYER_FX_ID, maxHp: charMaxHp },
          { id: OPPONENT_FX_ID, maxHp: oppMaxHp },
        ],
        TICK_MS * speedMultRef.current,
      );
      for (const r of dotResults) {
        if (r.id === PLAYER_FX_ID && r.dotDamage > 0) {
          const apply = effectsRouteDamage(effectsRef.current, PLAYER_FX_ID, playerHpRef.current, r.dotDamage);
          playerHpRef.current = Math.max(0, playerHpRef.current - apply.appliedDmg);
          setPlayerHp(playerHpRef.current);
        }
        if (r.id === OPPONENT_FX_ID) {
          if (r.dotDamage > 0) {
            const curHp = readOppHp();
            const apply = effectsRouteDamage(effectsRef.current, OPPONENT_FX_ID, curHp, r.dotDamage);
            // 2026-05 v6: per-tick DOT visual on the actually-targeted card.
            if (apply.appliedDmg > 0) {
              writeOppHp(Math.max(0, curHp - apply.appliedDmg));
              fxRef.current.pushEnemyFloat(oppSlot, apply.appliedDmg, 'spell', { icon: 'skull-and-crossbones' });
            }
          }
          // 2026-05 v7: Mroczny Rytuał detonation. % of opponent max HP, no
          // DEF mit. Re-read live HP in case the DOT path already shifted it.
          if (r.darkRitualTriggered && r.darkRitualDamage > 0) {
            const curHp = readOppHp();
            if (curHp > 0) {
              const ritualDmg = Math.min(curHp, r.darkRitualDamage);
              writeOppHp(Math.max(0, curHp - ritualDmg));
              fxRef.current.pushEnemyFloat(oppSlot, ritualDmg, 'spell', { icon: 'skull', label: 'RITUAL', isCrit: true });
            }
          }
        }
      }
    }, 250);
    return () => clearInterval(id);
  }, [phase, monsterMaxHp]);

  // -- Manual potion use ---------------------------------------------------
  const doUsePotion = useCallback((elixirId: string) => {
    const elixir = ELIXIRS.find((e) => e.id === elixirId);
    if (!elixir) return;
    const char = useCharacterStore.getState().character;
    if (!char) return;
    const eff = getEffectiveChar(char);
    if (!eff) return;
    const charMaxHp = eff.max_hp;
    const charMaxMp = eff.max_mp;
    const isHp = elixir.effect.startsWith('heal_hp');
    const isMp = elixir.effect.startsWith('heal_mp');
    const isPct = elixir.effect.includes('pct');
    if (isHp && !isPct && hpPotionCooldownRef.current > 0) return;
    if (isMp && !isPct && mpPotionCooldownRef.current > 0) return;
    if (isHp && isPct && pctHpCooldownRef.current > 0) return;
    if (isMp && isPct && pctMpCooldownRef.current > 0) return;
    const used = useInventoryStore.getState().useConsumable(elixirId);
    if (!used) return;
    if (isHp && !isPct) startHpCooldown();
    if (isMp && !isPct) startMpCooldown();
    if (isHp && isPct) { setPctHpCooldown(PCT_POTION_CD_MS); pctHpCooldownRef.current = PCT_POTION_CD_MS; }
    if (isMp && isPct) { setPctMpCooldown(PCT_POTION_CD_MS); pctMpCooldownRef.current = PCT_POTION_CD_MS; }
    const flatMatch = elixir.effect.match(/^heal_(hp|mp)_(\d+)$/);
    const pctMatch = elixir.effect.match(/^heal_(hp|mp)_pct_(\d+)$/);
    if (flatMatch) {
      const type = flatMatch[1] as 'hp' | 'mp';
      const amount = parseInt(flatMatch[2], 10);
      if (type === 'hp') { healPlayerHp(amount, charMaxHp); addLog(`${elixir.name_pl} +${amount} HP`, 'system'); }
      else { healPlayerMp(amount, charMaxMp); addLog(`${elixir.name_pl} +${amount} MP`, 'system'); }
    } else if (pctMatch) {
      const type = pctMatch[1] as 'hp' | 'mp';
      const pct = parseInt(pctMatch[2], 10);
      if (type === 'hp') { const a = Math.floor(charMaxHp * pct / 100); healPlayerHp(a, charMaxHp); addLog(`${elixir.name_pl} +${a} HP (${pct}%)`, 'system'); }
      else { const a = Math.floor(charMaxMp * pct / 100); healPlayerMp(a, charMaxMp); addLog(`${elixir.name_pl} +${a} MP (${pct}%)`, 'system'); }
    }
  }, [addLog, healPlayerHp, healPlayerMp, startHpCooldown, startMpCooldown]);

  // -- Get status of a transform ----------------------------------------------
  const getTransformStatus = useCallback((t: ITransformData): 'locked' | 'available' | 'in_progress' | 'completed' => {
    if (completedTransforms.includes(t.id)) return 'completed';
    if (currentQuest?.transformId === t.id && currentQuest.inProgress) return 'in_progress';

    if (!character) return 'locked';
    if (character.level < t.level) return 'locked';
    // Check sequential order
    for (let i = 1; i < t.id; i++) {
      if (!completedTransforms.includes(i)) return 'locked';
    }
    // If another quest is in progress, lock this one
    if (currentQuest?.inProgress) return 'locked';
    return 'available';
  }, [completedTransforms, currentQuest, character]);

  // -- Start quest --------------------------------------------------------------
  const handleStartQuest = useCallback((transformId: number) => {
    if (!character) return;
    const started = useTransformStore.getState().startTransformQuest(transformId, character.level);
    if (started) {
      setActiveTransformId(transformId);
      // Fresh fight = fresh leave-guard cycle.
      leavePenaltyAppliedRef.current = false;
      setPhase('fighting');
      setCombatLog([]);
      // Reset shared session: backpack/loot/log/kills empty for the new quest run
      useCombatStore.getState().clearCombatSession();
      setVictoryReady(false);
      // Training runs always — no need to pause
      // Start first monster
      const quest = useTransformStore.getState().currentTransformQuest;
      if (quest) {
        const remaining = useTransformStore.getState().getRemainingMonsters();
        if (remaining.length > 0) {
          const monsters = getTransformMonsters(transformId);
          const nextM = monsters.find((m) => m.id === remaining[0]);
          if (nextM) {
            startMonsterFight(nextM, transformId);
          }
        }
      }
    }
  }, [character]);

  // -- Resume quest (if player left and came back) ------------------------------
  const handleResumeQuest = useCallback(() => {
    if (!currentQuest?.inProgress) return;
    setActiveTransformId(currentQuest.transformId);
    // Resuming a quest = fresh leave-guard cycle for this combat session.
    leavePenaltyAppliedRef.current = false;
    setPhase('fighting');
    setCombatLog([]);
    // Resume = fresh session window (the previous flee/exit already cleared it,
    // but be safe in case the player navigated back without an explicit exit).
    useCombatStore.getState().clearCombatSession();
    setVictoryReady(false);
    // Training runs always — no need to pause
    const remaining = useTransformStore.getState().getRemainingMonsters();
    if (remaining.length > 0) {
      const monsters = getTransformMonsters(currentQuest.transformId);
      const nextM = monsters.find((m) => m.id === remaining[0]);
      if (nextM) {
        startMonsterFight(nextM, currentQuest.transformId);
      }
    } else {
      // All defeated already — arm claim button instead of auto-transitioning.
      setVictoryReady(true);
    }
  }, [currentQuest]);

  // -- Cinematic entry: card -> fullscreen morph + reveal --------------------
  // Triggered by the per-card "Walcz" button. Captures the source card's
  // bounding box + per-tier hue/image, flips into the new 'entering' phase
  // (combat does NOT mount yet — no ticks, no damage), then schedules:
  //   - T+1.34s — `handleStartQuest` so the combat HUD mounts UNDER the
  //     still-opaque overlay; the reveal portion of the animation crossfades
  //     from black straight into the live arena.
  //   - T+2.0s — drop the overlay so the combat HUD is the sole visible layer.
  // Click anywhere on the overlay during the cinematic to skip — handled by
  // `skipEntryAnimation` below, which cancels the queued timeouts and starts
  // combat immediately. Reduced-motion users + missing card element bypass
  // the animation entirely.
  const handleEnterClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, transformId: number) => {
      const card = (e.currentTarget as HTMLElement).closest('.transform__card') as HTMLElement | null;
      const reducedMotion = typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!card || enterAnim || reducedMotion) {
        handleStartQuest(transformId);
        return;
      }
      const rect = card.getBoundingClientRect();
      const tfColorInfo = getTransformColor(transformId);
      const tfColorHex = tfColorInfo.solid ?? tfColorInfo.gradient?.[0] ?? '#ffc107';
      const hue = hexToHue(tfColorHex);
      const url = getTransformCardImage(transformId) ?? '';
      pendingTransformIdRef.current = transformId;
      setEnterAnim({
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
        hue,
        image: url,
        transformId,
      });
      setPhase('entering');
      enterAnimTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      enterAnimTimeoutsRef.current = [];
      // T+1.34s — start combat under the still-opaque overlay.
      const tCombat = window.setTimeout(() => {
        handleStartQuest(transformId);
      }, ENTRY_ANIM_COMBAT_START_AT_MS);
      enterAnimTimeoutsRef.current.push(tCombat);
      // T+2.0s — animation done, drop the overlay.
      const tEnd = window.setTimeout(() => {
        setEnterAnim(null);
      }, ENTRY_ANIM_TOTAL_MS);
      enterAnimTimeoutsRef.current.push(tEnd);
    },
    [enterAnim, handleStartQuest],
  );

  // Skip the cinematic — clicked anywhere on the overlay during 'entering'.
  // Cancels every queued timeout, starts combat immediately if it hasn't yet,
  // then clears the overlay so AnimatePresence runs the (fast) exit fade.
  const skipEntryAnimation = useCallback(() => {
    if (!enterAnim) return;
    enterAnimTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    enterAnimTimeoutsRef.current = [];
    if (phaseRef.current === 'entering' && pendingTransformIdRef.current != null) {
      handleStartQuest(pendingTransformIdRef.current);
    }
    setEnterAnim(null);
  }, [enterAnim, handleStartQuest]);

  // -- Start fight with a specific monster --------------------------------------
  const startMonsterFight = useCallback((baseMonster: IMonster, _transformId: number) => {
    const char = useCharacterStore.getState().character;
    if (!char) return;

    const bossMonster = applyTransformBossStats(baseMonster);
    setCurrentMonster(bossMonster);
    setMonsterHp(bossMonster.hp);
    setMonsterMaxHp(bossMonster.hp);
    monsterHpRef.current = bossMonster.hp;

    // Build the 4-slot wave lineup (Normal / Strong / Epic / Boss). Slots 0-2
    // are escorts at the same level as the boss, drawn from the bestiary so
    // each tile shows a different sprite. Slot 3 is the boss itself; we don't
    // store it in `escortSlots` because it already lives in `currentMonster`.
    const lineup = getTransformWaveLineup(bossMonster, baseMonster.level);
    const newEscorts: Array<IEscortSlot | null> = [null, null, null];
    for (const entry of lineup) {
      if (entry.tier === 'Boss') continue; // slot 3 is `currentMonster`
      newEscorts[entry.slot] = {
        slot: entry.slot as 0 | 1 | 2,
        tier: entry.tier,
        monster: entry.monster,
        currentHp: entry.monster.hp,
        maxHp: entry.monster.hp,
        // Pre-resolved sprite URL from the original template level — see the
        // IEscortSlot.imageUrl docstring for why we have to capture this
        // upstream of the stamp/level-rewrite.
        imageUrl: entry.spriteImageUrl,
      };
    }
    setEscortSlots(newEscorts);
    escortSlotsRef.current = newEscorts;
    // Fresh wave -> fresh kill-tally tracking. Without this, a player who
    // killed an escort in the previous wave would never get a tally for the
    // matching slot in the next wave (the key would already be in the set).
    escortKillsCountedRef.current = new Set();

    // Clear leftover floats / skill overlays from any previous boss in this quest
    fxRef.current.resetFx();
    // HP/MP are carried over between bosses within the same quest.
    // The store's char.hp/mp is kept in sync on monster death, so reading from the
    // store here gives the post-last-fight values (not a refill).
    setPlayerHp(char.hp);
    setPlayerMp(char.mp);
    playerHpRef.current = char.hp;
    playerMpRef.current = char.mp;
    // Pulse counters DON'T reset between bosses — only the slot id changes
    // matter for keying. Resetting to 0 would still work, but staying
    // monotonic guarantees the keyed flash overlay never ends up with the
    // same key as the previous fight by accident.
    setPlayerAttacking(false);

    // Reset cooldowns for a fresh fight
    setSkillCooldowns({});
    skillCooldownRef.current.clear();
    setHpPotionCooldown(0); hpPotionCooldownRef.current = 0;
    setMpPotionCooldown(0); mpPotionCooldownRef.current = 0;
    setPctHpCooldown(0); pctHpCooldownRef.current = 0;
    setPctMpCooldown(0); pctMpCooldownRef.current = 0;
    // Fresh effect session — clear all timers / DOTs / queues from prior
    // bosses so a leftover stun doesn't carry over into the next fight.
    effectsRef.current = newCombatEffectsSession();
    // Drop any necro summons left from a prior boss attempt.
    useNecroSummonStore.getState().clear(PLAYER_FX_ID);

    addLog(`BOSS ${baseMonster.name_pl} (Lvl ${baseMonster.level}) - Walka rozpoczeta!`, 'system');

    // Start player attack timer
    const effChar = getEffectiveChar(char);
    if (!effChar) return;
    const attackMs = getAttackMs(effChar.attack_speed);
    const classData = classesData[char.class] ?? {};
    const isDualWield = !!classData.dualWield;

    // Clear old timers
    clearTimers();

    // -- Target resolver ----------------------------------------------------
    // Walks slots 0 -> 1 -> 2 -> 3 (Normal / Strong / Epic / Boss) and returns
    // the first one still alive. Slots 0-2 read from `escortSlotsRef`; slot 3
    // is always the boss (`bossMonster` + `monsterHpRef`). Returns `null` once
    // every slot is dead — the wave ends there.
    type TTarget = {
      slot: 0 | 1 | 2 | 3;
      monster: IMonster;
      prevHp: number;
      maxHp: number;
      name: string;
    };
    const resolveTarget = (): TTarget | null => {
      const escorts = escortSlotsRef.current;
      for (let s = 0; s < 3; s++) {
        const e = escorts[s];
        if (e && e.currentHp > 0) {
          return {
            slot: s as 0 | 1 | 2,
            monster: e.monster,
            prevHp: e.currentHp,
            maxHp: e.maxHp,
            name: e.monster.name_pl,
          };
        }
      }
      const bossHp = monsterHpRef.current;
      if (bossHp > 0) {
        return {
          slot: 3,
          monster: bossMonster,
          prevHp: bossHp,
          maxHp: bossMonster.hp,
          name: bossMonster.name_pl,
        };
      }
      return null;
    };

    // Apply damage to whichever slot the resolver picked. For escorts, we
    // mutate the in-memory ref AND push a fresh array into the state so React
    // re-renders the tile; for the boss we still go through the existing
    // `monsterHpRef` + `setMonsterHp` pair so the death effect's deps array
    // keeps working unchanged.
    const applyDamageToSlot = (slot: 0 | 1 | 2 | 3, newHp: number) => {
      if (slot === 3) {
        monsterHpRef.current = newHp;
        setMonsterHp(newHp);
        return;
      }
      const cur = escortSlotsRef.current.slice();
      const e = cur[slot];
      if (!e) return;
      cur[slot] = { ...e, currentHp: newHp };
      escortSlotsRef.current = cur;
      setEscortSlots(cur);
    };

    // Player attack interval – runs at base/4 rate with tick-skipping for x1/x2/x4
    const playerTickInterval = Math.max(100, attackMs / 4);
    let playerTickCount = 0;
    combatTimerRef.current = setInterval(() => {
      playerTickCount += 1;
      const skip = 4 / speedMultRef.current; // x1=>4, x2=>2, x4=>1
      if (playerTickCount % skip !== 0) return;
      // Stun gate — paralysed players skip their entire swing tick.
      if (isCombatantStunned(effectsRef.current, PLAYER_FX_ID)) return;
      (() => {
      const latestChar = useCharacterStore.getState().character;
      if (!latestChar) return;

      const eff = getEffectiveChar(latestChar, currentMonsterRef.current?.level ?? 0);
      if (!eff) return;

      const weaponDmg = rollWeaponDamage();
      const { skillLevels } = useSkillStore.getState();
      const classBonus = getClassSkillBonus(latestChar.class, skillLevels);
      const skillBonus = classBonus.skillBonus;
      // 2026-05 v6: consume "next basic" buff queues so Precyzyjny / Klon
      // / Knight Ostateczny / Cięcie Boga all land their queued mod on
      // the swing that follows the cast.
      const playerStatus = ensureStatus(effectsRef.current, PLAYER_FX_ID);
      const basicMods = consumeCasterBasicHitMods(playerStatus);
      syncCasterChargeConsume(basicMods.consumed);
      const basicCritBoost = basicMods.extraCritChance;
      const basicForceCrit = basicMods.forceCrit;
      const basicDmgMult = basicMods.dmgMult;

      // Resolve target FIRST — walks the 4 slots and returns the first alive
      // one, or bails when the wave is empty. All side effects below operate
      // against this single target.
      const target = resolveTarget();
      if (!target) return;
      const targetSlot = target.slot;

      let totalDmg = 0;
      if (isDualWield) {
        const dual = calculateDualWieldDamage({
          baseAtk: eff.attack,
          weaponAtk: weaponDmg,
          offHandAtk: rollOffHandDamage(),
          skillBonus,
          classModifier: CLASS_MODIFIER[latestChar.class] ?? 1,
          enemyDefense: target.monster.defense,
          critChance: eff.crit_chance + basicCritBoost,
          critDmg: eff.crit_damage,
          maxCritChance: classData.maxCritChance ?? 0.5,
          damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier() * basicDmgMult,
        });
        totalDmg = dual.totalDamage;
        // Per-hit floats so the targeted card shows two distinct numbers
        // (one per swing) rather than collapsing to a single sum.
        fxRef.current.pushEnemyFloat(targetSlot, dual.hit1.finalDamage, 'basic', { isCrit: dual.hit1.isCrit, icon: 'dagger' });
        fxRef.current.pushEnemyFloat(targetSlot, dual.hit2.finalDamage, 'basic', { isCrit: dual.hit2.isCrit, icon: 'dagger' });
        addLog(
          `[Ty -> ${target.name}] Podwojny atak za ${dual.hit1.finalDamage} + ${dual.hit2.finalDamage} = ${totalDmg} dmg${dual.hit1.isCrit || dual.hit2.isCrit ? ' CRIT!' : ''}`,
          dual.hit1.isCrit || dual.hit2.isCrit ? 'crit' : 'dualwield',
        );
      } else {
        const canBlock = !!classData.canBlock;
        const canDodge = !!classData.canDodge;
        const result = calculateDamage({
          baseAtk: eff.attack,
          weaponAtk: weaponDmg,
          skillBonus,
          classModifier: CLASS_MODIFIER[latestChar.class] ?? 1,
          enemyDefense: target.monster.defense,
          critChance: eff.crit_chance + basicCritBoost,
          critDmg: eff.crit_damage,
          blockChance: canBlock ? calculateBlockChance(skillLevels['shielding'] ?? 0) : 0,
          dodgeChance: canDodge ? calculateDodgeChance(latestChar.class) : 0,
          maxCritChance: classData.maxCritChance ?? 0.5,
          isCrit: basicForceCrit ? true : undefined,
          damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier() * basicDmgMult,
        });
        totalDmg = result.finalDamage;
        fxRef.current.pushEnemyFloat(targetSlot, totalDmg, 'basic', { isCrit: result.isCrit });
        const logType = result.isCrit ? 'crit' : 'player';
        addLog(
          `[Ty -> ${target.name}] Atak za ${totalDmg} dmg${result.isCrit ? ' CRIT!' : ''} (HP: ${Math.max(0, target.prevHp - totalDmg)}/${target.maxHp})`,
          logType,
        );
      }

      setMonsterHitPulses((p) => ({ ...p, [targetSlot]: (p[targetSlot] ?? 0) + 1 }));
      setPlayerAttacking(true);
      const animDur = ATTACK_ANIM_DURATION[latestChar.class] ?? 350;
      setTimeout(() => { setPlayerAttacking(false); }, animDur);

      // Grant skill XP from attack (weapon skill for non-magic + MLVL for magic classes)
      useSkillStore.getState().addWeaponSkillXpFromAttack(latestChar.class);
      useSkillStore.getState().addMlvlXpFromAttack(latestChar.class);
      if (isDualWield) {
        // Second hit for dual wield classes
        useSkillStore.getState().addWeaponSkillXpFromAttack(latestChar.class);
      }

      let newHp = Math.max(0, target.prevHp - totalDmg);

      // Auto-skill fire (check all 4 slots, only if skillMode=auto)
      if (newHp > 0 && useSettingsStore.getState().skillMode === 'auto') {
        const now = Date.now();
        const slots = useSkillStore.getState().activeSkillSlots;
        let extraDmg = 0;
        for (let i = 0; i < 4; i++) {
          const skillId = slots[i];
          if (!skillId) continue;
          const lastUsed = skillCooldownRef.current.get(skillId) ?? 0;
          // 2026-06-21: scale the recast window by combat speed so skills fire
          // as soon as the (speed-scaled) cooldown bar empties — x2 → 2.5s,
          // x4 → 1.25s — instead of a fixed 5s wall-clock window.
          if (now - lastUsed < getSpeedScaledCooldownMs(SKILL_COOLDOWN_MS, speedMultRef.current)) continue;
          if (playerMpRef.current < SKILL_MP_COST) continue;
          // 2026-05 v7: Apokalipsa Śmierci synchronous self-cost.
          {
            const tmpDef = getSkillDef(skillId);
            if ((tmpDef?.effect ?? '').includes('death_apocalypse') && latestChar.class === 'Necromancer') {
              const hpPct = playerHpRef.current / Math.max(1, eff.max_hp);
              if (hpPct < 0.05) continue;
              let newPlayerHp: number;
              if (hpPct > 0.20) {
                newPlayerHp = Math.max(1, playerHpRef.current - Math.floor(eff.max_hp * 0.20));
              } else {
                newPlayerHp = Math.max(1, Math.floor(eff.max_hp * 0.03));
              }
              const lost = playerHpRef.current - newPlayerHp;
              if (lost > 0) {
                playerHpRef.current = newPlayerHp;
                setPlayerHp(newPlayerHp);
                useCharacterStore.getState().updateCharacter({ hp: newPlayerHp });
                fxRef.current.pushAllyFloat(0, lost, 'spell', { icon: 'broken-heart', label: `-${lost} HP` });
                addLog(`:broken-heart: Apokalipsa: -${lost} HP`, 'crit');
              }
            }
          }
          // Apply v2 effects (stun/dot/instant_kill/marks/etc.). Transform
          // is a 1v1 from the effect system's POV — every alive monster
          // counts as the single OPPONENT_FX_ID so AOE / multistrike are
          // moot here (boss-style handling).
          const sDef = getSkillDef(skillId);
          // 2026-05 v6: pure-buff branch + skill.damage scaling.
          const skillBaseMult = sDef?.damage ?? 1;
          const isPureBuff = skillBaseMult === 0;
          const targetMaxHp = target.maxHp || 1;
          const targetHpPct = targetMaxHp > 0 ? (newHp / targetMaxHp) * 100 : 100;
          const apply = effectsCastSkill({
            session: effectsRef.current,
            casterId: PLAYER_FX_ID,
            targetId: OPPONENT_FX_ID,
            targetHpPct,
            effect: sDef?.effect ?? null,
            allyIds: [PLAYER_FX_ID],
            enemyIds: [OPPONENT_FX_ID],
          });
          // Skill-upgrade combat bonus — local player's own auto-cast
          // (Transform is solo). Modest & capped.
          const skillUpgradeMultAuto = getCombatSkillUpgradeMultiplier(
            useSkillStore.getState().skillUpgradeLevels[skillId] ?? 0,
          );
          const baseDmg = isPureBuff ? 0 : Math.max(1, Math.floor(eff.attack * 0.15 * skillBaseMult * getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier() * skillUpgradeMultAuto));
          const normalSkillDmgTf = Math.floor(baseDmg * apply.castDmgMult);
          let skillDmg = isPureBuff
            ? 0
            : (apply.instantKill
                ? Math.max(1, newHp)
                : ((apply.executeBurstPct ?? 0) > 0
                    ? Math.max(normalSkillDmgTf, Math.floor(targetMaxHp * (apply.executeBurstPct ?? 0) / 100))
                    : normalSkillDmgTf));
          // 2026-05 v7: auto-skill spell consumes Klątwa AND gets Kraina ×N.
          if (!isPureBuff && skillDmg > 0) {
            const oppStAuto = ensureStatus(effectsRef.current, OPPONENT_FX_ID);
            const ampAuto = consumeTargetMarkAmp(oppStAuto);
            if (ampAuto.mult !== 1) {
              skillDmg = Math.max(1, Math.floor(skillDmg * ampAuto.mult));
            }
          }
          extraDmg += skillDmg;
          const newMp = Math.max(0, playerMpRef.current - SKILL_MP_COST);
          playerMpRef.current = newMp;
          setPlayerMp(newMp);
          skillCooldownRef.current.set(skillId, now);
          setSkillCooldowns((prev) => ({ ...prev, [skillId]: SKILL_COOLDOWN_MS }));
          if (sDef) applySkillBuff(skillId, sDef, speedMult);
          triggerSkillAnim(skillId);
          if (isPureBuff) {
            fxRef.current.triggerAllySkillAnim(0, skillId);
            addLog(`:sparkles: ${formatSkillName(skillId)}: BUFF (-${SKILL_MP_COST} MP)`, 'crit');
          } else {
            fxRef.current.triggerEnemySkillAnim(targetSlot, skillId);
            fxRef.current.pushEnemyFloat(targetSlot, skillDmg, 'spell', { icon: getSkillIcon(skillId) });
            addLog(`:sparkles: ${formatSkillName(skillId)}: ${skillDmg} dmg (-${SKILL_MP_COST} MP)`, 'crit');
          }
          // 2026-06-24 AOE FIX: area spells (Strzała Niebios etc.) must hit the
          // WHOLE transform wave, not just the active target. The primary target
          // gets the full skill damage (folded into extraDmg above); splash 75%
          // to every OTHER alive slot (escorts 0-2 + boss slot 3). The reactive
          // death effect (watches escortSlots/monsterHp) handles kills + the
          // wave-clear, so here we only lower HP + show floats.
          void apply.multistrike;
          if (apply.aoe && !isPureBuff && skillDmg > 0) {
            const splashDmg = Math.max(1, Math.floor(skillDmg * 0.75));
            const escortsNow = escortSlotsRef.current;
            for (let s = 0; s < 3; s++) {
              if (s === targetSlot) continue;
              const e = escortsNow[s];
              if (!e || e.currentHp <= 0) continue;
              applyDamageToSlot(s as 0 | 1 | 2, Math.max(0, e.currentHp - splashDmg));
              fxRef.current.pushEnemyFloat(s, splashDmg, 'spell', { icon: getSkillIcon(skillId) });
            }
            if (targetSlot !== 3 && monsterHpRef.current > 0) {
              applyDamageToSlot(3, Math.max(0, monsterHpRef.current - splashDmg));
              fxRef.current.pushEnemyFloat(3, splashDmg, 'spell', { icon: getSkillIcon(skillId) });
            }
          }
          // 2026-05 v6: heal-on-cast (Promień Pustki, Pochłonięcie
          // Życia, Żniwa Dusz). Capture pre/post HP so the float shows
          // the COMPUTED heal value with a (MAX) tag when capped at
          // max_hp — never silent at 100% HP.
          if (apply.healCasterPctOfDmg > 0 && skillDmg > 0) {
            const heal = Math.floor(skillDmg * (apply.healCasterPctOfDmg / 100));
            const before = playerHpRef.current;
            playerHpRef.current = Math.min(eff.max_hp, playerHpRef.current + heal);
            setPlayerHp(playerHpRef.current);
            const actual = playerHpRef.current - before;
            if (heal > 0) {
              const cappedTag = actual < heal ? ' (MAX)' : '';
              fxRef.current.pushAllyFloat(0, heal, 'heal', {
                icon: 'sparkles',
                label: cappedTag ? `+${heal}${cappedTag}` : undefined,
              });
              addLog(`:sparkles: ${formatSkillName(skillId)}: +${heal} HP${cappedTag}`, 'crit');
            }
          }
          if (apply.healCasterPctOfMaxHp > 0) {
            const heal = Math.floor(eff.max_hp * (apply.healCasterPctOfMaxHp / 100));
            const before = playerHpRef.current;
            playerHpRef.current = Math.min(eff.max_hp, playerHpRef.current + heal);
            setPlayerHp(playerHpRef.current);
            const actual = playerHpRef.current - before;
            if (heal > 0) {
              const cappedTag = actual < heal ? ' (MAX)' : '';
              fxRef.current.pushAllyFloat(0, heal, 'heal', {
                icon: 'sparkles',
                label: cappedTag ? `+${heal}${cappedTag}` : undefined,
              });
            }
          }
          // 2026-05 v6: Cleric `heal` / `holy_nova` — heal_lowest_ally_pct.
          // Transform is solo so player IS the lowest ally; heals N% of
          // their max HP. Float on player slot + ally skill anim.
          if (apply.healLowestAllyPct > 0) {
            const heal = Math.floor(eff.max_hp * (apply.healLowestAllyPct / 100));
            const before = playerHpRef.current;
            playerHpRef.current = Math.min(eff.max_hp, playerHpRef.current + heal);
            setPlayerHp(playerHpRef.current);
            const actual = playerHpRef.current - before;
            if (heal > 0) {
              const cappedTag = actual < heal ? ' (MAX)' : '';
              fxRef.current.pushAllyFloat(0, heal, 'heal', {
                icon: 'sparkles',
                label: cappedTag ? `+${heal}${cappedTag}` : undefined,
              });
              fxRef.current.triggerAllySkillAnim(0, skillId);
              addLog(`:sparkles: ${formatSkillName(skillId)}: +${heal} HP${cappedTag}`, 'crit');
            }
          }
          // Necro summon spawn — only when caster is a necro.
          if (apply.summons.length > 0 && latestChar.class === 'Necromancer') {
            const store = useNecroSummonStore.getState();
            for (const sm of apply.summons) {
              {
                const spawned = store.spawn(PLAYER_FX_ID, sm.type, sm.count, eff.attack, eff.max_hp);
                if (spawned > 0) fxRef.current.triggerAllySummonSpawn(0, sm.type);
              }
            }
          }
          // 2026-05 v7: Apokalipsa Śmierci — target damage only.
          if (apply.deathApocalypse && latestChar.class === 'Necromancer') {
            const apocDmg = Math.max(1, Math.floor(target.maxHp * (apply.deathApocalypseTargetMaxHpPct / 100)));
            extraDmg += apocDmg;
            fxRef.current.pushEnemyFloat(targetSlot, apocDmg, 'spell', { icon: 'skull-and-crossbones', label: 'APOKALIPSA', isCrit: true });
            addLog(`:skull-and-crossbones: Apokalipsa Śmierci: ${apocDmg} dmg`, 'crit');
          }
          break;
        }
        if (extraDmg > 0) {
          newHp = Math.max(0, newHp - extraDmg);
        }
      }

      // Necromancer summon swing — every live summon contributes a fraction
      // of the necro's attack stat against the same target.
      if (latestChar.class === 'Necromancer' && newHp > 0) {
        const summonBonus = useNecroSummonStore.getState().totalAttackBonus(PLAYER_FX_ID, eff.attack);
        if (summonBonus > 0) {
          let dmg = Math.max(1, summonBonus - Math.floor(target.monster.defense * 0.5));
          // 2026-05 v7: summon swings consume Klątwa Śmierci (count)
          // AND Kraina Śmierci (duration ×N) on the boss.
          const oppStSum = ensureStatus(effectsRef.current, OPPONENT_FX_ID);
          const ampSum = consumeTargetMarkAmp(oppStSum);
          if (ampSum.mult !== 1) {
            dmg = Math.max(1, Math.floor(dmg * ampSum.mult));
          }
          newHp = Math.max(0, newHp - dmg);
          fxRef.current.pushEnemyFloat(targetSlot, dmg, 'basic', { icon: 'skull' });
          addLog(`:skull: Summony zadają ${dmg} dmg`, 'player');
        }
      }

      // Auto-potion check after player attack
      tryAutoPotionRef.current();

      applyDamageToSlot(targetSlot, newHp);
      })();
    }, playerTickInterval);

    // Monster attack interval – runs at base/4 rate with tick-skipping.
    // Every alive monster (escorts + boss) lands its own swing on the player
    // each tick; the per-tile float numbers come out as separate red pops so
    // the player can read each contribution. The interval cadence is keyed
    // off the boss's speed (escorts are minions and don't get a separate
    // timer of their own — keeps the system simple and predictable).
    const monsterAttackMs = Math.max(800, 2000 - bossMonster.speed * 10);
    const monsterTickInterval = Math.max(100, monsterAttackMs / 4);
    let monsterTickCount = 0;
    monsterTimerRef.current = setInterval(() => {
      monsterTickCount += 1;
      const skip = 4 / speedMultRef.current;
      if (monsterTickCount % skip !== 0) return;
      // Stun gate — paralysed opponents skip their swing tick.
      if (isCombatantStunned(effectsRef.current, OPPONENT_FX_ID)) return;
      // 2026-05 v6: Krok Cienia / Unik charge buff — burns one charge
      // per non-magic enemy hit, skips the entire attack tick.
      if (useBuffStore.getState().getBuffCharges('skill_charge_dodge_next') > 0) {
        useBuffStore.getState().consumeBuffCharge('skill_charge_dodge_next');
        addLog(`Przeciwnik atakuje – Krok Cienia! Unik!`, 'crit');
        return;
      }
      // 2026-05 v6: Cleric Boska Tarcza — block_next_party charge.
      // Stacks up to 2; consumed per incoming hit, eats the entire
      // attack tick.
      if (useBuffStore.getState().getBuffCharges('skill_charge_block_next_party') > 0) {
        useBuffStore.getState().consumeBuffCharge('skill_charge_block_next_party');
        fxRef.current.pushAllyFloat(0, 0, 'heal', { icon: 'shield', label: 'BLOCK' });
        addLog(`:shield: Boska Tarcza! Blok!`, 'crit');
        return;
      }
      // 2026-05 v6: Rogue Bomba Dymna (dodge_buff:50:4000) — % chance
      // to fully dodge each incoming basic during the buff window.
      const tfPlayerSt = ensureStatus(effectsRef.current, PLAYER_FX_ID);
      if (tfPlayerSt.dodgeBuffMs > 0 && tfPlayerSt.dodgeBuffPct > 0) {
        if (Math.random() * 100 < tfPlayerSt.dodgeBuffPct) {
          fxRef.current.pushAllyFloat(0, 0, 'heal', { icon: 'dashing-away', label: 'UNIK' });
          addLog(`:dashing-away: Bomba Dymna! Unik (${tfPlayerSt.dodgeBuffPct}%)`, 'crit');
          return;
        }
      }
      // Same pattern as the player attack: read prev HP from the ref, run all
      // side effects in normal flow, finally setPlayerHp with a plain value.
      const prevPhp = playerHpRef.current;
      if (prevPhp <= 0) return;

      const latestChar = useCharacterStore.getState().character;
      if (!latestChar) return;
      const eff = getEffectiveChar(latestChar);
      if (!eff) return;

      // Build the list of attackers (alive escorts + alive boss). Order is
      // top-left -> top-right -> bottom-left -> bottom-right so the floats stack
      // in a predictable reading order on the player card.
      type TAttacker = { monster: IMonster; name: string };
      const attackers: TAttacker[] = [];
      const escorts = escortSlotsRef.current;
      for (let s = 0; s < 3; s++) {
        const e = escorts[s];
        if (e && e.currentHp > 0) {
          attackers.push({ monster: e.monster, name: e.monster.name_pl });
        }
      }
      if (monsterHpRef.current > 0) {
        attackers.push({ monster: bossMonster, name: bossMonster.name_pl });
      }
      if (attackers.length === 0) return;

      let totalDmg = 0;
      for (const a of attackers) {
        const rawDmg = rollMonsterDamage(a.monster);
        const dmg = Math.max(1, rawDmg - eff.defense);
        totalDmg += dmg;
        // One red float per attacker so the player can read each contribution.
        fxRef.current.pushAllyFloat(0, dmg, 'monster');
        addLog(
          `[${a.name}] Atak za ${dmg} dmg`,
          'monster',
        );
      }

      // Necromancer summon shield — front-of-queue summon eats accumulated
      // damage before the necro takes it. Each opponent's swing already
      // landed its float, so we just absorb the totalled HP delta.
      let hpDelta = totalDmg;
      if (latestChar.class === 'Necromancer' && hpDelta > 0) {
        const store = useNecroSummonStore.getState();
        if (store.count(PLAYER_FX_ID) > 0) {
          const r2 = store.damageFirst(PLAYER_FX_ID, hpDelta);
          hpDelta = Math.max(0, hpDelta - r2.dmgConsumed);
        }
      }

      setPlayerHitPulse((p) => p + 1);
      const newPhp = Math.max(0, prevPhp - hpDelta);
      addLog(
        `Otrzymales ${totalDmg} dmg (HP: ${newPhp}/${eff.max_hp})`,
        'monster',
      );
      playerHpRef.current = newPhp;
      setPlayerHp(newPhp);
      // Try auto-potion after taking damage
      setTimeout(() => tryAutoPotionRef.current(), 0);
    }, monsterTickInterval);
    // `fx` intentionally NOT in deps — see comment on `fxRef`. Putting it here
    // would re-create `startMonsterFight` every render, which makes the death
    // effect's deps array (which includes startMonsterFight) churn every render
    // and re-fire `addLog` once monsterHp ≤ 0, blowing the update-depth limit.
  }, [addLog, clearTimers]);

  // -- Check monster death / player death ------------------------------------
  useEffect(() => {
    if (phase !== 'fighting') return;

    // Wave cleared — only when EVERY slot (3 escorts + boss) is dead. The boss
    // is always killed last (the player auto-attack walks slots 0->1->2->3, so
    // the boss is the final target), but we still gate on the escorts being
    // dead too in case some future change reorders targeting. Each escort kill
    // also fires a session/combat tally so the per-tier monsters count toward
    // the global "monsters defeated" stats.
    const escortsAllDead = escortSlots.every((e) => e === null || e.currentHp <= 0);

    // Mirror escort kills to the shared combat session as soon as they go
    // down. We track which slots have already been counted in a ref so the
    // tally doesn't double-fire across re-renders. The ref lives outside the
    // effect on purpose — see `escortKillsCountedRef` declaration.
    if (currentMonster) {
      for (let s = 0; s < 3; s++) {
        const e = escortSlots[s];
        if (!e || e.currentHp > 0) continue;
        const key = `${currentMonster.id}__slot${s}`;
        if (escortKillsCountedRef.current.has(key)) continue;
        escortKillsCountedRef.current.add(key);
        // Tier -> kill bucket mapping. Normal/Strong/Epic mirror the dungeon
        // monster types so the unified backpack popup counts them in the
        // matching rows. (Boss is counted on the wave clear branch below.)
        const bucket = e.tier === 'Normal' ? 'normal'
          : e.tier === 'Strong' ? 'strong'
          : 'epic';
        useCombatStore.getState().incrementSessionKill(bucket);
        // Per-kill task / quest / daily-quest / mastery progress —
        // mirrors the hunt/dungeon/raid wiring so escorts contribute
        // toward the same grind streams. The escort's `monster.id` is
        // a real monsters.json entry, so the lookups inside each store
        // resolve normally.
        useTaskStore.getState().addKill(e.monster.id, e.monster.level, 1);
        useQuestStore.getState().addProgress('kill', e.monster.id, 1, e.monster.level);
        useDailyQuestStore.getState().addProgress('kill_any', 1);
        useMasteryStore.getState().addMasteryKills(e.monster.id, 1);
        addLog(`${e.tier} ${e.monster.name_pl} pokonany!`, 'system');
      }
    }

    // Wave cleared — boss + all escorts down. Triggers the spawn timer for
    // the next wave OR arms `victoryReady` if this was the last wave.
    if (monsterHp <= 0 && escortsAllDead && currentMonster) {
      clearTimers();
      tickCombatElixirs(2000);
      // Record defeat in store
      useTransformStore.getState().defeatMonster(currentMonster.id);
      // Mirror to shared combat session so the unified backpack popup tally
      // counts every transform monster as a boss-tier kill.
      useCombatStore.getState().incrementSessionKill('boss');
      // Per-kill task / quest / daily-quest / mastery progress for the
      // boss — same wiring as the escort branch above. Boss-typed
      // daily quests + boss-rarity quests both fire here so the player
      // gets full credit alongside hunting / dungeon / raid kills.
      useTaskStore.getState().addKill(currentMonster.id, currentMonster.level, 1);
      useQuestStore.getState().addProgress('kill', currentMonster.id, 1, currentMonster.level);
      useQuestStore.getState().addProgress('boss', currentMonster.id, 1);
      useQuestStore.getState().addProgress('kill_rarity', 'boss', 1, currentMonster.level);
      useQuestStore.getState().addProgress('kill_bosses_any', 'any', 1);
      useDailyQuestStore.getState().addProgress('kill_any', 1);
      useDailyQuestStore.getState().addProgress('kill_boss', 1);
      useMasteryStore.getState().addMasteryKills(currentMonster.id, 1);
      addLog(`BOSS ${currentMonster.name_pl} pokonany!`, 'system');

      // Persist current HP/MP into character store so next boss fight continues
      // at the same HP/MP values (no refill between bosses in the same quest).
      useCharacterStore.getState().updateCharacter({
        hp: Math.max(1, playerHp),
        mp: Math.max(0, playerMp),
      });

      // Check for more monsters. Point 11 + N6: track the timeout ref + guard
      // the callback with phaseRef so clicking Uciekaj in this 1 s window never
      // resolves into a false "allDefeated" state and bogus reward popup.
      // Point N6: when the last monster dies, DO NOT auto-transition to the
      // 'allDefeated' phase — instead arm `victoryReady` so the combat view
      // shows an explicit "Zgarnij nagrody" button. This prevents the reward
      // popup from flashing in the millisecond gap between the setTimeout
      // firing and Uciekaj being clicked.
      if (postKillTimeoutRef.current) {
        clearTimeout(postKillTimeoutRef.current);
      }
      const spawnDelayMs = Math.max(60, Math.floor(MONSTER_SPAWN_DELAY_MS / speedMultRef.current));
      // Arm the spawn-bar countdown so the slim header bar fills L->R
      // over the wait. Cleared either when the timeout fires or when
      // the player flees / dies / claims (the phase-watching effect
      // below zeroes it whenever phase ≠ 'fighting').
      spawnStartRef.current = Date.now();
      spawnDurationRef.current = spawnDelayMs;
      setSpawnProgress(0);
      setWaitingForSpawn(true);
      postKillTimeoutRef.current = setTimeout(() => {
        postKillTimeoutRef.current = null;
        setWaitingForSpawn(false);
        setSpawnProgress(0);
        // If the player abandoned / fled / died in the meantime, do nothing.
        if (phaseRef.current !== 'fighting') return;
        const remaining = useTransformStore.getState().getRemainingMonsters();
        if (remaining.length === 0) {
          // All monsters defeated — arm the explicit claim button. Phase stays
          // 'fighting' so Uciekaj keeps working the same way.
          setVictoryReady(true);
          addLog('Wszystkie potwory pokonane! Kliknij "Zgarnij nagrody", aby dokonczyc transformacje.', 'system');
        } else {
          // Next monster
          const monsters = getTransformMonsters(activeTransformId);
          const nextM = monsters.find((m) => m.id === remaining[0]);
          if (nextM) {
            startMonsterFight(nextM, activeTransformId);
          }
        }
      }, spawnDelayMs);
    }

    // Player death
    if (playerHp <= 0 && currentMonster && monsterHp > 0) {
      clearTimers();
      // Real combat death — flag the leave guard so unmount cleanup doesn't
      // double-charge on top of the penalty applied below.
      leavePenaltyAppliedRef.current = true;
      addLog('Zostales pokonany!', 'system');

      // Apply death penalty
      const char = useCharacterStore.getState().character;
      if (char) {
        // Log death to global feed – include transform level + monster so the death
        // log can show "Transformacja III (Lvl 100) – Harpia Lvl 13 zabiła Krasek Lvl 44"
        const transformMeta = getTransformById(activeTransformId);
        const monsterName = currentMonster.name_pl ?? currentMonster.name_en ?? 'Nieznany potwor';
        const monsterLvl = currentMonster.level ?? char.level;
        const transformName = transformMeta?.name_pl ?? `Transform ${activeTransformId}`;
        const transformLvl = transformMeta?.level ?? char.level;
        void deathsApi.logDeath({
          character_id: char.id,
          character_name: char.name,
          character_class: char.class,
          character_level: char.level,
          source: 'transform',
          source_name: `${transformName} (Tlvl ${transformLvl}) – ${monsterName} Lvl ${monsterLvl}`,
          source_level: transformLvl,
        });

        // Unified death/flee protection (2026-06-21): a single helper consumes
        // ONE protection item (death-protection elixir first, then amulet of
        // loss). When protected the player loses NOTHING — no level, no XP, no
        // skill XP, no items — on both death and flee.
        const prot = consumeDeathProtection();

        // Capture the penalty figures so we can feed the unified DeathNotification
        // popup below — same shape as Boss/Dungeon use, so the player sees the
        // same "you died, here's what you lost" overlay across every combat view.
        let oldLevelForPopup = char.level;
        let newLevelForPopup = char.level;
        let levelsLostForPopup = 0;
        let xpPercentForPopup = 100;
        let skillXpLossPercentForPopup = 0;

        if (prot.isProtected) {
          // ZERO loss — no penalty math, no item loss. Just full-heal and log.
          useCharacterStore.getState().fullHealEffective();
          addLog(
            prot.consumedId === 'amulet_of_loss'
              ? 'Amulet of Loss roztrzaskal sie i ochronil Cie od wszelkich strat!'
              : 'Eliksir Ochrony uchronil Cie od wszelkich strat!',
            'system',
          );
        } else {
          const penalty = applyDeathPenalty(char.level, char.xp);
          const currentHighest = char.highest_level ?? char.level;
          const preservedHighest = Math.max(currentHighest, char.level);
          // Apply level/XP loss WITHOUT touching hp/mp — leaving the partial
          // 50% / 50% restore behind from before. After the level rollback
          // settles we call `fullHealEffective` so the player respawns at
          // 100% (against the NEW max_hp/max_mp computed from the rolled-
          // back level + active equipment), matching the behaviour of every
          // other combat view (Boss/Dungeon/Combat). Anything less and the
          // first thing the player has to do post-respawn is sit and watch
          // a regen tick before they can fight again — bad UX after the
          // already painful XP loss.
          useCharacterStore.getState().updateCharacter({
            level: penalty.newLevel,
            xp: penalty.newXp,
            highest_level: preservedHighest,
          });
          useCharacterStore.getState().fullHealEffective();
          useSkillStore.getState().applyDeathPenalty(char.class, penalty.skillXpLossPercent);
          useSkillStore.getState().purgeLockedSkillSlots(char.class, penalty.newLevel);
          if (penalty.levelsLost > 0) {
            addLog(`Straciles ${penalty.levelsLost} poziom${penalty.levelsLost === 1 ? '' : 'y'}: ${char.level} -> ${penalty.newLevel} · -${penalty.skillXpLossPercent}% Skill XP`, 'system');
          } else {
            addLog(`Zginąłeś. Kara: -${penalty.skillXpLossPercent}% Skill XP`, 'system');
          }
          oldLevelForPopup = char.level;
          newLevelForPopup = penalty.newLevel;
          levelsLostForPopup = penalty.levelsLost;
          xpPercentForPopup = penalty.xpPercent;
          skillXpLossPercentForPopup = penalty.skillXpLossPercent;

          // Item loss happens on UNPROTECTED DEATH ONLY.
          const itemsLost = useInventoryStore.getState().applyDeathItemLoss(false);
          if (itemsLost > 0) {
            addLog(`Stracileś ${itemsLost} przedmiot(ow) przy smierci!`, 'system');
          }
        }

        // Unified epic death overlay — same popup the Boss/Dungeon/Combat
        // views fire. Auto-navigates to town but the popup itself stays
        // mounted (DeathNotification is global) until the player clicks
        // it, so the post-mortem can't be missed. killedBy is the monster
        // that actually landed the killing blow (not the transform meta),
        // matching the mental model "X killed me" rather than "this whole
        // dungeon killed me".
        useDeathStore.getState().triggerDeath({
          killedBy: monsterName,
          sourceLevel: monsterLvl,
          oldLevel: oldLevelForPopup,
          newLevel: newLevelForPopup,
          levelsLost: levelsLostForPopup,
          xpPercent: xpPercentForPopup,
          skillXpLossPercent: skillXpLossPercentForPopup,
          protectionUsed: prot.isProtected,
          source: 'transform',
        });
      }

      // Abandon quest
      useTransformStore.getState().abandonTransformQuest();
      void saveCurrentCharacterStores();
      // Death ends the session — clear the shared session so the next combat
      // view starts with an empty backpack/log popup.
      useCombatStore.getState().clearCombatSession();
      // Drop any leftover necro summons.
      useNecroSummonStore.getState().clear(PLAYER_FX_ID);

      // Point 11: track the death transition so Abandon / nav away cancels it.
      if (deathTimeoutRef.current) {
        clearTimeout(deathTimeoutRef.current);
      }
      deathTimeoutRef.current = setTimeout(() => {
        deathTimeoutRef.current = null;
        setPhase('list');
        setCurrentMonster(null);
      }, 2000);
    }
  }, [monsterHp, playerHp, phase, currentMonster, escortSlots, activeTransformId, clearTimers, addLog, startMonsterFight]);

  // -- Handle "Uciekaj" button -------------------------------------------------
  // Point 11: Ucieknij must be fully cancellable — abandon the quest, cancel
  // any pending post-kill / death timers, and go straight to Miasto so no
  // stray setTimeout can fire an "allDefeated" state and award bogus rewards.
  // Spec: Ucieknij from a non-hunting fight = standard 1/10 flee penalty (XP
  // loss only — no level strip, no item loss). Same penalty as Boss/Dungeon.
  const handleAbandon = useCallback(() => {
    clearTimers(); // cancels attack intervals + post-kill + death timeouts
    useTransformStore.getState().abandonTransformQuest();
    // Voluntary abandon = soft flee penalty — flag the leave guard so
    // unmount cleanup doesn't upgrade this to a full death.
    leavePenaltyAppliedRef.current = true;
    // Apply the standard flee penalty so retreating from transform-quest
    // bosses costs the player something — never strips a level, never
    // touches equipment.
    const ch = useCharacterStore.getState().character;
    if (ch && ch.level > 1) {
      // 2026-05-19 v25 spec: log flee to the global deaths feed so the
      // /deaths view can render "<monster> przegnał <player>" even when
      // the player didn't actually die. We do this even if a protection
      // elixir would have negated the XP loss — the spec is explicit
      // that the feed entry must still appear, just with the verb
      // "przegnał" (driven by `result: 'fled'`).
      const transformMeta = getTransformById(activeTransformId);
      const mon = currentMonster;
      const monsterName = mon?.name_pl ?? mon?.name_en ?? transformMeta?.name_pl ?? `Transform ${activeTransformId}`;
      const monsterLvl = mon?.level ?? transformMeta?.level ?? ch.level;
      void deathsApi.logDeath({
        character_id: ch.id,
        character_name: ch.name,
        character_class: ch.class,
        character_level: ch.level,
        source: 'transform',
        source_name: monsterName,
        source_level: monsterLvl,
        result: 'fled',
      });

      // Unified death/flee protection (2026-06-21): consume ONE protection
      // item and, when protected, skip the flee penalty entirely — zero loss
      // (no level, no XP, no skill XP). Flee NEVER loses items regardless.
      const prot = consumeDeathProtection();
      if (prot.isProtected) {
        addLog(
          prot.consumedId === 'amulet_of_loss'
            ? 'Amulet of Loss roztrzaskal sie i ochronil Cie od kary za ucieczke!'
            : 'Eliksir Ochrony uchronil Cie od kary za ucieczke!',
          'system',
        );
      } else {
        const pen = applyFleePenalty(ch.level, ch.xp);
        useCharacterStore.getState().updateCharacter({
          xp: pen.newXp,
          level: pen.newLevel,
        });
        useSkillStore.getState().applyDeathPenalty(ch.class, pen.skillXpLossPercent);
        if (pen.levelsLost > 0) {
          useSkillStore.getState().purgeLockedSkillSlots(ch.class, pen.newLevel);
        }
      }
    }
    // Persist current HP/MP so fleeing keeps your wounds (combat outcomes
    // never silently top you off). Clamp to EFFECTIVE max so an HP-elixir-
    // boosted player doesn't lose their over-base HP on flee.
    {
      const liveChar = useCharacterStore.getState().character;
      if (liveChar) {
        const fleeEff = getEffectiveChar(liveChar);
        const fleeMaxHp = fleeEff?.max_hp ?? liveChar.max_hp;
        const fleeMaxMp = fleeEff?.max_mp ?? liveChar.max_mp;
        useCharacterStore.getState().updateCharacter({
          hp: Math.max(1, Math.min(fleeMaxHp, playerHpRef.current)),
          mp: Math.max(0, Math.min(fleeMaxMp, playerMpRef.current)),
        });
      }
    }
    // Training runs always — no action needed
    useCombatStore.getState().clearCombatSession();
    setVictoryReady(false);
    setPhase('list');
    setCurrentMonster(null);
    setCombatLog([]);
    navigate('/');
  }, [clearTimers, navigate, activeTransformId, currentMonster, addLog]);

  // Point N6: explicit claim button handler — transitions to 'allDefeated'.
  const handleClaimVictory = useCallback(() => {
    clearTimers();
    setVictoryReady(false);
    setPhase('allDefeated');
  }, [clearTimers]);

  // -- Handle rewards / complete transform --------------------------------------
  const handleShowRewards = useCallback(() => {
    if (!character) return;
    const transformId = activeTransformId;
    const transformRewards = calculateTransformRewards(transformId, character.class as TCharacterClass);
    setRewards(transformRewards);
  }, [character, activeTransformId]);

  const handleTransformClick = useCallback(() => {
    setShowTransformAnimation(true);

    // After 3s animation, show fullscreen avatar
    setTimeout(() => {
      setShowFullscreenAvatar(true);
    }, 3000);
  }, []);

  const handleCompleteTransform = useCallback(() => {
    if (!character || !rewards) return;

    // Complete the transform in the store — this is the ONLY state mutation
    // needed for the permanent bonuses. Point 7 (2026-04): bonuses are no
    // longer baked into character.max_hp / attack / etc. at claim time;
    // getEffectiveChar() reads the completed-transforms list and applies
    // both the flat rewards and the % multipliers live on every render, so
    // they keep scaling as the player levels up or swaps gear. Doing the
    // bake here would double-count them.
    //
    // Bug 1 (2026-04): completeTransform() now also handles the recovery
    // path where the quest was abandoned but a pending claim survived. It
    // returns the transformId in either case so the rest of the flow runs
    // identically.
    const completedId = useTransformStore.getState().completeTransform();
    if (completedId === 0) return;

    // Since completeTransform() flipped the live bonus stack, the player's
    // effective max_hp / max_mp just jumped. Refill HP/MP to the new max so
    // the reward actually feels like a power-up instead of a fractional bar.
    const effectiveMax = getEffectiveChar(useCharacterStore.getState().character);
    if (effectiveMax) {
      useCharacterStore.getState().updateCharacter({
        hp: effectiveMax.max_hp,
        mp: effectiveMax.max_mp,
      });
    }

    // Add consumable rewards to inventory
    for (const consumable of rewards.consumables) {
      useInventoryStore.getState().addConsumable(consumable.id, consumable.count);
    }

    // Add weapon reward to inventory if present
    if (rewards.weapon) {
      useInventoryStore.getState().addItem(rewards.weapon);
    }

    // Bug 1: clear the pending-reward marker so re-entry doesn't loop the
    // claim screen. Done last so that any thrown exception above keeps the
    // pending claim alive for next attempt.
    useTransformStore.getState().claimPendingReward();

    // Training runs always — no action needed

    void saveCurrentCharacterStores();

    setPhase('complete');
  }, [character, rewards]);

  const handleReturn = useCallback(() => {
    // Reset transform-screen state so the next visit lands fresh on the list
    // view (not stuck on the previous quest's complete screen). Then route to
    // the city — the button on the complete screen now reads "Wroc do miasta"
    // (return to town), so the player is sent to the town hub at `/` instead
    // of just the in-page transform list. Without the state reset, navigating
    // back into /transform later would briefly flash the previous complete
    // screen before the list mounts.
    setPhase('list');
    setCurrentMonster(null);
    setCombatLog([]);
    setRewards(null);
    setShowTransformAnimation(false);
    setShowFullscreenAvatar(false);
    setActiveTransformId(0);
    navigate('/');
  }, [navigate]);

  // -- Render helpers ----------------------------------------------------------

  // NOTE: `if (!character)` early-return moved DOWN past every hook in this
  // component (after `doManualSkill` useCallback below). Returning early up
  // here caused a Rules of Hooks violation — on first render character was
  // null so React stopped counting hooks; on the next render character was
  // hydrated and `doManualSkill` useCallback registered, breaking hook order
  // and crashing the entire <Boss>-style component tree. E2E
  // `combat/transform/page-loads.spec.ts` was failing with the React "change
  // in the order of Hooks" error before this move.

  const nameKey = language === 'pl' ? 'name_pl' : 'name_en';

  // -- Transform list view ------------------------------------------------------
  const renderList = () => {
    if (!character) return null;
    return (
      <div className="transform__list">
        {allTransforms.map((t) => {
          const status = getTransformStatus(t);
          const colorInfo = getTransformColor(t.id);
          const monsterCount = getTransformMonsters(t.id).length;
          const questForThis = currentQuest?.transformId === t.id ? currentQuest : null;

          const cardImage = getTransformCardImage(t.id);

          return (
            <div
              key={t.id}
              className={`transform__card transform__card--${status}${cardImage ? ' transform__card--has-image' : ''}`}
              style={{
                '--transform-color': colorInfo.solid ?? colorInfo.gradient?.[0] ?? '#9e9e9e',
                '--transform-gradient': colorInfo.css,
                ...(cardImage ? { '--card-image': `url("${cardImage}")` } : null),
              } as React.CSSProperties}
            >
              <div className="transform__card-header">
                <div
                  className={`transform__card-number${cardImage ? ' transform__card-number--has-image' : ''}`}
                  style={{ background: colorInfo.css }}
                >
                  {cardImage ? (
                    <img
                      className="transform__card-number-img"
                      src={cardImage}
                      alt={`T${t.id}`}
                      draggable={false}
                    />
                  ) : (
                    `T${t.id}`
                  )}
                </div>
                <div className="transform__card-info">
                  <span className="transform__card-name">{t[nameKey]}</span>
                  <span className="transform__card-level-pill">{t.level} LVL</span>
                </div>
                <div className="transform__card-status">
                  {status === 'locked' && <span className="transform__status-icon"><GameIcon name="locked" /></span>}
                  {status === 'available' && <span className="transform__status-icon"><GameIcon name="high-voltage" /></span>}
                  {status === 'in_progress' && <span className="transform__status-icon"><GameIcon name="crossed-swords" /></span>}
                  {status === 'completed' && <span className="transform__status-icon"><GameIcon name="trophy" /></span>}
                </div>
              </div>

              <div className="transform__card-monsters">
                <span className="transform__card-monsters-pill">{monsterCount} bossów</span>
              </div>

              {/* Progress bar for in-progress quests */}
              {status === 'in_progress' && questForThis && (
                <div className="transform__progress-wrap">
                  <div className="transform__progress-bar">
                    <div
                      className="transform__progress-fill"
                      style={{
                        width: `${(questForThis.monstersDefeated.length / questForThis.totalMonsters) * 100}%`,
                        background: colorInfo.css,
                      }}
                    />
                  </div>
                  <span className="transform__progress-text">
                    {questForThis.monstersDefeated.length} / {questForThis.totalMonsters}
                  </span>
                </div>
              )}

              {/* Completed avatar preview */}
              {status === 'completed' && (
                <div className="transform__card-avatar">
                  <img
                    src={getTransformAvatarImage(character.class, t.id)}
                    alt={`Transform ${t.id}`}
                    className="transform__card-avatar-img"
                  />
                </div>
              )}

              {/* Action buttons */}
              <div className="transform__card-actions">
                {status === 'available' && (
                  <button
                    className="transform__btn transform__btn--start"
                    onClick={(e) => handleEnterClick(e, t.id)}
                  >
                    Walcz
                  </button>
                )}
                {status === 'in_progress' && (
                  <button
                    className="transform__btn transform__btn--resume"
                    onClick={handleResumeQuest}
                  >
                    Kontynuuj
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // -- Manual skill use (click a slot when skillMode === 'manual') ----------
  const doManualSkill = useCallback((slotIdx: 0 | 1 | 2 | 3) => {
    if (phase !== 'fighting') return;
    // Stun gate — caster cannot cast while paralysed.
    if (isCombatantStunned(effectsRef.current, PLAYER_FX_ID)) return;
    const latestChar = useCharacterStore.getState().character;
    if (!latestChar) return;
    const eff = getEffectiveChar(latestChar, currentMonsterRef.current?.level ?? 0);
    if (!eff) return;
    const slots = useSkillStore.getState().activeSkillSlots;
    const skillId = slots[slotIdx];
    if (!skillId) return;
    const now = Date.now();
    const lastUsed = skillCooldownRef.current.get(skillId) ?? 0;
    // 2026-06-21: recast window scales with combat speed (see auto-cast note).
    if (now - lastUsed < getSpeedScaledCooldownMs(SKILL_COOLDOWN_MS, speedMultRef.current)) return;
    if (playerMpRef.current < SKILL_MP_COST) {
      addLog('Za mało MP!', 'system');
      return;
    }
    // 2026-05 v7: Apokalipsa Śmierci — synchronous self-cost.
    const sDefGateT = useSkillStore.getState().activeSkillSlots[slotIdx]
      ? getSkillDef(useSkillStore.getState().activeSkillSlots[slotIdx]!)
      : null;
    if ((sDefGateT?.effect ?? '').includes('death_apocalypse')) {
      const hpPctT = playerHpRef.current / Math.max(1, eff.max_hp);
      if (hpPctT < 0.05) {
        addLog(':broken-heart: Apokalipsa zablokowana: < 5% HP', 'system');
        return;
      }
      let newPlayerHp: number;
      if (hpPctT > 0.20) {
        newPlayerHp = Math.max(1, playerHpRef.current - Math.floor(eff.max_hp * 0.20));
      } else {
        newPlayerHp = Math.max(1, Math.floor(eff.max_hp * 0.03));
      }
      const lost = playerHpRef.current - newPlayerHp;
      if (lost > 0) {
        playerHpRef.current = newPlayerHp;
        setPlayerHp(newPlayerHp);
        useCharacterStore.getState().updateCharacter({ hp: newPlayerHp });
        fxRef.current.pushAllyFloat(0, lost, 'spell', { icon: 'broken-heart', label: `-${lost} HP` });
        addLog(`:broken-heart: Apokalipsa: -${lost} HP`, 'crit');
      }
    }

    // Manual skill targets whichever monster the auto-attack would currently
    // be hitting (first alive slot in 0->1->2->3 order). Without this, manual
    // casts always landed on slot 0 even after the Normal escort died.
    const escorts = escortSlotsRef.current;
    let targetSlot: 0 | 1 | 2 | 3 = 3;
    let targetName = currentMonsterRef.current?.name_pl ?? 'BOSS';
    let prevTargetHp = monsterHpRef.current;
    let isBossTarget = true;
    let targetMaxHp = currentMonsterRef.current?.hp ?? 1;
    for (let s = 0; s < 3; s++) {
      const e = escorts[s];
      if (e && e.currentHp > 0) {
        targetSlot = s as 0 | 1 | 2;
        targetName = e.monster.name_pl;
        prevTargetHp = e.currentHp;
        targetMaxHp = e.maxHp;
        isBossTarget = false;
        break;
      }
    }
    if (prevTargetHp <= 0) return;
    // Apply v2 effects (stun/dot/instant_kill/marks/etc.) against the
    // combined OPPONENT_FX_ID — Transform is 1v1 from the effect system's
    // POV (matches Boss behaviour).
    const sDef = getSkillDef(skillId);
    // 2026-05 v6: pure-buff branch + skill.damage scaling.
    const skillBaseMult = sDef?.damage ?? 1;
    const isPureBuff = skillBaseMult === 0;
    const targetHpPct = targetMaxHp > 0 ? (prevTargetHp / targetMaxHp) * 100 : 100;
    const apply = effectsCastSkill({
      session: effectsRef.current,
      casterId: PLAYER_FX_ID,
      targetId: OPPONENT_FX_ID,
      targetHpPct,
      effect: sDef?.effect ?? null,
      allyIds: [PLAYER_FX_ID],
      enemyIds: [OPPONENT_FX_ID],
    });
    // Skill-upgrade combat bonus — local player's own manual cast. Modest & capped.
    const skillUpgradeMultManual = getCombatSkillUpgradeMultiplier(
      useSkillStore.getState().skillUpgradeLevels[skillId] ?? 0,
    );
    const baseDmg = isPureBuff ? 0 : Math.max(
      1,
      Math.floor(eff.attack * 0.15 * skillBaseMult * getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier() * skillUpgradeMultManual),
    );
    const normalSkillDmgTfManual = Math.floor(baseDmg * apply.castDmgMult);
    let skillDmg = isPureBuff
      ? 0
      : (apply.instantKill
          ? Math.max(1, prevTargetHp)
          : ((apply.executeBurstPct ?? 0) > 0
              ? Math.max(normalSkillDmgTfManual, Math.floor(targetMaxHp * (apply.executeBurstPct ?? 0) / 100))
              : normalSkillDmgTfManual));
    // 2026-05 v7: manual spell cast consumes Klątwa Śmierci (count) AND
    // benefits from Kraina Śmierci (duration ×N) — same as basics.
    if (!isPureBuff && skillDmg > 0) {
      const oppStSpell = ensureStatus(effectsRef.current, OPPONENT_FX_ID);
      const ampSpell = consumeTargetMarkAmp(oppStSpell);
      if (ampSpell.mult !== 1) {
        skillDmg = Math.max(1, Math.floor(skillDmg * ampSpell.mult));
      }
    }
    // 2026-05 v7: Apokalipsa Śmierci — target damage only (self-cost
    // already paid synchronously at the top of doManualSkill).
    if (apply.deathApocalypse && latestChar.class === 'Necromancer') {
      const apocDmg = Math.max(1, Math.floor((targetMaxHp || prevTargetHp || 1) * (apply.deathApocalypseTargetMaxHpPct / 100)));
      skillDmg += apocDmg;
      fxRef.current.pushEnemyFloat(targetSlot, apocDmg, 'spell', { icon: 'skull-and-crossbones', label: 'APOKALIPSA', isCrit: true });
      addLog(`:skull-and-crossbones: Apokalipsa Śmierci: ${apocDmg} dmg`, 'crit');
    }
    const newTargetHp = isPureBuff ? prevTargetHp : Math.max(0, prevTargetHp - skillDmg);
    // 2026-06-24 AOE FIX: splash 75% of the skill damage to every OTHER alive
    // wave slot (escorts + boss) so area spells hit the whole transform wave,
    // not just the active target. The primary is applied below; the reactive
    // death effect handles kills + wave-clear.
    void apply.multistrike;
    if (apply.aoe && !isPureBuff && skillDmg > 0) {
      const splashDmg = Math.max(1, Math.floor(skillDmg * 0.75));
      const cur = escortSlotsRef.current.slice();
      let escortsTouched = false;
      for (let s = 0; s < 3; s++) {
        if (s === targetSlot) continue;
        const e = cur[s];
        if (!e || e.currentHp <= 0) continue;
        cur[s] = { ...e, currentHp: Math.max(0, e.currentHp - splashDmg) };
        escortsTouched = true;
        fxRef.current.pushEnemyFloat(s, splashDmg, 'spell', { icon: getSkillIcon(skillId) });
      }
      if (escortsTouched) {
        escortSlotsRef.current = cur;
        setEscortSlots(cur);
      }
      if (targetSlot !== 3 && monsterHpRef.current > 0) {
        const bossHp = Math.max(0, monsterHpRef.current - splashDmg);
        monsterHpRef.current = bossHp;
        setMonsterHp(bossHp);
        fxRef.current.pushEnemyFloat(3, splashDmg, 'spell', { icon: getSkillIcon(skillId) });
      }
    }
    // Necro summon spawn — only when the local player is a necro. Note:
    // Transform is a "you become the phoenix" view — but the underlying
    // class can still be Necromancer, so the summon stack still applies
    // (the player avatar is the necro icon with summon badges).
    if (apply.summons.length > 0 && latestChar.class === 'Necromancer') {
      const store = useNecroSummonStore.getState();
      for (const sm of apply.summons) {
        const spawned = store.spawn(PLAYER_FX_ID, sm.type, sm.count, eff.attack, eff.max_hp);
        if (spawned > 0) fxRef.current.triggerAllySummonSpawn(0, sm.type);
      }
    }

    if (isBossTarget) {
      monsterHpRef.current = newTargetHp;
      setMonsterHp(newTargetHp);
    } else {
      const cur = escortSlotsRef.current.slice();
      const e = cur[targetSlot as 0 | 1 | 2];
      if (e) {
        cur[targetSlot as 0 | 1 | 2] = { ...e, currentHp: newTargetHp };
        escortSlotsRef.current = cur;
        setEscortSlots(cur);
      }
    }

    const newMp = Math.max(0, playerMpRef.current - SKILL_MP_COST);
    playerMpRef.current = newMp;
    setPlayerMp(newMp);
    skillCooldownRef.current.set(skillId, now);
    setSkillCooldowns((prev) => ({ ...prev, [skillId]: SKILL_COOLDOWN_MS }));
    if (sDef) applySkillBuff(skillId, sDef, speedMult);
    triggerSkillAnim(skillId);
    if (isPureBuff) {
      fxRef.current.triggerAllySkillAnim(0, skillId);
      addLog(`:sparkles: ${formatSkillName(skillId)}: BUFF (-${SKILL_MP_COST} MP)`, 'crit');
    } else {
      fxRef.current.triggerEnemySkillAnim(targetSlot, skillId);
      fxRef.current.pushEnemyFloat(targetSlot, skillDmg, 'spell', { icon: getSkillIcon(skillId) });
      addLog(`:sparkles: ${formatSkillName(skillId)} -> ${targetName}: ${skillDmg} dmg (-${SKILL_MP_COST} MP)`, 'crit');
    }
    // 2026-05 v6: heal-on-cast also wired in the manual-cast path
    // (the auto-attack tick branch above handles it for auto). Without
    // this, manual Promień Pustki / Pochłonięcie Życia / Żniwa Dusz
    // never healed in transform — only the auto-attack mid-tick cast
    // did.
    if (apply.healCasterPctOfDmg > 0 && skillDmg > 0) {
      const heal = Math.floor(skillDmg * (apply.healCasterPctOfDmg / 100));
      const before = playerHpRef.current;
      playerHpRef.current = Math.min(eff.max_hp, playerHpRef.current + heal);
      setPlayerHp(playerHpRef.current);
      const actual = playerHpRef.current - before;
      if (heal > 0) {
        const cappedTag = actual < heal ? ' (MAX)' : '';
        fxRef.current.pushAllyFloat(0, heal, 'heal', {
          icon: 'sparkles',
          label: cappedTag ? `+${heal}${cappedTag}` : undefined,
        });
        addLog(`:sparkles: ${formatSkillName(skillId)}: +${heal} HP${cappedTag}`, 'crit');
      }
    }
    if (apply.healCasterPctOfMaxHp > 0) {
      const heal = Math.floor(eff.max_hp * (apply.healCasterPctOfMaxHp / 100));
      const before = playerHpRef.current;
      playerHpRef.current = Math.min(eff.max_hp, playerHpRef.current + heal);
      setPlayerHp(playerHpRef.current);
      const actual = playerHpRef.current - before;
      if (heal > 0) {
        const cappedTag = actual < heal ? ' (MAX)' : '';
        fxRef.current.pushAllyFloat(0, heal, 'heal', {
          icon: 'sparkles',
          label: cappedTag ? `+${heal}${cappedTag}` : undefined,
        });
      }
    }
    if (apply.healLowestAllyPct > 0) {
      const heal = Math.floor(eff.max_hp * (apply.healLowestAllyPct / 100));
      const before = playerHpRef.current;
      playerHpRef.current = Math.min(eff.max_hp, playerHpRef.current + heal);
      setPlayerHp(playerHpRef.current);
      const actual = playerHpRef.current - before;
      if (heal > 0) {
        const cappedTag = actual < heal ? ' (MAX)' : '';
        fxRef.current.pushAllyFloat(0, heal, 'heal', {
          icon: 'sparkles',
          label: cappedTag ? `+${heal}${cappedTag}` : undefined,
        });
        fxRef.current.triggerAllySkillAnim(0, skillId);
        addLog(`:sparkles: ${formatSkillName(skillId)}: +${heal} HP${cappedTag}`, 'crit');
      }
    }
    useSkillStore.getState().addMlvlXpFromSkill(latestChar.class);
    // `fx` intentionally NOT in deps — see fxRef comment. Same reasoning as
    // `startMonsterFight` above.
  }, [addLog, phase, triggerSkillAnim]);

  // -- Combat view (unified CombatUI) ---------------------------------------
  // Transform feeds into the same shared component tree as every other combat
  // view. Each transform monster is a boss-tier solo encounter, so we use the
  // shimmering daily-boss bg variant and show only one enemy slot + the player
  // ally slot (other slots stay empty placeholders so nothing reflows).
  const renderCombat = () => {
    if (!currentMonster) return null;
    if (!character) return null;

    const effChar = getEffectiveChar(character);
    const charMaxHp = effChar?.max_hp ?? 0;
    const charMaxMp = effChar?.max_mp ?? 0;

    // Quest progress (transform-specific — no other view counts "monsters in
    // a quest" this way, so it lives outside the shared CombatUI tree).
    const quest = useTransformStore.getState().currentTransformQuest;
    const allMonsters = getTransformMonsters(activeTransformId);
    const defeatedCount = quest?.monstersDefeated.length ?? 0;
    const tfColorInfo = getTransformColor(activeTransformId);
    const tfColor = tfColorInfo.solid ?? tfColorInfo.gradient?.[0] ?? '#ffc107';
    // Player avatar border reflects highest completed transform tier
    // (persistent identity). If the player has no completed transforms yet,
    // fall back to their class color — never to the active-quest color, which
    // would make first-time players appear in the color of a transform they
    // don't own.
    const highestCompleted = completedTransforms.length > 0 ? Math.max(...completedTransforms) : 0;
    const playerBorderColor = highestCompleted > 0
      ? (getTransformColor(highestCompleted).solid ?? getTransformColor(highestCompleted).gradient?.[0] ?? tfColor)
      : (CLASS_COLORS[character.class] ?? '#e94560');

    // Per-tier phoenix arena bg + matching hue. Hoisted ABOVE the uiEnemies
    // build so the boss-slot can use this same image as its sprite (instead of
    // falling back to a generic bestiary boss-N.png that doesn't exist for
    // most transform-tier levels).
    const arenaImageUrl = getTransformCardImage(activeTransformId);
    const arenaHue = hexToHue(tfColor);

    // -- Enemy slots (Normal / Strong / Epic / Boss = slots 0..3) ----------
    // The player auto-attack walks slots 0->1->2->3 in order, so only the first
    // alive slot shows the yellow target ring. Once a slot dies the next one
    // inherits the ring without any explicit retargeting click.
    const firstAliveSlot = (() => {
      for (let s = 0; s < 3; s++) {
        const e = escortSlots[s];
        if (e && e.currentHp > 0) return s;
      }
      return 3; // boss is always the last alive
    })();

    // Tier -> rarity mapping for the slot card backdrops. Normal/Strong/Epic
    // map to the matching dungeon-style rarity tints; Boss keeps its boss
    // gold/red treatment so the bottom-right tile still reads as a boss.
    const tierToRarity = (tier: 'Normal' | 'Strong' | 'Epic'): TMonsterRarity =>
      tier === 'Normal' ? 'normal'
      : tier === 'Strong' ? 'strong'
      : 'epic';

    const buildEscortEnemy = (slot: 0 | 1 | 2): ICombatEnemy | null => {
      const e = escortSlots[slot];
      if (!e) return null;
      return {
        id: e.monster.id,
        name: e.monster.name_pl,
        level: e.monster.level,
        sprite: e.monster.sprite ?? 'ogre',
        kind: 'monster' as const,
        // Use the pre-resolved sprite URL (captured from the original
        // template level before stamp rewrote it to bossLevel). This makes
        // each escort tile show the actual bestiary PNG for that monster
        // species — Wojownik Gnoll, Troll Bagienny, Ork Warlord, etc. —
        // instead of falling back to MonsterSprite's level-keyed lookup
        // which misses for T2/T3 transforms (boss levels 60+ have no
        // matching `monster-{level}.png` in the asset registry). When the
        // template's level also has no art, this is null and EnemyCard
        // routes to the emoji fallback exactly as before.
        imageUrl: e.imageUrl,
        currentHp: Math.max(0, e.currentHp),
        maxHp: e.maxHp,
        rarity: tierToRarity(e.tier),
        isDead: e.currentHp <= 0,
        isTargetedByPlayer: firstAliveSlot === slot,
        hitPulse: monsterHitPulses[slot] ?? 0,
        attackingClassName: playerAttacking && firstAliveSlot === slot ? `attack-${character.class}` : null,
        skillAnim: fx.enemySkill[slot] ?? null,
        floats: fx.enemyFloats[slot] ?? [],
      };
    };

    const uiEnemies: Array<ICombatEnemy | null> = [
      buildEscortEnemy(0),
      buildEscortEnemy(1),
      buildEscortEnemy(2),
      {
        id: currentMonster.id,
        name: currentMonster.name_pl,
        level: currentMonster.level,
        sprite: currentMonster.sprite ?? 'ogre',
        kind: 'boss' as const,
        // Use the per-tier phoenix card image as the boss sprite — overrides
        // the bestiary boss-N.png lookup so the bottom-right tile actually
        // shows the transform painting the player saw on the list view.
        imageUrl: arenaImageUrl ?? null,
        // Phoenix card art is composed to fill its portrait frame — `contain`
        // (the default for monster sprites) leaves visible empty bars top
        // and bottom that read as a layout bug, so the transform-only boss
        // slot opts into `cover` to fill the whole tile edge-to-edge.
        imageObjectFit: 'cover',
        currentHp: Math.max(0, monsterHp),
        maxHp: monsterMaxHp,
        rarity: 'boss',
        isDead: monsterHp <= 0,
        isTargetedByPlayer: firstAliveSlot === 3,
        // Per-attack pulse counter — every player swing / auto-skill cast
        // increments this so the boss card flashes on every distinct hit
        // even when two attacks land within the same 300ms window.
        hitPulse: monsterHitPulses[3] ?? 0,
        attackingClassName: playerAttacking && firstAliveSlot === 3 ? `attack-${character.class}` : null,
        // Per-slot themed skill animation + floating damage numbers
        skillAnim: fx.enemySkill[3] ?? null,
        floats: fx.enemyFloats[3] ?? [],
        // 2026-05 v7: live status countdowns on the transform boss —
        // :skull-and-crossbones: Klątwa Śmierci ×N · Ts and :skull: Mroczny Rytuał N% · Ts both
        // render so the player can time their burst window.
        statusOverlay: (() => {
          const st = effectsRef.current.statuses.get(OPPONENT_FX_ID);
          if (!st) return undefined;
          const top = st.markAmp.find((mm) => mm.count > 0 && mm.remainingMs > 0);
          const topRitual = st.darkRitualPending.length > 0
            ? st.darkRitualPending.reduce((a, b) => (a.triggerInMs <= b.triggerInMs ? a : b))
            : null;
          return {
            stunMs: st.stunMs,
            immortalMs: st.immortalMs,
            markHealToDmgMs: st.markNoHealMs,
            markAmpMs: top?.remainingMs,
            markAmpMult: top?.mult,
            darkRitualMs: topRitual?.triggerInMs,
            darkRitualPct: topRitual?.pctOfMaxHp,
            markAmpAllMs: st.markAmpAll?.remainingMs,
            markAmpAllMult: st.markAmpAll?.mult,
          };
        })(),
      },
    ];

    // -- Ally slots (player only — solo fight; pad to 4) --------------------
    const playerSummonList = necroSummons[PLAYER_FX_ID] ?? [];
    const playerSummonsByType: Partial<Record<'skeleton' | 'ghost' | 'demon' | 'lich', number>> = {};
    for (const sm of playerSummonList) {
      playerSummonsByType[sm.type] = (playerSummonsByType[sm.type] ?? 0) + 1;
    }
    const SUMMON_RANK_T = { skeleton: 0, ghost: 1, demon: 2, lich: 3 } as const;
    const SUMMON_LABELS_T: Record<'skeleton' | 'ghost' | 'demon' | 'lich', string> = {
      skeleton: 'Szkielet', ghost: 'Duch', demon: 'Demon', lich: 'Lisz',
    };
    const frontSummonT = playerSummonList.length > 0
      ? [...playerSummonList].sort((a, b) => SUMMON_RANK_T[a.type] - SUMMON_RANK_T[b.type])[0]
      : null;
    const playerNameT = (character.class === 'Necromancer' && frontSummonT)
      ? SUMMON_LABELS_T[frontSummonT.type]
      : character.name;
    const playerAvatarT = (character.class === 'Necromancer' && frontSummonT)
      ? (getSummonImage(frontSummonT.type) ?? getCharacterAvatar(character.class, completedTransforms))
      : getCharacterAvatar(character.class, completedTransforms);
    const playerCurHpT = (character.class === 'Necromancer' && frontSummonT)
      ? frontSummonT.hp
      : Math.max(0, playerHp);
    const playerMaxHpT = (character.class === 'Necromancer' && frontSummonT)
      ? frontSummonT.maxHp
      : charMaxHp;
    const playerCurMpT = (character.class === 'Necromancer' && frontSummonT)
      ? frontSummonT.mp
      : Math.max(0, playerMp);
    const playerMaxMpT = (character.class === 'Necromancer' && frontSummonT)
      ? frontSummonT.maxMp
      : charMaxMp;
    const uiAllies: Array<ICombatAlly | null> = [
      {
        id: 'player',
        name: playerNameT,
        avatarUrl: playerAvatarT,
        accentColor: playerBorderColor,
        className: character.class,
        currentHp: playerCurHpT,
        maxHp: playerMaxHpT,
        currentMp: playerCurMpT,
        maxMp: playerMaxMpT,
        isDead: playerHp <= 0,
        isPlayer: true,
        level: character.level,
        summonCount: playerSummonList.length,
        summonsByType: playerSummonsByType,
        onSummonClick: (type) => {
            useNecroSummonStore.getState().despawnOne(PLAYER_FX_ID, type);
            addLog(`:dashing-away: Odesłano: ${type}`, 'system');
        },
        // Solo fight — the one boss is always aggro'd onto the player.
        aggroCount: 1,
        // Per-attack pulse counter — every boss swing increments it so the
        // player's flash overlay re-mounts (replays the CSS animation) even
        // when the boss is attacking faster than the 300ms flash duration.
        hitPulse: playerHitPulse,
        attackingClassName: null,
        transformTier: highestCompleted || undefined,
        // Skill animations don't currently target allies in transform fights
        // (boss has no aimed spells), but we still bind a slot for future-proof
        // parity with the other views.
        skillAnim: fx.allySkill[0] ?? null,
        floats: fx.allyFloats[0] ?? [],
        summonSpawn: fx.allySummonSpawn[0] ?? null,
      },
      null, null, null,
    ];

    // -- Skill slots (4 active slots — pad nulls for empty) ----------------
    const uiSkills: Array<ICombatSkillSlot | null> =
      (activeSkillSlots as (string | null)[]).map((skillId, i) => {
        if (!skillId) return null;
        const cdRemaining = skillCooldowns[skillId] ?? 0;
        const cdActive = cdRemaining > 0;
        const noMp = playerMp < SKILL_MP_COST;
        return {
          id: skillId,
          icon: getSkillIcon(skillId),
          name: skillId,
          mpCost: SKILL_MP_COST,
          cooldownProgress: cdActive ? 1 - cdRemaining / SKILL_COOLDOWN_MS : 1,
          cooldownRemainingMs: cdRemaining,
          disabled: skillMode === 'auto' || noMp || cdActive,
          onClick: () => doManualSkill(i as 0 | 1 | 2 | 3),
        };
      });

    // -- Potion slots ------------------------------------------------------
    const bestHpPotion    = resolveAutoPotionElixir(autoPotionHpId,    'hp', 'flat', consumables, character?.level ?? 1) ?? getBestPotion(hpPotions,    consumables, character?.level ?? 1);
    const bestMpPotion    = resolveAutoPotionElixir(autoPotionMpId,    'mp', 'flat', consumables, character?.level ?? 1) ?? getBestPotion(mpPotions,    consumables, character?.level ?? 1);
    const bestPctHpPotion = resolveAutoPotionElixir(autoPotionPctHpId, 'hp', 'pct',  consumables, character?.level ?? 1) ?? getBestPotion(pctHpPotions, consumables, character?.level ?? 1);
    const bestPctMpPotion = resolveAutoPotionElixir(autoPotionPctMpId, 'mp', 'pct',  consumables, character?.level ?? 1) ?? getBestPotion(pctMpPotions, consumables, character?.level ?? 1);

    const buildPotion = (
      potion: typeof bestPctHpPotion,
      kind: ICombatPotionSlot['kind'],
      cd: number,
      cdMax: number,
    ): ICombatPotionSlot | null => {
      if (!potion) return null;
      const count = consumables[potion.id] ?? 0;
      const cdActive = cd > 0;
      return {
        kind,
        // 2026-05: dock shows the actual selected potion's PNG art.
        icon: getPotionImage(potion.id) ?? undefined,
        count,
        cooldownProgress: cdActive ? 1 - cd / cdMax : 1,
        cooldownRemainingMs: cdActive ? cd : 0,
        disabled: count === 0 || cdActive,
        onClick: () => doUsePotion(potion.id),
      };
    };
    const pctHpSlot  = buildPotion(bestPctHpPotion, 'pct-hp', pctHpCooldown, PCT_POTION_CD_MS);
    const pctMpSlot  = buildPotion(bestPctMpPotion, 'pct-mp', pctMpCooldown, PCT_POTION_CD_MS);
    const flatHpSlot = buildPotion(bestHpPotion,    'hp',     hpPotionCooldown, POTION_COOLDOWN_MS);
    const flatMpSlot = buildPotion(bestMpPotion,    'mp',     mpPotionCooldown, POTION_COOLDOWN_MS);

    const autoPotOn = autoPotionHpEnabled || autoPotionMpEnabled;
    const toggleAutoPot = () => {
      const next = !autoPotOn;
      useSettingsStore.getState().setAutoPotionHpEnabled(next);
      useSettingsStore.getState().setAutoPotionMpEnabled(next);
    };

    return (
      <div
        className="transform__combat"
        style={{
          '--transform-color': tfColor,
          '--transform-hue': arenaHue,
          ...(arenaImageUrl ? { '--arena-image': `url("${arenaImageUrl}")` } : null),
        } as React.CSSProperties}
      >
        <CombatHudHost active={phase === 'fighting'} accent={tfColor} compact>
          <div className="combat-ui">
            <CombatTopControls
              speed={{ label: speedMode, onCycle: cycleSpeed }}
              autoSkill={{
                on: skillMode === 'auto',
                onToggle: () =>
                  setSkillMode(skillMode === 'auto' ? 'manual' : 'auto'),
              }}
              autoPotion={{ on: autoPotOn, onToggle: toggleAutoPot }}
            />

            {/* Spawn-timer bar — visible only between monsters while the
                next one is about to appear. Same slim under-header pin as
                hunting auto-fight + dungeon / raid spawn timers so the
                player learns one cue: thin bar = "incoming". */}
            {waitingForSpawn && (
              <div
                className="combat-ui__spawn-bar"
                aria-label="Następny potwór za chwilę"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(spawnProgress * 100)}
              >
                <span
                  className="combat-ui__spawn-bar-fill"
                  style={{ width: `${spawnProgress * 100}%` }}
                />
              </div>
            )}

            {/* Quest progress banner — same visual slot as Dungeon/Raid
                wave counters so the three view families feel unified. Each
                4-monster wave counts as ONE bossDefeat tally entry, so the
                "Fala N/30" reads naturally to the player as wave count. */}
            <div className="combat-ui__wave-banner" aria-live="polite">
              <span className="combat-ui__wave-banner-label">Fala</span>
              <span className="combat-ui__wave-banner-value">
                {defeatedCount + 1}/{allMonsters.length}
              </span>
            </div>

            <CombatArena
              enemies={uiEnemies}
              allies={uiAllies}
              bgVariant={arenaImageUrl ? 'transform' : 'daily-boss'}
              /* Per-slot animation only — see Combat.tsx note. */
              overlay={null}
            />

            <CombatSubControls xp={null} />

            <CombatPotionDock
              hpPotion={flatHpSlot}
              pctHpPotion={pctHpSlot}
              mpPotion={flatMpSlot}
              pctMpPotion={pctMpSlot}
            />

            <CombatActionBar
              skills={uiSkills}
              exit={{
                kind: 'flee',
                onFlee: handleAbandon, // applies flee penalty + clears session
              }}
            />
          </div>
        </CombatHudHost>

        {/* Point N6: explicit claim overlay — only rendered when all monsters
            are defeated. Absolutely positioned over the combat area so it
            never shifts layout. */}
        <AnimatePresence>
          {victoryReady && (
            <motion.div
              key="victory-overlay"
              className="transform__victory-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <motion.div
                className="transform__victory-panel"
                initial={{ scale: 0.6, y: 30 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.8, y: 20 }}
                transition={{ type: 'spring', stiffness: 220, damping: 18 }}
              >
                <h2 className="transform__victory-panel-title">Zwyciestwo!</h2>
                <p className="transform__victory-panel-subtitle">
                  Wszystkie potwory pokonane. Zgarnij permanentne bonusy lub wroc do miasta.
                </p>
                <div className="transform__victory-panel-actions">
                  <button
                    className="transform__btn transform__btn--claim"
                    onClick={handleClaimVictory}
                  >
                    Zgarnij nagrody
                  </button>
                  <button
                    className="transform__btn transform__btn--abandon"
                    onClick={handleAbandon}
                  >
                    Wroc do miasta
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  // -- All defeated / rewards view --------------------------------------------
  const renderAllDefeated = () => {
    if (!character) return null;
    const colorInfo = getTransformColor(activeTransformId);
    const transformData = getTransformById(activeTransformId);
    const rewardLines: { label: string; value: string; icon: string }[] = rewards
      ? [
          { icon: 'crossed-swords', label: 'Damage',   value: `+${rewards.permanentBonuses.dmgPercent}%` },
          { icon: 'red-heart', label: 'Max HP',   value: `+${rewards.permanentBonuses.hpPercent}% · +${rewards.permanentBonuses.flatHp}` },
          { icon: 'crystal-ball', label: 'Max MP',   value: `+${rewards.permanentBonuses.mpPercent}% · +${rewards.permanentBonuses.flatMp}` },
          { icon: 'flexed-biceps', label: 'Attack',   value: `+${rewards.permanentBonuses.attack}` },
          { icon: 'shield', label: 'Defense',  value: `+${rewards.permanentBonuses.defPercent}% · +${rewards.permanentBonuses.defense}` },
          { icon: 'green-heart', label: 'HP Regen', value: `+${rewards.permanentBonuses.hpRegenFlat.toFixed(1)}/s` },
          { icon: 'blue-heart', label: 'MP Regen', value: `+${rewards.permanentBonuses.mpRegenFlat.toFixed(1)}/s` },
        ]
      : [];

    return (
      <div className="transform__victory">
        <motion.h2
          className="transform__victory-title"
          initial={{ opacity: 0, scale: 0.5, y: -40 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 140, damping: 12 }}
        >
          <GameIcon name="star" /> Zwyciestwo! <GameIcon name="star" />
        </motion.h2>
        <motion.p
          className="transform__victory-subtitle"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          Wszystkie potwory pokonane dla {transformData?.[nameKey] ?? `Transform ${activeTransformId}`}!
        </motion.p>

        {!rewards && (
          <motion.button
            className="transform__btn transform__btn--rewards"
            onClick={handleShowRewards}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.6, type: 'spring', stiffness: 200, damping: 15 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <GameIcon name="sparkles" /> Pokaz nagrody <GameIcon name="sparkles" />
          </motion.button>
        )}

        {rewards && !showTransformAnimation && (
          <motion.div
            className="transform__rewards"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            style={{
              '--tf-color1': colorInfo.solid ?? colorInfo.gradient?.[0] ?? '#ffc107',
              '--tf-color2': colorInfo.gradient?.[1] ?? colorInfo.solid ?? '#ffc107',
            } as React.CSSProperties}
          >
            {/* Glow halo behind the reward card */}
            <motion.div
              className="transform__rewards-halo"
              initial={{ scale: 0.2, opacity: 0 }}
              animate={{ scale: 1, opacity: 0.6 }}
              transition={{ duration: 0.8, delay: 0.1 }}
            />
            <motion.h3
              className="transform__rewards-title"
              initial={{ opacity: 0, letterSpacing: '-0.2em' }}
              animate={{ opacity: 1, letterSpacing: '0.1em' }}
              transition={{ duration: 0.6 }}
            >
              <GameIcon name="trophy" /> Nagrody Permanentne <GameIcon name="trophy" />
            </motion.h3>
            <div className="transform__rewards-list">
              {rewardLines.map((line, idx) => (
                <motion.div
                  key={line.label}
                  className="transform__reward-item"
                  initial={{ opacity: 0, x: -30, scale: 0.9 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={{
                    delay: 0.2 + idx * 0.08,
                    type: 'spring',
                    stiffness: 180,
                    damping: 14,
                  }}
                >
                  <span className="transform__reward-icon"><TinyIcon icon={line.icon} /></span>
                  <span className="transform__reward-label">{line.label}</span>
                  <span className="transform__reward-value">{line.value}</span>
                </motion.div>
              ))}
              {rewards.weapon && (
                <motion.div
                  className="transform__reward-item transform__reward-item--weapon"
                  initial={{ opacity: 0, scale: 0.6, rotate: -5 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  transition={{
                    delay: 0.2 + rewardLines.length * 0.08,
                    type: 'spring',
                    stiffness: 160,
                    damping: 10,
                  }}
                >
                  <span className="transform__reward-icon"><GameIcon name="dagger" /></span>
                  <span className="transform__reward-label">Mythic Weapon</span>
                  <span className="transform__reward-value">{getItemDisplayInfo(rewards.weapon.itemId)?.[nameKey]}</span>
                </motion.div>
              )}
              {rewards.consumables.map((c, cidx) => (
                <motion.div
                  key={c.id}
                  className="transform__reward-item"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + (rewardLines.length + cidx) * 0.08, duration: 0.4 }}
                >
                  <span className="transform__reward-icon"><GameIcon name="wrapped-gift" /></span>
                  <span className="transform__reward-label">{c.id.replace(/_/g, ' ')}</span>
                  <span className="transform__reward-value">x{c.count}</span>
                </motion.div>
              ))}
            </div>

            <motion.button
              className="transform__btn transform__btn--transform"
              onClick={handleTransformClick}
              style={{ background: colorInfo.css }}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                delay: 0.4 + rewardLines.length * 0.08,
                type: 'spring',
                stiffness: 160,
                damping: 12,
              }}
              whileHover={{ scale: 1.06, boxShadow: '0 0 32px var(--tf-color1)' }}
              whileTap={{ scale: 0.95 }}
            >
              <GameIcon name="sparkles" /> TRANSFORMUJ SIE <GameIcon name="sparkles" />
            </motion.button>
          </motion.div>
        )}

        {/* Transform animation overlay */}
        <AnimatePresence>
          {showTransformAnimation && (
            <motion.div
              className="transform__animation-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                '--tf-color1': colorInfo.solid ?? colorInfo.gradient?.[0] ?? '#ffc107',
                '--tf-color2': colorInfo.gradient?.[1] ?? colorInfo.solid ?? '#ffc107',
              } as React.CSSProperties}
            >
              {/* Rotating border */}
              <div className="transform__animation-border" />

              {/* Diagonal sweep background */}
              <div className="transform__animation-sweep" />

              {/* Particle effects */}
              <div className="transform__particles">
                {Array.from({ length: 20 }).map((_, i) => (
                  <div
                    key={i}
                    className="transform__particle"
                    style={{
                      '--delay': `${Math.random() * 2}s`,
                      '--x': `${Math.random() * 100}%`,
                      '--y': `${Math.random() * 100}%`,
                      '--size': `${4 + Math.random() * 8}px`,
                    } as React.CSSProperties}
                  />
                ))}
              </div>

              {/* Fullscreen avatar reveal after 3 seconds */}
              <AnimatePresence>
                {showFullscreenAvatar && (
                  <motion.div
                    className="transform__fullscreen-avatar"
                    initial={{ scale: 0, opacity: 0, rotate: -10 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 80, damping: 12, duration: 0.8 }}
                  >
                    <img
                      src={getTransformAvatarImage(character.class, activeTransformId)}
                      alt={`Transform ${activeTransformId}`}
                      className="transform__fullscreen-avatar-img"
                    />
                    <motion.h1
                      className="transform__congratulations"
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5, duration: 0.6 }}
                    >
                      Gratulacje!
                    </motion.h1>
                    <motion.div
                      className="transform__bonuses-summary"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.8, duration: 0.6 }}
                    >
                      {rewards && (
                        <>
                          <span>+{rewards.permanentBonuses.dmgPercent}% DMG</span>
                          <span>+{rewards.permanentBonuses.hpPercent}% HP +{rewards.permanentBonuses.flatHp}</span>
                          <span>+{rewards.permanentBonuses.mpPercent}% MP +{rewards.permanentBonuses.flatMp}</span>
                          <span>+{rewards.permanentBonuses.attack} ATK</span>
                          <span>+{rewards.permanentBonuses.defPercent}% +{rewards.permanentBonuses.defense} DEF</span>
                          <span>+{rewards.permanentBonuses.hpRegenFlat.toFixed(1)} HP/s</span>
                          <span>+{rewards.permanentBonuses.mpRegenFlat.toFixed(1)} MP/s</span>
                        </>
                      )}
                    </motion.div>
                    <motion.button
                      className="transform__btn transform__btn--continue"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 1.2, duration: 0.4 }}
                      onClick={handleCompleteTransform}
                    >
                      Kontynuuj
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  // -- Complete view ----------------------------------------------------------
  const renderComplete = () => {
    if (!character) return null;
    const colorInfo = getTransformColor(activeTransformId);
    return (
      <div className="transform__complete">
        <div className="transform__complete-avatar">
          <img
            src={getTransformAvatarImage(character.class, activeTransformId)}
            alt={`Transform ${activeTransformId}`}
          />
        </div>
        <h2 className="transform__complete-title" style={{ color: colorInfo.solid ?? colorInfo.gradient?.[0] ?? '#ffc107' }}>
          Transformacja {activeTransformId} ukonczona!
        </h2>
        <p className="transform__complete-text">
          Twoj avatar zostal zmieniony. Bonusy zostaly dodane do postaci.
        </p>
        {/* Themed return-to-town button. Inline CSS vars carry the transform's
            per-tier colour into `&--town` (matches the same `--transform-color`
            / `--transform-gradient` pattern that `&--start` consumes on the
            list view, so the visual language is consistent). The label changed
            from "Wroc do listy" to "Wroc do miasta" — the handler now routes
            to `/` (town hub) instead of just resetting in-view phase state. */}
        <button
          className="transform__btn transform__btn--town"
          onClick={handleReturn}
          style={{
            '--transform-color': colorInfo.solid ?? colorInfo.gradient?.[0] ?? '#ffc107',
            '--transform-gradient': colorInfo.css,
          } as React.CSSProperties}
        >
          Wroc do miasta
        </button>
      </div>
    );
  };

  // -- Main render ------------------------------------------------------------

  // Guard placed AFTER every hook in this component so we never alter hook
  // call order between renders (Rules of Hooks). Render helpers above are
  // closures — they don't execute until invoked from the JSX below, so an
  // early bail-out here keeps them safely dormant when `character` is null.
  if (!character) {
    return <div className="transform"><p>Brak postaci.</p></div>;
  }

  return (
    <div className={`transform${phase === 'fighting' ? ' transform--fighting' : ''}`}>
      {/* List remains rendered during 'entering' so the morph anchors to a
          live card behind the overlay (fade-out feels grounded instead of
          starting from black). The overlay sits at z-index 9000 above
          everything else. */}
      {(phase === 'list' || phase === 'entering') && renderList()}
      {phase === 'fighting' && renderCombat()}
      {phase === 'allDefeated' && renderAllDefeated()}
      {(phase === 'transforming' || phase === 'complete') && renderComplete()}

      {/* -- Cinematic entry overlay -----------------------------------------
          Three layers (z-index ladder inside the overlay):
            1 — phoenix image, morphs from card rect -> fullscreen + soft zoom
            2 — black panel, fades 0->1->1->0 (peaks at 33%, lifts at 67%)
            3 — "kliknij aby pominąć" hint, surfaces during the dark hold
          The wrapper itself owns the click -> skip handler. */}
      <AnimatePresence>
        {enterAnim && (
          <motion.div
            key={`transform-enter-${enterAnim.transformId}`}
            className="transform__enter-overlay"
            onClick={skipEntryAnimation}
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.18, ease: 'linear' } }}
          >
            <motion.div
              className="transform__enter-image"
              initial={{
                top: enterAnim.y,
                left: enterAnim.x,
                width: enterAnim.w,
                height: enterAnim.h,
                borderRadius: 12,
                scale: 1,
                opacity: 1,
              }}
              animate={{
                top: 0,
                left: 0,
                width: '100vw',
                height: '100dvh',
                borderRadius: 0,
                scale: 1.06,
                opacity: [1, 1, 0, 0],
              }}
              transition={{
                top:          { duration: 0.66, ease: [0.22, 0.61, 0.36, 1] },
                left:         { duration: 0.66, ease: [0.22, 0.61, 0.36, 1] },
                width:        { duration: 0.66, ease: [0.22, 0.61, 0.36, 1] },
                height:       { duration: 0.66, ease: [0.22, 0.61, 0.36, 1] },
                borderRadius: { duration: 0.66, ease: [0.22, 0.61, 0.36, 1] },
                scale:        { duration: 2.0, ease: 'linear' },
                opacity:      { duration: 2.0, times: [0, 0.3, 0.36, 1], ease: 'linear' },
              }}
              style={{
                '--card-hue': enterAnim.hue,
                '--card-image': enterAnim.image
                  ? `url("${enterAnim.image}")`
                  : 'none',
              } as React.CSSProperties}
            />

            <motion.div
              className="transform__enter-darkness"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 1, 0] }}
              transition={{
                duration: 2.0,
                times: [0, 0.33, 0.67, 1],
                ease: 'easeInOut',
              }}
            />

            <motion.div
              className="transform__enter-skip-hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0, 1, 1, 0, 0] }}
              transition={{
                duration: 2.0,
                times: [0, 0.2, 0.35, 0.55, 0.67, 1],
                ease: 'linear',
              }}
            >
              kliknij aby pominąć
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Transform;
