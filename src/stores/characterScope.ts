/**
 * Character-scoped storage – saves/loads per-character state for all persisted stores.
 *
 * Primary storage: Supabase `game_saves` table (character_id → state JSONB).
 * Fallback: localStorage (offline mode or when Supabase is unreachable).
 *
 * All 12 stores are serialised into ONE JSON blob per character.
 *
 * AUTO-SAVE: Every store change is automatically persisted to localStorage
 * via Zustand subscribe() with a short debounce. This ensures data survives
 * page refresh even if beforeunload doesn't fire (common on mobile).
 */

import { useCharacterStore } from './characterStore';
import { useInventoryStore } from './inventoryStore';
import { useSkillStore } from './skillStore';
import { useTaskStore } from './taskStore';
import { useQuestStore } from './questStore';
import { useBossStore } from './bossStore';
import { useDungeonStore } from './dungeonStore';
import { usePartyStore } from './partyStore';
import { useSettingsStore } from './settingsStore';
import { useDailyQuestStore } from './dailyQuestStore';
import { useMasteryStore } from './masteryStore';
import { useBossScoreStore } from './bossScoreStore';
import { useBuffStore } from './buffStore';
import { useTransformStore } from './transformStore';
import { useCombatStore } from './combatStore';
import { useOfflineHuntStore } from './offlineHuntStore';
import { useFriendsStore } from './friendsStore';
import { EMPTY_EQUIPMENT } from '../systems/itemSystem';
import { saveGame, loadGame, deleteGameSave } from '../storage/gameStorage';
import { characterApi } from '../api/v1/characterApi';
import { supabase } from '../lib/supabase';

// ── Active character tracker ────────────────────────────────────────────────

let _activeCharacterId: string | null = null;
const ACTIVE_CHAR_KEY = 'tibia_active_character_id';

/**
 * Per-tab session token. Used to prevent cross-tab data bleed when
 * multiple characters are open simultaneously in separate browser tabs.
 * Each tab writes its own session key so auto-save from one tab never
 * overwrites data belonging to a different tab's character.
 */
const TAB_SESSION_ID = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Per-tab lock system: each tab registers which character it owns in localStorage.
 * Key: `tibia_tab_lock_{charId}` → value: TAB_SESSION_ID
 * Before writing, a tab checks if it still owns the lock for that character.
 * This prevents Tab A (char X) from overwriting char Y's data after Tab B
 * switched to char Y and took ownership.
 */
const TAB_LOCK_PREFIX = 'tibia_tab_lock_';
const TAB_LOCK_EXPIRY_MS = 30_000; // Lock expires after 30s without refresh

/** Claim ownership of a character for this tab. Releases previous lock. */
const claimTabLock = (charId: string): void => {
  // Release any previous lock held by this tab
  releaseTabLock();
  const lockData = JSON.stringify({ tabId: TAB_SESSION_ID, ts: Date.now() });
  try {
    localStorage.setItem(`${TAB_LOCK_PREFIX}${charId}`, lockData);
  } catch { /* storage full */ }
};

/** Release the tab lock for the current character. */
const releaseTabLock = (): void => {
  // Scan for any lock belonging to this tab and remove it
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(TAB_LOCK_PREFIX)) {
      try {
        const data = JSON.parse(localStorage.getItem(key) ?? '{}');
        if (data.tabId === TAB_SESSION_ID) {
          localStorage.removeItem(key);
        }
      } catch { /* ignore corrupt */ }
    }
  }
};

/** Refresh the tab lock timestamp (called by auto-save to keep lock alive). */
const refreshTabLock = (charId: string): void => {
  try {
    const key = `${TAB_LOCK_PREFIX}${charId}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.tabId === TAB_SESSION_ID) {
        data.ts = Date.now();
        localStorage.setItem(key, JSON.stringify(data));
      }
    }
  } catch { /* ignore */ }
};

/**
 * Check if this tab currently owns the lock for the given character.
 * Returns false if another tab has claimed it (or lock is missing).
 */
const thisTabOwnsLock = (charId: string): boolean => {
  try {
    const raw = localStorage.getItem(`${TAB_LOCK_PREFIX}${charId}`);
    if (!raw) return false;
    const data = JSON.parse(raw);
    // If lock belongs to us, we own it
    if (data.tabId === TAB_SESSION_ID) return true;
    // If lock belongs to another tab but is expired (>30s), we can steal it
    if (Date.now() - (data.ts ?? 0) > TAB_LOCK_EXPIRY_MS) return false; // Expired = no owner
    return false; // Another tab owns it and lock is fresh
  } catch {
    return false;
  }
};

// Release tab lock on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    releaseTabLock();
  });
}

/**
 * Tracks whether a character switch is currently in progress.
 * While true, ALL auto-save operations are blocked to prevent
 * writing partial/mixed state from old + new character.
 */
let _switchInProgress = false;

// ── Auto-save debounce state ────────────────────────────────────────────────

let _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
/** How often (ms) to flush all store state to localStorage after a change. */
const AUTO_SAVE_DEBOUNCE_MS = 500;
/** Track whether auto-save subscriptions are active. */
let _subscriptionsActive = false;
/** Unsubscribe functions for all store subscriptions. */
let _unsubscribers: Array<() => void> = [];

/**
 * Returns the active character ID for THIS tab.
 * NEVER falls back to localStorage to prevent cross-tab data bleed.
 * The localStorage fallback is only used during initial page load
 * (via getActiveCharacterIdForRestore) before switchToCharacter runs.
 */
export const getActiveCharacterId = (): string | null => _activeCharacterId;

/**
 * Used ONLY during initial page load to restore the last-used character.
 * Falls back to localStorage for the persisted character ID.
 */
export const getActiveCharacterIdForRestore = (): string | null =>
  _activeCharacterId ?? localStorage.getItem(ACTIVE_CHAR_KEY);

// ── Store definitions: base key + how to get/set pure state ─────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
interface IStoreEntry {
  baseKey: string;
  getState: () => any;
  setState: (data: any) => void;
  defaults: () => Record<string, unknown>;
  /** keys to persist (data only, not functions) */
  stateKeys: string[];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const STORE_ENTRIES: IStoreEntry[] = [
  {
    baseKey: 'inventory',
    getState: () => useInventoryStore.getState(),
    setState: (d) => useInventoryStore.setState(d),
    defaults: () => ({ bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [], gold: 0, consumables: {}, stones: {} }),
    stateKeys: ['bag', 'equipment', 'deposit', 'gold', 'consumables', 'stones'],
  },
  {
    baseKey: 'skills',
    getState: () => useSkillStore.getState(),
    setState: (d) => useSkillStore.setState(d),
    defaults: () => ({
      skillLevels: {}, skillXp: {}, skillUpgradeLevels: {}, unlockedSkills: {},
      activeSkillSlots: [null, null, null, null],
      offlineTrainingSkillId: null, trainingSegmentStartedAt: null,
      trainingAccumulatedEffectiveSeconds: 0,
    }),
    stateKeys: [
      'skillLevels', 'skillXp', 'skillUpgradeLevels', 'unlockedSkills', 'activeSkillSlots',
      'offlineTrainingSkillId', 'trainingSegmentStartedAt',
      'trainingAccumulatedEffectiveSeconds',
      // NOTE: trainingCurrentSpeedMultiplier is NOT persisted — it's runtime state
      // determined by useActivityTracker (2x when active, 1x after 10min inactivity)
    ],
  },
  {
    baseKey: 'tasks',
    getState: () => useTaskStore.getState(),
    setState: (d) => useTaskStore.setState(d),
    defaults: () => ({ activeTask: null, activeTasks: [], completedTasks: [] }),
    stateKeys: ['activeTask', 'activeTasks', 'completedTasks'],
  },
  {
    baseKey: 'quests',
    getState: () => useQuestStore.getState(),
    setState: (d) => useQuestStore.setState(d),
    defaults: () => ({ activeQuests: [], completedQuestIds: [] }),
    stateKeys: ['activeQuests', 'completedQuestIds'],
  },
  {
    baseKey: 'bosses',
    getState: () => useBossStore.getState(),
    setState: (d) => useBossStore.setState(d),
    defaults: () => ({ dailyAttempts: {}, lastResult: null }),
    stateKeys: ['dailyAttempts', 'lastResult'],
  },
  {
    baseKey: 'dungeons',
    getState: () => useDungeonStore.getState(),
    setState: (d) => useDungeonStore.setState(d),
    defaults: () => ({ dailyAttempts: {}, lastResult: null }),
    stateKeys: ['dailyAttempts', 'lastResult'],
  },
  // Party state is server-synced via `partyApi` + Supabase Realtime now, so
  // there's no per-character localStorage slice. The store still exists for
  // the live Zustand state, but we skip persistence to avoid stale rehydrates.
  {
    baseKey: 'settings',
    getState: () => useSettingsStore.getState(),
    setState: (d) => useSettingsStore.setState(d),
    defaults: () => ({
      language: 'pl', combatSpeed: 'x1', skillMode: 'auto',
      autoPotionHpEnabled: true, autoPotionMpEnabled: true,
      autoPotionHpThreshold: 50, autoPotionMpThreshold: 50,
      autoPotionHpId: 'hp_potion_sm', autoPotionMpId: 'mp_potion_sm',
      autoPotionPctHpEnabled: false, autoPotionPctMpEnabled: false,
      autoPotionPctHpThreshold: 40, autoPotionPctMpThreshold: 40,
      autoPotionPctHpId: 'hp_potion_great', autoPotionPctMpId: 'mp_potion_great',
      showCombatXpBar: true,
      autoSellCommon: false, autoSellRare: false, autoSellEpic: false, autoSellLegendary: false, autoSellMythic: false,
    }),
    stateKeys: [
      'language', 'combatSpeed', 'skillMode',
      'autoPotionHpEnabled', 'autoPotionMpEnabled',
      'autoPotionHpThreshold', 'autoPotionMpThreshold',
      'autoPotionHpId', 'autoPotionMpId',
      'autoPotionPctHpEnabled', 'autoPotionPctMpEnabled',
      'autoPotionPctHpThreshold', 'autoPotionPctMpThreshold',
      'autoPotionPctHpId', 'autoPotionPctMpId',
      'showCombatXpBar',
      'autoSellCommon', 'autoSellRare', 'autoSellEpic', 'autoSellLegendary', 'autoSellMythic',
    ],
  },
  {
    baseKey: 'dailyQuests',
    getState: () => useDailyQuestStore.getState(),
    setState: (d) => useDailyQuestStore.setState(d),
    defaults: () => ({ lastRefreshDate: null, activeQuests: [], todayQuestDefs: [] }),
    stateKeys: ['lastRefreshDate', 'activeQuests', 'todayQuestDefs'],
  },
  {
    baseKey: 'mastery',
    getState: () => useMasteryStore.getState(),
    setState: (d) => useMasteryStore.setState(d),
    defaults: () => ({ masteries: {}, masteryKills: {} }),
    stateKeys: ['masteries', 'masteryKills'],
  },
  {
    baseKey: 'bossScore',
    getState: () => useBossScoreStore.getState(),
    setState: (d) => useBossScoreStore.setState(d),
    defaults: () => ({ totalScore: 0, bossKills: {} }),
    stateKeys: ['totalScore', 'bossKills'],
  },
  {
    baseKey: 'buffs',
    getState: () => useBuffStore.getState(),
    setState: (d) => useBuffStore.setState(d),
    defaults: () => ({ allBuffs: [] }),
    stateKeys: ['allBuffs'],
  },
  {
    baseKey: 'transforms',
    getState: () => useTransformStore.getState(),
    setState: (d) => useTransformStore.setState(d),
    // Point 7: legacy saves get `bakedBonusesApplied: true` (so the
    // migration runs on first load); brand-new characters start with `false`
    // so bonuses apply live from the very first transform.
    defaults: () => ({
      completedTransforms: [],
      currentTransformQuest: null,
      bakedBonusesApplied: false,
    }),
    stateKeys: ['completedTransforms', 'currentTransformQuest', 'bakedBonusesApplied'],
  },
  {
    baseKey: 'combat',
    getState: () => useCombatStore.getState(),
    setState: (d) => useCombatStore.setState(d),
    defaults: () => ({
      phase: 'idle', monster: null, monsterCurrentHp: 0, monsterMaxHp: 0,
      playerCurrentHp: 0, playerCurrentMp: 0, monsterRarity: 'normal',
      backgroundActive: false, baseMonster: null, autoFight: true,
      backgroundStartedAt: null, lastCombatTickAt: null,
      sessionXpEarned: 0, sessionGoldEarned: 0,
      sessionKills: { normal: 0, strong: 0, epic: 0, legendary: 0, boss: 0 },
      sessionStartedAt: Date.now(),
      waveMonsters: [], activeTargetIdx: 0, wavePlannedCount: 1,
    }),
    stateKeys: [
      'phase', 'monster', 'monsterCurrentHp', 'monsterMaxHp',
      'playerCurrentHp', 'playerCurrentMp', 'monsterRarity',
      'backgroundActive', 'baseMonster', 'autoFight',
      'backgroundStartedAt', 'lastCombatTickAt',
      'sessionXpEarned', 'sessionGoldEarned', 'sessionKills', 'sessionStartedAt',
      'waveMonsters', 'activeTargetIdx', 'wavePlannedCount',
    ],
  },
  {
    baseKey: 'offlineHunt',
    getState: () => useOfflineHuntStore.getState(),
    setState: (d) => useOfflineHuntStore.setState(d),
    defaults: () => ({
      isActive: false, startedAt: null, targetMonster: null, trainedSkillId: null,
    }),
    stateKeys: ['isActive', 'startedAt', 'targetMonster', 'trainedSkillId'],
  },
  {
    baseKey: 'friends',
    getState: () => useFriendsStore.getState(),
    setState: (d) => useFriendsStore.setState(d),
    defaults: () => ({ friends: [], favorites: [], blocked: [] }),
    stateKeys: ['friends', 'favorites', 'blocked'],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Pick only the data keys from the full store state (skip functions). */
const pickState = (full: Record<string, unknown>, keys: string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in full) out[k] = full[k];
  }
  return out;
};

/** Collect all stores into a single JSON blob (keyed by baseKey). */
const collectAllStores = (): Record<string, Record<string, unknown>> => {
  const charId = _activeCharacterId;
  const blob: Record<string, Record<string, unknown>> = {};
  for (const entry of STORE_ENTRIES) {
    const slice = pickState(entry.getState(), entry.stateKeys);
    // Stamp each entry with owner ID for cross-character safety verification
    if (charId) slice._entryOwner = charId;
    blob[entry.baseKey] = slice;
  }
  return blob;
};

/**
 * Apply a saved blob back to all stores. Every store is ALWAYS reset to its
 * defaults first so there is zero chance of leftover state from the previous
 * character bleeding into the new one. The blob MUST contain an
 * `_ownerCharacterId` matching the expected charId – otherwise it is rejected
 * and the stores end up at defaults only.
 */
const applyBlobToStores = (blob: Record<string, unknown>, expectedCharId: string): boolean => {
  // 1) Reset every gameplay store to its default state FIRST. Without this,
  //    a blob missing a particular baseKey would leave that store holding the
  //    previous character's data.
  resetStoresToDefaults();

  // 2) Refuse to apply a blob that belongs to a different character.
  const owner = typeof blob._ownerCharacterId === 'string' ? blob._ownerCharacterId : null;
  if (owner && owner !== expectedCharId) {
    // eslint-disable-next-line no-console
    console.warn('[characterScope] BLOCKED blob – owner mismatch', { owner, expectedCharId });
    return false;
  }

  // 3) Apply each store's slice from the blob.
  // Only apply keys listed in stateKeys — runtime-only fields (like
  // trainingCurrentSpeedMultiplier) must NOT be overwritten from old saves.
  // Also verify per-entry owner stamp if present.
  for (const entry of STORE_ENTRIES) {
    const data = blob[entry.baseKey];
    if (data && typeof data === 'object') {
      const dataObj = data as Record<string, unknown>;
      // Per-entry owner verification (added in safety update)
      const entryOwner = dataObj._entryOwner;
      if (typeof entryOwner === 'string' && entryOwner !== expectedCharId) {
        // eslint-disable-next-line no-console
        console.warn(`[characterScope] BLOCKED entry "${entry.baseKey}" – owner mismatch`, { entryOwner, expectedCharId });
        continue; // Skip this entry, keep defaults
      }
      const filtered: Record<string, unknown> = {};
      const allowed = new Set(entry.stateKeys);
      for (const [k, v] of Object.entries(dataObj)) {
        if (allowed.has(k)) filtered[k] = v;
      }
      entry.setState(filtered);
    }
  }

  // 4) Point 7 legacy migration: any save that completed a transform before
  //    the April-2026 live-bonus rewrite has its hp/mp/attack/defense/regen
  //    stats still inflated by the baked deltas. We flag completion with a
  //    per-character localStorage marker so migration runs exactly once,
  //    even if an earlier in-progress build already persisted
  //    `bakedBonusesApplied: false` to the blob without actually migrating.
  try {
    const transformSlice = blob.transforms as Record<string, unknown> | undefined;
    const completed = Array.isArray(transformSlice?.completedTransforms)
      ? (transformSlice!.completedTransforms as unknown[])
      : [];
    if (completed.length > 0) {
      const markerKey = `tibia_transform_migration_v1_${expectedCharId}`;
      const alreadyMigrated = localStorage.getItem(markerKey) === '1';
      if (!alreadyMigrated) {
        // Force the store into legacy state so the migrator knows to unbake.
        useTransformStore.setState({ bakedBonusesApplied: true });
        const ran = useTransformStore.getState().migrateLegacyBakedBonuses();
        if (ran) {
          try { localStorage.setItem(markerKey, '1'); } catch { /* storage full */ }
        }
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[characterScope] transform legacy migration failed', err);
  }

  return true;
};

/** Reset all stores to defaults. */
const resetStoresToDefaults = (): void => {
  for (const entry of STORE_ENTRIES) {
    entry.setState(entry.defaults());
  }
};

// ── Auto-save: persist stores to localStorage on every change ───────────────

/**
 * Ensure training is running at 1x (background) speed before persisting.
 * Always-on training never truly pauses — it just runs at 1x when inactive.
 * This ensures the outgoing character continues accumulating training time.
 */
/**
 * Ensure offline training has a running segment before saving.
 * @param forceBackgroundSpeed If true, flush segment and switch to 1x (used when
 *   switching characters — the outgoing character should train at background speed).
 *   If false (default), just make sure a segment exists without changing speed.
 */
const ensureOfflineTrainingRunning = (forceBackgroundSpeed = false): void => {
  const skillState = useSkillStore.getState();
  if (!skillState.offlineTrainingSkillId) return;

  if (!skillState.trainingSegmentStartedAt) {
    // Training skill selected but segment never started — start it
    const speed = forceBackgroundSpeed ? 1 : skillState.trainingCurrentSpeedMultiplier;
    skillState.startOfflineTraining(skillState.offlineTrainingSkillId, speed);
  } else if (forceBackgroundSpeed) {
    // Flush current segment and switch to 1x (background) speed
    skillState.onActivityChange(false);
  }
  // Otherwise: segment is running, don't change speed — just save as-is
};

/**
 * Synchronously flush all store state to localStorage for the active character.
 * This is the core auto-save mechanism – called on debounce after any store change.
 */
const flushStoresToLocalStorage = (): void => {
  // BLOCK during character switch – stores contain partial/mixed state.
  if (_switchInProgress) {
    return;
  }

  const charId = _activeCharacterId;
  if (!charId) return;

  // HARD GUARD 1: never save if characterStore is holding a DIFFERENT character.
  const activeCharacter = useCharacterStore.getState().character;
  if (activeCharacter && activeCharacter.id !== charId) {
    // eslint-disable-next-line no-console
    console.warn('[characterScope] Refused to save – character.id mismatch', {
      activeCharId: charId,
      characterStoreId: activeCharacter.id,
    });
    return;
  }

  // HARD GUARD 2: Tab lock — only save if THIS tab owns the character.
  // This prevents Tab A from overwriting char X's data when Tab B
  // has already loaded char X and taken ownership.
  if (!thisTabOwnsLock(charId)) {
    // eslint-disable-next-line no-console
    console.warn('[characterScope] Refused to save – another tab owns this character', { charId });
    return;
  }

  // Refresh the tab lock timestamp to keep it alive
  refreshTabLock(charId);

  // Make sure training is resumed before we take the snapshot
  ensureOfflineTrainingRunning();

  const blob: Record<string, unknown> = collectAllStores();
  blob._ownerCharacterId = charId;
  const now = new Date().toISOString();

  // Include character stats so level/XP/gold survive refresh
  const character = useCharacterStore.getState().character;
  if (character && character.id === charId) {
    blob['_characterStats'] = {
      level: character.level,
      xp: character.xp,
      hp: character.hp,
      max_hp: character.max_hp,
      mp: character.mp,
      max_mp: character.max_mp,
      attack: character.attack,
      defense: character.defense,
      attack_speed: character.attack_speed,
      crit_chance: character.crit_chance,
      crit_damage: character.crit_damage,
      magic_level: character.magic_level,
      stat_points: character.stat_points,
      highest_level: character.highest_level ?? character.level,
      gold: character.gold ?? 0,
    };
  }

  try {
    localStorage.setItem(
      `dungeon_rpg_save_char_${charId}`,
      JSON.stringify({ state: blob, updated_at: now }),
    );
  } catch {
    // storage full
  }
};

/**
 * Schedule a debounced auto-save. Multiple rapid state changes
 * (e.g. combat ticks) collapse into a single write.
 */
const scheduleAutoSave = (): void => {
  if (_autoSaveTimer !== null) {
    clearTimeout(_autoSaveTimer);
  }
  _autoSaveTimer = setTimeout(() => {
    _autoSaveTimer = null;
    flushStoresToLocalStorage();
  }, AUTO_SAVE_DEBOUNCE_MS);
};

/**
 * Cross-tab protection: detect when another tab takes our character's lock
 * or writes to our character's save slot.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    const charId = _activeCharacterId;
    if (!charId) return;

    // Another tab took the lock for our character
    const lockKey = `${TAB_LOCK_PREFIX}${charId}`;
    if (e.key === lockKey && e.newValue) {
      try {
        const data = JSON.parse(e.newValue);
        if (data.tabId && data.tabId !== TAB_SESSION_ID) {
          // Another tab now owns our character — STOP all auto-saves immediately
          // eslint-disable-next-line no-console
          console.warn('[characterScope] Another tab took ownership of this character – disabling auto-save');
          stopAutoSaveSubscriptions();
        }
      } catch { /* ignore */ }
    }

    // Another tab wrote to our character's save slot
    const saveKey = `dungeon_rpg_save_char_${charId}`;
    if (e.key === saveKey && e.newValue) {
      // Verify we still own the lock before reacting
      if (!thisTabOwnsLock(charId)) {
        // eslint-disable-next-line no-console
        console.warn('[characterScope] Another tab modified this character – pausing auto-save');
        stopAutoSaveSubscriptions();
      }
    }
  });
}

/**
 * Subscribe to ALL gameplay stores. Every state change triggers a debounced
 * localStorage write so data survives page refresh.
 */
const startAutoSaveSubscriptions = (): void => {
  if (_subscriptionsActive) return;
  _subscriptionsActive = true;

  // Subscribe to each gameplay store
  const stores = [
    useInventoryStore,
    useSkillStore,
    useTaskStore,
    useQuestStore,
    useBossStore,
    useDungeonStore,
    usePartyStore,
    useSettingsStore,
    useDailyQuestStore,
    useMasteryStore,
    useBossScoreStore,
    useBuffStore,
    useTransformStore,
  ];

  for (const store of stores) {
    const unsub = store.subscribe(() => {
      scheduleAutoSave();
    });
    _unsubscribers.push(unsub);
  }

  // Also subscribe to characterStore for gold/level/xp changes
  const unsubChar = useCharacterStore.subscribe(() => {
    scheduleAutoSave();
  });
  _unsubscribers.push(unsubChar);
};

/**
 * Stop all auto-save subscriptions (called when switching characters or logging out).
 */
const stopAutoSaveSubscriptions = (): void => {
  for (const unsub of _unsubscribers) {
    unsub();
  }
  _unsubscribers = [];
  _subscriptionsActive = false;

  // Cancel any pending debounced save — do NOT flush here, the caller
  // (switchToCharacter) handles explicit saving via forceSaveCharacterData.
  if (_autoSaveTimer !== null) {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
  }
};

/**
 * Restore stores from localStorage synchronously on page load.
 * This prevents the "flash of default state" race condition.
 * Returns true if data was restored, false otherwise.
 */
export const restoreFromLocalStorageSync = (charId: string): boolean => {
  const key = `dungeon_rpg_save_char_${charId}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      // No saved blob – still reset all stores to defaults so no leftover
      // state from a previous character survives.
      resetStoresToDefaults();
      return false;
    }
    const parsed = JSON.parse(raw);
    const state = parsed.state ?? parsed;
    if (state && typeof state === 'object') {
      return applyBlobToStores(state as Record<string, unknown>, charId);
    }
  } catch {
    // corrupt data
  }
  resetStoresToDefaults();
  return false;
};

/**
 * Peek at a specific sub-store ("baseKey") of a character without switching
 * the active character. Returns null if nothing is saved.
 */
export const peekCharacterStore = (charId: string, baseKey: string): Record<string, unknown> | null => {
  try {
    const raw = localStorage.getItem(`dungeon_rpg_save_char_${charId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const state = parsed.state ?? parsed;
    if (!state || typeof state !== 'object') return null;
    const sub = (state as Record<string, unknown>)[baseKey];
    return sub && typeof sub === 'object' ? (sub as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

// ── Clean up stale global persist keys (one-time migration) ─────────────────

const STALE_GLOBAL_KEYS = [
  'dungeon_rpg_inventory', 'dungeon_rpg_skills', 'dungeon_rpg_tasks',
  'dungeon_rpg_quests', 'dungeon_rpg_bosses', 'dungeon_rpg_dungeons',
  'dungeon_rpg_party', 'dungeon_rpg_settings', 'dungeon_rpg_daily_quests',
  'dungeon_rpg_mastery', 'dungeon_rpg_boss_score', 'dungeon_rpg_buffs',
];

const cleanStaleGlobalKeys = (): void => {
  for (const key of STALE_GLOBAL_KEYS) {
    localStorage.removeItem(key);
  }
};

// ── Also keep old localStorage per-char keys for migration ──────────────────

const oldCharKey = (baseKey: string, charId: string): string =>
  `dungeon_rpg_${baseKey}_char_${charId}`;

/** Try to migrate old per-store localStorage keys into the new unified format. */
const migrateOldLocalStorage = (charId: string): Record<string, Record<string, unknown>> | null => {
  const blob: Record<string, Record<string, unknown>> = {};
  let found = false;

  for (const entry of STORE_ENTRIES) {
    // Try old key format first
    const oldKey = oldCharKey(entry.baseKey, charId);
    // Also try the even older format
    const legacyKey = `dungeon_rpg_${entry.baseKey === 'inventory' ? 'inventory' : entry.baseKey}_char_${charId}`;
    const veryOldKey = `dungeon_rpg_${
      entry.baseKey === 'inventory' ? 'inventory'
        : entry.baseKey === 'skills' ? 'skills'
          : entry.baseKey
    }_char_${charId}`;

    for (const key of [oldKey, legacyKey, veryOldKey]) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          blob[entry.baseKey] = parsed.state ?? parsed;
          found = true;
          // Clean up old key
          localStorage.removeItem(key);
          break;
        } catch {
          // corrupt
        }
      }
    }
  }

  return found ? blob : null;
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Force-save current character stores to BOTH localStorage and Supabase.
 * This IGNORES the _switchInProgress flag — it must be called explicitly
 * during character switch to persist the outgoing character before resetting.
 */
const forceSaveCharacterData = async (charId: string): Promise<void> => {
  // Verify character store matches
  const activeCharacter = useCharacterStore.getState().character;
  if (activeCharacter && activeCharacter.id !== charId) {
    // eslint-disable-next-line no-console
    console.warn('[characterScope] forceSave – character.id mismatch, skipping', {
      charId, characterStoreId: activeCharacter.id,
    });
    return;
  }

  // 1) Collect all store data and tag with owner
  const blob: Record<string, unknown> = collectAllStores();
  blob._ownerCharacterId = charId;
  const now = new Date().toISOString();

  // Include character stats in blob
  const character = useCharacterStore.getState().character;
  if (character && character.id === charId) {
    blob['_characterStats'] = {
      level: character.level, xp: character.xp,
      hp: character.hp, max_hp: character.max_hp,
      mp: character.mp, max_mp: character.max_mp,
      attack: character.attack, defense: character.defense,
      attack_speed: character.attack_speed,
      crit_chance: character.crit_chance,
      crit_damage: character.crit_damage,
      magic_level: character.magic_level,
      stat_points: character.stat_points,
      highest_level: character.highest_level ?? character.level,
      gold: character.gold ?? 0,
    };
  }

  // 2) Write to localStorage SYNCHRONOUSLY
  try {
    localStorage.setItem(
      `dungeon_rpg_save_char_${charId}`,
      JSON.stringify({ state: blob, updated_at: now }),
    );
  } catch {
    // storage full
  }

  // 3) Write to Supabase (async)
  try {
    await saveGame(charId, blob as Record<string, Record<string, unknown>>);
  } catch {
    // offline – localStorage has the data
  }

  // 4) Save character stats to Supabase characters table
  try {
    await saveCharacterToSupabase(charId);
  } catch {
    // offline
  }

  // 5) Sync weapon skills for leaderboard
  try {
    await syncWeaponSkillsToSupabase(charId);
  } catch {
    // offline
  }
};

/**
 * Switch to a character. Saves current character's data, then loads the new one.
 * Async: tries Supabase first, falls back to localStorage.
 *
 * CRITICAL FIX: The old character's data is saved BEFORE _switchInProgress
 * is set to true. This ensures the save actually executes instead of being
 * silently blocked by the guard in saveCurrentCharacterStores().
 */
export const switchToCharacter = async (newCharacterId: string): Promise<void> => {
  const oldId = _activeCharacterId;

  // ── PHASE 1: Save outgoing character (BEFORE blocking auto-saves) ──────
  // Stop subscriptions first so no concurrent auto-save can interfere,
  // but do NOT set _switchInProgress yet — we need saveCurrentCharacterStores
  // to actually run.
  stopAutoSaveSubscriptions();

  if (oldId) {
    // Ensure training is at 1x (background) speed for outgoing character
    ensureOfflineTrainingRunning(true);

    // Force-save to localStorage + Supabase (bypasses _switchInProgress)
    await forceSaveCharacterData(oldId);
  }

  // ── PHASE 2: Block all saves, reset stores, load new character ─────────
  _switchInProgress = true;

  // Remove stale global persist keys that old Zustand persist middleware wrote
  cleanStaleGlobalKeys();

  // Wipe ALL gameplay stores to defaults — belt-and-braces safeguard
  resetStoresToDefaults();

  // Set new character ID BEFORE restore so all guards use correct ID
  _activeCharacterId = newCharacterId;
  localStorage.setItem(ACTIVE_CHAR_KEY, newCharacterId);

  // Step 1: IMMEDIATELY restore from localStorage (sync, instant)
  let restored = restoreFromLocalStorageSync(newCharacterId);

  // Step 2: Try loading from Supabase (async, may be newer)
  try {
    const saved = await loadGame(newCharacterId);
    if (saved) {
      const cloudBlob: Record<string, unknown> = { ...(saved as Record<string, unknown>) };
      cloudBlob._ownerCharacterId = newCharacterId;
      const ok = applyBlobToStores(cloudBlob, newCharacterId);
      if (ok) restored = true;
    }
  } catch {
    // offline – localStorage data already restored above
  }

  if (!restored) {
    // Check for old localStorage migration data
    const migrated = migrateOldLocalStorage(newCharacterId);
    if (migrated) {
      const migBlob: Record<string, unknown> = { ...(migrated as Record<string, unknown>) };
      migBlob._ownerCharacterId = newCharacterId;
      applyBlobToStores(migBlob, newCharacterId);
      void saveGame(newCharacterId, migBlob);
    } else {
      resetStoresToDefaults();
    }
  }

  // ── PHASE 3: Claim tab lock and re-enable saves for new character ───
  // Claim exclusive ownership of this character for THIS tab.
  // Other tabs will see this lock and refuse to auto-save to this character.
  claimTabLock(newCharacterId);

  _switchInProgress = false;

  // Start auto-save subscriptions for the new character
  startAutoSaveSubscriptions();
};

/**
 * Sync weapon/training skill levels to the `character_weapon_skills` table in Supabase.
 * This powers the leaderboard rankings for weapon skills (sword_fighting, magic_level, etc.).
 *
 * Strategy: delete all existing rows for this character, then insert fresh ones.
 * This avoids dependency on a unique constraint that may not exist on the table.
 */
const syncWeaponSkillsToSupabase = async (charId: string): Promise<void> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const skillState = useSkillStore.getState();
  const levels = skillState.skillLevels;
  const xps = skillState.skillXp;

  // All skill IDs that should be synced to the leaderboard table
  const skillIds = Object.keys(levels);

  const now = new Date().toISOString();
  const rows = skillIds.map((skillName) => ({
    character_id: charId,
    skill_name: skillName,
    skill_level: levels[skillName] ?? 0,
    skill_xp: xps[skillName] ?? 0,
    hits_count: 0,
    updated_at: now,
  }));

  // Also sync boss_score (from bossScoreStore) as a pseudo-skill so the
  // leaderboard can rank it alongside weapon/training skills.
  const bossScoreState = useBossScoreStore.getState();
  const bossKillCount = Object.values(bossScoreState.bossKills).reduce(
    (acc, entry) => acc + (entry?.count ?? 0),
    0,
  );
  rows.push({
    character_id: charId,
    skill_name: 'boss_score',
    skill_level: bossScoreState.totalScore,
    skill_xp: bossKillCount,
    hits_count: 0,
    updated_at: now,
  });

  if (rows.length === 0) return;

  // Delete existing rows for this character, then insert fresh ones
  await supabase
    .from('character_weapon_skills')
    .delete()
    .eq('character_id', charId);

  await supabase
    .from('character_weapon_skills')
    .insert(rows);
};

/**
 * Save the character's stats (level, XP, HP, MP, etc.) to Supabase.
 * This is CRITICAL – without this, level/XP resets on character switch!
 */
const saveCharacterToSupabase = async (charId: string): Promise<void> => {
  const character = useCharacterStore.getState().character;
  if (!character || character.id !== charId) return;

  try {
    await characterApi.updateCharacter(charId, {
      level: character.level,
      xp: character.xp,
      hp: character.hp,
      max_hp: character.max_hp,
      mp: character.mp,
      max_mp: character.max_mp,
      attack: character.attack,
      defense: character.defense,
      attack_speed: character.attack_speed,
      crit_chance: character.crit_chance,
      crit_damage: character.crit_damage,
      magic_level: character.magic_level,
      stat_points: character.stat_points,
      highest_level: character.highest_level ?? character.level,
      gold: character.gold ?? 0,
    });
  } catch {
    // Offline – character data saved in blob below as fallback
  }
};

/**
 * Save current character's stores to both localStorage and Supabase.
 * Also persists character stats (level, XP, etc.) to the characters table.
 */
export const saveCurrentCharacterStores = async (): Promise<void> => {
  if (_switchInProgress) return;

  const charId = _activeCharacterId;
  if (!charId) return;

  // HARD GUARD 1: never save if characterStore is holding a different character.
  const activeCharacter = useCharacterStore.getState().character;
  if (activeCharacter && activeCharacter.id !== charId) {
    // eslint-disable-next-line no-console
    console.warn('[characterScope] Refused to saveCurrentCharacterStores – character.id mismatch', {
      activeCharId: charId,
      characterStoreId: activeCharacter.id,
    });
    return;
  }

  // HARD GUARD 2: tab lock – only save if THIS tab owns the character.
  if (!thisTabOwnsLock(charId)) {
    // eslint-disable-next-line no-console
    console.warn('[characterScope] Refused to save – another tab owns this character', { charId });
    return;
  }

  // Refresh tab lock
  refreshTabLock(charId);

  // Save character stats to Supabase `characters` table
  await saveCharacterToSupabase(charId);

  // Sync weapon/training skill levels to Supabase for leaderboard
  try {
    await syncWeaponSkillsToSupabase(charId);
  } catch {
    // offline – skill leaderboard will update on next successful sync
  }

  // Save all store data to game_saves – tagged with owner for load-side check.
  const blob: Record<string, unknown> = collectAllStores();
  blob._ownerCharacterId = charId;
  await saveGame(charId, blob as Record<string, Record<string, unknown>>);
};

/**
 * Synchronous save to localStorage only (for beforeunload handler).
 * Also saves character stats (level, XP, etc.) to localStorage so they survive browser close.
 * Does NOT touch Supabase – that's handled by periodic sync.
 */
export const saveCurrentCharacterStoresSync = (): void => {
  if (_switchInProgress) return;

  // Cancel any pending debounced save and flush immediately
  if (_autoSaveTimer !== null) {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
  }
  flushStoresToLocalStorage();
};

/**
 * Clean up all stored data for a deleted character (local + cloud).
 */
export const deleteCharacterData = async (charId: string): Promise<void> => {
  // Clean up old per-store keys (migration remnants)
  for (const entry of STORE_ENTRIES) {
    localStorage.removeItem(oldCharKey(entry.baseKey, charId));
  }

  // Delete unified save
  await deleteGameSave(charId);
};
