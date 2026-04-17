import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useSkillStore } from '../../stores/skillStore';
import { useTransformStore } from '../../stores/transformStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { saveCurrentCharacterStores } from '../../stores/characterScope';
import { applyDeathPenalty } from '../../systems/levelSystem';
import { applySkillBuff, getSkillDef } from '../../systems/skillBuffs';
import { useSkillAnim } from '../../hooks/useSkillAnim';
import { resolveAutoPotionElixir } from '../../systems/potionSystem';
import { CLASS_COLORS } from '../../systems/itemSystem';
import { deathsApi } from '../../api/v1/deathsApi';
import {
  calculateDamage,
  calculateDualWieldDamage,
  calculateBlockChance,
  calculateDodgeChance,
  calculateAttackInterval,
  rollMonsterDamage,
} from '../../systems/combat';
import {
  getClassSkillBonus,
  getTotalEquipmentStats,
  flattenItemsData,
  type IBaseItem,
} from '../../systems/itemSystem';
import { getTrainingBonuses } from '../../systems/skillSystem';
import {
  getAtkDamageMultiplier,
  getSpellDamageMultiplier,
  getElixirHpBonus,
  getElixirMpBonus,
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
  type ITransformData,
  type ITransformColor,
  type ITransformRewards,
} from '../../systems/transformSystem';
import { getCharacterAvatar } from '../../data/classAvatars';
import type { IMonster } from '../../types/monster';
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
import './Transform.scss';

// ── Constants ──────────────────────────────────────────────────────────────────

const CLASS_ICONS: Record<string, string> = {
  Knight: '⚔️', Mage: '🔮', Cleric: '✨', Archer: '🏹',
  Rogue: '🗡️', Necromancer: '💀', Bard: '🎵',
};

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

const ALL_ITEMS = flattenItemsData(itemsData as Record<string, IBaseItem[]>);

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

const CLASS_AVATAR_IMAGES: Record<string, string> = {
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
) => {
  const reversed = [...potions].reverse();
  return reversed.find((e) => (consumables[e.id] ?? 0) > 0) ?? reversed[0] ?? null;
};

const getPotionLabel = (effect: string): string => {
  const flatMatch = effect.match(/^heal_(hp|mp)_(\d+)$/);
  if (flatMatch) return `+${flatMatch[2]} ${flatMatch[1].toUpperCase()}`;
  const pctMatch = effect.match(/^heal_(hp|mp)_pct_(\d+)$/);
  if (pctMatch) return `+${pctMatch[2]}% ${pctMatch[1].toUpperCase()}`;
  return effect;
};

/** Get the avatar image for a class + transform number. */
const getTransformAvatarImage = (cls: string, transformNumber: number): string => {
  return TRANSFORM_AVATARS[cls]?.[transformNumber] ?? BASE_AVATAR_IMAGES[cls] ?? mageImg;
};

// ── Combat log entry ─────────────────────────────────────────────────────────

interface ICombatLogEntry {
  id: number;
  text: string;
  type: 'player' | 'monster' | 'crit' | 'system' | 'block' | 'dodge' | 'dualwield';
}

let _logId = 0;

// ── Phases ──────────────────────────────────────────────────────────────────

type ScreenPhase = 'list' | 'fighting' | 'allDefeated' | 'transforming' | 'complete';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

const getEffectiveChar = (char: ReturnType<typeof useCharacterStore.getState>['character']) => {
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
  const rawAttack = char.attack + eq.attack + getElixirAtkBonus() + getTransformFlatAttack();
  return {
    ...char,
    attack: Math.floor(rawAttack * getTransformAtkPctMultiplier()),
    defense: Math.floor(rawDefense * getTransformDefPctMultiplier()),
    max_hp: Math.floor(rawMaxHp * getTransformHpPctMultiplier()),
    max_mp: Math.floor(rawMaxMp * getTransformMpPctMultiplier()),
    attack_speed: baseAttackSpeed * getElixirAttackSpeedMultiplier(),
    crit_chance: Math.min(0.5, char.crit_chance + eq.critChance * 0.01 + tb.crit_chance),
    crit_damage: (char.crit_damage ?? 2.0) + eq.critDmg * 0.01 + tb.crit_dmg,
    hp_regen: (char.hp_regen ?? 0) + tb.hp_regen + getTransformHpRegenFlat(),
    mp_regen: (char.mp_regen ?? 0) + getTransformMpRegenFlat(),
  };
};

const getAttackMs = (speed: number): number =>
  Math.max(500, Math.floor(3000 / Math.max(1, speed || 1)));

// ── Component ────────────────────────────────────────────────────────────────

const Transform = () => {
  const navigate = useNavigate();
  const character = useCharacterStore((s) => s.character);
  const { language } = useSettingsStore();
  const completedTransforms = useTransformStore((s) => s.completedTransforms);
  const currentQuest = useTransformStore((s) => s.currentTransformQuest);
  const consumables = useInventoryStore((s) => s.consumables);
  const { activeSkillSlots } = useSkillStore();
  const { skillMode, setSkillMode, autoPotionHpEnabled, autoPotionMpEnabled } = useSettingsStore();

  // Screen phase
  const [phase, setPhase] = useState<ScreenPhase>('list');

  // Combat state
  const [currentMonster, setCurrentMonster] = useState<IMonster | null>(null);
  const [monsterHp, setMonsterHp] = useState(0);
  const [monsterMaxHp, setMonsterMaxHp] = useState(0);
  const [playerHp, setPlayerHp] = useState(0);
  const [playerMp, setPlayerMp] = useState(0);
  const [combatLog, setCombatLog] = useState<ICombatLogEntry[]>([]);
  const [monsterHit, setMonsterHit] = useState(false);
  const [playerHit, setPlayerHit] = useState(false);
  const [playerAttacking, setPlayerAttacking] = useState(false);

  // Skill & potion state
  const [skillCooldowns, setSkillCooldowns] = useState<Record<string, number>>({});
  const [hpPotionCooldown, setHpPotionCooldown] = useState(0);
  const [mpPotionCooldown, setMpPotionCooldown] = useState(0);
  const [pctHpCooldown, setPctHpCooldown] = useState(0);
  const [pctMpCooldown, setPctMpCooldown] = useState(0);

  // Skill animation overlay
  const { overlay: skillAnimOverlay, trigger: triggerSkillAnim } = useSkillAnim();

  // Speed mode (x1 / x2 / x4, no SKIP)
  const [speedMode, setSpeedMode] = useState<'x1' | 'x2' | 'x4'>('x1');
  const speedMult = speedMode === 'x4' ? 4 : speedMode === 'x2' ? 2 : 1;
  const speedMultRef = useRef(1);
  useEffect(() => { speedMultRef.current = speedMult; }, [speedMult]);
  const cycleSpeed = useCallback(() => {
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
  const skillCooldownRef = useRef<Map<string, number>>(new Map());
  const hpPotionCooldownRef = useRef(0);
  const mpPotionCooldownRef = useRef(0);
  const pctHpCooldownRef = useRef(0);
  const pctMpCooldownRef = useRef(0);
  const tryAutoPotionRef = useRef<() => void>(() => {});

  const allTransforms = useMemo(() => getAllTransforms(), []);

  // ── Cleanup timers ──────────────────────────────────────────────────────────
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

  // Auto-scroll combat log
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [combatLog]);

  // Keep HP/MP refs in sync with state
  useEffect(() => { playerHpRef.current = playerHp; }, [playerHp]);
  useEffect(() => { playerMpRef.current = playerMp; }, [playerMp]);

  // ── Cooldown tick (100ms, scaled by speedMult) ───────────────────────────
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

  // ── Add log helper ──────────────────────────────────────────────────────────
  const addLog = useCallback((text: string, type: ICombatLogEntry['type']) => {
    setCombatLog((prev) => [...prev.slice(-49), { id: _logId++, text, type }]);
  }, []);

  // ── Heal / cooldown helpers ─────────────────────────────────────────────
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

  // ── Auto-potion helper ──────────────────────────────────────────────────
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

    const hpPct = charMaxHp > 0 ? (hp / charMaxHp) * 100 : 100;
    if (settings.autoPotionHpEnabled && settings.autoPotionHpThreshold > 0 && hpPct <= settings.autoPotionHpThreshold && hpPotionCooldownRef.current <= 0) {
      const elixir = resolveAutoPotionElixir(settings.autoPotionHpId, 'hp', 'flat', inv.consumables);
      if (elixir) {
        inv.useConsumable(elixir.id);
        startHpCooldown();
        const flatMatch = elixir.effect.match(/^heal_hp_(\d+)$/);
        const pctMatch = elixir.effect.match(/^heal_hp_pct_(\d+)$/);
        if (flatMatch) { const a = parseInt(flatMatch[1], 10); healPlayerHp(a, charMaxHp); addLog(`[Auto] ${elixir.name_pl} +${a} HP`, 'system'); }
        else if (pctMatch) { const p = parseInt(pctMatch[1], 10); const a = Math.floor(charMaxHp * p / 100); healPlayerHp(a, charMaxHp); addLog(`[Auto] ${elixir.name_pl} +${a} HP`, 'system'); }
      }
    }

    const mpPct = charMaxMp > 0 ? (mp / charMaxMp) * 100 : 100;
    if (settings.autoPotionMpEnabled && settings.autoPotionMpThreshold > 0 && mpPct <= settings.autoPotionMpThreshold && mpPotionCooldownRef.current <= 0) {
      const elixir = resolveAutoPotionElixir(settings.autoPotionMpId, 'mp', 'flat', inv.consumables);
      if (elixir) {
        inv.useConsumable(elixir.id);
        startMpCooldown();
        const flatMatch = elixir.effect.match(/^heal_mp_(\d+)$/);
        const pctMatch = elixir.effect.match(/^heal_mp_pct_(\d+)$/);
        if (flatMatch) { const a = parseInt(flatMatch[1], 10); healPlayerMp(a, charMaxMp); addLog(`[Auto] ${elixir.name_pl} +${a} MP`, 'system'); }
        else if (pctMatch) { const p = parseInt(pctMatch[1], 10); const a = Math.floor(charMaxMp * p / 100); healPlayerMp(a, charMaxMp); addLog(`[Auto] ${elixir.name_pl} +${a} MP`, 'system'); }
      }
    }

    if (settings.autoPotionPctHpEnabled && settings.autoPotionPctHpThreshold > 0 && hpPct <= settings.autoPotionPctHpThreshold && pctHpCooldownRef.current <= 0) {
      const elixir = resolveAutoPotionElixir(settings.autoPotionPctHpId, 'hp', 'pct', inv.consumables);
      if (elixir) {
        inv.useConsumable(elixir.id);
        setPctHpCooldown(PCT_POTION_CD_MS); pctHpCooldownRef.current = PCT_POTION_CD_MS;
        const pctMatch = elixir.effect.match(/^heal_hp_pct_(\d+)$/);
        if (pctMatch) { const p = parseInt(pctMatch[1], 10); const a = Math.floor(charMaxHp * p / 100); healPlayerHp(a, charMaxHp); addLog(`[Auto%] ${elixir.name_pl} +${a} HP`, 'system'); }
      }
    }
    if (settings.autoPotionPctMpEnabled && settings.autoPotionPctMpThreshold > 0 && mpPct <= settings.autoPotionPctMpThreshold && pctMpCooldownRef.current <= 0) {
      const elixir = resolveAutoPotionElixir(settings.autoPotionPctMpId, 'mp', 'pct', inv.consumables);
      if (elixir) {
        inv.useConsumable(elixir.id);
        setPctMpCooldown(PCT_POTION_CD_MS); pctMpCooldownRef.current = PCT_POTION_CD_MS;
        const pctMatch = elixir.effect.match(/^heal_mp_pct_(\d+)$/);
        if (pctMatch) { const p = parseInt(pctMatch[1], 10); const a = Math.floor(charMaxMp * p / 100); healPlayerMp(a, charMaxMp); addLog(`[Auto%] ${elixir.name_pl} +${a} MP`, 'system'); }
      }
    }
  }, [addLog, healPlayerHp, healPlayerMp, startHpCooldown, startMpCooldown]);

  useEffect(() => { tryAutoPotionRef.current = tryAutoPotion; }, [tryAutoPotion]);

  // ── Manual potion use ───────────────────────────────────────────────────
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

  // ── Get status of a transform ──────────────────────────────────────────────
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

  // ── Start quest ──────────────────────────────────────────────────────────────
  const handleStartQuest = useCallback((transformId: number) => {
    if (!character) return;
    const started = useTransformStore.getState().startTransformQuest(transformId, character.level);
    if (started) {
      setActiveTransformId(transformId);
      setPhase('fighting');
      setCombatLog([]);
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

  // ── Resume quest (if player left and came back) ──────────────────────────────
  const handleResumeQuest = useCallback(() => {
    if (!currentQuest?.inProgress) return;
    setActiveTransformId(currentQuest.transformId);
    setPhase('fighting');
    setCombatLog([]);
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

  // ── Start fight with a specific monster ──────────────────────────────────────
  const startMonsterFight = useCallback((baseMonster: IMonster, transformId: number) => {
    const char = useCharacterStore.getState().character;
    if (!char) return;

    const bossMonster = applyTransformBossStats(baseMonster);
    setCurrentMonster(bossMonster);
    setMonsterHp(bossMonster.hp);
    setMonsterMaxHp(bossMonster.hp);
    // HP/MP are carried over between bosses within the same quest.
    // The store's char.hp/mp is kept in sync on monster death, so reading from the
    // store here gives the post-last-fight values (not a refill).
    setPlayerHp(char.hp);
    setPlayerMp(char.mp);
    playerHpRef.current = char.hp;
    playerMpRef.current = char.mp;
    setMonsterHit(false);
    setPlayerHit(false);
    setPlayerAttacking(false);

    // Reset cooldowns for a fresh fight
    setSkillCooldowns({});
    skillCooldownRef.current.clear();
    setHpPotionCooldown(0); hpPotionCooldownRef.current = 0;
    setMpPotionCooldown(0); mpPotionCooldownRef.current = 0;
    setPctHpCooldown(0); pctHpCooldownRef.current = 0;
    setPctMpCooldown(0); pctMpCooldownRef.current = 0;

    addLog(`BOSS ${baseMonster.name_pl} (Lvl ${baseMonster.level}) - Walka rozpoczeta!`, 'system');

    // Start player attack timer
    const effChar = getEffectiveChar(char);
    if (!effChar) return;
    const attackMs = getAttackMs(effChar.attack_speed);
    const classData = classesData[char.class] ?? {};
    const isDualWield = !!classData.dualWield;

    // Clear old timers
    clearTimers();

    // Player attack interval – runs at base/4 rate with tick-skipping for x1/x2/x4
    const playerTickInterval = Math.max(100, attackMs / 4);
    let playerTickCount = 0;
    combatTimerRef.current = setInterval(() => {
      playerTickCount += 1;
      const skip = 4 / speedMultRef.current; // x1=>4, x2=>2, x4=>1
      if (playerTickCount % skip !== 0) return;
      (() => {
      const latestChar = useCharacterStore.getState().character;
      if (!latestChar) return;

      const eff = getEffectiveChar(latestChar);
      if (!eff) return;

      const weaponDmg = rollWeaponDamage();
      const { skillLevels } = useSkillStore.getState();
      const skillBonus = getClassSkillBonus(latestChar.class, skillLevels);

      setMonsterHp((prevMhp) => {
        if (prevMhp <= 0) return 0;

        let totalDmg = 0;
        if (isDualWield) {
          const dual = calculateDualWieldDamage({
            baseAtk: eff.attack,
            weaponAtk: weaponDmg,
            offHandAtk: rollOffHandDamage(),
            skillBonus,
            classModifier: CLASS_MODIFIER[latestChar.class] ?? 1,
            enemyDefense: bossMonster.defense,
            critChance: eff.crit_chance,
            critDmg: eff.crit_damage,
            maxCritChance: classData.maxCritChance ?? 0.5,
            damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
          });
          totalDmg = dual.totalDamage;
          addLog(
            `[Ty] Podwojny atak za ${dual.hit1.finalDamage} + ${dual.hit2.finalDamage} = ${totalDmg} dmg${dual.hit1.isCrit || dual.hit2.isCrit ? ' CRIT!' : ''}`,
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
            enemyDefense: bossMonster.defense,
            critChance: eff.crit_chance,
            critDmg: eff.crit_damage,
            blockChance: canBlock ? calculateBlockChance(skillLevels['shielding'] ?? 0) : 0,
            dodgeChance: canDodge ? calculateDodgeChance(latestChar.class) : 0,
            maxCritChance: classData.maxCritChance ?? 0.5,
            damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
          });
          totalDmg = result.finalDamage;
          const logType = result.isCrit ? 'crit' : 'player';
          addLog(
            `[Ty] Atak za ${totalDmg} dmg${result.isCrit ? ' CRIT!' : ''} (HP: ${Math.max(0, prevMhp - totalDmg)}/${bossMonster.hp})`,
            logType,
          );
        }

        setMonsterHit(true);
        setPlayerAttacking(true);
        const animDur = ATTACK_ANIM_DURATION[latestChar.class] ?? 350;
        setTimeout(() => { setMonsterHit(false); setPlayerAttacking(false); }, animDur);

        // Grant skill XP from attack (weapon skill for non-magic + MLVL for magic classes)
        useSkillStore.getState().addWeaponSkillXpFromAttack(latestChar.class);
        useSkillStore.getState().addMlvlXpFromAttack(latestChar.class);
        if (isDualWield) {
          // Second hit for dual wield classes
          useSkillStore.getState().addWeaponSkillXpFromAttack(latestChar.class);
        }

        const newHp = Math.max(0, prevMhp - totalDmg);

        // Auto-skill fire (check all 4 slots, only if skillMode=auto)
        if (newHp > 0 && useSettingsStore.getState().skillMode === 'auto') {
          const now = Date.now();
          const slots = useSkillStore.getState().activeSkillSlots;
          let extraDmg = 0;
          for (let i = 0; i < 4; i++) {
            const skillId = slots[i];
            if (!skillId) continue;
            const lastUsed = skillCooldownRef.current.get(skillId) ?? 0;
            if (now - lastUsed < SKILL_COOLDOWN_MS) continue;
            if (playerMpRef.current < SKILL_MP_COST) continue;
            const skillDmg = Math.max(1, Math.floor(eff.attack * 0.15 * getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier()));
            extraDmg += skillDmg;
            const newMp = Math.max(0, playerMpRef.current - SKILL_MP_COST);
            playerMpRef.current = newMp;
            setPlayerMp(newMp);
            skillCooldownRef.current.set(skillId, now);
            setSkillCooldowns((prev) => ({ ...prev, [skillId]: SKILL_COOLDOWN_MS }));
            { const sd = getSkillDef(skillId); if (sd) applySkillBuff(skillId, sd); }
            triggerSkillAnim(skillId);
            addLog(`✨ ${formatSkillName(skillId)}: ${skillDmg} dmg (-${SKILL_MP_COST} MP)`, 'crit');
            break;
          }
          if (extraDmg > 0) {
            return Math.max(0, newHp - extraDmg);
          }
        }

        // Auto-potion check after player attack
        tryAutoPotionRef.current();

        return newHp;
      });
      })();
    }, playerTickInterval);

    // Monster attack interval – runs at base/4 rate with tick-skipping
    const monsterAttackMs = Math.max(800, 2000 - bossMonster.speed * 10);
    const monsterTickInterval = Math.max(100, monsterAttackMs / 4);
    let monsterTickCount = 0;
    monsterTimerRef.current = setInterval(() => {
      monsterTickCount += 1;
      const skip = 4 / speedMultRef.current;
      if (monsterTickCount % skip !== 0) return;
      setPlayerHp((prevPhp) => {
        if (prevPhp <= 0) return 0;

        const latestChar = useCharacterStore.getState().character;
        if (!latestChar) return prevPhp;
        const eff = getEffectiveChar(latestChar);
        if (!eff) return prevPhp;

        // Monster attack with min/max range
        const rawDmg = rollMonsterDamage(bossMonster);
        const dmg = Math.max(1, rawDmg - eff.defense);

        setPlayerHit(true);
        setTimeout(() => setPlayerHit(false), 300);

        addLog(
          `[${baseMonster.name_pl}] Atak za ${dmg} dmg (HP: ${Math.max(0, prevPhp - dmg)}/${eff.max_hp})`,
          'monster',
        );

        const newPhp = Math.max(0, prevPhp - dmg);
        playerHpRef.current = newPhp;
        // Try auto-potion after taking damage
        setTimeout(() => tryAutoPotionRef.current(), 0);
        return newPhp;
      });
    }, monsterTickInterval);
  }, [addLog, clearTimers]);

  // ── Check monster death / player death ────────────────────────────────────
  useEffect(() => {
    if (phase !== 'fighting') return;

    // Monster defeated
    if (monsterHp <= 0 && currentMonster) {
      clearTimers();
      tickCombatElixirs(2000);
      // Record defeat in store
      useTransformStore.getState().defeatMonster(currentMonster.id);
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
      postKillTimeoutRef.current = setTimeout(() => {
        postKillTimeoutRef.current = null;
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
      }, 1000);
    }

    // Player death
    if (playerHp <= 0 && currentMonster && monsterHp > 0) {
      clearTimers();
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

        // Death Protection: saves level/XP. AoL: saves items. Both consumed independently.
        const usedDeathProtection = useInventoryStore.getState().useConsumable('death_protection');
        const usedAol = useInventoryStore.getState().useConsumable('amulet_of_loss');

        if (usedDeathProtection) {
          useCharacterStore.getState().fullHealEffective();
          addLog('Eliksir Ochrony uchronil Cie od utraty poziomu!', 'system');
        } else {
          const penalty = applyDeathPenalty(char.level, char.xp);
          const currentHighest = char.highest_level ?? char.level;
          const preservedHighest = Math.max(currentHighest, char.level);
          useCharacterStore.getState().updateCharacter({
            level: penalty.newLevel,
            xp: penalty.newXp,
            highest_level: preservedHighest,
            hp: Math.floor(char.max_hp * 0.5),
            mp: Math.floor(char.max_mp * 0.5),
          });
          useSkillStore.getState().applyDeathPenalty(char.class);
          if (penalty.levelsLost > 0) {
            addLog(`Straciles poziom: ${char.level} -> ${penalty.newLevel}`, 'system');
          }
        }

        // Item loss with optional Amulet of Loss protection
        const itemsLost = useInventoryStore.getState().applyDeathItemLoss(usedAol);
        if (usedAol) {
          addLog('Amulet of Loss roztrzaskal sie i ochronil Twoje przedmioty!', 'system');
        } else if (itemsLost > 0) {
          addLog(`Stracileś ${itemsLost} przedmiot(ow) przy smierci!`, 'system');
        }
      }

      // Abandon quest
      useTransformStore.getState().abandonTransformQuest();
      void saveCurrentCharacterStores();

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
  }, [monsterHp, playerHp, phase, currentMonster, activeTransformId, clearTimers, addLog, startMonsterFight]);

  // ── Handle "Uciekaj" button ─────────────────────────────────────────────────
  // Point 11: Ucieknij must be fully cancellable — abandon the quest, cancel
  // any pending post-kill / death timers, and go straight to Miasto so no
  // stray setTimeout can fire an "allDefeated" state and award bogus rewards.
  const handleAbandon = useCallback(() => {
    clearTimers(); // cancels attack intervals + post-kill + death timeouts
    useTransformStore.getState().abandonTransformQuest();
    // Training runs always — no action needed
    setVictoryReady(false);
    setPhase('list');
    setCurrentMonster(null);
    setCombatLog([]);
    navigate('/');
  }, [clearTimers, navigate]);

  // Point N6: explicit claim button handler — transitions to 'allDefeated'.
  const handleClaimVictory = useCallback(() => {
    clearTimers();
    setVictoryReady(false);
    setPhase('allDefeated');
  }, [clearTimers]);

  // ── Handle rewards / complete transform ──────────────────────────────────────
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

    // Training runs always — no action needed

    void saveCurrentCharacterStores();

    setPhase('complete');
  }, [character, rewards]);

  const handleReturn = useCallback(() => {
    setPhase('list');
    setCurrentMonster(null);
    setCombatLog([]);
    setRewards(null);
    setShowTransformAnimation(false);
    setShowFullscreenAvatar(false);
    setActiveTransformId(0);
  }, []);

  // ── Render helpers ──────────────────────────────────────────────────────────

  if (!character) {
    return <div className="transform"><p>Brak postaci.</p></div>;
  }

  const nameKey = language === 'pl' ? 'name_pl' : 'name_en';

  // ── Transform list view ──────────────────────────────────────────────────────
  const renderList = () => {
    return (
      <div className="transform__list">
        {allTransforms.map((t) => {
          const status = getTransformStatus(t);
          const colorInfo = getTransformColor(t.id);
          const monsterCount = getTransformMonsters(t.id).length;
          const questForThis = currentQuest?.transformId === t.id ? currentQuest : null;

          return (
            <div
              key={t.id}
              className={`transform__card transform__card--${status}`}
              style={{
                '--transform-color': colorInfo.solid ?? colorInfo.gradient?.[0] ?? '#9e9e9e',
                '--transform-gradient': colorInfo.css,
              } as React.CSSProperties}
            >
              <div className="transform__card-header">
                <div className="transform__card-number" style={{ background: colorInfo.css }}>
                  T{t.id}
                </div>
                <div className="transform__card-info">
                  <span className="transform__card-name">{t[nameKey]}</span>
                  <span className="transform__card-level">Wymagany poziom: {t.level}</span>
                </div>
                <div className="transform__card-status">
                  {status === 'locked' && <span className="transform__status-icon">🔒</span>}
                  {status === 'available' && <span className="transform__status-icon">⚡</span>}
                  {status === 'in_progress' && <span className="transform__status-icon">⚔️</span>}
                  {status === 'completed' && <span className="transform__status-icon">🏆</span>}
                </div>
              </div>

              <div className="transform__card-monsters">
                {monsterCount} Bossow | Lvl {t.monsterLevelRange[0]}-{t.monsterLevelRange[1]}
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
                    onClick={() => handleStartQuest(t.id)}
                  >
                    Start
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

  // ── Manual skill use (click a slot when skillMode === 'manual') ──────────
  const doManualSkill = useCallback((slotIdx: 0 | 1 | 2 | 3) => {
    if (phase !== 'fighting') return;
    const latestChar = useCharacterStore.getState().character;
    if (!latestChar) return;
    const eff = getEffectiveChar(latestChar);
    if (!eff) return;
    const slots = useSkillStore.getState().activeSkillSlots;
    const skillId = slots[slotIdx];
    if (!skillId) return;
    const now = Date.now();
    const lastUsed = skillCooldownRef.current.get(skillId) ?? 0;
    if (now - lastUsed < SKILL_COOLDOWN_MS) return;
    if (playerMpRef.current < SKILL_MP_COST) {
      addLog('Za mało MP!', 'system');
      return;
    }
    const skillDmg = Math.max(
      1,
      Math.floor(eff.attack * 0.15 * getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier()),
    );
    setMonsterHp((prevMhp) => {
      if (prevMhp <= 0) return 0;
      return Math.max(0, prevMhp - skillDmg);
    });
    const newMp = Math.max(0, playerMpRef.current - SKILL_MP_COST);
    playerMpRef.current = newMp;
    setPlayerMp(newMp);
    skillCooldownRef.current.set(skillId, now);
    setSkillCooldowns((prev) => ({ ...prev, [skillId]: SKILL_COOLDOWN_MS }));
    { const sd = getSkillDef(skillId); if (sd) applySkillBuff(skillId, sd); }
    triggerSkillAnim(skillId);
    addLog(`✨ ${formatSkillName(skillId)}: ${skillDmg} dmg (-${SKILL_MP_COST} MP)`, 'crit');
    useSkillStore.getState().addMlvlXpFromSkill(latestChar.class);
  }, [addLog, phase, triggerSkillAnim]);

  // ── Combat view ──────────────────────────────────────────────────────────────
  const renderCombat = () => {
    if (!currentMonster) return null;

    const effChar = getEffectiveChar(character);
    const hpPct = effChar ? Math.min(1, playerHp / effChar.max_hp) : 0;
    const mpPct = effChar ? Math.min(1, playerMp / effChar.max_mp) : 0;
    const monsterHpPct = monsterMaxHp > 0 ? Math.min(1, monsterHp / monsterMaxHp) : 0;

    // Figure out how many monsters remain
    const quest = useTransformStore.getState().currentTransformQuest;
    const allMonsters = getTransformMonsters(activeTransformId);
    const defeatedCount = quest?.monstersDefeated.length ?? 0;

    return (
      <div className="transform__combat">
        {/* Quest progress header */}
        <div className="transform__combat-progress">
          <span>Potwory: {defeatedCount} / {allMonsters.length}</span>
          <div className="transform__combat-progress-bar">
            <div
              className="transform__combat-progress-fill"
              style={{ width: `${(defeatedCount / allMonsters.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Monster card */}
        <div className={`transform__monster-card${monsterHit ? ' transform__monster-card--hit' : ''}${playerAttacking ? ` transform__monster-card--attack-${character.class}` : ''}`}>
          <motion.span
            className="transform__monster-sprite"
            animate={monsterHit ? { scale: [1, 0.8, 1.1, 1], rotate: [0, -5, 5, 0] } : {}}
            transition={{ duration: 0.3 }}
          >
            {currentMonster.sprite}
          </motion.span>
          <div className="transform__monster-info">
            <span className="transform__monster-name">BOSS {currentMonster.name_pl}</span>
            <span className="transform__monster-level">BOSS · Lvl {currentMonster.level}</span>
          </div>
          <div className="transform__bar transform__bar--monster">
            <div className="transform__bar-fill transform__bar-fill--hp" style={{ width: `${monsterHpPct * 100}%` }} />
            <span className="transform__bar-text">{monsterHp} / {monsterMaxHp}</span>
          </div>
          {skillAnimOverlay && (
            <div className={`skill-anim-overlay ${skillAnimOverlay.anim.cssClass}`}>
              <span className="skill-anim-emoji">{skillAnimOverlay.anim.emoji}</span>
            </div>
          )}
        </div>

        {/* Player card */}
        <div
          className={`transform__player-card${playerHit ? ' transform__player-card--hit' : ''}`}
          style={{ '--class-color': CLASS_COLORS[character.class] ?? '#ffc107' } as React.CSSProperties}
        >
          <div className="transform__player-avatar-wrap transform__player-avatar-wrap--big transform__player-avatar-wrap--class-border">
            <img
              src={getCharacterAvatar(character.class, useTransformStore.getState().completedTransforms)}
              alt={character.class}
              className="transform__player-avatar transform__player-avatar--big"
            />
            <span className="transform__player-avatar-lvl">Lvl {character.level}</span>
          </div>
          <div className="transform__player-info transform__player-info--centered">
            <span className="transform__player-name">
              <span className="transform__player-class-icon">{CLASS_ICONS[character.class] ?? '?'}</span>
              {character.name}
            </span>
          </div>
          <div className="transform__bar transform__bar--player-hp">
            <div className="transform__bar-fill transform__bar-fill--hp" style={{ width: `${hpPct * 100}%` }} />
            <span className="transform__bar-text">{playerHp} / {effChar?.max_hp ?? 0}</span>
          </div>
          <div className="transform__bar transform__bar--player-mp">
            <div className="transform__bar-fill transform__bar-fill--mp" style={{ width: `${mpPct * 100}%` }} />
            <span className="transform__bar-text">{playerMp} / {effChar?.max_mp ?? 0}</span>
          </div>
        </div>

        {/* Combat toggles */}
        <div className="transform__combat-toggles">
          <button
            className={`transform__toggle-btn transform__toggle-btn--speed transform__toggle-btn--speed-${speedMode}`}
            onClick={cycleSpeed}
            title="Prędkość walki"
          >
            ⏱ {speedMode.toUpperCase()}
          </button>
          <button
            className={`transform__toggle-btn transform__toggle-btn--${skillMode}`}
            onClick={() => setSkillMode(skillMode === 'auto' ? 'manual' : 'auto')}
          >
            {skillMode === 'auto' ? '🔄 Skille: AUTO' : '👆 Skille: MANUAL'}
          </button>
          <button
            className={`transform__toggle-btn transform__toggle-btn--potion${autoPotionHpEnabled || autoPotionMpEnabled ? '' : ' transform__toggle-btn--off'}`}
            onClick={() => {
              const newState = !(autoPotionHpEnabled || autoPotionMpEnabled);
              useSettingsStore.getState().setAutoPotionHpEnabled(newState);
              useSettingsStore.getState().setAutoPotionMpEnabled(newState);
            }}
          >
            {(autoPotionHpEnabled || autoPotionMpEnabled) ? '🧪 Auto-Potion: ON' : '🧪 Auto-Potion: OFF'}
          </button>
        </div>

        {/* Skill slots */}
        <div className="transform__skill-slots">
          {(activeSkillSlots as (string | null)[]).map((skillId, i) => {
            const isEmpty = !skillId;
            const cdRemaining = skillId ? (skillCooldowns[skillId] ?? 0) : 0;
            const cdActive = cdRemaining > 0;
            const cdFraction = cdActive ? cdRemaining / SKILL_COOLDOWN_MS : 0;
            const notEnoughMp = playerMp < SKILL_MP_COST;
            const isManual = skillMode === 'manual';
            const canClick = !isEmpty && isManual && !cdActive && !notEnoughMp;
            return (
              <button
                key={i}
                type="button"
                onClick={() => canClick && doManualSkill(i as 0 | 1 | 2 | 3)}
                disabled={isEmpty || !isManual || cdActive || notEnoughMp}
                className={[
                  'transform__skill-slot',
                  isEmpty ? 'transform__skill-slot--empty' : 'transform__skill-slot--filled',
                  cdActive ? 'transform__skill-slot--on-cooldown' : '',
                  !isEmpty && isManual && !cdActive ? 'transform__skill-slot--manual' : '',
                ].filter(Boolean).join(' ')}
                title={
                  isEmpty ? 'Pusty slot'
                    : cdActive ? `Cooldown: ${Math.ceil(cdRemaining / 1000)}s`
                    : notEnoughMp ? `Za mało MP (${SKILL_MP_COST})`
                    : isManual ? `${formatSkillName(skillId)} – kliknij aby użyć`
                    : `${formatSkillName(skillId)} (AUTO)`
                }
              >
                {cdActive && (
                  <span
                    className="transform__skill-cd-overlay"
                    style={{ height: `${cdFraction * 100}%` }}
                  />
                )}
                <span className="transform__skill-slot-name">{formatSkillName(skillId)}</span>
                {!isEmpty && (
                  <span className="transform__skill-slot-badge">
                    {cdActive ? `${Math.ceil(cdRemaining / 1000)}s`
                      : isManual ? `${SKILL_MP_COST}MP`
                      : 'AUTO'}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Potion buttons */}
        <div className="transform__potions">
          {(() => {
            const bestHpPotion = getBestPotion(hpPotions, consumables);
            if (!bestHpPotion) return null;
            const count = consumables[bestHpPotion.id] ?? 0;
            const cdActive = hpPotionCooldown > 0;
            const cdFrac = cdActive ? hpPotionCooldown / POTION_COOLDOWN_MS : 0;
            return (
              <button
                className={`transform__potion-btn transform__potion-btn--hp${cdActive ? ' transform__potion-btn--cooldown' : ''}`}
                onClick={() => doUsePotion(bestHpPotion.id)}
                disabled={count === 0 || cdActive}
                title={cdActive ? `Cooldown: ${Math.ceil(hpPotionCooldown / 1000)}s` : count === 0 ? 'Brak eliksirów HP' : bestHpPotion.description_pl}
              >
                {cdActive && (
                  <span className="transform__potion-cd-overlay" style={{ height: `${cdFrac * 100}%` }} />
                )}
                <span className="transform__potion-label">{bestHpPotion.icon} {getPotionLabel(bestHpPotion.effect)}</span>
                <span className="transform__potion-count">x{count}</span>
              </button>
            );
          })()}
          {(() => {
            const bestMpPotion = getBestPotion(mpPotions, consumables);
            if (!bestMpPotion) return null;
            const count = consumables[bestMpPotion.id] ?? 0;
            const cdActive = mpPotionCooldown > 0;
            const cdFrac = cdActive ? mpPotionCooldown / POTION_COOLDOWN_MS : 0;
            return (
              <button
                className={`transform__potion-btn transform__potion-btn--mp${cdActive ? ' transform__potion-btn--cooldown' : ''}`}
                onClick={() => doUsePotion(bestMpPotion.id)}
                disabled={count === 0 || cdActive}
                title={cdActive ? `Cooldown: ${Math.ceil(mpPotionCooldown / 1000)}s` : count === 0 ? 'Brak eliksirów MP' : bestMpPotion.description_pl}
              >
                {cdActive && (
                  <span className="transform__potion-cd-overlay" style={{ height: `${cdFrac * 100}%` }} />
                )}
                <span className="transform__potion-label">{bestMpPotion.icon} {getPotionLabel(bestMpPotion.effect)}</span>
                <span className="transform__potion-count">x{count}</span>
              </button>
            );
          })()}
          {(() => {
            const bestPctHpPotion = getBestPotion(pctHpPotions, consumables);
            if (!bestPctHpPotion) return null;
            const count = consumables[bestPctHpPotion.id] ?? 0;
            const cdActive = pctHpCooldown > 0;
            const cdFrac = cdActive ? pctHpCooldown / PCT_POTION_CD_MS : 0;
            return (
              <button
                className={`transform__potion-btn transform__potion-btn--pct-hp${cdActive ? ' transform__potion-btn--cooldown' : ''}${count === 0 ? ' transform__potion-btn--empty' : ''}`}
                onClick={() => doUsePotion(bestPctHpPotion.id)}
                disabled={count === 0 || cdActive}
                title={cdActive ? `Cooldown: ${Math.ceil(pctHpCooldown / 1000)}s` : count === 0 ? 'Brak % potionów HP' : bestPctHpPotion.description_pl}
              >
                {cdActive && (
                  <span className="transform__potion-cd-overlay" style={{ height: `${cdFrac * 100}%` }} />
                )}
                <span className="transform__potion-label">❤️‍🔥 {getPotionLabel(bestPctHpPotion.effect)}</span>
                <span className="transform__potion-count">x{count}</span>
              </button>
            );
          })()}
          {(() => {
            const bestPctMpPotion = getBestPotion(pctMpPotions, consumables);
            if (!bestPctMpPotion) return null;
            const count = consumables[bestPctMpPotion.id] ?? 0;
            const cdActive = pctMpCooldown > 0;
            const cdFrac = cdActive ? pctMpCooldown / PCT_POTION_CD_MS : 0;
            return (
              <button
                className={`transform__potion-btn transform__potion-btn--pct-mp${cdActive ? ' transform__potion-btn--cooldown' : ''}${count === 0 ? ' transform__potion-btn--empty' : ''}`}
                onClick={() => doUsePotion(bestPctMpPotion.id)}
                disabled={count === 0 || cdActive}
                title={cdActive ? `Cooldown: ${Math.ceil(pctMpCooldown / 1000)}s` : count === 0 ? 'Brak % potionów MP' : bestPctMpPotion.description_pl}
              >
                {cdActive && (
                  <span className="transform__potion-cd-overlay" style={{ height: `${cdFrac * 100}%` }} />
                )}
                <span className="transform__potion-label">💎 {getPotionLabel(bestPctMpPotion.effect)}</span>
                <span className="transform__potion-count">x{count}</span>
              </button>
            );
          })()}
        </div>

        {/* Combat log */}
        <div className="transform__log" ref={logContainerRef}>
          {combatLog.map((entry) => (
            <div key={entry.id} className={`transform__log-entry transform__log-entry--${entry.type}`}>
              {entry.text}
            </div>
          ))}
        </div>

        {/* Abandon button */}
        <button className="transform__btn transform__btn--abandon" onClick={handleAbandon}>
          Uciekaj (przerwij quest)
        </button>

        {/* Point N6: explicit claim overlay — only rendered when all monsters
            are defeated. Absolutely positioned over the combat area so it
            never shifts layout. Uciekaj remains accessible underneath via
            the backdrop-locked state so the user never accidentally claims. */}
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

  // ── All defeated / rewards view ────────────────────────────────────────────
  const renderAllDefeated = () => {
    const colorInfo = getTransformColor(activeTransformId);
    const transformData = getTransformById(activeTransformId);
    const rewardLines: { label: string; value: string; icon: string }[] = rewards
      ? [
          { icon: '⚔️', label: 'Damage',   value: `+${rewards.permanentBonuses.dmgPercent}%` },
          { icon: '❤️', label: 'Max HP',   value: `+${rewards.permanentBonuses.hpPercent}% · +${rewards.permanentBonuses.flatHp}` },
          { icon: '🔮', label: 'Max MP',   value: `+${rewards.permanentBonuses.mpPercent}% · +${rewards.permanentBonuses.flatMp}` },
          { icon: '💪', label: 'Attack',   value: `+${rewards.permanentBonuses.attack}` },
          { icon: '🛡️', label: 'Defense',  value: `+${rewards.permanentBonuses.defPercent}% · +${rewards.permanentBonuses.defense}` },
          { icon: '💚', label: 'HP Regen', value: `+${rewards.permanentBonuses.hpRegenFlat.toFixed(1)}/s` },
          { icon: '💙', label: 'MP Regen', value: `+${rewards.permanentBonuses.mpRegenFlat.toFixed(1)}/s` },
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
          ⭐ Zwyciestwo! ⭐
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
            ✨ Pokaz nagrody ✨
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
              🏆 Nagrody Permanentne 🏆
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
                  <span className="transform__reward-icon">{line.icon}</span>
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
                  <span className="transform__reward-icon">🗡️</span>
                  <span className="transform__reward-label">Mythic Weapon</span>
                  <span className="transform__reward-value">{rewards.weapon.item_name}</span>
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
                  <span className="transform__reward-icon">🎁</span>
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
              ✨ TRANSFORMUJ SIE ✨
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

  // ── Complete view ──────────────────────────────────────────────────────────
  const renderComplete = () => {
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
        <button className="transform__btn transform__btn--back" onClick={handleReturn}>
          Wroc do listy
        </button>
      </div>
    );
  };

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div className="transform">
      <header className="transform__header">
        <button
          className="transform__back"
          onClick={() => {
            if (phase === 'list') navigate('/');
            else if (phase === 'fighting') handleAbandon();
            // allDefeated / transforming / complete — back disabled
          }}
          disabled={phase === 'allDefeated' || phase === 'transforming' || phase === 'complete'}
          style={phase === 'allDefeated' || phase === 'transforming' || phase === 'complete' ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
        >
          ← Wroc
        </button>
        <h1 className="transform__title">🔄 Transform</h1>
      </header>

      {phase === 'list' && renderList()}
      {phase === 'fighting' && renderCombat()}
      {phase === 'allDefeated' && renderAllDefeated()}
      {(phase === 'transforming' || phase === 'complete') && renderComplete()}
    </div>
  );
};

export default Transform;
