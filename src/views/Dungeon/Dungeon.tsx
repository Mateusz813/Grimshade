import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import dungeonData from '../../data/dungeons.json';
import monstersData from '../../data/monsters.json';
import itemsData from '../../data/items.json';
import { useCharacterStore } from '../../stores/characterStore';
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
// Dungeon combat uses simplified damage calculation (no skills/crits)
import { rollMonsterDamage, getSpeedScaledCooldownMs, resolveSkillRecastMs } from '../../systems/combat';
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
import { getTrainingBonuses, getCombatSkillUpgradeMultiplier } from '../../systems/skillSystem';
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
import { saveCurrentCharacterStores } from '../../stores/characterScope';
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
import './Dungeon.scss';

// -- Class config for dual wield ----------------------------------------------

interface IDungeonClassData {
    dualWield?: boolean;
    dualWieldDmgPercent?: number;
}

const classesArray = classesRaw as unknown as (IDungeonClassData & { id: string })[];
const classesDataMap: Record<string, IDungeonClassData> = {};
for (const c of classesArray) {
    classesDataMap[c.id] = c;
}

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

// -- Constants -----------------------------------------------------------------

// `entering` is a brief cinematic phase between the lobby and combat — the
// dungeon image zooms from the clicked card to fullscreen while the screen
// darkens to black, holds, then reveals into the combat HUD. Combat does NOT
// tick during this phase (no spawn, no intervals) so the player isn't taking
// damage while watching the intro. A click anywhere on the overlay skips
// directly to combat (handled in `handleEnterClick`'s skip branch).
type ScreenPhase = 'list' | 'entering' | 'running' | 'result';

// Total length of the cinematic entry. Capped at 2s so veteran grinders
// don't feel held hostage between runs — the morph + darkness + reveal
// still read as a deliberate transition at this tempo, just snappier.
const ENTRY_ANIM_TOTAL_MS = 2000;
// When inside the entry animation, we mount the combat panel + spawn the
// first wave at this offset so the AnimatePresence fade-in lines up with the
// "reveal" portion of the overlay (the last ~33%) rather than snapping in
// at the very end. Combat intervals don't run yet — the panel is rendered
// for AnimatePresence to crossfade UNDER the still-fading-out black overlay
// so the reveal looks like the dungeon "appearing" rather than popping in.
// Kept at 67% of the total (matches the darkness `times` peak end-point).
const ENTRY_ANIM_COMBAT_START_AT_MS = 1340;

// Dungeons ALWAYS run at x1 speed (independent of normal combat speed)

const MONSTER_TYPE_BADGES: Record<DungeonMonsterType, { label: string; icon: string; color: string }> = {
    Normal:    { label: 'Normal',    icon: '',   color: '#9e9e9e' },
    Strong:    { label: 'Strong',    icon: 'flexed-biceps', color: '#2196f3' },
    Epic:      { label: 'Epic',      icon: 'high-voltage', color: '#4caf50' },
    Legendary: { label: 'Legendary', icon: 'fire', color: '#f44336' },
    Boss:      { label: 'BOSS',      icon: 'crown', color: '#ffc107' },
};

// -- Drop table helpers -------------------------------------------------------

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const;
// Heroic isn't part of the regular item drop, but stones include a "Heroic
// Stone" tier — kept here so the stone-color lookup below has a hue to use
// (matches Boss.tsx's heroic colour for visual consistency across views).
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
    /** Maps the stone tier to the matching item-rarity colour so the dot in
     *  the drop modal reads as "this stone is in the X tier" at a glance —
     *  e.g. a Rare Stone shares the blue dot used for Rare items. Without
     *  this, all stone dots collapsed to the same grey and players had to
     *  read the labels to tell them apart. */
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

// -- Skill / Potion constants -------------------------------------------------

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
    type: 'player' | 'monster' | 'crit' | 'system' | 'wave' | 'block' | 'dodge';
}

// -- Get attack interval ms ---------------------------------------------------

const getAttackMs = (speed: number): number =>
    Math.max(500, Math.floor(3000 / Math.max(1, speed || 1)));

// Pause between a wave's monster dying and the next wave's monster
// spawning. Drives the slim "next monster in…" bar pinned under the
// TopHeader so the player has a visible cue during the lull.
const WAVE_SPAWN_DELAY_MS = 600;

// -- Component -----------------------------------------------------------------

const Dungeon = () => {
    const character    = useCharacterStore((s) => s.character);
    const party        = usePartyStore((s) => s.party);
    const equipment    = useInventoryStore((s) => s.equipment);
    const consumables  = useInventoryStore((s) => s.consumables);
    const completedTransforms = useTransformStore((s) => s.completedTransforms);
    // Bug 2 (2026-04): subscribe to allBuffs so render-time charMaxHp/charMaxMp
    // recomputes whenever a buff is added/removed/expired. Without this the
    // component renders only on character/equipment changes — meaning a buff
    // tick-down mid-combat leaves charMaxHp stale and the auto-potion clamps
    // heals at the wrong cap.
    const _activeBuffs = useBuffStore((s) => s.allBuffs);
    void _activeBuffs;
    // Necromancer summon stack — when the local player is a necro, this is
    // the live ordered list spawned by `useNecroSummonStore`. The shared
    // AllyCard renders the summon-count badge from `summonCount` /
    // `summonsByType` plumbed below.
    const necroSummons = useNecroSummonStore((s) => s.summons);
    const playerAvatarSrc = character ? getCharacterAvatar(character.class, completedTransforms) : '';
    const { activeSkillSlots } = useSkillStore();
    // Dungeons always run at x1 speed (no speed controls)
    const { setDungeonCompleted, getAttemptsUsed, getAttemptsMax, canEnter, isDungeonCleared } = useDungeonStore();

    const [phase, setPhase]               = useState<ScreenPhase>('list');
    const [activeDungeon, setActiveDungeon] = useState<IDungeon | null>(null);
    // Holds the dungeon id whose drop-table popup is open (replaces the old
    // inline-expansion behaviour — the drop info now lives in a modal so the
    // tile body stays compact and a single click opens a focused view).
    const [dropModalDungeon, setDropModalDungeon] = useState<string | null>(null);
    const [result, setResult]             = useState<IDungeonResult | null>(null);
    // Result kind drives the post-combat CTA — green "Odbierz" on win, red
    // "Uciekaj" on flee, red "Wróć" on death. Tracked separately from
    // `result` so we don't have to widen the shared IDungeonResult type
    // (which is also used by the offline simulator).
    const [resultKind, setResultKind] = useState<'win' | 'death' | 'flee' | null>(null);

    // -- Tile-zoom entry animation ---------------------------------------------
    // When the player clicks "Wejdź" we capture the source card's bounding
    // box + visual identity (hue + image), animate a fixed overlay growing
    // from that rect to fullscreen, then flip phase to 'running'. The
    // overlay holds at fullscreen through the AnimatePresence cross-fade
    // so the player never sees a blank flash between the list and the
    // combat panel.
    const [enterAnim, setEnterAnim] = useState<
        | { x: number; y: number; w: number; h: number; hue: number; image: string; dungeonId: string }
        | null
    >(null);
    const enterAnimTimeoutsRef = useRef<number[]>([]);
    // The dungeon the cinematic is leading INTO — read by `skipEntryAnimation`
    // so a click during the intro can hand the right object to `handleStart`
    // without waiting for the queued timeout. Reset to null on overlay teardown.
    const pendingDungeonRef = useRef<IDungeon | null>(null);
    useEffect(() => {
        return () => {
            enterAnimTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
            enterAnimTimeoutsRef.current = [];
        };
    }, []);

    // -- Wave combat state ------------------------------------------------------
    // A wave now spawns 1–4 monsters at once (see `getWaveComposition`).
    // `currentMonsters` carries each enemy with per-slot HP + rarity tier so
    // the arena can render the lineup, the attack callbacks can target the
    // first alive slot, and the wave-clear handler can iterate kills for
    // XP/gold/loot rolls.
    interface ICurrentMonster {
        slot: number;                    // 0..3 — stable arena column
        monster: IDungeonMonster;        // base stats AFTER scaleDungeonMonsterAsType
        type: DungeonMonsterType;        // rarity tier this slot was scaled to
        currentHp: number;
        maxHp: number;
    }
    const [currentWave, setCurrentWave]       = useState(0);
    const [currentMonsters, setCurrentMonsters] = useState<ICurrentMonster[]>([]);
    const [playerHp, setPlayerHp]             = useState(0);
    const [playerMp, setPlayerMp]             = useState(0);
    const [combatLog, setCombatLog]           = useState<ILogEntry[]>([]);
    const [, setWaveItems]                    = useState<IGeneratedItem[]>([]);
    // Per-slot hit pulse — incremented on EVERY distinct hit landed against
    // that monster slot. Drives the keyed flash overlay in EnemyCard so two
    // hits inside the same 300ms window each get their own visible flash
    // instead of merging into one (e.g. auto-attack + auto-skill firing on
    // the same tick). Counter never resets between waves — only the slot
    // number matters for keying.
    const [monsterHitPulses, setMonsterHitPulses] = useState<Record<number, number>>({});
    // Slot index of the monster the player is currently swinging at, so the
    // attack VFX (`attack-${class}`) lands on the right card.
    const [playerAttackingSlot, setPlayerAttackingSlot] = useState<number | null>(null);

    // Skill & potion state
    const [skillCooldowns, setSkillCooldowns] = useState<Record<string, number>>({});
    const [hpPotionCooldown, setHpPotionCooldown] = useState(0);
    const [mpPotionCooldown, setMpPotionCooldown] = useState(0);
    const [pctHpCooldown, setPctHpCooldown] = useState(0);
    const [pctMpCooldown, setPctMpCooldown] = useState(0);
    const [speedMode, setSpeedMode] = useState<'x1' | 'x2' | 'x4'>('x1');
    const speedMult = speedMode === 'x4' ? 4 : speedMode === 'x2' ? 2 : 1;
    const cycleSpeed = useCallback(() => {
        // Pure state transition — BuffStore sync happens in the
        // useEffect below to avoid "setState during render" warnings
        // (calling Zustand inside a React updater fn caused TopHeader
        // to attempt a re-render mid-Dungeon-render).
        setSpeedMode((s) => (s === 'x1' ? 'x2' : s === 'x2' ? 'x4' : 'x1'));
    }, []);

    // Sync BuffStore.combatSpeedMult with selected speed; reset to 1 on
    // unmount so skill buffs drain real-time outside the dungeon.
    useEffect(() => {
        useBuffStore.getState().setCombatSpeedMult(speedMult);
        return () => useBuffStore.getState().setCombatSpeedMult(1);
    }, [speedMult]);

    // Cleric Błogosławieństwo accumulator — actual useEffect lives
    // below where fx + charMaxHp + playerHpRef are all in scope.
    const partyHealAccumRef = useRef(0);
    const { trigger: triggerSkillAnim } = useSkillAnim();
    // Per-slot combat VFX (skill overlays + floating damage numbers).
    // Lives in a single hook so each enemy / ally slot has its own
    // independent stream of visuals — no merging when two hits land in
    // the same frame. See `useCombatFx` doc-comment for full per-kind
    // semantics. We then bind `enemyFloats[slot]` / `enemySkill[slot]`
    // (and the ally side) into the `uiEnemies` / `uiAllies` arrays
    // built lower in the render so EnemyCard / AllyCard render them
    // automatically.
    const fx = useCombatFx();
    const skillCooldownRef = useRef<Map<string, number>>(new Map());
    const hpPotionCooldownRef = useRef(0);
    const mpPotionCooldownRef = useRef(0);
    const pctHpCooldownRef = useRef(0);
    const pctMpCooldownRef = useRef(0);
    const playerMpRef = useRef(0);

    // Animation state — `monsterHitPulses` (per-slot counter) is tracked
    // above. The player-side hit flash uses a SINGLE counter (there's still
    // only one player slot) but it's a counter not a boolean — every monster
    // attack increments it so the keyed flash overlay in AllyCard re-mounts
    // and replays the animation even when 4 monsters all swing in the same
    // 300ms window. Without the counter, two near-simultaneous hits would
    // visually merge into one shake because the boolean class was already on.
    const [playerHitPulse, setPlayerHitPulse] = useState(0);

    // Wave-spawn countdown — flips ON the moment a wave's monster dies and
    // OFF when the next wave's monster spawns. While ON, an rAF loop fills
    // `spawnProgress` 0->1 over the speed-scaled `WAVE_SPAWN_DELAY_MS` so
    // the slim "next monster in…" bar pinned under the header animates
    // smoothly. We carry the start timestamp + duration in a ref so the
    // effect can pick the loop back up if speed changes mid-countdown.
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

    // Refs for interval callbacks
    const playerHpRef     = useRef(0);

    // Level-up HP/MP refill — characterStore.addXp refills hp/mp to max on
    // every level-up, but Dungeon keeps a LOCAL playerHp/playerMp useState
    // that doesn't see the store-side refill. Without this, leveling up
    // mid-wave would leave the player's bars stuck at the pre-level-up value
    // until the next damage tick. We sync the local mirrors here.
    useLevelUpRefill(phase === 'running', useCallback((maxHp, maxMp) => {
        playerHpRef.current = maxHp;
        playerMpRef.current = maxMp;
        setPlayerHp(maxHp);
        setPlayerMp(maxMp);
    }, []));

    // Per-slot live HP for the wave's lineup. Mirrors `currentMonsters[i].currentHp`
    // but lives outside React state so the high-frequency attack callbacks
    // can read/write without forcing a render every tick. The state setter
    // is fired once per damage event for the UI sync.
    const monsterHpsRef   = useRef<number[]>([]);
    const currentWaveRef  = useRef(0);
    const activeDungeonRef = useRef<IDungeon | null>(null);
    // Snapshot of the wave's spawned monsters so callbacks have access to
    // `defense` / `name_pl` / `level` without re-deriving from state.
    const currentMonstersRef = useRef<ICurrentMonster[]>([]);
    const phaseRef        = useRef<ScreenPhase>('list');
    const waveItemsRef    = useRef<IGeneratedItem[]>([]);
    const waveXpRef       = useRef(0);
    const waveGoldRef     = useRef(0);

    // Skill-effect session — shared status state across player + per-monster
    // for DOTs, stuns, marks, immortality, dodges, AOE. Reset on every fresh
    // dungeon run (see handleStart). Each monster has a stable id of the
    // form `monster_${wave}_${slot}` so its statuses don't bleed across waves.
    const effectsRef = useRef<ICombatEffectsSession>(newCombatEffectsSession());
    const PLAYER_FX_ID = 'player';
    const monsterFxId = (wave: number, slot: number) => `monster_${wave}_${slot}`;

    const allDungeons = dungeonData as IDungeon[];
    const allMonsters = monstersData as IDungeonMonster[];
    const monstersRaw = monstersData as unknown as { id: string; gold: [number, number] }[];
    const allItems: IBaseItem[] = flattenItemsData(itemsData as Parameters<typeof flattenItemsData>[0]);
    const skillLevels = useSkillStore((s) => s.skillLevels);

    // -- Filter / sort state (per-character via characterScope) --------------
    // Pulled from settingsStore so the toggles persist between sessions and
    // across class swaps. Defaults are "show everything" (no filter) so an
    // existing player opening the dungeon list sees no behavioural change.
    const dungeonFilterAvailableOnly = useSettingsStore((s) => s.dungeonFilterAvailableOnly);
    const dungeonFilterMinLevel      = useSettingsStore((s) => s.dungeonFilterMinLevel);
    const dungeonFilterSortDesc      = useSettingsStore((s) => s.dungeonFilterSortDesc);
    const setDungeonFilterAvailableOnly = useSettingsStore((s) => s.setDungeonFilterAvailableOnly);
    const setDungeonFilterMinLevel      = useSettingsStore((s) => s.setDungeonFilterMinLevel);
    const setDungeonFilterSortDesc      = useSettingsStore((s) => s.setDungeonFilterSortDesc);

    // Configured auto-potion ids — drive the potion-dock display so the UI
    // shows the SPECIFIC potion the player selected (not the strongest owned).
    const autoPotionHpId    = useSettingsStore((s) => s.autoPotionHpId);
    const autoPotionMpId    = useSettingsStore((s) => s.autoPotionMpId);
    const autoPotionPctHpId = useSettingsStore((s) => s.autoPotionPctHpId);
    const autoPotionPctMpId = useSettingsStore((s) => s.autoPotionPctMpId);

    // NOTE: `if (!character) return …` early-return was moved DOWN past every
    // hook in this component (search for "// Dungeon render guard (after-hooks)").
    // The original early return here violated Rules of Hooks — first render
    // with `character === null` skipped all subsequent hooks; second render
    // with character hydrated registered them, mismatching hook count and
    // crashing the <Dungeon> subtree with the React "change in order of Hooks"
    // error. The derived values below use `character?.X ?? 0` so they still
    // compute safely when character is null (their results are unused in
    // that case — the post-hooks guard renders the spinner instead).
    const eqStats   = getTotalEquipmentStats(equipment, allItems);
    const tb        = getTrainingBonuses(skillLevels, character?.class ?? 'Knight');
    // Gear-gap penalty: under-geared players deal proportionally less damage so
    // low-level gear can't practically clear far-higher-level dungeons.
    const gearGapMult = getGearGapMultiplier(getEquippedGearLevel(equipment), activeDungeon?.level ?? 0);
    const charAtk   = ((character?.attack  ?? 0) + eqStats.attack + getElixirAtkBonus()) * gearGapMult;
    const charDef   = (character?.defense ?? 0) + eqStats.defense + tb.defense + getElixirDefBonus();
    // Include active transform in max HP/MP so auto-potion thresholds use the
    // true cap.
    const effChar   = character ? getEffectiveChar(character) : null;
    const baseMaxHp = (character?.max_hp ?? 0) + eqStats.hp + tb.max_hp + getElixirHpBonus();
    const baseMaxMp = (character?.max_mp ?? 0) + eqStats.mp + tb.max_mp + getElixirMpBonus();
    const charMaxHp = effChar?.max_hp ?? baseMaxHp;
    const charMaxMp = effChar?.max_mp ?? baseMaxMp;
    const charSpeed = ((character?.attack_speed ?? 1) + eqStats.speed * 0.01 + tb.attack_speed) * getElixirAttackSpeedMultiplier();

    // Cleric Błogosławieństwo pulse — 1-Hz game-time tick that pushes
    // a +X HP float on the player slot every in-game second. Dungeon
    // is solo so only slot 0 fires. Heal also applied to playerHpRef
    // so the local bar rises (TopHeader keeps characterStore.hp in
    // sync via its central tick).
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fx, charMaxHp]);

    // Potions shown in the dock — respect the player's auto-potion CONFIG
    // (resolveAutoPotionElixir picks the SPECIFIC configured potion) so the
    // UI matches what auto-drink actually uses. Falls back to the best owned
    // potion when the configured one isn't held, so the slot never goes empty.
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

    // Keep refs in sync
    phaseRef.current = phase;
    activeDungeonRef.current = activeDungeon;

    // -- Live HP/MP mirror -> characterStore ---------------------------------
    // Mirrors the local `playerHp` / `playerMp` state into the global
    // characterStore on every change so the TopHeader's mini-bars (which
    // read `character.hp` / `character.mp`) update in real time as the
    // player takes hits / heals / drinks potions inside the dungeon. Gated
    // by the `running` phase so the initial 0 state we hold before
    // `handleStart` doesn't clobber the real character HP.
    //
    // CRITICAL: clamp to the EFFECTIVE max (base + equipment + training +
    // active elixirs + transform), NOT the raw `liveChar.max_hp`. Without
    // this, drinking an HP potion while a +50% HP elixir is active would
    // bring local HP from 100 -> 130 (cap = 150 effective) but the mirror
    // would clamp the store write to 100 (base) — making the TopHeader
    // bar show a stale, lower value, and worse, persisting a sub-effective
    // HP that any later "read character.hp" branch would see as truth.
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

    // -- URL-leave / tab-close = death (anti-cheat) -------------------------
    // If the player navigates away mid-fight (back button, address bar, tab
    // close) we treat it as a real death — see `applyCombatLeaveDeath` for
    // why. The guard fires at most ONCE per leave event via `appliedRef` so
    // the unmount cleanup AND the beforeunload listener don't double-tap
    // the same death. Reset on every fresh combat run by `handleStart`.
    const leavePenaltyAppliedRef = useRef(false);
    useEffect(() => {
        const fire = () => {
            if (leavePenaltyAppliedRef.current) return;
            // Only the actively-fighting phase counts — lobby/list/result
            // are safe to leave from. Refs (not state) so the cleanup
            // closure sees the LATEST phase, not whatever was current
            // when the effect mounted.
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
        // beforeunload: tab close / refresh / browser-quit. Without this the
        // saved-on-unload localStorage snapshot would NOT include the penalty
        // and the player could resurrect a clean character on reload.
        window.addEventListener('beforeunload', fire);
        return () => {
            window.removeEventListener('beforeunload', fire);
            // useEffect cleanup also covers in-app navigation (the most
            // common cheat vector — typing /town in the URL bar).
            fire();
        };
    }, []);

    const addLog = useCallback((text: string, type: ILogEntry['type']) => {
        const id = ++logIdRef.current;
        setCombatLog((prev) => [...prev.slice(-50), { id, text, type }]);
        // Mirror into the unified session log (uncapped) so the shared
        // <CombatLogsModal> in <CombatSubControls> can render the full
        // dungeon-run feed without each view rolling its own modal. The local
        // `'wave'` separator type doesn't exist in the store union -> map to
        // `'system'` so the modal renders it as a neutral log line.
        const sessionType = type === 'wave' ? 'system' : type;
        useCombatStore.getState().addSessionLog(text, sessionType);
    }, []);

    // Floating damage numbers were tied to the legacy bespoke arena. The
    // shared CombatUI tree communicates hits via card flash (`isHit`), HP-bar
    // tween, and the session log instead, so this is a no-op kept only to
    // avoid touching every callsite. Drop in a later cleanup pass.
    const showFloatingDmg = useCallback((_text: string, _type: string, _side?: 'left' | 'right') => {}, []);

    // Auto-scroll log
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [combatLog.length]);

    // -- Cooldown tick (100ms, scaled by speedMult) ---------------------------
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

    // spendPlayerMp – handled inline in skill/attack callbacks via playerMpRef

    const startHpCooldown = useCallback(() => {
        setHpPotionCooldown(POTION_COOLDOWN_MS);
        hpPotionCooldownRef.current = POTION_COOLDOWN_MS;
    }, []);

    const startMpCooldown = useCallback(() => {
        setMpPotionCooldown(POTION_COOLDOWN_MS);
        mpPotionCooldownRef.current = POTION_COOLDOWN_MS;
    }, []);

    // -- Settings toggles --------------------------------------------------
    const { skillMode, setSkillMode, autoPotionHpEnabled, autoPotionMpEnabled } = useSettingsStore();

    // -- Auto-potion helper --------------------------------------------------
    const tryAutoPotion = useCallback(() => {
        const settings = useSettingsStore.getState();
        const inv = useInventoryStore.getState();
        const hp = playerHpRef.current;
        const mp = playerMpRef.current;

        // Bug 2 (2026-04): pull the EFFECTIVE max HP/MP fresh on every fire so
        // active-but-stale buffs (e.g. a +500 / +25% elixir that ticked down
        // mid-combat without re-rendering Dungeon.tsx) can't clamp the heal at
        // the wrong cap. Closure-captured `charMaxHp` was the old culprit
        // behind "potion count went down but HP barely moved" reports.
        const freshChar = useCharacterStore.getState().character;
        const freshEff = freshChar ? getEffectiveChar(freshChar) : null;
        const liveMaxHp = freshEff?.max_hp ?? charMaxHp;
        const liveMaxMp = freshEff?.max_mp ?? charMaxMp;

        const hpMissing = Math.max(0, liveMaxHp - hp);
        const mpMissing = Math.max(0, liveMaxMp - mp);
        const hpPct = liveMaxHp > 0 ? (hp / liveMaxHp) * 100 : 100;
        const mpPct = liveMaxMp > 0 ? (mp / liveMaxMp) * 100 : 100;

        // Hard safety: never fire a potion when HP/MP are already at (or above) max —
        // regardless of threshold. Guards against stale refs, transform-cap drift,
        // and floating-point rounding when the user sees "100%" in the UI.
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

        // Flat HP
        if (!hpAtFull && settings.autoPotionHpEnabled && settings.autoPotionHpThreshold > 0 && hpPct <= settings.autoPotionHpThreshold && hpPotionCooldownRef.current <= 0) {
            const pot = resolveAmount(settings.autoPotionHpId, 'flat', 'hp', liveMaxHp);
            if (pot && pot.amount > 0 && hpMissing >= pot.amount) {
                inv.useConsumable(pot.id);
                startHpCooldown();
                healPlayerHp(pot.amount, liveMaxHp);
                addLog(`[Auto] ${pot.name} +${pot.amount} HP`, 'system');
            }
        }

        // Flat MP
        if (!mpAtFull && settings.autoPotionMpEnabled && settings.autoPotionMpThreshold > 0 && mpPct <= settings.autoPotionMpThreshold && mpPotionCooldownRef.current <= 0) {
            const pot = resolveAmount(settings.autoPotionMpId, 'flat', 'mp', liveMaxMp);
            if (pot && pot.amount > 0 && mpMissing >= pot.amount) {
                inv.useConsumable(pot.id);
                startMpCooldown();
                healPlayerMp(pot.amount, liveMaxMp);
                addLog(`[Auto] ${pot.name} +${pot.amount} MP`, 'system');
            }
        }

        // Pct HP
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

        // Pct MP
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

    // -- Manual potion use ---------------------------------------------------
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
        // Bug 2: read fresh effective max so a buff that just landed is
        // reflected immediately. Without this, the closure-captured
        // charMaxHp could clamp the heal at the pre-buff cap.
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

    // -- Start a wave's monsters (1–4 enemies at once) ------------------------
    // The composition + count come from `getWaveComposition` / `pickWaveMonsters`
    // in dungeonSystem. Each spawned monster is independently scaled to its own
    // tier (lead = wave's nominal type, escorts = same or one tier below) so the
    // HP bars and damage numbers match the per-slot rarity badge.
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
        // Reset pulse counters on every fresh wave so the first hit on any
        // slot bumps from 0->1 (rendered) instead of e.g. 5->6 with the
        // EnemyCard already holding key=5 from a finished animation.
        setMonsterHitPulses({});
        setPlayerAttackingSlot(null);
        // Drop any in-flight FX from the previous wave (skill overlays still
        // animating, leftover damage floats) so the new wave starts visually
        // clean. Without this, the floats from the killing blow on wave N
        // would briefly hover over the freshly-spawned monsters of wave N+1.
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

    // -- Start dungeon --------------------------------------------------------
    const handleStart = useCallback((dungeon: IDungeon) => {
        setActiveDungeon(dungeon);
        setCurrentWave(0);
        setResult(null);
        setResultKind(null);
        setCombatLog([]);
        setWaveItems([]);
        waveItemsRef.current = [];
        waveXpRef.current = 0;
        waveGoldRef.current = 0;
        // Fresh session for the shared backpack/logs HUD — every new dungeon
        // run starts with empty drops/xp/gold/kills, mirrored from the per-
        // wave handlers below.
        useCombatStore.getState().clearCombatSession();
        // Each fresh run is a new "leave guard" cycle — clearing the flag
        // here so a player who survived run #1 (clean exit) can still be
        // punished for bailing mid-fight on run #2.
        leavePenaltyAppliedRef.current = false;
        // HP/MP persistence: every dungeon run starts from the player's
        // CURRENT pool (clamped to live max), not full. So if you bailed out
        // of a previous fight at 23% HP, that's the HP you start the next
        // one with. Full heal only happens via potions, rest, or death
        // recovery — never as a hidden side-effect of starting combat.
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
        // Fresh effect session — clear all timers / DOTs / queues from prior
        // runs so a leftover stun doesn't carry over into a new dungeon.
        effectsRef.current = newCombatEffectsSession();
        // Drop any necro summons left from a prior dungeon run.
        useNecroSummonStore.getState().clear(PLAYER_FX_ID);
        setPhase('running');
        startWaveMonster(dungeon, 0, startHp);
    }, [charMaxHp, charMaxMp, startWaveMonster]);

    /**
     * Click handler for the per-card "Wejdź" button. Drives the cinematic
     * entry sequence — see the comment block on `ENTRY_ANIM_TOTAL_MS` for
     * the full timeline. We:
     *
     *   1. Capture the source card's bounding box + visual identity
     *      (hue + image) so the overlay can morph from the tile.
     *   2. Flip the screen into the new `'entering'` phase — combat does
     *      NOT mount yet, so monsters don't tick or attack while the
     *      cinematic plays.
     *   3. Schedule combat start at `ENTRY_ANIM_COMBAT_START_AT_MS` so the
     *      combat HUD mounts UNDER the still-fading overlay (the reveal
     *      then crossfades from black to combat instead of snapping in).
     *   4. Clear the overlay at `ENTRY_ANIM_TOTAL_MS` so the cinematic
     *      formally ends.
     *
     * Click anywhere on the overlay during the cinematic to skip — handled
     * by `skipEntryAnimation` below.
     *
     * Reduced-motion users + a missing card element bypass the animation
     * entirely (instant `handleStart`).
     */
    const handleEnterClick = useCallback(
        (e: React.MouseEvent<HTMLButtonElement>, dungeon: IDungeon) => {
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
            // Stash the dungeon to start in BOTH the overlay state (for
            // visuals) and a ref (so the skip handler can access it
            // without a stale closure on the React state setter).
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
            // Cancel any in-flight previous morph so a rapid double-click
            // doesn't leave a stale overlay on screen.
            enterAnimTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
            enterAnimTimeoutsRef.current = [];
            // T+2.4s — mount combat HUD under the still-opaque overlay so
            // the reveal portion of the animation (last ~1.2s) crossfades
            // from black to combat instead of popping in at the very end.
            const tCombat = window.setTimeout(() => {
                handleStart(dungeon);
            }, ENTRY_ANIM_COMBAT_START_AT_MS);
            enterAnimTimeoutsRef.current.push(tCombat);
            // T+2.0s — animation done, drop the overlay so the combat
            // HUD becomes the sole visible layer.
            const tEnd = window.setTimeout(() => {
                setEnterAnim(null);
            }, ENTRY_ANIM_TOTAL_MS);
            enterAnimTimeoutsRef.current.push(tEnd);
        },
        [enterAnim, handleStart],
    );

    /**
     * Skip the cinematic — clicked anywhere on the overlay during the
     * 'entering' phase. We:
     *
     *   1. Cancel every queued timeout so they don't fire later and
     *      double-start combat.
     *   2. If combat hasn't mounted yet (still in 'entering'), call
     *      `handleStart` immediately so the player jumps straight in.
     *   3. Clear the overlay state so AnimatePresence runs the (fast)
     *      exit animation on the overlay div.
     *
     * Idempotent — calling twice is a no-op because `enterAnim` becomes
     * null after the first invocation and the early return short-circuits.
     */
    const skipEntryAnimation = useCallback(() => {
        if (!enterAnim) return;
        enterAnimTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
        enterAnimTimeoutsRef.current = [];
        if (phaseRef.current === 'entering' && pendingDungeonRef.current) {
            handleStart(pendingDungeonRef.current);
        }
        setEnterAnim(null);
    }, [enterAnim, handleStart]);

    // -- Handle a single monster dying inside the current wave ---------------
    // Per-slot rewards (XP, gold, mastery, kill counters, item drops, potion
    // drops) fire here. Wave-clear logic (advance wave / end dungeon) only
    // triggers once every slot in `currentMonstersRef.current` reports
    // `currentHp <= 0`.
    const handleWaveMonsterDeath = useCallback((slotIdx: number) => {
        const dungeon = activeDungeonRef.current;
        if (!dungeon || !character) return;

        const slots = currentMonstersRef.current;
        const killed = slots[slotIdx];
        if (!killed) return;

        // Tick combat elixirs per kill (was per wave — now matches kill cadence
        // since waves spawn 1–4 monsters and we want the elixir tick to scale
        // with the actual fight pace).
        tickCombatElixirs(1500);

        const totalWaves = getDungeonWaves(dungeon);
        const wave = currentWaveRef.current;
        const isBossWave = wave === totalWaves - 1;

        // Roll item drop per kill — boss-wave roll for slots inside the boss
        // wave, regular roll otherwise. The lead slot of a boss wave still
        // uses the boss roll so the legendary/mythic shower stays attached
        // to the lead boss kill rather than a random escort slot.
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

        // Potion drops keyed off the killed monster's level (mega potions
        // gated to lvl ≥100 inside the helper).
        const potionDrops = rollPotionDrop(killed.monster.level);
        if (potionDrops.length > 0) {
            const inv = useInventoryStore.getState();
            for (const pd of potionDrops) {
                inv.addConsumable(pd.potionId, pd.count);
                addLog(`:test-tube: Drop: ${pd.potionId} ×${pd.count}`, 'system');
            }
        }

        // Per-kill task / quest / mastery progress.
        const killedMonster = killed.monster;
        useTaskStore.getState().addKill(killedMonster.id, killedMonster.level, 1);
        useQuestStore.getState().addProgress('kill', killedMonster.id, 1);
        useDailyQuestStore.getState().addProgress('kill_any', 1);
        useMasteryStore.getState().addMasteryKills(killedMonster.id, 1);
        // Use the SLOT's rarity (Boss/Legendary/Epic/Strong/Normal) for the
        // session-kill pill so the player sees per-mob rarity counters
        // instead of every kill collapsing into the lead's tier.
        useCombatStore.getState().incrementSessionKill(
            killed.type.toLowerCase() as TMonsterRarity,
        );

        // Mastery N7: per-kill XP/Gold bonus (+2% per level, cap +50%)
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

        // Wave-clear gate — only proceed when EVERY slot in the wave is dead.
        const allDead = currentMonstersRef.current.every((m) => m.currentHp <= 0);
        if (!allDead) return;

        const hp = playerHpRef.current;

        if (isBossWave) {
            // ALL WAVES CLEARED — reward = (accumulated monster XP/gold × 4)
            //                            + level-driven completion bonus.
            // The bonus differentiates dungeons that share a base bestiary
            // tail (e.g. lvl 960 vs 980) so progression keeps moving.
            //   bonus_xp   = dungeon.level²        (lvl 1 = +1, lvl 900 = +810k)
            //   bonus_gold = dungeon.level × 1 000 (lvl 1 = +1k, lvl 960 = +9,6 cc)
            const DUNGEON_REWARD_MULTIPLIER = 4;
            const dungeonLevel = dungeon.level ?? 1;
            const xpBonus = dungeonLevel * dungeonLevel;
            const goldBonus = dungeonLevel * 1_000;
            const gold = waveGoldRef.current * DUNGEON_REWARD_MULTIPLIER + goldBonus;
            const xp = waveXpRef.current * DUNGEON_REWARD_MULTIPLIER + xpBonus;
            const items = waveItemsRef.current;

            // Apply rewards
            const inv = useInventoryStore.getState();
            inv.addGold(gold);
            const xpResult = useCharacterStore.getState().addXp(xp);
            for (const gen of items) inv.addItem(buildItem(gen));

            // Final XP/Gold tally for the unified backpack modal — drop-by-
            // drop appends are already in `useCombatStore.lastDrops`.
            useCombatStore.getState().addSessionStats(xp, gold);

            // Spell chest drops (dungeon = 1.5x multiplier)
            const dungeonLvl = dungeon.level ?? 1;
            const chestDrops = rollSpellChestDrop(dungeonLvl, 'normal', true, false);
            const chestNames: string[] = [];
            for (const cd of chestDrops) {
                inv.addSpellChest(cd.chestLevel, cd.count);
                chestNames.push(`${getSpellChestEmoji(cd.chestLevel)} ${getSpellChestDisplayName(cd.chestLevel)}`);
            }

            setDungeonCompleted(dungeon.id);
            // Track dungeon completion for quests
            useQuestStore.getState().addProgress('dungeon', dungeon.id, 1);
            useQuestStore.getState().addProgress('complete_dungeons_any', 'any', 1);
            useDailyQuestStore.getState().addProgress('complete_dungeon', 1);
            useDailyQuestStore.getState().addProgress('earn_gold', gold);
            addLog(`:trophy: Dungeon ukończony! +${gold.toLocaleString('pl-PL')} Gold, +${xp.toLocaleString('pl-PL')} XP`, 'system');
            if (chestNames.length > 0) {
                addLog(`:package: Spell Chests: ${chestNames.join(', ')}`, 'system');
            }
            setResult({ success: true, wavesCleared: totalWaves, playerHpLeft: hp, gold, xp, items });
            setResultKind('win');
            // Persist the player's end-of-run HP/MP back to the character
            // store so the next combat (any view) starts from this exact
            // state. Winning the dungeon is no longer a hidden full heal —
            // it's just a victory. (Full heal still happens on real death.)
            //
            // CRITICAL FIX (HP-drops-to-tiny-percent bug):
            //   Recompute the EFFECTIVE max HP/MP using the post-addXp
            //   character so a level-up's "full heal" lands at the
            //   displayed bar's ceiling (base + equipment + training +
            //   elixir + transform). Without this, addXp's internal heal
            //   only counts base + equipment + training (see
            //   getEffectiveMaxBonuses in characterStore.ts), so an active
            //   elixir or transform leaves the player at a tiny fraction
            //   of the bar even on a clean kill.
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
                    ? liveEffectiveMaxHp                                                       // level-up = full heal at the displayed max
                    : Math.max(1, Math.min(liveEffectiveMaxHp, hp));                           // no level-up = preserve in-run damage
                const finalMp = xpResult.levelsGained > 0
                    ? liveEffectiveMaxMp
                    : Math.max(0, Math.min(liveEffectiveMaxMp, playerMpRef.current));
                useCharacterStore.getState().updateCharacter({ hp: finalHp, mp: finalMp });
            }
            // Clean win — disable the leave guard so closing the result
            // screen doesn't punish a player who actually finished the run.
            leavePenaltyAppliedRef.current = true;
            setPhase('result');
        } else {
            // Next wave after a short pause — the slim spawn-timer bar
            // under the header animates over this interval. Speed-scaled
            // so the x2/x4 buttons collapse the wait alongside the
            // attack tempo (otherwise the lull stretches the run out).
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
                    // Read FRESH HP at the moment of wave start so any heal
                    // that landed during the spawn delay (auto-potion firing
                    // mid-tick, manual potion sip, regen) is preserved
                    // instead of being overwritten by the stale `hp` snapshot
                    // captured back at wave-clear time. This was the cause
                    // of "potion heals get reverted at wave end" — closing
                    // over a pre-heal value clobbered the fresh post-heal
                    // ref read.
                    startWaveMonster(dungeon, nextWave, playerHpRef.current);
                }
                setWaitingForSpawn(false);
                setSpawnProgress(0);
            }, delayMs);
        }
    }, [character, allItems, addLog, setDungeonCompleted, charMaxHp, charMaxMp, startWaveMonster, speedMult]);

    // -- Handle player death --------------------------------------------------
    const handlePlayerDeath = useCallback(() => {
        const dungeon = activeDungeonRef.current;
        if (!dungeon) return;
        // Real combat death is the canonical penalty for this run — flag the
        // leave-guard as already-applied so the unmount cleanup doesn't fire
        // a SECOND penalty when the player closes the result screen.
        leavePenaltyAppliedRef.current = true;
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

            // Unified protection (2026-06-21): ONE item (death_protection elixir
            // first, else amulet_of_loss) shields EVERYTHING — no level, no xp,
            // no skill xp, no item loss — on both death and flee.
            const prot = consumeDeathProtection();

            useCharacterStore.getState().fullHealEffective();

            const oldLevel = char.level;
            let newLevel = char.level;
            let levelsLost = 0;
            let xpPercent = 100;
            let skillXpLossPercent = 0;

            if (prot.isProtected) {
                // ZERO loss: keep level/xp/skill xp/items intact, only full-heal.
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

                // Item loss happens on UNPROTECTED DEATH ONLY.
                const itemsLost = useInventoryStore.getState().applyDeathItemLoss(false, char.level);
                if (itemsLost > 0) {
                    addLog(`:skull: Stracileś ${itemsLost} przedmiot(ow) przy śmierci!`, 'system');
                }
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
                skillXpLossPercent,
                protectionUsed: prot.isProtected,
                source: 'dungeon',
            });
        } else {
            addLog(`:skull: Poległeś na fali ${wave + 1}/${totalWaves}! Dungeon nieukończony.`, 'system');
        }

        // Death wipes the in-flight session feed/loot — the death modal owns
        // the post-mortem, so the unified backpack/logs HUD should reset.
        useCombatStore.getState().clearCombatSession();
        // Drop necro summons — corpses don't follow the necro into the
        // afterlife.
        useNecroSummonStore.getState().clear(PLAYER_FX_ID);
        setResult({ success: false, wavesCleared: wave, playerHpLeft: 0, gold: 0, xp: 0, items: [] });
        setResultKind('death');
        setPhase('result');
    }, [addLog]);

    // -- Helpers for multi-monster targeting ----------------------------------
    // Both attack callbacks below funnel through these so the "front of the
    // line" rule (player always swings at the first alive slot) is enforced
    // in one place. Mutates the shared HP ref + the slot-keyed React state
    // and returns the post-hit HP for the caller's death-check.
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

        // CRITICAL: update `currentMonstersRef.current` synchronously OUTSIDE
        // the setState updater. The wave-clear gate inside
        // `handleWaveMonsterDeath` reads `currentMonstersRef.current.every(
        // m => m.currentHp <= 0)` immediately after the kill — if we leave
        // the ref update inside the React updater (which can run async under
        // batched state), the check sees stale HP and the wave never
        // advances past the first kill. (Bug fix: dungeon stuck on wave 1.)
        const cur = currentMonstersRef.current;
        if (!cur[slot]) return after;
        const next = cur.slice();
        next[slot] = { ...next[slot], currentHp: after };
        currentMonstersRef.current = next;
        setCurrentMonsters(next);
        return after;
    }, []);

    // -- Manual skill use (click a slot when skillMode === 'manual') ----------
    const doManualSkill = useCallback((slotIdx: 0 | 1 | 2 | 3) => {
        if (phaseRef.current !== 'running') return;
        // Stun gate — caster cannot cast while paralysed.
        if (isCombatantStunned(effectsRef.current, PLAYER_FX_ID)) return;
        const targetSlot = getFirstAliveSlot();
        if (targetSlot < 0) return;
        const slots = useSkillStore.getState().activeSkillSlots;
        const skillId = slots[slotIdx];
        if (!skillId) return;
        const now = Date.now();
        const lastUsed = skillCooldownRef.current.get(skillId) ?? 0;
        // 2026-06-21: recast window scales with combat speed (see auto-cast note).
        if (now - lastUsed < getSpeedScaledCooldownMs(resolveSkillRecastMs(skillId, SKILL_COOLDOWN_MS), speedMult)) return;
        if (playerMpRef.current < SKILL_MP_COST) {
            addLog('Za mało MP!', 'system');
            return;
        }
        // 2026-05 v7: Apokalipsa Śmierci synchronous self-cost.
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
        // Apply v2 effects (stun/dot/aoe/instant_kill/marks/etc.) to the
        // currently-targeted monster. Enemy ids span every alive slot in
        // the wave so enemy_* effects (mark / silence / etc.) splash to
        // every active opponent in the lineup.
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
        // 2026-05 v6: classify cast affinity — see Combat.tsx / Boss.tsx.
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
        // def_pen drops monster def for this hit (Strzał Snajpera, etc.).
        const defPenFracDng = Math.max(0, Math.min(1, (apply.defPenPct ?? 0) / 100));
        // Skill-upgrade combat bonus — local player's own cast (Dungeon is
        // solo). Modest & capped.
        const skillUpgradeMultDng = getCombatSkillUpgradeMultiplier(
            useSkillStore.getState().skillUpgradeLevels[skillId] ?? 0,
        );
        const baseDmg = isDamageHit ? Math.max(
            1,
            Math.floor(charAtk * 0.15 * skillBaseMult * getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier() * (1 + defPenFracDng) * skillUpgradeMultDng),
        ) : 0;
        const normalSkillDmgDng = Math.floor(baseDmg * apply.castDmgMult);
        let skillDmg = isDamageHit
            ? (apply.instantKill
                ? Math.max(1, targetSlotData?.currentHp ?? 1)
                : ((apply.executeBurstPct ?? 0) > 0
                    ? Math.max(normalSkillDmgDng, Math.floor(targetMaxHp * (apply.executeBurstPct ?? 0) / 100))
                    : normalSkillDmgDng))
            : 0;
        // 2026-05 v7: spell hits also consume Klątwa Śmierci (count
        // mark) AND get Kraina Śmierci (duration ×N). Without this,
        // the player's basic attacks were ×2 from Kraina but their
        // spell cast (the heavy hitter) stayed at base damage.
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
        // 2026-05 v7: track total damage dealt this cast (primary +
        // splash) — Żniwa Dusz `aoe;heal_self_pct_dmg:50` heals on the
        // SUM, not just the primary. Initialised here, populated after
        // the AOE splash block lands, then consumed in the heal block
        // BELOW the splash logic.
        let totalDmgDealtThisCast = isDamageHit ? skillDmg : 0;
        // 2026-05 v6: Cleric Niebiańskie Leczenie — heal_party_pct.
        // Dungeon is solo so only the player slot. Float + skill anim.
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
        // 2026-05 v6: Cleric `heal` / `holy_nova` — heal_lowest_ally_pct.
        // Dungeon is solo so player IS the lowest ally; heals N% of
        // their max HP. Float on player slot + ally skill anim so the
        // green +HP shows up clearly (was previously silent).
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
            fx.triggerEnemySkillAnim(targetSlot, skillId);
            if (isDamageHit) {
                fx.pushEnemyFloat(targetSlot, skillDmg, 'spell', { icon: getSkillIcon(skillId) });
                showFloatingDmg(`-${skillDmg}`, 'player');
                addLog(`:sparkles: ${formatSkillName(skillId)}: ${skillDmg} dmg (-${SKILL_MP_COST} MP)`, 'player');
            } else {
                addLog(`:sparkles: ${formatSkillName(skillId)}: DEBUFF (-${SKILL_MP_COST} MP)`, 'player');
            }
            // Stun / paralyze label — per-target. AOE casts push the
            // float ONLY on the slots that actually got stunned (each
            // enemy rolls independently in the engine).
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
        // MLVL XP from skill use (all classes)
        if (character) {
            useSkillStore.getState().addMlvlXpFromSkill(character.class);
        }
        if (isDamageHit && afterSkill <= 0) {
            handleWaveMonsterDeath(targetSlot);
        }
        // Multistrike (Wielostrzał) — fire N follow-up basic attacks on
        // the same slot, ~120ms apart so they read as a quick burst.
        if (isDamageHit && (apply.multistrike ?? 0) > 0) {
            const extra = Math.max(0, Math.floor(apply.multistrike));
            for (let n = 0; n < extra; n++) {
                window.setTimeout(() => {
                    if (phaseRef.current !== 'running') return;
                    const slot = currentMonstersRef.current[targetSlot];
                    if (!slot || slot.currentHp <= 0) return;
                    const wRoll = rollWeaponDamage();
                    const followup = Math.max(1, Math.floor((charAtk + wRoll - Math.max(0, slot.monster.defense * (1 - defPenFracDng))) * getAtkDamageMultiplier() * getTransformDmgMultiplier()));
                    const after = applyDamageToSlot(targetSlot, followup);
                    fx.pushEnemyFloat(targetSlot, followup, 'basic');
                    addLog(`:bow-and-arrow:×${n + 2} ${followup} dmg`, 'player');
                    if (after <= 0) handleWaveMonsterDeath(targetSlot);
                }, 120 * (n + 1));
            }
        }
        // AOE splash — primary 100% (above), splash 75% per target.
        // Per-target instant_kill_chance roll for AOE+IK skills.
        if (isDamageHit && apply.aoe) {
            const splashDmgManual = Math.max(1, Math.floor(skillDmg * 0.75));
            const splashIkPctManual = apply.instantKillPct ?? 0;
            for (let i = 0; i < currentMonstersRef.current.length; i++) {
                if (i === targetSlot) continue;
                const slotMon = currentMonstersRef.current[i];
                if (!slotMon || slotMon.currentHp <= 0) continue;
                // AOE re-roll of instant_kill_chance — on success deals a
                // finite execute burst (12% of splash target max HP, or the
                // normal splash if bigger), NOT a full-HP one-shot.
                const splashIk = splashIkPctManual > 0 && Math.random() * 100 < splashIkPctManual;
                let splashApplied = splashIk
                    ? Math.max(splashDmgManual, Math.floor(slotMon.maxHp * 12 / 100))
                    : splashDmgManual;
                // 2026-05 v7: each splash slot consumes its own markAmp /
                // markAmpAll — Kraina marks every AOE'd enemy and the
                // splash on each one should ×2 too.
                if (!splashIk) {
                    const splashSt = ensureStatus(effectsRef.current, monsterFxId(currentWaveRef.current, i));
                    const ampSplash = consumeTargetMarkAmp(splashSt);
                    if (ampSplash.mult !== 1) {
                        splashApplied = Math.max(1, Math.floor(splashApplied * ampSplash.mult));
                    }
                }
                const splashAfter = applyDamageToSlot(i, splashApplied);
                totalDmgDealtThisCast += splashApplied;
                fx.triggerEnemySkillAnim(i, skillId);
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
        // 2026-05 v7: heal-on-cast (Void Ray, Bossa Nova, Pochłonięcie
        // Życia, Żniwa Dusz, Uderzenie Święte). Moved BELOW the splash
        // block so AOE casts heal on the TOTAL damage dealt (primary +
        // splash). Single-target casts heal off totalDmg === skillDmg.
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
        // Necro summon spawn — only when the local player is a necro.
        if (apply.summons.length > 0 && character?.class === 'Necromancer') {
            const store = useNecroSummonStore.getState();
            for (const sm of apply.summons) {
                {
                    const spawned = store.spawn(PLAYER_FX_ID, sm.type, sm.count, charAtk, charMaxHp);
                    if (spawned > 0) fx.triggerAllySummonSpawn(0, sm.type);
                }
            }
        }
        // 2026-05 v7: Apokalipsa Śmierci — target damage only (self-cost
        // already paid at top of doManualSkill).
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

    // -- Player attack callback -----------------------------------------------
    // Targets the FIRST ALIVE slot (left -> right). After each hit, if the
    // target dies, the auto-skill / overflow chain naturally retargets to
    // the next alive slot via `getFirstAliveSlot()` so a single tick can
    // chain into the next escort if the player overkills.
    const doPlayerAttack = useCallback(() => {
        if (phaseRef.current !== 'running') return;
        // Stun gate — paralysed players skip their entire swing tick.
        if (isCombatantStunned(effectsRef.current, PLAYER_FX_ID)) return;
        const initialTarget = getFirstAliveSlot();
        if (initialTarget < 0) return;

        const isDualWield = !!classesDataMap[character?.class ?? '']?.dualWield;

        // -- Helper: single hit with weapon roll, retargets each call ---------
        const doSingleHit = (hand: 'left' | 'right' | undefined, weaponRollFn: () => number, dmgPercent: number) => {
            if (phaseRef.current !== 'running') return 0;
            const slot = getFirstAliveSlot();
            if (slot < 0) return 0;
            const slotData = currentMonstersRef.current[slot];
            if (!slotData) return 0;

            const wRoll = Math.floor(weaponRollFn() * dmgPercent);
            const totalAtk = charAtk + wRoll;
            const baseDmg = Math.max(1, totalAtk - slotData.monster.defense);
            const variance = Math.floor(baseDmg * 0.2);
            const rolledDmg = Math.max(1, baseDmg - variance + Math.floor(Math.random() * (variance * 2 + 1)));
            // 2026-05 v6: consume player "next basic" buff queues so that
            // crit_buff_next / crit_next / dmg_amp_next / atk_buff actually
            // affect the swing that follows the cast.
            const playerStatus = ensureStatus(effectsRef.current, PLAYER_FX_ID);
            const mods = consumeCasterBasicHitMods(playerStatus);
            syncCasterChargeConsume(mods.consumed);
            const baseCrit = mods.forceCrit ? true : Math.random() < mods.extraCritChance;
            const critMult = baseCrit ? 2.0 : 1.0;
            const finalDmg = Math.max(1, Math.floor(rolledDmg * critMult * mods.dmgMult * getAtkDamageMultiplier() * getTransformDmgMultiplier()));

            const newMHp = applyDamageToSlot(slot, finalDmg);

            // Per-attack hit pulse (counter — increment so the keyed flash
            // overlay re-mounts and replays on every distinct hit, even when
            // dual-wield's two swings land in the same 150ms window). The
            // attack VFX class still toggles via the timeout — that's bound
            // to the player's outgoing animation duration, not the hit
            // feedback on the target card.
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
            // Anchored basic-hit float on the targeted slot. Dual-wield's
            // off-hand strike also goes through here, so each swing gets its
            // own float with the sword-hand glyph as a visual cue.
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

        // -- Execute attack(s) ------------------------------------------------
        if (isDualWield) {
            // Hit 1: left hand (mainHand, 60%)
            doSingleHit('left', rollWeaponDamage, 0.6);
            // Hit 2: right hand (offHand, 60%) – 150ms delay. The doSingleHit
            // helper internally retargets so if the first hit kills slot 0
            // the off-hand swing lands on slot 1.
            setTimeout(() => {
                if (phaseRef.current !== 'running') return;
                if (getFirstAliveSlot() < 0) return;
                doSingleHit('right', rollOffHandDamage, 0.6);
            }, 150);
        } else {
            // Normal swing — full charAtk (weapon roll already included).
            const slot = getFirstAliveSlot();
            const slotData = currentMonstersRef.current[slot];
            if (slot >= 0 && slotData) {
                const baseDmg = Math.max(1, charAtk - slotData.monster.defense);
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

        // Grant skill XP from attack (weapon skill for non-magic + MLVL for magic classes)
        if (character) {
            useSkillStore.getState().addWeaponSkillXpFromAttack(character.class);
            useSkillStore.getState().addMlvlXpFromAttack(character.class);
        }

        // Necromancer summon swing — every live summon attacks the front
        // monster slot for a fraction of the necro's attack stat. The
        // contribution is dealt as a single combined hit per tick (with a
        // dedicated log line) so the UI doesn't get spammed.
        if (character?.class === 'Necromancer') {
            const summonBonus = useNecroSummonStore.getState().totalAttackBonus(PLAYER_FX_ID, charAtk);
            const tgt = getFirstAliveSlot();
            if (summonBonus > 0 && tgt >= 0) {
                const slotMon = currentMonstersRef.current[tgt];
                if (slotMon && slotMon.currentHp > 0) {
                    let dmg = Math.max(1, summonBonus - Math.floor(slotMon.monster.defense * 0.5));
                    // 2026-05 v7: summon swings consume Klątwa Śmierci
                    // (count) AND Kraina Śmierci (duration ×N).
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

        // Auto-skill fire (check all 4 slots) – only when skill mode is AUTO.
        // Re-targets to the first alive slot every fire so an overkill chain
        // walks down the line instead of wasting damage on a dead slot.
        if (getFirstAliveSlot() >= 0 && useSettingsStore.getState().skillMode === 'auto') {
            const now = Date.now();
            const slots = useSkillStore.getState().activeSkillSlots;
            for (let i = 0; i < 4; i++) {
                const skillId = slots[i];
                if (!skillId) continue;
                const lastUsed = skillCooldownRef.current.get(skillId) ?? 0;
                // 2026-06-21: scale recast window by combat speed (x2 → 2.5s,
                // x4 → 1.25s) to match the speed-scaled cooldown bar.
                if (now - lastUsed < getSpeedScaledCooldownMs(resolveSkillRecastMs(skillId, SKILL_COOLDOWN_MS), speedMult)) continue;
                if (playerMpRef.current < SKILL_MP_COST) continue;
                const tgt = getFirstAliveSlot();
                if (tgt < 0) break;
                // Apply v2 effects (stun/dot/aoe/instant_kill/marks/etc.)
                // for the auto-fire path, mirroring doManualSkill.
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
                // 2026-05 v7: Apokalipsa Śmierci synchronous self-cost.
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
                // 2026-05 v6: same affinity classification as manual cast.
                const skillBaseMult = sDef?.damage ?? 0;
                const isDamageHitAuto = skillBaseMult > 0;
                const targetsEnemyAuto = isDamageHitAuto || skillTargetsEnemy(sDef?.effect ?? null);
                const defPenFracAuto = Math.max(0, Math.min(1, (apply.defPenPct ?? 0) / 100));
                // Skill-upgrade combat bonus — local player's own auto-cast.
                const skillUpgradeMultAuto = getCombatSkillUpgradeMultiplier(
                    useSkillStore.getState().skillUpgradeLevels[skillId] ?? 0,
                );
                const baseDmg = isDamageHitAuto ? Math.max(1, Math.floor(charAtk * 0.15 * skillBaseMult * getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier() * (1 + defPenFracAuto) * skillUpgradeMultAuto)) : 0;
                const normalSkillDmgAuto = Math.floor(baseDmg * apply.castDmgMult);
                let skillDmg = isDamageHitAuto
                    ? (apply.instantKill
                        ? Math.max(1, tgtSlotData?.currentHp ?? 1)
                        : ((apply.executeBurstPct ?? 0) > 0
                            ? Math.max(normalSkillDmgAuto, Math.floor(tgtMaxHp * (apply.executeBurstPct ?? 0) / 100))
                            : normalSkillDmgAuto))
                    : 0;
                // 2026-05 v7: auto-skill spells also consume Klątwa AND
                // get Kraina ×N — same as manual cast / basic attack.
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
                    fx.triggerEnemySkillAnim(tgt, skillId);
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
                // Multistrike — fire N follow-up basic attacks on same slot.
                if (isDamageHitAuto && (apply.multistrike ?? 0) > 0) {
                    const extra = Math.max(0, Math.floor(apply.multistrike));
                    for (let n = 0; n < extra; n++) {
                        window.setTimeout(() => {
                            if (phaseRef.current !== 'running') return;
                            const slot = currentMonstersRef.current[tgt];
                            if (!slot || slot.currentHp <= 0) return;
                            const wRoll = rollWeaponDamage();
                            const followup = Math.max(1, Math.floor((charAtk + wRoll - Math.max(0, slot.monster.defense * (1 - defPenFracAuto))) * getAtkDamageMultiplier() * getTransformDmgMultiplier()));
                            const after = applyDamageToSlot(tgt, followup);
                            fx.pushEnemyFloat(tgt, followup, 'basic');
                            addLog(`:bow-and-arrow:×${n + 2} ${followup} dmg`, 'player');
                            if (after <= 0) handleWaveMonsterDeath(tgt);
                        }, 120 * (n + 1));
                    }
                }
                // 2026-05 v7: track total dmg (primary + splash) so
                // Żniwa Dusz heals on the SUM via auto-skill too.
                let totalDmgAuto = isDamageHitAuto ? skillDmg : 0;
                // AOE splash — primary 100%, splash 75% per target +
                // per-target IK roll for AOE+IK skills.
                if (isDamageHitAuto && apply.aoe) {
                    const splashDmgAuto = Math.max(1, Math.floor(skillDmg * 0.75));
                    const splashIkPctAuto = apply.instantKillPct ?? 0;
                    for (let j = 0; j < currentMonstersRef.current.length; j++) {
                        if (j === tgt) continue;
                        const slotMon = currentMonstersRef.current[j];
                        if (!slotMon || slotMon.currentHp <= 0) continue;
                        // AOE re-roll of instant_kill_chance — finite execute
                        // burst (12% of splash target max HP) on success.
                        const splashIk = splashIkPctAuto > 0 && Math.random() * 100 < splashIkPctAuto;
                        let splashApplied = splashIk
                            ? Math.max(splashDmgAuto, Math.floor(slotMon.maxHp * 12 / 100))
                            : splashDmgAuto;
                        // 2026-05 v7: each splash consumes its own markAmp.
                        if (!splashIk) {
                            const splashStAuto = ensureStatus(effectsRef.current, monsterFxId(currentWaveRef.current, j));
                            const ampSplashAuto = consumeTargetMarkAmp(splashStAuto);
                            if (ampSplashAuto.mult !== 1) {
                                splashApplied = Math.max(1, Math.floor(splashApplied * ampSplashAuto.mult));
                            }
                        }
                        const splashAfter = applyDamageToSlot(j, splashApplied);
                        totalDmgAuto += splashApplied;
                        fx.triggerEnemySkillAnim(j, skillId);
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
                // 2026-05 v7: heal_self_pct_dmg on auto-skill — Żniwa
                // Dusz / Pochłonięcie Życia / Promień Pustki / Bossa
                // Nova heal off TOTAL damage dealt this cast.
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
                // Necro summon spawn — only when the local player is a necro.
                if (apply.summons.length > 0 && character?.class === 'Necromancer') {
                    const store = useNecroSummonStore.getState();
                    for (const sm of apply.summons) {
                        {
                    const spawned = store.spawn(PLAYER_FX_ID, sm.type, sm.count, charAtk, charMaxHp);
                    if (spawned > 0) fx.triggerAllySummonSpawn(0, sm.type);
                }
                    }
                }
                // 2026-05 v7: Apokalipsa Śmierci — target damage only.
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
                break; // One skill per attack tick
            }
        }

        // Auto-potion check
        tryAutoPotion();
    }, [charAtk, addLog, showFloatingDmg, handleWaveMonsterDeath, tryAutoPotion, character, getFirstAliveSlot, applyDamageToSlot, fx]);

    // -- Monster attack callback ----------------------------------------------
    // Processes ONE monster's swing — driven by a per-slot interval clocked at
    // that monster's individual attack speed. This is the per-attacker model
    // the player asked for: 4 escorts with different speeds = 4 independent
    // hit animations & 4 independent log lines instead of one aggregate "monsters
    // hit you" tick. Utamo Vita / auto-potion / death check still run per call
    // because each is a per-hit reaction, not a per-tick batch.
    const doMonsterAttack = useCallback((attackerSlot: number) => {
        if (phaseRef.current !== 'running') return;
        const slotData = currentMonstersRef.current[attackerSlot];
        if (!slotData || slotData.currentHp <= 0) return;
        // Stun gate — paralysed monsters skip their swing tick. Each monster
        // has its own status keyed by `monster_${wave}_${slot}` so stunning
        // slot 0 doesn't silence slots 1..3.
        if (isCombatantStunned(effectsRef.current, monsterFxId(currentWaveRef.current, attackerSlot))) return;
        // 2026-05 v6: Krok Cienia / Unik charge buff — burns one charge
        // per non-magic enemy hit, skips the swing entirely.
        if (useBuffStore.getState().getBuffCharges('skill_charge_dodge_next') > 0) {
            useBuffStore.getState().consumeBuffCharge('skill_charge_dodge_next');
            addLog(`${slotData.monster.name_pl} atakuje – Krok Cienia! Unik!`, 'dodge');
            return;
        }
        // 2026-05 v6: Cleric Boska Tarcza — block_next_party charge.
        // Stacks up to 2; consumed per incoming basic monster hit, eats
        // the entire hit.
        if (useBuffStore.getState().getBuffCharges('skill_charge_block_next_party') > 0) {
            useBuffStore.getState().consumeBuffCharge('skill_charge_block_next_party');
            fx.pushAllyFloat(0, 0, 'heal', { icon: 'shield', label: 'BLOCK' });
            addLog(`:shield: Boska Tarcza! Blok!`, 'system');
            return;
        }
        // 2026-05 v6: Rogue Bomba Dymna (dodge_buff:50:4000) — % chance
        // to fully dodge each incoming basic during the buff window.
        const dngPlayerSt = ensureStatus(effectsRef.current, PLAYER_FX_ID);
        if (dngPlayerSt.dodgeBuffMs > 0 && dngPlayerSt.dodgeBuffPct > 0) {
            if (Math.random() * 100 < dngPlayerSt.dodgeBuffPct) {
                fx.pushAllyFloat(0, 0, 'heal', { icon: 'dashing-away', label: 'UNIK' });
                addLog(`:dashing-away: Bomba Dymna! Unik (${dngPlayerSt.dodgeBuffPct}%)`, 'system');
                return;
            }
        }

        // 2026-05 v6: defBuffPct (Knight Umocnienie / Żelazna Obrona)
        // bumps player def for the buff window. Engine wrote it but
        // never read it on incoming damage — fixed here.
        const psDng = effectsRef.current.statuses.get(PLAYER_FX_ID);
        const dngDefMult = (psDng && psDng.defBuffMs > 0 && psDng.defBuffPct > 0)
            ? 1 + (psDng.defBuffPct / 100) : 1;
        const effPlayerDef = Math.floor(charDef * dngDefMult);

        // immortal — Knight Absolutne Cięcie zeroes incoming damage.
        if (psDng && psDng.immortalMs > 0) {
            fx.pushAllyFloat(0, 0, 'heal', { icon: 'sparkles', label: 'BLOCK' });
            addLog(`:sparkles: BLOCK! Niewrażliwość chroni przed ${slotData.monster.name_pl}`, 'block');
            return;
        }

        const mAtk = rollMonsterDamage(slotData.monster);
        const rawDmg = Math.max(1, mAtk - effPlayerDef);

        let hpDmg = rawDmg;
        let mpDmg = 0;
        // 2026-05 v6: Mage Tarcza Many — 100% MP redirect (self only).
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
        // -- Utamo Vita (Magic Shield): 50% of remaining -> MP ----------
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

        // Necromancer summon shield — front-of-queue summon eats single-target
        // hits before the necro's HP pool. AOE branches don't exist here
        // (dungeon monsters all swing single-target), so `damageFirst` is
        // the only path required.
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

        // Pulse counter — increment so AllyCard's keyed flash overlay re-mounts
        // and replays from frame 0. Without this, two near-simultaneous hits
        // from different monsters would visually merge into a single shake.
        setPlayerHitPulse((p) => p + 1);
        showFloatingDmg(`-${rawDmg}${hasUtamoDng && mpDmg > 0 ? 'blue-circle' : ''}`, 'monster');
        // Anchored monster-attack float on the player ally slot (0). Plain
        // physical hit -> 'monster' kind (red). The Utamo Vita :blue-circle: marker is
        // dropped here on purpose — the float colour already says "I got
        // hit" and the marker would just clutter the number; the addLog
        // line below still records the MP-shield split for the log reader.
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

    // -- Refs for stable intervals --------------------------------------------
    const playerAtkRef  = useRef(doPlayerAttack);
    const monsterAtkRef = useRef(doMonsterAttack);
    useEffect(() => { playerAtkRef.current  = doPlayerAttack; });
    useEffect(() => { monsterAtkRef.current = doMonsterAttack; });

    // -- Attack intervals (scaled by speedMult) -------------------------------
    // Player interval resets when the wave's lead monster id changes (fresh
    // wave spawns). Per-slot kills don't restart the timer — kills are
    // processed inside the callback via `handleWaveMonsterDeath`.
    const waveLeadId = currentMonsters[0]?.monster.id ?? null;
    useEffect(() => {
        if (phase !== 'running' || !waveLeadId) return;
        const interval = Math.max(200, getAttackMs(charSpeed) / speedMult);
        const id = setInterval(() => playerAtkRef.current(), interval);
        return () => clearInterval(id);
    }, [phase, waveLeadId, charSpeed, speedMult]); // eslint-disable-line react-hooks/exhaustive-deps

    // Per-monster intervals: every alive escort gets ITS OWN setInterval ticking
    // at its individual `monster.speed`. This is what gives each mob its own
    // independent hit animation when the player is solo-tanking 4 monsters with
    // different attack speeds — each one swings on its own timer instead of all
    // four firing on a single shared 2s tick. Effect re-runs when the wave
    // composition changes (new wave spawns / monster slot removed) — `wavePulse`
    // is bumped from the wave-spawn handler so we don't try to use stale
    // currentMonsters identities. Kills DON'T restart timers (the callback
    // bails out early via the `currentHp <= 0` guard) so a freshly-revealed
    // mob doesn't get a free swing on death of its neighbour.
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
    }, [phase, monsterSlotKey, speedMult]); // eslint-disable-line react-hooks/exhaustive-deps

    // Status / DOT tick — drains stun timers + applies DOT damage to every
    // alive combatant on a separate cadence (every 250 ms scaled by speed)
    // so paralysed combatants recover in real-time and DOTs deal their
    // per-second slice consistently. Wave-clear leaves dead monsters'
    // statuses in the map; they're filtered out here via maxHp lookup.
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
                        // 2026-05 v6: per-tick DOT visual on the affected slot.
                        fx.pushEnemyFloat(m.slot, apply.appliedDmg, 'spell', { icon: 'skull-and-crossbones' });
                        if (after <= 0) {
                            handleWaveMonsterDeath(m.slot);
                            continue;
                        }
                    }
                }
                // 2026-05 v7: Mroczny Rytuał detonation. % of monster max
                // HP, no DEF mit. Re-read currentHp because the DOT branch
                // above may have shifted it.
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
    }, [phase, speedMult, charMaxHp, monsterSlotKey, applyDamageToSlot, handlePlayerDeath, handleWaveMonsterDeath]); // eslint-disable-line react-hooks/exhaustive-deps

    // -- Spawn-bar progress driver (rAF) --------------------------------------
    // While `waitingForSpawn` is true, fill `spawnProgress` 0->1 over the
    // duration captured when the wave-clear handler armed the timeout.
    // We restart the loop fresh on every transition so toggling speed mid
    // countdown re-syncs the bar to the new (already-shortened) timeout.
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

    // Reset the spawn bar when the player leaves the running phase (flee /
    // death / completion). The setTimeout in the wave-clear handler is
    // best-effort and might still resolve in the background; this cleanup
    // guarantees the bar disappears the moment the phase flips.
    useEffect(() => {
        if (phase !== 'running') {
            setWaitingForSpawn(false);
            setSpawnProgress(0);
        }
    }, [phase]);

    const totalWaves = activeDungeon ? getDungeonWaves(activeDungeon) : 0;
    // isBossWave computed inline where needed (inside wave completion handler)

    // Dungeon render guard (after-hooks) — see note up near the eqStats block.
    // Placed AFTER every hook in this component so we never alter hook call
    // order between renders. Character starts null on the first render after
    // a `goto('/dungeon')` (App.tsx re-hydrates async via switchToCharacter)
    // and the React Rules of Hooks detector would crash the tree if we
    // returned early before all `useEffect`s registered.
    if (!character) return <div className="dungeon"><Spinner size="lg" /></div>;

    return (
        <div className="dungeon">
            <AnimatePresence mode="wait">

                {/* -- List -------------------------------------------------------- */}
                {phase === 'list' && (() => {
                    // Apply the three persisted filters before rendering the
                    // list. Sorting happens last so the visible order always
                    // respects the player's choice. Defaults yield the
                    // unfiltered, ascending data order — i.e. behaves exactly
                    // like the pre-filter view for new players.
                    const gateLvlForFilter = getPartyGateLevel(character.level, party?.members ?? null);
                    let visibleDungeons = allDungeons.slice();
                    if (dungeonFilterMinLevel > 0) {
                        visibleDungeons = visibleDungeons.filter(
                            (d) => getDungeonMinLevel(d) >= dungeonFilterMinLevel,
                        );
                    }
                    if (dungeonFilterAvailableOnly) {
                        // "Available" = player meets the level gate AND has
                        // attempts left. Everything else (locked, exhausted)
                        // is hidden from the list.
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
                        {/* Persistent filter bar — same visual / interaction
                            shape as the Hunt-Hub filter strip (pill toggles
                            then a numeric input then an optional Wyczyść)
                            so the two listing screens feel like siblings.
                            Saved per character via settingsStore /
                            characterScope plumbing. */}
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
                            // Gate by the lowest human level in the party — the
                            // weakest member dictates what content the group can
                            // enter. Solo players keep their own level.
                            const gateLevel    = getPartyGateLevel(character.level, party?.members ?? null);
                            const tooLow       = gateLevel < getDungeonMinLevel(d);
                            const blocked      = noAttempts || tooLow;

                            const dungeonLvl = getDungeonMinLevel(d);
                            const allDone = attemptsUsed >= attemptsMax;
                            // Persistent "ever beat this dungeon" flag —
                            // separate from `allDone` (daily reset). Drives
                            // the "Pokonany" stamp at the top of the card.
                            const cleared = isDungeonCleared(d.id);
                            const est = estimateDungeonRewards(d, allMonsters, monstersRaw);

                            return (
                                <div
                                    key={d.id}
                                    className={`dungeon__card${blocked ? ' dungeon__card--blocked' : ''}${allDone ? ' dungeon__card--all-done' : ''}`}
                                    style={{
                                        '--card-hue': getDungeonCardHue(dungeonLvl),
                                        // Per-dungeon background art. The ID
                                        // -> image map in spriteAssets is
                                        // stable across filter / sort, so a
                                        // given dungeon always shows the
                                        // same picture. Falls back to `none`
                                        // when art is missing — the hue
                                        // gradient layers still carry the
                                        // card's visual identity.
                                        '--card-image': (() => {
                                            const url = getDungeonImage(d.id);
                                            return url ? `url("${url}")` : 'none';
                                        })(),
                                    } as React.CSSProperties}
                                >
                                    {/* Corner badges — required level top-left,
                                        wave count top-right. Pinned absolute so
                                        the centred head can claim the full card
                                        width without fighting these for space. */}
                                    <span className="dungeon__corner dungeon__corner--lvl">
                                        Lvl {dungeonLvl}
                                    </span>
                                    <span className="dungeon__corner dungeon__corner--waves">
                                        {getDungeonWaves(d)} fal
                                    </span>

                                    {/* "Pokonany" stamp — only when the player
                                        is locked out for the day (5/5 daily
                                        attempts used) AND has actually cleared
                                        the dungeon. `allDone` alone implies a
                                        prior clear under the current data
                                        model (attempts only increment on
                                        victory), but we keep `cleared` in the
                                        condition as belt-and-suspenders so the
                                        badge stays truthful if the attempts
                                        rule ever changes. Centered between
                                        the lvl and waves corners. */}
                                    {allDone && cleared && (
                                        <span className="dungeon__corner dungeon__corner--cleared">
                                            <GameIcon name="check-mark-button" /> Pokonany
                                        </span>
                                    )}

                                    {/* Centred head — icon, name and the flavour
                                        description in a max-width block so long
                                        names wrap nicely on every screen and
                                        the card has a clear "title page" feel. */}
                                    <div className="dungeon__card-head">
                                        <h3 className="dungeon__card-name">{d.name_pl}</h3>
                                        <p className="dungeon__card-desc">{d.description_pl}</p>
                                    </div>

                                    {/* Quick reward summary — the level / wave
                                        info already lives in the corners, so the
                                        meta row is reduced to gold + XP. */}
                                    <div className="dungeon__card-rewards">
                                        <span><GameIcon name="money-bag" /> {formatGoldShort(est.goldMin)}–{formatGoldShort(est.goldMax)}</span>
                                        <span><GameIcon name="star" /> ~{est.xp.toLocaleString('pl-PL')} XP</span>
                                    </div>

                                    {/* Drop table is now a popup — opens the
                                        modal at the bottom of the panel. */}
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

                        {/* Drop-table modal — single instance lives outside the
                            .map() so only one popup is mounted at a time.
                            Backdrop click & explicit :multiply: both dismiss. */}
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

                {/* -- Running (real combat) — unified shared CombatUI tree -----
                    Same JSX family used by hunting/boss/transform/raid/trainer.
                    Dungeon-specific shape:
                      - 1–4 monsters in slots 0..3 (composition per wave)
                      - 1 player in slot 0, 3 empty ally slots (no party bots)
                      - bgVariant="default" (daily-boss reserved for Boss view)
                      - Exit = `kind: 'flee'` with the standard 1/10 death penalty
                ------------------------------------------------------------- */}
                {phase === 'running' && activeDungeon && currentMonsters.length > 0 && (() => {
                    // -- Enemy slots (left column, 4 fixed) -------------------
                    // Walk the wave's spawned monsters into 4 fixed slots,
                    // padding empties with `null`. The player always targets
                    // the first alive slot (left -> right) so we mark only
                    // that one as `isTargetedByPlayer` for the highlight.
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
                            // Per-attack pulse counter — every distinct hit increments
                            // it so EnemyCard's keyed flash overlay re-mounts and the
                            // CSS animation replays from frame 0. Solves the "rapid
                            // hits visually merge into one shake" problem when the
                            // player's auto-attack and an auto-skill land within the
                            // same 300ms window.
                            hitPulse: monsterHitPulses[m.slot] ?? 0,
                            attackingClassName: playerAttackingSlot === m.slot
                                ? `attack-${character.class}`
                                : null,
                            // Per-slot VFX from useCombatFx — themed skill
                            // overlay + floating damage stack. EnemyCard
                            // renders both internally; we just pass the
                            // current snapshot for this monster's slot.
                            skillAnim: fx.enemySkill[m.slot] ?? null,
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

                    // -- Player accent for transform-tinted HUD chrome --------
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

                    // -- Ally slots (right column) — Dungeon is solo ----------
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
                            // Aggro pip count = number of alive monsters
                            // currently hostile to the player. Drives the
                            // shared HUD's "you have N attackers" badge.
                            aggroCount: aliveCount,
                            // Per-attacker pulse counter — bumped on every monster
                            // swing so the player's flash overlay re-mounts even
                            // when 4 monsters with different attack speeds land
                            // hits inside the same 300ms window.
                            hitPulse: playerHitPulse,
                            // Attacker-side animation removed — slash/spell visual
                            // lives on the target enemy card only (see uiEnemies).
                            attackingClassName: null,
                            // Per-slot VFX for the player ally — monster-attack
                            // floats land here (red); future heal floats
                            // (`kind: 'heal'`) too.
                            skillAnim: fx.allySkill[0] ?? null,
                            floats: fx.allyFloats[0] ?? [],
                            summonSpawn: fx.allySummonSpawn[0] ?? null,
                        },
                        null, null, null,
                    ];

                    // -- Skill slots (action-bar) -----------------------------
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

                    // -- Potion slots (action-bar = pct, sub-controls = flat) -
                    // Type the `potion` param as the widest of the four sources
                    // (`bestPctHpPotion` is `IElixir | null` — flat helpers
                    // never return null, so they fit in here too).
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
                            // 2026-05: pass the actual potion's PNG art to the dock.
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

                                    {/* Spawn-timer bar — visible only between
                                        waves while the next monster is about
                                        to appear. Shares the slim fixed-top
                                        visual with the hunting auto-fight bar
                                        so the player learns one cue: thin bar
                                        under the header = "next monster
                                        incoming". Speed-scaled in the
                                        wave-clear handler so x2/x4 collapses
                                        the wait too. */}
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

                                    {/* Wave banner — sits BELOW the top-controls
                                        chip cluster and ABOVE the arena so it's
                                        always visible during the fight without
                                        crowding the page header. Shared visual
                                        with Transform/Raid via the unified
                                        `combat-ui__wave-banner` class. */}
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
                                                // applies XP loss but never strips a
                                                // level and never touches equipment.
                                                // Flag the leave-guard as already-applied
                                                // so unmounting after this flee doesn't
                                                // upgrade the soft penalty to a real death.
                                                leavePenaltyAppliedRef.current = true;
                                                const ch = useCharacterStore.getState().character;
                                                if (ch && ch.level > 1) {
                                                    // 2026-05-19 v25 spec: log flee to the
                                                    // global deaths feed so the /deaths view
                                                    // renders "<dungeon> przegnał <player>"
                                                    // (verb driven by `result: 'fled'`).
                                                    const dungeonForLog = activeDungeonRef.current;
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
                                                    // Unified protection (2026-06-21): ONE
                                                    // protection item shields the flee penalty
                                                    // entirely (no level, no xp, no skill xp).
                                                    // Flee NEVER loses items either way.
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
                                                        // 2026-05-14 spec ("Jezeli sojusznik
                                                        // ucieknie z bossa lub dungeona ...
                                                        // powinien wyskoczyc mu popup ze
                                                        // udalo Ci sie uciec"): flee overlay
                                                        // (kind: 'flee') with the penalty —
                                                        // same pattern boss + raid use now.
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
                                                // Persist current HP/MP — fleeing keeps your wounds
                                                // (matches death/win persistence policy: combat outcomes
                                                // never silently top you off).
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

                {/* -- Result ------------------------------------------------------ */}
                {phase === 'result' && result && activeDungeon && (
                    // `--centered` modifier vertically centres the result
                    // card in the visible viewport (header + bottom nav
                    // subtracted) so the celebration screen sits in the
                    // middle of the screen instead of crammed under the
                    // header with empty space below.
                    <motion.div key="result" className="dungeon__panel dungeon__panel--centered"
                        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                        <div
                            className={`dungeon__result${result.success ? ' dungeon__result--win' : ' dungeon__result--loss'}`}
                            style={{
                                '--card-hue': getDungeonCardHue(getDungeonMinLevel(activeDungeon)),
                                // Same per-dungeon art as the lobby card. The
                                // result screen is the celebration view, so we
                                // keep the image visible and let the reward
                                // rows / banner sit on top with their own
                                // backgrounds for legibility.
                                '--card-image': (() => {
                                    const url = getDungeonImage(activeDungeon.id);
                                    return url ? `url("${url}")` : 'none';
                                })(),
                            } as React.CSSProperties}
                        >
                            {/* Win view starts with a shimmering gradient banner
                                that shouts the dungeon name back at the player —
                                the celebration framing the run earned. The
                                shimmer animation lives in SCSS via ::before. */}
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

                            {/* Result actions — single CTA. Win -> green "Odbierz"
                                (celebratory claim-the-spoils beat; items
                                already landed in the inventory). Flee -> red
                                "Uciekaj" so the panel doesn't visually
                                celebrate a bail-out. Death -> red "Wróć" so
                                the loss state stays consistent and never
                                tempts the player into thinking there's loot
                                to claim. */}
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
                                        {/* Spec 4 (2026-05): "Walcz ponownie" button when the
                                            same dungeon still has attempts left for the day —
                                            saves the player a trip back to the list to start
                                            another run. */}
                                        {activeDungeon && canEnter(activeDungeon.id) && (
                                            <button
                                                className="dungeon__back-btn dungeon__back-btn--again"
                                                onClick={() => handleStart(activeDungeon)}
                                            >
                                                <GameIcon name="crossed-swords" /> Walcz ponownie
                                            </button>
                                        )}
                                        {/* 2026-05 v6: when this dungeon's daily attempts
                                            are spent, jump to the next higher-level dungeon
                                            within reach (level <= char.level) that still has
                                            attempts available. */}
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

            {/* Tile-zoom entry overlay — a fixed-position, full-screen
                framer panel that morphs from the clicked card's bounding
                box into the viewport, then crossfades out once the
                running phase has mounted underneath. Lives outside the
                phase-switching AnimatePresence (which uses mode="wait")
                so it can stay on top during the brief
                list->running swap and hide any visual flash. */}
            {/* -- Cinematic entry sequence (2.0s) -------------------------
                Three stacked motion layers, all sharing the same total
                duration so we can keep the timing readable in one place.

                Layer 1 — IMAGE: morphs from the clicked card's bounding
                box up to fullscreen + a touch past (scale 1.06) for that
                "we're being pulled in" feel. Holds at fullscreen, then
                fades out at the very end so the reveal lands on the
                combat HUD underneath rather than on the dungeon image.

                Layer 2 — DARKNESS: a flat black panel that fades 0 -> 1 in
                lockstep with the image zoom, holds black through the mid
                of the animation, then fades 1 -> 0 to reveal whatever
                mounted underneath (combat HUD, mounted at 2.4s).

                Layer 3 — SKIP HINT: tiny "kliknij aby pominąć" label
                that fades in once the screen is dark enough to read it,
                stays visible during the hold, then fades out with the
                rest of the overlay. Pure UX-affordance — the whole
                overlay is the click target, not just the hint.

                The wrapper itself owns the click -> skip handler and
                takes pointer events so the player can interrupt at any
                point during the cinematic. */}
            <AnimatePresence>
                {enterAnim && (
                    <motion.div
                        key={`enter-${enterAnim.dungeonId}`}
                        className="dungeon__enter-overlay"
                        onClick={skipEntryAnimation}
                        initial={{ opacity: 1 }}
                        animate={{ opacity: 1 }}
                        // Fast exit on skip / formal completion — combat is
                        // already mounted underneath, no need to linger.
                        exit={{ opacity: 0, transition: { duration: 0.18, ease: 'linear' } }}
                    >
                        {/* Layer 1 — dungeon image, card -> fullscreen + soft zoom */}
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
                                // 4 keyframes to match the `times` array below:
                                // hold full opacity through the zoom-in, then
                                // crossfade to 0 just before the darkness panel
                                // peaks so the eventual reveal lands on combat.
                                opacity: [1, 1, 0, 0],
                            }}
                            transition={{
                                // Faster card->fullscreen morph — gets the
                                // image filling the viewport just before the
                                // darkness panel hits peak opacity at 0.66s,
                                // so the geometry is settled by the time the
                                // screen reads as fully black. Compressed
                                // proportionally with the 2s total.
                                top:          { duration: 0.66, ease: [0.22, 0.61, 0.36, 1] },
                                left:         { duration: 0.66, ease: [0.22, 0.61, 0.36, 1] },
                                width:        { duration: 0.66, ease: [0.22, 0.61, 0.36, 1] },
                                height:       { duration: 0.66, ease: [0.22, 0.61, 0.36, 1] },
                                borderRadius: { duration: 0.66, ease: [0.22, 0.61, 0.36, 1] },
                                // Slow continuous zoom past fullscreen — only
                                // visible up to ~36% (when the image fades
                                // out) but cheap to keep running through the
                                // hold so any partial visibility on slower
                                // devices still feels alive instead of frozen.
                                scale:        { duration: 2.0, ease: 'linear' },
                                // Image must be GONE before the darkness
                                // starts to lift (>67%) — otherwise the reveal
                                // would show the still-frame dungeon image
                                // instead of the combat HUD that mounted
                                // underneath at 67% (1.34s). We hold full
                                // opacity until 30% (image dominates the
                                // zoom-in), then crossfade to 0 over the
                                // 30->36% window (~0.12s) which lines up with
                                // the darkness panel hitting peak black at 33%.
                                opacity:      { duration: 2.0, times: [0, 0.3, 0.36, 1], ease: 'linear' },
                            }}
                            style={{
                                '--card-hue': enterAnim.hue,
                                '--card-image': enterAnim.image
                                    ? `url("${enterAnim.image}")`
                                    : 'none',
                            } as React.CSSProperties}
                        />

                        {/* Layer 2 — darkness fade 0 -> 1 -> 1 -> 0
                            Compressed to the new 2s total. The screen reaches
                            FULL black at 33% (≈0.66s) and holds. The combat
                            HUD mounts at 67% / 1.34s (under the still-opaque
                            panel) so the reveal from 67%->100% (1.34s->2s)
                            crossfades the player straight into the live arena
                            instead of the dungeon image. */}
                        <motion.div
                            className="dungeon__enter-darkness"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: [0, 1, 1, 0] }}
                            transition={{
                                duration: 2.0,
                                // 0s clear -> 0.66s full black -> 1.34s still
                                // black (combat mounts here) -> 2.0s fully
                                // transparent.
                                times: [0, 0.33, 0.67, 1],
                                ease: 'easeInOut',
                            }}
                        />

                        {/* Layer 3 — skip affordance */}
                        <motion.div
                            className="dungeon__enter-skip-hint"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: [0, 0, 1, 1, 0, 0] }}
                            transition={{
                                duration: 2.0,
                                // Hint surfaces only during the dark hold —
                                // visible at 35% (just after peak black at
                                // 33%), fades out by 67% so it's gone the
                                // moment the reveal starts. Final 0 keyframe
                                // holds through to t=1 so framer keeps the
                                // hint hidden during the combat reveal.
                                // Relative `times` are unchanged — they scale
                                // automatically with the new 2s duration.
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
