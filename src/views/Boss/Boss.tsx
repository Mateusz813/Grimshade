import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import bossData from '../../data/bosses.json';
import itemsData from '../../data/items.json';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useSkillStore } from '../../stores/skillStore';
import { useBossStore } from '../../stores/bossStore';
import { useBossScoreStore } from '../../stores/bossScoreStore';
import { usePartyStore } from '../../stores/partyStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useBuffStore } from '../../stores/buffStore';
import { ELIXIRS } from '../../stores/shopStore';
import { resolveAutoPotionElixir } from '../../systems/potionSystem';
import { applyDeathPenalty } from '../../systems/levelSystem';
import { applySkillBuff, getSkillDef } from '../../systems/skillBuffs';
import { useSkillAnim } from '../../hooks/useSkillAnim';
import { saveCurrentCharacterStores } from '../../stores/characterScope';
import { deathsApi } from '../../api/v1/deathsApi';
import { useDeathStore } from '../../stores/deathStore';
import {
    isBossEnraged,
    getBossRecommendedLevel,
    getBossPhaseMultiplier,
    getScaledBossStats,
    rollBossGold,
    rollBossLoot,
    getBossXp,
    BOSS_REWARD_MULTIPLIER,
    type IBoss,
    type IBossResult,
    type IBossUniqueItem,
} from '../../systems/bossSystem';
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
import { flattenItemsData, getTotalEquipmentStats, formatItemName, type IBaseItem } from '../../systems/itemSystem';
import { getItemDisplayInfo, generateRandomItemForClass } from '../../systems/itemGenerator';
import { getPotionDropInfo, rollSpellChestDrop, getSpellChestIcon, getSpellChestDisplayName, getSpellChestDropInfo } from '../../systems/lootSystem';
import { getTrainingBonuses } from '../../systems/skillSystem';
import { useTaskStore } from '../../stores/taskStore';
import { useQuestStore } from '../../stores/questStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { useMasteryStore, getMasteryXpMultiplier, getMasteryGoldMultiplier } from '../../stores/masteryStore';
import { useBotStore } from '../../stores/botStore';
import {
    calculateBotAction,
    pickAggroTarget,
    calculateAoeDamage,
    isBossAoeTurn,
    BOT_CLASS_ICONS,
} from '../../systems/botSystem';

/** Boss aggro re-rolls every 10 seconds (wall-clock), using class-weighted pick. */
const BOSS_AGGRO_SWITCH_INTERVAL_MS = 10_000;
import type { IBot } from '../../types/bot';
import type { TCharacterClass } from '../../types/character';
import ItemIcon from '../../components/ui/ItemIcon/ItemIcon';
import { getSkillIcon } from '../../data/skillIcons';
import { getCharacterAvatar } from '../../data/classAvatars';
import classesRaw from '../../data/classes.json';
import { useTransformStore } from '../../stores/transformStore';
import './Boss.scss';

// ── Class config for dual wield ──────────────────────────────────────────────

interface IBossClassData {
    dualWield?: boolean;
    dualWieldDmgPercent?: number;
}

const bossClassesArray = classesRaw as unknown as (IBossClassData & { id: string })[];
const bossClassesMap: Record<string, IBossClassData> = {};
for (const c of bossClassesArray) {
    bossClassesMap[c.id] = c;
}

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

const CLASS_ICONS: Record<string, string> = {
  Knight: '⚔️', Mage: '🔮', Cleric: '✨', Archer: '🏹',
  Rogue: '🗡️', Necromancer: '💀', Bard: '🎵',
};

/**
 * Maps boss level → HSL hue for unique gradient backgrounds.
 * Each tier gets a distinct colour palette so the list looks epic.
 */
const getBossCardHue = (level: number): number => {
    if (level <= 50) return 0;        // red
    if (level <= 100) return 25;      // orange
    if (level <= 200) return 280;     // purple
    if (level <= 300) return 200;     // cyan-blue
    if (level <= 400) return 340;     // crimson-pink
    if (level <= 500) return 160;     // teal-green
    if (level <= 600) return 240;     // deep blue
    if (level <= 700) return 310;     // magenta
    if (level <= 800) return 45;      // gold
    if (level <= 900) return 130;     // emerald
    return 10;                        // fire-red
};

// ── Types ─────────────────────────────────────────────────────────────────────

type ScreenPhase = 'list' | 'fighting' | 'result';

type TBotClassOrNone = TCharacterClass | 'none';
const ALL_BOT_CLASSES: TCharacterClass[] = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'];

// Bosses ALWAYS run at x1 speed (independent of normal combat speed)

// ── Drop table helpers ───────────────────────────────────────────────────────

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic', 'heroic'] as const;
const RARITY_LABELS: Record<string, { label: string; color: string }> = {
    common:    { label: 'Common',    color: '#ffffff' },
    rare:      { label: 'Rare',      color: '#2196f3' },
    epic:      { label: 'Epic',      color: '#4caf50' },
    legendary: { label: 'Legendary', color: '#f44336' },
    mythic:    { label: 'Mythic',    color: '#ffc107' },
    heroic:    { label: 'Heroic',    color: '#9c27b0' },
};

const BOSS_ITEM_DROP_RATES: Record<string, number> = {
    common: 30, rare: 25, epic: 20, legendary: 12, mythic: 8, heroic: 0.5,
};

interface IStoneDropInfo {
    name: string;
    chance: number;
}

const BOSS_STONE_DROPS: IStoneDropInfo[] = [
    { name: 'Common Stone',    chance: 50 },
    { name: 'Rare Stone',      chance: 35 },
    { name: 'Epic Stone',      chance: 25 },
    { name: 'Legendary Stone',  chance: 15 },
    { name: 'Mythic Stone',    chance: 8 },
    { name: 'Heroic Stone',    chance: 2 },
];

const getBossItemDropTiers = (bossLevel: number) => {
    const tiers = RARITY_ORDER.map((r) => {
        let chance = BOSS_ITEM_DROP_RATES[r];
        if (r === 'heroic') {
            chance = 0.5;
        }
        if (r === 'mythic') {
            chance = Math.min(10, 5 + (bossLevel / 200));
        }
        return {
            key: r,
            label: RARITY_LABELS[r].label,
            color: RARITY_LABELS[r].color,
            chance: parseFloat(chance.toFixed(1)),
        };
    });
    return tiers;
};

// ── Skill / Potion constants ─────────────────────────────────────────────────

const SKILL_COOLDOWN_MS = 5000;
const SKILL_MP_COST = 15;
const POTION_COOLDOWN_MS = 1000;

const hpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_hp') && !e.effect.includes('pct'));
const mpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_mp') && !e.effect.includes('pct'));
const pctHpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_hp_pct'));
const pctMpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_mp_pct'));
const PCT_POTION_CD_MS = 500;

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

const HpBar = ({ current, max, variant }: { current: number; max: number; variant: 'hp' | 'mp' | 'enemy' | 'boss-enraged' }) => {
    const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
    return (
        <div className={`boss__combat-bar boss__combat-bar--${variant}`}>
            <motion.div
                className="boss__combat-bar-fill"
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
    type: 'player' | 'monster' | 'crit' | 'system' | 'boss-spell';
}

// ── Get attack interval ms ───────────────────────────────────────────────────

const getAttackMs = (speed: number): number =>
    Math.max(500, Math.floor(3000 / Math.max(1, speed || 1)));

// ── Boss spell system ────────────────────────────────────────────────────────

interface IBossSpell {
    name: string;
    icon: string;
    type: 'damage' | 'heal' | 'buff';
    power: number; // multiplier
}

const BOSS_SPELLS: IBossSpell[] = [
    { name: 'Cios Mocy', icon: '💥', type: 'damage', power: 2.5 },
    { name: 'Mroczny Pocisk', icon: '🌑', type: 'damage', power: 1.8 },
    { name: 'Leczenie', icon: '💚', type: 'heal', power: 0.1 },
    { name: 'Wściekłość', icon: '🔥', type: 'buff', power: 1.5 },
    { name: 'Trucizna', icon: '☠️', type: 'damage', power: 1.5 },
    { name: 'Drenaż Życia', icon: '🩸', type: 'damage', power: 2.0 },
];

const pickBossSpell = (boss: IBoss): IBossSpell => {
    // Higher level bosses have more spell variety
    const maxIdx = Math.min(BOSS_SPELLS.length, Math.floor(boss.level / 100) + 3);
    return BOSS_SPELLS[Math.floor(Math.random() * maxIdx)];
};

// ── Component ─────────────────────────────────────────────────────────────────

const Boss = () => {
    const navigate = useNavigate();

    const character   = useCharacterStore((s) => s.character);
    const equipment   = useInventoryStore((s) => s.equipment);
    const consumables = useInventoryStore((s) => s.consumables);
    const completedTransforms = useTransformStore((s) => s.completedTransforms);
    const playerAvatarSrc = character ? getCharacterAvatar(character.class, completedTransforms) : '';
    const { activeSkillSlots } = useSkillStore();
    // Bosses always run at x1 speed (no speed controls)
    const { setBossDefeated, getAttemptsUsed, getAttemptsMax, canChallenge } = useBossStore();
    const { addBossKill, getTotalScore } = useBossScoreStore();
    const party = usePartyStore((s) => s.party);
    const { skillMode, setSkillMode, autoPotionHpEnabled, autoPotionMpEnabled } = useSettingsStore();

    const [phase, setPhase]           = useState<ScreenPhase>('list');
    const [activeBoss, setActiveBoss] = useState<IBoss | null>(null);
    const [result, setResult]         = useState<IBossResult | null>(null);
    const [expandedBoss, setExpandedBoss] = useState<string | null>(null);
    // Epic entry animation — the screen "splits open" before the fight begins
    const [bossEntryBoss, setBossEntryBoss] = useState<IBoss | null>(null);

    // ── Pre-fight bot picker modal ──────────────────────────────────────────
    const [pendingBoss, setPendingBoss] = useState<IBoss | null>(null);
    const [partySize, setPartySize]     = useState<0 | 1 | 3>(3);
    const [botPicks, setBotPicks]       = useState<TBotClassOrNone[]>(['Knight', 'Cleric', 'Mage']);
    const lastBotPicksRef = useRef<TCharacterClass[]>([]);

    // ── Combat state ─────────────────────────────────────────────────────────
    const [bossHp, setBossHp]         = useState(0);
    const [playerHp, setPlayerHp]     = useState(0);
    const [playerMp, setPlayerMp]     = useState(0);
    const [combatLog, setCombatLog]   = useState<ILogEntry[]>([]);

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
    const bossHpRef   = useRef(0);
    const playerHpRef = useRef(0);
    const phaseRef    = useRef<ScreenPhase>('list');
    const activeBossRef = useRef<IBoss | null>(null);
    /** Scaled combat stats (HP/ATK/DEF multiplied for party balance) */
    const scaledBossRef = useRef<{ hp: number; attack: number; attack_min: number; attack_max: number; defense: number }>({ hp: 0, attack: 0, attack_min: 0, attack_max: 0, defense: 0 });
    const [scaledBossMaxHp, setScaledBossMaxHp] = useState(0);
    const spellCounterRef = useRef(0);

    // ── Bot companion state ─────────────────────────────────────────────────
    const { bots, generateBotsCustom, updateBotHp, updateBotMp, killBot, clearBots } = useBotStore();
    const botsRef = useRef<IBot[]>([]);
    const aggroTargetRef = useRef<string>('player');
    const bossTurnCounterRef = useRef(0);
    /** Timestamp (ms) when the next aggro re-roll is allowed. */
    const aggroSwitchAtRef = useRef<number>(Date.now() + BOSS_AGGRO_SWITCH_INTERVAL_MS);
    const botSkillCooldownsRef = useRef<Map<string, number>>(new Map());

    // Keep botsRef in sync with store
    useEffect(() => { botsRef.current = bots; }, [bots]);

    const bosses   = bossData as IBoss[];
    const allItems: IBaseItem[] = flattenItemsData(itemsData as Parameters<typeof flattenItemsData>[0]);
    const skillLevels = useSkillStore((s) => s.skillLevels);

    if (!character) return <div className="boss"><p className="boss__loading">Ładowanie...</p></div>;

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
    const bestPctHpPotion = getBestPotion(pctHpPotions, consumables);
    const bestPctMpPotion = getBestPotion(pctMpPotions, consumables);

    // Keep refs in sync
    phaseRef.current = phase;
    activeBossRef.current = activeBoss;

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
        // ── Pct auto-potions ──
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
    }, [charMaxHp, charMaxMp, healPlayerHp, healPlayerMp, startHpCooldown, startMpCooldown, addLog]);

    // ── Manual potion use ───────────────────────────────────────────────────
    const doUsePotion = useCallback((elixirId: string) => {
        const elixir = ELIXIRS.find((e) => e.id === elixirId);
        if (!elixir) return;
        const isHp = elixir.effect.startsWith('heal_hp');
        const isMp = elixir.effect.startsWith('heal_mp');
        const isPct = elixir.effect.includes('pct');
        // Check cooldown for appropriate slot
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
    }, [charMaxHp, charMaxMp, healPlayerHp, healPlayerMp, startHpCooldown, startMpCooldown, addLog]);

    const enraged = activeBoss ? isBossEnraged(bossHp, scaledBossMaxHp) : false;

    const cancelPendingBoss = useCallback(() => {
        setPendingBoss(null);
    }, []);

    const updateBotPick = useCallback((idx: number, cls: TBotClassOrNone) => {
        setBotPicks((prev) => {
            const next = [...prev];
            next[idx] = cls;
            return next;
        });
    }, []);

    // ── Actually start boss fight with chosen bot party ────────────────────
    const beginBossFight = useCallback((boss: IBoss, chosenBotClasses: TCharacterClass[]) => {
        const scaled = getScaledBossStats(boss);
        setActiveBoss(boss);
        scaledBossRef.current = scaled;
        setScaledBossMaxHp(scaled.hp);
        setBossHp(scaled.hp);
        bossHpRef.current = scaled.hp;
        setPlayerHp(charMaxHp);
        playerHpRef.current = charMaxHp;
        setPlayerMp(charMaxMp);
        playerMpRef.current = charMaxMp;
        setResult(null);
        setCombatLog([]);
        spellCounterRef.current = 0;
        // Reset cooldowns
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
        // Generate bot companions (custom picks or none)
        if (chosenBotClasses.length > 0) {
            generateBotsCustom(character.level, chosenBotClasses);
        } else {
            clearBots();
        }
        bossTurnCounterRef.current = 0;
        // Initial aggro: class-weighted over player + freshly-generated bots so
        // the boss doesn't automatically glue onto the player every single time.
        // `generateBotsCustom` mutates the store synchronously, so reading
        // `getState()` here returns the new roster.
        const initialCandidates = [
            { id: 'player', class: character.class },
            ...useBotStore.getState().bots
                .filter((b) => b.alive)
                .map((b) => ({ id: b.id, class: b.class })),
        ];
        aggroTargetRef.current = pickAggroTarget(initialCandidates);
        aggroSwitchAtRef.current = Date.now() + BOSS_AGGRO_SWITCH_INTERVAL_MS;
        botSkillCooldownsRef.current.clear();
        setPhase('fighting');
        logIdRef.current = 0;
    }, [charMaxHp, charMaxMp, character.level, generateBotsCustom, clearBots]);

    // Duration of the door-opening intro before the fight actually begins.
    // Kept short enough that players feel a punchy cut; long enough to read.
    // Timings:
    //  0ms          → overlay appears, doors closed, faint boss backdrop visible behind
    //  400–1300ms   → doors slide off to the sides (0.9s ease)
    //  1300–2100ms  → doors are gone, player sees the boss centered before combat mounts
    //  ~2100ms      → navigate to combat (overlay fades during combat mount)
    const BOSS_ENTRY_MS = 2100;

    // Run the epic door-opening entry, then kick off the real fight.
    const playEntryThenFight = useCallback((boss: IBoss, picks: TCharacterClass[]) => {
        setBossEntryBoss(boss);
        window.setTimeout(() => {
            setBossEntryBoss(null);
            beginBossFight(boss, picks);
        }, BOSS_ENTRY_MS);
    }, [beginBossFight]);

    // ── Open pre-fight bot picker (or skip if already in party) ─────────────
    const handleChallenge = useCallback((boss: IBoss) => {
        // If the player is already in a party, use the existing composition:
        // bot-helpers stay as bots, human party members act as bots locally
        // (placeholder until Supabase Realtime multiplayer is implemented).
        if (party && party.members.length > 1) {
            const partnerClasses: TCharacterClass[] = party.members
                .filter((m) => m.id !== character.id)
                .slice(0, 3)
                .map((m) => m.class as TCharacterClass);
            lastBotPicksRef.current = partnerClasses;
            playEntryThenFight(boss, partnerClasses);
            return;
        }
        setPendingBoss(boss);
    }, [party, character.id, playEntryThenFight]);

    const confirmBossFight = useCallback(() => {
        if (!pendingBoss) return;
        const picks: TCharacterClass[] = [];
        for (let i = 0; i < partySize; i++) {
            const c = botPicks[i];
            if (c && c !== 'none') picks.push(c);
        }
        const boss = pendingBoss;
        setPendingBoss(null);
        lastBotPicksRef.current = picks;
        playEntryThenFight(boss, picks);
    }, [pendingBoss, partySize, botPicks, playEntryThenFight]);

    const retryBossFight = useCallback(() => {
        if (!activeBoss) return;
        playEntryThenFight(activeBoss, lastBotPicksRef.current);
    }, [activeBoss, playEntryThenFight]);

    // ── Handle boss death ────────────────────────────────────────────────────
    const handleBossDeath = useCallback(() => {
        const boss = activeBossRef.current;
        if (!boss) return;

        tickCombatElixirs(2000);

        const drops = rollBossLoot(boss);
        // Mastery N7: per-boss-kill XP/Gold bonus (+2% per level, cap +50%)
        const bossMasteryLvl = useMasteryStore.getState().getMasteryLevel(boss.id);
        const bossXpMult = getMasteryXpMultiplier(bossMasteryLvl);
        const bossGoldMult = getMasteryGoldMultiplier(bossMasteryLvl);
        const gold = Math.floor(rollBossGold(boss.gold) * bossGoldMult);
        const xp = Math.floor(getBossXp(boss) * bossXpMult);

        // Heroic drop (0.5% chance per boss kill) – generates a random heroic item for player's class
        if (Math.random() < 0.005) {
            const heroicItem = generateRandomItemForClass(character.class, boss.level, 'heroic');
            if (heroicItem) {
                const info = getItemDisplayInfo(heroicItem.itemId);
                drops.push({
                    itemId: heroicItem.itemId,
                    chance: 0.005,
                    rarity: 'heroic',
                    name_pl: info?.name_pl ?? formatItemName(heroicItem.itemId),
                    name_en: info?.name_en ?? formatItemName(heroicItem.itemId),
                    slot: info?.slot ?? '',
                    bonuses: heroicItem.bonuses ?? {},
                });
                useInventoryStore.getState().addItem(heroicItem);
            }
        }

        // Track drop rarity for quest progress
        for (const drop of drops) {
            useQuestStore.getState().addProgress('drop_rarity', drop.rarity, 1);
        }

        // Apply rewards
        const inv = useInventoryStore.getState();
        inv.addGold(gold);
        setBossDefeated(boss.id);
        addBossKill(boss.id, boss.level);

        // Track kills for tasks, quests, and mastery (boss kills count).
        useTaskStore.getState().addKill(boss.id, boss.level, 1);
        useQuestStore.getState().addProgress('kill', boss.id, 1);
        useQuestStore.getState().addProgress('boss', boss.id, 1);
        useQuestStore.getState().addProgress('kill_rarity', 'boss', 1, boss.level);
        useQuestStore.getState().addProgress('kill_bosses_any', 'any', 1);
        useDailyQuestStore.getState().addProgress('kill_any', 1);
        useDailyQuestStore.getState().addProgress('kill_boss', 1);
        useDailyQuestStore.getState().addProgress('earn_gold', gold);

        // Spell chest drops (boss = 2.0x multiplier)
        const chestDrops = rollSpellChestDrop(boss.level, 'normal', false, true);
        const chestNames: string[] = [];
        for (const cd of chestDrops) {
            inv.addSpellChest(cd.chestLevel, cd.count);
            chestNames.push(`${getSpellChestIcon(cd.chestLevel)} ${getSpellChestDisplayName(cd.chestLevel)}`);
        }

        addLog(`🏆 ${boss.name_pl} pokonany! +${gold} Gold, +${xp} XP`, 'system');
        if (drops.length > 0) {
            const dropNames = drops.map((d) => {
                const info = getItemDisplayInfo(d.itemId);
                return info?.name_pl ?? formatItemName(d.itemId);
            });
            addLog(`📦 Drop: ${dropNames.join(', ')}`, 'system');
        }
        if (chestNames.length > 0) {
            addLog(`📦 Spell Chests: ${chestNames.join(', ')}`, 'system');
        }

        setResult({
            won: true,
            playerHpLeft: playerHpRef.current,
            turns: 0,
            drops,
            gold,
            xp,
        });
        clearBots();
        setTimeout(() => setPhase('result'), 500);
    }, [addLog, setBossDefeated, addBossKill, clearBots]);

    // ── Handle player death ──────────────────────────────────────────────────
    const handlePlayerDeath = useCallback(() => {
        const boss = activeBossRef.current;
        if (!boss) return;

        // Apply death penalty (same as normal combat)
        const char = useCharacterStore.getState().character;
        if (char) {
            // Log death to global deaths feed (best-effort)
            void deathsApi.logDeath({
                character_id: char.id,
                character_name: char.name,
                character_class: char.class,
                character_level: char.level,
                source: 'boss',
                source_name: boss.name_pl,
                source_level: boss.level,
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
                    addLog(`💀 Zginąłeś! Tracisz poziom: ${char.level} → ${penalty.newLevel} (${penalty.xpPercent}% XP zachowane) · -5% Skill XP`, 'system');
                } else {
                    addLog(`💀 Zginąłeś w walce z ${boss.name_pl}! -50% XP · -5% Skill XP`, 'system');
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
                killedBy: boss.name_pl,
                sourceLevel: boss.level,
                oldLevel,
                newLevel,
                levelsLost,
                xpPercent,
                protectionUsed: usedDeathProtection,
                source: 'boss',
            });
        } else {
            addLog(`💀 Zginąłeś w walce z ${boss.name_pl}!`, 'system');
        }

        setResult({
            won: false,
            playerHpLeft: 0,
            turns: 0,
            drops: [],
            gold: 0,
            xp: 0,
        });
        clearBots();
        setTimeout(() => setPhase('result'), 500);
    }, [addLog, clearBots]);

    // ── Manual skill use (click a slot when skillMode === 'manual') ──────────
    const doManualSkill = useCallback((slotIdx: 0 | 1 | 2 | 3) => {
        if (phaseRef.current !== 'fighting') return;
        if (bossHpRef.current <= 0) return;
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
        const afterSkill = Math.max(0, bossHpRef.current - skillDmg);
        bossHpRef.current = afterSkill;
        setBossHp(afterSkill);
        const newMp = Math.max(0, playerMpRef.current - SKILL_MP_COST);
        playerMpRef.current = newMp;
        setPlayerMp(newMp);
        skillCooldownRef.current.set(skillId, now);
        setSkillCooldowns((prev) => ({ ...prev, [skillId]: SKILL_COOLDOWN_MS }));
        { const sd = getSkillDef(skillId); if (sd) applySkillBuff(skillId, sd); }
        triggerSkillAnim(skillId);
        showFloatingDmg(`-${skillDmg}`, 'player');
        addLog(`✨ ${formatSkillName(skillId)}: ${skillDmg} dmg (-${SKILL_MP_COST} MP)`, 'player');
        if (character) {
            useSkillStore.getState().addMlvlXpFromSkill(character.class);
        }
        if (afterSkill <= 0) {
            handleBossDeath();
        }
    }, [addLog, charAtk, character, handleBossDeath, showFloatingDmg]);

    // ── Player attack callback ───────────────────────────────────────────────
    const doPlayerAttack = useCallback(() => {
        if (phaseRef.current !== 'fighting') return;
        if (bossHpRef.current <= 0) return;
        const boss = activeBossRef.current;
        if (!boss) return;

        const isDualWield = !!bossClassesMap[character?.class ?? '']?.dualWield;
        const sDef = scaledBossRef.current.defense;
        const sMaxHp = scaledBossRef.current.hp;

        // ── Helper: single hit ──────────────────────────────────────────────
        const doSingleHit = (hand: 'left' | 'right' | undefined, weaponRollFn: () => number, dmgPercent: number) => {
            if (bossHpRef.current <= 0 || phaseRef.current !== 'fighting') return 0;
            const wRoll = Math.floor(weaponRollFn() * dmgPercent);
            const totalAtk = charAtk + wRoll;
            const baseDmg = Math.max(1, totalAtk - sDef);
            const variance = Math.floor(baseDmg * 0.2);
            const rolledDmg = Math.max(1, baseDmg - variance + Math.floor(Math.random() * (variance * 2 + 1)));
            const finalDmg = Math.max(1, Math.floor(rolledDmg * getAtkDamageMultiplier() * getTransformDmgMultiplier()));

            const newBossHp = Math.max(0, bossHpRef.current - finalDmg);
            bossHpRef.current = newBossHp;
            setBossHp(newBossHp);

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
            addLog(`${handPrefix}Atakujesz za ${finalDmg} dmg (Boss HP: ${newBossHp.toLocaleString('pl-PL')}/${sMaxHp.toLocaleString('pl-PL')})`, 'player');
            return finalDmg;
        };

        // ── Execute attack(s) ────────────────────────────────────────────────
        if (isDualWield) {
            // Hit 1: left hand (mainHand, 60%)
            doSingleHit('left', rollWeaponDamage, 0.6);
            // Hit 2: right hand (offHand, 60%) – 150ms delay
            setTimeout(() => {
                if (phaseRef.current !== 'fighting' || bossHpRef.current <= 0) return;
                doSingleHit('right', rollOffHandDamage, 0.6);
                if (bossHpRef.current <= 0) {
                    handleBossDeath();
                }
            }, 150);
        } else {
            // Normal single attack
            const baseDmg = Math.max(1, charAtk - sDef);
            const variance = Math.floor(baseDmg * 0.2);
            const rolledDmg = Math.max(1, baseDmg - variance + Math.floor(Math.random() * (variance * 2 + 1)));
            const finalDmg = Math.max(1, Math.floor(rolledDmg * getAtkDamageMultiplier() * getTransformDmgMultiplier()));

            const newBossHp = Math.max(0, bossHpRef.current - finalDmg);
            bossHpRef.current = newBossHp;
            setBossHp(newBossHp);

            setMonsterHit(true);
            setPlayerAttacking(true);
            const animDur = ATTACK_ANIM_DURATION[character?.class ?? ''] ?? 350;
            setTimeout(() => { setMonsterHit(false); setPlayerAttacking(false); }, animDur);
            showFloatingDmg(`-${finalDmg}`, 'player');
            addLog(`Atakujesz za ${finalDmg} dmg (Boss HP: ${newBossHp.toLocaleString('pl-PL')}/${sMaxHp.toLocaleString('pl-PL')})`, 'player');
        }

        // Grant skill XP from attack (weapon skill for non-magic + MLVL for magic classes)
        if (character) {
            useSkillStore.getState().addWeaponSkillXpFromAttack(character.class);
            useSkillStore.getState().addMlvlXpFromAttack(character.class);
        }

        // Auto-skill fire (check all 4 slots, only if skillMode=auto)
        if (bossHpRef.current > 0 && useSettingsStore.getState().skillMode === 'auto') {
            const now = Date.now();
            const slots = useSkillStore.getState().activeSkillSlots;
            for (let i = 0; i < 4; i++) {
                const skillId = slots[i];
                if (!skillId) continue;
                const lastUsed = skillCooldownRef.current.get(skillId) ?? 0;
                if (now - lastUsed < SKILL_COOLDOWN_MS) continue;
                if (playerMpRef.current < SKILL_MP_COST) continue;
                const skillDmg = Math.max(1, Math.floor(charAtk * 0.15 * getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier()));
                const afterSkill = Math.max(0, bossHpRef.current - skillDmg);
                bossHpRef.current = afterSkill;
                setBossHp(afterSkill);
                const newMp = Math.max(0, playerMpRef.current - SKILL_MP_COST);
                playerMpRef.current = newMp;
                setPlayerMp(newMp);
                skillCooldownRef.current.set(skillId, now);
                setSkillCooldowns((prev) => ({ ...prev, [skillId]: SKILL_COOLDOWN_MS }));
                { const sd = getSkillDef(skillId); if (sd) applySkillBuff(skillId, sd); }
                triggerSkillAnim(skillId);
                addLog(`✨ ${formatSkillName(skillId)}: ${skillDmg} dmg (-${SKILL_MP_COST} MP)`, 'player');
                if (afterSkill <= 0) { handleBossDeath(); return; }
                break;
            }
        }

        // Auto-potion check
        tryAutoPotion();

        if (bossHpRef.current <= 0) {
            handleBossDeath();
        }
    }, [charAtk, addLog, showFloatingDmg, handleBossDeath, tryAutoPotion, character]);

    // ── Boss attack callback ─────────────────────────────────────────────────
    // ── Helper: deal damage to a bot target ────────────────────────────────
    const dealDamageToBot = useCallback((botId: string, damage: number, bossName: string): boolean => {
        const currentBots = botsRef.current;
        const bot = currentBots.find((b) => b.id === botId && b.alive);
        if (!bot) return false;
        const newHp = Math.max(0, bot.hp - damage);
        updateBotHp(botId, newHp);
        const icon = BOT_CLASS_ICONS[bot.class] ?? '?';
        if (newHp <= 0) {
            killBot(botId);
            addLog(`${bossName} zabija ${icon} ${bot.name}! (-${damage} dmg)`, 'monster');
        } else {
            addLog(`${bossName} atakuje ${icon} ${bot.name} za ${damage} dmg (HP: ${newHp}/${bot.maxHp})`, 'monster');
        }
        return true;
    }, [updateBotHp, killBot, addLog]);

    // ── Utamo Vita helper for boss damage to player ────────────────────────
    const applyUtamoDamageToPlayer = useCallback((rawDmg: number): { newPHp: number; hpDmg: number; mpDmg: number; shieldActive: boolean } => {
        let hpDmg = rawDmg;
        let mpDmg = 0;
        const hasUtamo = useBuffStore.getState().hasBuff('utamo_vita');
        if (hasUtamo && playerMpRef.current > 0) {
            mpDmg = Math.floor(rawDmg * 0.5);
            hpDmg = rawDmg - mpDmg;
            if (mpDmg > playerMpRef.current) {
                const overflow = mpDmg - playerMpRef.current;
                mpDmg = playerMpRef.current;
                hpDmg += overflow;
            }
            const newMp = Math.max(0, playerMpRef.current - mpDmg);
            playerMpRef.current = newMp;
            setPlayerMp(newMp);
            if (newMp <= 0) {
                useBuffStore.getState().removeBuffByEffect('utamo_vita');
                addLog('🔵 Utamo Vita peka! Brak many.', 'system');
            }
        }
        const newPHp = Math.max(0, playerHpRef.current - hpDmg);
        playerHpRef.current = newPHp;
        setPlayerHp(newPHp);
        return { newPHp, hpDmg, mpDmg, shieldActive: hasUtamo && mpDmg > 0 };
    }, [addLog]);

    const doBossAttack = useCallback(() => {
        if (phaseRef.current !== 'fighting') return;
        if (bossHpRef.current <= 0) return;
        const boss = activeBossRef.current;
        if (!boss) return;

        spellCounterRef.current++;
        bossTurnCounterRef.current++;

        const sAtk = scaledBossRef.current.attack;
        const sMaxHp = scaledBossRef.current.hp;
        const phaseMult = getBossPhaseMultiplier(bossHpRef.current / sMaxHp);

        // ── AOE attack every 5th turn (50% damage to all) ────────────────────
        if (isBossAoeTurn(bossTurnCounterRef.current)) {
            addLog(`💥 ${boss.name_pl} wykonuje ATAK OBSZAROWY!`, 'boss-spell');

            // Damage player (with Utamo Vita)
            const aoeDmgPlayer = calculateAoeDamage(Math.floor(sAtk * phaseMult), charDef);
            const aoeResult = applyUtamoDamageToPlayer(aoeDmgPlayer);
            setPlayerHit(true);
            setTimeout(() => setPlayerHit(false), 300);
            showFloatingDmg(`-${aoeDmgPlayer} AOE${aoeResult.shieldActive ? ' 🔵' : ''}`, 'monster');
            const aoeSuffix = aoeResult.shieldActive ? ` 🔵 (${aoeResult.hpDmg} HP / ${aoeResult.mpDmg} MP)` : '';
            addLog(`  Ty: -${aoeDmgPlayer} dmg${aoeSuffix} (HP: ${aoeResult.newPHp}/${charMaxHp})`, 'monster');

            // Damage all alive bots
            const currentBots = botsRef.current;
            for (const bot of currentBots) {
                if (!bot.alive) continue;
                const aoeDmgBot = calculateAoeDamage(Math.floor(sAtk * phaseMult), bot.defense);
                const newBotHp = Math.max(0, bot.hp - aoeDmgBot);
                updateBotHp(bot.id, newBotHp);
                const icon = BOT_CLASS_ICONS[bot.class] ?? '?';
                if (newBotHp <= 0) {
                    killBot(bot.id);
                    addLog(`  ${icon} ${bot.name}: POLEGŁ! (-${aoeDmgBot} dmg)`, 'monster');
                } else {
                    addLog(`  ${icon} ${bot.name}: -${aoeDmgBot} dmg (HP: ${newBotHp}/${bot.maxHp})`, 'monster');
                }
            }

            if (aoeResult.newPHp <= 0) {
                handlePlayerDeath();
                return;
            }
            tryAutoPotion();
            return;
        }

        // ── Aggro switch check (time-based, every 10s wall-clock) ────────────
        // Boss re-rolls its target every 10 seconds using class-weighted aggro
        // (Knight 80%, Rogue 60%, Archer 50%, Necro 40%, Mage 30%, Cleric/Bard 20%).
        if (Date.now() >= aggroSwitchAtRef.current) {
            // Build class-weighted candidate list: player + all alive bots.
            const candidates = [
                { id: 'player', class: character.class },
                ...botsRef.current.filter((b) => b.alive).map((b) => ({ id: b.id, class: b.class })),
            ];
            aggroTargetRef.current = pickAggroTarget(candidates);
            aggroSwitchAtRef.current = Date.now() + BOSS_AGGRO_SWITCH_INTERVAL_MS;
        }

        // Boss uses spell every 3-4 attacks
        const useSpell = spellCounterRef.current % 4 === 0 || (enraged && spellCounterRef.current % 3 === 0);

        if (useSpell) {
            const spell = pickBossSpell(boss);

            if (spell.type === 'damage') {
                // Spell damage targets current aggro
                const target = aggroTargetRef.current;
                const baseDmg = Math.max(1, sAtk - (target === 'player' ? charDef : (botsRef.current.find((b) => b.id === target)?.defense ?? 0)));
                const spellDmg = Math.max(1, Math.floor(baseDmg * spell.power));

                if (target === 'player') {
                    const newPHp = Math.max(0, playerHpRef.current - spellDmg);
                    playerHpRef.current = newPHp;
                    setPlayerHp(newPHp);
                    setPlayerHit(true);
                    setTimeout(() => setPlayerHit(false), 300);
                    showFloatingDmg(`-${spellDmg} ${spell.icon}`, 'monster');
                    addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name} na Ciebie: ${spellDmg} dmg! (HP: ${newPHp}/${charMaxHp})`, 'boss-spell');
                    if (newPHp <= 0) { handlePlayerDeath(); return; }
                    tryAutoPotion();
                } else {
                    const bot = botsRef.current.find((b) => b.id === target && b.alive);
                    if (bot) {
                        const newBotHp = Math.max(0, bot.hp - spellDmg);
                        updateBotHp(target, newBotHp);
                        const icon = BOT_CLASS_ICONS[bot.class] ?? '?';
                        if (newBotHp <= 0) {
                            killBot(target);
                            addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name} na ${icon} ${bot.name}: ${spellDmg} dmg! POLEGŁ!`, 'boss-spell');
                        } else {
                            addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name} na ${icon} ${bot.name}: ${spellDmg} dmg! (HP: ${newBotHp}/${bot.maxHp})`, 'boss-spell');
                        }
                    } else {
                        // Bot target died, redirect to player
                        aggroTargetRef.current = 'player';
                        const newPHp = Math.max(0, playerHpRef.current - spellDmg);
                        playerHpRef.current = newPHp;
                        setPlayerHp(newPHp);
                        setPlayerHit(true);
                        setTimeout(() => setPlayerHit(false), 300);
                        showFloatingDmg(`-${spellDmg} ${spell.icon}`, 'monster');
                        addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name} na Ciebie: ${spellDmg} dmg! (HP: ${newPHp}/${charMaxHp})`, 'boss-spell');
                        if (newPHp <= 0) { handlePlayerDeath(); return; }
                        tryAutoPotion();
                    }
                }
            } else if (spell.type === 'heal') {
                const healAmount = Math.floor(sMaxHp * spell.power);
                const newBossHp = Math.min(sMaxHp, bossHpRef.current + healAmount);
                bossHpRef.current = newBossHp;
                setBossHp(newBossHp);
                showFloatingDmg(`+${healAmount} ${spell.icon}`, 'heal');
                addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name}: leczy się za ${healAmount.toLocaleString('pl-PL')} HP!`, 'boss-spell');
            } else if (spell.type === 'buff') {
                addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name}: wzmacnia się!`, 'boss-spell');
            }
            return;
        }

        // ── Normal boss attack (targeted via aggro) ──────────────────────────
        const target = aggroTargetRef.current;
        const targetDef = target === 'player' ? charDef : (botsRef.current.find((b) => b.id === target && b.alive)?.defense ?? 0);
        const rolled = rollMonsterDamage({
            attack: sAtk,
            attack_min: scaledBossRef.current.attack_min,
            attack_max: scaledBossRef.current.attack_max,
        });
        const finalDmg = Math.max(1, Math.floor((rolled - targetDef) * phaseMult));
        const enragedText = phaseMult > 1 ? ' \uD83D\uDD25' : '';

        if (target === 'player') {
            const newPHp = Math.max(0, playerHpRef.current - finalDmg);
            playerHpRef.current = newPHp;
            setPlayerHp(newPHp);
            setPlayerHit(true);
            setTimeout(() => setPlayerHit(false), 300);
            showFloatingDmg(`-${finalDmg}`, 'monster');
            addLog(`${boss.name_pl} atakuje Cię za ${finalDmg} dmg${enragedText} (HP: ${newPHp}/${charMaxHp})`, 'monster');
            if (newPHp > 0) { tryAutoPotion(); }
            if (newPHp <= 0) { handlePlayerDeath(); }
        } else {
            const bot = botsRef.current.find((b) => b.id === target && b.alive);
            if (bot) {
                dealDamageToBot(bot.id, finalDmg, boss.name_pl + enragedText);
            } else {
                // Fallback to player
                aggroTargetRef.current = 'player';
                const newPHp = Math.max(0, playerHpRef.current - finalDmg);
                playerHpRef.current = newPHp;
                setPlayerHp(newPHp);
                setPlayerHit(true);
                setTimeout(() => setPlayerHit(false), 300);
                showFloatingDmg(`-${finalDmg}`, 'monster');
                addLog(`${boss.name_pl} atakuje Cię za ${finalDmg} dmg${enragedText} (HP: ${newPHp}/${charMaxHp})`, 'monster');
                if (newPHp > 0) { tryAutoPotion(); }
                if (newPHp <= 0) { handlePlayerDeath(); }
            }
        }
    }, [charDef, charMaxHp, addLog, showFloatingDmg, handlePlayerDeath, handleBossDeath, enraged, tryAutoPotion, updateBotHp, killBot, dealDamageToBot]);

    // ── Bot attack callback ──────────────────────────────────────────────────
    const doBotAttacks = useCallback(() => {
        if (phaseRef.current !== 'fighting') return;
        if (bossHpRef.current <= 0) return;
        const boss = activeBossRef.current;
        if (!boss) return;

        const currentBots = botsRef.current;
        const now = Date.now();

        for (const bot of currentBots) {
            if (!bot.alive) continue;
            if (bossHpRef.current <= 0) break;

            const canUseSkill = (() => {
                if (!bot.skillId) return false;
                const lastUsed = botSkillCooldownsRef.current.get(bot.id) ?? 0;
                return (now - lastUsed) >= bot.skillCooldownMs;
            })();

            const sDef = scaledBossRef.current.defense;
            const bossForCalc = { ...boss, defense: sDef };
            const action = calculateBotAction(bot, bossForCalc, canUseSkill);
            const icon = BOT_CLASS_ICONS[bot.class] ?? '?';

            const newBossHp = Math.max(0, bossHpRef.current - action.damage);
            bossHpRef.current = newBossHp;
            setBossHp(newBossHp);

            if (action.type === 'skill' && bot.skillId) {
                botSkillCooldownsRef.current.set(bot.id, now);
                const newMp = Math.max(0, bot.mp - bot.skillMpCost);
                updateBotMp(bot.id, newMp);
                addLog(`${icon} ${bot.name} rzuca ${action.skillName}: ${action.damage} dmg (Boss HP: ${newBossHp.toLocaleString('pl-PL')})`, 'player');
            } else {
                addLog(`${icon} ${bot.name} atakuje za ${action.damage} dmg (Boss HP: ${newBossHp.toLocaleString('pl-PL')})`, 'player');
            }

            if (newBossHp <= 0) {
                handleBossDeath();
                return;
            }
        }
    }, [addLog, handleBossDeath, updateBotMp]);

    // ── Refs for stable intervals ────────────────────────────────────────────
    const playerAtkRef = useRef(doPlayerAttack);
    const bossAtkRef   = useRef(doBossAttack);
    const botAtkRef    = useRef(doBotAttacks);
    useEffect(() => { playerAtkRef.current = doPlayerAttack; });
    useEffect(() => { bossAtkRef.current   = doBossAttack; });
    useEffect(() => { botAtkRef.current    = doBotAttacks; });

    // ── Attack intervals (scaled by speedMult) ───────────────────────────────
    useEffect(() => {
        if (phase !== 'fighting' || !activeBoss) return;
        const interval = Math.max(200, getAttackMs(charSpeed) / speedMult);
        const id = setInterval(() => playerAtkRef.current(), interval);
        return () => clearInterval(id);
    }, [phase, activeBoss?.id, charSpeed, speedMult]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (phase !== 'fighting' || !activeBoss) return;
        const bossSpeed = activeBoss.speed || 1.5;
        const interval = Math.max(200, getAttackMs(bossSpeed) / speedMult);
        const id = setInterval(() => bossAtkRef.current(), interval);
        return () => clearInterval(id);
    }, [phase, activeBoss?.id, speedMult]); // eslint-disable-line react-hooks/exhaustive-deps

    // Bot companions attack interval (slightly slower than player)
    useEffect(() => {
        if (phase !== 'fighting' || !activeBoss) return;
        const interval = Math.max(300, (getAttackMs(charSpeed) + 200) / speedMult);
        const id = setInterval(() => botAtkRef.current(), interval);
        return () => clearInterval(id);
    }, [phase, activeBoss?.id, charSpeed, speedMult]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className={`boss${phase === 'fighting' ? ' boss--fighting' : ''}`}>
            <header className="boss__header">
                <button className="boss__back" onClick={() => { setPhase('list'); navigate('/'); }}>
                    ← Miasto
                </button>
                <h1 className="boss__title">Bossowie</h1>
                <span className="boss__score">🏆 Boss Score: {getTotalScore().toLocaleString('pl-PL')}</span>
                {phase === 'fighting' && activeBoss && (
                    <span className="boss__fighting-badge">⚔️ Walka</span>
                )}
            </header>

            <AnimatePresence mode="wait">

                {/* ── Boss list ─────────────────────────────────────────────────── */}
                {phase === 'list' && (
                    <motion.div key="list" className="boss__panel"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        {bosses.map((b) => {
                            const attemptsUsed = getAttemptsUsed(b.id);
                            const attemptsMax  = getAttemptsMax();
                            const noAttempts   = !canChallenge(b.id);
                            const tooLow       = character.level < b.level;
                            const blocked      = noAttempts || tooLow;
                            const recommended  = getBossRecommendedLevel(b);

                            const allDone = attemptsUsed >= attemptsMax;

                            return (
                                <div key={b.id} className={`boss__card${blocked ? ' boss__card--blocked' : ''}${allDone ? ' boss__card--all-done' : ''}`}
                                    style={{ '--card-hue': getBossCardHue(b.level) } as React.CSSProperties}>
                                    <div className="boss__card-top">
                                        <span className="boss__sprite">{b.sprite}</span>
                                        <div className="boss__card-info">
                                            <div className="boss__card-name">{b.name_pl}</div>
                                            <div className="boss__card-level">Wymagany poziom: {b.level} (zalecany: {recommended})</div>
                                        </div>
                                    </div>

                                    <p className="boss__card-desc">{b.description_pl}</p>

                                    <div className="boss__card-stats">
                                        <span>❤️ HP: {getScaledBossStats(b).hp.toLocaleString('pl-PL')}</span>
                                        <span>⚔️ ATK: {getScaledBossStats(b).attack}</span>
                                        <span>🛡️ DEF: {getScaledBossStats(b).defense}</span>
                                        <span>⭐ XP: {getBossXp(b).toLocaleString('pl-PL')}</span>
                                        <span>💰 {(b.gold[0] * BOSS_REWARD_MULTIPLIER).toLocaleString('pl-PL')}–{(b.gold[1] * BOSS_REWARD_MULTIPLIER).toLocaleString('pl-PL')}</span>
                                    </div>
                                    <div className="boss__card-party-note">
                                        <span>👥 Zbalansowany dla 4-osobowej drużyny</span>
                                    </div>

                                    {/* Abilities */}
                                    {b.abilities && b.abilities.length > 0 && (
                                        <div className="boss__abilities">
                                            <span className="boss__abilities-label">Spelle:</span>
                                            {b.abilities.map((a, i) => (
                                                <span key={i} className="boss__ability-tag">{formatItemName(a)}</span>
                                            ))}
                                        </div>
                                    )}

                                    {/* Drop table toggle */}
                                    {(() => {
                                        const isExpanded = expandedBoss === b.id;
                                        const itemTiers = getBossItemDropTiers(b.level);
                                        return (
                                            <>
                                                <button
                                                    className={`boss__drop-toggle${isExpanded ? ' boss__drop-toggle--open' : ''}`}
                                                    onClick={() => setExpandedBoss(isExpanded ? null : b.id)}
                                                >
                                                    📦 Drop table {isExpanded ? '▲' : '▼'}
                                                </button>

                                                {isExpanded && (
                                                    <div className="boss__drop-table">
                                                        <div className="boss__drop-section">
                                                            <div className="boss__drop-section-title">💰 Nagrody</div>
                                                            <div className="boss__drop-info">
                                                                Gold: {(b.gold[0] * BOSS_REWARD_MULTIPLIER).toLocaleString('pl-PL')}–{(b.gold[1] * BOSS_REWARD_MULTIPLIER).toLocaleString('pl-PL')}
                                                            </div>
                                                            <div className="boss__drop-info">
                                                                XP: {getBossXp(b).toLocaleString('pl-PL')}
                                                            </div>
                                                            <div className="boss__drop-info">
                                                                Lvl itemów: {b.level}
                                                            </div>
                                                        </div>

                                                        <div className="boss__drop-section">
                                                            <div className="boss__drop-section-title">💎 Kamienie ulepszania</div>
                                                            {BOSS_STONE_DROPS.map((stone) => (
                                                                <div key={stone.name} className="boss__drop-tier">
                                                                    <span className="boss__drop-dot" style={{ background: '#9e9e9e' }} />
                                                                    <span className="boss__drop-tier-name">{stone.name}</span>
                                                                    <span className="boss__drop-tier-chance">{stone.chance}%</span>
                                                                </div>
                                                            ))}
                                                        </div>

                                                        <div className="boss__drop-section">
                                                            <div className="boss__drop-section-title">🎒 Przedmioty (Lvl {b.level})</div>
                                                            {itemTiers.map((tier) => (
                                                                <div key={tier.key} className="boss__drop-tier">
                                                                    <span className="boss__drop-dot" style={{ background: tier.color, boxShadow: `0 0 4px ${tier.color}` }} />
                                                                    <span className="boss__drop-tier-name" style={{ color: tier.color }}>{tier.label}</span>
                                                                    <span className="boss__drop-tier-chance">{tier.chance}%</span>
                                                                </div>
                                                            ))}
                                                            <div className="boss__drop-note">Heroic itemy dostepne tylko z bossow</div>
                                                        </div>

                                                        {(() => {
                                                            const potionInfo = getPotionDropInfo(b.level);
                                                            return (
                                                                <div className="boss__drop-section">
                                                                    <div className="boss__drop-section-title">🧪 Potiony</div>
                                                                    <div className="boss__drop-tier">
                                                                        <span className="boss__drop-dot" style={{ background: '#e57373' }} />
                                                                        <span className="boss__drop-tier-name" style={{ color: '#e57373' }}>
                                                                            ❤️ {potionInfo.hpLabel} ({potionInfo.hpHeal})
                                                                        </span>
                                                                        <span className="boss__drop-tier-chance">10%</span>
                                                                    </div>
                                                                    <div className="boss__drop-tier">
                                                                        <span className="boss__drop-dot" style={{ background: '#64b5f6' }} />
                                                                        <span className="boss__drop-tier-name" style={{ color: '#64b5f6' }}>
                                                                            💙 {potionInfo.mpLabel} ({potionInfo.mpHeal})
                                                                        </span>
                                                                        <span className="boss__drop-tier-chance">8%</span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}

                                                        {/* Spell chest drops */}
                                                        {(() => {
                                                            const chestInfo = getSpellChestDropInfo(b.level);
                                                            if (chestInfo.levels.length === 0) return null;
                                                            return (
                                                                <div className="boss__drop-section">
                                                                    <div className="boss__drop-section-title">📦 Spell Chests (x2 z bossow)</div>
                                                                    {chestInfo.levels.map((lvl) => (
                                                                        <div key={lvl} className="boss__drop-tier">
                                                                            <span className="boss__drop-dot" style={{ background: '#ab47bc' }} />
                                                                            <span className="boss__drop-tier-name" style={{ color: '#ab47bc' }}>
                                                                                {getSpellChestIcon(lvl)} Lvl {lvl}
                                                                            </span>
                                                                            <span className="boss__drop-tier-chance">{(chestInfo.baseChance * 200).toFixed(0)}%</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}

                                    <div className="boss__card-footer">
                                        <div className="boss__attempts">
                                            <span>⚔️ {attemptsUsed}/{attemptsMax}</span>
                                            <div className="boss__attempts-bar">
                                                <div
                                                    className={`boss__attempts-bar-fill${allDone ? ' boss__attempts-bar-fill--full' : ''}`}
                                                    style={{ width: `${(attemptsUsed / attemptsMax) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                        {noAttempts && (
                                            <span className="boss__cooldown">❌ Brak prób · reset o północy</span>
                                        )}
                                        {!noAttempts && tooLow && (
                                            <span className="boss__locked">🔒 Lvl {b.level} wymagany</span>
                                        )}
                                        {!blocked && (
                                            <button className="boss__challenge-btn" onClick={() => handleChallenge(b)}>
                                                Wyzwij
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </motion.div>
                )}

                {/* ── Pre-fight bot picker modal ──────────────────────────────── */}
                {pendingBoss && (
                    <motion.div
                        key="prefight"
                        className="boss__prefight-overlay"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={cancelPendingBoss}
                    >
                        <motion.div
                            className="boss__prefight-modal"
                            initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="boss__prefight-header">
                                <h2>Przygotuj się do walki</h2>
                                <p>{pendingBoss.name_pl} · Lvl {pendingBoss.level}</p>
                            </div>

                            <div className="boss__prefight-section">
                                <h3>Skład drużyny</h3>
                                <div className="boss__prefight-size">
                                    {[0, 1, 3].map((s) => (
                                        <button
                                            key={s}
                                            className={`boss__prefight-size-btn${partySize === s ? ' boss__prefight-size-btn--active' : ''}`}
                                            onClick={() => setPartySize(s as 0 | 1 | 3)}
                                        >
                                            {s === 0 ? 'Solo' : `${s + 1} osoby`}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {partySize > 0 && (
                                <div className="boss__prefight-section">
                                    <h3>Wybierz klasy botów</h3>
                                    <div className="boss__prefight-bots">
                                        {Array.from({ length: partySize }).map((_, i) => (
                                            <div key={i} className="boss__prefight-bot-row">
                                                <span className="boss__prefight-bot-label">Bot {i + 1}</span>
                                                <div className="boss__prefight-bot-classes">
                                                    {ALL_BOT_CLASSES.map((cls) => (
                                                        <button
                                                            key={cls}
                                                            className={`boss__prefight-class-btn${botPicks[i] === cls ? ' boss__prefight-class-btn--active' : ''}`}
                                                            onClick={() => updateBotPick(i, cls)}
                                                            title={cls}
                                                        >
                                                            {BOT_CLASS_ICONS[cls]}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="boss__prefight-actions">
                                <button className="boss__prefight-cancel" onClick={cancelPendingBoss}>
                                    Anuluj
                                </button>
                                <button className="boss__prefight-start" onClick={confirmBossFight}>
                                    ⚔️ Rozpocznij walkę
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}

                {/* ── Fighting (real combat) ────────────────────────────────────── */}
                {phase === 'fighting' && activeBoss && (
                    <motion.div key="fighting" className="boss__panel"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

                        {/* Arena */}
                        <div className="boss__arena">
                            {/* Boss card */}
                            <div className={`boss__combat-card boss__combat-card--monster${monsterHit ? ' boss__combat-card--hit' : ''}${playerAttacking ? ` boss__combat-card--attack-${character.class}` : ''}${enraged ? ' boss__combat-card--enraged' : ''}`}>
                                {enraged && <div className="boss__enraged-combat-badge">🔥 WŚCIEKŁY</div>}
                                <div className="boss__combat-card-header">
                                    <motion.span
                                        className="boss__combat-sprite"
                                        animate={monsterHit ? { scale: [1, 0.8, 1.1, 1], rotate: [0, -5, 5, 0] } : { scale: [1, 1.02, 1] }}
                                        transition={monsterHit ? { duration: 0.3 } : { repeat: Infinity, duration: 2 }}
                                    >
                                        {activeBoss.sprite}
                                    </motion.span>
                                    <div className="boss__combat-card-info">
                                        <span className="boss__combat-card-name">{activeBoss.name_pl}</span>
                                        <span className="boss__combat-card-sub">
                                            Boss · Lvl {activeBoss.level}
                                            {enraged ? ' · 🔥 WŚCIEKŁY' : ''}
                                        </span>
                                    </div>
                                    <span className="boss__combat-hp-text">
                                        {Math.max(0, bossHp).toLocaleString('pl-PL')}/{scaledBossMaxHp.toLocaleString('pl-PL')}
                                    </span>
                                </div>
                                <HpBar current={bossHp} max={scaledBossMaxHp} variant={enraged ? 'boss-enraged' : 'enemy'} />

                                {/* Floating damage on boss (from player) */}
                                <AnimatePresence>
                                    {floatingDmgs.filter((d) => d.type === 'player' || d.type === 'heal').map((d) => (
                                        <motion.div
                                            key={d.id}
                                            className={`boss__floating-dmg boss__floating-dmg--${d.type}${d.side ? ` boss__floating-dmg--${d.side}` : ''}`}
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
                            <div className={`boss__combat-card boss__combat-card--player${playerHit ? ' boss__combat-card--hit' : ''}${aggroTargetRef.current === 'player' ? ' boss__combat-card--targeted' : ''}`}>
                                {aggroTargetRef.current === 'player' && (
                                    <span className="boss__aggro-label">🎯 AGGRO</span>
                                )}
                                <div className="boss__combat-card-header">
                                    <div className="boss__player-avatar-wrap">
                                        <img
                                            src={playerAvatarSrc}
                                            alt={character.class}
                                            className="boss__player-avatar"
                                        />
                                        <span className="boss__player-avatar-lvl">Lvl {character.level}</span>
                                    </div>
                                    <div className="boss__combat-card-info">
                                        <span className="boss__combat-card-name">{character.name}</span>
                                        <span className="boss__combat-card-sub">{CLASS_ICONS[character.class] ?? '?'} {character.class}</span>
                                    </div>
                                </div>
                                {/* Floating damage on player */}
                                <AnimatePresence>
                                    {floatingDmgs.filter((d) => d.type === 'monster').map((d) => (
                                        <motion.div
                                            key={d.id}
                                            className="boss__floating-dmg boss__floating-dmg--monster"
                                            initial={{ opacity: 1, y: 0 }}
                                            animate={{ opacity: 0, y: -35 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.8, ease: 'easeOut' }}
                                        >
                                            {d.text}
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                                <div className="boss__combat-stat-row">
                                    <span className="boss__combat-stat-label">HP</span>
                                    <HpBar current={playerHp} max={charMaxHp} variant="hp" />
                                    <span className="boss__combat-hp-text">{Math.max(0, playerHp)}/{charMaxHp}</span>
                                </div>
                                <div className="boss__combat-stat-row">
                                    <span className="boss__combat-stat-label">MP</span>
                                    <HpBar current={playerMp} max={charMaxMp} variant="mp" />
                                    <span className="boss__combat-hp-text">{Math.max(0, playerMp)}/{charMaxMp}</span>
                                </div>
                            </div>

                            {/* Bot companions */}
                            {bots.length > 0 && (
                                <div className="boss__bot-party">
                                    <div className="boss__bot-party-title">Towarzysze</div>
                                    {bots.map((bot) => {
                                        const botHpPct = bot.maxHp > 0 ? Math.max(0, Math.min(100, (bot.hp / bot.maxHp) * 100)) : 0;
                                        const icon = BOT_CLASS_ICONS[bot.class] ?? '?';
                                        const isTarget = aggroTargetRef.current === bot.id;
                                        return (
                                            <div
                                                key={bot.id}
                                                className={`boss__bot-card${!bot.alive ? ' boss__bot-card--dead' : ''}${isTarget ? ' boss__bot-card--targeted' : ''}`}
                                            >
                                                {isTarget && <span className="boss__aggro-label">🎯 AGGRO</span>}
                                                <div className="boss__bot-card-header">
                                                    <span className="boss__bot-icon">{icon}</span>
                                                    <span className="boss__bot-name">{bot.name}</span>
                                                    <span className="boss__bot-level">Lvl {bot.level}</span>
                                                </div>
                                                <div className="boss__bot-hp-row">
                                                    <div className="boss__bot-hp-bar">
                                                        <motion.div
                                                            className={`boss__bot-hp-fill${!bot.alive ? ' boss__bot-hp-fill--dead' : ''}`}
                                                            animate={{ width: `${botHpPct}%` }}
                                                            transition={{ duration: 0.18, ease: 'easeOut' }}
                                                        />
                                                    </div>
                                                    <span className="boss__bot-hp-text">
                                                        {bot.alive ? `${bot.hp}/${bot.maxHp}` : 'POLEGŁ'}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Combat toggles */}
                            <div className="boss__combat-toggles">
                                <button
                                    className={`boss__toggle-btn boss__toggle-btn--speed boss__toggle-btn--speed-${speedMode}`}
                                    onClick={cycleSpeed}
                                    title="Prędkość walki"
                                >
                                    ⏱ {speedMode.toUpperCase()}
                                </button>
                                <button
                                    className={`boss__toggle-btn boss__toggle-btn--${skillMode}`}
                                    onClick={() => setSkillMode(skillMode === 'auto' ? 'manual' : 'auto')}
                                >
                                    {skillMode === 'auto' ? '🔄 Skille: AUTO' : '👆 Skille: MANUAL'}
                                </button>
                                <button
                                    className={`boss__toggle-btn boss__toggle-btn--potion${autoPotionHpEnabled || autoPotionMpEnabled ? '' : ' boss__toggle-btn--off'}`}
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
                            <div className="boss__skill-slots">
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
                                                'boss__skill-slot',
                                                isEmpty ? 'boss__skill-slot--empty' : 'boss__skill-slot--filled',
                                                cdActive ? 'boss__skill-slot--on-cooldown' : '',
                                                !isEmpty && isManual && !cdActive ? 'boss__skill-slot--manual' : '',
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
                                                    className="boss__skill-cd-overlay"
                                                    style={{ height: `${cdFraction * 100}%` }}
                                                />
                                            )}
                                            <span className="boss__skill-slot-name">{formatSkillName(skillId)}</span>
                                            {!isEmpty && (
                                                <span className="boss__skill-slot-badge">
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
                            <div className="boss__potions">
                                {bestHpPotion && (() => {
                                    const count = consumables[bestHpPotion.id] ?? 0;
                                    const hpCdActive = hpPotionCooldown > 0;
                                    const hpCdFraction = hpCdActive ? hpPotionCooldown / POTION_COOLDOWN_MS : 0;
                                    return (
                                        <button
                                            className={`boss__potion-btn boss__potion-btn--hp${hpCdActive ? ' boss__potion-btn--cooldown' : ''}`}
                                            onClick={() => doUsePotion(bestHpPotion.id)}
                                            disabled={count === 0 || hpCdActive}
                                            title={hpCdActive ? `Cooldown: ${Math.ceil(hpPotionCooldown / 1000)}s` : count === 0 ? 'Brak eliksirów HP' : bestHpPotion.description_pl}
                                        >
                                            {hpCdActive && (
                                                <span className="boss__potion-cd-overlay" style={{ height: `${hpCdFraction * 100}%` }} />
                                            )}
                                            <span className="boss__potion-label">{bestHpPotion.icon} {getPotionLabel(bestHpPotion.effect)}</span>
                                            <span className="boss__potion-count">x{count}</span>
                                        </button>
                                    );
                                })()}
                                {bestMpPotion && (() => {
                                    const count = consumables[bestMpPotion.id] ?? 0;
                                    const mpCdActive = mpPotionCooldown > 0;
                                    const mpCdFraction = mpCdActive ? mpPotionCooldown / POTION_COOLDOWN_MS : 0;
                                    return (
                                        <button
                                            className={`boss__potion-btn boss__potion-btn--mp${mpCdActive ? ' boss__potion-btn--cooldown' : ''}`}
                                            onClick={() => doUsePotion(bestMpPotion.id)}
                                            disabled={count === 0 || mpCdActive}
                                            title={mpCdActive ? `Cooldown: ${Math.ceil(mpPotionCooldown / 1000)}s` : count === 0 ? 'Brak eliksirów MP' : bestMpPotion.description_pl}
                                        >
                                            {mpCdActive && (
                                                <span className="boss__potion-cd-overlay" style={{ height: `${mpCdFraction * 100}%` }} />
                                            )}
                                            <span className="boss__potion-label">{bestMpPotion.icon} {getPotionLabel(bestMpPotion.effect)}</span>
                                            <span className="boss__potion-count">x{count}</span>
                                        </button>
                                    );
                                })()}
                                {/* Pct HP Potion */}
                                {bestPctHpPotion && (() => {
                                    const count = consumables[bestPctHpPotion.id] ?? 0;
                                    const cdActive = pctHpCooldown > 0;
                                    const cdFrac = cdActive ? pctHpCooldown / PCT_POTION_CD_MS : 0;
                                    return (
                                        <button
                                            className={`boss__potion-btn boss__potion-btn--pct-hp${cdActive ? ' boss__potion-btn--cooldown' : ''}${count === 0 ? ' boss__potion-btn--empty' : ''}`}
                                            onClick={() => doUsePotion(bestPctHpPotion.id)}
                                            disabled={count === 0 || cdActive}
                                            title={cdActive ? `Cooldown: ${Math.ceil(pctHpCooldown / 1000)}s` : count === 0 ? 'Brak % potionów HP' : bestPctHpPotion.description_pl}
                                        >
                                            {cdActive && (
                                                <span className="boss__potion-cd-overlay" style={{ height: `${cdFrac * 100}%` }} />
                                            )}
                                            <span className="boss__potion-label">❤️‍🔥 {getPotionLabel(bestPctHpPotion.effect)}</span>
                                            <span className="boss__potion-count">x{count}</span>
                                        </button>
                                    );
                                })()}
                                {/* Pct MP Potion */}
                                {bestPctMpPotion && (() => {
                                    const count = consumables[bestPctMpPotion.id] ?? 0;
                                    const cdActive = pctMpCooldown > 0;
                                    const cdFrac = cdActive ? pctMpCooldown / PCT_POTION_CD_MS : 0;
                                    return (
                                        <button
                                            className={`boss__potion-btn boss__potion-btn--pct-mp${cdActive ? ' boss__potion-btn--cooldown' : ''}${count === 0 ? ' boss__potion-btn--empty' : ''}`}
                                            onClick={() => doUsePotion(bestPctMpPotion.id)}
                                            disabled={count === 0 || cdActive}
                                            title={cdActive ? `Cooldown: ${Math.ceil(pctMpCooldown / 1000)}s` : count === 0 ? 'Brak % potionów MP' : bestPctMpPotion.description_pl}
                                        >
                                            {cdActive && (
                                                <span className="boss__potion-cd-overlay" style={{ height: `${cdFrac * 100}%` }} />
                                            )}
                                            <span className="boss__potion-label">💎 {getPotionLabel(bestPctMpPotion.effect)}</span>
                                            <span className="boss__potion-count">x{count}</span>
                                        </button>
                                    );
                                })()}
                            </div>

                            {/* Flee button */}
                            <button
                                className="boss__flee-btn"
                                onClick={() => {
                                    setResult({ won: false, playerHpLeft: playerHp, turns: 0, drops: [], gold: 0, xp: 0 });
                                    clearBots();
                                    setPhase('result');
                                }}
                            >
                                Uciekaj
                            </button>
                        </div>

                        {/* Combat log */}
                        <div className="boss__combat-log">
                            {combatLog.map((entry) => (
                                <div key={entry.id} className={`boss__combat-log-entry boss__combat-log-entry--${entry.type}`}>
                                    {entry.text}
                                </div>
                            ))}
                            <div ref={logEndRef} />
                        </div>
                    </motion.div>
                )}

                {/* ── Result ────────────────────────────────────────────────────── */}
                {phase === 'result' && result && activeBoss && (
                    <motion.div key="result" className="boss__panel"
                        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                        <div className={`boss__result${result.won ? ' boss__result--win' : ' boss__result--loss'}`}>
                            <div className="boss__result-sprite">{activeBoss.sprite}</div>
                            <div className="boss__result-title">
                                {result.won ? '🏆 Boss Pokonany!' : '💀 Porażka'}
                            </div>
                            <div className="boss__result-boss">{activeBoss.name_pl}</div>

                            {result.won ? (
                                <div className="boss__rewards">
                                    <div className="boss__reward-row"><span>💰 Gold</span><span>+{result.gold}</span></div>
                                    <div className="boss__reward-row"><span>⭐ XP</span><span>+{result.xp}</span></div>

                                    {result.drops.length > 0 ? (
                                        <div className="boss__drops-result">
                                            <div className="boss__drops-result-title">Zdobyte przedmioty ({result.drops.length})</div>
                                            <div className="boss__drops-grid">
                                                {result.drops.map((drop: IBossUniqueItem, i: number) => {
                                                    const info = getItemDisplayInfo(drop.itemId);
                                                    const icon = info?.icon ?? '📦';
                                                    const rarity = drop.rarity ?? 'legendary';
                                                    return (
                                                        <div key={i} className="boss__drop-item">
                                                            <ItemIcon icon={icon} rarity={rarity} size="md" />
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="boss__no-drops">Brak dodatkowych przedmiotow tym razem.</div>
                                    )}
                                </div>
                            ) : (
                                <p className="boss__fail-msg">
                                    Za słaby by pokonać {activeBoss.name_pl}. Wróć silniejszy!
                                </p>
                            )}

                            <div className="boss__result-actions">
                                {canChallenge(activeBoss.id) && (
                                    <button
                                        className="boss__retry-btn"
                                        onClick={retryBossFight}
                                    >
                                        🔄 Ponów walkę
                                    </button>
                                )}
                                <button className="boss__back-btn" onClick={() => { clearBots(); setPhase('list'); }}>
                                    ← Lista bossów
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Epic boss entry: doors sliding open ──────────────────────── */}
            <AnimatePresence>
                {bossEntryBoss && (
                    <motion.div
                        key="boss-entry"
                        className="boss__entry-overlay"
                        initial={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        {/* Arena backdrop behind the doors — revealed as they slide off,
                            so the player sees boss atmosphere, not the previous screen. */}
                        <div className="boss__entry-bg" aria-hidden="true" />
                        {/* Left door slides off to the left */}
                        <motion.div
                            className="boss__entry-door boss__entry-door--left"
                            initial={{ x: 0 }}
                            animate={{ x: '-110%' }}
                            transition={{ delay: 0.4, duration: 0.9, ease: [0.7, 0, 0.3, 1] }}
                        />
                        {/* Right door slides off to the right */}
                        <motion.div
                            className="boss__entry-door boss__entry-door--right"
                            initial={{ x: 0 }}
                            animate={{ x: '110%' }}
                            transition={{ delay: 0.4, duration: 0.9, ease: [0.7, 0, 0.3, 1] }}
                        />
                        {/* Crack of light down the seam (fades out once doors are gone) */}
                        <motion.div
                            className="boss__entry-seam"
                            initial={{ scaleY: 0, opacity: 0 }}
                            animate={{
                                scaleY: [0, 1, 1, 0],
                                opacity: [0, 1, 1, 0],
                            }}
                            transition={{ duration: 1.3, times: [0, 0.3, 0.65, 1] }}
                        />
                        {/* Boss name + sprite reveal. Stays visible through the
                            whole entry so when the doors finish opening the boss
                            is clearly on screen before combat mounts. */}
                        <motion.div
                            className="boss__entry-label"
                            initial={{ opacity: 0, scale: 0.6, y: 20 }}
                            animate={{
                                opacity: [0, 1, 1, 1],
                                scale:   [0.6, 1.1, 1, 1.08],
                                y:       [20, 0, 0, 0],
                            }}
                            transition={{ duration: 2.0, times: [0, 0.25, 0.65, 1], ease: 'easeOut' }}
                        >
                            <span className="boss__entry-sprite">{bossEntryBoss.sprite ?? '👹'}</span>
                            <span className="boss__entry-name">{bossEntryBoss.name_pl}</span>
                            <span className="boss__entry-level">Lvl {bossEntryBoss.level}</span>
                        </motion.div>
                        {/* Shockwave ring on seam crack */}
                        <motion.div
                            className="boss__entry-shock"
                            initial={{ scale: 0, opacity: 0.9 }}
                            animate={{ scale: 4, opacity: 0 }}
                            transition={{ delay: 0.35, duration: 0.7, ease: 'easeOut' }}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default Boss;
