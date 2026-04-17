import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import dungeonData from '../../data/dungeons.json';
import monstersData from '../../data/monsters.json';
import itemsData from '../../data/items.json';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useSkillStore } from '../../stores/skillStore';
import { useDungeonStore } from '../../stores/dungeonStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useBuffStore } from '../../stores/buffStore';
import { ELIXIRS } from '../../stores/shopStore';
import {
    getDungeonWaves,
    getDungeonMinLevel,
    pickWaveMonster,
    scaleDungeonMonster,
    rollDungeonItemDrop,
    getWaveMonsterType,
    estimateDungeonRewards,
    type IDungeon,
    type IDungeonMonster,
    type IDungeonResult,
    type DungeonMonsterType,
} from '../../systems/dungeonSystem';
// Dungeon combat uses simplified damage calculation (no skills/crits)
import { rollMonsterDamage } from '../../systems/combat';
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
import { getTransformDmgMultiplier } from '../../systems/transformBonuses';
import { buildItem, flattenItemsData, getTotalEquipmentStats, formatItemName, type IBaseItem } from '../../systems/itemSystem';
import { getItemDisplayInfo } from '../../systems/itemGenerator';
import { getTrainingBonuses } from '../../systems/skillSystem';
import { getPotionDropInfo, HP_POTION_DROP_CHANCE, MP_POTION_DROP_CHANCE, rollSpellChestDrop, getSpellChestIcon, getSpellChestDisplayName, getSpellChestDropInfo, type IGeneratedItem } from '../../systems/lootSystem';
import { applyDeathPenalty } from '../../systems/levelSystem';
import { applySkillBuff, getSkillDef } from '../../systems/skillBuffs';
import { useSkillAnim } from '../../hooks/useSkillAnim';
import { saveCurrentCharacterStores } from '../../stores/characterScope';
import { deathsApi } from '../../api/v1/deathsApi';
import { useDeathStore } from '../../stores/deathStore';
import { useTaskStore } from '../../stores/taskStore';
import { useQuestStore } from '../../stores/questStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { useMasteryStore, getMasteryXpMultiplier, getMasteryGoldMultiplier } from '../../stores/masteryStore';
import {
    FLAT_HP_POTIONS,
    FLAT_MP_POTIONS,
    PCT_HP_POTIONS,
    PCT_MP_POTIONS,
    PCT_POTION_COOLDOWN_MS,
    getBestPotion as getBestPotionUtil,
    getPotionCooldownMs,
    resolveAutoPotionElixir,
} from '../../systems/potionSystem';
import ItemIcon from '../../components/ui/ItemIcon/ItemIcon';
import { getSkillIcon } from '../../data/skillIcons';
import { getCharacterAvatar } from '../../data/classAvatars';
import classesRaw from '../../data/classes.json';
import { useTransformStore } from '../../stores/transformStore';
import './Dungeon.scss';

// ── Class config for dual wield ──────────────────────────────────────────────

interface IDungeonClassData {
    dualWield?: boolean;
    dualWieldDmgPercent?: number;
}

const classesArray = classesRaw as unknown as (IDungeonClassData & { id: string })[];
const classesDataMap: Record<string, IDungeonClassData> = {};
for (const c of classesArray) {
    classesDataMap[c.id] = c;
}

/** Themed emoji icon per dungeon based on name keywords and difficulty. */
const DUNGEON_ICONS: Record<string, string> = {
    dungeon_1: '🏚️', dungeon_3: '🐀', dungeon_5: '🐺', dungeon_7: '👺',
    dungeon_8: '🕷️', dungeon_10: '🗼', dungeon_12: '🐸', dungeon_15: '💀',
    dungeon_18: '⛏️', dungeon_20: '🌲', dungeon_22: '🐻', dungeon_25: '🏰',
    dungeon_28: '☀️', dungeon_30: '🦅', dungeon_33: '⚔️', dungeon_35: '🦂',
    dungeon_38: '🧪', dungeon_40: '👹', dungeon_43: '🦁', dungeon_45: '🌊',
    dungeon_48: '🐍', dungeon_50: '🪓', dungeon_55: '🐉', dungeon_60: '🧙',
    dungeon_65: '🤖', dungeon_70: '🐍', dungeon_75: '🏺', dungeon_80: '🧛',
    dungeon_85: '🐲', dungeon_90: '👁️', dungeon_95: '🦇', dungeon_100: '😈',
    dungeon_110: '🔥', dungeon_120: '👑', dungeon_125: '🐂', dungeon_135: '🌪️',
    dungeon_145: '🏟️', dungeon_150: '🌑', dungeon_160: '❄️', dungeon_175: '🧊',
    dungeon_190: '🐲', dungeon_200: '🌋', dungeon_220: '💀', dungeon_240: '🏛️',
    dungeon_260: '🦴', dungeon_280: '🔨', dungeon_300: '☠️', dungeon_320: '🧟',
    dungeon_340: '⛰️', dungeon_360: '👿', dungeon_380: '🔺', dungeon_400: '🕳️',
    dungeon_420: '⛓️', dungeon_450: '🌀', dungeon_475: '😱', dungeon_500: '⭐',
    dungeon_530: '🌀', dungeon_550: '🐍', dungeon_575: '🔮', dungeon_600: '⛈️',
    dungeon_625: '🌿', dungeon_650: '🏯', dungeon_675: '👻', dungeon_700: '⏳',
    dungeon_725: '🕳️', dungeon_750: '💎', dungeon_775: '🔥', dungeon_800: '🙏',
    dungeon_830: '♾️', dungeon_850: '🔴', dungeon_870: '✨', dungeon_900: '💀',
    dungeon_920: '🌍', dungeon_940: '🕳️', dungeon_960: '🚪', dungeon_980: '⚡',
    dungeon_1000: '🌌',
};
const getDungeonIcon = (id: string): string => DUNGEON_ICONS[id] ?? '🏰';

/**
 * Returns a CSS hue value (0-360) for a dungeon card gradient based on level.
 * Low levels = cool greens/teals, mid = blues/purples, high = reds/golds.
 */
const getDungeonCardHue = (level: number): number => {
    if (level <= 10) return 160;     // teal
    if (level <= 25) return 140;     // green
    if (level <= 50) return 200;     // blue
    if (level <= 100) return 240;    // indigo
    if (level <= 200) return 270;    // purple
    if (level <= 400) return 300;    // magenta
    if (level <= 600) return 330;    // pink
    if (level <= 800) return 15;     // orange-red
    return 45;                       // gold
};

/**
 * Returns a random weapon damage value from equipped mainHand weapon.
 */
const rollWeaponDamage = (): number => {
    const { equipment } = useInventoryStore.getState();
    const weapon = equipment.mainHand;
    if (!weapon) return 0;
    const dmgMin = weapon.bonuses.dmg_min ?? weapon.bonuses.attack ?? 0;
    const dmgMax = weapon.bonuses.dmg_max ?? dmgMin;
    if (dmgMax <= 0) return 0;
    return dmgMin + Math.floor(Math.random() * (dmgMax - dmgMin + 1));
};

/**
 * Returns a random weapon damage value from equipped offHand weapon (Rogue dual wield).
 */
const rollOffHandDamage = (): number => {
    const { equipment } = useInventoryStore.getState();
    const weapon = equipment.offHand ?? equipment.mainHand;
    if (!weapon) return 0;
    const dmgMin = weapon.bonuses.dmg_min ?? weapon.bonuses.attack ?? 0;
    const dmgMax = weapon.bonuses.dmg_max ?? dmgMin;
    if (dmgMax <= 0) return 0;
    return dmgMin + Math.floor(Math.random() * (dmgMax - dmgMin + 1));
};

// ── Constants ─────────────────────────────────────────────────────────────────

type ScreenPhase = 'list' | 'running' | 'result';

const CLASS_ICONS: Record<string, string> = {
    Knight: '⚔️', Mage: '🔮', Cleric: '✨', Archer: '🏹',
    Rogue: '🗡️', Necromancer: '💀', Bard: '🎵',
};

// Dungeons ALWAYS run at x1 speed (independent of normal combat speed)

const MONSTER_TYPE_BADGES: Record<DungeonMonsterType, { label: string; icon: string; color: string }> = {
    Normal:    { label: 'Normal',    icon: '',   color: '#9e9e9e' },
    Strong:    { label: 'Strong',    icon: '💪', color: '#2196f3' },
    Epic:      { label: 'Epic',      icon: '⚡', color: '#4caf50' },
    Legendary: { label: 'Legendary', icon: '🔥', color: '#f44336' },
    Boss:      { label: 'BOSS',      icon: '👑', color: '#ffc107' },
};

const RARITY_COLORS: Record<string, string> = {
    common: '#9e9e9e', rare: '#2196f3', epic: '#9c27b0',
    legendary: '#ffc107', mythic: '#f44336', unique: '#ff5722',
};

// ── Drop table helpers ───────────────────────────────────────────────────────

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const;
const RARITY_LABELS: Record<string, { label: string; color: string }> = {
    common:    { label: 'Common',    color: '#ffffff' },
    rare:      { label: 'Rare',      color: '#2196f3' },
    epic:      { label: 'Epic',      color: '#4caf50' },
    legendary: { label: 'Legendary', color: '#f44336' },
    mythic:    { label: 'Mythic',    color: '#ffc107' },
};

const DUNGEON_ITEM_DROP_RATES: Record<string, number> = {
    common: 55, rare: 25, epic: 12, legendary: 5, mythic: 2.5,
};

interface IStoneDropInfo {
    name: string;
    chance: number;
    minLevel: number;
}

const DUNGEON_STONE_DROPS: IStoneDropInfo[] = [
    { name: 'Common Stone',    chance: 40,  minLevel: 1 },
    { name: 'Rare Stone',      chance: 25,  minLevel: 15 },
    { name: 'Epic Stone',      chance: 15,  minLevel: 40 },
    { name: 'Legendary Stone',  chance: 8,   minLevel: 80 },
    { name: 'Mythic Stone',    chance: 3,   minLevel: 200 },
    { name: 'Heroic Stone',    chance: 0.5, minLevel: 500 },
];

const getDungeonItemDropTiers = () => {
    const totalWeight = RARITY_ORDER.reduce((s, r) => s + DUNGEON_ITEM_DROP_RATES[r], 0);
    return RARITY_ORDER.map((r) => ({
        key: r,
        label: RARITY_LABELS[r].label,
        color: RARITY_LABELS[r].color,
        chance: parseFloat(((DUNGEON_ITEM_DROP_RATES[r] / totalWeight) * 100).toFixed(1)),
    }));
};

const getDungeonStoneDrops = (dungeonLevel: number) =>
    DUNGEON_STONE_DROPS.filter((s) => dungeonLevel >= s.minLevel);

// ── Skill / Potion constants ─────────────────────────────────────────────────

const SKILL_COOLDOWN_MS = 5000;
const SKILL_MP_COST = 15;
const POTION_COOLDOWN_MS = 1000;

const hpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_hp'));
const mpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_mp'));

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

// ── HP bar sub-component ─────────────────────────────────────────────────────

const HpBar = ({ current, max, variant }: { current: number; max: number; variant: 'hp' | 'mp' | 'enemy' }) => {
    const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
    return (
        <div className={`dungeon__combat-bar dungeon__combat-bar--${variant}`}>
            <motion.div
                className="dungeon__combat-bar-fill"
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
            />
        </div>
    );
};

// ── Combat log entry type ────────────────────────────────────────────────────

interface ILogEntry {
    id: number;
    text: string;
    type: 'player' | 'monster' | 'crit' | 'system' | 'wave';
}

// ── Get attack interval ms ───────────────────────────────────────────────────

const getAttackMs = (speed: number): number =>
    Math.max(500, Math.floor(3000 / Math.max(1, speed || 1)));

// ── Component ─────────────────────────────────────────────────────────────────

const Dungeon = () => {
    const navigate = useNavigate();

    const character    = useCharacterStore((s) => s.character);
    const equipment    = useInventoryStore((s) => s.equipment);
    const consumables  = useInventoryStore((s) => s.consumables);
    const completedTransforms = useTransformStore((s) => s.completedTransforms);
    const playerAvatarSrc = character ? getCharacterAvatar(character.class, completedTransforms) : '';
    const { activeSkillSlots } = useSkillStore();
    // Dungeons always run at x1 speed (no speed controls)
    const { setDungeonCompleted, getAttemptsUsed, getAttemptsMax, canEnter } = useDungeonStore();

    const [phase, setPhase]               = useState<ScreenPhase>('list');
    const [activeDungeon, setActiveDungeon] = useState<IDungeon | null>(null);
    const [expandedDungeon, setExpandedDungeon] = useState<string | null>(null);
    const [result, setResult]             = useState<IDungeonResult | null>(null);

    // ── Wave combat state ──────────────────────────────────────────────────────
    const [currentWave, setCurrentWave]       = useState(0);
    const [currentMonster, setCurrentMonster] = useState<IDungeonMonster | null>(null);
    const [monsterMaxHp, setMonsterMaxHp]     = useState(0);
    const [monsterCurrentHp, setMonsterCurrentHp] = useState(0);
    const [playerHp, setPlayerHp]             = useState(0);
    const [playerMp, setPlayerMp]             = useState(0);
    const [combatLog, setCombatLog]           = useState<ILogEntry[]>([]);
    const [, setWaveItems]                    = useState<IGeneratedItem[]>([]);
    const [waveMonsterType, setWaveMonsterType] = useState<DungeonMonsterType>('Normal');

    // Skill & potion state
    const [skillCooldowns, setSkillCooldowns] = useState<Record<string, number>>({});
    const [hpPotionCooldown, setHpPotionCooldown] = useState(0);
    const [mpPotionCooldown, setMpPotionCooldown] = useState(0);
    const [pctHpCooldown, setPctHpCooldown] = useState(0);
    const [pctMpCooldown, setPctMpCooldown] = useState(0);
    const [speedMode, setSpeedMode] = useState<'x1' | 'x2' | 'x4'>('x1');
    const speedMult = speedMode === 'x4' ? 4 : speedMode === 'x2' ? 2 : 1;
    const cycleSpeed = useCallback(() => {
        setSpeedMode((s) => (s === 'x1' ? 'x2' : s === 'x2' ? 'x4' : 'x1'));
    }, []);
    const { overlay: skillAnimOverlay, trigger: triggerSkillAnim } = useSkillAnim();
    const skillCooldownRef = useRef<Map<string, number>>(new Map());
    const hpPotionCooldownRef = useRef(0);
    const mpPotionCooldownRef = useRef(0);
    const pctHpCooldownRef = useRef(0);
    const pctMpCooldownRef = useRef(0);
    const playerMpRef = useRef(0);

    // Animation state
    const [monsterHit, setMonsterHit]           = useState(false);
    const [playerHit, setPlayerHit]             = useState(false);
    const [playerAttacking, setPlayerAttacking] = useState(false);
    const [floatingDmgs, setFloatingDmgs]       = useState<{ id: number; text: string; type: string; side?: 'left' | 'right' }[]>([]);

    const ATTACK_ANIM_DURATION: Record<string, number> = {
        Knight: 350,
        Mage: 400,
        Cleric: 400,
        Archer: 300,
        Rogue: 250,
        Necromancer: 450,
        Bard: 400,
    };
    const dmgIdRef = useRef(0);
    const logEndRef = useRef<HTMLDivElement>(null);
    const logIdRef = useRef(0);

    // Refs for interval callbacks
    const playerHpRef     = useRef(0);
    const monsterHpRef    = useRef(0);
    const currentWaveRef  = useRef(0);
    const activeDungeonRef = useRef<IDungeon | null>(null);
    const currentMonsterRef = useRef<IDungeonMonster | null>(null);
    const phaseRef        = useRef<ScreenPhase>('list');
    const waveItemsRef    = useRef<IGeneratedItem[]>([]);
    const waveXpRef       = useRef(0);
    const waveGoldRef     = useRef(0);

    const dungeons    = dungeonData as IDungeon[];
    const allMonsters = monstersData as IDungeonMonster[];
    const monstersRaw = monstersData as unknown as { id: string; gold: [number, number] }[];
    const allItems: IBaseItem[] = flattenItemsData(itemsData as Parameters<typeof flattenItemsData>[0]);
    const skillLevels = useSkillStore((s) => s.skillLevels);

    if (!character) return <div className="dungeon"><p className="dungeon__loading">Ładowanie...</p></div>;

    const eqStats   = getTotalEquipmentStats(equipment, allItems);
    const tb        = getTrainingBonuses(skillLevels, character.class);
    const charAtk   = character.attack  + eqStats.attack + getElixirAtkBonus();
    const charDef   = character.defense + eqStats.defense + tb.defense + getElixirDefBonus();
    const charMaxHp = character.max_hp  + eqStats.hp + tb.max_hp + getElixirHpBonus();
    const charMaxMp = character.max_mp  + eqStats.mp + tb.max_mp + getElixirMpBonus();
    const charSpeed = (character.attack_speed + eqStats.speed * 0.01 + tb.attack_speed) * getElixirAttackSpeedMultiplier();

    // Best potions the player owns
    const bestHpPotion = getBestPotion(hpPotions, consumables);
    const bestMpPotion = getBestPotion(mpPotions, consumables);
    const bestPctHpPotion = getBestPotionUtil(PCT_HP_POTIONS, consumables);
    const bestPctMpPotion = getBestPotionUtil(PCT_MP_POTIONS, consumables);

    // Keep refs in sync
    phaseRef.current = phase;
    activeDungeonRef.current = activeDungeon;

    const addLog = useCallback((text: string, type: ILogEntry['type']) => {
        const id = ++logIdRef.current;
        setCombatLog((prev) => [...prev.slice(-50), { id, text, type }]);
    }, []);

    const showFloatingDmg = useCallback((text: string, type: string, side?: 'left' | 'right') => {
        const id = ++dmgIdRef.current;
        setFloatingDmgs((prev) => [...prev, { id, text, type, side }]);
        setTimeout(() => setFloatingDmgs((prev) => prev.filter((e) => e.id !== id)), 900);
    }, []);

    // Auto-scroll log
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [combatLog.length]);

    // ── Cooldown tick (100ms, scaled by speedMult) ───────────────────────────
    useEffect(() => {
        if (phase !== 'running') return;
        const TICK_MS = 100;
        const DEC = TICK_MS * speedMult;
        const id = setInterval(() => {
            // Skill cooldowns
            setSkillCooldowns((prev) => {
                const next = { ...prev };
                let changed = false;
                for (const key of Object.keys(next)) {
                    if (next[key] > 0) {
                        next[key] = Math.max(0, next[key] - DEC);
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
            // Potion cooldowns
            setHpPotionCooldown((v) => { const nv = Math.max(0, v - DEC); hpPotionCooldownRef.current = nv; return nv; });
            setMpPotionCooldown((v) => { const nv = Math.max(0, v - DEC); mpPotionCooldownRef.current = nv; return nv; });
            setPctHpCooldown((v) => { const nv = Math.max(0, v - DEC); pctHpCooldownRef.current = nv; return nv; });
            setPctMpCooldown((v) => { const nv = Math.max(0, v - DEC); pctMpCooldownRef.current = nv; return nv; });
        }, TICK_MS);
        return () => clearInterval(id);
    }, [phase, speedMult]);

    // ── Helpers: heal / spend MP ─────────────────────────────────────────────
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

    // spendPlayerMp – handled inline in skill/attack callbacks via playerMpRef

    const startHpCooldown = useCallback(() => {
        setHpPotionCooldown(POTION_COOLDOWN_MS);
        hpPotionCooldownRef.current = POTION_COOLDOWN_MS;
    }, []);

    const startMpCooldown = useCallback(() => {
        setMpPotionCooldown(POTION_COOLDOWN_MS);
        mpPotionCooldownRef.current = POTION_COOLDOWN_MS;
    }, []);

    // ── Settings toggles ──────────────────────────────────────────────────
    const { skillMode, setSkillMode, autoPotionHpEnabled, autoPotionMpEnabled } = useSettingsStore();

    // ── Auto-potion helper ──────────────────────────────────────────────────
    const tryAutoPotion = useCallback(() => {
        const settings = useSettingsStore.getState();
        const inv = useInventoryStore.getState();
        const hp = playerHpRef.current;
        const mp = playerMpRef.current;

        // Auto HP (flat slot; falls back to strongest owned flat HP potion)
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

        // Auto MP (flat slot; falls back to strongest owned flat MP potion)
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
    }, [charMaxHp, charMaxMp, healPlayerHp, healPlayerMp, startHpCooldown, startMpCooldown, addLog]);

    const startPctHpCooldown = useCallback(() => {
        setPctHpCooldown(PCT_POTION_COOLDOWN_MS);
        pctHpCooldownRef.current = PCT_POTION_COOLDOWN_MS;
    }, []);

    const startPctMpCooldown = useCallback(() => {
        setPctMpCooldown(PCT_POTION_COOLDOWN_MS);
        pctMpCooldownRef.current = PCT_POTION_COOLDOWN_MS;
    }, []);

    // ── Manual potion use ───────────────────────────────────────────────────
    const doUsePotion = useCallback((elixirId: string) => {
        const elixir = ELIXIRS.find((e) => e.id === elixirId);
        if (!elixir) return;
        const isHp = elixir.effect.startsWith('heal_hp');
        const isMp = elixir.effect.startsWith('heal_mp');
        const isPct = elixir.effect.includes('_pct_');
        // Check cooldown for the correct slot
        if (isHp && !isPct && hpPotionCooldownRef.current > 0) return;
        if (isMp && !isPct && mpPotionCooldownRef.current > 0) return;
        if (isHp && isPct && pctHpCooldownRef.current > 0) return;
        if (isMp && isPct && pctMpCooldownRef.current > 0) return;
        const used = useInventoryStore.getState().useConsumable(elixirId);
        if (!used) return;
        // Start cooldown for the correct slot
        if (isHp && !isPct) startHpCooldown();
        if (isMp && !isPct) startMpCooldown();
        if (isHp && isPct) startPctHpCooldown();
        if (isMp && isPct) startPctMpCooldown();
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
    }, [charMaxHp, charMaxMp, healPlayerHp, healPlayerMp, startHpCooldown, startMpCooldown, startPctHpCooldown, startPctMpCooldown, addLog]);

    // ── Start a wave's monster ───────────────────────────────────────────────
    const startWaveMonster = useCallback((dungeon: IDungeon, waveIdx: number, hp: number) => {
        const totalWaves = getDungeonWaves(dungeon);
        const raw = pickWaveMonster(dungeon, allMonsters, waveIdx, totalWaves);
        const dLvl = getDungeonMinLevel(dungeon);
        const monster = scaleDungeonMonster(raw, waveIdx, totalWaves, dLvl);
        const monsterType = getWaveMonsterType(waveIdx, totalWaves, dLvl);

        setCurrentMonster(monster);
        currentMonsterRef.current = monster;
        setMonsterMaxHp(monster.hp);
        setMonsterCurrentHp(monster.hp);
        monsterHpRef.current = monster.hp;
        setPlayerHp(hp);
        playerHpRef.current = hp;
        currentWaveRef.current = waveIdx;
        setWaveMonsterType(monsterType);

        const typeLabel = monsterType !== 'Normal' ? ` · ${MONSTER_TYPE_BADGES[monsterType].icon} ${MONSTER_TYPE_BADGES[monsterType].label}` : '';
        addLog(
            `═══ Fala ${waveIdx + 1}/${totalWaves}${typeLabel}: ${raw.name_pl} ═══`,
            'wave',
        );
    }, [allMonsters, addLog]);

    // ── Start dungeon ────────────────────────────────────────────────────────
    const handleStart = useCallback((dungeon: IDungeon) => {
        setActiveDungeon(dungeon);
        setCurrentWave(0);
        setResult(null);
        setCombatLog([]);
        setWaveItems([]);
        waveItemsRef.current = [];
        waveXpRef.current = 0;
        waveGoldRef.current = 0;
        // Reset MP and cooldowns
        setPlayerMp(charMaxMp);
        playerMpRef.current = charMaxMp;
        setSkillCooldowns({});
        skillCooldownRef.current.clear();
        setHpPotionCooldown(0);
        hpPotionCooldownRef.current = 0;
        setMpPotionCooldown(0);
        mpPotionCooldownRef.current = 0;
        setPctHpCooldown(0);
        pctHpCooldownRef.current = 0;
        setPctMpCooldown(0);
        pctMpCooldownRef.current = 0;
        setPhase('running');
        startWaveMonster(dungeon, 0, charMaxHp);
    }, [charMaxHp, charMaxMp, startWaveMonster]);

    // ── Handle wave monster death ────────────────────────────────────────────
    const handleWaveMonsterDeath = useCallback(() => {
        const dungeon = activeDungeonRef.current;
        if (!dungeon || !character) return;

        // Tick combat elixirs per wave kill
        tickCombatElixirs(2000);

        const totalWaves = getDungeonWaves(dungeon);
        const wave = currentWaveRef.current;
        const isBossWave = wave === totalWaves - 1;
        const hp = playerHpRef.current;

        // Roll item drop for this wave
        const drop = rollDungeonItemDrop(dungeon, character.level, allItems, isBossWave);
        if (drop) {
            waveItemsRef.current = [...waveItemsRef.current, drop];
            setWaveItems([...waveItemsRef.current]);
            const info = getItemDisplayInfo(drop.itemId);
            const displayName = info?.name_pl ?? formatItemName(drop.itemId);
            addLog(`📦 Drop: ${displayName} [${drop.rarity}]`, 'system');
            // Track drop rarity for quest progress
            useQuestStore.getState().addProgress('drop_rarity', drop.rarity, 1);
        }

        // Track kills for tasks, quests, and mastery (dungeon monsters count too).
        const killedMonster = currentMonsterRef.current;
        if (killedMonster) {
            useTaskStore.getState().addKill(killedMonster.id, killedMonster.level, 1);
            useQuestStore.getState().addProgress('kill', killedMonster.id, 1);
            useDailyQuestStore.getState().addProgress('kill_any', 1);
            // Mastery kills (normal rarity in dungeons — dungeon scales own difficulty)
            useMasteryStore.getState().addMasteryKills(killedMonster.id, 1);

            // Mastery N7: per-kill XP/Gold bonus (+2% per level, cap +50%)
            const killMasteryLvl = useMasteryStore.getState().getMasteryLevel(killedMonster.id);
            const killXpMult = getMasteryXpMultiplier(killMasteryLvl);
            const killGoldMult = getMasteryGoldMultiplier(killMasteryLvl);

            // Accumulate base XP and gold from killed monster
            waveXpRef.current += Math.floor((killedMonster.xp ?? 0) * killXpMult);
            // Gold comes from the base monster data (IDungeonMonster doesn't carry gold)
            const baseMonster = allMonsters.find((m) => m.id === killedMonster.id);
            if (baseMonster) {
                const bmRaw = monstersData as unknown as { id: string; gold: [number, number] }[];
                const bmGold = bmRaw.find((m) => m.id === killedMonster.id)?.gold;
                if (bmGold) {
                    const rawGold = bmGold[0] + Math.floor(Math.random() * (bmGold[1] - bmGold[0] + 1));
                    waveGoldRef.current += Math.floor(rawGold * killGoldMult);
                }
            }
        }

        if (isBossWave) {
            // ALL WAVES CLEARED — reward = accumulated monster XP/gold × 4
            const DUNGEON_REWARD_MULTIPLIER = 4;
            const gold = waveGoldRef.current * DUNGEON_REWARD_MULTIPLIER;
            const xp = waveXpRef.current * DUNGEON_REWARD_MULTIPLIER;
            const items = waveItemsRef.current;

            // Apply rewards
            const inv = useInventoryStore.getState();
            inv.addGold(gold);
            useCharacterStore.getState().addXp(xp);
            for (const gen of items) inv.addItem(buildItem(gen));

            // Spell chest drops (dungeon = 1.5x multiplier)
            const dungeonLvl = dungeon.level ?? 1;
            const chestDrops = rollSpellChestDrop(dungeonLvl, 'normal', true, false);
            const chestNames: string[] = [];
            for (const cd of chestDrops) {
                inv.addSpellChest(cd.chestLevel, cd.count);
                chestNames.push(`${getSpellChestIcon(cd.chestLevel)} ${getSpellChestDisplayName(cd.chestLevel)}`);
            }

            setDungeonCompleted(dungeon.id);
            // Track dungeon completion for quests
            useQuestStore.getState().addProgress('dungeon', dungeon.id, 1);
            useQuestStore.getState().addProgress('complete_dungeons_any', 'any', 1);
            useDailyQuestStore.getState().addProgress('complete_dungeon', 1);
            useDailyQuestStore.getState().addProgress('earn_gold', gold);
            addLog(`🏆 Dungeon ukończony! +${gold} Gold, +${xp} XP`, 'system');
            if (chestNames.length > 0) {
                addLog(`📦 Spell Chests: ${chestNames.join(', ')}`, 'system');
            }
            setResult({ success: true, wavesCleared: totalWaves, playerHpLeft: hp, gold, xp, items });
            setPhase('result');
        } else {
            // Next wave after brief pause
            const nextWave = wave + 1;
            setCurrentWave(nextWave);
            addLog(`✓ Fala ${wave + 1} zaliczona! HP: ${hp}/${charMaxHp}`, 'system');
            setTimeout(() => {
                if (phaseRef.current === 'running') {
                    startWaveMonster(dungeon, nextWave, hp);
                }
            }, 600);
        }
    }, [character, allItems, addLog, setDungeonCompleted, charMaxHp, startWaveMonster]);

    // ── Handle player death ──────────────────────────────────────────────────
    const handlePlayerDeath = useCallback(() => {
        const dungeon = activeDungeonRef.current;
        if (!dungeon) return;
        const wave = currentWaveRef.current;
        const totalWaves = getDungeonWaves(dungeon);

        // Apply death penalty (same as normal combat)
        const char = useCharacterStore.getState().character;
        if (char) {
            // Log death to global deaths feed (best-effort)
            void deathsApi.logDeath({
                character_id: char.id,
                character_name: char.name,
                character_class: char.class,
                character_level: char.level,
                source: 'dungeon',
                source_name: dungeon.name_pl,
                source_level: dungeon.level,
            });

            // Death Protection: saves level/XP. AoL: saves items. Both consumed independently.
            const usedDeathProtection = useInventoryStore.getState().useConsumable('death_protection');
            const usedAol = useInventoryStore.getState().useConsumable('amulet_of_loss');

            useCharacterStore.getState().fullHealEffective();

            const oldLevel = char.level;
            let newLevel = char.level;
            let levelsLost = 0;
            let xpPercent = 100;

            if (usedDeathProtection) {
                addLog('🛡️ Eliksir Ochrony uchronił Cię od utraty poziomu!', 'system');
            } else {
                const penalty = applyDeathPenalty(char.level, char.xp);
                newLevel = penalty.newLevel;
                levelsLost = penalty.levelsLost;
                xpPercent = penalty.xpPercent;
                const currentHighest = char.highest_level ?? char.level;
                const preservedHighest = Math.max(currentHighest, char.level);
                useCharacterStore.getState().updateCharacter({
                    xp: penalty.newXp,
                    level: penalty.newLevel,
                    highest_level: preservedHighest,
                });
                useCharacterStore.getState().fullHealEffective();
                useSkillStore.getState().applyDeathPenalty(char.class);
                if (penalty.levelsLost > 0) {
                    addLog(`💀 Poległeś na fali ${wave + 1}/${totalWaves}! Tracisz poziom: ${char.level} → ${penalty.newLevel} (${penalty.xpPercent}% XP zachowane) · -5% Skill XP`, 'system');
                } else {
                    addLog(`💀 Poległeś na fali ${wave + 1}/${totalWaves}! Dungeon nieukończony. -50% XP · -5% Skill XP`, 'system');
                }
            }

            // Item loss with optional Amulet of Loss protection
            const itemsLost = useInventoryStore.getState().applyDeathItemLoss(usedAol);
            if (usedAol) {
                addLog('🔱 Amulet of Loss roztrzaskal sie i ochronil Twoje przedmioty!', 'system');
            } else if (itemsLost > 0) {
                addLog(`💀 Stracileś ${itemsLost} przedmiot(ow) przy śmierci!`, 'system');
            }
            void saveCurrentCharacterStores();

            // Trigger epic death overlay (auto-navigates to town)
            useDeathStore.getState().triggerDeath({
                killedBy: dungeon.name_pl,
                sourceLevel: dungeon.level,
                oldLevel,
                newLevel,
                levelsLost,
                xpPercent,
                protectionUsed: usedDeathProtection,
                source: 'dungeon',
            });
        } else {
            addLog(`💀 Poległeś na fali ${wave + 1}/${totalWaves}! Dungeon nieukończony.`, 'system');
        }

        setResult({ success: false, wavesCleared: wave, playerHpLeft: 0, gold: 0, xp: 0, items: [] });
        setPhase('result');
    }, [addLog]);

    // ── Manual skill use (click a slot when skillMode === 'manual') ──────────
    const doManualSkill = useCallback((slotIdx: 0 | 1 | 2 | 3) => {
        if (phaseRef.current !== 'running') return;
        if (monsterHpRef.current <= 0) return;
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
            Math.floor(charAtk * 0.15 * getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier()),
        );
        const afterSkill = Math.max(0, monsterHpRef.current - skillDmg);
        monsterHpRef.current = afterSkill;
        setMonsterCurrentHp(afterSkill);
        const newMp = Math.max(0, playerMpRef.current - SKILL_MP_COST);
        playerMpRef.current = newMp;
        setPlayerMp(newMp);
        skillCooldownRef.current.set(skillId, now);
        setSkillCooldowns((prev) => ({ ...prev, [skillId]: SKILL_COOLDOWN_MS }));
        { const sd = getSkillDef(skillId); if (sd) applySkillBuff(skillId, sd); }
        triggerSkillAnim(skillId);
        showFloatingDmg(`-${skillDmg}`, 'player');
        addLog(`✨ ${formatSkillName(skillId)}: ${skillDmg} dmg (-${SKILL_MP_COST} MP)`, 'player');
        // MLVL XP from skill use (all classes)
        if (character) {
            useSkillStore.getState().addMlvlXpFromSkill(character.class);
        }
        if (afterSkill <= 0) {
            handleWaveMonsterDeath();
        }
    }, [addLog, charAtk, character, handleWaveMonsterDeath, showFloatingDmg]);

    // ── Player attack callback ───────────────────────────────────────────────
    const doPlayerAttack = useCallback(() => {
        if (phaseRef.current !== 'running') return;
        const mHp = monsterHpRef.current;
        if (mHp <= 0) return;

        const isDualWield = !!classesDataMap[character?.class ?? '']?.dualWield;

        // ── Helper: single hit with weapon roll ─────────────────────────────
        const doSingleHit = (hand: 'left' | 'right' | undefined, weaponRollFn: () => number, dmgPercent: number) => {
            if (monsterHpRef.current <= 0 || phaseRef.current !== 'running') return 0;
            const wRoll = Math.floor(weaponRollFn() * dmgPercent);
            const totalAtk = charAtk + wRoll;
            const baseDmg = Math.max(1, totalAtk - (currentMonsterRef.current?.defense ?? 0));
            const variance = Math.floor(baseDmg * 0.2);
            const rolledDmg = Math.max(1, baseDmg - variance + Math.floor(Math.random() * (variance * 2 + 1)));
            const finalDmg = Math.max(1, Math.floor(rolledDmg * getAtkDamageMultiplier() * getTransformDmgMultiplier()));

            const newMHp = Math.max(0, monsterHpRef.current - finalDmg);
            monsterHpRef.current = newMHp;
            setMonsterCurrentHp(newMHp);

            setMonsterHit(true);
            setPlayerAttacking(true);
            const animDur = ATTACK_ANIM_DURATION[character?.class ?? ''] ?? 350;
            setTimeout(() => { setMonsterHit(false); setPlayerAttacking(false); }, animDur);

            if (hand) {
                showFloatingDmg(`🗡️ -${finalDmg}`, 'player', hand);
            } else {
                showFloatingDmg(`-${finalDmg}`, 'player');
            }

            const handPrefix = hand === 'left' ? '[Lewa] ' : hand === 'right' ? '[Prawa] ' : '';
            addLog(`${handPrefix}Atakujesz za ${finalDmg} dmg (HP: ${newMHp}/${monsterMaxHp})`, 'player');
            return finalDmg;
        };

        // ── Execute attack(s) ────────────────────────────────────────────────
        let totalHitDmg = 0;
        if (isDualWield) {
            // Hit 1: left hand (mainHand, 60%)
            totalHitDmg += doSingleHit('left', rollWeaponDamage, 0.6);
            // Hit 2: right hand (offHand, 60%) – 150ms delay
            setTimeout(() => {
                if (phaseRef.current !== 'running' || monsterHpRef.current <= 0) return;
                doSingleHit('right', rollOffHandDamage, 0.6);
                if (monsterHpRef.current <= 0) {
                    handleWaveMonsterDeath();
                }
            }, 150);
        } else {
            // Normal: use full charAtk (weapon roll already included in charAtk)
            const baseDmg = Math.max(1, charAtk - (currentMonster?.defense ?? 0));
            const variance = Math.floor(baseDmg * 0.2);
            const rolledDmg = Math.max(1, baseDmg - variance + Math.floor(Math.random() * (variance * 2 + 1)));
            const finalDmg = Math.max(1, Math.floor(rolledDmg * getAtkDamageMultiplier() * getTransformDmgMultiplier()));
            const newMHp = Math.max(0, monsterHpRef.current - finalDmg);
            monsterHpRef.current = newMHp;
            setMonsterCurrentHp(newMHp);

            setMonsterHit(true);
            setPlayerAttacking(true);
            const animDur = ATTACK_ANIM_DURATION[character?.class ?? ''] ?? 350;
            setTimeout(() => { setMonsterHit(false); setPlayerAttacking(false); }, animDur);
            showFloatingDmg(`-${finalDmg}`, 'player');
            addLog(`Atakujesz za ${finalDmg} dmg (HP: ${newMHp}/${monsterMaxHp})`, 'player');
            totalHitDmg = finalDmg;
        }

        // Grant skill XP from attack (weapon skill for non-magic + MLVL for magic classes)
        if (character) {
            useSkillStore.getState().addWeaponSkillXpFromAttack(character.class);
            useSkillStore.getState().addMlvlXpFromAttack(character.class);
        }

        // Auto-skill fire (check all 4 slots) – only when skill mode is AUTO
        const currentMHp = monsterHpRef.current;
        if (currentMHp > 0 && useSettingsStore.getState().skillMode === 'auto') {
            const now = Date.now();
            const slots = useSkillStore.getState().activeSkillSlots;
            for (let i = 0; i < 4; i++) {
                const skillId = slots[i];
                if (!skillId) continue;
                const lastUsed = skillCooldownRef.current.get(skillId) ?? 0;
                if (now - lastUsed < SKILL_COOLDOWN_MS) continue;
                if (playerMpRef.current < SKILL_MP_COST) continue;
                // Fire skill: bonus damage = 15% of charAtk
                const skillDmg = Math.max(1, Math.floor(charAtk * 0.15 * getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier()));
                const afterSkill = Math.max(0, monsterHpRef.current - skillDmg);
                monsterHpRef.current = afterSkill;
                setMonsterCurrentHp(afterSkill);
                const newMp = Math.max(0, playerMpRef.current - SKILL_MP_COST);
                playerMpRef.current = newMp;
                setPlayerMp(newMp);
                skillCooldownRef.current.set(skillId, now);
                setSkillCooldowns((prev) => ({ ...prev, [skillId]: SKILL_COOLDOWN_MS }));
                { const sd = getSkillDef(skillId); if (sd) applySkillBuff(skillId, sd); }
                triggerSkillAnim(skillId);
                addLog(`✨ ${formatSkillName(skillId)}: ${skillDmg} dmg (-${SKILL_MP_COST} MP)`, 'player');
                if (afterSkill <= 0) { handleWaveMonsterDeath(); return; }
                break; // One skill per attack tick
            }
        }

        // Auto-potion check
        tryAutoPotion();

        if (monsterHpRef.current <= 0) {
            handleWaveMonsterDeath();
        }
    }, [charAtk, addLog, showFloatingDmg, handleWaveMonsterDeath, monsterMaxHp, currentMonster, tryAutoPotion, character]);

    // ── Monster attack callback ──────────────────────────────────────────────
    const doMonsterAttack = useCallback(() => {
        if (phaseRef.current !== 'running') return;
        if (monsterHpRef.current <= 0) return;

        const mAtk = currentMonster ? rollMonsterDamage(currentMonster) : 0;
        const rawDmg = Math.max(1, mAtk - charDef);

        // ── Utamo Vita (Magic Shield): 50% dmg → MP ─────────────────
        let hpDmg = rawDmg;
        let mpDmg = 0;
        const hasUtamoDng = useBuffStore.getState().hasBuff('utamo_vita');
        if (hasUtamoDng && playerMpRef.current > 0) {
            mpDmg = Math.floor(rawDmg * 0.5);
            hpDmg = rawDmg - mpDmg;
            if (mpDmg > playerMpRef.current) {
                const overflow = mpDmg - playerMpRef.current;
                mpDmg = playerMpRef.current;
                hpDmg += overflow;
            }
            const newMpAfterShield = Math.max(0, playerMpRef.current - mpDmg);
            playerMpRef.current = newMpAfterShield;
            setPlayerMp(newMpAfterShield);
            if (newMpAfterShield <= 0) {
                useBuffStore.getState().removeBuffByEffect('utamo_vita');
                addLog('🔵 Utamo Vita peka! Brak many.', 'system');
            }
        }

        const newPHp = Math.max(0, playerHpRef.current - hpDmg);
        playerHpRef.current = newPHp;
        setPlayerHp(newPHp);

        // Animation
        setPlayerHit(true);
        setTimeout(() => setPlayerHit(false), 300);
        showFloatingDmg(`-${rawDmg}${hasUtamoDng && mpDmg > 0 ? ' 🔵' : ''}`, 'monster');

        const utamoSuffix = hasUtamoDng && mpDmg > 0 ? ` 🔵 (${hpDmg} HP / ${mpDmg} MP)` : '';
        addLog(`${currentMonster?.name_pl ?? 'Potwór'} atakuje za ${rawDmg} dmg${utamoSuffix} (HP: ${newPHp}/${charMaxHp})`, 'monster');

        if (newPHp > 0) {
            tryAutoPotion();
        }

        if (newPHp <= 0) {
            handlePlayerDeath();
        }
    }, [currentMonster, charDef, charMaxHp, addLog, showFloatingDmg, handlePlayerDeath, tryAutoPotion]);

    // ── Refs for stable intervals ────────────────────────────────────────────
    const playerAtkRef  = useRef(doPlayerAttack);
    const monsterAtkRef = useRef(doMonsterAttack);
    useEffect(() => { playerAtkRef.current  = doPlayerAttack; });
    useEffect(() => { monsterAtkRef.current = doMonsterAttack; });

    // ── Attack intervals (scaled by speedMult) ───────────────────────────────
    useEffect(() => {
        if (phase !== 'running' || !currentMonster) return;
        const interval = Math.max(200, getAttackMs(charSpeed) / speedMult);
        const id = setInterval(() => playerAtkRef.current(), interval);
        return () => clearInterval(id);
    }, [phase, currentMonster?.id, charSpeed, speedMult]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (phase !== 'running' || !currentMonster) return;
        const monsterSpeed = 1.5; // dungeon monsters attack every ~2s base
        const interval = Math.max(200, getAttackMs(monsterSpeed) / speedMult);
        const id = setInterval(() => monsterAtkRef.current(), interval);
        return () => clearInterval(id);
    }, [phase, currentMonster?.id, speedMult]); // eslint-disable-line react-hooks/exhaustive-deps

    const totalWaves = activeDungeon ? getDungeonWaves(activeDungeon) : 0;
    // isBossWave computed inline where needed (inside wave completion handler)
    const currentTypeBadge = MONSTER_TYPE_BADGES[waveMonsterType];
    const showTypeBadge = waveMonsterType !== 'Normal';

    return (
        <div className="dungeon">
            <header className="dungeon__header page-header">
                <button className="dungeon__back page-back-btn" onClick={() => { setPhase('list'); navigate('/'); }}>
                    ← Miasto
                </button>
                <h1 className="dungeon__title page-title">Dungeony</h1>
                {phase === 'running' && activeDungeon && (
                    <span className="dungeon__wave-counter">
                        Fala {currentWave + 1}/{totalWaves}
                    </span>
                )}
            </header>

            <AnimatePresence mode="wait">

                {/* ── List ──────────────────────────────────────────────────────── */}
                {phase === 'list' && (
                    <motion.div key="list" className="dungeon__panel"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        {dungeons.map((d) => {
                            const attemptsUsed = getAttemptsUsed(d.id);
                            const attemptsMax  = getAttemptsMax();
                            const noAttempts   = !canEnter(d.id);
                            const tooLow       = character.level < getDungeonMinLevel(d);
                            const blocked      = noAttempts || tooLow;

                            const isExpanded = expandedDungeon === d.id;
                            const dungeonLvl = getDungeonMinLevel(d);
                            const itemTiers = getDungeonItemDropTiers();
                            const stoneDrops = getDungeonStoneDrops(dungeonLvl);

                            const allDone = attemptsUsed >= attemptsMax;

                            return (
                                <div
                                    key={d.id}
                                    className={`dungeon__card${blocked ? ' dungeon__card--blocked' : ''}${allDone ? ' dungeon__card--all-done' : ''}`}
                                    style={{ '--card-hue': getDungeonCardHue(dungeonLvl) } as React.CSSProperties}
                                >
                                    <div className="dungeon__card-top">
                                        <span className="dungeon__card-icon">{getDungeonIcon(d.id)}</span>
                                        <span className="dungeon__card-name">{d.name_pl}</span>
                                    </div>
                                    <p className="dungeon__card-desc">{d.description_pl}</p>
                                    {(() => {
                                        const est = estimateDungeonRewards(d, allMonsters, monstersRaw);
                                        return (
                                            <div className="dungeon__card-meta">
                                                <span>Lvl {dungeonLvl}+</span>
                                                <span>{getDungeonWaves(d)} fal</span>
                                                <span>💰 {est.goldMin}–{est.goldMax}</span>
                                                <span>⭐ ~{est.xp} XP</span>
                                            </div>
                                        );
                                    })()}

                                    {/* Drop table toggle */}
                                    <button
                                        className={`dungeon__drop-toggle${isExpanded ? ' dungeon__drop-toggle--open' : ''}`}
                                        onClick={() => setExpandedDungeon(isExpanded ? null : d.id)}
                                    >
                                        📦 Drop table {isExpanded ? '▲' : '▼'}
                                    </button>

                                    {isExpanded && (
                                        <div className="dungeon__drop-table">
                                            {(() => {
                                                const estDrop = estimateDungeonRewards(d, allMonsters, monstersRaw);
                                                return (
                                                    <div className="dungeon__drop-section">
                                                        <div className="dungeon__drop-section-title">💰 Nagrody (potwory ×4)</div>
                                                        <div className="dungeon__drop-info">
                                                            Gold: {estDrop.goldMin}–{estDrop.goldMax}
                                                        </div>
                                                        <div className="dungeon__drop-info">
                                                            XP: ~{estDrop.xp}
                                                        </div>
                                                        <div className="dungeon__drop-info">
                                                            Fale: {getDungeonWaves(d)} · Lvl itemów: {dungeonLvl}
                                                        </div>
                                                    </div>
                                                );
                                            })()}

                                            <div className="dungeon__drop-section">
                                                <div className="dungeon__drop-section-title">💎 Kamienie ulepszania</div>
                                                {stoneDrops.map((stone) => (
                                                    <div key={stone.name} className="dungeon__drop-tier">
                                                        <span className="dungeon__drop-dot" style={{ background: '#9e9e9e' }} />
                                                        <span className="dungeon__drop-tier-name">{stone.name}</span>
                                                        <span className="dungeon__drop-tier-chance">{stone.chance}%</span>
                                                    </div>
                                                ))}
                                            </div>

                                            <div className="dungeon__drop-section">
                                                <div className="dungeon__drop-section-title">🎒 Przedmioty (Lvl {dungeonLvl})</div>
                                                {itemTiers.map((tier) => (
                                                    <div key={tier.key} className="dungeon__drop-tier">
                                                        <span className="dungeon__drop-dot" style={{ background: tier.color, boxShadow: `0 0 4px ${tier.color}` }} />
                                                        <span className="dungeon__drop-tier-name" style={{ color: tier.color }}>{tier.label}</span>
                                                        <span className="dungeon__drop-tier-chance">{tier.chance}%</span>
                                                    </div>
                                                ))}
                                                <div className="dungeon__drop-note">Brak Heroic itemów z dungeonów (tylko z bossów)</div>
                                            </div>

                                            {(() => {
                                                const potionInfo = getPotionDropInfo(dungeonLvl);
                                                return (
                                                    <div className="dungeon__drop-section">
                                                        <div className="dungeon__drop-section-title">🧪 Potiony</div>
                                                        <div className="dungeon__drop-tier">
                                                            <span className="dungeon__drop-dot" style={{ background: '#e57373' }} />
                                                            <span className="dungeon__drop-tier-name" style={{ color: '#e57373' }}>
                                                                ❤️ {potionInfo.hpLabel} ({potionInfo.hpHeal})
                                                            </span>
                                                            <span className="dungeon__drop-tier-chance">{(HP_POTION_DROP_CHANCE * 100).toFixed(0)}%</span>
                                                        </div>
                                                        <div className="dungeon__drop-tier">
                                                            <span className="dungeon__drop-dot" style={{ background: '#64b5f6' }} />
                                                            <span className="dungeon__drop-tier-name" style={{ color: '#64b5f6' }}>
                                                                💙 {potionInfo.mpLabel} ({potionInfo.mpHeal})
                                                            </span>
                                                            <span className="dungeon__drop-tier-chance">{(MP_POTION_DROP_CHANCE * 100).toFixed(0)}%</span>
                                                        </div>
                                                    </div>
                                                );
                                            })()}

                                            {/* Spell chest drops */}
                                            {(() => {
                                                const chestInfo = getSpellChestDropInfo(dungeonLvl);
                                                if (chestInfo.levels.length === 0) return null;
                                                return (
                                                    <div className="dungeon__drop-section">
                                                        <div className="dungeon__drop-section-title">📦 Spell Chests (x1.5 w dungeonie)</div>
                                                        {chestInfo.levels.map((lvl) => (
                                                            <div key={lvl} className="dungeon__drop-tier">
                                                                <span className="dungeon__drop-dot" style={{ background: '#ab47bc' }} />
                                                                <span className="dungeon__drop-tier-name" style={{ color: '#ab47bc' }}>
                                                                    {getSpellChestIcon(lvl)} Lvl {lvl}
                                                                </span>
                                                                <span className="dungeon__drop-tier-chance">{(chestInfo.baseChance * 150).toFixed(1)}%</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}

                                    <div className="dungeon__card-footer">
                                        <div className="dungeon__attempts">
                                            <span>⚔️ {attemptsUsed}/{attemptsMax}</span>
                                            <div className="dungeon__attempts-bar">
                                                <div
                                                    className={`dungeon__attempts-bar-fill${allDone ? ' dungeon__attempts-bar-fill--full' : ''}`}
                                                    style={{ width: `${(attemptsUsed / attemptsMax) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                        {noAttempts && (
                                            <span className="dungeon__cooldown">❌ Brak prób · reset o północy</span>
                                        )}
                                        {!noAttempts && tooLow && (
                                            <span className="dungeon__locked">🔒 Lvl {getDungeonMinLevel(d)}</span>
                                        )}
                                        {!blocked && (
                                            <button className="dungeon__enter-btn" onClick={() => handleStart(d)}>
                                                Wejdź
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </motion.div>
                )}

                {/* ── Running (real combat) ─────────────────────────────────────── */}
                {phase === 'running' && activeDungeon && currentMonster && (
                    <motion.div key="running" className="dungeon__panel"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

                        {/* Arena */}
                        <div className="dungeon__arena">
                            {/* Monster card */}
                            <div className={`dungeon__combat-card dungeon__combat-card--monster${monsterHit ? ' dungeon__combat-card--hit' : ''}${playerAttacking ? ` dungeon__combat-card--attack-${character.class}` : ''}`}>
                                {showTypeBadge && (
                                    <div
                                        className="dungeon__boss-combat-badge"
                                        style={{
                                            background: `${currentTypeBadge.color}14`,
                                            border: `1px solid ${currentTypeBadge.color}66`,
                                            color: currentTypeBadge.color,
                                            textShadow: 'none',
                                        }}
                                    >
                                        {currentTypeBadge.icon} {currentTypeBadge.label}
                                    </div>
                                )}
                                <div className="dungeon__combat-card-header">
                                    <motion.span
                                        className="dungeon__combat-sprite"
                                        animate={monsterHit ? { scale: [1, 0.8, 1.1, 1], rotate: [0, -5, 5, 0] } : {}}
                                        transition={{ duration: 0.3 }}
                                    >
                                        {currentMonster.sprite}
                                    </motion.span>
                                    <div className="dungeon__combat-card-info">
                                        <span className="dungeon__combat-card-name">{currentMonster.name_pl}</span>
                                        <span className="dungeon__combat-card-sub">
                                            Lvl {currentMonster.level} · Fala {currentWave + 1}/{totalWaves}{showTypeBadge ? ` · ${currentTypeBadge.label}` : ''}
                                        </span>
                                    </div>
                                    <span className="dungeon__combat-hp-text">{Math.max(0, monsterCurrentHp)}/{monsterMaxHp}</span>
                                </div>
                                <HpBar current={monsterCurrentHp} max={monsterMaxHp} variant="enemy" />

                                {/* Floating damage on monster (from player) */}
                                <AnimatePresence>
                                    {floatingDmgs.filter((d) => d.type === 'player').map((d) => (
                                        <motion.div
                                            key={d.id}
                                            className={`dungeon__floating-dmg dungeon__floating-dmg--player${d.side ? ` dungeon__floating-dmg--${d.side}` : ''}`}
                                            initial={{ opacity: 1, y: 0, x: d.side === 'left' ? -60 : d.side === 'right' ? 60 : 0 }}
                                            animate={{ opacity: 0, y: -40, x: d.side === 'left' ? -60 : d.side === 'right' ? 60 : 0, scale: 0.8 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.8, ease: 'easeOut' }}
                                        >
                                            {d.text}
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                                {skillAnimOverlay && (
                                    <div className={`skill-anim-overlay ${skillAnimOverlay.anim.cssClass}`}>
                                        <span className="skill-anim-emoji">{skillAnimOverlay.anim.emoji}</span>
                                    </div>
                                )}
                            </div>

                            {/* Player card */}
                            <div className={`dungeon__combat-card dungeon__combat-card--player${playerHit ? ' dungeon__combat-card--hit' : ''}`}>
                                <div className="dungeon__combat-card-header">
                                    <div className="dungeon__player-avatar-wrap">
                                        <img
                                            src={playerAvatarSrc}
                                            alt={character.class}
                                            className="dungeon__player-avatar"
                                        />
                                        <span className="dungeon__player-avatar-lvl">Lvl {character.level}</span>
                                    </div>
                                    <div className="dungeon__combat-card-info">
                                        <span className="dungeon__combat-card-name">{character.name}</span>
                                        <span className="dungeon__combat-card-sub">{CLASS_ICONS[character.class] ?? '?'} {character.class}</span>
                                    </div>
                                </div>
                                {/* Floating damage on player */}
                                <AnimatePresence>
                                    {floatingDmgs.filter((d) => d.type === 'monster').map((d) => (
                                        <motion.div
                                            key={d.id}
                                            className="dungeon__floating-dmg dungeon__floating-dmg--monster"
                                            initial={{ opacity: 1, y: 0 }}
                                            animate={{ opacity: 0, y: -35 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.8, ease: 'easeOut' }}
                                        >
                                            {d.text}
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                                <div className="dungeon__combat-stat-row">
                                    <span className="dungeon__combat-stat-label">HP</span>
                                    <HpBar current={playerHp} max={charMaxHp} variant="hp" />
                                    <span className="dungeon__combat-hp-text">{Math.max(0, playerHp)}/{charMaxHp}</span>
                                </div>
                                <div className="dungeon__combat-stat-row">
                                    <span className="dungeon__combat-stat-label">MP</span>
                                    <HpBar current={playerMp} max={charMaxMp} variant="mp" />
                                    <span className="dungeon__combat-hp-text">{Math.max(0, playerMp)}/{charMaxMp}</span>
                                </div>
                            </div>

                            {/* Skill slots */}
                            <div className="dungeon__skill-slots">
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
                                                'dungeon__skill-slot',
                                                isEmpty ? 'dungeon__skill-slot--empty' : 'dungeon__skill-slot--filled',
                                                cdActive ? 'dungeon__skill-slot--on-cooldown' : '',
                                                !isEmpty && isManual && !cdActive ? 'dungeon__skill-slot--manual' : '',
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
                                                    className="dungeon__skill-cd-overlay"
                                                    style={{ height: `${cdFraction * 100}%` }}
                                                />
                                            )}
                                            <span className="dungeon__skill-slot-name">{formatSkillName(skillId)}</span>
                                            {!isEmpty && (
                                                <span className="dungeon__skill-slot-badge">
                                                    {cdActive ? `${Math.ceil(cdRemaining / 1000)}s`
                                                        : isManual ? `${SKILL_MP_COST}MP`
                                                        : 'AUTO'}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Combat toggles */}
                            <div className="dungeon__combat-toggles">
                                <button
                                    className={`dungeon__toggle-btn dungeon__toggle-btn--speed dungeon__toggle-btn--speed-${speedMode}`}
                                    onClick={cycleSpeed}
                                    title="Prędkość walki"
                                >
                                    ⏱ {speedMode.toUpperCase()}
                                </button>
                                <button
                                    className={`dungeon__toggle-btn dungeon__toggle-btn--${skillMode}`}
                                    onClick={() => setSkillMode(skillMode === 'auto' ? 'manual' : 'auto')}
                                >
                                    {skillMode === 'auto' ? '🔄 Skille: AUTO' : '👆 Skille: MANUAL'}
                                </button>
                                <button
                                    className={`dungeon__toggle-btn dungeon__toggle-btn--potion${autoPotionHpEnabled || autoPotionMpEnabled ? '' : ' dungeon__toggle-btn--off'}`}
                                    onClick={() => {
                                        const newState = !(autoPotionHpEnabled || autoPotionMpEnabled);
                                        useSettingsStore.getState().setAutoPotionHpEnabled(newState);
                                        useSettingsStore.getState().setAutoPotionMpEnabled(newState);
                                    }}
                                >
                                    {(autoPotionHpEnabled || autoPotionMpEnabled) ? '🧪 Auto-Potion: ON' : '🧪 Auto-Potion: OFF'}
                                </button>
                            </div>

                            {/* Potion buttons */}
                            <div className="dungeon__potions">
                                {bestHpPotion && (() => {
                                    const count = consumables[bestHpPotion.id] ?? 0;
                                    const hpCdActive = hpPotionCooldown > 0;
                                    const hpCdFraction = hpCdActive ? hpPotionCooldown / POTION_COOLDOWN_MS : 0;
                                    return (
                                        <button
                                            className={`dungeon__potion-btn dungeon__potion-btn--hp${hpCdActive ? ' dungeon__potion-btn--cooldown' : ''}`}
                                            onClick={() => doUsePotion(bestHpPotion.id)}
                                            disabled={count === 0 || hpCdActive}
                                            title={hpCdActive ? `Cooldown: ${Math.ceil(hpPotionCooldown / 1000)}s` : count === 0 ? 'Brak eliksirów HP' : bestHpPotion.description_pl}
                                        >
                                            {hpCdActive && (
                                                <span className="dungeon__potion-cd-overlay" style={{ height: `${hpCdFraction * 100}%` }} />
                                            )}
                                            <span className="dungeon__potion-label">{bestHpPotion.icon} {getPotionLabel(bestHpPotion.effect)}</span>
                                            <span className="dungeon__potion-count">x{count}</span>
                                        </button>
                                    );
                                })()}
                                {bestMpPotion && (() => {
                                    const count = consumables[bestMpPotion.id] ?? 0;
                                    const mpCdActive = mpPotionCooldown > 0;
                                    const mpCdFraction = mpCdActive ? mpPotionCooldown / POTION_COOLDOWN_MS : 0;
                                    return (
                                        <button
                                            className={`dungeon__potion-btn dungeon__potion-btn--mp${mpCdActive ? ' dungeon__potion-btn--cooldown' : ''}`}
                                            onClick={() => doUsePotion(bestMpPotion.id)}
                                            disabled={count === 0 || mpCdActive}
                                            title={mpCdActive ? `Cooldown: ${Math.ceil(mpPotionCooldown / 1000)}s` : count === 0 ? 'Brak eliksirów MP' : bestMpPotion.description_pl}
                                        >
                                            {mpCdActive && (
                                                <span className="dungeon__potion-cd-overlay" style={{ height: `${mpCdFraction * 100}%` }} />
                                            )}
                                            <span className="dungeon__potion-label">{bestMpPotion.icon} {getPotionLabel(bestMpPotion.effect)}</span>
                                            <span className="dungeon__potion-count">x{count}</span>
                                        </button>
                                    );
                                })()}
                                {/* Pct HP Potion */}
                                {bestPctHpPotion && (() => {
                                    const count = consumables[bestPctHpPotion.id] ?? 0;
                                    const cdActive = pctHpCooldown > 0;
                                    const cdFraction = cdActive ? pctHpCooldown / PCT_POTION_COOLDOWN_MS : 0;
                                    return (
                                        <button
                                            className={`dungeon__potion-btn dungeon__potion-btn--pct-hp${cdActive ? ' dungeon__potion-btn--cooldown' : ''}${count === 0 ? ' dungeon__potion-btn--empty' : ''}`}
                                            onClick={() => doUsePotion(bestPctHpPotion.id)}
                                            disabled={count === 0 || cdActive}
                                            title={cdActive ? `Cooldown: ${Math.ceil(pctHpCooldown / 1000)}s` : count === 0 ? 'Brak % potionów HP' : bestPctHpPotion.description_pl}
                                        >
                                            {cdActive && (
                                                <span className="dungeon__potion-cd-overlay" style={{ height: `${cdFraction * 100}%` }} />
                                            )}
                                            <span className="dungeon__potion-label">❤️‍🔥 {getPotionLabel(bestPctHpPotion.effect)}</span>
                                            <span className="dungeon__potion-count">x{count}</span>
                                        </button>
                                    );
                                })()}
                                {/* Pct MP Potion */}
                                {bestPctMpPotion && (() => {
                                    const count = consumables[bestPctMpPotion.id] ?? 0;
                                    const cdActive = pctMpCooldown > 0;
                                    const cdFraction = cdActive ? pctMpCooldown / PCT_POTION_COOLDOWN_MS : 0;
                                    return (
                                        <button
                                            className={`dungeon__potion-btn dungeon__potion-btn--pct-mp${cdActive ? ' dungeon__potion-btn--cooldown' : ''}${count === 0 ? ' dungeon__potion-btn--empty' : ''}`}
                                            onClick={() => doUsePotion(bestPctMpPotion.id)}
                                            disabled={count === 0 || cdActive}
                                            title={cdActive ? `Cooldown: ${Math.ceil(pctMpCooldown / 1000)}s` : count === 0 ? 'Brak % potionów MP' : bestPctMpPotion.description_pl}
                                        >
                                            {cdActive && (
                                                <span className="dungeon__potion-cd-overlay" style={{ height: `${cdFraction * 100}%` }} />
                                            )}
                                            <span className="dungeon__potion-label">💎 {getPotionLabel(bestPctMpPotion.effect)}</span>
                                            <span className="dungeon__potion-count">x{count}</span>
                                        </button>
                                    );
                                })()}
                            </div>

                            {/* Flee button */}
                            <button
                                className="dungeon__flee-btn"
                                onClick={() => {
                                    setResult({ success: false, wavesCleared: currentWave, playerHpLeft: playerHp, gold: 0, xp: 0, items: [] });
                                    setPhase('result');
                                }}
                            >
                                Uciekaj z dungeonu
                            </button>
                        </div>

                        {/* Combat log */}
                        <div className="dungeon__combat-log">
                            {combatLog.map((entry) => (
                                <div key={entry.id} className={`dungeon__combat-log-entry dungeon__combat-log-entry--${entry.type}`}>
                                    {entry.text}
                                </div>
                            ))}
                            <div ref={logEndRef} />
                        </div>
                    </motion.div>
                )}

                {/* ── Result ────────────────────────────────────────────────────── */}
                {phase === 'result' && result && activeDungeon && (
                    <motion.div key="result" className="dungeon__panel"
                        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                        <div className={`dungeon__result${result.success ? ' dungeon__result--win' : ' dungeon__result--loss'}`}>
                            <div className="dungeon__result-title">
                                {result.success ? '🏆 Ukończono!' : '💀 Porażka'}
                            </div>
                            <div className="dungeon__result-dungeon">{activeDungeon.name_pl}</div>

                            {result.success ? (
                                <div className="dungeon__rewards">
                                    <div className="dungeon__reward-row"><span>💰 Gold</span><span>+{result.gold}</span></div>
                                    <div className="dungeon__reward-row"><span>⭐ XP</span><span>+{result.xp}</span></div>
                                    {result.items.length > 0 ? (
                                        <div className="dungeon__drops">
                                            <div className="dungeon__drops-title">Zdobyte przedmioty ({result.items.length})</div>
                                            <div className="dungeon__drops-grid">
                                                {result.items.map((item, i) => {
                                                    const info = getItemDisplayInfo(item.itemId);
                                                    const displayName = info?.name_pl ?? formatItemName(item.itemId);
                                                    const icon = info?.icon ?? '📦';
                                                    return (
                                                        <div key={i} className="dungeon__drop-item">
                                                            <ItemIcon icon={icon} rarity={item.rarity} size="md" />
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="dungeon__no-drops">Brak przedmiotów tym razem.</div>
                                    )}
                                </div>
                            ) : (
                                <p className="dungeon__fail-msg">
                                    Polegli na fali {result.wavesCleared + 1}/{getDungeonWaves(activeDungeon)}. Żadnych nagród.
                                </p>
                            )}

                            <div className="dungeon__result-actions">
                                {canEnter(activeDungeon.id) && (
                                    <button
                                        className="dungeon__retry-btn"
                                        onClick={() => handleStart(activeDungeon)}
                                    >
                                        🔄 Ponów dungeon
                                    </button>
                                )}
                                <button className="dungeon__back-btn" onClick={() => setPhase('list')}>
                                    ← Lista dungeonów
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default Dungeon;
