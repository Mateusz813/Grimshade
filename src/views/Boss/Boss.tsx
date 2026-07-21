import { useState, useEffect, useRef, useCallback } from 'react';
import { rollWeaponDamage, formatSkillName } from '../../systems/combatViewHelpers';
import { useShallow } from 'zustand/react/shallow';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import bossData from '../../data/bosses.json';
import itemsData from '../../data/items.json';
import { useCharacterStore } from '../../stores/characterStore';
import { useCooldownStore } from '../../stores/cooldownStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useSkillStore } from '../../stores/skillStore';
import { useBossStore } from '../../stores/bossStore';
import { useBossScoreStore } from '../../stores/bossScoreStore';
import { usePartyStore } from '../../stores/partyStore';
import { usePartyPresenceStore } from '../../stores/partyPresenceStore';
import { getPartyGateLevel } from '../../systems/partySystem';
import { useSettingsStore } from '../../stores/settingsStore';
import { useBuffStore } from '../../stores/buffStore';
import { ELIXIRS } from '../../stores/shopStore';
import { resolveAutoPotionElixir } from '../../systems/potionSystem';
import { canUsePotionAtLevel } from '../../systems/potionGating';
import { applyDeathPenalty, applyFleePenalty } from '../../systems/levelSystem';
import { consumeDeathProtection } from '../../systems/deathProtection';
import { applyCombatLeaveDeath } from '../../systems/combatLeavePenalty';
import { useCombatStore } from '../../stores/combatStore';
import { usePartyCombatSyncStore } from '../../stores/partyCombatSyncStore';
import { requestPartyCombatStart, registerGoReplicator, triggerPartyCombatGo } from '../../hooks/usePartyReadyCheck';
import { usePartyReadyCheckStore } from '../../stores/partyReadyCheckStore';

registerGoReplicator('/boss', (payload) => {
    const p = payload as { bossId?: string } | null;
    if (!p?.bossId) return;
    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
        usePartyCombatSyncStore.getState().requestMemberBossEntry(p.bossId!);
    }).catch(() => { });
});
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
import { consumeCasterBasicHitMods, consumeTargetMarkAmp, skillTargetsEnemy, applyIncomingHeal } from '../../systems/skillEffectsV2';
import { useNecroSummonStore } from '../../stores/necroSummonStore';
import { useSkillAnim } from '../../hooks/useSkillAnim';
import { useCombatFx } from '../../hooks/useCombatFx';
import { useLevelUpRefill } from '../../hooks/useLevelUpRefill';
import { saveCurrentCharacterStores, commitCombatEventNow } from '../../stores/characterScope';
import { deathsApi } from '../../api/v1/deathsApi';
import { useDeathStore } from '../../stores/deathStore';
import {
    isBossEnraged,
    getBossPhaseMultiplier,
    getScaledBossStats,
    rollBossGold,
    rollBossLoot,
    getBossXp,
    computeBossRewards,
    type IBoss,
    type IBossResult,
    type IBossUniqueItem,
} from '../../systems/bossSystem';
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
import { flattenItemsData, getTotalEquipmentStats, getEquippedGearLevel, getGearGapMultiplier, formatItemName, STONE_GENERIC_ICON, STONE_ICONS, type IBaseItem } from '../../systems/itemSystem';
import { getItemDisplayInfo, generateRandomItemForClass } from '../../systems/itemGenerator';
import { getPotionDropInfo, rollPotionDrop, rollSpellChestDrop, getSpellChestIcon, getSpellChestEmoji, getSpellChestDisplayName, getSpellChestDropInfo } from '../../systems/lootSystem';
import TinyIcon from '../../components/ui/TinyIcon/TinyIcon';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import Icon from '../../components/atoms/Icon/Icon';
import { getTrainingBonuses, rollSkillDamageMult } from '../../systems/skillSystem';
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
    getBotLogIcon,
} from '../../systems/botSystem';

const BOSS_AGGRO_SWITCH_INTERVAL_MS = 10_000;
import type { IBot } from '../../types/bot';
import type { TCharacterClass } from '../../types/character';
import ItemIcon from '../../components/ui/ItemIcon/ItemIcon';
import { BossSprite } from '../../components/ui/Sprite/MonsterSprite';
import { getBossCardImage, getPotionImage, getSpellChestImage, getSummonImage } from '../../systems/spriteAssets';
import { getSkillIcon } from '../../data/skillIcons';
import { getCharacterAvatar } from '../../data/classAvatars';
import classesRaw from '../../data/classes.json';
import { useTransformStore } from '../../stores/transformStore';
import { formatGoldShort } from '../../systems/goldFormat';
import { isBackendMode, isBackendCombatDelegated } from '../../config/backendMode';
import { backendApi } from '../../api/backend/backendApi';
import { syncFromBackend } from '../../api/backend/syncState';
import './Boss.scss';


interface IBossClassData {
    dualWield?: boolean;
    dualWieldDmgPercent?: number;
}

const bossClassesArray = classesRaw as unknown as (IBossClassData & { id: string })[];
const bossClassesMap: Record<string, IBossClassData> = {};
for (const c of bossClassesArray) {
    bossClassesMap[c.id] = c;
}


const rollOffHandDamage = (): number => {
    const { equipment } = useInventoryStore.getState();
    const weapon = equipment.offHand ?? equipment.mainHand;
    if (!weapon) return 0;
    const dmgMin = weapon.bonuses.dmg_min ?? weapon.bonuses.attack ?? 0;
    const dmgMax = weapon.bonuses.dmg_max ?? dmgMin;
    if (dmgMax <= 0) return 0;
    return dmgMin + Math.floor(Math.random() * (dmgMax - dmgMin + 1));
};

const getBossCardHue = (level: number): number => {
    if (level <= 50) return 0;
    if (level <= 100) return 25;
    if (level <= 200) return 280;
    if (level <= 300) return 200;
    if (level <= 400) return 340;
    if (level <= 500) return 160;
    if (level <= 600) return 240;
    if (level <= 700) return 310;
    if (level <= 800) return 45;
    if (level <= 900) return 130;
    return 10;
};


type ScreenPhase = 'list' | 'fighting' | 'result';

type TBotClassOrNone = TCharacterClass | 'none';
const ALL_BOT_CLASSES: TCharacterClass[] = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'];

interface IBossResolveResult {
    won?: boolean;
    victory?: boolean;
    reward?: { gold?: number; xp?: number };
    gold?: number;
    xp?: number;
}

const readBossResolveResult = (res: unknown): IBossResolveResult =>
    (typeof res === 'object' && res !== null) ? (res as IBossResolveResult) : {};

const formatBossResolveFeedback = (boss: IBoss, res: unknown): string => {
    const r = readBossResolveResult(res);
    const won = r.won ?? r.victory;
    if (won === false) return `Porażka: ${boss.name_pl} nie został pokonany.`;
    const gold = r.reward?.gold ?? r.gold;
    const xp = r.reward?.xp ?? r.xp;
    const parts: string[] = [];
    if (typeof gold === 'number') parts.push(`+${gold} złota`);
    if (typeof xp === 'number') parts.push(`+${xp} XP`);
    const rewardStr = parts.length > 0 ? ` (${parts.join(', ')})` : '';
    return `Pokonano bossa ${boss.name_pl}!${rewardStr}`;
};



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
    rarity: keyof typeof RARITY_LABELS;
}

const BOSS_STONE_DROPS: IStoneDropInfo[] = [
    { name: 'Common Stone',    chance: 50, rarity: 'common' },
    { name: 'Rare Stone',      chance: 35, rarity: 'rare' },
    { name: 'Epic Stone',      chance: 25, rarity: 'epic' },
    { name: 'Legendary Stone',  chance: 15, rarity: 'legendary' },
    { name: 'Mythic Stone',    chance: 8,  rarity: 'mythic' },
    { name: 'Heroic Stone',    chance: 2,  rarity: 'heroic' },
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


const SKILL_COOLDOWN_MS = 5000;
const SKILL_MP_COST = 15;
const POTION_COOLDOWN_MS = 1000;

const hpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_hp') && !e.effect.includes('pct'));
const mpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_mp') && !e.effect.includes('pct'));
const pctHpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_hp_pct'));
const pctMpPotions = ELIXIRS.filter((e) => e.effect.startsWith('heal_mp_pct'));
const PCT_POTION_CD_MS = 500;


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
    type: 'player' | 'monster' | 'crit' | 'system' | 'boss-spell' | 'block' | 'dodge';
}


const getAttackMs = (speed: number): number =>
    Math.max(500, Math.floor(3000 / Math.max(1, speed || 1)));


interface IBossSpell {
    name: string;
    icon: string;
    type: 'damage' | 'heal' | 'buff';
    power: number;
}

const BOSS_SPELLS: IBossSpell[] = [
    { name: 'Cios Mocy', icon: 'collision', type: 'damage', power: 2.5 },
    { name: 'Mroczny Pocisk', icon: 'new-moon', type: 'damage', power: 1.8 },
    { name: 'Leczenie', icon: 'green-heart', type: 'heal', power: 0.1 },
    { name: 'Wściekłość', icon: 'fire', type: 'buff', power: 1.5 },
    { name: 'Trucizna', icon: 'skull-and-crossbones', type: 'damage', power: 1.5 },
    { name: 'Drenaż Życia', icon: 'drop-of-blood', type: 'damage', power: 2.0 },
];

const pickBossSpell = (boss: IBoss): IBossSpell => {
    const maxIdx = Math.min(BOSS_SPELLS.length, Math.floor(boss.level / 100) + 3);
    return BOSS_SPELLS[Math.floor(Math.random() * maxIdx)];
};


const Boss = () => {
    const navigate = useNavigate();

    const character   = useCharacterStore((s) => s.character);
    const equipment   = useInventoryStore((s) => s.equipment);
    const consumables = useInventoryStore((s) => s.consumables);
    const completedTransforms = useTransformStore((s) => s.completedTransforms);
    const _activeBuffs = useBuffStore((s) => s.allBuffs);
    void _activeBuffs;
    const necroSummons = useNecroSummonStore((s) => s.summons);
    const playerAvatarSrc = character ? getCharacterAvatar(character.class, completedTransforms) : '';
    const { activeSkillSlots } = useSkillStore(useShallow((s) => ({ activeSkillSlots: s.activeSkillSlots })));
    const { setBossDefeated, getAttemptsUsed, getAttemptsMax, canChallenge } = useBossStore();
    const { addBossKill, getTotalScore, getBossKillCount } = useBossScoreStore();
    const party = usePartyStore((s) => s.party);
    const presenceByMember = usePartyPresenceStore((s) => s.byMember);
    const { skillMode, setSkillMode, autoPotionHpEnabled, autoPotionMpEnabled } = useSettingsStore(useShallow((s) => ({ skillMode: s.skillMode, setSkillMode: s.setSkillMode, autoPotionHpEnabled: s.autoPotionHpEnabled, autoPotionMpEnabled: s.autoPotionMpEnabled })));
    const autoPotionHpId    = useSettingsStore((s) => s.autoPotionHpId);
    const autoPotionMpId    = useSettingsStore((s) => s.autoPotionMpId);
    const autoPotionPctHpId = useSettingsStore((s) => s.autoPotionPctHpId);
    const autoPotionPctMpId = useSettingsStore((s) => s.autoPotionPctMpId);

    const isMultiHumanParty = !!party && party.members.some(
        (m) => m.id !== character?.id && !m.isBot,
    );
    const isLeaderInPartyCombat = isMultiHumanParty && party?.leaderId === character?.id;
    const isNonLeaderMember     = isMultiHumanParty && party?.leaderId !== character?.id;

    const bossFilterAvailableOnly    = useSettingsStore((s) => s.bossFilterAvailableOnly);
    const bossFilterMinLevel         = useSettingsStore((s) => s.bossFilterMinLevel);
    const bossFilterSortDesc         = useSettingsStore((s) => s.bossFilterSortDesc);
    const setBossFilterAvailableOnly = useSettingsStore((s) => s.setBossFilterAvailableOnly);
    const setBossFilterMinLevel      = useSettingsStore((s) => s.setBossFilterMinLevel);
    const setBossFilterSortDesc      = useSettingsStore((s) => s.setBossFilterSortDesc);

    const [phase, setPhase]           = useState<ScreenPhase>('list');

    const [backendFeedback, setBackendFeedback] = useState<string | null>(null);

    const prevBossPhaseRef = useRef<ScreenPhase>(phase);
    useEffect(() => {
        const prev = prevBossPhaseRef.current;
        prevBossPhaseRef.current = phase;
        if (prev === 'list' || phase !== 'list') return;
        const partyState = usePartyStore.getState().party;
        const me = useCharacterStore.getState().character?.id;
        if (!partyState || !me) return;
        const otherH = partyState.members.filter((m) => m.id !== me && !m.isBot);
        if (otherH.length === 0) return;
        if (partyState.leaderId !== me) return;
        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishCombatEnd();
        }).catch(() => { });
    }, [phase]);
    const [activeBoss, setActiveBoss] = useState<IBoss | null>(null);
    const [deathChoicePopup, setDeathChoicePopup] = useState(false);
    const deathChoiceShownRef = useRef(false);
    const [result, setResult]         = useState<IBossResult | null>(null);

    const bossEventSentRef = useRef(false);
    useEffect(() => {
        if (phase !== 'result') {
            bossEventSentRef.current = false;
            return;
        }
        if (!isBackendMode() || !result || bossEventSentRef.current) return;
        bossEventSentRef.current = true;
        commitCombatEventNow({
            type: 'boss',
            sourceId: activeBoss?.id,
            outcome: result.won ? 'won' : 'lost',
            died: !result.won,
        });
    }, [phase, result, activeBoss]);

    const [dropModalBoss, setDropModalBoss] = useState<string | null>(null);
    const [bossEntryBoss, setBossEntryBoss] = useState<IBoss | null>(() => {
        const rc = usePartyReadyCheckStore.getState();
        if (rc.destination !== '/boss') return null;
        if (rc.open) return null;
        const p = rc.payload as { bossId?: string } | null;
        if (!p?.bossId) return null;
        const meId = useCharacterStore.getState().character?.id;
        const pty = usePartyStore.getState().party;
        if (!pty || !meId || pty.leaderId === meId) return null;
        return (bossData as Array<{ id: string }>).find((b) => b.id === p.bossId) as IBoss | null;
    });

    const [pendingBoss, setPendingBoss] = useState<IBoss | null>(null);
    const [partySize, setPartySize]     = useState<0 | 1 | 3>(3);
    const [botPicks, setBotPicks]       = useState<TBotClassOrNone[]>(['Knight', 'Cleric', 'Mage']);
    const lastBotPicksRef = useRef<TCharacterClass[]>([]);

    const [bossHp, setBossHp]         = useState(0);
    const [playerHp, setPlayerHp]     = useState(0);
    const [playerMp, setPlayerMp]     = useState(0);
    const [combatLog, setCombatLog]   = useState<ILogEntry[]>([]);

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
    useEffect(() => {
        useBuffStore.getState().setCombatSpeedMult(speedMult);
        return () => useBuffStore.getState().setCombatSpeedMult(1);
    }, [speedMult]);

    useEffect(() => {
        const ptyState = usePartyStore.getState().party;
        const meId = useCharacterStore.getState().character?.id;
        if (!ptyState || !meId || ptyState.leaderId !== meId) return;
        const otherHumans = ptyState.members.filter((m) => m.id !== meId && !m.isBot).length;
        if (otherHumans === 0) return;
        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishCombatSpeed(speedMode);
        }).catch(() => { });
    }, [speedMode]);

    useEffect(() => {
        if (!isNonLeaderMember) return;
        const unsub = (async () => {
            const { useSettingsStore } = await import('../../stores/settingsStore');
            return useSettingsStore.subscribe((state, prev) => {
                if (state.combatSpeed === prev.combatSpeed) return;
                const cs = state.combatSpeed;
                if (cs === 'x1' || cs === 'x2' || cs === 'x4') {
                    setSpeedMode(cs);
                }
            });
        })();
        return () => { void unsub.then((fn) => fn?.()); };
    }, [isNonLeaderMember]);

    const partyHealAccumRef = useRef(0);

    useEffect(() => {
        if (playerHp > 0 && deathChoicePopup) {
            setDeathChoicePopup(false);
            deathChoiceShownRef.current = false;
        }
    }, [playerHp, deathChoicePopup]);


    const cycleSpeed = useCallback(() => {
        if (isNonLeaderMember) return;
        setSpeedMode((s) => (s === 'x1' ? 'x2' : s === 'x2' ? 'x4' : 'x1'));
    }, [isNonLeaderMember]);
    const { trigger: triggerSkillAnim } = useSkillAnim();
    const fx = useCombatFx();
    const skillCooldownRef = useRef<Map<string, number>>(new Map());
    const hpPotionCooldownRef = useRef(0);
    const mpPotionCooldownRef = useRef(0);
    const pctHpCooldownRef = useRef(0);
    const pctMpCooldownRef = useRef(0);
    useEffect(() => { useCooldownStore.getState().clearAll(); return () => useCooldownStore.getState().clearAll(); }, []);
    const playerMpRef = useRef(0);

    const [monsterHitPulse, setMonsterHitPulse] = useState(0);
    const [playerHitPulse, setPlayerHitPulse]   = useState(0);
    const [botHitPulses, setBotHitPulses] = useState<Record<string, number>>({});
    const [playerAttacking, setPlayerAttacking] = useState(false);
    const [botAttackingClass, setBotAttackingClass] = useState<string | null>(null);

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

    const bossHpRef   = useRef(0);
    const playerHpRef = useRef(0);
    const phaseRef    = useRef<ScreenPhase>('list');
    const bossDeathHandledRef = useRef(false);

    const effectsRef = useRef<ICombatEffectsSession>(newCombatEffectsSession());
    const PLAYER_FX_ID = 'player';
    const BOSS_FX_ID = 'boss';

    const getActivePartyAtkPct = (): number => {
        const ps = effectsRef.current.statuses.get(PLAYER_FX_ID);
        if (!ps) return 0;
        return ps.atkBuffMs > 0 ? ps.atkBuffPct : 0;
    };
    const getActivePartyAsMult = (): number => {
        const ps = effectsRef.current.statuses.get(PLAYER_FX_ID);
        if (!ps) return 1;
        return ps.asMultMs > 0 ? Math.max(1, ps.asMult) : 1;
    };

    useLevelUpRefill(phase === 'fighting', useCallback((maxHp, maxMp) => {
        playerHpRef.current = maxHp;
        playerMpRef.current = maxMp;
        setPlayerHp(maxHp);
        setPlayerMp(maxMp);
    }, []));
    const activeBossRef = useRef<IBoss | null>(null);
    const scaledBossRef = useRef<{ hp: number; attack: number; attack_min: number; attack_max: number; defense: number }>({ hp: 0, attack: 0, attack_min: 0, attack_max: 0, defense: 0 });
    const [scaledBossMaxHp, setScaledBossMaxHp] = useState(0);
    const spellCounterRef = useRef(0);

    const { bots, generateBotsCustom, updateBotHp, updateBotMp, killBot, clearBots } = useBotStore();
    const botsRef = useRef<IBot[]>([]);
    const aggroTargetRef = useRef<string>('player');
    const bossTurnCounterRef = useRef(0);
    const aggroSwitchAtRef = useRef<number>(Date.now() + BOSS_AGGRO_SWITCH_INTERVAL_MS);
    const botSkillCooldownsRef = useRef<Map<string, number>>(new Map());

    useEffect(() => { botsRef.current = bots; }, [bots]);

    const botIdsSignatureRef = useRef<string>('');
    useEffect(() => {
        const signature = bots.map((b) => b.id).join(',');
        if (
            botIdsSignatureRef.current !== '' &&
            botIdsSignatureRef.current !== signature
        ) {
            fx.resetAllyFx();
        }
        botIdsSignatureRef.current = signature;
    }, [bots]);

    const bosses   = bossData as IBoss[];
    const allItems: IBaseItem[] = flattenItemsData(itemsData as Parameters<typeof flattenItemsData>[0]);
    const skillLevels = useSkillStore((s) => s.skillLevels);

    const eqStats   = getTotalEquipmentStats(equipment, allItems);
    const tb        = getTrainingBonuses(skillLevels, character?.class ?? 'Knight');
    const gearGapMult = getGearGapMultiplier(getEquippedGearLevel(equipment), activeBoss?.level ?? 0);
    const charAtk   = ((character?.attack  ?? 0) + eqStats.attack + getElixirAtkBonus()) * gearGapMult;
    const charDef   = (character?.defense ?? 0) + eqStats.defense + tb.defense + getElixirDefBonus();
    const effChar   = character ? getEffectiveChar(character) : null;
    const baseMaxHp = (character?.max_hp ?? 0) + eqStats.hp + tb.max_hp + getElixirHpBonus();
    const baseMaxMp = (character?.max_mp ?? 0) + eqStats.mp + tb.max_mp + getElixirMpBonus();
    const charMaxHp = effChar?.max_hp ?? baseMaxHp;
    const charMaxMp = effChar?.max_mp ?? baseMaxMp;
    const charSpeed = ((character?.attack_speed ?? 1) + eqStats.speed * 0.01 + tb.attack_speed) * getElixirAttackSpeedMultiplier();

    const bestHpPotion = resolveAutoPotionElixir(autoPotionHpId, 'hp', 'flat', consumables, character?.level ?? 1)
        ?? getBestPotion(hpPotions, consumables, character?.level ?? 1);
    const bestMpPotion = resolveAutoPotionElixir(autoPotionMpId, 'mp', 'flat', consumables, character?.level ?? 1)
        ?? getBestPotion(mpPotions, consumables, character?.level ?? 1);
    const bestPctHpPotion = resolveAutoPotionElixir(autoPotionPctHpId, 'hp', 'pct', consumables, character?.level ?? 1)
        ?? getBestPotion(pctHpPotions, consumables, character?.level ?? 1);
    const bestPctMpPotion = resolveAutoPotionElixir(autoPotionPctMpId, 'mp', 'pct', consumables, character?.level ?? 1)
        ?? getBestPotion(pctMpPotions, consumables, character?.level ?? 1);

    phaseRef.current = phase;
    activeBossRef.current = activeBoss;

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

    const leavePenaltyAppliedRef = useRef(false);
    useEffect(() => {
        const fire = () => {
            if (leavePenaltyAppliedRef.current) return;
            if (phaseRef.current !== 'fighting') return;
            const boss = activeBossRef.current;
            if (!boss) return;
            leavePenaltyAppliedRef.current = true;
            applyCombatLeaveDeath({
                source: 'boss',
                sourceName: boss.name_pl,
                sourceLevel: boss.level,
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
        const sessionType = type === 'boss-spell' ? 'system' : type;
        useCombatStore.getState().addSessionLog(text, sessionType);
    }, []);

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
                const playerHeal = Math.max(1, Math.floor(charMaxHp * (pct / 100)));
                const before = playerHpRef.current;
                if (before < charMaxHp) {
                    playerHpRef.current = Math.min(charMaxHp, before + playerHeal);
                    setPlayerHp(playerHpRef.current);
                }
                const actual = playerHpRef.current - before;
                const cappedTag = actual < playerHeal ? ' (MAX)' : '';
                fx.pushAllyFloat(0, playerHeal, 'heal', {
                    icon: 'green-heart',
                    label: cappedTag ? `+${playerHeal}${cappedTag}` : undefined,
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
                    const botActual = newHp - bot.hp;
                    const botCapped = botActual < heal ? ' (MAX)' : '';
                    fx.pushAllyFloat(i + 1, heal, 'heal', {
                        icon: 'green-heart',
                        label: botCapped ? `+${heal}${botCapped}` : undefined,
                    });
                    if (pulseSkillId) fx.triggerAllySkillAnim(i + 1, pulseSkillId);
                }
            }
        }, TICK);
        return () => clearInterval(id);
    }, [fx, charMaxHp]);

    const showFloatingDmg = useCallback((_text: string, _type: string, _side?: 'left' | 'right') => {}, []);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [combatLog.length]);

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

    const tryAutoPotion = useCallback(() => {
        const settings = useSettingsStore.getState();
        const inv = useInventoryStore.getState();
        const hp = playerHpRef.current;
        const mp = playerMpRef.current;

        const freshChar = useCharacterStore.getState().character;
        const freshEff = freshChar ? getEffectiveChar(freshChar) : null;
        const liveMaxHp = freshEff?.max_hp ?? charMaxHp;
        const liveMaxMp = freshEff?.max_mp ?? charMaxMp;

        const hpAtFull = liveMaxHp > 0 && hp >= liveMaxHp;
        const mpAtFull = liveMaxMp > 0 && mp >= liveMaxMp;

        const resolveAmount = (elixirIdOrNull: string | null, kind: 'flat' | 'pct', hm: 'hp' | 'mp', maxVal: number): { id: string; name: string; amount: number } | null => {
            const elixir = resolveAutoPotionElixir(elixirIdOrNull ?? undefined, hm, kind, inv.consumables, character?.level ?? 1);
            if (!elixir) return null;
            const flatRe = hm === 'hp' ? /^heal_hp_(\d+)$/ : /^heal_mp_(\d+)$/;
            const pctRe = hm === 'hp' ? /^heal_hp_pct_(\d+)$/ : /^heal_mp_pct_(\d+)$/;
            const flat = elixir.effect.match(flatRe);
            const pct = elixir.effect.match(pctRe);
            if (flat) return { id: elixir.id, name: elixir.name_pl, amount: parseInt(flat[1], 10) };
            if (pct) return { id: elixir.id, name: elixir.name_pl, amount: Math.floor(maxVal * parseInt(pct[1], 10) / 100) };
            return null;
        };

        const hpMissing = Math.max(0, liveMaxHp - hp);
        const mpMissing = Math.max(0, liveMaxMp - mp);
        const hpPct = liveMaxHp > 0 ? (hp / liveMaxHp) * 100 : 100;
        const mpPct = liveMaxMp > 0 ? (mp / liveMaxMp) * 100 : 100;

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
                setPctHpCooldown(PCT_POTION_CD_MS); pctHpCooldownRef.current = PCT_POTION_CD_MS;
                healPlayerHp(pot.amount, liveMaxHp);
                addLog(`[Auto%] ${pot.name} +${pot.amount} HP`, 'system');
            }
        }

        if (!mpAtFull && settings.autoPotionPctMpEnabled && settings.autoPotionPctMpThreshold > 0 && mpPct <= settings.autoPotionPctMpThreshold && pctMpCooldownRef.current <= 0) {
            const pot = resolveAmount(settings.autoPotionPctMpId, 'pct', 'mp', liveMaxMp);
            if (pot && pot.amount > 0 && mpMissing >= pot.amount) {
                inv.useConsumable(pot.id);
                setPctMpCooldown(PCT_POTION_CD_MS); pctMpCooldownRef.current = PCT_POTION_CD_MS;
                healPlayerMp(pot.amount, liveMaxMp);
                addLog(`[Auto%] ${pot.name} +${pot.amount} MP`, 'system');
            }
        }
    }, [charMaxHp, charMaxMp, healPlayerHp, healPlayerMp, startHpCooldown, startMpCooldown, addLog]);

    const doUsePotion = useCallback((elixirId: string) => {
        const elixir = ELIXIRS.find((e) => e.id === elixirId);
        if (!elixir) return;
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

    const lastBossPartyRef = useRef<TCharacterClass[]>([]);

    const beginBossFight = useCallback((boss: IBoss, chosenBotClasses: TCharacterClass[]) => {
        if (!character) return;
        lastBossPartyRef.current = chosenBotClasses;
        useCombatStore.getState().clearCombatSession();
        void import('../../stores/partyDamageStore').then(({ usePartyDamageStore }) => {
            usePartyDamageStore.getState().reset();
        }).catch(() => { });
        fx.resetFx();
        const scaled = getScaledBossStats(boss);
        setActiveBoss(boss);
        scaledBossRef.current = scaled;
        setScaledBossMaxHp(scaled.hp);
        setBossHp(scaled.hp);
        bossHpRef.current = scaled.hp;
        const startChar = useCharacterStore.getState().character;
        const stayDead = !!startChar && (startChar.hp ?? 0) <= 0;
        const startHp = stayDead
            ? 0
            : startChar
                ? Math.max(1, Math.min(charMaxHp, startChar.hp ?? charMaxHp))
                : charMaxHp;
        const startMp = stayDead
            ? 0
            : startChar
                ? Math.max(0, Math.min(charMaxMp, startChar.mp ?? charMaxMp))
                : charMaxMp;
        setPlayerHp(startHp);
        playerHpRef.current = startHp;
        setPlayerMp(startMp);
        playerMpRef.current = startMp;
        setResult(null);
        setCombatLog([]);
        spellCounterRef.current = 0;
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
        if (chosenBotClasses.length > 0) {
            generateBotsCustom(character.level, chosenBotClasses);
            const ptyForBots = usePartyStore.getState().party;
            const presenceMap = usePartyPresenceStore.getState().byMember;
            const humanMatesForBots = ptyForBots?.members.filter(
                (m) => m.id !== character.id && !m.isBot,
            ) ?? [];
            const generated = useBotStore.getState().bots;
            const patched = generated.map((b, i) => {
                const mate = humanMatesForBots[i];
                if (!mate) return b;
                const pres = presenceMap[mate.id];
                const repPatch = {
                    ...b,
                    name: mate.name,
                    level: mate.level,
                    representsCharacterId: mate.id,
                };
                if (!pres) return repPatch;
                return {
                    ...repPatch,
                    hp: pres.hp,
                    maxHp: pres.maxHp,
                    mp: pres.mp,
                    maxMp: pres.maxMp,
                    attack: pres.attack ?? b.attack,
                    defense: pres.defense ?? b.defense,
                    alive: pres.hp > 0,
                };
            });
            useBotStore.setState({ bots: patched });
        } else {
            clearBots();
        }
        bossTurnCounterRef.current = 0;
        const initialCandidates = [
            { id: 'player', class: character.class },
            ...useBotStore.getState().bots
                .filter((b) => b.alive)
                .map((b) => ({ id: b.id, class: b.class })),
        ];
        aggroTargetRef.current = pickAggroTarget(initialCandidates);
        aggroSwitchAtRef.current = Date.now() + BOSS_AGGRO_SWITCH_INTERVAL_MS;
        botSkillCooldownsRef.current.clear();
        effectsRef.current = newCombatEffectsSession();
        useNecroSummonStore.getState().clear(PLAYER_FX_ID);
        leavePenaltyAppliedRef.current = false;
        bossDeathHandledRef.current = false;
        deathChoiceShownRef.current = false;
        setDeathChoicePopup(false);
        resultDeathAppliedRef.current = false;
        wipeForcedRef.current = false;
        setPhase('fighting');
        logIdRef.current = 0;
    }, [charMaxHp, charMaxMp, character?.level, generateBotsCustom, clearBots, fx]);

    const BOSS_ENTRY_MS = 1800;

    const bossEntryTimeoutRef = useRef<number | null>(null);
    const bossEntryPendingRef = useRef<{ boss: IBoss; picks: TCharacterClass[] } | null>(null);

    const skipBossEntry = useCallback(() => {
        if (isNonLeaderMember) return;
        const pending = bossEntryPendingRef.current;
        if (!pending) return;
        if (bossEntryTimeoutRef.current !== null) {
            window.clearTimeout(bossEntryTimeoutRef.current);
            bossEntryTimeoutRef.current = null;
        }
        bossEntryPendingRef.current = null;
        setBossEntryBoss(null);
        beginBossFight(pending.boss, pending.picks);
        if (isLeaderInPartyCombat) {
            void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                usePartyCombatSyncStore.getState().publishBossEntrySkip();
            }).catch(() => { });
        }
    }, [beginBossFight, isLeaderInPartyCombat, isNonLeaderMember]);

    const playEntryThenFight = useCallback((boss: IBoss, picks: TCharacterClass[]) => {
        bossEntryPendingRef.current = { boss, picks };
        setBossEntryBoss(boss);
        if (bossEntryTimeoutRef.current !== null) {
            window.clearTimeout(bossEntryTimeoutRef.current);
        }
        bossEntryTimeoutRef.current = window.setTimeout(() => {
            bossEntryTimeoutRef.current = null;
            const pending = bossEntryPendingRef.current;
            if (!pending) return;
            bossEntryPendingRef.current = null;
            setBossEntryBoss(null);
            beginBossFight(pending.boss, pending.picks);
        }, BOSS_ENTRY_MS);
    }, [beginBossFight]);

    const memberEntryTriedRef = useRef(false);
    const lastBossEntryAtSeenRef = useRef(0);
    useEffect(() => {
        if (!character) return;
        const me = character.id;
        const fireEntry = (bossId: string) => {
            const partyState = usePartyStore.getState().party;
            if (!partyState) return;
            if (partyState.leaderId === me) return;
            const boss = (bossData as Array<{ id: string }>).find((b) => b.id === bossId);
            if (!boss) return;
            lastBotPicksRef.current = [];
            memberEntryTriedRef.current = true;
            playEntryThenFight(boss as IBoss, []);
        };
        const tryStartFromReadyCheck = () => {
            const rc = usePartyReadyCheckStore.getState();
            if (rc.destination !== '/boss') return;
            const p = rc.payload as { bossId?: string } | null;
            if (!p?.bossId) return;
            const partyState = usePartyStore.getState().party;
            if (!partyState) return;
            if (partyState.leaderId === me) return;
            if (rc.open) return;
            usePartyReadyCheckStore.getState().consumeDestination();
            fireEntry(p.bossId);
        };
        tryStartFromReadyCheck();
        const unsubRc = usePartyReadyCheckStore.subscribe((state, prev) => {
            if (state.destination === prev.destination) return;
            if (state.destination !== '/boss') return;
            tryStartFromReadyCheck();
        });
        let unsubSync: (() => void) | null = null;
        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            lastBossEntryAtSeenRef.current = usePartyCombatSyncStore.getState().pendingBossEntryAt;
            unsubSync = usePartyCombatSyncStore.subscribe((state) => {
                const at = state.pendingBossEntryAt;
                if (!at || at === lastBossEntryAtSeenRef.current) return;
                lastBossEntryAtSeenRef.current = at;
                const bossId = state.pendingBossEntryBossId;
                if (!bossId) return;
                fireEntry(bossId);
            });
        }).catch(() => { });
        return () => {
            unsubRc();
            unsubSync?.();
        };
    }, [character?.id, playEntryThenFight]);

    const handleChallenge = useCallback(async (boss: IBoss) => {
        if (isBackendCombatDelegated() && character) {
            try {
                const res = await backendApi.bossResolve(character.id, boss.id);
                await syncFromBackend(character.id);
                setBackendFeedback(formatBossResolveFeedback(boss, res));
                return;
            } catch (e) {
                console.warn('[backend] bossResolve failed', e);
                setBackendFeedback(`Nie udało się rozstrzygnąć walki: ${boss.name_pl}.`);
                return;
            }
        }
        const partyState = usePartyStore.getState().party;
        const me = useCharacterStore.getState().character?.id;
        const otherHumans = partyState?.members.filter((m) => m.id !== me && !m.isBot) ?? [];
        const isMultiHumanParty = !!partyState && otherHumans.length > 0;
        if (isMultiHumanParty && partyState?.leaderId !== me) {
            return;
        }

        let partnerClasses: TCharacterClass[] = [];
        if (party && party.members.length > 1) {
            partnerClasses = party.members
                .filter((m) => m.id !== character?.id)
                .slice(0, 3)
                .map((m) => m.class as TCharacterClass);
        }

        const startNow = () => {
            if (partnerClasses.length > 0) {
                lastBotPicksRef.current = partnerClasses;
                playEntryThenFight(boss, partnerClasses);
            } else {
                setPendingBoss(boss);
            }
        };

        requestPartyCombatStart({
            destination: '/boss',
            label: `Boss: ${boss.name_pl}`,
            payload: { bossId: boss.id },
            onConfirmed: startNow,
        });
    }, [party, character, playEntryThenFight]);

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


    const handleBossDeath = useCallback(() => {
        const boss = activeBossRef.current;
        if (!boss) return;
        if (!character) return;
        if (bossDeathHandledRef.current) return;
        bossDeathHandledRef.current = true;

        tickCombatElixirs(2000);

        const drops = rollBossLoot(boss);
        const bossMasteryLvl = useMasteryStore.getState().getMasteryLevel(boss.id);
        const bossXpMult = getMasteryXpMultiplier(bossMasteryLvl);
        const bossGoldMult = getMasteryGoldMultiplier(bossMasteryLvl);
        const gold = Math.floor(rollBossGold(boss) * bossGoldMult);
        const bStore = useBuffStore.getState();
        const baseBossXp = Math.floor(getBossXp(boss) * bossXpMult);
        const xp = baseBossXp;
        void bStore;

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

        for (const drop of drops) {
            useQuestStore.getState().addProgress('drop_rarity', drop.rarity, 1);
        }

        const inv = useInventoryStore.getState();
        inv.addGold(gold);
        const xpResult = useCharacterStore.getState().addXp(xp);
        if (xpResult.levelsGained > 0) {
            addLog(`Awans! Poziom ${xpResult.newLevel}! (+${xpResult.statPointsGained} pkt statystyk) – pełne HP/MP!`, 'system');
        }
        setBossDefeated(boss.id);
        addBossKill(boss.id, boss.level);

        const ptyState = usePartyStore.getState().party;
        const meIdForKill = useCharacterStore.getState().character?.id;
        const otherHumansForKill = ptyState?.members.filter(
            (m) => m.id !== meIdForKill && !m.isBot,
        ) ?? [];
        if (ptyState && meIdForKill && ptyState.leaderId === meIdForKill && otherHumansForKill.length > 0) {
            const aliveBots = useBotStore.getState().bots;
            const aliveMemberIds: string[] = [];
            otherHumansForKill.forEach((mate, idx) => {
                const bot = aliveBots[idx];
                if (bot?.alive) aliveMemberIds.push(mate.id);
            });
            void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                usePartyCombatSyncStore.getState().publishBossKilled({
                    bossId: boss.id,
                    aliveMemberIds,
                });
            }).catch(() => { });
        }

        useTaskStore.getState().addKill(boss.id, boss.level, 1);
        useQuestStore.getState().addProgress('kill', boss.id, 1);
        useQuestStore.getState().addProgress('boss', boss.id, 1);
        useQuestStore.getState().addProgress('kill_rarity', 'boss', 1, boss.level);
        useQuestStore.getState().addProgress('kill_bosses_any', 'any', 1);
        useDailyQuestStore.getState().addProgress('kill_any', 1);
        useDailyQuestStore.getState().addProgress('kill_boss', 1);
        useDailyQuestStore.getState().addProgress('earn_gold', gold);

        const chestDrops = rollSpellChestDrop(boss.level, 'normal', false, true);
        const chestNames: string[] = [];
        for (const cd of chestDrops) {
            inv.addSpellChest(cd.chestLevel, cd.count);
            chestNames.push(`${getSpellChestEmoji(cd.chestLevel)} ${getSpellChestDisplayName(cd.chestLevel)}`);
        }

        const potionDrops = rollPotionDrop(boss.level);
        const potionNames: string[] = [];
        for (const pd of potionDrops) {
            inv.addConsumable(pd.potionId, pd.count);
            potionNames.push(`${pd.potionId} ×${pd.count}`);
        }
        if (potionNames.length > 0) {
            addLog(`:test-tube: Drop: ${potionNames.join(', ')}`, 'system');
        }

        addLog(`:trophy: ${boss.name_pl} pokonany! +${gold.toLocaleString('pl-PL')} Gold, +${xp.toLocaleString('pl-PL')} XP`, 'system');
        if (drops.length > 0) {
            const dropNames = drops.map((d) => {
                const info = getItemDisplayInfo(d.itemId);
                return info?.name_pl ?? formatItemName(d.itemId);
            });
            addLog(`:package: Drop: ${dropNames.join(', ')}`, 'system');
        }
        if (chestNames.length > 0) {
            addLog(`:package: Spell Chests: ${chestNames.join(', ')}`, 'system');
        }

        setResult({
            won: true,
            playerHpLeft: playerHpRef.current,
            turns: 0,
            drops,
            gold,
            xp,
        });
        const liveCharAfter = useCharacterStore.getState().character;
        if (liveCharAfter) {
            const eqLive = getTotalEquipmentStats(equipment, allItems);
            const tbLive = getTrainingBonuses(skillLevels, character.class);
            const baseMaxHpLive = liveCharAfter.max_hp + eqLive.hp + tbLive.max_hp + getElixirHpBonus();
            const baseMaxMpLive = liveCharAfter.max_mp + eqLive.mp + tbLive.max_mp + getElixirMpBonus();
            const effLive = getEffectiveChar(liveCharAfter);
            const liveEffectiveMaxHp = effLive?.max_hp ?? baseMaxHpLive;
            const liveEffectiveMaxMp = effLive?.max_mp ?? baseMaxMpLive;

            const finalHp = playerHpRef.current > 0 ? liveEffectiveMaxHp : 0;
            const finalMp = playerHpRef.current > 0 ? liveEffectiveMaxMp : 0;

            useCharacterStore.getState().updateCharacter({ hp: finalHp, mp: finalMp });
        }
        leavePenaltyAppliedRef.current = true;
        const cs = useCombatStore.getState();
        cs.addSessionStats(xp, gold);
        cs.incrementSessionKill('boss');
        if (drops.length > 0) {
            cs.appendDrops(drops.map((d) => {
                const info = getItemDisplayInfo(d.itemId);
                return {
                    icon: info?.icon ?? 'package',
                    name: info?.name_pl ?? formatItemName(d.itemId),
                    rarity: d.rarity ?? 'legendary',
                };
            }));
        }
        clearBots();
        setTimeout(() => setPhase('result'), 500);
    }, [addLog, setBossDefeated, addBossKill, clearBots]);

    const handlePlayerDeath = useCallback((forceConfirm: boolean = false) => {
        const boss = activeBossRef.current;
        if (!boss) return;
        if (!forceConfirm) {
            const ptyState = usePartyStore.getState().party;
            const meId = useCharacterStore.getState().character?.id;
            const otherHumans = ptyState?.members.filter((m) => m.id !== meId && !m.isBot) ?? [];
            const isInMultiHumanParty = ptyState && otherHumans.length > 0;
            if (isInMultiHumanParty) {
                if (!deathChoiceShownRef.current) {
                    deathChoiceShownRef.current = true;
                    setDeathChoicePopup(true);
                }
                return;
            }
        }
        leavePenaltyAppliedRef.current = true;

        const char = useCharacterStore.getState().character;
        if (char) {
            if (isBackendMode() && char) {
                void backendApi.logDeath(char.id, {
                    source: 'boss',
                    source_name: boss.name_pl,
                    source_level: boss.level,
                    result: 'killed',
                });
            } else {
                void deathsApi.logDeath({
                    character_id: char.id,
                    character_name: char.name,
                    character_class: char.class,
                    character_level: char.level,
                    source: 'boss',
                    source_name: boss.name_pl,
                    source_level: boss.level,
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
                const protName = prot.consumedId === 'amulet_of_loss' ? 'Amulet of Loss' : 'Eliksir Ochrony';
                addLog(`:shield: ${protName} uchronił Cię przed wszelkimi stratami!`, 'system');
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
                    addLog(`:skull: Zginąłeś! Tracisz ${penalty.levelsLost} poziom${penalty.levelsLost === 1 ? '' : 'y'}: ${char.level} -> ${penalty.newLevel} · ${skillPctTxt}`, 'system');
                } else {
                    addLog(`:skull: Zginąłeś w walce z ${boss.name_pl}! ${skillPctTxt}`, 'system');
                }

                const itemsLost = useInventoryStore.getState().applyDeathItemLoss(false, char.level);
                if (itemsLost > 0) {
                    addLog(`:skull: Stracileś ${itemsLost} przedmiot(ow) przy śmierci!`, 'system');
                }
            }
            void saveCurrentCharacterStores();

            useDeathStore.getState().triggerDeath({
                killedBy: boss.name_pl,
                sourceLevel: boss.level,
                oldLevel,
                newLevel,
                levelsLost,
                xpPercent,
                skillXpLossPercent,
                protectionUsed: prot.isProtected,
                source: 'boss',
            });
        } else {
            addLog(`:skull: Zginąłeś w walce z ${boss.name_pl}!`, 'system');
        }

        setResult({
            won: false,
            playerHpLeft: 0,
            turns: 0,
            drops: [],
            gold: 0,
            xp: 0,
        });
        useCombatStore.getState().clearCombatSession();
        clearBots();
        setTimeout(() => setPhase('result'), 500);
    }, [addLog, clearBots]);

    const doManualSkill = useCallback((slotIdx: 0 | 1 | 2 | 3) => {
        if (phaseRef.current !== 'fighting') return;
        if (bossHpRef.current <= 0) return;
        if (isCombatantStunned(effectsRef.current, PLAYER_FX_ID)) return;
        const slots = useSkillStore.getState().activeSkillSlots;
        const skillId = slots[slotIdx];
        if (!skillId) return;
        if (isNonLeaderMember) {
            const myId = useCharacterStore.getState().character?.id;
            if (!myId) return;
            usePartyCombatSyncStore.getState().publishMemberSkillRequest(myId, skillId);
            const def = getSkillDef(skillId);
            const cdMs = def?.cooldown ?? SKILL_COOLDOWN_MS;
            skillCooldownRef.current.set(skillId, Date.now());
            void cdMs;
            return;
        }
        const now = Date.now();
        const lastUsed = skillCooldownRef.current.get(skillId) ?? 0;
        if (now - lastUsed < getSpeedScaledCooldownMs(resolveSkillRecastMs(skillId, SKILL_COOLDOWN_MS), speedMult)) return;
        if (playerMpRef.current < SKILL_MP_COST) {
            addLog('Za mało MP!', 'system');
            return;
        }
        const sDefGate = getSkillDef(skillId);
        if ((sDefGate?.effect ?? '').includes('death_apocalypse')) {
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
                addLog(`:broken-heart: Apokalipsa: -${lost} HP (kanał życia)`, 'system');
            }
        }
        const sDef = getSkillDef(skillId);
        const skillBaseMult = sDef?.damage ?? 0;
        const isDamageHit = skillBaseMult > 0;
        const targetsEnemy = isDamageHit || skillTargetsEnemy(sDef?.effect ?? null);
        const apply = effectsCastSkill({
            session: effectsRef.current,
            casterId: PLAYER_FX_ID,
            targetId: BOSS_FX_ID,
            targetHpPct: scaledBossMaxHp > 0 ? (bossHpRef.current / scaledBossMaxHp) * 100 : 100,
            effect: sDef?.effect ?? null,
            allyIds: [PLAYER_FX_ID, ...botsRef.current.filter((b) => b.alive).map((b) => b.id)],
            enemyIds: [BOSS_FX_ID],
        });
        const defPenFracBoss = Math.max(0, Math.min(1, (apply.defPenPct ?? 0) / 100));
        const partyAtkMultManual = 1 + getActivePartyAtkPct() / 100;
        const baseDmg = isDamageHit ? Math.max(
            1,
            Math.floor(mitigateDamage(charAtk, Math.max(0, scaledBossRef.current.defense * (1 - defPenFracBoss)), character?.level ?? 1, true) * rollSkillDamageMult(skillBaseMult, useSkillStore.getState().skillUpgradeLevels[skillId] ?? 0) * partyAtkMultManual * getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier()),
        ) : 0;
        const normalSkillDmgBoss = Math.floor(baseDmg * apply.castDmgMult);
        let skillDmg = isDamageHit
            ? (apply.instantKill
                ? bossHpRef.current
                : ((apply.executeBurstPct ?? 0) > 0
                    ? Math.max(normalSkillDmgBoss, Math.floor(scaledBossMaxHp * (apply.executeBurstPct ?? 0) / 100))
                    : normalSkillDmgBoss))
            : 0;
        if (isDamageHit && skillDmg > 0) {
            const bossSt = ensureStatus(effectsRef.current, BOSS_FX_ID);
            const ampBoss = consumeTargetMarkAmp(bossSt);
            if (ampBoss.mult !== 1) {
                skillDmg = Math.max(1, Math.floor(skillDmg * ampBoss.mult));
                addLog(`:skull-and-crossbones: Klątwa Śmierci: ${formatSkillName(skillId)} ×${ampBoss.mult} dmg`, 'system');
            }
        }
        const afterSkill = Math.max(0, bossHpRef.current - skillDmg);
        bossHpRef.current = afterSkill;
        setBossHp(afterSkill);
        const newMp = Math.max(0, playerMpRef.current - SKILL_MP_COST);
        playerMpRef.current = newMp;
        setPlayerMp(newMp);
        skillCooldownRef.current.set(skillId, now);
        setSkillCooldowns((prev) => ({ ...prev, [skillId]: resolveSkillRecastMs(skillId, SKILL_COOLDOWN_MS) }));
        { const sd = getSkillDef(skillId); if (sd) applySkillBuff(skillId, sd, speedMult); }
        if (apply.healCasterPctOfDmg > 0 && skillDmg > 0) {
            const heal = Math.floor(skillDmg * (apply.healCasterPctOfDmg / 100));
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
        if (apply.healCasterPctOfMaxHp > 0) {
            const heal = Math.floor(charMaxHp * (apply.healCasterPctOfMaxHp / 100));
            const before = playerHpRef.current;
            playerHpRef.current = Math.min(charMaxHp, playerHpRef.current + heal);
            setPlayerHp(playerHpRef.current);
            const actual = playerHpRef.current - before;
            if (actual > 0) {
                fx.pushAllyFloat(0, actual, 'heal', { icon: 'sparkles' });
            }
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
        if (apply.healPartyPctInstant > 0) {
            const heal = Math.floor(charMaxHp * (apply.healPartyPctInstant / 100));
            playerHpRef.current = Math.min(charMaxHp, playerHpRef.current + heal);
            setPlayerHp(playerHpRef.current);
        }
        void apply.aoe; void apply.multistrike;
        if (apply.summons.length > 0 && character?.class === 'Necromancer') {
            for (const s of apply.summons) {
                const spawned = useNecroSummonStore.getState().spawn(
                    PLAYER_FX_ID,
                    s.type,
                    s.count,
                    charAtk,
                    charMaxHp,
                );
                if (spawned > 0) fx.triggerAllySummonSpawn(0, s.type);
            }
        }
        if (apply.deathApocalypse) {
            const apocDmg = Math.max(1, Math.floor(scaledBossMaxHp * (apply.deathApocalypseTargetMaxHpPct / 100)));
            const newBossHp = Math.max(0, bossHpRef.current - apocDmg);
            bossHpRef.current = newBossHp;
            setBossHp(newBossHp);
            setMonsterHitPulse((p) => p + 1);
            fx.pushEnemyFloat(0, apocDmg, 'spell', { icon: 'skull-and-crossbones', label: 'APOKALIPSA', isCrit: true });
            addLog(`:skull-and-crossbones: Apokalipsa Śmierci: ${apocDmg} dmg`, 'system');
            if (newBossHp <= 0) handleBossDeath();
        }
        triggerSkillAnim(skillId);
        if (!targetsEnemy) {
            fx.triggerAllySkillAnim(0, skillId);
            addLog(`:sparkles: ${formatSkillName(skillId)}: BUFF (-${SKILL_MP_COST} MP)`, 'player');
            if (isLeaderInPartyCombat) {
                const sidCapBuff = skillId;
                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                    usePartyCombatSyncStore.getState().publishBossDamage({
                        attackerId: 'player',
                        attackerClass: character?.class as TCharacterClass,
                        targetId: 'player',
                        damage: 0,
                        kind: 'heal',
                        icon: getSkillIcon(sidCapBuff),
                        label: 'BUFF',
                        skillId: sidCapBuff,
                    });
                }).catch(() => { });
            }
        } else {
            if (isDamageHit) {
                fx.pushEnemyFloat(0, skillDmg, 'spell', { icon: getSkillIcon(skillId) });
                showFloatingDmg(`-${skillDmg}`, 'player');
                addLog(`:sparkles: ${formatSkillName(skillId)}: ${skillDmg} dmg (-${SKILL_MP_COST} MP)`, 'player');
            } else {
                addLog(`:sparkles: ${formatSkillName(skillId)}: DEBUFF (-${SKILL_MP_COST} MP)`, 'player');
            }
            if (isLeaderInPartyCombat) {
                const sidCap = skillId;
                const dmgCap = isDamageHit ? skillDmg : 0;
                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                    usePartyCombatSyncStore.getState().publishBossDamage({
                        attackerId: 'player',
                        attackerClass: character?.class as TCharacterClass,
                        targetId: 'boss',
                        damage: dmgCap,
                        kind: 'spell',
                        icon: getSkillIcon(sidCap),
                        skillId: sidCap,
                    });
                }).catch(() => { });
            }
            if (apply.stunApplied) {
                fx.pushEnemyFloat(0, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
            } else if (apply.paralyzeApplied) {
                fx.pushEnemyFloat(0, 0, 'spell', { icon: 'locked', label: 'PARAL' });
            }
        }
        if (apply.reviveDeadAllies) {
            const allBots = bots;
            const revivedNames: string[] = [];
            for (let i = 0; i < allBots.length; i++) {
                const bot = allBots[i];
                if (!bot.alive) {
                    const reviveHp = Math.max(1, Math.floor(bot.maxHp * 0.5));
                    updateBotHp(bot.id, reviveHp);
                    revivedNames.push(bot.name);
                    fx.pushAllyFloat(i + 1, reviveHp, 'heal', { icon: 'sparkles', label: '+REZ' });
                    fx.triggerAllySkillAnim(i + 1, skillId);
                }
            }
            if (revivedNames.length > 0) {
                addLog(`:sparkles: ${formatSkillName(skillId)}: wskrzeszono ${revivedNames.join(', ')}`, 'system');
            }
        }
        if ((apply.multistrike ?? 0) > 0) {
            const extra = Math.max(0, Math.floor(apply.multistrike));
            for (let n = 0; n < extra; n++) {
                window.setTimeout(() => {
                    if (phaseRef.current !== 'fighting' || bossHpRef.current <= 0) return;
                    const wRoll = rollWeaponDamage();
                    const followup = Math.max(1, Math.floor(mitigateDamage(charAtk + wRoll, Math.max(0, scaledBossRef.current.defense * (1 - defPenFracBoss)), character?.level ?? 1, true) * getAtkDamageMultiplier() * getTransformDmgMultiplier()));
                    bossHpRef.current = Math.max(0, bossHpRef.current - followup);
                    setBossHp(bossHpRef.current);
                    fx.pushEnemyFloat(0, followup, 'basic');
                    addLog(`:bow-and-arrow:×${n + 2} ${followup} dmg`, 'player');
                    if (bossHpRef.current <= 0) handleBossDeath();
                }, 120 * (n + 1));
            }
        }
        if (character) {
            useSkillStore.getState().addMlvlXpFromSkill(character.class);
        }
        if (afterSkill <= 0) {
            handleBossDeath();
        }
    }, [addLog, charAtk, character, handleBossDeath, showFloatingDmg, fx]);

    const doPlayerAttack = useCallback(() => {
        if (phaseRef.current !== 'fighting') return;
        if (bossHpRef.current <= 0) return;
        if (playerHpRef.current <= 0) return;
        if (isCombatantStunned(effectsRef.current, PLAYER_FX_ID)) return;
        const boss = activeBossRef.current;
        if (!boss) return;

        const isDualWield = !!bossClassesMap[character?.class ?? '']?.dualWield;
        const sDef = scaledBossRef.current.defense;
        const sMaxHp = scaledBossRef.current.hp;

        const doSingleHit = (hand: 'left' | 'right' | undefined, weaponRollFn: () => number, dmgPercent: number) => {
            if (bossHpRef.current <= 0 || phaseRef.current !== 'fighting') return 0;
            const wRoll = Math.floor(weaponRollFn() * dmgPercent);
            const totalAtk = charAtk + wRoll;
            const baseDmg = mitigateDamage(totalAtk, sDef, character?.level ?? 1, true);
            const variance = Math.floor(baseDmg * 0.2);
            const rolledDmg = Math.max(1, baseDmg - variance + Math.floor(Math.random() * (variance * 2 + 1)));
            const playerStatus = ensureStatus(effectsRef.current, PLAYER_FX_ID);
            const mods = consumeCasterBasicHitMods(playerStatus);
            syncCasterChargeConsume(mods.consumed);
            const baseCrit = mods.forceCrit
                ? true
                : Math.random() < mods.extraCritChance;
            const critMult = baseCrit ? 2.0 : 1.0;
            let finalDmg = Math.max(1, Math.floor(rolledDmg * critMult * mods.dmgMult * getAtkDamageMultiplier() * getTransformDmgMultiplier()));
            const bossStBasic = ensureStatus(effectsRef.current, BOSS_FX_ID);
            const ampBasic = consumeTargetMarkAmp(bossStBasic);
            if (ampBasic.mult !== 1) {
                finalDmg = Math.max(1, Math.floor(finalDmg * ampBasic.mult));
                addLog(`:skull-and-crossbones: Klątwa Śmierci! ×${ampBasic.mult} dmg`, 'player');
            }

            const newBossHp = Math.max(0, bossHpRef.current - finalDmg);
            bossHpRef.current = newBossHp;
            setBossHp(newBossHp);

            setMonsterHitPulse((p) => p + 1);
            setPlayerAttacking(true);
            const animDur = ATTACK_ANIM_DURATION[character?.class ?? ''] ?? 350;
            setTimeout(() => { setPlayerAttacking(false); }, animDur);

            if (hand) {
                showFloatingDmg(`:dagger: -${finalDmg}`, 'player', hand);
            } else {
                showFloatingDmg(`-${finalDmg}`, 'player');
            }
            fx.pushEnemyFloat(0, finalDmg, 'basic', { icon: hand ? 'dagger' : undefined });
            if (character?.id) {
                void import('../../stores/partyDamageStore').then(({ usePartyDamageStore }) => {
                    usePartyDamageStore.getState().addDamage(character.id, finalDmg);
                }).catch(() => { });
            }
            if (isLeaderInPartyCombat) {
                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                    usePartyCombatSyncStore.getState().publishBossDamage({
                        attackerId: 'player',
                        attackerClass: character?.class as TCharacterClass,
                        targetId: 'boss',
                        damage: finalDmg,
                        isCrit: baseCrit,
                        kind: 'basic',
                        icon: hand ? 'dagger' : undefined,
                    });
                }).catch(() => { });
            }

            const handPrefix = hand === 'left' ? '[Lewa] ' : hand === 'right' ? '[Prawa] ' : '';
            addLog(`${handPrefix}Atakujesz za ${finalDmg} dmg (Boss HP: ${newBossHp.toLocaleString('pl-PL')}/${sMaxHp.toLocaleString('pl-PL')})`, 'player');
            return finalDmg;
        };

        if (isDualWield) {
            doSingleHit('left', rollWeaponDamage, 0.6);
            setTimeout(() => {
                if (phaseRef.current !== 'fighting' || bossHpRef.current <= 0) return;
                doSingleHit('right', rollOffHandDamage, 0.6);
                if (bossHpRef.current <= 0) {
                    handleBossDeath();
                }
            }, 150);
        } else {
            const baseDmg = mitigateDamage(charAtk, sDef, character?.level ?? 1, true);
            const variance = Math.floor(baseDmg * 0.2);
            const rolledDmg = Math.max(1, baseDmg - variance + Math.floor(Math.random() * (variance * 2 + 1)));
            const partyAtkMult = 1 + getActivePartyAtkPct() / 100;
            const finalDmg = Math.max(1, Math.floor(rolledDmg * partyAtkMult * getAtkDamageMultiplier() * getTransformDmgMultiplier()));

            const newBossHp = Math.max(0, bossHpRef.current - finalDmg);
            bossHpRef.current = newBossHp;
            setBossHp(newBossHp);

            setMonsterHitPulse((p) => p + 1);
            setPlayerAttacking(true);
            const animDur = ATTACK_ANIM_DURATION[character?.class ?? ''] ?? 350;
            setTimeout(() => { setPlayerAttacking(false); }, animDur);
            showFloatingDmg(`-${finalDmg}`, 'player');
            fx.pushEnemyFloat(0, finalDmg, 'basic');
            if (character?.id) {
                void import('../../stores/partyDamageStore').then(({ usePartyDamageStore }) => {
                    usePartyDamageStore.getState().addDamage(character.id, finalDmg);
                }).catch(() => { });
            }
            if (isLeaderInPartyCombat) {
                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                    usePartyCombatSyncStore.getState().publishBossDamage({
                        attackerId: 'player',
                        attackerClass: character?.class as TCharacterClass,
                        targetId: 'boss',
                        damage: finalDmg,
                        kind: 'basic',
                    });
                }).catch(() => { });
            }
            addLog(`Atakujesz za ${finalDmg} dmg (Boss HP: ${newBossHp.toLocaleString('pl-PL')}/${sMaxHp.toLocaleString('pl-PL')})`, 'player');
        }

        if (character?.class === 'Necromancer') {
            const liveSummons = bots;
            void liveSummons;
            const list = useNecroSummonStore.getState().summons[PLAYER_FX_ID] ?? [];
            if (list.length > 0) {
                const SUMMON_TYPE_RANK = { skeleton: 0, ghost: 1, demon: 2, lich: 3 } as const;
                const SUMMON_ICON: Record<'skeleton' | 'ghost' | 'demon' | 'lich', string> = {
                    skeleton: 'skull-and-crossbones', ghost: 'ghost', demon: 'smiling-face-with-horns', lich: 'crown',
                };
                const sortedSummons = [...list].sort(
                    (a, b) => SUMMON_TYPE_RANK[a.type] - SUMMON_TYPE_RANK[b.type],
                );
                sortedSummons.forEach((sm, idx) => {
                    setTimeout(() => {
                        if (phaseRef.current !== 'fighting' || bossHpRef.current <= 0) return;
                        const summonRaw = Math.floor(charAtk * sm.dmgMult);
                        let summonDmg = mitigateDamage(summonRaw, Math.floor(sDef * 0.5), character?.level ?? 1, true);
                        const bossStSum = ensureStatus(effectsRef.current, BOSS_FX_ID);
                        const ampSum = consumeTargetMarkAmp(bossStSum);
                        if (ampSum.mult !== 1) {
                            summonDmg = Math.max(1, Math.floor(summonDmg * ampSum.mult));
                        }
                        const newHpAfter = Math.max(0, bossHpRef.current - summonDmg);
                        bossHpRef.current = newHpAfter;
                        setBossHp(newHpAfter);
                        setMonsterHitPulse((p) => p + 1);
                        fx.pushEnemyFloat(0, summonDmg, 'ally-basic', { icon: SUMMON_ICON[sm.type] });
                        addLog(`:skull: ${sm.type}: ${summonDmg} dmg`, 'player');
                        if (newHpAfter <= 0) handleBossDeath();
                    }, 80 + idx * 100);
                });
            }
        }

        if (character) {
            useSkillStore.getState().addWeaponSkillXpFromAttack(character.class);
            useSkillStore.getState().addMlvlXpFromAttack(character.class);
        }

        if (bossHpRef.current > 0 && useSettingsStore.getState().skillMode === 'auto') {
            const now = Date.now();
            const slots = useSkillStore.getState().activeSkillSlots;
            for (let i = 0; i < 4; i++) {
                const skillId = slots[i];
                if (!skillId) continue;
                const lastUsed = skillCooldownRef.current.get(skillId) ?? 0;
                if (now - lastUsed < getSpeedScaledCooldownMs(resolveSkillRecastMs(skillId, SKILL_COOLDOWN_MS), speedMult)) continue;
                if (playerMpRef.current < SKILL_MP_COST) continue;
                const liveCh = useCharacterStore.getState().character;
                const unlockLvl = getSkillDef(skillId)?.unlockLevel ?? 0;
                if (liveCh && unlockLvl > 0 && liveCh.level < unlockLvl) continue;
                {
                    const tmpDef = getSkillDef(skillId);
                    if ((tmpDef?.effect ?? '').includes('death_apocalypse')) {
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
                            addLog(`:broken-heart: Apokalipsa: -${lost} HP (kanał życia)`, 'system');
                        }
                    }
                }
                const sDef = getSkillDef(skillId);
                const skillBaseMult = sDef?.damage ?? 1;
                const isPureBuff = skillBaseMult === 0;
                const apply = effectsCastSkill({
                    session: effectsRef.current,
                    casterId: PLAYER_FX_ID,
                    targetId: BOSS_FX_ID,
                    targetHpPct: scaledBossMaxHp > 0 ? (bossHpRef.current / scaledBossMaxHp) * 100 : 100,
                    effect: sDef?.effect ?? null,
                    allyIds: [PLAYER_FX_ID],
                    enemyIds: [BOSS_FX_ID],
                });
                const partyAtkMultAuto = 1 + getActivePartyAtkPct() / 100;
                const defPenFracAuto = Math.max(0, Math.min(1, (apply.defPenPct ?? 0) / 100));
                let skillDmg = isPureBuff ? 0 : Math.max(1, Math.floor(mitigateDamage(charAtk, Math.max(0, scaledBossRef.current.defense * (1 - defPenFracAuto)), character?.level ?? 1, true) * rollSkillDamageMult(skillBaseMult, useSkillStore.getState().skillUpgradeLevels[skillId] ?? 0) * partyAtkMultAuto * getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier()));
                if (!isPureBuff && skillDmg > 0) {
                    const bossSt = ensureStatus(effectsRef.current, BOSS_FX_ID);
                    const ampAuto = consumeTargetMarkAmp(bossSt);
                    if (ampAuto.mult !== 1) {
                        skillDmg = Math.max(1, Math.floor(skillDmg * ampAuto.mult));
                        addLog(`:skull-and-crossbones: Klątwa Śmierci! ${formatSkillName(skillId)} ×${ampAuto.mult} dmg`, 'system');
                    }
                }
                const afterSkill = isPureBuff ? bossHpRef.current : Math.max(0, bossHpRef.current - skillDmg);
                bossHpRef.current = afterSkill;
                setBossHp(afterSkill);
                const newMp = Math.max(0, playerMpRef.current - SKILL_MP_COST);
                playerMpRef.current = newMp;
                setPlayerMp(newMp);
                skillCooldownRef.current.set(skillId, now);
                setSkillCooldowns((prev) => ({ ...prev, [skillId]: resolveSkillRecastMs(skillId, SKILL_COOLDOWN_MS) }));
                if (sDef) applySkillBuff(skillId, sDef, speedMult);
                triggerSkillAnim(skillId);
                if (isPureBuff) {
                    fx.triggerAllySkillAnim(0, skillId);
                    addLog(`:sparkles: ${formatSkillName(skillId)}: BUFF (-${SKILL_MP_COST} MP)`, 'player');
                } else {
                    fx.pushEnemyFloat(0, skillDmg, 'spell', { icon: getSkillIcon(skillId) });
                    addLog(`:sparkles: ${formatSkillName(skillId)}: ${skillDmg} dmg (-${SKILL_MP_COST} MP)`, 'player');
                }
                if (isLeaderInPartyCombat) {
                    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                        if (isPureBuff) {
                            usePartyCombatSyncStore.getState().publishBossDamage({
                                attackerId: 'player',
                                attackerClass: character?.class as TCharacterClass,
                                targetId: 'player',
                                damage: 0,
                                kind: 'heal',
                                icon: getSkillIcon(skillId),
                                label: 'BUFF',
                                skillId,
                            });
                        } else {
                            usePartyCombatSyncStore.getState().publishBossDamage({
                                attackerId: 'player',
                                attackerClass: character?.class as TCharacterClass,
                                targetId: 'boss',
                                damage: skillDmg,
                                kind: 'spell',
                                icon: getSkillIcon(skillId),
                                skillId,
                            });
                        }
                    }).catch(() => { });
                }

                if (apply.summons.length > 0 && character?.class === 'Necromancer') {
                    for (const sm of apply.summons) {
                        const spawned = useNecroSummonStore.getState().spawn(
                            PLAYER_FX_ID, sm.type, sm.count, charAtk, charMaxHp, charMaxMp,
                        );
                        if (spawned > 0) {
                            fx.triggerAllySkillAnim(0, skillId);
                            fx.triggerAllySummonSpawn(0, sm.type);
                            fx.pushAllyFloat(0, spawned, 'heal', {
                                icon: 'skull',
                                label: `+${spawned}× ${sm.type.toUpperCase()}`,
                            });
                            addLog(`:skull: ${formatSkillName(skillId)}: przywołano ${spawned}× ${sm.type}`, 'system');
                        }
                    }
                }
                if (apply.deathApocalypse) {
                    const apocDmg = Math.max(1, Math.floor(scaledBossMaxHp * (apply.deathApocalypseTargetMaxHpPct / 100)));
                    const newBossHp = Math.max(0, bossHpRef.current - apocDmg);
                    bossHpRef.current = newBossHp;
                    setBossHp(newBossHp);
                    setMonsterHitPulse((p) => p + 1);
                    fx.pushEnemyFloat(0, apocDmg, 'spell', { icon: 'skull-and-crossbones', label: 'APOKALIPSA', isCrit: true });
                    addLog(`:skull-and-crossbones: Apokalipsa Śmierci: ${apocDmg} dmg`, 'system');
                    if (newBossHp <= 0) handleBossDeath();
                }
                if (apply.healCasterPctOfDmg > 0 && skillDmg > 0) {
                    const heal = Math.floor(skillDmg * (apply.healCasterPctOfDmg / 100));
                    if (heal > 0) {
                        const before = playerHpRef.current;
                        playerHpRef.current = Math.min(charMaxHp, before + heal);
                        setPlayerHp(playerHpRef.current);
                        const actual = playerHpRef.current - before;
                        const cappedTag = actual < heal ? ' (MAX)' : '';
                        fx.pushAllyFloat(0, heal, 'heal', {
                            icon: 'sparkles',
                            label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                        });
                        addLog(`:sparkles: ${formatSkillName(skillId)}: +${heal} HP${cappedTag}`, 'system');
                    }
                }
                if (apply.healCasterPctOfMaxHp > 0) {
                    const heal = Math.floor(charMaxHp * (apply.healCasterPctOfMaxHp / 100));
                    const before = playerHpRef.current;
                    playerHpRef.current = Math.min(charMaxHp, before + heal);
                    setPlayerHp(playerHpRef.current);
                    const actual = playerHpRef.current - before;
                    if (actual > 0) {
                        fx.pushAllyFloat(0, actual, 'heal', { icon: 'sparkles' });
                    }
                }
                if (apply.healLowestAllyPct > 0) {
                    const heal = Math.floor(charMaxHp * (apply.healLowestAllyPct / 100));
                    const before = playerHpRef.current;
                    playerHpRef.current = Math.min(charMaxHp, before + heal);
                    setPlayerHp(playerHpRef.current);
                    const actual = playerHpRef.current - before;
                    if (heal > 0) {
                        const cappedTag = actual < heal ? ' (MAX)' : '';
                        fx.pushAllyFloat(0, heal, 'heal', {
                            icon: 'sparkles',
                            label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                        });
                        fx.triggerAllySkillAnim(0, skillId);
                    }
                }
                if (apply.healPartyPctInstant > 0) {
                    const heal = Math.floor(charMaxHp * (apply.healPartyPctInstant / 100));
                    if (heal > 0) {
                        const before = playerHpRef.current;
                        playerHpRef.current = Math.min(charMaxHp, before + heal);
                        setPlayerHp(playerHpRef.current);
                        const actual = playerHpRef.current - before;
                        const cappedTag = actual < heal ? ' (MAX)' : '';
                        fx.pushAllyFloat(0, heal, 'heal', {
                            icon: 'sparkles',
                            label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                        });
                        fx.triggerAllySkillAnim(0, skillId);
                    }
                    if (character?.class === 'Necromancer') {
                        useNecroSummonStore.getState().healAllPct(PLAYER_FX_ID, apply.healPartyPctInstant);
                    }
                }
                if (apply.reviveDeadAllies) {
                    const allBots = bots;
                    for (let bi = 0; bi < allBots.length; bi++) {
                        const bot = allBots[bi];
                        if (!bot.alive) {
                            const reviveHp = Math.max(1, Math.floor(bot.maxHp * 0.5));
                            updateBotHp(bot.id, reviveHp);
                            fx.pushAllyFloat(bi + 1, reviveHp, 'heal', { icon: 'sparkles', label: '+REZ' });
                            fx.triggerAllySkillAnim(bi + 1, skillId);
                            addLog(`:sparkles: ${formatSkillName(skillId)}: wskrzeszono ${bot.name}`, 'system');
                        }
                    }
                }
                if (apply.partyImmortalMs > 0) {
                    fx.triggerAllySkillAnim(0, skillId);
                    fx.pushAllyFloat(0, 0, 'heal', { icon: 'sparkles', label: 'IMMORTAL' });
                }

                if (!isPureBuff && afterSkill <= 0) { handleBossDeath(); return; }
                break;
            }
        }

        tryAutoPotion();

        if (bossHpRef.current <= 0) {
            handleBossDeath();
        }
    }, [charAtk, addLog, showFloatingDmg, handleBossDeath, tryAutoPotion, character, fx]);

    const dealDamageToBot = useCallback((botId: string, damage: number, bossName: string, kind: 'monster' | 'monster-spell' = 'monster', icon?: string): boolean => {
        const currentBots = botsRef.current;
        const bot = currentBots.find((b) => b.id === botId && b.alive);
        if (!bot) return false;
        const botStatus = effectsRef.current.statuses.get(botId);
        let scaledDamage = damage;
        if (botStatus && botStatus.immortalMs > 0) scaledDamage = 0;
        else if (botStatus && botStatus.defBuffMs > 0 && botStatus.defBuffPct > 0) {
            scaledDamage = Math.max(0, Math.floor(damage * (1 - botStatus.defBuffPct / 100)));
        }
        const newHp = Math.max(0, bot.hp - scaledDamage);
        updateBotHp(botId, newHp);
        setBotHitPulses((prev) => ({ ...prev, [botId]: (prev[botId] ?? 0) + 1 }));
        const botIdx = currentBots.findIndex((b) => b.id === botId);
        if (botIdx >= 0) {
            fx.pushAllyFloat(botIdx + 1, damage, kind, { icon });
        }
        const iconLabel = getBotLogIcon(bot.class);
        if (newHp <= 0) {
            killBot(botId);
            addLog(`${bossName} zabija ${iconLabel} ${bot.name}! (-${damage} dmg)`, 'monster');
        } else {
            addLog(`${bossName} atakuje ${iconLabel} ${bot.name} za ${damage} dmg (HP: ${newHp}/${bot.maxHp})`, 'monster');
        }
        return true;
    }, [updateBotHp, killBot, addLog, fx]);

    const routeIncomingNecroDmg = useCallback((rawDmg: number, kind: 'single' | 'aoe'): number => {
        if (rawDmg <= 0) return 0;
        if (character?.class !== 'Necromancer') return rawDmg;
        const store = useNecroSummonStore.getState();
        if (store.count(PLAYER_FX_ID) <= 0) return rawDmg;
        if (kind === 'aoe') {
            store.damageAll(PLAYER_FX_ID, rawDmg);
            return rawDmg;
        }
        const r = store.damageFirst(PLAYER_FX_ID, rawDmg);
        return Math.max(0, rawDmg - r.dmgConsumed);
    }, [character?.class]);

    const applyUtamoDamageToPlayer = useCallback((rawDmg: number): { newPHp: number; hpDmg: number; mpDmg: number; shieldActive: boolean } => {
        const ps = effectsRef.current.statuses.get(PLAYER_FX_ID);
        if (ps && ps.immortalMs > 0) {
            fx.pushAllyFloat(0, 0, 'heal', { icon: 'sparkles', label: 'BLOCK' });
            addLog(`:sparkles: BLOCK! Niewrażliwość chroni przed atakiem`, 'block');
            return { newPHp: playerHpRef.current, hpDmg: 0, mpDmg: 0, shieldActive: false };
        }
        if (ps && ps.defBuffMs > 0 && ps.defBuffPct > 0) {
            rawDmg = Math.max(0, Math.floor(rawDmg * (1 - ps.defBuffPct / 100)));
        }
        let hpDmg = rawDmg;
        let mpDmg = 0;
        if (ps && ps.manaShieldMs > 0 && rawDmg > 0) {
            const mpAvail = Math.max(0, playerMpRef.current);
            const ms = Math.min(rawDmg, mpAvail);
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
        const hasUtamo = useBuffStore.getState().hasBuff('utamo_vita');
        if (hasUtamo && playerMpRef.current > 0 && hpDmg > 0) {
            const utamoMp = Math.floor(hpDmg * 0.5);
            let actualMp = utamoMp;
            let leftover = 0;
            if (actualMp > playerMpRef.current) {
                leftover = actualMp - playerMpRef.current;
                actualMp = playerMpRef.current;
            }
            mpDmg += actualMp;
            hpDmg = hpDmg - utamoMp + leftover;
            const newMp = Math.max(0, playerMpRef.current - actualMp);
            playerMpRef.current = newMp;
            setPlayerMp(newMp);
            if (newMp <= 0) {
                useBuffStore.getState().removeBuffByEffect('utamo_vita');
                addLog(':blue-circle: Utamo Vita peka! Brak many.', 'system');
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
        if (!character) return;
        const playerAlive = playerHpRef.current > 0;
        const anyBotAlive = botsRef.current.some((b) => b.alive);
        if (!playerAlive && !anyBotAlive) return;
        if (aggroTargetRef.current === 'player' && !playerAlive) {
            const aliveBots = botsRef.current.filter((b) => b.alive);
            if (aliveBots.length > 0) {
                aggroTargetRef.current = aliveBots[Math.floor(Math.random() * aliveBots.length)].id;
            }
        } else if (aggroTargetRef.current !== 'player') {
            const currentBot = botsRef.current.find((b) => b.id === aggroTargetRef.current);
            if (!currentBot || !currentBot.alive) {
                if (playerAlive) {
                    aggroTargetRef.current = 'player';
                } else {
                    const aliveBots = botsRef.current.filter((b) => b.alive);
                    if (aliveBots.length > 0) {
                        aggroTargetRef.current = aliveBots[Math.floor(Math.random() * aliveBots.length)].id;
                    }
                }
            }
        }
        if (isCombatantStunned(effectsRef.current, BOSS_FX_ID)) return;
        if (useBuffStore.getState().getBuffCharges('skill_charge_dodge_next') > 0) {
            useBuffStore.getState().consumeBuffCharge('skill_charge_dodge_next');
            addLog(`Boss atakuje – Krok Cienia! Unik!`, 'dodge');
            return;
        }
        if (useBuffStore.getState().getBuffCharges('skill_charge_block_next_party') > 0) {
            useBuffStore.getState().consumeBuffCharge('skill_charge_block_next_party');
            fx.pushAllyFloat(0, 0, 'heal', { icon: 'shield', label: 'BLOCK' });
            addLog(`:shield: Boska Tarcza! Blok!`, 'system');
            return;
        }
        const bossPlayerSt = ensureStatus(effectsRef.current, PLAYER_FX_ID);
        if (bossPlayerSt.dodgeBuffMs > 0 && bossPlayerSt.dodgeBuffPct > 0) {
            if (Math.random() * 100 < bossPlayerSt.dodgeBuffPct) {
                fx.pushAllyFloat(0, 0, 'heal', { icon: 'dashing-away', label: 'UNIK' });
                addLog(`:dashing-away: Bomba Dymna! Unik (${bossPlayerSt.dodgeBuffPct}%)`, 'system');
                return;
            }
        }
        const boss = activeBossRef.current;
        if (!boss) return;

        spellCounterRef.current++;
        bossTurnCounterRef.current++;

        const sAtk = scaledBossRef.current.attack;
        const sMaxHp = scaledBossRef.current.hp;
        const phaseMult = getBossPhaseMultiplier(bossHpRef.current / sMaxHp);

        if (isBossAoeTurn(bossTurnCounterRef.current)) {
            addLog(`:collision: ${boss.name_pl} wykonuje ATAK OBSZAROWY!`, 'boss-spell');

            const aoeDmgPlayer = calculateAoeDamage(Math.floor(sAtk * phaseMult), charDef, boss.level);
            if (character?.class === 'Necromancer' && useNecroSummonStore.getState().count(PLAYER_FX_ID) > 0) {
                useNecroSummonStore.getState().damageAll(PLAYER_FX_ID, aoeDmgPlayer);
            }
            const aoeResult = applyUtamoDamageToPlayer(aoeDmgPlayer);
            setPlayerHitPulse((p) => p + 1);
            showFloatingDmg(`-${aoeDmgPlayer} AOE${aoeResult.shieldActive ? 'blue-circle' : ''}`, 'monster');
            fx.pushAllyFloat(0, aoeDmgPlayer, 'monster-spell', { icon: 'collision' });
            const ptyForAoe = usePartyStore.getState().party;
            const meIdForAoe = useCharacterStore.getState().character?.id ?? '';
            const otherHumansForAoe = (ptyForAoe?.members.filter((m) => m.id !== meIdForAoe && !m.isBot) ?? []).length;
            const aoeBroadcastEnabled = !!(ptyForAoe && ptyForAoe.leaderId === meIdForAoe && otherHumansForAoe > 0);
            if (aoeBroadcastEnabled) {
                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                    usePartyCombatSyncStore.getState().publishBossDamage({
                        attackerId: 'boss',
                        targetId: 'player',
                        damage: aoeDmgPlayer,
                        kind: 'monster-spell',
                        icon: 'collision',
                    });
                }).catch(() => { });
            }
            const aoeSuffix = aoeResult.shieldActive ? ` :blue-circle: (${aoeResult.hpDmg} HP / ${aoeResult.mpDmg} MP)` : '';
            addLog(`  Ty: -${aoeDmgPlayer} dmg${aoeSuffix} (HP: ${aoeResult.newPHp}/${charMaxHp})`, 'monster');

            const currentBots = botsRef.current;
            for (let bIdx = 0; bIdx < currentBots.length; bIdx++) {
                const bot = currentBots[bIdx];
                if (!bot.alive) continue;
                const aoeDmgBot = calculateAoeDamage(Math.floor(sAtk * phaseMult), bot.defense, boss.level);
                const newBotHp = Math.max(0, bot.hp - aoeDmgBot);
                updateBotHp(bot.id, newBotHp);
                setBotHitPulses((prev) => ({ ...prev, [bot.id]: (prev[bot.id] ?? 0) + 1 }));
                fx.pushAllyFloat(bIdx + 1, aoeDmgBot, 'monster-spell', { icon: 'collision' });
                if (aoeBroadcastEnabled) {
                    const botIdCapture = bot.id;
                    const aoeDmgCapture = aoeDmgBot;
                    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                        usePartyCombatSyncStore.getState().publishBossDamage({
                            attackerId: 'boss',
                            targetId: botIdCapture,
                            damage: aoeDmgCapture,
                            kind: 'monster-spell',
                            icon: 'collision',
                        });
                    }).catch(() => { });
                }
                const icon = getBotLogIcon(bot.class);
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

        if (Date.now() >= aggroSwitchAtRef.current) {
            const candidates = [
                { id: 'player', class: character.class },
                ...botsRef.current.filter((b) => b.alive).map((b) => ({ id: b.id, class: b.class })),
            ];
            aggroTargetRef.current = pickAggroTarget(candidates);
            aggroSwitchAtRef.current = Date.now() + BOSS_AGGRO_SWITCH_INTERVAL_MS;
        }

        const useSpell = spellCounterRef.current % 4 === 0 || (enraged && spellCounterRef.current % 3 === 0);

        if (useSpell) {
            const spell = pickBossSpell(boss);

            if (spell.type === 'damage') {
                const target = aggroTargetRef.current;
                const baseDmg = mitigateDamage(sAtk, target === 'player' ? charDef : (botsRef.current.find((b) => b.id === target)?.defense ?? 0), boss.level);
                const spellDmg = Math.max(1, Math.floor(baseDmg * spell.power));

                const ptyForSpell = usePartyStore.getState().party;
                const meIdForSpell = useCharacterStore.getState().character?.id ?? '';
                const otherHumansForSpell = (ptyForSpell?.members.filter((m) => m.id !== meIdForSpell && !m.isBot) ?? []).length;
                const spellBroadcastEnabled = !!(ptyForSpell && ptyForSpell.leaderId === meIdForSpell && otherHumansForSpell > 0);

                if (target === 'player') {
                    const playerDmg = routeIncomingNecroDmg(spellDmg, 'single');
                    const newPHp = Math.max(0, playerHpRef.current - playerDmg);
                    playerHpRef.current = newPHp;
                    setPlayerHp(newPHp);
                    setPlayerHitPulse((p) => p + 1);
                    showFloatingDmg(`-${spellDmg} ${spell.icon}`, 'monster');
                    fx.pushAllyFloat(0, spellDmg, 'monster-spell', { icon: spell.icon });
                    if (spellBroadcastEnabled) {
                        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                            usePartyCombatSyncStore.getState().publishBossDamage({
                                attackerId: 'boss',
                                targetId: 'player',
                                damage: spellDmg,
                                kind: 'monster-spell',
                                icon: spell.icon,
                            });
                        }).catch(() => { });
                    }
                    addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name} na Ciebie: ${spellDmg} dmg! (HP: ${newPHp}/${charMaxHp})`, 'boss-spell');
                    if (newPHp <= 0) { handlePlayerDeath(); return; }
                    tryAutoPotion();
                } else {
                    const bot = botsRef.current.find((b) => b.id === target && b.alive);
                    if (bot) {
                        const newBotHp = Math.max(0, bot.hp - spellDmg);
                        updateBotHp(target, newBotHp);
                        setBotHitPulses((prev) => ({ ...prev, [bot.id]: (prev[bot.id] ?? 0) + 1 }));
                        const botIdx = botsRef.current.findIndex((b) => b.id === bot.id);
                        if (botIdx >= 0) {
                            fx.pushAllyFloat(botIdx + 1, spellDmg, 'monster-spell', { icon: spell.icon });
                        }
                        if (spellBroadcastEnabled) {
                            const botIdCap = bot.id;
                            const spellDmgCap = spellDmg;
                            const spellIconCap = spell.icon;
                            void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                usePartyCombatSyncStore.getState().publishBossDamage({
                                    attackerId: 'boss',
                                    targetId: botIdCap,
                                    damage: spellDmgCap,
                                    kind: 'monster-spell',
                                    icon: spellIconCap,
                                });
                            }).catch(() => { });
                        }
                        const icon = getBotLogIcon(bot.class);
                        if (newBotHp <= 0) {
                            killBot(target);
                            addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name} na ${icon} ${bot.name}: ${spellDmg} dmg! POLEGŁ!`, 'boss-spell');
                        } else {
                            addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name} na ${icon} ${bot.name}: ${spellDmg} dmg! (HP: ${newBotHp}/${bot.maxHp})`, 'boss-spell');
                        }
                    } else {
                        aggroTargetRef.current = 'player';
                        const playerDmg = routeIncomingNecroDmg(spellDmg, 'single');
                        const newPHp = Math.max(0, playerHpRef.current - playerDmg);
                        playerHpRef.current = newPHp;
                        setPlayerHp(newPHp);
                        setPlayerHitPulse((p) => p + 1);
                        showFloatingDmg(`-${spellDmg} ${spell.icon}`, 'monster');
                        fx.pushAllyFloat(0, spellDmg, 'monster-spell', { icon: spell.icon });
                        addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name} na Ciebie: ${spellDmg} dmg! (HP: ${newPHp}/${charMaxHp})`, 'boss-spell');
                        if (newPHp <= 0) { handlePlayerDeath(); return; }
                        tryAutoPotion();
                    }
                }
            } else if (spell.type === 'heal') {
                const healAmount = Math.floor(sMaxHp * spell.power);
                const bossSt = ensureStatus(effectsRef.current, BOSS_FX_ID);
                const hr = applyIncomingHeal(bossSt, healAmount);
                if (hr.hpDelta < 0) {
                    const reversed = -hr.hpDelta;
                    const newBossHp = Math.max(0, bossHpRef.current - reversed);
                    bossHpRef.current = newBossHp;
                    setBossHp(newBossHp);
                    fx.pushEnemyFloat(0, reversed, 'spell', { icon: 'skull-and-crossbones' });
                    addLog(`:skull-and-crossbones: Naznaczony na Śmierć: ${boss.name_pl} próbuje się leczyć ale traci ${reversed.toLocaleString('pl-PL')} HP!`, 'boss-spell');
                    if (newBossHp <= 0) {
                        handleBossDeath();
                    }
                } else {
                    const newBossHp = Math.min(sMaxHp, bossHpRef.current + hr.hpDelta);
                    bossHpRef.current = newBossHp;
                    setBossHp(newBossHp);
                    showFloatingDmg(`+${hr.hpDelta} ${spell.icon}`, 'heal');
                    fx.pushEnemyFloat(0, hr.hpDelta, 'heal', { icon: spell.icon });
                    addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name}: leczy się za ${hr.hpDelta.toLocaleString('pl-PL')} HP!`, 'boss-spell');
                }
            } else if (spell.type === 'buff') {
                addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name}: wzmacnia się!`, 'boss-spell');
            }
            return;
        }

        if (aggroTargetRef.current === 'player' && playerHpRef.current <= 0) {
            const aliveBots = botsRef.current.filter((b) => b.alive);
            if (aliveBots.length > 0) {
                aggroTargetRef.current = aliveBots[Math.floor(Math.random() * aliveBots.length)].id;
            }
        }
        const target = aggroTargetRef.current;
        const targetDef = target === 'player' ? charDef : (botsRef.current.find((b) => b.id === target && b.alive)?.defense ?? 0);
        const rolled = rollMonsterDamage({
            attack: sAtk,
            attack_min: scaledBossRef.current.attack_min,
            attack_max: scaledBossRef.current.attack_max,
        });
        const finalDmg = Math.max(1, Math.floor(mitigateDamage(rolled, targetDef, boss.level) * phaseMult));
        const enragedText = phaseMult > 1 ? ' \uD83D\uDD25' : '';

        if (target === 'player') {
            const playerDmg = routeIncomingNecroDmg(finalDmg, 'single');
            const newPHp = Math.max(0, playerHpRef.current - playerDmg);
            playerHpRef.current = newPHp;
            setPlayerHp(newPHp);
            setPlayerHitPulse((p) => p + 1);
            showFloatingDmg(`-${finalDmg}`, 'monster');
            fx.pushAllyFloat(0, finalDmg, 'monster');
            const ptyForBoss = usePartyStore.getState().party;
            const meIdForBoss = useCharacterStore.getState().character?.id ?? '';
            const otherHumansForBoss = (ptyForBoss?.members.filter((m) => m.id !== meIdForBoss && !m.isBot) ?? []).length;
            if (ptyForBoss && ptyForBoss.leaderId === meIdForBoss && otherHumansForBoss > 0) {
                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                    usePartyCombatSyncStore.getState().publishBossDamage({
                        attackerId: 'boss',
                        targetId: 'player',
                        damage: finalDmg,
                        kind: 'monster',
                    });
                }).catch(() => { });
            }
            addLog(`${boss.name_pl} atakuje Cię za ${finalDmg} dmg${enragedText} (HP: ${newPHp}/${charMaxHp})`, 'monster');
            if (newPHp > 0) { tryAutoPotion(); }
            if (newPHp <= 0) { handlePlayerDeath(); }
        } else {
            const bot = botsRef.current.find((b) => b.id === target && b.alive);
            if (bot) {
                dealDamageToBot(bot.id, finalDmg, boss.name_pl + enragedText);
                const ptyForBoss = usePartyStore.getState().party;
                const meIdForBoss = useCharacterStore.getState().character?.id ?? '';
                const otherHumansForBoss = (ptyForBoss?.members.filter((m) => m.id !== meIdForBoss && !m.isBot) ?? []).length;
                if (ptyForBoss && ptyForBoss.leaderId === meIdForBoss && otherHumansForBoss > 0) {
                    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                        usePartyCombatSyncStore.getState().publishBossDamage({
                            attackerId: 'boss',
                            targetId: bot.id,
                            damage: finalDmg,
                            kind: 'monster',
                        });
                    }).catch(() => { });
                }
            } else {
                aggroTargetRef.current = 'player';
                const playerDmg = routeIncomingNecroDmg(finalDmg, 'single');
                const newPHp = Math.max(0, playerHpRef.current - playerDmg);
                playerHpRef.current = newPHp;
                setPlayerHp(newPHp);
                setPlayerHitPulse((p) => p + 1);
                showFloatingDmg(`-${finalDmg}`, 'monster');
                fx.pushAllyFloat(0, finalDmg, 'monster');
                addLog(`${boss.name_pl} atakuje Cię za ${finalDmg} dmg${enragedText} (HP: ${newPHp}/${charMaxHp})`, 'monster');
                if (newPHp > 0) { tryAutoPotion(); }
                if (newPHp <= 0) { handlePlayerDeath(); }
            }
        }
    }, [charDef, charMaxHp, addLog, showFloatingDmg, handlePlayerDeath, handleBossDeath, enraged, tryAutoPotion, updateBotHp, killBot, dealDamageToBot, fx, routeIncomingNecroDmg, character?.class]);

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

            const humanPartyMatesForCanSkill = usePartyStore.getState().party?.members.filter(
                (m) => m.id !== character?.id && !m.isBot,
            ) ?? [];
            const matchedHumanIdxForCanSkill = botsRef.current.findIndex((b) => b.id === bot.id);
            const matchedHumanForCanSkill = matchedHumanIdxForCanSkill >= 0
                ? humanPartyMatesForCanSkill[matchedHumanIdxForCanSkill]
                : null;
            const memSkillMode: 'auto' | 'manual' = matchedHumanForCanSkill
                ? (usePartyPresenceStore.getState().byMember[matchedHumanForCanSkill.id]?.skillMode ?? 'auto')
                : 'auto';
            const canUseSkill = (() => {
                if (!bot.skillId) return false;
                if (memSkillMode === 'manual') return false;
                const lastUsed = botSkillCooldownsRef.current.get(bot.id) ?? 0;
                return (now - lastUsed) >= bot.skillCooldownMs;
            })();

            let botForAction = bot;
            let manualOverrideSkillId: string | null = null;
            if (matchedHumanForCanSkill) {
                const wantedId = usePartyCombatSyncStore.getState().consumeMemberSkillRequest(matchedHumanForCanSkill.id);
                if (wantedId) {
                    const def = getSkillDef(wantedId);
                    if (def) {
                        manualOverrideSkillId = wantedId;
                        botForAction = {
                            ...bot,
                            skillId: wantedId,
                            skillDamageMultiplier: def.damage ?? 0,
                            skillMpCost: def.mpCost ?? 0,
                            skillCooldownMs: def.cooldown ?? 5000,
                        };
                    }
                }
            }

            const sDef = scaledBossRef.current.defense;
            const bossForCalc = { ...boss, defense: sDef };
            const canUseSkillFinal = manualOverrideSkillId
                ? botForAction.mp >= botForAction.skillMpCost
                : canUseSkill;
            const action = calculateBotAction(botForAction, bossForCalc, canUseSkillFinal);
            const icon = getBotLogIcon(bot.class);

            const newBossHp = Math.max(0, bossHpRef.current - action.damage);
            bossHpRef.current = newBossHp;
            setBossHp(newBossHp);

            const humanPartyMatesForBot = usePartyStore.getState().party?.members.filter(
                (m) => m.id !== character?.id && !m.isBot,
            ) ?? [];
            const matchedHumanIdx = botsRef.current.findIndex((b) => b.id === bot.id);
            const matchedHuman = matchedHumanIdx >= 0 ? humanPartyMatesForBot[matchedHumanIdx] : null;
            const dmgAttributedTo = matchedHuman?.id ?? bot.id;

            if (action.type === 'skill' && botForAction.skillId) {
                botSkillCooldownsRef.current.set(bot.id, now);
                const newMp = Math.max(0, bot.mp - botForAction.skillMpCost);
                updateBotMp(bot.id, newMp);
                addLog(`${icon} ${bot.name} rzuca ${action.skillName}: ${action.damage} dmg (Boss HP: ${newBossHp.toLocaleString('pl-PL')})`, 'player');
                fx.pushEnemyFloat(0, action.damage, 'ally-spell', { icon: getSkillIcon(botForAction.skillId) });
                void import('../../stores/partyDamageStore').then(({ usePartyDamageStore }) => {
                    usePartyDamageStore.getState().addDamage(dmgAttributedTo, action.damage);
                }).catch(() => { });
                if (isLeaderInPartyCombat) {
                    const sid = botForAction.skillId!;
                    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                        usePartyCombatSyncStore.getState().publishBossDamage({
                            attackerId: bot.id,
                            attackerClass: bot.class,
                            targetId: 'boss',
                            damage: action.damage,
                            kind: 'ally-spell',
                            icon: getSkillIcon(sid),
                            skillId: sid,
                        });
                    }).catch(() => { });
                }
            } else {
                addLog(`${icon} ${bot.name} atakuje za ${action.damage} dmg (Boss HP: ${newBossHp.toLocaleString('pl-PL')})`, 'player');
                fx.pushEnemyFloat(0, action.damage, 'ally-basic');
                void import('../../stores/partyDamageStore').then(({ usePartyDamageStore }) => {
                    usePartyDamageStore.getState().addDamage(dmgAttributedTo, action.damage);
                }).catch(() => { });
                if (isLeaderInPartyCombat) {
                    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                        usePartyCombatSyncStore.getState().publishBossDamage({
                            attackerId: bot.id,
                            attackerClass: bot.class,
                            targetId: 'boss',
                            damage: action.damage,
                            kind: 'ally-basic',
                        });
                    }).catch(() => { });
                }
            }

            const animMs = ATTACK_ANIM_DURATION[bot.class] ?? 320;
            setBotAttackingClass(bot.class);
            setMonsterHitPulse((p) => p + 1);
            window.setTimeout(() => setBotAttackingClass((c) => c === bot.class ? null : c), animMs);


            if (newBossHp <= 0) {
                handleBossDeath();
                return;
            }
        }
    }, [addLog, handleBossDeath, updateBotMp, fx]);

    const wipeForcedRef = useRef(false);
    useEffect(() => {
        if (wipeForcedRef.current) return;
        if (phase !== 'fighting' && phase !== 'result') return;
        const playerAliveNow = playerHp > 0;
        const anyBotAliveNow = bots.some((b) => b.alive);
        if (!playerAliveNow && !anyBotAliveNow) {
            wipeForcedRef.current = true;
            setDeathChoicePopup(false);
            void (async () => {
                try {
                    const me = useCharacterStore.getState().character?.id;
                    if (me) await usePartyStore.getState().leaveParty(me);
                } catch { }
            })();
            handlePlayerDeath(true);
        }
    }, [phase, playerHp, bots, handlePlayerDeath]);

    useEffect(() => {
        if (phaseRef.current !== 'fighting') return;
        if (!party || !character) return;
        if (party.leaderId !== character.id) return;
        const partyIds = new Set(party.members.map((m) => m.id));
        const localBots = botsRef.current;
        const departedBotIds: string[] = [];
        const survivors: typeof localBots = [];
        for (const b of localBots) {
            if (b.representsCharacterId && !partyIds.has(b.representsCharacterId)) {
                departedBotIds.push(b.id);
            } else {
                survivors.push(b);
            }
        }
        if (departedBotIds.length === 0) return;
        useBotStore.setState({ bots: survivors });
        if (departedBotIds.includes(aggroTargetRef.current)) {
            const aliveSurvivors = survivors.filter((b) => b.alive);
            if (aliveSurvivors.length > 0) {
                aggroTargetRef.current = aliveSurvivors[
                    Math.floor(Math.random() * aliveSurvivors.length)
                ].id;
            } else {
                aggroTargetRef.current = 'player';
            }
            aggroSwitchAtRef.current = Date.now();
        }
        fx.resetAllyFx();
    }, [party, character?.id, fx]);

    const playerAtkRef = useRef(doPlayerAttack);
    const bossAtkRef   = useRef(doBossAttack);
    const botAtkRef    = useRef(doBotAttacks);
    useEffect(() => { playerAtkRef.current = doPlayerAttack; });
    useEffect(() => { bossAtkRef.current   = doBossAttack; });
    useEffect(() => { botAtkRef.current    = doBotAttacks; });
    const charSpeedRef = useRef(charSpeed);
    charSpeedRef.current = charSpeed;

    useEffect(() => {
        if (!isLeaderInPartyCombat) return;
        if (!activeBoss) return;
        if (phase === 'list') return;

        const meId = character?.id ?? '';
        const liveBots = useBotStore.getState().bots;
        const humanPartyMates = party?.members.filter((m) => m.id !== meId) ?? [];
        const allies: import('../../stores/partyCombatSyncStore').IPartyBossAlly[] = [
            {
                id: meId,
                class: character?.class as TCharacterClass,
                name: character?.name ?? '',
                level: character?.level ?? 1,
                hp: playerHpRef.current,
                maxHp: charMaxHp,
                mp: playerMpRef.current,
                maxMp: charMaxMp,
                isDead: playerHpRef.current <= 0,
                isLeader: true,
                representsCharacterId: meId,
            },
            ...liveBots.map((bot, idx) => {
                const humanMate = humanPartyMates[idx];
                const isHuman = !!humanMate && !humanMate.isBot;
                return {
                    id: bot.id,
                    class: bot.class,
                    name: isHuman ? humanMate.name : bot.name,
                    level: isHuman ? humanMate.level : bot.level,
                    hp: bot.hp,
                    maxHp: bot.maxHp,
                    mp: bot.mp,
                    maxMp: bot.maxMp,
                    isDead: !bot.alive,
                    isLeader: false,
                    representsCharacterId: isHuman ? humanMate.id : undefined,
                };
            }),
        ];

        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            import('../../stores/partyDamageStore').then(({ usePartyDamageStore }) => {
                usePartyCombatSyncStore.getState().publishBossState({
                    bossId: activeBoss.id,
                    bossHp,
                    scaledBossMaxHp,
                    phase,
                    won: phase === 'result' ? !!result?.won : undefined,
                    earnedXp: phase === 'result' && result?.won ? result.xp : undefined,
                    earnedGold: phase === 'result' && result?.won ? result.gold : undefined,
                    allies,
                    aggroTargetId: aggroTargetRef.current ?? undefined,
                    partyDamage: { ...usePartyDamageStore.getState().damage },
                    speedMode,
                });
            }).catch(() => { });
        }).catch(() => { });
    }, [isLeaderInPartyCombat, activeBoss, bossHp, scaledBossMaxHp, phase, result, playerHp, playerMp, bots, speedMode]);

    const lastBossKilledSeenRef = useRef(0);
    useEffect(() => {
        if (!isNonLeaderMember) return;
        const unsub = (async () => {
            const { usePartyCombatSyncStore } = await import('../../stores/partyCombatSyncStore');
            lastBossKilledSeenRef.current = usePartyCombatSyncStore.getState().lastBossKilled?.sentAt ?? 0;
            return usePartyCombatSyncStore.subscribe((state) => {
                const ev = state.lastBossKilled;
                if (!ev) return;
                if (ev.sentAt === lastBossKilledSeenRef.current) return;
                lastBossKilledSeenRef.current = ev.sentAt;
                const meId = useCharacterStore.getState().character?.id ?? '';
                if (!meId) return;
                if (!ev.aliveMemberIds.includes(meId)) return;
                useBossStore.getState().setBossDefeated(ev.bossId);
            });
        })();
        return () => { void unsub.then((fn) => fn?.()); };
    }, [isNonLeaderMember]);

    const lastBossDamageSeenRef = useRef<Record<string, unknown>>({});
    useEffect(() => {
        if (!isNonLeaderMember) return;
        const unsub = (async () => {
            const { usePartyCombatSyncStore } = await import('../../stores/partyCombatSyncStore');
            const initial = usePartyCombatSyncStore.getState().lastBossDamageByAttacker;
            for (const [k, v] of Object.entries(initial)) {
                lastBossDamageSeenRef.current[k] = v;
            }
            return usePartyCombatSyncStore.subscribe((state) => {
                const map = state.lastBossDamageByAttacker;
                if (!map) return;
                for (const [key, ev] of Object.entries(map)) {
                    if (ev === lastBossDamageSeenRef.current[key]) continue;
                    lastBossDamageSeenRef.current[key] = ev;

                    if (ev.attackerId !== 'boss' && ev.attackerId === ev.targetId) {
                        const localBotsForBuff = useBotStore.getState().bots;
                        let buffSlot: number;
                        if (ev.targetId === 'player') {
                            const leaderIdx = localBotsForBuff.findIndex((b) => b.isLeader);
                            buffSlot = leaderIdx >= 0 ? leaderIdx + 1 : 0;
                        } else {
                            const botIdx = localBotsForBuff.findIndex((b) => b.id === ev.targetId);
                            buffSlot = botIdx >= 0 ? botIdx + 1 : 0;
                        }
                        fx.pushAllyFloat(buffSlot, ev.damage, ev.kind ?? 'heal', {
                            icon: ev.icon,
                            label: ev.label,
                            isCrit: ev.isCrit,
                        });
                        if (ev.skillId) {
                            fx.triggerAllySkillAnim(buffSlot, ev.skillId);
                        }
                        continue;
                    }
                    if (ev.targetId === 'boss') {
                        fx.pushEnemyFloat(0, ev.damage, ev.kind ?? 'basic', {
                            icon: ev.icon,
                            label: ev.label,
                            isCrit: ev.isCrit,
                        });
                        if (ev.attackerClass) {
                            const animMs = ATTACK_ANIM_DURATION[ev.attackerClass] ?? 320;
                            setBotAttackingClass(ev.attackerClass);
                            window.setTimeout(
                                () => setBotAttackingClass((c) => c === ev.attackerClass ? null : c),
                                animMs,
                            );
                        }
                    }
                    if (ev.attackerId === 'boss') {
                        const localBotsForFx = useBotStore.getState().bots;
                        let fxSlot: number;
                        if (ev.targetId === 'player') {
                            const leaderIdx = localBotsForFx.findIndex((b) => b.isLeader);
                            fxSlot = leaderIdx >= 0 ? leaderIdx + 1 : 0;
                        } else {
                            const botIdx = localBotsForFx.findIndex((b) => b.id === ev.targetId);
                            if (botIdx === -1) {
                                fxSlot = 0;
                                setPlayerHitPulse((p) => p + 1);
                            } else {
                                fxSlot = botIdx + 1;
                                setBotHitPulses((m) => ({
                                    ...m,
                                    [ev.targetId]: (m[ev.targetId] ?? 0) + 1,
                                }));
                            }
                        }
                        fx.pushAllyFloat(fxSlot, ev.damage, ev.kind ?? 'monster', {
                            icon: ev.icon,
                            label: ev.label,
                            isCrit: ev.isCrit,
                        });
                    }
                }
            });
        })();
        return () => { void unsub.then((fn) => fn?.()); };
    }, [isNonLeaderMember, fx]);

    const lastSkipAppliedRef = useRef(0);
    useEffect(() => {
        if (!isNonLeaderMember) return;
        const unsub = (async () => {
            const { usePartyCombatSyncStore } = await import('../../stores/partyCombatSyncStore');
            return usePartyCombatSyncStore.subscribe((state) => {
                const ts = state.lastBossEntrySkipAt;
                if (!ts || ts === lastSkipAppliedRef.current) return;
                lastSkipAppliedRef.current = ts;
                const pending = bossEntryPendingRef.current;
                if (!pending) return;
                if (bossEntryTimeoutRef.current !== null) {
                    window.clearTimeout(bossEntryTimeoutRef.current);
                    bossEntryTimeoutRef.current = null;
                }
                bossEntryPendingRef.current = null;
                setBossEntryBoss(null);
                beginBossFight(pending.boss, pending.picks);
            });
        })();
        return () => { void unsub.then((fn) => fn?.()); };
    }, [isNonLeaderMember, beginBossFight]);

    const memberResultAppliedRef = useRef(false);
    const resultDeathAppliedRef = useRef(false);
    useEffect(() => {
        if (!isNonLeaderMember) return;
        memberResultAppliedRef.current = false;
        const unsub = (async () => {
            const { usePartyCombatSyncStore } = await import('../../stores/partyCombatSyncStore');
            return usePartyCombatSyncStore.subscribe((state, prev) => {
                const s = state.lastBossState;
                if (!s) return;
                if (prev.lastBossState && prev.lastBossState.seq === s.seq) return;
                const prevPhase = prev.lastBossState?.phase;
                if (prevPhase === 'result' && s.phase !== 'result') {
                    memberResultAppliedRef.current = false;
                }
                const def = (bossData as Array<{ id: string }>).find((b) => b.id === s.bossId);
                if (def) {
                    setActiveBoss(def as IBoss);
                    activeBossRef.current = def as IBoss;
                }
                if (prev.lastBossState && s.bossHp < prev.lastBossState.bossHp) {
                    setMonsterHitPulse((n) => n + 1);
                }
                setBossHp(s.bossHp);
                bossHpRef.current = s.bossHp;
                setScaledBossMaxHp(s.scaledBossMaxHp);
                setPhase(s.phase);
                phaseRef.current = s.phase;

                if (s.speedMode && (s.speedMode === 'x1' || s.speedMode === 'x2' || s.speedMode === 'x4')) {
                    setSpeedMode(s.speedMode);
                }

                if (s.aggroTargetId !== undefined) {
                    const meIdForAggro = useCharacterStore.getState().character?.id;
                    if (s.allies) {
                        const targetAlly = s.allies.find((a) => a.id === s.aggroTargetId);
                        if (targetAlly && targetAlly.representsCharacterId === meIdForAggro) {
                            aggroTargetRef.current = 'player';
                        } else {
                            aggroTargetRef.current = s.aggroTargetId;
                        }
                    } else {
                        aggroTargetRef.current = s.aggroTargetId;
                    }
                }

                const enteringFight = s.phase === 'fighting'
                    && prevPhase !== 'fighting';
                if (enteringFight) {
                    const liveCh = useCharacterStore.getState().character;
                    if (liveCh && ((liveCh.hp ?? 0) <= 0 || (liveCh.mp ?? 0) <= 0)) {
                        useCharacterStore.getState().fullHealEffective();
                    }
                    const finalCh = useCharacterStore.getState().character;
                    if (finalCh) {
                        const hp = Math.max(1, finalCh.hp ?? 1);
                        const mp = Math.max(0, finalCh.mp ?? 0);
                        setPlayerHp(hp);
                        playerHpRef.current = hp;
                        setPlayerMp(mp);
                        playerMpRef.current = mp;
                    }
                }

                if (s.partyDamage) {
                    void import('../../stores/partyDamageStore').then(({ usePartyDamageStore }) => {
                        const dmgState = usePartyDamageStore.getState();
                        for (const [memberId, total] of Object.entries(s.partyDamage!)) {
                            dmgState.setMemberDamage(memberId, total);
                        }
                    }).catch(() => { });
                }

                if (s.allies && s.allies.length > 0) {
                    const meId = useCharacterStore.getState().character?.id ?? '';
                    const prevSig = (prev.lastBossState?.allies ?? [])
                        .map((a) => a.representsCharacterId ?? a.id)
                        .join(',');
                    const nextSig = s.allies
                        .map((a) => a.representsCharacterId ?? a.id)
                        .join(',');
                    if (prevSig && prevSig !== nextSig) {
                        fx.resetAllyFx();
                    }

                    const meAlly = s.allies.find((a) => a.representsCharacterId === meId);
                    if (meAlly) {
                        const prevMeAlly = prev.lastBossState?.allies?.find(
                            (a) => a.representsCharacterId === meId,
                        );
                        if (prevMeAlly && meAlly.hp < prevMeAlly.hp) {
                            setPlayerHitPulse((n) => n + 1);
                        }
                        if (meAlly.hp !== playerHpRef.current) {
                            setPlayerHp(meAlly.hp);
                            playerHpRef.current = meAlly.hp;
                        }
                        if (meAlly.hp <= 0 && !deathChoiceShownRef.current) {
                            deathChoiceShownRef.current = true;
                            setDeathChoicePopup(true);
                        }
                        if (meAlly.mp !== playerMpRef.current) {
                            setPlayerMp(meAlly.mp);
                            playerMpRef.current = meAlly.mp;
                        }
                        const liveCh = useCharacterStore.getState().character;
                        if (liveCh && (liveCh.hp !== meAlly.hp || liveCh.mp !== meAlly.mp)) {
                            useCharacterStore.getState().updateCharacter({
                                hp: meAlly.hp,
                                mp: meAlly.mp,
                            });
                        }
                    }

                    const prevByCharId = new Map<string, typeof s.allies[number]>();
                    for (const a of (prev.lastBossState?.allies ?? [])) {
                        if (a.representsCharacterId) prevByCharId.set(a.representsCharacterId, a);
                        else prevByCharId.set(a.id, a);
                    }
                    for (const a of s.allies) {
                        if (a.representsCharacterId === meId) continue;
                        const key = a.representsCharacterId ?? a.id;
                        const prevA = prevByCharId.get(key);
                        if (prevA && a.hp < prevA.hp) {
                            setBotHitPulses((m) => ({ ...m, [a.id]: (m[a.id] ?? 0) + 1 }));
                        }
                    }

                    const visibleAllies = s.allies.filter(
                        (a) => a.representsCharacterId !== meId,
                    );
                    const mirroredBots: IBot[] = visibleAllies.map((a) => ({
                        id: a.id,
                        name: a.name,
                        class: a.class,
                        level: a.level,
                        hp: a.hp,
                        maxHp: a.maxHp,
                        mp: a.mp,
                        maxMp: a.maxMp,
                        attack: 0,
                        defense: 0,
                        attackSpeed: 1.5,
                        critChance: 0,
                        magicLevel: 0,
                        skillId: null,
                        skillDamageMultiplier: 1,
                        skillMpCost: 0,
                        skillCooldownMs: 0,
                        alive: !a.isDead,
                        representsCharacterId: a.representsCharacterId,
                        isLeader: a.isLeader,
                    }));
                    useBotStore.setState({ bots: mirroredBots });
                }

                if (s.phase === 'result' && !memberResultAppliedRef.current) {
                    memberResultAppliedRef.current = true;
                    if (s.won && typeof s.earnedXp === 'number' && typeof s.earnedGold === 'number') {
                        useBossStore.getState().setBossDefeated(s.bossId);
                        useCharacterStore.getState().addXp(s.earnedXp);
                        const ch = useCharacterStore.getState().character;
                        if (ch) {
                            useCharacterStore.getState().updateCharacter({
                                gold: (ch.gold ?? 0) + s.earnedGold,
                            });
                        }
                        const bossDef = (bossData as Array<{ id: string }>).find((b) => b.id === s.bossId) as IBoss | undefined;
                        const memberDrops = bossDef ? rollBossLoot(bossDef) : [];
                        setResult({
                            won: true,
                            playerHpLeft: playerHpRef.current,
                            turns: 0,
                            drops: memberDrops,
                            gold: s.earnedGold,
                            xp: s.earnedXp,
                        });
                    } else {
                        setResult({
                            won: !!s.won,
                            playerHpLeft: playerHpRef.current,
                            turns: 0,
                            drops: [],
                            gold: 0,
                            xp: 0,
                        });
                    }
                }
            });
        })();
        return () => {
            void unsub.then((fn) => fn?.());
        };
    }, [isNonLeaderMember]);

    useEffect(() => {
        if (phase !== 'result') return;
        if (resultDeathAppliedRef.current) return;
        if (leavePenaltyAppliedRef.current) return;
        const ch = useCharacterStore.getState().character;
        if (!ch) return;
        if ((ch.hp ?? 0) > 0) return;
        resultDeathAppliedRef.current = true;
        leavePenaltyAppliedRef.current = true;
        const boss = activeBossRef.current;
        const prot = consumeDeathProtection();
        useCharacterStore.getState().fullHealEffective();
        const oldLevel = ch.level;
        let newLevel = ch.level;
        let levelsLost = 0;
        let xpPercent = 100;
        let skillXpLossPercent = 0;
        if (prot.isProtected) {
            const protName = prot.consumedId === 'amulet_of_loss' ? 'Amulet of Loss' : 'Eliksir Ochrony';
            addLog(`:shield: ${protName} uchronił Cię przed wszelkimi stratami!`, 'system');
        } else {
            const penalty = applyDeathPenalty(ch.level, ch.xp);
            newLevel = penalty.newLevel;
            levelsLost = penalty.levelsLost;
            xpPercent = penalty.xpPercent;
            skillXpLossPercent = penalty.skillXpLossPercent;
            const currentHighest = ch.highest_level ?? ch.level;
            const preservedHighest = Math.max(currentHighest, ch.level);
            useCharacterStore.getState().updateCharacter({
                xp: penalty.newXp,
                level: penalty.newLevel,
                highest_level: preservedHighest,
            });
            useCharacterStore.getState().fullHealEffective();
            useSkillStore.getState().applyDeathPenalty(ch.class, penalty.skillXpLossPercent);
            useSkillStore.getState().purgeLockedSkillSlots(ch.class, penalty.newLevel);
            const itemsLost = useInventoryStore.getState().applyDeathItemLoss(false, ch.level);
            if (itemsLost > 0) {
                addLog(`:skull: Stracileś ${itemsLost} przedmiot(ow) przy śmierci!`, 'system');
            }
        }
        addLog(':skull: Nikt Cię nie wskrzesił — ginieesz.', 'system');
        useDeathStore.getState().triggerDeath({
            killedBy: boss?.name_pl ?? 'Boss',
            sourceLevel: boss?.level ?? ch.level,
            oldLevel,
            newLevel,
            levelsLost,
            xpPercent,
            skillXpLossPercent,
            protectionUsed: prot.isProtected,
            source: 'boss',
        });
        useCombatStore.getState().clearCombatSession();
        usePartyReadyCheckStore.getState().clear();
        clearBots();
        void (async () => {
            try {
                await usePartyStore.getState().leaveParty(ch.id);
            } catch { }
        })();
        navigate('/');
    }, [phase, addLog, clearBots, navigate]);

    useEffect(() => {
        if (phase !== 'fighting' || !activeBoss) return;
        if (isNonLeaderMember) return;
        let timeoutId: ReturnType<typeof setTimeout>;
        let cancelled = false;
        const scheduleNext = () => {
            if (cancelled) return;
            const effSpeed = charSpeedRef.current * getActivePartyAsMult();
            const interval = Math.max(200, getAttackMs(effSpeed) / speedMult);
            timeoutId = setTimeout(() => {
                if (cancelled) return;
                playerAtkRef.current();
                scheduleNext();
            }, interval);
        };
        scheduleNext();
        return () => { cancelled = true; clearTimeout(timeoutId); };
    }, [phase, activeBoss?.id, charSpeed, speedMult, isNonLeaderMember]);

    useEffect(() => {
        if (phase !== 'fighting' || !activeBoss) return;
        if (isNonLeaderMember) return;
        const bossSpeed = activeBoss.speed || 1.5;
        const interval = Math.max(200, getAttackMs(bossSpeed) / speedMult);
        const id = setInterval(() => bossAtkRef.current(), interval);
        return () => clearInterval(id);
    }, [phase, activeBoss?.id, speedMult, isNonLeaderMember]);

    useEffect(() => {
        if (phase !== 'fighting' || !activeBoss) return;
        if (isNonLeaderMember) return;
        const interval = Math.max(300, (getAttackMs(charSpeed) + 200) / speedMult);
        const id = setInterval(() => botAtkRef.current(), interval);
        return () => clearInterval(id);
    }, [phase, activeBoss?.id, charSpeed, speedMult, isNonLeaderMember]);

    useEffect(() => {
        if (phase !== 'fighting' || !activeBoss) return;
        if (isNonLeaderMember) return;
        const TICK_MS = 250;
        const id = setInterval(() => {
            const dotResults = effectsTickAll(
                effectsRef.current,
                [
                    { id: PLAYER_FX_ID, maxHp: charMaxHp },
                    { id: BOSS_FX_ID, maxHp: scaledBossMaxHp },
                ],
                TICK_MS * speedMult,
            );
            for (const r of dotResults) {
                if (r.id === PLAYER_FX_ID && r.dotDamage > 0) {
                    const apply = effectsRouteDamage(effectsRef.current, PLAYER_FX_ID, playerHpRef.current, r.dotDamage);
                    playerHpRef.current = Math.max(0, playerHpRef.current - apply.appliedDmg);
                    setPlayerHp(playerHpRef.current);
                }
                if (r.id === BOSS_FX_ID && r.dotDamage > 0) {
                    const apply = effectsRouteDamage(effectsRef.current, BOSS_FX_ID, bossHpRef.current, r.dotDamage);
                    bossHpRef.current = Math.max(0, bossHpRef.current - apply.appliedDmg);
                    setBossHp(bossHpRef.current);
                    if (apply.appliedDmg > 0) {
                        fx.pushEnemyFloat(0, apply.appliedDmg, 'spell', { icon: 'skull-and-crossbones' });
                        if (isLeaderInPartyCombat) {
                            const dotDmgCap = apply.appliedDmg;
                            void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                usePartyCombatSyncStore.getState().publishBossDamage({
                                    attackerId: 'player',
                                    targetId: 'boss',
                                    damage: dotDmgCap,
                                    kind: 'spell',
                                    icon: 'skull-and-crossbones',
                                });
                            }).catch(() => { });
                        }
                    }
                }
                if (r.id === BOSS_FX_ID && r.darkRitualTriggered && r.darkRitualDamage > 0) {
                    bossHpRef.current = Math.max(0, bossHpRef.current - r.darkRitualDamage);
                    setBossHp(bossHpRef.current);
                    fx.pushEnemyFloat(0, r.darkRitualDamage, 'spell', { icon: 'skull', label: 'RITUAL', isCrit: true });
                    if (isLeaderInPartyCombat) {
                        const ritDmgCap = r.darkRitualDamage;
                        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                            usePartyCombatSyncStore.getState().publishBossDamage({
                                attackerId: 'player',
                                targetId: 'boss',
                                damage: ritDmgCap,
                                kind: 'spell',
                                icon: 'skull',
                                label: 'RITUAL',
                                isCrit: true,
                            });
                        }).catch(() => { });
                    }
                }
                if (r.id === BOSS_FX_ID && bossHpRef.current <= 0 && phaseRef.current === 'fighting') {
                    handleBossDeath();
                    break;
                }
            }
        }, 250);
        return () => clearInterval(id);
    }, [phase, activeBoss?.id, speedMult, charMaxHp, scaledBossMaxHp, handleBossDeath, isNonLeaderMember]);

    if (!character) return <div className="boss"><Spinner size="lg" /></div>;

    return (
        <div className={`boss${phase === 'fighting' ? ' boss--fighting' : ''}`}>
            {backendFeedback && (
                <div
                    className="boss__backend-feedback"
                    role="status"
                    onClick={() => setBackendFeedback(null)}
                    style={{
                        margin: '8px auto',
                        maxWidth: '640px',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        background: 'rgba(0, 0, 0, 0.6)',
                        color: '#ffd54f',
                        textAlign: 'center',
                        cursor: 'pointer',
                    }}
                >
                    {backendFeedback}
                </div>
            )}
            <header className="boss__header boss__header--minimal">
                {phase === 'list' && (
                    <span className="boss__score"><GameIcon name="trophy" /> {getTotalScore().toLocaleString('pl-PL')}</span>
                )}
            </header>

            <AnimatePresence mode="wait">

                {phase === 'list' && (() => {
                    const gateLvlForFilter = getPartyGateLevel(character.level, party?.members ?? null);
                    let visibleBosses = bosses.slice();
                    if (bossFilterMinLevel > 0) {
                        visibleBosses = visibleBosses.filter((b) => b.level >= bossFilterMinLevel);
                    }
                    if (bossFilterAvailableOnly) {
                        visibleBosses = visibleBosses.filter(
                            (b) => b.level <= gateLvlForFilter && canChallenge(b.id),
                        );
                    }
                    if (bossFilterSortDesc) {
                        visibleBosses = visibleBosses.slice().sort((a, b) => b.level - a.level);
                    }
                    const anyBossFilterActive =
                        bossFilterAvailableOnly || bossFilterSortDesc || bossFilterMinLevel > 0;
                    return (
                    <motion.div key="list" className="boss__panel"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <section className="boss__hub-filters">
                            <h2 className="boss__hub-section-title">Filtry</h2>
                            <div className="boss__filter-bar">
                                <label
                                    className={`boss__filter-toggle${bossFilterAvailableOnly ? ' boss__filter-toggle--active' : ''}`}
                                    title="Pokaż tylko bossów, do których masz wymagany poziom i pozostałe próby"
                                >
                                    <input
                                        type="checkbox"
                                        checked={bossFilterAvailableOnly}
                                        onChange={(e) => setBossFilterAvailableOnly(e.target.checked)}
                                    />
                                    <span className="boss__filter-toggle-label">Tylko dostępne</span>
                                </label>
                                <label
                                    className={`boss__filter-toggle${bossFilterSortDesc ? ' boss__filter-toggle--active' : ''}`}
                                    title="Sortuj od najwyższego poziomu"
                                >
                                    <input
                                        type="checkbox"
                                        checked={bossFilterSortDesc}
                                        onChange={(e) => setBossFilterSortDesc(e.target.checked)}
                                    />
                                    <span className="boss__filter-toggle-label">Od najwyższego poziomu</span>
                                </label>
                                <label
                                    className="boss__filter-input"
                                    title="Pokaż bossów od podanego poziomu"
                                >
                                    <span className="boss__filter-input-label">Lvl od</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={1000}
                                        inputMode="numeric"
                                        value={bossFilterMinLevel || ''}
                                        placeholder="0"
                                        onChange={(e) =>
                                            setBossFilterMinLevel(parseInt(e.target.value, 10) || 0)
                                        }
                                    />
                                </label>
                                {anyBossFilterActive && (
                                    <button
                                        type="button"
                                        className="boss__filter-clear"
                                        onClick={() => {
                                            setBossFilterAvailableOnly(false);
                                            setBossFilterSortDesc(false);
                                            setBossFilterMinLevel(0);
                                        }}
                                        title="Wyczyść filtry"
                                    >
                                        <Icon name="x" /> Wyczyść
                                    </button>
                                )}
                            </div>
                        </section>

                        {visibleBosses.length === 0 && (
                            <div className="boss__filters-empty">
                                Żaden boss nie pasuje do filtrów.
                            </div>
                        )}

                        {visibleBosses.map((b) => {
                            const bossIdx = bosses.findIndex((x) => x.id === b.id);
                            const attemptsUsed = getAttemptsUsed(b.id);
                            const attemptsMax  = getAttemptsMax();
                            const noAttempts   = !canChallenge(b.id);
                            const gateLevel    = getPartyGateLevel(character.level, party?.members ?? null);
                            const tooLow       = gateLevel < b.level;
                            const blocked      = noAttempts || tooLow;
                            const allDone = attemptsUsed >= attemptsMax;
                            const cleared = getBossKillCount(b.id) > 0;
                            const cardBg = getBossCardImage(bossIdx);

                            return (
                                <div key={b.id} className={`boss__card${blocked ? ' boss__card--blocked' : ''}${allDone ? ' boss__card--all-done' : ''}${cardBg ? ' boss__card--has-bg' : ''}`}
                                    style={{
                                        '--card-hue': getBossCardHue(b.level),
                                        '--card-image': cardBg ? `url("${cardBg}")` : 'none',
                                    } as React.CSSProperties}>
                                    <div className="boss__card-level-badge">LVL {b.level}</div>
                                    {allDone && cleared && (
                                        <div className="boss__card-cleared-badge"><GameIcon name="check-mark-button" /> Pokonany</div>
                                    )}
                                    <div className="boss__card-top">
                                        <span className="boss__sprite">
                                            <BossSprite level={b.level} sprite={b.sprite} name={b.name_pl} style={{ objectFit: 'cover' }} />
                                        </span>
                                        <div className="boss__card-info">
                                            <div className="boss__card-name">{b.name_pl}</div>
                                        </div>
                                    </div>

                                    <p className="boss__card-desc">{b.description_pl}</p>

                                    <div className="boss__card-stats boss__card-stats--combat">
                                        <span><GameIcon name="red-heart" /> HP: {getScaledBossStats(b).hp.toLocaleString('pl-PL')}</span>
                                        <span><GameIcon name="crossed-swords" /> ATK: {getScaledBossStats(b).attack}</span>
                                        <span><GameIcon name="shield" /> DEF: {getScaledBossStats(b).defense}</span>
                                    </div>
                                    <div className="boss__card-stats boss__card-stats--rewards">
                                        <span className="boss__card-stat-gold">
                                            <GameIcon name="money-bag" /> {formatGoldShort(computeBossRewards(b.level).goldMin)}–{formatGoldShort(computeBossRewards(b.level).goldMax)}
                                        </span>
                                        <span><GameIcon name="star" /> XP: {getBossXp(b).toLocaleString('pl-PL')}</span>
                                        <button
                                            type="button"
                                            className="boss__drop-icon"
                                            onClick={() => setDropModalBoss(b.id)}
                                            aria-label="Pokaż drop table"
                                            title="Drop table"
                                        >
                                            <GameIcon name="package" />
                                        </button>
                                    </div>

                                    {b.abilities && b.abilities.length > 0 && (
                                        <div className="boss__abilities">
                                            <span className="boss__abilities-label">Spelle:</span>
                                            {b.abilities.map((a, i) => (
                                                <span key={i} className="boss__ability-tag">{formatItemName(a)}</span>
                                            ))}
                                        </div>
                                    )}

                                    <div className="boss__card-footer">
                                        <div className="boss__card-footer-row">
                                            <div className="boss__attempts">
                                                <span><GameIcon name="crossed-swords" /> {attemptsUsed}/{attemptsMax}</span>
                                                <div className="boss__attempts-bar">
                                                    <div
                                                        className={`boss__attempts-bar-fill${allDone ? ' boss__attempts-bar-fill--full' : ''}`}
                                                        style={{ width: `${(attemptsUsed / attemptsMax) * 100}%` }}
                                                    />
                                                </div>
                                            </div>
                                            {noAttempts && (
                                                <span className="boss__cooldown"><GameIcon name="cross-mark" /> Brak prób · reset o północy</span>
                                            )}
                                            {!noAttempts && tooLow && (
                                                <span className="boss__locked"><GameIcon name="locked" /> Lvl {b.level} wymagany</span>
                                            )}
                                        </div>
                                        {!blocked && (
                                            <button className="boss__challenge-btn" onClick={() => { void handleChallenge(b); }}>
                                                Wyzwij
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {dropModalBoss && (() => {
                            const b = bosses.find((x) => x.id === dropModalBoss);
                            if (!b) return null;
                            const itemTiers = getBossItemDropTiers(b.level);
                            const potionInfo = getPotionDropInfo(b.level);
                            const chestInfo = getSpellChestDropInfo(b.level);
                            return (
                                <div
                                    className="boss__modal-backdrop"
                                    onClick={() => setDropModalBoss(null)}
                                >
                                    <div
                                        className="boss__modal"
                                        onClick={(e) => e.stopPropagation()}
                                        style={{ '--card-hue': getBossCardHue(b.level) } as React.CSSProperties}
                                    >
                                        <div className="boss__modal-header">
                                            <span className="boss__modal-title"><TinyIcon icon={getSpellChestImage(1000) ?? 'package'} size="sm" /> {b.name_pl} · Drop table</span>
                                            <button
                                                className="boss__modal-close"
                                                onClick={() => setDropModalBoss(null)}
                                                aria-label="Zamknij"
                                            >
                                                <Icon name="x" />
                                            </button>
                                        </div>
                                        <div className="boss__modal-body">
                                            <div className="boss__drop-section">
                                                <div className="boss__drop-section-title"><GameIcon name="money-bag" /> Nagrody</div>
                                                <div className="boss__drop-info">
                                                    Gold: {formatGoldShort(computeBossRewards(b.level).goldMin)}–{formatGoldShort(computeBossRewards(b.level).goldMax)}
                                                </div>
                                                <div className="boss__drop-info">
                                                    XP: {getBossXp(b).toLocaleString('pl-PL')}
                                                </div>
                                                <div className="boss__drop-info">
                                                    Lvl itemów: {b.level}
                                                </div>
                                            </div>

                                            <div className="boss__drop-section">
                                                <div className="boss__drop-section-title"><TinyIcon icon={STONE_GENERIC_ICON} size="sm" /> Kamienie ulepszania</div>
                                                {BOSS_STONE_DROPS.map((stone) => {
                                                    const stoneColor = RARITY_LABELS[stone.rarity].color;
                                                    const stoneId = `${stone.rarity}_stone`;
                                                    return (
                                                        <div key={stone.name} className="boss__drop-tier">
                                                            <TinyIcon icon={STONE_ICONS[stoneId] ?? STONE_GENERIC_ICON} size="sm" />
                                                            <span className="boss__drop-tier-name" style={{ color: stoneColor }}>{stone.name}</span>
                                                            <span className="boss__drop-tier-chance">{stone.chance}%</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            <div className="boss__drop-section">
                                                <div className="boss__drop-section-title"><GameIcon name="backpack" /> Przedmioty (Lvl {b.level})</div>
                                                {itemTiers.map((tier) => (
                                                    <div key={tier.key} className="boss__drop-tier">
                                                        <span className="boss__drop-dot" style={{ background: tier.color, boxShadow: `0 0 4px ${tier.color}` }} />
                                                        <span className="boss__drop-tier-name" style={{ color: tier.color }}>{tier.label}</span>
                                                        <span className="boss__drop-tier-chance">{tier.chance}%</span>
                                                    </div>
                                                ))}
                                            </div>

                                            <div className="boss__drop-section">
                                                <div className="boss__drop-section-title"><TinyIcon icon={getPotionImage(null) ?? 'test-tube'} size="sm" /> Potiony</div>
                                                <div className="boss__drop-tier">
                                                    <span className="boss__drop-dot" style={{ background: '#e57373' }} />
                                                    <span className="boss__drop-tier-name" style={{ color: '#e57373' }}>
                                                        <TinyIcon icon={getPotionImage('hp_potion_sm') ?? 'red-heart'} size="sm" /> {potionInfo.hpLabel} ({potionInfo.hpHeal})
                                                    </span>
                                                    <span className="boss__drop-tier-chance">{(potionInfo.hpChance * 100).toFixed(2)}%</span>
                                                </div>
                                                <div className="boss__drop-tier">
                                                    <span className="boss__drop-dot" style={{ background: '#64b5f6' }} />
                                                    <span className="boss__drop-tier-name" style={{ color: '#64b5f6' }}>
                                                        <TinyIcon icon={getPotionImage('mp_potion_sm') ?? 'droplet'} size="sm" /> {potionInfo.mpLabel} ({potionInfo.mpHeal})
                                                    </span>
                                                    <span className="boss__drop-tier-chance">{(potionInfo.mpChance * 100).toFixed(2)}%</span>
                                                </div>
                                                {potionInfo.mega && (
                                                    <>
                                                        <div className="boss__drop-tier">
                                                            <span className="boss__drop-dot" style={{ background: '#ff5252' }} />
                                                            <span className="boss__drop-tier-name" style={{ color: '#ff5252' }}>
                                                                <TinyIcon icon={getPotionImage('hp_potion_mega') ?? 'heart-on-fire'} size="sm" /> {potionInfo.mega.hpLabel} ({potionInfo.mega.hpHeal})
                                                            </span>
                                                            <span className="boss__drop-tier-chance">{(potionInfo.mega.chance * 100).toFixed(2)}%</span>
                                                        </div>
                                                        <div className="boss__drop-tier">
                                                            <span className="boss__drop-dot" style={{ background: '#448aff' }} />
                                                            <span className="boss__drop-tier-name" style={{ color: '#448aff' }}>
                                                                <TinyIcon icon={getPotionImage('mp_potion_mega') ?? 'gem-stone'} size="sm" /> {potionInfo.mega.mpLabel} ({potionInfo.mega.mpHeal})
                                                            </span>
                                                            <span className="boss__drop-tier-chance">{(potionInfo.mega.chance * 100).toFixed(2)}%</span>
                                                        </div>
                                                    </>
                                                )}
                                            </div>

                                            {chestInfo.levels.length > 0 && (
                                                <div className="boss__drop-section">
                                                    <div className="boss__drop-section-title"><TinyIcon icon={getSpellChestImage(1000) ?? 'package'} size="sm" /> Spell Chests</div>
                                                    {chestInfo.levels.map((lvl) => (
                                                        <div key={lvl} className="boss__drop-tier">
                                                            <span className="boss__drop-dot" style={{ background: '#ab47bc' }} />
                                                            <span className="boss__drop-tier-name" style={{ color: '#ab47bc' }}>
                                                                <TinyIcon icon={getSpellChestIcon(lvl)} size="sm" /> Lvl {lvl}
                                                            </span>
                                                            <span className="boss__drop-tier-chance">{(chestInfo.baseChance * 200).toFixed(2)}%</span>
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
                                                            <GameIcon name={BOT_CLASS_ICONS[cls]} />
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
                                    <GameIcon name="crossed-swords" /> Rozpocznij walkę
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}

                {phase === 'fighting' && activeBoss && (() => {
                    const classColorFallbackMap: Record<string, string> = {
                        Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
                        Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
                    };
                    const playerAccent = classColorFallbackMap[character.class] ?? '#e94560';

                    const uiEnemies: Array<ICombatEnemy | null> = [
                        {
                            id: activeBoss.id,
                            name: activeBoss.name_pl,
                            level: activeBoss.level,
                            sprite: activeBoss.sprite ?? 'ogre',
                            kind: 'boss' as const,
                            currentHp: Math.max(0, bossHp),
                            maxHp: scaledBossMaxHp,
                            rarity: 'boss',
                            isDead: bossHp <= 0,
                            isTargetedByPlayer: true,
                            hitPulse: monsterHitPulse,
                            attackingClassName: playerAttacking
                                ? `attack-${character.class}`
                                : botAttackingClass
                                    ? `attack-${botAttackingClass}`
                                    : null,
                            floats: fx.enemyFloats[0] ?? [],
                            statusOverlay: (() => {
                                const st = effectsRef.current.statuses.get(BOSS_FX_ID);
                                if (!st) return undefined;
                                const top = st.markAmp.find((m) => m.count > 0 && m.remainingMs > 0);
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

                    const playerAggro = aggroTargetRef.current === 'player' ? 1 : 0;
                    const playerSummonList = necroSummons[PLAYER_FX_ID] ?? [];
                    const playerSummonsByType: Partial<Record<'skeleton' | 'ghost' | 'demon' | 'lich', number>> = {};
                    for (const s of playerSummonList) {
                        playerSummonsByType[s.type] = (playerSummonsByType[s.type] ?? 0) + 1;
                    }
                    const SUMMON_RANK_B = { skeleton: 0, ghost: 1, demon: 2, lich: 3 } as const;
                    const SUMMON_LABELS_B: Record<'skeleton' | 'ghost' | 'demon' | 'lich', string> = {
                        skeleton: 'Szkielet', ghost: 'Duch', demon: 'Demon', lich: 'Lisz',
                    };
                    const frontSummonB = playerSummonList.length > 0
                        ? [...playerSummonList].sort((a, b) => SUMMON_RANK_B[a.type] - SUMMON_RANK_B[b.type])[0]
                        : null;
                    const playerNameB = (character.class === 'Necromancer' && frontSummonB)
                        ? SUMMON_LABELS_B[frontSummonB.type]
                        : character.name;
                    const playerAvatarB = (character.class === 'Necromancer' && frontSummonB)
                        ? (getSummonImage(frontSummonB.type) ?? playerAvatarSrc)
                        : playerAvatarSrc;
                    const playerCurHpB = (character.class === 'Necromancer' && frontSummonB)
                        ? frontSummonB.hp
                        : Math.max(0, playerHp);
                    const playerMaxHpB = (character.class === 'Necromancer' && frontSummonB)
                        ? frontSummonB.maxHp
                        : charMaxHp;
                    const playerCurMpB = (character.class === 'Necromancer' && frontSummonB)
                        ? frontSummonB.mp
                        : Math.max(0, playerMp);
                    const playerMaxMpB = (character.class === 'Necromancer' && frontSummonB)
                        ? frontSummonB.maxMp
                        : charMaxMp;
                    const selfCard: ICombatAlly = {
                            id: 'player',
                            name: playerNameB,
                            avatarUrl: playerAvatarB,
                            accentColor: playerAccent,
                            className: character.class,
                            currentHp: playerCurHpB,
                            maxHp: playerMaxHpB,
                            currentMp: playerCurMpB,
                            maxMp: playerMaxMpB,
                            isDead: playerHp <= 0,
                            isPlayer: true,
                            level: character.level,
                            aggroCount: playerAggro,
                            hitPulse: playerHitPulse,
                            attackingClassName: null,
                            skillAnim: fx.allySkill[0] ?? null,
                            floats: fx.allyFloats[0] ?? [],
                            summonSpawn: fx.allySummonSpawn[0] ?? null,
                            summonCount: playerSummonList.length,
                            summonsByType: playerSummonsByType,
                            onSummonClick: (type) => {
                                useNecroSummonStore.getState().despawnOne(PLAYER_FX_ID, type);
                                addLog(`:dashing-away: Odesłano: ${type}`, 'system');
                            },
                    };
                    const botCards: ICombatAlly[] = bots.map<ICombatAlly>((bot, bIdx) => {
                            const humanPartyMates = party?.members.filter(
                                (m) => m.id !== character.id && !m.isBot,
                            ) ?? [];
                            const humanMate = humanPartyMates[bIdx];
                            const tier = humanMate
                                ? (presenceByMember[humanMate.id]?.transformTier ?? 0)
                                : 0;
                            const avatarUrl = humanMate
                                ? getCharacterAvatar(bot.class, tier > 0 ? [tier] : [])
                                : getCharacterAvatar(bot.class, []);
                            return {
                            id: bot.id,
                            name: humanMate?.name ?? bot.name,
                            avatarUrl,
                            accentColor: classColorFallbackMap[bot.class] ?? '#888',
                            className: bot.class,
                            currentHp: Math.max(0, bot.hp),
                            maxHp: bot.maxHp,
                            currentMp: Math.max(0, bot.mp),
                            maxMp: bot.maxMp,
                            isDead: !bot.alive,
                            isPlayer: false,
                            isBot: !humanMate,
                            level: humanMate?.level ?? bot.level,
                            aggroCount: aggroTargetRef.current === bot.id ? 1 : 0,
                            hitPulse: botHitPulses[bot.id] ?? 0,
                            attackingClassName: null,
                            skillAnim: fx.allySkill[bIdx + 1] ?? null,
                            floats: fx.allyFloats[bIdx + 1] ?? [],
                            };
                        });
                    const leaderBotIdx = botCards.findIndex(
                        (_, i) => bots[i]?.isLeader === true,
                    );
                    const uiAllies: Array<ICombatAlly | null> =
                        isNonLeaderMember && leaderBotIdx >= 0
                            ? [
                                botCards[leaderBotIdx],
                                selfCard,
                                ...botCards.filter((_, i) => i !== leaderBotIdx),
                            ]
                            : [selfCard, ...botCards];

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
                        potion: typeof bestHpPotion,
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
                    const pctHpSlot  = buildPotion(bestPctHpPotion, 'pct-hp', pctHpCooldown, PCT_POTION_CD_MS);
                    const pctMpSlot  = buildPotion(bestPctMpPotion, 'pct-mp', pctMpCooldown, PCT_POTION_CD_MS);
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
                            key="fighting"
                            className="boss__panel boss__panel--fighting"
                            style={{ '--boss-hue': getBossCardHue(activeBoss.level) } as React.CSSProperties}
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        >
                            <CombatHudHost active={phase === 'fighting'} accent={playerAccent} compact>
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

                                    <CombatArena
                                        enemies={uiEnemies}
                                        allies={uiAllies}
                                        bgVariant="daily-boss"
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
                                                    if (isBackendMode() && ch) {
                                                        void backendApi.logDeath(ch.id, {
                                                            source: 'boss',
                                                            source_name: activeBoss?.name_pl ?? 'Boss',
                                                            source_level: activeBoss?.level ?? ch.level,
                                                            result: 'fled',
                                                        });
                                                    } else {
                                                        void deathsApi.logDeath({
                                                            character_id: ch.id,
                                                            character_name: ch.name,
                                                            character_class: ch.class,
                                                            character_level: ch.level,
                                                            source: 'boss',
                                                            source_name: activeBoss?.name_pl ?? 'Boss',
                                                            source_level: activeBoss?.level ?? ch.level,
                                                            result: 'fled',
                                                        });
                                                    }
                                                    const prot = consumeDeathProtection();
                                                    if (prot.isProtected) {
                                                        const protName = prot.consumedId === 'amulet_of_loss' ? 'Amulet of Loss' : 'Eliksir Ochrony';
                                                        addLog(`:shield: ${protName} uchronił Cię przed stratami przy ucieczce!`, 'system');
                                                        useDeathStore.getState().triggerDeath({
                                                            kind: 'flee',
                                                            killedBy: activeBoss?.name_pl ?? 'Boss',
                                                            sourceLevel: activeBoss?.level ?? ch.level,
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
                                                            killedBy: activeBoss?.name_pl ?? 'Boss',
                                                            sourceLevel: activeBoss?.level ?? ch.level,
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
                                                if (isNonLeaderMember) {
                                                    const me = useCharacterStore.getState().character?.id;
                                                    if (me) void usePartyStore.getState().leaveParty(me);
                                                    useCombatStore.getState().clearCombatSession();
                                                    clearBots();
                                                    navigate('/');
                                                    return;
                                                }
                                                setResult({
                                                    won: false,
                                                    playerHpLeft: playerHp,
                                                    turns: 0,
                                                    drops: [],
                                                    gold: 0,
                                                    xp: 0,
                                                });
                                                useCombatStore.getState().clearCombatSession();
                                                clearBots();
                                                setPhase('result');
                                            },
                                        }}
                                    />
                                </div>
                            </CombatHudHost>
                        </motion.div>
                    );
                })()}


                {phase === 'result' && result && activeBoss && (() => {
                    const bossIdx = bosses.findIndex((x) => x.id === activeBoss.id);
                    const cardBg = bossIdx >= 0 ? getBossCardImage(bossIdx) : null;
                    const iDiedUnresurrected = ((character?.hp ?? 0) <= 0);
                    return (
                        <motion.div key="result" className="boss__panel boss__panel--centered"
                            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                            <div
                                className={`boss__result${result.won ? ' boss__result--win' : ' boss__result--loss'}`}
                                style={{
                                    '--card-hue': getBossCardHue(activeBoss.level),
                                    '--card-image': cardBg ? `url("${cardBg}")` : 'none',
                                } as React.CSSProperties}
                            >
                                {result.won && (
                                    <div className="boss__victory-banner">
                                        <span className="boss__victory-icon"><GameIcon name="trophy" /></span>
                                        <div className="boss__victory-name">{activeBoss.name_pl}</div>
                                        <div className="boss__victory-sub">Boss pokonany!</div>
                                    </div>
                                )}
                                {!result.won && (
                                    <>
                                        <div className="boss__result-title"><GameIcon name="skull" /> Porażka</div>
                                        <div className="boss__result-boss">{activeBoss.name_pl}</div>
                                    </>
                                )}

                                {result.won ? (
                                    <div className="boss__rewards">
                                        <div className="boss__reward-row"><span><GameIcon name="money-bag" /> Gold</span><span>+{formatGoldShort(result.gold)}</span></div>
                                        <div className="boss__reward-row"><span><GameIcon name="star" /> XP</span><span>+{result.xp.toLocaleString('pl-PL')}</span></div>
                                        {result.drops.length > 0 ? (
                                            <div className="boss__drops">
                                                <div className="boss__drops-title">Zdobyte przedmioty ({result.drops.length})</div>
                                                <div className="boss__drops-grid">
                                                    {result.drops.map((drop: IBossUniqueItem, i: number) => {
                                                        const info = getItemDisplayInfo(drop.itemId);
                                                        const icon = info?.icon ?? 'package';
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
                                            <div className="boss__no-drops">Brak przedmiotów tym razem.</div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="boss__fail-msg">
                                        Za słaby by pokonać {activeBoss.name_pl}. Wróć silniejszy!
                                    </p>
                                )}

                                <div className="boss__result-actions">
                                    {iDiedUnresurrected ? (
                                        <button
                                            className="boss__back-btn boss__back-btn--retreat"
                                            onClick={() => {
                                                clearBots();
                                                if (isNonLeaderMember) {
                                                    const me = useCharacterStore.getState().character?.id;
                                                    if (me) void usePartyStore.getState().leaveParty(me);
                                                }
                                                navigate('/');
                                            }}
                                        >
                                            Wróć do miasta
                                        </button>
                                    ) : result.won ? (
                                        <>
                                            <button
                                                className="boss__back-btn boss__back-btn--claim"
                                                onClick={() => {
                                                    clearBots();
                                                    if (isNonLeaderMember) {
                                                        const me = useCharacterStore.getState().character?.id;
                                                        if (me) void usePartyStore.getState().leaveParty(me);
                                                        navigate('/');
                                                    } else {
                                                        setPhase('list');
                                                    }
                                                }}
                                            >
                                                {isNonLeaderMember ? 'Wyjdź z party' : 'Odbierz'}
                                            </button>
                                            {!isNonLeaderMember && (() => {
                                                if (!activeBoss) return null;
                                                if (!canChallenge(activeBoss.id)) return null;
                                                const playerAlive = (character?.hp ?? 0) > 0;
                                                const allBotsAlive = useBotStore.getState().bots.every((b) => b.alive);
                                                if (!playerAlive || !allBotsAlive) return null;
                                                const sameBoss = activeBoss;
                                                const samePicks = lastBossPartyRef.current;
                                                return (
                                                    <button
                                                        className="boss__back-btn boss__back-btn--again"
                                                        onClick={() => {
                                                            triggerPartyCombatGo({
                                                                destination: '/boss',
                                                                label: `Boss: ${sameBoss.name_pl}`,
                                                                payload: { bossId: sameBoss.id },
                                                                onConfirmed: () => playEntryThenFight(sameBoss, samePicks),
                                                            });
                                                        }}
                                                    >
                                                        <GameIcon name="crossed-swords" /> Walcz ponownie
                                                    </button>
                                                );
                                            })()}
                                            {!isNonLeaderMember && (() => {
                                                if (!activeBoss) return null;
                                                if (canChallenge(activeBoss.id)) return null;
                                                const playerAlive = (character?.hp ?? 0) > 0;
                                                const allBotsAlive = useBotStore.getState().bots.every((b) => b.alive);
                                                if (!playerAlive || !allBotsAlive) return null;
                                                const charLvl = character?.level ?? 1;
                                                const nextBoss = bosses
                                                    .filter((b) => b.level > activeBoss.level && b.level <= charLvl && canChallenge(b.id))
                                                    .sort((a, b) => a.level - b.level)[0];
                                                if (!nextBoss) return null;
                                                const nextPicks = lastBossPartyRef.current;
                                                return (
                                                    <button
                                                        className="boss__back-btn boss__back-btn--again"
                                                        onClick={() => {
                                                            triggerPartyCombatGo({
                                                                destination: '/boss',
                                                                label: `Boss: ${nextBoss.name_pl}`,
                                                                payload: { bossId: nextBoss.id },
                                                                onConfirmed: () => playEntryThenFight(nextBoss, nextPicks),
                                                            });
                                                        }}
                                                        title={`${nextBoss.name_pl} (lvl ${nextBoss.level})`}
                                                    >
                                                        <GameIcon name="up-arrow" /> Walcz wyżej (lvl {nextBoss.level})
                                                    </button>
                                                );
                                            })()}
                                        </>
                                    ) : (
                                        <button
                                            className="boss__back-btn boss__back-btn--retreat"
                                            onClick={() => {
                                                clearBots();
                                                if (isNonLeaderMember) {
                                                    navigate('/');
                                                } else {
                                                    setPhase('list');
                                                }
                                            }}
                                        >
                                            Wróć
                                        </button>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    );
                })()}
            </AnimatePresence>

            <AnimatePresence>
                {bossEntryBoss && (
                    <motion.div
                        key="boss-entry"
                        className="boss__entry-overlay"
                        initial={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        role="button"
                        tabIndex={0}
                        aria-label="Pomiń animację wejścia do bossa"
                        onClick={skipBossEntry}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
                                e.preventDefault();
                                skipBossEntry();
                            }
                        }}
                    >
                        <div className="boss__entry-bg" aria-hidden="true" />
                        <motion.div
                            className="boss__entry-door boss__entry-door--left"
                            initial={{ x: 0 }}
                            animate={{ x: '-110%' }}
                            transition={{ delay: 0.25, duration: 0.7, ease: [0.7, 0, 0.3, 1] }}
                        />
                        <motion.div
                            className="boss__entry-door boss__entry-door--right"
                            initial={{ x: 0 }}
                            animate={{ x: '110%' }}
                            transition={{ delay: 0.25, duration: 0.7, ease: [0.7, 0, 0.3, 1] }}
                        />
                        <motion.div
                            className="boss__entry-seam"
                            initial={{ scaleY: 0, opacity: 0 }}
                            animate={{
                                scaleY: [0, 1, 1, 0],
                                opacity: [0, 1, 1, 0],
                            }}
                            transition={{ duration: 1.0, times: [0, 0.3, 0.65, 1] }}
                        />
                        <motion.div
                            className="boss__entry-label"
                            initial={{ opacity: 0, scale: 0.6, y: 20 }}
                            animate={{
                                opacity: [0, 1, 1, 1],
                                scale:   [0.6, 1.1, 1, 1.08],
                                y:       [20, 0, 0, 0],
                            }}
                            transition={{ duration: 1.5, times: [0, 0.25, 0.65, 1], ease: 'easeOut' }}
                        >
                            <span className="boss__entry-sprite">
                                <BossSprite level={bossEntryBoss.level} sprite={bossEntryBoss.sprite ?? 'ogre'} name={bossEntryBoss.name_pl} style={{ objectFit: 'cover' }} />
                            </span>
                            <span className="boss__entry-name">{bossEntryBoss.name_pl}</span>
                            <span className="boss__entry-level">Lvl {bossEntryBoss.level}</span>
                        </motion.div>
                        <motion.div
                            className="boss__entry-shock"
                            initial={{ scale: 0, opacity: 0.9 }}
                            animate={{ scale: 4, opacity: 0 }}
                            transition={{ delay: 0.25, duration: 0.5, ease: 'easeOut' }}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {deathChoicePopup && (
                    <motion.div
                        key="boss-death-choice"
                        className="boss__death-choice-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: 500,
                            background: 'rgba(0, 0, 0, 0.85)',
                            backdropFilter: 'blur(6px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <motion.div
                            className="boss__death-choice-modal"
                            initial={{ scale: 0.92, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.96, opacity: 0 }}
                            style={{
                                width: '100%',
                                maxWidth: 420,
                                margin: 16,
                                padding: 22,
                                background: 'linear-gradient(180deg, #2a0d0d 0%, #06070d 100%)',
                                border: '2px solid #ff4040',
                                borderRadius: 16,
                                color: '#fff',
                                boxShadow: '0 22px 80px rgba(0, 0, 0, 0.9)',
                                textAlign: 'center',
                            }}
                        >
                            <div style={{ fontSize: 36, marginBottom: 8 }}><GameIcon name="skull" /></div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: '#ff8a80', marginBottom: 6 }}>
                                Zostałeś pokonany
                            </div>
                            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.4, marginBottom: 18 }}>
                                Wybierz: zaakceptuj śmierć teraz (kara: poziom + skill XP + przedmioty)
                                lub poczekaj — jeśli sojusznik Cię wskrzesi w trakcie walki, wrócisz do akcji.
                            </div>
                            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setDeathChoicePopup(false);
                                        const pty = usePartyStore.getState().party;
                                        const me = useCharacterStore.getState().character?.id;
                                        if (pty && me) {
                                            void (async () => {
                                                const isLeader = pty.leaderId === me;
                                                if (isLeader) {
                                                    const { usePartyPresenceStore } =
                                                        await import('../../stores/partyPresenceStore');
                                                    const presence = usePartyPresenceStore.getState().byMember;
                                                    const candidate = pty.members.find((m) => {
                                                        if (m.id === me) return false;
                                                        if (m.isBot) return false;
                                                        const pres = presence[m.id];
                                                        return !pres || pres.hp > 0;
                                                    }) ?? pty.members.find((m) => m.id !== me && !m.isBot);
                                                    if (candidate) {
                                                        try {
                                                            await usePartyStore.getState()
                                                                .transferLeadership(candidate.id);
                                                        } catch { }
                                                    }
                                                }
                                                try {
                                                    await usePartyStore.getState().leaveParty(me);
                                                } catch { }
                                            })();
                                        }
                                        handlePlayerDeath(true);
                                    }}
                                    style={{
                                        flex: 1,
                                        border: '1px solid rgba(244, 67, 54, 0.6)',
                                        background: 'rgba(244, 67, 54, 0.18)',
                                        color: '#ff8a80',
                                        borderRadius: 999,
                                        padding: '12px 18px',
                                        fontWeight: 800,
                                        fontSize: 13,
                                        letterSpacing: '0.05em',
                                        textTransform: 'uppercase',
                                        cursor: 'pointer',
                                    }}
                                >
                                    Wróć do miasta
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDeathChoicePopup(false)}
                                    style={{
                                        flex: 1,
                                        border: 'none',
                                        background: 'linear-gradient(135deg, #4caf50, #2e7d32)',
                                        color: '#fff',
                                        borderRadius: 999,
                                        padding: '12px 18px',
                                        fontWeight: 800,
                                        fontSize: 13,
                                        letterSpacing: '0.05em',
                                        textTransform: 'uppercase',
                                        cursor: 'pointer',
                                    }}
                                >
                                    Czekaj na sojuszników
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default Boss;
