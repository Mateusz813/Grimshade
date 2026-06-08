import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    calculateDamage,
    getMonsterAttackRange,
    MONSTER_STAT_MULTIPLIERS,
} from '../../systems/combat';
import {
    getEffectiveRarityChances,
    formatRarityChance,
    getSpellChestDropInfo,
    getPotionDropInfo,
} from '../../systems/lootSystem';
import { getTotalEquipmentStats, flattenItemsData, STONE_ICONS, type IBaseItem } from '../../systems/itemSystem';
import TinyIcon from '../../components/ui/TinyIcon/TinyIcon';
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
import { MonsterSprite } from '../../components/ui/Sprite/MonsterSprite';
import { useCombatStore, type IMonster } from '../../stores/combatStore';
import { useCombatHudStore } from '../../stores/combatHudStore';
import { usePartyDamageStore } from '../../stores/partyDamageStore';
import { requestPartyCombatStart, registerGoReplicator } from '../../hooks/usePartyReadyCheck';

// 2026-05-09: register the hunt go-replicator at module load. When a
// non-leader member receives the `go` event for the /combat
// destination, this fires `engineStartNewFight(monster)` so they
// land on the SAME monster + wave count the leader picked.
registerGoReplicator('/combat', (payload) => {
    if (!payload) return;
    const p = payload as { monster: Parameters<typeof engineStartNewFight>[0]; waveCount?: number };
    if (!p.monster) return;
    // 2026-05-10 spec ("knight niezywy od startu"): if the joining
    // member is at 0 HP (e.g. left over from a prior session/death
    // that never resolved), heal them to full BEFORE starting the
    // shared fight. Otherwise the leader sees an immediately-dead
    // ally card and the member's engine spawns at hp=0.
    const ch = useCharacterStore.getState().character;
    if (ch && (ch.hp ?? 0) <= 0) {
        useCharacterStore.getState().fullHealEffective();
    }
    // Members should spawn the SAME number of monsters the leader
    // chose. Sync the wavePlannedCount before kicking off the fight.
    if (typeof p.waveCount === 'number' && p.waveCount > 0) {
        useCombatStore.getState().setWavePlannedCount(p.waveCount);
    }
    // 2026-05-11 spec ("knight nie dolaczyl do walki"): pass
    // `bypassLevelCheck=true` so a lower-level party member can follow
    // the leader into a monster they couldn't solo. The leader has
    // already validated level + mastery on their end; if the member's
    // engine re-checks, the fight silently never starts and the member
    // is stranded on the hub picker. This also skips the mastery gate
    // (see startNewFight implementation).
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
import './Combat.scss';

// Potion cooldown durations (ms) — for manual potion use UI
const HP_POTION_COOLDOWN_MS = 1000;
const MP_POTION_COOLDOWN_MS = 1000;
const SKILL_COOLDOWN_MS = 8000;
// 2026-05-12: scale skill MP cost with player's effective max MP.
// See combatEngine.ts → `getSkillMpCost()` for the formula. Imported
// at top of file; alias kept for readability at call sites.

// ── Types / constants ─────────────────────────────────────────────────────────

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
// Maps a combat variant key (`normal`/`strong`/.../`boss`) to its drop
// stone ID so we can resolve the proper PNG via STONE_ICONS.
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

// ── Main component ────────────────────────────────────────────────────────────

const ALL_ITEMS: IBaseItem[] = flattenItemsData(itemsData as Parameters<typeof flattenItemsData>[0]);

/**
 * Module-level set of party.id values we've already reset
 * session counters for. Survives Combat.tsx unmount/remount so a
 * background-mode round-trip (town → /combat) doesn't wipe the
 * shared session tally.
 */
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
    } = useSettingsStore();
    const { activeSkillSlots } = useSkillStore();
    const consumables = useInventoryStore((s) => s.consumables);
    const activeTasks = useTaskStore((s) => s.activeTasks);
    const activeQuests = useQuestStore((s) => s.activeQuests);
    const completedTransforms = useTransformStore((s) => s.completedTransforms);
    const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
    const transformColor = getHighestTransformColor();
    const playerAvatarSrc = character ? getCharacterAvatar(character.class, completedTransforms) : '';
    // Necromancer summon stack — when the local player is a necro, this is
    // the live ordered list spawned by `useNecroSummonStore` and consumed
    // by AllyCard for the count badge + tooltip breakdown.
    const necroSummons = useNecroSummonStore((s) => s.summons);

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
        phase, monster,
        playerCurrentHp, playerCurrentMp,
        log,
        addLog, healPlayerHp, healPlayerMp, spendPlayerMp,
        setSelectedMonster,
    } = useCombatStore();

    // Background combat state from store (not local)
    const autoFight = useCombatStore((s) => s.autoFight);
    const lastCombatEvent = useCombatStore((s) => s.lastCombatEvent);
    // Wave state
    const waveMonsters = useCombatStore((s) => s.waveMonsters);
    const activeTargetIdx = useCombatStore((s) => s.activeTargetIdx);
    const wavePlannedCount = useCombatStore((s) => s.wavePlannedCount);
    const decrementWavePlannedCount = useCombatStore((s) => s.decrementWavePlannedCount);
    // Live XP/h readout — populated globally by `useBackgroundCombat` (mounted
    // in App.tsx). Read it here so we can pass into <CombatSubControls> for
    // the in-bar "X.Yk XP/h" badge.
    const sessionXpPerHour = useCombatStore((s) => s.sessionXpPerHour);
    // Party bots fighting alongside the player (hydrated in startNewFight)
    const partyBots = useBotStore((s) => s.bots);
    // 2026-05-09: party humans (non-self, non-bot) shown as ally cards
    // alongside the local player. Live HP/MP comes from the realtime
    // presence broadcast (`usePartyPresence` heartbeat).
    const partyPresence = usePartyPresenceStore((s) => s.byMember);
    // 2026-05-09: realtime spell-cast cues from other party members.
    // Drives the ally-card skill anim when a teammate casts a spell.
    const partyLastSpells = usePartyCombatSyncStore((s) => s.lastSpellByCaster);
    // 2026-05-11: realtime damage events from the party-combat channel.
    // Driven by the leader's resolved attacks (own + applied member
    // attack-actions). Every client renders the same hit animation +
    // floating number, and the per-attacker damage counter sums via
    // `partyDamageStore.addDamage(attackerId, dmg)`.
    const partyLastDamage = usePartyCombatSyncStore((s) => s.lastDamageByAttacker);
    // 2026-05-11: realtime "monster hit a member" events. Whatever
    // client receives it renders a floating damage number on the
    // targeted member's ally slot so the whole party visually sees who
    // took the hit. The targeted member additionally applies the
    // damage to their own character (handled in usePartyCombatSync).
    const partyLastMemberHit = usePartyCombatSyncStore((s) => s.lastMemberHit);

    // 2026-05-09 spec ("tylko lider zmienia walke"): in a multi-human party
    // (i.e. at least one OTHER human besides me) only the leader can change
    // wave count, combat speed, or kick off a fight. Bots don't count — a
    // solo player with only bot helpers is still effectively the leader.
    // Members keep the read-only display so they see what the leader picked.
    const isMemberInMultiHumanParty = useMemo(() => {
        if (!party || !character) return false;
        const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
        if (otherHumans.length === 0) return false;
        return party.leaderId !== character.id;
    }, [party, character]);

    // 2026-05-14 spec ("port death popup/handoff to hunt"): are we
    // the leader in a multi-human party? Drives the PartyDeathChoice
    // popup that arms when the leader's HP drops to 0 — instead of
    // auto-running the full death sequence, the player picks between
    // bailing to town (penalty + leader-handoff + leaveParty) or
    // waiting for a Cleric ally to revive them. Members in hunt
    // currently can't really die (engine auto-heals them) so the
    // popup is leader-only for now.
    const isLeaderInMultiHumanParty = useMemo(() => {
        if (!party || !character) return false;
        const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
        if (otherHumans.length === 0) return false;
        return party.leaderId === character.id;
    }, [party, character]);

    const logContainerRef = useRef<HTMLDivElement>(null);

    /** Monster currently being inspected in the drop-info modal (idle phase). */
    const [dropModalMonsterId, setDropModalMonsterId] = useState<string | null>(null);

    /** Hunt-only "Wyjdź" popup ("Zakończ polowanie" / "Wróć do miasta"). */
    const [exitDialogOpen, setExitDialogOpen] = useState(false);

    // 2026-05-14: leader-death choice popup state. `deathChoicePopup`
    // is shown when the leader hits 0 HP with at least one ally still
    // up. `deathChoiceShownRef` is the one-shot latch — without it the
    // popup would re-open every render frame because HP stays at 0 on
    // the engine's view (the leader bail keeps it there).
    // `waitingForResRef` flips when the player picks "Czekaj"; if a
    // teammate Cleric's Aura Wskrzeszenia revives them, the auto-
    // close effect below catches the heal and clears all three.
    const [deathChoicePopup, setDeathChoicePopup] = useState(false);
    const deathChoiceShownRef = useRef(false);
    const waitingForResRef = useRef(false);

    // 2026-05-14: arm the popup when the leader's HP hits 0 with at
    // least one ally still up. The engine's `handlePlayerDeath` bails
    // for this exact case (see combatEngine.ts) so we DON'T need to
    // race the death sequence — HP just sits at 0 until the player
    // picks a path.
    useEffect(() => {
        if (!isLeaderInMultiHumanParty) return;
        if (phase !== 'fighting') return;
        if (playerCurrentHp > 0) return;
        if (deathChoiceShownRef.current) return;
        // Count alive allies (bots + humans whose presence shows HP > 0).
        const aliveBots = partyBots.filter((b) => b.alive).length;
        const aliveHumans = (party?.members ?? []).filter((m) => {
            if (m.id === character?.id) return false;
            if (m.isBot) return false;
            const pres = partyPresence[m.id];
            return !pres || pres.hp > 0;
        }).length;
        const aliveAllies = aliveBots + aliveHumans;
        if (aliveAllies <= 0) {
            // No one to revive us — let the engine's auto-death fire
            // by forcing through immediately. We pass true so the
            // leader-bail in handlePlayerDeath doesn't trigger again.
            engineHandlePlayerDeath(true);
            return;
        }
        deathChoiceShownRef.current = true;
        setDeathChoicePopup(true);
    }, [isLeaderInMultiHumanParty, phase, playerCurrentHp, partyBots, party, character?.id, partyPresence]);

    // 2026-05-14: auto-close the popup if a Cleric's Aura Wskrzeszenia
    // (or any other heal) brings the player back above 0 HP. Clears
    // the one-shot latch so a later death re-arms it.
    useEffect(() => {
        if (playerCurrentHp > 0 && deathChoicePopup) {
            setDeathChoicePopup(false);
            deathChoiceShownRef.current = false;
            waitingForResRef.current = false;
        }
    }, [playerCurrentHp, deathChoicePopup]);

    // 2026-05-14: "Wróć do miasta" handler. Mirrors Boss/Raid's
    // confirm branch — promote an alive human teammate to leader so
    // the fight continues under fresh authority, drop ourselves out
    // of the party so members see us disappear, then run the full
    // death sequence via the engine (penalty + global skull overlay +
    // nav home). Fire-and-forget the network calls so the overlay
    // doesn't wait.
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
                        } catch { /* best effort */ }
                    }
                }
                try {
                    await usePartyStore.getState().leaveParty(me);
                } catch { /* best effort */ }
            })();
        }
        // Run the full engine death sequence. forceConfirm=true pushes
        // past the leader-in-multi-human-party bail we added so the
        // penalty + skull overlay + nav home actually fire.
        engineHandlePlayerDeath(true);
    }, []);

    // 2026-05-14: "Czekaj na wskrzeszenie". Closes the popup but the
    // engine keeps HP at 0 — the player sits slumped on the field and
    // an ally Cleric's Aura Wskrzeszenia can rez them back to half HP.
    // The auto-close effect above catches the heal and re-arms the
    // latch for a future death.
    const handleDeathWaitForRes = useCallback(() => {
        setDeathChoicePopup(false);
        waitingForResRef.current = true;
    }, []);

    // 2026-05-17 v2 spec ("to sie tyczy kazdej walki w party"): when a
    // hunt wave wraps in victory but the local player is still dead
    // (chose Czekaj earlier, no Cleric rez), auto-fire the same
    // sequence as the Wróć-do-miasta button: penalty + death overlay
    // + leave party + nav home. Without this the leader's autoFight
    // (or "Walcz ponownie" click) would yank the dead player into
    // the next wave at 0 HP — they'd loop through Czekaj → death
    // → Czekaj forever. One-shot per session via deathChoiceShownRef
    // semantics — the existing handler already gates re-entry.
    const autoDeathOnVictoryRef = useRef(false);
    useEffect(() => {
        if (phase !== 'victory') return;
        if (playerCurrentHp > 0) return;
        if (autoDeathOnVictoryRef.current) return;
        autoDeathOnVictoryRef.current = true;
        handleDeathReturnToTown();
    }, [phase, playerCurrentHp, handleDeathReturnToTown]);
    // Re-arm the latch the moment combat resumes so a future death
    // can re-fire the auto handler.
    useEffect(() => {
        if (phase === 'fighting') {
            autoDeathOnVictoryRef.current = false;
        }
    }, [phase]);

    // ── Level-up HP/MP refill ─────────────────────────────────────────────────
    // characterStore.addXp() refills character.hp/mp to the new max on every
    // level-up. Hunting keeps live HP/MP in combatStore.playerCurrentHp/Mp,
    // which is NOT touched by addXp — without this hook the player would level
    // up mid-fight and watch their bars stay at the pre-level-up value until
    // the next monster died and the engine re-synced. Refill on event so the
    // bars jump to 100% the same frame the level-up popup shows.
    useLevelUpRefill(phase === 'fighting', useCallback((maxHp, maxMp) => {
        useCombatStore.setState({
            playerCurrentHp: maxHp,
            playerCurrentMp: maxMp,
        });
    }, []));

    // 2026-05-11 spec ("dmg pasek gorny zbiorcze z calego polowania"):
    // the party-damage tally accumulates across the WHOLE hunt — every
    // wave, every monster — and resets ONLY when the player leaves
    // combat (Wyjdź / Zakończ Polowanie / Wróć do miasta). The old
    // per-wave reset on phase==='fighting' wiped the counter on every
    // auto-fight transition, which made it useless for tracking party
    // contribution. Resetting on mount instead gives one tally per
    // combat session.
    const damageResetDoneRef = useRef(false);
    useEffect(() => {
        if (damageResetDoneRef.current) return;
        damageResetDoneRef.current = true;
        usePartyDamageStore.getState().reset();
    }, []);

    // 2026-05-12 spec ("po powrocie z miasta nie reset counterow / liczniki
    // nie zgadzaja sie miedzy graczami"): reset the per-session kill
    // counters + accumulated XP / gold ONCE per party.id. Using a
    // module-level map outside React so the reset state survives
    // Combat.tsx unmount/remount (e.g. player goes to town for
    // background combat, then comes back — view remounts but the same
    // party is still active, so we MUST NOT reset again).
    //
    // Both leader's and member's clients hit this effect when their
    // local `party` first transitions to a multi-human roster. Both
    // call `resetSession()` so they start the shared tally at 0 on
    // the same "first kill". Every subsequent kill broadcast keeps
    // them in lockstep.
    useEffect(() => {
        if (!character || !party) return;
        const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
        if (otherHumans.length === 0) return;
        if (sharedSessionResetSeen.has(party.id)) return;
        sharedSessionResetSeen.add(party.id);
        useCombatStore.getState().resetSession();
    }, [character, party]);

    // 2026-05-11: defensive heal at /combat mount — if the player
    // arrives at the combat view with character.hp <= 0 (left over
    // from any prior session bug, an interrupted death penalty, or a
    // stale Supabase row), refill them. The defensive heal in
    // `switchToCharacter` covers session boot; this one catches
    // direct navigations or hot-reloads that skip the boot path.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Live HP/MP mirror → characterStore ────────────────────────────────────
    // Hunting keeps its live HP/MP in combatStore (playerCurrentHp/Mp).
    // combatEngine already syncs these to characterStore on every kill, but
    // the global TopHeader bars need the WITHIN-fight values too — without
    // this mirror they'd freeze between kills until the monster dies. The
    // engine's stopCombat() and post-kill sync still own end-of-fight
    // persistence; this effect only handles the mid-fight ticks.
    //
    // Clamp uses EFFECTIVE max (base + equipment + training + active
    // elixirs + transform), NOT the raw `liveChar.max_hp`. Without this,
    // a potion that brings local HP above base max while an HP elixir is
    // active would write a truncated value to the store and the
    // TopHeader bar would lose the elixir-buffed surplus.
    useEffect(() => {
        if (phase !== 'fighting' && phase !== 'victory') return;
        // 2026-05-11: for non-leader members in a multi-human party,
        // combatStore.playerCurrentHp/Mp reflect the SHARED arena state
        // (leader-authoritative). It's NOT this player's HP/MP. Don't
        // mirror it back into character.hp — that would wipe out the
        // member's real HP with the leader's value the moment they
        // walk into /combat.
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

    /** Auto-potion master toggle — flips both HP and MP flat-potion auto-use
     *  in one chip click (the spec wants a single user-facing switch). */
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

    // ── Combat animation state ─────────────────────────────────────────────────
    // Per-monster hit pulse map: monster idx -> monotonically-increasing
    // counter. EnemyCard renders a keyed flash overlay against this counter,
    // so two near-simultaneous hits on the same slot (auto + skill, party
    // members syncing on the same tick) each get their own visible flash
    // instead of the second one being swallowed by the in-flight 300ms
    // animation. `hitMonsterIdx` is kept separately to drive the attacker
    // class slash visual, which is short-lived and naturally resets.
    const [hitMonsterIdx, setHitMonsterIdx] = useState<number | null>(null);
    const [monsterHitPulses, setMonsterHitPulses] = useState<Record<number, number>>({});
    const [playerHitPulse, setPlayerHitPulse] = useState(0);
    // Per-bot pulse counter — keyed by bot id. Engine emits `botHit` events
    // whenever a wave monster's aggro lands on a party member, so the player
    // can visually track which bots are getting focused.
    const [botHitPulses, setBotHitPulses] = useState<Record<string, number>>({});
    // 2026-05-11: per-remote-human hit pulse — bumped when a party-combat
    // `member-hit` event arrives. Drives the same flash/shake overlay as
    // the local player and bots so a monster swing on Archer's ally card
    // (on Knight's screen) looks identical to a monster swing on Knight's
    // own card. Keyed by character id.
    const [humanHitPulses, setHumanHitPulses] = useState<Record<string, number>>({});
    // Note: we no longer track an attacker-side `playerAttacking` flag because
    // attack animations now land ONLY on the targeted monster (see uiEnemies
    // binding below). The target's `attack-{class}` modifier is gated on
    // `hitMonsterIdx` + `attackingClassName` alone.
    const [attackingClassName, setAttackingClassName] = useState<string | null>(null);

    // Skill animation overlay — same pattern as Boss/Dungeon. The hook owns a
    // single `overlay` slot that holds the active skill's emoji + cssClass and
    // auto-clears after `animData.duration`. We pass it down to <CombatArena>.
    const { trigger: triggerSkillAnim } = useSkillAnim();
    // Per-slot combat VFX. Hunting uses 4 wave-monster slots on the left
    // (engine ships `targetIdx` in events) and player + bots on the right.
    // We bind these into uiEnemies / uiAllies further down so the cards
    // render automatically.
    const fx = useCombatFx();

    // Auto-fight countdown progress — drives a thin bar above "Walcz ponownie"
    // when the player is in `victory` phase with auto-fight ON. Mirrors the
    // engine's `AUTO_FIGHT_DELAY_MS` timer in `useBackgroundCombat`. Hidden
    // when SKIP speed is active (delay collapses to 10ms — would just blink).
    const [autoFightProgress, setAutoFightProgress] = useState(0);

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

    // Pin the attack animation to the GIVEN slot. We accept `idx` as an
    // argument instead of reading `activeTargetIdx` from the store because by
    // the time the React effect fires, the engine may have already advanced
    // the cursor (post-kill). The engine now ships `targetIdx` in the
    // `monsterHit` event payload — we route it through here so the slash /
    // bolt / arrow visual sticks to the slot that was actually struck.
    // The pulse counter is bumped on every distinct hit so the keyed flash
    // overlay in EnemyCard re-mounts each time, even if the previous flash
    // hasn't faded yet.
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

    // ── Reset FX on return-to-idle ────────────────────────────────────────────
    // The combat-fx hook holds floats / skill overlays in local state. Hit
    // pulses naturally fade with their CSS, but a fight that ends mid-cast
    // (e.g. monster died right after a skill fired) could leave a stale skill
    // overlay sitting on the slot when the player returns to the monster picker.
    // Clearing on phase=idle gives every new fight a clean visual canvas.
    //
    // IMPORTANT: depend on the stable `fx.resetFx` callback (memoised with
    // `useCallback([])` inside `useCombatFx`), NOT on the `fx` object — `fx`
    // is a fresh object literal every render, so depending on it would re-run
    // this effect every render. When phase === 'idle', that loops:
    // resetFx() → 4 setStates to new {} → re-render → new fx → effect again.
    const resetFx = fx.resetFx;
    useEffect(() => {
        if (phase === 'idle') resetFx();
    }, [phase, resetFx]);

    // ── Remote ally spell-cast → fire animation on the right card ────────
    // The partyCombatSyncStore receives `spell-cast` events from teammates
    // and stores the latest one per casterId. We watch that map and, when
    // a NEW timestamp lands for any caster other than the local player,
    // dispatch the animation:
    //   • DAMAGE spells → triggerEnemySkillAnim on the target monster slot
    //     (the spell visually lands on the enemy, exactly like for our own
    //     casts). Each player kills their OWN copy of the monster, so the
    //     floating damage value isn't shipped — only the cast cue is.
    //   • SELF / HEAL / BUFF spells → triggerAllySkillAnim on the caster's
    //     ally card so the aura shows where it's actually applied.
    const lastRemoteCastTsRef = useRef<Record<string, number>>({});
    useEffect(() => {
        if (!character) return;
        const orderedHumanIds = (party?.members ?? [])
            .filter((m) => m.id !== character.id && !m.isBot)
            .map((m) => m.id);
        for (const [casterId, cast] of Object.entries(partyLastSpells)) {
            if (casterId === character.id) continue; // local cast handled by engine
            const prev = lastRemoteCastTsRef.current[casterId] ?? 0;
            if (cast.sentAt <= prev) continue;
            lastRemoteCastTsRef.current[casterId] = cast.sentAt;
            const humanIdx = orderedHumanIds.indexOf(casterId);
            if (humanIdx < 0) continue;
            const allySlot = humanIdx + 1; // +1 because slot 0 is local player
            if (cast.isDamageHit && typeof cast.targetIdx === 'number') {
                fx.triggerEnemySkillAnim(cast.targetIdx, cast.skillId);
            } else {
                fx.triggerAllySkillAnim(allySlot, cast.skillId);
            }
        }
    }, [partyLastSpells, party?.members, character, fx]);

    // ── Remote damage events → animations + damage counter ────────────────
    // The leader broadcasts every basic-attack hit (own + member-applied)
    // so all clients render the same floating number / hit flash. Each
    // attacker's contribution also bumps `partyDamageStore` so the
    // PartyWidget's per-ally dmg column reflects who hit for what.
    const lastDamageTsRef = useRef<Record<string, number>>({});
    useEffect(() => {
        if (!character) return;
        // 2026-05-11 spec ("nie widze animacji atakow podstawowych
        // sojusznikow"): figure out whether THIS client is a member or
        // the leader. The leader's local engine already emits a
        // `monsterHit` event for their own swing (rendered via the
        // `lastCombatEvent` FX path below), so we skip self events for
        // the leader to avoid double-rendering. A non-leader MEMBER
        // diverts their swing to an `attack-action` broadcast and
        // their local engine emits NOTHING — the leader's echoed
        // `damage-event` is the ONLY path that triggers the
        // animation, so we must NOT skip self for members.
        const partyState = usePartyStore.getState().party;
        const otherHumans = partyState?.members.filter((m) => m.id !== character.id && !m.isBot) ?? [];
        const iAmLeaderOrSolo = !partyState || otherHumans.length === 0 || partyState.leaderId === character.id;
        for (const [attackerId, ev] of Object.entries(partyLastDamage)) {
            const prev = lastDamageTsRef.current[attackerId] ?? 0;
            if (ev.sentAt <= prev) continue;
            lastDamageTsRef.current[attackerId] = ev.sentAt;
            if (attackerId === character.id && iAmLeaderOrSolo) continue;
            // Color the float by attacker — local player's own hits
            // render in white ('basic'), remote allies in cyan
            // ('ally-basic'). Members see their own attacks in white
            // (consistent with solo experience).
            const isLocalAttacker = attackerId === character.id;
            const kind: 'basic' | 'ally-basic' = isLocalAttacker ? 'basic' : 'ally-basic';
            fx.pushEnemyFloat(ev.targetIdx, ev.damage, kind, { isCrit: ev.isCrit });
            setMonsterHitPulses((prev) => ({ ...prev, [ev.targetIdx]: (prev[ev.targetIdx] ?? 0) + 1 }));
            // 2026-05-12 spec ("damage counter wspolny dla wszystkich"):
            // ONLY the leader / solo player accumulates locally. Members
            // wait for the next `state` broadcast which carries the
            // leader's authoritative damage map and SETS the local
            // store (see applyStateLocally in partyCombatSyncStore).
            // Without this gate, members would double-count their own
            // damage (once via damage-event, once via state mirror)
            // and any dropped damage-event would permanently desync
            // them from the leader's truth.
            if (ev.damage > 0 && iAmLeaderOrSolo) {
                usePartyDamageStore.getState().addDamage(attackerId, ev.damage);
            }
            // 2026-05-11 spec ("logi pokazuja wszystkie ataki"): write
            // the ally attack to the local log so the filtered
            // "Sojusznicy" view shows it. For LEADER/SOLO, skip self
            // because the local engine already logged the swing via
            // doSingleHit's addLog. For MEMBER, the local engine
            // diverts basic attacks to a broadcast (no addLog), so
            // we MUST log own attacks from the damage-event echo —
            // otherwise the member's own log is empty for basic hits.
            if (ev.damage > 0) {
                const isSelfAndLogged = isLocalAttacker && iAmLeaderOrSolo;
                if (!isSelfAndLogged) {
                    const attackerName = ev.attackerName ?? (isLocalAttacker ? (character.name ?? 'Ja') : 'Sojusznik');
                    const critTag = ev.isCrit ? ' ⚡KRYTYK' : '';
                    if (isLocalAttacker) {
                        // Mirror the leader/solo log style: "Atakujesz X za N dmg".
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

    // ── Remote member-hit (monster → ally) → animate on ally card ─────────
    // Every client renders the floating damage number on the targeted
    // member's slot — same `'monster'` float kind + flash overlay the
    // local engine uses for `playerHit`. The TARGETED member additionally
    // takes damage to their own character (handled by usePartyCombatSync
    // via the local playerHit emit). For OTHER clients (the leader or a
    // third member), this watcher is the only source of the visual.
    //
    // Avoid double-rendering on the targeted member's own client: their
    // local engine already emit'd `playerHit` from `usePartyCombatSync`,
    // which routed through the FX subscriber above with the same
    // `'monster'` kind. Skipping self here prevents two stacked floats.
    const lastMemberHitTsRef = useRef<number>(0);
    useEffect(() => {
        if (!partyLastMemberHit || !character) return;
        if (partyLastMemberHit.sentAt <= lastMemberHitTsRef.current) return;
        lastMemberHitTsRef.current = partyLastMemberHit.sentAt;
        // Targeted-self path already animated via local playerHit emit
        // (see usePartyCombatSync.subscribe `lastMemberHit` handler).
        if (partyLastMemberHit.memberId === character.id) return;
        const allHumans = (party?.members ?? []).filter((m) => !m.isBot);
        const targeted = allHumans.find((m) => m.id === partyLastMemberHit.memberId);
        if (!targeted) return;
        // fx slot resolution: local player = 0, remote humans 1..N.
        const remoteList = allHumans.filter((m) => m.id !== character.id);
        const fxSlot = remoteList.findIndex((m) => m.id === targeted.id) + 1;
        if (fxSlot <= 0) return;
        // Push the same `'monster'` (red) float the local engine uses
        // for playerHit — no icon override, isCrit forwarded if known.
        fx.pushAllyFloat(fxSlot, partyLastMemberHit.damage, 'monster');
        // Bump the targeted human's hit pulse so their card flash
        // overlay re-mounts (same animation as botHit / playerHit).
        setHumanHitPulses((prev) => ({
            ...prev,
            [partyLastMemberHit.memberId]: (prev[partyLastMemberHit.memberId] ?? 0) + 1,
        }));
    }, [partyLastMemberHit, character, party?.members, fx]);

    // ── Subscribe to combat events from engine (for animations) ───────────────
    const lastEventRef = useRef<number>(0);
    useEffect(() => {
        if (!lastCombatEvent) return;
        if (lastCombatEvent.timestamp <= lastEventRef.current) return;
        lastEventRef.current = lastCombatEvent.timestamp;

        const { type, data } = lastCombatEvent;

        if (type === 'monsterHit') {
            // Prefer the engine-provided slot index so the animation is never
            // stale. Fall back to `activeTargetIdx` for older engine code
            // paths (boss/dungeon/etc. that haven't been migrated yet).
            const idx = typeof (data as { targetIdx?: number })?.targetIdx === 'number'
                ? (data as { targetIdx: number }).targetIdx
                : useCombatStore.getState().activeTargetIdx;
            triggerMonsterHit(idx);
            // Floating damage on the monster slot. Player's basic attack →
            // 'basic' kind (white). Crits get the brighter render. Hand
            // (left/right for dual-wield) gets a 🗡️ glyph for visual cue.
            const dmg = (data as { damage?: number })?.damage ?? 0;
            // 2026-05-08 v3: track party damage for the floating widget.
            // Only the local player's damage feeds the store — each
            // teammate runs their OWN engine so this counter tracks
            // "what I hit for in MY copy of the fight".
            const isSummonHit = !!(data as { isSummon?: boolean })?.isSummon;
            if (!isSummonHit && dmg > 0) {
                const charId = useCharacterStore.getState().character?.id;
                if (charId) usePartyDamageStore.getState().addDamage(charId, dmg);
            }
            const isCrit = !!(data as { isCrit?: boolean })?.isCrit;
            const hand = (data as { hand?: 'left' | 'right' | null })?.hand ?? null;
            // 2026-05 v6: Necromancer summon swing — engine emits a
            // separate event per summon (skel ☠️ / ghost 👻 / demon
            // 😈 / lich 👑) staggered ~100 ms apart. Render with
            // 'ally-basic' kind (cyan) + type-specific icon so the
            // player can tell summon hits apart from their own.
            const isSummon = !!(data as { isSummon?: boolean })?.isSummon;
            const summonType = (data as { summonType?: 'skeleton' | 'ghost' | 'demon' | 'lich' })?.summonType;
            if (isSummon && dmg > 0) {
                const SUMMON_ICON: Record<'skeleton' | 'ghost' | 'demon' | 'lich', string> = {
                    skeleton: '☠️', ghost: '👻', demon: '😈', lich: '👑',
                };
                fx.pushEnemyFloat(idx, dmg, 'ally-basic', {
                    icon: summonType ? SUMMON_ICON[summonType] : '💀',
                });
            } else if (dmg > 0) {
                fx.pushEnemyFloat(idx, dmg, 'basic', { isCrit, icon: hand ? '🗡️' : undefined });
            }
        } else if (type === 'botMonsterHit') {
            // Bot landed a swing on the wave's active monster. Re-uses the
            // monsterHit flash + pushes an ally-basic float so the player
            // can tell their bots' hits apart from their own (cyan vs white).
            const idx = typeof (data as { targetIdx?: number })?.targetIdx === 'number'
                ? (data as { targetIdx: number }).targetIdx
                : useCombatStore.getState().activeTargetIdx;
            const dmg = (data as { damage?: number })?.damage ?? 0;
            const isCrit = !!(data as { isCrit?: boolean })?.isCrit;
            // No flash override — the monster card already shakes from the
            // engine's per-hit pulse counter; we just add the float.
            if (dmg > 0) fx.pushEnemyFloat(idx, dmg, 'ally-basic', { isCrit });
        } else if (type === 'dotTick') {
            // 2026-05 v6: per-tick DOT visual. Engine fires this every
            // 250ms while a poison/bleed/burn DOT drains HP — we push a
            // green poison-themed float on the affected slot so the
            // player can see the spell ticking. Aggregating into 1/sec
            // would feel too slow given the tick cadence; 4/sec reads
            // as a quick stutter and matches the actual HP drain.
            const idx = (data as { targetIdx?: number })?.targetIdx ?? 0;
            const dmg = (data as { damage?: number })?.damage ?? 0;
            if (dmg > 0) fx.pushEnemyFloat(idx, dmg, 'spell', { icon: '☠️' });
        } else if (type === 'summonSpawn') {
            // 2026-05 v7: Necromancer summon raised. Play the per-type
            // 2s overlay animation on the player's AllyCard avatar.
            const summonType = (data as { summonType?: 'skeleton' | 'ghost' | 'demon' | 'lich' })?.summonType;
            if (summonType) fx.triggerAllySummonSpawn(0, summonType);
        } else if (type === 'darkRitualTick') {
            // 2026-05 v7: Necromancer Mroczny Rytuał detonation. Engine
            // fires this when the countdown hits 0 — push a 💀 RITUAL
            // crit-styled float so the player sees the lump-sum % HP
            // chunk separately from regular DOT ticks.
            const idx = (data as { targetIdx?: number })?.targetIdx ?? 0;
            const dmg = (data as { damage?: number })?.damage ?? 0;
            if (dmg > 0) fx.pushEnemyFloat(idx, dmg, 'spell', { icon: '💀', label: 'RITUAL', isCrit: true });
        } else if (type === 'skillAnim') {
            // Engine emits this for AUTO-mode skill casts (manual casts are
            // handled inline in `doUseSkill` above and never go through this
            // event). Render the per-slot themed overlay + spell float.
            const skillId = (data as { skillId?: string })?.skillId;
            const idx = typeof (data as { targetIdx?: number })?.targetIdx === 'number'
                ? (data as { targetIdx: number }).targetIdx
                : useCombatStore.getState().activeTargetIdx;
            const dmg = (data as { damage?: number })?.damage ?? 0;
            const isCrit = !!(data as { isCrit?: boolean })?.isCrit;
            // 2026-05 v6: AOE splash targets — engine now includes every
            // additional slot the AOE landed on so we can fire the same
            // animation + float on each card. Defaults to empty so single-
            // target skills still render only on `idx`.
            const aoeTargets = ((data as { aoeTargets?: number[] })?.aoeTargets) ?? [];
            // Splash damage = primary × 0.75 (AOE falloff). Falls back to
            // primary dmg for older event payloads.
            const splashDmg = (data as { splashDamage?: number })?.splashDamage ?? dmg;
            // 2026-05 v6: targetsEnemy flag from engine. Damage hits +
            // enemy debuffs (Pułapka, Strzała Wiatru) animate on the
            // enemy. Pure self/party buffs (Orle Oko, Bomba Dymna,
            // Tarcza Many, Okrzyk Bojowy) animate on player avatar.
            // Falls back to true for older payloads so single-target
            // damage spells still work without the flag.
            const targetsEnemyEvt = (data as { targetsEnemy?: boolean })?.targetsEnemy ?? true;
            const stunLabelEvt = (data as { stunLabel?: string | null })?.stunLabel ?? null;
            // 2026-05 v6: instant-kill marker — view shows "DEATH ATTACK"
            // float on the targeted slot when Strzała Śmierci /
            // Skrytobójstwo / execute_below proc'd.
            const instantKillEvt = !!(data as { instantKill?: boolean })?.instantKill;
            if (skillId) {
                if (!targetsEnemyEvt) {
                    fx.triggerAllySkillAnim(0, skillId);
                } else {
                    fx.triggerEnemySkillAnim(idx, skillId);
                    if (dmg > 0) fx.pushEnemyFloat(idx, dmg, 'spell', { icon: getSkillIcon(skillId), isCrit });
                    if (stunLabelEvt) {
                        fx.pushEnemyFloat(idx, 0, 'spell', {
                            icon: stunLabelEvt === 'PARAL' ? '🔒' : '💫',
                            label: stunLabelEvt,
                        });
                    }
                    if (instantKillEvt) {
                        fx.pushEnemyFloat(idx, 0, 'spell', { icon: '💀', label: 'DEATH ATTACK', isCrit: true });
                    }
                    for (const aIdx of aoeTargets) {
                        fx.triggerEnemySkillAnim(aIdx, skillId);
                        if (splashDmg > 0) fx.pushEnemyFloat(aIdx, splashDmg, 'spell', { icon: getSkillIcon(skillId), isCrit });
                    }
                }
            }
        } else if (type === 'playerHit' || type === 'playerDodge') {
            triggerPlayerHit();
            if (type === 'playerHit') {
                // Floating monster-hit on the player ally slot (always 0).
                // 'monster' kind → red. The engine ships hpDamage so we can
                // show only the actual HP loss (Utamo Vita's MP-shielded
                // portion is logged but doesn't appear as a hit number).
                const dmg = (data as { damage?: number; hpDamage?: number })?.hpDamage
                    ?? (data as { damage?: number })?.damage
                    ?? 0;
                const isCrit = !!(data as { isCrit?: boolean })?.isCrit;
                // 2026-05 v6: immortal block (Absolutne Cięcie) — push a
                // distinct BLOCK label instead of nothing/-1 so the player
                // can SEE the swing was eaten.
                const isImmortal = !!(data as { isImmortal?: boolean })?.isImmortal;
                // Tarcza Many — shield ate the hit; show MP loss float.
                const isManaShield = !!(data as { isManaShield?: boolean })?.isManaShield;
                const msMpDmg = (data as { mpDamage?: number })?.mpDamage ?? 0;
                // Void Ray spell heal — green +HP float on player slot.
                const isSpellHeal = !!(data as { isSpellHeal?: boolean })?.isSpellHeal;
                const spellHealAmount = (data as { spellHealAmount?: number })?.spellHealAmount ?? 0;
                if (isImmortal) {
                    fx.pushAllyFloat(0, 0, 'heal', { icon: '✨', label: 'BLOCK' });
                } else if (isSpellHeal) {
                    const requested = (data as { spellHealRequested?: number })?.spellHealRequested ?? spellHealAmount;
                    const cappedTag = spellHealAmount < requested ? ' (MAX)' : '';
                    fx.pushAllyFloat(0, requested, 'heal', {
                        icon: '✨',
                        label: cappedTag ? `+${requested}${cappedTag}` : undefined,
                    });
                } else if (isManaShield && msMpDmg > 0) {
                    fx.pushAllyFloat(0, msMpDmg, 'spell', { icon: '🛡️' });
                } else if (dmg > 0) {
                    fx.pushAllyFloat(0, dmg, 'monster', { isCrit });
                }
            }
        } else if (type === 'botHit') {
            // Per-bot pulse — engine ships the bot id alongside damage. Bump
            // its counter so the matching AllyCard's keyed flash overlay
            // re-mounts and replays from frame 0.
            const botId = (data as { botId?: string })?.botId;
            if (botId) {
                setBotHitPulses((prev) => ({ ...prev, [botId]: (prev[botId] ?? 0) + 1 }));
                // Map bot id → display slot. Bots render in `bots` order
                // starting at ally slot 1 (player is slot 0). Use a fresh
                // store read so we don't depend on a stale closure.
                const allBots = useBotStore.getState().bots;
                const botIdx = allBots.findIndex((b) => b.id === botId);
                const dmg = (data as { damage?: number })?.damage ?? 0;
                if (botIdx >= 0 && dmg > 0) {
                    fx.pushAllyFloat(botIdx + 1, dmg, 'monster');
                }
            }
        }
    }, [lastCombatEvent]); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-scroll combat log
    useEffect(() => {
        const container = logContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, [log.length]);

    // Auto-fight countdown — runs an rAF loop while in `victory` phase with
    // auto-fight on (and not SKIP). Resets to 0 on entry/exit so the next
    // wave starts the bar fresh. Mirrors `useBackgroundCombat`'s timer; if
    // the engine starts the next fight earlier (e.g. SKIP toggled mid-wait)
    // the cleanup guard zeroes the bar instantly.
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

        const manualMpCost = getSkillMpCost(skillId);
        if (s.playerCurrentMp < manualMpCost) {
            s.addLog('Za mało MP!', 'system');
            return;
        }
        // Stun gate — paralysed players can't manually cast either.
        if (engineIsHuntPlayerStunned()) return;

        const classConfig = getClassConfig(char.class);
        const maxCrit = (classConfig.maxCritChance ?? 30) / 100;

        // 2026-05 v6: classify cast affinity so the animation lands on the
        // right side. `damage > 0` always animates on enemy. `damage === 0`
        // splits two ways:
        //   • enemy-debuff atom (Pułapka stun:3000, Strzała Wiatru,
        //     enemy_atk_down, mark_no_heal …) → animate on enemy slot
        //   • pure self-buff (Orle Oko, Bomba Dymna, Tarcza Many,
        //     Okrzyk Bojowy …) → animate on player avatar
        // This fixes the "Pułapka anim ląduje na graczu" complaint.
        const skillDef = getSkillDef(skillId);
        const skillDmgMult = skillDef?.damage ?? 0;
        const targetsEnemy = skillDmgMult > 0 || skillTargetsEnemy(skillDef?.effect ?? null);
        const isDamageHit = skillDmgMult > 0;

        // Pull v2 result FIRST so we know `defPenPct` for the damage roll.
        // Note: this also writes the DOT / stun / mark to the target's
        // status, which is correct — DOT can land before the spell hit.
        // 2026-05-11 spec ("podstawowy atak zabija potwora i spell dalej
        // atakuje w tego potwora"): huntApplySkillEffectV2 retargets to
        // the next alive wave monster if the active slot died between
        // click and apply. It returns `null` if NO monster is alive,
        // in which case we abort the cast — no MP spent, no cooldown
        // started, no damage applied. The skill becomes a no-op.
        const effApply = engineHuntApplySkillEffectV2(skillId, s.activeTargetIdx);
        if (effApply === null) {
            s.addLog('🎯 Brak żywych potworów — spell anulowany', 'system');
            return;
        }
        // Strzał Snajpera & friends: `def_pen:100` should ignore the
        // monster's defense outright. Multiply enemy DEF by (1 - %/100).
        const defPenFrac = Math.max(0, Math.min(1, (effApply?.defPenPct ?? 0) / 100));
        const effectiveEnemyDef = Math.max(0, Math.floor(s.monster.defense * (1 - defPenFrac)));

        const r = calculateDamage({
            baseAtk: char.attack, weaponAtk: rollWeaponDamage(),
            skillBonus: Math.floor(char.attack * 0.5),
            classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
            enemyDefense: effectiveEnemyDef,
            critChance: 0.20,
            maxCritChance: maxCrit,
            damageMultiplier: isDamageHit
                ? getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier() * skillDmgMult
                : 0,
        });

        if (isDamageHit) {
            // Necromancer Klątwa Śmierci (mark_amp) — first damage
            // hit on the marked monster gets ×N. Consumes the charge
            // up-front so AOE splash uses the boosted r.finalDamage.
            const ampHunt = consumeHuntMonsterMarkAmp(s.activeTargetIdx, s.monster.id);
            if (ampHunt.mult !== 1) {
                r.finalDamage = Math.max(1, Math.floor(r.finalDamage * ampHunt.mult));
                s.addLog(`☠️ Klątwa Śmierci: ${formatSkillName(skillId)} ×${ampHunt.mult} dmg`, 'system');
            }
            // 2026-05 v7: track total damage dealt this cast (primary +
            // every splash that landed). Żniwa Dusz `aoe;heal_self_pct_dmg:50`
            // heals on the SUM, so a 4-monster AOE pumps the lifesteal
            // with all four hits instead of just the primary.
            let totalDmgDealtThisCast = 0;
            if (effApply?.instantKill) {
                const wm = useCombatStore.getState().waveMonsters[s.activeTargetIdx];
                if (wm) {
                    useCombatStore.getState().damageWaveMonster(s.activeTargetIdx, wm.currentHp);
                    totalDmgDealtThisCast += wm.currentHp;
                }
                // 2026-05 v6: DEATH ATTACK marker — instant_kill /
                // execute_below procc'd. Crit-styled float so the player
                // sees "I rolled the 5%!" on Strzała Śmierci / Skrytobójstwo.
                fx.pushEnemyFloat(s.activeTargetIdx, 0, 'spell', { icon: '💀', label: 'DEATH ATTACK', isCrit: true });
                s.addLog(`💀 ${formatSkillName(skillId)}: DEATH ATTACK! Natychmiastowe zabicie!`, 'crit');
            } else {
                s.dealToMonster(r.finalDamage);
                totalDmgDealtThisCast += r.finalDamage;
                if (effApply?.aoe) {
                    const splashDmg = Math.max(1, Math.floor(r.finalDamage * 0.75));
                    // 2026-05 v6: per-target IK roll for AOE skills
                    // (Strzała Wszechświata `aoe;instant_kill_chance:15`
                    // gives each splash monster its own 15% IK chance,
                    // not just the primary).
                    const splashIkPct = effApply?.instantKillPct ?? 0;
                    const wave = useCombatStore.getState().waveMonsters;
                    for (let ii = 0; ii < wave.length; ii++) {
                        if (ii === s.activeTargetIdx) continue;
                        if (wave[ii].isDead) continue;
                        const splashIk = splashIkPct > 0 && Math.random() * 100 < splashIkPct;
                        if (splashIk) {
                            const ikDmg = wave[ii].currentHp;
                            useCombatStore.getState().damageWaveMonster(ii, ikDmg);
                            totalDmgDealtThisCast += ikDmg;
                            fx.triggerEnemySkillAnim(ii, skillId);
                            fx.pushEnemyFloat(ii, 0, 'spell', { icon: '💀', label: 'DEATH ATTACK', isCrit: true });
                        } else {
                            // 2026-05 v7: each splash target consumes
                            // its own markAmp / markAmpAll so AOE Kraina
                            // hits ×2 on every enemy in the wave.
                            let thisSplash = splashDmg;
                            const ampSplash = consumeHuntMonsterMarkAmp(ii, wave[ii].monster.id);
                            if (ampSplash.mult !== 1) {
                                thisSplash = Math.max(1, Math.floor(thisSplash * ampSplash.mult));
                            }
                            useCombatStore.getState().damageWaveMonster(ii, thisSplash);
                            totalDmgDealtThisCast += thisSplash;
                            fx.triggerEnemySkillAnim(ii, skillId);
                            fx.pushEnemyFloat(ii, thisSplash, 'spell', { icon: getSkillIcon(skillId), isCrit: r.isCrit });
                        }
                    }
                }
            }
            if (effApply && effApply.healCasterPctOfDmg > 0 && totalDmgDealtThisCast > 0) {
                // Żniwa Dusz `aoe;heal_self_pct_dmg:50` — 50% of TOTAL
                // damage dealt across primary + every AOE splash that
                // landed. Single-target casts (Pochłonięcie Życia /
                // Promień Pustki) heal off `totalDmg === r.finalDamage`,
                // identical to the previous behaviour.
                const heal = Math.floor(totalDmgDealtThisCast * (effApply.healCasterPctOfDmg / 100));
                // 2026-05 v6: capture pre/post HP so the heal float
                // shows the ACTUAL healed amount (player capped at
                // max_hp may receive 0 even though heal=N — float
                // should reflect the real delta).
                const beforeHp = useCombatStore.getState().playerCurrentHp;
                useCombatStore.getState().healPlayerHp(heal, char.max_hp);
                const afterHp = useCombatStore.getState().playerCurrentHp;
                const actual = afterHp - beforeHp;
                if (heal > 0) {
                    // Always show the COMPUTED heal value (so player
                    // sees how much the spell rolled even at full HP).
                    // When capped at maxHp the bar doesn't move — the
                    // float still flashes the spell's roll so the
                    // mechanic stays visible.
                    const cappedTag = actual < heal ? ' (MAX)' : '';
                    fx.pushAllyFloat(0, heal, 'heal', {
                        icon: '✨',
                        label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                    });
                    s.addLog(`✨ ${formatSkillName(skillId)}: +${heal} HP${cappedTag}`, 'system');
                }
            }
        }
        // 2026-05 v6: Cleric Niebiańskie Leczenie / Modlitwa Niebios —
        // heal_party_pct. Heals every alive ally for N% of THEIR own
        // max HP, with float + skill anim on each slot.
        if (effApply && effApply.healPartyPctInstant > 0) {
            const playerHeal = Math.max(1, Math.floor(char.max_hp * (effApply.healPartyPctInstant / 100)));
            const playerHpBefore = useCombatStore.getState().playerCurrentHp;
            useCombatStore.getState().healPlayerHp(playerHeal, char.max_hp);
            const playerHpAfter = useCombatStore.getState().playerCurrentHp;
            const playerActual = playerHpAfter - playerHpBefore;
            const playerTag = playerActual < playerHeal ? ' (MAX)' : '';
            fx.pushAllyFloat(0, playerHeal, 'heal', {
                icon: '✨',
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
                    icon: '✨',
                    label: tag ? `+${heal}${tag}` : undefined,
                });
                fx.triggerAllySkillAnim(i + 1, skillId);
            }
            s.addLog(`✨ ${formatSkillName(skillId)}: heal_party_pct ${effApply.healPartyPctInstant}%`, 'system');
        }
        // 2026-05 v6: Cleric `heal` / `holy_nova` — heal_lowest_ally_pct
        // picks the ally with the lowest HP% (player + bots) and heals
        // them by N% of their max HP. Float lands on THEIR slot so the
        // player can see who got patched up.
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
            // Pick the ally with the LOWEST HP ratio. Ties → player wins.
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
                    icon: '✨',
                    label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                });
                fx.triggerAllySkillAnim(lowest.slot, skillId);
                s.addLog(`✨ ${formatSkillName(skillId)} → ${lowest.name}: +${heal} HP${cappedTag}`, 'system');
            }
        }
        spendPlayerMp(manualMpCost);
        startSkillCooldown(skillId);
        // Player-side global overlay always fires (so the caster sees the
        // spell glyph regardless of whether it's a buff or a damage skill).
        triggerSkillAnim(skillId);
        const tgtIdx = useCombatStore.getState().activeTargetIdx;
        if (targetsEnemy) {
            // Damage skill OR enemy-debuff cast (Pułapka, Strzała Wiatru, etc.)
            // — animacja + float na celu. Damage spells pokazują liczbę,
            // pure-debuff casts (damage=0) zostawiają bez liczby ale dorzucają
            // marker stunu poniżej.
            fx.triggerEnemySkillAnim(tgtIdx, skillId);
            if (isDamageHit) {
                fx.pushEnemyFloat(tgtIdx, r.finalDamage, 'spell', { icon: getSkillIcon(skillId), isCrit: r.isCrit });
            }
        } else {
            // Pure self/party buff — animacja na PLAYERZE (ally slot 0).
            fx.triggerAllySkillAnim(0, skillId);
        }
        // Stun / paralyze visual marker — per-target. For AOE+stun_chance
        // each enemy rolls independently in the engine; the float only
        // appears on the slots that actually got stunned. Single-target
        // casts use the primary stunApplied flag.
        if (effApply?.aoe) {
            const stunIdxs = effApply.aoeStunIdxs ?? [];
            for (const idx of stunIdxs) {
                fx.pushEnemyFloat(idx, 0, 'spell', { icon: '💫', label: 'STUN' });
            }
            const paralIdxs = effApply.aoeParalyzeIdxs ?? [];
            for (const idx of paralIdxs) {
                fx.pushEnemyFloat(idx, 0, 'spell', { icon: '🔒', label: 'PARAL' });
            }
        } else if (effApply?.stunApplied) {
            fx.pushEnemyFloat(tgtIdx, 0, 'spell', { icon: '💫', label: 'STUN' });
        } else if (effApply?.paralyzeApplied) {
            fx.pushEnemyFloat(tgtIdx, 0, 'spell', { icon: '🔒', label: 'PARAL' });
        }
        // 2026-05 v6: Cleric Aura Wskrzeszenia. Revive dead party bots
        // to 50% HP and bring them back to alive. Bot slots are 1+
        // (player is slot 0, never dead in Hunt — death triggers the
        // run-end overlay).
        if (effApply?.reviveDeadAllies) {
            const allBots = useBotStore.getState().bots;
            const revivedNames: string[] = [];
            for (let i = 0; i < allBots.length; i++) {
                const bot = allBots[i];
                if (!bot.alive) {
                    const reviveHp = Math.max(1, Math.floor(bot.maxHp * 0.5));
                    useBotStore.getState().updateBotHp(bot.id, reviveHp);
                    revivedNames.push(bot.name);
                    fx.pushAllyFloat(i + 1, reviveHp, 'heal', { icon: '✨', label: '+REZ' });
                    fx.triggerAllySkillAnim(i + 1, skillId);
                }
            }
            if (revivedNames.length > 0) {
                s.addLog(`✨ ${formatSkillName(skillId)}: wskrzeszono ${revivedNames.join(', ')}`, 'system');
            }
        }
        // Multistrike (Wielostrzał) — schedule N follow-up basic attacks
        // on the SAME target, ~120 ms apart so they read as a quick burst
        // instead of one mega-hit. Each follow-up rolls a fresh basic damage
        // (uses doSingleHit-style logic but inline since we don't want to
        // double-trigger the engine's tick callbacks).
        if ((effApply?.multistrike ?? 0) > 0) {
            const extra = Math.max(0, Math.floor(effApply!.multistrike));
            for (let n = 0; n < extra; n++) {
                window.setTimeout(() => {
                    const fresh = useCombatStore.getState();
                    if (fresh.phase !== 'fighting' || !fresh.monster) return;
                    const wm = fresh.waveMonsters[fresh.activeTargetIdx];
                    if (!wm || wm.isDead) return;
                    const followup = calculateDamage({
                        baseAtk: char.attack, weaponAtk: rollWeaponDamage(),
                        skillBonus: Math.floor(char.attack * 0.5),
                        classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                        enemyDefense: effectiveEnemyDef,
                        critChance: (char.crit_chance ?? 0.05),
                        maxCritChance: maxCrit,
                        damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
                    });
                    useCombatStore.getState().damageWaveMonster(fresh.activeTargetIdx, followup.finalDamage);
                    fx.pushEnemyFloat(fresh.activeTargetIdx, followup.finalDamage, 'basic', { isCrit: followup.isCrit });
                    fresh.addLog(`🏹×${n + 2} ${followup.finalDamage} dmg${followup.isCrit ? ' ⚡' : ''}`, followup.isCrit ? 'crit' : 'player');
                }, 120 * (n + 1));
            }
        }
        // Register every timed self/party buff atom in the BuffBar so the
        // header shows remaining time for each (Orle Oko / Okrzyk Bojowy /
        // Tarcza Many / Bomba Dymna / etc.). At x2/x4 the buff drains
        // faster so its in-game duration matches the rest of the speed-up.
        if (skillDef) applySkillBuff(skillId, skillDef, SPEED_MULT[combatSpeed] ?? 1);
        if (r.finalDamage > 0) {
            useDailyQuestStore.getState().addProgress('deal_damage', r.finalDamage);
        }
        useSkillStore.getState().addMlvlXpFromSkill(char.class as any);
        s.addLog(
            `Używasz ${formatSkillName(skillId)}: ${r.finalDamage} dmg${r.isCrit ? ' ⚡KRYTYK!' : ''} (-${manualMpCost} MP)`,
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

    // ── Auto-start fight from MonsterList selection (on mount) ────────────────
    useEffect(() => {
        const sel = useCombatStore.getState().selectedMonster;
        if (sel) {
            setSelectedMonster(null);
            engineStartNewFight(sel, true);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // 2026-05 v6: keep BuffStore's combatSpeedMult in sync with this
    // view's selected speed. On unmount → reset to 1 so game-time buffs
    // drain at real time outside combat.
    useEffect(() => {
        useBuffStore.getState().setCombatSpeedMult(SPEED_MULT[combatSpeed] ?? 1);
        return () => useBuffStore.getState().setCombatSpeedMult(1);
    }, [combatSpeed]);

    // 2026-05 v6: Cleric Błogosławieństwo (heal_party_dot) — 1-Hz game-
    // time pulse that pushes a green +X HP float on player + every alive
    // bot's slot. The actual HP increment for the player happens in
    // TopHeader's central tick (so it works in town too); for bots we
    // also bump their HP here. Accumulator keeps the pulse rate
    // synced to game-time (1× per in-game second, scales with speed).
    const partyHealAccumRef = useRef(0);
    useEffect(() => {
        const TICK = 250;
        const id = setInterval(() => {
            const pct = useBuffStore.getState().getPartyHealDotPctPerSec();
            if (pct <= 0) {
                partyHealAccumRef.current = 0;
                return;
            }
            // Only run the view-side pulse while combat is HUD-active —
            // TopHeader handles the smooth town regen otherwise (and we
            // don't want both stacking).
            if (!useCombatHudStore.getState().active) return;
            const mult = useBuffStore.getState().combatSpeedMult;
            partyHealAccumRef.current += TICK * Math.max(1, mult);
            const live = useCharacterStore.getState().character;
            if (!live) return;
            const pulseSkillId = useBuffStore.getState().getPartyHealDotSkillId();
            while (partyHealAccumRef.current >= 1000) {
                partyHealAccumRef.current -= 1000;
                // Player slot — bump combatStore HP directly and push
                // both the +X float and the spell anim overlay (so the
                // player can see Blessing actually pulsing on them).
                const playerHeal = Math.max(1, Math.floor(live.max_hp * (pct / 100)));
                const playerHpBefore = useCombatStore.getState().playerCurrentHp;
                if (playerHpBefore < live.max_hp) {
                    useCombatStore.getState().healPlayerHp(playerHeal, live.max_hp);
                }
                const playerHpAfter = useCombatStore.getState().playerCurrentHp;
                const playerActual = playerHpAfter - playerHpBefore;
                const playerCapped = playerActual < playerHeal ? ' (MAX)' : '';
                fx.pushAllyFloat(0, playerHeal, 'heal', {
                    icon: '💚',
                    label: playerCapped ? `+${playerHeal}${playerCapped}` : undefined,
                });
                if (pulseSkillId) fx.triggerAllySkillAnim(0, pulseSkillId);
                // Each alive bot — bump HP, push float, play anim.
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
                        icon: '💚',
                        label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                    });
                    if (pulseSkillId) fx.triggerAllySkillAnim(i + 1, pulseSkillId);
                }
            }
        }, TICK);
        return () => clearInterval(id);
    }, [fx]);

    const cycleSpeed = () => {
        // 2026-05-09 spec ("tylko lider predkoscia"): in a multi-human
        // party, only the leader can change the combat-speed multiplier.
        // Members see the same x1/x2/x4 indicator the leader picked
        // but their click is a no-op (the button still renders so the
        // current speed reads at a glance).
        const partyState = usePartyStore.getState().party;
        const me = useCharacterStore.getState().character?.id;
        const otherHumans = partyState?.members.filter((m) => m.id !== me && !m.isBot) ?? [];
        if (partyState && otherHumans.length > 0 && partyState.leaderId !== me) {
            return;
        }
        // In party (bots present), SKIP is disabled — cycle x1→x2→x4 only.
        const order = partyBots.length > 0
            ? SPEED_ORDER.filter((s) => s !== 'SKIP')
            : SPEED_ORDER;
        const idx = order.indexOf(combatSpeed);
        const next = order[(idx + 1) % order.length];
        // BuffStore.combatSpeedMult sync is handled by the
        // useEffect([combatSpeed]) above; calling Zustand setters from
        // here used to fire TopHeader subscriptions mid-Combat-render
        // ("Cannot update a component (`TopHeader`) while rendering…").
        setCombatSpeed(next);
    };

    // ── Derived ───────────────────────────────────────────────────────────────
    const sortedMonsters = [...monsters].sort((a, b) => a.level - b.level);

    const bestHpPotion = getBestPotionUtil(FLAT_HP_POTIONS, consumables);
    const bestMpPotion = getBestPotionUtil(FLAT_MP_POTIONS, consumables);
    const bestPctHpPotion = getBestPotionUtil(PCT_HP_POTIONS, consumables);
    const bestPctMpPotion = getBestPotionUtil(PCT_MP_POTIONS, consumables);

    if (!character) return null;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="combat">

            {/* ── Top bar ─────────────────────────────────────────────────────
                Slimmed-down header: no Wstecz button, no "Polowanie" title —
                just the four control buttons (speed / skill mode / fight mode
                / XP toggle). Mode buttons use icons instead of word-prefixes:
                  • ✨ + AUTO/MANUAL  → skill auto-cast toggle
                  • ⚔️ + AUTO/MANUAL  → auto-fight toggle
            ──────────────────────────────────────────────────────────────── */}
            {/* Idle (hub) top header — kept verbatim. The in-fight phase
                gets its own top-bar via <CombatTopControls /> + <CombatTaskBadge />
                rendered inside the arena wrapper below, so we hide this whole
                bar then. */}
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
                                <span className="combat__mode-btn-icon" aria-hidden="true">✨</span>
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
                                <span className="combat__mode-btn-icon" aria-hidden="true">⚔️</span>
                                {autoFight ? 'AUTO' : 'MANUAL'}
                            </button>
                            <button
                                className={`combat__xp-toggle${showCombatXpBar ? ' combat__xp-toggle--active' : ''}`}
                                onClick={() => setShowCombatXpBar(!showCombatXpBar)}
                                title={showCombatXpBar ? 'Ukryj pasek XP' : 'Pokaż pasek XP'}
                            >
                                {showCombatXpBar ? '👁️' : '👁️‍🗨️'}
                            </button>
                        </div>
                    </div>

                    {/* 2026-05 v6: stat-points badge removed from hunt
                        view per spec — distribution lives only in Postać
                        (/inventory) now. The Postać tab in BottomNav
                        already shows a yellow "rewards waiting" hint when
                        the player has unspent points. */}
                </header>
            )}

            {/* ── Hub: monster picker (idle) ─────────────────────────────────
                New layout per redesign:
                  • "Ilość przeciwników" wave-count box (no FALA label,
                    centered with max-width on mobile, left-aligned on
                    desktop via SCSS).
                  • Monster grid — 1 col on mobile, 2-3 on tablet/desktop.
                    Big sprite, name + LVL chip top-right, stacked stat
                    rows (ATK/HP/DEF/AS/MAG), XP+Gold rewards with mastery
                    bonus annotations, package + sword action icons.
                    Borders highlight when there's an active task or the
                    monster is fully mastered (25/25).
                  • Drop info now opens a modal (📦) instead of expanding
                    inline — content is identical to the old expand panel.
                  • Active tasks + quests are listed below the monster grid.
            ────────────────────────────────────────────────────────────── */}
            {phase === 'idle' && !useCombatStore.getState().selectedMonster && (() => {
                const masteriesState = useMasteryStore.getState().masteries;
                const masteryKillsState = useMasteryStore.getState().masteryKills;
                const gateLevel = getPartyGateLevel(character.level, party?.members ?? null);

                // 2026-05-11 spec ("lider party powinien widziec tylko te
                // potwory ktore sa dostepne przez party"): when we're in a
                // multi-human party, hide monsters that ANY member can't
                // fight. Each member broadcasts their personal unlock cap
                // (level + mastery) via `usePartyPresence`; we take the
                // MIN of those. If a member hasn't broadcast yet, they're
                // skipped (cap snaps once their snapshot arrives).
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

                // ── Filter pipeline ─────────────────────────────────────────
                // Three independent filters from the persistent settingsStore:
                //   1. huntFilterAvailableOnly  → unlocked monsters only
                //   2. huntFilterTaskedOnly     → only monsters bound to an
                //      active task or an active 'kill' quest goal
                //   3. huntFilterMinLevel > 0   → hide monsters below this level
                // Plus the party intersection cap when applicable.
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
                // The hub list is built ascending (lowest level first); flip it
                // here when the player asked for "highest level first" so the
                // unlock-status helper still works against the canonical order.
                const visibleMonsters = huntFilterSortDesc
                    ? [...filteredMonsters].reverse()
                    : filteredMonsters;
                const anyFilterActive =
                    huntFilterAvailableOnly || huntFilterTaskedOnly || huntFilterMinLevel > 0 || huntFilterSortDesc;
                return (
                    <div className="combat__hub">

                        {/* Filter bar ─────────────────────────────────────── */}
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
                                        ✕ Wyczyść
                                    </button>
                                )}
                            </div>
                        </section>

                        {/* Wave-count box ─────────────────────────────────── */}
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

                        {/* Monster grid ───────────────────────────────────── */}
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
                                                        ? '🔒'
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
                                                        <span className="combat__mcard-mastery-icon" aria-hidden="true">🎖️</span>
                                                        {masteryLvl}/{MASTERY_MAX_LEVEL}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="combat__mcard-stats">
                                                <span className="combat__mcard-stat" title="Atak (min - max)">
                                                    <span className="combat__mcard-stat-icon" aria-hidden="true">⚔️</span>
                                                    <span className="combat__mcard-stat-label">ATK</span>
                                                    <span className="combat__mcard-stat-value">{range.min}-{range.max}</span>
                                                </span>
                                                <span className="combat__mcard-stat" title="Punkty życia">
                                                    <span className="combat__mcard-stat-icon" aria-hidden="true">❤️</span>
                                                    <span className="combat__mcard-stat-label">HP</span>
                                                    <span className="combat__mcard-stat-value">{m.hp.toLocaleString('pl-PL')}</span>
                                                </span>
                                                <span className="combat__mcard-stat" title="Obrona">
                                                    <span className="combat__mcard-stat-icon" aria-hidden="true">🛡️</span>
                                                    <span className="combat__mcard-stat-label">DEF</span>
                                                    <span className="combat__mcard-stat-value">{m.defense}</span>
                                                </span>
                                                <span className="combat__mcard-stat" title="Szybkość ataku (Attack Speed)">
                                                    <span className="combat__mcard-stat-icon" aria-hidden="true">🏃</span>
                                                    <span className="combat__mcard-stat-label">AS</span>
                                                    <span className="combat__mcard-stat-value">{m.speed}</span>
                                                </span>
                                                {m.magical && (
                                                    <span className="combat__mcard-stat combat__mcard-stat--magical" title="Atak magiczny — omija blok i unik">
                                                        <span className="combat__mcard-stat-icon" aria-hidden="true">✨</span>
                                                        <span className="combat__mcard-stat-label">MAG</span>
                                                        <span className="combat__mcard-stat-value">tak</span>
                                                    </span>
                                                )}
                                            </div>

                                            <div className="combat__mcard-rewards">
                                                <span className="combat__mcard-reward" title="XP za zabicie">
                                                    <span className="combat__mcard-reward-icon" aria-hidden="true">✨</span>
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
                                                    <span className="combat__mcard-reward-icon" aria-hidden="true">💰</span>
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

                                            {/* Per-monster task & quest progress lines.
                                                These replace the bottom-of-hub list — now
                                                each card carries its own context so the
                                                player can see at a glance which monster
                                                is wired to which goal. */}
                                            {(hasTask || hasQuest) && (
                                                <div className="combat__mcard-goals">
                                                    {hasTask && monsterTask && (
                                                        <div
                                                            className="combat__mcard-goal combat__mcard-goal--task"
                                                            title={`Task: zabij ${monsterTask.killCount}× ${m.name_pl}`}
                                                        >
                                                            <span className="combat__mcard-goal-icon" aria-hidden="true">📋</span>
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
                                                                {qb.done ? '✅' : '📜'}
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
                                                        🔒 {req.name_pl}: {killsNow.toLocaleString('pl-PL')}/{MASTERY_KILL_THRESHOLD.toLocaleString('pl-PL')}
                                                    </div>
                                                );
                                            })()}
                                            {locked && unlock.lockKind !== 'mastery' && (
                                                <div className="combat__mcard-locked-note">{unlock.shortLabel}</div>
                                            )}

                                            <div className="combat__mcard-actions">
                                                <button
                                                    className="combat__mcard-action combat__mcard-action--info"
                                                    onClick={() => setDropModalMonsterId(m.id)}
                                                    disabled={locked}
                                                    title="Pokaż szczegóły dropu"
                                                    aria-label={`Drop dla ${m.name_pl}`}
                                                >📦</button>
                                                <button
                                                    className="combat__mcard-action combat__mcard-action--fight"
                                                    onClick={() => {
                                                        if (locked) return;
                                                        // 2026-05-09 spec: party ready-check
                                                        // fires when leader picks SPECIFIC
                                                        // monster. Leader's fight does NOT
                                                        // start until all members confirm —
                                                        // the broadcast carries the monster
                                                        // JSON so every client (incl. leader)
                                                        // calls engineStartNewFight on `go`,
                                                        // landing everyone on the same fight
                                                        // simultaneously.
                                                        // Capture the leader's chosen wave
                                                        // count so members spawn the same
                                                        // number of monsters when their
                                                        // replicator fires on `go`.
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
                                                >⚔️</button>
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

            {/* ── Drop info modal ─────────────────────────────────────────────
                Replaces the inline expand on monster cards. Same content (per-
                rarity stats + drop tier breakdown + potions + spell chests),
                rendered as a centered popup. Heroic chest tier appears only
                for monsters the player has fully mastered (25/25).
            ──────────────────────────────────────────────────────────────── */}
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
                                >✕</button>
                            </header>

                            <div className="combat__drop-modal-body">
                                {/* Base reward summary (XP + Gold with mastery bonus) */}
                                <div className="combat__drop-modal-summary">
                                    <span>
                                        💰 Gold: {formatGoldShort(m.gold[0])}–{formatGoldShort(m.gold[1])}
                                        {mLvl > 0 && (
                                            <span className="combat__monster-xp-bonus" title={masteryTooltip}>
                                                {' '}+{formatGoldShort(Math.floor(m.gold[0] * (masteryPct / 100)))}–{formatGoldShort(Math.floor(m.gold[1] * (masteryPct / 100)))}
                                            </span>
                                        )}
                                    </span>
                                    <span>
                                        ✨ XP: {m.xp.toLocaleString('pl-PL')}
                                        {mLvl > 0 && (
                                            <span className="combat__monster-xp-bonus" title={masteryTooltip}>
                                                {' '}+{Math.floor(m.xp * (masteryPct / 100)).toLocaleString('pl-PL')}
                                            </span>
                                        )}
                                    </span>
                                </div>
                                <div className="combat__drop-modal-info">
                                    🎒 Losowy ekwipunek Lvl {m.level} (bronie, zbroje, akcesoria)
                                </div>

                                {/* Per-rarity drop breakdown — laid out left-to-right
                                    on wide screens, stacking on narrow ones via SCSS grid. */}
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
                                                {/* Spec 3 (2026-05): each reward row sits on its own
                                                    line so wrapping never crops a value mid-text. */}
                                                <span className="combat__variant-xp">
                                                    <span className="combat__variant-xp-row">⭐ {effXp.toLocaleString('pl-PL')} XP{mLvl > 0 && (
                                                        <span className="combat__monster-xp-bonus" title={masteryTooltip}>
                                                            {' '}+{masteryPct}%
                                                        </span>
                                                    )}</span>
                                                    <span className="combat__variant-xp-row">💰 {formatGoldShort(effGoldMin)}–{formatGoldShort(effGoldMax)}</span>
                                                    <span className="combat__variant-xp-row">📋 Task: ×{v.taskKills}</span>
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
                                                        <TinyIcon icon={STONE_ICONS[VARIANT_TO_STONE_ID[v.key] ?? ''] ?? '💎'} size="sm" /> {stoneName} ({(stoneChance * 100).toFixed(0)}%)
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Potion drops — main tier + optional mega elixir bonus (lvl 100+) */}
                                <div className="combat__drops-potions">
                                    <div className="combat__drops-potions-title"><TinyIcon icon={getPotionImage(null) ?? '🧪'} size="sm" /> Potiony</div>
                                    <div className="combat__variant-tier">
                                        <span className="combat__tier-dot" style={{ background: '#e57373' }} />
                                        <span className="combat__tier-name" style={{ color: '#e57373' }}>
                                            <TinyIcon icon={getPotionImage('hp_potion_sm') ?? '❤️'} size="sm" /> {potionInfo.hpLabel} ({potionInfo.hpHeal})
                                        </span>
                                        <span className="combat__tier-chance">{(potionInfo.hpChance * 100).toFixed(2)}%</span>
                                    </div>
                                    <div className="combat__variant-tier">
                                        <span className="combat__tier-dot" style={{ background: '#64b5f6' }} />
                                        <span className="combat__tier-name" style={{ color: '#64b5f6' }}>
                                            <TinyIcon icon={getPotionImage('mp_potion_sm') ?? '💧'} size="sm" /> {potionInfo.mpLabel} ({potionInfo.mpHeal})
                                        </span>
                                        <span className="combat__tier-chance">{(potionInfo.mpChance * 100).toFixed(2)}%</span>
                                    </div>
                                    {potionInfo.mega && (
                                        <>
                                            <div className="combat__variant-tier">
                                                <span className="combat__tier-dot" style={{ background: '#ff7043' }} />
                                                <span className="combat__tier-name" style={{ color: '#ff7043' }}>
                                                    <TinyIcon icon={getPotionImage('hp_potion_mega') ?? '❤️‍🔥'} size="sm" /> {potionInfo.mega.hpLabel} ({potionInfo.mega.hpHeal})
                                                </span>
                                                <span className="combat__tier-chance">{(potionInfo.mega.chance * 100).toFixed(2)}%</span>
                                            </div>
                                            <div className="combat__variant-tier">
                                                <span className="combat__tier-dot" style={{ background: '#26c6da' }} />
                                                <span className="combat__tier-name" style={{ color: '#26c6da' }}>
                                                    <TinyIcon icon={getPotionImage('mp_potion_mega') ?? '💎'} size="sm" /> {potionInfo.mega.mpLabel} ({potionInfo.mega.mpHeal})
                                                </span>
                                                <span className="combat__tier-chance">{(potionInfo.mega.chance * 100).toFixed(2)}%</span>
                                            </div>
                                        </>
                                    )}
                                </div>

                                {/* Spell chest drops — heroic tier shown only at mastery 25/25 */}
                                {chestInfo.levels.length > 0 && (() => {
                                    const chestLevelsLabel = chestInfo.levels.length === 1
                                        ? `Lvl ${chestInfo.levels[0]}`
                                        : `Lvl ${chestInfo.levels[0]}–${chestInfo.levels[chestInfo.levels.length - 1]}`;
                                    return (
                                        <div className="combat__drops-potions">
                                            <div className="combat__drops-potions-title" style={{ color: '#ab47bc' }}>
                                                <TinyIcon icon={getSpellChestImage(1000) ?? '📦'} size="sm" /> Spell Chest ({chestLevelsLabel})
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
                                                    👑 Mastery 25/25 odblokuje tier <strong>Heroic</strong> (5%).
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

            {/* ── In-fight UI — fully unified across hunting/boss/dungeon/etc ──
                Per-view engines (combat, boss, dungeon…) all feed the same
                shared <CombatUI/> family. Hunting is the reference: it shows
                the most features (HuntedTally, +/- monster controls, hunt-popup
                exit). Other views just hide what doesn't apply.

                Notable mappings:
                  • waveMonsters[]  → enemies  (left column, 4 fixed slots)
                  • [player, ...partyBots] → allies  (right column, 4 fixed slots)
                  • activeSkillSlots[] → action-bar skill buttons
                  • bestHp/MpPotion + bestPctHp/MpPotion → potion buttons
                  • activeTasks + activeQuests for this monster → CombatTaskBadge
            ───────────────────────────────────────────────────────────────── */}
            {phase !== 'idle' && monster && (() => {
                // ── Enemy slots (left column) ─────────────────────────────────
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
                    // Per-slot pulse counter — every distinct hit landed on
                    // this monster bumps it so the keyed flash overlay in
                    // EnemyCard re-mounts and the CSS animation replays even
                    // when two attacks (auto + skill, party multi-hit) land
                    // inside the same 300ms window.
                    hitPulse: monsterHitPulses[i] ?? 0,
                    attackingClassName:
                        hitMonsterIdx === i && attackingClassName
                            ? `attack-${attackingClassName}`
                            : null,
                    // Per-slot VFX from useCombatFx — pushed by the engine's
                    // event handler above (monsterHit/botMonsterHit/skillAnim).
                    skillAnim: fx.enemySkill[i] ?? null,
                    floats: fx.enemyFloats[i] ?? [],
                    // Live stun / immortal countdowns from the engine — drains
                    // every tick because `huntStatusTick` mutates the status
                    // object in-place (no new ref needed).
                    statusOverlay: getHuntMonsterStatusView(i, w.monster.id),
                }));

                // ── Ally slots (right column) — player first, then bots ──────
                // 2026-05-11 spec ("agroo widoczne tak samo na obu ekranach"):
                // the leader's engine encodes aggroTarget as `'player'` for
                // their own slot and `human_<id>` for remote party humans.
                // When state is broadcast, both encodings travel as-is. On
                // the LEADER's screen `'player'` = "me"; on a MEMBER's
                // screen `'player'` = "the leader" (since the leader is
                // the broadcast author). Compute the local player's
                // aggro count accordingly.
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
                // Build summon-type counts for the badge tooltip. The hunt
                // engine writes summons under the constant `'player'` key.
                const playerSummonList = necroSummons['player'] ?? [];
                const playerSummonsByType: Partial<Record<'skeleton' | 'ghost' | 'demon' | 'lich', number>> = {};
                for (const sm of playerSummonList) {
                    playerSummonsByType[sm.type] = (playerSummonsByType[sm.type] ?? 0) + 1;
                }
                // Necromancer summon avatar/HP swap — front-of-queue
                // summon (skeleton → ghost → demon → lich) takes over
                // the necro's card. Slot 0 then represents THAT
                // summon: name + portrait + own HP/MP pool. Damage to
                // slot 0 hits the summon's HP first; once dead the
                // queue rotates, eventually leaving the necro herself
                // exposed again. See necroSummonStore for caps + HP
                // fractions per type.
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
                // 2026-05-11 spec ("postacie w takiej samej kolejnosci na
                // obu ekranach"): iterate `party.members` in server order
                // (joined_at ASC — leader first, then joiners in order)
                // and emit one entry per human regardless of who's the
                // local player. Bots tack on at the end. fx-slot mapping
                // stays: local player owns slot 0, remote humans take
                // 1..N in `non-self filtered` order so the existing
                // `partyLastSpells` / `partyLastDamage` handlers still
                // target the right card.
                const humansInOrder = (party?.members ?? []).filter((m) => !m.isBot);
                const remoteHumanFxIdx = (memberId: string): number => {
                    const list = humansInOrder.filter((m) => m.id !== character.id);
                    const idx = list.findIndex((m) => m.id === memberId);
                    return idx + 1;
                };
                // 2026-05-18 spec ("W polowaniu zniknal moj avatar jak
                // walcze sam bez party"): when the player isn't in a
                // party (or is in one but it doesn't contain them as a
                // human entry yet — race during join), `humansInOrder`
                // would skip them entirely and the ally column rendered
                // only bots. Force the local player into slot 0 in
                // that case so their avatar + HP + MP bars always
                // render in solo hunts.
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
                            // Local player — the rich entry with summons,
                            // hit pulses, etc. fx slot 0.
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
                        // Remote human ally — HP/MP/transform from presence.
                        const presence = partyPresence[m.id];
                        const tier = presence?.transformTier ?? 0;
                        const accent = classColorFallbackMap[m.class] ?? '#888';
                        const hasPresence = presence !== undefined;
                        const hpC = hasPresence ? (presence?.hp ?? 0) : 1;
                        const hpM = hasPresence ? (presence?.maxHp ?? 1) : 1;
                        const mpC = hasPresence ? (presence?.mp ?? 0) : 1;
                        const mpM = hasPresence ? (presence?.maxMp ?? 1) : 1;
                        const fxSlot = remoteHumanFxIdx(m.id);
                        // 2026-05-11 spec ("agroo na sojusznikach"): count
                        // alive wave monsters whose aggroTarget points at
                        // this remote human. If the remote IS the leader
                        // their encoded aggro id is `'player'` (because
                        // that's what the leader's engine wrote before
                        // broadcasting). Otherwise it's `human_<id>`.
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
                        // Bots come AFTER party humans in the column.
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
                            level: bot.level,
                            aggroCount: waveMonsters.filter(
                                (w) => !w.isDead && w.aggroTarget === bot.id,
                            ).length,
                            // Per-bot pulse — bumped via the engine's `botHit`
                            // event (see effect above) so each ally flashes only
                            // when a wave monster actually targets them.
                            hitPulse: botHitPulses[bot.id] ?? 0,
                            // Display slot is `bIdx + 1` (player is slot 0). The
                            // event handler above maps engine `botHit` → this slot.
                            skillAnim: fx.allySkill[slotIdx] ?? null,
                            floats: fx.allyFloats[slotIdx] ?? [],
                        };
                    }),
                ];

                // ── Skill slots (action-bar) ──────────────────────────────────
                const uiSkills: Array<ICombatSkillSlot | null> =
                    (activeSkillSlots as (string | null)[]).map((skillId, i) => {
                        if (!skillId) return null;
                        // Per-skill MP cost (from data/skills.json). UI shows
                        // the actual cost of THIS slot so the player sees
                        // why a high-tier spell might not be castable.
                        const slotMpCost = getSkillMpCost(skillId);
                        const cdRemaining = skillCooldowns[skillId] ?? 0;
                        const cdActive = cdRemaining > 0;
                        const noMp = playerCurrentMp < slotMpCost;
                        return {
                            id: skillId,
                            icon: getSkillIcon(skillId),
                            name: skillId,
                            mpCost: slotMpCost,
                            cooldownProgress: cdActive ? 1 - cdRemaining / SKILL_COOLDOWN_MS : 1,
                            cooldownRemainingMs: cdRemaining,
                            disabled: skillMode === 'auto' || noMp || cdActive,
                            onClick: () => doUseSkill(i as 0 | 1 | 2 | 3),
                        };
                    });

                // ── Potion slots (action-bar = pct, sub-controls = flat) ──────
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
                        // 2026-05: feed the actual selected potion's PNG art into
                        // the dock so it matches the Inventory bag tile (no more
                        // generic ❤️/💧 emoji at the bottom of combat).
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
                                /* Global cast overlay disabled: per-slot
                                   animations on the targeted enemy/ally card
                                   are now the canonical visual. The
                                   centre-screen overlay was duplicating the
                                   spell PNG and reading as a bug to the
                                   player. `skillAnimOverlay` itself still
                                   ticks (so triggerSkillAnim calls don't
                                   crash) but its render is suppressed. */
                                overlay={null}
                            />

                            {/* +/− wave-size controls — hunting only.
                                Shows the PLANNED wave size (1–MAX) — the count
                                the player chose for the NEXT wave to spawn. The
                                current wave is never mutated mid-fight; killing
                                a monster doesn't drop the number on screen. The
                                player can tweak this any time and it applies at
                                the next wave start.

                                The pill is rendered INLINE inside <CombatSubControls>
                                via the `waveControl` slot so it shares the bag/logs
                                row — on mobile that gives the player a
                                [bag][wave][logs] strip; on desktop it sits between
                                the HuntedTally (left) and the bag/logs cluster
                                (right) instead of having its own dedicated row. */}
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
                                    // 2026-05-11 spec ("dopisz +% bonus XP
                                    // przy XP/h"): combined XP multiplier
                                    // ABOVE base — party + active XP buffs.
                                    // Mastery is per-monster so we skip it
                                    // here (shown per-kill in the log).
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

                            {/* After-victory footer — hunting only.
                                Two primary post-victory choices: "Walcz ponownie"
                                (re-spawn same monster) and "Zmień potwora" (back
                                to monster picker). The flee/exit path is owned by
                                the action-bar's Wyjdź button.

                                HIDDEN when auto-fight is on — in that mode the
                                player isn't choosing manually, so the popup just
                                blocks the arena. The under-header countdown bar
                                below replaces it as the "we're waiting" cue.

                                2026-05-17 spec ("to sie tyczy kazdej walki w
                                party"): if the wave ended in victory but the
                                player is still dead (chose Czekaj, no one
                                rezed), show only "Wróć do miasta" — same as
                                boss / raid. Forces the death sequence to
                                fire so they get the standard skull overlay +
                                penalty. */}
                            {phase === 'victory' && playerCurrentHp <= 0 && (
                                <div className="combat-ui__victory-footer">
                                    <button
                                        type="button"
                                        className="combat-ui__victory-btn combat-ui__victory-btn--primary"
                                        onClick={handleDeathReturnToTown}
                                    >
                                        🏠 Wróć do miasta
                                    </button>
                                </div>
                            )}
                            {phase === 'victory' && playerCurrentHp > 0 && !autoFight && (
                                <div className="combat-ui__victory-footer">
                                    <button
                                        type="button"
                                        className="combat-ui__victory-btn combat-ui__victory-btn--primary"
                                        onClick={() => {
                                            const baseMonster =
                                                monsters.find((m) => m.id === monster.id) ?? monster;
                                            engineStartNewFight(baseMonster);
                                        }}
                                    >
                                        ⚔️ Walcz ponownie
                                    </button>
                                    <button
                                        type="button"
                                        className="combat-ui__victory-btn"
                                        onClick={() => stopCombat()}
                                    >
                                        🔄 Zmień potwora
                                    </button>
                                </div>
                            )}

                            {/* Auto-fight countdown — slim transform-tinted bar
                                pinned right under the TopHeader, fills L→R over
                                AUTO_FIGHT_DELAY_MS while we wait for the next
                                wave to spawn. Replaces the in-popup countdown
                                so the player sees a thin, unobtrusive cue
                                instead of a center-screen modal during auto
                                runs. Hidden when SKIP speed is on (delay
                                collapses to 10ms — would just blink). */}
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

                            {/* Action bar fixed-bottom — replaces global BottomNav
                                for the whole combat session. Stays visible during
                                'victory' so the player still sees skills/potions/
                                exit between waves; only the explicit Wyjdź /
                                Zmień potwora paths return to the global nav. */}
                            {(phase === 'fighting' || phase === 'victory') && (
                                <CombatActionBar
                                    skills={uiSkills}
                                    exit={{
                                        kind: 'hunt-popup',
                                        onOpenDialog: () => setExitDialogOpen(true),
                                    }}
                                />
                            )}

                            {/* Floating potion dock — fixed bottom-left, always
                                visible during fighting/victory so the player can
                                sip without scrolling. Stacked: HP → %HP → MP → %MP. */}
                            {(phase === 'fighting' || phase === 'victory') && (
                                <CombatPotionDock
                                    hpPotion={flatHpSlot}
                                    pctHpPotion={pctHpSlot}
                                    mpPotion={flatMpSlot}
                                    pctMpPotion={pctMpSlot}
                                />
                            )}

                            {/* Hunt-only exit popup ("Zakończ" vs "Wróć do miasta") */}
                            {exitDialogOpen && (
                                <HuntExitDialog
                                    onClose={() => setExitDialogOpen(false)}
                                    onEndHunt={() => {
                                        setExitDialogOpen(false);
                                        stopCombat();
                                        useCombatStore.getState().clearCombatSession();
                                        // 2026-05-12 spec ("knight wyszedl z polowania
                                        // a u archera dalej zostal w walce"): when a
                                        // PARTY MEMBER exits the hunt, they must leave
                                        // the party too so the leader's roster + ally
                                        // column drop them and aggro re-rolls. The
                                        // leader exiting kicks EVERYONE (disband) per
                                        // the same spec — boss/raid/hunt exit by the
                                        // leader auto-dismantles the party.
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
            {/* 2026-05-14: leader-death popup. Mirrors Boss / Raid —
                arms when the leader's HP hits 0 with at least one
                ally still up; "Wróć do miasta" applies penalty +
                hands off leadership + leaves party; "Czekaj" closes
                the popup and waits for a Cleric rez. */}
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
