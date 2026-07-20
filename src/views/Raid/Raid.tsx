import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import { useCooldownStore } from '../../stores/cooldownStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { usePartyStore } from '../../stores/partyStore';
import { usePartyPresenceStore } from '../../stores/partyPresenceStore';
import { requestPartyCombatStart, registerGoReplicator } from '../../hooks/usePartyReadyCheck';

registerGoReplicator('/raid', (payload) => {
    const p = payload as { raidId?: string } | null;
    if (!p?.raidId) return;
    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
        usePartyCombatSyncStore.getState().requestMemberRaidEntry(p.raidId!);
    }).catch(() => { });
});
import { useRaidStore } from '../../stores/raidStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSkillStore } from '../../stores/skillStore';
import { useTransformStore } from '../../stores/transformStore';
import { useNecroSummonStore } from '../../stores/necroSummonStore';
import { usePartyCombatSyncStore } from '../../stores/partyCombatSyncStore';
import { usePartyReadyCheckStore } from '../../stores/partyReadyCheckStore';
import { useCombatStore } from '../../stores/combatStore';
import { useDeathStore } from '../../stores/deathStore';
import { useTaskStore } from '../../stores/taskStore';
import { useQuestStore } from '../../stores/questStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { useMasteryStore } from '../../stores/masteryStore';
import { getAllRaids, generateWaveBosses, rollMemberRewards, estimateRaidRewards } from '../../systems/raidSystem';
import classesData from '../../data/classes.json';
import { getDungeonImage, getPotionImage, getSpellChestImage, getSummonImage } from '../../systems/spriteAssets';
import { getPotionDropInfo, getSpellChestIcon } from '../../systems/lootSystem';
import TinyIcon from '../../components/ui/TinyIcon/TinyIcon';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import Icon from '../../components/atoms/Icon/Icon';
import { getItemDisplayInfo } from '../../systems/itemGenerator';
import { STONE_GENERIC_ICON, STONE_ICONS, getEquippedGearLevel, getGearGapMultiplier } from '../../systems/itemSystem';
import ItemIcon from '../../components/ui/ItemIcon/ItemIcon';
import { SPELL_CHEST_LEVELS, rollSkillDamageMult } from '../../systems/skillSystem';
import dungeonsData from '../../data/dungeons.json';
import { getSkillIcon } from '../../data/skillIcons';
import { useCombatFx } from '../../hooks/useCombatFx';
import { useLevelUpRefill } from '../../hooks/useLevelUpRefill';
import {
    newCombatEffectsSession,
    isCombatantStunned,
    ensureStatus,
    castSkill as effectsCastSkill,
    tickAll as effectsTickAll,
    routeDamage as effectsRouteDamage,
    type ICombatEffectsSession,
} from '../../systems/combatEffectsHelpers';
import { consumeTargetMarkAmp, skillTargetsEnemy } from '../../systems/skillEffectsV2';
import { applyDeathPenalty, applyFleePenalty } from '../../systems/levelSystem';
import { consumeDeathProtection } from '../../systems/deathProtection';
import { applyCombatLeaveDeath } from '../../systems/combatLeavePenalty';
import { deathsApi } from '../../api/v1/deathsApi';
import { getEffectiveChar } from '../../systems/combatEngine';
import { mitigateDamage } from '../../systems/combat';
import { ELIXIRS } from '../../stores/shopStore';
import { getPartyGateLevel } from '../../systems/partySystem';
import { getCharacterAvatar } from '../../data/classAvatars';
import PartyDeathChoice from '../../components/ui/PartyDeathChoice/PartyDeathChoice';
import skillsData from '../../data/skills.json';
import type {
    IRaid,
    IRaidBossState,
    IRaidMemberState,
    IRaidDropLine,
    RaidPhase,
} from '../../types/raid';
import type { IInventoryItem } from '../../types/item';
import {
    CombatHudHost,
    CombatArena,
    CombatTopControls,
    CombatSubControls,
    CombatActionBar,
    CombatPotionDock,
    type ICombatEnemy,
    type ICombatAlly,
    type ICombatSkillSlot,
    type ICombatPotionSlot,
} from '../../components/organisms/CombatUI';
import {
    getBestPotion as getBestPotionUtil,
    resolveAutoPotionElixir,
    FLAT_HP_POTIONS,
    FLAT_MP_POTIONS,
    PCT_HP_POTIONS,
    PCT_MP_POTIONS,
    PCT_POTION_COOLDOWN_MS as PCT_CD_MS,
} from '../../systems/potionSystem';
import '../../components/organisms/CombatUI/CombatUI.scss';
import { formatGoldShort } from '../../systems/goldFormat';
import { isBackendMode, isBackendCombatDelegated } from '../../config/backendMode';
import { commitCombatEventNow } from '../../stores/characterScope';
import { backendApi } from '../../api/backend/backendApi';
import { syncFromBackend } from '../../api/backend/syncState';
import './Raid.scss';

const CLASS_COLORS: Record<string, string> = {
    Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
    Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

interface IRaidResolveResult {
    won?: boolean;
    victory?: boolean;
    success?: boolean;
    reward?: { gold?: number; xp?: number };
    rewards?: { gold?: number; xp?: number };
    gold?: number;
    xp?: number;
}

const readRaidResolveResult = (res: unknown): IRaidResolveResult =>
    (typeof res === 'object' && res !== null) ? (res as IRaidResolveResult) : {};

const formatRaidResolveFeedback = (raid: IRaid, res: unknown): string => {
    const r = readRaidResolveResult(res);
    const won = r.won ?? r.victory ?? r.success;
    if (won === false) return `Porażka: rajd „${raid.name_pl}” nie został ukończony.`;
    const gold = r.reward?.gold ?? r.rewards?.gold ?? r.gold;
    const xp = r.reward?.xp ?? r.rewards?.xp ?? r.xp;
    const parts: string[] = [];
    if (typeof gold === 'number') parts.push(`+${gold} złota`);
    if (typeof xp === 'number') parts.push(`+${xp} XP`);
    const rewardStr = parts.length > 0 ? ` (${parts.join(', ')})` : '';
    return `Rajd „${raid.name_pl}” ukończony!${rewardStr}`;
};

const getRaidCardHue = (level: number): number => {
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

const RAID_RARITY_COLOR: Record<string, string> = {
    heroic:    '#9c27b0',
    mythic:    '#ffc107',
    legendary: '#f44336',
    epic:      '#4caf50',
    rare:      '#2196f3',
    common:    '#ffffff',
};

const RAID_ITEM_TIERS: Array<{ key: string; label: string; chance: number; color: string }> = [
    { key: 'heroic',    label: 'Heroic',    chance: 0.5,  color: RAID_RARITY_COLOR.heroic    },
    { key: 'mythic',    label: 'Mythic',    chance: 5,    color: RAID_RARITY_COLOR.mythic    },
    { key: 'legendary', label: 'Legendary', chance: 10,   color: RAID_RARITY_COLOR.legendary },
    { key: 'epic',      label: 'Epic',      chance: 20,   color: RAID_RARITY_COLOR.epic      },
    { key: 'rare',      label: 'Rare',      chance: 50,   color: RAID_RARITY_COLOR.rare      },
    { key: 'common',    label: 'Common',    chance: 14.5, color: RAID_RARITY_COLOR.common    },
];

const RAID_STONE_TIERS: Array<{ key: string; label: string; chance: number; color: string }> = [
    { key: 'heroic',    label: 'Heroic Stone',    chance: 1,  color: RAID_RARITY_COLOR.heroic    },
    { key: 'mythic',    label: 'Mythic Stone',    chance: 15, color: RAID_RARITY_COLOR.mythic    },
    { key: 'legendary', label: 'Legendary Stone', chance: 25, color: RAID_RARITY_COLOR.legendary },
    { key: 'epic',      label: 'Epic Stone',      chance: 40, color: RAID_RARITY_COLOR.epic      },
    { key: 'rare',      label: 'Rare Stone',      chance: 10, color: RAID_RARITY_COLOR.rare      },
    { key: 'common',    label: 'Common Stone',    chance: 9,  color: RAID_RARITY_COLOR.common    },
];

const RAID_BONUS_TIERS: Array<{ key: string; label: string; chance: number; color: string }> = [
    { key: 'heroic',    label: 'Heroic',    chance: 1.5,  color: RAID_RARITY_COLOR.heroic    },
    { key: 'mythic',    label: 'Mythic',    chance: 8,    color: RAID_RARITY_COLOR.mythic    },
    { key: 'legendary', label: 'Legendary', chance: 15,   color: RAID_RARITY_COLOR.legendary },
    { key: 'epic',      label: 'Epic',      chance: 25,   color: RAID_RARITY_COLOR.epic      },
    { key: 'rare',      label: 'Rare',      chance: 40,   color: RAID_RARITY_COLOR.rare      },
    { key: 'common',    label: 'Common',    chance: 10.5, color: RAID_RARITY_COLOR.common    },
];

const RAID_SPELL_CHEST_CHANCE = 0.0025;

const DUNGEON_DESC_BY_ID: Record<string, string> = (() => {
    const out: Record<string, string> = {};
    for (const d of dungeonsData as Array<{ id: string; description_pl?: string }>) {
        if (d.description_pl) out[d.id] = d.description_pl;
    }
    return out;
})();

const SPEED_OPTIONS: Array<{ label: string; mult: number }> = [
    { label: 'X1', mult: 1 },
    { label: 'X2', mult: 2 },
    { label: 'X4', mult: 4 },
];

interface IActiveSkill {
    id: string;
    mpCost: number;
    cooldown: number;
    damage: number;
    effect: string | null;
    unlockLevel: number;
    class: string;
}

const getClassActiveSkills = (cls: string): IActiveSkill[] => {
    const key = cls.toLowerCase() as keyof typeof skillsData.activeSkills;
    const list = (skillsData.activeSkills[key] ?? []) as Array<Omit<IActiveSkill, 'class'>>;
    return list.map((s) => ({ ...s, class: cls }));
};

type MemberCooldownMap = Record<string, Record<string, number>>;
interface ISkillFx {
    id: number;
    skillId: string;
    targets: number[];
    expiresAt: number;
}

const Raid = () => {
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const party = usePartyStore((s) => s.party);
    const leaveParty = usePartyStore((s) => s.leaveParty);
    const { attemptsRemaining, consumeAttempt, refundAttempt } = useRaidStore(useShallow((s) => ({ attemptsRemaining: s.attemptsRemaining, consumeAttempt: s.consumeAttempt, refundAttempt: s.refundAttempt })));

    const isMultiHumanParty = !!party && party.members.some(
        (m) => m.id !== character?.id && !m.isBot,
    );
    const isLeaderInPartyCombat = isMultiHumanParty && party?.leaderId === character?.id;
    const isNonLeaderMember     = isMultiHumanParty && party?.leaderId !== character?.id;

    const {
        raidFilterAvailableOnly,
        raidFilterMinLevel,
        raidFilterSortDesc,
        setRaidFilterAvailableOnly,
        setRaidFilterMinLevel,
        setRaidFilterSortDesc,
    } = useSettingsStore(useShallow((s) => ({ raidFilterAvailableOnly: s.raidFilterAvailableOnly, raidFilterMinLevel: s.raidFilterMinLevel, raidFilterSortDesc: s.raidFilterSortDesc, setRaidFilterAvailableOnly: s.setRaidFilterAvailableOnly, setRaidFilterMinLevel: s.setRaidFilterMinLevel, setRaidFilterSortDesc: s.setRaidFilterSortDesc })));

    const skillMode = useSettingsStore((s) => s.skillMode);
    const setSkillMode = useSettingsStore((s) => s.setSkillMode);
    const autoPotionHpEnabled = useSettingsStore((s) => s.autoPotionHpEnabled);
    const autoPotionMpEnabled = useSettingsStore((s) => s.autoPotionMpEnabled);
    const setAutoPotionHpEnabled = useSettingsStore((s) => s.setAutoPotionHpEnabled);
    const setAutoPotionMpEnabled = useSettingsStore((s) => s.setAutoPotionMpEnabled);
    const autoPotionHpId = useSettingsStore((s) => s.autoPotionHpId);
    const autoPotionMpId = useSettingsStore((s) => s.autoPotionMpId);
    const autoPotionPctHpId = useSettingsStore((s) => s.autoPotionPctHpId);
    const autoPotionPctMpId = useSettingsStore((s) => s.autoPotionPctMpId);
    const autoPotionOn = autoPotionHpEnabled || autoPotionMpEnabled;
    const toggleAutoPotion = () => {
        const next = !autoPotionOn;
        setAutoPotionHpEnabled(next);
        setAutoPotionMpEnabled(next);
    };
    const necroSummons = useNecroSummonStore((s) => s.summons);

    const consumables = useInventoryStore((s) => s.consumables);
    const activeSkillSlots = useSkillStore((s) => s.activeSkillSlots);

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

    const hpPotionCooldown = useCooldownStore((s) => s.hpPotionCooldown);
    const mpPotionCooldown = useCooldownStore((s) => s.mpPotionCooldown);
    const pctHpCooldown = useCooldownStore((s) => s.pctHpCooldown);
    const pctMpCooldown = useCooldownStore((s) => s.pctMpCooldown);
    const setHpPotionCooldown = useCooldownStore((s) => s.setHpPotionCooldown);
    const setMpPotionCooldown = useCooldownStore((s) => s.setMpPotionCooldown);
    const setPctHpCooldown = useCooldownStore((s) => s.setPctHpCooldown);
    const setPctMpCooldown = useCooldownStore((s) => s.setPctMpCooldown);
    const hpPotionCooldownRef = useRef(0);
    const mpPotionCooldownRef = useRef(0);
    const pctHpCooldownRef = useRef(0);
    const pctMpCooldownRef = useRef(0);
    useEffect(() => { useCooldownStore.getState().clearAll(); return () => useCooldownStore.getState().clearAll(); }, []);
    useEffect(() => { hpPotionCooldownRef.current = hpPotionCooldown; }, [hpPotionCooldown]);
    useEffect(() => { mpPotionCooldownRef.current = mpPotionCooldown; }, [mpPotionCooldown]);
    useEffect(() => { pctHpCooldownRef.current = pctHpCooldown; }, [pctHpCooldown]);
    useEffect(() => { pctMpCooldownRef.current = pctMpCooldown; }, [pctMpCooldown]);
    const HP_POTION_CD = 1000;
    const MP_POTION_CD = 1000;

    const skillQueueRef = useRef<number[]>([]);
    const [playerSkillCooldowns, setPlayerSkillCooldowns] = useState<Record<string, number>>({});

    const raids = useMemo(() => getAllRaids(), []);
    const [phase, setPhase] = useState<RaidPhase>('lobby');
    const [selectedRaid, setSelectedRaid] = useState<IRaid | null>(null);

    const raidEventSentRef = useRef(false);
    useEffect(() => {
        if (phase !== 'victory' && phase !== 'wipe') {
            raidEventSentRef.current = false;
            return;
        }
        if (!isBackendMode() || raidEventSentRef.current) return;
        raidEventSentRef.current = true;
        commitCombatEventNow({
            type: 'raid',
            sourceId: selectedRaid?.id,
            outcome: phase === 'victory' ? 'won' : 'lost',
            died: phase === 'wipe',
        });
    }, [phase, selectedRaid]);

    const [backendFeedback, setBackendFeedback] = useState<string | null>(null);

    const retryInProgressRef = useRef(false);
    const prevSelectedRaidRef = useRef<IRaid | null>(selectedRaid);
    useEffect(() => {
        const prev = prevSelectedRaidRef.current;
        prevSelectedRaidRef.current = selectedRaid;
        if (!prev || selectedRaid) return;
        if (retryInProgressRef.current) return;
        const partyState = usePartyStore.getState().party;
        const me = useCharacterStore.getState().character?.id;
        if (!partyState || !me) return;
        const otherH = partyState.members.filter((m) => m.id !== me && !m.isBot);
        if (otherH.length === 0) return;
        if (partyState.leaderId !== me) return;
        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishCombatEnd();
        }).catch(() => { });
    }, [selectedRaid]);
    const [dropModalRaidId, setDropModalRaidId] = useState<string | null>(null);
    const [speedMult, setSpeedMult] = useState(1);
    const [currentWave, setCurrentWave] = useState(0);
    const [bosses, setBosses] = useState<IRaidBossState[]>([]);
    const [members, setMembers] = useState<IRaidMemberState[]>([]);
    const [skillFx, setSkillFx] = useState<ISkillFx[]>([]);
    const fx = useCombatFx();
    const [dropsByMember, setDropsByMember] = useState<Record<string, IRaidDropLine[]>>({});
    const [itemsByMember, setItemsByMember] = useState<Record<string, IInventoryItem[]>>({});
    const [bossHitPulses, setBossHitPulses] = useState<Record<string, number>>({});
    const [memberHitPulses, setMemberHitPulses] = useState<Record<string, number>>({});
    const [memberAttackingClass, setMemberAttackingClass] = useState<Record<string, string>>({});
    const [bossAggroIds, setBossAggroIds] = useState<Record<string, string>>({});

    const [bossAttackerClass, setBossAttackerClass] = useState<Record<string, { className: string; token: number }>>({});
    const ATTACK_ANIM_DURATION: Record<string, number> = {
        Knight: 350, Mage: 400, Cleric: 400, Archer: 300,
        Rogue: 250, Necromancer: 450, Bard: 400,
    };
    const flashBossAttacker = useCallback((bossId: string, className: string) => {
        const dur = ATTACK_ANIM_DURATION[className] ?? 350;
        const token = Date.now() + Math.random();
        setBossAttackerClass((prev) => ({ ...prev, [bossId]: { className, token } }));
        setTimeout(() => {
            setBossAttackerClass((prev) => {
                if (prev[bossId]?.token !== token) return prev;
                const next = { ...prev };
                delete next[bossId];
                return next;
            });
        }, dur);
    }, []);

    const [waitingForSpawn, setWaitingForSpawn] = useState(false);
    const [spawnProgress, setSpawnProgress] = useState(0);

    const [partyChoiceOpen, setPartyChoiceOpen] = useState(false);
    const [partyChoiceAlliesAlive, setPartyChoiceAlliesAlive] = useState(0);
    const playerWaitingResRef = useRef(false);
    const playerDeathHandledRef = useRef(false);
    const resultDeathAppliedRef = useRef(false);
    const spawnStartRef = useRef<number>(0);
    const spawnDurationRef = useRef<number>(0);
    const cooldownsRef = useRef<MemberCooldownMap>({});
    const tickIdRef = useRef(0);
    const bossesRef = useRef<IRaidBossState[]>([]);
    const membersRef = useRef<IRaidMemberState[]>([]);
    const phaseRef = useRef<RaidPhase>('lobby');
    const fxIdRef = useRef(0);

    const effectsRef = useRef<ICombatEffectsSession>(newCombatEffectsSession());
    const allyFxId = (memberId: string) => `ally_${memberId}`;

    const partyHealDotRef = useRef<{
        remainingMs: number;
        pctPerSec: number;
        accumMs: number;
        skillId: string | null;
    }>({ remainingMs: 0, pctPerSec: 0, accumMs: 0, skillId: null });

    useEffect(() => { bossesRef.current = bosses; }, [bosses]);
    useEffect(() => { membersRef.current = members; }, [members]);

    const memberIdsSignatureRef = useRef<string>('');
    useEffect(() => {
        const signature = members.map((m) => m.id).join(',');
        if (
            memberIdsSignatureRef.current !== '' &&
            memberIdsSignatureRef.current !== signature
        ) {
            fx.resetAllyFx();
        }
        memberIdsSignatureRef.current = signature;
    }, [members]);
    useEffect(() => { phaseRef.current = phase; }, [phase]);

    useEffect(() => {
        if (phase !== 'fighting') return;
        const TICK_MS = 100;
        const id = setInterval(() => {
            const drain = TICK_MS * speedMult;
            useCooldownStore.getState().tick(drain);
            const _cd = useCooldownStore.getState();
            hpPotionCooldownRef.current = _cd.hpPotionCooldown;
            mpPotionCooldownRef.current = _cd.mpPotionCooldown;
            pctHpCooldownRef.current = _cd.pctHpCooldown;
            pctMpCooldownRef.current = _cd.pctMpCooldown;
            setPlayerSkillCooldowns((prev) => {
                let changed = false;
                const next: Record<string, number> = {};
                for (const [k, v] of Object.entries(prev)) {
                    const nv = Math.max(0, v - drain);
                    if (nv > 0) next[k] = nv;
                    if (nv !== v) changed = true;
                }
                return changed ? next : prev;
            });
        }, TICK_MS);
        return () => clearInterval(id);
    }, [phase, speedMult]);

    useEffect(() => {
        if (phase !== 'fighting') return;
        if (isNonLeaderMember) return;
        const TICK_MS = 250;
        const id = setInterval(() => {
            const aliveBosses = bossesRef.current.filter((b) => !b.isDead);
            const aliveMembers = membersRef.current.filter((m) => !m.isDead && !m.hasEscaped);
            if (aliveBosses.length === 0 && aliveMembers.length === 0) return;
            const dotResults = effectsTickAll(
                effectsRef.current,
                [
                    ...aliveBosses.map((b) => ({ id: b.id, maxHp: b.maxHp })),
                    ...aliveMembers.map((m) => ({ id: allyFxId(m.id), maxHp: m.maxHp })),
                ],
                TICK_MS * speedMult,
            );
            const healDot = partyHealDotRef.current;
            const healDotActive = healDot.remainingMs > 0 && healDot.pctPerSec > 0;
            if (dotResults.length === 0 && !healDotActive) return;
            const nextBosses = bossesRef.current.map((b) => ({ ...b }));
            const nextMembers = membersRef.current.map((m) => ({ ...m }));
            let bossesDirty = false;
            let membersDirty = false;
            for (const r of dotResults) {
                if (r.dotDamage <= 0 && !r.darkRitualTriggered) continue;
                const bIdx = nextBosses.findIndex((b) => b.id === r.id);
                if (bIdx >= 0) {
                    const b = nextBosses[bIdx];
                    if (b.isDead) continue;
                    if (r.dotDamage > 0) {
                        const apply = effectsRouteDamage(effectsRef.current, b.id, b.currentHp, r.dotDamage);
                        if (apply.appliedDmg > 0) {
                            b.currentHp = Math.max(0, b.currentHp - apply.appliedDmg);
                            if (b.currentHp <= 0) b.isDead = true;
                            bossesDirty = true;
                            const dotPushSlot = bIdx;
                            fx.pushEnemyFloat(dotPushSlot, apply.appliedDmg, 'spell', { icon: 'skull-and-crossbones' });
                            if (isLeaderInPartyCombat) {
                                const dotDmgCap = apply.appliedDmg;
                                const bIdCap = b.id;
                                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                    usePartyCombatSyncStore.getState().publishRaidDamage({
                                        attackerId: 'player',
                                        targetId: bIdCap,
                                        damage: dotDmgCap,
                                        kind: 'spell',
                                        icon: 'skull-and-crossbones',
                                    });
                                }).catch(() => { });
                            }
                        }
                    }
                    if (r.darkRitualTriggered && r.darkRitualDamage > 0 && !b.isDead) {
                        const ritualDmg = Math.min(b.currentHp, r.darkRitualDamage);
                        b.currentHp = Math.max(0, b.currentHp - ritualDmg);
                        if (b.currentHp <= 0) b.isDead = true;
                        bossesDirty = true;
                        fx.pushEnemyFloat(bIdx, ritualDmg, 'spell', { icon: 'skull', label: 'RITUAL', isCrit: true });
                        if (isLeaderInPartyCombat) {
                            const rDmgCap = ritualDmg;
                            const bIdCap = b.id;
                            void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                usePartyCombatSyncStore.getState().publishRaidDamage({
                                    attackerId: 'player',
                                    targetId: bIdCap,
                                    damage: rDmgCap,
                                    kind: 'spell',
                                    icon: 'skull',
                                    label: 'RITUAL',
                                    isCrit: true,
                                });
                            }).catch(() => { });
                        }
                    }
                    continue;
                }
                const liveNextMembers = nextMembers.filter((m) => !m.hasEscaped);
                const mIdx = liveNextMembers.findIndex((m) => allyFxId(m.id) === r.id);
                if (mIdx >= 0 && r.dotDamage > 0) {
                    const m = liveNextMembers[mIdx];
                    if (m.isDead || m.hasEscaped) continue;
                    const apply = effectsRouteDamage(effectsRef.current, allyFxId(m.id), m.hp, r.dotDamage);
                    if (apply.appliedDmg <= 0) continue;
                    m.hp = Math.max(0, m.hp - apply.appliedDmg);
                    if (m.hp <= 0) m.isDead = true;
                    membersDirty = true;
                    fx.pushAllyFloat(mIdx, apply.appliedDmg, 'monster-spell', { icon: 'skull-and-crossbones' });
                    if (isLeaderInPartyCombat) {
                        const dotDmgCap = apply.appliedDmg;
                        const mIdCap = m.id;
                        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                            usePartyCombatSyncStore.getState().publishRaidDamage({
                                attackerId: 'monster',
                                targetId: mIdCap,
                                damage: dotDmgCap,
                                kind: 'monster-spell',
                                icon: 'skull-and-crossbones',
                            });
                        }).catch(() => { });
                    }
                }
            }
            if (healDotActive) {
                const elapsed = TICK_MS * speedMult;
                const covered = Math.min(elapsed, healDot.remainingMs);
                healDot.remainingMs = Math.max(0, healDot.remainingMs - elapsed);
                healDot.accumMs += covered;
                const pct = healDot.pctPerSec;
                const liveSlots = nextMembers.filter((m) => !m.hasEscaped);
                while (healDot.accumMs >= 1000) {
                    healDot.accumMs -= 1000;
                    for (const m of nextMembers) {
                        if (m.isDead || m.hasEscaped) continue;
                        if (m.hp >= m.maxHp) continue;
                        const heal = Math.max(1, Math.floor(m.maxHp * (pct / 100)));
                        const before = m.hp;
                        m.hp = Math.min(m.maxHp, m.hp + heal);
                        const actual = m.hp - before;
                        if (actual <= 0) continue;
                        membersDirty = true;
                        if (m.id === character?.id) {
                            const slot = liveSlots.findIndex((lm) => lm.id === m.id);
                            const cappedTag = actual < heal ? ' (MAX)' : '';
                            fx.pushAllyFloat(slot >= 0 ? slot : 0, heal, 'heal', {
                                icon: 'green-heart',
                                label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                            });
                            if (healDot.skillId) fx.triggerAllySkillAnim(slot >= 0 ? slot : 0, healDot.skillId);
                        }
                    }
                }
                if (healDot.remainingMs <= 0) {
                    partyHealDotRef.current = { remainingMs: 0, pctPerSec: 0, accumMs: 0, skillId: null };
                }
            }
            if (bossesDirty) {
                bossesRef.current = nextBosses;
                setBosses(nextBosses);
            }
            if (membersDirty) {
                membersRef.current = nextMembers;
                setMembers(nextMembers);
            }
        }, 250);
        return () => clearInterval(id);
    }, [phase, speedMult, isNonLeaderMember]);

    const consumeRaidPotion = useCallback((potionId: string) => {
        if (!character) return;
        const inv = useInventoryStore.getState();
        const owned = inv.consumables[potionId] ?? 0;
        if (owned <= 0) return;

        const elixir = ELIXIRS.find((e) => e.id === potionId);
        if (!elixir) return;
        const eff = elixir.effect;
        const isHp = eff.startsWith('heal_hp');
        const isMp = eff.startsWith('heal_mp');
        if (!isHp && !isMp) return;

        const isPct = eff.includes('_pct_');
        const numStr = eff.split('_').pop() ?? '0';
        const value = parseInt(numStr, 10) || 0;

        const effChar = getEffectiveChar(character);
        const liveMaxHp = effChar?.max_hp ?? character.max_hp;
        const liveMaxMp = effChar?.max_mp ?? character.max_mp;

        const max = isHp ? liveMaxHp : liveMaxMp;
        const heal = isPct ? Math.floor(max * (value / 100)) : value;

        setMembers((prev) => {
            const next = prev.map((m) => {
                if (m.id !== character.id) return m;
                const newHp = isHp ? Math.min(liveMaxHp, m.hp + heal) : m.hp;
                const newMp = isMp ? Math.min(liveMaxMp, m.mp + heal) : m.mp;
                return { ...m, hp: newHp, mp: newMp, maxHp: liveMaxHp, maxMp: liveMaxMp };
            });
            membersRef.current = next;
            return next;
        });

        useCharacterStore.getState().updateCharacter(
            isHp
                ? { hp: Math.min(liveMaxHp, (character.hp ?? 0) + heal) }
                : { mp: Math.min(liveMaxMp, (character.mp ?? 0) + heal) },
        );
        inv.useConsumable(potionId);

        if (isHp && isPct) setPctHpCooldown(PCT_CD_MS);
        else if (isHp) setHpPotionCooldown(HP_POTION_CD);
        else if (isMp && isPct) setPctMpCooldown(PCT_CD_MS);
        else setMpPotionCooldown(MP_POTION_CD);

        useCombatStore.getState().addSessionLog(
            `:test-tube: Użyto: ${elixir.name_pl} (+${heal.toLocaleString('pl-PL')} ${isHp ? 'HP' : 'MP'})`,
            'system',
        );
    }, [character]);

    const queuePlayerSkill = useCallback((slotIdx: 0 | 1 | 2 | 3) => {
        if (isNonLeaderMember) {
            const myId = character?.id;
            if (!myId) return;
            const skillId = activeSkillSlots[slotIdx];
            if (!skillId) return;
            usePartyCombatSyncStore.getState().publishMemberSkillRequest(myId, skillId);
            const cls = character?.class;
            if (cls) {
                const def = getClassActiveSkills(cls).find((s) => s.id === skillId);
                const cdMs = def?.cooldown ?? 1500;
                setPlayerSkillCooldowns((prev) => ({ ...prev, [skillId]: cdMs }));
            }
            return;
        }
        skillQueueRef.current.push(slotIdx);
    }, [isNonLeaderMember, character?.id, character?.class, activeSkillSlots]);

    useLevelUpRefill(phase === 'fighting', useCallback((maxHp, maxMp) => {
        const myId = character?.id;
        if (!myId) return;
        setMembers((prev) => prev.map((m) =>
            m.id === myId ? { ...m, hp: maxHp, mp: maxMp, maxHp, maxMp } : m
        ));
    }, [character?.id]));

    useEffect(() => {
        if (phase !== 'fighting') return;
        if (!party || !character) return;
        const partyIds = new Set(party.members.map((m) => m.id));
        const localMembers = membersRef.current;
        const departed = localMembers.filter((m) => !partyIds.has(m.id) || m.hasEscaped);
        if (departed.length === 0) return;
        const stillIn = localMembers.filter((m) => partyIds.has(m.id) && !m.hasEscaped);
        membersRef.current = stillIn;
        setMembers(stillIn);
        const departedIds = new Set(departed.map((m) => m.id));
        setBossAggroIds((prev) => {
            let changed = false;
            const next: Record<string, string> = {};
            for (const [bossId, memberId] of Object.entries(prev)) {
                if (departedIds.has(memberId)) {
                    changed = true;
                    continue;
                }
                next[bossId] = memberId;
            }
            return changed ? next : prev;
        });
        fx.resetAllyFx();
    }, [party, phase, character?.id, fx]);

    const leavePenaltyAppliedRef = useRef(false);
    const selectedRaidRef = useRef<IRaid | null>(null);
    useEffect(() => {
        const fire = () => {
            if (leavePenaltyAppliedRef.current) return;
            if (phaseRef.current !== 'fighting') return;
            const raid = selectedRaidRef.current;
            if (!raid) return;
            leavePenaltyAppliedRef.current = true;
            applyCombatLeaveDeath({
                source: 'raid',
                sourceName: raid.name_pl,
                sourceLevel: raid.level,
            });
        };
        window.addEventListener('beforeunload', fire);
        return () => {
            window.removeEventListener('beforeunload', fire);
            fire();
        };
    }, []);
    useEffect(() => { selectedRaidRef.current = selectedRaid; }, [selectedRaid]);

    const iAmLeader = !!character && !!party && party.leaderId === character.id;
    const humanMembers = party?.members.filter((m) => !m.isBot) ?? [];
    const totalMembers = party?.members.length ?? 0;
    const partyMinLevel = getPartyGateLevel(character?.level ?? 1, party?.members);

    const addLog = useCallback((text: string) => {
        useCombatStore.getState().addSessionLog(text, 'system');
    }, []);

    const buildMemberStates = useCallback((): IRaidMemberState[] => {
        if (!character || !party) return [];
        const transformColor = useTransformStore.getState().getHighestTransformColor();
        const transformTier = useTransformStore.getState().getHighestCompletedTransform?.() ?? 0;
        return party.members.map((m) => {
            const isMe = m.id === character.id;
            if (isMe) {
                const eff = getEffectiveChar(character) ?? character;
                const raidLevel = selectedRaidRef.current?.level ?? 0;
                const leaderGearGapMult = getGearGapMultiplier(
                    getEquippedGearLevel(useInventoryStore.getState().equipment),
                    raidLevel,
                );
                const leaderAttack = Math.floor(eff.attack * leaderGearGapMult);
                const stayDead = (character.hp ?? 0) <= 0;
                const curHp = Math.min(eff.max_hp, Math.max(0, character.hp ?? eff.max_hp));
                const curMp = Math.min(eff.max_mp, Math.max(0, character.mp ?? eff.max_mp));
                const startHp = stayDead ? 0 : curHp;
                const startMp = stayDead ? 0 : curMp;
                return {
                    id: m.id,
                    name: m.name,
                    class: character.class,
                    level: character.level,
                    maxHp: eff.max_hp,
                    hp: startHp,
                    maxMp: eff.max_mp,
                    mp: startMp,
                    attack: leaderAttack,
                    defense: eff.defense,
                    isDead: stayDead,
                    isBot: false,
                    hasEscaped: false,
                    color: transformColor?.solid ?? CLASS_COLORS[character.class] ?? '#888',
                    transformTier,
                };
            }
            const presenceSnap = !m.isBot
                ? usePartyPresenceStore.getState().byMember[m.id]
                : null;
            const fallbackHp = Math.max(100, m.level * 60);
            const fallbackMp = Math.max(40, m.level * 30);
            const hpMax = presenceSnap?.maxHp ?? fallbackHp;
            const mpMax = presenceSnap?.maxMp ?? fallbackMp;
            const stayDeadOther = !!presenceSnap && presenceSnap.hp <= 0 && presenceSnap.maxHp > 0;
            const curHpOther = presenceSnap
                ? Math.min(hpMax, Math.max(0, presenceSnap.hp))
                : hpMax;
            const curMpOther = presenceSnap
                ? Math.min(mpMax, Math.max(0, presenceSnap.mp))
                : mpMax;
            const startHpOther = stayDeadOther ? 0 : curHpOther;
            const startMpOther = stayDeadOther ? 0 : curMpOther;
            return {
                id: m.id,
                name: m.name,
                class: m.class,
                level: m.level,
                maxHp: hpMax,
                hp: startHpOther,
                maxMp: mpMax,
                mp: startMpOther,
                attack: presenceSnap?.attack ?? (5 + m.level * 3),
                defense: presenceSnap?.defense ?? (2 + m.level * 1),
                isDead: stayDeadOther,
                isBot: !!m.isBot,
                hasEscaped: false,
                color: CLASS_COLORS[m.class] ?? '#888',
                transformTier: presenceSnap?.transformTier ?? 0,
            };
        });
    }, [character, party]);

    useEffect(() => {
        if (!character) return;
        useSkillStore.getState().purgeLockedSkillSlots(character.class, character.level);
    }, [character?.class, character?.level]);

    const handleEnterRaid = useCallback(async (raid: IRaid) => {
        const liveChar = useCharacterStore.getState().character;
        if (isBackendCombatDelegated() && liveChar) {
            try {
                const res: unknown = await backendApi.raidResolve(liveChar.id, raid.id);
                await syncFromBackend(liveChar.id);
                setBackendFeedback(formatRaidResolveFeedback(raid, res));
                return;
            } catch (e) {
                console.warn('[backend] raidResolve failed', e);
                setBackendFeedback(`Nie udało się rozstrzygnąć rajdu: ${raid.name_pl}.`);
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
        requestPartyCombatStart({
            destination: '/raid',
            label: `Raid: ${raid.name_pl}`,
            payload: { raidId: raid.id },
            onConfirmed: () => startRaid(raid),
        });
    }, []);

    const lastRaidEntryAtSeenRef = useRef(0);
    useEffect(() => {
        const me = character?.id;
        if (!me) return;
        let unsub: (() => void) | null = null;
        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            lastRaidEntryAtSeenRef.current = usePartyCombatSyncStore.getState().pendingRaidEntryAt;
            unsub = usePartyCombatSyncStore.subscribe((state) => {
                const at = state.pendingRaidEntryAt;
                if (!at || at === lastRaidEntryAtSeenRef.current) return;
                lastRaidEntryAtSeenRef.current = at;
                const raidId = state.pendingRaidEntryRaidId;
                if (!raidId) return;
                const partyState = usePartyStore.getState().party;
                if (partyState && partyState.leaderId === me) return;
                const raid = getAllRaids().find((r) => r.id === raidId);
                if (!raid) return;
                setTimeout(() => startRaid(raid as IRaid), 0);
            });
        }).catch(() => { });
        return () => { unsub?.(); };
    }, [character?.id]);

    const startRaid = useCallback((raid: IRaid) => {
        if (!consumeAttempt(raid.id)) {
            addLog('Brak dostępnych prób dzisiaj dla tego rajdu.');
            return;
        }
        setSelectedRaid(raid);
        setCurrentWave(0);
        const waveBosses = generateWaveBosses(raid, 0);
        setBosses(waveBosses);
        const newMembers = buildMemberStates();
        setMembers(newMembers);
        cooldownsRef.current = {};
        setBossHitPulses({});
        setMemberHitPulses({});
        fx.resetFx();
        useCombatStore.getState().clearCombatSession();
        useCombatStore.getState().addSessionLog(
            `:crossed-swords: Rajd "${raid.name_pl}" rozpoczęty! Fala 1/${raid.waves}`,
            'system',
        );
        setDropsByMember({});
        leavePenaltyAppliedRef.current = false;
        playerWaitingResRef.current = false;
        playerDeathHandledRef.current = false;
        resultDeathAppliedRef.current = false;
        setPartyChoiceOpen(false);
        setPartyChoiceAlliesAlive(0);
        effectsRef.current = newCombatEffectsSession();
        partyHealDotRef.current = { remainingMs: 0, pctPerSec: 0, accumMs: 0, skillId: null };
        useNecroSummonStore.getState().clearAll();
        setPhase('fighting');
    }, [buildMemberStates, consumeAttempt, addLog, fx]);

    useEffect(() => {
        if (!isLeaderInPartyCombat) return;
        if (!selectedRaid) return;
        if (phase === 'lobby') return;
        const speedMode: 'x1' | 'x2' | 'x4' = speedMult === 4 ? 'x4' : speedMult === 2 ? 'x2' : 'x1';
        void Promise.all([
            import('../../stores/partyCombatSyncStore'),
            import('../../stores/partyDamageStore'),
        ]).then(([{ usePartyCombatSyncStore }, { usePartyDamageStore }]) => {
            usePartyCombatSyncStore.getState().publishRaidState({
                raidId: selectedRaid.id,
                phase,
                currentWave,
                bosses,
                members,
                speedMode,
                aggroTargetIds: bossAggroIds,
                partyDamage: { ...usePartyDamageStore.getState().damage },
                dropsByMember: phase === 'victory' ? dropsByMember : undefined,
                itemsByMember: phase === 'victory' ? itemsByMember : undefined,
            });
        }).catch(() => { });
    }, [isLeaderInPartyCombat, selectedRaid, phase, currentWave, bosses, members, speedMult, bossAggroIds, dropsByMember, itemsByMember]);

    const memberVictoryAppliedRef = useRef(false);
    useEffect(() => {
        if (!isNonLeaderMember) return;
        memberVictoryAppliedRef.current = false;
        const unsubP = (async () => {
            const { usePartyCombatSyncStore } = await import('../../stores/partyCombatSyncStore');
            return usePartyCombatSyncStore.subscribe((state, prev) => {
                const s = state.lastRaidState;
                if (!s) return;
                if (prev.lastRaidState && prev.lastRaidState.seq === s.seq) return;
                const raid = getAllRaids().find((r) => r.id === s.raidId);
                if (raid) {
                    setSelectedRaid(raid as IRaid);
                    selectedRaidRef.current = raid as IRaid;
                }
                setCurrentWave(s.currentWave);
                setBosses(s.bosses);
                bossesRef.current = s.bosses;
                const incomingMembers = (s.members ?? []).filter((m) => !m.hasEscaped);
                if (prev.lastRaidState) {
                    const prevSig = (prev.lastRaidState.members ?? [])
                        .filter((m) => !m.hasEscaped)
                        .map((m) => m.id).join(',');
                    const nextSig = incomingMembers.map((m) => m.id).join(',');
                    if (prevSig !== nextSig) {
                        fx.resetAllyFx();
                    }
                }
                membersRef.current = incomingMembers;
                setMembers(incomingMembers);
                const meId = useCharacterStore.getState().character?.id;
                const meInState = meId ? s.members.find((m) => m.id === meId) : null;
                if (meInState) {
                    useCharacterStore.getState().updateCharacter({
                        hp: meInState.hp,
                        mp: meInState.mp,
                    });
                    const aliveAlliesForMember = s.members.filter(
                        (m) => !m.isDead && !m.hasEscaped && m.id !== meId,
                    ).length;
                    if (
                        meInState.isDead &&
                        aliveAlliesForMember > 0 &&
                        !playerDeathHandledRef.current &&
                        s.phase === 'fighting'
                    ) {
                        playerDeathHandledRef.current = true;
                        setPartyChoiceAlliesAlive(aliveAlliesForMember);
                        setPartyChoiceOpen(true);
                        addLog(':skull: Padłeś! Wybierz: Powrót do miasta lub Czekaj na wskrzeszenie.');
                    }
                }
                const prevPhase = prev.lastRaidState?.phase;
                if (s.phase !== 'victory' && s.phase !== 'wipe') {
                    memberVictoryAppliedRef.current = false;
                }
                if (
                    s.phase === 'victory' &&
                    !memberVictoryAppliedRef.current &&
                    prevPhase !== 'victory' &&
                    raid
                ) {
                    memberVictoryAppliedRef.current = true;
                    if (s.dropsByMember) {
                        setDropsByMember(s.dropsByMember);
                        if (s.itemsByMember) setItemsByMember(s.itemsByMember);
                        const myMeId = useCharacterStore.getState().character?.id ?? '';
                        const myDrops = s.dropsByMember[myMeId] ?? [];
                        const myItems = s.itemsByMember?.[myMeId] ?? [];
                        let myXp = 0;
                        let myGold = 0;
                        for (const d of myDrops) {
                            if (d.kind === 'xp' && d.amount) myXp += d.amount;
                            if (d.kind === 'gold' && d.amount) myGold += d.amount;
                        }
                        if (myXp > 0) useCharacterStore.getState().addXp(myXp);
                        const liveCh = useCharacterStore.getState().character;
                        if (liveCh && myGold > 0) {
                            useCharacterStore.getState().updateCharacter({
                                gold: (liveCh.gold ?? 0) + myGold,
                            });
                        }
                        const inv = useInventoryStore.getState();
                        for (const it of myItems) inv.addItem(it);
                        for (const drop of myDrops) {
                            if (drop.kind === 'spell_chest' && drop.amount) {
                                inv.addSpellChest(drop.amount, 1);
                            }
                        }
                        useCombatStore.getState().addSessionStats(myXp, myGold);
                        useCombatStore.getState().appendDrops(
                            myDrops.map((d) => ({
                                icon: 'wrapped-gift',
                                name: d.label,
                                rarity: d.rarity ?? 'common',
                            })),
                        );
                    } else {
                        const raidCap = raid as IRaid;
                        const membersCap = s.members;
                        setTimeout(() => distributeRewards(raidCap, membersCap), 0);
                    }
                }
                setPhase(s.phase);
                phaseRef.current = s.phase;
                if (s.speedMode === 'x1' || s.speedMode === 'x2' || s.speedMode === 'x4') {
                    const sm = s.speedMode === 'x4' ? 4 : s.speedMode === 'x2' ? 2 : 1;
                    setSpeedMult(sm);
                }
                if (s.aggroTargetIds) setBossAggroIds(s.aggroTargetIds);
                if (s.partyDamage) {
                    void import('../../stores/partyDamageStore').then(({ usePartyDamageStore }) => {
                        const dmgState = usePartyDamageStore.getState();
                        for (const [memberId, total] of Object.entries(s.partyDamage!)) {
                            dmgState.setMemberDamage(memberId, total);
                        }
                    }).catch(() => { });
                }
            });
        })();
        return () => { void unsubP.then((fn) => fn?.()); };
    }, [isNonLeaderMember]);

    const lastRaidDamageSeenRef = useRef<Record<string, unknown>>({});
    useEffect(() => {
        if (!isNonLeaderMember) return;
        const unsub = (async () => {
            const { usePartyCombatSyncStore } = await import('../../stores/partyCombatSyncStore');
            const initial = usePartyCombatSyncStore.getState().lastRaidDamageByAttacker;
            for (const [k, v] of Object.entries(initial)) {
                lastRaidDamageSeenRef.current[k] = v;
            }
            return usePartyCombatSyncStore.subscribe((state) => {
                const map = state.lastRaidDamageByAttacker;
                if (!map) return;
                for (const [key, ev] of Object.entries(map)) {
                    if (ev === lastRaidDamageSeenRef.current[key]) continue;
                    lastRaidDamageSeenRef.current[key] = ev;

                    if (ev.attackerId !== 'monster' && ev.attackerId === ev.targetId) {
                        const stateMembersAll = state.lastRaidState?.members ?? membersRef.current;
                        const stateMembers = stateMembersAll.filter((m) => !m.hasEscaped);
                        const buffSlot = stateMembers.findIndex((m) => m.id === ev.targetId);
                        if (buffSlot < 0) continue;
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
                    if (ev.attackerId !== 'monster') {
                        const localBosses = bossesRef.current;
                        const bossSlot = localBosses.findIndex((b) => b.id === ev.targetId);
                        if (bossSlot < 0) continue;
                        fx.pushEnemyFloat(bossSlot, ev.damage, ev.kind ?? 'ally-basic', {
                            icon: ev.icon,
                            label: ev.label,
                            isCrit: ev.isCrit,
                        });
                        setBossHitPulses((prev) => ({
                            ...prev,
                            [ev.targetId]: (prev[ev.targetId] ?? 0) + 1,
                        }));
                        if (ev.attackerClass) {
                            flashBossAttacker(ev.targetId, ev.attackerClass);
                        }
                        if (ev.skillId) {
                            const skillIdCap = ev.skillId;
                            setSkillFx((prev) => [
                                ...prev,
                                {
                                    id: fxIdRef.current++,
                                    skillId: skillIdCap,
                                    targets: [bossSlot],
                                    expiresAt: Date.now() + 900,
                                },
                            ]);
                        }
                        continue;
                    }
                    const stateMembersAll = state.lastRaidState?.members ?? membersRef.current;
                    const stateMembers = stateMembersAll.filter((m) => !m.hasEscaped);
                    const memSlot = stateMembers.findIndex((m) => m.id === ev.targetId);
                    if (memSlot < 0) continue;
                    const tgtIdCap = ev.targetId;
                    setMemberAttackingClass((prev) => ({ ...prev, [tgtIdCap]: 'attack-Necromancer' }));
                    window.setTimeout(() => {
                        setMemberAttackingClass((prev) => {
                            if (!prev[tgtIdCap]) return prev;
                            const next = { ...prev };
                            delete next[tgtIdCap];
                            return next;
                        });
                    }, ATTACK_ANIM_DURATION['Necromancer'] ?? 450);
                    fx.pushAllyFloat(memSlot, ev.damage, ev.kind ?? 'monster', {
                        icon: ev.icon,
                        label: ev.label,
                        isCrit: ev.isCrit,
                    });
                    if (ev.damage > 0) {
                        setMemberHitPulses((prev) => ({
                            ...prev,
                            [ev.targetId]: (prev[ev.targetId] ?? 0) + 1,
                        }));
                    }
                }
            });
        })();
        return () => { void unsub.then((fn) => fn?.()); };
    }, [isNonLeaderMember, fx, flashBossAttacker]);

    useEffect(() => {
        if (phase !== 'fighting') return;
        if (isNonLeaderMember) return;
        const interval = setInterval(() => {
            tickIdRef.current += 1;
            const tick = tickIdRef.current;

            const curMembers = membersRef.current;
            const curBosses = bossesRef.current;
            const aliveBosses = curBosses.filter((b) => !b.isDead);
            const skipActions = aliveBosses.length === 0
                || curMembers.every((m) => m.isDead || m.hasEscaped);

            const nextMembers = curMembers.map((m) => ({ ...m }));
            const nextBosses = curBosses.map((b) => ({ ...b }));
            const fxQueue: ISkillFx[] = [];

            if (skipActions) {
                setBosses(nextBosses);
                setMembers(nextMembers);
                if (nextBosses.every((b) => b.isDead) && nextBosses.length > 0) {
                    const nextWaveIdx = currentWave + 1;
                    if (selectedRaid && nextWaveIdx < selectedRaid.waves) {
                        const waveDelayMs = Math.max(60, Math.floor(800 / speedMult));
                        spawnStartRef.current = Date.now();
                        spawnDurationRef.current = waveDelayMs;
                        setSpawnProgress(0);
                        setWaitingForSpawn(true);
                        addLog(`:check-mark-button: Fala ${nextWaveIdx}/${selectedRaid.waves} zaliczona!`);
                        setTimeout(() => {
                            if (phaseRef.current !== 'fighting') return;
                            setCurrentWave(nextWaveIdx);
                            setBosses(generateWaveBosses(selectedRaid, nextWaveIdx));
                            setWaitingForSpawn(false);
                            setSpawnProgress(0);
                        }, waveDelayMs);
                    } else if (selectedRaid) {
                        leavePenaltyAppliedRef.current = true;
                        setPhase('victory');
                        useNecroSummonStore.getState().clearAll();
                        distributeRewards(selectedRaid, nextMembers);
                    }
                }
                if (nextMembers.every((m) => m.isDead || m.hasEscaped)) {
                    leavePenaltyAppliedRef.current = true;
                    setPhase('wipe');
                    useNecroSummonStore.getState().clearAll();
                    handleWipe();
                }
                return;
            }

            if (character) {
                const me = nextMembers.find((m) => m.id === character.id);
                if (me && !me.isDead && !me.hasEscaped) {
                    const settings = useSettingsStore.getState();
                    const inv = useInventoryStore.getState();
                    const tryFire = (
                        enabled: boolean,
                        configuredId: string,
                        thresholdPct: number,
                        which: 'hp' | 'mp',
                        isPct: boolean,
                    ) => {
                        if (!enabled) return;
                        const candidatePool = which === 'hp'
                            ? (isPct ? PCT_HP_POTIONS : FLAT_HP_POTIONS)
                            : (isPct ? PCT_MP_POTIONS : FLAT_MP_POTIONS);
                        let potionId = configuredId;
                        if (!potionId || (inv.consumables[potionId] ?? 0) <= 0) {
                            const ownedPool = candidatePool
                                .filter((p) => (inv.consumables[p.id] ?? 0) > 0);
                            if (ownedPool.length === 0) return;
                            potionId = ownedPool[ownedPool.length - 1].id;
                        }
                        const cdActive = isPct
                            ? (which === 'hp' ? pctHpCooldownRef.current : pctMpCooldownRef.current) > 0
                            : (which === 'hp' ? hpPotionCooldownRef.current : mpPotionCooldownRef.current) > 0;
                        if (cdActive) return;
                        const cur = which === 'hp' ? me.hp : me.mp;
                        const max = which === 'hp' ? me.maxHp : me.maxMp;
                        if (max <= 0) return;
                        const pct = (cur / max) * 100;
                        if (pct >= thresholdPct) return;

                        const elixir = ELIXIRS.find((e) => e.id === potionId);
                        if (!elixir) return;
                        const numStr = elixir.effect.split('_').pop() ?? '0';
                        const value = parseInt(numStr, 10) || 0;
                        const heal = isPct ? Math.floor(max * (value / 100)) : value;

                        if (which === 'hp') me.hp = Math.min(me.maxHp, me.hp + heal);
                        else me.mp = Math.min(me.maxMp, me.mp + heal);
                        inv.useConsumable(potionId);
                        if (which === 'hp' && isPct) setPctHpCooldown(PCT_CD_MS);
                        else if (which === 'hp') setHpPotionCooldown(HP_POTION_CD);
                        else if (which === 'mp' && isPct) setPctMpCooldown(PCT_CD_MS);
                        else setMpPotionCooldown(MP_POTION_CD);
                        useCombatStore.getState().addSessionLog(
                            `:test-tube: Auto-potion: ${elixir.name_pl} (+${heal.toLocaleString('pl-PL')} ${which.toUpperCase()})`,
                            'system',
                        );
                    };
                    tryFire(
                        settings.autoPotionHpEnabled,
                        settings.autoPotionHpId,
                        settings.autoPotionHpThreshold,
                        'hp',
                        false,
                    );
                    tryFire(
                        settings.autoPotionMpEnabled,
                        settings.autoPotionMpId,
                        settings.autoPotionMpThreshold,
                        'mp',
                        false,
                    );
                    tryFire(
                        settings.autoPotionPctHpEnabled,
                        settings.autoPotionPctHpId,
                        settings.autoPotionPctHpThreshold,
                        'hp',
                        true,
                    );
                    tryFire(
                        settings.autoPotionPctMpEnabled,
                        settings.autoPotionPctMpId,
                        settings.autoPotionPctMpThreshold,
                        'mp',
                        true,
                    );
                }
            }

            if (
                playerWaitingResRef.current &&
                character?.id &&
                tick % 4 === 0
            ) {
                const meIdx = nextMembers.findIndex((m) => m.id === character.id);
                const me = meIdx >= 0 ? nextMembers[meIdx] : null;
                if (me && me.isDead) {
                    const helpers = nextMembers.filter(
                        (m) => !m.isDead && !m.hasEscaped && m.id !== character.id,
                    );
                    if (helpers.length > 0) {
                        const rezChance = Math.min(0.30, 0.08 * helpers.length);
                        if (Math.random() < rezChance) {
                            me.isDead = false;
                            me.hp = Math.max(1, Math.floor(me.maxHp * 0.5));
                            me.mp = Math.floor(me.maxMp * 0.3);
                            const helper = helpers[Math.floor(Math.random() * helpers.length)];
                            addLog(`:high-voltage: ${helper.name} wskrzesił Cię! (+50% HP / +30% MP)`);
                            playerWaitingResRef.current = false;
                            playerDeathHandledRef.current = false;
                        }
                    }
                }
            }

            for (let mi = 0; mi < nextMembers.length; mi++) {
                const mem = nextMembers[mi];
                if (mem.isDead || mem.hasEscaped) continue;
                const memStunned = isCombatantStunned(effectsRef.current, allyFxId(mem.id));

                if (!memStunned && tick % 2 === 0) {
                    const target = nextBosses.find((b) => !b.isDead);
                    if (target) {
                        const memCfg = (classesData as ReadonlyArray<{ id: string; dualWield?: boolean }>)
                            .find((c) => c.id === mem.class);
                        const memDual = !!memCfg?.dualWield;
                        const isMe = mem.id === character?.id;
                        const targetSlot = nextBosses.indexOf(target);
                        const computeDmg = (pct: number): number => {
                            let d = mitigateDamage(Math.floor(mem.attack * pct), Math.floor(target.defense * 0.5), mem.level, true);
                            if (mem.class === 'Necromancer') {
                                const summonBonus = useNecroSummonStore.getState().totalAttackBonus(mem.id, mem.attack);
                                if (summonBonus > 0) {
                                    d += mitigateDamage(Math.floor(summonBonus * pct), Math.floor(target.defense * 0.5), mem.level, true);
                                }
                            }
                            return d;
                        };
                        const fireOne = (hand: 'left' | 'right' | null, pct: number) => {
                            let dmg = computeDmg(pct);
                            const bossStAmp = ensureStatus(effectsRef.current, target.id);
                            const ampMem = consumeTargetMarkAmp(bossStAmp);
                            if (ampMem.mult !== 1) {
                                dmg = Math.max(1, Math.floor(dmg * ampMem.mult));
                            }
                            target.currentHp = Math.max(0, target.currentHp - dmg);
                            const targetIdForPulse = target.id;
                            setBossHitPulses((prev) => ({
                                ...prev,
                                [targetIdForPulse]: (prev[targetIdForPulse] ?? 0) + 1,
                            }));
                            if (targetSlot >= 0) {
                                fx.pushEnemyFloat(targetSlot, dmg, isMe ? 'basic' : 'ally-basic', {
                                    icon: hand ? 'dagger' : undefined,
                                });
                            }
                            flashBossAttacker(target.id, mem.class);
                            if (isLeaderInPartyCombat) {
                                const dmgCap = dmg;
                                const targetIdCap = target.id;
                                const memIdCap = mem.id;
                                const memClassCap = mem.class;
                                const iconCap = hand ? 'dagger' : undefined;
                                const kindCap = isMe ? 'basic' : 'ally-basic';
                                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                    usePartyCombatSyncStore.getState().publishRaidDamage({
                                        attackerId: memIdCap,
                                        attackerClass: memClassCap,
                                        targetId: targetIdCap,
                                        damage: dmgCap,
                                        kind: kindCap,
                                        icon: iconCap,
                                    });
                                }).catch(() => { });
                            }
                            return dmg;
                        };
                        if (memDual) {
                            fireOne('left', 0.6);
                            setTimeout(() => {
                                if (target.isDead || target.currentHp <= 0) return;
                                fireOne('right', 0.6);
                            }, 150);
                        } else {
                            fireOne(null, 1.0);
                        }
                        if (target.currentHp <= 0) {
                            target.isDead = true;
                            useCombatStore.getState().incrementSessionKill('boss');
                            if (mem.id === character?.id) {
                                useTaskStore.getState().addKill(target.baseId, target.level, 1);
                                useQuestStore.getState().addProgress('kill', target.baseId, 1, target.level);
                                useDailyQuestStore.getState().addProgress('kill_any', 1);
                                useDailyQuestStore.getState().addProgress('kill_boss', 1);
                                useMasteryStore.getState().addMasteryKills(target.baseId, 1);
                            }
                        }
                        if (mem.id === character?.id) {
                            const dmgMode = memDual ? 'podwójne cięcie' : 'cios';
                            addLog(`:crossed-swords: ${dmgMode} -> ${target.name}`);
                        }
                    }
                }

                if (memStunned) continue;
                const isPlayer = mem.id === character?.id;
                const liveCh = isPlayer ? useCharacterStore.getState().character : null;
                const effectiveLevel = liveCh ? Math.min(mem.level, liveCh.level) : mem.level;
                const playerSlottedIds = isPlayer
                    ? new Set(activeSkillSlots.filter((id): id is string => !!id))
                    : null;
                const skills = getClassActiveSkills(mem.class)
                    .filter((s) => s.unlockLevel <= effectiveLevel && s.damage > 0)
                    .filter((s) => playerSlottedIds === null || playerSlottedIds.has(s.id));
                const manualSkills = isPlayer
                    ? getClassActiveSkills(mem.class)
                        .filter((s) => s.unlockLevel <= effectiveLevel)
                        .filter((s) => playerSlottedIds === null || playerSlottedIds.has(s.id))
                    : skills;
                const memCds = cooldownsRef.current[mem.id] ?? {};

                let chosen = null as ReturnType<typeof getClassActiveSkills>[number] | null;
                if (isPlayer && skillQueueRef.current.length > 0) {
                    const slotIdx = skillQueueRef.current.shift()!;
                    const wantedId = activeSkillSlots[slotIdx];
                    const def = wantedId
                        ? manualSkills.find((s) => s.id === wantedId)
                        : null;
                    if (def && mem.mp >= def.mpCost && (memCds[def.id] ?? 0) <= tick) {
                        chosen = def;
                    }
                }
                if (!chosen && !isPlayer && !mem.isBot && !mem.hasEscaped && !mem.isDead) {
                    const pcss = usePartyCombatSyncStore.getState();
                    const wantedId = pcss.consumeMemberSkillRequest(mem.id);
                    if (wantedId) {
                        const def = getClassActiveSkills(mem.class)
                            .filter((s) => s.unlockLevel <= mem.level)
                            .find((s) => s.id === wantedId);
                        if (def && mem.mp >= def.mpCost && (memCds[def.id] ?? 0) <= tick) {
                            chosen = def;
                        }
                    }
                }
                let memSkillMode: 'auto' | 'manual' = 'auto';
                if (isPlayer) {
                    memSkillMode = skillMode;
                } else if (!mem.isBot) {
                    const pres = usePartyPresenceStore.getState().byMember[mem.id];
                    memSkillMode = pres?.skillMode ?? 'auto';
                }
                const autoSkillAllowed = memSkillMode === 'auto';
                if (!chosen && autoSkillAllowed && tick % 2 === 0) {
                    chosen = skills
                        .filter((s) => mem.mp >= s.mpCost && (memCds[s.id] ?? 0) <= tick)
                        .sort((a, b) => {
                            const ca = memCds[a.id] ?? 0;
                            const cb = memCds[b.id] ?? 0;
                            if (ca !== cb) return ca - cb;
                            return b.unlockLevel - a.unlockLevel;
                        })[0] ?? null;
                }
                if (chosen) {
                        mem.mp = Math.max(0, mem.mp - chosen.mpCost);
                        cooldownsRef.current[mem.id] = {
                            ...memCds,
                            [chosen.id]: tick + Math.ceil(chosen.cooldown / 500),
                        };
                        if (mem.id === character?.id) {
                            const cdMs = chosen.cooldown;
                            const skillId = chosen.id;
                            setPlayerSkillCooldowns((prev) => ({ ...prev, [skillId]: cdMs }));
                        }
                        const firstAliveIdx = nextBosses.findIndex((b) => !b.isDead);
                        const primaryBoss = firstAliveIdx >= 0 ? nextBosses[firstAliveIdx] : null;
                        const primaryHpPct = primaryBoss && primaryBoss.maxHp > 0
                            ? (primaryBoss.currentHp / primaryBoss.maxHp) * 100
                            : 100;
                        const allyIds = nextMembers.filter((m) => !m.isDead && !m.hasEscaped).map((m) => allyFxId(m.id));
                        const enemyIds = nextBosses.filter((b) => !b.isDead).map((b) => b.id);
                        if ((chosen.effect ?? '').includes('death_apocalypse') && mem.class === 'Necromancer') {
                            const hpPct = mem.hp / Math.max(1, mem.maxHp);
                            if (hpPct < 0.05) {
                                if (mem.id === character?.id) {
                                    addLog(':broken-heart: Apokalipsa zablokowana: < 5% HP');
                                }
                                continue;
                            }
                            let newMemHp: number;
                            if (hpPct > 0.20) {
                                newMemHp = Math.max(1, mem.hp - Math.floor(mem.maxHp * 0.20));
                            } else {
                                newMemHp = Math.max(1, Math.floor(mem.maxHp * 0.03));
                            }
                            const lost = mem.hp - newMemHp;
                            if (lost > 0) {
                                mem.hp = newMemHp;
                                if (mem.id === character?.id) {
                                    useCharacterStore.getState().updateCharacter({ hp: newMemHp });
                                    addLog(`:broken-heart: Apokalipsa: -${lost} HP`);
                                } else {
                                    addLog(`:broken-heart: ${mem.name}: Apokalipsa -${lost} HP`);
                                }
                            }
                        }
                        const apply = effectsCastSkill({
                            session: effectsRef.current,
                            casterId: allyFxId(mem.id),
                            targetId: primaryBoss ? primaryBoss.id : null,
                            targetHpPct: primaryHpPct,
                            effect: chosen.effect,
                            allyIds,
                            enemyIds,
                        });
                        const aoe = apply.aoe;
                        const targets = aoe
                            ? nextBosses.map((b, i) => (b.isDead ? -1 : i)).filter((i) => i >= 0)
                            : (firstAliveIdx >= 0 ? [firstAliveIdx] : []);
                        const skillDmgMult = rollSkillDamageMult(chosen.damage, isPlayer ? (useSkillStore.getState().skillUpgradeLevels[chosen.id] ?? 0) : 0);
                        const baseDmg = Math.floor(mem.attack * skillDmgMult * apply.castDmgMult);
                        void apply.multistrike;
                        if (apply.summons.length > 0 && mem.class === 'Necromancer') {
                            const store = useNecroSummonStore.getState();
                            for (const sm of apply.summons) {
                                const spawned = store.spawn(mem.id, sm.type, sm.count, mem.attack, mem.maxHp);
                                if (spawned > 0 && mem.id === character?.id) {
                                    const memSlot = nextMembers.findIndex((mm) => mm.id === mem.id);
                                    if (memSlot >= 0) fx.triggerAllySummonSpawn(memSlot, sm.type);
                                }
                            }
                        }
                        if (apply.deathApocalypse && mem.class === 'Necromancer') {
                            const apocTarget = nextBosses.find((b) => !b.isDead);
                            if (apocTarget) {
                                const apocDmg = Math.max(1, Math.floor(apocTarget.maxHp * (apply.deathApocalypseTargetMaxHpPct / 100)));
                                apocTarget.currentHp = Math.max(0, apocTarget.currentHp - apocDmg);
                                if (apocTarget.currentHp <= 0) {
                                    apocTarget.isDead = true;
                                    useCombatStore.getState().incrementSessionKill('boss');
                                }
                                const apocSlot = nextBosses.indexOf(apocTarget);
                                if (apocSlot >= 0) {
                                    fx.pushEnemyFloat(apocSlot, apocDmg, 'spell', { icon: 'skull-and-crossbones', label: 'APOKALIPSA', isCrit: true });
                                }
                                if (isLeaderInPartyCombat) {
                                    const dmgCap = apocDmg;
                                    const tIdCap = apocTarget.id;
                                    const memIdCap = mem.id;
                                    const memClassCap = mem.class;
                                    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                        usePartyCombatSyncStore.getState().publishRaidDamage({
                                            attackerId: memIdCap,
                                            attackerClass: memClassCap,
                                            targetId: tIdCap,
                                            damage: dmgCap,
                                            kind: 'spell',
                                            icon: 'skull-and-crossbones',
                                            label: 'APOKALIPSA',
                                            isCrit: true,
                                        });
                                    }).catch(() => { });
                                }
                                addLog(`:skull-and-crossbones: ${mem.name}: Apokalipsa Śmierci ${apocDmg} dmg`);
                            }
                        }
                        const skillPulseBumps: string[] = [];
                        const isMe = mem.id === character?.id;
                        const skillKind = isMe ? 'spell' : 'ally-spell';
                        const skillIcon = getSkillIcon(chosen.id);
                        const isDamageHit = (chosen.damage ?? 0) > 0;
                        const castTargetsEnemy = isDamageHit || skillTargetsEnemy(chosen.effect ?? null);
                        let totalDmgDealtThisCast = 0;
                        if (!castTargetsEnemy) {
                            const casterSlot = nextMembers
                                .filter((m) => !m.hasEscaped)
                                .findIndex((m) => m.id === mem.id);
                            if (casterSlot >= 0) {
                                fx.pushAllyFloat(casterSlot, 0, 'heal', {
                                    icon: skillIcon,
                                    label: 'BUFF',
                                });
                                fx.triggerAllySkillAnim(casterSlot, chosen.id);
                            }
                            if (isLeaderInPartyCombat) {
                                const memIdCap = mem.id;
                                const memClassCap = mem.class;
                                const skillIdCap = chosen.id;
                                const skillIconCap = skillIcon;
                                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                    usePartyCombatSyncStore.getState().publishRaidDamage({
                                        attackerId: memIdCap,
                                        attackerClass: memClassCap,
                                        targetId: memIdCap,
                                        damage: 0,
                                        kind: 'heal',
                                        icon: skillIconCap,
                                        label: 'BUFF',
                                        skillId: skillIdCap,
                                    });
                                }).catch(() => { });
                            }
                        }
                        const enemyTargets = castTargetsEnemy ? targets : [];
                        for (const ti of enemyTargets) {
                            const t = nextBosses[ti];
                            if (!t || t.isDead) continue;
                            const normalDmgRaid = mitigateDamage(baseDmg, Math.floor(t.defense * 0.3), effectiveLevel, true);
                            let dmg = apply.instantKill
                                ? Math.max(1, t.currentHp)
                                : ((apply.executeBurstPct ?? 0) > 0
                                    ? Math.max(normalDmgRaid, Math.floor(t.maxHp * (apply.executeBurstPct ?? 0) / 100))
                                    : normalDmgRaid);
                            if (!apply.instantKill) {
                                const tStAmp = ensureStatus(effectsRef.current, t.id);
                                const ampSp = consumeTargetMarkAmp(tStAmp);
                                if (ampSp.mult !== 1) {
                                    dmg = Math.max(1, Math.floor(dmg * ampSp.mult));
                                }
                            }
                            t.currentHp = Math.max(0, t.currentHp - dmg);
                            totalDmgDealtThisCast += dmg;
                            skillPulseBumps.push(t.id);
                            fx.pushEnemyFloat(ti, dmg, skillKind, { icon: skillIcon });
                            if (isLeaderInPartyCombat) {
                                const dmgCap = dmg;
                                const tIdCap = t.id;
                                const memIdCap = mem.id;
                                const memClassCap = mem.class;
                                const skillIdCap = chosen.id;
                                const skillIconCap = skillIcon;
                                const kindCap = skillKind;
                                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                    usePartyCombatSyncStore.getState().publishRaidDamage({
                                        attackerId: memIdCap,
                                        attackerClass: memClassCap,
                                        targetId: tIdCap,
                                        damage: dmgCap,
                                        kind: kindCap,
                                        icon: skillIconCap,
                                        skillId: skillIdCap,
                                    });
                                }).catch(() => { });
                            }
                            if (t.currentHp <= 0) {
                                t.isDead = true;
                                useCombatStore.getState().incrementSessionKill('boss');
                                if (mem.id === character?.id) {
                                    useTaskStore.getState().addKill(t.baseId, t.level, 1);
                                    useQuestStore.getState().addProgress('kill', t.baseId, 1, t.level);
                                    useDailyQuestStore.getState().addProgress('kill_any', 1);
                                    useDailyQuestStore.getState().addProgress('kill_boss', 1);
                                    useMasteryStore.getState().addMasteryKills(t.baseId, 1);
                                }
                            }
                        }
                        if (skillPulseBumps.length > 0) {
                            setBossHitPulses((prev) => {
                                const next = { ...prev };
                                for (const bid of skillPulseBumps) {
                                    next[bid] = (next[bid] ?? 0) + 1;
                                }
                                return next;
                            });
                        }
                        if (apply.healCasterPctOfDmg > 0 && totalDmgDealtThisCast > 0) {
                            const heal = Math.floor(totalDmgDealtThisCast * (apply.healCasterPctOfDmg / 100));
                            if (heal > 0) {
                                const before = mem.hp;
                                mem.hp = Math.min(mem.maxHp, mem.hp + heal);
                                const actual = mem.hp - before;
                                if (mem.id === character?.id) {
                                    const cappedTag = actual < heal ? ' (MAX)' : '';
                                    fx.pushAllyFloat(0, heal, 'heal', {
                                        icon: 'sparkles',
                                        label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                                    });
                                    addLog(`:sparkles: ${chosen.id}: +${heal} HP${cappedTag}`);
                                }
                            }
                        }
                        if (apply.healCasterPctOfMaxHp > 0) {
                            const heal = Math.floor(mem.maxHp * (apply.healCasterPctOfMaxHp / 100));
                            if (heal > 0) {
                                const before = mem.hp;
                                mem.hp = Math.min(mem.maxHp, mem.hp + heal);
                                const actual = mem.hp - before;
                                if (mem.id === character?.id) {
                                    const cappedTag = actual < heal ? ' (MAX)' : '';
                                    fx.pushAllyFloat(0, heal, 'heal', {
                                        icon: 'sparkles',
                                        label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                                    });
                                }
                            }
                        }
                        if (apply.reviveDeadAllies) {
                            for (let mi = 0; mi < nextMembers.length; mi++) {
                                const m = nextMembers[mi];
                                if (m.isDead) {
                                    m.isDead = false;
                                    m.hp = Math.max(1, Math.floor(m.maxHp * 0.5));
                                    if (m.id === character?.id) {
                                        fx.pushAllyFloat(0, m.hp, 'heal', { icon: 'sparkles', label: '+REZ' });
                                        fx.triggerAllySkillAnim(0, chosen.id);
                                        addLog(`:sparkles: ${chosen.id}: wskrzeszony!`);
                                    }
                                }
                            }
                        }
                        if (apply.healLowestAllyPct > 0) {
                            const aliveMembers = nextMembers.filter((m) => !m.isDead);
                            if (aliveMembers.length > 0) {
                                let lowest = aliveMembers[0];
                                let lowestRatio = lowest.hp / Math.max(1, lowest.maxHp);
                                for (let i = 1; i < aliveMembers.length; i++) {
                                    const ratio = aliveMembers[i].hp / Math.max(1, aliveMembers[i].maxHp);
                                    if (ratio < lowestRatio) {
                                        lowest = aliveMembers[i];
                                        lowestRatio = ratio;
                                    }
                                }
                                const heal = Math.floor(lowest.maxHp * (apply.healLowestAllyPct / 100));
                                if (heal > 0) {
                                    const before = lowest.hp;
                                    lowest.hp = Math.min(lowest.maxHp, lowest.hp + heal);
                                    const actual = lowest.hp - before;
                                    if (lowest.id === character?.id) {
                                        const cappedTag = actual < heal ? ' (MAX)' : '';
                                        fx.pushAllyFloat(0, heal, 'heal', {
                                            icon: 'sparkles',
                                            label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                                        });
                                        fx.triggerAllySkillAnim(0, chosen.id);
                                        addLog(`:sparkles: ${chosen.id}: +${heal} HP${cappedTag}`);
                                    }
                                }
                            }
                        }
                        if (apply.healPartyPctInstant > 0) {
                            const liveSlots = nextMembers.filter((m) => !m.hasEscaped);
                            for (const m of nextMembers) {
                                if (m.isDead || m.hasEscaped) continue;
                                const heal = Math.floor(m.maxHp * (apply.healPartyPctInstant / 100));
                                if (heal <= 0) continue;
                                const before = m.hp;
                                m.hp = Math.min(m.maxHp, m.hp + heal);
                                const actual = m.hp - before;
                                if (m.id === character?.id && actual > 0) {
                                    const slot = liveSlots.findIndex((lm) => lm.id === m.id);
                                    const cappedTag = actual < heal ? ' (MAX)' : '';
                                    fx.pushAllyFloat(slot >= 0 ? slot : 0, heal, 'heal', {
                                        icon: 'sparkles',
                                        label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                                    });
                                    fx.triggerAllySkillAnim(slot >= 0 ? slot : 0, chosen.id);
                                    addLog(`:sparkles: ${chosen.id}: +${heal} HP${cappedTag}`);
                                }
                            }
                        }
                        if (apply.healPartyDotMs > 0 && apply.healPartyDotPctPerSec > 0) {
                            const cur = partyHealDotRef.current;
                            partyHealDotRef.current = {
                                remainingMs: Math.max(cur.remainingMs, apply.healPartyDotMs),
                                pctPerSec: Math.max(cur.pctPerSec, apply.healPartyDotPctPerSec),
                                accumMs: cur.accumMs,
                                skillId: apply.healPartyDotPctPerSec >= cur.pctPerSec ? chosen.id : cur.skillId,
                            };
                            if (mem.id === character?.id) {
                                addLog(`:sparkles: ${chosen.id}: regeneracja drużyny (${apply.healPartyDotPctPerSec}%/s)`);
                            }
                        }
                        fxQueue.push({
                            id: fxIdRef.current++,
                            skillId: chosen.id,
                            targets,
                            expiresAt: Date.now() + 900,
                        });
                        if (mem.id === character?.id) {
                            addLog(`:sparkles: Używasz ${chosen.id} (${aoe ? 'AOE' : 'single'})`);
                        }
                    }
            }

            if (tick % 3 === 0) {
                const memberPulseBumps: string[] = [];
                const aggroPicks: Record<string, string> = {};
                for (const boss of nextBosses) {
                    if (boss.isDead) continue;
                    if (isCombatantStunned(effectsRef.current, boss.id)) continue;
                    const liveTargets = nextMembers.filter((m) => !m.isDead && !m.hasEscaped);
                    if (liveTargets.length === 0) break;
                    const tgt = liveTargets[Math.floor(Math.random() * liveTargets.length)];
                    aggroPicks[boss.id] = tgt.id;
                    const tgtSt = effectsRef.current.statuses.get(allyFxId(tgt.id));
                    if (tgtSt && tgtSt.dodgeBuffMs > 0 && tgtSt.dodgeBuffPct > 0) {
                        if (Math.random() * 100 < tgtSt.dodgeBuffPct) {
                            const tgtSlot = nextMembers.filter((m) => !m.hasEscaped).indexOf(tgt);
                            if (tgtSlot >= 0) {
                                fx.pushAllyFloat(tgtSlot, 0, 'heal', { icon: 'dashing-away', label: 'UNIK' });
                            }
                            if (isLeaderInPartyCombat) {
                                const tgtIdCap = tgt.id;
                                const bossIdCap = boss.id;
                                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                    usePartyCombatSyncStore.getState().publishRaidDamage({
                                        attackerId: 'monster',
                                        sourceBossId: bossIdCap,
                                        targetId: tgtIdCap,
                                        damage: 0,
                                        kind: 'heal',
                                        icon: 'dashing-away',
                                        label: 'UNIK',
                                    });
                                }).catch(() => { });
                            }
                            if (tgt.id === character?.id) {
                                addLog(`:dashing-away: Bomba Dymna! Unikasz ataku ${boss.name} (${tgtSt.dodgeBuffPct}%)`);
                            }
                            continue;
                        }
                    }
                    const rawDmg = mitigateDamage(boss.attack, Math.floor(tgt.defense * 0.4), boss.level);
                    let appliedDmg = rawDmg;
                    if (tgt.class === 'Necromancer' && rawDmg > 0) {
                        const store = useNecroSummonStore.getState();
                        if (store.count(tgt.id) > 0) {
                            const r2 = store.damageFirst(tgt.id, rawDmg);
                            appliedDmg = Math.max(0, rawDmg - r2.dmgConsumed);
                        }
                    }
                    tgt.hp = Math.max(0, tgt.hp - appliedDmg);
                    memberPulseBumps.push(tgt.id);
                    const liveSlotMembers = nextMembers.filter((m) => !m.hasEscaped);
                    const tgtSlot = liveSlotMembers.indexOf(tgt);
                    if (tgtSlot >= 0) {
                        fx.pushAllyFloat(tgtSlot, rawDmg, 'monster');
                    }
                    const tgtIdLocal = tgt.id;
                    setMemberAttackingClass((prev) => ({ ...prev, [tgtIdLocal]: 'attack-Necromancer' }));
                    window.setTimeout(() => {
                        setMemberAttackingClass((prev) => {
                            if (!prev[tgtIdLocal]) return prev;
                            const next = { ...prev };
                            delete next[tgtIdLocal];
                            return next;
                        });
                    }, ATTACK_ANIM_DURATION['Necromancer'] ?? 450);
                    if (isLeaderInPartyCombat) {
                        const rawDmgCap = rawDmg;
                        const tgtIdCap = tgt.id;
                        const bossIdCap = boss.id;
                        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                            usePartyCombatSyncStore.getState().publishRaidDamage({
                                attackerId: 'monster',
                                sourceBossId: bossIdCap,
                                targetId: tgtIdCap,
                                damage: rawDmgCap,
                                kind: 'monster',
                            });
                        }).catch(() => { });
                    }
                    if (tgt.hp <= 0) {
                        tgt.isDead = true;
                        addLog(`:skull: ${tgt.name} pada!`);
                    }
                }
                if (memberPulseBumps.length > 0) {
                    setMemberHitPulses((prev) => {
                        const next = { ...prev };
                        for (const mid of memberPulseBumps) {
                            next[mid] = (next[mid] ?? 0) + 1;
                        }
                        return next;
                    });
                }
                setBossAggroIds((prev) => {
                    const keys = Object.keys(aggroPicks);
                    if (keys.length === 0) return prev;
                    let changed = false;
                    for (const k of keys) {
                        if (prev[k] !== aggroPicks[k]) { changed = true; break; }
                    }
                    if (!changed && keys.length === Object.keys(prev).length) return prev;
                    return aggroPicks;
                });
            }

            if (character?.id && !playerDeathHandledRef.current) {
                const me = nextMembers.find((m) => m.id === character.id);
                const aliveAllies = nextMembers.filter(
                    (m) => !m.isDead && !m.hasEscaped && m.id !== character.id,
                ).length;
                if (me && me.isDead && aliveAllies > 0) {
                    playerDeathHandledRef.current = true;
                    setPartyChoiceAlliesAlive(aliveAllies);
                    setPartyChoiceOpen(true);
                    addLog(':skull: Padłeś! Wybierz: Powrót do miasta lub Czekaj na wskrzeszenie.');
                }
            }

            setBosses(nextBosses);
            setMembers(nextMembers);
            if (fxQueue.length > 0) setSkillFx((prev) => [...prev, ...fxQueue]);

            const me = nextMembers.find((m) => m.id === character?.id);
            if (me) {
                useCharacterStore.getState().updateCharacter({ hp: me.hp, mp: me.mp });
            }

            if (nextBosses.every((b) => b.isDead)) {
                const nextWaveIdx = currentWave + 1;
                if (selectedRaid && nextWaveIdx < selectedRaid.waves) {
                    const waveDelayMs = Math.max(60, Math.floor(800 / speedMult));
                    spawnStartRef.current = Date.now();
                    spawnDurationRef.current = waveDelayMs;
                    setSpawnProgress(0);
                    setWaitingForSpawn(true);
                    addLog(`:check-mark-button: Fala ${nextWaveIdx}/${selectedRaid.waves} zaliczona!`);
                    setTimeout(() => {
                        if (phaseRef.current !== 'fighting') return;
                        setCurrentWave(nextWaveIdx);
                        setBosses(generateWaveBosses(selectedRaid, nextWaveIdx));
                        setWaitingForSpawn(false);
                        setSpawnProgress(0);
                    }, waveDelayMs);
                } else if (selectedRaid) {
                    leavePenaltyAppliedRef.current = true;
                    setPhase('victory');
                    useNecroSummonStore.getState().clearAll();
                    distributeRewards(selectedRaid, nextMembers);
                }
            }

            if (nextMembers.every((m) => m.isDead || m.hasEscaped)) {
                leavePenaltyAppliedRef.current = true;
                setPhase('wipe');
                useNecroSummonStore.getState().clearAll();
                handleWipe();
            }
        }, Math.max(100, 500 / speedMult));

        return () => clearInterval(interval);
    }, [phase, speedMult, selectedRaid, currentWave, character?.id, isNonLeaderMember]);

    useEffect(() => {
        if (skillFx.length === 0) return;
        const t = setTimeout(() => {
            setSkillFx((prev) => prev.filter((f) => f.expiresAt > Date.now()));
        }, 400);
        return () => clearTimeout(t);
    }, [skillFx]);

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
        if (phase !== 'fighting') {
            setWaitingForSpawn(false);
            setSpawnProgress(0);
            setPartyChoiceOpen(false);
            playerWaitingResRef.current = false;
            playerDeathHandledRef.current = false;
        }
    }, [phase]);

    const handleWipe = useCallback(() => {
        const char = useCharacterStore.getState().character;
        if (!char) return;
        const raidForLog = selectedRaidRef.current;
        if (isBackendMode() && char) {
            void backendApi.logDeath(char.id, {
                source: 'raid',
                source_name: raidForLog?.name_pl ?? 'Rajd',
                source_level: raidForLog?.level ?? char.level,
                result: 'killed',
            });
        } else {
            void deathsApi.logDeath({
                character_id: char.id,
                character_name: char.name,
                character_class: char.class,
                character_level: char.level,
                source: 'raid',
                source_name: raidForLog?.name_pl ?? 'Rajd',
                source_level: raidForLog?.level ?? char.level,
                result: 'killed',
            });
        }
        const prot = consumeDeathProtection();
        const oldLevel = char.level;
        let newLevel = char.level;
        let levelsLost = 0;
        let xpPercent = 100;
        let skillXpLossPercent = 0;
        const refillFullEffective = () => {
            useCharacterStore.getState().fullHealEffective();
        };
        if (prot.isProtected) {
            refillFullEffective();
            addLog(
                prot.consumedId === 'death_protection'
                    ? ':shield: Eliksir Ochrony uchronił Cię od jakichkolwiek strat!'
                    : ':trident-emblem: Amulet of Loss uchronił Cię od jakichkolwiek strat!',
            );
        } else {
            const p = applyDeathPenalty(char.level, char.xp);
            useCharacterStore.getState().updateCharacter({
                level: p.newLevel,
                xp: p.newXp,
            });
            refillFullEffective();
            useSkillStore.getState().applyDeathPenalty(char.class, p.skillXpLossPercent);
            useSkillStore.getState().purgeLockedSkillSlots(char.class, p.newLevel);
            newLevel = p.newLevel;
            levelsLost = p.levelsLost;
            xpPercent = p.xpPercent;
            skillXpLossPercent = p.skillXpLossPercent;
            addLog(`:skull: Wipe! Kara: -${p.levelsLost} lvl · -${p.skillXpLossPercent}% Skill XP`);
            const itemsLost = useInventoryStore.getState().applyDeathItemLoss(false, char.level);
            if (itemsLost > 0) {
                addLog(`:skull: Stracileś ${itemsLost} przedmiot(ow) przy wipe!`);
            }
        }
        useCombatStore.getState().clearCombatSession();
        void (async () => {
            try {
                await usePartyStore.getState().leaveParty(char.id);
            } catch { }
        })();
        const raid = selectedRaidRef.current;
        useDeathStore.getState().triggerDeath({
            killedBy: raid?.name_pl ?? 'Rajd',
            sourceLevel: raid?.level ?? char.level,
            oldLevel,
            newLevel,
            levelsLost,
            xpPercent,
            skillXpLossPercent,
            protectionUsed: prot.isProtected,
            source: 'raid',
        });
    }, [addLog]);

    const wipeForcedRef = useRef(false);
    useEffect(() => {
        if (!isNonLeaderMember) return;
        if (phase !== 'wipe') return;
        if (wipeForcedRef.current) return;
        if (leavePenaltyAppliedRef.current) return;
        wipeForcedRef.current = true;
        leavePenaltyAppliedRef.current = true;
        void (async () => {
            try {
                const me = useCharacterStore.getState().character?.id;
                if (me) await usePartyStore.getState().leaveParty(me);
            } catch { }
        })();
        handleWipe();
    }, [phase, isNonLeaderMember, handleWipe]);
    useEffect(() => {
        if (phase === 'fighting') wipeForcedRef.current = false;
    }, [phase]);

    const handleReturnToTown = useCallback(() => {
        setPartyChoiceOpen(false);
        playerWaitingResRef.current = false;
        leavePenaltyAppliedRef.current = true;
        const char = useCharacterStore.getState().character;
        if (!char) {
            navigate('/');
            return;
        }
        const raidForLog = selectedRaidRef.current;
        if (isBackendMode() && char) {
            void backendApi.logDeath(char.id, {
                source: 'raid',
                source_name: raidForLog?.name_pl ?? 'Rajd',
                source_level: raidForLog?.level ?? char.level,
                result: 'killed',
            });
        } else {
            void deathsApi.logDeath({
                character_id: char.id,
                character_name: char.name,
                character_class: char.class,
                character_level: char.level,
                source: 'raid',
                source_name: raidForLog?.name_pl ?? 'Rajd',
                source_level: raidForLog?.level ?? char.level,
                result: 'killed',
            });
        }
        const pty = usePartyStore.getState().party;
        const me = char.id;
        if (pty) {
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
        const prot = consumeDeathProtection();
        const oldLevel = char.level;
        let newLevel = char.level;
        let levelsLost = 0;
        let xpPercent = 100;
        let skillXpLossPercent = 0;
        const refillFullEffective = () => {
            const live = useCharacterStore.getState().character;
            if (!live) return;
            const eff = getEffectiveChar(live);
            useCharacterStore.getState().updateCharacter({
                hp: eff?.max_hp ?? live.max_hp,
                mp: eff?.max_mp ?? live.max_mp,
            });
        };
        if (prot.isProtected) {
            refillFullEffective();
            addLog(
                prot.consumedId === 'death_protection'
                    ? ':shield: Eliksir Ochrony uchronił Cię od jakichkolwiek strat!'
                    : ':trident-emblem: Amulet of Loss uchronił Cię od jakichkolwiek strat!',
            );
        } else {
            const p = applyDeathPenalty(char.level, char.xp);
            useCharacterStore.getState().updateCharacter({
                level: p.newLevel,
                xp: p.newXp,
            });
            refillFullEffective();
            useSkillStore.getState().applyDeathPenalty(char.class, p.skillXpLossPercent);
            useSkillStore.getState().purgeLockedSkillSlots(char.class, p.newLevel);
            newLevel = p.newLevel;
            levelsLost = p.levelsLost;
            xpPercent = p.xpPercent;
            skillXpLossPercent = p.skillXpLossPercent;
            addLog(`:skull: Wracasz do miasta. Kara: -${p.levelsLost} lvl · -${p.skillXpLossPercent}% Skill XP`);
            const itemsLost = useInventoryStore.getState().applyDeathItemLoss(false, char.level);
            if (itemsLost > 0) {
                addLog(`:skull: Stracileś ${itemsLost} przedmiot(ow)!`);
            }
        }
        useCombatStore.getState().clearCombatSession();
        const raid = selectedRaidRef.current;
        useDeathStore.getState().triggerDeath({
            killedBy: raid?.name_pl ?? 'Rajd',
            sourceLevel: raid?.level ?? char.level,
            oldLevel,
            newLevel,
            levelsLost,
            xpPercent,
            skillXpLossPercent,
            protectionUsed: prot.isProtected,
            source: 'raid',
        });
    }, [addLog, navigate]);

    const handleWaitForResurrection = useCallback(() => {
        setPartyChoiceOpen(false);
        playerWaitingResRef.current = true;
        addLog(':hourglass-not-done: Czekasz na wskrzeszenie...');
    }, [addLog]);

    const distributeRewards = useCallback((raid: IRaid, finalMembers: IRaidMemberState[]) => {
        const bossesDefeatedPerMember = raid.waves * 4;
        const perMember: Record<string, IRaidDropLine[]> = {};
        const itemsPerMember: Record<string, IInventoryItem[]> = {};

        for (const mem of finalMembers) {
            if (mem.hasEscaped) continue;
            const result = rollMemberRewards({
                member: mem,
                raid,
                bossesDefeated: bossesDefeatedPerMember,
            });
            perMember[mem.id] = result.drops;
            itemsPerMember[mem.id] = result.items;

            if (character && mem.id === character.id) {
                useCharacterStore.getState().addXp(result.xp);
                const inv = useInventoryStore.getState();
                inv.addGold(result.gold);
                for (const it of result.items) inv.addItem(it);
                for (const drop of result.drops) {
                    if (drop.kind === 'spell_chest' && drop.amount) {
                        inv.addSpellChest(drop.amount, 1);
                    }
                }
                useCombatStore.getState().addSessionStats(result.xp, result.gold);
                useCombatStore.getState().appendDrops(
                    result.drops.map((d) => ({
                        icon: 'wrapped-gift',
                        name: d.label,
                        rarity: d.rarity ?? 'common',
                    })),
                );
            }
        }
        setDropsByMember(perMember);
        setItemsByMember(itemsPerMember);
        addLog(':trophy: Rajd ukończony! Nagrody rozdzielone.');
    }, [character, addLog]);

    const handleEscape = useCallback(async () => {
        if (!character) return;
        leavePenaltyAppliedRef.current = true;
        setMembers((prev) =>
            prev.map((m) => (m.id === character.id ? { ...m, hasEscaped: true } : m)),
        );
        addLog(':white-flag: Uciekasz z rajdu! Party opuszczone.');
        const raidForRefund = selectedRaidRef.current;
        if (raidForRefund) {
            refundAttempt(raidForRefund.id);
        }
        const ptyForFlee = usePartyStore.getState().party;
        const meId = character.id;
        if (ptyForFlee && ptyForFlee.leaderId === meId) {
            const presence = usePartyPresenceStore.getState().byMember;
            const candidate = ptyForFlee.members.find((m) => {
                if (m.id === meId) return false;
                if (m.isBot) return false;
                const pres = presence[m.id];
                return !pres || pres.hp > 0;
            }) ?? ptyForFlee.members.find((m) => m.id !== meId && !m.isBot);
            if (candidate) {
                try {
                    await usePartyStore.getState().transferLeadership(candidate.id);
                } catch { }
            }
        }
        try { await leaveParty(character.id); } catch { }
        const raidForFlee = selectedRaidRef.current;
        if (character.level > 1) {
            if (isBackendMode() && character) {
                void backendApi.logDeath(character.id, {
                    source: 'raid',
                    source_name: raidForFlee?.name_pl ?? 'Rajd',
                    source_level: raidForFlee?.level ?? character.level,
                    result: 'fled',
                });
            } else {
                void deathsApi.logDeath({
                    character_id: character.id,
                    character_name: character.name,
                    character_class: character.class,
                    character_level: character.level,
                    source: 'raid',
                    source_name: raidForFlee?.name_pl ?? 'Rajd',
                    source_level: raidForFlee?.level ?? character.level,
                    result: 'fled',
                });
            }
            const prot = consumeDeathProtection();
            if (prot.isProtected) {
                addLog(
                    prot.consumedId === 'death_protection'
                        ? ':shield: Eliksir Ochrony uchronił Cię od jakichkolwiek strat przy ucieczce!'
                        : ':trident-emblem: Amulet of Loss uchronił Cię od jakichkolwiek strat przy ucieczce!',
                );
                useDeathStore.getState().triggerDeath({
                    kind: 'flee',
                    killedBy: raidForFlee?.name_pl ?? 'Rajd',
                    sourceLevel: raidForFlee?.level ?? character.level,
                    oldLevel: character.level,
                    newLevel: character.level,
                    levelsLost: 0,
                    xpPercent: 100,
                    skillXpLossPercent: 0,
                    protectionUsed: true,
                    source: 'flee',
                });
            } else {
                const p = applyFleePenalty(character.level, character.xp);
                useCharacterStore.getState().updateCharacter({
                    level: p.newLevel,
                    xp: p.newXp,
                });
                useSkillStore.getState().applyDeathPenalty(character.class, p.skillXpLossPercent);
                if (p.levelsLost > 0) {
                    useSkillStore.getState().purgeLockedSkillSlots(character.class, p.newLevel);
                }
                useDeathStore.getState().triggerDeath({
                    kind: 'flee',
                    killedBy: raidForFlee?.name_pl ?? 'Rajd',
                    sourceLevel: raidForFlee?.level ?? character.level,
                    oldLevel: character.level,
                    newLevel: p.newLevel,
                    levelsLost: p.levelsLost,
                    xpPercent: p.xpPercent,
                    skillXpLossPercent: p.skillXpLossPercent,
                    protectionUsed: false,
                    source: 'flee',
                });
            }
        }
        useCombatStore.getState().clearCombatSession();
        setPhase('lobby');
        setSelectedRaid(null);
        navigate('/');
    }, [character, leaveParty, addLog, navigate, refundAttempt]);

    const backToLobby = useCallback(() => {
        setPhase('lobby');
        setSelectedRaid(null);
        setBosses([]);
        setMembers([]);
        setSkillFx([]);
        setDropsByMember({});
        fx.resetFx();
    }, [fx.resetFx]);

    useEffect(() => {
        if (phase !== 'victory' && phase !== 'wipe') return;
        if (resultDeathAppliedRef.current) return;
        if (leavePenaltyAppliedRef.current) return;
        const ch = useCharacterStore.getState().character;
        if (!ch) return;
        const meMember = membersRef.current.find((m) => m.id === ch.id);
        if (!meMember) return;
        if (!meMember.isDead) return;
        if (meMember.hasEscaped) return;
        if (phase === 'wipe') {
            resultDeathAppliedRef.current = true;
            return;
        }
        resultDeathAppliedRef.current = true;
        leavePenaltyAppliedRef.current = true;
        {
            const raidForLog = selectedRaidRef.current;
            if (isBackendMode() && ch) {
                void backendApi.logDeath(ch.id, {
                    source: 'raid',
                    source_name: raidForLog?.name_pl ?? 'Rajd',
                    source_level: raidForLog?.level ?? ch.level,
                    result: 'killed',
                });
            } else {
                void deathsApi.logDeath({
                    character_id: ch.id,
                    character_name: ch.name,
                    character_class: ch.class,
                    character_level: ch.level,
                    source: 'raid',
                    source_name: raidForLog?.name_pl ?? 'Rajd',
                    source_level: raidForLog?.level ?? ch.level,
                    result: 'killed',
                });
            }
        }
        const oldLevel = ch.level;
        if (oldLevel > 1) {
            const prot = consumeDeathProtection();
            const p = applyDeathPenalty(ch.level, ch.xp);
            const newLevel = prot.isProtected ? oldLevel : p.newLevel;
            const newXp = prot.isProtected ? ch.xp : p.newXp;
            const xpPercent = prot.isProtected ? 100 : p.xpPercent;
            const skillXpLossPercent = prot.isProtected ? 0 : p.skillXpLossPercent;
            const levelsLost = prot.isProtected ? 0 : p.levelsLost;
            if (prot.isProtected) {
                addLog(
                    prot.consumedId === 'death_protection'
                        ? ':shield: Eliksir Ochrony uchronił Cię od jakichkolwiek strat!'
                        : ':trident-emblem: Amulet of Loss uchronił Cię od jakichkolwiek strat!',
                );
            } else {
                useCharacterStore.getState().updateCharacter({ level: newLevel, xp: newXp });
                useSkillStore.getState().applyDeathPenalty(ch.class, p.skillXpLossPercent);
                if (p.levelsLost > 0) {
                    useSkillStore.getState().purgeLockedSkillSlots(ch.class, p.newLevel);
                }
            }
            const raidForDeath = selectedRaidRef.current;
            useDeathStore.getState().triggerDeath({
                killedBy: raidForDeath?.name_pl ?? 'Rajd',
                sourceLevel: raidForDeath?.level ?? ch.level,
                oldLevel,
                newLevel,
                levelsLost,
                xpPercent,
                skillXpLossPercent,
                protectionUsed: prot.isProtected,
                source: 'raid',
            });
        }
        addLog(':skull: Nikt Cię nie wskrzesił — ginieesz.');
        useCombatStore.getState().clearCombatSession();
        usePartyReadyCheckStore.getState().clear();
        void (async () => {
            try {
                await usePartyStore.getState().leaveParty(ch.id);
            } catch { }
        })();
        navigate('/');
    }, [phase, addLog, navigate]);

    if (phase === 'lobby') {
        const noParty = !party;
        const partyTooSmall = !!party && totalMembers < 2;
        const notLeader = !!party && !iAmLeader;
        const showList = !!party && totalMembers >= 2 && iAmLeader;

        let visibleRaids = raids;
        if (raidFilterMinLevel > 0) {
            visibleRaids = visibleRaids.filter((r) => r.level >= raidFilterMinLevel);
        }
        if (raidFilterAvailableOnly) {
            visibleRaids = visibleRaids.filter(
                (r) => r.level <= partyMinLevel && attemptsRemaining(r.id) > 0,
            );
        }
        if (raidFilterSortDesc) {
            visibleRaids = visibleRaids.slice().sort((a, b) => b.level - a.level);
        }
        const anyRaidFilterActive =
            raidFilterAvailableOnly || raidFilterSortDesc || raidFilterMinLevel > 0;

        return (
            <div className="raid">
                {backendFeedback && (
                    <div
                        className="raid__backend-feedback"
                        role="status"
                        onClick={() => setBackendFeedback(null)}
                    >
                        {backendFeedback}
                    </div>
                )}
                {noParty && (
                    <div className="raid__gate">
                        <span className="raid__gate-icon"><GameIcon name="locked" /></span>
                        <h2>Potrzebujesz Party</h2>
                        <p>Raidy wymagają co najmniej 2 graczy w party. Dołącz lub załóż party.</p>
                        <button onClick={() => navigate('/party')}>Przejdź do Party</button>
                    </div>
                )}

                {partyTooSmall && (
                    <div className="raid__gate">
                        <span className="raid__gate-icon"><GameIcon name="busts-in-silhouette" /></span>
                        <h2>Za mało osób</h2>
                        <p>Party musi mieć co najmniej 2 osoby ({humanMembers.length}/2). Dodaj członka lub bota.</p>
                        <button onClick={() => navigate('/party')}>Party</button>
                    </div>
                )}

                {notLeader && (
                    <div className="raid__gate">
                        <span className="raid__gate-icon"><GameIcon name="crown" /></span>
                        <h2>Tylko lider</h2>
                        <p>Rajd wybiera i startuje lider party.</p>
                    </div>
                )}

                {showList && (
                    <div className="raid__panel">
                        <section className="raid__hub-filters">
                            <h2 className="raid__hub-section-title">Filtry</h2>
                            <div className="raid__filter-bar">
                                <label
                                    className={`raid__filter-toggle${raidFilterAvailableOnly ? ' raid__filter-toggle--active' : ''}`}
                                    title="Pokaż tylko raidy, do których party ma poziom i pozostałe próby"
                                >
                                    <input
                                        type="checkbox"
                                        checked={raidFilterAvailableOnly}
                                        onChange={(e) => setRaidFilterAvailableOnly(e.target.checked)}
                                    />
                                    <span className="raid__filter-toggle-label">Tylko dostępne</span>
                                </label>
                                <label
                                    className={`raid__filter-toggle${raidFilterSortDesc ? ' raid__filter-toggle--active' : ''}`}
                                    title="Sortuj od najwyższego poziomu"
                                >
                                    <input
                                        type="checkbox"
                                        checked={raidFilterSortDesc}
                                        onChange={(e) => setRaidFilterSortDesc(e.target.checked)}
                                    />
                                    <span className="raid__filter-toggle-label">Od najwyższego poziomu</span>
                                </label>
                                <label
                                    className="raid__filter-input"
                                    title="Pokaż raidy od podanego poziomu"
                                >
                                    <span className="raid__filter-input-label">Lvl od</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={1000}
                                        inputMode="numeric"
                                        value={raidFilterMinLevel || ''}
                                        placeholder="0"
                                        onChange={(e) =>
                                            setRaidFilterMinLevel(parseInt(e.target.value, 10) || 0)
                                        }
                                    />
                                </label>
                                {anyRaidFilterActive && (
                                    <button
                                        type="button"
                                        className="raid__filter-clear"
                                        onClick={() => {
                                            setRaidFilterAvailableOnly(false);
                                            setRaidFilterSortDesc(false);
                                            setRaidFilterMinLevel(0);
                                        }}
                                        title="Wyczyść filtry"
                                    >
                                        <Icon name="x" /> Wyczyść
                                    </button>
                                )}
                            </div>
                        </section>

                        {visibleRaids.length === 0 && (
                            <div className="raid__filters-empty">
                                Żaden rajd nie pasuje do filtrów.
                            </div>
                        )}

                        {visibleRaids.map((r) => {
                            const left = attemptsRemaining(r.id);
                            const tooLow = r.level > partyMinLevel;
                            const noAttempts = left <= 0;
                            const blocked = tooLow || noAttempts;
                            const allDone = left <= 0;
                            const used = r.dailyAttempts - left;
                            const hue = getRaidCardHue(r.level);
                            const desc = DUNGEON_DESC_BY_ID[r.sourceDungeonId] ?? '';
                            const est = estimateRaidRewards(r);

                            return (
                                <div
                                    key={r.id}
                                    className={`raid__card${blocked ? ' raid__card--blocked' : ''}${allDone ? ' raid__card--all-done' : ''}`}
                                    style={{
                                        '--card-hue': hue,
                                        '--card-image': (() => {
                                            const url = getDungeonImage(r.sourceDungeonId);
                                            return url ? `url("${url}")` : 'none';
                                        })(),
                                    } as React.CSSProperties}
                                >
                                    <span className="raid__corner raid__corner--lvl">
                                        Lvl {r.level}
                                    </span>
                                    <span className="raid__corner raid__corner--waves">
                                        {r.waves} {r.waves === 1 ? 'fala' : 'fal'} × 4
                                    </span>

                                    {allDone && (
                                        <span className="raid__corner raid__corner--cleared">
                                            <GameIcon name="check-mark-button" /> Pokonany
                                        </span>
                                    )}

                                    <div className="raid__card-head">
                                        <h3 className="raid__card-name">{r.name_pl}</h3>
                                        {desc && (
                                            <p className="raid__card-desc">{desc}</p>
                                        )}
                                    </div>

                                    <div className="raid__card-rewards">
                                        <span><GameIcon name="money-bag" /> {formatGoldShort(est.goldMin)}–{formatGoldShort(est.goldMax)}</span>
                                        <span><GameIcon name="star" /> ~{est.xp.toLocaleString('pl-PL')} XP</span>
                                    </div>

                                    <button
                                        className="raid__drop-btn"
                                        onClick={() => setDropModalRaidId(r.id)}
                                    >
                                        <GameIcon name="package" /> Pokaż drop table
                                    </button>

                                    <div className="raid__attempts">
                                        <span><GameIcon name="crossed-swords" /> {used}/{r.dailyAttempts}</span>
                                        <div className="raid__attempts-bar">
                                            <div
                                                className={`raid__attempts-bar-fill${noAttempts ? ' raid__attempts-bar-fill--full' : ''}`}
                                                style={{ width: `${(used / r.dailyAttempts) * 100}%` }}
                                            />
                                        </div>
                                    </div>

                                    {noAttempts && (
                                        <span className="raid__cooldown"><GameIcon name="cross-mark" /> Brak prób · reset o północy</span>
                                    )}
                                    {!noAttempts && tooLow && (
                                        <span className="raid__locked"><GameIcon name="locked" /> Wymaga Lvl {r.level} (party gate)</span>
                                    )}

                                    {!blocked && (
                                        <button
                                            className="raid__enter-btn raid__enter-btn--wide"
                                            onClick={() => { void handleEnterRaid(r); }}
                                        >
                                            <GameIcon name="crossed-swords" /> Wejdź
                                        </button>
                                    )}
                                </div>
                            );
                        })}

                        {dropModalRaidId && (() => {
                            const r = raids.find((x) => x.id === dropModalRaidId);
                            if (!r) return null;
                            const hue = getRaidCardHue(r.level);
                            const totalBosses = r.waves * 4;
                            const modalEst = estimateRaidRewards(r);
                            const potionInfo = getPotionDropInfo(r.level);
                            const chestLevels = SPELL_CHEST_LEVELS.filter((lvl) => lvl <= r.level);
                            return (
                                <div
                                    className="raid__modal-backdrop"
                                    onClick={() => setDropModalRaidId(null)}
                                >
                                    <div
                                        className="raid__modal"
                                        onClick={(e) => e.stopPropagation()}
                                        style={{ '--card-hue': hue } as React.CSSProperties}
                                    >
                                        <div className="raid__modal-header">
                                            <span className="raid__modal-title">{r.name_pl}</span>
                                            <button
                                                className="raid__modal-close"
                                                onClick={() => setDropModalRaidId(null)}
                                                aria-label="Zamknij"
                                            >
                                                <Icon name="x" />
                                            </button>
                                        </div>
                                        <div className="raid__modal-body">
                                            <div className="raid__drop-section">
                                                <div className="raid__drop-section-title"><GameIcon name="money-bag" /> Nagrody</div>
                                                <div className="raid__drop-info">Gold: {formatGoldShort(modalEst.goldMin)}–{formatGoldShort(modalEst.goldMax)}</div>
                                                <div className="raid__drop-info">XP: ~{modalEst.xp.toLocaleString('pl-PL')}</div>
                                                <div className="raid__drop-info">
                                                    Bossy: {totalBosses} ({r.waves} fal × 4) · Lvl: {r.level}
                                                </div>
                                            </div>

                                            <div className="raid__drop-section">
                                                <div className="raid__drop-section-title"><TinyIcon icon={STONE_GENERIC_ICON} size="sm" /> Kamienie ulepszania (per boss)</div>
                                                {RAID_STONE_TIERS.map((s) => {
                                                    const stoneId = `${s.key}_stone`;
                                                    return (
                                                        <div key={s.key} className="raid__drop-tier">
                                                            <TinyIcon icon={STONE_ICONS[stoneId] ?? STONE_GENERIC_ICON} size="sm" />
                                                            <span className="raid__drop-tier-name" style={{ color: s.color }}>{s.label}</span>
                                                            <span className="raid__drop-tier-chance">{s.chance}%</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            <div className="raid__drop-section">
                                                <div className="raid__drop-section-title"><GameIcon name="backpack" /> Przedmioty (per boss)</div>
                                                {RAID_ITEM_TIERS.map((tier) => (
                                                    <div key={tier.key} className="raid__drop-tier">
                                                        <span className="raid__drop-dot" style={{ background: tier.color, boxShadow: `0 0 4px ${tier.color}` }} />
                                                        <span className="raid__drop-tier-name" style={{ color: tier.color }}>{tier.label}</span>
                                                        <span className="raid__drop-tier-chance">{tier.chance}%</span>
                                                    </div>
                                                ))}
                                            </div>

                                            <div className="raid__drop-section">
                                                <div className="raid__drop-section-title"><TinyIcon icon={getPotionImage(null) ?? 'test-tube'} size="sm" /> Potiony</div>
                                                <div className="raid__drop-tier">
                                                    <span className="raid__drop-dot" style={{ background: '#e57373' }} />
                                                    <span className="raid__drop-tier-name" style={{ color: '#e57373' }}>
                                                        <TinyIcon icon={getPotionImage('hp_potion_sm') ?? 'red-heart'} size="sm" /> {potionInfo.hpLabel} ({potionInfo.hpHeal})
                                                    </span>
                                                    <span className="raid__drop-tier-chance">{(potionInfo.hpChance * 100).toFixed(2)}%</span>
                                                </div>
                                                <div className="raid__drop-tier">
                                                    <span className="raid__drop-dot" style={{ background: '#64b5f6' }} />
                                                    <span className="raid__drop-tier-name" style={{ color: '#64b5f6' }}>
                                                        <TinyIcon icon={getPotionImage('mp_potion_sm') ?? 'droplet'} size="sm" /> {potionInfo.mpLabel} ({potionInfo.mpHeal})
                                                    </span>
                                                    <span className="raid__drop-tier-chance">{(potionInfo.mpChance * 100).toFixed(2)}%</span>
                                                </div>
                                                {potionInfo.mega && (
                                                    <>
                                                        <div className="raid__drop-tier">
                                                            <span className="raid__drop-dot" style={{ background: '#ff5252' }} />
                                                            <span className="raid__drop-tier-name" style={{ color: '#ff5252' }}>
                                                                <TinyIcon icon={getPotionImage('hp_potion_mega') ?? 'heart-on-fire'} size="sm" /> {potionInfo.mega.hpLabel} ({potionInfo.mega.hpHeal})
                                                            </span>
                                                            <span className="raid__drop-tier-chance">{(potionInfo.mega.chance * 100).toFixed(2)}%</span>
                                                        </div>
                                                        <div className="raid__drop-tier">
                                                            <span className="raid__drop-dot" style={{ background: '#448aff' }} />
                                                            <span className="raid__drop-tier-name" style={{ color: '#448aff' }}>
                                                                <TinyIcon icon={getPotionImage('mp_potion_mega') ?? 'gem-stone'} size="sm" /> {potionInfo.mega.mpLabel} ({potionInfo.mega.mpHeal})
                                                            </span>
                                                            <span className="raid__drop-tier-chance">{(potionInfo.mega.chance * 100).toFixed(2)}%</span>
                                                        </div>
                                                    </>
                                                )}
                                            </div>

                                            {chestLevels.length > 0 && (
                                                <div className="raid__drop-section">
                                                    <div className="raid__drop-section-title"><TinyIcon icon={getSpellChestImage(1000) ?? 'package'} size="sm" /> Spell Chests (per boss)</div>
                                                    {chestLevels.map((lvl) => (
                                                        <div key={lvl} className="raid__drop-tier">
                                                            <span className="raid__drop-dot" style={{ background: '#ab47bc' }} />
                                                            <span className="raid__drop-tier-name" style={{ color: '#ab47bc' }}>
                                                                <TinyIcon icon={getSpellChestIcon(lvl)} size="sm" /> Lvl {lvl}
                                                            </span>
                                                            <span className="raid__drop-tier-chance">
                                                                {(RAID_SPELL_CHEST_CHANCE * 100).toFixed(2)}%
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="raid__drop-section">
                                                <div className="raid__drop-section-title"><GameIcon name="trophy" /> Bonus za ukończenie rajdu (dodatkowy drop)</div>
                                                {RAID_BONUS_TIERS.map((tier) => (
                                                    <div key={tier.key} className="raid__drop-tier">
                                                        <span className="raid__drop-dot" style={{ background: tier.color, boxShadow: `0 0 4px ${tier.color}` }} />
                                                        <span className="raid__drop-tier-name" style={{ color: tier.color }}>{tier.label}</span>
                                                        <span className="raid__drop-tier-chance">{tier.chance}%</span>
                                                    </div>
                                                ))}
                                                <div className="raid__drop-info">
                                                    Każdy ocalały członek party dostaje ten roll po ukończeniu rajdu.
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                )}
            </div>
        );
    }

    if (phase === 'victory' || phase === 'wipe') {
        const resultHue = selectedRaid ? getRaidCardHue(selectedRaid.level) : 220;
        const meMember = members.find((m) => m.id === character?.id);
        const iDiedUnresurrected = !!meMember && meMember.isDead && !meMember.hasEscaped;
        return (
            <div className="raid">
                <div className="raid__result-header">
                    <h1>
                        {phase === 'victory' ? <><GameIcon name="trophy" /> Rajd ukończony</> : <><GameIcon name="skull" /> Wipe</>}
                    </h1>
                    {selectedRaid && (
                        <p className="raid__result-sub">
                            {selectedRaid.name_pl} · Lvl {selectedRaid.level}
                        </p>
                    )}
                </div>

                <div className="raid__result">
                    {phase === 'victory' && (
                        <div className="raid__result-grid">
                            {members.map((m) => {
                                const drops = dropsByMember[m.id] ?? [];
                                const escaped = m.hasEscaped;
                                return (
                                    <div
                                        key={m.id}
                                        className={`raid__result-member${escaped ? ' raid__result-member--escaped' : ''}`}
                                        style={{
                                            '--card-hue': resultHue,
                                            borderColor: m.color,
                                        } as React.CSSProperties}
                                    >
                                        <div className="raid__result-member-head">
                                            <span
                                                className="raid__result-member-dot"
                                                style={{ background: m.color }}
                                            />
                                            <div className="raid__result-member-info">
                                                <h3 className="raid__result-member-name">
                                                    {m.name}
                                                </h3>
                                                <span className="raid__result-member-meta">
                                                    {m.class} · Lvl {m.level}
                                                    {escaped && ' · uciekł(a)'}
                                                </span>
                                            </div>
                                        </div>
                                        {escaped ? (
                                            <p className="raid__result-member-empty">
                                                Brak nagród — uciekł(a) z rajdu.
                                            </p>
                                        ) : drops.length === 0 ? (
                                            <p className="raid__result-member-empty">
                                                Brak dropu — pech tej tury.
                                            </p>
                                        ) : (() => {
                                            const renderDrop = (d: IRaidDropLine, i: number) => {
                                                if (d.kind === 'item' && d.itemId) {
                                                    const info = getItemDisplayInfo(d.itemId);
                                                    return (
                                                        <ItemIcon
                                                            key={i}
                                                            icon={info?.icon ?? 'package'}
                                                            rarity={d.rarity ?? 'common'}
                                                            tooltip={info?.name_pl ?? d.label}
                                                            size="sm"
                                                        />
                                                    );
                                                }
                                                if (d.kind === 'upgrade_stone') {
                                                    const stoneId = `${d.rarity ?? 'common'}_stone`;
                                                    return (
                                                        <ItemIcon
                                                            key={i}
                                                            icon={STONE_ICONS[stoneId] ?? STONE_GENERIC_ICON}
                                                            rarity={d.rarity ?? 'common'}
                                                            tooltip={d.label}
                                                            size="sm"
                                                        />
                                                    );
                                                }
                                                if (d.kind === 'spell_chest') {
                                                    const lvl = d.amount ?? 1;
                                                    return (
                                                        <ItemIcon
                                                            key={i}
                                                            icon={getSpellChestIcon(lvl)}
                                                            rarity="legendary"
                                                            tooltip={d.label}
                                                            size="sm"
                                                        />
                                                    );
                                                }
                                                if (d.kind === 'potion') {
                                                    return (
                                                        <ItemIcon
                                                            key={i}
                                                            icon={getPotionImage(null) ?? 'test-tube'}
                                                            rarity="rare"
                                                            tooltip={d.label}
                                                            size="sm"
                                                        />
                                                    );
                                                }
                                                if (d.kind === 'xp') {
                                                    return (
                                                        <ItemIcon
                                                            key={i}
                                                            icon="sparkles"
                                                            rarity="epic"
                                                            tooltip={`+${(d.amount ?? 0).toLocaleString('pl-PL')} XP`}
                                                            size="sm"
                                                        />
                                                    );
                                                }
                                                if (d.kind === 'gold') {
                                                    return (
                                                        <ItemIcon
                                                            key={i}
                                                            icon="money-bag"
                                                            rarity="mythic"
                                                            tooltip={formatGoldShort(d.amount ?? 0)}
                                                            size="sm"
                                                        />
                                                    );
                                                }
                                                return null;
                                            };
                                            const bonusDrops = drops.filter((d) => d.isBonus);
                                            const regularDrops = drops.filter((d) => !d.isBonus);
                                            return (
                                                <>
                                                    <div className="raid__result-drops">
                                                        {regularDrops.map(renderDrop)}
                                                    </div>
                                                    {bonusDrops.length > 0 && (
                                                        <div className="raid__result-bonus">
                                                            <span className="raid__result-bonus-label">
                                                                <GameIcon name="wrapped-gift" /> Dodatkowy item:
                                                            </span>
                                                            <div className="raid__result-bonus-icons">
                                                                {bonusDrops.map(renderDrop)}
                                                            </div>
                                                        </div>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {phase === 'wipe' && (
                        <p className="raid__result-wipe">
                            Cała drużyna padła. Zastosowano standardową karę śmierci.
                        </p>
                    )}
                    <div className="raid__result-actions">
                        {iDiedUnresurrected ? (
                            <button
                                className="raid__primary raid__primary--hued"
                                onClick={() => {
                                    useCombatStore.getState().clearCombatSession();
                                    navigate('/');
                                }}
                                style={{ '--btn-hue': resultHue } as React.CSSProperties}
                            >
                                Wróć do miasta
                            </button>
                        ) : isNonLeaderMember ? (
                            <button
                                className="raid__primary raid__primary--hued"
                                onClick={() => {
                                    const me = useCharacterStore.getState().character?.id;
                                    if (me) void usePartyStore.getState().leaveParty(me);
                                    useCombatStore.getState().clearCombatSession();
                                    navigate('/');
                                }}
                                style={{ '--btn-hue': resultHue } as React.CSSProperties}
                            >
                                Wyjdź z party
                            </button>
                        ) : (
                            <>
                                {phase === 'victory'
                                    && selectedRaid
                                    && attemptsRemaining(selectedRaid.id) > 0
                                    && (party?.members.filter((m) => m.id !== character?.id && !m.isBot).length ?? 0) > 0 && (
                                    <button
                                        className="raid__primary raid__primary--retry"
                                        onClick={() => {
                                            const r = selectedRaid;
                                            retryInProgressRef.current = true;
                                            backToLobby();
                                            setTimeout(() => {
                                                startRaid(r);
                                                retryInProgressRef.current = false;
                                            }, 0);
                                        }}
                                    >
                                        <GameIcon name="crossed-swords" /> Ponów
                                    </button>
                                )}
                                {phase === 'victory'
                                    && selectedRaid
                                    && attemptsRemaining(selectedRaid.id) <= 0
                                    && (party?.members.filter((m) => m.id !== character?.id && !m.isBot).length ?? 0) > 0
                                    && (() => {
                                        const charLvl = character?.level ?? 1;
                                        const nextRaid = raids
                                            .filter((r) => r.level > selectedRaid.level && r.level <= charLvl && attemptsRemaining(r.id) > 0)
                                            .sort((a, b) => a.level - b.level)[0];
                                        if (!nextRaid) return null;
                                        return (
                                            <button
                                                className="raid__primary raid__primary--retry"
                                                onClick={() => {
                                                    const r = nextRaid;
                                                    retryInProgressRef.current = true;
                                                    backToLobby();
                                                    setTimeout(() => {
                                                        startRaid(r);
                                                        retryInProgressRef.current = false;
                                                    }, 0);
                                                }}
                                                title={`${nextRaid.name_pl ?? nextRaid.id} (lvl ${nextRaid.level})`}
                                            >
                                                <GameIcon name="up-arrow" /> Walcz wyżej (lvl {nextRaid.level})
                                            </button>
                                        );
                                    })()}
                                <button
                                    className="raid__primary raid__primary--hued"
                                    onClick={backToLobby}
                                    style={{ '--btn-hue': resultHue } as React.CSSProperties}
                                >
                                    Powrót do lobby
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    const cycleSpeed = () => {
        if (isNonLeaderMember) return;
        const idx = SPEED_OPTIONS.findIndex((s) => s.mult === speedMult);
        const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
        setSpeedMult(next.mult);
    };
    const speedLabel = SPEED_OPTIONS.find((s) => s.mult === speedMult)?.label ?? 'X1';

    const padTo4 = <T,>(arr: Array<T | null>): Array<T | null> => {
        const out = arr.slice(0, 4);
        while (out.length < 4) out.push(null);
        return out;
    };

    const playerAccent = (() => {
        const tc = useTransformStore.getState().getHighestTransformColor();
        return tc?.solid ?? tc?.gradient?.[0] ?? CLASS_COLORS[character?.class ?? ''] ?? '#e94560';
    })();

    const uiEnemies: Array<ICombatEnemy | null> = padTo4(
        bosses.map<ICombatEnemy>((b, slot) => ({
            id: b.id,
            name: b.name,
            level: b.level,
            sprite: b.sprite ?? 'ogre',
            kind: 'monster' as const,
            currentHp: Math.max(0, b.currentHp),
            maxHp: b.maxHp,
            rarity: 'boss',
            isDead: b.isDead,
            isTargetedByPlayer: !b.isDead && bosses.findIndex((bb) => !bb.isDead) === bosses.indexOf(b),
            hitPulse: bossHitPulses[b.id] ?? 0,
            attackingClassName: bossAttackerClass[b.id]
                ? `attack-${bossAttackerClass[b.id].className}`
                : null,
            floats: fx.enemyFloats[slot] ?? [],
            statusOverlay: (() => {
                const st = effectsRef.current.statuses.get(b.id);
                if (!st) return undefined;
                const top = st.markAmp.find((mm) => mm.count > 0 && mm.remainingMs > 0);
                const topRitual = st.darkRitualPending.length > 0
                    ? st.darkRitualPending.reduce((a, b2) => (a.triggerInMs <= b2.triggerInMs ? a : b2))
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
        })),
    );

    const SUMMON_RANK_R = { skeleton: 0, ghost: 1, demon: 2, lich: 3 } as const;
    const SUMMON_LABELS_R: Record<'skeleton' | 'ghost' | 'demon' | 'lich', string> = {
        skeleton: 'Szkielet', ghost: 'Duch', demon: 'Demon', lich: 'Lisz',
    };
    const visibleMembersForUi = members.filter((m) => !m.hasEscaped);
    const uiAllies: Array<ICombatAlly | null> = padTo4(
        visibleMembersForUi.map<ICombatAlly>((m, slot) => {
            const isSelfNecro = m.id === character?.id;
            const summonList = m.class === 'Necromancer'
                ? (
                    isSelfNecro
                        ? (necroSummons[m.id] ?? [])
                        : (usePartyPresenceStore.getState().byMember[m.id]?.summons ?? []).map((s, idx) => ({
                            id: `presence-${m.id}-${idx}`,
                            type: s.type,
                            hp: s.hp,
                            maxHp: s.maxHp,
                            mp: s.mp,
                            maxMp: s.maxMp,
                            dmgMult: 0,
                        }))
                )
                : [];
            const summonsByType: Partial<Record<'skeleton' | 'ghost' | 'demon' | 'lich', number>> = {};
            for (const sm of summonList) {
                summonsByType[sm.type] = (summonsByType[sm.type] ?? 0) + 1;
            }
            const frontSummonR = summonList.length > 0
                ? [...summonList].sort((a, b) => SUMMON_RANK_R[a.type] - SUMMON_RANK_R[b.type])[0]
                : null;
            const memberName = (m.class === 'Necromancer' && frontSummonR)
                ? SUMMON_LABELS_R[frontSummonR.type]
                : m.name;
            const baseAvatar = m.id === character?.id
                ? getCharacterAvatar(m.class, useTransformStore.getState().completedTransforms)
                : getCharacterAvatar(m.class, m.transformTier ? [m.transformTier] : []);
            const memberAvatar = (m.class === 'Necromancer' && frontSummonR)
                ? (getSummonImage(frontSummonR.type) ?? baseAvatar)
                : baseAvatar;
            const memberCurHp = (m.class === 'Necromancer' && frontSummonR)
                ? frontSummonR.hp
                : Math.max(0, m.hp);
            const memberMaxHp = (m.class === 'Necromancer' && frontSummonR)
                ? frontSummonR.maxHp
                : m.maxHp;
            const memberCurMp = (m.class === 'Necromancer' && frontSummonR)
                ? frontSummonR.mp
                : Math.max(0, m.mp);
            const memberMaxMp = (m.class === 'Necromancer' && frontSummonR)
                ? frontSummonR.maxMp
                : m.maxMp;
            return ({
            id: m.id,
            name: memberName,
            avatarUrl: memberAvatar,
            accentColor: m.color,
            className: m.class,
            currentHp: memberCurHp,
            maxHp: memberMaxHp,
            currentMp: memberCurMp,
            maxMp: memberMaxMp,
            isDead: m.isDead || m.hasEscaped,
            isPlayer: m.id === character?.id,
            isBot: !!m.isBot,
            level: m.level,
            summonCount: summonList.length,
            summonsByType,
            onSummonClick: m.id === character?.id
                ? (type) => {
                    useNecroSummonStore.getState().despawnOne(m.id, type);
                    addLog(`:dashing-away: Odesłano: ${type}`);
                }
                : undefined,
            aggroCount: bosses.filter((b) => !b.isDead && bossAggroIds[b.id] === m.id).length,
            hitPulse: memberHitPulses[m.id] ?? 0,
            attackingClassName: memberAttackingClass[m.id] ?? null,
            transformTier: m.transformTier > 0 ? m.transformTier : undefined,
            skillAnim: fx.allySkill[slot] ?? null,
            floats: fx.allyFloats[slot] ?? [],
            summonSpawn: fx.allySummonSpawn[slot] ?? null,
            });
        }),
    );

    return (
        <div className="raid raid--fighting">
            <CombatHudHost active={phase === 'fighting'} accent={playerAccent} compact>
                <div className="combat-ui">
                    <CombatTopControls
                        speed={{ label: speedLabel, onCycle: cycleSpeed }}
                        autoSkill={{
                            on: skillMode === 'auto',
                            onToggle: () =>
                                setSkillMode(skillMode === 'auto' ? 'manual' : 'auto'),
                        }}
                        autoPotion={{ on: autoPotionOn, onToggle: toggleAutoPotion }}
                    />

                    {waitingForSpawn && (
                        <div
                            className="combat-ui__spawn-bar"
                            aria-label="Następna fala za chwilę"
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
                        <span className="combat-ui__wave-banner-label">
                            {selectedRaid?.name_pl} · Fala
                        </span>
                        <span className="combat-ui__wave-banner-value">
                            {currentWave + 1}/{selectedRaid?.waves}
                        </span>
                    </div>

                    <CombatArena
                        enemies={uiEnemies}
                        allies={uiAllies}
                        bgVariant="daily-boss"
                        overlay={
                            null
                        }
                    />

                    <CombatSubControls xp={null} />

                    {(() => {
                        const playerMember = members.find((m) => m.id === character?.id);
                        const playerLevel = playerMember?.level ?? character?.level ?? 1;
                        const playerMp = playerMember?.mp ?? 0;
                        const classSkills = character ? getClassActiveSkills(character.class) : [];
                        const uiSkills: Array<ICombatSkillSlot | null> =
                            (activeSkillSlots as (string | null)[]).map((skillId, i) => {
                                if (!skillId) return null;
                                const def = classSkills.find((s) => s.id === skillId);
                                if (!def) return null;
                                const noMp = playerMp < def.mpCost;
                                const locked = playerLevel < def.unlockLevel;
                                const cdMs = playerSkillCooldowns[skillId] ?? 0;
                                const cdActive = cdMs > 0;
                                const cooldownProgress = cdActive && def.cooldown > 0
                                    ? Math.max(0, Math.min(1, 1 - cdMs / def.cooldown))
                                    : 1;
                                return {
                                    id: skillId,
                                    icon: getSkillIcon(skillId),
                                    name: skillId,
                                    mpCost: def.mpCost,
                                    cooldownProgress,
                                    cooldownRemainingMs: cdMs,
                                    disabled: skillMode === 'auto' || noMp || locked || cdActive,
                                    onClick: () => queuePlayerSkill(i as 0 | 1 | 2 | 3),
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
                                onClick: () => consumeRaidPotion(potion.id),
                            };
                        };
                        const flatHpSlot = buildPotion(bestHpPotion, 'hp', hpPotionCooldown, HP_POTION_CD);
                        const flatMpSlot = buildPotion(bestMpPotion, 'mp', mpPotionCooldown, MP_POTION_CD);
                        const pctHpSlot  = buildPotion(bestPctHpPotion, 'pct-hp', pctHpCooldown, PCT_CD_MS);
                        const pctMpSlot  = buildPotion(bestPctMpPotion, 'pct-mp', pctMpCooldown, PCT_CD_MS);

                        return (
                            <>
                                <CombatPotionDock
                                    hpPotion={flatHpSlot}
                                    pctHpPotion={pctHpSlot}
                                    mpPotion={flatMpSlot}
                                    pctMpPotion={pctMpSlot}
                                />
                                <CombatActionBar
                                    skills={uiSkills}
                                    exit={{ kind: 'flee', onFlee: handleEscape }}
                                />
                            </>
                        );
                    })()}
                </div>
            </CombatHudHost>

            <PartyDeathChoice
                open={partyChoiceOpen}
                aliveAllies={partyChoiceAlliesAlive}
                onReturnToTown={handleReturnToTown}
                onWaitForResurrection={handleWaitForResurrection}
            />
        </div>
    );
};

export default Raid;
