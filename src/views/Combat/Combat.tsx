import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    calculateDamage,
    getMonsterAttackRange,
    MONSTER_STAT_MULTIPLIERS,
} from '../../systems/combat';
import {
    HP_POTION_DROP_CHANCE,
    MP_POTION_DROP_CHANCE,
    MONSTER_RARITY_LABELS,
    SPELL_CHEST_BASE_CHANCE,
    getEffectiveRarityChances,
    formatRarityChance,
    getSpellChestDropInfo,
    getPotionDropInfo,
    type TMonsterRarity,
} from '../../systems/lootSystem';
import { getTotalEquipmentStats, flattenItemsData, type IBaseItem } from '../../systems/itemSystem';
import { getTrainingBonuses } from '../../systems/skillSystem';
import {
    getAtkDamageMultiplier,
    getSpellDamageMultiplier,
    getElixirHpBonus,
    getElixirMpBonus,
    getElixirDefBonus,
    getElixirAttackSpeedMultiplier,
} from '../../systems/combatElixirs';
import { getTransformDmgMultiplier } from '../../systems/transformBonuses';
import itemsData from '../../data/items.json';
import ItemIcon from '../../components/ui/ItemIcon/ItemIcon';
import { useCombatStore, type IMonster } from '../../stores/combatStore';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useSkillStore } from '../../stores/skillStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { usePartyStore } from '../../stores/partyStore';
import { getPartyGateLevel } from '../../systems/partySystem';
import { xpProgress, xpToNextLevel } from '../../systems/levelSystem';
import { useTaskStore } from '../../stores/taskStore';
import { useQuestStore, getActiveQuestKillProgress } from '../../stores/questStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { ELIXIRS } from '../../stores/shopStore';
import {
    startNewFight as engineStartNewFight,
    stopCombat,
    handleMonsterDeath as engineHandleMonsterDeath,
    addMonsterToWave,
    SPEED_ORDER,
    getEffectiveChar as engineGetEffectiveChar,
} from '../../systems/combatEngine';
import { MAX_WAVE_MONSTERS } from '../../stores/combatStore';
import { useMasteryStore, MASTERY_KILL_THRESHOLD, MASTERY_MAX_LEVEL } from '../../stores/masteryStore';
import { useCooldownStore } from '../../stores/cooldownStore';
import { useBotStore } from '../../stores/botStore';
import {
    getBestPotion as getBestPotionUtil,
    getPotionLabel,
    FLAT_HP_POTIONS,
    FLAT_MP_POTIONS,
    PCT_HP_POTIONS,
    PCT_MP_POTIONS,
    PCT_POTION_COOLDOWN_MS as PCT_CD_MS,
} from '../../systems/potionSystem';
import monstersRaw from '../../data/monsters.json';
import { getMonsterUnlockStatus } from '../../systems/progression';
import classesRaw from '../../data/classes.json';
import { getSkillIcon } from '../../data/skillIcons';
import { getSkillAnimation, type ISkillAnimation } from '../../data/skillAnimations';
import { getCharacterAvatar } from '../../data/classAvatars';
import { useTransformStore } from '../../stores/transformStore';
import { applySkillBuff, getSkillDef } from '../../systems/skillBuffs';
import './Combat.scss';

const CLASS_ICONS: Record<string, string> = {
  Knight: '⚔️', Mage: '🔮', Cleric: '✨', Archer: '🏹',
  Rogue: '🗡️', Necromancer: '💀', Bard: '🎵',
};

// Potion cooldown durations (ms) — for manual potion use UI
const HP_POTION_COOLDOWN_MS = 1000;
const MP_POTION_COOLDOWN_MS = 1000;
const SKILL_COOLDOWN_MS = 8000;
const SKILL_MP_COST = 15;

// ── Types / constants ─────────────────────────────────────────────────────────

const monsters = monstersRaw as unknown as IMonster[];

interface IClassData {
    dualWield?: boolean;
    dualWieldDmgPercent?: number;
    canBlock?: boolean;
    canDodge?: boolean;
    maxCritChance?: number;
    mlvlFromAttacks?: boolean;
}

const classesArray = classesRaw as unknown as (IClassData & { id: string })[];
const classesData: Record<string, IClassData> = {};
for (const c of classesArray) {
    classesData[c.id] = c;
}

const CLASS_MODIFIER: Record<string, number> = {
    Knight: 1.0, Mage: 1.3, Cleric: 1.0,
    Archer: 1.2, Rogue: 1.0, Necromancer: 1.2, Bard: 1.0,
};

// ── Drop breakdown helpers (same logic as MonsterList) ───────────────────────

const RARITY_THRESHOLDS = [0.55, 0.25, 0.12, 0.05, 0.025, 0.005];
const RARITY_TIER_NAMES: { key: string; label: string; color: string }[] = [
    { key: 'common', label: 'Common', color: '#ffffff' },
    { key: 'rare', label: 'Rare', color: '#2196f3' },
    { key: 'epic', label: 'Epic', color: '#4caf50' },
    { key: 'legendary', label: 'Legendary', color: '#f44336' },
    { key: 'mythic', label: 'Mythic', color: '#ffc107' },
    { key: 'heroic', label: 'Heroic', color: '#9c27b0' },
];

const MONSTER_MAX_RARITY_INDEX: Record<string, number> = {
    normal: 0, strong: 1, epic: 2, legendary: 3, boss: 4,
};

const ROLL_COUNTS: Record<string, number> = { normal: 2, strong: 3, epic: 4, legendary: 5, boss: 6 };
const DROP_CHANCES: Record<string, number> = { normal: 0.08, strong: 0.12, epic: 0.15, legendary: 0.20, boss: 0.30 };

const STONE_NAMES_MAP: Record<string, string> = {
    normal: 'Common Stone', strong: 'Rare Stone', epic: 'Epic Stone',
    legendary: 'Legendary Stone', boss: 'Mythic Stone',
    common_stone: 'Common Stone', rare_stone: 'Rare Stone', epic_stone: 'Epic Stone',
    legendary_stone: 'Legendary Stone', mythic_stone: 'Mythic Stone', heroic_stone: 'Heroic Stone',
};

const STONE_CHANCES_MAP: Record<string, number> = {
    normal: 0.10, strong: 0.07, epic: 0.04, legendary: 0.02, boss: 0.01,
};

const COMBAT_VARIANTS = [
    { key: 'normal' as const,    label: 'Normal',    color: '#9e9e9e', chance: '90%',  hpMult: MONSTER_STAT_MULTIPLIERS.normal.hp,    atkMult: MONSTER_STAT_MULTIPLIERS.normal.atk,    defMult: MONSTER_STAT_MULTIPLIERS.normal.def,    xpMult: MONSTER_STAT_MULTIPLIERS.normal.xp,    goldMult: MONSTER_STAT_MULTIPLIERS.normal.gold,    taskKills: 1 },
    { key: 'strong' as const,    label: 'Strong',    color: '#2196f3', chance: '7%',   hpMult: MONSTER_STAT_MULTIPLIERS.strong.hp,    atkMult: MONSTER_STAT_MULTIPLIERS.strong.atk,    defMult: MONSTER_STAT_MULTIPLIERS.strong.def,    xpMult: MONSTER_STAT_MULTIPLIERS.strong.xp,    goldMult: MONSTER_STAT_MULTIPLIERS.strong.gold,    taskKills: 3 },
    { key: 'epic' as const,      label: 'Epic',      color: '#4caf50', chance: '1.5%', hpMult: MONSTER_STAT_MULTIPLIERS.epic.hp,      atkMult: MONSTER_STAT_MULTIPLIERS.epic.atk,      defMult: MONSTER_STAT_MULTIPLIERS.epic.def,      xpMult: MONSTER_STAT_MULTIPLIERS.epic.xp,      goldMult: MONSTER_STAT_MULTIPLIERS.epic.gold,      taskKills: 10 },
    { key: 'legendary' as const, label: 'Legendary', color: '#f44336', chance: '1%',   hpMult: MONSTER_STAT_MULTIPLIERS.legendary.hp, atkMult: MONSTER_STAT_MULTIPLIERS.legendary.atk, defMult: MONSTER_STAT_MULTIPLIERS.legendary.def, xpMult: MONSTER_STAT_MULTIPLIERS.legendary.xp, goldMult: MONSTER_STAT_MULTIPLIERS.legendary.gold, taskKills: 50 },
    { key: 'boss' as const,      label: 'Boss',      color: '#ffc107', chance: '0.5%', hpMult: MONSTER_STAT_MULTIPLIERS.boss.hp,      atkMult: MONSTER_STAT_MULTIPLIERS.boss.atk,      defMult: MONSTER_STAT_MULTIPLIERS.boss.def,      xpMult: MONSTER_STAT_MULTIPLIERS.boss.xp,      goldMult: MONSTER_STAT_MULTIPLIERS.boss.gold,      taskKills: 200 },
];

interface ICombatDropTier { key: string; label: string; color: string; chancePerRoll: number; }

const getCombatDropBreakdown = (variant: string): { rollCount: number; dropChance: number; tiers: ICombatDropTier[] } => {
    const maxIdx = MONSTER_MAX_RARITY_INDEX[variant] ?? 0;
    const dropChance = DROP_CHANCES[variant] ?? 0.08;
    const rollCount = ROLL_COUNTS[variant] ?? 2;
    const applicable = RARITY_THRESHOLDS.slice(0, maxIdx + 1);
    const totalWeight = applicable.reduce((a, b) => a + b, 0);
    const tiers: ICombatDropTier[] = applicable.map((t, i) => ({
        key: RARITY_TIER_NAMES[i].key,
        label: RARITY_TIER_NAMES[i].label,
        color: RARITY_TIER_NAMES[i].color,
        chancePerRoll: (t / totalWeight) * dropChance * 100,
    }));
    return { rollCount, dropChance: dropChance * 100, tiers };
};

/**
 * Returns a random weapon damage value from mainHand (for manual skill use).
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatSkillName = (id: string | null): string => {
    if (!id) return '—';
    const name = id.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `${getSkillIcon(id)} ${name}`;
};

// ── Sub-components ────────────────────────────────────────────────────────────

const HpBar = ({
    current, max, variant,
}: {
    current: number; max: number; variant: 'hp' | 'mp' | 'enemy';
}) => {
    const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
    return (
        <div className={`combat__bar combat__bar--${variant}`}>
            <motion.div
                className="combat__bar-fill"
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
            />
        </div>
    );
};

// ── Main component ────────────────────────────────────────────────────────────

const ALL_ITEMS: IBaseItem[] = flattenItemsData(itemsData as Parameters<typeof flattenItemsData>[0]);

const Combat = () => {
    const navigate  = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const party     = usePartyStore((s) => s.party);
    const equipment = useInventoryStore((s) => s.equipment);
    const { combatSpeed, setCombatSpeed, skillMode, setSkillMode, showCombatXpBar, setShowCombatXpBar } = useSettingsStore();
    const { activeSkillSlots } = useSkillStore();
    const consumables = useInventoryStore((s) => s.consumables);
    const activeTasks = useTaskStore((s) => s.activeTasks);
    const activeQuests = useQuestStore((s) => s.activeQuests);
    const completedTransforms = useTransformStore((s) => s.completedTransforms);
    const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
    const transformColor = getHighestTransformColor();
    const playerAvatarSrc = character ? getCharacterAvatar(character.class, completedTransforms) : '';

    // Derive an accent color from the active transform tier (solid or first stop
    // of the gradient). Falls back to the class color if no transform unlocked.
    const classColorFallbackMap: Record<string, string> = {
        Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
        Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
    };
    const playerAccent = (() => {
        if (transformColor?.solid) return transformColor.solid;
        if (transformColor?.gradient?.[0]) return transformColor.gradient[0];
        return character ? (classColorFallbackMap[character.class] ?? '#e94560') : '#e94560';
    })();
    const playerAccentRgb = (() => {
        const hex = playerAccent.replace('#', '');
        if (hex.length !== 6) return '233, 69, 96';
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `${r}, ${g}, ${b}`;
    })();
    const playerAccentFill = (() => {
        const g = transformColor?.gradient;
        if (g && g.length >= 2) return `linear-gradient(90deg, ${g.join(', ')})`;
        return playerAccent;
    })();

    // Calculate effective stats (base character + equipment bonuses) for display.
    // Use the SAME engine helper the combat system uses so the displayed max_hp /
    // max_mp match what the engine and auto-potion logic see — otherwise the UI
    // can show `current > max` (e.g. HP 4055/3962 with an active transform) and
    // auto-potions fire against a higher engine-max than the UI shows.
    const eqStats = useMemo(
        () => getTotalEquipmentStats(equipment, ALL_ITEMS),
        [equipment],
    );
    const skillLevelsForStats = useSkillStore((s) => s.skillLevels);
    const effectiveChar = useMemo(() => {
        if (!character) return null;
        const engineEff = engineGetEffectiveChar(character);
        if (engineEff) return engineEff;
        // Fallback if engine helper returned null for any reason — keeps UI safe.
        const tb = getTrainingBonuses(skillLevelsForStats, character.class);
        return {
            ...character,
            attack: character.attack + eqStats.attack,
            defense: character.defense + eqStats.defense + tb.defense + getElixirDefBonus(),
            max_hp: character.max_hp + eqStats.hp + tb.max_hp + getElixirHpBonus(),
            max_mp: character.max_mp + eqStats.mp + tb.max_mp + getElixirMpBonus(),
            attack_speed: (character.attack_speed + eqStats.speed * 0.01 + tb.attack_speed) * getElixirAttackSpeedMultiplier(),
            crit_chance: Math.min(0.5, character.crit_chance + eqStats.critChance * 0.01 + tb.crit_chance),
            crit_damage: (character.crit_damage ?? 2.0) + eqStats.critDmg * 0.01 + tb.crit_dmg,
            hp_regen: (character.hp_regen ?? 0) + tb.hp_regen,
        };
        // `completedTransforms` is in the dep list so transform changes
        // recompute the effective stats while the Combat view is mounted.
    }, [character, eqStats, skillLevelsForStats, completedTransforms]);

    // ── Combat store state ────────────────────────────────────────────────────
    const {
        phase, monster, monsterCurrentHp,
        playerCurrentHp, playerCurrentMp,
        log, earnedXp, earnedGold, monsterRarity,
        addLog, healPlayerHp, healPlayerMp, spendPlayerMp, resetCombat,
        setSelectedMonster,
    } = useCombatStore();

    // Background combat state from store (not local)
    const autoFight = useCombatStore((s) => s.autoFight);
    const lastDrops = useCombatStore((s) => s.lastDrops);
    const sessionKills = useCombatStore((s) => s.sessionKills);
    const xpPerHour = useCombatStore((s) => s.sessionXpPerHour);
    const lastCombatEvent = useCombatStore((s) => s.lastCombatEvent);
    // Wave state
    const waveMonsters = useCombatStore((s) => s.waveMonsters);
    const activeTargetIdx = useCombatStore((s) => s.activeTargetIdx);
    const wavePlannedCount = useCombatStore((s) => s.wavePlannedCount);
    const removeLastWaveMonster = useCombatStore((s) => s.removeLastWaveMonster);
    const decrementWavePlannedCount = useCombatStore((s) => s.decrementWavePlannedCount);
    // Party bots fighting alongside the player (hydrated in startNewFight)
    const partyBots = useBotStore((s) => s.bots);

    const logEndRef       = useRef<HTMLDivElement>(null);
    const logContainerRef = useRef<HTMLDivElement>(null);

    // Expandable drop info in monster picker
    const [expandedMonster, setExpandedMonster] = useState<string | null>(null);

    // ── Combat animation state ─────────────────────────────────────────────────
    // Per-monster hit tracking: stores the index of the monster currently being
    // hit so the attack animation fires on the correct wave slot, not just
    // the "active" target. Also tracks the CSS class for the attacker.
    const [hitMonsterIdx, setHitMonsterIdx] = useState<number | null>(null);
    const [playerHit, setPlayerHit] = useState(false);
    const [playerAttacking, setPlayerAttacking] = useState(false);
    const [attackingClassName, setAttackingClassName] = useState<string | null>(null);
    const [monsterAttacking, setMonsterAttacking] = useState(false);
    // Track the last victory timestamp for the loot-bar flash animation key
    const [victoryFlashKey, setVictoryFlashKey] = useState(0);
    interface IFloatingDmg {
        id: number;
        text: string;
        type: 'player' | 'monster' | 'crit' | 'heal' | 'block' | 'dodge';
        source: 'player' | 'monster';
        side?: 'left' | 'right';
    }
    const [floatingDmgs, setFloatingDmgs] = useState<IFloatingDmg[]>([]);
    const dmgIdRef = useRef(0);

    // ── Skill animation overlay state ─────────────────────────────────────────
    const [skillAnimOverlay, setSkillAnimOverlay] = useState<{ id: number; anim: ISkillAnimation } | null>(null);
    const skillAnimIdRef = useRef(0);

    const triggerSkillAnim = useCallback((skillId: string) => {
        const animData = getSkillAnimation(skillId);
        if (!animData) return;
        skillAnimIdRef.current += 1;
        setSkillAnimOverlay({ id: skillAnimIdRef.current, anim: animData });
        setTimeout(() => {
            setSkillAnimOverlay((prev) => prev?.id === skillAnimIdRef.current ? null : prev);
        }, animData.duration);
    }, []);

    // ── Potion + skill cooldown state ──────────────────────────────────────────
    const hpPotionCooldown = useCooldownStore((s) => s.hpPotionCooldown);
    const mpPotionCooldown = useCooldownStore((s) => s.mpPotionCooldown);
    const pctHpCooldown = useCooldownStore((s) => s.pctHpCooldown);
    const pctMpCooldown = useCooldownStore((s) => s.pctMpCooldown);
    const skillCooldowns = useCooldownStore((s) => s.skillCooldowns);

    const startHpCooldown = useCallback((cdMs: number) => {
        if (cdMs <= 0) return;
        useCooldownStore.getState().setHpPotionCooldown(cdMs);
    }, []);
    const startMpCooldown = useCallback((cdMs: number) => {
        if (cdMs <= 0) return;
        useCooldownStore.getState().setMpPotionCooldown(cdMs);
    }, []);
    const startPctHpCooldown = useCallback((cdMs: number) => {
        if (cdMs <= 0) return;
        useCooldownStore.getState().setPctHpCooldown(cdMs);
    }, []);
    const startPctMpCooldown = useCallback((cdMs: number) => {
        if (cdMs <= 0) return;
        useCooldownStore.getState().setPctMpCooldown(cdMs);
    }, []);
    const startSkillCooldown = useCallback((skillId: string) => {
        useCooldownStore.getState().setSkillCooldown(skillId, SKILL_COOLDOWN_MS);
    }, []);

    const ATTACK_ANIM_DURATION: Record<string, number> = {
        Knight: 350, Mage: 400, Cleric: 400, Archer: 300,
        Rogue: 250, Necromancer: 450, Bard: 400,
    };

    const showFloatingDmg = (
        text: string,
        type: 'player' | 'monster' | 'crit' | 'heal' | 'block' | 'dodge',
        source: 'player' | 'monster',
        side?: 'left' | 'right',
    ) => {
        const id = ++dmgIdRef.current;
        const entry: IFloatingDmg = { id, text, type, source, side };
        setFloatingDmgs((prev) => [...prev, entry]);
        setTimeout(() => setFloatingDmgs((prev) => prev.filter((e) => e.id !== id)), 900);
    };

    const triggerMonsterHit = () => {
        const idx = useCombatStore.getState().activeTargetIdx;
        setHitMonsterIdx(idx);
        setPlayerAttacking(true);
        setAttackingClassName(character?.class ?? null);
        const dur = ATTACK_ANIM_DURATION[character?.class ?? ''] ?? 350;
        setTimeout(() => { setHitMonsterIdx(null); setPlayerAttacking(false); setAttackingClassName(null); }, dur);
    };

    const triggerPlayerHit = () => {
        setPlayerHit(true);
        setMonsterAttacking(true);
        setTimeout(() => { setPlayerHit(false); setMonsterAttacking(false); }, 300);
    };

    // ── Subscribe to combat events from engine (for animations) ───────────────
    const lastEventRef = useRef<number>(0);
    useEffect(() => {
        if (!lastCombatEvent) return;
        if (lastCombatEvent.timestamp <= lastEventRef.current) return;
        lastEventRef.current = lastCombatEvent.timestamp;

        const { type, data } = lastCombatEvent;

        if (type === 'monsterHit') {
            triggerMonsterHit();
            const damage = (data?.damage as number) ?? 0;
            const isCrit = data?.isCrit as boolean;
            const hand = data?.hand as string | null;
            if (hand) {
                showFloatingDmg(`🗡️ -${damage}`, isCrit ? 'crit' : 'player', 'player', hand as 'left' | 'right');
            } else {
                showFloatingDmg(`-${damage}`, isCrit ? 'crit' : 'player', 'player');
            }
        } else if (type === 'playerHit') {
            triggerPlayerHit();
            const damage = (data?.damage as number) ?? 0;
            const isCrit = data?.isCrit as boolean;
            const isBlocked = data?.isBlocked as boolean;
            const mpDamage = (data?.mpDamage as number) ?? 0;
            if (isBlocked) {
                showFloatingDmg(`-${damage} 🛡️`, 'block', 'monster');
            } else {
                const utamoSuffix = mpDamage > 0 ? ' 🔵' : '';
                showFloatingDmg(`-${damage}${utamoSuffix}`, isCrit ? 'crit' : 'monster', 'monster');
            }
        } else if (type === 'playerDodge') {
            triggerPlayerHit();
            showFloatingDmg('UNIK!', 'dodge', 'monster');
        } else if (type === 'skillAnim') {
            const skillId = data?.skillId as string;
            if (skillId) triggerSkillAnim(skillId);
        }
    }, [lastCombatEvent]); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-scroll combat log
    useEffect(() => {
        const container = logContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, [log.length]);

    // ── Helper: get class config ──────────────────────────────────────────────
    const getClassConfig = useCallback((className: string): IClassData => {
        return classesData[className] ?? {};
    }, []);

    // ── Skill use (manual mode) ───────────────────────────────────────────────
    const doUseSkill = (slotIdx: 0 | 1 | 2 | 3) => {
        const skillId = activeSkillSlots[slotIdx];
        const s       = useCombatStore.getState();
        const char    = useCharacterStore.getState().character;
        if (!skillId || !char || s.phase !== 'fighting' || !s.monster) return;

        if (s.playerCurrentMp < SKILL_MP_COST) {
            s.addLog('Za mało MP!', 'system');
            return;
        }

        const classConfig = getClassConfig(char.class);
        const maxCrit = (classConfig.maxCritChance ?? 30) / 100;

        const r = calculateDamage({
            baseAtk: char.attack, weaponAtk: rollWeaponDamage(),
            skillBonus: Math.floor(char.attack * 0.5),
            classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
            enemyDefense: s.monster.defense,
            critChance: 0.20,
            maxCritChance: maxCrit,
            damageMultiplier: getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier(),
        });

        s.dealToMonster(r.finalDamage);
        spendPlayerMp(SKILL_MP_COST);
        startSkillCooldown(skillId);
        triggerSkillAnim(skillId);
        { const sd = getSkillDef(skillId); if (sd) applySkillBuff(skillId, sd); }
        if (r.finalDamage > 0) {
            useDailyQuestStore.getState().addProgress('deal_damage', r.finalDamage);
        }
        useSkillStore.getState().addMlvlXpFromSkill(char.class as any);
        s.addLog(
            `Używasz ${formatSkillName(skillId)}: ${r.finalDamage} dmg${r.isCrit ? ' ⚡KRYTYK!' : ''} (-${SKILL_MP_COST} MP)`,
            r.isCrit ? 'crit' : 'player',
        );

        // Check monster death after manual skill
        const newMHp = Math.max(0, s.monsterCurrentHp - r.finalDamage);
        if (newMHp <= 0) {
            engineHandleMonsterDeath(s.monsterRarity);
        }
    };

    // ── Potion use ────────────────────────────────────────────────────────────
    const doUsePotion = (elixirId: string) => {
        if (!character || !effectiveChar) return;

        const elixir = ELIXIRS.find((e) => e.id === elixirId);
        if (!elixir) return;

        const isHp = elixir.effect.startsWith('heal_hp');
        const isMp = elixir.effect.startsWith('heal_mp');
        if (isHp && hpPotionCooldown > 0) return;
        if (isMp && mpPotionCooldown > 0) return;

        const used = useInventoryStore.getState().useConsumable(elixirId);
        if (!used) return;

        useDailyQuestStore.getState().addProgress('use_potion', 1);

        const isPct = elixir.effect.includes('_pct_');
        const cdMs = isPct ? PCT_CD_MS : (isHp ? HP_POTION_COOLDOWN_MS : MP_POTION_COOLDOWN_MS);
        if (isHp && !isPct) startHpCooldown(cdMs);
        if (isMp && !isPct) startMpCooldown(cdMs);
        if (isHp && isPct) startPctHpCooldown(cdMs);
        if (isMp && isPct) startPctMpCooldown(cdMs);

        const flatMatch = elixir.effect.match(/^heal_(hp|mp)_(\d+)$/);
        const pctMatch = elixir.effect.match(/^heal_(hp|mp)_pct_(\d+)$/);

        const applyHeal = (type: 'hp' | 'mp', amount: number) => {
            if (phase !== 'fighting') {
                const curChar = useCharacterStore.getState().character;
                if (!curChar) return;
                if (type === 'hp') {
                    const newHp = Math.min(effectiveChar.max_hp, curChar.hp + amount);
                    useCharacterStore.getState().updateCharacter({ hp: newHp });
                } else {
                    const newMp = Math.min(effectiveChar.max_mp, curChar.mp + amount);
                    useCharacterStore.getState().updateCharacter({ mp: newMp });
                }
            } else {
                if (type === 'hp') healPlayerHp(amount, effectiveChar.max_hp);
                else healPlayerMp(amount, effectiveChar.max_mp);
            }
        };

        if (flatMatch) {
            const type = flatMatch[1] as 'hp' | 'mp';
            const amount = parseInt(flatMatch[2], 10);
            applyHeal(type, amount);
            addLog(`Używasz ${elixir.name_pl}. +${amount} ${type.toUpperCase()}`, 'system');
        } else if (pctMatch) {
            const type = pctMatch[1] as 'hp' | 'mp';
            const pct = parseInt(pctMatch[2], 10);
            const max = type === 'hp' ? effectiveChar.max_hp : effectiveChar.max_mp;
            const amount = Math.floor(max * pct / 100);
            applyHeal(type, amount);
            addLog(`Używasz ${elixir.name_pl}. +${amount} ${type.toUpperCase()} (${pct}%)`, 'system');
        }
    };

    // Trigger loot bar flash animation on victory
    useEffect(() => {
        if (phase === 'victory') {
            setVictoryFlashKey((k) => k + 1);
        }
    }, [phase]);

    // ── Auto-start fight from MonsterList selection (on mount) ────────────────
    useEffect(() => {
        const sel = useCombatStore.getState().selectedMonster;
        if (sel) {
            setSelectedMonster(null);
            engineStartNewFight(sel, true);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const cycleSpeed = () => {
        // In party (bots present), SKIP is disabled — cycle x1→x2→x4 only.
        const order = partyBots.length > 0
            ? SPEED_ORDER.filter((s) => s !== 'SKIP')
            : SPEED_ORDER;
        const idx = order.indexOf(combatSpeed);
        setCombatSpeed(order[(idx + 1) % order.length]);
    };

    // ── Derived ───────────────────────────────────────────────────────────────
    const sortedMonsters = [...monsters].sort((a, b) => a.level - b.level);

    const bestHpPotion = getBestPotionUtil(FLAT_HP_POTIONS, consumables);
    const bestMpPotion = getBestPotionUtil(FLAT_MP_POTIONS, consumables);
    const bestPctHpPotion = getBestPotionUtil(PCT_HP_POTIONS, consumables);
    const bestPctMpPotion = getBestPotionUtil(PCT_MP_POTIONS, consumables);

    const isSkipMode = combatSpeed === 'SKIP';

    // Auto-fight delay for display
    const AUTO_FIGHT_DELAY_MS = 1000;

    if (!character) return null;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="combat">

            {/* ── Header ─────────────────────────────────────────────────────── */}
            <header className="combat__header page-header">
                <button className="combat__back page-back-btn" onClick={() => {
                    if (phase === 'fighting' || phase === 'victory') {
                        useCombatStore.getState().setBackgroundActive(true);
                    }
                    navigate('/');
                }}>← Miasto</button>
                {(phase === 'fighting' || phase === 'victory') && (
                    <button className="combat__back combat__back--stop page-back-btn" onClick={() => {
                        stopCombat();
                        navigate('/');
                    }}>⏹ Zakończ</button>
                )}
                <h1 className="combat__title page-title">⚔️ Walka</h1>
                {(phase === 'fighting' || phase === 'victory' || phase === 'dead') && monster && (() => {
                    const monsterTask = activeTasks.find((t) => t.monsterId === monster.id);
                    if (!monsterTask) return null;
                    return (
                        <div className="combat__header-task">
                            <span className="combat__header-task-icon">📋</span>
                            <span className="combat__header-task-text">{monster.name_pl} {monsterTask.progress}/{monsterTask.killCount}</span>
                        </div>
                    );
                })()}
                {(phase === 'fighting' || phase === 'victory' || phase === 'dead') && monster && activeQuests.length > 0 && (() => {
                    const relevantGoals = getActiveQuestKillProgress(activeQuests, monster.id);
                    if (relevantGoals.length === 0) return null;
                    return (
                        <div className="combat__header-quests">
                            {relevantGoals.map((rg) => (
                                <div key={rg.questId} className="combat__header-quest" title={rg.questName}>
                                    <span className="combat__header-quest-icon">{rg.done ? '✅' : '📜'}</span>
                                    <span className="combat__header-quest-text">
                                        {rg.questName} {rg.progress}/{rg.count}
                                    </span>
                                </div>
                            ))}
                        </div>
                    );
                })()}
                <div className="combat__header-controls">
                    <button
                        className={`combat__speed-btn combat__speed-btn--${combatSpeed}`}
                        onClick={cycleSpeed}
                        title="Zmień prędkość walki"
                    >
                        {combatSpeed}
                    </button>
                    <button
                        className={`combat__mode-btn combat__mode-btn--${skillMode}`}
                        onClick={() => setSkillMode(skillMode === 'auto' ? 'manual' : 'auto')}
                        title="Tryb skillów"
                    >
                        {skillMode === 'auto' ? 'Skille: AUTO' : 'Skille: MANUAL'}
                    </button>
                    <button
                        className={`combat__toggle-btn${autoFight ? ' combat__toggle-btn--active' : ''}`}
                        onClick={() => useCombatStore.getState().setAutoFight(!autoFight)}
                        title={autoFight ? 'Auto-walka włączona' : 'Auto-walka wyłączona'}
                    >
                        {autoFight ? 'Walka: AUTO' : 'Walka: MANUAL'}
                    </button>
                    <button
                        className={`combat__xp-toggle${showCombatXpBar ? ' combat__xp-toggle--active' : ''}`}
                        onClick={() => setShowCombatXpBar(!showCombatXpBar)}
                        title={showCombatXpBar ? 'Ukryj pasek XP' : 'Pokaż pasek XP'}
                    >
                        {showCombatXpBar ? '👁️' : '👁️‍🗨️'}
                    </button>
                </div>
                {(character.stat_points ?? 0) > 0 && (
                    <button
                        className="combat__stat-points-badge"
                        onClick={() => navigate('/stats')}
                        title="Rozdaj punkty statystyk"
                    >
                        +{character.stat_points} statystyk do rozdania
                    </button>
                )}
            </header>

            {/* ── Monster picker ──────────────────────────────────────────────── */}
            {phase === 'idle' && !useCombatStore.getState().selectedMonster && (() => {
                const masteriesState = useMasteryStore.getState().masteries;
                const masteryKillsState = useMasteryStore.getState().masteryKills;
                return (
                    <div className="combat__select">
                        <h2 className="combat__select-title">Wybierz przeciwnika</h2>
                        {/* Pre-fight wave size selector — lets the player configure
                            how many monsters spawn at once before starting the fight. */}
                        <div className="combat__wave-picker" title="Ilosc potworow w nastepnej fali">
                            <span className="combat__wave-picker-label">Fala:</span>
                            <button
                                className="combat__wave-btn combat__wave-btn--remove"
                                onClick={() => useCombatStore.getState().decrementWavePlannedCount()}
                                disabled={wavePlannedCount <= 1}
                                title="Mniej potworow w fali"
                            >
                                ➖
                            </button>
                            <span className="combat__wave-picker-count">
                                {wavePlannedCount}/{MAX_WAVE_MONSTERS}
                            </span>
                            <button
                                className="combat__wave-btn combat__wave-add-btn"
                                onClick={() => useCombatStore.getState().incrementWavePlannedCount()}
                                disabled={wavePlannedCount >= MAX_WAVE_MONSTERS}
                                title="Wiecej potworow w fali"
                            >
                                ➕
                            </button>
                            <span className="combat__wave-picker-hint">
                                {wavePlannedCount === 1
                                    ? 'Walka 1 na 1'
                                    : `Tyle potworow pojawi sie na start kazdej walki`}
                            </span>
                        </div>
                        <div className="combat__monster-list">
                            {sortedMonsters.map((m) => {
                                // In a party, the weakest human member dictates
                                // what monsters the group can actually engage.
                                const gateLevel = getPartyGateLevel(character.level, party?.members ?? null);
                                const unlock = getMonsterUnlockStatus(m, sortedMonsters, gateLevel, masteriesState);
                                const locked = !unlock.unlocked;
                                const isExpanded = expandedMonster === m.id;
                                const monsterTask = activeTasks.find((t) => t.monsterId === m.id);
                                const hasTask = !!monsterTask;
                                const questBadges = getActiveQuestKillProgress(activeQuests, m.id);
                                const hasQuest = questBadges.length > 0;
                                return (
                                    <div key={m.id} className={`combat__monster-card${locked ? ' combat__monster-card--locked' : ''}${hasTask ? ' combat__monster-card--task' : ''}${hasQuest ? ' combat__monster-card--quest' : ''}`}>
                                        {/* Row 1: sprite + name/lvl + stats + xp + arrow + fight */}
                                        <div className="combat__monster-row" onClick={() => !locked && setExpandedMonster(isExpanded ? null : m.id)}>
                                            <span className="combat__monster-sprite">{locked ? '🔒' : m.sprite}</span>
                                            <div className="combat__monster-name-col">
                                                <span className="combat__monster-name">{m.name_pl}</span>
                                                <span className="combat__monster-level">Lvl {m.level}</span>
                                            </div>
                                            <div className="combat__monster-stats">
                                                <span title="HP">❤️ {m.hp}</span>
                                                {(() => {
                                                    const r = getMonsterAttackRange(m);
                                                    return <span title="Attack">⚔️ {r.min}-{r.max}</span>;
                                                })()}
                                                <span title="Defense">🛡️ {m.defense}</span>
                                            </div>
                                            <div className="combat__monster-xp">
                                                {locked
                                                    ? unlock.shortLabel
                                                    : (() => {
                                                        const mLvl = masteriesState[m.id]?.level ?? 0;
                                                        if (mLvl === 0) return `+${m.xp} XP`;
                                                        const pct = mLvl * 2;
                                                        const bonus = Math.floor(m.xp * (pct / 100));
                                                        return (
                                                            <>
                                                                +{m.xp} XP
                                                                <span
                                                                    className="combat__monster-xp-bonus"
                                                                    title={`+${pct}% XP & Gold za Mastery ${mLvl}/${MASTERY_MAX_LEVEL} (2% za 1 pkt masterii)`}
                                                                >
                                                                    {' '}+{bonus}
                                                                </span>
                                                            </>
                                                        );
                                                    })()}
                                            </div>
                                            {!locked && (
                                                <span className={`combat__monster-arrow${isExpanded ? ' combat__monster-arrow--open' : ''}`}>▼</span>
                                            )}
                                            <button
                                                className="combat__fight-btn"
                                                onClick={(e) => { e.stopPropagation(); if (!locked) engineStartNewFight(m); }}
                                                disabled={locked}
                                                title={locked ? unlock.reason : 'Walcz!'}
                                            >
                                                ⚔️
                                            </button>
                                        </div>
                                        {/* Row 2: badges (tasks, quests, mastery unlock) — full width below */}
                                        {(hasTask || hasQuest || (locked && unlock.lockKind === 'mastery' && unlock.requiredMonster)) && (
                                            <div className="combat__monster-badges">
                                                {locked && unlock.lockKind === 'mastery' && unlock.requiredMonster && (() => {
                                                    const req = unlock.requiredMonster;
                                                    const killsNow = masteryKillsState[req.id] ?? 0;
                                                    const remaining = Math.max(0, MASTERY_KILL_THRESHOLD - killsNow);
                                                    return (
                                                        <span className="combat__unlock-badge" title={`Zdobądź Mastery 1/25 na ${req.name_pl}`}>
                                                            🔒 {req.name_pl}: {killsNow.toLocaleString('pl-PL')}/{MASTERY_KILL_THRESHOLD.toLocaleString('pl-PL')} (zostało {remaining.toLocaleString('pl-PL')})
                                                        </span>
                                                    );
                                                })()}
                                                {hasTask && (
                                                    <span className="combat__task-badge">
                                                        📋 {monsterTask.progress}/{monsterTask.killCount}
                                                    </span>
                                                )}
                                                {questBadges.map((qb) => (
                                                    <span key={qb.questId} className="combat__quest-badge" title={qb.questName}>
                                                        {qb.done ? '✅' : '📜'} {qb.questName}: {qb.progress}/{qb.count}
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        {isExpanded && !locked && (
                                            <div className="combat__monster-drops">
                                                <div className="combat__drops-header">
                                                    {(() => {
                                                        const mLvl = masteriesState[m.id]?.level ?? 0;
                                                        const pct = mLvl * 2;
                                                        if (mLvl === 0) {
                                                            return (
                                                                <>
                                                                    <span>💰 Gold: {m.gold[0]}–{m.gold[1]}</span>
                                                                    <span>✨ XP: {m.xp}</span>
                                                                </>
                                                            );
                                                        }
                                                        const goldMinBonus = Math.floor(m.gold[0] * (pct / 100));
                                                        const goldMaxBonus = Math.floor(m.gold[1] * (pct / 100));
                                                        const xpBonus = Math.floor(m.xp * (pct / 100));
                                                        const tooltip = `+${pct}% XP & Gold za Mastery ${mLvl}/${MASTERY_MAX_LEVEL} (2% za 1 pkt masterii)`;
                                                        return (
                                                            <>
                                                                <span>
                                                                    💰 Gold: {m.gold[0]}–{m.gold[1]}
                                                                    <span className="combat__monster-xp-bonus" title={tooltip}>
                                                                        {' '}+{goldMinBonus}–{goldMaxBonus}
                                                                    </span>
                                                                </span>
                                                                <span>
                                                                    ✨ XP: {m.xp}
                                                                    <span className="combat__monster-xp-bonus" title={tooltip}>
                                                                        {' '}+{xpBonus}
                                                                    </span>
                                                                </span>
                                                            </>
                                                        );
                                                    })()}
                                                </div>

                                                <div className="combat__drops-info">
                                                    🎒 Losowy ekwipunek Lvl {m.level} (bronie, zbroje, akcesoria)
                                                </div>

                                                {/* Monster rarity variants with full drop breakdown */}
                                                <div className="combat__drops-variants">
                                                    {(() => {
                                                        const effChances = getEffectiveRarityChances(
                                                            useMasteryStore.getState().getMasteryBonuses(m.id),
                                                        );
                                                        return COMBAT_VARIANTS.map((v) => {
                                                        const bd = getCombatDropBreakdown(v.key);
                                                        const stoneChance = STONE_CHANCES_MAP[v.key] ?? 0;
                                                        const stoneName = STONE_NAMES_MAP[v.key] ?? 'Stone';
                                                        const chanceLabel = formatRarityChance(effChances[v.key as keyof typeof effChances]);
                                                        return (
                                                            <div
                                                                key={v.key}
                                                                className={`combat__variant${v.key !== 'normal' ? ` combat__variant--${v.key}` : ''}`}
                                                            >
                                                                <span className="combat__variant-name" style={{ color: v.color }}>{v.label}</span>
                                                                <span className="combat__variant-chance">{chanceLabel}</span>
                                                                {(() => {
                                                                    const base = getMonsterAttackRange(m);
                                                                    const vMin = Math.max(1, Math.floor(base.min * v.atkMult));
                                                                    const vMax = Math.max(vMin, Math.floor(base.max * v.atkMult));
                                                                    return (
                                                                        <span className="combat__variant-stats">
                                                                            HP: {Math.floor(m.hp * v.hpMult).toLocaleString('pl-PL')} · ATK: {vMin}-{vMax} · DEF: {Math.floor(m.defense * v.defMult)}
                                                                        </span>
                                                                    );
                                                                })()}
                                                                <span className="combat__variant-xp">
                                                                    {(() => {
                                                                        const mLvl = masteriesState[m.id]?.level ?? 0;
                                                                        const pct = mLvl * 2;
                                                                        const mult = 1 + pct / 100;
                                                                        const baseXp = Math.floor(m.xp * v.xpMult);
                                                                        const baseGoldMin = Math.floor(m.gold[0] * v.goldMult);
                                                                        const baseGoldMax = Math.floor(m.gold[1] * v.goldMult);
                                                                        const effXp = Math.floor(baseXp * mult);
                                                                        const effGoldMin = Math.floor(baseGoldMin * mult);
                                                                        const effGoldMax = Math.floor(baseGoldMax * mult);
                                                                        return (
                                                                            <>
                                                                                ⭐ {effXp} XP · 💰 {effGoldMin}–{effGoldMax} Gold · 📋 Task: ×{v.taskKills}
                                                                                {mLvl > 0 && (
                                                                                    <span
                                                                                        className="combat__monster-xp-bonus"
                                                                                        title={`+${pct}% XP & Gold za Mastery ${mLvl}/${MASTERY_MAX_LEVEL} (2% za 1 pkt masterii)`}
                                                                                    >
                                                                                        {' '}+{pct}%
                                                                                    </span>
                                                                                )}
                                                                            </>
                                                                        );
                                                                    })()}
                                                                </span>

                                                                <div className="combat__variant-drops">
                                                                    {bd.tiers.map((tier) => (
                                                                        <div key={tier.key} className="combat__variant-tier">
                                                                            <span
                                                                                className="combat__tier-dot"
                                                                                style={{ background: tier.color, boxShadow: `0 0 4px ${tier.color}` }}
                                                                            />
                                                                            <span className="combat__tier-name" style={{ color: tier.color }}>
                                                                                {tier.label}
                                                                            </span>
                                                                            <span className="combat__tier-chance">
                                                                                {tier.chancePerRoll.toFixed(2)}%
                                                                            </span>
                                                                        </div>
                                                                    ))}
                                                                    <div className="combat__variant-stone">
                                                                        💎 {stoneName} ({(stoneChance * 100).toFixed(0)}%)
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                        });
                                                    })()}
                                                </div>

                                                {/* Potion drop info */}
                                                {(() => {
                                                    const potionInfo = getPotionDropInfo(m.level);
                                                    return (
                                                        <div className="combat__drops-potions">
                                                            <div className="combat__drops-potions-title">🧪 Potiony</div>
                                                            <div className="combat__variant-tier">
                                                                <span className="combat__tier-dot" style={{ background: '#e57373' }} />
                                                                <span className="combat__tier-name" style={{ color: '#e57373' }}>
                                                                    ❤️ {potionInfo.hpLabel} ({potionInfo.hpHeal})
                                                                </span>
                                                                <span className="combat__tier-chance">{(HP_POTION_DROP_CHANCE * 100).toFixed(0)}%</span>
                                                            </div>
                                                            <div className="combat__variant-tier">
                                                                <span className="combat__tier-dot" style={{ background: '#64b5f6' }} />
                                                                <span className="combat__tier-name" style={{ color: '#64b5f6' }}>
                                                                    💙 {potionInfo.mpLabel} ({potionInfo.mpHeal})
                                                                </span>
                                                                <span className="combat__tier-chance">{(MP_POTION_DROP_CHANCE * 100).toFixed(0)}%</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}

                                                {/* Spell chest drop info */}
                                                {(() => {
                                                    const chestInfo = getSpellChestDropInfo(m.level);
                                                    if (chestInfo.levels.length === 0) return null;
                                                    const chestLevelsLabel = chestInfo.levels.length === 1
                                                        ? `Lvl ${chestInfo.levels[0]}`
                                                        : `Lvl ${chestInfo.levels[0]}–${chestInfo.levels[chestInfo.levels.length - 1]}`;
                                                    return (
                                                        <div className="combat__drops-potions">
                                                            <div className="combat__drops-potions-title" style={{ color: '#ab47bc' }}>
                                                                📦 Spell Chest ({chestLevelsLabel})
                                                            </div>
                                                            <div className="combat__variant-tier">
                                                                <span className="combat__tier-dot" style={{ background: '#ab47bc' }} />
                                                                <span className="combat__tier-name" style={{ color: '#ab47bc', fontSize: '0.75rem' }}>
                                                                    Normal {(SPELL_CHEST_BASE_CHANCE.normal * 100).toFixed(1)}% · Strong {(SPELL_CHEST_BASE_CHANCE.strong * 100).toFixed(1)}% · Epic {(SPELL_CHEST_BASE_CHANCE.epic * 100).toFixed(1)}%
                                                                </span>
                                                            </div>
                                                            <div className="combat__variant-tier">
                                                                <span className="combat__tier-dot" style={{ background: '#ab47bc' }} />
                                                                <span className="combat__tier-name" style={{ color: '#ab47bc', fontSize: '0.75rem' }}>
                                                                    Legendary {(SPELL_CHEST_BASE_CHANCE.legendary * 100).toFixed(1)}% · Boss {(SPELL_CHEST_BASE_CHANCE.boss * 100).toFixed(1)}%
                                                                </span>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })()}

            {/* ── Arena ───────────────────────────────────────────────────────── */}
            {phase !== 'idle' && monster && (
                <div className="combat__arena">

                    {/* ── 4 stacked monsters (replaces the old single "Troll" card) ── */}
                    <div className="combat__wave">
                            <div className="combat__wave-slots">
                                {Array.from({ length: MAX_WAVE_MONSTERS }).map((_, i) => {
                                    const w = waveMonsters[i];
                                    const slotPlanned = i < wavePlannedCount;
                                    if (!w) {
                                        // Empty slot — two flavors: "planned but not yet spawned"
                                        // (during transition between waves) vs. "not in wave at all".
                                        return (
                                            <div
                                                key={i}
                                                className={`combat__wave-slot combat__wave-slot--empty${slotPlanned ? ' combat__wave-slot--reserved' : ''}`}
                                            >
                                                <span className="combat__wave-slot-placeholder">
                                                    {slotPlanned ? '⏳' : '—'}
                                                </span>
                                            </div>
                                        );
                                    }
                                    const isActive = i === activeTargetIdx && !w.isDead;
                                    const hpPct = w.maxHp > 0 ? Math.max(0, Math.min(100, (w.currentHp / w.maxHp) * 100)) : 0;
                                    // Point 6: rarity tint persists even after death so the player can
                                    // still see "that was a Legendary" on the corpse.
                                    const classNames = [
                                        'combat__wave-slot',
                                        w.isDead ? 'combat__wave-slot--dead' : '',
                                        isActive ? 'combat__wave-slot--active' : '',
                                        w.rarity !== 'normal' ? `combat__wave-slot--${w.rarity}` : '',
                                    ].filter(Boolean).join(' ');
                                    // Resolve which entity this monster is currently attacking, for the aggro label.
                                    let aggroLabel = '';
                                    if (!w.isDead && w.aggroTarget) {
                                        if (w.aggroTarget === 'player') {
                                            aggroLabel = `🎯 ${character.name}`;
                                        } else {
                                            const targetBot = partyBots.find((b) => b.id === w.aggroTarget);
                                            if (targetBot) {
                                                aggroLabel = `🎯 ${targetBot.name}`;
                                            }
                                        }
                                    }
                                    // Per-monster hit tracking: animations fire on the specific
                                    // monster being attacked (hitMonsterIdx), not just the active one.
                                    const isBeingHit = hitMonsterIdx === i;
                                    const slotClassNames = [
                                        classNames,
                                        isBeingHit ? 'combat__wave-slot--hit' : '',
                                        isBeingHit && attackingClassName ? `combat__wave-slot--attack-${attackingClassName}` : '',
                                        isActive && monsterAttacking ? 'combat__wave-slot--attacking' : '',
                                    ].filter(Boolean).join(' ');
                                    return (
                                        <div key={i} className={slotClassNames}>
                                            {isActive && <span className="combat__wave-slot-target">🎯</span>}
                                            <span className="combat__wave-slot-sprite">{w.monster.sprite}</span>
                                            <div className="combat__wave-slot-info">
                                                <span className="combat__wave-slot-name">
                                                    {w.monster.name_pl}
                                                    {/* Point 6: rarity label persists after death */}
                                                    {w.rarity !== 'normal' && (
                                                        <span className={`combat__wave-slot-rarity combat__wave-slot-rarity--${w.rarity}`}>
                                                            {MONSTER_RARITY_LABELS[w.rarity]}
                                                        </span>
                                                    )}
                                                </span>
                                                <div className="combat__wave-slot-bar">
                                                    <div
                                                        className="combat__wave-slot-bar-fill"
                                                        style={{ width: `${hpPct}%` }}
                                                    />
                                                </div>
                                                <span className="combat__wave-slot-hp">
                                                    {w.isDead ? '☠️ Zabity' : `${Math.max(0, w.currentHp)}/${w.maxHp}`}
                                                </span>
                                                <div className="combat__wave-slot-bar combat__wave-slot-bar--mp">
                                                    <div
                                                        className="combat__wave-slot-bar-fill combat__wave-slot-bar-fill--mp"
                                                        style={{ width: '100%' }}
                                                    />
                                                </div>
                                                <span className="combat__wave-slot-hp combat__wave-slot-hp--mp">
                                                    0/0 MP
                                                </span>
                                                {aggroLabel && (
                                                    <span className="combat__wave-slot-aggro" title={`Atakuje: ${aggroLabel.replace('🎯 ', '')}`}>
                                                        {aggroLabel}
                                                    </span>
                                                )}
                                            </div>
                                            {/* Floating damage from PLAYER attacks + skill animation overlay */}
                                            {(isActive || isBeingHit) && (
                                                <>
                                                    <AnimatePresence>
                                                        {floatingDmgs.filter((d) => d.source === 'player').map((d) => (
                                                            <motion.div
                                                                key={d.id}
                                                                className={`combat__floating-dmg combat__floating-dmg--${d.type}${d.side ? ` combat__floating-dmg--${d.side}` : ''}`}
                                                                initial={{ opacity: 1, y: 0, x: d.side === 'left' ? -60 : d.side === 'right' ? 60 : 0, scale: d.type === 'crit' ? 1.4 : 1 }}
                                                                animate={{ opacity: 0, y: -40, x: d.side === 'left' ? -60 : d.side === 'right' ? 60 : 0, scale: 0.8 }}
                                                                exit={{ opacity: 0 }}
                                                                transition={{ duration: 0.8, ease: 'easeOut' }}
                                                            >
                                                                {d.text}
                                                            </motion.div>
                                                        ))}
                                                    </AnimatePresence>
                                                    {skillAnimOverlay && (
                                                        <div
                                                            key={skillAnimOverlay.id}
                                                            className={`combat__skill-anim-overlay ${skillAnimOverlay.anim.cssClass}`}
                                                        >
                                                            <span className="combat__skill-anim-emoji">{skillAnimOverlay.anim.emoji}</span>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Point 5: compact +/− wave size controls, available outside
                                the fighting phase too (e.g. after victory while picking
                                the next wave size). The planned count sticks between waves. */}
                            <div className="combat__wave-footer">
                                <button
                                    className="combat__wave-btn combat__wave-btn--remove"
                                    onClick={() => {
                                        // First remove a live spawned monster if one exists,
                                        // otherwise just lower the sticky planned count.
                                        const removed = removeLastWaveMonster();
                                        const nextCount = decrementWavePlannedCount();
                                        if (removed) {
                                            addLog(`➖ Usunięto potwora z fali (${nextCount} planowanych)`, 'system');
                                        } else {
                                            addLog(`Zmniejszono planowaną falę do ${nextCount}`, 'system');
                                        }
                                    }}
                                    disabled={wavePlannedCount <= 1}
                                    title={
                                        wavePlannedCount <= 1
                                            ? 'Minimalna fala to 1 potwór'
                                            : 'Usuń ostatniego potwora z fali'
                                    }
                                >
                                    ➖
                                </button>
                                <span className="combat__wave-footer-count">
                                    {waveMonsters.filter((w) => !w.isDead).length}/{wavePlannedCount}
                                </span>
                                <button
                                    className="combat__wave-btn combat__wave-add-btn"
                                    onClick={() => {
                                        const ok = addMonsterToWave();
                                        if (!ok) {
                                            addLog('Nie można dodać kolejnego potwora', 'system');
                                        }
                                    }}
                                    disabled={wavePlannedCount >= MAX_WAVE_MONSTERS}
                                    title={
                                        wavePlannedCount >= MAX_WAVE_MONSTERS
                                            ? 'Maksymalna wielkość fali (4)'
                                            : 'Dodaj kolejnego potwora'
                                    }
                                >
                                    ➕
                                </button>
                            </div>
                    </div>

                    {/* ── Battlefield: party bots + player card ────── */}
                    <div className="combat__battlefield">
                    <div className="combat__side combat__side--party">
                    {partyBots.length > 0 && (
                        <div className="combat__bots">
                            <div className="combat__bots-header">
                                <span className="combat__bots-title">
                                    🤝 Drużyna ({partyBots.filter((b) => b.alive).length}/{partyBots.length})
                                </span>
                            </div>
                            <div className="combat__bots-list">
                                {partyBots.map((bot) => {
                                    const hpPct = bot.maxHp > 0
                                        ? Math.max(0, Math.min(100, (bot.hp / bot.maxHp) * 100))
                                        : 0;
                                    // Is ANY wave monster currently aggroing this bot?
                                    const targetingCount = waveMonsters.filter((w) => !w.isDead && w.aggroTarget === bot.id).length;
                                    return (
                                        <div
                                            key={bot.id}
                                            className={`combat__bot-card${!bot.alive ? ' combat__bot-card--dead' : ''}${targetingCount > 0 ? ' combat__bot-card--targeted' : ''}`}
                                            title={`${bot.name} (${bot.class} Lvl ${bot.level})`}
                                        >
                                            {targetingCount > 0 && (
                                                <span className="combat__bot-aggro-badge">🎯 x{targetingCount}</span>
                                            )}
                                            <span className="combat__bot-icon">
                                                {CLASS_ICONS[bot.class] ?? '🤖'}
                                            </span>
                                            <div className="combat__bot-info">
                                                <span className="combat__bot-name">{bot.name}</span>
                                                <span className="combat__bot-sub">Lvl {bot.level} {bot.class}</span>
                                                <div className="combat__bot-bar">
                                                    <div
                                                        className="combat__bot-bar-fill"
                                                        style={{ width: `${hpPct}%` }}
                                                    />
                                                </div>
                                                <span className="combat__bot-hp">
                                                    {bot.alive ? `${Math.max(0, bot.hp)}/${bot.maxHp}` : '☠️ Martwy'}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Player card */}
                    {(() => {
                        const playerTargetedCount = waveMonsters.filter((w) => !w.isDead && w.aggroTarget === 'player').length;
                        return (
                    <div
                        className={`combat__card combat__card--player${playerHit ? ' combat__card--hit' : ''}${playerTargetedCount > 0 ? ' combat__card--targeted' : ''}`}
                        data-class={character.class}
                        style={{
                            '--player-accent': playerAccent,
                            '--player-accent-rgb': playerAccentRgb,
                            '--player-accent-fill': playerAccentFill,
                        } as React.CSSProperties}
                    >
                        {playerTargetedCount > 0 && (
                            <span className="combat__player-aggro-badge">🎯 AGGRO x{playerTargetedCount}</span>
                        )}
                        <div className="combat__card-header">
                            <div className="combat__player-avatar-wrap">
                                <img
                                    src={playerAvatarSrc}
                                    alt={character.class}
                                    className="combat__player-avatar"
                                />
                                <span className="combat__player-avatar-lvl">Lvl {character.level}</span>
                            </div>
                            <div className="combat__card-info">
                                <span className="combat__card-name">{character.name}</span>
                                <span className="combat__card-sub">{CLASS_ICONS[character.class] ?? '?'} {character.class}</span>
                            </div>
                        </div>
                        {/* Floating damage on player (from MONSTER attacks) */}
                        <AnimatePresence>
                            {floatingDmgs.filter((d) => d.source === 'monster').map((d) => (
                                <motion.div
                                    key={d.id}
                                    className={`combat__floating-dmg combat__floating-dmg--${d.type}`}
                                    initial={{ opacity: 1, y: 0 }}
                                    animate={{ opacity: 0, y: -35 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.8, ease: 'easeOut' }}
                                >
                                    {d.text}
                                </motion.div>
                            ))}
                        </AnimatePresence>
                        <div className="combat__stat-row">
                            <span className="combat__stat-label">HP</span>
                            {(() => {
                                const mh = effectiveChar?.max_hp ?? character.max_hp;
                                const cur = Math.max(0, Math.min(playerCurrentHp, mh));
                                return <>
                                    <HpBar current={cur} max={mh} variant="hp" />
                                    <span className="combat__hp-text">{cur}/{mh}</span>
                                </>;
                            })()}
                        </div>
                        <div className="combat__stat-row">
                            <span className="combat__stat-label">MP</span>
                            {(() => {
                                const mm = effectiveChar?.max_mp ?? character.max_mp;
                                const cur = Math.max(0, Math.min(playerCurrentMp, mm));
                                return <>
                                    <HpBar current={cur} max={mm} variant="mp" />
                                    <span className="combat__hp-text">{cur}/{mm}</span>
                                </>;
                            })()}
                        </div>
                    </div>
                        );
                    })()}
                    </div>{/* /combat__side--party */}
                    </div>{/* /combat__battlefield */}

                    {/* ── XP progress bar ─────────────────────────────────────────── */}
                    <div className="combat__xp-bar-placeholder">
                        {showCombatXpBar && (() => {
                            const xpPct = xpProgress(character.xp, character.level);
                            const xpNeeded = xpToNextLevel(character.level);
                            return (
                                <div className="combat__xp-bar-wrap">
                                    <span className="combat__xp-label">XP</span>
                                    <div className="combat__xp-bar">
                                        <motion.div
                                            className="combat__xp-bar-fill"
                                            animate={{ width: `${xpPct * 100}%` }}
                                            transition={{ duration: 0.25, ease: 'easeOut' }}
                                        />
                                    </div>
                                    <span className="combat__xp-text">
                                        {Math.round(xpPct * 100)}% · {character.xp.toLocaleString('pl-PL')} / {xpNeeded.toLocaleString('pl-PL')}
                                        {xpPerHour > 0 && (
                                            <span className="combat__xp-rate"> · {xpPerHour.toLocaleString('pl-PL')} XP/h</span>
                                        )}
                                    </span>
                                </div>
                            );
                        })()}
                    </div>

                    {/* ── 4 active skill slots ─────────────────────────────────── */}
                    {(
                        <div className={`combat__skill-slots${phase !== 'fighting' ? ' combat__skill-slots--hidden' : ''}`}>
                            {(activeSkillSlots as (string | null)[]).map((skillId, i) => {
                                const isEmpty  = !skillId;
                                const cdRemaining = skillId ? (skillCooldowns[skillId] ?? 0) : 0;
                                const cdActive = cdRemaining > 0;
                                const cdFraction = cdActive ? cdRemaining / SKILL_COOLDOWN_MS : 0;
                                const canClick = !isEmpty && skillMode === 'manual' && playerCurrentMp >= SKILL_MP_COST && !cdActive;
                                return (
                                    <button
                                        key={i}
                                        className={[
                                            'combat__skill-slot',
                                            isEmpty ? 'combat__skill-slot--empty' : 'combat__skill-slot--filled',
                                            !isEmpty && skillMode === 'auto' ? 'combat__skill-slot--auto' : '',
                                            cdActive ? 'combat__skill-slot--on-cooldown' : '',
                                        ].filter(Boolean).join(' ')}
                                        onClick={() => canClick && doUseSkill(i as 0 | 1 | 2 | 3)}
                                        disabled={isEmpty || skillMode === 'auto' || playerCurrentMp < SKILL_MP_COST || cdActive}
                                        title={
                                            isEmpty ? 'Pusty slot – ustaw w Skille → Aktywne'
                                                : cdActive ? `Cooldown: ${Math.ceil(cdRemaining / 1000)}s`
                                                : skillMode === 'auto' ? 'Tryb AUTO – skille używają się automatycznie'
                                                : playerCurrentMp < SKILL_MP_COST ? `Za mało MP (potrzeba ${SKILL_MP_COST})`
                                                : `Użyj: ${formatSkillName(skillId)}`
                                        }
                                    >
                                        {cdActive && (
                                            <span
                                                className="combat__skill-cd-overlay"
                                                style={{ height: `${cdFraction * 100}%` }}
                                            />
                                        )}
                                        <span className="combat__skill-slot-name">{formatSkillName(skillId)}</span>
                                        {!isEmpty && (
                                            <span className="combat__skill-slot-badge">
                                                {cdActive
                                                    ? `${Math.ceil(cdRemaining / 1000)}s`
                                                    : skillMode === 'auto' ? 'AUTO' : `${SKILL_MP_COST}MP`}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* ── Potion quick-use (flat HP/MP + pct HP/MP) ───────────── */}
                    {(
                        <div className={`combat__potions${phase !== 'fighting' && !(phase === 'victory' && isSkipMode) ? ' combat__potions--hidden' : ''}`}>
                            {bestHpPotion && (() => {
                                const count = consumables[bestHpPotion.id] ?? 0;
                                const hpCdActive = hpPotionCooldown > 0;
                                const hpCdFraction = hpCdActive ? hpPotionCooldown / HP_POTION_COOLDOWN_MS : 0;
                                return (
                                    <button
                                        className={`combat__potion-btn combat__potion-btn--hp${hpCdActive ? ' combat__potion-btn--cooldown' : ''}${count === 0 ? ' combat__potion-btn--empty' : ''}`}
                                        onClick={() => doUsePotion(bestHpPotion.id)}
                                        disabled={count === 0 || hpCdActive}
                                        title={hpCdActive ? `Cooldown: ${Math.ceil(hpPotionCooldown / 1000)}s` : count === 0 ? 'Brak eliksirów HP' : bestHpPotion.description_pl}
                                    >
                                        {hpCdActive && (
                                            <span
                                                className="combat__potion-cd-overlay"
                                                style={{ height: `${hpCdFraction * 100}%` }}
                                            />
                                        )}
                                        <span className="combat__potion-label">
                                            {bestHpPotion.icon} {getPotionLabel(bestHpPotion.effect)}
                                        </span>
                                        <span className="combat__potion-count">x{count}</span>
                                    </button>
                                );
                            })()}
                            {bestMpPotion && (() => {
                                const count = consumables[bestMpPotion.id] ?? 0;
                                const mpCdActive = mpPotionCooldown > 0;
                                const mpCdFraction = mpCdActive ? mpPotionCooldown / MP_POTION_COOLDOWN_MS : 0;
                                return (
                                    <button
                                        className={`combat__potion-btn combat__potion-btn--mp${mpCdActive ? ' combat__potion-btn--cooldown' : ''}${count === 0 ? ' combat__potion-btn--empty' : ''}`}
                                        onClick={() => doUsePotion(bestMpPotion.id)}
                                        disabled={count === 0 || mpCdActive}
                                        title={mpCdActive ? `Cooldown: ${Math.ceil(mpPotionCooldown / 1000)}s` : count === 0 ? 'Brak eliksirów MP' : bestMpPotion.description_pl}
                                    >
                                        {mpCdActive && (
                                            <span
                                                className="combat__potion-cd-overlay"
                                                style={{ height: `${mpCdFraction * 100}%` }}
                                            />
                                        )}
                                        <span className="combat__potion-label">
                                            {bestMpPotion.icon} {getPotionLabel(bestMpPotion.effect)}
                                        </span>
                                        <span className="combat__potion-count">x{count}</span>
                                    </button>
                                );
                            })()}
                            {bestPctHpPotion && (() => {
                                const count = consumables[bestPctHpPotion.id] ?? 0;
                                const pctHpCdActive = pctHpCooldown > 0;
                                const pctHpCdFraction = pctHpCdActive ? pctHpCooldown / PCT_CD_MS : 0;
                                return (
                                    <button
                                        className={`combat__potion-btn combat__potion-btn--pct-hp${pctHpCdActive ? ' combat__potion-btn--cooldown' : ''}${count === 0 ? ' combat__potion-btn--empty' : ''}`}
                                        onClick={() => doUsePotion(bestPctHpPotion.id)}
                                        disabled={count === 0 || pctHpCdActive}
                                        title={pctHpCdActive ? `Cooldown: ${Math.ceil(pctHpCooldown / 1000)}s` : count === 0 ? 'Brak % potionów HP' : bestPctHpPotion.description_pl}
                                    >
                                        {pctHpCdActive && (
                                            <span
                                                className="combat__potion-cd-overlay"
                                                style={{ height: `${pctHpCdFraction * 100}%` }}
                                            />
                                        )}
                                        <span className="combat__potion-label">
                                            {bestPctHpPotion.icon} {getPotionLabel(bestPctHpPotion.effect)}
                                        </span>
                                        <span className="combat__potion-count">x{count}</span>
                                    </button>
                                );
                            })()}
                            {bestPctMpPotion && (() => {
                                const count = consumables[bestPctMpPotion.id] ?? 0;
                                const pctMpCdActive = pctMpCooldown > 0;
                                const pctMpCdFraction = pctMpCdActive ? pctMpCooldown / PCT_CD_MS : 0;
                                return (
                                    <button
                                        className={`combat__potion-btn combat__potion-btn--pct-mp${pctMpCdActive ? ' combat__potion-btn--cooldown' : ''}${count === 0 ? ' combat__potion-btn--empty' : ''}`}
                                        onClick={() => doUsePotion(bestPctMpPotion.id)}
                                        disabled={count === 0 || pctMpCdActive}
                                        title={pctMpCdActive ? `Cooldown: ${Math.ceil(pctMpCooldown / 1000)}s` : count === 0 ? 'Brak % potionów MP' : bestPctMpPotion.description_pl}
                                    >
                                        {pctMpCdActive && (
                                            <span
                                                className="combat__potion-cd-overlay"
                                                style={{ height: `${pctMpCdFraction * 100}%` }}
                                            />
                                        )}
                                        <span className="combat__potion-label">
                                            {bestPctMpPotion.icon} {getPotionLabel(bestPctMpPotion.effect)}
                                        </span>
                                        <span className="combat__potion-count">x{count}</span>
                                    </button>
                                );
                            })()}
                        </div>
                    )}

                    {/* ── Persistent loot bar — always visible, no modal ───── */}
                    {(() => {
                        // Group drops by icon+rarity+upgrade for display
                        const rarityTier: Record<string, number> = {
                            common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4, heroic: 5,
                        };
                        const dropGroups = new Map<string, { icon: string; rarity: string; upgradeLevel?: number; count: number; sold: number; soldGold: number }>();
                        for (const d of lastDrops) {
                            const key = `${d.icon}|${d.rarity}|${d.upgradeLevel ?? 0}`;
                            const prev = dropGroups.get(key);
                            if (prev) {
                                prev.count += 1;
                                if (d.sold) { prev.sold += 1; prev.soldGold += d.soldPrice ?? 0; }
                            } else {
                                dropGroups.set(key, {
                                    icon: d.icon,
                                    rarity: d.rarity,
                                    upgradeLevel: d.upgradeLevel,
                                    count: 1,
                                    sold: d.sold ? 1 : 0,
                                    soldGold: d.sold ? (d.soldPrice ?? 0) : 0,
                                });
                            }
                        }
                        const sortedDrops = Array.from(dropGroups.values()).sort(
                            (a, b) => (rarityTier[b.rarity] ?? 0) - (rarityTier[a.rarity] ?? 0),
                        );
                        const hasReward = phase === 'victory' || (earnedXp > 0 && phase !== 'idle');
                        return (
                            <div
                                key={victoryFlashKey}
                                className={[
                                    'combat__loot-bar',
                                    phase === 'victory' ? 'combat__loot-bar--victory' : '',
                                    phase === 'dead' ? 'combat__loot-bar--dead' : '',
                                ].filter(Boolean).join(' ')}
                            >
                                <div className="combat__loot-bar-row">
                                    <span className="combat__loot-bar-item">
                                        ⭐ XP: {hasReward ? <strong className="combat__loot-bar-val combat__loot-bar-val--xp">+{earnedXp}</strong> : '—'}
                                    </span>
                                    <span className="combat__loot-bar-item">
                                        💰 Gold: {phase === 'victory' && !isSkipMode ? <strong className="combat__loot-bar-val combat__loot-bar-val--gold">+{earnedGold}</strong> : '—'}
                                    </span>
                                    <span className="combat__loot-bar-item combat__loot-bar-item--drop">
                                        🎒 Drop: {phase === 'victory' && sortedDrops.length > 0 ? (
                                            <span className="combat__loot-bar-drops">
                                                {sortedDrops.map((drop, di) => (
                                                    <span key={di} className="combat__loot-bar-drop-icon">
                                                        <ItemIcon
                                                            icon={drop.icon}
                                                            rarity={drop.rarity}
                                                            upgradeLevel={drop.upgradeLevel}
                                                            size="xs"
                                                            quantity={drop.count > 1 ? drop.count : undefined}
                                                            showTooltip={false}
                                                        />
                                                        {drop.sold > 0 && (
                                                            <span className="combat__loot-bar-sold">💰{drop.soldGold}g</span>
                                                        )}
                                                    </span>
                                                ))}
                                            </span>
                                        ) : '—'}
                                    </span>
                                </div>
                                {isSkipMode && phase === 'victory' && (
                                    <span className="combat__loot-bar-skip">⚡ SKIP: brak golda/dropu, XP −25%</span>
                                )}
                                {autoFight && phase === 'victory' && (
                                    <span className="combat__loot-bar-auto">Następna walka za {AUTO_FIGHT_DELAY_MS / 1000}s…</span>
                                )}
                            </div>
                        );
                    })()}

                    {/* ── Action buttons — always visible, disabled when inappropriate ── */}
                    <div className="combat__action-btns">
                        <button
                            className="combat__action-btn combat__action-btn--fight"
                            disabled={phase === 'fighting' || phase === 'idle'}
                            onClick={() => {
                                const baseMonster = monsters.find((m) => m.id === monster.id) ?? monster;
                                engineStartNewFight(baseMonster);
                            }}
                        >
                            ⚔️ Walcz ponownie
                        </button>
                        <button
                            className="combat__action-btn combat__action-btn--change"
                            disabled={phase === 'fighting'}
                            onClick={() => stopCombat()}
                        >
                            🔄 Zmień potwora
                        </button>
                        <button
                            className="combat__action-btn combat__action-btn--flee"
                            disabled={phase !== 'fighting'}
                            onClick={() => stopCombat()}
                        >
                            🏃 Uciekaj
                        </button>
                    </div>

                    {/* ── Death overlay — epic fullscreen animation ────────────── */}
                    <AnimatePresence>
                        {phase === 'dead' && (
                            <motion.div
                                className="combat__death-overlay"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.5 }}
                            >
                                <motion.div
                                    className="combat__death-content"
                                    initial={{ scale: 0.7, y: 30 }}
                                    animate={{ scale: 1, y: 0 }}
                                    transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.2 }}
                                >
                                    <span className="combat__death-icon">💀</span>
                                    <h2 className="combat__death-title">Zginąłeś!</h2>
                                    <p className="combat__death-penalty">Utrata poziomu · −5% Skill XP</p>
                                    <button
                                        className="combat__death-btn"
                                        onClick={() => { resetCombat(); navigate('/'); }}
                                    >
                                        Wróć do miasta
                                    </button>
                                </motion.div>
                                {/* Animated particles */}
                                {Array.from({ length: 12 }).map((_, i) => (
                                    <motion.div
                                        key={i}
                                        className="combat__death-particle"
                                        initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                                        animate={{
                                            opacity: [0, 1, 0],
                                            scale: [0, 1.5, 0],
                                            x: Math.cos(i * 30 * Math.PI / 180) * 120,
                                            y: Math.sin(i * 30 * Math.PI / 180) * 120,
                                        }}
                                        transition={{ duration: 1.5, delay: 0.3 + i * 0.05, ease: 'easeOut' }}
                                    />
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* ── Session kill counter (above combat log) ───────────── */}
                    {!isSkipMode && (() => {
                        const totalKills =
                            (sessionKills.normal ?? 0) + (sessionKills.strong ?? 0) + (sessionKills.epic ?? 0) +
                            (sessionKills.legendary ?? 0) + (sessionKills.boss ?? 0);
                        const rarityOrder: TMonsterRarity[] = ['normal', 'strong', 'epic', 'legendary', 'boss'];
                        const CHIP_BG: Record<TMonsterRarity, string> = {
                            normal:    'rgba(189,189,189,1)',
                            strong:    'rgba(33,150,243,1)',
                            epic:      'rgba(76,175,80,1)',
                            legendary: 'rgba(244,67,54,1)',
                            boss:      'rgba(255,193,7,1)',
                        };
                        return (
                            <div className="combat__session-kills" title="Licznik zabitych potworow w tej sesji">
                                <span className="combat__session-kills-title">Sesja</span>
                                <span className="combat__session-kills-total">{totalKills}</span>
                                {rarityOrder.map((r) => {
                                    const bg = CHIP_BG[r];
                                    return (
                                        <span
                                            key={r}
                                            className={`combat__session-kills-chip combat__session-kills-chip--${r}`}
                                            style={{
                                                background: bg,
                                                borderColor: bg,
                                                color: '#fff',
                                            }}
                                        >
                                            {MONSTER_RARITY_LABELS[r]}: {sessionKills[r] ?? 0}
                                        </span>
                                    );
                                })}
                            </div>
                        );
                    })()}

                    {/* Combat log – hidden in SKIP mode */}
                    {!isSkipMode && (
                        <div className="combat__log" ref={logContainerRef}>
                            {log.map((entry) => (
                                <div key={entry.id} className={`combat__log-entry combat__log-entry--${entry.type}`}>
                                    {entry.text}
                                </div>
                            ))}
                            <div ref={logEndRef} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default Combat;
