
import { useCharacterStore, computeBaseStatFloor, computeAttackDefenseFloor } from './characterStore';
import { getAttributePointsForLevel } from '../systems/attributeSystem';
import { useInventoryStore } from './inventoryStore';
import { useSkillStore } from './skillStore';
import { useTaskStore } from './taskStore';
import { useQuestStore } from './questStore';
import { useBossStore } from './bossStore';
import { useDungeonStore } from './dungeonStore';
import { useSettingsStore } from './settingsStore';
import { useDailyQuestStore } from './dailyQuestStore';
import { useMasteryStore } from './masteryStore';
import { useAttributeStore, ATTRIBUTE_MIGRATION_VERSION } from './attributeStore';
import { isActionGateBusy } from '../api/backend/actionGate';
import { useBossScoreStore } from './bossScoreStore';
import { useBuffStore } from './buffStore';
import { SPELL_CHEST_LEVELS } from '../systems/skillSystem';
import { useTransformStore } from './transformStore';
import { useCombatStore } from './combatStore';
import { useOfflineHuntStore } from './offlineHuntStore';
import { useFriendsStore } from './friendsStore';
import { useConnectivityStore } from './connectivityStore';
import { EMPTY_EQUIPMENT, type IInventoryItem } from '../systems/itemSystem';
import { saveGame, loadGame, deleteGameSave } from '../storage/gameStorage';
import { characterApi } from '../api/v1/characterApi';
import { commitStateToBackend, commitStateViaKeepalive, type ICombatEvent } from '../api/backend/commit';
import { setPendingCommitFlusher } from '../api/backend/pendingCommit';
import { supabase } from '../lib/supabase';
import { isBackendMode } from '../config/backendMode';
import skillsData from '../data/skills.json';
import type { ICharacter } from '../types/character';


let _activeCharacterId: string | null = null;
const ACTIVE_CHAR_KEY = 'tibia_active_character_id';

const TAB_SESSION_ID = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const TAB_LOCK_PREFIX = 'tibia_tab_lock_';
const TAB_LOCK_EXPIRY_MS = 30_000;

const claimTabLock = (charId: string): void => {
  releaseTabLock();
  const lockData = JSON.stringify({ tabId: TAB_SESSION_ID, ts: Date.now() });
  try {
    localStorage.setItem(`${TAB_LOCK_PREFIX}${charId}`, lockData);
  } catch { }
};

const releaseTabLock = (): void => {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(TAB_LOCK_PREFIX)) {
      try {
        const data = JSON.parse(localStorage.getItem(key) ?? '{}');
        if (data.tabId === TAB_SESSION_ID) {
          localStorage.removeItem(key);
        }
      } catch { }
    }
  }
};

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
  } catch { }
};

const thisTabOwnsLock = (charId: string): boolean => {
  try {
    const raw = localStorage.getItem(`${TAB_LOCK_PREFIX}${charId}`);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.tabId === TAB_SESSION_ID) return true;
    if (Date.now() - (data.ts ?? 0) > TAB_LOCK_EXPIRY_MS) return false;
    return false;
  } catch {
    return false;
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    releaseTabLock();
  });
}

let _switchInProgress = false;


let _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_SAVE_DEBOUNCE_MS = 500;
let _subscriptionsActive = false;
let _unsubscribers: Array<() => void> = [];

let _backendCommitTimer: ReturnType<typeof setTimeout> | null = null;
let _backendCommitMaxTimer: ReturnType<typeof setTimeout> | null = null;
let _dirtySinceCommit = false;
const BACKEND_COMMIT_DEBOUNCE_MS = 300;
const BACKEND_COMMIT_MAX_WAIT_MS = 5000;

const clearBackendCommitTimers = (): void => {
  if (_backendCommitTimer !== null) {
    clearTimeout(_backendCommitTimer);
    _backendCommitTimer = null;
  }
  if (_backendCommitMaxTimer !== null) {
    clearTimeout(_backendCommitMaxTimer);
    _backendCommitMaxTimer = null;
  }
};

const runBackendCommit = (): void => {
  clearBackendCommitTimers();
  const charId = _activeCharacterId;
  if (!charId || !isBackendMode()) return;
  if (_switchInProgress) return;
  if (isActionGateBusy()) {
    _backendCommitTimer = setTimeout(runBackendCommit, BACKEND_COMMIT_DEBOUNCE_MS);
    return;
  }
  flushStoresToLocalStorage();
  void commitStateToBackend(charId).then((ok) => {
    if (ok) _dirtySinceCommit = false;
  });
};

const scheduleBackendCommit = (): void => {
  if (!isBackendMode() || !_activeCharacterId) return;
  if (_switchInProgress) return;
  const cs = useCombatStore.getState() as { phase?: string; backgroundActive?: boolean; autoFight?: boolean };
  const autoHunting = ((cs.phase === 'fighting' || cs.phase === 'victory') && !!cs.autoFight) || !!cs.backgroundActive;
  if (autoHunting) {
    clearBackendCommitTimers();
    return;
  }
  if (_backendCommitTimer !== null) clearTimeout(_backendCommitTimer);
  _backendCommitTimer = setTimeout(runBackendCommit, BACKEND_COMMIT_DEBOUNCE_MS);
  if (_backendCommitMaxTimer === null) {
    _backendCommitMaxTimer = setTimeout(runBackendCommit, BACKEND_COMMIT_MAX_WAIT_MS);
  }
};

const flushBackendCommitNow = async (): Promise<void> => {
  if (!isBackendMode() || !_activeCharacterId) return;
  if (_switchInProgress) return;
  clearBackendCommitTimers();
  if (!_dirtySinceCommit) return;
  flushStoresToLocalStorage();
  const ok = await commitStateToBackend(_activeCharacterId);
  if (ok) _dirtySinceCommit = false;
};
setPendingCommitFlusher(flushBackendCommitNow);

export const commitCombatEventNow = (event: ICombatEvent): void => {
  if (!isBackendMode() || !_activeCharacterId) return;
  if (_switchInProgress) return;
  clearBackendCommitTimers();
  flushStoresToLocalStorage();
  void commitStateToBackend(_activeCharacterId, event).then((ok) => {
    if (ok) _dirtySinceCommit = false;
  });
};

let _hideHooked = false;
const hookBackendCommitOnHide = (): void => {
  if (_hideHooked || typeof document === 'undefined') return;
  _hideHooked = true;
  const flushOnHide = (): void => {
    if (!isBackendMode() || !_activeCharacterId) return;
    if (_switchInProgress) return;
    flushStoresToLocalStorage();
    commitStateViaKeepalive(_activeCharacterId);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnHide();
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushOnHide);
  }
};

export const getActiveCharacterId = (): string | null => _activeCharacterId;

export const getActiveCharacterIdForRestore = (): string | null =>
  _activeCharacterId ?? localStorage.getItem(ACTIVE_CHAR_KEY);


interface IStoreEntry {
  baseKey: string;
  getState: () => unknown;
  setState: (data: Record<string, unknown>) => void;
  defaults: () => Record<string, unknown>;
  stateKeys: string[];
}

const STORE_ENTRIES: IStoreEntry[] = [
  {
    baseKey: 'inventory',
    getState: () => useInventoryStore.getState(),
    setState: (d) => useInventoryStore.setState(d),
    defaults: () => ({ bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [], gold: 0, consumables: {}, stones: {}, arenaPoints: 0 }),
    stateKeys: ['bag', 'equipment', 'deposit', 'gold', 'consumables', 'stones', 'arenaPoints'],
  },
  {
    baseKey: 'skills',
    getState: () => useSkillStore.getState(),
    setState: (d) => useSkillStore.setState(d),
    defaults: () => ({
      skillLevels: {}, skillXp: {}, skillXpFraction: {}, skillUpgradeLevels: {}, unlockedSkills: {},
      activeSkillSlots: [null, null, null, null],
      offlineTrainingSkillId: null, trainingSegmentStartedAt: null,
      trainingAccumulatedEffectiveSeconds: 0, trainingCurrentSpeedMultiplier: 2,
    }),
    stateKeys: [
      'skillLevels', 'skillXp', 'skillXpFraction', 'skillUpgradeLevels', 'unlockedSkills', 'activeSkillSlots',
      'offlineTrainingSkillId', 'trainingSegmentStartedAt',
      'trainingAccumulatedEffectiveSeconds', 'trainingCurrentSpeedMultiplier',
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
    defaults: () => ({ dailyAttempts: {}, clearedDungeonIds: {}, lastResult: null }),
    stateKeys: ['dailyAttempts', 'clearedDungeonIds', 'lastResult'],
  },
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
      autoSellMaxLevel: 0, autoDisassembleCommon: false, autoDisassembleRare: false, autoDisassembleEpic: false, autoDisassembleLegendary: false, autoDisassembleMythic: false, autoDisassembleMaxLevel: 0,
      huntFilterAvailableOnly: false, huntFilterTaskedOnly: false, huntFilterMinLevel: 0, huntFilterSortDesc: false,
      dungeonFilterAvailableOnly: false, dungeonFilterMinLevel: 0, dungeonFilterSortDesc: false,
      raidFilterAvailableOnly: false, raidFilterMinLevel: 0, raidFilterSortDesc: false,
      bossFilterAvailableOnly: false, bossFilterMinLevel: 0, bossFilterSortDesc: false,
      taskFilterAvailableOnly: false, taskFilterInactiveOnly: false, taskFilterSortDesc: false, taskFilterLvlFrom: '',
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
      'autoSellMaxLevel', 'autoDisassembleCommon', 'autoDisassembleRare', 'autoDisassembleEpic', 'autoDisassembleLegendary', 'autoDisassembleMythic', 'autoDisassembleMaxLevel',
      'huntFilterAvailableOnly', 'huntFilterTaskedOnly', 'huntFilterMinLevel', 'huntFilterSortDesc',
      'dungeonFilterAvailableOnly', 'dungeonFilterMinLevel', 'dungeonFilterSortDesc',
      'raidFilterAvailableOnly', 'raidFilterMinLevel', 'raidFilterSortDesc',
      'bossFilterAvailableOnly', 'bossFilterMinLevel', 'bossFilterSortDesc',
      'taskFilterAvailableOnly', 'taskFilterInactiveOnly', 'taskFilterSortDesc', 'taskFilterLvlFrom',
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
    baseKey: 'attributes',
    getState: () => useAttributeStore.getState(),
    setState: (d) => useAttributeStore.setState(d),
    defaults: () => ({ attackPoints: 0, hpPoints: 0, defensePoints: 0, migrationVersion: 0 }),
    stateKeys: ['attackPoints', 'hpPoints', 'defensePoints', 'migrationVersion'],
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
    defaults: () => ({
      completedTransforms: [],
      currentTransformQuest: null,
      bakedBonusesApplied: false,
      transformMigrationVersion: 1,
      pendingClaimTransformId: null,
    }),
    stateKeys: ['completedTransforms', 'currentTransformQuest', 'bakedBonusesApplied', 'transformMigrationVersion', 'pendingClaimTransformId'],
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


const pickState = (full: Record<string, unknown>, keys: string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in full) out[k] = full[k];
  }
  return out;
};

const collectAllStores = (): Record<string, Record<string, unknown>> => {
  const charId = _activeCharacterId;
  const blob: Record<string, Record<string, unknown>> = {};
  for (const entry of STORE_ENTRIES) {
    const slice = pickState(entry.getState() as Record<string, unknown>, entry.stateKeys);
    if (charId) slice._entryOwner = charId;
    blob[entry.baseKey] = slice;
  }
  return blob;
};

const CHAR_STAT_NUMERIC_KEYS = [
  'level', 'xp', 'hp', 'max_hp', 'mp', 'max_mp', 'attack', 'defense',
  'attack_speed', 'crit_chance', 'crit_damage', 'magic_level', 'stat_points', 'highest_level', 'gold',
] as const;

const applyCharacterStatsFromBlob = (blob: Record<string, unknown>, expectedCharId: string): void => {
  const stats = blob._characterStats;
  if (!stats || typeof stats !== 'object') return;
  const current = useCharacterStore.getState().character;
  if (!current || current.id !== expectedCharId) return;
  const src = stats as Record<string, unknown>;
  const patch: Record<string, number> = {};
  for (const k of CHAR_STAT_NUMERIC_KEYS) {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v)) patch[k] = v;
  }
  if (Object.keys(patch).length > 0) {
    useCharacterStore.getState().updateCharacter(patch as Partial<ICharacter>);
  }
};

const stripLegacyCritDmgBonuses = (): void => {
  const inv = useInventoryStore.getState();
  const strip = (item: IInventoryItem): IInventoryItem => {
    if (!item?.bonuses || !('critDmg' in item.bonuses)) return item;
    const { critDmg: _critDmg, ...rest } = item.bonuses as Record<string, number>;
    return { ...item, bonuses: rest };
  };
  useInventoryStore.setState({
    bag: inv.bag.map(strip),
    deposit: inv.deposit.map(strip),
    equipment: Object.fromEntries(
      Object.entries(inv.equipment).map(([slot, item]) => [slot, item ? strip(item) : item]),
    ) as typeof inv.equipment,
  });
};

const migrateAttributesV1 = (): void => {
  const char = useCharacterStore.getState().character;
  if (char) {
    const highest = char.highest_level ?? char.level;
    const hpFloor = computeBaseStatFloor(char.class, highest);
    const adFloor = computeAttackDefenseFloor(char.class, highest);
    const maxHp = Math.min(char.max_hp ?? hpFloor.max_hp, hpFloor.max_hp);
    const maxMp = Math.min(char.max_mp ?? hpFloor.max_mp, hpFloor.max_mp);
    useCharacterStore.getState().updateCharacter({
      max_hp: maxHp,
      max_mp: maxMp,
      hp: Math.min(char.hp ?? maxHp, maxHp),
      mp: Math.min(char.mp ?? maxMp, maxMp),
      attack: Math.min(char.attack ?? adFloor.attack, adFloor.attack),
      defense: Math.min(char.defense ?? adFloor.defense, adFloor.defense),
      stat_points: getAttributePointsForLevel(highest),
    });
  }
  stripLegacyCritDmgBonuses();
  useAttributeStore.setState({
    attackPoints: 0,
    hpPoints: 0,
    defensePoints: 0,
    migrationVersion: ATTRIBUTE_MIGRATION_VERSION,
  });
};

export const applyBlobToStores = (
  blob: Record<string, unknown>,
  expectedCharId: string,
  opts?: { hydrateCharacterStats?: boolean },
): boolean => {
  resetStoresToDefaults();

  const owner = typeof blob._ownerCharacterId === 'string' ? blob._ownerCharacterId : null;
  if (owner && owner !== expectedCharId) {
    console.warn('[characterScope] BLOCKED blob – owner mismatch', { owner, expectedCharId });
    return false;
  }

  for (const entry of STORE_ENTRIES) {
    const data = blob[entry.baseKey];
    if (data && typeof data === 'object') {
      const dataObj = data as Record<string, unknown>;
      const entryOwner = dataObj._entryOwner;
      if (typeof entryOwner === 'string' && entryOwner !== expectedCharId) {
        console.warn(`[characterScope] BLOCKED entry "${entry.baseKey}" – owner mismatch`, { entryOwner, expectedCharId });
        continue;
      }
      const filtered: Record<string, unknown> = {};
      const allowed = new Set(entry.stateKeys);
      for (const [k, v] of Object.entries(dataObj)) {
        if (allowed.has(k)) filtered[k] = v;
      }
      entry.setState(filtered);
    }
  }

  try {
    const transformSlice = blob.transforms as Record<string, unknown> | undefined;
    const completed = Array.isArray(transformSlice?.completedTransforms)
      ? (transformSlice!.completedTransforms as unknown[])
      : [];
    const migrationVersion =
      typeof transformSlice?.transformMigrationVersion === 'number'
        ? (transformSlice!.transformMigrationVersion as number)
        : 0;
    if (completed.length > 0 && migrationVersion === 0) {
      useTransformStore.setState({ bakedBonusesApplied: true });
      useTransformStore.getState().migrateLegacyBakedBonuses();
      useTransformStore.setState({ transformMigrationVersion: 1 });
    }
  } catch (err) {
    console.error('[characterScope] transform legacy migration failed', err);
  }

  try {
    useCharacterStore.getState().healCorruptedBaseStats();
  } catch (err) {
    console.error('[characterScope] base-stat heal failed', err);
  }

  try {
    const buffs = useBuffStore.getState().allBuffs;
    useBuffStore.setState({
      allBuffs: buffs.filter((b) => !b.effect.startsWith('skill_charge_')),
    });
  } catch (err) {
    console.error('[characterScope] skill-charge buff sanitize failed', err);
  }

  try {
    const consumables = useInventoryStore.getState().consumables;
    let changed = false;
    const cleaned: Record<string, number> = {};
    for (const [key, count] of Object.entries(consumables)) {
      const match = /^spell_chest_(\d+)$/.exec(key);
      if (match && !SPELL_CHEST_LEVELS.includes(Number(match[1]))) {
        changed = true;
        continue;
      }
      cleaned[key] = count;
    }
    if (changed) useInventoryStore.setState({ consumables: cleaned });
  } catch (err) {
    console.error('[characterScope] invalid spell-chest sanitize failed', err);
  }

  if (opts?.hydrateCharacterStats) {
    applyCharacterStatsFromBlob(blob, expectedCharId);
  }

  try {
    if (useAttributeStore.getState().migrationVersion < ATTRIBUTE_MIGRATION_VERSION) {
      migrateAttributesV1();
    }
  } catch (err) {
    console.error('[characterScope] attribute migration failed', err);
  }

  return true;
};

const resetStoresToDefaults = (): void => {
  for (const entry of STORE_ENTRIES) {
    entry.setState(entry.defaults());
  }
};


const ensureOfflineTrainingRunning = (forceBackgroundSpeed = false): void => {
  const skillState = useSkillStore.getState();
  if (!skillState.offlineTrainingSkillId) return;

  if (useOfflineHuntStore.getState().isActive) return;

  if (!skillState.trainingSegmentStartedAt) {
    useSkillStore.setState({
      trainingSegmentStartedAt: new Date().toISOString(),
      trainingCurrentSpeedMultiplier: forceBackgroundSpeed ? 1 : skillState.trainingCurrentSpeedMultiplier,
    });
  } else if (forceBackgroundSpeed) {
    skillState.onActivityChange(false);
  }
};

const flushStoresToLocalStorage = (): void => {
  if (_switchInProgress) {
    return;
  }

  const charId = _activeCharacterId;
  if (!charId) return;

  const activeCharacter = useCharacterStore.getState().character;
  if (activeCharacter && activeCharacter.id !== charId) {
    console.warn('[characterScope] Refused to save – character.id mismatch', {
      activeCharId: charId,
      characterStoreId: activeCharacter.id,
    });
    return;
  }

  if (!thisTabOwnsLock(charId)) {
    console.warn('[characterScope] Refused to save – another tab owns this character', { charId });
    return;
  }

  refreshTabLock(charId);

  ensureOfflineTrainingRunning();

  const blob: Record<string, unknown> = collectAllStores();
  blob._ownerCharacterId = charId;
  const now = new Date().toISOString();

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
  }
};

const scheduleAutoSave = (): void => {
  _dirtySinceCommit = true;
  const offlineMode = useConnectivityStore.getState().mode === 'offline';
  if (offlineMode) {
    if (_autoSaveTimer !== null) {
      clearTimeout(_autoSaveTimer);
      _autoSaveTimer = null;
    }
    flushStoresToLocalStorage();
    return;
  }
  if (_autoSaveTimer !== null) {
    clearTimeout(_autoSaveTimer);
  }
  _autoSaveTimer = setTimeout(() => {
    _autoSaveTimer = null;
    flushStoresToLocalStorage();
  }, AUTO_SAVE_DEBOUNCE_MS);

  scheduleBackendCommit();
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    const charId = _activeCharacterId;
    if (!charId) return;

    const lockKey = `${TAB_LOCK_PREFIX}${charId}`;
    if (e.key === lockKey && e.newValue) {
      try {
        const data = JSON.parse(e.newValue);
        if (data.tabId && data.tabId !== TAB_SESSION_ID) {
          console.warn('[characterScope] Another tab took ownership of this character – disabling auto-save');
          stopAutoSaveSubscriptions();
        }
      } catch { }
    }

    const saveKey = `dungeon_rpg_save_char_${charId}`;
    if (e.key === saveKey && e.newValue) {
      if (!thisTabOwnsLock(charId)) {
        console.warn('[characterScope] Another tab modified this character – pausing auto-save');
        stopAutoSaveSubscriptions();
      }
    }
  });
}

const startAutoSaveSubscriptions = (): void => {
  if (_subscriptionsActive) return;
  _subscriptionsActive = true;

  const stores = [
    useInventoryStore,
    useSkillStore,
    useTaskStore,
    useQuestStore,
    useBossStore,
    useDungeonStore,
    useCombatStore,
    useSettingsStore,
    useDailyQuestStore,
    useMasteryStore,
    useBossScoreStore,
    useBuffStore,
    useTransformStore,
    useOfflineHuntStore,
    useFriendsStore,
    useAttributeStore,
  ];

  for (const store of stores) {
    const unsub = store.subscribe(() => {
      scheduleAutoSave();
    });
    _unsubscribers.push(unsub);
  }

  const unsubChar = useCharacterStore.subscribe(() => {
    scheduleAutoSave();
  });
  _unsubscribers.push(unsubChar);

  hookBackendCommitOnHide();
};

const stopAutoSaveSubscriptions = (): void => {
  for (const unsub of _unsubscribers) {
    unsub();
  }
  _unsubscribers = [];
  _subscriptionsActive = false;

  if (_autoSaveTimer !== null) {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
  }
  clearBackendCommitTimers();
};

export const restoreFromLocalStorageSync = (charId: string): boolean => {
  const key = `dungeon_rpg_save_char_${charId}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      resetStoresToDefaults();
      return false;
    }
    const parsed = JSON.parse(raw);
    const state = parsed.state ?? parsed;
    if (state && typeof state === 'object') {
      return applyBlobToStores(state as Record<string, unknown>, charId, { hydrateCharacterStats: true });
    }
  } catch {
  }
  resetStoresToDefaults();
  return false;
};

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


const oldCharKey = (baseKey: string, charId: string): string =>
  `dungeon_rpg_${baseKey}_char_${charId}`;

const migrateOldLocalStorage = (charId: string): Record<string, Record<string, unknown>> | null => {
  const blob: Record<string, Record<string, unknown>> = {};
  let found = false;

  for (const entry of STORE_ENTRIES) {
    const oldKey = oldCharKey(entry.baseKey, charId);
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
          localStorage.removeItem(key);
          break;
        } catch {
        }
      }
    }
  }

  return found ? blob : null;
};


const forceSaveCharacterData = async (charId: string): Promise<void> => {
  const activeCharacter = useCharacterStore.getState().character;
  if (activeCharacter && activeCharacter.id !== charId) {
    console.warn('[characterScope] forceSave – character.id mismatch, skipping', {
      charId, characterStoreId: activeCharacter.id,
    });
    return;
  }

  const blob: Record<string, unknown> = collectAllStores();
  blob._ownerCharacterId = charId;
  const now = new Date().toISOString();

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

  try {
    localStorage.setItem(
      `dungeon_rpg_save_char_${charId}`,
      JSON.stringify({ state: blob, updated_at: now }),
    );
  } catch {
  }

  try {
    await saveGame(charId, blob as Record<string, Record<string, unknown>>);
  } catch {
  }

  try {
    await saveCharacterToSupabase(charId);
  } catch {
  }

  try {
    await syncWeaponSkillsToSupabase(charId);
  } catch {
  }
};

export const switchToCharacter = async (newCharacterId: string): Promise<void> => {
  const oldId = _activeCharacterId;

  stopAutoSaveSubscriptions();

  if (oldId) {
    ensureOfflineTrainingRunning(true);

    await forceSaveCharacterData(oldId);
  }

  _switchInProgress = true;

  cleanStaleGlobalKeys();

  resetStoresToDefaults();

  _activeCharacterId = newCharacterId;
  localStorage.setItem(ACTIVE_CHAR_KEY, newCharacterId);

  let restored = restoreFromLocalStorageSync(newCharacterId);

  const offlineSession = useConnectivityStore.getState().snapshot !== null;
  if (!offlineSession) {
    try {
      const saved = await loadGame(newCharacterId);
      if (saved) {
        const cloudBlob: Record<string, unknown> = { ...(saved as Record<string, unknown>) };
        cloudBlob._ownerCharacterId = newCharacterId;
        const ok = applyBlobToStores(cloudBlob, newCharacterId, { hydrateCharacterStats: true });
        if (ok) restored = true;
      }
    } catch {
    }
  }

  if (!restored) {
    const migrated = migrateOldLocalStorage(newCharacterId);
    if (migrated) {
      const migBlob: Record<string, unknown> = { ...(migrated as Record<string, unknown>) };
      migBlob._ownerCharacterId = newCharacterId;
      applyBlobToStores(migBlob, newCharacterId, { hydrateCharacterStats: true });
      void saveGame(newCharacterId, migBlob);
    } else {
      resetStoresToDefaults();
    }
  }

  claimTabLock(newCharacterId);

  _switchInProgress = false;

  startAutoSaveSubscriptions();

  try {
    const restoredChar = useCharacterStore.getState().character;
    if (restoredChar && (restoredChar.hp ?? 0) <= 0) {
      useCharacterStore.getState().fullHealEffective();
    }
  } catch { }

  ensureMaxLevelPerks();
};

const ensureMaxLevelPerks = (): void => {
  const character = useCharacterStore.getState().character;
  if (!character || character.level < 1000) return;
  const classKey = character.class.toLowerCase();
  const allClassSkills = (skillsData as { activeSkills: Record<string, { id: string }[]> })
    .activeSkills[classKey] ?? [];
  if (allClassSkills.length === 0) return;
  const skillState = useSkillStore.getState();
  const current = skillState.unlockedSkills ?? {};
  const next: Record<string, boolean> = { ...current };
  let changed = false;
  for (const def of allClassSkills) {
    if (next[def.id] !== true) {
      next[def.id] = true;
      changed = true;
    }
  }
  if (changed) {
    useSkillStore.setState({ unlockedSkills: next });
  }
};

const syncWeaponSkillsToSupabase = async (charId: string): Promise<void> => {
  if (isBackendMode()) return;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const skillState = useSkillStore.getState();
  const levels = skillState.skillLevels;
  const xps = skillState.skillXp;

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

  await supabase
    .from('character_weapon_skills')
    .delete()
    .eq('character_id', charId);

  await supabase
    .from('character_weapon_skills')
    .insert(rows);
};

const saveCharacterToSupabase = async (charId: string): Promise<void> => {
  if (isBackendMode()) return;

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
  }
};

const SAVE_THROTTLE_MS = 4_000;
let _lastSaveAt = 0;
export const saveCurrentCharacterStores = async (): Promise<void> => {
  const now = Date.now();
  if (now - _lastSaveAt < SAVE_THROTTLE_MS) return;
  _lastSaveAt = now;
  await saveCurrentCharacterStoresImpl();
};

export const saveCurrentCharacterStoresForce = async (): Promise<void> => {
  _lastSaveAt = Date.now();
  await saveCurrentCharacterStoresImpl();
};

const saveCurrentCharacterStoresImpl = async (): Promise<void> => {
  if (_switchInProgress) return;

  const charId = _activeCharacterId;
  if (!charId) return;

  const activeCharacter = useCharacterStore.getState().character;
  if (activeCharacter && activeCharacter.id !== charId) {
    console.warn('[characterScope] Refused to saveCurrentCharacterStores – character.id mismatch', {
      activeCharId: charId,
      characterStoreId: activeCharacter.id,
    });
    return;
  }

  if (!thisTabOwnsLock(charId)) {
    console.warn('[characterScope] Refused to save – another tab owns this character', { charId });
    return;
  }

  refreshTabLock(charId);

  await saveCharacterToSupabase(charId);

  try {
    await syncWeaponSkillsToSupabase(charId);
  } catch {
  }

  const blob: Record<string, unknown> = collectAllStores();
  blob._ownerCharacterId = charId;
  await saveGame(charId, blob as Record<string, Record<string, unknown>>);
};

export const saveCurrentCharacterStoresSync = (): void => {
  if (_switchInProgress) return;

  if (_autoSaveTimer !== null) {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
  }
  flushStoresToLocalStorage();
};

export const deleteCharacterData = async (charId: string): Promise<void> => {
  for (const entry of STORE_ENTRIES) {
    localStorage.removeItem(oldCharKey(entry.baseKey, charId));
  }

  await deleteGameSave(charId);
};
