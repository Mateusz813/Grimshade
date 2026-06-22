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
import { usePartyPresenceStore } from '../../stores/partyPresenceStore';
import { getPartyGateLevel } from '../../systems/partySystem';
import { useSettingsStore } from '../../stores/settingsStore';
import { useBuffStore } from '../../stores/buffStore';
import { ELIXIRS } from '../../stores/shopStore';
import { resolveAutoPotionElixir } from '../../systems/potionSystem';
import { canUsePotionAtLevel } from '../../systems/potionGating';
import { applyDeathPenalty, applyFleePenalty } from '../../systems/levelSystem';
import { applyCombatLeaveDeath } from '../../systems/combatLeavePenalty';
import { useCombatStore } from '../../stores/combatStore';
import { usePartyCombatSyncStore } from '../../stores/partyCombatSyncStore';
import { requestPartyCombatStart, registerGoReplicator, triggerPartyCombatGo } from '../../hooks/usePartyReadyCheck';
import { usePartyReadyCheckStore } from '../../stores/partyReadyCheckStore';

// 2026-05-13: register a /boss go-replicator that fires from AppShell's
// useReadyCheckGoEffect — AFTER Boss.tsx's mount effects but BEFORE the
// navigate-effect consumes destination. Two jobs:
//   1. Heal the member if they're at 0 HP (so they don't spawn dead).
//   2. Bump partyCombatSyncStore.pendingBossEntryAt — Boss.tsx subscribes
//      to that timestamp and fires playEntryThenFight on every bump.
//      This is the ONLY trigger path that survives the mount-time race
//      where the destination store update was already consumed before
//      Boss.tsx's mount effect read it (e.g. on slow first-mount renders
//      where playEntryThenFight's deps re-fire mid-commit).
registerGoReplicator('/boss', (payload) => {
    const p = payload as { bossId?: string } | null;
    if (!p?.bossId) return;
    // 2026-05-18 spec ("Nic nigdy nie powinno mi samemu odnawiac HP i MP
    // poza HP i MP regen oraz potionami"): removed the auto-heal on
    // dead re-entry. beginBossFight already handles `stayDead` so a
    // corpse spawns slumped and only a mid-fight rez restores them.
    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
        usePartyCombatSyncStore.getState().requestMemberBossEntry(p.bossId!);
    }).catch(() => { /* offline */ });
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
import { saveCurrentCharacterStores } from '../../stores/characterScope';
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
import { rollMonsterDamage } from '../../systems/combat';
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
import { getTrainingBonuses, getCombatSkillUpgradeMultiplier } from '../../systems/skillSystem';
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

/** Boss aggro re-rolls every 10 seconds (wall-clock), using class-weighted pick. */
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
import './Boss.scss';

// -- Class config for dual wield ----------------------------------------------

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

/**
 * Maps boss level -> HSL hue for unique gradient backgrounds.
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

// -- Types ---------------------------------------------------------------------

type ScreenPhase = 'list' | 'fighting' | 'result';

type TBotClassOrNone = TCharacterClass | 'none';
const ALL_BOT_CLASSES: TCharacterClass[] = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'];

// Bosses ALWAYS run at x1 speed (independent of normal combat speed)

// -- Drop table helpers -------------------------------------------------------

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
    /** Maps the stone tier to the matching item-rarity colour so the dot in
     *  the drop modal reads as "this stone is in the X tier" at a glance —
     *  e.g. a Rare Stone shares the blue dot used for Rare items. Without
     *  this, all stone dots collapsed to the same grey and players had to
     *  read the labels to tell them apart. */
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

// -- Skill / Potion constants -------------------------------------------------

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

// -- Combat log entry type ----------------------------------------------------

interface ILogEntry {
    id: number;
    text: string;
    type: 'player' | 'monster' | 'crit' | 'system' | 'boss-spell' | 'block' | 'dodge';
}

// -- Get attack interval ms ---------------------------------------------------

const getAttackMs = (speed: number): number =>
    Math.max(500, Math.floor(3000 / Math.max(1, speed || 1)));

// -- Boss spell system --------------------------------------------------------

interface IBossSpell {
    name: string;
    icon: string;
    type: 'damage' | 'heal' | 'buff';
    power: number; // multiplier
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
    // Higher level bosses have more spell variety
    const maxIdx = Math.min(BOSS_SPELLS.length, Math.floor(boss.level / 100) + 3);
    return BOSS_SPELLS[Math.floor(Math.random() * maxIdx)];
};

// -- Component -----------------------------------------------------------------

const Boss = () => {
    const navigate = useNavigate();

    const character   = useCharacterStore((s) => s.character);
    const equipment   = useInventoryStore((s) => s.equipment);
    const consumables = useInventoryStore((s) => s.consumables);
    const completedTransforms = useTransformStore((s) => s.completedTransforms);
    // Bug 2 (2026-04): subscribe to allBuffs so charMaxHp/charMaxMp recompute
    // whenever an elixir buff is added/expired during a boss fight.
    const _activeBuffs = useBuffStore((s) => s.allBuffs);
    void _activeBuffs;
    // Subscribe to the necromancer summon store so the count badge re-renders
    // when summons spawn, take damage, or die. Single map keyed by FX id.
    const necroSummons = useNecroSummonStore((s) => s.summons);
    const playerAvatarSrc = character ? getCharacterAvatar(character.class, completedTransforms) : '';
    const { activeSkillSlots } = useSkillStore();
    // Bosses always run at x1 speed (no speed controls)
    const { setBossDefeated, getAttemptsUsed, getAttemptsMax, canChallenge } = useBossStore();
    const { addBossKill, getTotalScore, getBossKillCount } = useBossScoreStore();
    const party = usePartyStore((s) => s.party);
    // 2026-05-13 spec ("Lider widzi bledny awatar sojusznikow nie po
    // transformach"): subscribe to the party presence store so the
    // leader's bot cards for human party-mates pick up their real
    // transform tier (and re-render when a member transforms mid-fight).
    const presenceByMember = usePartyPresenceStore((s) => s.byMember);
    const { skillMode, setSkillMode, autoPotionHpEnabled, autoPotionMpEnabled } = useSettingsStore();

    // 2026-05-13 spec ("sojusznik widzi to samo co lider w walce z bossem"):
    // derive party-combat role. ANY member with another human in the
    // party joins the shared fight; non-leader members suppress their
    // own ticks and mirror the leader's authoritative boss-state.
    const isMultiHumanParty = !!party && party.members.some(
        (m) => m.id !== character?.id && !m.isBot,
    );
    const isLeaderInPartyCombat = isMultiHumanParty && party?.leaderId === character?.id;
    const isNonLeaderMember     = isMultiHumanParty && party?.leaderId !== character?.id;

    // -- Boss-list filter / sort state (per-character via characterScope) ----
    // Same persistence pattern as the dungeon hub: pulled from settingsStore
    // so toggles survive sessions and class swaps. Defaults are "show
    // everything" so existing players see no behaviour change until they
    // explicitly narrow the list.
    const bossFilterAvailableOnly    = useSettingsStore((s) => s.bossFilterAvailableOnly);
    const bossFilterMinLevel         = useSettingsStore((s) => s.bossFilterMinLevel);
    const bossFilterSortDesc         = useSettingsStore((s) => s.bossFilterSortDesc);
    const setBossFilterAvailableOnly = useSettingsStore((s) => s.setBossFilterAvailableOnly);
    const setBossFilterMinLevel      = useSettingsStore((s) => s.setBossFilterMinLevel);
    const setBossFilterSortDesc      = useSettingsStore((s) => s.setBossFilterSortDesc);

    const [phase, setPhase]           = useState<ScreenPhase>('list');

    // 2026-05-13 spec ("lider konczy bossa -> sojusznicy do miasta"):
    // when the leader of a multi-human party transitions OUT of an
    // active fight (phase becomes 'list', meaning back to the boss
    // picker), broadcast a `combat-end` event so every member's
    // partyCombatSyncStore listener pulls them back to town. Mirrors
    // the same mechanism hunt's stopCombat uses. Members on /boss
    // would otherwise sit there with stale state.
    const prevBossPhaseRef = useRef<ScreenPhase>(phase);
    useEffect(() => {
        const prev = prevBossPhaseRef.current;
        prevBossPhaseRef.current = phase;
        if (prev === 'list' || phase !== 'list') return;
        // phase transitioned from non-list -> list (we exited a fight).
        const partyState = usePartyStore.getState().party;
        const me = useCharacterStore.getState().character?.id;
        if (!partyState || !me) return;
        const otherH = partyState.members.filter((m) => m.id !== me && !m.isBot);
        if (otherH.length === 0) return;
        if (partyState.leaderId !== me) return; // members don't broadcast
        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishCombatEnd();
        }).catch(() => { /* offline */ });
    }, [phase]);
    const [activeBoss, setActiveBoss] = useState<IBoss | null>(null);
    // 2026-05-14 spec ("Walka ma trwac dalej a osoba co zginela nie ma
    // miec od razu animacji smierci tylko popup ma jej wyskoczyc"):
    // when in a multi-human party and our character's HP hits 0 we
    // show a death-decision popup INSTEAD of running the full
    // handlePlayerDeath path. Two choices:
    //   - "Wróć do miasta" -> run the standard death penalty + flee
    //     home (full XP/skill loss + leave party).
    //   - "Czekaj na sojuszników" -> close popup, stay incapacitated.
    //     If a teammate revives us (HP > 0 again) we auto-close +
    //     resume normal play. If the party wins without our revive,
    //     no rewards + automatic death. If party wipes, death is
    //     applied via the natural defeat flow.
    // The leader's tick is gated so a corpse doesn't keep swinging.
    const [deathChoicePopup, setDeathChoicePopup] = useState(false);
    // Latch — once we showed the popup for this fight, don't auto
    // re-show on every HP=0 broadcast tick (lockout cleared on a
    // successful revive or when the user picks Wróć).
    const deathChoiceShownRef = useRef(false);
    const [result, setResult]         = useState<IBossResult | null>(null);
    // Boss-id whose drop-table popup is open. Replaces the inline expansion
    // so the tile stays compact and the drop info reads as a focused modal.
    const [dropModalBoss, setDropModalBoss] = useState<string | null>(null);
    // Epic entry animation — the screen "splits open" before the fight begins.
    //
    // 2026-05-14 spec ("Pierwsze ladowanie knightowi pokazuje podstrone /boss i
    // po chwili odpala sie walka z bossem tak nie powinno byc on powinien
    // widziec ta sama animacje co lider"): pre-seed the entry overlay from
    // the ready-check store's destination + payload so the first paint
    // already shows the door-opening animation instead of the empty boss
    // list. Before this fix, the member's Boss.tsx mounted with phase='list',
    // rendered the boss browser for ~1 frame, then the mount effect ran
    // playEntryThenFight which finally set bossEntryBoss -> overlay popped
    // in late. Each member saw a visible "/boss page" flash. The
    // initializer captures the same data the mount effect's tryStart()
    // would and arms the overlay synchronously during render.
    const [bossEntryBoss, setBossEntryBoss] = useState<IBoss | null>(() => {
        const rc = usePartyReadyCheckStore.getState();
        if (rc.destination !== '/boss') return null;
        // 2026-05-14 spec ("animacja ma sie odpalic po tym jak zaakceptuja
        // wszyscy sojusznicy popup bo nie mam jak zaakceptowac teraz"):
        // if the popup is still open (open=true), DO NOT pre-seed the
        // entry overlay — it would cover the modal and block the
        // Gotowy click. Only seed in the post-`go` state (open=false +
        // destination set) which is the case when the member navigates
        // here AFTER the ready-check resolved. With the new pre-nav
        // flow, the member mounts during the popup phase; in that
        // case bossEntryBoss stays null until the replicator-driven
        // `pendingBossEntryAt` trigger flips it after Gotowy -> `go`.
        if (rc.open) return null;
        const p = rc.payload as { bossId?: string } | null;
        if (!p?.bossId) return null;
        // The leader runs their own playEntryThenFight via pendingGoAction —
        // we only pre-seed for non-leader members.
        const meId = useCharacterStore.getState().character?.id;
        const pty = usePartyStore.getState().party;
        if (!pty || !meId || pty.leaderId === meId) return null;
        return (bossData as Array<{ id: string }>).find((b) => b.id === p.bossId) as IBoss | null;
    });

    // -- Pre-fight bot picker modal ------------------------------------------
    const [pendingBoss, setPendingBoss] = useState<IBoss | null>(null);
    const [partySize, setPartySize]     = useState<0 | 1 | 3>(3);
    const [botPicks, setBotPicks]       = useState<TBotClassOrNone[]>(['Knight', 'Cleric', 'Mage']);
    const lastBotPicksRef = useRef<TCharacterClass[]>([]);

    // -- Combat state ---------------------------------------------------------
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
    // 2026-05 v6: keep global BuffStore.combatSpeedMult in sync. Reset
    // to 1 on unmount so skill buffs drain at real time once we leave.
    useEffect(() => {
        useBuffStore.getState().setCombatSpeedMult(speedMult);
        return () => useBuffStore.getState().setCombatSpeedMult(1);
    }, [speedMult]);

    // 2026-05-14 spec ("zmienilem predkosc na X4 i nie zmienila sie u
    // sojusznika tez automatycznie"): broadcast speed changes from
    // leader so members mirror. Combat-speed event already lives in
    // partyCombatSyncStore (used by hunt) — reuse it here. Throttle
    // via partyState lookup so a solo player doesn't push to the
    // channel unnecessarily.
    useEffect(() => {
        const ptyState = usePartyStore.getState().party;
        const meId = useCharacterStore.getState().character?.id;
        if (!ptyState || !meId || ptyState.leaderId !== meId) return;
        const otherHumans = ptyState.members.filter((m) => m.id !== meId && !m.isBot).length;
        if (otherHumans === 0) return;
        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishCombatSpeed(speedMode);
        }).catch(() => { /* offline */ });
    }, [speedMode]);

    // Member side: leader broadcasts combat-speed on every speedMode
    // change, AND every boss-state snapshot carries `speedMode` as a
    // backstop. The boss-state subscriber below applies that field
    // verbatim on every tick — so the member converges to the leader's
    // current speed within ~120 ms of joining, even if they missed the
    // last combat-speed broadcast.
    //
    // 2026-05-14 spec ("po wejsciu do walki ma pokazywac zawsze
    // predkosc jaka ustawil lider"): previously we hard-reset the
    // settingsStore.combatSpeed to 'x1' on mount, which raced the
    // channel handler — if the leader's broadcast landed BEFORE the
    // mount-reset ran, settingsStore briefly held the leader's value
    // and then our reset clobbered it back to 'x1'. Member stayed at
    // x1 forever until the leader manually re-cycled.
    //
    // The fix is twofold: (1) DON'T touch settingsStore (it belongs to
    // the player's hunt path, not boss combat — leader-broadcast
    // updates it via the channel handler, but we no longer overwrite
    // it locally); (2) make boss-state authoritative for the member's
    // boss-fight speed (see the `s.speedMode` block in the boss-state
    // subscriber). The legacy settingsStore-listener below stays as a
    // belt-and-braces fallback for the case where boss-state hasn't
    // arrived yet but a combat-speed broadcast has.
    useEffect(() => {
        if (!isNonLeaderMember) return;
        const unsub = (async () => {
            const { useSettingsStore } = await import('../../stores/settingsStore');
            return useSettingsStore.subscribe((state, prev) => {
                if (state.combatSpeed === prev.combatSpeed) return;
                const cs = state.combatSpeed;
                // SKIP isn't a valid Boss speedMode — clamp to x1.
                if (cs === 'x1' || cs === 'x2' || cs === 'x4') {
                    setSpeedMode(cs);
                }
            });
        })();
        return () => { void unsub.then((fn) => fn?.()); };
    }, [isNonLeaderMember]);

    // 2026-05 v6: Cleric Błogosławieństwo 1-Hz pulse declared further
    // below (after fx + charMaxHp + playerHpRef are wired). See the
    // useEffect tagged "Cleric Błogosławieństwo pulse".
    const partyHealAccumRef = useRef(0);

    // 2026-05-14: auto-close the death-decision popup if the player
    // gets healed back above 0 HP (revive spell, teammate cleric, etc.).
    // We also clear the one-shot latch so a later death re-opens the
    // popup if the player drops again in the same fight.
    useEffect(() => {
        if (playerHp > 0 && deathChoicePopup) {
            setDeathChoicePopup(false);
            deathChoiceShownRef.current = false;
        }
    }, [playerHp, deathChoicePopup]);

    // (party-wipe useEffect moved below — after bots + handlePlayerDeath
    // are declared, otherwise TS flags "used before declaration".)

    const cycleSpeed = useCallback(() => {
        // 2026-05-13 spec ("sojusznicy nie moga przyspieszac walki"):
        // only the leader controls combat speed. Members mirror the
        // leader's setting (combat-speed broadcast keeps them in sync);
        // letting them tap their own button here would only desync
        // their local speedMult from the shared engine.
        if (isNonLeaderMember) return;
        setSpeedMode((s) => (s === 'x1' ? 'x2' : s === 'x2' ? 'x4' : 'x1'));
    }, [isNonLeaderMember]);
    const { trigger: triggerSkillAnim } = useSkillAnim();
    // Per-slot combat VFX. The boss occupies enemy slot 0; player is ally slot
    // 0; bots fill ally slots 1+ in the same order they're rendered. We use
    // a small `botSlotOf(id)` helper inside the damage callbacks so spell
    // floats land on the right card. See `useCombatFx` doc-comment for kinds.
    const fx = useCombatFx();
    const skillCooldownRef = useRef<Map<string, number>>(new Map());
    const hpPotionCooldownRef = useRef(0);
    const mpPotionCooldownRef = useRef(0);
    const pctHpCooldownRef = useRef(0);
    const pctMpCooldownRef = useRef(0);
    const playerMpRef = useRef(0);

    // Animation state — pulse counters (not booleans) so the keyed flash
    // overlays in EnemyCard / AllyCard re-mount on EVERY hit. Critical for
    // boss fights where the player's auto-attack and a skill can land within
    // the same 300ms window (the boolean version would only flash once),
    // and for boss multi-hit phases where multiple swings can hit the player
    // in rapid succession.
    const [monsterHitPulse, setMonsterHitPulse] = useState(0);
    const [playerHitPulse, setPlayerHitPulse]   = useState(0);
    // Per-bot hit pulse — keyed by bot id so each ally in the party gets its
    // own independent flash overlay when the boss targets them. Without this
    // every bot's avatar would only flash when the player got hit, not when
    // the boss was beating on a specific bot via aggro / AOE.
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

    // Refs for interval callbacks
    const bossHpRef   = useRef(0);
    const playerHpRef = useRef(0);
    const phaseRef    = useRef<ScreenPhase>('list');
    // 2026-05 v7: one-shot guard for handleBossDeath. The death handler
    // schedules `setPhase('result')` via a 500ms setTimeout, which means
    // between the kill and the phase change there's a window where every
    // 250ms-cadence interval (×speedMult: at x4 -> ~60ms wall-time) sees
    // `phaseRef.current === 'fighting' && bossHpRef.current <= 0` and
    // re-fires the death handler. Each fire calls `setBossDefeated` (one
    // attempt) + `addBossKill` (one kill). Without the guard, killing a
    // boss once burned all 3 attempts and double/triple-counted the kill.
    // Reset to false in `handleChallenge` (start of every fight).
    const bossDeathHandledRef = useRef(false);

    // Skill-effect session — shared status state across player + boss for
    // DOTs, stuns, marks, immortality, dodges, etc. Reset on every fight
    // start (see handleChallenge below).
    const effectsRef = useRef<ICombatEffectsSession>(newCombatEffectsSession());
    const PLAYER_FX_ID = 'player';
    const BOSS_FX_ID = 'boss';

    // 2026-06: party-buff leak fix — `party_attack_up` / `party_as_up`
    // (cast by Bard/Cleric) write to EVERY ally's status incl. the
    // leader's own `PLAYER_FX_ID` (it's in `allyIds`). The ally bots
    // already consume these via their own status, but the LEADER's own
    // single-wield basics + skill damage never read `atkBuffPct`, and
    // `charSpeed` never folded in `asMult` — so the support felt useless
    // for the party leader. These live readers pull the CURRENT active
    // party buff off the player's status (decayed by `tickStatus`, so a
    // 0 means "not active right now"). Note: the player's status field is
    // shared with the self-cast `attack_up` / self `as_up` window, but
    // those self-buffs already reach the leader through the normal
    // damage path (basic via `consumeCasterBasicHitMods`, etc.), so for
    // the missing paths below reading the merged value is the correct
    // total buff to apply — `Math.max` in `applyEffects` means we never
    // stack self + party, just take the strongest window.
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

    // Level-up HP/MP refill — characterStore.addXp refills hp/mp to max on
    // every level-up, but Boss keeps a LOCAL playerHp/playerMp useState that
    // doesn't see the store-side refill. Without this hook, leveling up
    // mid-boss-fight would leave the player's bars stuck at the pre-level-up
    // value until the next damage tick. We sync the local mirrors here.
    useLevelUpRefill(phase === 'fighting', useCallback((maxHp, maxMp) => {
        playerHpRef.current = maxHp;
        playerMpRef.current = maxMp;
        setPlayerHp(maxHp);
        setPlayerMp(maxMp);
    }, []));
    const activeBossRef = useRef<IBoss | null>(null);
    /** Scaled combat stats (HP/ATK/DEF multiplied for party balance) */
    const scaledBossRef = useRef<{ hp: number; attack: number; attack_min: number; attack_max: number; defense: number }>({ hp: 0, attack: 0, attack_min: 0, attack_max: 0, defense: 0 });
    const [scaledBossMaxHp, setScaledBossMaxHp] = useState(0);
    const spellCounterRef = useRef(0);

    // -- Bot companion state -------------------------------------------------
    const { bots, generateBotsCustom, updateBotHp, updateBotMp, killBot, clearBots } = useBotStore();
    const botsRef = useRef<IBot[]>([]);
    const aggroTargetRef = useRef<string>('player');
    const bossTurnCounterRef = useRef(0);
    /** Timestamp (ms) when the next aggro re-roll is allowed. */
    const aggroSwitchAtRef = useRef<number>(Date.now() + BOSS_AGGRO_SWITCH_INTERVAL_MS);
    const botSkillCooldownsRef = useRef<Map<string, number>>(new Map());

    // Keep botsRef in sync with store
    useEffect(() => { botsRef.current = bots; }, [bots]);

    // 2026-05-15 spec ("animacje spelli potworow ... rzucaja sie w
    // niewlasciwy kafelek"): defensive — whenever the bot roster ID
    // set changes (someone left party, slot indices shifted), wipe
    // ally-side fx so any in-flight monster spell / DOT float keyed
    // by the OLD slot doesn't land on an empty (or wrong) tile. Same
    // catch-all raid has.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bots]);

    const bosses   = bossData as IBoss[];
    const allItems: IBaseItem[] = flattenItemsData(itemsData as Parameters<typeof flattenItemsData>[0]);
    const skillLevels = useSkillStore((s) => s.skillLevels);

    // NOTE: `if (!character) return …` early-return was moved DOWN past every
    // hook in this component (search for "// Boss render guard (after-hooks)").
    // The original early return here violated Rules of Hooks — first render
    // with `character === null` skipped all subsequent hooks; second render
    // with character hydrated registered them, mismatching hook count and
    // crashing the <Boss> subtree with the React "change in order of Hooks"
    // error. The derived values below use `character?.X ?? 0` so they still
    // compute safely when character is null (their results are unused in
    // that case — the post-hooks guard renders the spinner instead).
    const eqStats   = getTotalEquipmentStats(equipment, allItems);
    const tb        = getTrainingBonuses(skillLevels, character?.class ?? 'Knight');
    // Gear-gap penalty: under-geared players deal proportionally less damage so
    // low-level gear can't practically clear far-higher-level bosses.
    const gearGapMult = getGearGapMultiplier(getEquippedGearLevel(equipment), activeBoss?.level ?? 0);
    const charAtk   = ((character?.attack  ?? 0) + eqStats.attack + getElixirAtkBonus()) * gearGapMult;
    const charDef   = (character?.defense ?? 0) + eqStats.defense + tb.defense + getElixirDefBonus();
    // Use the transform-aware effective max HP/MP so active transforms raise
    // the cap used by auto-potion / heal-clamp logic. Fallback to the raw
    // sum if the effective snapshot isn't available yet.
    const effChar   = character ? getEffectiveChar(character) : null;
    const baseMaxHp = (character?.max_hp ?? 0) + eqStats.hp + tb.max_hp + getElixirHpBonus();
    const baseMaxMp = (character?.max_mp ?? 0) + eqStats.mp + tb.max_mp + getElixirMpBonus();
    const charMaxHp = effChar?.max_hp ?? baseMaxHp;
    const charMaxMp = effChar?.max_mp ?? baseMaxMp;
    const charSpeed = ((character?.attack_speed ?? 1) + eqStats.speed * 0.01 + tb.attack_speed) * getElixirAttackSpeedMultiplier();

    // Best potions the player owns
    const bestHpPotion = getBestPotion(hpPotions, consumables, character?.level ?? 1);
    const bestMpPotion = getBestPotion(mpPotions, consumables, character?.level ?? 1);
    const bestPctHpPotion = getBestPotion(pctHpPotions, consumables, character?.level ?? 1);
    const bestPctMpPotion = getBestPotion(pctMpPotions, consumables, character?.level ?? 1);

    // Keep refs in sync
    phaseRef.current = phase;
    activeBossRef.current = activeBoss;

    // -- Live HP/MP mirror -> characterStore ---------------------------------
    // Same pattern as Dungeon — mirror local fight HP/MP into characterStore
    // on every change so the global TopHeader bars stay live. Gated by the
    // 'fighting' phase so we never clobber the real character HP with the
    // 0 initial state held before `beginBossFight` runs.
    //
    // Clamp uses EFFECTIVE max (not raw `liveChar.max_hp`) so a potion that
    // brings local HP above the BASE max (because an HP elixir is active)
    // isn't truncated when written to the store — see Dungeon mirror for
    // the full bug write-up.
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

    // -- URL-leave / tab-close = death (anti-cheat) -------------------------
    // Same anti-cheat guard as Dungeon — if the player navigates away mid-
    // fight (back button, address bar, tab close) we treat it as a real
    // death. See `applyCombatLeaveDeath` for the rationale (consumable-
    // protection items are intentionally bypassed). Real wins/deaths/flees
    // each flip the ref so the cleanup doesn't double-charge.
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
        // Mirror into the unified session log (uncapped) so the shared
        // <CombatLogsModal> in <CombatSubControls> can render the full Boss
        // session feed without each view rolling its own modal.
        const sessionType = type === 'boss-spell' ? 'system' : type;
        useCombatStore.getState().addSessionLog(text, sessionType);
    }, []);

    // Cleric Błogosławieństwo pulse — 1-Hz game-time tick that pushes
    // a +X HP float on the player + each alive bot's slot. Uses fx /
    // charMaxHp / playerHpRef declared above. The accumulator was
    // declared near the top of the component to keep the ref stable.
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fx, charMaxHp]);

    // Floating damage numbers were tied to the legacy bespoke arena. The
    // shared CombatUI tree communicates hits via card flash (`isHit`), HP-bar
    // tween, and the session log instead, so this is a no-op kept only to
    // avoid touching every callsite. Drop it in a later cleanup pass.
    const showFloatingDmg = useCallback((_text: string, _type: string, _side?: 'left' | 'right') => {}, []);

    // Auto-scroll log
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [combatLog.length]);

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

    // -- Helpers: heal / spend MP ---------------------------------------------
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
        const settings = useSettingsStore.getState();
        const inv = useInventoryStore.getState();
        const hp = playerHpRef.current;
        const mp = playerMpRef.current;

        // Bug 2 (2026-04): pull effective max HP/MP fresh on every fire so a
        // buff that ticked down without re-rendering Boss.tsx can't clamp the
        // heal at the stale (higher) cap.
        const freshChar = useCharacterStore.getState().character;
        const freshEff = freshChar ? getEffectiveChar(freshChar) : null;
        const liveMaxHp = freshEff?.max_hp ?? charMaxHp;
        const liveMaxMp = freshEff?.max_mp ?? charMaxMp;

        // Safety: never fire a potion when HP/MP are already at (or above) max —
        // regardless of the user's threshold. This guards against stale refs,
        // transform-cap drift, and floating-point rounding.
        const hpAtFull = liveMaxHp > 0 && hp >= liveMaxHp;
        const mpAtFull = liveMaxMp > 0 && mp >= liveMaxMp;

        // Resolve the potion amount first. We only fire a potion when the
        // actual missing amount is at least as large as what this potion would
        // restore — otherwise we'd waste a +50 HP flask healing 1 HP. This is
        // the hard guard against "lost 1 HP, burned a potion".
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

    // -- Manual potion use ---------------------------------------------------
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
        // Bug 2: pull effective max fresh so a freshly-applied buff is honored.
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

    // Spec 6 (2026-05): remember the most recent boss + bot picks so the
    // result modal's "Walcz ponownie" button can replay the exact same
    // setup without making the player walk back through the prefight UI.
    const lastBossPartyRef = useRef<TCharacterClass[]>([]);

    // -- Actually start boss fight with chosen bot party --------------------
    const beginBossFight = useCallback((boss: IBoss, chosenBotClasses: TCharacterClass[]) => {
        if (!character) return;
        lastBossPartyRef.current = chosenBotClasses;
        // Wipe the unified session before a new boss attempt — fresh logs,
        // empty backpack, zero kills/xp/gold for this session.
        useCombatStore.getState().clearCombatSession();
        // 2026-05-14 spec ("nie zlicza sie suma zadanego DMG"): reset
        // the party-damage tally so the widget counts from zero on
        // every retry / new boss.
        void import('../../stores/partyDamageStore').then(({ usePartyDamageStore }) => {
            usePartyDamageStore.getState().reset();
        }).catch(() => { /* offline */ });
        // Drop any leftover skill overlays / floating numbers from the
        // previous attempt so the new fight starts visually clean.
        fx.resetFx();
        const scaled = getScaledBossStats(boss);
        setActiveBoss(boss);
        scaledBossRef.current = scaled;
        setScaledBossMaxHp(scaled.hp);
        setBossHp(scaled.hp);
        bossHpRef.current = scaled.hp;
        // HP/MP persistence: boss attempts start from the player's CURRENT
        // pool (clamped to live max), not full. Combat outcomes never
        // silently top the player off — only potions/rest/death do.
        //
        // 2026-05-14 spec ("Jezeli w bossie i raidzie zginie sojusznik
        // i na popupie kliknie ze nie wraca do miasta i czeka a nikt go
        // nie wskrzesi to otrzymuje nagrody ... ale ponownym
        // rozpoczeciu caly czas jest nie zywy"): if char.hp is 0
        // (Czekaj-dead carried over from the previous fight) spawn the
        // player DEAD — they sit slumped until a Cleric's Aura
        // Wskrzeszenia revives them mid-fight.
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
            // 2026-05-14 spec ("Dalej jest rozjazd w HP sojusznikow, jeden
            // sojusznik widzi co innego niz drugi"): after generation,
            // override each bot's HP/MP pool from partyPresenceStore for
            // slots that represent a real human party-mate. Without this
            // the bot's maxHp is scaled to the LEADER's level (e.g.
            // 100 000 at lvl 1000) while the human's real maxHp could be
            // 5 000 — so when boss damage drops bot.hp to 50 000, the
            // leader's bar shows 50% but the broadcast hp value of 50 000
            // overflows the human's real 5 000 maxHp -> member's bar
            // renders meaninglessly. By taking maxHp from presence we
            // anchor the bot's scale to reality, and bot.hp tracks
            // damage out of a maxHp the member shares.
            const ptyForBots = usePartyStore.getState().party;
            const presenceMap = usePartyPresenceStore.getState().byMember;
            const humanMatesForBots = ptyForBots?.members.filter(
                (m) => m.id !== character.id && !m.isBot,
            ) ?? [];
            const generated = useBotStore.getState().bots;
            const patched = generated.map((b, i) => {
                const mate = humanMatesForBots[i];
                if (!mate) return b; // AI fill slot — keep generated values.
                const pres = presenceMap[mate.id];
                // 2026-05-14: tag the bot with its represented human so
                // the roster-sync effect below can find + drop this
                // slot when the human leaves the party mid-fight.
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
                    // 2026-06-19 spec ("party damage ignoruje ekwipunek
                    // sojusznikow"): a human mate's bot slot was scaled to
                    // the LEADER's level with NO gear, so a fully-geared
                    // friend hit for bot-tier damage. Override the slot's
                    // attack/defense with the mate's REAL effective stats
                    // broadcast via presence so they contribute their actual
                    // power. Falls back to the bot-formula value when the
                    // broadcast hasn't arrived yet OR comes from an older
                    // client that doesn't send these fields (safe degrade).
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
        // Fresh effect session — clear all timers / DOTs / queues from prior
        // fights so a leftover stun doesn't carry over.
        effectsRef.current = newCombatEffectsSession();
        // Wipe any leftover necromancer summons from a previous fight.
        useNecroSummonStore.getState().clear(PLAYER_FX_ID);
        // Fresh fight = fresh leave-guard cycle so a player who beat boss A
        // cleanly can still be punished for bailing during boss B.
        leavePenaltyAppliedRef.current = false;
        // 2026-05 v7: arm the one-shot death guard for this fight.
        bossDeathHandledRef.current = false;
        // 2026-05-14: clear death-popup latch + close any stale popup.
        deathChoiceShownRef.current = false;
        setDeathChoicePopup(false);
        // 2026-05-17: rearm the result-phase death-without-rez guard
        // so the next fight can re-trigger it if needed.
        resultDeathAppliedRef.current = false;
        wipeForcedRef.current = false;
        setPhase('fighting');
        logIdRef.current = 0;
    }, [charMaxHp, charMaxMp, character?.level, generateBotsCustom, clearBots, fx]);

    // Duration of the door-opening intro before the fight actually begins.
    // Capped at 2 seconds total per UX directive — the previous 2.1s build
    // dragged on; players want a punchy cut into combat. All sub-animations
    // (doors / seam / label / shockwave) were scaled down accordingly so the
    // sequence still reads as "doors -> reveal -> fight" without feeling rushed.
    // Timings:
    //  0ms          -> overlay appears, doors closed, faint boss backdrop visible behind
    //  250–950ms    -> doors slide off to the sides (0.7s ease)
    //  950–1800ms   -> doors are gone, boss centered + label settling
    //  ~1800ms      -> navigate to combat (overlay fades during combat mount)
    const BOSS_ENTRY_MS = 1800;

    // Refs for the entry-skip path. We need to reach the pending fight
    // params (boss + picks) and the running timeout from a click handler
    // on the overlay itself, so a tap anywhere while the doors are still
    // opening jumps straight into combat.
    const bossEntryTimeoutRef = useRef<number | null>(null);
    const bossEntryPendingRef = useRef<{ boss: IBoss; picks: TCharacterClass[] } | null>(null);

    // Skip the door-opening intro and start the fight immediately. Safe to
    // call multiple times — the first invocation clears the timeout and
    // nulls the pending payload, so subsequent clicks become no-ops.
    //
    // 2026-05-13 spec ("Tylko lider moze pominac animacje wtedy wszystkim
    // sie pomija ona ale to tylko w party tak dziala"):
    //   - Solo / bots-only: anyone clicks -> skips locally (unchanged).
    //   - Multi-human party leader: skipping broadcasts a `boss-entry-skip`
    //     so members fast-forward in lockstep.
    //   - Multi-human party member: clicks are silently ignored (their
    //     own subscriber receives the leader's skip event and runs the
    //     local fast-forward then).
    const skipBossEntry = useCallback(() => {
        if (isNonLeaderMember) return; // Member can't skip on their own.
        const pending = bossEntryPendingRef.current;
        if (!pending) return;
        if (bossEntryTimeoutRef.current !== null) {
            window.clearTimeout(bossEntryTimeoutRef.current);
            bossEntryTimeoutRef.current = null;
        }
        bossEntryPendingRef.current = null;
        setBossEntryBoss(null);
        beginBossFight(pending.boss, pending.picks);
        // Leader-in-party-combat: tell members to also skip.
        if (isLeaderInPartyCombat) {
            void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                usePartyCombatSyncStore.getState().publishBossEntrySkip();
            }).catch(() => { /* offline */ });
        }
    }, [beginBossFight, isLeaderInPartyCombat, isNonLeaderMember]);

    // Run the epic door-opening entry, then kick off the real fight.
    // Stores the pending params + timeout id in refs so `skipBossEntry`
    // (wired to an onClick on the overlay) can short-circuit the wait.
    const playEntryThenFight = useCallback((boss: IBoss, picks: TCharacterClass[]) => {
        bossEntryPendingRef.current = { boss, picks };
        setBossEntryBoss(boss);
        if (bossEntryTimeoutRef.current !== null) {
            window.clearTimeout(bossEntryTimeoutRef.current);
        }
        bossEntryTimeoutRef.current = window.setTimeout(() => {
            bossEntryTimeoutRef.current = null;
            const pending = bossEntryPendingRef.current;
            if (!pending) return; // already skipped
            bossEntryPendingRef.current = null;
            setBossEntryBoss(null);
            beginBossFight(pending.boss, pending.picks);
        }, BOSS_ENTRY_MS);
    }, [beginBossFight]);

    // 2026-05-12 spec ("popup z przywolaniem przed bossem"): member-side
    // pickup of the ready-check `go` event. After the leader fires `go`,
    // both clients navigate to /boss. The MEMBER's Boss.tsx mounts and
    // checks the ready-check store for a pending boss-id payload — if
    // present, auto-starts the fight with the current party composition.
    // Runs ONLY on mount (deps `[]`). Order of effects: child (Boss)
    // mount-effects fire BEFORE the parent (AppShell) usePartyReadyCheck
    // useEffect that consumes destination, so the payload is still
    // there when we read it.
    // 2026-05-13: subscribe to destination changes on the ready-check
    // store so we re-trigger the entry animation every time the leader
    // chains a fight (Walcz ponownie / Walcz wyżej through
    // triggerPartyCombatGo). The previous "fire once on mount" version
    // only worked for the first ready-check; on subsequent retries the
    // member stayed on the result panel because Boss.tsx wasn't
    // remounted.
    //
    // FIRST-ENTRY RACE FIX (2026-05-13): the mount-time tryStart() used
    // to fire BEFORE the boss-state subscriber finished settling, so on
    // a very fresh navigate the member's character.hp could still be at
    // its pre-heal value or the party state hadn't fully hydrated.
    // We now run tryStart() on a microtask after mount AND defensively
    // re-fire it any time character / party / destination changes —
    // idempotent because consumeDestination clears the trigger after
    // the first successful call.
    const memberEntryTriedRef = useRef(false);
    const lastBossEntryAtSeenRef = useRef(0);
    useEffect(() => {
        if (!character) return;
        const me = character.id;
        const fireEntry = (bossId: string) => {
            const partyState = usePartyStore.getState().party;
            if (!partyState) return;
            if (partyState.leaderId === me) return; // leader uses pendingGoAction
            const boss = (bossData as Array<{ id: string }>).find((b) => b.id === bossId);
            if (!boss) return;
            // 2026-05-18 spec ("Nic nigdy nie powinno mi samemu odnawiac
            // HP i MP poza HP i MP regen oraz potionami"): removed the
            // hp<=0 || mp<=0 auto-fullHeal — carry current pool into
            // the new boss attempt (stayDead path still handles 0-HP
            // re-entry as a slumped corpse).
            lastBotPicksRef.current = [];
            memberEntryTriedRef.current = true;
            playEntryThenFight(boss as IBoss, []);
        };
        const tryStartFromReadyCheck = () => {
            const rc = usePartyReadyCheckStore.getState();
            if (rc.destination !== '/boss') return;
            const p = rc.payload as { bossId?: string } | null;
            if (!p?.bossId) return;
            // 2026-05-13 BUG FIX: only the MEMBER should consume the
            // destination here. The leader's own popup is still in
            // flight (open=true, members confirming) and the leader's
            // ReadyCheckModal reads destination + payload to render the
            // boss card. Stripping them turns the popup into a "?"
            // banner with no target — fight never starts.
            //
            // Also bail early if the ready-check modal is still OPEN
            // (meaning we're inside the start->ready->go window, not a
            // direct go / instant-go arrival).
            const partyState = usePartyStore.getState().party;
            if (!partyState) return;
            if (partyState.leaderId === me) return; // leader uses pendingGoAction
            if (rc.open) return; // still confirming — wait for `go` to flip open=false
            usePartyReadyCheckStore.getState().consumeDestination();
            fireEntry(p.bossId);
        };
        // Try immediately on mount (covers first-fight case where the
        // destination was set just before mount).
        tryStartFromReadyCheck();
        // Subscribe to ready-check destination changes (retry path via
        // triggerPartyCombatGo / instant-go).
        const unsubRc = usePartyReadyCheckStore.subscribe((state, prev) => {
            if (state.destination === prev.destination) return;
            if (state.destination !== '/boss') return;
            tryStartFromReadyCheck();
        });
        // Subscribe to the replicator's local trigger — fires from
        // AppShell's useReadyCheckGoEffect, AFTER our mount-effect, so
        // any first-entry race where tryStartFromReadyCheck missed the
        // destination is recovered here. Importing async keeps the
        // module-load order tidy (Boss.tsx already pulls in this store
        // for the boss-state subscription).
        let unsubSync: (() => void) | null = null;
        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            // Seed the seen-at so a stale value from a previous fight
            // doesn't re-fire on mount.
            lastBossEntryAtSeenRef.current = usePartyCombatSyncStore.getState().pendingBossEntryAt;
            unsubSync = usePartyCombatSyncStore.subscribe((state) => {
                const at = state.pendingBossEntryAt;
                if (!at || at === lastBossEntryAtSeenRef.current) return;
                lastBossEntryAtSeenRef.current = at;
                const bossId = state.pendingBossEntryBossId;
                if (!bossId) return;
                fireEntry(bossId);
            });
        }).catch(() => { /* offline */ });
        return () => {
            unsubRc();
            unsubSync?.();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character?.id, playEntryThenFight]);

    // -- Open pre-fight bot picker (or skip if already in party) -------------
    const handleChallenge = useCallback((boss: IBoss) => {
        // 2026-05-12 spec ("ready-check popup przed bossem / raidem /
        // trainerem"): route the click through `requestPartyCombatStart`.
        // For solo / leader: runs the onConfirmed action (immediate or
        // queued for `go`). For non-leader member: returns false ->
        // silent no-op (member can't start; leader must summon).
        const partyState = usePartyStore.getState().party;
        const me = useCharacterStore.getState().character?.id;
        const otherHumans = partyState?.members.filter((m) => m.id !== me && !m.isBot) ?? [];
        const isMultiHumanParty = !!partyState && otherHumans.length > 0;
        if (isMultiHumanParty && partyState?.leaderId !== me) {
            // Non-leader member: silent no-op
            return;
        }

        // Compute partner classes from current party (bots + humans).
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
    }, [party, character?.id, playEntryThenFight]);

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

    // `retryBossFight` lived here to power the now-removed ":counterclockwise-arrows-button: Ponów walkę"
    // button. The unified-combat spec drops the in-result fight-again CTA so
    // the helper is gone too — players head back to the list to re-engage.

    // -- Handle boss death ----------------------------------------------------
    const handleBossDeath = useCallback(() => {
        const boss = activeBossRef.current;
        if (!boss) return;
        if (!character) return;
        // 2026-05 v7: idempotency guard — every code path that could
        // land the killing blow (basic attack, spell cast, summon swing,
        // DOT tick, Mroczny Rytuał detonation) calls this handler. The
        // handler schedules `setPhase('result')` 500ms later, leaving a
        // window where multiple calls can stack. Without this guard the
        // player saw 3/3 attempts used after a single kill (the necro's
        // summon swung at ~the same time the ritual fired, then the next
        // 250ms DOT tick re-fired the handler too because phaseRef was
        // still 'fighting'). One kill -> one attempt consumed -> one
        // reward roll. Reset in `handleChallenge` for the next fight.
        if (bossDeathHandledRef.current) return;
        bossDeathHandledRef.current = true;

        tickCombatElixirs(2000);

        const drops = rollBossLoot(boss);
        // Mastery N7: per-boss-kill XP/Gold bonus (+2% per level, cap +50%)
        const bossMasteryLvl = useMasteryStore.getState().getMasteryLevel(boss.id);
        const bossXpMult = getMasteryXpMultiplier(bossMasteryLvl);
        const bossGoldMult = getMasteryGoldMultiplier(bossMasteryLvl);
        const gold = Math.floor(rollBossGold(boss) * bossGoldMult);
        // 2026-05-08: Per spec, XP boost elixirs (xp_boost / xp_boost_100 /
        // premium_xp_boost) ONLY apply to hunting monsters in Combat view.
        // Boss kills no longer multiply XP by these buffs and do NOT
        // drain pausable time — the player gets full uptime for hunt.
        // skill_xp_boost is also removed from boss-kill drain (spec: only
        // basic-attack weapon-XP in hunt + active training).
        const bStore = useBuffStore.getState();
        const baseBossXp = Math.floor(getBossXp(boss) * bossXpMult);
        const xp = baseBossXp;
        void bStore; // kept for downstream pausable-buff API drains.

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
        // Award XP to the character (was missing — boss kills granted 0 XP before this fix)
        const xpResult = useCharacterStore.getState().addXp(xp);
        if (xpResult.levelsGained > 0) {
            addLog(`Awans! Poziom ${xpResult.newLevel}! (+${xpResult.statPointsGained} pkt statystyk) – pełne HP/MP!`, 'system');
        }
        setBossDefeated(boss.id);
        addBossKill(boss.id, boss.level);

        // 2026-05-14 spec ("Jezeli w party zabije bossa to powinno sie
        // zliczac wszystkim sojusznikom"): explicit kill broadcast so
        // every member's bossStore burns an attempt locally. Dead
        // members (per spec) are excluded. We compute the alive list
        // from the leader's authoritative bot roster — humanPartyMates
        // map gives us the character.id for each non-self party
        // member; we keep those whose bot is still alive.
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
            }).catch(() => { /* offline */ });
        }

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
            chestNames.push(`${getSpellChestEmoji(cd.chestLevel)} ${getSpellChestDisplayName(cd.chestLevel)}`);
        }

        // Potion drops — same per-level cadence as monsters/dungeons. The
        // mega elixirs (1000 HP / 1000 MP, gated to monsters lvl ≥100 in
        // the helper) drop naturally for high-level bosses without any
        // extra wiring here.
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
        // Persist end-of-fight HP/MP so the next combat (any view) starts
        // from this exact state. Killing the boss is no longer a hidden
        // full heal. (Real death still triggers the recovery heal.)
        //
        // CRITICAL FIX (HP-drops-to-11% bug, take 2):
        //   The earlier fix used `liveChar.max_hp` as the clamp ceiling,
        //   but that's the BASE max (no equipment / training / elixirs /
        //   transform). The in-combat `playerHpRef.current` lives on the
        //   EFFECTIVE max scale (base + all bonuses), so clamping with the
        //   base max chops e.g. 28 000 down to ~4 000 and the UI then
        //   renders 4 000 / 28 000 ≈ 14 % even when the player took zero
        //   damage. Same problem on level-up: addXp's "full heal" only
        //   includes equipment + training (see getEffectiveMaxBonuses in
        //   characterStore.ts), so an active elixir or transform leaves
        //   the player at base+eq+training instead of the displayed max.
        //
        //   Real fix: recompute the post-addXp EFFECTIVE max here and
        //   either heal to it (level-up) or clamp the in-combat HP to it
        //   (no level-up). Same formula as the in-combat charMaxHp at
        //   line ~436 — keeps the boss view's heal-clamp on the same
        //   scale as the displayed bar.
        const liveCharAfter = useCharacterStore.getState().character;
        if (liveCharAfter) {
            const eqLive = getTotalEquipmentStats(equipment, allItems);
            const tbLive = getTrainingBonuses(skillLevels, character.class);
            const baseMaxHpLive = liveCharAfter.max_hp + eqLive.hp + tbLive.max_hp + getElixirHpBonus();
            const baseMaxMpLive = liveCharAfter.max_mp + eqLive.mp + tbLive.max_mp + getElixirMpBonus();
            const effLive = getEffectiveChar(liveCharAfter);
            const liveEffectiveMaxHp = effLive?.max_hp ?? baseMaxHpLive;
            const liveEffectiveMaxMp = effLive?.max_mp ?? baseMaxMpLive;

            // 2026-05 v7: post-victory full-restore HP & MP.
            //
            // 2026-05-14 spec ("Jezeli w bossie i raidzie zginie
            // sojusznik i na popupie kliknie ze nie wraca do miasta i
            // czeka a nikt go nie wskrzesi to otrzymuje nagrody ... ale
            // ponownym rozpoczeciu caly czas jest nie zywy"): a leader
            // who Czekaj-died and never got rezzed reaches the kill
            // with `playerHpRef.current === 0`. We MUST NOT refill —
            // their character carries hp=0 into the next boss attempt
            // so they spawn dead until a Cleric mid-fight revives.
            // Only alive winners get the heroic-recovery refill.
            const finalHp = playerHpRef.current > 0 ? liveEffectiveMaxHp : 0;
            const finalMp = playerHpRef.current > 0 ? liveEffectiveMaxMp : 0;

            useCharacterStore.getState().updateCharacter({ hp: finalHp, mp: finalMp });
        }
        // Clean win — disable the leave guard so closing the result screen
        // doesn't punish a player who actually killed the boss.
        leavePenaltyAppliedRef.current = true;
        // Mirror the win into the unified session so the shared backpack
        // modal (CombatBackpackModal) and HuntedTally read consistent
        // state across views. Bosses always count as a single 'boss' kill.
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

    // -- Handle player death --------------------------------------------------
    const handlePlayerDeath = useCallback((forceConfirm: boolean = false) => {
        const boss = activeBossRef.current;
        if (!boss) return;
        // 2026-05-14 spec ("Walka powinna trwac dalej, popup nie znika
        // po 3 sekundach"): in a multi-human party, ANY auto-call from
        // the combat tick MUST short-circuit. The full death sequence
        // (penalty + death overlay + setPhase('result')) is only
        // entered via the "Wróć do miasta" button which passes
        // forceConfirm=true. Until then, the corpse stays on the
        // arena, popup stays open, and combat ticks around the player.
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
                // Always bail — repeated calls (DOT, AOE, follow-up
                // attacks) hit this guard and never fall through to
                // the full death path that was killing the popup at ~3 s.
                return;
            }
        }
        // Real combat death is the canonical penalty for this fight — flag
        // the leave-guard so unmounting after won't double-charge.
        leavePenaltyAppliedRef.current = true;

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
            let skillXpLossPercent = 0;

            if (usedDeathProtection) {
                addLog(':shield: Eliksir Ochrony uchronił Cię od utraty poziomu!', 'system');
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
                // Drop slotted spells whose unlock-level now exceeds the
                // post-penalty character level so the player isn't stuck
                // with greyed-out slots they can't fix without manual swap.
                useSkillStore.getState().purgeLockedSkillSlots(char.class, penalty.newLevel);
                const skillPctTxt = `-${penalty.skillXpLossPercent}% Skill XP`;
                if (penalty.levelsLost > 0) {
                    addLog(`:skull: Zginąłeś! Tracisz ${penalty.levelsLost} poziom${penalty.levelsLost === 1 ? '' : 'y'}: ${char.level} -> ${penalty.newLevel} · ${skillPctTxt}`, 'system');
                } else {
                    addLog(`:skull: Zginąłeś w walce z ${boss.name_pl}! ${skillPctTxt}`, 'system');
                }
            }

            // Item loss with optional Amulet of Loss protection
            const itemsLost = useInventoryStore.getState().applyDeathItemLoss(usedAol);
            if (usedAol) {
                addLog(':trident-emblem: Amulet of Loss roztrzaskal sie i ochronil Twoje przedmioty!', 'system');
            } else if (itemsLost > 0) {
                addLog(`:skull: Stracileś ${itemsLost} przedmiot(ow) przy śmierci!`, 'system');
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
                skillXpLossPercent,
                protectionUsed: usedDeathProtection,
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
        // Death wipes the session so the next boss attempt starts clean.
        useCombatStore.getState().clearCombatSession();
        clearBots();
        setTimeout(() => setPhase('result'), 500);
    }, [addLog, clearBots]);

    // -- Manual skill use (click a slot when skillMode === 'manual') ----------
    const doManualSkill = useCallback((slotIdx: 0 | 1 | 2 | 3) => {
        if (phaseRef.current !== 'fighting') return;
        if (bossHpRef.current <= 0) return;
        // Stun gate — caster cannot cast while paralysed.
        if (isCombatantStunned(effectsRef.current, PLAYER_FX_ID)) return;
        const slots = useSkillStore.getState().activeSkillSlots;
        const skillId = slots[slotIdx];
        if (!skillId) return;
        // 2026-05-17 spec ("wylaczylem auto spelle i nie moge ich uzywac
        // klikam non stop manualnie spella i nie dziala"): non-leader
        // members don't run the boss engine — their local cast would
        // never animate or apply damage. Broadcast a skill request to
        // the leader instead; the leader's engine pops it from
        // `consumeMemberSkillRequest(memberId)` and casts on the
        // member's behalf (with the same MP / CD gates). The cast +
        // damage will arrive back on every screen via the existing
        // boss-damage broadcast.
        //
        // 2026-05-17 v2: switched to the STATIC store import (no
        // microtask) so the publish actually fires on the same frame
        // as the click — the dynamic-import variant occasionally
        // dropped the request under HMR. Also stamp the slot's
        // visual cooldown locally so the member's action bar shows
        // immediate "click registered" feedback while the leader's
        // tick rolls back its `boss-damage` broadcast.
        if (isNonLeaderMember) {
            const myId = useCharacterStore.getState().character?.id;
            if (!myId) return;
            usePartyCombatSyncStore.getState().publishMemberSkillRequest(myId, skillId);
            const def = getSkillDef(skillId);
            const cdMs = def?.cooldown ?? SKILL_COOLDOWN_MS;
            skillCooldownRef.current.set(skillId, Date.now());
            void cdMs; // CD value already drives the cooldown sweep via skillCooldownRef
            return;
        }
        const now = Date.now();
        const lastUsed = skillCooldownRef.current.get(skillId) ?? 0;
        if (now - lastUsed < SKILL_COOLDOWN_MS) return;
        if (playerMpRef.current < SKILL_MP_COST) {
            addLog('Za mało MP!', 'system');
            return;
        }
        // 2026-05 v7: Apokalipsa Śmierci — drives HP cost SYNCHRONOUSLY
        // at the top of the cast handler so nothing downstream can
        // erase it. Spec: HP > 20% -> 20%, HP 5-20% -> 3%, HP < 5% -> block.
        const sDefGate = getSkillDef(skillId);
        if ((sDefGate?.effect ?? '').includes('death_apocalypse')) {
            const hpPct = playerHpRef.current / Math.max(1, charMaxHp);
            if (hpPct < 0.05) {
                addLog(':broken-heart: Apokalipsa zablokowana: < 5% HP', 'system');
                return;
            }
            // > 20% -> lose 20% of max HP; 5–20% -> drop to 3% of max
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
        // Apply v2 effects (stun/dot/aoe/instant_kill/marks/etc.) to boss.
        const sDef = getSkillDef(skillId);
        // 2026-05 v6: classify cast affinity — enemy debuffs (Pułapka /
        // Cewka Śmierci / Osobliwość) animate on boss; pure self/party
        // buffs (Orle Oko / Tarcza Many / Okrzyk Bojowy) on player.
        const skillBaseMult = sDef?.damage ?? 0;
        const isDamageHit = skillBaseMult > 0;
        const targetsEnemy = isDamageHit || skillTargetsEnemy(sDef?.effect ?? null);
        const apply = effectsCastSkill({
            session: effectsRef.current,
            casterId: PLAYER_FX_ID,
            targetId: BOSS_FX_ID,
            targetHpPct: scaledBossMaxHp > 0 ? (bossHpRef.current / scaledBossMaxHp) * 100 : 100,
            effect: sDef?.effect ?? null,
            // Include alive bots so party_attack_up / party_defense_up etc.
            // actually buff their per-bot v2 status (consumed in bot atk / dmg).
            allyIds: [PLAYER_FX_ID, ...botsRef.current.filter((b) => b.alive).map((b) => b.id)],
            enemyIds: [BOSS_FX_ID],
        });
        // For damage skills the spell-damage multiplier from skills.json
        // (`skill.damage` 3.15× / 5× / 230× …) now actually scales the hit
        // — previously it was ignored, so every spell did the same baseline
        // 0.15×ATK regardless of which one.
        // def_pen:N drops the boss's defense to 0 (or N%) for this hit.
        const defPenFracBoss = Math.max(0, Math.min(1, (apply.defPenPct ?? 0) / 100));
        // Skill-upgrade combat bonus — local player's own cast only (this path
        // returns early for non-leader members above). Modest & capped.
        const skillUpgradeMultBoss = getCombatSkillUpgradeMultiplier(
            useSkillStore.getState().skillUpgradeLevels[skillId] ?? 0,
        );
        // 2026-06: party-buff leak fix — manual skill damage never folded
        // in the leader's own `party_attack_up`. Skill damage doesn't pass
        // through `consumeCasterBasicHitMods`, so read the active party
        // ATK% live off the player's status and scale the cast.
        const partyAtkMultManual = 1 + getActivePartyAtkPct() / 100;
        const baseDmg = isDamageHit ? Math.max(
            1,
            Math.floor(charAtk * 0.15 * skillBaseMult * partyAtkMultManual * getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier() * (1 + defPenFracBoss) * skillUpgradeMultBoss),
        ) : 0;
        const normalSkillDmgBoss = Math.floor(baseDmg * apply.castDmgMult);
        let skillDmg = isDamageHit
            ? (apply.instantKill
                ? bossHpRef.current
                : ((apply.executeBurstPct ?? 0) > 0
                    ? Math.max(normalSkillDmgBoss, Math.floor(scaledBossMaxHp * (apply.executeBurstPct ?? 0) / 100))
                    : normalSkillDmgBoss))
            : 0;
        // Necromancer Klątwa Śmierci — first damage (basic OR spell)
        // on the marked boss consumes the charge and gets ×N.
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
        setSkillCooldowns((prev) => ({ ...prev, [skillId]: SKILL_COOLDOWN_MS }));
        { const sd = getSkillDef(skillId); if (sd) applySkillBuff(skillId, sd, speedMult); }
        // Heal-on-cast effects (Void Ray heal_self_pct_dmg, Bossa Nova
        // heal_self_pct_dmg, Pochłonięcie Życia, Żniwa Dusz).
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
        // 2026-05 v6: Cleric `heal` / `holy_nova` — heal_lowest_ally_pct.
        // Boss is 1v1 so the player IS the lowest ally; heals N% of
        // their max HP and lands the float on their slot.
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
        // Suppress unused-binding lint while AOE multistrike etc. wait for
        // wider integration (boss is 1v1 so AOE has no extra targets here).
        void apply.aoe; void apply.multistrike;
        // Necromancer summon spawn — only when the player's class is Necro.
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
        // 2026-05 v7: Apokalipsa Śmierci — target damage only.
        // Self-cost handled at top of cast handler.
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
            // Pure self/party buff — animacja na PLAYERZE.
            fx.triggerAllySkillAnim(0, skillId);
            addLog(`:sparkles: ${formatSkillName(skillId)}: BUFF (-${SKILL_MP_COST} MP)`, 'player');
            // 2026-05-18 spec ("animacje buffow itp byly poprawnie
            // pokazywane"): mirror the buff cue to members. Target =
            // 'player' (self-buff) so the receiver routes to the
            // leader's slot 0 ally float instead of boss-overlay.
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
                }).catch(() => { /* offline */ });
            }
        } else {
            // Damage hit OR enemy debuff (Pułapka / Cewka Śmierci) — boss
            // is enemy slot 0 (1v1 view, bots on right column).
            fx.triggerEnemySkillAnim(0, skillId);
            if (isDamageHit) {
                fx.pushEnemyFloat(0, skillDmg, 'spell', { icon: getSkillIcon(skillId) });
                showFloatingDmg(`-${skillDmg}`, 'player');
                addLog(`:sparkles: ${formatSkillName(skillId)}: ${skillDmg} dmg (-${SKILL_MP_COST} MP)`, 'player');
            } else {
                addLog(`:sparkles: ${formatSkillName(skillId)}: DEBUFF (-${SKILL_MP_COST} MP)`, 'player');
            }
            // 2026-05-14: broadcast leader's MANUAL skill cast so the
            // member sees the same overlay + spell float on the boss.
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
                }).catch(() => { /* offline */ });
            }
            // Stun / paralyze label on the boss — gated on the actual
            // apply result so failed `stun_chance:30:…` rolls (Smite) no
            // longer flash STUN every cast.
            if (apply.stunApplied) {
                fx.pushEnemyFloat(0, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
            } else if (apply.paralyzeApplied) {
                fx.pushEnemyFloat(0, 0, 'spell', { icon: 'locked', label: 'PARAL' });
            }
        }
        // 2026-05 v6: Cleric Aura Wskrzeszenia — revive dead bots to 50%
        // HP. Player slot 0 is the caster (alive) so revive only applies
        // to bot slots 1+.
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
        // Multistrike — fire N follow-up basic attacks on the boss.
        if ((apply.multistrike ?? 0) > 0) {
            const extra = Math.max(0, Math.floor(apply.multistrike));
            for (let n = 0; n < extra; n++) {
                window.setTimeout(() => {
                    if (phaseRef.current !== 'fighting' || bossHpRef.current <= 0) return;
                    const wRoll = rollWeaponDamage();
                    const followup = Math.max(1, Math.floor((charAtk + wRoll - Math.max(0, scaledBossRef.current.defense * (1 - defPenFracBoss))) * getAtkDamageMultiplier() * getTransformDmgMultiplier()));
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

    // -- Player attack callback -----------------------------------------------
    const doPlayerAttack = useCallback(() => {
        if (phaseRef.current !== 'fighting') return;
        if (bossHpRef.current <= 0) return;
        // 2026-05-14: dead-but-waiting player (multi-human party) keeps
        // the fight ticking via bots/leader, but their own swings
        // shouldn't fire (corpse can't shoot).
        if (playerHpRef.current <= 0) return;
        // Stun gate — caster cannot act while paralysed.
        if (isCombatantStunned(effectsRef.current, PLAYER_FX_ID)) return;
        const boss = activeBossRef.current;
        if (!boss) return;

        const isDualWield = !!bossClassesMap[character?.class ?? '']?.dualWield;
        const sDef = scaledBossRef.current.defense;
        const sMaxHp = scaledBossRef.current.hp;

        // -- Helper: single hit ----------------------------------------------
        const doSingleHit = (hand: 'left' | 'right' | undefined, weaponRollFn: () => number, dmgPercent: number) => {
            if (bossHpRef.current <= 0 || phaseRef.current !== 'fighting') return 0;
            const wRoll = Math.floor(weaponRollFn() * dmgPercent);
            const totalAtk = charAtk + wRoll;
            const baseDmg = Math.max(1, totalAtk - sDef);
            const variance = Math.floor(baseDmg * 0.2);
            const rolledDmg = Math.max(1, baseDmg - variance + Math.floor(Math.random() * (variance * 2 + 1)));
            // 2026-05 v6: pull "next basic" buff queues from the player's
            // status (Precyzyjny Strzał +30% crit / Klon Cienia ×2 dmg /
            // Knight Ostateczny guaranteed crit / Cięcie Boga chained
            // crit_next×5 / dmg_amp_next×5 etc.) — without this the boss
            // basic-attack ignored every queued caster mod.
            const playerStatus = ensureStatus(effectsRef.current, PLAYER_FX_ID);
            const mods = consumeCasterBasicHitMods(playerStatus);
            // Mirror charge consumption to BuffStore (drains visible
            // counters: Strzał Boga ×N, Klon Cienia, Precyzyjny etc.)
            syncCasterChargeConsume(mods.consumed);
            // Force-crit: 2.0× the rolled dmg (matches engine's crit mult).
            // critChance buff: roll once with the bumped chance.
            const baseCrit = mods.forceCrit
                ? true
                : Math.random() < mods.extraCritChance;
            const critMult = baseCrit ? 2.0 : 1.0;
            let finalDmg = Math.max(1, Math.floor(rolledDmg * critMult * mods.dmgMult * getAtkDamageMultiplier() * getTransformDmgMultiplier()));
            // Necromancer Klątwa Śmierci — first basic hit on the
            // marked boss consumes the charge and gets ×N.
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
            // Anchored basic-attack float on the boss (slot 0). Dual-wield
            // off-hand passes through with `hand: 'right'`, also picked up
            // here so each swing gets its own number on the same target.
            fx.pushEnemyFloat(0, finalDmg, 'basic', { icon: hand ? 'dagger' : undefined });
            // 2026-05-14: tally for party widget.
            if (character?.id) {
                void import('../../stores/partyDamageStore').then(({ usePartyDamageStore }) => {
                    usePartyDamageStore.getState().addDamage(character.id, finalDmg);
                }).catch(() => { /* offline */ });
            }
            // 2026-05-14: mirror to members so their arena shows the
            // same floating number + class-swing pulse.
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
                }).catch(() => { /* offline */ });
            }

            const handPrefix = hand === 'left' ? '[Lewa] ' : hand === 'right' ? '[Prawa] ' : '';
            addLog(`${handPrefix}Atakujesz za ${finalDmg} dmg (Boss HP: ${newBossHp.toLocaleString('pl-PL')}/${sMaxHp.toLocaleString('pl-PL')})`, 'player');
            return finalDmg;
        };

        // -- Execute attack(s) ------------------------------------------------
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
            // 2026-06: party-buff leak fix — single-wield basics never went
            // through `consumeCasterBasicHitMods` (only the dual-wield
            // `doSingleHit` path does, line ~2106), so `party_attack_up` on
            // the leader was dropped. Fold the active party ATK% in here.
            // Dual-wield is handled separately and MUST NOT also use this,
            // or it would double-apply.
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
            // 2026-05-14: tally for party widget.
            if (character?.id) {
                void import('../../stores/partyDamageStore').then(({ usePartyDamageStore }) => {
                    usePartyDamageStore.getState().addDamage(character.id, finalDmg);
                }).catch(() => { /* offline */ });
            }
            // 2026-05-14: mirror to members.
            if (isLeaderInPartyCombat) {
                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                    usePartyCombatSyncStore.getState().publishBossDamage({
                        attackerId: 'player',
                        attackerClass: character?.class as TCharacterClass,
                        targetId: 'boss',
                        damage: finalDmg,
                        kind: 'basic',
                    });
                }).catch(() => { /* offline */ });
            }
            addLog(`Atakujesz za ${finalDmg} dmg (Boss HP: ${newBossHp.toLocaleString('pl-PL')}/${sMaxHp.toLocaleString('pl-PL')})`, 'player');
        }

        // 2026-05 v6: Necromancer summons swing INDEPENDENTLY alongside
        // the necro's basic attack. Each summon gets its own staggered
        // setTimeout (~100 ms apart so the boss card flashes per-hit
        // instead of merging) and pushes a type-specific float
        // (skel :skull-and-crossbones: / ghost :ghost: / demon :smiling-face-with-horns: / lich :crown:). Display order
        // mirrors the avatar damage-soak order: skeleton first, lich
        // last. Summons don't double-consume mark_amp — only the
        // player's first hit does.
        if (character?.class === 'Necromancer') {
            const liveSummons = bots; // unused alias — reuse necroSummons map
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
                        let summonDmg = Math.max(1, summonRaw - Math.floor(sDef * 0.5));
                        // 2026-05 v7: summons consume Klątwa Śmierci (count
                        // mark) AND benefit from Kraina Śmierci (duration
                        // mark) the same as the player. Without this only
                        // the necro's own swing got the ×2/×6 multiplier
                        // and the summon hits looked weak by comparison.
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
                // 2026-05-14 spec ("jezeli stracilem poziom i nie moge
                // uzywac danego spella a wlaczone mam auto spelle to
                // one i tak sie uzywaja"): block auto-cast when the
                // player's level is below the skill's unlockLevel.
                // After a death penalty drops the character level, a
                // previously-slotted skill can be locked again; the
                // auto loop must refuse to fire it (matches the manual
                // path which greys out the slot).
                const liveCh = useCharacterStore.getState().character;
                const unlockLvl = getSkillDef(skillId)?.unlockLevel ?? 0;
                if (liveCh && unlockLvl > 0 && liveCh.level < unlockLvl) continue;
                // 2026-05 v7: Apokalipsa Śmierci — synchronous HP cost
                // BEFORE the cast resolves, so nothing downstream can
                // erase it. Auto path: skip when < 5% HP.
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
                // 2026-05 v6: honor pure-buff branch + skill.damage scaling.
                // Without `applyEffects` here the boss-fight auto-skill loop
                // would never push self-buffs like Orle Oko into the BuffBar.
                const sDef = getSkillDef(skillId);
                const skillBaseMult = sDef?.damage ?? 1;
                const isPureBuff = skillBaseMult === 0;
                // 2026-05 v7: capture `apply` so the auto-cast path
                // can run ALL side-effect consumers — previously the
                // result was discarded which dropped summon spawns,
                // revive_party, party_immortal anim, heal_party_pct,
                // heal_lowest_ally_pct, heal_self_*, mark_amp damage
                // amplification etc. User reported "Boss z auto-skill
                // nie summonuje szkieleta"; root cause = ignored apply.
                const apply = effectsCastSkill({
                    session: effectsRef.current,
                    casterId: PLAYER_FX_ID,
                    targetId: BOSS_FX_ID,
                    targetHpPct: scaledBossMaxHp > 0 ? (bossHpRef.current / scaledBossMaxHp) * 100 : 100,
                    effect: sDef?.effect ?? null,
                    allyIds: [PLAYER_FX_ID],
                    enemyIds: [BOSS_FX_ID],
                });
                // Skill-upgrade combat bonus — local player's own auto-cast
                // (this loop reads the local player's slots). Modest & capped.
                const skillUpgradeMultAuto = getCombatSkillUpgradeMultiplier(
                    useSkillStore.getState().skillUpgradeLevels[skillId] ?? 0,
                );
                // 2026-06: party-buff leak fix — auto-cast skill damage
                // also folds in the leader's own `party_attack_up` (live
                // read off the player's status, same as the manual path).
                const partyAtkMultAuto = 1 + getActivePartyAtkPct() / 100;
                let skillDmg = isPureBuff ? 0 : Math.max(1, Math.floor(charAtk * 0.15 * skillBaseMult * partyAtkMultAuto * getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier() * skillUpgradeMultAuto));
                // Necromancer Klątwa Śmierci — first hit on the marked
                // boss consumes the charge and gets ×N damage.
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
                setSkillCooldowns((prev) => ({ ...prev, [skillId]: SKILL_COOLDOWN_MS }));
                if (sDef) applySkillBuff(skillId, sDef, speedMult);
                triggerSkillAnim(skillId);
                if (isPureBuff) {
                    fx.triggerAllySkillAnim(0, skillId);
                    addLog(`:sparkles: ${formatSkillName(skillId)}: BUFF (-${SKILL_MP_COST} MP)`, 'player');
                } else {
                    fx.triggerEnemySkillAnim(0, skillId);
                    fx.pushEnemyFloat(0, skillDmg, 'spell', { icon: getSkillIcon(skillId) });
                    addLog(`:sparkles: ${formatSkillName(skillId)}: ${skillDmg} dmg (-${SKILL_MP_COST} MP)`, 'player');
                }
                // 2026-05-14 spec ("Lider uzywa spella a sojusznik nie
                // widzi tego, nie widzi ani animacji spella ze uzywa
                // lider"): broadcast leader's auto-skill cast so the
                // member fires the same themed overlay + spell float
                // on the boss card.
                // 2026-05-18 spec ("animacje buffow itp byly poprawnie
                // pokazywane"): pure-buff casts route to the CASTER
                // ally card via the special attackerId === targetId
                // pattern — receiver sees this as a self-target buff
                // cue and lights the leader's slot (index 0), instead
                // of overlaying the buff on the boss.
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
                    }).catch(() => { /* offline */ });
                }

                // -- Side-effect consumers (mirror of manual cast) ----
                // Necromancer summon spawn — Przywołaj Szkieleta /
                // Wskrześ Umarłych / Powstanie Apokalipsy / Przemiana
                // Lisza / Burza Dusz / Armia Ciemności.
                if (apply.summons.length > 0 && character?.class === 'Necromancer') {
                    for (const sm of apply.summons) {
                        const spawned = useNecroSummonStore.getState().spawn(
                            PLAYER_FX_ID, sm.type, sm.count, charAtk, charMaxHp, charMaxMp,
                        );
                        if (spawned > 0) {
                            fx.triggerAllySkillAnim(0, skillId);
                            // 2026-05 v7: per-type spawn anim (2s)
                            fx.triggerAllySummonSpawn(0, sm.type);
                            fx.pushAllyFloat(0, spawned, 'heal', {
                                icon: 'skull',
                                label: `+${spawned}× ${sm.type.toUpperCase()}`,
                            });
                            addLog(`:skull: ${formatSkillName(skillId)}: przywołano ${spawned}× ${sm.type}`, 'system');
                        }
                    }
                }
                // 2026-05 v7: Apokalipsa Śmierci — target damage only.
                // Self-cost handled at top of auto-skill loop.
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
                // heal_self_pct_dmg (Pochłonięcie Życia, Żniwa Dusz,
                // Promień Pustki, Uderzenie Święte) — heal caster for
                // pct% of damage dealt this cast.
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
                // heal_lowest_ally_pct — Cleric heal / holy_nova. Boss
                // is 1v1 so the player IS the lowest ally.
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
                // heal_party_pct (Niebiańskie Leczenie / Modlitwa
                // Niebios) — Boss is 1v1 so only player + summons.
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
                    // Summons share the heal (they're separate beings
                    // — party-pct treats them as distinct allies).
                    if (character?.class === 'Necromancer') {
                        useNecroSummonStore.getState().healAllPct(PLAYER_FX_ID, apply.healPartyPctInstant);
                    }
                }
                // revive_party — Aura Wskrzeszenia / Holy Apocalypse.
                // Boss has bots; revive them to 50% HP.
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
                // party_immortal — Wieża Bogów / Święta Apokalipsa.
                // Already applied to allyIds' immortalMs via cast;
                // here we just paint the IMMORTAL anim on each card.
                if (apply.partyImmortalMs > 0) {
                    fx.triggerAllySkillAnim(0, skillId);
                    fx.pushAllyFloat(0, 0, 'heal', { icon: 'sparkles', label: 'IMMORTAL' });
                }

                if (!isPureBuff && afterSkill <= 0) { handleBossDeath(); return; }
                break;
            }
        }

        // Auto-potion check
        tryAutoPotion();

        if (bossHpRef.current <= 0) {
            handleBossDeath();
        }
    }, [charAtk, addLog, showFloatingDmg, handleBossDeath, tryAutoPotion, character, fx]);

    // -- Boss attack callback -------------------------------------------------
    // -- Helper: deal damage to a bot target --------------------------------
    const dealDamageToBot = useCallback((botId: string, damage: number, bossName: string, kind: 'monster' | 'monster-spell' = 'monster', icon?: string): boolean => {
        const currentBots = botsRef.current;
        const bot = currentBots.find((b) => b.id === botId && b.alive);
        if (!bot) return false;
        // 2026-05 v6: per-bot v2 status — Knight party_defense_up gives
        // each bot a defBuffPct that should reduce incoming damage.
        // immortal zeros it entirely.
        const botStatus = effectsRef.current.statuses.get(botId);
        let scaledDamage = damage;
        if (botStatus && botStatus.immortalMs > 0) scaledDamage = 0;
        else if (botStatus && botStatus.defBuffMs > 0 && botStatus.defBuffPct > 0) {
            scaledDamage = Math.max(0, Math.floor(damage * (1 - botStatus.defBuffPct / 100)));
        }
        const newHp = Math.max(0, bot.hp - scaledDamage);
        updateBotHp(botId, newHp);
        // Per-bot hit pulse — increment so AllyCard's flash overlay re-mounts
        // and replays the CSS animation on EVERY hit this bot takes.
        setBotHitPulses((prev) => ({ ...prev, [botId]: (prev[botId] ?? 0) + 1 }));
        // Floating monster-attack damage on the bot's ally slot. Bot index in
        // `botsRef.current` corresponds to display slot (1..3 — player is 0).
        // findIndex on `botsRef.current` not `currentBots` because the local
        // copy already filtered? No — `currentBots` IS `botsRef.current` by
        // assignment above. So index alignment matches the JSX render order.
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

    // -- Necro summon damage routing -----------------------------------------
    // Front-of-queue summon takes single-target hits before the necro does.
    // For AOE hits, every summon takes the full splash (necro still takes
    // their own hit normally — caller handles that).
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

    // -- Utamo Vita helper for boss damage to player ------------------------
    const applyUtamoDamageToPlayer = useCallback((rawDmg: number): { newPHp: number; hpDmg: number; mpDmg: number; shieldActive: boolean } => {
        // 2026-05 v6: immortal (Knight Absolutne Cięcie) zeroes incoming
        // damage entirely. defBuffPct (Umocnienie / Żelazna Obrona) scales
        // it down by a percent. Both come from the player v2 status.
        const ps = effectsRef.current.statuses.get(PLAYER_FX_ID);
        if (ps && ps.immortalMs > 0) {
            // BLOCK label on player slot so the immortal window is visible.
            fx.pushAllyFloat(0, 0, 'heal', { icon: 'sparkles', label: 'BLOCK' });
            addLog(`:sparkles: BLOCK! Niewrażliwość chroni przed atakiem`, 'block');
            return { newPHp: playerHpRef.current, hpDmg: 0, mpDmg: 0, shieldActive: false };
        }
        if (ps && ps.defBuffMs > 0 && ps.defBuffPct > 0) {
            // %def reduces incoming damage proportionally (a 30% def buff
            // chops the boss hit by 30%).
            rawDmg = Math.max(0, Math.floor(rawDmg * (1 - ps.defBuffPct / 100)));
        }
        let hpDmg = rawDmg;
        let mpDmg = 0;
        // 2026-05 v6: Mage Tarcza Many — 100% MP-first redirect runs
        // BEFORE Utamo Vita's 50% split, so both can stack on a high-MP
        // mage and shield the entire hit.
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
                // Blue MP float on the player slot so it's visible.
                fx.pushAllyFloat(0, ms, 'spell', { icon: 'shield' });
            }
        }
        const hasUtamo = useBuffStore.getState().hasBuff('utamo_vita');
        if (hasUtamo && playerMpRef.current > 0 && hpDmg > 0) {
            // Utamo Vita splits whatever HP damage remains AFTER Tarcza
            // Many — 50% MP, 50% HP. Adds to mpDmg without resetting it.
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
        // 2026-05-14 spec ("bije mnie potwor mimo ze nei zyje, nie moze
        // nigdy niezywych bic potwor, ani lapac na niezywych agroo"):
        // hard gate at the top of every boss swing. If nobody is alive
        // on our side, bail entirely — the wipe-detect useEffect will
        // close out the fight via handlePlayerDeath(true). If aggro
        // currently points at a corpse, redirect FIRST so the swing
        // lands on someone real.
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
        // Stun gate — boss cannot swing while stunned/paralysed.
        if (isCombatantStunned(effectsRef.current, BOSS_FX_ID)) return;
        // 2026-05 v6: Krok Cienia / Unik — charge buff. Each enemy hit
        // burns one charge and skips this swing entirely. Boss is a
        // physical attacker (non-magical) so the non_magic scope matches.
        if (useBuffStore.getState().getBuffCharges('skill_charge_dodge_next') > 0) {
            useBuffStore.getState().consumeBuffCharge('skill_charge_dodge_next');
            addLog(`Boss atakuje – Krok Cienia! Unik!`, 'dodge');
            return;
        }
        // 2026-05 v6: Cleric Boska Tarcza — block_next_party charge.
        // Stacks up to 2; each boss swing consumes 1 charge and eats
        // the entire hit (BLOCK float). Same fall-through as dodge.
        if (useBuffStore.getState().getBuffCharges('skill_charge_block_next_party') > 0) {
            useBuffStore.getState().consumeBuffCharge('skill_charge_block_next_party');
            fx.pushAllyFloat(0, 0, 'heal', { icon: 'shield', label: 'BLOCK' });
            addLog(`:shield: Boska Tarcza! Blok!`, 'system');
            return;
        }
        // 2026-05 v6: Rogue Bomba Dymna (dodge_buff:50:4000) — % chance
        // to fully dodge each incoming basic during the buff window.
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

        // -- AOE attack every 5th turn (50% damage to all) --------------------
        if (isBossAoeTurn(bossTurnCounterRef.current)) {
            addLog(`:collision: ${boss.name_pl} wykonuje ATAK OBSZAROWY!`, 'boss-spell');

            // Damage player (with Utamo Vita). For necro, AOE also splashes
            // every live summon in parallel — the necro still takes their hit.
            const aoeDmgPlayer = calculateAoeDamage(Math.floor(sAtk * phaseMult), charDef);
            if (character?.class === 'Necromancer' && useNecroSummonStore.getState().count(PLAYER_FX_ID) > 0) {
                useNecroSummonStore.getState().damageAll(PLAYER_FX_ID, aoeDmgPlayer);
            }
            const aoeResult = applyUtamoDamageToPlayer(aoeDmgPlayer);
            setPlayerHitPulse((p) => p + 1);
            showFloatingDmg(`-${aoeDmgPlayer} AOE${aoeResult.shieldActive ? 'blue-circle' : ''}`, 'monster');
            // Floating monster-AOE float on the player ally slot. AOE is
            // categorically magical (boss spells), so 'monster-spell' kind
            // gives it the dark-red halo to read as a magical hit. The :collision:
            // glyph mirrors the addLog suffix.
            fx.pushAllyFloat(0, aoeDmgPlayer, 'monster-spell', { icon: 'collision' });
            // 2026-05-14 spec ("nie widze jak przeciwnik atakuje np
            // spellami aoe to nie widze za ile dostaje dmg od niego"):
            // broadcast the AOE float to the member so their own card
            // shows the damage number too. Member's subscriber maps
            // targetId='player' onto the leader-bot slot in their view.
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
                        // 2026-05-14: omit label — overlay renders label IN
                        // PLACE of the damage number, so "AOE" hid the real
                        // value on member's screen. Match the per-bot AOE
                        // broadcast below.
                    });
                }).catch(() => { /* offline */ });
            }
            const aoeSuffix = aoeResult.shieldActive ? ` :blue-circle: (${aoeResult.hpDmg} HP / ${aoeResult.mpDmg} MP)` : '';
            addLog(`  Ty: -${aoeDmgPlayer} dmg${aoeSuffix} (HP: ${aoeResult.newPHp}/${charMaxHp})`, 'monster');

            // Damage all alive bots — each gets its own pulse increment so
            // every ally flashes independently from the AOE blast.
            const currentBots = botsRef.current;
            for (let bIdx = 0; bIdx < currentBots.length; bIdx++) {
                const bot = currentBots[bIdx];
                if (!bot.alive) continue;
                const aoeDmgBot = calculateAoeDamage(Math.floor(sAtk * phaseMult), bot.defense);
                const newBotHp = Math.max(0, bot.hp - aoeDmgBot);
                updateBotHp(bot.id, newBotHp);
                setBotHitPulses((prev) => ({ ...prev, [bot.id]: (prev[bot.id] ?? 0) + 1 }));
                // AOE on bot — same magical 'monster-spell' kind. Bot's
                // ally slot is `bIdx + 1` (player occupies slot 0).
                fx.pushAllyFloat(bIdx + 1, aoeDmgBot, 'monster-spell', { icon: 'collision' });
                // 2026-05-14: broadcast per-bot AOE so the targeted
                // member's own slot (or other bots') shows the float.
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
                            // 2026-05-14: omit `label` — the float overlay
                            // uses label IN PLACE of the damage number, so
                            // setting label: 'AOE' made the member see
                            // ":collision: AOE" instead of ":collision: 1234". Let the float
                            // render the damage value with the bomb icon.
                        });
                    }).catch(() => { /* offline */ });
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

        // -- Aggro switch check (time-based, every 10s wall-clock) ------------
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

                // 2026-05-14: broadcast boss-spell damage so members
                // see the icon + float for boss spells on their view.
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
                        }).catch(() => { /* offline */ });
                    }
                    addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name} na Ciebie: ${spellDmg} dmg! (HP: ${newPHp}/${charMaxHp})`, 'boss-spell');
                    if (newPHp <= 0) { handlePlayerDeath(); return; }
                    tryAutoPotion();
                } else {
                    const bot = botsRef.current.find((b) => b.id === target && b.alive);
                    if (bot) {
                        const newBotHp = Math.max(0, bot.hp - spellDmg);
                        updateBotHp(target, newBotHp);
                        // Per-bot pulse + spell float on this bot's slot.
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
                            }).catch(() => { /* offline */ });
                        }
                        const icon = getBotLogIcon(bot.class);
                        if (newBotHp <= 0) {
                            killBot(target);
                            addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name} na ${icon} ${bot.name}: ${spellDmg} dmg! POLEGŁ!`, 'boss-spell');
                        } else {
                            addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name} na ${icon} ${bot.name}: ${spellDmg} dmg! (HP: ${newBotHp}/${bot.maxHp})`, 'boss-spell');
                        }
                    } else {
                        // Bot target died, redirect to player
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
                // 2026-05 v6: route the heal through applyIncomingHeal
                // so the boss's status (Rogue Naznaczony na Śmierć's
                // markNoHealMs / mark_heal_to_dmg) reverses the heal
                // into damage. Without this the boss would always
                // self-heal at full strength even when marked.
                const bossSt = ensureStatus(effectsRef.current, BOSS_FX_ID);
                const hr = applyIncomingHeal(bossSt, healAmount);
                if (hr.hpDelta < 0) {
                    // Mark active -> heal flips to damage of equal size.
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
                    // Boss self-heal float on the boss card. We borrow `pushEnemyFloat`
                    // with kind 'heal' (green) since the float palette has the same
                    // visual semantics regardless of which side the heal lands on.
                    fx.pushEnemyFloat(0, hr.hpDelta, 'heal', { icon: spell.icon });
                    addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name}: leczy się za ${hr.hpDelta.toLocaleString('pl-PL')} HP!`, 'boss-spell');
                }
            } else if (spell.type === 'buff') {
                addLog(`${boss.name_pl} rzuca ${spell.icon} ${spell.name}: wzmacnia się!`, 'boss-spell');
            }
            return;
        }

        // -- Normal boss attack (targeted via aggro) --------------------------
        // 2026-05-14: if aggro is on a dead-but-waiting leader (multi-
        // human party), switch to a random alive bot so the fight
        // continues to deal damage somewhere instead of pummelling
        // a corpse for no effect.
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
        const finalDmg = Math.max(1, Math.floor((rolled - targetDef) * phaseMult));
        const enragedText = phaseMult > 1 ? ' \uD83D\uDD25' : '';

        if (target === 'player') {
            const playerDmg = routeIncomingNecroDmg(finalDmg, 'single');
            const newPHp = Math.max(0, playerHpRef.current - playerDmg);
            playerHpRef.current = newPHp;
            setPlayerHp(newPHp);
            setPlayerHitPulse((p) => p + 1);
            showFloatingDmg(`-${finalDmg}`, 'monster');
            // Plain physical boss swing on the player -> 'monster' kind (red).
            fx.pushAllyFloat(0, finalDmg, 'monster');
            // 2026-05-14: broadcast so member's view shows the float
            // even when the boss is hitting the leader (the member's
            // own ally card flashes via HP-delta already, but the
            // numeric float only renders via the explicit event).
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
                }).catch(() => { /* offline */ });
            }
            addLog(`${boss.name_pl} atakuje Cię za ${finalDmg} dmg${enragedText} (HP: ${newPHp}/${charMaxHp})`, 'monster');
            if (newPHp > 0) { tryAutoPotion(); }
            if (newPHp <= 0) { handlePlayerDeath(); }
        } else {
            const bot = botsRef.current.find((b) => b.id === target && b.alive);
            if (bot) {
                // dealDamageToBot internally calls fx.pushAllyFloat, so the
                // bot's own card lights up. Default kind is 'monster'.
                dealDamageToBot(bot.id, finalDmg, boss.name_pl + enragedText);
                // 2026-05-14: broadcast so the targeted member's
                // own slot pulses + shows the float.
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
                    }).catch(() => { /* offline */ });
                }
            } else {
                // Fallback to player
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

    // -- Bot attack callback --------------------------------------------------
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

            // 2026-05-14 spec ("w party kazdy sojusznik moze sam
            // decydowac czy uzywa auto spelli czy nie"): if this bot
            // slot represents a HUMAN party-mate, respect their own
            // skillMode (broadcast via partyPresence). When they
            // toggle auto-skills off on their client, this bot stops
            // auto-casting on the leader's engine. AI bots default to
            // 'auto' as before.
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

            // 2026-05-17: pop any manual-cast request the member sent
            // from their client. When present, override the bot's
            // preset `skillId` + multipliers with the requested skill's
            // values from skills.json so the leader's engine casts THAT
            // skill (matching the member's slot click). The cooldown
            // gate is bypassed — the member's local CD already gated
            // the click on their side.
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
            // Force-allow the skill path when a manual override is
            // present (bypass auto/CD gates — member already gated on
            // their side).
            const canUseSkillFinal = manualOverrideSkillId
                ? botForAction.mp >= botForAction.skillMpCost
                : canUseSkill;
            const action = calculateBotAction(botForAction, bossForCalc, canUseSkillFinal);
            const icon = getBotLogIcon(bot.class);

            const newBossHp = Math.max(0, bossHpRef.current - action.damage);
            bossHpRef.current = newBossHp;
            setBossHp(newBossHp);

            // 2026-05-14: figure out which human (if any) this bot
            // represents so we can credit them in the party-damage
            // tally + broadcast tags. Bots are generated in the same
            // order as `party.members.filter(m => m.id !== leader.id)`,
            // so bot[idx] maps to humanPartyMates[idx].
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
                // Per-slot themed overlay + ally-spell float on the boss
                // card. Uses the bot's actual skillId so the visual matches
                // (e.g. Mage cast -> fire halo).
                fx.triggerEnemySkillAnim(0, botForAction.skillId);
                fx.pushEnemyFloat(0, action.damage, 'ally-spell', { icon: getSkillIcon(botForAction.skillId) });
                // Tally for party widget.
                void import('../../stores/partyDamageStore').then(({ usePartyDamageStore }) => {
                    usePartyDamageStore.getState().addDamage(dmgAttributedTo, action.damage);
                }).catch(() => { /* offline */ });
                // 2026-05-14: mirror to members — include skillId so
                // member also fires `triggerEnemySkillAnim` for the
                // themed overlay.
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
                    }).catch(() => { /* offline */ });
                }
            } else {
                addLog(`${icon} ${bot.name} atakuje za ${action.damage} dmg (Boss HP: ${newBossHp.toLocaleString('pl-PL')})`, 'player');
                // Ally basic float (cyan) so the player can tell their bots'
                // hits apart from their own white-hued basic damage.
                fx.pushEnemyFloat(0, action.damage, 'ally-basic');
                // Tally for party widget.
                void import('../../stores/partyDamageStore').then(({ usePartyDamageStore }) => {
                    usePartyDamageStore.getState().addDamage(dmgAttributedTo, action.damage);
                }).catch(() => { /* offline */ });
                // 2026-05-14: mirror to members.
                if (isLeaderInPartyCombat) {
                    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                        usePartyCombatSyncStore.getState().publishBossDamage({
                            attackerId: bot.id,
                            attackerClass: bot.class,
                            targetId: 'boss',
                            damage: action.damage,
                            kind: 'ally-basic',
                        });
                    }).catch(() => { /* offline */ });
                }
            }

            // Trigger the class-specific attack animation on the boss card so
            // the player sees their party members swinging in, not just log text.
            const animMs = ATTACK_ANIM_DURATION[bot.class] ?? 320;
            setBotAttackingClass(bot.class);
            setMonsterHitPulse((p) => p + 1);
            window.setTimeout(() => setBotAttackingClass((c) => c === bot.class ? null : c), animMs);

            // (Floating-number visuals removed — see showFloatingDmg comment.)

            if (newBossHp <= 0) {
                handleBossDeath();
                return;
            }
        }
    }, [addLog, handleBossDeath, updateBotMp, fx]);

    // 2026-05-14 spec ("kliknalem ze chce zostac, wszyscy zgineli i
    // walka trwa dalej"): wipe detection runs WHENEVER the player is
    // dead AND every bot is dead — works for BOTH leader and member
    // because:
    //   - Leader's local bots reflect their own combat tick
    //   - Member's local bots are MIRRORED from the leader's allies
    //     broadcast, so once the leader sees everyone dead the
    //     broadcast lands on member with the same all-dead state
    // We accept BOTH `phase === 'fighting'` and `phase === 'result'`
    // so that members whose phase already flipped to 'result' (via
    // the leader's broadcast) still get the death overlay + nav home.
    // Also call leaveParty so the dying member is removed and — when
    // they're the last surviving party row — the party dissolves
    // naturally on the server.
    const wipeForcedRef = useRef(false);
    useEffect(() => {
        if (wipeForcedRef.current) return;
        if (phase !== 'fighting' && phase !== 'result') return;
        const playerAliveNow = playerHp > 0;
        const anyBotAliveNow = bots.some((b) => b.alive);
        if (!playerAliveNow && !anyBotAliveNow) {
            wipeForcedRef.current = true;
            setDeathChoicePopup(false);
            // 2026-05-14: clean up party row + leave so the wipe
            // doesn't leave a ghost party with all-corpse members.
            // Fire-and-forget so the death overlay can run on top.
            void (async () => {
                try {
                    const me = useCharacterStore.getState().character?.id;
                    if (me) await usePartyStore.getState().leaveParty(me);
                } catch { /* best effort */ }
            })();
            handlePlayerDeath(true);
        }
    }, [phase, playerHp, bots, handlePlayerDeath]);

    // 2026-05-14 spec ("Jak zginal sojusznik i wrocil do miasta to nie
    // zniknal z walki a powinien od razu zniknac z widoku walki i na
    // nowo powinno sie agroo potworow wyrenderowac na reszcie
    // uczestnikow party"): leader-side roster sync. When a human
    // party-mate leaves the party mid-fight (e.g. via the death-popup
    // "Wróć do miasta" path), drop the bot slot that represented them
    // from the local botStore so their ghost card disappears from the
    // arena. Also redirect any aggro currently targeting that bot to
    // a live ally so the boss doesn't keep swinging at an empty
    // slot. Members see the change via the next boss-state broadcast.
    useEffect(() => {
        if (phaseRef.current !== 'fighting') return;
        if (!party || !character) return;
        // 2026-05-14 bug fix: previously gated on `isLeaderInPartyCombat`,
        // which evaluates `isMultiHumanParty && leaderId === me`. The
        // moment the LAST other human leaves, isMultiHuman flips false
        // and the effect bailed BEFORE removing their bot slot — the
        // ghost ally card sat on the arena indefinitely. Gate only on
        // "we're the leader" so every party shrink runs cleanup.
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
        // Redirect aggro if it landed on one of the departed slots.
        if (departedBotIds.includes(aggroTargetRef.current)) {
            const aliveSurvivors = survivors.filter((b) => b.alive);
            if (aliveSurvivors.length > 0) {
                aggroTargetRef.current = aliveSurvivors[
                    Math.floor(Math.random() * aliveSurvivors.length)
                ].id;
            } else {
                aggroTargetRef.current = 'player';
            }
            // Reset the aggro switch timer so the next pick honours the
            // fresh roster (otherwise the 10 s wall-clock cooldown could
            // pin aggro to the random survivor for another full cycle).
            aggroSwitchAtRef.current = Date.now();
        }
        // 2026-05-15 spec ("animacje ataku potworow zle sie pokzuja
        // nie w tym miejscu co powinny a czasami na kafelku co jest
        // pusty"): same slot-index drift bug raid has — when a bot
        // slot disappears, the surviving slots shift down and pending
        // allyFloats keyed by the old indices land on the wrong (or
        // empty) tiles. Drop all ally-side fx so the next swing lands
        // on the fresh layout.
        fx.resetAllyFx();
    }, [party, character?.id, fx]);

    // -- Refs for stable intervals --------------------------------------------
    const playerAtkRef = useRef(doPlayerAttack);
    const bossAtkRef   = useRef(doBossAttack);
    const botAtkRef    = useRef(doBotAttacks);
    useEffect(() => { playerAtkRef.current = doPlayerAttack; });
    useEffect(() => { bossAtkRef.current   = doBossAttack; });
    useEffect(() => { botAtkRef.current    = doBotAttacks; });
    // 2026-06: party-buff leak fix — the player attack loop reads the
    // LATEST base charSpeed live each tick (charSpeed is recomputed every
    // render but the self-rescheduling timeout closure below would
    // otherwise capture a stale value), then multiplies by the active
    // `party_as_up` mult so the leader swings faster while it's up.
    const charSpeedRef = useRef(charSpeed);
    charSpeedRef.current = charSpeed;

    // -- Party-shared boss combat (2026-05-13) --------------------------------
    // Leader-side: publish authoritative boss-state on every meaningful
    // change. The store throttles non-phase updates to ~120 ms; phase
    // transitions go through immediately so the member's result popup
    // opens together with the leader's.
    useEffect(() => {
        if (!isLeaderInPartyCombat) return;
        if (!activeBoss) return;
        // Only meaningful boss-fight phases are broadcast. The list
        // screen has no shared boss to mirror, so we skip — and the
        // separate `combat-end` broadcast already pulls members back
        // when the leader leaves the fight (see prevBossPhaseRef block).
        if (phase === 'list') return;

        // 2026-05-13 spec ("Lider i sojusznik maja widziec to samo
        // podczas walki z bossem"): build the authoritative ally
        // roster. Slot 0 = leader's own card. Bot slots 1..N tag
        // human party-mates via representsCharacterId so members
        // can find themselves and render the rest as allies.
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
                // 2026-05-14: broadcast `bot.{hp,maxHp,...}` directly.
                // The bot's pool was already anchored to the member's
                // real character pool at fight-start (presence override
                // in `beginBossFight`), so these values track the
                // member's real HP scale and damage flows correctly
                // through the boss-state subscriber's HP-sync.
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
            // 2026-05-14: ship the party-damage tally so members'
            // floating widget shows the same Σ dmg the leader sees.
            import('../../stores/partyDamageStore').then(({ usePartyDamageStore }) => {
                usePartyCombatSyncStore.getState().publishBossState({
                    bossId: activeBoss.id,
                    bossHp,
                    scaledBossMaxHp,
                    phase,
                    won: phase === 'result' ? !!result?.won : undefined,
                    // 2026-05-13: ship leader's computed xp / gold for the kill
                    // so members credit their own pools with identical values
                    // (same XP-per-kill across the party, mirrors hunt).
                    earnedXp: phase === 'result' && result?.won ? result.xp : undefined,
                    earnedGold: phase === 'result' && result?.won ? result.gold : undefined,
                    allies,
                    // 2026-05-14: current aggro target so both screens
                    // highlight the same card.
                    aggroTargetId: aggroTargetRef.current ?? undefined,
                    partyDamage: { ...usePartyDamageStore.getState().damage },
                    // 2026-05-14 spec ("po wejsciu do walki ma
                    // pokazywac zawsze predkosc jaka ustawil lider"):
                    // ride speed on every snapshot so members converge
                    // even if they joined after the last combat-speed
                    // broadcast.
                    speedMode,
                });
            }).catch(() => { /* offline */ });
        }).catch(() => { /* offline */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // 2026-05-14: include `bots` in the deps so any change to an ally's
    // HP / alive state (boss attacking a bot, bot taking AOE) re-fires
    // the broadcast. Without this, member views froze on ally HP between
    // bossHp / playerHp changes. publishBossState is internally
    // throttled to ~120 ms so this can't drown the channel.
    // 2026-05-14: also include `speedMode` so a leader speed change
    // re-publishes immediately — the throttle is bypassed for phase
    // changes; for speed we just want the next snapshot to carry it
    // (members converge within one tick).
    }, [isLeaderInPartyCombat, activeBoss, bossHp, scaledBossMaxHp, phase, result, playerHp, playerMp, bots, speedMode]);

    // 2026-05-14: member-side listener for leader's boss-killed
    // broadcast. Each kill that includes us in `aliveMemberIds` bumps
    // our local bossStore.dailyAttempts so leaving party doesn't reset
    // our attempt count. Guarded by `sentAt` so the same kill isn't
    // counted twice if the broadcast re-arrives.
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

    // 2026-05-14: member-side listener for leader's damage events.
    // Replays floats + attack-class swing pulse on the local arena so
    // the member's view animates in sync with the leader's tick.
    //
    // 2026-05-14 spec ("Masz polowanie tam dziala wszystko poprawnie
    // zobacz sobie jak tam jest zrobione"): mirrors hunt's
    // `lastDamageByAttacker` map iteration. Each (attackerId, targetId)
    // pair has its own slot in the map, so AOE blasts that publish 4+
    // events in the same microtask all survive and replay (single-field
    // mirroring only kept the last one — hence the member previously
    // saw at most one AOE float).
    //
    // Dedupe is per-key REFERENCE — same-ms events still get unique
    // object refs from each `set(...)`, so we never silent-drop.
    const lastBossDamageSeenRef = useRef<Record<string, unknown>>({});
    useEffect(() => {
        if (!isNonLeaderMember) return;
        const unsub = (async () => {
            const { usePartyCombatSyncStore } = await import('../../stores/partyCombatSyncStore');
            // Seed from current map so the first delta-pass after mount
            // doesn't replay already-rendered events.
            const initial = usePartyCombatSyncStore.getState().lastBossDamageByAttacker;
            for (const [k, v] of Object.entries(initial)) {
                lastBossDamageSeenRef.current[k] = v;
            }
            return usePartyCombatSyncStore.subscribe((state) => {
                const map = state.lastBossDamageByAttacker;
                if (!map) return;
                for (const [key, ev] of Object.entries(map)) {
                    // Reference dedupe per-key — every new publish makes
                    // a fresh object, so the !== check catches every
                    // new event, even ones with the same sentAt.
                    if (ev === lastBossDamageSeenRef.current[key]) continue;
                    lastBossDamageSeenRef.current[key] = ev;

                    // 2026-05-18 spec ("sokole oko nie powinno pokazywac
                    // sie na potworze"): self-target buff cue from an
                    // ally (attackerId === targetId, both = a member id
                    // or 'player' for the leader). Route to the caster's
                    // ally slot — leader (broadcaster) lands on slot 0,
                    // other party-mate bots land on (botIdx + 1). Skips
                    // the boss-overlay branch entirely so Orle Oko /
                    // Tarcza Many / Krok Cienia don't flash on the boss.
                    if (ev.attackerId !== 'boss' && ev.attackerId === ev.targetId) {
                        const localBotsForBuff = useBotStore.getState().bots;
                        let buffSlot = 0;
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
                    // Ally hits the boss -> enemy float on slot 0 of the
                    // arena + bot-attacking-class flash (drives the same
                    // swing animation the leader sees).
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
                        // 2026-05-14: spell cast -> fire the themed enemy
                        // skill animation overlay so the member sees the
                        // same fire halo / arrow trail / etc.
                        if (ev.skillId) {
                            fx.triggerEnemySkillAnim(0, ev.skillId);
                        }
                    }
                    // Boss hits an ally -> push float on the right fx slot.
                    //
                    // CRITICAL fix (2026-05-14): the useCombatFx slot index
                    // is INDEPENDENT of the uiAllies reorder. The arena
                    // cards bind:
                    //   - selfCard -> fx.allyFloats[0]   (always slot 0,
                    //                                    regardless of
                    //                                    visual position)
                    //   - botCards[i] -> fx.allyFloats[i + 1]
                    // So:
                    //   - Boss hit the LEADER -> find leader bot in local
                    //     mirror, push at (leaderIdx + 1).
                    //   - Boss hit OUR character (no bot match in mirror,
                    //     because we're filtered out) -> push at slot 0
                    //     (self).
                    //   - Boss hit any other bot -> push at (botIdx + 1).
                    if (ev.attackerId === 'boss') {
                        const localBotsForFx = useBotStore.getState().bots;
                        let fxSlot = 0;
                        if (ev.targetId === 'player') {
                            const leaderIdx = localBotsForFx.findIndex((b) => b.isLeader);
                            fxSlot = leaderIdx >= 0 ? leaderIdx + 1 : 0;
                        } else {
                            const botIdx = localBotsForFx.findIndex((b) => b.id === ev.targetId);
                            if (botIdx === -1) {
                                // Member's own slot (filtered from mirror).
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

    // 2026-05-13: member-side listener for leader's skip-entry broadcast.
    // Bumps the local `lastBossEntrySkipAt` (set by the channel handler in
    // partyCombatSyncStore) and we fire the same local fast-forward logic
    // that skipBossEntry does — bypass the isNonLeaderMember guard by
    // calling the steps inline (the guard is meant for human clicks).
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

    // Member-side: subscribe to leader's authoritative boss-state and
    // mirror it locally. We set phase + activeBoss + bossHp directly so
    // every render reflects the leader's view. Member's own tick loops
    // are suppressed below (early-return on isNonLeaderMember).
    const memberResultAppliedRef = useRef(false);
    // 2026-05-17 spec ("to sie tyczy kazdej walki w party"): one-shot
    // latch for the death-without-resurrection result handler. When
    // we hit the result phase still in deathChoicePopup (chose Czekaj
    // but nobody revived us) we apply the standard death penalty +
    // open the death overlay so the player sees the same dying flow
    // they'd get if they died and clicked "Wróć do miasta".
    const resultDeathAppliedRef = useRef(false);
    useEffect(() => {
        if (!isNonLeaderMember) return;
        // Reset the one-shot reward guard whenever the subscription
        // (re-)mounts — a new fight should re-arm it.
        memberResultAppliedRef.current = false;
        const unsub = (async () => {
            const { usePartyCombatSyncStore } = await import('../../stores/partyCombatSyncStore');
            return usePartyCombatSyncStore.subscribe((state, prev) => {
                const s = state.lastBossState;
                if (!s) return;
                if (prev.lastBossState && prev.lastBossState.seq === s.seq) return;
                // 2026-05-13 spec ("Po skonczonej ponownej walce mam
                // pusty ekran jako sojusznik"): rearm the result guard
                // when phase transitions back into combat for a NEW
                // fight (retry). Without this, the second fight's
                // result broadcast hits a still-true guard and the
                // member never sets their local result panel.
                const prevPhase = prev.lastBossState?.phase;
                if (prevPhase === 'result' && s.phase !== 'result') {
                    memberResultAppliedRef.current = false;
                }
                // Look up the boss def by id so sprite / stats render.
                const def = (bossData as Array<{ id: string }>).find((b) => b.id === s.bossId);
                if (def) {
                    setActiveBoss(def as IBoss);
                    activeBossRef.current = def as IBoss;
                }
                // 2026-05-14 spec ("knight nie widzi zadnych animacji ani
                // spelli ani atakow"): bump the monster-hit pulse when the
                // boss's HP drops between broadcasts so the member's enemy
                // card flashes the same way the leader's does. This is a
                // cheap visual proxy for full attack-event sync — a real
                // damage-event channel would be needed to mirror crits /
                // floating numbers, but the pulse already kills the "frozen
                // arena" feeling on the member side.
                if (prev.lastBossState && s.bossHp < prev.lastBossState.bossHp) {
                    setMonsterHitPulse((n) => n + 1);
                }
                setBossHp(s.bossHp);
                bossHpRef.current = s.bossHp;
                setScaledBossMaxHp(s.scaledBossMaxHp);
                setPhase(s.phase);
                phaseRef.current = s.phase;

                // 2026-05-14 spec ("Dalej kazdy widzi predkosc inna,
                // po wejsciu do walki ma pokazywac zawsze predkosc
                // jaka ustawil lider"): authoritative speed from
                // leader's snapshot — every tick reasserts it so a
                // late-joining member converges within one ~120 ms
                // beat instead of waiting for the leader to click
                // the speed button again. Local cycleSpeed is gated
                // on isNonLeaderMember so this can't fight with a
                // user action.
                if (s.speedMode && (s.speedMode === 'x1' || s.speedMode === 'x2' || s.speedMode === 'x4')) {
                    setSpeedMode(s.speedMode);
                }

                // 2026-05-14: mirror aggro so both screens highlight
                // the same card. Translate 'player' (leader) and any
                // bot.id whose `representsCharacterId` matches our own
                // character.id into a member-relative target.
                if (s.aggroTargetId !== undefined) {
                    const meIdForAggro = useCharacterStore.getState().character?.id;
                    // The aggro id is the LEADER's view: 'player' = leader,
                    // bot.id = some slot. On the member side, we set our
                    // aggroTargetRef to the same value so the renderer
                    // picks up the slot via the same equality checks
                    // (botCards iterate by bot.id; if leader's player
                    // matches the bot tagged as isLeader, that's slot 0
                    // of reordered uiAllies; otherwise it's the bot's
                    // own slot). When the target represents OUR
                    // character (boss attacking us), we map to 'player'
                    // so our self card highlights.
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

                // 2026-05-13 spec ("znowu byl martwy"): when transitioning
                // INTO a fight from list/result and beginBossFight hasn't
                // run yet (its setTimeout fires after the entry animation,
                // ~1.8 s later), the in-fight player card would render
                // with playerHp=0 -> isDead=true (greyed). Push our own
                // HP/MP from the character store immediately so the card
                // shows alive from frame 1 of the arena render. Heal a
                // corpse first to match the entry replicator's behaviour.
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

                // 2026-05-13 spec ("Lider i sojusznik maja widziec to
                // samo"): mirror the leader's ally roster onto the
                // member's local botStore. We skip the slot whose
                // representsCharacterId matches our own id (that's us
                // — we render at slot 0 from our own character store).
                // The leader's own player card becomes a bot slot in
                // our view (so we see them as ally).
                // 2026-05-14 spec ("nie zlicza sie suma zadanego DMG"):
                // apply leader's authoritative party-damage tally
                // verbatim so the floating widget renders the same Σ
                // each member sees.
                if (s.partyDamage) {
                    void import('../../stores/partyDamageStore').then(({ usePartyDamageStore }) => {
                        const dmgState = usePartyDamageStore.getState();
                        for (const [memberId, total] of Object.entries(s.partyDamage!)) {
                            dmgState.setMemberDamage(memberId, total);
                        }
                    }).catch(() => { /* offline */ });
                }

                if (s.allies && s.allies.length > 0) {
                    const meId = useCharacterStore.getState().character?.id ?? '';
                    // 2026-05-15 spec ("Jezeli ktos wyjdzie z party
                    // podczas raidu ... animacje ataku potworow zle
                    // sie pokzuja nie w tym miejscu co powinny a
                    // czasami na kafelku co jest pusty") + 2026-05-15
                    // v2 ("Ta ikonka powinna byc na knightcie. ...
                    // animacja ataku spelli potworow tez powinna
                    // zmienic pozycje jezeli atakuja knighta"): wipe
                    // ally fx whenever the ally-ID SIGNATURE changes
                    // (someone left OR roster reordered after leader
                    // hand-off). Length-only check missed reorders
                    // where length stays equal but Knight shifted
                    // slot index, leaving stale fx ghosting onto the
                    // now-empty top-right tile.
                    const prevSig = (prev.lastBossState?.allies ?? [])
                        .map((a) => a.representsCharacterId ?? a.id)
                        .join(',');
                    const nextSig = s.allies
                        .map((a) => a.representsCharacterId ?? a.id)
                        .join(',');
                    if (prevSig && prevSig !== nextSig) {
                        fx.resetAllyFx();
                    }

                    // 2026-05-14 spec ("Sojusznikowi nie ucieka pasek HP
                    // i MP zawiesil sie"): the leader's allies snapshot
                    // includes the member's own bot slot with the
                    // authoritative HP/MP (after damage on the leader's
                    // tick). Sync it back into the local playerHp/playerMp
                    // + characterStore so the member's card + TopHeader
                    // bars match what the leader sees.
                    const meAlly = s.allies.find((a) => a.representsCharacterId === meId);
                    if (meAlly) {
                        // Pulse when our HP drops between broadcasts —
                        // visual feedback for boss attacks that landed on
                        // us during the leader's tick.
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
                        // 2026-05-14: trigger the death-decision popup
                        // when the broadcast drops our HP to 0. The
                        // one-shot latch + useEffect-on-hp>0 auto-close
                        // handles revives the same way as on the leader.
                        if (meAlly.hp <= 0 && !deathChoiceShownRef.current) {
                            deathChoiceShownRef.current = true;
                            setDeathChoicePopup(true);
                        }
                        if (meAlly.mp !== playerMpRef.current) {
                            setPlayerMp(meAlly.mp);
                            playerMpRef.current = meAlly.mp;
                        }
                        // Mirror into character store so the global
                        // TopHeader avatar bars update in real time.
                        const liveCh = useCharacterStore.getState().character;
                        if (liveCh && (liveCh.hp !== meAlly.hp || liveCh.mp !== meAlly.mp)) {
                            useCharacterStore.getState().updateCharacter({
                                hp: meAlly.hp,
                                mp: meAlly.mp,
                            });
                        }
                    }

                    // Pulse each ally bot whose HP dropped between
                    // broadcasts. Drives the per-card hit overlay.
                    const prevByCharId = new Map<string, typeof s.allies[number]>();
                    for (const a of (prev.lastBossState?.allies ?? [])) {
                        if (a.representsCharacterId) prevByCharId.set(a.representsCharacterId, a);
                        else prevByCharId.set(a.id, a);
                    }
                    for (const a of s.allies) {
                        if (a.representsCharacterId === meId) continue; // own slot pulses via playerHitPulse above
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
                        // Combat-relevant fields are unused on the
                        // member side (their tick is suppressed) — fill
                        // with safe defaults.
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
                        // 2026-05-13: keep the leader / human-id tags so
                        // the renderer can put the leader at slot 0 of
                        // the arena regardless of who's viewing.
                        representsCharacterId: a.representsCharacterId,
                        isLeader: a.isLeader,
                    }));
                    useBotStore.setState({ bots: mirroredBots });
                }

                // 2026-05-13: result phase — credit own XP + gold from the
                // leader's roll and populate the local result panel so the
                // member's "Odbierz" CTA wraps up cleanly. Guarded with a
                // one-shot ref because boss-state can re-arrive (throttle
                // bypass) and we don't want to double-credit.
                if (s.phase === 'result' && !memberResultAppliedRef.current) {
                    memberResultAppliedRef.current = true;
                    if (s.won && typeof s.earnedXp === 'number' && typeof s.earnedGold === 'number') {
                        // 2026-05-14 spec ("Jezeli w bossie i raidzie
                        // zginie sojusznik i na popupie kliknie ze nie
                        // wraca do miasta i czeka a nikt go nie
                        // wskrzesi to otrzymuje nagrody oraz zalicza
                        // mu raid / bossa jako zrobionego i dostaje
                        // nagrody"): dead-Czekaj members ALSO consume
                        // an attempt + take XP/gold/drops. The earlier
                        // "alive only" gate was reversed per the new
                        // spec. The leader's local bossStore already
                        // burned an attempt via handleBossDeath; we
                        // mirror it here regardless of ally life.
                        useBossStore.getState().setBossDefeated(s.bossId);
                        // Apply XP via characterStore (handles level-ups
                        // + full-restore on level-up just like hunt).
                        useCharacterStore.getState().addXp(s.earnedXp);
                        const ch = useCharacterStore.getState().character;
                        if (ch) {
                            useCharacterStore.getState().updateCharacter({
                                gold: (ch.gold ?? 0) + s.earnedGold,
                            });
                        }
                        // 2026-05-14 spec ("W dropie cos sie nie zgada
                        // kazdy powinien dostac drop ... I sprawdz czy
                        // w bossie tez jest poprawnie"): roll the
                        // member's OWN boss loot locally so the result
                        // panel actually shows item entries (same shape
                        // raid uses — each client rolls independently
                        // so every player walks away with their own
                        // slice). Skipped if no boss def found locally
                        // (defensive).
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
                        // Loss or missing rewards: render empty result panel
                        // so the member still has a CTA to exit.
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

    // 2026-05-17 spec ("Sluchaj zginalem w party na raidzie kliknalem
    // zeby zostac i wskrzesic przez graczy, ale nikt mnie nie
    // wskrzesil ... powinienem miec tylko guzik wroc do miasta i
    // powinienem miec animacje smierci i zginac bo nikt mnie nie
    // wskrzesil ale nagrody otrzymac normalnie ... to sie tyczy
    // kazdej walki w party"): on entering the result phase, if the
    // local player is still flagged dead (HP <= 0) and we haven't
    // already burned the death penalty via handlePlayerDeath, apply
    // it now + open the death overlay. Rewards stay credited (we
    // don't touch the result panel — the member's earlier subscriber
    // already added XP/gold). One-shot latch keeps it from firing
    // again on every re-render.
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
        const usedDeathProtection = useInventoryStore.getState().useConsumable('death_protection');
        const usedAol = useInventoryStore.getState().useConsumable('amulet_of_loss');
        useCharacterStore.getState().fullHealEffective();
        const oldLevel = ch.level;
        let newLevel = ch.level;
        let levelsLost = 0;
        let xpPercent = 100;
        let skillXpLossPercent = 0;
        if (!usedDeathProtection) {
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
        }
        const itemsLost = useInventoryStore.getState().applyDeathItemLoss(usedAol);
        if (usedAol) {
            addLog(':trident-emblem: Amulet of Loss roztrzaskal sie i ochronil Twoje przedmioty!', 'system');
        } else if (itemsLost > 0) {
            addLog(`:skull: Stracileś ${itemsLost} przedmiot(ow) przy śmierci!`, 'system');
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
            protectionUsed: usedDeathProtection,
            source: 'boss',
        });
        // 2026-05-17 v2 spec ("jezeli lider party kliknie ponow lub
        // walczy wyzej to mnie powinno wywalic z party i przejsc do
        // miasta"): leave the party + navigate home so the leader's
        // next "Walcz ponownie" / "Walcz wyżej" can't pull this dead
        // player back into the ready-check flow.
        useCombatStore.getState().clearCombatSession();
        // Tear down the ready-check channel so an `instant-go` from
        // the leader can't navigate us back to /boss before the
        // async leaveParty roundtrip lands.
        usePartyReadyCheckStore.getState().clear();
        clearBots();
        void (async () => {
            try {
                await usePartyStore.getState().leaveParty(ch.id);
            } catch { /* offline / already left */ }
        })();
        navigate('/');
    }, [phase, addLog, clearBots, navigate]);

    // -- Attack intervals (scaled by speedMult) -------------------------------
    // 2026-06: party-buff leak fix — the leader's own attack speed must
    // honour an active `party_as_up` (Bard/Cleric haste). `charSpeed` is
    // computed inline at render and never folds in `asMult` (a mutable
    // status field, not React state), so a plain `setInterval` keyed on
    // `charSpeed` would never speed up when the buff lands. Use a
    // self-rescheduling timeout loop that, each swing, reads the LIVE base
    // charSpeed + the active party haste mult and recomputes the delay —
    // so the leader swings faster while the buff is up and slows back when
    // it expires, with no dependency on the buff in React state.
    useEffect(() => {
        if (phase !== 'fighting' || !activeBoss) return;
        // 2026-05-13: non-leader members mirror the leader's authoritative
        // boss-state via the subscriber above; their own tick must NOT run
        // or we'd get parallel copies of the fight again.
        if (isNonLeaderMember) return;
        let timeoutId: ReturnType<typeof setTimeout>;
        let cancelled = false;
        const scheduleNext = () => {
            if (cancelled) return;
            // Effective speed = base charSpeed × active party haste mult.
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
    }, [phase, activeBoss?.id, charSpeed, speedMult, isNonLeaderMember]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (phase !== 'fighting' || !activeBoss) return;
        if (isNonLeaderMember) return;
        const bossSpeed = activeBoss.speed || 1.5;
        const interval = Math.max(200, getAttackMs(bossSpeed) / speedMult);
        const id = setInterval(() => bossAtkRef.current(), interval);
        return () => clearInterval(id);
    }, [phase, activeBoss?.id, speedMult, isNonLeaderMember]); // eslint-disable-line react-hooks/exhaustive-deps

    // Bot companions attack interval (slightly slower than player)
    useEffect(() => {
        if (phase !== 'fighting' || !activeBoss) return;
        if (isNonLeaderMember) return;
        const interval = Math.max(300, (getAttackMs(charSpeed) + 200) / speedMult);
        const id = setInterval(() => botAtkRef.current(), interval);
        return () => clearInterval(id);
    }, [phase, activeBoss?.id, charSpeed, speedMult, isNonLeaderMember]); // eslint-disable-line react-hooks/exhaustive-deps

    // Status / DOT tick — drains stun timers + applies DOT damage on a
    // separate cadence (every 250 ms scaled by speed) so paralysed combatants
    // recover in real-time and DOTs deal their per-second slice consistently.
    useEffect(() => {
        if (phase !== 'fighting' || !activeBoss) return;
        // 2026-05-13: non-leader members do not run DOT ticks — boss state
        // mirrors the leader's authoritative tally instead.
        if (isNonLeaderMember) return;
        const TICK_MS = 250;
        const id = setInterval(() => {
            // Game-time buffs handled globally by BuffBar tick (reads
            // combatSpeedMult from BuffStore). Just DOT/stun here.
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
                    // 2026-05 v6: per-tick DOT visual on the boss card so
                    // the player sees Zatruty Strzał / Plaga / Mistrzostwo
                    // Miecza ticking instead of the HP bar silently
                    // shrinking.
                    if (apply.appliedDmg > 0) {
                        fx.pushEnemyFloat(0, apply.appliedDmg, 'spell', { icon: 'skull-and-crossbones' });
                        // 2026-05-14 spec ("Nie widze animacji DOT i
                        // wszystkich animacji spelli sojusznikow"):
                        // broadcast the DOT tick so every party member
                        // sees the same floating :skull-and-crossbones: damage number on
                        // the boss card. Without this, only the leader
                        // saw DOT damage; members had a silently
                        // shrinking boss HP bar.
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
                            }).catch(() => { /* offline */ });
                        }
                    }
                }
                // 2026-05 v7: Mroczny Rytuał detonation. Damage is in % of
                // boss max HP, applied AFTER boss-DEF mitigation is bypassed
                // (it's a true HP-percent strip — go straight to HP).
                if (r.id === BOSS_FX_ID && r.darkRitualTriggered && r.darkRitualDamage > 0) {
                    bossHpRef.current = Math.max(0, bossHpRef.current - r.darkRitualDamage);
                    setBossHp(bossHpRef.current);
                    fx.pushEnemyFloat(0, r.darkRitualDamage, 'spell', { icon: 'skull', label: 'RITUAL', isCrit: true });
                    // 2026-05-14: ritual detonation visible on every
                    // member's screen (matches leader's RITUAL float).
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
                        }).catch(() => { /* offline */ });
                    }
                }
                // 2026-05 v7 BUG FIX: tick-loop kills (DOT or Mroczny
                // Rytuał) need to fire `handleBossDeath()` exactly the
                // same way a basic-attack / spell killing-blow does.
                // Without this the boss HP bar drained to 0 but the
                // fight stayed in the `fighting` phase — UI froze, no
                // victory screen, no rewards. Reproduced when a Necro
                // summon swung the killing blow at the same tick the
                // ritual fired (or when only a DOT/ritual finished off
                // the boss). Single guard at the bottom of the dot loop
                // covers both atoms.
                if (r.id === BOSS_FX_ID && bossHpRef.current <= 0 && phaseRef.current === 'fighting') {
                    handleBossDeath();
                    break;
                }
            }
        }, 250);
        return () => clearInterval(id);
    }, [phase, activeBoss?.id, speedMult, charMaxHp, scaledBossMaxHp, handleBossDeath, isNonLeaderMember]);

    // Boss render guard (after-hooks) — see note up near the eqStats block.
    // Placed AFTER every hook in this component so we never alter hook call
    // order between renders. Character starts null on the first render after
    // a `goto('/boss')` (App.tsx re-hydrates async via switchToCharacter) and
    // the React Rules of Hooks detector would crash the tree if we returned
    // early before all `useEffect`s registered.
    if (!character) return <div className="boss"><Spinner size="lg" /></div>;

    return (
        <div className={`boss${phase === 'fighting' ? ' boss--fighting' : ''}`}>
            {/* Header now only carries the trophy + boss-score badge under
                a small top margin — the page title (":ogre: Bossowie") and the
                "<- Miasto" back button were dropped in the latest UX pass.
                Navigation back to town lives in the global BottomNav, so the
                in-page back button became redundant chrome. The trophy is
                centred and visually breathes; everything else is gone. */}
            <header className="boss__header boss__header--minimal">
                {/* Trophy / total-score badge only makes sense on the list
                    view — during a live fight or the result screen the
                    player's looking at boss HP and rewards, so the global
                    score widget would be visual noise. The ":crossed-swords: Walka" pill
                    that used to sit here was also dropped per UX pass; the
                    fighting phase is already obvious from the arena layout. */}
                {phase === 'list' && (
                    <span className="boss__score"><GameIcon name="trophy" /> {getTotalScore().toLocaleString('pl-PL')}</span>
                )}
            </header>

            <AnimatePresence mode="wait">

                {/* -- Boss list --------------------------------------------------- */}
                {phase === 'list' && (() => {
                    // Apply the three persisted filters before rendering. The
                    // gate level is identical to the in-card calculation —
                    // factor it out so the "available" filter and the per-card
                    // `tooLow` flag agree on which bosses the player can hit.
                    const gateLvlForFilter = getPartyGateLevel(character.level, party?.members ?? null);
                    let visibleBosses = bosses.slice();
                    if (bossFilterMinLevel > 0) {
                        visibleBosses = visibleBosses.filter((b) => b.level >= bossFilterMinLevel);
                    }
                    if (bossFilterAvailableOnly) {
                        // "Available" = player meets level gate AND has
                        // attempts left. Locked / exhausted bosses fall out.
                        visibleBosses = visibleBosses.filter(
                            (b) => b.level <= gateLvlForFilter && canChallenge(b.id),
                        );
                    }
                    if (bossFilterSortDesc) {
                        visibleBosses = visibleBosses.slice().sort((a, b) => b.level - a.level);
                    }
                    const anyBossFilterActive =
                        bossFilterAvailableOnly || bossFilterSortDesc || bossFilterMinLevel > 0;
                    // Track the original index so card backgrounds (boss1.png,
                    // boss2.png, …) stay tied to the canonical boss order, not
                    // the filtered position. Otherwise a sorted view would
                    // remap the painted backgrounds and look inconsistent.
                    return (
                    <motion.div key="list" className="boss__panel"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        {/* Persistent filter bar — same shape as the dungeon
                            hub: pill toggles + numeric input + optional
                            Wyczyść. Saved per character via settingsStore /
                            characterScope. */}
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
                            // Resolve the painted background by canonical
                            // index so sorting / filtering doesn't shuffle
                            // which boss gets which `bossN.png`.
                            const bossIdx = bosses.findIndex((x) => x.id === b.id);
                            const attemptsUsed = getAttemptsUsed(b.id);
                            const attemptsMax  = getAttemptsMax();
                            const noAttempts   = !canChallenge(b.id);
                            // Gate by the lowest human level in the party — the
                            // weakest member dictates which boss the group can
                            // challenge. Solo players keep their own level.
                            const gateLevel    = getPartyGateLevel(character.level, party?.members ?? null);
                            const tooLow       = gateLevel < b.level;
                            const blocked      = noAttempts || tooLow;
                            const allDone = attemptsUsed >= attemptsMax;
                            // "Cleared" = the player has killed this boss at
                            // least once. `bossKills` only ever increments on
                            // a real victory so a positive count is a reliable
                            // win-once indicator (mirrors Dungeon's
                            // `clearedDungeonIds`). Drives the "Pokonany"
                            // stamp at the top of the card.
                            const cleared = getBossKillCount(b.id) > 0;
                            // Per-card background painting — `boss1.png` for the
                            // first tile, `boss2.png` for the second, and so on.
                            // Returns null when the user hasn't dropped art for
                            // this slot yet, in which case the card just falls
                            // back to its gradient chrome.
                            const cardBg = getBossCardImage(bossIdx);

                            return (
                                <div key={b.id} className={`boss__card${blocked ? ' boss__card--blocked' : ''}${allDone ? ' boss__card--all-done' : ''}${cardBg ? ' boss__card--has-bg' : ''}`}
                                    style={{
                                        '--card-hue': getBossCardHue(b.level),
                                        '--card-image': cardBg ? `url("${cardBg}")` : 'none',
                                    } as React.CSSProperties}>
                                    {/* Corner LVL badge — replaces the old
                                        "Wymagany poziom: X" inline label so
                                        the level reads at a glance from the
                                        top-right of the card without competing
                                        with the boss name for vertical space. */}
                                    <div className="boss__card-level-badge">LVL {b.level}</div>
                                    {/* "Pokonany" stamp — fires when the daily
                                        attempts are exhausted AND the player
                                        has killed this boss at least once.
                                        Centred between the LVL badge and the
                                        right edge of the card. Mirrors
                                        Dungeon's `dungeon__corner--cleared`
                                        treatment so the two views read as the
                                        same kind of "you did it for today"
                                        signal. */}
                                    {allDone && cleared && (
                                        <div className="boss__card-cleared-badge"><GameIcon name="check-mark-button" /> Pokonany</div>
                                    )}
                                    <div className="boss__card-top">
                                        <span className="boss__sprite">
                                            {/* `objectFit: cover` — boss card art is composed
                                                to fill the portrait frame, contain (the
                                                BossSprite default for monster/boss tiles in
                                                combat views) leaves visible empty bars at
                                                top/bottom that read as a layout bug on the
                                                list. The `style` prop is merged after the
                                                renderer's hardcoded `objectFit: contain` in
                                                MonsterSprite.renderImage, so this override
                                                wins. Keep in sync with the entry-sprite
                                                override below — both render the same boss
                                                art and should match. */}
                                            <BossSprite level={b.level} sprite={b.sprite} name={b.name_pl} style={{ objectFit: 'cover' }} />
                                        </span>
                                        <div className="boss__card-info">
                                            <div className="boss__card-name">{b.name_pl}</div>
                                        </div>
                                    </div>

                                    <p className="boss__card-desc">{b.description_pl}</p>

                                    {/* Stats — split into two rows per the
                                        latest UX spec:
                                          - Row 1: combat numbers the player
                                            cares about up-front (HP / ATK /
                                            DEF).
                                          - Row 2: rewards (Gold / XP) plus the
                                            :package: drop-table icon button that opens
                                            the full reward modal. Splitting
                                            the row gives each group enough
                                            breathing room on narrow tiles
                                            instead of wrapping awkwardly when
                                            the gold range is long. */}
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

                                    {/* Abilities */}
                                    {b.abilities && b.abilities.length > 0 && (
                                        <div className="boss__abilities">
                                            <span className="boss__abilities-label">Spelle:</span>
                                            {b.abilities.map((a, i) => (
                                                <span key={i} className="boss__ability-tag">{formatItemName(a)}</span>
                                            ))}
                                        </div>
                                    )}

                                    {/* Footer is now an explicit column: a status
                                        row (attempts + cooldown / locked badges)
                                        and a separate button row underneath.
                                        This removes the need for the flex-basis
                                        wrap trick — the Wyzwij CTA always sits
                                        on its own line and centres via
                                        margin: 0 auto in `.boss__challenge-btn`. */}
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
                                            <button className="boss__challenge-btn" onClick={() => handleChallenge(b)}>
                                                Wyzwij
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {/* Drop-table modal — single instance for all bosses,
                            opened by the :package: icon next to the gold cell. */}
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

                {/* -- Pre-fight bot picker modal -------------------------------- */}
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

                {/* -- Fighting (unified CombatUI) -------------------------------
                    Boss feeds into the same shared component tree as every other
                    combat view: 1 boss in slot 0 of the enemies column, player
                    + bots in the allies column. Daily-boss shimmering bg via
                    `bgVariant="daily-boss"` since every boss in this view is a
                    daily-attempt encounter.
                ------------------------------------------------------------ */}
                {phase === 'fighting' && activeBoss && (() => {
                    const classColorFallbackMap: Record<string, string> = {
                        Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
                        Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
                    };
                    const playerAccent = classColorFallbackMap[character.class] ?? '#e94560';

                    // -- Enemy slots (boss occupies slot 0; pad to 4) ----------
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
                            // Per-attack pulse counter — every distinct hit
                            // (player auto, dual-wield off-hand, skill cast,
                            // bot attack) bumps it so the keyed flash overlay
                            // re-mounts and the CSS animation replays from
                            // frame 0 even when two hits land in the same
                            // 300ms window.
                            hitPulse: monsterHitPulse,
                            attackingClassName: playerAttacking
                                ? `attack-${character.class}`
                                : botAttackingClass
                                    ? `attack-${botAttackingClass}`
                                    : null,
                            // Per-slot VFX from useCombatFx — boss is always
                            // slot 0. Floats include player basics, player
                            // spells, ally basics, ally spells, and even the
                            // boss's own self-heal in green.
                            skillAnim: fx.enemySkill[0] ?? null,
                            floats: fx.enemyFloats[0] ?? [],
                            // Live stun / immortal countdowns. Boss view re-renders
                            // every state-tick (HP / hitPulses change) so badges
                            // visibly drain.
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

                    // -- Ally slots (player + up to 3 bots) --------------------
                    const playerAggro = aggroTargetRef.current === 'player' ? 1 : 0;
                    const playerSummonList = necroSummons[PLAYER_FX_ID] ?? [];
                    const playerSummonsByType: Partial<Record<'skeleton' | 'ghost' | 'demon' | 'lich', number>> = {};
                    for (const s of playerSummonList) {
                        playerSummonsByType[s.type] = (playerSummonsByType[s.type] ?? 0) + 1;
                    }
                    // Necromancer summon avatar/HP swap — see Trainer
                    // for the spec; same logic mirrored here so Boss /
                    // Dungeon / Hunt all show the front summon's card.
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
                    // 2026-05-13 spec ("pierwszy powinien byc archer a
                    // drugi sojusznik nr 2 czyli knight w tym wypadku na
                    // kazdym ekranie"): both leader and member must see
                    // the same slot order = party roster order (leader
                    // first, then members in join order). The local
                    // player ("self") rendering still uses character /
                    // playerHp / etc., but their slot index depends on
                    // their position in the party. For the leader this
                    // is slot 0 (no visible change). For a member it's
                    // slot 1 (or later) — slot 0 is filled by the bot
                    // representing the leader.
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
                            // Per-attack pulse counter — every boss swing /
                            // AOE / spell increments this so the player's
                            // flash overlay re-mounts even on rapid back-to-back
                            // boss attacks.
                            hitPulse: playerHitPulse,
                            // Attacker-side animation removed — the slash/spell
                            // visual lands on the boss only (see uiEnemies).
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
                            // 2026-05-13: bots are generated in the same
                            // order as `party.members.filter(m => m.id !== me)`,
                            // so bot[i] represents humanPartyMates[i] when
                            // the slot maps to a real human. We look up
                            // that human's live transform tier from the
                            // presence store and pass it to
                            // getCharacterAvatar so the leader sees the
                            // member's actual transform-respecting avatar
                            // (and their real player name).
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
                            // 2026-05-14: render from `bot.{hp,maxHp,...}`
                            // — the bot's pool was anchored to the
                            // member's REAL maxHp at generation time
                            // (see beginBossFight's post-generation
                            // patch using partyPresenceStore), so each
                            // boss hit on bot.hp lines up 1:1 with the
                            // member's character pool. Earlier attempt
                            // to read from presence at render time froze
                            // the bar at the stale 2s-heartbeat value
                            // and lost real-time damage feedback.
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
                            // Only a TRUE AI bot gets the robot badge — a card
                            // backed by `humanMate` is a real party member.
                            isBot: !humanMate,
                            level: humanMate?.level ?? bot.level,
                            aggroCount: aggroTargetRef.current === bot.id ? 1 : 0,
                            // Per-bot pulse — bumped inside `dealDamageToBot`
                            // and the AOE loop so this ally flashes only when
                            // the boss actually hits THEM (not on every tick).
                            hitPulse: botHitPulses[bot.id] ?? 0,
                            // Bots are attackers — animation belongs on the boss target.
                            attackingClassName: null,
                            // Bot's display slot is `bIdx + 1` (player = 0).
                            // Anything boss-cast on this bot pushes through
                            // `pushAllyFloat(bIdx + 1, ...)` above.
                            skillAnim: fx.allySkill[bIdx + 1] ?? null,
                            floats: fx.allyFloats[bIdx + 1] ?? [],
                            };
                        });
                    // Build the final slot list. Non-leader members put
                    // the leader-bot at slot 0; everyone else uses the
                    // existing self-first order. The leader-bot is
                    // identified via the `isLeader` flag preserved from
                    // the broadcast.
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

                    // -- Skill slots -------------------------------------------
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

                    // -- Potion slots ------------------------------------------
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
                            // Expose this boss's card hue to the combat arena
                            // shimmer: the daily-boss variant in CombatUI.scss
                            // reads `--boss-hue` to build its gradient so the
                            // pulse matches the per-tier border the player saw
                            // on the list view (per UX direction: "powinno
                            // mienic sie na kolor taki jaki jest na borderze
                            // przed rozpoczeciem walki").
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
                                            onFlee: () => {
                                                // Standard flee penalty (1/10 death) —
                                                // applies XP loss but never strips a level
                                                // and never touches equipment.
                                                // Flag the leave-guard so unmount doesn't
                                                // upgrade this soft penalty to full death.
                                                leavePenaltyAppliedRef.current = true;
                                                const ch = useCharacterStore.getState().character;
                                                // 2026-05-14 spec ("Jezeli sojusznik
                                                // ucieknie z bossa lub dungeona podczas
                                                // walki to ... powinien wyskoczyc mu popup
                                                // ze udalo Ci sie uciec"): fire the flee
                                                // overlay (kind: 'flee') with the penalty
                                                // numbers so the player sees an explicit
                                                // "UCIEKŁEŚ — tracisz X% lvl / Y% Skill
                                                // XP" panel before being dropped at the
                                                // city. Without this the penalty was
                                                // applied silently and the player had no
                                                // visible feedback for the loss.
                                                if (ch && ch.level > 1) {
                                                    // 2026-05-19 v25 spec: log flee to the
                                                    // global deaths feed so the /deaths view
                                                    // renders "<boss> przegnał <player>"
                                                    // (verb driven by `result: 'fled'`).
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
                                                // Persist current HP/MP — fleeing keeps your wounds
                                                // (combat outcomes never silently top you off).
                                                // Clamp to EFFECTIVE max so a potion-buffed HP isn't
                                                // truncated to base on flee.
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
                                                // 2026-05-13 spec ("kazdy sojusznik moze
                                                // uciec z bossa w kazdym momencie, wtedy
                                                // automatycznie wychodzi z party i traci
                                                // 1/10 XP oraz skilli"): non-leader members
                                                // who flee leave the party and head to
                                                // town instead of seeing the defeat result
                                                // panel. Flee penalty above already applied.
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


                {/* -- Result ------------------------------------------------------
                    Mirrors Dungeon's victory view 1:1 per spec — same banner
                    shimmer, same per-card background painting (when art is
                    present), same Odbierz/Wróć CTA palette. The result card
                    sits centred in the viewport via `boss__panel--centered`,
                    matching the Dungeon vertical-centre treatment. */}
                {phase === 'result' && result && activeBoss && (() => {
                    const bossIdx = bosses.findIndex((x) => x.id === activeBoss.id);
                    const cardBg = bossIdx >= 0 ? getBossCardImage(bossIdx) : null;
                    // 2026-05-17 spec ("Sluchaj zginalem w party na
                    // raidzie ... powinienem miec tylko guzik wroc do
                    // miasta i powinienem miec animacje smierci i
                    // zginac bo nikt mnie nie wskrzesil ale nagrody
                    // otrzymac normalnie ... to sie tyczy kazdej
                    // walki w party"): if the player's character is
                    // still dead at result time, surface ONLY a
                    // "Wróć do miasta" CTA — hide Odbierz / Wyjdź /
                    // Walcz ponownie / Walcz wyżej. Rewards stay
                    // credited (the result panel above already shows
                    // the gold/XP/drops the member earned).
                    const iDiedUnresurrected = ((character?.hp ?? 0) <= 0);
                    return (
                        <motion.div key="result" className="boss__panel boss__panel--centered"
                            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                            <div
                                className={`boss__result${result.won ? ' boss__result--win' : ' boss__result--loss'}`}
                                style={{
                                    '--card-hue': getBossCardHue(activeBoss.level),
                                    // Same per-boss painting as the lobby tile.
                                    // Falls back to `none` so the gradient
                                    // chrome shows through cleanly when art
                                    // isn't on disk yet.
                                    '--card-image': cardBg ? `url("${cardBg}")` : 'none',
                                } as React.CSSProperties}
                            >
                                {/* Win view leads with the shimmering banner
                                    (transparent fill so the boss painting shows
                                    through), exactly like Dungeon. */}
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

                                {/* Single CTA — green "Odbierz" celebrates the
                                    win, red "Wróć" closes a loss. Both clear
                                    the bot party and return to the list (the
                                    unified-combat spec — fight-again removed). */}
                                <div className="boss__result-actions">
                                    {iDiedUnresurrected ? (
                                        // 2026-05-17 spec: dead-not-resurrected
                                        // gets a single "Wróć do miasta" CTA.
                                        // Death overlay is fired by the
                                        // useEffect above; this just exits.
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
                                                    // 2026-05-13 spec: members exit by leaving
                                                    // the party (so the leader's next "Walcz
                                                    // ponownie" doesn't pull them back); leader
                                                    // returns to the boss list to chain fights.
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
                                            {/* Spec 6 (2026-05): "Walcz ponownie" replays the
                                                same boss + bot party when the player + every
                                                bot survived AND the boss still has attempts
                                                left for the day.
                                                2026-05-13: members never see retry CTAs —
                                                they only collect their share + head to town;
                                                the leader is the one who starts the next
                                                fight (and members get pulled in via the
                                                ready-check flow). */}
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
                                                            // 2026-05-13 spec ("Jak lider
                                                            // klika Walcz ponownie to wszyscy
                                                            // nie powinni potwierdzac jej
                                                            // tylko od razu powinno im ekran
                                                            // przekierowywac do walki z
                                                            // bossem ale wczesniej animacja"):
                                                            // use triggerPartyCombatGo —
                                                            // bypasses the ready-check popup,
                                                            // members auto-navigate +
                                                            // entry-animation. Both leader
                                                            // and members fire
                                                            // playEntryThenFight so the
                                                            // animation plays on every screen.
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
                                            {/* 2026-05 v6: when daily attempts on this boss
                                                are spent, surface the next higher-level boss
                                                that's still available + within reach
                                                (level <= char.level). Lets the player chain
                                                through tiers without manually returning to
                                                the list. */}
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
                                                            // Same pattern as "Walcz ponownie" —
                                                            // skip ready-check popup, members
                                                            // auto-redirect with animation.
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

            {/* -- Epic boss entry: doors sliding open ------------------------
                Clickable anywhere on the overlay to short-circuit the
                animation and drop straight into combat (per UX direction:
                "Daj mozliwosc pominiecia animacji poprzez klikniecie
                gdziekolwiek wchodzac do bossa"). The handler is idempotent
                via `bossEntryPendingRef` — repeated taps after the first
                are no-ops. role/tabIndex/keyboard wiring keeps the
                shortcut accessible without forcing keyboard users to wait
                out the doors. */}
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
                        {/* Arena backdrop behind the doors — revealed as they slide off,
                            so the player sees boss atmosphere, not the previous screen. */}
                        <div className="boss__entry-bg" aria-hidden="true" />
                        {/* Left door slides off to the left.
                            Compressed from 0.4 + 0.9 to 0.25 + 0.7 so the
                            doors clear by 0.95s and we still leave room for
                            the post-reveal hold within the 2s ceiling. */}
                        <motion.div
                            className="boss__entry-door boss__entry-door--left"
                            initial={{ x: 0 }}
                            animate={{ x: '-110%' }}
                            transition={{ delay: 0.25, duration: 0.7, ease: [0.7, 0, 0.3, 1] }}
                        />
                        {/* Right door slides off to the right (mirrors left). */}
                        <motion.div
                            className="boss__entry-door boss__entry-door--right"
                            initial={{ x: 0 }}
                            animate={{ x: '110%' }}
                            transition={{ delay: 0.25, duration: 0.7, ease: [0.7, 0, 0.3, 1] }}
                        />
                        {/* Crack of light down the seam (fades out once doors
                            are gone). Compressed from 1.3s to 1.0s. */}
                        <motion.div
                            className="boss__entry-seam"
                            initial={{ scaleY: 0, opacity: 0 }}
                            animate={{
                                scaleY: [0, 1, 1, 0],
                                opacity: [0, 1, 1, 0],
                            }}
                            transition={{ duration: 1.0, times: [0, 0.3, 0.65, 1] }}
                        />
                        {/* Boss name + sprite reveal. Compressed from 2.0s to
                            1.5s so the label finishes its little punch-in
                            300ms before combat mounts. */}
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
                                {/* `objectFit: cover` — match the list-card sprite above.
                                    The intro animation flies the boss tile from the list
                                    grid into the centre of the screen; if cover/contain
                                    differed between the two surfaces the artwork would
                                    visibly resize mid-flight. Keep both call sites in
                                    lock-step. */}
                                <BossSprite level={bossEntryBoss.level} sprite={bossEntryBoss.sprite ?? 'ogre'} name={bossEntryBoss.name_pl} style={{ objectFit: 'cover' }} />
                            </span>
                            <span className="boss__entry-name">{bossEntryBoss.name_pl}</span>
                            <span className="boss__entry-level">Lvl {bossEntryBoss.level}</span>
                        </motion.div>
                        {/* Shockwave ring on seam crack. Compressed from
                            0.35 + 0.7 to 0.25 + 0.5. */}
                        <motion.div
                            className="boss__entry-shock"
                            initial={{ scale: 0, opacity: 0.9 }}
                            animate={{ scale: 4, opacity: 0 }}
                            transition={{ delay: 0.25, duration: 0.5, ease: 'easeOut' }}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* 2026-05-14 spec ("popup ma jej wyskoczyc i dopiero po
                popupie w zaleznosci co kliknie to albo animacja albo
                nic"): party-combat death decision modal. Pops when our
                HP hits 0 inside a multi-human party. Two outcomes:
                  - Wróć do miasta -> run the full handlePlayerDeath
                    sequence (XP/skill loss, item loss, death overlay,
                    /). The hadnler's deathChoiceShownRef latch lets
                    the second call through unconditionally.
                  - Czekaj na sojuszników -> close popup, stay
                    incapacitated. Combat keeps ticking around us;
                    a teammate's revive auto-closes via the useEffect
                    above. */}
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
                                        // 2026-05-14 spec: confirming death also
                                        // removes us from party so the fight cleans up:
                                        //   - Member confirms -> leaveParty (removes
                                        //     us from party_members; party persists).
                                        //   - Leader confirms -> transfer leadership
                                        //     to any alive teammate first, THEN
                                        //     leaveParty (which now treats us as a
                                        //     plain member, party persists with the
                                        //     new leader and the fight continues).
                                        // Fire-and-forget so the death penalty +
                                        // overlay (handlePlayerDeath below) doesn't
                                        // wait on the network.
                                        const pty = usePartyStore.getState().party;
                                        const me = useCharacterStore.getState().character?.id;
                                        if (pty && me) {
                                            void (async () => {
                                                const isLeader = pty.leaderId === me;
                                                if (isLeader) {
                                                    // Find an alive teammate to
                                                    // promote. Prefer humans (so the
                                                    // fight has someone real to drive
                                                    // ticks) over AI bots, and skip
                                                    // anyone whose presence shows them
                                                    // already dead.
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
                                                        } catch { /* best effort */ }
                                                    }
                                                }
                                                try {
                                                    await usePartyStore.getState().leaveParty(me);
                                                } catch { /* best effort */ }
                                            })();
                                        }
                                        // Continue with the standard death sequence
                                        // (penalty + skull overlay + navigate to /).
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
