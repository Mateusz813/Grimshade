import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { rollWeaponDamage, formatSkillName } from '../../systems/combatViewHelpers';
import { useShallow } from 'zustand/react/shallow';
import { AnimatePresence, motion } from 'framer-motion';
import dungeonData from '../../data/dungeons.json';
import monstersData from '../../data/monsters.json';
import itemsData from '../../data/items.json';
import { useCharacterStore } from '../../stores/characterStore';
import { useCooldownStore } from '../../stores/cooldownStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useSkillStore } from '../../stores/skillStore';
import { useDungeonStore } from '../../stores/dungeonStore';
import { usePartyStore } from '../../stores/partyStore';
import { getPartyGateLevel } from '../../systems/partySystem';
import { useSettingsStore } from '../../stores/settingsStore';
import { useBuffStore } from '../../stores/buffStore';
import { ELIXIRS } from '../../stores/shopStore';
import {
    getDungeonWaves,
    getDungeonMinLevel,
    pickWaveMonsters,
    scaleDungeonMonsterAsType,
    rollDungeonItemDrop,
    getWaveComposition,
    estimateDungeonRewards,
    type IDungeon,
    type IDungeonMonster,
    type IDungeonResult,
    type DungeonMonsterType,
} from '../../systems/dungeonSystem';
import { rollMonsterDamage, getSpeedScaledCooldownMs, resolveSkillRecastMs, mitigateDamage } from '../../systems/combat';
import { getEffectiveChar, syncCasterChargeConsume } from '../../systems/combatEngine';
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
import { buildItem, flattenItemsData, getTotalEquipmentStats, getEquippedGearLevel, getGearGapMultiplier, formatItemName, STONE_GENERIC_ICON, STONE_ICONS, type IBaseItem } from '../../systems/itemSystem';
import { getItemDisplayInfo } from '../../systems/itemGenerator';
import { getTrainingBonuses, rollSkillDamageMult } from '../../systems/skillSystem';
import { getPotionDropInfo, rollPotionDrop, rollSpellChestDrop, getSpellChestIcon, getSpellChestEmoji, getSpellChestDisplayName, getSpellChestDropInfo, type IGeneratedItem, type TMonsterRarity } from '../../systems/lootSystem';
import TinyIcon from '../../components/ui/TinyIcon/TinyIcon';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import Icon from '../../components/atoms/Icon/Icon';
import { applyDeathPenalty, applyFleePenalty } from '../../systems/levelSystem';
import { consumeDeathProtection } from '../../systems/deathProtection';
import { applyCombatLeaveDeath } from '../../systems/combatLeavePenalty';
import { useCombatStore } from '../../stores/combatStore';
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
import Spinner from '../../components/ui/Spinner/Spinner';
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
import { consumeCasterBasicHitMods, consumeTargetMarkAmp, skillTargetsEnemy } from '../../systems/skillEffectsV2';
import { useNecroSummonStore } from '../../stores/necroSummonStore';
import { useSkillAnim } from '../../hooks/useSkillAnim';
import { useCombatFx } from '../../hooks/useCombatFx';
import { useLevelUpRefill } from '../../hooks/useLevelUpRefill';
import { saveCurrentCharacterStores, commitCombatEventNow } from '../../stores/characterScope';
import { deathsApi } from '../../api/v1/deathsApi';
import { useDeathStore } from '../../stores/deathStore';
import { useTaskStore } from '../../stores/taskStore';
import { useQuestStore } from '../../stores/questStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { useMasteryStore, getMasteryXpMultiplier, getMasteryGoldMultiplier } from '../../stores/masteryStore';
import {
    PCT_HP_POTIONS,
    PCT_MP_POTIONS,
    PCT_POTION_COOLDOWN_MS,
    getBestPotion as getBestPotionUtil,
    resolveAutoPotionElixir,
} from '../../systems/potionSystem';
import { canUsePotionAtLevel } from '../../systems/potionGating';
import ItemIcon from '../../components/ui/ItemIcon/ItemIcon';
import { getDungeonImage, getPotionImage, getSpellChestImage, getSummonImage } from '../../systems/spriteAssets';
import { getSkillIcon } from '../../data/skillIcons';
import { getCharacterAvatar } from '../../data/classAvatars';
import classesRaw from '../../data/classes.json';
import { useTransformStore } from '../../stores/transformStore';
import { formatGoldShort } from '../../systems/goldFormat';
import { isBackendMode, isBackendCombatDelegated } from '../../config/backendMode';
import { backendApi } from '../../api/backend/backendApi';
import { syncFromBackend } from '../../api/backend/syncState';
import './Dungeon.scss';


interface IDungeonClassData {
    dualWield?: boolean;
    dualWieldDmgPercent?: number;
}

const classesArray = classesRaw as unknown as (IDungeonClassData & { id: string })[];
const classesDataMap: Record<string, IDungeonClassData> = {};
for (const c of classesArray) {
    classesDataMap[c.id] = c;
}

const getDungeonCardHue = (level: number): number => {
    if (level <= 10) return 160;
    if (level <= 25) return 140;
    if (level <= 50) return 200;
    if (level <= 100) return 240;
    if (level <= 200) return 270;
    if (level <= 400) return 300;
    if (level <= 600) return 330;
    if (level <= 800) return 15;
    return 45;
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


type ScreenPhase = 'list' | 'entering' | 'running' | 'result';

const ENTRY_ANIM_TOTAL_MS = 2000;
const ENTRY_ANIM_COMBAT_START_AT_MS = 1340;


const MONSTER_TYPE_BADGES: Record<DungeonMonsterType, { label: string; icon: string; color: string }> = {
    Normal:    { label: 'Normal',    icon: '',   color: '#9e9e9e' },
    Strong:    { label: 'Strong',    icon: 'flexed-biceps', color: '#2196f3' },
    Epic:      { label: 'Epic',      icon: 'high-voltage', color: '#4caf50' },
    Legendary: { label: 'Legendary', icon: 'fire', color: '#f44336' },
    Boss:      { label: 'BOSS',      icon: 'crown', color: '#ffc107' },
};


const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const;
const RARITY_LABELS: Record<string, { label: string; color: string }> = {
    common:    { label: 'Common',    color: '#ffffff' },
    rare:      { label: 'Rare',      color: '#2196f3' },
    epic:      { label: 'Epic',      color: '#4caf50' },
    legendary: { label: 'Legendary', color: '#f44336' },
    mythic:    { label: 'Mythic',    color: '#ffc107' },
    heroic:    { label: 'Heroic',    color: '#9c27b0' },
};

const DUNGEON_ITEM_DROP_RATES: Record<string, number> = {
    common: 55, rare: 25, epic: 12, legendary: 5, mythic: 2.5,
};

interface IStoneDropInfo {
    name: string;
    chance: number;
    minLevel: number;
    rarity: keyof typeof RARITY_LABELS;
}

const DUNGEON_STONE_DROPS: IStoneDropInfo[] = [
    { name: 'Common Stone',    chance: 40,  minLevel: 1,   rarity: 'common' },
    { name: 'Rare Stone',      chance: 25,  minLevel: 15,  rarity: 'rare' },
    { name: 'Epic Stone',      chance: 15,  minLevel: 40,  rarity: 'epic' },
    { name: 'Legendary Stone',  chance: 8,   minLevel: 80,  rarity: 'legendary' },
    { name: 'Mythic Stone',    chance: 3,   minLevel: 200, rarity: 'mythic' },
    { name: 'Heroic Stone',    chance: 0.5, minLevel: 500, rarity: 'heroic' },
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


const SKILL_COOLDOWN_MS = 5000;
const SKILL_MP_COST = 15;
const POTION_COOLDOWN_MS = 1000;

const hpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_hp'));
const mpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_mp'));


const getBestPotion = (
    potions: typeof ELIXIRS,
    consumables: Record<string, number>,
    characterLevel: number = Number.POSITIVE_INFINITY,
) => {
    const reversed = [...potions].reverse();
    return (
        reversed.find((e) => (consumables[e.id] ?? 0) > 0 && canUsePotionAtLevel(e.id, characterLevel))
        ?? reversed.find((e) => canUsePotionAtLevel(e.id, characterLevel))
        ?? null
    );
};


interface ILogEntry {
    id: number;
    text: string;
    type: 'player' | 'monster' | 'crit' | 'system' | 'wave' | 'block' | 'dodge';
}


const getAttackMs = (speed: number): number =>
    Math.max(500, Math.floor(3000 / Math.max(1, speed || 1)));

const WAVE_SPAWN_DELAY_MS = 600;


const Dungeon = () => {
    const character    = useCharacterStore((s) => s.character);
    const party        = usePartyStore((s) => s.party);
    const equipment    = useInventoryStore((s) => s.equipment);
    const consumables  = useInventoryStore((s) => s.consumables);
    const completedTransforms = useTransformStore((s) => s.completedTransforms);
    const _activeBuffs = useBuffStore((s) => s.allBuffs);
    void _activeBuffs;
    const necroSummons = useNecroSummonStore((s) => s.summons);
    const playerAvatarSrc = character ? getCharacterAvatar(character.class, completedTransforms) : '';
    const { activeSkillSlots } = useSkillStore(useShallow((s) => ({ activeSkillSlots: s.activeSkillSlots })));
    const { setDungeonCompleted, getAttemptsUsed, getAttemptsMax, canEnter, isDungeonCleared } = useDungeonStore();

    const [phase, setPhase]               = useState<ScreenPhase>('list');
    const [activeDungeon, setActiveDungeon] = useState<IDungeon | null>(null);
    const [dropModalDungeon, setDropModalDungeon] = useState<string | null>(null);
    const [result, setResult]             = useState<IDungeonResult | null>(null);
    const [resultKind, setResultKind] = useState<'win' | 'death' | 'flee' | null>(null);

    const dungeonEventSentRef = useRef<string | null>(null);
    useEffect(() => {
        if (phase !== 'result') {
            dungeonEventSentRef.current = null;
            return;
        }
        if (!isBackendMode() || !resultKind) return;
        const key = `${activeDungeon?.id ?? '?'}:${resultKind}`;
        if (dungeonEventSentRef.current === key) return;
        dungeonEventSentRef.current = key;
        commitCombatEventNow({
            type: 'dungeon',
            sourceId: activeDungeon?.id,
            outcome: resultKind === 'win' ? 'won' : resultKind === 'flee' ? 'fled' : 'lost',
            died: resultKind === 'death',
        });
    }, [phase, resultKind, activeDungeon]);

    const [enterAnim, setEnterAnim] = useState<
        | { x: number; y: number; w: number; h: number; hue: number; image: string; dungeonId: string }
        | null
    >(null);
    const enterAnimTimeoutsRef = useRef<number[]>([]);
    const pendingDungeonRef = useRef<IDungeon | null>(null);
    useEffect(() => {
        return () => {
            enterAnimTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
            enterAnimTimeoutsRef.current = [];
        };
    }, []);

    interface ICurrentMonster {
        slot: number;
        monster: IDungeonMonster;
        type: DungeonMonsterType;
        currentHp: number;
        maxHp: number;
    }
    const [currentWave, setCurrentWave]       = useState(0);
    const [currentMonsters, setCurrentMonsters] = useState<ICurrentMonster[]>([]);
    const [playerHp, setPlayerHp]             = useState(0);
    const [playerMp, setPlayerMp]             = useState(0);
    const [combatLog, setCombatLog]           = useState<ILogEntry[]>([]);
    const [, setWaveItems]                    = useState<IGeneratedItem[]>([]);
    const [monsterHitPulses, setMonsterHitPulses] = useState<Record<number, number>>({});
    const [playerAttackingSlot, setPlayerAttackingSlot] = useState<number | null>(null);

    const [skillCooldowns, setSkillCooldowns] = useState<Record<string, number>>({});
    const hpPotionCooldown = useCooldownStore((s) => s.hpPotionCooldown);
    const mpPotionCooldown = useCooldownStore((s) => s.mpPotionCooldown);
    const pctHpCooldown = useCooldownStore((s) => s.pctHpCooldown);
    const pctMpCooldown = useCooldownStore((s) => s.pctMpCooldown);
    const setHpPotionCooldown = useCooldownStore((s) => s.setHpPotionCooldown);
    const setMpPotionCooldown = useCooldownStore((s) => s.setMpPotionCooldown);
    const setPctHpCooldown = useCooldownStore((s) => s.setPctHpCooldown);
    const setPctMpCooldown = useCooldownStore((s) => s.setPctMpCooldown);
    const [speedMode, setSpeedMode] = useState<'x1' | 'x2' | 'x4'>('x1');
    const speedMult = speedMode === 'x4' ? 4 : speedMode === 'x2' ? 2 : 1;
    const cycleSpeed = useCallback(() => {
        setSpeedMode((s) => (s === 'x1' ? 'x2' : s === 'x2' ? 'x4' : 'x1'));
    }, []);

    useEffect(() => {
        useBuffStore.getState().setCombatSpeedMult(speedMult);
        return () => useBuffStore.getState().setCombatSpeedMult(1);
    }, [speedMult]);

    const partyHealAccumRef = useRef(0);
    const { trigger: triggerSkillAnim } = useSkillAnim();
    const fx = useCombatFx();
    const skillCooldownRef = useRef<Map<string, number>>(new Map());
    const hpPotionCooldownRef = useRef(0);
    const mpPotionCooldownRef = useRef(0);
    const pctHpCooldownRef = useRef(0);
    const pctMpCooldownRef = useRef(0);
    useEffect(() => { useCooldownStore.getState().clearAll(); return () => useCooldownStore.getState().clearAll(); }, []);
    const playerMpRef = useRef(0);

    const [playerHitPulse, setPlayerHitPulse] = useState(0);

    const [waitingForSpawn, setWaitingForSpawn] = useState(false);
    const [spawnProgress, setSpawnProgress] = useState(0);
    const spawnStartRef = useRef<number>(0);
    const spawnDurationRef = useRef<number>(WAVE_SPAWN_DELAY_MS);

    const ATTACK_ANIM_DURATION: Record<string, number> = {
        Knight: 350,
        Mage: 400,
        Cleric: 400,
        Archer: 300,
        Rogue: 250,
        Necromancer: 450,
        Bard: 400,
    };
    const logEndRef = useRef<HTMLDivElement>(null);
    const logIdRef = useRef(0);

    const playerHpRef     = useRef(0);

    useLevelUpRefill(phase === 'running', useCallback((maxHp, maxMp) => {
        playerHpRef.current = maxHp;
        playerMpRef.current = maxMp;
        setPlayerHp(maxHp);
        setPlayerMp(maxMp);
    }, []));

    const monsterHpsRef   = useRef<number[]>([]);
    const currentWaveRef  = useRef(0);
    const activeDungeonRef = useRef<IDungeon | null>(null);
    const currentMonstersRef = useRef<ICurrentMonster[]>([]);
    const phaseRef        = useRef<ScreenPhase>('list');
    const waveItemsRef    = useRef<IGeneratedItem[]>([]);
    const waveXpRef       = useRef(0);
    const waveGoldRef     = useRef(0);

    const effectsRef = useRef<ICombatEffectsSession>(newCombatEffectsSession());
    const PLAYER_FX_ID = 'player';
    const monsterFxId = (wave: number, slot: number) => `monster_${wave}_${slot}`;

    const allDungeons = dungeonData as IDungeon[];
    const allMonsters = monstersData as IDungeonMonster[];
    const monstersRaw = monstersData as unknown as { id: string; gold: [number, number] }[];
    const allItems: IBaseItem[] = flattenItemsData(itemsData as Parameters<typeof flattenItemsData>[0]);
    const skillLevels = useSkillStore((s) => s.skillLevels);

    const dungeonFilterAvailableOnly = useSettingsStore((s) => s.dungeonFilterAvailableOnly);
    const dungeonFilterMinLevel      = useSettingsStore((s) => s.dungeonFilterMinLevel);
    const dungeonFilterSortDesc      = useSettingsStore((s) => s.dungeonFilterSortDesc);
    const setDungeonFilterAvailableOnly = useSettingsStore((s) => s.setDungeonFilterAvailableOnly);
    const setDungeonFilterMinLevel      = useSettingsStore((s) => s.setDungeonFilterMinLevel);
    const setDungeonFilterSortDesc      = useSettingsStore((s) => s.setDungeonFilterSortDesc);

    const autoPotionHpId    = useSettingsStore((s) => s.autoPotionHpId);
    const autoPotionMpId    = useSettingsStore((s) => s.autoPotionMpId);
    const autoPotionPctHpId = useSettingsStore((s) => s.autoPotionPctHpId);
    const autoPotionPctMpId = useSettingsStore((s) => s.autoPotionPctMpId);

    const eqStats   = getTotalEquipmentStats(equipment, allItems);
    const tb        = getTrainingBonuses(skillLevels, character?.class ?? 'Knight');
    const gearGapMult = getGearGapMultiplier(getEquippedGearLevel(equipment), activeDungeon?.level ?? 0);
    const charAtk   = ((character?.attack  ?? 0) + eqStats.attack + getElixirAtkBonus()) * gearGapMult;
    const charDef   = (character?.defense ?? 0) + eqStats.defense + tb.defense + getElixirDefBonus();
    const effChar   = character ? getEffectiveChar(character) : null;
    const baseMaxHp = (character?.max_hp ?? 0) + eqStats.hp + tb.max_hp + getElixirHpBonus();
    const baseMaxMp = (character?.max_mp ?? 0) + eqStats.mp + tb.max_mp + getElixirMpBonus();
    const charMaxHp = effChar?.max_hp ?? baseMaxHp;
    const charMaxMp = effChar?.max_mp ?? baseMaxMp;
    const charSpeed = ((character?.attack_speed ?? 1) + eqStats.speed * 0.01 + tb.attack_speed) * getElixirAttackSpeedMultiplier();

    useEffect(() => {
        const TICK = 250;
        const id = setInterval(() => {
            const pct = useBuffStore.getState().getPartyHealDotPctPerSec();
            if (pct <= 0) {
                partyHealAccumRef.current = 0;
                return;
            }
            const mult = useBuffStore.getState().combatSpeedMult;
            partyHealAccumRef.current += TICK * Math.max(1, mult);
            const pulseSkillId = useBuffStore.getState().getPartyHealDotSkillId();
            while (partyHealAccumRef.current >= 1000) {
                partyHealAccumRef.current -= 1000;
                const heal = Math.max(1, Math.floor(charMaxHp * (pct / 100)));
                const before = playerHpRef.current;
                if (before < charMaxHp) {
                    playerHpRef.current = Math.min(charMaxHp, before + heal);
                    setPlayerHp(playerHpRef.current);
                }
                const actual = playerHpRef.current - before;
                const cappedTag = actual < heal ? ' (MAX)' : '';
                fx.pushAllyFloat(0, heal, 'heal', {
                    icon: 'green-heart',
                    label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                });
                if (pulseSkillId) fx.triggerAllySkillAnim(0, pulseSkillId);
            }
        }, TICK);
        return () => clearInterval(id);
    }, [fx, charMaxHp]);

    const dockLevel = character?.level ?? 1;
    const bestHpPotion =
        resolveAutoPotionElixir(autoPotionHpId, 'hp', 'flat', consumables, dockLevel)
        ?? getBestPotion(hpPotions, consumables, dockLevel);
    const bestMpPotion =
        resolveAutoPotionElixir(autoPotionMpId, 'mp', 'flat', consumables, dockLevel)
        ?? getBestPotion(mpPotions, consumables, dockLevel);
    const bestPctHpPotion =
        resolveAutoPotionElixir(autoPotionPctHpId, 'hp', 'pct', consumables, dockLevel)
        ?? getBestPotionUtil(PCT_HP_POTIONS, consumables, dockLevel);
    const bestPctMpPotion =
        resolveAutoPotionElixir(autoPotionPctMpId, 'mp', 'pct', consumables, dockLevel)
        ?? getBestPotionUtil(PCT_MP_POTIONS, consumables, dockLevel);

    phaseRef.current = phase;
    activeDungeonRef.current = activeDungeon;

    useEffect(() => {
        if (phase !== 'running') return;
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

    const leavePenaltyAppliedRef = useRef(false);
    useEffect(() => {
        const fire = () => {
            if (leavePenaltyAppliedRef.current) return;
            if (phaseRef.current !== 'running') return;
            const dungeon = activeDungeonRef.current;
            if (!dungeon) return;
            leavePenaltyAppliedRef.current = true;
            applyCombatLeaveDeath({
                source: 'dungeon',
                sourceName: dungeon.name_pl,
                sourceLevel: dungeon.level,
            });
        };
        window.addEventListener('beforeunload', fire);
        return () => {
            window.removeEventListener('beforeunload', fire);
            fire();
        };
    }, []);

    const addLog = useCallback((text: string, type: ILogEntry['type']) => {
        const id = ++logIdRef.current;
        setCombatLog((prev) => [...prev.slice(-50), { id, text, type }]);
        const sessionType = type === 'wave' ? 'system' : type;
        useCombatStore.getState().addSessionLog(text, sessionType);
    }, []);

    const showFloatingDmg = useCallback((_text: string, _type: string, _side?: 'left' | 'right') => {
        void _text; void _type; void _side;
    }, []);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [combatLog.length]);

    useEffect(() => {
        if (phase !== 'running') return;
        const TICK_MS = 100;
        const DEC = TICK_MS * speedMult;
        const id = setInterval(() => {
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
            useCooldownStore.getState().tick(DEC);
            const _cd = useCooldownStore.getState();
            hpPotionCooldownRef.current = _cd.hpPotionCooldown;
            mpPotionCooldownRef.current = _cd.mpPotionCooldown;
            pctHpCooldownRef.current = _cd.pctHpCooldown;
            pctMpCooldownRef.current = _cd.pctMpCooldown;
        }, TICK_MS);
        return () => clearInterval(id);
    }, [phase, speedMult]);

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

    const { skillMode, setSkillMode, autoPotionHpEnabled, autoPotionMpEnabled } = useSettingsStore(useShallow((s) => ({ skillMode: s.skillMode, setSkillMode: s.setSkillMode, autoPotionHpEnabled: s.autoPotionHpEnabled, autoPotionMpEnabled: s.autoPotionMpEnabled })));

    const tryAutoPotion = useCallback(() => {
        const settings = useSettingsStore.getState();
        const inv = useInventoryStore.getState();
        const hp = playerHpRef.current;
        const mp = playerMpRef.current;

        const freshChar = useCharacterStore.getState().character;
        const freshEff = freshChar ? getEffectiveChar(freshChar) : null;
        const liveMaxHp = freshEff?.max_hp ?? charMaxHp;
        const liveMaxMp = freshEff?.max_mp ?? charMaxMp;

        const hpMissing = Math.max(0, liveMaxHp - hp);
        const mpMissing = Math.max(0, liveMaxMp - mp);
        const hpPct = liveMaxHp > 0 ? (hp / liveMaxHp) * 100 : 100;
        const mpPct = liveMaxMp > 0 ? (mp / liveMaxMp) * 100 : 100;

        const hpAtFull = liveMaxHp > 0 && hp >= liveMaxHp;
        const mpAtFull = liveMaxMp > 0 && mp >= liveMaxMp;

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

        if (!hpAtFull && settings.autoPotionHpEnabled && settings.autoPotionHpThreshold > 0 && hpPct <= settings.autoPotionHpThreshold && hpPotionCooldownRef.current <= 0) {
            const pot = resolveAmount(settings.autoPotionHpId, 'flat', 'hp', liveMaxHp);
            if (pot && pot.amount > 0 && hpMissing >= pot.amount) {
                inv.useConsumable(pot.id);
                startHpCooldown();
                healPlayerHp(pot.amount, liveMaxHp);
                addLog(`[Auto] ${pot.name} +${pot.amount} HP`, 'system');
            }
        }

        if (!mpAtFull && settings.autoPotionMpEnabled && settings.autoPotionMpThreshold > 0 && mpPct <= settings.autoPotionMpThreshold && mpPotionCooldownRef.current <= 0) {
            const pot = resolveAmount(settings.autoPotionMpId, 'flat', 'mp', liveMaxMp);
            if (pot && pot.amount > 0 && mpMissing >= pot.amount) {
                inv.useConsumable(pot.id);
                startMpCooldown();
                healPlayerMp(pot.amount, liveMaxMp);
                addLog(`[Auto] ${pot.name} +${pot.amount} MP`, 'system');
            }
        }

        if (!hpAtFull && settings.autoPotionPctHpEnabled && settings.autoPotionPctHpThreshold > 0 && hpPct <= settings.autoPotionPctHpThreshold && pctHpCooldownRef.current <= 0) {
            const pot = resolveAmount(settings.autoPotionPctHpId, 'pct', 'hp', liveMaxHp);
            if (pot && pot.amount > 0 && hpMissing >= pot.amount) {
                inv.useConsumable(pot.id);
                setPctHpCooldown(PCT_POTION_COOLDOWN_MS);
                pctHpCooldownRef.current = PCT_POTION_COOLDOWN_MS;
                healPlayerHp(pot.amount, liveMaxHp);
                const tag = pot.pct != null ? ` (${pot.pct}%)` : '';
                addLog(`[Auto] ${pot.name} +${pot.amount} HP${tag}`, 'system');
            }
        }

        if (!mpAtFull && settings.autoPotionPctMpEnabled && settings.autoPotionPctMpThreshold > 0 && mpPct <= settings.autoPotionPctMpThreshold && pctMpCooldownRef.current <= 0) {
            const pot = resolveAmount(settings.autoPotionPctMpId, 'pct', 'mp', liveMaxMp);
            if (pot && pot.amount > 0 && mpMissing >= pot.amount) {
                inv.useConsumable(pot.id);
                setPctMpCooldown(PCT_POTION_COOLDOWN_MS);
                pctMpCooldownRef.current = PCT_POTION_COOLDOWN_MS;
                healPlayerMp(pot.amount, liveMaxMp);
                const tag = pot.pct != null ? ` (${pot.pct}%)` : '';
                addLog(`[Auto] ${pot.name} +${pot.amount} MP${tag}`, 'system');
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

    const doUsePotion = useCallback((elixirId: string) => {
        const elixir = ELIXIRS.find((e) => e.id === elixirId);
        if (!elixir) return;
        const isHp = elixir.effect.startsWith('heal_hp');
        const isMp = elixir.effect.startsWith('heal_mp');
        const isPct = elixir.effect.includes('_pct_');
        if (isHp && !isPct && hpPotionCooldownRef.current > 0) return;
        if (isMp && !isPct && mpPotionCooldownRef.current > 0) return;
        if (isHp && isPct && pctHpCooldownRef.current > 0) return;
        if (isMp && isPct && pctMpCooldownRef.current > 0) return;
        const used = useInventoryStore.getState().useConsumable(elixirId);
        if (!used) return;
        if (isHp && !isPct) startHpCooldown();
        if (isMp && !isPct) startMpCooldown();
        if (isHp && isPct) startPctHpCooldown();
        if (isMp && isPct) startPctMpCooldown();
        const freshChar = useCharacterStore.getState().character;
        const freshEff = freshChar ? getEffectiveChar(freshChar) : null;
        const liveMaxHp = freshEff?.max_hp ?? charMaxHp;
        const liveMaxMp = freshEff?.max_mp ?? charMaxMp;

        const flatMatch = elixir.effect.match(/^heal_(hp|mp)_(\d+)$/);
        const pctMatch = elixir.effect.match(/^heal_(hp|mp)_pct_(\d+)$/);
        if (flatMatch) {
            const type = flatMatch[1] as 'hp' | 'mp';
            const amount = parseInt(flatMatch[2], 10);
            if (type === 'hp') { healPlayerHp(amount, liveMaxHp); addLog(`${elixir.name_pl} +${amount} HP`, 'system'); }
            else { healPlayerMp(amount, liveMaxMp); addLog(`${elixir.name_pl} +${amount} MP`, 'system'); }
        } else if (pctMatch) {
            const type = pctMatch[1] as 'hp' | 'mp';
            const pct = parseInt(pctMatch[2], 10);
            if (type === 'hp') { const a = Math.floor(liveMaxHp * pct / 100); healPlayerHp(a, liveMaxHp); addLog(`${elixir.name_pl} +${a} HP (${pct}%)`, 'system'); }
            else { const a = Math.floor(liveMaxMp * pct / 100); healPlayerMp(a, liveMaxMp); addLog(`${elixir.name_pl} +${a} MP (${pct}%)`, 'system'); }
        }
    }, [charMaxHp, charMaxMp, healPlayerHp, healPlayerMp, startHpCooldown, startMpCooldown, startPctHpCooldown, startPctMpCooldown, addLog]);

    const startWaveMonster = useCallback((dungeon: IDungeon, waveIdx: number, hp: number) => {
        const totalWaves = getDungeonWaves(dungeon);
        const dLvl       = getDungeonMinLevel(dungeon);
        const composition = getWaveComposition(dLvl, waveIdx, totalWaves);
        const rawMonsters = pickWaveMonsters(dungeon, allMonsters, waveIdx, totalWaves);

        const spawned: ICurrentMonster[] = composition.map((type, idx) => {
            const raw    = rawMonsters[idx] ?? rawMonsters[rawMonsters.length - 1];
            const scaled = scaleDungeonMonsterAsType(raw, waveIdx, totalWaves, dLvl, type);
            return {
                slot:      idx,
                monster:   scaled,
                type,
                currentHp: scaled.hp,
                maxHp:     scaled.hp,
            };
        });

        setCurrentMonsters(spawned);
        currentMonstersRef.current = spawned;
        monsterHpsRef.current = spawned.map((m) => m.currentHp);
        setMonsterHitPulses({});
        setPlayerAttackingSlot(null);
        fx.resetFx();

        setPlayerHp(hp);
        playerHpRef.current = hp;
        currentWaveRef.current = waveIdx;

        const leadType = composition[0];
        const typeLabel = leadType !== 'Normal'
            ? ` · ${MONSTER_TYPE_BADGES[leadType].icon} ${MONSTER_TYPE_BADGES[leadType].label}`
            : '';
        const namesSummary = spawned.length > 1
            ? `${spawned[0].monster.name_pl} ×${spawned.length}`
            : spawned[0].monster.name_pl;
        addLog(
            `=== Fala ${waveIdx + 1}/${totalWaves}${typeLabel}: ${namesSummary} ===`,
            'wave',
        );
    }, [allMonsters, addLog, fx]);

    const resolveDungeonViaBackend = useCallback(async (dungeon: IDungeon): Promise<void> => {
        const liveChar = useCharacterStore.getState().character;
        if (!liveChar) return;
        const goldBefore = useInventoryStore.getState().gold;
        try {
            const res: unknown = await backendApi.dungeonResolve(liveChar.id, dungeon.id);
            await syncFromBackend(liveChar.id);

            const root: Record<string, unknown> =
                res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
            const rewardsRaw = root.rewards ?? root.reward;
            const rewards: Record<string, unknown> =
                rewardsRaw && typeof rewardsRaw === 'object'
                    ? (rewardsRaw as Record<string, unknown>)
                    : {};
            const num = (v: unknown): number | null =>
                typeof v === 'number' && Number.isFinite(v) ? v : null;

            const won: boolean =
                typeof root.won === 'boolean' ? root.won
                : typeof root.success === 'boolean' ? root.success
                : root.result === 'loss' || root.result === 'death' ? false
                : true;
            const goldDelta = Math.max(0, useInventoryStore.getState().gold - goldBefore);
            const gold = num(root.gold) ?? num(rewards.gold) ?? goldDelta;
            const xp = num(root.xp) ?? num(rewards.xp) ?? 0;
            const wavesCleared = num(root.wavesCleared) ?? num(root.waves_cleared)
                ?? (won ? getDungeonWaves(dungeon) : 0);

            setActiveDungeon(dungeon);
            setResult({
                success: won,
                wavesCleared,
                playerHpLeft: playerHpRef.current,
                gold,
                xp,
                items: [],
            });
            setResultKind(won ? 'win' : 'death');
            setPhase('result');
        } catch (e) {
            console.warn('[dungeon] dungeonResolve failed', e);
            setPhase('list');
        }
    }, []);

    const handleStart = useCallback((dungeon: IDungeon) => {
        if (isBackendCombatDelegated()) {
            void resolveDungeonViaBackend(dungeon);
            return;
        }
        setActiveDungeon(dungeon);
        setCurrentWave(0);
        setResult(null);
        setResultKind(null);
        setCombatLog([]);
        setWaveItems([]);
        waveItemsRef.current = [];
        waveXpRef.current = 0;
        waveGoldRef.current = 0;
        useCombatStore.getState().clearCombatSession();
        leavePenaltyAppliedRef.current = false;
        const startChar = useCharacterStore.getState().character;
        const startHp = startChar
            ? Math.max(1, Math.min(charMaxHp, startChar.hp ?? charMaxHp))
            : charMaxHp;
        const startMp = startChar
            ? Math.max(0, Math.min(charMaxMp, startChar.mp ?? charMaxMp))
            : charMaxMp;
        setPlayerMp(startMp);
        playerMpRef.current = startMp;
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
        effectsRef.current = newCombatEffectsSession();
        useNecroSummonStore.getState().clear(PLAYER_FX_ID);
        setPhase('running');
        startWaveMonster(dungeon, 0, startHp);
    }, [charMaxHp, charMaxMp, startWaveMonster, resolveDungeonViaBackend]);

    const handleEnterClick = useCallback(
        (e: React.MouseEvent<HTMLButtonElement>, dungeon: IDungeon) => {
            if (isBackendCombatDelegated()) {
                handleStart(dungeon);
                return;
            }
            const card = (e.currentTarget as HTMLElement).closest('.dungeon__card') as HTMLElement | null;
            const reducedMotion = typeof window !== 'undefined'
                && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            if (!card || enterAnim || reducedMotion) {
                handleStart(dungeon);
                return;
            }
            const rect = card.getBoundingClientRect();
            const dungeonLvl = getDungeonMinLevel(dungeon);
            const url = getDungeonImage(dungeon.id);
            pendingDungeonRef.current = dungeon;
            setEnterAnim({
                x: rect.left,
                y: rect.top,
                w: rect.width,
                h: rect.height,
                hue: getDungeonCardHue(dungeonLvl),
                image: url ?? '',
                dungeonId: dungeon.id,
            });
            setPhase('entering');
            enterAnimTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
            enterAnimTimeoutsRef.current = [];
            const tCombat = window.setTimeout(() => {
                handleStart(dungeon);
            }, ENTRY_ANIM_COMBAT_START_AT_MS);
            enterAnimTimeoutsRef.current.push(tCombat);
            const tEnd = window.setTimeout(() => {
                setEnterAnim(null);
            }, ENTRY_ANIM_TOTAL_MS);
            enterAnimTimeoutsRef.current.push(tEnd);
        },
        [enterAnim, handleStart],
    );

    const skipEntryAnimation = useCallback(() => {
        if (!enterAnim) return;
        enterAnimTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
        enterAnimTimeoutsRef.current = [];
        if (phaseRef.current === 'entering' && pendingDungeonRef.current) {
            handleStart(pendingDungeonRef.current);
        }
        setEnterAnim(null);
    }, [enterAnim, handleStart]);

    const handleWaveMonsterDeath = useCallback((slotIdx: number) => {
        const dungeon = activeDungeonRef.current;
        if (!dungeon || !character) return;

        const slots = currentMonstersRef.current;
        const killed = slots[slotIdx];
        if (!killed) return;

        tickCombatElixirs(1500);

        const totalWaves = getDungeonWaves(dungeon);
        const wave = currentWaveRef.current;
        const isBossWave = wave === totalWaves - 1;

        const drop = rollDungeonItemDrop(dungeon, character.level, allItems, isBossWave);
        if (drop) {
            waveItemsRef.current = [...waveItemsRef.current, drop];
            setWaveItems([...waveItemsRef.current]);
            const info = getItemDisplayInfo(drop.itemId);
            const displayName = info?.name_pl ?? formatItemName(drop.itemId);
            addLog(`:package: Drop: ${displayName} [${drop.rarity}]`, 'system');
            useCombatStore.getState().appendDrops([{
                icon: info?.icon ?? 'package',
                name: displayName,
                rarity: drop.rarity,
            }]);
            useQuestStore.getState().addProgress('drop_rarity', drop.rarity, 1);
        }

        const potionDrops = rollPotionDrop(killed.monster.level);
        if (potionDrops.length > 0) {
            const inv = useInventoryStore.getState();
            for (const pd of potionDrops) {
                inv.addConsumable(pd.potionId, pd.count);
                addLog(`:test-tube: Drop: ${pd.potionId} ×${pd.count}`, 'system');
            }
        }

        const killedMonster = killed.monster;
        useTaskStore.getState().addKill(killedMonster.id, killedMonster.level, 1);
        useQuestStore.getState().addProgress('kill', killedMonster.id, 1);
        useDailyQuestStore.getState().addProgress('kill_any', 1);
        useMasteryStore.getState().addMasteryKills(killedMonster.id, 1);
        useCombatStore.getState().incrementSessionKill(
            killed.type.toLowerCase() as TMonsterRarity,
        );

        const killMasteryLvl = useMasteryStore.getState().getMasteryLevel(killedMonster.id);
        const killXpMult = getMasteryXpMultiplier(killMasteryLvl);
        const killGoldMult = getMasteryGoldMultiplier(killMasteryLvl);

        waveXpRef.current += Math.floor((killedMonster.xp ?? 0) * killXpMult);
        const baseMonster = allMonsters.find((m) => m.id === killedMonster.id);
        if (baseMonster) {
            const bmRaw = monstersData as unknown as { id: string; gold: [number, number] }[];
            const bmGold = bmRaw.find((m) => m.id === killedMonster.id)?.gold;
            if (bmGold) {
                const rawGold = bmGold[0] + Math.floor(Math.random() * (bmGold[1] - bmGold[0] + 1));
                waveGoldRef.current += Math.floor(rawGold * killGoldMult);
            }
        }

        const allDead = currentMonstersRef.current.every((m) => m.currentHp <= 0);
        if (!allDead) return;

        const hp = playerHpRef.current;

        if (isBossWave) {
            const DUNGEON_REWARD_MULTIPLIER = 4;
            const dungeonLevel = dungeon.level ?? 1;
            const xpBonus = dungeonLevel * dungeonLevel;
            const goldBonus = dungeonLevel * 1_000;
            const gold = waveGoldRef.current * DUNGEON_REWARD_MULTIPLIER + goldBonus;
            const xp = waveXpRef.current * DUNGEON_REWARD_MULTIPLIER + xpBonus;
            const items = waveItemsRef.current;

            const inv = useInventoryStore.getState();
            inv.addGold(gold);
            const xpResult = useCharacterStore.getState().addXp(xp);
            const xpAwarded = xpResult.xpApplied;
            for (const gen of items) inv.addItem(buildItem(gen));

            useCombatStore.getState().addSessionStats(xpAwarded, gold);

            const dungeonLvl = dungeon.level ?? 1;
            const chestDrops = rollSpellChestDrop(dungeonLvl, 'normal', true, false);
            const chestNames: string[] = [];
            for (const cd of chestDrops) {
                inv.addSpellChest(cd.chestLevel, cd.count);
                chestNames.push(`${getSpellChestEmoji(cd.chestLevel)} ${getSpellChestDisplayName(cd.chestLevel)}`);
            }

            setDungeonCompleted(dungeon.id);
            useQuestStore.getState().addProgress('dungeon', dungeon.id, 1);
            useQuestStore.getState().addProgress('complete_dungeons_any', 'any', 1);
            useDailyQuestStore.getState().addProgress('complete_dungeon', 1);
            useDailyQuestStore.getState().addProgress('earn_gold', gold);
            addLog(`:trophy: Dungeon ukończony! +${gold.toLocaleString('pl-PL')} Gold, +${xpAwarded.toLocaleString('pl-PL')} XP`, 'system');
            if (chestNames.length > 0) {
                addLog(`:package: Spell Chests: ${chestNames.join(', ')}`, 'system');
            }
            setResult({ success: true, wavesCleared: totalWaves, playerHpLeft: hp, gold, xp: xpAwarded, items });
            setResultKind('win');
            const liveCharAfter = useCharacterStore.getState().character;
            if (liveCharAfter) {
                const eqLive = getTotalEquipmentStats(equipment, allItems);
                const tbLive = getTrainingBonuses(skillLevels, character.class);
                const baseMaxHpLive = liveCharAfter.max_hp + eqLive.hp + tbLive.max_hp + getElixirHpBonus();
                const baseMaxMpLive = liveCharAfter.max_mp + eqLive.mp + tbLive.max_mp + getElixirMpBonus();
                const effLive = getEffectiveChar(liveCharAfter);
                const liveEffectiveMaxHp = effLive?.max_hp ?? baseMaxHpLive;
                const liveEffectiveMaxMp = effLive?.max_mp ?? baseMaxMpLive;
                const finalHp = xpResult.levelsGained > 0
                    ? liveEffectiveMaxHp
                    : Math.max(1, Math.min(liveEffectiveMaxHp, hp));
                const finalMp = xpResult.levelsGained > 0
                    ? liveEffectiveMaxMp
                    : Math.max(0, Math.min(liveEffectiveMaxMp, playerMpRef.current));
                useCharacterStore.getState().updateCharacter({ hp: finalHp, mp: finalMp });
            }
            leavePenaltyAppliedRef.current = true;
            setPhase('result');
        } else {
            const nextWave = wave + 1;
            setCurrentWave(nextWave);
            addLog(`:check-mark-button: Fala ${wave + 1} zaliczona! HP: ${hp}/${charMaxHp}`, 'system');
            const delayMs = Math.max(60, Math.floor(WAVE_SPAWN_DELAY_MS / speedMult));
            spawnStartRef.current = Date.now();
            spawnDurationRef.current = delayMs;
            setSpawnProgress(0);
            setWaitingForSpawn(true);
            setTimeout(() => {
                if (phaseRef.current === 'running') {
                    startWaveMonster(dungeon, nextWave, playerHpRef.current);
                }
                setWaitingForSpawn(false);
                setSpawnProgress(0);
            }, delayMs);
        }
    }, [character, allItems, addLog, setDungeonCompleted, charMaxHp, charMaxMp, startWaveMonster, speedMult]);

    const handlePlayerDeath = useCallback(() => {
        const dungeon = activeDungeonRef.current;
        if (!dungeon) return;
        leavePenaltyAppliedRef.current = true;
        const wave = currentWaveRef.current;
        const totalWaves = getDungeonWaves(dungeon);

        const char = useCharacterStore.getState().character;
        if (char) {
            if (isBackendMode() && char) {
                void backendApi.logDeath(char.id, {
                    source: 'dungeon',
                    source_name: dungeon.name_pl,
                    source_level: dungeon.level,
                    result: 'killed',
                });
            } else {
                void deathsApi.logDeath({
                    character_id: char.id,
                    character_name: char.name,
                    character_class: char.class,
                    character_level: char.level,
                    source: 'dungeon',
                    source_name: dungeon.name_pl,
                    source_level: dungeon.level,
                });
            }

            const prot = consumeDeathProtection();

            useCharacterStore.getState().fullHealEffective();

            const oldLevel = char.level;
            let newLevel = char.level;
            let levelsLost = 0;
            let xpPercent = 100;
            let skillXpLossPercent = 0;

            if (prot.isProtected) {
                const savedByTxt = prot.consumedId === 'death_protection'
                    ? 'Eliksir Ochrony'
                    : 'Amulet of Loss';
                addLog(`:shield: ${savedByTxt} uchronił Cię od jakiejkolwiek straty!`, 'system');
            } else {
                const penalty = applyDeathPenalty(char.level, char.xp);
                newLevel = penalty.newLevel;
                levelsLost = penalty.levelsLost;
                xpPercent = penalty.xpPercent;
                skillXpLossPercent = penalty.skillXpLossPercent;
                const currentHighest = char.highest_level ?? char.level;
                const preservedHighest = Math.max(currentHighest, char.level);
                useCharacterStore.getState().updateCharacter({
                    xp: penalty.newXp,
                    level: penalty.newLevel,
                    highest_level: preservedHighest,
                });
                useCharacterStore.getState().fullHealEffective();
                useSkillStore.getState().applyDeathPenalty(char.class, penalty.skillXpLossPercent);
                useSkillStore.getState().purgeLockedSkillSlots(char.class, penalty.newLevel);
                const skillPctTxt = `-${penalty.skillXpLossPercent}% Skill XP`;
                if (penalty.levelsLost > 0) {
                    addLog(`:skull: Poległeś na fali ${wave + 1}/${totalWaves}! Tracisz ${penalty.levelsLost} poziom${penalty.levelsLost === 1 ? '' : 'y'}: ${char.level} -> ${penalty.newLevel} · ${skillPctTxt}`, 'system');
                } else {
                    addLog(`:skull: Poległeś na fali ${wave + 1}/${totalWaves}! Dungeon nieukończony. ${skillPctTxt}`, 'system');
                }

                const itemsLost = useInventoryStore.getState().applyDeathItemLoss(false, char.level);
                if (itemsLost > 0) {
                    addLog(`:skull: Stracileś ${itemsLost} przedmiot(ow) przy śmierci!`, 'system');
                }
            }

            void saveCurrentCharacterStores();

            useDeathStore.getState().triggerDeath({
                killedBy: dungeon.name_pl,
                sourceLevel: dungeon.level,
                oldLevel,
                newLevel,
                levelsLost,
                xpPercent,
                skillXpLossPercent,
                protectionUsed: prot.isProtected,
                source: 'dungeon',
            });
        } else {
            addLog(`:skull: Poległeś na fali ${wave + 1}/${totalWaves}! Dungeon nieukończony.`, 'system');
        }

        useCombatStore.getState().clearCombatSession();
        useNecroSummonStore.getState().clear(PLAYER_FX_ID);
        setResult({ success: false, wavesCleared: wave, playerHpLeft: 0, gold: 0, xp: 0, items: [] });
        setResultKind('death');
        setPhase('result');
    }, [addLog]);

    const getFirstAliveSlot = useCallback((): number => {
        const hps = monsterHpsRef.current;
        for (let i = 0; i < hps.length; i++) {
            if (hps[i] > 0) return i;
        }
        return -1;
    }, []);

    const applyDamageToSlot = useCallback((slot: number, dmg: number): number => {
        const hps = monsterHpsRef.current;
        const before = hps[slot] ?? 0;
        const after = Math.max(0, before - dmg);
        hps[slot] = after;

        const cur = currentMonstersRef.current;
        if (!cur[slot]) return after;
        const next = cur.slice();
        next[slot] = { ...next[slot], currentHp: after };
        currentMonstersRef.current = next;
        setCurrentMonsters(next);
        return after;
    }, []);

    const doManualSkill = useCallback((slotIdx: 0 | 1 | 2 | 3) => {
        if (phaseRef.current !== 'running') return;
        if (isCombatantStunned(effectsRef.current, PLAYER_FX_ID)) return;
        const targetSlot = getFirstAliveSlot();
        if (targetSlot < 0) return;
        const slots = useSkillStore.getState().activeSkillSlots;
        const skillId = slots[slotIdx];
        if (!skillId) return;
        const now = Date.now();
        const lastUsed = skillCooldownRef.current.get(skillId) ?? 0;
        if (now - lastUsed < getSpeedScaledCooldownMs(resolveSkillRecastMs(skillId, SKILL_COOLDOWN_MS), speedMult)) return;
        if (playerMpRef.current < SKILL_MP_COST) {
            addLog('Za mało MP!', 'system');
            return;
        }
        const skillDefDng = getSkillDef(skillId);
        if ((skillDefDng?.effect ?? '').includes('death_apocalypse')) {
            const hpPct = playerHpRef.current / Math.max(1, charMaxHp);
            if (hpPct < 0.05) {
                addLog(':broken-heart: Apokalipsa zablokowana: < 5% HP', 'system');
                return;
            }
            let newPlayerHp: number;
            if (hpPct > 0.20) {
                newPlayerHp = Math.max(1, playerHpRef.current - Math.floor(charMaxHp * 0.20));
            } else {
                newPlayerHp = Math.max(1, Math.floor(charMaxHp * 0.03));
            }
            const lost = playerHpRef.current - newPlayerHp;
            if (lost > 0) {
                playerHpRef.current = newPlayerHp;
                setPlayerHp(newPlayerHp);
                useCharacterStore.getState().updateCharacter({ hp: newPlayerHp });
                fx.pushAllyFloat(0, lost, 'spell', { icon: 'broken-heart', label: `-${lost} HP` });
                addLog(`:broken-heart: Apokalipsa: -${lost} HP`, 'system');
            }
        }
        const wave = currentWaveRef.current;
        const targetFxId = monsterFxId(wave, targetSlot);
        const aliveEnemyIds = currentMonstersRef.current
            .map((m, idx) => (m.currentHp > 0 ? monsterFxId(wave, idx) : null))
            .filter((id): id is string => id !== null);
        const targetSlotData = currentMonstersRef.current[targetSlot];
        const targetMaxHp = targetSlotData?.maxHp ?? 1;
        const targetHpPct = targetMaxHp > 0
            ? (targetSlotData!.currentHp / targetMaxHp) * 100
            : 100;
        const sDef = getSkillDef(skillId);
        const skillBaseMult = sDef?.damage ?? 0;
        const isDamageHit = skillBaseMult > 0;
        const targetsEnemy = isDamageHit || skillTargetsEnemy(sDef?.effect ?? null);
        const apply = effectsCastSkill({
            session: effectsRef.current,
            casterId: PLAYER_FX_ID,
            targetId: targetFxId,
            targetHpPct,
            effect: sDef?.effect ?? null,
            allyIds: [PLAYER_FX_ID],
            enemyIds: aliveEnemyIds,
        });
        const defPenFracDng = Math.max(0, Math.min(1, (apply.defPenPct ?? 0) / 100));
        const baseDmg = isDamageHit ? Math.max(
            1,
            Math.floor(charAtk * rollSkillDamageMult(skillBaseMult, useSkillStore.getState().skillUpgradeLevels[skillId] ?? 0) * getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier() * (1 + defPenFracDng)),
        ) : 0;
        const normalSkillDmgDng = Math.floor(baseDmg * apply.castDmgMult);
        let skillDmg = isDamageHit
            ? (apply.instantKill
                ? Math.max(1, targetSlotData?.currentHp ?? 1)
                : ((apply.executeBurstPct ?? 0) > 0
                    ? Math.max(normalSkillDmgDng, Math.floor(targetMaxHp * (apply.executeBurstPct ?? 0) / 100))
                    : normalSkillDmgDng))
            : 0;
        if (isDamageHit && skillDmg > 0) {
            const tgtStSpell = ensureStatus(effectsRef.current, monsterFxId(currentWaveRef.current, targetSlot));
            const ampSpell = consumeTargetMarkAmp(tgtStSpell);
            if (ampSpell.mult !== 1) {
                skillDmg = Math.max(1, Math.floor(skillDmg * ampSpell.mult));
            }
        }
        const afterSkill = isDamageHit ? applyDamageToSlot(targetSlot, skillDmg) : -1;
        const newMp = Math.max(0, playerMpRef.current - SKILL_MP_COST);
        playerMpRef.current = newMp;
        setPlayerMp(newMp);
        skillCooldownRef.current.set(skillId, now);
        setSkillCooldowns((prev) => ({ ...prev, [skillId]: resolveSkillRecastMs(skillId, SKILL_COOLDOWN_MS) }));
        { const sd = getSkillDef(skillId); if (sd) applySkillBuff(skillId, sd, speedMult); }
        let totalDmgDealtThisCast = isDamageHit ? skillDmg : 0;
        if (apply.healPartyPctInstant > 0) {
            const heal = Math.max(1, Math.floor(charMaxHp * (apply.healPartyPctInstant / 100)));
            const before = playerHpRef.current;
            playerHpRef.current = Math.min(charMaxHp, before + heal);
            setPlayerHp(playerHpRef.current);
            const actual = playerHpRef.current - before;
            const tag = actual < heal ? ' (MAX)' : '';
            fx.pushAllyFloat(0, heal, 'heal', {
                icon: 'sparkles',
                label: tag ? `+${heal}${tag}` : undefined,
            });
            fx.triggerAllySkillAnim(0, skillId);
            addLog(`:sparkles: ${formatSkillName(skillId)}: +${heal} HP${tag}`, 'system');
        }
        if (apply.healLowestAllyPct > 0) {
            const heal = Math.floor(charMaxHp * (apply.healLowestAllyPct / 100));
            const before = playerHpRef.current;
            playerHpRef.current = Math.min(charMaxHp, playerHpRef.current + heal);
            setPlayerHp(playerHpRef.current);
            const actual = playerHpRef.current - before;
            if (heal > 0) {
                const cappedTag = actual < heal ? ' (MAX)' : '';
                fx.pushAllyFloat(0, heal, 'heal', {
                    icon: 'sparkles',
                    label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                });
                fx.triggerAllySkillAnim(0, skillId);
                addLog(`:sparkles: ${formatSkillName(skillId)}: +${heal} HP${cappedTag}`, 'system');
            }
        }
        triggerSkillAnim(skillId);
        if (!targetsEnemy) {
            fx.triggerAllySkillAnim(0, skillId);
            addLog(`:sparkles: ${formatSkillName(skillId)}: BUFF (-${SKILL_MP_COST} MP)`, 'player');
        } else {
            if (isDamageHit) {
                fx.pushEnemyFloat(targetSlot, skillDmg, 'spell', { icon: getSkillIcon(skillId) });
                showFloatingDmg(`-${skillDmg}`, 'player');
                addLog(`:sparkles: ${formatSkillName(skillId)}: ${skillDmg} dmg (-${SKILL_MP_COST} MP)`, 'player');
            } else {
                addLog(`:sparkles: ${formatSkillName(skillId)}: DEBUFF (-${SKILL_MP_COST} MP)`, 'player');
            }
            if (apply.aoe) {
                for (const idx of apply.aoeStunIdxs ?? []) {
                    fx.pushEnemyFloat(idx, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
                }
                for (const idx of apply.aoeParalyzeIdxs ?? []) {
                    fx.pushEnemyFloat(idx, 0, 'spell', { icon: 'locked', label: 'PARAL' });
                }
            } else if (apply.stunApplied) {
                fx.pushEnemyFloat(targetSlot, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
            } else if (apply.paralyzeApplied) {
                fx.pushEnemyFloat(targetSlot, 0, 'spell', { icon: 'locked', label: 'PARAL' });
            }
        }
        if (character) {
            useSkillStore.getState().addMlvlXpFromSkill(character.class);
        }
        if (isDamageHit && afterSkill <= 0) {
            handleWaveMonsterDeath(targetSlot);
        }
        if (isDamageHit && (apply.multistrike ?? 0) > 0) {
            const extra = Math.max(0, Math.floor(apply.multistrike));
            for (let n = 0; n < extra; n++) {
                window.setTimeout(() => {
                    if (phaseRef.current !== 'running') return;
                    const slot = currentMonstersRef.current[targetSlot];
                    if (!slot || slot.currentHp <= 0) return;
                    const wRoll = rollWeaponDamage();
                    const followup = Math.max(1, Math.floor(mitigateDamage(charAtk + wRoll, Math.max(0, slot.monster.defense * (1 - defPenFracDng)), character?.level ?? 1, true) * getAtkDamageMultiplier() * getTransformDmgMultiplier()));
                    const after = applyDamageToSlot(targetSlot, followup);
                    fx.pushEnemyFloat(targetSlot, followup, 'basic');
                    addLog(`:bow-and-arrow:×${n + 2} ${followup} dmg`, 'player');
                    if (after <= 0) handleWaveMonsterDeath(targetSlot);
                }, 120 * (n + 1));
            }
        }
        if (isDamageHit && apply.aoe) {
            const splashDmgManual = Math.max(1, Math.floor(skillDmg * 0.75));
            const splashIkPctManual = apply.instantKillPct ?? 0;
            for (let i = 0; i < currentMonstersRef.current.length; i++) {
                if (i === targetSlot) continue;
                const slotMon = currentMonstersRef.current[i];
                if (!slotMon || slotMon.currentHp <= 0) continue;
                const splashIk = splashIkPctManual > 0 && Math.random() * 100 < splashIkPctManual;
                let splashApplied = splashIk
                    ? Math.max(splashDmgManual, Math.floor(slotMon.maxHp * 12 / 100))
                    : splashDmgManual;
                if (!splashIk) {
                    const splashSt = ensureStatus(effectsRef.current, monsterFxId(currentWaveRef.current, i));
                    const ampSplash = consumeTargetMarkAmp(splashSt);
                    if (ampSplash.mult !== 1) {
                        splashApplied = Math.max(1, Math.floor(splashApplied * ampSplash.mult));
                    }
                }
                const splashAfter = applyDamageToSlot(i, splashApplied);
                totalDmgDealtThisCast += splashApplied;
                if (splashIk) {
                    fx.pushEnemyFloat(i, splashApplied, 'spell', { icon: 'skull', label: 'DEATH ATTACK', isCrit: true });
                } else {
                    fx.pushEnemyFloat(i, splashApplied, 'spell', { icon: getSkillIcon(skillId) });
                }
                if (splashAfter <= 0) {
                    handleWaveMonsterDeath(i);
                }
            }
        }
        if (apply.healCasterPctOfDmg > 0 && totalDmgDealtThisCast > 0) {
            const heal = Math.floor(totalDmgDealtThisCast * (apply.healCasterPctOfDmg / 100));
            const before = playerHpRef.current;
            playerHpRef.current = Math.min(charMaxHp, playerHpRef.current + heal);
            setPlayerHp(playerHpRef.current);
            const actual = playerHpRef.current - before;
            if (heal > 0) {
                const cappedTag = actual < heal ? ' (MAX)' : '';
                fx.pushAllyFloat(0, heal, 'heal', {
                    icon: 'sparkles',
                    label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                });
                addLog(`:sparkles: ${formatSkillName(skillId)}: +${heal} HP${cappedTag}`, 'system');
            }
        }
        if (apply.summons.length > 0 && character?.class === 'Necromancer') {
            const store = useNecroSummonStore.getState();
            for (const sm of apply.summons) {
                {
                    const spawned = store.spawn(PLAYER_FX_ID, sm.type, sm.count, charAtk, charMaxHp);
                    if (spawned > 0) fx.triggerAllySummonSpawn(0, sm.type);
                }
            }
        }
        if (apply.deathApocalypse && character) {
            const tgtMon = currentMonstersRef.current[targetSlot];
            if (tgtMon && tgtMon.currentHp > 0) {
                const apocDmg = Math.max(1, Math.floor(tgtMon.maxHp * (apply.deathApocalypseTargetMaxHpPct / 100)));
                const after = applyDamageToSlot(targetSlot, apocDmg);
                fx.pushEnemyFloat(targetSlot, apocDmg, 'spell', { icon: 'skull-and-crossbones', label: 'APOKALIPSA', isCrit: true });
                addLog(`:skull-and-crossbones: Apokalipsa Śmierci: ${apocDmg} dmg`, 'system');
                if (after <= 0) handleWaveMonsterDeath(targetSlot);
            }
        }
    }, [addLog, charAtk, charMaxHp, character, handleWaveMonsterDeath, showFloatingDmg, getFirstAliveSlot, applyDamageToSlot, fx]);

    const doPlayerAttack = useCallback(() => {
        if (phaseRef.current !== 'running') return;
        if (isCombatantStunned(effectsRef.current, PLAYER_FX_ID)) return;
        const initialTarget = getFirstAliveSlot();
        if (initialTarget < 0) return;

        const isDualWield = !!classesDataMap[character?.class ?? '']?.dualWield;

        const doSingleHit = (hand: 'left' | 'right' | undefined, weaponRollFn: () => number, dmgPercent: number) => {
            if (phaseRef.current !== 'running') return 0;
            const slot = getFirstAliveSlot();
            if (slot < 0) return 0;
            const slotData = currentMonstersRef.current[slot];
            if (!slotData) return 0;

            const wRoll = Math.floor(weaponRollFn() * dmgPercent);
            const totalAtk = charAtk + wRoll;
            const baseDmg = mitigateDamage(totalAtk, slotData.monster.defense, character?.level ?? 1, true);
            const variance = Math.floor(baseDmg * 0.2);
            const rolledDmg = Math.max(1, baseDmg - variance + Math.floor(Math.random() * (variance * 2 + 1)));
            const playerStatus = ensureStatus(effectsRef.current, PLAYER_FX_ID);
            const mods = consumeCasterBasicHitMods(playerStatus);
            syncCasterChargeConsume(mods.consumed);
            const baseCrit = mods.forceCrit ? true : Math.random() < mods.extraCritChance;
            const critMult = baseCrit ? 2.0 : 1.0;
            const finalDmg = Math.max(1, Math.floor(rolledDmg * critMult * mods.dmgMult * getAtkDamageMultiplier() * getTransformDmgMultiplier()));

            const newMHp = applyDamageToSlot(slot, finalDmg);

            setMonsterHitPulses((prev) => ({ ...prev, [slot]: (prev[slot] ?? 0) + 1 }));
            setPlayerAttackingSlot(slot);
            const animDur = ATTACK_ANIM_DURATION[character?.class ?? ''] ?? 350;
            setTimeout(() => {
                setPlayerAttackingSlot((cur) => (cur === slot ? null : cur));
            }, animDur);

            if (hand) {
                showFloatingDmg(`:dagger: -${finalDmg}`, 'player', hand);
            } else {
                showFloatingDmg(`-${finalDmg}`, 'player');
            }
            fx.pushEnemyFloat(slot, finalDmg, 'basic', { icon: hand ? 'dagger' : undefined });

            const handPrefix = hand === 'left' ? '[Lewa] ' : hand === 'right' ? '[Prawa] ' : '';
            addLog(
                `${handPrefix}Atakujesz ${slotData.monster.name_pl} za ${finalDmg} dmg (HP: ${newMHp}/${slotData.maxHp})`,
                'player',
            );
            if (newMHp <= 0) {
                handleWaveMonsterDeath(slot);
            }
            return finalDmg;
        };

        if (isDualWield) {
            doSingleHit('left', rollWeaponDamage, 0.6);
            setTimeout(() => {
                if (phaseRef.current !== 'running') return;
                if (getFirstAliveSlot() < 0) return;
                doSingleHit('right', rollOffHandDamage, 0.6);
            }, 150);
        } else {
            const slot = getFirstAliveSlot();
            const slotData = currentMonstersRef.current[slot];
            if (slot >= 0 && slotData) {
                const baseDmg = mitigateDamage(charAtk, slotData.monster.defense, character?.level ?? 1, true);
                const variance = Math.floor(baseDmg * 0.2);
                const rolledDmg = Math.max(1, baseDmg - variance + Math.floor(Math.random() * (variance * 2 + 1)));
                const finalDmg = Math.max(1, Math.floor(rolledDmg * getAtkDamageMultiplier() * getTransformDmgMultiplier()));
                const newMHp = applyDamageToSlot(slot, finalDmg);

                setMonsterHitPulses((prev) => ({ ...prev, [slot]: (prev[slot] ?? 0) + 1 }));
                setPlayerAttackingSlot(slot);
                const animDur = ATTACK_ANIM_DURATION[character?.class ?? ''] ?? 350;
                setTimeout(() => {
                    setPlayerAttackingSlot((cur) => (cur === slot ? null : cur));
                }, animDur);
                showFloatingDmg(`-${finalDmg}`, 'player');
                fx.pushEnemyFloat(slot, finalDmg, 'basic');
                addLog(
                    `Atakujesz ${slotData.monster.name_pl} za ${finalDmg} dmg (HP: ${newMHp}/${slotData.maxHp})`,
                    'player',
                );
                if (newMHp <= 0) {
                    handleWaveMonsterDeath(slot);
                }
            }
        }

        if (character) {
            useSkillStore.getState().addWeaponSkillXpFromAttack(character.class);
            useSkillStore.getState().addMlvlXpFromAttack(character.class);
        }

        if (character?.class === 'Necromancer') {
            const summonBonus = useNecroSummonStore.getState().totalAttackBonus(PLAYER_FX_ID, charAtk);
            const tgt = getFirstAliveSlot();
            if (summonBonus > 0 && tgt >= 0) {
                const slotMon = currentMonstersRef.current[tgt];
                if (slotMon && slotMon.currentHp > 0) {
                    let dmg = mitigateDamage(summonBonus, Math.floor(slotMon.monster.defense * 0.5), character?.level ?? 1, true);
                    const monStSum = ensureStatus(effectsRef.current, monsterFxId(currentWaveRef.current, tgt));
                    const ampSum = consumeTargetMarkAmp(monStSum);
                    if (ampSum.mult !== 1) {
                        dmg = Math.max(1, Math.floor(dmg * ampSum.mult));
                    }
                    const newMHp = applyDamageToSlot(tgt, dmg);
                    fx.pushEnemyFloat(tgt, dmg, 'basic', { icon: 'skull' });
                    addLog(`:skull: Summony zadają ${dmg} dmg`, 'player');
                    if (newMHp <= 0) handleWaveMonsterDeath(tgt);
                }
            }
        }

        if (getFirstAliveSlot() >= 0 && useSettingsStore.getState().skillMode === 'auto') {
            const now = Date.now();
            const slots = useSkillStore.getState().activeSkillSlots;
            for (let i = 0; i < 4; i++) {
                const skillId = slots[i];
                if (!skillId) continue;
                const lastUsed = skillCooldownRef.current.get(skillId) ?? 0;
                if (now - lastUsed < getSpeedScaledCooldownMs(resolveSkillRecastMs(skillId, SKILL_COOLDOWN_MS), speedMult)) continue;
                if (playerMpRef.current < SKILL_MP_COST) continue;
                const tgt = getFirstAliveSlot();
                if (tgt < 0) break;
                const wave = currentWaveRef.current;
                const tgtFxId = monsterFxId(wave, tgt);
                const aliveEnemyIds = currentMonstersRef.current
                    .map((m, idx) => (m.currentHp > 0 ? monsterFxId(wave, idx) : null))
                    .filter((id): id is string => id !== null);
                const tgtSlotData = currentMonstersRef.current[tgt];
                const tgtMaxHp = tgtSlotData?.maxHp ?? 1;
                const tgtHpPct = tgtMaxHp > 0
                    ? (tgtSlotData!.currentHp / tgtMaxHp) * 100
                    : 100;
                const sDef = getSkillDef(skillId);
                if ((sDef?.effect ?? '').includes('death_apocalypse')) {
                    const hpPct = playerHpRef.current / Math.max(1, charMaxHp);
                    if (hpPct < 0.05) continue;
                    let newPlayerHp: number;
                    if (hpPct > 0.20) {
                        newPlayerHp = Math.max(1, playerHpRef.current - Math.floor(charMaxHp * 0.20));
                    } else {
                        newPlayerHp = Math.max(1, Math.floor(charMaxHp * 0.03));
                    }
                    const lost = playerHpRef.current - newPlayerHp;
                    if (lost > 0) {
                        playerHpRef.current = newPlayerHp;
                        setPlayerHp(newPlayerHp);
                        useCharacterStore.getState().updateCharacter({ hp: newPlayerHp });
                        fx.pushAllyFloat(0, lost, 'spell', { icon: 'broken-heart', label: `-${lost} HP` });
                        addLog(`:broken-heart: Apokalipsa: -${lost} HP`, 'system');
                    }
                }
                const apply = effectsCastSkill({
                    session: effectsRef.current,
                    casterId: PLAYER_FX_ID,
                    targetId: tgtFxId,
                    targetHpPct: tgtHpPct,
                    effect: sDef?.effect ?? null,
                    allyIds: [PLAYER_FX_ID],
                    enemyIds: aliveEnemyIds,
                });
                const skillBaseMult = sDef?.damage ?? 0;
                const isDamageHitAuto = skillBaseMult > 0;
                const targetsEnemyAuto = isDamageHitAuto || skillTargetsEnemy(sDef?.effect ?? null);
                const defPenFracAuto = Math.max(0, Math.min(1, (apply.defPenPct ?? 0) / 100));
                const baseDmg = isDamageHitAuto ? Math.max(1, Math.floor(charAtk * rollSkillDamageMult(skillBaseMult, useSkillStore.getState().skillUpgradeLevels[skillId] ?? 0) * getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier() * (1 + defPenFracAuto))) : 0;
                const normalSkillDmgAuto = Math.floor(baseDmg * apply.castDmgMult);
                let skillDmg = isDamageHitAuto
                    ? (apply.instantKill
                        ? Math.max(1, tgtSlotData?.currentHp ?? 1)
                        : ((apply.executeBurstPct ?? 0) > 0
                            ? Math.max(normalSkillDmgAuto, Math.floor(tgtMaxHp * (apply.executeBurstPct ?? 0) / 100))
                            : normalSkillDmgAuto))
                    : 0;
                if (isDamageHitAuto && skillDmg > 0) {
                    const tgtStAuto = ensureStatus(effectsRef.current, tgtFxId);
                    const ampAuto = consumeTargetMarkAmp(tgtStAuto);
                    if (ampAuto.mult !== 1) {
                        skillDmg = Math.max(1, Math.floor(skillDmg * ampAuto.mult));
                    }
                }
                const afterSkill = isDamageHitAuto ? applyDamageToSlot(tgt, skillDmg) : -1;
                const newMp = Math.max(0, playerMpRef.current - SKILL_MP_COST);
                playerMpRef.current = newMp;
                setPlayerMp(newMp);
                skillCooldownRef.current.set(skillId, now);
                setSkillCooldowns((prev) => ({ ...prev, [skillId]: resolveSkillRecastMs(skillId, SKILL_COOLDOWN_MS) }));
                { const sd2 = getSkillDef(skillId); if (sd2) applySkillBuff(skillId, sd2, speedMult); }
                triggerSkillAnim(skillId);
                if (!targetsEnemyAuto) {
                    fx.triggerAllySkillAnim(0, skillId);
                    addLog(`:sparkles: ${formatSkillName(skillId)}: BUFF (-${SKILL_MP_COST} MP)`, 'player');
                } else {
                    if (isDamageHitAuto) {
                        fx.pushEnemyFloat(tgt, skillDmg, 'spell', { icon: getSkillIcon(skillId) });
                        addLog(`:sparkles: ${formatSkillName(skillId)}: ${skillDmg} dmg (-${SKILL_MP_COST} MP)`, 'player');
                        if (afterSkill <= 0) { handleWaveMonsterDeath(tgt); }
                    } else {
                        addLog(`:sparkles: ${formatSkillName(skillId)}: DEBUFF (-${SKILL_MP_COST} MP)`, 'player');
                    }
                    if (apply.aoe) {
                        for (const idx of apply.aoeStunIdxs ?? []) {
                            fx.pushEnemyFloat(idx, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
                        }
                        for (const idx of apply.aoeParalyzeIdxs ?? []) {
                            fx.pushEnemyFloat(idx, 0, 'spell', { icon: 'locked', label: 'PARAL' });
                        }
                    } else if (apply.stunApplied) {
                        fx.pushEnemyFloat(tgt, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
                    } else if (apply.paralyzeApplied) {
                        fx.pushEnemyFloat(tgt, 0, 'spell', { icon: 'locked', label: 'PARAL' });
                    }
                }
                if (isDamageHitAuto && (apply.multistrike ?? 0) > 0) {
                    const extra = Math.max(0, Math.floor(apply.multistrike));
                    for (let n = 0; n < extra; n++) {
                        window.setTimeout(() => {
                            if (phaseRef.current !== 'running') return;
                            const slot = currentMonstersRef.current[tgt];
                            if (!slot || slot.currentHp <= 0) return;
                            const wRoll = rollWeaponDamage();
                            const followup = Math.max(1, Math.floor(mitigateDamage(charAtk + wRoll, Math.max(0, slot.monster.defense * (1 - defPenFracAuto)), character?.level ?? 1, true) * getAtkDamageMultiplier() * getTransformDmgMultiplier()));
                            const after = applyDamageToSlot(tgt, followup);
                            fx.pushEnemyFloat(tgt, followup, 'basic');
                            addLog(`:bow-and-arrow:×${n + 2} ${followup} dmg`, 'player');
                            if (after <= 0) handleWaveMonsterDeath(tgt);
                        }, 120 * (n + 1));
                    }
                }
                let totalDmgAuto = isDamageHitAuto ? skillDmg : 0;
                if (isDamageHitAuto && apply.aoe) {
                    const splashDmgAuto = Math.max(1, Math.floor(skillDmg * 0.75));
                    const splashIkPctAuto = apply.instantKillPct ?? 0;
                    for (let j = 0; j < currentMonstersRef.current.length; j++) {
                        if (j === tgt) continue;
                        const slotMon = currentMonstersRef.current[j];
                        if (!slotMon || slotMon.currentHp <= 0) continue;
                        const splashIk = splashIkPctAuto > 0 && Math.random() * 100 < splashIkPctAuto;
                        let splashApplied = splashIk
                            ? Math.max(splashDmgAuto, Math.floor(slotMon.maxHp * 12 / 100))
                            : splashDmgAuto;
                        if (!splashIk) {
                            const splashStAuto = ensureStatus(effectsRef.current, monsterFxId(currentWaveRef.current, j));
                            const ampSplashAuto = consumeTargetMarkAmp(splashStAuto);
                            if (ampSplashAuto.mult !== 1) {
                                splashApplied = Math.max(1, Math.floor(splashApplied * ampSplashAuto.mult));
                            }
                        }
                        const splashAfter = applyDamageToSlot(j, splashApplied);
                        totalDmgAuto += splashApplied;
                        if (splashIk) {
                            fx.pushEnemyFloat(j, splashApplied, 'spell', { icon: 'skull', label: 'DEATH ATTACK', isCrit: true });
                        } else {
                            fx.pushEnemyFloat(j, splashApplied, 'spell', { icon: getSkillIcon(skillId) });
                        }
                        if (splashAfter <= 0) {
                            handleWaveMonsterDeath(j);
                        }
                    }
                }
                if (apply.healCasterPctOfDmg > 0 && totalDmgAuto > 0) {
                    const heal = Math.floor(totalDmgAuto * (apply.healCasterPctOfDmg / 100));
                    if (heal > 0) {
                        const before = playerHpRef.current;
                        playerHpRef.current = Math.min(charMaxHp, before + heal);
                        setPlayerHp(playerHpRef.current);
                        const actual = playerHpRef.current - before;
                        const cappedTag = actual < heal ? ' (MAX)' : '';
                        fx.pushAllyFloat(0, heal, 'heal', { icon: 'sparkles', label: `+${heal}${cappedTag}` });
                        addLog(`:sparkles: ${formatSkillName(skillId)}: +${heal} HP${cappedTag}`, 'system');
                    }
                }
                if (apply.summons.length > 0 && character?.class === 'Necromancer') {
                    const store = useNecroSummonStore.getState();
                    for (const sm of apply.summons) {
                        {
                    const spawned = store.spawn(PLAYER_FX_ID, sm.type, sm.count, charAtk, charMaxHp);
                    if (spawned > 0) fx.triggerAllySummonSpawn(0, sm.type);
                }
                    }
                }
                if (apply.deathApocalypse && character) {
                    const tgtMon = currentMonstersRef.current[tgt];
                    if (tgtMon && tgtMon.currentHp > 0) {
                        const apocDmg = Math.max(1, Math.floor(tgtMon.maxHp * (apply.deathApocalypseTargetMaxHpPct / 100)));
                        const after = applyDamageToSlot(tgt, apocDmg);
                        fx.pushEnemyFloat(tgt, apocDmg, 'spell', { icon: 'skull-and-crossbones', label: 'APOKALIPSA', isCrit: true });
                        addLog(`:skull-and-crossbones: Apokalipsa Śmierci: ${apocDmg} dmg`, 'system');
                        if (after <= 0) handleWaveMonsterDeath(tgt);
                    }
                }
                break;
            }
        }

        tryAutoPotion();
    }, [charAtk, addLog, showFloatingDmg, handleWaveMonsterDeath, tryAutoPotion, character, getFirstAliveSlot, applyDamageToSlot, fx]);

    const doMonsterAttack = useCallback((attackerSlot: number) => {
        if (phaseRef.current !== 'running') return;
        const slotData = currentMonstersRef.current[attackerSlot];
        if (!slotData || slotData.currentHp <= 0) return;
        if (isCombatantStunned(effectsRef.current, monsterFxId(currentWaveRef.current, attackerSlot))) return;
        if (useBuffStore.getState().getBuffCharges('skill_charge_dodge_next') > 0) {
            useBuffStore.getState().consumeBuffCharge('skill_charge_dodge_next');
            addLog(`${slotData.monster.name_pl} atakuje – Krok Cienia! Unik!`, 'dodge');
            return;
        }
        if (useBuffStore.getState().getBuffCharges('skill_charge_block_next_party') > 0) {
            useBuffStore.getState().consumeBuffCharge('skill_charge_block_next_party');
            fx.pushAllyFloat(0, 0, 'heal', { icon: 'shield', label: 'BLOCK' });
            addLog(`:shield: Boska Tarcza! Blok!`, 'system');
            return;
        }
        const dngPlayerSt = ensureStatus(effectsRef.current, PLAYER_FX_ID);
        if (dngPlayerSt.dodgeBuffMs > 0 && dngPlayerSt.dodgeBuffPct > 0) {
            if (Math.random() * 100 < dngPlayerSt.dodgeBuffPct) {
                fx.pushAllyFloat(0, 0, 'heal', { icon: 'dashing-away', label: 'UNIK' });
                addLog(`:dashing-away: Bomba Dymna! Unik (${dngPlayerSt.dodgeBuffPct}%)`, 'system');
                return;
            }
        }

        const psDng = effectsRef.current.statuses.get(PLAYER_FX_ID);
        const dngDefMult = (psDng && psDng.defBuffMs > 0 && psDng.defBuffPct > 0)
            ? 1 + (psDng.defBuffPct / 100) : 1;
        const effPlayerDef = Math.floor(charDef * dngDefMult);

        if (psDng && psDng.immortalMs > 0) {
            fx.pushAllyFloat(0, 0, 'heal', { icon: 'sparkles', label: 'BLOCK' });
            addLog(`:sparkles: BLOCK! Niewrażliwość chroni przed ${slotData.monster.name_pl}`, 'block');
            return;
        }

        const mAtk = rollMonsterDamage(slotData.monster);
        const rawDmg = mitigateDamage(mAtk, effPlayerDef, slotData.monster.level);

        let hpDmg = rawDmg;
        let mpDmg = 0;
        if (psDng && psDng.manaShieldMs > 0 && rawDmg > 0) {
            const ms = Math.min(rawDmg, Math.max(0, playerMpRef.current));
            mpDmg += ms;
            hpDmg = rawDmg - ms;
            if (ms > 0) {
                const newMp = Math.max(0, playerMpRef.current - ms);
                playerMpRef.current = newMp;
                setPlayerMp(newMp);
                addLog(`:shield: Tarcza Many pochłania ${ms} MP`, 'block');
                fx.pushAllyFloat(0, ms, 'spell', { icon: 'shield' });
            }
        }
        const hasUtamoDng = useBuffStore.getState().hasBuff('utamo_vita');
        if (hasUtamoDng && playerMpRef.current > 0 && hpDmg > 0) {
            const utamoMp = Math.floor(hpDmg * 0.5);
            let actualMp = utamoMp;
            let leftover = 0;
            if (actualMp > playerMpRef.current) {
                leftover = actualMp - playerMpRef.current;
                actualMp = playerMpRef.current;
            }
            mpDmg += actualMp;
            hpDmg = hpDmg - utamoMp + leftover;
            const newMpAfterShield = Math.max(0, playerMpRef.current - actualMp);
            playerMpRef.current = newMpAfterShield;
            setPlayerMp(newMpAfterShield);
            if (newMpAfterShield <= 0) {
                useBuffStore.getState().removeBuffByEffect('utamo_vita');
                addLog(':blue-circle: Utamo Vita peka! Brak many.', 'system');
            }
        }

        if (character?.class === 'Necromancer' && hpDmg > 0) {
            const store = useNecroSummonStore.getState();
            if (store.count(PLAYER_FX_ID) > 0) {
                const r2 = store.damageFirst(PLAYER_FX_ID, hpDmg);
                hpDmg = Math.max(0, hpDmg - r2.dmgConsumed);
            }
        }

        const newPHp = Math.max(0, playerHpRef.current - hpDmg);
        playerHpRef.current = newPHp;
        setPlayerHp(newPHp);

        setPlayerHitPulse((p) => p + 1);
        showFloatingDmg(`-${rawDmg}${hasUtamoDng && mpDmg > 0 ? 'blue-circle' : ''}`, 'monster');
        fx.pushAllyFloat(0, rawDmg, 'monster');

        const utamoSuffix = hasUtamoDng && mpDmg > 0 ? ` :blue-circle: (${hpDmg} HP / ${mpDmg} MP)` : '';
        addLog(
            `${slotData.monster.name_pl} atakuje za ${rawDmg} dmg${utamoSuffix} (HP: ${newPHp}/${charMaxHp})`,
            'monster',
        );

        if (newPHp > 0) {
            tryAutoPotion();
        }

        if (newPHp <= 0) {
            handlePlayerDeath();
        }
    }, [charDef, charMaxHp, addLog, showFloatingDmg, handlePlayerDeath, tryAutoPotion, fx]);

    const playerAtkRef  = useRef(doPlayerAttack);
    const monsterAtkRef = useRef(doMonsterAttack);
    useEffect(() => { playerAtkRef.current  = doPlayerAttack; });
    useEffect(() => { monsterAtkRef.current = doMonsterAttack; });

    const waveLeadId = currentMonsters[0]?.monster.id ?? null;
    useEffect(() => {
        if (phase !== 'running' || !waveLeadId) return;
        const interval = Math.max(200, getAttackMs(charSpeed) / speedMult);
        const id = setInterval(() => playerAtkRef.current(), interval);
        return () => clearInterval(id);
    }, [phase, waveLeadId, charSpeed, speedMult]);

    const monsterSlotKey = useMemo(() => {
        return currentMonsters
            .map((m, idx) => `${idx}:${m.monster.id}:${m.monster.speed ?? 1.5}`)
            .join('|');
    }, [currentMonsters]);
    useEffect(() => {
        if (phase !== 'running') return;
        if (currentMonsters.length === 0) return;
        const ids: number[] = [];
        currentMonsters.forEach((slot, idx) => {
            const speed = slot.monster.speed ?? 1.5;
            const interval = Math.max(200, getAttackMs(speed) / speedMult);
            const id = window.setInterval(() => monsterAtkRef.current(idx), interval);
            ids.push(id);
        });
        return () => {
            ids.forEach((id) => window.clearInterval(id));
        };
    }, [phase, monsterSlotKey, speedMult]);

    useEffect(() => {
        if (phase !== 'running') return;
        const TICK_MS = 250;
        const id = setInterval(() => {
            const wave = currentWaveRef.current;
            const aliveMonsters = currentMonstersRef.current
                .map((m, idx) => (m.currentHp > 0
                    ? { id: monsterFxId(wave, idx), maxHp: m.maxHp, slot: idx }
                    : null))
                .filter((x): x is { id: string; maxHp: number; slot: number } => x !== null);
            const dotResults = effectsTickAll(
                effectsRef.current,
                [
                    { id: PLAYER_FX_ID, maxHp: charMaxHp },
                    ...aliveMonsters.map((m) => ({ id: m.id, maxHp: m.maxHp })),
                ],
                TICK_MS * speedMult,
            );
            for (const r of dotResults) {
                if (r.id === PLAYER_FX_ID && r.dotDamage > 0) {
                    const apply = effectsRouteDamage(effectsRef.current, PLAYER_FX_ID, playerHpRef.current, r.dotDamage);
                    playerHpRef.current = Math.max(0, playerHpRef.current - apply.appliedDmg);
                    setPlayerHp(playerHpRef.current);
                    if (playerHpRef.current <= 0) {
                        handlePlayerDeath();
                    }
                    continue;
                }
                const m = aliveMonsters.find((x) => x.id === r.id);
                if (!m) continue;
                const slotData = currentMonstersRef.current[m.slot];
                if (!slotData || slotData.currentHp <= 0) continue;
                if (r.dotDamage > 0) {
                    const apply = effectsRouteDamage(effectsRef.current, r.id, slotData.currentHp, r.dotDamage);
                    if (apply.appliedDmg > 0) {
                        const after = applyDamageToSlot(m.slot, apply.appliedDmg);
                        fx.pushEnemyFloat(m.slot, apply.appliedDmg, 'spell', { icon: 'skull-and-crossbones' });
                        if (after <= 0) {
                            handleWaveMonsterDeath(m.slot);
                            continue;
                        }
                    }
                }
                if (r.darkRitualTriggered && r.darkRitualDamage > 0) {
                    const fresh = currentMonstersRef.current[m.slot];
                    if (fresh && fresh.currentHp > 0) {
                        const ritualDmg = Math.min(fresh.currentHp, r.darkRitualDamage);
                        const after = applyDamageToSlot(m.slot, ritualDmg);
                        fx.pushEnemyFloat(m.slot, ritualDmg, 'spell', { icon: 'skull', label: 'RITUAL', isCrit: true });
                        if (after <= 0) {
                            handleWaveMonsterDeath(m.slot);
                        }
                    }
                }
            }
        }, 250);
        return () => clearInterval(id);
    }, [phase, speedMult, charMaxHp, monsterSlotKey, applyDamageToSlot, handlePlayerDeath, handleWaveMonsterDeath]);

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

    useEffect(() => {
        if (phase !== 'running') {
            setWaitingForSpawn(false);
            setSpawnProgress(0);
        }
    }, [phase]);

    const totalWaves = activeDungeon ? getDungeonWaves(activeDungeon) : 0;

    if (!character) return <div className="dungeon"><Spinner size="lg" /></div>;

    return (
        <div className="dungeon">
            <AnimatePresence mode="wait">

                {phase === 'list' && (() => {
                    const gateLvlForFilter = getPartyGateLevel(character.level, party?.members ?? null);
                    let visibleDungeons = allDungeons.slice();
                    if (dungeonFilterMinLevel > 0) {
                        visibleDungeons = visibleDungeons.filter(
                            (d) => getDungeonMinLevel(d) >= dungeonFilterMinLevel,
                        );
                    }
                    if (dungeonFilterAvailableOnly) {
                        visibleDungeons = visibleDungeons.filter(
                            (d) => getDungeonMinLevel(d) <= gateLvlForFilter && canEnter(d.id),
                        );
                    }
                    if (dungeonFilterSortDesc) {
                        visibleDungeons = visibleDungeons.slice().sort(
                            (a, b) => getDungeonMinLevel(b) - getDungeonMinLevel(a),
                        );
                    }

                    const anyDungeonFilterActive =
                        dungeonFilterAvailableOnly || dungeonFilterSortDesc || dungeonFilterMinLevel > 0;
                    return (
                    <motion.div key="list" className="dungeon__panel"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <section className="dungeon__hub-filters">
                            <h2 className="dungeon__hub-section-title">Filtry</h2>
                            <div className="dungeon__filter-bar">
                                <label
                                    className={`dungeon__filter-toggle${dungeonFilterAvailableOnly ? ' dungeon__filter-toggle--active' : ''}`}
                                    title="Pokaż tylko dungeony, do których masz wymagany poziom i pozostałe próby"
                                >
                                    <input
                                        type="checkbox"
                                        checked={dungeonFilterAvailableOnly}
                                        onChange={(e) => setDungeonFilterAvailableOnly(e.target.checked)}
                                    />
                                    <span className="dungeon__filter-toggle-label">Tylko dostępne</span>
                                </label>
                                <label
                                    className={`dungeon__filter-toggle${dungeonFilterSortDesc ? ' dungeon__filter-toggle--active' : ''}`}
                                    title="Sortuj od najwyższego poziomu"
                                >
                                    <input
                                        type="checkbox"
                                        checked={dungeonFilterSortDesc}
                                        onChange={(e) => setDungeonFilterSortDesc(e.target.checked)}
                                    />
                                    <span className="dungeon__filter-toggle-label">Od najwyższego poziomu</span>
                                </label>
                                <label
                                    className="dungeon__filter-input"
                                    title="Pokaż dungeony od podanego poziomu"
                                >
                                    <span className="dungeon__filter-input-label">Lvl od</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={1000}
                                        inputMode="numeric"
                                        value={dungeonFilterMinLevel || ''}
                                        placeholder="0"
                                        onChange={(e) =>
                                            setDungeonFilterMinLevel(parseInt(e.target.value, 10) || 0)
                                        }
                                    />
                                </label>
                                {anyDungeonFilterActive && (
                                    <button
                                        type="button"
                                        className="dungeon__filter-clear"
                                        onClick={() => {
                                            setDungeonFilterAvailableOnly(false);
                                            setDungeonFilterSortDesc(false);
                                            setDungeonFilterMinLevel(0);
                                        }}
                                        title="Wyczyść filtry"
                                    >
                                        <Icon name="x" /> Wyczyść
                                    </button>
                                )}
                            </div>
                        </section>

                        {visibleDungeons.length === 0 && (
                            <div className="dungeon__filters-empty">
                                Żaden dungeon nie pasuje do filtrów.
                            </div>
                        )}

                        {visibleDungeons.map((d) => {
                            const attemptsUsed = getAttemptsUsed(d.id);
                            const attemptsMax  = getAttemptsMax();
                            const noAttempts   = !canEnter(d.id);
                            const gateLevel    = getPartyGateLevel(character.level, party?.members ?? null);
                            const tooLow       = gateLevel < getDungeonMinLevel(d);
                            const blocked      = noAttempts || tooLow;

                            const dungeonLvl = getDungeonMinLevel(d);
                            const allDone = attemptsUsed >= attemptsMax;
                            const cleared = isDungeonCleared(d.id);
                            const est = estimateDungeonRewards(d, allMonsters, monstersRaw);

                            return (
                                <div
                                    key={d.id}
                                    className={`dungeon__card${blocked ? ' dungeon__card--blocked' : ''}${allDone ? ' dungeon__card--all-done' : ''}`}
                                    style={{
                                        '--card-hue': getDungeonCardHue(dungeonLvl),
                                        '--card-image': (() => {
                                            const url = getDungeonImage(d.id);
                                            return url ? `url("${url}")` : 'none';
                                        })(),
                                    } as React.CSSProperties}
                                >
                                    <span className="dungeon__corner dungeon__corner--lvl">
                                        Lvl {dungeonLvl}
                                    </span>
                                    <span className="dungeon__corner dungeon__corner--waves">
                                        {getDungeonWaves(d)} fal
                                    </span>

                                    {allDone && cleared && (
                                        <span className="dungeon__corner dungeon__corner--cleared">
                                            <GameIcon name="check-mark-button" /> Pokonany
                                        </span>
                                    )}

                                    <div className="dungeon__card-head">
                                        <h3 className="dungeon__card-name">{d.name_pl}</h3>
                                        <p className="dungeon__card-desc">{d.description_pl}</p>
                                    </div>

                                    <div className="dungeon__card-rewards">
                                        <span><GameIcon name="money-bag" /> {formatGoldShort(est.goldMin)}–{formatGoldShort(est.goldMax)}</span>
                                        <span><GameIcon name="star" /> ~{est.xp.toLocaleString('pl-PL')} XP</span>
                                    </div>

                                    <button
                                        className="dungeon__drop-btn"
                                        onClick={() => setDropModalDungeon(d.id)}
                                    >
                                        <GameIcon name="package" /> Pokaż drop table
                                    </button>

                                    <div className="dungeon__attempts">
                                        <span><GameIcon name="crossed-swords" /> {attemptsUsed}/{attemptsMax}</span>
                                        <div className="dungeon__attempts-bar">
                                            <div
                                                className={`dungeon__attempts-bar-fill${allDone ? ' dungeon__attempts-bar-fill--full' : ''}`}
                                                style={{ width: `${(attemptsUsed / attemptsMax) * 100}%` }}
                                            />
                                        </div>
                                    </div>

                                    {noAttempts && (
                                        <span className="dungeon__cooldown"><GameIcon name="cross-mark" /> Brak prób · reset o północy</span>
                                    )}
                                    {!noAttempts && tooLow && (
                                        <span className="dungeon__locked"><GameIcon name="locked" /> Wymaga Lvl {dungeonLvl}</span>
                                    )}

                                    {!blocked && (
                                        <button
                                            className="dungeon__enter-btn dungeon__enter-btn--wide"
                                            onClick={(e) => handleEnterClick(e, d)}
                                        >
                                            <GameIcon name="crossed-swords" /> Wejdź
                                        </button>
                                    )}
                                </div>
                            );
                        })}

                        {dropModalDungeon && (() => {
                            const d = allDungeons.find((x) => x.id === dropModalDungeon);
                            if (!d) return null;
                            const dungeonLvl  = getDungeonMinLevel(d);
                            const itemTiers   = getDungeonItemDropTiers();
                            const stoneDrops  = getDungeonStoneDrops(dungeonLvl);
                            const estDrop     = estimateDungeonRewards(d, allMonsters, monstersRaw);
                            const potionInfo  = getPotionDropInfo(dungeonLvl);
                            const chestInfo   = getSpellChestDropInfo(dungeonLvl);
                            return (
                                <div
                                    className="dungeon__modal-backdrop"
                                    onClick={() => setDropModalDungeon(null)}
                                >
                                    <div
                                        className="dungeon__modal"
                                        onClick={(e) => e.stopPropagation()}
                                        style={{ '--card-hue': getDungeonCardHue(dungeonLvl) } as React.CSSProperties}
                                    >
                                        <div className="dungeon__modal-header">
                                            <span className="dungeon__modal-title">
                                                {d.name_pl}
                                            </span>
                                            <button
                                                className="dungeon__modal-close"
                                                onClick={() => setDropModalDungeon(null)}
                                                aria-label="Zamknij"
                                            >
                                                <Icon name="x" />
                                            </button>
                                        </div>
                                        <div className="dungeon__modal-body">
                                            <div className="dungeon__drop-section">
                                                <div className="dungeon__drop-section-title"><GameIcon name="money-bag" /> Nagrody</div>
                                                <div className="dungeon__drop-info">Gold: {formatGoldShort(estDrop.goldMin)}–{formatGoldShort(estDrop.goldMax)}</div>
                                                <div className="dungeon__drop-info">XP: ~{estDrop.xp.toLocaleString('pl-PL')}</div>
                                                <div className="dungeon__drop-info">
                                                    Fale: {getDungeonWaves(d)} · Lvl itemów: {dungeonLvl}
                                                </div>
                                            </div>

                                            <div className="dungeon__drop-section">
                                                <div className="dungeon__drop-section-title"><TinyIcon icon={STONE_GENERIC_ICON} size="sm" /> Kamienie ulepszania</div>
                                                {stoneDrops.map((stone) => {
                                                    const stoneColor = RARITY_LABELS[stone.rarity].color;
                                                    const stoneId = `${stone.rarity}_stone`;
                                                    return (
                                                        <div key={stone.name} className="dungeon__drop-tier">
                                                            <TinyIcon icon={STONE_ICONS[stoneId] ?? STONE_GENERIC_ICON} size="sm" />
                                                            <span className="dungeon__drop-tier-name" style={{ color: stoneColor }}>{stone.name}</span>
                                                            <span className="dungeon__drop-tier-chance">{stone.chance}%</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            <div className="dungeon__drop-section">
                                                <div className="dungeon__drop-section-title"><GameIcon name="backpack" /> Przedmioty (Lvl {dungeonLvl})</div>
                                                {itemTiers.map((tier) => (
                                                    <div key={tier.key} className="dungeon__drop-tier">
                                                        <span className="dungeon__drop-dot" style={{ background: tier.color, boxShadow: `0 0 4px ${tier.color}` }} />
                                                        <span className="dungeon__drop-tier-name" style={{ color: tier.color }}>{tier.label}</span>
                                                        <span className="dungeon__drop-tier-chance">{tier.chance}%</span>
                                                    </div>
                                                ))}
                                            </div>

                                            <div className="dungeon__drop-section">
                                                <div className="dungeon__drop-section-title"><TinyIcon icon={getPotionImage(null) ?? 'test-tube'} size="sm" /> Potiony</div>
                                                <div className="dungeon__drop-tier">
                                                    <span className="dungeon__drop-dot" style={{ background: '#e57373' }} />
                                                    <span className="dungeon__drop-tier-name" style={{ color: '#e57373' }}>
                                                        <TinyIcon icon={getPotionImage('hp_potion_sm') ?? 'red-heart'} size="sm" /> {potionInfo.hpLabel} ({potionInfo.hpHeal})
                                                    </span>
                                                    <span className="dungeon__drop-tier-chance">{(potionInfo.hpChance * 100).toFixed(2)}%</span>
                                                </div>
                                                <div className="dungeon__drop-tier">
                                                    <span className="dungeon__drop-dot" style={{ background: '#64b5f6' }} />
                                                    <span className="dungeon__drop-tier-name" style={{ color: '#64b5f6' }}>
                                                        <TinyIcon icon={getPotionImage('mp_potion_sm') ?? 'droplet'} size="sm" /> {potionInfo.mpLabel} ({potionInfo.mpHeal})
                                                    </span>
                                                    <span className="dungeon__drop-tier-chance">{(potionInfo.mpChance * 100).toFixed(2)}%</span>
                                                </div>
                                                {potionInfo.mega && (
                                                    <>
                                                        <div className="dungeon__drop-tier">
                                                            <span className="dungeon__drop-dot" style={{ background: '#ff5252' }} />
                                                            <span className="dungeon__drop-tier-name" style={{ color: '#ff5252' }}>
                                                                <TinyIcon icon={getPotionImage('hp_potion_mega') ?? 'heart-on-fire'} size="sm" /> {potionInfo.mega.hpLabel} ({potionInfo.mega.hpHeal})
                                                            </span>
                                                            <span className="dungeon__drop-tier-chance">{(potionInfo.mega.chance * 100).toFixed(2)}%</span>
                                                        </div>
                                                        <div className="dungeon__drop-tier">
                                                            <span className="dungeon__drop-dot" style={{ background: '#448aff' }} />
                                                            <span className="dungeon__drop-tier-name" style={{ color: '#448aff' }}>
                                                                <TinyIcon icon={getPotionImage('mp_potion_mega') ?? 'gem-stone'} size="sm" /> {potionInfo.mega.mpLabel} ({potionInfo.mega.mpHeal})
                                                            </span>
                                                            <span className="dungeon__drop-tier-chance">{(potionInfo.mega.chance * 100).toFixed(2)}%</span>
                                                        </div>
                                                    </>
                                                )}
                                            </div>

                                            {chestInfo.levels.length > 0 && (
                                                <div className="dungeon__drop-section">
                                                    <div className="dungeon__drop-section-title"><TinyIcon icon={getSpellChestImage(1000) ?? 'package'} size="sm" /> Spell Chests (x1.5 w dungeonie)</div>
                                                    {chestInfo.levels.map((lvl) => (
                                                        <div key={lvl} className="dungeon__drop-tier">
                                                            <span className="dungeon__drop-dot" style={{ background: '#ab47bc' }} />
                                                            <span className="dungeon__drop-tier-name" style={{ color: '#ab47bc' }}>
                                                                <TinyIcon icon={getSpellChestIcon(lvl)} size="sm" /> Lvl {lvl}
                                                            </span>
                                                            <span className="dungeon__drop-tier-chance">{(chestInfo.baseChance * 150).toFixed(2)}%</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </motion.div>
                    );
                })()}

                {phase === 'running' && activeDungeon && currentMonsters.length > 0 && (() => {
                    const firstAliveIdx = currentMonsters.findIndex((m) => m.currentHp > 0);
                    const uiEnemies: Array<ICombatEnemy | null> = [null, null, null, null];
                    for (const m of currentMonsters) {
                        const rarity = m.type.toLowerCase() as TMonsterRarity;
                        const isBoss = rarity === 'boss';
                        uiEnemies[m.slot] = {
                            id: `wave-${currentWave}-slot-${m.slot}`,
                            name: m.monster.name_pl,
                            level: m.monster.level,
                            sprite: m.monster.sprite,
                            kind: isBoss ? 'boss' : 'monster',
                            currentHp: Math.max(0, m.currentHp),
                            maxHp: m.maxHp,
                            rarity,
                            isDead: m.currentHp <= 0,
                            isTargetedByPlayer: m.slot === firstAliveIdx && m.currentHp > 0,
                            hitPulse: monsterHitPulses[m.slot] ?? 0,
                            attackingClassName: playerAttackingSlot === m.slot
                                ? `attack-${character.class}`
                                : null,
                            floats: fx.enemyFloats[m.slot] ?? [],
                            statusOverlay: (() => {
                                const st = effectsRef.current.statuses.get(monsterFxId(currentWave, m.slot));
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
                        };
                    }
                    const aliveCount = currentMonsters.filter((m) => m.currentHp > 0).length;

                    const classColorFallbackMap: Record<string, string> = {
                        Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
                        Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
                    };
                    const transformColor = useTransformStore.getState().getHighestTransformColor();
                    const playerAccent =
                        transformColor?.solid
                        ?? transformColor?.gradient?.[0]
                        ?? classColorFallbackMap[character.class]
                        ?? '#e94560';

                    const playerSummonList = necroSummons[PLAYER_FX_ID] ?? [];
                    const playerSummonsByType: Partial<Record<'skeleton' | 'ghost' | 'demon' | 'lich', number>> = {};
                    for (const sm of playerSummonList) {
                        playerSummonsByType[sm.type] = (playerSummonsByType[sm.type] ?? 0) + 1;
                    }
                    const SUMMON_RANK_D = { skeleton: 0, ghost: 1, demon: 2, lich: 3 } as const;
                    const SUMMON_LABELS_D: Record<'skeleton' | 'ghost' | 'demon' | 'lich', string> = {
                        skeleton: 'Szkielet', ghost: 'Duch', demon: 'Demon', lich: 'Lisz',
                    };
                    const frontSummonD = playerSummonList.length > 0
                        ? [...playerSummonList].sort((a, b) => SUMMON_RANK_D[a.type] - SUMMON_RANK_D[b.type])[0]
                        : null;
                    const playerNameD = (character.class === 'Necromancer' && frontSummonD)
                        ? SUMMON_LABELS_D[frontSummonD.type]
                        : character.name;
                    const playerAvatarD = (character.class === 'Necromancer' && frontSummonD)
                        ? (getSummonImage(frontSummonD.type) ?? playerAvatarSrc)
                        : playerAvatarSrc;
                    const playerCurHpD = (character.class === 'Necromancer' && frontSummonD)
                        ? frontSummonD.hp
                        : Math.max(0, playerHp);
                    const playerMaxHpD = (character.class === 'Necromancer' && frontSummonD)
                        ? frontSummonD.maxHp
                        : charMaxHp;
                    const playerCurMpD = (character.class === 'Necromancer' && frontSummonD)
                        ? frontSummonD.mp
                        : Math.max(0, playerMp);
                    const playerMaxMpD = (character.class === 'Necromancer' && frontSummonD)
                        ? frontSummonD.maxMp
                        : charMaxMp;
                    const uiAllies: Array<ICombatAlly | null> = [
                        {
                            id: 'player',
                            name: playerNameD,
                            avatarUrl: playerAvatarD,
                            accentColor: playerAccent,
                            className: character.class,
                            currentHp: playerCurHpD,
                            maxHp: playerMaxHpD,
                            currentMp: playerCurMpD,
                            maxMp: playerMaxMpD,
                            isDead: playerHp <= 0,
                            isPlayer: true,
                            level: character.level,
                            summonCount: playerSummonList.length,
                            summonsByType: playerSummonsByType,
                            onSummonClick: (type) => {
                                useNecroSummonStore.getState().despawnOne(PLAYER_FX_ID, type);
                                addLog(`:dashing-away: Odesłano: ${type}`, 'system');
                            },
                            aggroCount: aliveCount,
                            hitPulse: playerHitPulse,
                            attackingClassName: null,
                            skillAnim: fx.allySkill[0] ?? null,
                            floats: fx.allyFloats[0] ?? [],
                            summonSpawn: fx.allySummonSpawn[0] ?? null,
                        },
                        null, null, null,
                    ];

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
                                cooldownProgress: cdActive ? 1 - cdRemaining / resolveSkillRecastMs(skillId, SKILL_COOLDOWN_MS) : 1,
                                cooldownRemainingMs: cdRemaining,
                                disabled: skillMode === 'auto' || noMp || cdActive,
                                onClick: () => doManualSkill(i as 0 | 1 | 2 | 3),
                            };
                        });

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
                            icon: getPotionImage(potion.id) ?? undefined,
                            count,
                            cooldownProgress: cdActive ? 1 - cd / cdMax : 1,
                            cooldownRemainingMs: cdActive ? cd : 0,
                            disabled: count === 0 || cdActive,
                            onClick: () => doUsePotion(potion.id),
                        };
                    };
                    const pctHpSlot  = buildPotion(bestPctHpPotion, 'pct-hp', pctHpCooldown, PCT_POTION_COOLDOWN_MS);
                    const pctMpSlot  = buildPotion(bestPctMpPotion, 'pct-mp', pctMpCooldown, PCT_POTION_COOLDOWN_MS);
                    const flatHpSlot = buildPotion(bestHpPotion, 'hp', hpPotionCooldown, POTION_COOLDOWN_MS);
                    const flatMpSlot = buildPotion(bestMpPotion, 'mp', mpPotionCooldown, POTION_COOLDOWN_MS);

                    const autoPotOn = autoPotionHpEnabled || autoPotionMpEnabled;
                    const toggleAutoPot = () => {
                        const next = !autoPotOn;
                        useSettingsStore.getState().setAutoPotionHpEnabled(next);
                        useSettingsStore.getState().setAutoPotionMpEnabled(next);
                    };

                    return (
                        <motion.div
                            key="running"
                            className="dungeon__panel dungeon__panel--combat"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        >
                            <CombatHudHost active={phase === 'running'} accent={playerAccent} compact>
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

                                    <div className="combat-ui__wave-banner" aria-live="polite">
                                        <span className="combat-ui__wave-banner-label">Fala</span>
                                        <span className="combat-ui__wave-banner-value">
                                            {currentWave + 1}/{totalWaves}
                                        </span>
                                    </div>

                                    <CombatArena
                                        enemies={uiEnemies}
                                        allies={uiAllies}
                                        bgVariant="default"
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
                                            onFlee: () => {
                                                leavePenaltyAppliedRef.current = true;
                                                const ch = useCharacterStore.getState().character;
                                                if (ch && ch.level > 1) {
                                                    const dungeonForLog = activeDungeonRef.current;
                                                    if (isBackendMode() && ch) {
                                                        void backendApi.logDeath(ch.id, {
                                                            source: 'dungeon',
                                                            source_name: dungeonForLog?.name_pl ?? 'Loch',
                                                            source_level: dungeonForLog?.level ?? ch.level,
                                                            result: 'fled',
                                                        });
                                                    } else {
                                                        void deathsApi.logDeath({
                                                            character_id: ch.id,
                                                            character_name: ch.name,
                                                            character_class: ch.class,
                                                            character_level: ch.level,
                                                            source: 'dungeon',
                                                            source_name: dungeonForLog?.name_pl ?? 'Loch',
                                                            source_level: dungeonForLog?.level ?? ch.level,
                                                            result: 'fled',
                                                        });
                                                    }
                                                    const fleeProt = consumeDeathProtection();
                                                    const dungeonForFlee = activeDungeonRef.current;
                                                    if (fleeProt.isProtected) {
                                                        const savedByTxt = fleeProt.consumedId === 'death_protection'
                                                            ? 'Eliksir Ochrony'
                                                            : 'Amulet of Loss';
                                                        addLog(`:shield: ${savedByTxt} uchronił Cię od jakiejkolwiek straty przy ucieczce!`, 'system');
                                                        useDeathStore.getState().triggerDeath({
                                                            kind: 'flee',
                                                            killedBy: dungeonForFlee?.name_pl ?? 'Loch',
                                                            sourceLevel: dungeonForFlee?.level ?? ch.level,
                                                            oldLevel: ch.level,
                                                            newLevel: ch.level,
                                                            levelsLost: 0,
                                                            xpPercent: 100,
                                                            skillXpLossPercent: 0,
                                                            protectionUsed: true,
                                                            source: 'flee',
                                                        });
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
                                                        const lvlTxt = pen.levelsLost > 0
                                                            ? ` · -${pen.levelsLost} lvl`
                                                            : '';
                                                        addLog(`:person-running: Uciekłeś${lvlTxt} · -${pen.skillXpLossPercent}% Skill XP`, 'system');
                                                        useDeathStore.getState().triggerDeath({
                                                            kind: 'flee',
                                                            killedBy: dungeonForFlee?.name_pl ?? 'Loch',
                                                            sourceLevel: dungeonForFlee?.level ?? ch.level,
                                                            oldLevel: ch.level,
                                                            newLevel: pen.newLevel,
                                                            levelsLost: pen.levelsLost,
                                                            xpPercent: pen.xpPercent,
                                                            skillXpLossPercent: pen.skillXpLossPercent,
                                                            protectionUsed: false,
                                                            source: 'flee',
                                                        });
                                                    }
                                                }
                                                useCombatStore.getState().clearCombatSession();
                                                useCharacterStore.getState().updateCharacter({
                                                    hp: Math.max(1, Math.min(charMaxHp, playerHpRef.current)),
                                                    mp: Math.max(0, Math.min(charMaxMp, playerMpRef.current)),
                                                });
                                                setResult({
                                                    success: false,
                                                    wavesCleared: currentWave,
                                                    playerHpLeft: playerHp,
                                                    gold: 0,
                                                    xp: 0,
                                                    items: [],
                                                });
                                                setResultKind('flee');
                                                setPhase('result');
                                            },
                                        }}
                                    />
                                </div>
                            </CombatHudHost>
                        </motion.div>
                    );
                })()}

                {phase === 'result' && result && activeDungeon && (
                    <motion.div key="result" className="dungeon__panel dungeon__panel--centered"
                        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                        <div
                            className={`dungeon__result${result.success ? ' dungeon__result--win' : ' dungeon__result--loss'}`}
                            style={{
                                '--card-hue': getDungeonCardHue(getDungeonMinLevel(activeDungeon)),
                                '--card-image': (() => {
                                    const url = getDungeonImage(activeDungeon.id);
                                    return url ? `url("${url}")` : 'none';
                                })(),
                            } as React.CSSProperties}
                        >
                            {result.success && (
                                <div className="dungeon__victory-banner">
                                    <span className="dungeon__victory-icon"><GameIcon name="trophy" /></span>
                                    <div className="dungeon__victory-name">{activeDungeon.name_pl}</div>
                                    <div className="dungeon__victory-sub">Ukończono!</div>
                                </div>
                            )}
                            {!result.success && (
                                <>
                                    <div className="dungeon__result-title"><GameIcon name="skull" /> Porażka</div>
                                    <div className="dungeon__result-dungeon">{activeDungeon.name_pl}</div>
                                </>
                            )}

                            {result.success ? (
                                <div className="dungeon__rewards">
                                    <div className="dungeon__reward-row"><span><GameIcon name="money-bag" /> Gold</span><span>+{formatGoldShort(result.gold)}</span></div>
                                    <div className="dungeon__reward-row"><span><GameIcon name="star" /> XP</span><span>+{result.xp.toLocaleString('pl-PL')}</span></div>
                                    {result.items.length > 0 ? (
                                        <div className="dungeon__drops">
                                            <div className="dungeon__drops-title">Zdobyte przedmioty ({result.items.length})</div>
                                            <div className="dungeon__drops-grid">
                                                {result.items.map((item, i) => {
                                                    const info = getItemDisplayInfo(item.itemId);
                                                    const icon = info?.icon ?? 'package';
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
                                {resultKind === 'flee' ? (
                                    <button
                                        className="dungeon__back-btn dungeon__back-btn--retreat"
                                        onClick={() => setPhase('list')}
                                    >
                                        <GameIcon name="person-running" /> Uciekaj
                                    </button>
                                ) : resultKind === 'death' ? (
                                    <button
                                        className="dungeon__back-btn dungeon__back-btn--retreat"
                                        onClick={() => setPhase('list')}
                                    >
                                        Wróć
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            className="dungeon__back-btn dungeon__back-btn--claim"
                                            onClick={() => setPhase('list')}
                                        >
                                            Odbierz
                                        </button>
                                        {activeDungeon && canEnter(activeDungeon.id) && (
                                            <button
                                                className="dungeon__back-btn dungeon__back-btn--again"
                                                onClick={() => handleStart(activeDungeon)}
                                            >
                                                <GameIcon name="crossed-swords" /> Walcz ponownie
                                            </button>
                                        )}
                                        {(() => {
                                            if (!activeDungeon) return null;
                                            if (canEnter(activeDungeon.id)) return null;
                                            const charLvl = character?.level ?? 1;
                                            const nextDng = allDungeons
                                                .filter((d) => d.level > activeDungeon.level && d.level <= charLvl && canEnter(d.id))
                                                .sort((a, b) => a.level - b.level)[0];
                                            if (!nextDng) return null;
                                            return (
                                                <button
                                                    className="dungeon__back-btn dungeon__back-btn--again"
                                                    onClick={() => handleStart(nextDng)}
                                                    title={`${nextDng.name_pl} (lvl ${nextDng.level})`}
                                                >
                                                    <GameIcon name="up-arrow" /> Walcz wyżej (lvl {nextDng.level})
                                                </button>
                                            );
                                        })()}
                                    </>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {enterAnim && (
                    <motion.div
                        key={`enter-${enterAnim.dungeonId}`}
                        className="dungeon__enter-overlay"
                        onClick={skipEntryAnimation}
                        initial={{ opacity: 1 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, transition: { duration: 0.18, ease: 'linear' } }}
                    >
                        <motion.div
                            className="dungeon__enter-image"
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
                            className="dungeon__enter-darkness"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: [0, 1, 1, 0] }}
                            transition={{
                                duration: 2.0,
                                times: [0, 0.33, 0.67, 1],
                                ease: 'easeInOut',
                            }}
                        />

                        <motion.div
                            className="dungeon__enter-skip-hint"
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

export default Dungeon;
