import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { usePartyStore } from '../../stores/partyStore';
import { usePartyPresenceStore } from '../../stores/partyPresenceStore';
import { requestPartyCombatStart, registerGoReplicator } from '../../hooks/usePartyReadyCheck';

// 2026-05-14 spec ("Sojusznik ma ikonki jak w walce nie powinien
// jeszcze byc na widoku walki a widze ze z tylu jest, jak klikne
// anuluj to jestem w walce"): register the `/raid` go-replicator the
// same way Boss does — full-heal a dead member, then bump the local
// `pendingRaidEntryAt` so Raid.tsx's subscriber kicks off startRaid.
//
// The previous implementation auto-started the raid in Raid.tsx's
// mount effect by reading `partyReadyCheckStore.destination` directly.
// That fired during the OPEN (ready-check still in flight) phase
// because the start handler pre-navigates non-leader members to
// `/raid` to overlay the popup on the destination. As a side effect
// the mount-effect ALSO consumed the destination, which wiped the
// popup's preview (no background image, no name, no level — just
// `?`). Routing the start through this replicator means combat only
// fires after the leader's `go` event.
registerGoReplicator('/raid', (payload) => {
    const p = payload as { raidId?: string } | null;
    if (!p?.raidId) return;
    // 2026-05-18 spec ("Nic nigdy nie powinno mi samemu odnawiac HP i MP
    // poza HP i MP regen oraz potionami"): removed the auto-heal-when-
    // dead path. buildMemberStates spawns the player with whatever
    // current HP/MP they carry (or stayDead=true if hp <= 0) and
    // mid-fight rez is the only way back from a corpse re-entry.
    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
        usePartyCombatSyncStore.getState().requestMemberRaidEntry(p.raidId!);
    }).catch(() => { /* offline */ });
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
import { SPELL_CHEST_LEVELS, getCombatSkillUpgradeMultiplier } from '../../systems/skillSystem';
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
import { isBackendMode } from '../../config/backendMode';
import { backendApi } from '../../api/backend/backendApi';
import { syncFromBackend } from '../../api/backend/syncState';
import './Raid.scss';

const CLASS_COLORS: Record<string, string> = {
    Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
    Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

// -- Backend-mode (opt-in) resolve helpers ------------------------------------
// Autorytatywny backend rozstrzyga CAŁY rajd jednym wywołaniem
// POST /raid/{id}/resolve i zwraca wynik. Tu go TYLKO czytamy (nigdy nie
// liczymy ponownie) i zamieniamy na krótką linię feedbacku. `raidResolve` jest
// typowany jako `unknown`, więc zawężamy defensywnie — każde pole opcjonalne,
// a kształt tolerancyjny na płaskie / zagnieżdżone nazwy nagród.
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

/**
 * Mirrors the dungeon-card hue function so raid cards walk through the same
 * level -> colour ramp. Two views, one visual language: a Lvl 50 raid feels
 * like a Lvl 50 dungeon at a glance.
 */
const getRaidCardHue = (level: number): number => {
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
 * Canonical rarity colours — exact mirror of `RARITY_LABELS` in Dungeon.tsx.
 * The raid drop modal must read in lock-step with the dungeon one (same
 * Heroic = purple, Mythic = yellow, Legendary = red, Epic = green, Rare =
 * blue, Common = white) so a player who has internalised the dungeon
 * palette doesn't have to re-learn anything when they open a raid. These
 * are the source-of-truth hues for every per-tier dot / label below.
 */
const RAID_RARITY_COLOR: Record<string, string> = {
    heroic:    '#9c27b0',
    mythic:    '#ffc107',
    legendary: '#f44336',
    epic:      '#4caf50',
    rare:      '#2196f3',
    common:    '#ffffff',
};

/**
 * Drop-modal display tiers — visualised in the popup so the player can read
 * the same chance table the engine actually rolls against. Sourced from the
 * spec rebalance in raidSystem.ts, kept local to this view (the engine
 * arrays are not exported intentionally). Colours come from the canonical
 * rarity palette above; chance values match the engine's `ITEM_RARITY_CHANCES`
 * and `STONE_DROPS` tables.
 */
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

/**
 * Completion-bonus tiers — single extra item roll every surviving member
 * gets at the end of a successful raid (engine's `COMPLETION_ROLL` table).
 * Skewed higher than per-boss drops (Heroic 1.5%, Mythic 8%, Legendary
 * 15%, Epic 25%, Rare 40%, Common 10.5%). Rendered as a per-tier list in
 * the modal so each rarity name picks up its canonical colour and reads
 * as a category, not a sentence.
 */
const RAID_BONUS_TIERS: Array<{ key: string; label: string; chance: number; color: string }> = [
    { key: 'heroic',    label: 'Heroic',    chance: 1.5,  color: RAID_RARITY_COLOR.heroic    },
    { key: 'mythic',    label: 'Mythic',    chance: 8,    color: RAID_RARITY_COLOR.mythic    },
    { key: 'legendary', label: 'Legendary', chance: 15,   color: RAID_RARITY_COLOR.legendary },
    { key: 'epic',      label: 'Epic',      chance: 25,   color: RAID_RARITY_COLOR.epic      },
    { key: 'rare',      label: 'Rare',      chance: 40,   color: RAID_RARITY_COLOR.rare      },
    { key: 'common',    label: 'Common',    chance: 10.5, color: RAID_RARITY_COLOR.common    },
];

/**
 * Per-chest spell chest drop chance the raid modal advertises. Matches
 * `SPELL_CHEST_CHANCE_PER_LEVEL` in raidSystem.ts so the displayed odds
 * stay in sync with the engine roll. Each eligible chest level rolls
 * independently, so the visible chance is per-row, not aggregate.
 */
const RAID_SPELL_CHEST_CHANCE = 0.0025;

/**
 * Source-dungeon description lookup keyed by `IRaid.sourceDungeonId`.
 * Raids reuse their source dungeon's flavour line so the two list views
 * read identical at a glance (same painting + same name + same description).
 * Built once at module load — the dungeons.json import is static.
 */
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
    const { attemptsRemaining, consumeAttempt, refundAttempt } = useRaidStore();

    // 2026-05-13 spec ("sojusznik widzi to samo co lider w raidzie"):
    // shared-raid role detection. Non-leader members suppress local
    // combat tick + DOT tick + cooldown drain and mirror the leader's
    // authoritative state via `lastRaidState` subscription.
    const isMultiHumanParty = !!party && party.members.some(
        (m) => m.id !== character?.id && !m.isBot,
    );
    const isLeaderInPartyCombat = isMultiHumanParty && party?.leaderId === character?.id;
    const isNonLeaderMember     = isMultiHumanParty && party?.leaderId !== character?.id;

    // Persisted raid-list filters (per character via characterScope) — same
    // contract as the dungeon hub so the two screens behave identically.
    const {
        raidFilterAvailableOnly,
        raidFilterMinLevel,
        raidFilterSortDesc,
        setRaidFilterAvailableOnly,
        setRaidFilterMinLevel,
        setRaidFilterSortDesc,
    } = useSettingsStore();

    // Auto-skill / auto-potion toggles — share the same global settings the
    // hunting + boss + dungeon views use so a single toggle in any combat
    // view propagates everywhere.
    const skillMode = useSettingsStore((s) => s.skillMode);
    const setSkillMode = useSettingsStore((s) => s.setSkillMode);
    const autoPotionHpEnabled = useSettingsStore((s) => s.autoPotionHpEnabled);
    const autoPotionMpEnabled = useSettingsStore((s) => s.autoPotionMpEnabled);
    const setAutoPotionHpEnabled = useSettingsStore((s) => s.setAutoPotionHpEnabled);
    const setAutoPotionMpEnabled = useSettingsStore((s) => s.setAutoPotionMpEnabled);
    // Configured auto-potion ids — the dock must reflect what the PLAYER picked,
    // not just the strongest owned potion. Read reactively so changing the pick
    // in settings re-renders the dock immediately.
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
    // Necromancer summon stack (per member). Indexed by member id so each
    // necro in the party gets their own queue + own badge.
    const necroSummons = useNecroSummonStore((s) => s.summons);

    const consumables = useInventoryStore((s) => s.consumables);
    const activeSkillSlots = useSkillStore((s) => s.activeSkillSlots);

    // Dock potions — show the CONFIGURED auto-potion for each slot so the UI
    // matches what actually gets drunk (BUG #9: dock used to show the strongest
    // owned potion via getBestPotion, making it look like the game ignored the
    // player's picks even though the real auto-drink already respects config).
    // Fall back to the strongest owned potion when the configured one isn't
    // owned / usable, so the dock shows the best available instead of empty.
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

    // Cooldown timers (ms remaining). Tick down every 100 ms while phase==='fighting'.
    // We keep BOTH state (for UI re-render) and refs (for sync reads inside
    // the combat tick callback — its closure deps are `[phase, speedMult]`
    // so it would otherwise read STALE state values, which is what made
    // auto-potion silently skip after a manual click set the cooldown).
    const [hpPotionCooldown, setHpPotionCooldown] = useState(0);
    const [mpPotionCooldown, setMpPotionCooldown] = useState(0);
    const [pctHpCooldown, setPctHpCooldown] = useState(0);
    const [pctMpCooldown, setPctMpCooldown] = useState(0);
    const hpPotionCooldownRef = useRef(0);
    const mpPotionCooldownRef = useRef(0);
    const pctHpCooldownRef = useRef(0);
    const pctMpCooldownRef = useRef(0);
    useEffect(() => { hpPotionCooldownRef.current = hpPotionCooldown; }, [hpPotionCooldown]);
    useEffect(() => { mpPotionCooldownRef.current = mpPotionCooldown; }, [mpPotionCooldown]);
    useEffect(() => { pctHpCooldownRef.current = pctHpCooldown; }, [pctHpCooldown]);
    useEffect(() => { pctMpCooldownRef.current = pctMpCooldown; }, [pctMpCooldown]);
    const HP_POTION_CD = 1000;
    const MP_POTION_CD = 1000;

    // Manual-skill queue — slot index queued by the player via the action bar.
    // The raid combat tick pops one cast per tick when present, falling back
    // to auto-cast only if `skillMode === 'auto'` and the queue is empty.
    const skillQueueRef = useRef<number[]>([]);
    // ms-based mirror of the player's skill cooldowns — drives the UI sweep
    // on the action bar so the player can SEE the timer drain. Updated
    // every 100 ms by the same ticker that drains potion cooldowns; set
    // by the cast block when the player fires a spell (auto or manual).
    const [playerSkillCooldowns, setPlayerSkillCooldowns] = useState<Record<string, number>>({});

    const raids = useMemo(() => getAllRaids(), []);
    const [phase, setPhase] = useState<RaidPhase>('lobby');
    const [selectedRaid, setSelectedRaid] = useState<IRaid | null>(null);

    // Backend-mode (opt-in) feedback banner. Only ever set on the isBackendMode()
    // branch of handleEnterRaid; stays null on the default client path so the
    // legacy flow (party ready-check + client combat) renders identically.
    const [backendFeedback, setBackendFeedback] = useState<string | null>(null);

    // 2026-05-13 spec ("lider konczy raid -> sojusznicy do miasta"):
    // mirror of the Boss view logic — when leader's selectedRaid
    // transitions from non-null to null (back to the raid list, raid
    // finished / fled / failed), broadcast a `combat-end` so every
    // party member's listener pulls them out of /raid and back to
    // town. Members on /raid would otherwise be stranded with stale
    // boss/wave HP bars.
    //
    // 2026-05-14 spec ("Klikam ponow i sojusznik umiera od razu"): the
    // Ponów button briefly transitions selectedRaid -> null (via
    // backToLobby) before setting it back to non-null (via startRaid
    // in the next tick). That transient null fired combat-end ->
    // member's `usePartyCombatSync` ran `stopCombat()` + `navigate('/')`
    // -> Raid.tsx unmounted on the member -> the beforeunload-style
    // cleanup at `applyCombatLeaveDeath` triggered the full death
    // penalty with the previous raid's name. We now skip the
    // combat-end broadcast when a retry is in flight; the leader's
    // upcoming raid-state broadcast (with the new fight) keeps the
    // member on /raid.
    const retryInProgressRef = useRef(false);
    const prevSelectedRaidRef = useRef<IRaid | null>(selectedRaid);
    useEffect(() => {
        const prev = prevSelectedRaidRef.current;
        prevSelectedRaidRef.current = selectedRaid;
        if (!prev || selectedRaid) return;
        // transitioned: non-null -> null (raid ended)
        if (retryInProgressRef.current) return;
        const partyState = usePartyStore.getState().party;
        const me = useCharacterStore.getState().character?.id;
        if (!partyState || !me) return;
        const otherH = partyState.members.filter((m) => m.id !== me && !m.isBot);
        if (otherH.length === 0) return;
        if (partyState.leaderId !== me) return;
        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishCombatEnd();
        }).catch(() => { /* offline */ });
    }, [selectedRaid]);
    // Drop-table modal state — id of the raid whose drops are being shown,
    // or null when no popup is open. Mirrors `dropModalDungeon` in Dungeon.
    const [dropModalRaidId, setDropModalRaidId] = useState<string | null>(null);
    const [speedMult, setSpeedMult] = useState(1);
    const [currentWave, setCurrentWave] = useState(0);
    const [bosses, setBosses] = useState<IRaidBossState[]>([]);
    const [members, setMembers] = useState<IRaidMemberState[]>([]);
    // Local log state removed — the unified CombatLogsModal renders from the
    // shared combatStore session log, which addLog now writes to directly.
    const [skillFx, setSkillFx] = useState<ISkillFx[]>([]);
    // Per-slot floating-damage numbers + per-slot themed skill animations
    // (overlaid on the actual targeted card, mirroring Dungeon/Boss/Combat).
    const fx = useCombatFx();
    const [dropsByMember, setDropsByMember] = useState<Record<string, IRaidDropLine[]>>({});
    // 2026-05-15 spec ("Dropy na raidzie sie nie zgadzaja"): items rolled
    // for every member (full IInventoryItem with generated stats). The
    // LEADER fills this from distributeRewards then it rides on the
    // raid-state broadcast — every other client applies their own
    // member-id slice into their inventory so the items shown in the
    // result panel ARE the items in their bag.
    const [itemsByMember, setItemsByMember] = useState<Record<string, IInventoryItem[]>>({});
    // Per-target hit pulses — bumped on EVERY distinct hit so the keyed flash
    // overlay in EnemyCard / AllyCard re-mounts and replays the CSS animation
    // even when multiple swings land in the same tick (raid bosses cleave
    // multiple members; multiple members single-target the same boss; AOE
    // skills tag every alive boss in one pass). Without these counters, the
    // flash would only show ONCE per ~300ms window even if 5 hits landed.
    // Boss key = boss id (raid bosses are identified by string id, not slot
    // index, because waves can swap bosses mid-fight). Member key = member id.
    const [bossHitPulses, setBossHitPulses] = useState<Record<string, number>>({});
    const [memberHitPulses, setMemberHitPulses] = useState<Record<string, number>>({});
    // 2026-05-15 v16 spec ("Teraz mam wrazenie ze nie widze wcale
    // animacji spelli potworow jak rzucaja spella na sojusznika
    // jakiegos"): per-ally attacking-class map. When a boss hits an
    // ally, we flash a strike overlay on the ALLY's card so the
    // player sees a visual "incoming attack" cue. Bosses don't carry
    // an `attack-XYZ` CSS class (they're not player classes), so we
    // use `attack-Necromancer` (dark/spell-flavoured visual) as the
    // generic monster-strike theme. Auto-clears after ATTACK_FLASH_MS.
    const [memberAttackingClass, setMemberAttackingClass] = useState<Record<string, string>>({});
    // Per-boss aggro pick — `bossId -> memberId currently being targeted`.
    // Set by the boss-attack tick whenever a boss picks a member to swing
    // at; surfaces in the ally cards as `aggroCount` so the player can see
    // who's about to eat the next round of swings. Refreshes every boss
    // attack cycle (~1.5 s @ X1) — enough to feel responsive without
    // constant flicker when 4 bosses re-roll in the same render.
    const [bossAggroIds, setBossAggroIds] = useState<Record<string, string>>({});

    // Per-boss "basic-attack flash" — `attackingClassName` set on the
    // matching boss card for ~ATTACK_ANIM_DURATION ms after the PLAYER
    // basic-attacks it. Drives the per-class slash / bolt / arrow visual
    // the hunting view uses (combat-ui__enemy--attack-Knight etc.).
    //
    // Bot party-mates don't flash here — 4 members swinging the same boss
    // every tick would just spam-overwrite the class string with no time
    // for the CSS animation to retrigger between frames; their hits are
    // already represented by class-tinted damage floats.
    //
    // Each flash carries a token (Date.now() + random) so a stale clear-
    // timer (e.g. when the player attacks twice in quick succession at
    // X4 speed) can't wipe a fresher overlay scheduled by the second hit.
    // Duration matches the per-class CSS keyframes so the class string
    // explicitly clears between hits -> animation re-triggers on the next
    // attack rather than just sitting there idle.
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
                // Only clear if THIS flash is still the active one. A
                // later flash (with a higher token) has already replaced
                // us; let its own timer handle the clear.
                if (prev[bossId]?.token !== token) return prev;
                const next = { ...prev };
                delete next[bossId];
                return next;
            });
        }, dur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Spawn-bar countdown — flips ON between waves while the next wave's
    // bosses are spawning. Matches the visual + behaviour used in Dungeon
    // and Transform so the player learns one cue across the app: thin
    // bar pinned under the header = "next monster incoming".
    const [waitingForSpawn, setWaitingForSpawn] = useState(false);
    const [spawnProgress, setSpawnProgress] = useState(0);

    // Mid-fight death-choice popup state. Flips ON the first tick the
    // player goes down WHILE other allies are still alive — gives them
    // the choice between bailing (apply penalty + nav to town) or
    // waiting for an ally rez. `playerWaitingResRef` is the persistent
    // intent flag the tick loop reads to roll the rez chance; once the
    // player picks "wait" the popup closes but the flag stays on until
    // either rez succeeds, the party wipes, or the player exits.
    // `playerDeathHandledRef` is a one-shot guard so the popup doesn't
    // re-open every tick while the player sits dead in the field.
    const [partyChoiceOpen, setPartyChoiceOpen] = useState(false);
    const [partyChoiceAlliesAlive, setPartyChoiceAlliesAlive] = useState(0);
    const playerWaitingResRef = useRef(false);
    const playerDeathHandledRef = useRef(false);
    // 2026-05-17 spec: one-shot latch so the unresurrected-at-result
    // death-penalty + overlay fires exactly once per raid run (the
    // result phase re-renders multiple times — without this we'd
    // stack penalties + open the death modal repeatedly).
    const resultDeathAppliedRef = useRef(false);
    const spawnStartRef = useRef<number>(0);
    const spawnDurationRef = useRef<number>(0);
    const cooldownsRef = useRef<MemberCooldownMap>({});
    const tickIdRef = useRef(0);
    const bossesRef = useRef<IRaidBossState[]>([]);
    const membersRef = useRef<IRaidMemberState[]>([]);
    const phaseRef = useRef<RaidPhase>('lobby');
    const fxIdRef = useRef(0);

    // Skill-effect session — shared status state across every ally + every
    // boss for DOTs, stuns, marks, immortality, dodges, AOE. Reset on every
    // raid start (see handleStart). Per-ally id = `ally_${memberId}`,
    // per-boss id = `boss.id` (already unique within the wave).
    const effectsRef = useRef<ICombatEffectsSession>(newCombatEffectsSession());
    const allyFxId = (memberId: string) => `ally_${memberId}`;

    // 2026-06-19: Cleric `heal_party_dot` (Błogosławieństwo) — raid has no
    // buffStore wiring (unlike Boss.tsx which leans on
    // getPartyHealDotPctPerSec), so the party-wide heal-over-time lives as a
    // shared spec here: how many GAME-ms of regen remain + how much %max HP
    // to heal each alive member per second. The status/DOT tick drains
    // `remainingMs` at speed-scaled rate and applies the per-tick slice,
    // accumulating fractional ms in `accumMs` so a 250ms tick at x1 heals
    // 1/4 of the per-second amount per pass. Reset on raid start; refreshed
    // (max-tier wins) when a member casts the skill. The casting member id +
    // skill id drive the heal-pulse anim/log so it reads like Boss's DOT.
    const partyHealDotRef = useRef<{
        remainingMs: number;
        pctPerSec: number;
        accumMs: number;
        skillId: string | null;
    }>({ remainingMs: 0, pctPerSec: 0, accumMs: 0, skillId: null });

    useEffect(() => { bossesRef.current = bosses; }, [bosses]);
    useEffect(() => { membersRef.current = members; }, [members]);

    // 2026-05-15 spec ("Popraw tylko animacje spelli potworow, jak
    // wyjdzie sojusznik z party podczas raidu, to spelle rzucaja sie
    // w niewlasciwy kafelek. Zmienila sie pozycja sojusznikow i
    // animacje spelli pokazuja sie na zlym kafelku tylko rzucanych
    // przez potwory"): defensive blanket — whenever the member roster
    // ID set changes (someone left, the array compacted, slot indices
    // shifted), wipe ally-side fx so any in-flight monster spell /
    // DOT float keyed by the OLD slot doesn't land on an empty (or
    // wrong) tile. Boss-side fx is intentionally untouched (boss
    // slots are stable). The earlier roster-sync + broadcast-shrink
    // hooks already call this in many paths; this is the catch-all.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [members]);
    useEffect(() => { phaseRef.current = phase; }, [phase]);

    // -- Potion cooldown ticker ------------------------------------------------
    // 100 ms decrement while fighting — drains the four potion-slot timers
    // (HP / %HP / MP / %MP) so re-clicks land at the right time. Mirrors
    // Boss / Combat: the dock shows a sweep over `cooldownProgress` and
    // disables the slot until the timer hits zero.
    useEffect(() => {
        if (phase !== 'fighting') return;
        // Cooldowns drain at ~SPEED × real time so the visible timer matches
        // how fast the engine ticks. At X4 the combat tick fires 4× faster
        // (every 125 ms instead of 500 ms), and a skill rolls off engine-CD
        // 4× faster too — so the visual countdown has to keep up or it
        // shows "still on CD" while the engine already let the next cast
        // through.
        const TICK_MS = 100;
        const id = setInterval(() => {
            const drain = TICK_MS * speedMult;
            setHpPotionCooldown((c) => Math.max(0, c - drain));
            setMpPotionCooldown((c) => Math.max(0, c - drain));
            setPctHpCooldown((c) => Math.max(0, c - drain));
            setPctMpCooldown((c) => Math.max(0, c - drain));
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

    // Status / DOT tick — drains stun timers + applies DOT damage on a
    // separate cadence (every 250 ms scaled by speed) so paralysed
    // combatants recover in real-time and DOTs deal their per-second slice
    // consistently. Routes damage through `effectsRouteDamage` so immortal /
    // cannotDie windows are honoured. Mutates `bossesRef` / `membersRef`
    // in place, then fires a single setBosses / setMembers from the same
    // arrays so React picks up the visible HP changes.
    useEffect(() => {
        if (phase !== 'fighting') return;
        // 2026-05-13: non-leader members do not run DOT ticks — raid state
        // mirrors the leader's authoritative HP tally instead.
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
            // 2026-06-19: the party heal-over-time (Cleric Błogosławieństwo)
            // also ticks here even when there are NO damage DOTs active, so we
            // can't early-return on empty dotResults anymore.
            const healDot = partyHealDotRef.current;
            const healDotActive = healDot.remainingMs > 0 && healDot.pctPerSec > 0;
            if (dotResults.length === 0 && !healDotActive) return;
            const nextBosses = bossesRef.current.map((b) => ({ ...b }));
            const nextMembers = membersRef.current.map((m) => ({ ...m }));
            let bossesDirty = false;
            let membersDirty = false;
            for (const r of dotResults) {
                if (r.dotDamage <= 0 && !r.darkRitualTriggered) continue;
                // Boss DOT / Ritual?
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
                            // 2026-05-14: mirror DOT tick to members
                            // (same :skull-and-crossbones: icon as boss). Visual float on
                            // the boss card so members don't see the
                            // HP bar silently shrink.
                            const dotPushSlot = bIdx;
                            fx.pushEnemyFloat(dotPushSlot, apply.appliedDmg, 'spell', { icon: 'skull-and-crossbones' });
                            if (isLeaderInPartyCombat) {
                                const dotDmgCap = apply.appliedDmg;
                                const bIdCap = b.id;
                                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                    usePartyCombatSyncStore.getState().publishRaidDamage({
                                        // attackerId 'player' as a synthetic
                                        // "ally side" marker — DOT was
                                        // applied by some ally's spell, but
                                        // the original caster credit is
                                        // dropped (matches boss's pattern).
                                        attackerId: 'player',
                                        targetId: bIdCap,
                                        damage: dotDmgCap,
                                        kind: 'spell',
                                        icon: 'skull-and-crossbones',
                                    });
                                }).catch(() => { /* offline */ });
                            }
                        }
                    }
                    // 2026-05 v7: Mroczny Rytuał detonation. % of boss
                    // max HP, no DEF mit.
                    if (r.darkRitualTriggered && r.darkRitualDamage > 0 && !b.isDead) {
                        const ritualDmg = Math.min(b.currentHp, r.darkRitualDamage);
                        b.currentHp = Math.max(0, b.currentHp - ritualDmg);
                        if (b.currentHp <= 0) b.isDead = true;
                        bossesDirty = true;
                        // 2026-05-14: ritual float on the boss card +
                        // broadcast so member sees the same :skull: RITUAL.
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
                            }).catch(() => { /* offline */ });
                        }
                    }
                    continue;
                }
                // Member DOT?
                // 2026-05-15 v11: filter escapees so the DOT tick float
                // lands on the RENDERED slot, not the broadcast-roster
                // slot that may include phantom escapees during the
                // post-flee window before cleanup catches up.
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
                    // 2026-05-14: member DOT float + broadcast so the
                    // ally card shows the bleed tick on every screen.
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
                        }).catch(() => { /* offline */ });
                    }
                }
            }
            // 2026-06-19: Cleric `heal_party_dot` (Błogosławieństwo) tick.
            // Drain `remainingMs` at speed-scaled rate (same cadence the DOT
            // damage uses). Accumulate elapsed game-ms and, every whole
            // game-second, heal each ALIVE member pctPerSec/100 × THEIR max HP,
            // clamped to maxHp. Float lands on the local player's slot only;
            // bots/remote bars top up next render (matching the DOT-damage +
            // cast heal handlers, which avoid AOE-rate ally float spam).
            if (healDotActive) {
                const elapsed = TICK_MS * speedMult;
                // Only credit the accumulator with ms that fall WITHIN the
                // regen window so the final partial tick doesn't over-heal
                // past expiry; then drain the timer.
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

    // -- Potion-use handler ----------------------------------------------------
    // Parses the elixir's `effect` string ("heal_hp_50" / "heal_hp_pct_20"
    // etc.) to compute the heal amount, applies it to the local player
    // member's HP/MP, syncs the new pool back to the character store, and
    // decrements the consumable. Cooldowns mirror Combat: 1 s flat / 0.5 s pct.
    const useRaidPotion = useCallback((potionId: string) => {
        if (!character) return;
        const inv = useInventoryStore.getState();
        const owned = inv.consumables[potionId] ?? 0;
        if (owned <= 0) return;

        const elixir = ELIXIRS.find((e) => e.id === potionId);
        if (!elixir) return;
        const eff = elixir.effect; // e.g. "heal_hp_50" or "heal_hp_pct_20"
        const isHp = eff.startsWith('heal_hp');
        const isMp = eff.startsWith('heal_mp');
        if (!isHp && !isMp) return;

        const isPct = eff.includes('_pct_');
        const numStr = eff.split('_').pop() ?? '0';
        const value = parseInt(numStr, 10) || 0;

        // Resolve effective max from the live character — equipment / elixir
        // / transform buffs may have shifted the cap since raid entry.
        const effChar = getEffectiveChar(character);
        const liveMaxHp = effChar?.max_hp ?? character.max_hp;
        const liveMaxMp = effChar?.max_mp ?? character.max_mp;

        const max = isHp ? liveMaxHp : liveMaxMp;
        const heal = isPct ? Math.floor(max * (value / 100)) : value;

        // Apply to local member state + sync to store. The members array
        // is also used by the tick loop, so we update it via setMembers
        // (with the live ref) so the next tick reads the healed value.
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

        // Set cooldown for the matching slot.
        if (isHp && isPct) setPctHpCooldown(PCT_CD_MS);
        else if (isHp) setHpPotionCooldown(HP_POTION_CD);
        else if (isMp && isPct) setPctMpCooldown(PCT_CD_MS);
        else setMpPotionCooldown(MP_POTION_CD);

        useCombatStore.getState().addSessionLog(
            `:test-tube: Użyto: ${elixir.name_pl} (+${heal.toLocaleString('pl-PL')} ${isHp ? 'HP' : 'MP'})`,
            'system',
        );
    }, [character]);

    // Manual-skill click handler — pushes the slot index onto the queue. The
    // raid combat tick (further below) drains this queue first before the
    // auto-cast block fires, so a manual cast always takes priority over
    // the bot-style auto-pick.
    //
    // 2026-05-17 spec ("wylaczylem auto spelle i nie moge ich uzywac klikam
    // non stop manualnie spella i nie dziala"): non-leader members don't run
    // the combat tick (it's leader-authoritative), so a local
    // `skillQueueRef.push(...)` would never drain. We resolve the slot to a
    // skill id locally and broadcast a `member-skill-request` instead — the
    // leader's engine pops it from `consumeMemberSkillRequest(memberId)` and
    // treats it as a manual cast for that member's slot (same MP/CD checks).
    //
    // 2026-05-17 v2 ("Nie moge uzywac manualnie spelli, klikam caly czas w
    // party podczas raidu przykladowo i nie dziala nic"): use the STATIC
    // import (synchronous) so the publish actually fires before the user's
    // click handler exits — the dynamic-import path waited a microtask /
    // module fetch, which under certain HMR conditions resolved AFTER the
    // user already moved on. Also stamp a local visual cooldown on the
    // member's slot so they see immediate "click registered" feedback (the
    // server-roundtrip animation lands ~200ms later when the leader's tick
    // broadcasts the damage event).
    const queuePlayerSkill = useCallback((slotIdx: 0 | 1 | 2 | 3) => {
        if (isNonLeaderMember) {
            const myId = character?.id;
            if (!myId) return;
            const skillId = activeSkillSlots[slotIdx];
            if (!skillId) return;
            usePartyCombatSyncStore.getState().publishMemberSkillRequest(myId, skillId);
            // Local visual feedback: stamp the slot's cooldown so the
            // action bar greys out briefly. Resolves from the skills
            // table; falls back to 1500ms when the def isn't loaded.
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

    // -- Level-up mid-fight = full HP/MP refill -------------------------------
    // characterStore.addXp() already tops the persistent character pool to
    // max on level-up, but THIS view holds the player's live HP/MP inside
    // its `members` array. The next combat tick syncs back FROM members TO
    // the store, so without this hook the just-refilled store values would
    // get overwritten by the stale member entry on the very next tick.
    // Find the player by id and reset their hp/mp/maxHp/maxMp to the new
    // post-level-up maxima so the buff is visible immediately.
    useLevelUpRefill(phase === 'fighting', useCallback((maxHp, maxMp) => {
        const myId = character?.id;
        if (!myId) return;
        setMembers((prev) => prev.map((m) =>
            m.id === myId ? { ...m, hp: maxHp, mp: maxMp, maxHp, maxMp } : m
        ));
    }, [character?.id]));

    // 2026-05-14 spec ("Jak zginal sojusznik i wrocil do miasta to nie
    // zniknal z walki a powinien od razu zniknac z widoku walki i na
    // nowo powinno sie agroo potworow wyrenderowac na reszcie
    // uczestnikow party"): leader-side roster sync. When the
    // `party.members` row changes (e.g. a member leaves via the
    // death-popup -> leaveParty path), drop them from the local
    // `members[]` AND clear any boss aggro pointing at them. Without
    // this, the leaver's card stayed visible at 0 HP and one or more
    // bosses kept "aggroing" a ghost slot for ~1.5 s until the
    // re-pick fired. We also blow away the stale aggro map so the
    // next 3-tick aggro roll picks from the live roster on the very
    // next swing. Members mirror this via the next raid-state
    // broadcast.
    useEffect(() => {
        if (phase !== 'fighting') return;
        if (!party || !character) return;
        // 2026-05-15 v13 spec ("dalej tak zeby ikonka tej tarczy i
        // wszystkie inne byly na kafelku postaci a nie na pustym
        // kafelku"): cleanup runs on EVERY client, not just the
        // leader. The previous "leader-only" gate created a race
        // window during leader handoff — between Krasek leaveParty
        // (which makes party.leaderId temporarily null/unchanged)
        // and the transferLeadership broadcast settling, NEITHER
        // client was the recognized leader on Knight's screen, so
        // the cleanup never ran. Knight's local members[] kept
        // Krasek's phantom, the next render pinned uiAllies[0] to
        // Krasek's faded card (with skull), and every boss attack
        // float landed on uiAllies[1] — Knight's old slot, now an
        // empty padding tile. By dropping the leader gate any
        // client that locally sees a phantom member cleans it up.
        const partyIds = new Set(party.members.map((m) => m.id));
        const localMembers = membersRef.current;
        // Also treat hasEscaped as "departed" so escapees never
        // linger in the array waiting for the partyIds sync.
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
                    continue; // drop this boss's aggro pick — re-rolls on next tick
                }
                next[bossId] = memberId;
            }
            return changed ? next : prev;
        });
        // 2026-05-15 spec ("Jezeli ktos wyjdzie z party podczas raidu i
        // znika jakis sojusznik z widoku walki to animacje ataku
        // potworow zle sie pokzuja nie w tym miejscu co powinny a
        // czasami na kafelku co jest pusty"): allyFloats / allySkill /
        // allySummonSpawn are keyed by SLOT INDEX. When the roster
        // shrinks, the surviving members shift to lower slot indices
        // and the padding (null) tiles inherit the OLD floats from the
        // departed member's slot. Drop every pending ally-side
        // animation so the very next tick lands on the fresh slot
        // layout. Enemy/boss-side animations stay (boss slots are
        // stable, no shift happens there).
        fx.resetAllyFx();
    }, [party, phase, character?.id, fx]);

    // -- URL-leave / tab-close = death (anti-cheat) -------------------------
    // Same anti-cheat guard as Dungeon/Boss — if the player navigates away
    // mid-fight (back, address bar, tab close) we treat it as a real wipe.
    // Note: raid wipes don't normally log to the deaths feed (see handleWipe),
    // but for the leave-cheat case we DO want a log entry — players cheating
    // via URL should see their name on the public feed of shame.
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

    // Mirror every log line to the shared combat session feed so the unified
    // CombatLogsModal sees the same stream every other view sees. Raid only
    // produces 'system'-flavored lines (no per-attack damage flooding).
    const addLog = useCallback((text: string) => {
        useCombatStore.getState().addSessionLog(text, 'system');
    }, []);

    // -- Build member states from party + character ---------------------------
    const buildMemberStates = useCallback((): IRaidMemberState[] => {
        if (!character || !party) return [];
        const transformColor = useTransformStore.getState().getHighestTransformColor();
        const transformTier = useTransformStore.getState().getHighestCompletedTransform?.() ?? 0;
        return party.members.map((m) => {
            const isMe = m.id === character.id;
            if (isMe) {
                // 2026-05-18 spec ("Nic nigdy nie powinno mi samemu
                // odnawiac HP i MP poza HP i MP regen oraz potionami"):
                // raid entry CARRIES the live HP/MP pool — no free
                // heroic-recovery refill on Ponów / new raid start.
                // Dead-but-waiting members still spawn dead so a
                // Cleric mid-fight rez is required to bring them back
                // (matches the existing "Czekaj na wskrzeszenie" flow).
                //
                // CRITICAL: read max_hp/max_mp/attack/defense via
                // `getEffectiveChar` so the raid honours equipment,
                // training, elixir & transform bonuses.
                const eff = getEffectiveChar(character) ?? character;
                // Gear-gap penalty (leader only): under-geared players deal
                // proportionally less damage so low-level gear can't carry a
                // far-higher-level raid. dmg × (gearLvl/raidLvl)², floor 0.05.
                // Bots / non-leader humans are untouched (their attack comes
                // from presence / the bot-tier formula below).
                const raidLevel = selectedRaidRef.current?.level ?? 0;
                const leaderGearGapMult = getGearGapMultiplier(
                    getEquippedGearLevel(useInventoryStore.getState().equipment),
                    raidLevel,
                );
                const leaderAttack = Math.floor(eff.attack * leaderGearGapMult);
                const stayDead = (character.hp ?? 0) <= 0;
                // Clamp current pool to the live max — equipment
                // changes between raids could lower max_hp below the
                // stored character.hp, and starting above max would
                // wedge the regen tick.
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
            // 2026-05-14 spec ("Teraz tak wszystko zrob identycznie
            // jak w polowaniu i bossie"): for HUMAN party-mates pull
            // the live HP/MP/maxHp/maxMp/transformTier snapshot from
            // partyPresenceStore (broadcast by every member's own
            // client) so the leader's raid screen shows the SAME bars
            // as that player's local view — instead of a level-by-60
            // approximation that drifted by an order of magnitude past
            // level 100. Falls back to the level approximation only
            // when no snapshot has arrived yet OR when the slot is an
            // AI bot (bots don't broadcast presence).
            //
            // 2026-05-18 spec ("Nic nigdy nie powinno mi samemu
            // odnawiac HP i MP poza HP i MP regen oraz potionami"):
            // carry the LIVE current HP/MP from the presence snapshot
            // (or fall back to max for bots, which never persist a
            // partial pool). Dead-not-resurrected members still spawn
            // dead so the Czekaj-na-wskrzeszenie flow keeps working.
            const presenceSnap = !m.isBot
                ? usePartyPresenceStore.getState().byMember[m.id]
                : null;
            const fallbackHp = Math.max(100, m.level * 60);
            const fallbackMp = Math.max(40, m.level * 30);
            const hpMax = presenceSnap?.maxHp ?? fallbackHp;
            const mpMax = presenceSnap?.maxMp ?? fallbackMp;
            // 2026-05-14 spec ("zalicza mu raid / bossa jako zrobionego
            // ... ale ponownym rozpoczeciu caly czas jest nie zywy"):
            // if a HUMAN teammate's broadcast snapshot shows them at
            // 0 HP (Czekaj-dead from the previous attempt) they spawn
            // dead in this attempt too — only a Cleric mid-fight rez
            // can put them back into the fight. AI bots never die
            // between raids so their fallback HP path stays alive.
            const stayDeadOther = !!presenceSnap && presenceSnap.hp <= 0 && presenceSnap.maxHp > 0;
            // Carry live HP/MP from the presence snapshot for humans;
            // bots start at full (they don't persist between fights).
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
                // 2026-06-19 spec ("party damage ignoruje ekwipunek
                // sojusznikow"): for a HUMAN party-mate use their REAL
                // effective attack/defense broadcast via presence (base +
                // gear + upgrades + training + elixirs + transform) so a
                // geared friend contributes their actual power instead of
                // the `5 + level*3` bot-tier approximation. Falls back to
                // the formula when no snapshot has arrived yet, when the
                // slot is an AI bot, or when the snapshot comes from an
                // older client without these fields (safe degrade).
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

    // -- Defensive skill-slot purge ------------------------------------------
    // Whenever the player's level changes (level-up, death penalty, manual
    // intervention) sweep the active skill slots and clear any whose
    // unlock-level now exceeds the new level. Catches deaths that happened
    // before the death-time purge landed, plus any future level-loss path
    // that forgets to call purge directly.
    useEffect(() => {
        if (!character) return;
        useSkillStore.getState().purgeLockedSkillSlots(character.class, character.level);
    }, [character?.class, character?.level]);

    // 2026-05-12 spec ("popup z przywolaniem przed bossem / raidem"):
    // routes the click through `requestPartyCombatStart`. Solo/leader
    // path runs `startRaid` (immediate or queued for go); non-leader
    // member silently no-ops. Member-side go-handling is in the
    // mount effect below.
    const handleEnterRaid = useCallback(async (raid: IRaid) => {
        // Backend-mode (opt-in): autorytatywny serwer rozstrzyga cały rajd
        // jednym wywołaniem POST /raid/{id}/resolve — bez klienckiego
        // ready-checka, animacji wejścia czy pętli walki. Wzór jak w
        // Boss/Dungeon: resolve -> syncFromBackend -> feedback, a błąd nie
        // wywala gry. Return PRZED starą ścieżką, która zostaje nietknięta.
        const liveChar = useCharacterStore.getState().character;
        if (isBackendMode() && liveChar) {
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
            return; // non-leader: silent no-op
        }
        requestPartyCombatStart({
            destination: '/raid',
            label: `Raid: ${raid.name_pl}`,
            payload: { raidId: raid.id },
            onConfirmed: () => startRaid(raid),
        });
    // startRaid is defined below — captured via closure of latest render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Member-side: subscribe to the go-replicator's local trigger
    // (`pendingRaidEntryAt`) so we only start the raid AFTER the
    // leader's `go` event fires. The trigger is bumped from
    // `registerGoReplicator('/raid', …)` above, which is invoked from
    // AppShell's `useReadyCheckGoEffect` once `open` flips false. The
    // previous mount-time read of `partyReadyCheckStore.destination`
    // raced the OPEN phase and dropped the member straight into combat
    // behind the popup; this subscriber waits for the explicit
    // confirmation instead.
    const lastRaidEntryAtSeenRef = useRef(0);
    useEffect(() => {
        const me = character?.id;
        if (!me) return;
        let unsub: (() => void) | null = null;
        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            // Seed the seen-at so a stale value from a previous fight
            // doesn't re-fire on mount.
            lastRaidEntryAtSeenRef.current = usePartyCombatSyncStore.getState().pendingRaidEntryAt;
            unsub = usePartyCombatSyncStore.subscribe((state) => {
                const at = state.pendingRaidEntryAt;
                if (!at || at === lastRaidEntryAtSeenRef.current) return;
                lastRaidEntryAtSeenRef.current = at;
                const raidId = state.pendingRaidEntryRaidId;
                if (!raidId) return;
                const partyState = usePartyStore.getState().party;
                // Leader's pendingGoAction path runs startRaid directly
                // — skip the replicator on the leader.
                if (partyState && partyState.leaderId === me) return;
                const raid = getAllRaids().find((r) => r.id === raidId);
                if (!raid) return;
                // Defer to next tick so startRaid (defined later in
                // this component) is in scope by the time we call it.
                setTimeout(() => startRaid(raid as IRaid), 0);
            });
        }).catch(() => { /* offline */ });
        return () => { unsub?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character?.id]);

    // -- Start raid ----------------------------------------------------------
    const startRaid = useCallback((raid: IRaid) => {
        if (!consumeAttempt(raid.id)) {
            addLog('Brak dostępnych prób dzisiaj dla tego rajdu.');
            return;
        }
        // 2026-05-18 spec ("Nic nigdy nie powinno mi samemu odnawiac
        // HP i MP poza HP i MP regen oraz potionami"): the old
        // "fullHealEffective on raid start" auto-refill is gone.
        // buildMemberStates now carries character.hp/mp into the new
        // raid (clamped to live max). Dead-not-resurrected players
        // still spawn dead — that's handled by the `stayDead` check
        // in buildMemberStates itself.
        setSelectedRaid(raid);
        setCurrentWave(0);
        const waveBosses = generateWaveBosses(raid, 0);
        setBosses(waveBosses);
        const newMembers = buildMemberStates();
        setMembers(newMembers);
        cooldownsRef.current = {};
        // Pulse counters carry between fights without harm (keys are unique
        // boss/member ids), but resetting keeps state lean across many runs.
        setBossHitPulses({});
        setMemberHitPulses({});
        // Clear leftover floats / skill overlays from any previous run.
        fx.resetFx();
        // Reset shared session log to a clean slate, then post the opener.
        useCombatStore.getState().clearCombatSession();
        useCombatStore.getState().addSessionLog(
            `:crossed-swords: Rajd "${raid.name_pl}" rozpoczęty! Fala 1/${raid.waves}`,
            'system',
        );
        setDropsByMember({});
        // Fresh raid = fresh leave-guard cycle. Also clear any leftover
        // mid-fight-death state from a previous run so the choice popup
        // arms cleanly the first time the player goes down this run.
        leavePenaltyAppliedRef.current = false;
        playerWaitingResRef.current = false;
        playerDeathHandledRef.current = false;
        // 2026-05-17: re-arm the unresurrected-at-result death latch
        // so the next raid run can fire its own death penalty.
        resultDeathAppliedRef.current = false;
        setPartyChoiceOpen(false);
        setPartyChoiceAlliesAlive(0);
        // Fresh effect session — clear all timers / DOTs / queues from prior
        // raids so a leftover stun doesn't carry over into the next run.
        effectsRef.current = newCombatEffectsSession();
        // Reset any leftover Cleric party heal-over-time so a Błogosławieństwo
        // cast at the end of the previous raid doesn't bleed into this one.
        partyHealDotRef.current = { remainingMs: 0, pctPerSec: 0, accumMs: 0, skillId: null };
        // Drop every member's necro summons — fresh raid, fresh undead.
        useNecroSummonStore.getState().clearAll();
        setPhase('fighting');
    }, [buildMemberStates, consumeAttempt, addLog, fx]);

    // -- Party-shared raid combat (2026-05-13) --------------------------------
    // Leader-side: publish authoritative raid-state on every meaningful
    // change. Throttled internally (~120 ms); phase + wave changes go
    // through immediately so the member's UI advances together.
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
                // 2026-05-14: ride speed + aggro picks + party-damage
                // tally so members converge to the leader's view.
                speedMode,
                aggroTargetIds: bossAggroIds,
                partyDamage: { ...usePartyDamageStore.getState().damage },
                // 2026-05-15 spec ("Dropy na raidzie sie nie zgadzaja"):
                // ship the leader's authoritative drop roll for every
                // member alongside the items (full IInventoryItem with
                // generated stats) so all clients render IDENTICAL
                // tiles and every member's bag gets the exact gear
                // shown on the result panel. Only meaningful when
                // phase === 'victory' — pre-victory snapshots leave
                // these fields undefined so the throttle isn't bloated
                // for every regular state tick.
                dropsByMember: phase === 'victory' ? dropsByMember : undefined,
                itemsByMember: phase === 'victory' ? itemsByMember : undefined,
            });
        }).catch(() => { /* offline */ });
    }, [isLeaderInPartyCombat, selectedRaid, phase, currentWave, bosses, members, speedMult, bossAggroIds, dropsByMember, itemsByMember]);

    // Member-side: subscribe to leader's authoritative raid-state and
    // mirror it locally so the screen reflects the leader's view 1:1.
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
                // 2026-05-15 spec ("Jezeli ktos wyjdzie z party podczas
                // raidu ... animacje ataku potworow zle sie pokzuja
                // nie w tym miejscu co powinny a czasami na kafelku
                // co jest pusty") + 2026-05-15 v2 ("Ta ikonka powinna
                // byc na knightcie. poprzedni lider wyszedl z raidu i
                // knight zmienil swoja pozycje wiec animacja ataku
                // spelli potworow tez powinna zmienic pozycje"): wipe
                // ally fx whenever the member-ID SIGNATURE changes
                // (someone left OR roster reordered after leader
                // hand-off). Length-only check missed reorders where
                // length stays equal — Knight from slot 1 -> slot 0
                // after the previous leader leaves would leave stale
                // `fx.allyFloats[1]` ghosting onto the now-empty
                // top-right tile. Also bumps `membersRef.current`
                // BEFORE the React state update so the very next
                // damage-broadcast tick computes the correct slot
                // from the fresh roster, not the stale one.
                // 2026-05-15 v12 spec ("po odejsciu podczas walki kogos
                // wszystkie animacje ataku spellami potworow pokazywaly
                // sie w odpowiedniej i poprawnej pozycji uwzglednionej
                // zmiana pozycji sojusznikow na widoku walki w raidzie"):
                // BEFORE storing the incoming roster, drop any member
                // with `hasEscaped: true`. The leader's last broadcast
                // before fleeing carries themselves with hasEscaped=true,
                // and if that broadcast arrives AFTER the new-leader
                // cleanup useEffect already filtered them out, the
                // subscriber re-inserts the phantom and the next boss
                // attack lands on the wrong slot. Filtering at the
                // intake means escaped members never enter local state
                // — the engine tick + the receiver subscriber + the
                // uiAllies builder all agree on the same roster.
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
                // 2026-05-14 spec ("Jezeli w bossie i raidzie zginie
                // sojusznik i na popupie kliknie ze nie wraca do
                // miasta i czeka a nikt go nie wskrzesi to ... ponownym
                // rozpoczeciu caly czas jest nie zywy"): persist our
                // own HP/MP from the leader's authoritative members[]
                // into the local character store. The member never runs
                // the engine tick, so without this their `character.hp`
                // stayed at the pre-raid value — a Czekaj-dead member
                // had local hp > 0 and `buildMemberStates` would spawn
                // them alive on the next attempt instead of dead.
                const meId = useCharacterStore.getState().character?.id;
                const meInState = meId ? s.members.find((m) => m.id === meId) : null;
                if (meInState) {
                    useCharacterStore.getState().updateCharacter({
                        hp: meInState.hp,
                        mp: meInState.mp,
                    });
                    // 2026-05-14 spec ("Jak zginal sojusznik to nie
                    // wyskoczyl mu popup czy chce zostac w walce czy
                    // wychodzic z party i wraca do miasta i wtedy
                    // animacja smierci jak w bossie"): when the
                    // broadcast flips us to dead with at least one
                    // ally still up, raise the PartyDeathChoice on the
                    // MEMBER's view too — previously only the leader's
                    // local tick set this state, so member screens just
                    // showed an unresponsive 0-HP card until the leader
                    // either won or wiped. Boss does the same in its
                    // member subscriber (`meAlly.hp <= 0 ->
                    // setDeathChoicePopup(true)`).
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
                // 2026-05-14 spec ("W dropie cos sie nie zgada kazdy
                // powinien dostac drop tak jak jest u gory"): when the
                // leader's broadcast flips into 'victory' for the
                // first time, run distributeRewards LOCALLY so the
                // member's own client rolls their own drops, credits
                // their own char with XP/gold/items, and the result
                // panel actually shows the per-member drop tiles.
                // Without this, member's view sat at "Brak dropu — pech
                // tej tury" because dropsByMember was empty.
                //
                // Re-arm the latch when phase exits result so the next
                // raid victory triggers again.
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
                    // 2026-05-15 spec ("Dropy na raidzie sie nie
                    // zgadzaja. Powinien kazdy widziec co inni gracze
                    // otrzymali z dropu"): the leader's broadcast now
                    // carries the authoritative `dropsByMember` +
                    // `itemsByMember` rolled ONCE on the leader's
                    // client. Use that verbatim — show every tile
                    // exactly as leader rolled it, AND drop the local
                    // player's items + chests + xp + gold into their
                    // own stores. Fall back to a local re-roll if the
                    // broadcast didn't carry rewards (older client
                    // compatibility / offline mode).
                    if (s.dropsByMember) {
                        setDropsByMember(s.dropsByMember);
                        if (s.itemsByMember) setItemsByMember(s.itemsByMember);
                        const myMeId = useCharacterStore.getState().character?.id ?? '';
                        const myDrops = s.dropsByMember[myMeId] ?? [];
                        const myItems = s.itemsByMember?.[myMeId] ?? [];
                        // Compute XP + gold from the drop list (lines
                        // tagged 'xp' / 'gold' carry the .amount).
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
                        // Defer one tick so the state above commits before
                        // distributeRewards reads members — guarantees the
                        // rolled drops attach to the just-updated roster.
                        const raidCap = raid as IRaid;
                        const membersCap = s.members;
                        setTimeout(() => distributeRewards(raidCap, membersCap), 0);
                    }
                }
                setPhase(s.phase);
                phaseRef.current = s.phase;
                // 2026-05-14 spec ("Teraz tak wszystko zrob identycznie
                // jak w polowaniu i bossie"): apply leader's speed,
                // aggro picks, party-damage tally on every snapshot so
                // a late-joining member converges within one beat.
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
                    }).catch(() => { /* offline */ });
                }
            });
        })();
        return () => { void unsubP.then((fn) => fn?.()); };
    }, [isNonLeaderMember]);

    // 2026-05-14 spec ("Teraz tak wszystko zrob identycznie jak w
    // polowaniu i bossie"): per-hit raid damage subscriber that
    // replays floats + class-swing pulses on the member's local arena
    // so every animation looks identical to the leader's screen.
    // Mirrors Boss.tsx's `lastBossDamageByAttacker` watcher — map
    // iteration with per-key reference dedupe handles same-ms bursts
    // (e.g. 4 bosses cleaving 4 members in one tick).
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

                    // 2026-05-18 spec ("sokole oko nie powinno pokazywac
                    // sie na potworze na zadnym ekranie"): if an ally
                    // broadcast a self-target buff (attackerId === targetId,
                    // both = a member id), route to ALLY float + ally skill
                    // anim on the caster's card. Without this the buff event
                    // fell into the "ally hits boss" branch below, found no
                    // boss with id === memberId, and was silently dropped on
                    // member screens (while the leader's local view still
                    // landed the cue on the wrong target). Detect by
                    // matching `targetId` against the live members roster.
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
                    // Ally hits a boss -> enemy float on the matching
                    // boss slot + class-swing pulse on that card.
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
                            // 2026-05-14 spec ("Nie widze animacji spelli
                            // przeciwnika na ekranie sojusznika"): on
                            // every ally-on-boss spell hit, also push
                            // an entry into the global arena `skillFx`
                            // queue so the member sees the same
                            // full-arena themed overlay the leader's
                            // tick fires at Raid.tsx:1929. Per-slot
                            // overlay already fires above; the arena
                            // one is the missing piece.
                            fx.triggerEnemySkillAnim(bossSlot, ev.skillId);
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
                    // Boss hits an ally -> ally float on the matching
                    // member slot. `targetId` is the member id; we
                    // resolve to a slot via the FRESH raid state's
                    // members rather than `membersRef.current` so a
                    // late-arriving damage event right after the
                    // roster shifted (e.g. leader handoff) still lands
                    // on the correct slot. Falls back to membersRef
                    // when lastRaidState isn't populated yet.
                    // 2026-05-15 v11: filter out hasEscaped so the slot
                    // index matches the RENDERED roster (uiAllies
                    // applies the same filter). Otherwise a late-
                    // arriving damage event pushed onto fx.allyFloats[N]
                    // where N is the broadcast-roster index lands on
                    // the wrong card (or an unrendered slot) once the
                    // visible layout shifts due to a flee.
                    const stateMembersAll = state.lastRaidState?.members ?? membersRef.current;
                    const stateMembers = stateMembersAll.filter((m) => !m.hasEscaped);
                    const memSlot = stateMembers.findIndex((m) => m.id === ev.targetId);
                    if (memSlot < 0) continue;
                    // 2026-05-15 v16: mirror the leader's strike
                    // overlay flash on the target's card so every
                    // client sees the same "incoming attack" anim.
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
                    // Only bump the hit-pulse for actual damage events
                    // (dodge / UNIK ships damage=0 and shouldn't flash
                    // the card red).
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

    // -- Combat tick loop -----------------------------------------------------
    useEffect(() => {
        if (phase !== 'fighting') return;
        // 2026-05-13: members mirror the leader's authoritative state;
        // their own tick must NOT run or we'd get parallel copies.
        if (isNonLeaderMember) return;
        const interval = setInterval(() => {
            tickIdRef.current += 1;
            const tick = tickIdRef.current;

            // Members act
            const curMembers = membersRef.current;
            const curBosses = bossesRef.current;
            const aliveBosses = curBosses.filter((b) => !b.isDead);
            // 2026-05-15 spec ("idealnie po zabiciu wszystkich potworow
            // ucieknal z pierwszej fali i wtedy zawiesza sie walka
            // raidu dla reszty sojusznikow"): the old `return` here
            // short-circuited the ENTIRE tick body when bosses were
            // all dead — meaning the wave-transition check at the
            // bottom never ran. When a new leader inherited an
            // all-dead state from the previous leader's last
            // broadcast (right before that leader fled), their tick
            // bailed every cycle and the raid froze on the cleared
            // wave forever. We now skip only the action-processing
            // block and let the wave/wipe checks at the bottom run.
            const skipActions = aliveBosses.length === 0
                || curMembers.every((m) => m.isDead || m.hasEscaped);

            const nextMembers = curMembers.map((m) => ({ ...m }));
            const nextBosses = curBosses.map((b) => ({ ...b }));
            const fxQueue: ISkillFx[] = [];

            // Skip the entire action-processing block when there's
            // nothing actionable. Fall through to the wave/wipe
            // checks below so the loop can still transition.
            if (skipActions) {
                setBosses(nextBosses);
                setMembers(nextMembers);
                // Wave / raid end checks
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

            // -- Auto-potion check (player only) -------------------------------
            // Mirrors the hunting / boss / dungeon auto-potion: every tick we
            // check whether HP / MP have fallen below the configured
            // threshold and whether a matching potion is owned + off-cooldown.
            // The heal is applied INLINE on `nextMembers[player]` — calling
            // the React `useRaidPotion` callback would race with the end-of-
            // tick `setMembers(nextMembers)` / `updateCharacter({ hp: me.hp })`
            // and the just-applied heal would get overwritten before the
            // next render. So the consumable + cooldown side-effects fire
            // from here directly, and `me.hp` / `me.mp` are mutated in place.
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
                        // Resolve the potion id with a fallback chain — if
                        // the configured potion isn't owned, pick the best
                        // owned variant of the same flat-vs-pct tier so the
                        // auto-potion still fires instead of silently
                        // skipping (the legacy bug — user runs out of e.g.
                        // `hp_potion_md` but has stacks of `hp_potion_lg`,
                        // and the auto stays inert because it only checked
                        // the configured id).
                        const candidatePool = which === 'hp'
                            ? (isPct ? PCT_HP_POTIONS : FLAT_HP_POTIONS)
                            : (isPct ? PCT_MP_POTIONS : FLAT_MP_POTIONS);
                        let potionId = configuredId;
                        if (!potionId || (inv.consumables[potionId] ?? 0) <= 0) {
                            // Highest-tier owned wins (same logic that
                            // `getBestPotion` uses for the manual dock).
                            const ownedPool = candidatePool
                                .filter((p) => (inv.consumables[p.id] ?? 0) > 0);
                            if (ownedPool.length === 0) return;
                            potionId = ownedPool[ownedPool.length - 1].id;
                        }
                        // Read cooldowns from refs — the combat-tick callback
                        // captures `[phase, speedMult]` deps, so the
                        // useState values would be stale across renders
                        // and auto-potion would think the slot is on
                        // cooldown forever after the first manual click.
                        const cdActive = isPct
                            ? (which === 'hp' ? pctHpCooldownRef.current : pctMpCooldownRef.current) > 0
                            : (which === 'hp' ? hpPotionCooldownRef.current : mpPotionCooldownRef.current) > 0;
                        if (cdActive) return;
                        const cur = which === 'hp' ? me.hp : me.mp;
                        const max = which === 'hp' ? me.maxHp : me.maxMp;
                        if (max <= 0) return;
                        const pct = (cur / max) * 100;
                        if (pct >= thresholdPct) return;

                        // Resolve the heal amount from the elixir effect string
                        // (`heal_hp_50` / `heal_hp_pct_20` / `heal_mp_*`).
                        const elixir = ELIXIRS.find((e) => e.id === potionId);
                        if (!elixir) return;
                        const numStr = elixir.effect.split('_').pop() ?? '0';
                        const value = parseInt(numStr, 10) || 0;
                        const heal = isPct ? Math.floor(max * (value / 100)) : value;

                        // In-tick mutation — directly land the heal on
                        // `nextMembers[player]` so the end-of-tick state
                        // sync writes the post-heal value, not the pre-heal
                        // one. Cooldown + consumable consumption + log fire
                        // here too so they don't race with React batching.
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

            // -- Resurrection roll (only when the player chose to wait) -------
            // Every ~4 ticks (≈2s at x1) any alive ally rolls a small chance
            // to revive the downed player. Chance scales with number of
            // helpers so a full 4-person backup recovers the player in a
            // reasonable window without trivializing the death cost.
            // Capped at 30% per attempt — even a stacked Cleric party
            // shouldn't make death meaningless.
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
                            // Re-arm the death-popup gate so a SECOND death
                            // later this run shows the choice again.
                            playerDeathHandledRef.current = false;
                        }
                    }
                }
            }

            for (let mi = 0; mi < nextMembers.length; mi++) {
                const mem = nextMembers[mi];
                if (mem.isDead || mem.hasEscaped) continue;
                // Stun gate — paralysed members skip both basic attack AND
                // skill cast this tick. The DOT tick continues to drain
                // their stun timer so they recover on the next pulse.
                const memStunned = isCombatantStunned(effectsRef.current, allyFxId(mem.id));

                // Basic attack every 2 ticks (≈1s at X1).
                if (!memStunned && tick % 2 === 0) {
                    const target = nextBosses.find((b) => !b.isDead);
                    if (target) {
                        // 2026-05 v6: Knight/Rogue dual-wield — each
                        // swing fires TWO independent strikes at 60%
                        // damage, ~150ms apart, with separate floats
                        // and flash so the player can see both hands
                        // land. Single-wield classes do one 100%.
                        const memCfg = (classesData as ReadonlyArray<{ id: string; dualWield?: boolean }>)
                            .find((c) => c.id === mem.class);
                        const memDual = !!memCfg?.dualWield;
                        const isMe = mem.id === character?.id;
                        const targetSlot = nextBosses.indexOf(target);
                        const computeDmg = (pct: number): number => {
                            let d = Math.max(1, Math.floor(mem.attack * pct) - Math.floor(target.defense * 0.5));
                            if (mem.class === 'Necromancer') {
                                const summonBonus = useNecroSummonStore.getState().totalAttackBonus(mem.id, mem.attack);
                                if (summonBonus > 0) {
                                    d += Math.max(1, Math.floor(summonBonus * pct) - Math.floor(target.defense * 0.5));
                                }
                            }
                            return d;
                        };
                        const fireOne = (hand: 'left' | 'right' | null, pct: number) => {
                            let dmg = computeDmg(pct);
                            // 2026-05 v7: every member's swing (player or
                            // bot ally, including their summons rolled
                            // into computeDmg) consumes Klątwa Śmierci
                            // (count) AND benefits from Kraina Śmierci
                            // (duration ×N) on the target boss.
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
                            // 2026-05-14 spec ("nie widac animacji ataku
                            // ... wszystko ma byc identyczne jak w bossie"):
                            // every member's basic swing flashes its class
                            // animation on the targeted boss card, not
                            // just the local player's. Mirrors Boss.tsx's
                            // doBotAttacks which always calls
                            // setBotAttackingClass(bot.class) regardless
                            // of `isMe`. flashBossAttacker is per-boss
                            // and uses a token so back-to-back hits
                            // re-trigger the CSS animation cleanly.
                            flashBossAttacker(target.id, mem.class);
                            // 2026-05-14 spec ("zrob to identycznie jak
                            // w polowaniu i bossie"): mirror every member
                            // basic swing to the channel so the other
                            // members render the same float + class
                            // pulse on the same boss card.
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
                                }).catch(() => { /* offline */ });
                            }
                            return dmg;
                        };
                        if (memDual) {
                            fireOne('left', 0.6);
                            // Off-hand swing 150ms later (matches the
                            // Hunt engine's twin-strike cadence).
                            setTimeout(() => {
                                if (target.isDead || target.currentHp <= 0) return;
                                fireOne('right', 0.6);
                            }, 150);
                        } else {
                            fireOne(null, 1.0);
                        }
                        if (target.currentHp <= 0) {
                            target.isDead = true;
                            // Each raid enemy is a wave-boss — count it for
                            // the unified backpack popup tally.
                            useCombatStore.getState().incrementSessionKill('boss');
                            // Only the local player's kills feed their task /
                            // quest / mastery progress. Party bots' kills are
                            // already attributed to their own characters
                            // server-side, so we never double-count.
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

                // -- Skill cast (manual queue first, then auto) --------------
                // Manual path runs every tick for the player so a click lands
                // on the very next pulse. Auto path tries every 2 ticks
                // (~1 s @ X1) and is gated by per-skill cooldowns — each
                // spell already has its own `cooldown` field that gets
                // stamped into `cooldownsRef` on every cast, so we don't
                // need a coarse outer 8 s window. Skipped for the player
                // when `skillMode === 'manual'` (toggling auto-skill OFF
                // means the player only fires what they click).
                // Stun gate also blocks skill casting for this member.
                if (memStunned) continue;
                const isPlayer = mem.id === character?.id;
                // 2026-05-14 spec ("Teraz tak wszystko zrob identycznie
                // jak w polowaniu i bossie"): for the local player,
                // gate skills against the LIVE character level (the
                // mem snapshot is captured at raid start, so a death-
                // induced level loss mid-raid would otherwise let a
                // now-locked skill fire). Mirrors Boss's auto-skill
                // gate at Boss.tsx:2166-2167.
                const liveCh = isPlayer ? useCharacterStore.getState().character : null;
                const effectiveLevel = liveCh ? Math.min(mem.level, liveCh.level) : mem.level;
                // 2026-05-14 spec ("auto skille uzywaja spelli ktorych
                // nie ma wybranych w slotach — KRYTYCZNY blad"): for
                // the local player, restrict the auto-pick + manual
                // cast pool to the four IDs sitting in their active
                // slot bar. Without this filter the engine iterated
                // every unlocked class skill and the auto path could
                // fire any of them. Other members (bots / non-leader
                // humans) don't expose their slot bar to the leader's
                // engine — they keep the full class list (no worse
                // than today). Slots may contain `null` for empty
                // chambers — we filter those out.
                const playerSlottedIds = isPlayer
                    ? new Set(activeSkillSlots.filter((id): id is string => !!id))
                    : null;
                const skills = getClassActiveSkills(mem.class)
                    .filter((s) => s.unlockLevel <= effectiveLevel && s.damage > 0)
                    .filter((s) => playerSlottedIds === null || playerSlottedIds.has(s.id));
                // 2026-05-17 spec ("wylaczylem auto spelle i nie moge
                // ich uzywac klikam non stop manualnie spella i nie
                // dziala"): manual casts must accept BUFF skills too
                // (Orle Oko / Krok Cienia / Tarcza Many / etc. all
                // have `damage = 0`). The auto-pick filter drops them
                // on purpose — bots/auto-rotation only fire damage —
                // but manual click on the action bar has to be able
                // to reach every slotted skill. Separate the manual
                // pool from the auto pool.
                const manualSkills = isPlayer
                    ? getClassActiveSkills(mem.class)
                        .filter((s) => s.unlockLevel <= effectiveLevel)
                        .filter((s) => playerSlottedIds === null || playerSlottedIds.has(s.id))
                    : skills;
                const memCds = cooldownsRef.current[mem.id] ?? {};

                let chosen = null as ReturnType<typeof getClassActiveSkills>[number] | null;
                if (isPlayer && skillQueueRef.current.length > 0) {
                    // Manual cast — pop queue, resolve slot -> skill id, look
                    // up the def. Fall back to no cast if the slot is empty
                    // or the skill is on CD / over MP.
                    const slotIdx = skillQueueRef.current.shift()!;
                    const wantedId = activeSkillSlots[slotIdx];
                    const def = wantedId
                        ? manualSkills.find((s) => s.id === wantedId)
                        : null;
                    if (def && mem.mp >= def.mpCost && (memCds[def.id] ?? 0) <= tick) {
                        chosen = def;
                    }
                }
                // 2026-05-17: leader-side consume of non-self member's
                // remote manual click. The member's client published a
                // `member-skill-request` with their resolved skill id;
                // we accept any skill in their class pool that they've
                // unlocked (we don't see their `activeSkillSlots` so we
                // skip the slot-bar filter — same semantics as the bot
                // path, which already iterates the full class list).
                // Buffs are accepted too (no `damage > 0` filter).
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
                // 2026-05-14 spec ("w party kazdy sojusznik moze sam
                // decydowac czy uzywa auto spelli czy nie i wtedy u
                // kazdego sojusznika nie powinien uzywac tych spelli
                // jezeli je wylaczy"): per-member auto/manual gate.
                // The leader-driven engine reads each member's OWN
                // skillMode (broadcast via partyPresence) so toggling
                // auto off on a member's client immediately stops the
                // leader's engine from casting for that character.
                // Bots default to 'auto' (no presence broadcast).
                let memSkillMode: 'auto' | 'manual' = 'auto';
                if (isPlayer) {
                    memSkillMode = skillMode;
                } else if (!mem.isBot) {
                    const pres = usePartyPresenceStore.getState().byMember[mem.id];
                    memSkillMode = pres?.skillMode ?? 'auto';
                }
                const autoSkillAllowed = memSkillMode === 'auto';
                if (!chosen && autoSkillAllowed && tick % 2 === 0) {
                    // Pick the longest-off-cooldown affordable skill (lowest
                    // stamped CD-expiry tick, ties broken by higher unlock-
                    // level so end-game spells still preferred when both
                    // skills come off CD on the same tick). This naturally
                    // round-robins through all 4 active slots instead of
                    // always firing slot #1 — the previous `unlockLevel`
                    // sort meant a low-CD high-tier spell would dominate
                    // and never let slot #2 through.
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
                        // Mirror the tick-based gate to a ms-based map so the
                        // action-bar's cooldown sweep can render a smooth
                        // visual drain on the player's slot. Bot casts are
                        // ignored here — they don't show on the player's bar.
                        if (mem.id === character?.id) {
                            const cdMs = chosen.cooldown;
                            const skillId = chosen.id;
                            setPlayerSkillCooldowns((prev) => ({ ...prev, [skillId]: cdMs }));
                        }
                        // Resolve the actually-targeted boss FIRST so the
                        // effect cast knows whose HP% to evaluate
                        // `execute_below` against. AOE flag will be derived
                        // from the parsed effect string below.
                        const firstAliveIdx = nextBosses.findIndex((b) => !b.isDead);
                        const primaryBoss = firstAliveIdx >= 0 ? nextBosses[firstAliveIdx] : null;
                        const primaryHpPct = primaryBoss && primaryBoss.maxHp > 0
                            ? (primaryBoss.currentHp / primaryBoss.maxHp) * 100
                            : 100;
                        const allyIds = nextMembers.filter((m) => !m.isDead && !m.hasEscaped).map((m) => allyFxId(m.id));
                        const enemyIds = nextBosses.filter((b) => !b.isDead).map((b) => b.id);
                        // 2026-05 v7: Apokalipsa Śmierci synchronous self-cost.
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
                        // AOE comes from the parsed effect (was previously
                        // a hand-rolled `isAoeSkill` check). Honouring
                        // `apply.aoe` lets new "aoe" tags in skills.json
                        // automatically splash here.
                        const aoe = apply.aoe;
                        const targets = aoe
                            ? nextBosses.map((b, i) => (b.isDead ? -1 : i)).filter((i) => i >= 0)
                            : (firstAliveIdx >= 0 ? [firstAliveIdx] : []);
                        // Skill-upgrade combat bonus — ONLY the local player's
                        // own casts (their slot upgrades live in this client's
                        // skillStore). Bots / remote members have no accessible
                        // upgrade level here, so they get the neutral 1.0.
                        const skillUpgradeMult = isPlayer
                            ? getCombatSkillUpgradeMultiplier(
                                useSkillStore.getState().skillUpgradeLevels[chosen.id] ?? 0,
                            )
                            : 1;
                        const baseDmg = Math.floor(mem.attack * chosen.damage * apply.castDmgMult * skillUpgradeMult);
                        // Suppress unused-binding lint while heal/multistrike
                        // wait for view-side wiring.
                        void apply.multistrike;
                        // Necromancer summon spawn — only when the casting
                        // member is a necro. Each member has its own summon
                        // queue keyed by `mem.id`, so a 4-necro raid party
                        // gets 4 independent stacks (each capped per-type).
                        if (apply.summons.length > 0 && mem.class === 'Necromancer') {
                            const store = useNecroSummonStore.getState();
                            for (const sm of apply.summons) {
                                const spawned = store.spawn(mem.id, sm.type, sm.count, mem.attack, mem.maxHp);
                                if (spawned > 0 && mem.id === character?.id) {
                                    // Only the local player gets the spawn anim;
                                    // bot necromancers' cards aren't watched.
                                    const memSlot = nextMembers.findIndex((mm) => mm.id === mem.id);
                                    if (memSlot >= 0) fx.triggerAllySummonSpawn(memSlot, sm.type);
                                }
                            }
                        }
                        // 2026-05 v7: Apokalipsa Śmierci — target damage
                        // only (self-cost paid synchronously above).
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
                                // 2026-05-14: broadcast Apokalipsa hit.
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
                                    }).catch(() => { /* offline */ });
                                }
                                addLog(`:skull-and-crossbones: ${mem.name}: Apokalipsa Śmierci ${apocDmg} dmg`);
                            }
                        }
                        // Buffer skill-hit pulses to flush in a single setState
                        // after the loop — AOE skills that tag 4 bosses at once
                        // shouldn't trigger 4 separate setBossHitPulses calls
                        // (each would queue a render).
                        const skillPulseBumps: string[] = [];
                        const isMe = mem.id === character?.id;
                        const skillKind = isMe ? 'spell' : 'ally-spell';
                        const skillIcon = getSkillIcon(chosen.id);
                        // 2026-05-18 spec ("animacje buffow itp byly poprawnie
                        // pokazywane. Bo sokole oko nie powinno pokazywac sie
                        // na potworze"): pure-buff skills (damage=0 and no
                        // enemy-affinity atoms like aoe/dot/stun/etc.) must
                        // NOT animate on the boss — they target the CASTER.
                        // The old loop blindly iterated `targets` for every
                        // cast, so Orle Oko fired `triggerEnemySkillAnim` +
                        // `pushEnemyFloat(1)` on the boss slot. Mirror Boss
                        // .tsx's `targetsEnemy` gate: damage > 0 OR effect
                        // contains an enemy-affinity atom. Buff casts skip
                        // the enemy loop and push an ally-side anim + float
                        // on the caster's slot instead.
                        const isDamageHit = (chosen.damage ?? 0) > 0;
                        const castTargetsEnemy = isDamageHit || skillTargetsEnemy(chosen.effect ?? null);
                        let totalDmgDealtThisCast = 0;
                        if (!castTargetsEnemy) {
                            // Pure buff (Orle Oko, Tarcza Many, Krok Cienia,
                            // Okrzyk Bojowy etc.) — render on the CASTER's
                            // ally slot, broadcast as ally-side cue so the
                            // other clients also light up the right card.
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
                                        // Target = CASTER (ally cue path on
                                        // the receiver). Receiver resolves
                                        // this via the members roster and
                                        // pushes pushAllyFloat instead of
                                        // pushEnemyFloat.
                                        targetId: memIdCap,
                                        damage: 0,
                                        kind: 'heal',
                                        icon: skillIconCap,
                                        label: 'BUFF',
                                        skillId: skillIdCap,
                                    });
                                }).catch(() => { /* offline */ });
                            }
                        }
                        const enemyTargets = castTargetsEnemy ? targets : [];
                        for (const ti of enemyTargets) {
                            const t = nextBosses[ti];
                            if (!t || t.isDead) continue;
                            const normalDmgRaid = Math.max(1, baseDmg - Math.floor(t.defense * 0.3));
                            let dmg = apply.instantKill
                                ? Math.max(1, t.currentHp)
                                : ((apply.executeBurstPct ?? 0) > 0
                                    ? Math.max(normalDmgRaid, Math.floor(t.maxHp * (apply.executeBurstPct ?? 0) / 100))
                                    : normalDmgRaid);
                            // 2026-05 v7: spell hits consume Klątwa AND
                            // get Kraina ×N — same as basics. Each AOE
                            // target rolls its own consume so a 4-target
                            // AOE drains 4 charges (one per boss) but
                            // each gets the duration mark passively. Both the
                            // normal and execute-burst paths still take the
                            // mark-amp consume (only the true one-shot skips).
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
                            // Per-slot themed overlay + per-slot purple/pink
                            // spell float on the actual targeted boss card.
                            // AOE skills correctly fire on every hit boss.
                            fx.triggerEnemySkillAnim(ti, chosen.id);
                            fx.pushEnemyFloat(ti, dmg, skillKind, { icon: skillIcon });
                            // 2026-05-14: mirror to members — skillId
                            // ships so they trigger the same themed
                            // overlay; AOE hits with the same skillId
                            // land on each boss slot independently.
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
                                }).catch(() => { /* offline */ });
                            }
                            if (t.currentHp <= 0) {
                                t.isDead = true;
                                useCombatStore.getState().incrementSessionKill('boss');
                                // Same player-kill gate as basic-attack path.
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
                        // 2026-05 v6: heal-on-cast (Promień Pustki,
                        // Pochłonięcie Życia, Żniwa Dusz). Heals THIS
                        // raid member by N% of total damage dealt this
                        // cast (including AOE splash). For the local
                        // player, push a green +HP float on their slot
                        // and apply the heal to the live members map;
                        // for bot allies it just bumps their hp ref so
                        // the bar visibly recovers — float-on-bot would
                        // stack with everyone's spell floats and read
                        // confusingly at AOE rate.
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
                        // 2026-05 v6: Cleric `heal` / `holy_nova` — pick
                        // the raid member with the lowest HP%, heal them
                        // for N% of their max. Float lands on the local
                        // player's slot only when THEY were the lowest;
                        // otherwise the bot's bar simply tops up (their
                        // card re-renders next frame).
                        // 2026-05 v6: Cleric Aura Wskrzeszenia — revive
                        // dead raid members to 50% HP. Float on each
                        // resurrected member's slot if they're the local
                        // player; bots get revived silently.
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
                        // 2026-06-19: Cleric `heal_party_pct` (Niebiańskie
                        // Leczenie / Modlitwa) — instantly heal EVERY alive
                        // raid member (leader + bots + remote) by N% of their
                        // OWN max HP, clamped to maxHp. Float lands on the
                        // local player's slot only; bots/remote bars simply
                        // top up next render (matching the DOT-tick + heal
                        // handlers above, which avoid AOE-rate float spam on
                        // ally cards). Use the escaped-filtered roster for the
                        // local player's rendered slot index.
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
                        // 2026-06-19: Cleric `heal_party_dot` (Błogosławieństwo)
                        // — register the party-wide heal-over-time on the shared
                        // ref. The status/DOT tick drains `remainingMs` at
                        // speed-scaled rate and heals each alive member
                        // pctPerSec/100 × maxHp per game-second. Refresh
                        // semantics: take the strongest tier (max pctPerSec)
                        // and the longest remaining duration so re-casting /
                        // a second Cleric can't shorten an active regen.
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

            // Bosses act every 3 ticks (≈1.5s at X1)
            if (tick % 3 === 0) {
                // Buffer member hit pulses so a tick where 4 bosses all swing
                // at the party only fires one setMemberHitPulses call (the
                // map merge inside is the natural batch — each member id gets
                // its own counter increment, but it's one render).
                const memberPulseBumps: string[] = [];
                const aggroPicks: Record<string, string> = {};
                for (const boss of nextBosses) {
                    if (boss.isDead) continue;
                    // Stun gate — paralysed bosses skip their swing for this
                    // tick. Their stun timer continues to drain in the DOT
                    // tick effect below so they recover on schedule.
                    if (isCombatantStunned(effectsRef.current, boss.id)) continue;
                    const liveTargets = nextMembers.filter((m) => !m.isDead && !m.hasEscaped);
                    if (liveTargets.length === 0) break;
                    const tgt = liveTargets[Math.floor(Math.random() * liveTargets.length)];
                    aggroPicks[boss.id] = tgt.id;
                    // 2026-05 v6: Rogue Bomba Dymna (dodge_buff:50:4000)
                    // — % chance to fully dodge each incoming basic
                    // during the buff window. Member's v2 status is
                    // keyed by `allyFxId(mem.id)`. Roll once per swing.
                    const tgtSt = effectsRef.current.statuses.get(allyFxId(tgt.id));
                    if (tgtSt && tgtSt.dodgeBuffMs > 0 && tgtSt.dodgeBuffPct > 0) {
                        if (Math.random() * 100 < tgtSt.dodgeBuffPct) {
                            // 2026-05-15 v11: filter escapees from the
                            // slot calc so the dodge float lands on the
                            // rendered roster slot.
                            const tgtSlot = nextMembers.filter((m) => !m.hasEscaped).indexOf(tgt);
                            if (tgtSlot >= 0) {
                                fx.pushAllyFloat(tgtSlot, 0, 'heal', { icon: 'dashing-away', label: 'UNIK' });
                            }
                            // 2026-05-14: mirror dodge to members so
                            // their card shows the same UNIK label.
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
                                }).catch(() => { /* offline */ });
                            }
                            if (tgt.id === character?.id) {
                                addLog(`:dashing-away: Bomba Dymna! Unikasz ataku ${boss.name} (${tgtSt.dodgeBuffPct}%)`);
                            }
                            continue;
                        }
                    }
                    const rawDmg = Math.max(1, boss.attack - Math.floor(tgt.defense * 0.4));
                    // Necromancer summon shield — front-of-queue summon eats
                    // the hit before the necro takes it. Each necro member
                    // has their own summon queue keyed by member id.
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
                    // Red 'monster' float on the actual member card so the
                    // player can see who got hit, not just a screen-shake.
                    // 2026-05-15 v11 spec ("dalej leca animacje na pusty
                    // kafelek dopoki nie pokaze sie poprawnie"): match
                    // the slot index to the RENDERED roster (uiAllies
                    // filters `hasEscaped` out). If the cleanup useEffect
                    // hasn't caught up with the broadcast yet, members
                    // still contains the escapee at their old slot, so
                    // `nextMembers.indexOf(tgt)` returned the WRONG
                    // index relative to the visible cards — pushing the
                    // float into an unrendered slot or a phantom tile.
                    const liveSlotMembers = nextMembers.filter((m) => !m.hasEscaped);
                    const tgtSlot = liveSlotMembers.indexOf(tgt);
                    if (tgtSlot >= 0) {
                        fx.pushAllyFloat(tgtSlot, rawDmg, 'monster');
                    }
                    // 2026-05-15 v16 spec ("nie widze wcale animacji
                    // spelli potworow jak rzucaja spella na sojusznika
                    // jakiegos"): paint a strike overlay on the
                    // target's card so the user sees a visible attack
                    // animation (not just the damage number). Uses
                    // `attack-Necromancer` as the generic monster-
                    // strike theme since bosses don't carry a player
                    // class. Auto-clears after the boss-strike anim
                    // duration.
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
                    // 2026-05-14: broadcast the boss swing so members
                    // see the damage number on the same member card.
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
                        }).catch(() => { /* offline */ });
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
                // Refresh aggro picks for the ally-card aggro indicator.
                // Only writes when the picks change — avoids a re-render when
                // the same 4 bosses target the same 4 members tick-over-tick.
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

            // -- Player-death detection (mid-fight, party still alive) --------
            // If the player went down THIS tick AND there's still at least
            // one ally swinging, surface the choice popup: bail to town now
            // (apply penalty) or wait for an ally rez. The one-shot guard
            // (`playerDeathHandledRef`) prevents the popup from re-arming
            // every subsequent tick while the player sits dead. The wipe
            // path below handles the "everyone-dead-including-me" case.
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

            // Sync my character HP/MP back to the store so UI reflects it.
            const me = nextMembers.find((m) => m.id === character?.id);
            if (me) {
                useCharacterStore.getState().updateCharacter({ hp: me.hp, mp: me.mp });
            }

            // Wave / raid end checks
            if (nextBosses.every((b) => b.isDead)) {
                const nextWaveIdx = currentWave + 1;
                if (selectedRaid && nextWaveIdx < selectedRaid.waves) {
                    // Slim spawn-timer bar over the inter-wave lull —
                    // gives the player a visible cue between waves
                    // instead of a sudden boss swap. Speed-scaled so
                    // x4 collapses the wait alongside the attack tempo.
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
                    // Clean victory — disable the leave guard so closing the
                    // result screen doesn't punish a player who actually won.
                    leavePenaltyAppliedRef.current = true;
                    setPhase('victory');
                    // Victory drops all member summons — they served their
                    // purpose and the next attempt starts fresh.
                    useNecroSummonStore.getState().clearAll();
                    distributeRewards(selectedRaid, nextMembers);
                }
            }

            if (nextMembers.every((m) => m.isDead || m.hasEscaped)) {
                // Real wipe — flag the leave guard so closing the result
                // screen doesn't double-charge on top of handleWipe's penalty.
                leavePenaltyAppliedRef.current = true;
                setPhase('wipe');
                // Wipe drops every member's summons.
                useNecroSummonStore.getState().clearAll();
                handleWipe();
            }
        }, Math.max(100, 500 / speedMult));

        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, speedMult, selectedRaid, currentWave, character?.id, isNonLeaderMember]);

    // Prune expired skill FX
    useEffect(() => {
        if (skillFx.length === 0) return;
        const t = setTimeout(() => {
            setSkillFx((prev) => prev.filter((f) => f.expiresAt > Date.now()));
        }, 400);
        return () => clearTimeout(t);
    }, [skillFx]);

    // Spawn-bar progress driver (rAF) — fills `spawnProgress` 0->1 over
    // the duration captured when the wave-clear branch armed the
    // setTimeout. Cancelled on flag flip or unmount.
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
    // (escape / wipe / victory). The setTimeout is best-effort and might
    // still resolve in the background — this guarantees the bar
    // disappears the moment the phase flips.
    useEffect(() => {
        if (phase !== 'fighting') {
            setWaitingForSpawn(false);
            setSpawnProgress(0);
            // Phase exit also tears down the mid-fight choice popup —
            // wipe / victory / escape all eclipse the player's pending
            // choice (the choice only made sense WHILE the fight was
            // ongoing). The actual wipe-vs-bail penalty handling lives
            // in handleWipe / handleReturnToTown — this effect is just
            // the visual cleanup for the modal.
            setPartyChoiceOpen(false);
            playerWaitingResRef.current = false;
            playerDeathHandledRef.current = false;
        }
    }, [phase]);

    // -- Wipe / death penalty ------------------------------------------------
    // A full party wipe = real death (everyone fell in combat). Apply the
    // full death penalty (level loss possible) — different from Ucieczka,
    // which is the optional flee. Also fires the global DeathNotification
    // popup so the post-mortem follows the player to town and persists
    // until they click to dismiss.
    const handleWipe = useCallback(() => {
        const char = useCharacterStore.getState().character;
        if (!char) return;
        // 2026-05-19 v25 spec ("Dodać jeszcze raidy"): log raid wipes to the
        // global deaths feed. Logged BEFORE the penalty so the row's
        // `character_level` reflects the pre-penalty level (matches the
        // pattern used by Boss / Dungeon real-death logs).
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
        // 2026-06-21 spec: a SINGLE shared helper governs death + flee
        // protection. Consumes ONE protection item (death_protection elixir
        // first, then amulet_of_loss); when protected the player loses NOTHING
        // (no level, no xp, no skill xp, no items).
        const prot = consumeDeathProtection();
        const oldLevel = char.level;
        let newLevel = char.level;
        let levelsLost = 0;
        let xpPercent = 100;
        let skillXpLossPercent = 0;
        // `fullHealEffective` in characterStore already includes elixir +
        // transform multipliers as of this revision, so a thin alias keeps
        // call-sites symmetric with the legacy code.
        const refillFullEffective = () => {
            useCharacterStore.getState().fullHealEffective();
        };
        if (prot.isProtected) {
            // ZERO loss: no penalty, no skill-xp drain, no slot purge, no item
            // loss. Still full-heal the player and log the save.
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
            // Drop any active-skill slot whose unlock-level now exceeds the
            // post-penalty character level — otherwise a slotted lvl-100
            // spell on a lvl-92 character sits there permanently disabled.
            useSkillStore.getState().purgeLockedSkillSlots(char.class, p.newLevel);
            newLevel = p.newLevel;
            levelsLost = p.levelsLost;
            xpPercent = p.xpPercent;
            skillXpLossPercent = p.skillXpLossPercent;
            addLog(`:skull: Wipe! Kara: -${p.levelsLost} lvl · -${p.skillXpLossPercent}% Skill XP`);
            // Item loss happens on UNPROTECTED DEATH ONLY.
            const itemsLost = useInventoryStore.getState().applyDeathItemLoss(false, char.level);
            if (itemsLost > 0) {
                addLog(`:skull: Stracileś ${itemsLost} przedmiot(ow) przy wipe!`);
            }
        }
        // Wipe ends the session — clear so the next combat view starts clean.
        useCombatStore.getState().clearCombatSession();
        // 2026-05-14 spec ("Jak ktos zginie i ma animacje smierci to
        // powinno wywalic go z party"): wipe = death = leave the party
        // so the corpse doesn't linger in the leader's roster. Server
        // dissolves the row when the last member leaves naturally.
        void (async () => {
            try {
                await usePartyStore.getState().leaveParty(char.id);
            } catch { /* best effort */ }
        })();
        // Unified epic death overlay — auto-navigates to town but the
        // popup itself stays mounted (DeathNotification is global) until
        // the player clicks it.
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

    // 2026-05-14 spec ("Teraz tak wszystko zrob identycznie jak w
    // polowaniu i bossie"): member-side wipe-forced latch. Mirrors
    // Boss.tsx's `wipeForcedRef` — when the leader's broadcast flips
    // phase to 'wipe' on our screen we run handleWipe ourselves so
    // the local player picks up the penalty + DeathNotification +
    // nav-home. Without this, members who clicked "Czekaj" sat
    // staring at a `wipe` phase forever; the leader's `handleWipe`
    // only ran on the leader, so members never lost levels and never
    // left the dead arena.
    const wipeForcedRef = useRef(false);
    useEffect(() => {
        if (!isNonLeaderMember) return;
        if (phase !== 'wipe') return;
        if (wipeForcedRef.current) return;
        if (leavePenaltyAppliedRef.current) return;
        wipeForcedRef.current = true;
        leavePenaltyAppliedRef.current = true;
        // 2026-05-14 spec ("Jak ktos zginie i ma animacje smierci to
        // powinno wywalic go z party"): every death path leaves the
        // party so the corpse doesn't linger in the leader's roster.
        // Wipe = everyone dies = everyone leaves; the server-side
        // party row dissolves naturally once the last member is gone.
        // Fire-and-forget — death overlay runs on top.
        void (async () => {
            try {
                const me = useCharacterStore.getState().character?.id;
                if (me) await usePartyStore.getState().leaveParty(me);
            } catch { /* best effort */ }
        })();
        handleWipe();
    }, [phase, isNonLeaderMember, handleWipe]);
    // Re-arm the latch whenever the player re-enters a fight (so the
    // NEXT wipe still triggers the same path).
    useEffect(() => {
        if (phase === 'fighting') wipeForcedRef.current = false;
    }, [phase]);

    // -- Mid-fight choice handlers --------------------------------------------
    // Player clicked "Powrót do miasta" while their character was downed but
    // the team was still fighting. Treat this as a real death NOW: full
    // penalty + global popup + nav to town. The interval clears on unmount,
    // so the wipe check below this never re-applies a second penalty (and
    // we additionally flag leavePenaltyAppliedRef so the URL-leave guard
    // also stands down). This is the ONLY penalty path for this branch.
    const handleReturnToTown = useCallback(() => {
        setPartyChoiceOpen(false);
        playerWaitingResRef.current = false;
        leavePenaltyAppliedRef.current = true;
        const char = useCharacterStore.getState().character;
        if (!char) {
            navigate('/');
            return;
        }
        // 2026-05-19 v25 spec ("Dodać jeszcze raidy"): log the return-to-town
        // death (player died, chose not to wait for rez) to the global feed.
        // Same pre-penalty timing as handleWipe so `character_level` reflects
        // the level the player WAS at.
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
        // 2026-05-14 spec ("Teraz tak wszystko zrob identycznie jak w
        // polowaniu i bossie"): same leader-handoff + party-leave
        // pattern Boss uses (Boss.tsx:4989-5021). If we're the leader,
        // promote an alive human teammate so the raid keeps going under
        // a new authority instead of stalling the moment we navigate
        // home. Then leave the party so other members see us drop off
        // their ally roster. Fire-and-forget so the death penalty +
        // overlay below doesn't wait on the network.
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
                        } catch { /* best effort */ }
                    }
                }
                try {
                    await usePartyStore.getState().leaveParty(me);
                } catch { /* best effort */ }
            })();
        }
        // 2026-06-21 spec: shared death/flee protection helper. Consumes ONE
        // protection item; when protected the player loses NOTHING.
        const prot = consumeDeathProtection();
        const oldLevel = char.level;
        let newLevel = char.level;
        let levelsLost = 0;
        let xpPercent = 100;
        let skillXpLossPercent = 0;
        // Same full-effective refill helper used by the wipe path — see
        // `handleWipe` for the why; in short, `fullHealEffective` in the
        // store doesn't include elixir/transform bonuses, so we recompute
        // via `getEffectiveChar` and write the result directly.
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
            // ZERO loss: no penalty, no skill-xp drain, no slot purge, no item
            // loss. Still full-heal the player and log the save.
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
            // Drop any active-skill slot whose unlock-level now exceeds the
            // post-penalty character level — otherwise a slotted lvl-100
            // spell on a lvl-92 character sits there permanently disabled.
            useSkillStore.getState().purgeLockedSkillSlots(char.class, p.newLevel);
            newLevel = p.newLevel;
            levelsLost = p.levelsLost;
            xpPercent = p.xpPercent;
            skillXpLossPercent = p.skillXpLossPercent;
            addLog(`:skull: Wracasz do miasta. Kara: -${p.levelsLost} lvl · -${p.skillXpLossPercent}% Skill XP`);
            // Item loss happens on UNPROTECTED DEATH ONLY.
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

    // Player chose to wait for an ally rez. The popup closes but the player
    // stays slumped on the field — the tick loop's resurrection roll above
    // gets a chance every ~2s. If a rez never lands and the party wipes,
    // the standard handleWipe path applies the wipe penalty (only once —
    // this handler never applies a personal penalty, by design).
    const handleWaitForResurrection = useCallback(() => {
        setPartyChoiceOpen(false);
        playerWaitingResRef.current = true;
        addLog(':hourglass-not-done: Czekasz na wskrzeszenie...');
    }, [addLog]);

    // -- Rewards -------------------------------------------------------------
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

            // Apply to the local character only (other members get their share server-side
            // in a full realtime setup — we simulate locally so only "me" actually gains).
            if (character && mem.id === character.id) {
                useCharacterStore.getState().addXp(result.xp);
                const inv = useInventoryStore.getState();
                // 2026-06-21 fix: raid gold must land in the spendable/displayed
                // inventory pool (same as hunting/dungeon/boss/task rewards), not
                // the invisible `characters.gold` column — otherwise the reward
                // tally shows gold the player never actually receives.
                inv.addGold(result.gold);
                for (const it of result.items) inv.addItem(it);
                for (const drop of result.drops) {
                    if (drop.kind === 'spell_chest' && drop.amount) {
                        inv.addSpellChest(drop.amount, 1);
                    }
                }
                // Mirror to the unified backpack popup tally.
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
        // 2026-05-15: store the rolled items so the leader's
        // broadcast effect can ship them to every member alongside
        // dropsByMember. Without this, each client rolled their OWN
        // items -> different drops shown on different screens.
        setItemsByMember(itemsPerMember);
        addLog(':trophy: Rajd ukończony! Nagrody rozdzielone.');
    }, [character, addLog]);

    // -- Escape handler ------------------------------------------------------
    // Spec: Ucieknij from a non-hunting fight = standard 1/10 flee penalty
    // (XP loss only — no level strip, no item loss, no HP/MP nuke). Same
    // contract as Boss/Dungeon/Transform.
    const handleEscape = useCallback(async () => {
        if (!character) return;
        // Voluntary escape uses the soft flee penalty — disable the leave
        // guard so unmount after this doesn't upgrade it to a full death.
        leavePenaltyAppliedRef.current = true;
        setMembers((prev) =>
            prev.map((m) => (m.id === character.id ? { ...m, hasEscaped: true } : m)),
        );
        addLog(':white-flag: Uciekasz z rajdu! Party opuszczone.');
        // 2026-05-15 v11 spec ("Jezeli ucieklem z raidu a moi
        // soujusznicy i tak go zrobili to nie zabieraj mi limitow
        // robienia go"): refund the daily-attempt count for this
        // raid. `startRaid` consumed one attempt up front; fleeing
        // (whether or not the rest of the party clears the raid)
        // shouldn't burn a daily attempt for the fleeing player.
        const raidForRefund = selectedRaidRef.current;
        if (raidForRefund) {
            refundAttempt(raidForRefund.id);
        }
        // 2026-05-15 spec ("Jezeli podczas raidu lider ucieka z raidu
        // to powinno przekazac innemu graczowi lidera party i wywalic
        // poprzedniego lidera z party ... obecnie wszyscy inni
        // sojusznicy gina co jest duzym bledem"): partyApi.leaveParty
        // dissolves the WHOLE party when the caller is the leader.
        // Without an explicit transferLeadership first, every other
        // member's `party` flips to null -> AppShell flee-watcher
        // fires the flee penalty for ALL of them. Promote an alive
        // human teammate before bailing so the raid keeps going
        // under the new leader and only WE eat the flee. Mirrors
        // handleReturnToTown's leader-handoff branch.
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
                } catch { /* best effort */ }
            }
        }
        try { await leaveParty(character.id); } catch { /* best effort */ }
        // Apply standard flee penalty: 0.3% level loss + 0.1% skill XP.
        // 2026-05-14 spec ("powinien wyskoczyc mu popup ze udalo Ci sie
        // uciec ... napis Ucieczka na srodku i potem opis i guzik
        // miasto"): fire the flee overlay (kind: 'flee') with the
        // penalty so the player sees "UCIEKŁEŚ — X% lvl / Y% Skill XP"
        // before landing in town instead of a silent stat drop.
        const raidForFlee = selectedRaidRef.current;
        if (character.level > 1) {
            // 2026-05-19 v25 spec: log flee to the global deaths feed so the
            // /deaths view renders "<raid> przegnał <player>" (verb driven by
            // `result: 'fled'`).
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
            // 2026-06-21 spec: shared death/flee protection helper now gates
            // the flee penalty too — a single protection item (elixir first,
            // then amulet) cancels ALL loss on flee. Flee NEVER loses items
            // (no applyDeathItemLoss here, protected or not).
            const prot = consumeDeathProtection();
            if (prot.isProtected) {
                // ZERO loss: no level/xp drop, no skill-xp drain, no slot
                // purge. Overlay reports the run as fully protected.
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
        // Clear shared session so the next combat view starts fresh.
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
    }, [fx.resetFx]); // eslint-disable-line react-hooks/exhaustive-deps

    // 2026-05-17 spec ("Sluchaj zginalem w party na raidzie kliknalem
    // zeby zostac i wskrzesic przez graczy, ale nikt mnie nie
    // wskrzesil ... powinienem miec animacje smierci i zginac"): on
    // entering the result phase (victory OR wipe), if the local
    // player is still dead AND we haven't already handled it via the
    // wipe path (which applies its own penalty), apply the standard
    // death penalty + open the death overlay. One-shot latch keeps
    // it from re-firing on every re-render. Rewards are NOT
    // affected — `distributeRewards` still credits dead-but-not-
    // escaped members (they get the loot just like a survivor).
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
        // The wipe handler (handleWipe) already runs death penalty +
        // overlay when the whole party falls — don't double-apply.
        if (phase === 'wipe') {
            resultDeathAppliedRef.current = true;
            return;
        }
        // Victory + dead-not-resurrected -> personal death penalty.
        resultDeathAppliedRef.current = true;
        leavePenaltyAppliedRef.current = true;
        // 2026-05-19 v25 spec ("Dodać jeszcze raidy"): log dead-not-resurrected
        // raid deaths to the global feed (these are real deaths even though
        // the rest of the party may have cleared the raid).
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
            // 2026-06-21 spec: shared death/flee protection helper. Consumes
            // ONE protection item; when protected the player loses NOTHING
            // (no level, no xp, no skill xp). This dead-not-resurrected path
            // never applies item loss (matching prior behaviour).
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
        // 2026-05-17 v2 spec ("jezeli lider party kliknie ponow lub
        // walczy wyzej to mnie powinno wywalic z party i przejsc do
        // miasta"): leave the party + navigate home IMMEDIATELY so the
        // leader's next Ponów / Walcz wyżej can't pull the dead
        // player back into combat via the ready-check / go pipeline.
        // Without this, the dead player would re-enter the next fight
        // already in zero-HP state and the engine would loop them
        // through Czekaj -> death -> Czekaj forever. Fire-and-forget
        // the leaveParty call so the death overlay opens immediately.
        useCombatStore.getState().clearCombatSession();
        // Tear down the ready-check channel + clear any pending
        // destination so an `instant-go` from the leader (Ponów /
        // Walcz wyżej) can't navigate us back to /raid before
        // leaveParty finishes its API roundtrip.
        usePartyReadyCheckStore.getState().clear();
        void (async () => {
            try {
                await usePartyStore.getState().leaveParty(ch.id);
            } catch { /* offline / already left */ }
        })();
        navigate('/');
    }, [phase, addLog, navigate]);

    // -- Render: lobby gate --------------------------------------------------
    // Three party gates run before the list — all must pass before the
    // player can pick a raid. The list itself is then a visual sibling of
    // the dungeon hub (same filter strip, same card chrome, same drop
    // modal pattern) so the two screens read as one family.
    if (phase === 'lobby') {
        const noParty = !party;
        const partyTooSmall = !!party && totalMembers < 2;
        const notLeader = !!party && !iAmLeader;
        const showList = !!party && totalMembers >= 2 && iAmLeader;

        // Apply filters in the same order as the dungeon hub.
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
                {/* Backend-mode (opt-in) resolve feedback. Only rendered when the
                    authoritative server resolved a raid — the default client path
                    never sets backendFeedback, so this stays invisible there. */}
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
                        {/* Filter bar — pill toggles + numeric input + clear,
                            cloned from the dungeon hub for visual parity. */}
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

                        {/* Raid cards — corner badges + centred head + reward
                            summary + drop popup trigger + wide enter CTA. */}
                        {visibleRaids.map((r) => {
                            const left = attemptsRemaining(r.id);
                            const tooLow = r.level > partyMinLevel;
                            const noAttempts = left <= 0;
                            const blocked = tooLow || noAttempts;
                            const allDone = left <= 0;
                            const used = r.dailyAttempts - left;
                            const hue = getRaidCardHue(r.level);
                            // Reuse the source dungeon's flavour line so the
                            // two list views read identical at a glance —
                            // same painting, same name, same description.
                            const desc = DUNGEON_DESC_BY_ID[r.sourceDungeonId] ?? '';
                            // Live reward estimate (matches engine math in
                            // rollMemberRewards) so the card surfaces real
                            // numbers instead of an opaque "×10" multiplier.
                            const est = estimateRaidRewards(r);

                            return (
                                <div
                                    key={r.id}
                                    className={`raid__card${blocked ? ' raid__card--blocked' : ''}${allDone ? ' raid__card--all-done' : ''}`}
                                    style={{
                                        '--card-hue': hue,
                                        // Per-raid background art. Raids reuse
                                        // their source dungeon's painting (the
                                        // raid is just the same biome run as a
                                        // 4-up party fight), keyed off the
                                        // canonical `sourceDungeonId` set when
                                        // the raid was generated. The ID ->
                                        // image map in spriteAssets is stable
                                        // across filter/sort, so a given raid
                                        // always shows the same picture. Falls
                                        // back to `none` when art is missing —
                                        // the hue accents (border + box-shadow)
                                        // still carry the card's identity.
                                        // Same pattern as Dungeon.tsx so the
                                        // two list views read identical at a
                                        // glance, only the wave/×4 labels differ.
                                        '--card-image': (() => {
                                            const url = getDungeonImage(r.sourceDungeonId);
                                            return url ? `url("${url}")` : 'none';
                                        })(),
                                    } as React.CSSProperties}
                                >
                                    {/* Corner badges — required level top-left,
                                        wave count top-right. Wave label keeps
                                        the raid-specific "× 4" suffix (4
                                        bosses per wave) so the only visible
                                        difference between the dungeon and
                                        raid cards lives here. */}
                                    <span className="raid__corner raid__corner--lvl">
                                        Lvl {r.level}
                                    </span>
                                    <span className="raid__corner raid__corner--waves">
                                        {r.waves} {r.waves === 1 ? 'fala' : 'fal'} × 4
                                    </span>

                                    {/* "Pokonany" stamp — shown when daily
                                        attempts are exhausted. Raid attempts
                                        only increment on victory, so allDone
                                        implies the player has cleared this
                                        raid. Mirrors the dungeon's centred
                                        green stamp between the lvl & waves
                                        corner pills. */}
                                    {allDone && (
                                        <span className="raid__corner raid__corner--cleared">
                                            <GameIcon name="check-mark-button" /> Pokonany
                                        </span>
                                    )}

                                    {/* Centred head — name + flavour line.
                                        Description is pulled from the source
                                        dungeon so the two cards read 1:1 (a
                                        raid in "Ruiny Starego Fortu" is the
                                        same biome as the dungeon, just run
                                        as a 4-up party fight). */}
                                    <div className="raid__card-head">
                                        <h3 className="raid__card-name">{r.name_pl}</h3>
                                        {desc && (
                                            <p className="raid__card-desc">{desc}</p>
                                        )}
                                    </div>

                                    {/* Quick reward callout — same shape as
                                        the dungeon (":money-bag: min–max" + ":star: ~xp")
                                        so a player can compare raid vs.
                                        dungeon yields directly without
                                        decoding a multiplier. Numbers come
                                        from `estimateRaidRewards`, which
                                        mirrors the live engine math. */}
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

                                    {/* Attempts strip — used/max + bar.
                                        Drops the "Próby:" prefix to match
                                        the dungeon's terser ":crossed-swords: 1/5"
                                        format; the swords icon already
                                        signals "attempts" semantically. */}
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

                        {/* Drop-table modal — single instance lives outside
                            the .map() so only one popup is mounted at once.
                            Backdrop click & explicit :multiply: both dismiss. */}
                        {dropModalRaidId && (() => {
                            const r = raids.find((x) => x.id === dropModalRaidId);
                            if (!r) return null;
                            const hue = getRaidCardHue(r.level);
                            const totalBosses = r.waves * 4;
                            // Same engine-mirroring estimate as the card
                            // surface — keeps the modal honest about the
                            // gold/XP a successful run actually pays out.
                            const modalEst = estimateRaidRewards(r);
                            // Potion + spell-chest info pulled from the
                            // shared lootSystem so the raid modal renders
                            // the same per-tier rows the dungeon does.
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
                                            {/* Nagrody — gold range + xp
                                                estimate (mirrors dungeon
                                                modal); the old "×10 mnożnik"
                                                line was redundant once the
                                                actual numbers are visible. */}
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

                                            {/* Mikstury — HP + MP rolled
                                                independently per boss, same
                                                shape the dungeon modal uses
                                                via `getPotionDropInfo`. Mega
                                                tier (raid level ≥ 100) gets
                                                its own pair of rows when
                                                eligible. The earlier "stronger
                                                potions at higher raid levels"
                                                hint was redundant — the tier
                                                names already show that. */}
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

                                            {/* Spell Chests — one row per
                                                eligible chest level (those at
                                                or below the raid's level).
                                                Flat 0.25% per chest, rolled
                                                independently per boss; matches
                                                `SPELL_CHEST_CHANCE_PER_LEVEL`
                                                in raidSystem.ts. Hidden when
                                                the raid is too low for any
                                                chest to drop. */}
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

                                            {/* Completion bonus — extra roll
                                                each surviving member gets at
                                                the end of the raid. Per-tier
                                                list (not a paragraph) so each
                                                rarity name picks up its own
                                                colour and reads as a category
                                                — same visual grammar as the
                                                Przedmioty / Kamienie sections
                                                above. Header drops the legacy
                                                "(1×)" suffix in favour of the
                                                clearer "(dodatkowy drop)". */}
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

    // -- Render: victory / wipe ----------------------------------------------
    // Per-member loot tiles on victory — each surviving member gets a
    // raid-tinted card listing every drop the engine rolled for them.
    // Hue is derived from the raid level (matches the lobby card colour
    // so the result screen feels like the conclusion of the same raid).
    if (phase === 'victory' || phase === 'wipe') {
        const resultHue = selectedRaid ? getRaidCardHue(selectedRaid.level) : 220;
        // 2026-05-17 spec ("Sluchaj zginalem w party na raidzie
        // kliknalem zeby zostac i wskrzesic przez graczy, ale nikt
        // mnie nie wskrzesil ... powinienem miec tylko guzik wroc do
        // miasta i powinienem miec animacje smierci i zginac"): if
        // the local player is still flagged dead at the result
        // screen (we chose Czekaj-na-wskrzeszenie but no one revived
        // us before the raid ended), surface them as actually dead
        // here — hide Ponów / Walcz wyżej / Wyjdź z party / Powrót
        // do lobby and offer only the single "Wróć do miasta" CTA.
        // The death animation fires through the standard death-
        // overlay (see the useEffect just below) so the player
        // sees the same dying flow that fires when they die mid-
        // fight without choosing Czekaj.
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
                                            // Render single drop as an icon tile with tooltip.
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
                                                    // 2026-05-08: use the generic +50 HP potion
                                                    // PNG as a real-art fallback; raid drops
                                                    // currently don't carry a specific potion
                                                    // ID so we can't pick a tier-specific tile.
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
                                            // Pull the completion-roll bonus item out so it can render
                                            // under its own "Dodatkowy item:" label — easy for the
                                            // player to spot vs. getting lost in the per-boss grid.
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
                        {/* 2026-05-14 spec ("Kazdy sojusznik co nie
                            jest liderem powinien miec guziki tylko
                            opusc party i wroc do menu jak w bossie"):
                            non-leader members get a single "Wyjdź z
                            party" CTA — same shape boss uses. They
                            leave the party + navigate to town; the
                            leader is the one chaining fights.
                            Leaders see Ponów / Walcz wyżej + Powrót
                            do lobby (subject to the alone-party gate
                            below). */}
                        {iDiedUnresurrected ? (
                            // 2026-05-17 spec ("powinienem miec tylko
                            // guzik wroc do miasta"): dead-not-
                            // resurrected gets the single Wróć do
                            // miasta CTA — no retry, no claim, no
                            // "Wyjdź z party". Rewards are already
                            // credited via distributeRewards above.
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
                                {/* "Ponów" — leader-only, victory phase,
                                    attempts remaining, AND at least one
                                    other human still in party (#3 spec
                                    "Jezeli wyszlo tyle osob podczas walki
                                    w raidzie ze zostalo sie samemu to na
                                    podsumowaniu nie powinno byc guzika
                                    ponow tylko wroc do miasta"). */}
                                {phase === 'victory'
                                    && selectedRaid
                                    && attemptsRemaining(selectedRaid.id) > 0
                                    && (party?.members.filter((m) => m.id !== character?.id && !m.isBot).length ?? 0) > 0 && (
                                    <button
                                        className="raid__primary raid__primary--retry"
                                        onClick={() => {
                                            const r = selectedRaid;
                                            // 2026-05-14: flag a retry so the
                                            // selectedRaid -> null transition
                                            // (inside backToLobby) doesn't fire
                                            // publishCombatEnd — that flushed
                                            // members straight off the /raid
                                            // route and the beforeunload-style
                                            // cleanup applied a full death
                                            // penalty. Cleared after startRaid
                                            // re-sets selectedRaid to non-null.
                                            retryInProgressRef.current = true;
                                            backToLobby();
                                            // Defer to next tick so backToLobby's
                                            // state resets (phase=lobby, members=[],
                                            // etc.) commit BEFORE startRaid spawns
                                            // a fresh fight.
                                            setTimeout(() => {
                                                startRaid(r);
                                                retryInProgressRef.current = false;
                                            }, 0);
                                        }}
                                    >
                                        <GameIcon name="crossed-swords" /> Ponów
                                    </button>
                                )}
                                {/* 2026-05 v6: when this raid's daily attempts
                                    are spent, surface the next higher-level
                                    raid the party can clear. Same alone-party
                                    gate as Ponów. */}
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

    // -- Render: fighting (unified CombatUI) ---------------------------------
    // Raid feeds into the same shared CombatUI tree as every other view: the
    // 4 wave bosses fill the enemies column and the (up to 4) party members
    // fill the allies column. Daily-boss shimmer bg since raids are 3×/day
    // boss-tier encounters. No skills/potions exposed (raids auto-resolve).
    // Speed cycles X1->X2->X3->X4->X1 via the shared chip.
    const cycleSpeed = () => {
        // 2026-05-13: only the leader can change combat speed in a
        // shared raid. Members mirror via combat-speed broadcast.
        if (isNonLeaderMember) return;
        const idx = SPEED_OPTIONS.findIndex((s) => s.mult === speedMult);
        const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
        setSpeedMult(next.mult);
    };
    const speedLabel = SPEED_OPTIONS.find((s) => s.mult === speedMult)?.label ?? 'X1';

    // Pad enemies to 4 slots; pad allies to 4 slots.
    const padTo4 = <T,>(arr: Array<T | null>): Array<T | null> => {
        const out = arr.slice(0, 4);
        while (out.length < 4) out.push(null);
        return out;
    };

    // -- Player accent for transform-tinted HUD chrome ----------------------
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
            // `monster` (not `boss`) so EnemyCard pulls `monster-{level}.png`
            // via MonsterSprite — raids now spawn boss-tier mobs from
            // monsters.json, so the matching image registry is the monster
            // one. The `rarity: 'boss'` below still drives the boss-tier
            // border / score treatment, just not the sprite lookup.
            kind: 'monster' as const,
            currentHp: Math.max(0, b.currentHp),
            maxHp: b.maxHp,
            rarity: 'boss',
            isDead: b.isDead,
            // First alive boss is the "focused" target for visual clarity.
            isTargetedByPlayer: !b.isDead && bosses.findIndex((bb) => !bb.isDead) === bosses.indexOf(b),
            // Per-boss pulse — bumped inside the tick loop on every member's
            // basic attack and every skill hit, so the keyed flash overlay
            // re-mounts for each individual hit (4 members focus-firing the
            // same boss = 4 separate flashes).
            hitPulse: bossHitPulses[b.id] ?? 0,
            // Class-specific basic-attack flash — the matching CSS overlay
            // (defined in CombatUI.scss as `combat-ui__enemy--attack-{class}`)
            // plays when a member of that class lands a basic hit.
            attackingClassName: bossAttackerClass[b.id]
                ? `attack-${bossAttackerClass[b.id].className}`
                : null,
            // Per-slot themed skill animation + floating damage numbers
            skillAnim: fx.enemySkill[slot] ?? null,
            floats: fx.enemyFloats[slot] ?? [],
            // 2026-05 v7: live status countdowns on each raid boss.
            // Klątwa Śmierci :skull-and-crossbones: ×N · Ts and Mroczny Rytuał :skull: N% · Ts
            // both render so the player can time the burst window
            // before the mark/ritual expires.
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
    // 2026-05-15 v10 spec ("I dalej to samo na widoku walki raidu,
    // znowu"): drop members that have already escaped (hasEscaped =
    // true) from the visible roster BEFORE building cards. Otherwise
    // a leader who fled but lingers in `members` for a couple ticks
    // (until the cleanup useEffect catches up with the party-store
    // broadcast) keeps their phantom slot in the layout — and any
    // residual badge on that card (boss aggro pointing at them, a
    // pending fx float that didn't get reset, an early-frame anim
    // overlay, etc.) reads as a "shield icon in the empty tile" the
    // user has been reporting for 9 rounds. Filtering them out of
    // `uiAllies` makes the slot literally `null`, AllyCard returns
    // its empty `<div>`, and nothing can render inside.
    const visibleMembersForUi = members.filter((m) => !m.hasEscaped);
    const uiAllies: Array<ICombatAlly | null> = padTo4(
        visibleMembersForUi.map<ICombatAlly>((m, slot) => {
            // Per-member necro-summon stack. Non-necro members read 0/{}.
            // 2026-05-15 v16 + v17 spec ("Jako sojusznik party nie
            // widze summonow necromanty" / "Tutaj cos sie stalo nie
            // tak z summonami sojusznicy widza inne summony niz
            // necromanta"): for non-self necromancers, ALWAYS prefer
            // the partyPresence broadcast (the necro's own client is
            // the source of truth). The local `necroSummons` store
            // may not have entries for remote players OR may have
            // stale entries from a previous fight — picking presence
            // first guarantees parity. For SELF (the necromancer's
            // own client) we use the local store directly because the
            // engine writes there before the broadcast goes out.
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
            // Necromancer card swap — front-of-queue summon takes the
            // slot. Per-member: each necro raid member can have their
            // own active summon shown.
            const frontSummonR = summonList.length > 0
                ? [...summonList].sort((a, b) => SUMMON_RANK_R[a.type] - SUMMON_RANK_R[b.type])[0]
                : null;
            const memberName = (m.class === 'Necromancer' && frontSummonR)
                ? SUMMON_LABELS_R[frontSummonR.type]
                : m.name;
            // 2026-05-14 spec ("Jest zly avatar sojusznikow"): pull the
            // transform tier from the live member snapshot (broadcast
            // via partyPresenceStore on each member's own client) so
            // the ally card shows the correct transformed avatar — not
            // the base class portrait. Same pattern PartyWidget uses.
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
            // 2026-05 v7: only the LOCAL player can dismiss their own
            // summons. Each raid member has their own summon queue keyed
            // by `m.id`, so passing `m.id` here lets the player tap
            // their own card's badge to despawn one. Bot members'
            // cards leave `onSummonClick` undefined -> read-only.
            onSummonClick: m.id === character?.id
                ? (type) => {
                    useNecroSummonStore.getState().despawnOne(m.id, type);
                    addLog(`:dashing-away: Odesłano: ${type}`);
                }
                : undefined,
            // How many alive bosses currently picked this member as their
            // swing target. Boss-attack tick refreshes the pick map every
            // ~1.5 s @ X1, so the indicator updates with each round.
            aggroCount: bosses.filter((b) => !b.isDead && bossAggroIds[b.id] === m.id).length,
            // Per-member pulse — bumped inside the boss-attack tick when this
            // member is randomly picked as the swing target. The keyed flash
            // overlay in AllyCard re-mounts for every distinct hit, so a tick
            // where 4 bosses all swing shows 4 visible flashes across the
            // party (one per recipient) instead of a single shared shake.
            hitPulse: memberHitPulses[m.id] ?? 0,
            // 2026-05-15 v16: per-ally attacking-class overlay so
            // boss attacks paint a strike on the target's card.
            attackingClassName: memberAttackingClass[m.id] ?? null,
            transformTier: m.transformTier > 0 ? m.transformTier : undefined,
            // Per-slot themed skill animation + floating damage numbers (red
            // monster numbers when bosses crack the party for damage).
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

                    {/* Spawn-timer bar — visible only between waves while
                        the next wave's bosses are about to spawn. Same
                        slim under-header pin as hunting auto-fight +
                        dungeon / transform spawn timers. */}
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

                    {/* Wave banner — same shared slot used by Dungeon &
                        Transform so the three views feel unified. Includes
                        the raid name on raids since the player can run
                        multiple raids in a session. */}
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
                            // 2026-05-15 v15 spec ("Dalej animacja
                            // spella potworow pokazuje sie w zlym
                            // miejscu dla raidu"): the
                            // global `raid__fx` overlay was a
                            // duplicate of the per-card animation
                            // already painted by
                            // `fx.triggerEnemySkillAnim(bossSlot,
                            // skillId)`. The overlay was pinned to
                            // `top:10 right:10` of the arena — and
                            // since the arena's right side is the
                            // ally column, every spell cast painted a
                            // floating glyph on TOP of the rightmost
                            // empty ally tile. That's the persistent
                            // "shield/animation in the wrong place"
                            // the user has been reporting. The per-
                            // card skill animation (see `skillAnim`
                            // on EnemyCard / AllyCard) already shows
                            // each spell on its actual target, so the
                            // global overlay is removed entirely.
                            null
                        }
                    />

                    {/* No XP bar in raids — kept null so the sub-controls
                        row only carries the bag/log buttons. */}
                    <CombatSubControls xp={null} />

                    {(() => {
                        // Build the 4 skill slots from the player's persisted
                        // active-skill bar. A click pushes onto `skillQueueRef`
                        // and the raid combat tick fires it on the very next
                        // pulse (manual cast takes priority over auto-cast,
                        // see the loop above).
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
                                // ms-based progress = (1 - remaining / total).
                                // CombatActionBar sweeps the dark overlay
                                // bottom-up using `(1 - cooldownProgress) * 100%`
                                // so 0 = full overlay, 1 = ready (no overlay).
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

                        // Potion slots — same buildPotion shape as Combat /
                        // Boss / Dungeon. Each slot is rendered when the
                        // matching tier is owned (best owned variant wins).
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
                                // 2026-05: pass selected potion's PNG to the dock.
                                icon: getPotionImage(potion.id) ?? undefined,
                                count,
                                cooldownProgress: cdActive ? 1 - cd / cdMax : 1,
                                cooldownRemainingMs: cdActive ? cd : 0,
                                disabled: count === 0 || cdActive,
                                // `useRaidPotion` is a useCallback handler (defined above), not a
                                // React Hook — rules-of-hooks misfires purely on the `use` name
                                // prefix. Comment only; no runtime-behavior change to this path.
                                // eslint-disable-next-line react-hooks/rules-of-hooks
                                onClick: () => useRaidPotion(potion.id),
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

            {/* Mid-fight death-choice popup. Fires only when the player
                goes down WHILE allies are still up — solo-style "everyone
                dead" deaths route through handleWipe + the global
                DeathNotification instead. */}
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
