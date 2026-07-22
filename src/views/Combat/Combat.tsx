import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { rollWeaponDamage, formatSkillName, CLASS_MODIFIER } from '../../systems/combatViewHelpers';
import { useShallow } from 'zustand/react/shallow';
import { useNavigate } from 'react-router-dom';
import {
    calculateDamage,
    getMonsterAttackRange,
    MONSTER_STAT_MULTIPLIERS,
    resolveSkillRecastMs,
    scaleGearHp,
} from '../../systems/combat';
import {
    getEffectiveRarityChances,
    formatRarityChance,
    getSpellChestDropInfo,
    getPotionDropInfo,
} from '../../systems/lootSystem';
import { getTotalEquipmentStats, getEquippedGearLevel, getGearGapMultiplier, flattenItemsData, STONE_ICONS, type IBaseItem } from '../../systems/itemSystem';
import TinyIcon from '../../components/ui/TinyIcon/TinyIcon';
import Icon from '../../components/atoms/Icon/Icon';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import EmojiText from '../../components/atoms/Twemoji/EmojiText';
import { getTrainingBonuses, rollSkillDamageMult } from '../../systems/skillSystem';
import {
    getAtkDamageMultiplier,
    getSpellDamageMultiplier,
    getElixirHpBonus,
    getElixirMpBonus,
    getElixirDefBonus,
    getElixirAttackSpeedMultiplier,
  getCooldownReductionMs,
} from '../../systems/combatElixirs';
import { getTransformDmgMultiplier } from '../../systems/transformBonuses';
import itemsData from '../../data/items.json';
import { MonsterSprite } from '../../components/ui/Sprite/MonsterSprite';
import { useCombatStore, type IMonster } from '../../stores/combatStore';
import { useCombatHudStore } from '../../stores/combatHudStore';
import { usePartyDamageStore } from '../../stores/partyDamageStore';
import { requestPartyCombatStart, registerGoReplicator } from '../../hooks/usePartyReadyCheck';

registerGoReplicator('/combat', (payload) => {
    if (!payload) return;
    const p = payload as { monster: Parameters<typeof engineStartNewFight>[0]; waveCount?: number };
    if (!p.monster) return;
    const ch = useCharacterStore.getState().character;
    if (ch && (ch.hp ?? 0) <= 0) {
        useCharacterStore.getState().fullHealEffective();
    }
    if (typeof p.waveCount === 'number' && p.waveCount > 0) {
        useCombatStore.getState().setWavePlannedCount(p.waveCount);
    }
    engineStartNewFight(p.monster, true);
});
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useSkillStore } from '../../stores/skillStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { usePartyStore } from '../../stores/partyStore';
import { usePartyPresenceStore } from '../../stores/partyPresenceStore';
import { usePartyCombatSyncStore } from '../../stores/partyCombatSyncStore';
import { getPartyGateLevel, getPartyMaxUnlockedMonsterLevel, calculateXpMultiplier } from '../../systems/partySystem';
import { xpToNextLevel } from '../../systems/levelSystem';
import { useTaskStore } from '../../stores/taskStore';
import { useQuestStore, getActiveQuestKillProgress } from '../../stores/questStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { ELIXIRS } from '../../stores/shopStore';
import {
    startNewFight as engineStartNewFight,
    stopCombat,
    handleMonsterDeath as engineHandleMonsterDeath,
    handlePlayerDeath as engineHandlePlayerDeath,
    SPEED_ORDER,
    SPEED_MULT,
    getEffectiveChar as engineGetEffectiveChar,
    isHuntPlayerStunned as engineIsHuntPlayerStunned,
    huntApplySkillEffectV2 as engineHuntApplySkillEffectV2,
    getHuntMonsterStatusView,
    consumeHuntMonsterMarkAmp,
    getSkillMpCost,
} from '../../systems/combatEngine';
import PartyDeathChoice from '../../components/ui/PartyDeathChoice/PartyDeathChoice';
import { MAX_WAVE_MONSTERS } from '../../stores/combatStore';
import { useMasteryStore, MASTERY_KILL_THRESHOLD, MASTERY_MAX_LEVEL } from '../../stores/masteryStore';
import { useCooldownStore } from '../../stores/cooldownStore';
import { useBotStore } from '../../stores/botStore';
import {
    getBestPotion as getBestPotionUtil,
    resolveAutoPotionElixir,
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
import { getCharacterAvatar } from '../../data/classAvatars';
import { useTransformStore } from '../../stores/transformStore';
import { useNecroSummonStore } from '../../stores/necroSummonStore';
import { applySkillBuff, getSkillDef } from '../../systems/skillBuffs';
import { skillTargetsEnemy } from '../../systems/skillEffectsV2';
import { useBuffStore } from '../../stores/buffStore';
import {
    CombatHudHost,
    CombatArena,
    CombatTopControls,
    CombatSubControls,
    CombatActionBar,
    CombatPotionDock,
    HuntedTally,
    HuntExitDialog,
    type ICombatEnemy,
    type ICombatAlly,
    type ICombatSkillSlot,
    type ICombatPotionSlot,
} from '../../components/organisms/CombatUI';
import '../../components/organisms/CombatUI/CombatUI.scss';
import { useSkillAnim } from '../../hooks/useSkillAnim';
import { useCombatFx } from '../../hooks/useCombatFx';
import { useLevelUpRefill } from '../../hooks/useLevelUpRefill';
import { AUTO_FIGHT_DELAY_MS } from '../../hooks/useBackgroundCombat';
import { formatGoldShort } from '../../systems/goldFormat';
import { getPotionImage, getSpellChestImage, getSummonImage } from '../../systems/spriteAssets';
import { isBackendCombatDelegated } from '../../config/backendMode';
import { backendApi } from '../../api/backend/backendApi';
import { syncFromBackend } from '../../api/backend/syncState';
import './Combat.scss';

const HP_POTION_COOLDOWN_MS = 1000;
const MP_POTION_COOLDOWN_MS = 1000;
const SKILL_COOLDOWN_MS = 20000;


const monsters = monstersRaw as unknown as IMonster[];
const monsterById = new Map(monsters.map((m) => [m.id, m]));

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
const VARIANT_TO_STONE_ID: Record<string, string> = {
    normal: 'common_stone', strong: 'rare_stone', epic: 'epic_stone',
    legendary: 'legendary_stone', boss: 'mythic_stone',
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




interface IBackendHuntDrops {
    stones?: { type?: string; count?: number } | null;
    potions?: Array<{ potionId?: string; count?: number }>;
    items?: unknown[];
}
interface IBackendHuntResult {
    won?: boolean;
    xpGained?: number;
    goldGained?: number;
    levelsGained?: number;
    monsterRarity?: string;
    playerHp?: number;
    drops?: IBackendHuntDrops;
}
interface IBackendHuntResponse {
    result?: IBackendHuntResult;
    gold?: number;
}

const parseBackendHuntResult = (raw: unknown): IBackendHuntResult => {
    if (typeof raw !== 'object' || raw === null) return {};
    const obj = raw as IBackendHuntResponse;
    if (typeof obj.result !== 'object' || obj.result === null) return {};
    return obj.result;
};

interface IBackendHuntFeedback {
    won: boolean;
    xp: number;
    gold: number;
    levelsGained: number;
    itemDrops: number;
    monsterName: string;
    error: boolean;
}


const ALL_ITEMS: IBaseItem[] = flattenItemsData(itemsData as Parameters<typeof flattenItemsData>[0]);

const sharedSessionResetSeen = new Set<string>();

const Combat = () => {
    const navigate  = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const party     = usePartyStore((s) => s.party);
    const equipment = useInventoryStore((s) => s.equipment);
    const {
        combatSpeed, setCombatSpeed, skillMode, setSkillMode,
        showCombatXpBar, setShowCombatXpBar,
        huntFilterAvailableOnly, huntFilterTaskedOnly, huntFilterMinLevel, huntFilterSortDesc,
        setHuntFilterAvailableOnly, setHuntFilterTaskedOnly, setHuntFilterMinLevel, setHuntFilterSortDesc,
        autoPotionHpId, autoPotionMpId, autoPotionPctHpId, autoPotionPctMpId,
    } = useSettingsStore(useShallow((s) => ({ combatSpeed: s.combatSpeed, setCombatSpeed: s.setCombatSpeed, skillMode: s.skillMode, setSkillMode: s.setSkillMode, showCombatXpBar: s.showCombatXpBar, setShowCombatXpBar: s.setShowCombatXpBar, huntFilterAvailableOnly: s.huntFilterAvailableOnly, huntFilterTaskedOnly: s.huntFilterTaskedOnly, huntFilterMinLevel: s.huntFilterMinLevel, huntFilterSortDesc: s.huntFilterSortDesc, setHuntFilterAvailableOnly: s.setHuntFilterAvailableOnly, setHuntFilterTaskedOnly: s.setHuntFilterTaskedOnly, setHuntFilterMinLevel: s.setHuntFilterMinLevel, setHuntFilterSortDesc: s.setHuntFilterSortDesc, autoPotionHpId: s.autoPotionHpId, autoPotionMpId: s.autoPotionMpId, autoPotionPctHpId: s.autoPotionPctHpId, autoPotionPctMpId: s.autoPotionPctMpId })));
    const { activeSkillSlots } = useSkillStore(useShallow((s) => ({ activeSkillSlots: s.activeSkillSlots })));
    const consumables = useInventoryStore((s) => s.consumables);
    const activeTasks = useTaskStore((s) => s.activeTasks);
    const activeQuests = useQuestStore((s) => s.activeQuests);
    const completedTransforms = useTransformStore((s) => s.completedTransforms);
    const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
    const transformColor = getHighestTransformColor();
    const playerAvatarSrc = character ? getCharacterAvatar(character.class, completedTransforms) : '';
    const necroSummons = useNecroSummonStore((s) => s.summons);

    const classColorFallbackMap: Record<string, string> = {
        Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
        Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
    };
    const playerAccent = (() => {
        if (transformColor?.solid) return transformColor.solid;
        if (transformColor?.gradient?.[0]) return transformColor.gradient[0];
        return character ? (classColorFallbackMap[character.class] ?? '#e94560') : '#e94560';
    })();

    const eqStats = useMemo(
        () => getTotalEquipmentStats(equipment, ALL_ITEMS),
        [equipment],
    );
    const skillLevelsForStats = useSkillStore((s) => s.skillLevels);
    const effectiveChar = useMemo(() => {
        if (!character) return null;
        const engineEff = engineGetEffectiveChar(character);
        if (engineEff) return engineEff;
        const tb = getTrainingBonuses(skillLevelsForStats, character.class);
        return {
            ...character,
            attack: character.attack + eqStats.attack,
            defense: character.defense + eqStats.defense + tb.defense + getElixirDefBonus(),
            max_hp: character.max_hp + scaleGearHp(eqStats.hp) + tb.max_hp + getElixirHpBonus(),
            max_mp: character.max_mp + eqStats.mp + tb.max_mp + getElixirMpBonus(),
            attack_speed: (character.attack_speed + eqStats.speed * 0.01 + tb.attack_speed) * getElixirAttackSpeedMultiplier(),
            crit_chance: Math.min(0.5, character.crit_chance + eqStats.critChance * 0.01 + tb.crit_chance),
            hp_regen: (character.hp_regen ?? 0) + tb.hp_regen,
        };
    }, [character, eqStats, skillLevelsForStats, completedTransforms]);

    const {
        phase, monster,
        playerCurrentHp, playerCurrentMp,
        log,
        addLog, healPlayerHp, healPlayerMp, spendPlayerMp,
        setSelectedMonster,
    } = useCombatStore();

    const autoFight = useCombatStore((s) => s.autoFight);
    const lastCombatEvent = useCombatStore((s) => s.lastCombatEvent);
    const waveMonsters = useCombatStore((s) => s.waveMonsters);
    const activeTargetIdx = useCombatStore((s) => s.activeTargetIdx);
    const wavePlannedCount = useCombatStore((s) => s.wavePlannedCount);
    const decrementWavePlannedCount = useCombatStore((s) => s.decrementWavePlannedCount);
    const sessionXpPerHour = useCombatStore((s) => s.sessionXpPerHour);

    const partyBots = useBotStore((s) => s.bots);
    const partyPresence = usePartyPresenceStore((s) => s.byMember);
    const partyLastSpells = usePartyCombatSyncStore((s) => s.lastSpellByCaster);
    const partyLastDamage = usePartyCombatSyncStore((s) => s.lastDamageByAttacker);
    const partyLastMemberHit = usePartyCombatSyncStore((s) => s.lastMemberHit);

    const isMemberInMultiHumanParty = useMemo(() => {
        if (!party || !character) return false;
        const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
        if (otherHumans.length === 0) return false;
        return party.leaderId !== character.id;
    }, [party, character]);

    const isLeaderInMultiHumanParty = useMemo(() => {
        if (!party || !character) return false;
        const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
        if (otherHumans.length === 0) return false;
        return party.leaderId === character.id;
    }, [party, character]);

    const logContainerRef = useRef<HTMLDivElement>(null);

    const [dropModalMonsterId, setDropModalMonsterId] = useState<string | null>(null);

    const [backendHuntResult, setBackendHuntResult] = useState<IBackendHuntFeedback | null>(null);

    useEffect(() => {
        if (!backendHuntResult) return;
        const id = setTimeout(() => setBackendHuntResult(null), 6000);
        return () => clearTimeout(id);
    }, [backendHuntResult]);

    const runBackendHunt = useCallback(async (target: IMonster): Promise<void> => {
        if (!character) return;
        try {
            const raw = await backendApi.combatResolve(character.id, target.id);
            const result = parseBackendHuntResult(raw);
            await syncFromBackend(character.id);
            const items = result.drops?.items;
            setBackendHuntResult({
                won: result.won === true,
                xp: result.xpGained ?? 0,
                gold: result.goldGained ?? 0,
                levelsGained: result.levelsGained ?? 0,
                itemDrops: Array.isArray(items) ? items.length : 0,
                monsterName: target.name_pl,
                error: false,
            });
        } catch (e) {
            console.warn('[combat] backendowe polowanie nie powiodło się', e);
            setBackendHuntResult({
                won: false,
                xp: 0,
                gold: 0,
                levelsGained: 0,
                itemDrops: 0,
                monsterName: target.name_pl,
                error: true,
            });
        }
    }, [character]);

    const [exitDialogOpen, setExitDialogOpen] = useState(false);

    const [deathChoicePopup, setDeathChoicePopup] = useState(false);
    const deathChoiceShownRef = useRef(false);
    const waitingForResRef = useRef(false);

    useEffect(() => {
        if (!isLeaderInMultiHumanParty) return;
        if (phase !== 'fighting') return;
        if (playerCurrentHp > 0) return;
        if (deathChoiceShownRef.current) return;
        const aliveBots = partyBots.filter((b) => b.alive).length;
        const aliveHumans = (party?.members ?? []).filter((m) => {
            if (m.id === character?.id) return false;
            if (m.isBot) return false;
            const pres = partyPresence[m.id];
            return !pres || pres.hp > 0;
        }).length;
        const aliveAllies = aliveBots + aliveHumans;
        if (aliveAllies <= 0) {
            engineHandlePlayerDeath(true);
            return;
        }
        deathChoiceShownRef.current = true;
        setDeathChoicePopup(true);
    }, [isLeaderInMultiHumanParty, phase, playerCurrentHp, partyBots, party, character?.id, partyPresence]);

    useEffect(() => {
        if (playerCurrentHp > 0 && deathChoicePopup) {
            setDeathChoicePopup(false);
            deathChoiceShownRef.current = false;
            waitingForResRef.current = false;
        }
    }, [playerCurrentHp, deathChoicePopup]);

    const handleDeathReturnToTown = useCallback(() => {
        setDeathChoicePopup(false);
        const pty = usePartyStore.getState().party;
        const me = useCharacterStore.getState().character?.id;
        if (pty && me) {
            void (async () => {
                const isLeader = pty.leaderId === me;
                if (isLeader) {
                    const presence = usePartyPresenceStore.getState().byMember;
                    const candidate = pty.members.find((m) => {
                        if (m.id === me) return false;
                        if (m.isBot) return false;
                        const pres = presence[m.id];
                        return !pres || pres.hp > 0;
                    }) ?? pty.members.find((m) => m.id !== me && !m.isBot);
                    if (candidate) {
                        try {
                            await usePartyStore.getState().transferLeadership(candidate.id);
                        } catch { }
                    }
                }
                try {
                    await usePartyStore.getState().leaveParty(me);
                } catch { }
            })();
        }
        engineHandlePlayerDeath(true);
    }, []);

    const handleDeathWaitForRes = useCallback(() => {
        setDeathChoicePopup(false);
        waitingForResRef.current = true;
    }, []);

    const autoDeathOnVictoryRef = useRef(false);
    useEffect(() => {
        if (phase !== 'victory') return;
        if (playerCurrentHp > 0) return;
        if (autoDeathOnVictoryRef.current) return;
        autoDeathOnVictoryRef.current = true;
        handleDeathReturnToTown();
    }, [phase, playerCurrentHp, handleDeathReturnToTown]);
    useEffect(() => {
        if (phase === 'fighting') {
            autoDeathOnVictoryRef.current = false;
        }
    }, [phase]);

    useLevelUpRefill(phase === 'fighting', useCallback((maxHp, maxMp) => {
        useCombatStore.setState({
            playerCurrentHp: maxHp,
            playerCurrentMp: maxMp,
        });
    }, []));

    const damageResetDoneRef = useRef(false);
    useEffect(() => {
        if (damageResetDoneRef.current) return;
        damageResetDoneRef.current = true;
        usePartyDamageStore.getState().reset();
    }, []);

    useEffect(() => {
        if (!character || !party) return;
        const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
        if (otherHumans.length === 0) return;
        if (sharedSessionResetSeen.has(party.id)) return;
        sharedSessionResetSeen.add(party.id);
        useCombatStore.getState().resetSession();
    }, [character, party]);

    useEffect(() => {
        const ch = useCharacterStore.getState().character;
        if (!ch) return;
        if ((ch.hp ?? 0) <= 0) {
            useCharacterStore.getState().fullHealEffective();
            const eff = engineGetEffectiveChar(useCharacterStore.getState().character);
            if (eff) {
                useCombatStore.setState({
                    playerCurrentHp: eff.max_hp,
                    playerCurrentMp: eff.max_mp,
                });
            }
        }
    }, []);

    useEffect(() => {
        if (phase !== 'fighting' && phase !== 'victory') return;
        const partyState = usePartyStore.getState().party;
        const me = useCharacterStore.getState().character?.id;
        const otherHumans = partyState?.members.filter((m) => m.id !== me && !m.isBot) ?? [];
        const isMemberOnly = !!(partyState && otherHumans.length > 0 && partyState.leaderId !== me);
        if (isMemberOnly) return;
        const liveChar = useCharacterStore.getState().character;
        if (!liveChar) return;
        const eff = engineGetEffectiveChar(liveChar);
        const effMaxHp = eff?.max_hp ?? liveChar.max_hp;
        const effMaxMp = eff?.max_mp ?? liveChar.max_mp;
        const safeHp = Math.max(0, Math.min(effMaxHp, playerCurrentHp));
        const safeMp = Math.max(0, Math.min(effMaxMp, playerCurrentMp));
        if (liveChar.hp === safeHp && liveChar.mp === safeMp) return;
        useCharacterStore.getState().updateCharacter({ hp: safeHp, mp: safeMp });
    }, [playerCurrentHp, playerCurrentMp, phase]);

    const autoPotionHpEnabled = useSettingsStore((s) => s.autoPotionHpEnabled);
    const autoPotionMpEnabled = useSettingsStore((s) => s.autoPotionMpEnabled);
    const setAutoPotionHpEnabled = useSettingsStore((s) => s.setAutoPotionHpEnabled);
    const setAutoPotionMpEnabled = useSettingsStore((s) => s.setAutoPotionMpEnabled);
    const autoPotionOn = autoPotionHpEnabled || autoPotionMpEnabled;
    const toggleAutoPotion = () => {
        const next = !autoPotionOn;
        setAutoPotionHpEnabled(next);
        setAutoPotionMpEnabled(next);
    };

    const [hitMonsterIdx, setHitMonsterIdx] = useState<number | null>(null);
    const [monsterHitPulses, setMonsterHitPulses] = useState<Record<number, number>>({});
    const [playerHitPulse, setPlayerHitPulse] = useState(0);
    const [botHitPulses, setBotHitPulses] = useState<Record<string, number>>({});
    const [humanHitPulses, setHumanHitPulses] = useState<Record<string, number>>({});
    const [attackingClassName, setAttackingClassName] = useState<string | null>(null);

    const { trigger: triggerSkillAnim } = useSkillAnim();
    const fx = useCombatFx();

    const [autoFightProgress, setAutoFightProgress] = useState(0);

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
        useCooldownStore.getState().setSkillCooldown(skillId, Math.max(1000, resolveSkillRecastMs(skillId, SKILL_COOLDOWN_MS) - getCooldownReductionMs()));
    }, []);

    const ATTACK_ANIM_DURATION: Record<string, number> = {
        Knight: 350, Mage: 400, Cleric: 400, Archer: 300,
        Rogue: 250, Necromancer: 450, Bard: 400,
    };

    const triggerMonsterHit = (idx: number) => {
        setHitMonsterIdx(idx);
        setAttackingClassName(character?.class ?? null);
        setMonsterHitPulses((prev) => ({ ...prev, [idx]: (prev[idx] ?? 0) + 1 }));
        const dur = ATTACK_ANIM_DURATION[character?.class ?? ''] ?? 350;
        setTimeout(() => { setHitMonsterIdx(null); setAttackingClassName(null); }, dur);
    };

    const triggerPlayerHit = () => {
        setPlayerHitPulse((p) => p + 1);
    };

    const resetFx = fx.resetFx;
    useEffect(() => {
        if (phase === 'idle') resetFx();
    }, [phase, resetFx]);

    const lastRemoteCastTsRef = useRef<Record<string, number>>({});
    useEffect(() => {
        if (!character) return;
        const orderedHumanIds = (party?.members ?? [])
            .filter((m) => m.id !== character.id && !m.isBot)
            .map((m) => m.id);
        for (const [casterId, cast] of Object.entries(partyLastSpells)) {
            if (casterId === character.id) continue;
            const prev = lastRemoteCastTsRef.current[casterId] ?? 0;
            if (cast.sentAt <= prev) continue;
            lastRemoteCastTsRef.current[casterId] = cast.sentAt;
            const humanIdx = orderedHumanIds.indexOf(casterId);
            if (humanIdx < 0) continue;
            const allySlot = humanIdx + 1;
            if (!(cast.isDamageHit && typeof cast.targetIdx === 'number')) {
                fx.triggerAllySkillAnim(allySlot, cast.skillId);
            }
        }
    }, [partyLastSpells, party?.members, character, fx]);

    const lastDamageTsRef = useRef<Record<string, number>>({});
    useEffect(() => {
        if (!character) return;
        const partyState = usePartyStore.getState().party;
        const otherHumans = partyState?.members.filter((m) => m.id !== character.id && !m.isBot) ?? [];
        const iAmLeaderOrSolo = !partyState || otherHumans.length === 0 || partyState.leaderId === character.id;
        for (const [attackerId, ev] of Object.entries(partyLastDamage)) {
            const prev = lastDamageTsRef.current[attackerId] ?? 0;
            if (ev.sentAt <= prev) continue;
            lastDamageTsRef.current[attackerId] = ev.sentAt;
            if (attackerId === character.id && iAmLeaderOrSolo) continue;
            const isLocalAttacker = attackerId === character.id;
            const kind: 'basic' | 'ally-basic' = isLocalAttacker ? 'basic' : 'ally-basic';
            fx.pushEnemyFloat(ev.targetIdx, ev.damage, kind, { isCrit: ev.isCrit });
            setMonsterHitPulses((prev) => ({ ...prev, [ev.targetIdx]: (prev[ev.targetIdx] ?? 0) + 1 }));
            if (ev.damage > 0 && iAmLeaderOrSolo) {
                usePartyDamageStore.getState().addDamage(attackerId, ev.damage);
            }
            if (ev.damage > 0) {
                const isSelfAndLogged = isLocalAttacker && iAmLeaderOrSolo;
                if (!isSelfAndLogged) {
                    const attackerName = ev.attackerName ?? (isLocalAttacker ? (character.name ?? 'Ja') : 'Sojusznik');
                    const critTag = ev.isCrit ? ' :high-voltage:KRYTYK' : '';
                    if (isLocalAttacker) {
                        const monsterName = useCombatStore.getState().waveMonsters[ev.targetIdx]?.monster.name_pl
                            ?? useCombatStore.getState().monster?.name_pl
                            ?? '...';
                        useCombatStore.getState().addLog(
                            `Atakujesz ${monsterName} za ${ev.damage} dmg${critTag}`,
                            ev.isCrit ? 'crit' : 'player',
                        );
                    } else {
                        useCombatStore.getState().addLog(
                            `[${attackerName}] Atakuje za ${ev.damage} dmg${critTag}`,
                            ev.isCrit ? 'crit' : 'player',
                        );
                    }
                }
            }
        }
    }, [partyLastDamage, character, fx]);

    const lastMemberHitTsRef = useRef<number>(0);
    useEffect(() => {
        if (!partyLastMemberHit || !character) return;
        if (partyLastMemberHit.sentAt <= lastMemberHitTsRef.current) return;
        lastMemberHitTsRef.current = partyLastMemberHit.sentAt;
        if (partyLastMemberHit.memberId === character.id) return;
        const allHumans = (party?.members ?? []).filter((m) => !m.isBot);
        const targeted = allHumans.find((m) => m.id === partyLastMemberHit.memberId);
        if (!targeted) return;
        const remoteList = allHumans.filter((m) => m.id !== character.id);
        const fxSlot = remoteList.findIndex((m) => m.id === targeted.id) + 1;
        if (fxSlot <= 0) return;
        fx.pushAllyFloat(fxSlot, partyLastMemberHit.damage, 'monster');
        setHumanHitPulses((prev) => ({
            ...prev,
            [partyLastMemberHit.memberId]: (prev[partyLastMemberHit.memberId] ?? 0) + 1,
        }));
    }, [partyLastMemberHit, character, party?.members, fx]);

    const lastEventRef = useRef<number>(0);
    useEffect(() => {
        if (!lastCombatEvent) return;
        if (lastCombatEvent.timestamp <= lastEventRef.current) return;
        lastEventRef.current = lastCombatEvent.timestamp;

        const { type, data } = lastCombatEvent;

        if (type === 'monsterHit') {
            const idx = typeof (data as { targetIdx?: number })?.targetIdx === 'number'
                ? (data as { targetIdx: number }).targetIdx
                : useCombatStore.getState().activeTargetIdx;
            triggerMonsterHit(idx);
            const dmg = (data as { damage?: number })?.damage ?? 0;
            const isSummonHit = !!(data as { isSummon?: boolean })?.isSummon;
            if (!isSummonHit && dmg > 0) {
                const charId = useCharacterStore.getState().character?.id;
                if (charId) usePartyDamageStore.getState().addDamage(charId, dmg);
            }
            const isCrit = !!(data as { isCrit?: boolean })?.isCrit;
            const hand = (data as { hand?: 'left' | 'right' | null })?.hand ?? null;
            const isSummon = !!(data as { isSummon?: boolean })?.isSummon;
            const summonType = (data as { summonType?: 'skeleton' | 'ghost' | 'demon' | 'lich' })?.summonType;
            if (isSummon && dmg > 0) {
                const SUMMON_ICON: Record<'skeleton' | 'ghost' | 'demon' | 'lich', string> = {
                    skeleton: 'skull-and-crossbones', ghost: 'ghost', demon: 'smiling-face-with-horns', lich: 'crown',
                };
                fx.pushEnemyFloat(idx, dmg, 'ally-basic', {
                    icon: summonType ? SUMMON_ICON[summonType] : 'skull',
                });
            } else if (dmg > 0) {
                fx.pushEnemyFloat(idx, dmg, 'basic', { isCrit, icon: hand ? 'dagger' : undefined });
            }
        } else if (type === 'botMonsterHit') {
            const idx = typeof (data as { targetIdx?: number })?.targetIdx === 'number'
                ? (data as { targetIdx: number }).targetIdx
                : useCombatStore.getState().activeTargetIdx;
            const dmg = (data as { damage?: number })?.damage ?? 0;
            const isCrit = !!(data as { isCrit?: boolean })?.isCrit;
            if (dmg > 0) fx.pushEnemyFloat(idx, dmg, 'ally-basic', { isCrit });
        } else if (type === 'dotTick') {
            const idx = (data as { targetIdx?: number })?.targetIdx ?? 0;
            const dmg = (data as { damage?: number })?.damage ?? 0;
            if (dmg > 0) fx.pushEnemyFloat(idx, dmg, 'spell', { icon: 'skull-and-crossbones' });
        } else if (type === 'summonSpawn') {
            const summonType = (data as { summonType?: 'skeleton' | 'ghost' | 'demon' | 'lich' })?.summonType;
            if (summonType) fx.triggerAllySummonSpawn(0, summonType);
        } else if (type === 'darkRitualTick') {
            const idx = (data as { targetIdx?: number })?.targetIdx ?? 0;
            const dmg = (data as { damage?: number })?.damage ?? 0;
            if (dmg > 0) fx.pushEnemyFloat(idx, dmg, 'spell', { icon: 'skull', label: 'RITUAL', isCrit: true });
        } else if (type === 'skillAnim') {
            const skillId = (data as { skillId?: string })?.skillId;
            const idx = typeof (data as { targetIdx?: number })?.targetIdx === 'number'
                ? (data as { targetIdx: number }).targetIdx
                : useCombatStore.getState().activeTargetIdx;
            const dmg = (data as { damage?: number })?.damage ?? 0;
            const isCrit = !!(data as { isCrit?: boolean })?.isCrit;
            const aoeTargets = ((data as { aoeTargets?: number[] })?.aoeTargets) ?? [];
            const splashDmg = (data as { splashDamage?: number })?.splashDamage ?? dmg;
            const targetsEnemyEvt = (data as { targetsEnemy?: boolean })?.targetsEnemy ?? true;
            const stunLabelEvt = (data as { stunLabel?: string | null })?.stunLabel ?? null;
            const instantKillEvt = !!(data as { instantKill?: boolean })?.instantKill;
            const executeBurstDmgEvt = (data as { executeBurstDmg?: number })?.executeBurstDmg ?? 0;
            if (skillId) {
                if (!targetsEnemyEvt) {
                    fx.triggerAllySkillAnim(0, skillId);
                } else {
                    if (executeBurstDmgEvt > 0) {
                        fx.pushEnemyFloat(idx, executeBurstDmgEvt, 'spell', { icon: 'skull', label: 'DEATH ATTACK', isCrit: true });
                    } else if (dmg > 0) {
                        fx.pushEnemyFloat(idx, dmg, 'spell', { icon: getSkillIcon(skillId), isCrit });
                    }
                    if (stunLabelEvt) {
                        fx.pushEnemyFloat(idx, 0, 'spell', {
                            icon: stunLabelEvt === 'PARAL' ? 'locked' : 'dizzy',
                            label: stunLabelEvt,
                        });
                    }
                    if (instantKillEvt) {
                        fx.pushEnemyFloat(idx, 0, 'spell', { icon: 'skull', label: 'DEATH ATTACK', isCrit: true });
                    }
                    for (const aIdx of aoeTargets) {
                        if (splashDmg > 0) fx.pushEnemyFloat(aIdx, splashDmg, 'spell', { icon: getSkillIcon(skillId), isCrit });
                    }
                }
            }
        } else if (type === 'playerHit' || type === 'playerDodge') {
            triggerPlayerHit();
            if (type === 'playerHit') {
                const dmg = (data as { damage?: number; hpDamage?: number })?.hpDamage
                    ?? (data as { damage?: number })?.damage
                    ?? 0;
                const isCrit = !!(data as { isCrit?: boolean })?.isCrit;
                const isImmortal = !!(data as { isImmortal?: boolean })?.isImmortal;
                const isManaShield = !!(data as { isManaShield?: boolean })?.isManaShield;
                const msMpDmg = (data as { mpDamage?: number })?.mpDamage ?? 0;
                const isSpellHeal = !!(data as { isSpellHeal?: boolean })?.isSpellHeal;
                const spellHealAmount = (data as { spellHealAmount?: number })?.spellHealAmount ?? 0;
                if (isImmortal) {
                    fx.pushAllyFloat(0, 0, 'heal', { icon: 'sparkles', label: 'BLOCK' });
                } else if (isSpellHeal) {
                    const requested = (data as { spellHealRequested?: number })?.spellHealRequested ?? spellHealAmount;
                    const cappedTag = spellHealAmount < requested ? ' (MAX)' : '';
                    fx.pushAllyFloat(0, requested, 'heal', {
                        icon: 'sparkles',
                        label: cappedTag ? `+${requested}${cappedTag}` : undefined,
                    });
                } else if (isManaShield && msMpDmg > 0) {
                    fx.pushAllyFloat(0, msMpDmg, 'spell', { icon: 'shield' });
                } else if (dmg > 0) {
                    fx.pushAllyFloat(0, dmg, 'monster', { isCrit });
                }
            }
        } else if (type === 'botHit') {
            const botId = (data as { botId?: string })?.botId;
            if (botId) {
                setBotHitPulses((prev) => ({ ...prev, [botId]: (prev[botId] ?? 0) + 1 }));
                const allBots = useBotStore.getState().bots;
                const botIdx = allBots.findIndex((b) => b.id === botId);
                const dmg = (data as { damage?: number })?.damage ?? 0;
                if (botIdx >= 0 && dmg > 0) {
                    fx.pushAllyFloat(botIdx + 1, dmg, 'monster');
                }
            }
        }
    }, [lastCombatEvent]);

    useEffect(() => {
        const container = logContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, [log.length]);

    useEffect(() => {
        if (phase !== 'victory' || !autoFight || combatSpeed === 'SKIP') {
            setAutoFightProgress(0);
            return;
        }
        const startedAt = Date.now();
        let raf = 0;
        const tick = () => {
            const elapsed = Date.now() - startedAt;
            const ratio = Math.min(1, elapsed / AUTO_FIGHT_DELAY_MS);
            setAutoFightProgress(ratio);
            if (ratio < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(raf);
            setAutoFightProgress(0);
        };
    }, [phase, autoFight, combatSpeed]);

    const getClassConfig = useCallback((className: string): IClassData => {
        return classesData[className] ?? {};
    }, []);

    const doUseSkill = (slotIdx: 0 | 1 | 2 | 3) => {
        const skillId = activeSkillSlots[slotIdx];
        const s       = useCombatStore.getState();
        const char    = useCharacterStore.getState().character;
        if (!skillId || !char || s.phase !== 'fighting' || !s.monster) return;

        const skillGearGapMult = getGearGapMultiplier(getEquippedGearLevel(equipment), s.monster.level ?? 0);
        const skillAtk = char.attack * skillGearGapMult;

        const manualMpCost = getSkillMpCost(skillId);
        if (s.playerCurrentMp < manualMpCost) {
            s.addLog('Za mało MP!', 'system');
            return;
        }
        if (engineIsHuntPlayerStunned()) return;

        const classConfig = getClassConfig(char.class);
        const maxCrit = (classConfig.maxCritChance ?? 30) / 100;

        const skillDef = getSkillDef(skillId);
        const skillDmgMult = skillDef?.damage ?? 0;
        const targetsEnemy = skillDmgMult > 0 || skillTargetsEnemy(skillDef?.effect ?? null);
        const isDamageHit = skillDmgMult > 0;

        const effApply = engineHuntApplySkillEffectV2(skillId, s.activeTargetIdx);
        if (effApply === null) {
            s.addLog(':bullseye: Brak żywych potworów — spell anulowany', 'system');
            return;
        }
        const defPenFrac = Math.max(0, Math.min(1, (effApply?.defPenPct ?? 0) / 100));
        const effectiveEnemyDef = Math.max(0, Math.floor(s.monster.defense * (1 - defPenFrac)));

        const skillUpgradeLevel = useSkillStore.getState().skillUpgradeLevels[skillId] ?? 0;
        const r = calculateDamage({
            baseAtk: skillAtk, weaponAtk: rollWeaponDamage(),
            skillBonus: Math.floor(skillAtk * 0.5),
            classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
            enemyDefense: effectiveEnemyDef,
            attackerLevel: char.level, playerSource: true,
            critChance: 0.20,
            maxCritChance: maxCrit,
            damageMultiplier: isDamageHit
                ? getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier() * rollSkillDamageMult(skillDmgMult, skillUpgradeLevel)
                : 0,
        });

        if (isDamageHit) {
            const ampHunt = consumeHuntMonsterMarkAmp(s.activeTargetIdx, s.monster.id);
            if (ampHunt.mult !== 1) {
                r.finalDamage = Math.max(1, Math.floor(r.finalDamage * ampHunt.mult));
                s.addLog(`:skull-and-crossbones: Klątwa Śmierci: ${formatSkillName(skillId)} ×${ampHunt.mult} dmg`, 'system');
            }
            let totalDmgDealtThisCast = 0;
            if (effApply?.instantKill) {
                const wm = useCombatStore.getState().waveMonsters[s.activeTargetIdx];
                if (wm) {
                    useCombatStore.getState().damageWaveMonster(s.activeTargetIdx, wm.currentHp);
                    totalDmgDealtThisCast += wm.currentHp;
                }
                fx.pushEnemyFloat(s.activeTargetIdx, 0, 'spell', { icon: 'skull', label: 'DEATH ATTACK', isCrit: true });
                s.addLog(`:skull: ${formatSkillName(skillId)}: DEATH ATTACK! Natychmiastowe zabicie!`, 'crit');
            } else {
                let primaryDmg = r.finalDamage;
                if ((effApply?.executeBurstPct ?? 0) > 0) {
                    const wm = useCombatStore.getState().waveMonsters[s.activeTargetIdx];
                    const burst = Math.floor((wm?.maxHp ?? 0) * (effApply!.executeBurstPct) / 100);
                    primaryDmg = Math.max(primaryDmg, burst);
                    fx.pushEnemyFloat(s.activeTargetIdx, primaryDmg, 'spell', { icon: 'skull', label: 'DEATH ATTACK', isCrit: true });
                    s.addLog(`:skull: ${formatSkillName(skillId)}: DEATH ATTACK! ${primaryDmg} dmg!`, 'crit');
                }
                s.dealToMonster(primaryDmg);
                totalDmgDealtThisCast += primaryDmg;
                if (effApply?.aoe) {
                    const splashDmg = Math.max(1, Math.floor(primaryDmg * 0.75));
                    const splashIkPct = effApply?.instantKillPct ?? 0;
                    const wave = useCombatStore.getState().waveMonsters;
                    for (let ii = 0; ii < wave.length; ii++) {
                        if (ii === s.activeTargetIdx) continue;
                        if (wave[ii].isDead) continue;
                        const splashIk = splashIkPct > 0 && Math.random() * 100 < splashIkPct;
                        if (splashIk) {
                            const ikDmg = Math.max(splashDmg, Math.floor(wave[ii].maxHp * 12 / 100));
                            useCombatStore.getState().damageWaveMonster(ii, ikDmg);
                            totalDmgDealtThisCast += ikDmg;
                            fx.pushEnemyFloat(ii, ikDmg, 'spell', { icon: 'skull', label: 'DEATH ATTACK', isCrit: true });
                        } else {
                            let thisSplash = splashDmg;
                            const ampSplash = consumeHuntMonsterMarkAmp(ii, wave[ii].monster.id);
                            if (ampSplash.mult !== 1) {
                                thisSplash = Math.max(1, Math.floor(thisSplash * ampSplash.mult));
                            }
                            useCombatStore.getState().damageWaveMonster(ii, thisSplash);
                            totalDmgDealtThisCast += thisSplash;
                            fx.pushEnemyFloat(ii, thisSplash, 'spell', { icon: getSkillIcon(skillId), isCrit: r.isCrit });
                        }
                    }
                }
            }
            if (effApply && effApply.healCasterPctOfDmg > 0 && totalDmgDealtThisCast > 0) {
                const heal = Math.floor(totalDmgDealtThisCast * (effApply.healCasterPctOfDmg / 100));
                const beforeHp = useCombatStore.getState().playerCurrentHp;
                useCombatStore.getState().healPlayerHp(heal, char.max_hp);
                const afterHp = useCombatStore.getState().playerCurrentHp;
                const actual = afterHp - beforeHp;
                if (heal > 0) {
                    const cappedTag = actual < heal ? ' (MAX)' : '';
                    fx.pushAllyFloat(0, heal, 'heal', {
                        icon: 'sparkles',
                        label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                    });
                    s.addLog(`:sparkles: ${formatSkillName(skillId)}: +${heal} HP${cappedTag}`, 'system');
                }
            }
        }
        if (effApply && effApply.healPartyPctInstant > 0) {
            const playerHeal = Math.max(1, Math.floor(char.max_hp * (effApply.healPartyPctInstant / 100)));
            const playerHpBefore = useCombatStore.getState().playerCurrentHp;
            useCombatStore.getState().healPlayerHp(playerHeal, char.max_hp);
            const playerHpAfter = useCombatStore.getState().playerCurrentHp;
            const playerActual = playerHpAfter - playerHpBefore;
            const playerTag = playerActual < playerHeal ? ' (MAX)' : '';
            fx.pushAllyFloat(0, playerHeal, 'heal', {
                icon: 'sparkles',
                label: playerTag ? `+${playerHeal}${playerTag}` : undefined,
            });
            fx.triggerAllySkillAnim(0, skillId);
            for (let i = 0; i < partyBots.length; i++) {
                const bot = partyBots[i];
                if (!bot.alive) continue;
                const heal = Math.max(1, Math.floor(bot.maxHp * (effApply.healPartyPctInstant / 100)));
                const newHp = Math.min(bot.maxHp, bot.hp + heal);
                if (newHp !== bot.hp) useBotStore.getState().updateBotHp(bot.id, newHp);
                const tag = (newHp - bot.hp) < heal ? ' (MAX)' : '';
                fx.pushAllyFloat(i + 1, heal, 'heal', {
                    icon: 'sparkles',
                    label: tag ? `+${heal}${tag}` : undefined,
                });
                fx.triggerAllySkillAnim(i + 1, skillId);
            }
            s.addLog(`:sparkles: ${formatSkillName(skillId)}: heal_party_pct ${effApply.healPartyPctInstant}%`, 'system');
        }
        if (effApply && effApply.healLowestAllyPct > 0) {
            const allies: Array<{ slot: number; curHp: number; maxHp: number; setHp: (hp: number) => void; name: string }> = [
                {
                    slot: 0,
                    curHp: useCombatStore.getState().playerCurrentHp,
                    maxHp: char.max_hp,
                    setHp: (hp) => useCombatStore.getState().healPlayerHp(Math.max(0, hp - useCombatStore.getState().playerCurrentHp), char.max_hp),
                    name: char.name,
                },
                ...partyBots.filter((b) => b.alive).map((b, i) => ({
                    slot: i + 1,
                    curHp: b.hp,
                    maxHp: b.maxHp,
                    setHp: (hp: number) => useBotStore.getState().updateBotHp(b.id, hp),
                    name: b.name,
                })),
            ];
            let lowest = allies[0];
            let lowestRatio = lowest.curHp / Math.max(1, lowest.maxHp);
            for (let i = 1; i < allies.length; i++) {
                const ratio = allies[i].curHp / Math.max(1, allies[i].maxHp);
                if (ratio < lowestRatio) {
                    lowest = allies[i];
                    lowestRatio = ratio;
                }
            }
            const heal = Math.floor(lowest.maxHp * (effApply.healLowestAllyPct / 100));
            if (heal > 0) {
                const before = lowest.curHp;
                lowest.setHp(Math.min(lowest.maxHp, before + heal));
                const after = Math.min(lowest.maxHp, before + heal);
                const actual = after - before;
                const cappedTag = actual < heal ? ' (MAX)' : '';
                fx.pushAllyFloat(lowest.slot, heal, 'heal', {
                    icon: 'sparkles',
                    label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                });
                fx.triggerAllySkillAnim(lowest.slot, skillId);
                s.addLog(`:sparkles: ${formatSkillName(skillId)} -> ${lowest.name}: +${heal} HP${cappedTag}`, 'system');
            }
        }
        spendPlayerMp(manualMpCost);
        startSkillCooldown(skillId);
        triggerSkillAnim(skillId);
        const tgtIdx = useCombatStore.getState().activeTargetIdx;
        if (targetsEnemy) {
            if (isDamageHit) {
                fx.pushEnemyFloat(tgtIdx, r.finalDamage, 'spell', { icon: getSkillIcon(skillId), isCrit: r.isCrit });
            }
        } else {
            fx.triggerAllySkillAnim(0, skillId);
        }
        if (effApply?.aoe) {
            const stunIdxs = effApply.aoeStunIdxs ?? [];
            for (const idx of stunIdxs) {
                fx.pushEnemyFloat(idx, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
            }
            const paralIdxs = effApply.aoeParalyzeIdxs ?? [];
            for (const idx of paralIdxs) {
                fx.pushEnemyFloat(idx, 0, 'spell', { icon: 'locked', label: 'PARAL' });
            }
        } else if (effApply?.stunApplied) {
            fx.pushEnemyFloat(tgtIdx, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
        } else if (effApply?.paralyzeApplied) {
            fx.pushEnemyFloat(tgtIdx, 0, 'spell', { icon: 'locked', label: 'PARAL' });
        }
        if (effApply?.reviveDeadAllies) {
            const allBots = useBotStore.getState().bots;
            const revivedNames: string[] = [];
            for (let i = 0; i < allBots.length; i++) {
                const bot = allBots[i];
                if (!bot.alive) {
                    const reviveHp = Math.max(1, Math.floor(bot.maxHp * 0.5));
                    useBotStore.getState().updateBotHp(bot.id, reviveHp);
                    revivedNames.push(bot.name);
                    fx.pushAllyFloat(i + 1, reviveHp, 'heal', { icon: 'sparkles', label: '+REZ' });
                    fx.triggerAllySkillAnim(i + 1, skillId);
                }
            }
            if (revivedNames.length > 0) {
                s.addLog(`:sparkles: ${formatSkillName(skillId)}: wskrzeszono ${revivedNames.join(', ')}`, 'system');
            }
        }
        if ((effApply?.multistrike ?? 0) > 0) {
            const extra = Math.max(0, Math.floor(effApply!.multistrike));
            for (let n = 0; n < extra; n++) {
                window.setTimeout(() => {
                    const fresh = useCombatStore.getState();
                    if (fresh.phase !== 'fighting' || !fresh.monster) return;
                    const wm = fresh.waveMonsters[fresh.activeTargetIdx];
                    if (!wm || wm.isDead) return;
                    const followup = calculateDamage({
                        baseAtk: skillAtk, weaponAtk: rollWeaponDamage(),
                        skillBonus: Math.floor(skillAtk * 0.5),
                        classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                        enemyDefense: effectiveEnemyDef,
                        attackerLevel: char.level, playerSource: true,
                        critChance: (char.crit_chance ?? 0.05),
                        maxCritChance: maxCrit,
                        damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
                    });
                    useCombatStore.getState().damageWaveMonster(fresh.activeTargetIdx, followup.finalDamage);
                    fx.pushEnemyFloat(fresh.activeTargetIdx, followup.finalDamage, 'basic', { isCrit: followup.isCrit });
                    fresh.addLog(`:bow-and-arrow:×${n + 2} ${followup.finalDamage} dmg${followup.isCrit ? 'high-voltage' : ''}`, followup.isCrit ? 'crit' : 'player');
                }, 120 * (n + 1));
            }
        }
        if (skillDef) applySkillBuff(skillId, skillDef, SPEED_MULT[combatSpeed] ?? 1);
        if (r.finalDamage > 0) {
            useDailyQuestStore.getState().addProgress('deal_damage', r.finalDamage);
        }
        useSkillStore.getState().addMlvlXpFromSkill(char.class);
        s.addLog(
            `Używasz ${formatSkillName(skillId)}: ${r.finalDamage} dmg${r.isCrit ? ' :high-voltage:KRYTYK!' : ''} (-${manualMpCost} MP)`,
            r.isCrit ? 'crit' : 'player',
        );

        const newMHp = Math.max(0, s.monsterCurrentHp - r.finalDamage);
        if (newMHp <= 0) {
            engineHandleMonsterDeath(s.monsterRarity);
        }
    };

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

    useEffect(() => {
        const sel = useCombatStore.getState().selectedMonster;
        if (sel) {
            setSelectedMonster(null);
            engineStartNewFight(sel, true);
        }
    }, []);

    useEffect(() => {
        useBuffStore.getState().setCombatSpeedMult(SPEED_MULT[combatSpeed] ?? 1);
        return () => useBuffStore.getState().setCombatSpeedMult(1);
    }, [combatSpeed]);

    const partyHealAccumRef = useRef(0);
    useEffect(() => {
        const TICK = 250;
        const id = setInterval(() => {
            const pct = useBuffStore.getState().getPartyHealDotPctPerSec();
            if (pct <= 0) {
                partyHealAccumRef.current = 0;
                return;
            }
            if (!useCombatHudStore.getState().active) return;
            const mult = useBuffStore.getState().combatSpeedMult;
            partyHealAccumRef.current += TICK * Math.max(1, mult);
            const live = useCharacterStore.getState().character;
            if (!live) return;
            const pulseSkillId = useBuffStore.getState().getPartyHealDotSkillId();
            while (partyHealAccumRef.current >= 1000) {
                partyHealAccumRef.current -= 1000;
                const playerHeal = Math.max(1, Math.floor(live.max_hp * (pct / 100)));
                const playerHpBefore = useCombatStore.getState().playerCurrentHp;
                if (playerHpBefore < live.max_hp) {
                    useCombatStore.getState().healPlayerHp(playerHeal, live.max_hp);
                }
                const playerHpAfter = useCombatStore.getState().playerCurrentHp;
                const playerActual = playerHpAfter - playerHpBefore;
                const playerCapped = playerActual < playerHeal ? ' (MAX)' : '';
                fx.pushAllyFloat(0, playerHeal, 'heal', {
                    icon: 'green-heart',
                    label: playerCapped ? `+${playerHeal}${playerCapped}` : undefined,
                });
                if (pulseSkillId) fx.triggerAllySkillAnim(0, pulseSkillId);
                const allBots = useBotStore.getState().bots;
                for (let i = 0; i < allBots.length; i++) {
                    const bot = allBots[i];
                    if (!bot.alive) continue;
                    const heal = Math.max(1, Math.floor(bot.maxHp * (pct / 100)));
                    const newHp = Math.min(bot.maxHp, bot.hp + heal);
                    if (newHp !== bot.hp) {
                        useBotStore.getState().updateBotHp(bot.id, newHp);
                    }
                    const actual = newHp - bot.hp;
                    const cappedTag = actual < heal ? ' (MAX)' : '';
                    fx.pushAllyFloat(i + 1, heal, 'heal', {
                        icon: 'green-heart',
                        label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                    });
                    if (pulseSkillId) fx.triggerAllySkillAnim(i + 1, pulseSkillId);
                }
            }
        }, TICK);
        return () => clearInterval(id);
    }, [fx]);

    const cycleSpeed = () => {
        const partyState = usePartyStore.getState().party;
        const me = useCharacterStore.getState().character?.id;
        const otherHumans = partyState?.members.filter((m) => m.id !== me && !m.isBot) ?? [];
        if (partyState && otherHumans.length > 0 && partyState.leaderId !== me) {
            return;
        }
        const order = partyBots.length > 0
            ? SPEED_ORDER.filter((s) => s !== 'SKIP')
            : SPEED_ORDER;
        const idx = order.indexOf(combatSpeed);
        const next = order[(idx + 1) % order.length];
        setCombatSpeed(next);
    };

    const sortedMonsters = [...monsters].sort((a, b) => a.level - b.level);

    const bestHpPotion =
        resolveAutoPotionElixir(autoPotionHpId, 'hp', 'flat', consumables, character?.level ?? 1)
        ?? getBestPotionUtil(FLAT_HP_POTIONS, consumables, character?.level ?? 1);
    const bestMpPotion =
        resolveAutoPotionElixir(autoPotionMpId, 'mp', 'flat', consumables, character?.level ?? 1)
        ?? getBestPotionUtil(FLAT_MP_POTIONS, consumables, character?.level ?? 1);
    const bestPctHpPotion =
        resolveAutoPotionElixir(autoPotionPctHpId, 'hp', 'pct', consumables, character?.level ?? 1)
        ?? getBestPotionUtil(PCT_HP_POTIONS, consumables, character?.level ?? 1);
    const bestPctMpPotion =
        resolveAutoPotionElixir(autoPotionPctMpId, 'mp', 'pct', consumables, character?.level ?? 1)
        ?? getBestPotionUtil(PCT_MP_POTIONS, consumables, character?.level ?? 1);

    if (!character) return null;

    return (
        <div className="combat">

            {backendHuntResult && (
                <div
                    className="combat__backend-toast"
                    role="status"
                    onClick={() => setBackendHuntResult(null)}
                    style={{
                        position: 'fixed',
                        top: 12,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 9999,
                        maxWidth: '92%',
                        padding: '10px 16px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        color: '#fff',
                        fontSize: 14,
                        lineHeight: 1.35,
                        textAlign: 'center',
                        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
                        background: backendHuntResult.error
                            ? 'rgba(120, 30, 30, 0.95)'
                            : backendHuntResult.won
                                ? 'rgba(20, 80, 40, 0.95)'
                                : 'rgba(90, 70, 20, 0.95)',
                    }}
                >
                    {backendHuntResult.error
                        ? `Serwer: walka z ${backendHuntResult.monsterName} nie powiodła się. Spróbuj ponownie.`
                        : backendHuntResult.won
                            ? `Zwycięstwo nad ${backendHuntResult.monsterName}! +${backendHuntResult.xp} XP, +${backendHuntResult.gold} złota`
                                + (backendHuntResult.itemDrops > 0 ? `, przedmioty: ${backendHuntResult.itemDrops}` : '')
                                + (backendHuntResult.levelsGained > 0 ? `, +${backendHuntResult.levelsGained} poziom` : '')
                            : `Porażka w walce z ${backendHuntResult.monsterName}.`}
                </div>
            )}

            {phase === 'idle' && (
                <header className="combat__top page-header">
                    <div className="combat__top-row">
                        <div className="combat__top-controls">
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
                                title={skillMode === 'auto' ? 'Skille: AUTO' : 'Skille: MANUAL'}
                                aria-label={skillMode === 'auto' ? 'Skille: AUTO' : 'Skille: MANUAL'}
                            >
                                <span className="combat__mode-btn-icon" aria-hidden="true"><GameIcon name="sparkles" /></span>
                                {skillMode === 'auto' ? 'AUTO' : 'MANUAL'}
                            </button>
                            <button
                                className={`combat__toggle-btn${autoFight ? ' combat__toggle-btn--active' : ''}`}
                                onClick={() => {
                                    if (isMemberInMultiHumanParty) return;
                                    useCombatStore.getState().setAutoFight(!autoFight);
                                }}
                                disabled={isMemberInMultiHumanParty}
                                title={isMemberInMultiHumanParty
                                    ? 'Tylko lider party może zmieniać tryb walki'
                                    : (autoFight ? 'Auto-walka włączona' : 'Auto-walka wyłączona')}
                                aria-label={autoFight ? 'Walka: AUTO' : 'Walka: MANUAL'}
                            >
                                <span className="combat__mode-btn-icon" aria-hidden="true"><GameIcon name="crossed-swords" /></span>
                                {autoFight ? 'AUTO' : 'MANUAL'}
                            </button>
                            <button
                                className={`combat__xp-toggle${showCombatXpBar ? ' combat__xp-toggle--active' : ''}`}
                                onClick={() => setShowCombatXpBar(!showCombatXpBar)}
                                title={showCombatXpBar ? 'Ukryj pasek XP' : 'Pokaż pasek XP'}
                            >
                                <Icon name={showCombatXpBar ? 'eye' : 'eyeOff'} />
                            </button>
                        </div>
                    </div>

                </header>
            )}

            {phase === 'idle' && !useCombatStore.getState().selectedMonster && (() => {
                const masteriesState = useMasteryStore.getState().masteries;
                const masteryKillsState = useMasteryStore.getState().masteryKills;
                const gateLevel = getPartyGateLevel(character.level, party?.members ?? null);

                const myMaxUnlocked = (() => {
                    let max = 0;
                    for (const m of sortedMonsters) {
                        const u = getMonsterUnlockStatus(m, sortedMonsters, character.level, masteriesState);
                        if (!u.unlocked) break;
                        if (m.level > max) max = m.level;
                    }
                    return max;
                })();
                const partyMonsterCap = getPartyMaxUnlockedMonsterLevel(
                    myMaxUnlocked,
                    party?.members ?? null,
                    partyPresence,
                    character.id,
                );
                const otherHumansCount = party?.members.filter((m) => m.id !== character.id && !m.isBot).length ?? 0;
                const applyPartyCap = otherHumansCount > 0;

                const filteredMonsters = sortedMonsters.filter((m) => {
                    if (applyPartyCap && m.level > partyMonsterCap) return false;
                    if (huntFilterMinLevel > 0 && m.level < huntFilterMinLevel) return false;
                    if (huntFilterAvailableOnly) {
                        const u = getMonsterUnlockStatus(m, sortedMonsters, gateLevel, masteriesState);
                        if (!u.unlocked) return false;
                    }
                    if (huntFilterTaskedOnly) {
                        const hasT = activeTasks.some((t) => t.monsterId === m.id);
                        const hasQ = getActiveQuestKillProgress(activeQuests, m.id).length > 0;
                        if (!hasT && !hasQ) return false;
                    }
                    return true;
                });
                const visibleMonsters = huntFilterSortDesc
                    ? [...filteredMonsters].reverse()
                    : filteredMonsters;
                const anyFilterActive =
                    huntFilterAvailableOnly || huntFilterTaskedOnly || huntFilterMinLevel > 0 || huntFilterSortDesc;
                return (
                    <div className="combat__hub">

                        <section className="combat__hub-filters">
                            <h2 className="combat__hub-section-title">Filtry</h2>
                            <div className="combat__filter-bar">
                                <label
                                    className={`combat__filter-toggle${huntFilterAvailableOnly ? ' combat__filter-toggle--active' : ''}`}
                                    title="Pokaż tylko potwory, na które masz wymagany poziom i mastery"
                                >
                                    <input
                                        type="checkbox"
                                        checked={huntFilterAvailableOnly}
                                        onChange={(e) => setHuntFilterAvailableOnly(e.target.checked)}
                                    />
                                    <span className="combat__filter-toggle-label">Tylko dostępne</span>
                                </label>
                                <label
                                    className={`combat__filter-toggle${huntFilterTaskedOnly ? ' combat__filter-toggle--active' : ''}`}
                                    title="Pokaż tylko potwory powiązane z aktywnym taskiem lub questem"
                                >
                                    <input
                                        type="checkbox"
                                        checked={huntFilterTaskedOnly}
                                        onChange={(e) => setHuntFilterTaskedOnly(e.target.checked)}
                                    />
                                    <span className="combat__filter-toggle-label">Tylko z taskiem / questem</span>
                                </label>
                                <label
                                    className={`combat__filter-toggle${huntFilterSortDesc ? ' combat__filter-toggle--active' : ''}`}
                                    title="Sortuj listę od najwyższego poziomu"
                                >
                                    <input
                                        type="checkbox"
                                        checked={huntFilterSortDesc}
                                        onChange={(e) => setHuntFilterSortDesc(e.target.checked)}
                                    />
                                    <span className="combat__filter-toggle-label">Od najwyższego poziomu</span>
                                </label>
                                <label
                                    className="combat__filter-input"
                                    title="Pokaż potwory na podanym poziomie i wyższe"
                                >
                                    <span className="combat__filter-input-label">Lvl od</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={1000}
                                        value={huntFilterMinLevel || ''}
                                        placeholder="0"
                                        onChange={(e) => setHuntFilterMinLevel(Number(e.target.value) || 0)}
                                    />
                                </label>
                                {anyFilterActive && (
                                    <button
                                        type="button"
                                        className="combat__filter-clear"
                                        onClick={() => {
                                            setHuntFilterAvailableOnly(false);
                                            setHuntFilterTaskedOnly(false);
                                            setHuntFilterMinLevel(0);
                                            setHuntFilterSortDesc(false);
                                        }}
                                        title="Wyczyść filtry"
                                    >
                                        <Icon name="x" /> Wyczyść
                                    </button>
                                )}
                            </div>
                        </section>

                        <section className="combat__hub-wave">
                            <h2 className="combat__hub-section-title">Ilość przeciwników</h2>
                            <div className="combat__wave-box" title="Ilość potworów w następnej fali">
                                <button
                                    className="combat__wave-btn combat__wave-btn--remove"
                                    onClick={() => {
                                        if (isMemberInMultiHumanParty) return;
                                        useCombatStore.getState().decrementWavePlannedCount();
                                    }}
                                    disabled={wavePlannedCount <= 1 || isMemberInMultiHumanParty}
                                    title={isMemberInMultiHumanParty ? 'Tylko lider party może zmieniać falę' : 'Mniej potworów w fali'}
                                    aria-label="Mniej potworów w fali"
                                >−</button>
                                <span className="combat__wave-count" aria-live="polite">
                                    {wavePlannedCount}/{MAX_WAVE_MONSTERS}
                                </span>
                                <button
                                    className="combat__wave-btn combat__wave-add-btn"
                                    onClick={() => {
                                        if (isMemberInMultiHumanParty) return;
                                        useCombatStore.getState().incrementWavePlannedCount();
                                    }}
                                    disabled={wavePlannedCount >= MAX_WAVE_MONSTERS || isMemberInMultiHumanParty}
                                    title={isMemberInMultiHumanParty ? 'Tylko lider party może zmieniać falę' : 'Więcej potworów w fali'}
                                    aria-label="Więcej potworów w fali"
                                >+</button>
                                <span className="combat__wave-hint">
                                    {isMemberInMultiHumanParty
                                        ? 'Tylko lider party może zmieniać ilość przeciwników'
                                        : wavePlannedCount === 1
                                            ? 'Walka 1 na 1'
                                            : 'Tyle potworów pojawi się na start każdej walki'}
                                </span>
                            </div>
                        </section>

                        <section className="combat__hub-monsters">
                            <h2 className="combat__hub-section-title">Przeciwnicy</h2>
                            {visibleMonsters.length === 0 ? (
                                <div className="combat__hub-empty">
                                    Żaden potwór nie pasuje do wybranych filtrów.
                                </div>
                            ) : (
                                <div className="combat__mcard-grid">
                                {visibleMonsters.map((m) => {
                                    const unlock = getMonsterUnlockStatus(m, sortedMonsters, gateLevel, masteriesState);
                                    const locked = !unlock.unlocked;
                                    const monsterTask = activeTasks.find((t) => t.monsterId === m.id);
                                    const hasTask = !!monsterTask;
                                    const questBadges = getActiveQuestKillProgress(activeQuests, m.id);
                                    const hasQuest = questBadges.length > 0;
                                    const masteryLvl = masteriesState[m.id]?.level ?? 0;
                                    const isMaxMasteryHere = masteryLvl >= MASTERY_MAX_LEVEL;
                                    const range = getMonsterAttackRange(m);
                                    const masteryPct = masteryLvl * 2;
                                    const xpBonus = Math.floor(m.xp * (masteryPct / 100));
                                    const goldBonusMin = Math.floor(m.gold[0] * (masteryPct / 100));
                                    const goldBonusMax = Math.floor(m.gold[1] * (masteryPct / 100));
                                    const masteryTooltip = masteryLvl > 0
                                        ? `+${masteryPct}% XP & Gold za Mastery ${masteryLvl}/${MASTERY_MAX_LEVEL}`
                                        : '';
                                    const cardClass = [
                                        'combat__mcard',
                                        locked && 'combat__mcard--locked',
                                        !locked && (hasTask || hasQuest) && 'combat__mcard--task',
                                        !locked && isMaxMasteryHere && 'combat__mcard--mastery-max',
                                    ].filter(Boolean).join(' ');
                                    return (
                                        <article key={m.id} className={cardClass}>
                                            <div className="combat__mcard-head">
                                                <span className="combat__mcard-sprite" aria-hidden="true">
                                                    {locked
                                                        ? <GameIcon name="locked" />
                                                        : <MonsterSprite level={m.level} sprite={m.sprite} name={m.name_pl} style={{ objectFit: 'contain' }} />}
                                                </span>
                                                <span className="combat__mcard-name">{m.name_pl}</span>
                                                <div className="combat__mcard-chips">
                                                    <span className="combat__mcard-level" title={`Poziom potwora: ${m.level}`}>
                                                        Lvl {m.level}
                                                    </span>
                                                    <span
                                                        className={`combat__mcard-mastery${isMaxMasteryHere ? ' combat__mcard-mastery--max' : ''}`}
                                                        title={`Mastery ${masteryLvl}/${MASTERY_MAX_LEVEL}`}
                                                    >
                                                        <span className="combat__mcard-mastery-icon" aria-hidden="true"><GameIcon name="military-medal" /></span>
                                                        {masteryLvl}/{MASTERY_MAX_LEVEL}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="combat__mcard-stats">
                                                <span className="combat__mcard-stat" title="Atak (min - max)">
                                                    <span className="combat__mcard-stat-icon" aria-hidden="true"><GameIcon name="crossed-swords" /></span>
                                                    <span className="combat__mcard-stat-label">ATK</span>
                                                    <span className="combat__mcard-stat-value">{range.min}-{range.max}</span>
                                                </span>
                                                <span className="combat__mcard-stat" title="Punkty życia">
                                                    <span className="combat__mcard-stat-icon" aria-hidden="true"><GameIcon name="red-heart" /></span>
                                                    <span className="combat__mcard-stat-label">HP</span>
                                                    <span className="combat__mcard-stat-value">{m.hp.toLocaleString('pl-PL')}</span>
                                                </span>
                                                <span className="combat__mcard-stat" title="Obrona">
                                                    <span className="combat__mcard-stat-icon" aria-hidden="true"><GameIcon name="shield" /></span>
                                                    <span className="combat__mcard-stat-label">DEF</span>
                                                    <span className="combat__mcard-stat-value">{m.defense}</span>
                                                </span>
                                                <span className="combat__mcard-stat" title="Szybkość ataku (Attack Speed)">
                                                    <span className="combat__mcard-stat-icon" aria-hidden="true"><GameIcon name="person-running" /></span>
                                                    <span className="combat__mcard-stat-label">AS</span>
                                                    <span className="combat__mcard-stat-value">{m.speed}</span>
                                                </span>
                                                {m.magical && (
                                                    <span className="combat__mcard-stat combat__mcard-stat--magical" title="Atak magiczny — omija blok i unik">
                                                        <span className="combat__mcard-stat-icon" aria-hidden="true"><GameIcon name="sparkles" /></span>
                                                        <span className="combat__mcard-stat-label">MAG</span>
                                                        <span className="combat__mcard-stat-value">tak</span>
                                                    </span>
                                                )}
                                            </div>

                                            <div className="combat__mcard-rewards">
                                                <span className="combat__mcard-reward" title="XP za zabicie">
                                                    <span className="combat__mcard-reward-icon" aria-hidden="true"><GameIcon name="sparkles" /></span>
                                                    <span className="combat__mcard-reward-label">XP</span>
                                                    <span className="combat__mcard-reward-value">
                                                        {m.xp.toLocaleString('pl-PL')}
                                                        {masteryLvl > 0 && xpBonus > 0 && (
                                                            <span className="combat__mcard-reward-bonus" title={masteryTooltip}>
                                                                {' '}+{xpBonus.toLocaleString('pl-PL')}
                                                            </span>
                                                        )}
                                                    </span>
                                                </span>
                                                <span className="combat__mcard-reward" title="Gold za zabicie">
                                                    <span className="combat__mcard-reward-icon" aria-hidden="true"><GameIcon name="money-bag" /></span>
                                                    <span className="combat__mcard-reward-label">Gold</span>
                                                    <span className="combat__mcard-reward-value">
                                                        {formatGoldShort(m.gold[0])}–{formatGoldShort(m.gold[1])}
                                                        {masteryLvl > 0 && (goldBonusMin > 0 || goldBonusMax > 0) && (
                                                            <span className="combat__mcard-reward-bonus" title={masteryTooltip}>
                                                                {' '}+{formatGoldShort(goldBonusMin)}-{formatGoldShort(goldBonusMax)}
                                                            </span>
                                                        )}
                                                    </span>
                                                </span>
                                            </div>

                                            {(hasTask || hasQuest) && (
                                                <div className="combat__mcard-goals">
                                                    {hasTask && monsterTask && (
                                                        <div
                                                            className="combat__mcard-goal combat__mcard-goal--task"
                                                            title={`Task: zabij ${monsterTask.killCount}× ${m.name_pl}`}
                                                        >
                                                            <span className="combat__mcard-goal-icon" aria-hidden="true"><GameIcon name="clipboard" /></span>
                                                            <span className="combat__mcard-goal-text">
                                                                Task {monsterTask.progress}/{monsterTask.killCount}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {questBadges.map((qb) => (
                                                        <div
                                                            key={qb.questId}
                                                            className={`combat__mcard-goal combat__mcard-goal--quest${qb.done ? ' combat__mcard-goal--done' : ''}`}
                                                            title={`Quest: ${qb.questName}`}
                                                        >
                                                            <span className="combat__mcard-goal-icon" aria-hidden="true">
                                                                {qb.done ? <GameIcon name="check-mark-button" /> : <GameIcon name="scroll" />}
                                                            </span>
                                                            <span className="combat__mcard-goal-text">
                                                                {qb.questName} {qb.progress}/{qb.count}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {locked && unlock.lockKind === 'mastery' && unlock.requiredMonster && (() => {
                                                const req = unlock.requiredMonster;
                                                const killsNow = masteryKillsState[req.id] ?? 0;
                                                return (
                                                    <div className="combat__mcard-locked-note" title={`Zdobądź Mastery 1/25 na ${req.name_pl}`}>
                                                        <GameIcon name="locked" /> {req.name_pl}: {killsNow.toLocaleString('pl-PL')}/{MASTERY_KILL_THRESHOLD.toLocaleString('pl-PL')}
                                                    </div>
                                                );
                                            })()}
                                            {locked && unlock.lockKind !== 'mastery' && (
                                                <div className="combat__mcard-locked-note"><EmojiText>{unlock.shortLabel}</EmojiText></div>
                                            )}

                                            <div className="combat__mcard-actions">
                                                <button
                                                    className="combat__mcard-action combat__mcard-action--info"
                                                    onClick={() => setDropModalMonsterId(m.id)}
                                                    disabled={locked}
                                                    title="Pokaż szczegóły dropu"
                                                    aria-label={`Drop dla ${m.name_pl}`}
                                                ><GameIcon name="package" /></button>
                                                <button
                                                    className="combat__mcard-action combat__mcard-action--fight"
                                                    onClick={async () => {
                                                        if (locked) return;
                                                        if (isBackendCombatDelegated() && character) {
                                                            await runBackendHunt(m);
                                                            return;
                                                        }
                                                        const waveCount = useCombatStore.getState().wavePlannedCount;
                                                        requestPartyCombatStart({
                                                            destination: '/combat',
                                                            label: `${m.name_pl} Lv${m.level}`,
                                                            payload: { monster: m, waveCount },
                                                            onConfirmed: () => engineStartNewFight(m),
                                                        });
                                                    }}
                                                    disabled={locked}
                                                    title={locked ? unlock.reason : 'Walcz!'}
                                                    aria-label={`Walcz z ${m.name_pl}`}
                                                ><GameIcon name="crossed-swords" /></button>
                                            </div>
                                        </article>
                                    );
                                })}
                                </div>
                            )}
                        </section>
                    </div>
                );
            })()}

            {phase === 'idle' && dropModalMonsterId && (() => {
                const m = monsterById.get(dropModalMonsterId);
                if (!m) return null;
                const masteriesState = useMasteryStore.getState().masteries;
                const mLvl = masteriesState[m.id]?.level ?? 0;
                const masteryPct = mLvl * 2;
                const isMaxMasteryHere = mLvl >= MASTERY_MAX_LEVEL;
                const masteryTooltip = mLvl > 0
                    ? `+${masteryPct}% XP & Gold za Mastery ${mLvl}/${MASTERY_MAX_LEVEL} (2% za 1 pkt masterii)`
                    : '';
                const effChances = getEffectiveRarityChances(
                    useMasteryStore.getState().getMasteryBonuses(m.id),
                );
                const potionInfo = getPotionDropInfo(m.level);
                const chestInfo = getSpellChestDropInfo(m.level, isMaxMasteryHere);
                const CHEST_TIER_LABELS: Record<string, string> = {
                    normal: 'Normal', strong: 'Strong', epic: 'Epic',
                    legendary: 'Legendary', boss: 'Boss', heroic: 'Heroic',
                };
                const CHEST_TIER_COLORS: Record<string, string> = {
                    normal: '#9e9e9e', strong: '#2196f3', epic: '#4caf50',
                    legendary: '#f44336', boss: '#ffc107', heroic: '#ab47bc',
                };
                return (
                    <div
                        className="combat__drop-modal-backdrop"
                        onClick={() => setDropModalMonsterId(null)}
                        role="presentation"
                    >
                        <div
                            className="combat__drop-modal"
                            onClick={(e) => e.stopPropagation()}
                            role="dialog"
                            aria-modal="true"
                            aria-label={`Drop dla ${m.name_pl}`}
                        >
                            <header className="combat__drop-modal-head">
                                <span className="combat__drop-modal-sprite" aria-hidden="true">
                                    <MonsterSprite level={m.level} sprite={m.sprite} name={m.name_pl} />
                                </span>
                                <div className="combat__drop-modal-name-col">
                                    <span className="combat__drop-modal-name">{m.name_pl}</span>
                                    <span className="combat__drop-modal-level">Lvl {m.level}</span>
                                </div>
                                <button
                                    className="combat__drop-modal-close"
                                    onClick={() => setDropModalMonsterId(null)}
                                    aria-label="Zamknij"
                                    title="Zamknij"
                                ><Icon name="x" /></button>
                            </header>

                            <div className="combat__drop-modal-body">
                                <div className="combat__drop-modal-summary">
                                    <span>
                                        <GameIcon name="money-bag" /> Gold: {formatGoldShort(m.gold[0])}–{formatGoldShort(m.gold[1])}
                                        {mLvl > 0 && (
                                            <span className="combat__monster-xp-bonus" title={masteryTooltip}>
                                                {' '}+{formatGoldShort(Math.floor(m.gold[0] * (masteryPct / 100)))}–{formatGoldShort(Math.floor(m.gold[1] * (masteryPct / 100)))}
                                            </span>
                                        )}
                                    </span>
                                    <span>
                                        <GameIcon name="sparkles" /> XP: {m.xp.toLocaleString('pl-PL')}
                                        {mLvl > 0 && (
                                            <span className="combat__monster-xp-bonus" title={masteryTooltip}>
                                                {' '}+{Math.floor(m.xp * (masteryPct / 100)).toLocaleString('pl-PL')}
                                            </span>
                                        )}
                                    </span>
                                </div>
                                <div className="combat__drop-modal-info">
                                    <GameIcon name="backpack" /> Losowy ekwipunek Lvl {m.level} (bronie, zbroje, akcesoria)
                                </div>

                                <div className="combat__drop-modal-variants">
                                    {COMBAT_VARIANTS.map((v) => {
                                        const bd = getCombatDropBreakdown(v.key);
                                        const stoneChance = STONE_CHANCES_MAP[v.key] ?? 0;
                                        const stoneName = STONE_NAMES_MAP[v.key] ?? 'Stone';
                                        const chanceLabel = formatRarityChance(effChances[v.key as keyof typeof effChances]);
                                        const base = getMonsterAttackRange(m);
                                        const vMin = Math.max(1, Math.floor(base.min * v.atkMult));
                                        const vMax = Math.max(vMin, Math.floor(base.max * v.atkMult));
                                        const mult = 1 + masteryPct / 100;
                                        const baseXp = Math.floor(m.xp * v.xpMult);
                                        const baseGoldMin = Math.floor(m.gold[0] * v.goldMult);
                                        const baseGoldMax = Math.floor(m.gold[1] * v.goldMult);
                                        const effXp = Math.floor(baseXp * mult);
                                        const effGoldMin = Math.floor(baseGoldMin * mult);
                                        const effGoldMax = Math.floor(baseGoldMax * mult);
                                        return (
                                            <div
                                                key={v.key}
                                                className={`combat__variant${v.key !== 'normal' ? ` combat__variant--${v.key}` : ''}`}
                                            >
                                                <span className="combat__variant-name" style={{ color: v.color }}>{v.label}</span>
                                                <span className="combat__variant-chance">{chanceLabel}</span>
                                                <span className="combat__variant-stats">
                                                    HP: {Math.floor(m.hp * v.hpMult).toLocaleString('pl-PL')} · ATK: {vMin}-{vMax} · DEF: {Math.floor(m.defense * v.defMult)}
                                                </span>
                                                <span className="combat__variant-xp">
                                                    <span className="combat__variant-xp-row"><GameIcon name="star" /> {effXp.toLocaleString('pl-PL')} XP{mLvl > 0 && (
                                                        <span className="combat__monster-xp-bonus" title={masteryTooltip}>
                                                            {' '}+{masteryPct}%
                                                        </span>
                                                    )}</span>
                                                    <span className="combat__variant-xp-row"><GameIcon name="money-bag" /> {formatGoldShort(effGoldMin)}–{formatGoldShort(effGoldMax)}</span>
                                                    <span className="combat__variant-xp-row"><GameIcon name="clipboard" /> Task: ×{v.taskKills}</span>
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
                                                        <TinyIcon icon={STONE_ICONS[VARIANT_TO_STONE_ID[v.key] ?? ''] ?? 'gem-stone'} size="sm" /> {stoneName} ({(stoneChance * 100).toFixed(0)}%)
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="combat__drops-potions">
                                    <div className="combat__drops-potions-title"><TinyIcon icon={getPotionImage(null) ?? 'test-tube'} size="sm" /> Potiony</div>
                                    <div className="combat__variant-tier">
                                        <span className="combat__tier-dot" style={{ background: '#e57373' }} />
                                        <span className="combat__tier-name" style={{ color: '#e57373' }}>
                                            <TinyIcon icon={getPotionImage('hp_potion_sm') ?? 'red-heart'} size="sm" /> {potionInfo.hpLabel} ({potionInfo.hpHeal})
                                        </span>
                                        <span className="combat__tier-chance">{(potionInfo.hpChance * 100).toFixed(2)}%</span>
                                    </div>
                                    <div className="combat__variant-tier">
                                        <span className="combat__tier-dot" style={{ background: '#64b5f6' }} />
                                        <span className="combat__tier-name" style={{ color: '#64b5f6' }}>
                                            <TinyIcon icon={getPotionImage('mp_potion_sm') ?? 'droplet'} size="sm" /> {potionInfo.mpLabel} ({potionInfo.mpHeal})
                                        </span>
                                        <span className="combat__tier-chance">{(potionInfo.mpChance * 100).toFixed(2)}%</span>
                                    </div>
                                    {potionInfo.mega && (
                                        <>
                                            <div className="combat__variant-tier">
                                                <span className="combat__tier-dot" style={{ background: '#ff7043' }} />
                                                <span className="combat__tier-name" style={{ color: '#ff7043' }}>
                                                    <TinyIcon icon={getPotionImage('hp_potion_mega') ?? 'heart-on-fire'} size="sm" /> {potionInfo.mega.hpLabel} ({potionInfo.mega.hpHeal})
                                                </span>
                                                <span className="combat__tier-chance">{(potionInfo.mega.chance * 100).toFixed(2)}%</span>
                                            </div>
                                            <div className="combat__variant-tier">
                                                <span className="combat__tier-dot" style={{ background: '#26c6da' }} />
                                                <span className="combat__tier-name" style={{ color: '#26c6da' }}>
                                                    <TinyIcon icon={getPotionImage('mp_potion_mega') ?? 'gem-stone'} size="sm" /> {potionInfo.mega.mpLabel} ({potionInfo.mega.mpHeal})
                                                </span>
                                                <span className="combat__tier-chance">{(potionInfo.mega.chance * 100).toFixed(2)}%</span>
                                            </div>
                                        </>
                                    )}
                                </div>

                                {chestInfo.levels.length > 0 && (() => {
                                    const chestLevelsLabel = chestInfo.levels.length === 1
                                        ? `Lvl ${chestInfo.levels[0]}`
                                        : `Lvl ${chestInfo.levels[0]}–${chestInfo.levels[chestInfo.levels.length - 1]}`;
                                    return (
                                        <div className="combat__drops-potions">
                                            <div className="combat__drops-potions-title" style={{ color: '#ab47bc' }}>
                                                <TinyIcon icon={getSpellChestImage(1000) ?? 'package'} size="sm" /> Spell Chest ({chestLevelsLabel})
                                            </div>
                                            {chestInfo.rates.map((r) => (
                                                <div key={r.tier} className="combat__variant-tier">
                                                    <span
                                                        className="combat__tier-dot"
                                                        style={{ background: CHEST_TIER_COLORS[r.tier] ?? '#ab47bc' }}
                                                    />
                                                    <span
                                                        className="combat__tier-name"
                                                        style={{ color: CHEST_TIER_COLORS[r.tier] ?? '#ab47bc' }}
                                                    >
                                                        {CHEST_TIER_LABELS[r.tier] ?? r.tier}
                                                    </span>
                                                    <span className="combat__tier-chance">{(r.chance * 100).toFixed(2)}%</span>
                                                </div>
                                            ))}
                                            {!isMaxMasteryHere && (
                                                <div className="combat__drop-modal-hint">
                                                    <GameIcon name="crown" /> Mastery 25/25 odblokuje tier <strong>Heroic</strong> (5%).
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {phase !== 'idle' && monster && (() => {
                const uiEnemies: Array<ICombatEnemy | null> = waveMonsters.map((w, i) => ({
                    id: `wave-${i}`,
                    name: w.monster.name_pl,
                    level: w.monster.level,
                    sprite: w.monster.sprite,
                    kind: 'monster' as const,
                    currentHp: Math.max(0, w.currentHp),
                    maxHp: w.maxHp,
                    rarity: w.rarity,
                    isDead: w.isDead,
                    isTargetedByPlayer: i === activeTargetIdx && !w.isDead,
                    hitPulse: monsterHitPulses[i] ?? 0,
                    attackingClassName:
                        hitMonsterIdx === i && attackingClassName
                            ? `attack-${attackingClassName}`
                            : null,
                    floats: fx.enemyFloats[i] ?? [],
                    statusOverlay: getHuntMonsterStatusView(i, w.monster.id),
                }));

                const partyForUi = party;
                const iAmRemoteMember = !!(
                    partyForUi && partyForUi.leaderId !== character.id &&
                    partyForUi.members.some((m) => !m.isBot && m.id !== character.id)
                );
                const myAggroKey = iAmRemoteMember ? `human_${character.id}` : 'player';
                const playerAggroCount = waveMonsters.filter(
                    (w) => !w.isDead && w.aggroTarget === myAggroKey,
                ).length;
                const playerEffMaxHp = effectiveChar?.max_hp ?? character.max_hp;
                const playerEffMaxMp = effectiveChar?.max_mp ?? character.max_mp;
                const playerSummonList = necroSummons['player'] ?? [];
                const playerSummonsByType: Partial<Record<'skeleton' | 'ghost' | 'demon' | 'lich', number>> = {};
                for (const sm of playerSummonList) {
                    playerSummonsByType[sm.type] = (playerSummonsByType[sm.type] ?? 0) + 1;
                }
                const SUMMON_RANK_C = { skeleton: 0, ghost: 1, demon: 2, lich: 3 } as const;
                const SUMMON_LABELS_C: Record<'skeleton' | 'ghost' | 'demon' | 'lich', string> = {
                    skeleton: 'Szkielet', ghost: 'Duch', demon: 'Demon', lich: 'Lisz',
                };
                const frontSummonC = playerSummonList.length > 0
                    ? [...playerSummonList].sort((a, b) => SUMMON_RANK_C[a.type] - SUMMON_RANK_C[b.type])[0]
                    : null;
                const playerNameC = (character.class === 'Necromancer' && frontSummonC)
                    ? SUMMON_LABELS_C[frontSummonC.type]
                    : character.name;
                const playerAvatarC = (character.class === 'Necromancer' && frontSummonC)
                    ? (getSummonImage(frontSummonC.type) ?? playerAvatarSrc)
                    : playerAvatarSrc;
                const playerCurHpC = (character.class === 'Necromancer' && frontSummonC)
                    ? frontSummonC.hp
                    : Math.max(0, Math.min(playerCurrentHp, playerEffMaxHp));
                const playerMaxHpC = (character.class === 'Necromancer' && frontSummonC)
                    ? frontSummonC.maxHp
                    : playerEffMaxHp;
                const playerCurMpC = (character.class === 'Necromancer' && frontSummonC)
                    ? frontSummonC.mp
                    : Math.max(0, Math.min(playerCurrentMp, playerEffMaxMp));
                const playerMaxMpC = (character.class === 'Necromancer' && frontSummonC)
                    ? frontSummonC.maxMp
                    : playerEffMaxMp;
                const humansInOrder = (party?.members ?? []).filter((m) => !m.isBot);
                const remoteHumanFxIdx = (memberId: string): number => {
                    const list = humansInOrder.filter((m) => m.id !== character.id);
                    const idx = list.findIndex((m) => m.id === memberId);
                    return idx + 1;
                };
                const localPlayerMember = humansInOrder.find((m) => m.id === character.id);
                const soloFallbackPlayer: ICombatAlly | null = localPlayerMember ? null : {
                    id: 'player',
                    name: playerNameC,
                    avatarUrl: playerAvatarC,
                    accentColor: playerAccent,
                    className: character.class,
                    currentHp: playerCurHpC,
                    maxHp: playerMaxHpC,
                    currentMp: playerCurMpC,
                    maxMp: playerMaxMpC,
                    isDead: playerCurrentHp <= 0,
                    isPlayer: true,
                    level: character.level,
                    aggroCount: playerAggroCount,
                    summonCount: playerSummonList.length,
                    summonsByType: playerSummonsByType,
                    onSummonClick: (type) => {
                        useNecroSummonStore.getState().despawnOne('player', type);
                    },
                    hitPulse: playerHitPulse,
                    attackingClassName: null,
                    skillAnim: fx.allySkill[0] ?? null,
                    floats: fx.allyFloats[0] ?? [],
                    summonSpawn: fx.allySummonSpawn[0] ?? null,
                };
                const uiAllies: Array<ICombatAlly | null> = [
                    ...(soloFallbackPlayer ? [soloFallbackPlayer] : []),
                    ...humansInOrder.map<ICombatAlly>((m) => {
                        if (m.id === character.id) {
                            return {
                                id: 'player',
                                name: playerNameC,
                                avatarUrl: playerAvatarC,
                                accentColor: playerAccent,
                                className: character.class,
                                currentHp: playerCurHpC,
                                maxHp: playerMaxHpC,
                                currentMp: playerCurMpC,
                                maxMp: playerMaxMpC,
                                isDead: playerCurrentHp <= 0,
                                isPlayer: true,
                                level: character.level,
                                aggroCount: playerAggroCount,
                                summonCount: playerSummonList.length,
                                summonsByType: playerSummonsByType,
                                onSummonClick: (type) => {
                                    useNecroSummonStore.getState().despawnOne('player', type);
                                },
                                hitPulse: playerHitPulse,
                                attackingClassName: null,
                                skillAnim: fx.allySkill[0] ?? null,
                                floats: fx.allyFloats[0] ?? [],
                                summonSpawn: fx.allySummonSpawn[0] ?? null,
                            };
                        }
                        const presence = partyPresence[m.id];
                        const tier = presence?.transformTier ?? 0;
                        const accent = classColorFallbackMap[m.class] ?? '#888';
                        const hasPresence = presence !== undefined;
                        const hpC = hasPresence ? (presence?.hp ?? 0) : 1;
                        const hpM = hasPresence ? (presence?.maxHp ?? 1) : 1;
                        const mpC = hasPresence ? (presence?.mp ?? 0) : 1;
                        const mpM = hasPresence ? (presence?.maxMp ?? 1) : 1;
                        const fxSlot = remoteHumanFxIdx(m.id);
                        const remoteIsLeader = partyForUi && partyForUi.leaderId === m.id;
                        const remoteAggroKey = remoteIsLeader ? 'player' : `human_${m.id}`;
                        const humanAggro = waveMonsters.filter(
                            (w) => !w.isDead && w.aggroTarget === remoteAggroKey,
                        ).length;
                        return {
                            id: `human_${m.id}`,
                            name: m.name,
                            avatarUrl: getCharacterAvatar(m.class, tier ? [tier] : []),
                            accentColor: accent,
                            className: m.class,
                            currentHp: Math.max(0, hpC),
                            maxHp: hpM,
                            currentMp: Math.max(0, mpC),
                            maxMp: mpM,
                            isDead: hasPresence && hpC <= 0,
                            isPlayer: false,
                            level: m.level,
                            aggroCount: humanAggro,
                            hitPulse: humanHitPulses[m.id] ?? 0,
                            skillAnim: fx.allySkill[fxSlot] ?? null,
                            floats: fx.allyFloats[fxSlot] ?? [],
                        };
                    }),
                    ...partyBots.map<ICombatAlly>((bot, bIdx) => {
                        const slotIdx = (party?.members.filter((m) => m.id !== character.id && !m.isBot).length ?? 0) + bIdx + 1;
                        return {
                            id: bot.id,
                            name: bot.name,
                            avatarUrl: getCharacterAvatar(bot.class, []),
                            accentColor: classColorFallbackMap[bot.class] ?? '#888',
                            className: bot.class,
                            currentHp: Math.max(0, bot.hp),
                            maxHp: bot.maxHp,
                            currentMp: Math.max(0, bot.mp),
                            maxMp: bot.maxMp,
                            isDead: !bot.alive,
                            isPlayer: false,
                            isBot: true,
                            level: bot.level,
                            aggroCount: waveMonsters.filter(
                                (w) => !w.isDead && w.aggroTarget === bot.id,
                            ).length,
                            hitPulse: botHitPulses[bot.id] ?? 0,
                            skillAnim: fx.allySkill[slotIdx] ?? null,
                            floats: fx.allyFloats[slotIdx] ?? [],
                        };
                    }),
                ];

                const uiSkills: Array<ICombatSkillSlot | null> =
                    (activeSkillSlots as (string | null)[]).map((skillId, i) => {
                        if (!skillId) return null;
                        const slotMpCost = getSkillMpCost(skillId);
                        const cdRemaining = skillCooldowns[skillId] ?? 0;
                        const cdActive = cdRemaining > 0;
                        const noMp = playerCurrentMp < slotMpCost;
                        return {
                            id: skillId,
                            icon: getSkillIcon(skillId),
                            name: skillId,
                            mpCost: slotMpCost,
                            cooldownProgress: cdActive ? 1 - cdRemaining / Math.max(1000, resolveSkillRecastMs(skillId, SKILL_COOLDOWN_MS) - getCooldownReductionMs()) : 1,
                            cooldownRemainingMs: cdRemaining,
                            disabled: skillMode === 'auto' || noMp || cdActive,
                            onClick: () => doUseSkill(i as 0 | 1 | 2 | 3),
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
                const pctHpSlot = buildPotion(bestPctHpPotion, 'pct-hp', pctHpCooldown, PCT_CD_MS);
                const pctMpSlot = buildPotion(bestPctMpPotion, 'pct-mp', pctMpCooldown, PCT_CD_MS);
                const flatHpSlot = buildPotion(bestHpPotion, 'hp', hpPotionCooldown, HP_POTION_COOLDOWN_MS);
                const flatMpSlot = buildPotion(bestMpPotion, 'mp', mpPotionCooldown, MP_POTION_COOLDOWN_MS);

                return (
                    <CombatHudHost active={phase === 'fighting' || phase === 'victory'} accent={playerAccent}>
                        <div className="combat-ui">
                            <CombatTopControls
                                speed={{ label: combatSpeed, onCycle: cycleSpeed }}
                                autoSkill={{
                                    on: skillMode === 'auto',
                                    onToggle: () =>
                                        setSkillMode(skillMode === 'auto' ? 'manual' : 'auto'),
                                }}
                                autoFight={{
                                    on: autoFight,
                                    onToggle: () => {
                                        if (isMemberInMultiHumanParty) return;
                                        useCombatStore.getState().setAutoFight(!autoFight);
                                    },
                                }}
                                autoPotion={{ on: autoPotionOn, onToggle: toggleAutoPotion }}
                                xpVisible={{
                                    on: showCombatXpBar,
                                    onToggle: () => setShowCombatXpBar(!showCombatXpBar),
                                }}
                            />

                            <CombatArena
                                enemies={uiEnemies}
                                allies={uiAllies}
                                bgVariant="default"
                                overlay={null}
                            />

                            <CombatSubControls
                                xp={
                                    showCombatXpBar
                                        ? {
                                              current: character.xp,
                                              max: xpToNextLevel(character.level),
                                              level: character.level,
                                          }
                                        : null
                                }
                                xpPerHour={sessionXpPerHour}
                                xpBonusPct={(() => {
                                    const partySize = party ? Math.max(1, party.members.length) : 1;
                                    const partyMult = calculateXpMultiplier(partySize);
                                    const bStore = useBuffStore.getState();
                                    const has100 = bStore.hasBuff('xp_boost_100');
                                    const has50 = bStore.hasBuff('xp_boost');
                                    const baseXpMult = has100
                                        ? bStore.getBuffMultiplier('xp_boost_100')
                                        : has50 ? bStore.getBuffMultiplier('xp_boost') : 1;
                                    const premiumXpMult = bStore.getBuffMultiplier('premium_xp_boost');
                                    const total = partyMult * baseXpMult * premiumXpMult;
                                    return Math.max(0, total - 1);
                                })()}
                                showBackpackPing={phase === 'victory'}
                                tally={<HuntedTally />}
                                waveControl={
                                    <div
                                        className="combat-ui__wave-ctl"
                                        title={isMemberInMultiHumanParty
                                            ? 'Tylko lider party może zmieniać falę'
                                            : 'Wielkość kolejnej fali'}
                                    >
                                        <button
                                            type="button"
                                            className="combat-ui__wave-ctl-btn"
                                            onClick={() => {
                                                if (isMemberInMultiHumanParty) return;
                                                const next = decrementWavePlannedCount();
                                                addLog(
                                                    `Następna fala: ${next} potwor${next === 1 ? '' : next < 5 ? 'y' : 'ów'}`,
                                                    'system',
                                                );
                                            }}
                                            disabled={wavePlannedCount <= 1 || isMemberInMultiHumanParty}
                                            aria-label="Mniej potworów w następnej fali"
                                        >−</button>
                                        <span className="combat-ui__wave-ctl-count">
                                            Fala: {wavePlannedCount}/{MAX_WAVE_MONSTERS}
                                        </span>
                                        <button
                                            type="button"
                                            className="combat-ui__wave-ctl-btn"
                                            onClick={() => {
                                                if (isMemberInMultiHumanParty) return;
                                                const next = useCombatStore.getState().incrementWavePlannedCount();
                                                addLog(
                                                    `Następna fala: ${next} potwor${next === 1 ? '' : next < 5 ? 'y' : 'ów'}`,
                                                    'system',
                                                );
                                            }}
                                            disabled={wavePlannedCount >= MAX_WAVE_MONSTERS || isMemberInMultiHumanParty}
                                            aria-label="Więcej potworów w następnej fali"
                                        >+</button>
                                    </div>
                                }
                            />

                            {phase === 'victory' && playerCurrentHp <= 0 && (
                                <div className="combat-ui__victory-footer">
                                    <button
                                        type="button"
                                        className="combat-ui__victory-btn combat-ui__victory-btn--primary"
                                        onClick={handleDeathReturnToTown}
                                    >
                                        <GameIcon name="house" /> Wróć do miasta
                                    </button>
                                </div>
                            )}
                            {phase === 'victory' && playerCurrentHp > 0 && !autoFight && (
                                <div className="combat-ui__victory-footer">
                                    <button
                                        type="button"
                                        className="combat-ui__victory-btn combat-ui__victory-btn--primary"
                                        onClick={async () => {
                                            const baseMonster =
                                                monsters.find((m) => m.id === monster.id) ?? monster;
                                            if (isBackendCombatDelegated() && character) {
                                                await runBackendHunt(baseMonster);
                                                return;
                                            }
                                            engineStartNewFight(baseMonster);
                                        }}
                                    >
                                        <GameIcon name="crossed-swords" /> Walcz ponownie
                                    </button>
                                    <button
                                        type="button"
                                        className="combat-ui__victory-btn"
                                        onClick={() => stopCombat()}
                                    >
                                        <GameIcon name="counterclockwise-arrows-button" /> Zmień potwora
                                    </button>
                                </div>
                            )}

                            {phase === 'victory' && autoFight && combatSpeed !== 'SKIP' && playerCurrentHp > 0 && (
                                <div
                                    className="combat-ui__auto-fight-bar"
                                    aria-label="Następna walka za chwilę"
                                    role="progressbar"
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={Math.round(autoFightProgress * 100)}
                                >
                                    <span
                                        className="combat-ui__auto-fight-bar-fill"
                                        style={{ width: `${autoFightProgress * 100}%` }}
                                    />
                                </div>
                            )}

                            {(phase === 'fighting' || phase === 'victory') && (
                                <CombatActionBar
                                    skills={uiSkills}
                                    exit={{
                                        kind: 'hunt-popup',
                                        onOpenDialog: () => setExitDialogOpen(true),
                                    }}
                                />
                            )}

                            {(phase === 'fighting' || phase === 'victory') && (
                                <CombatPotionDock
                                    hpPotion={flatHpSlot}
                                    pctHpPotion={pctHpSlot}
                                    mpPotion={flatMpSlot}
                                    pctMpPotion={pctMpSlot}
                                />
                            )}

                            {exitDialogOpen && (
                                <HuntExitDialog
                                    onClose={() => setExitDialogOpen(false)}
                                    onEndHunt={() => {
                                        setExitDialogOpen(false);
                                        stopCombat();
                                        useCombatStore.getState().clearCombatSession();
                                        const pState = usePartyStore.getState().party;
                                        const me = useCharacterStore.getState().character?.id;
                                        if (pState && me) {
                                            const otherHumans = pState.members.filter(
                                                (m) => m.id !== me && !m.isBot,
                                            );
                                            if (otherHumans.length > 0) {
                                                if (pState.leaderId === me) {
                                                    void usePartyStore.getState().disbandParty(me);
                                                } else {
                                                    void usePartyStore.getState().leaveParty(me);
                                                }
                                            }
                                        }
                                        navigate('/battle');
                                    }}
                                    onLeaveBackground={() => {
                                        setExitDialogOpen(false);
                                        navigate('/');
                                    }}
                                />
                            )}
                        </div>
                    </CombatHudHost>
                );
            })()}
            <PartyDeathChoice
                open={deathChoicePopup}
                aliveAllies={
                    partyBots.filter((b) => b.alive).length +
                    ((party?.members ?? []).filter((m) => {
                        if (m.id === character?.id) return false;
                        if (m.isBot) return false;
                        const pres = partyPresence[m.id];
                        return !pres || pres.hp > 0;
                    }).length)
                }
                onReturnToTown={handleDeathReturnToTown}
                onWaitForResurrection={handleDeathWaitForRes}
            />
        </div>
    );
};

export default Combat;
