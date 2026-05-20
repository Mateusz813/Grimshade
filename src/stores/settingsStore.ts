import { create } from 'zustand';
import i18n from '../i18n/index';

export type Language = 'pl' | 'en';
export type CombatSpeed = 'x1' | 'x2' | 'x4' | 'SKIP';
export type SkillMode = 'auto' | 'manual';
interface ISettingsState {
  language: Language;
  combatSpeed: CombatSpeed;
  skillMode: SkillMode;
  // Slot 1: flat (non-%) potions
  autoPotionHpEnabled: boolean;
  autoPotionMpEnabled: boolean;
  autoPotionHpThreshold: number;
  autoPotionMpThreshold: number;
  autoPotionHpId: string;
  autoPotionMpId: string;
  // Slot 2: percentage-based potions (Great, Super, Ultimate, Divine)
  autoPotionPctHpEnabled: boolean;
  autoPotionPctMpEnabled: boolean;
  autoPotionPctHpThreshold: number;
  autoPotionPctMpThreshold: number;
  autoPotionPctHpId: string;
  autoPotionPctMpId: string;
  showCombatXpBar: boolean;
  autoSellCommon: boolean;
  autoSellRare: boolean;
  autoSellEpic: boolean;
  autoSellLegendary: boolean;
  autoSellMythic: boolean;

  /** Hunt-hub filters (persisted per character via characterScope). */
  huntFilterAvailableOnly: boolean;
  huntFilterTaskedOnly: boolean;
  /** Minimum monster level to show in the hub list (0 = no minimum). */
  huntFilterMinLevel: number;
  /** Sort the hub list by descending level (highest first) when true. */
  huntFilterSortDesc: boolean;
  setHuntFilterAvailableOnly: (val: boolean) => void;
  setHuntFilterTaskedOnly: (val: boolean) => void;
  setHuntFilterMinLevel: (val: number) => void;
  setHuntFilterSortDesc: (val: boolean) => void;

  /** Dungeon-list filters — same per-character persistence pattern as the
   *  hunt filters above. `dungeonFilterAvailableOnly` hides locked/exhausted
   *  dungeons, `dungeonFilterMinLevel` is the input the player types to
   *  hide everything below their chosen floor, and `dungeonFilterSortDesc`
   *  flips the list to highest-level-first. All three persist to the active
   *  character's scope so they survive across sessions and classes. */
  dungeonFilterAvailableOnly: boolean;
  dungeonFilterMinLevel: number;
  dungeonFilterSortDesc: boolean;
  setDungeonFilterAvailableOnly: (val: boolean) => void;
  setDungeonFilterMinLevel: (val: number) => void;
  setDungeonFilterSortDesc: (val: boolean) => void;

  /** Raid-list filters — independent of the dungeon ones so a player can
   *  filter raids without disturbing their dungeon view. Same persistence
   *  contract (per-character via characterScope). */
  raidFilterAvailableOnly: boolean;
  raidFilterMinLevel: number;
  raidFilterSortDesc: boolean;
  setRaidFilterAvailableOnly: (val: boolean) => void;
  setRaidFilterMinLevel: (val: number) => void;
  setRaidFilterSortDesc: (val: boolean) => void;

  /** Boss-list filters — same persistence contract as the dungeon/raid
   *  filters. Independent slice so a player can narrow the boss roster
   *  without affecting the dungeon or raid views. */
  bossFilterAvailableOnly: boolean;
  bossFilterMinLevel: number;
  bossFilterSortDesc: boolean;
  setBossFilterAvailableOnly: (val: boolean) => void;
  setBossFilterMinLevel: (val: number) => void;
  setBossFilterSortDesc: (val: boolean) => void;

  setShowCombatXpBar: (val: boolean) => void;
  setLanguage: (lang: Language) => void;
  setCombatSpeed: (speed: CombatSpeed) => void;
  setSkillMode: (mode: SkillMode) => void;
  setAutoPotionHpEnabled: (val: boolean) => void;
  setAutoPotionMpEnabled: (val: boolean) => void;
  setAutoPotionHpThreshold: (val: number) => void;
  setAutoPotionMpThreshold: (val: number) => void;
  setAutoPotionHpId: (id: string) => void;
  setAutoPotionMpId: (id: string) => void;
  setAutoPotionPctHpEnabled: (val: boolean) => void;
  setAutoPotionPctMpEnabled: (val: boolean) => void;
  setAutoPotionPctHpThreshold: (val: number) => void;
  setAutoPotionPctMpThreshold: (val: number) => void;
  setAutoPotionPctHpId: (id: string) => void;
  setAutoPotionPctMpId: (id: string) => void;
  setAutoSellCommon: (val: boolean) => void;
  setAutoSellRare: (val: boolean) => void;
  setAutoSellEpic: (val: boolean) => void;
  setAutoSellLegendary: (val: boolean) => void;
  setAutoSellMythic: (val: boolean) => void;
}

export const useSettingsStore = create<ISettingsState>()(
    (set) => ({
      language: 'pl',
      combatSpeed: 'x1',
      skillMode: 'auto',

      // Slot 1: flat potions
      autoPotionHpEnabled: true,
      autoPotionMpEnabled: true,
      autoPotionHpThreshold: 50,
      autoPotionMpThreshold: 50,
      autoPotionHpId: 'hp_potion_sm',
      autoPotionMpId: 'mp_potion_sm',

      // Slot 2: percentage potions
      autoPotionPctHpEnabled: false,
      autoPotionPctMpEnabled: false,
      autoPotionPctHpThreshold: 40,
      autoPotionPctMpThreshold: 40,
      autoPotionPctHpId: 'hp_potion_great',
      autoPotionPctMpId: 'mp_potion_great',

      showCombatXpBar: localStorage.getItem('showCombatXpBar') !== 'false',
      autoSellCommon: false,
      autoSellRare: false,
      autoSellEpic: false,
      autoSellLegendary: false,
      autoSellMythic: false,

      // Hunt-hub filters — defaults are "show everything" so existing
      // characters open the hub looking exactly like before the filter bar
      // landed. Per-character persistence happens through characterScope.
      huntFilterAvailableOnly: false,
      huntFilterTaskedOnly: false,
      huntFilterMinLevel: 0,
      huntFilterSortDesc: false,
      setHuntFilterAvailableOnly: (huntFilterAvailableOnly) => set({ huntFilterAvailableOnly }),
      setHuntFilterTaskedOnly: (huntFilterTaskedOnly) => set({ huntFilterTaskedOnly }),
      setHuntFilterMinLevel: (huntFilterMinLevel) =>
          set({ huntFilterMinLevel: Math.max(0, Math.floor(huntFilterMinLevel || 0)) }),
      setHuntFilterSortDesc: (huntFilterSortDesc) => set({ huntFilterSortDesc }),

      // Dungeon filters — defaults match "show everything" so existing
      // characters open the list looking exactly like before. Per-character
      // persistence happens through characterScope (same as hunt filters).
      dungeonFilterAvailableOnly: false,
      dungeonFilterMinLevel: 0,
      dungeonFilterSortDesc: false,
      setDungeonFilterAvailableOnly: (dungeonFilterAvailableOnly) => set({ dungeonFilterAvailableOnly }),
      setDungeonFilterMinLevel: (dungeonFilterMinLevel) =>
          set({ dungeonFilterMinLevel: Math.max(0, Math.floor(dungeonFilterMinLevel || 0)) }),
      setDungeonFilterSortDesc: (dungeonFilterSortDesc) => set({ dungeonFilterSortDesc }),

      // Raid filters — same defaults & semantics as dungeon filters; the
      // raid hub is the dungeon hub's harder sibling so visual parity calls
      // for behavioural parity in the controls.
      raidFilterAvailableOnly: false,
      raidFilterMinLevel: 0,
      raidFilterSortDesc: false,
      setRaidFilterAvailableOnly: (raidFilterAvailableOnly) => set({ raidFilterAvailableOnly }),
      setRaidFilterMinLevel: (raidFilterMinLevel) =>
          set({ raidFilterMinLevel: Math.max(0, Math.floor(raidFilterMinLevel || 0)) }),
      setRaidFilterSortDesc: (raidFilterSortDesc) => set({ raidFilterSortDesc }),

      // Boss filters — same defaults & semantics as dungeon/raid filters.
      // Independent slice so a player can narrow the boss roster without
      // affecting other hub views. Per-character persistence handled by
      // characterScope (see stateKeys list there).
      bossFilterAvailableOnly: false,
      bossFilterMinLevel: 0,
      bossFilterSortDesc: false,
      setBossFilterAvailableOnly: (bossFilterAvailableOnly) => set({ bossFilterAvailableOnly }),
      setBossFilterMinLevel: (bossFilterMinLevel) =>
          set({ bossFilterMinLevel: Math.max(0, Math.floor(bossFilterMinLevel || 0)) }),
      setBossFilterSortDesc: (bossFilterSortDesc) => set({ bossFilterSortDesc }),

      setShowCombatXpBar: (showCombatXpBar) => {
        localStorage.setItem('showCombatXpBar', String(showCombatXpBar));
        set({ showCombatXpBar });
      },
      setLanguage: (language) => { void i18n.changeLanguage(language); set({ language }); },
      setCombatSpeed: (combatSpeed) => set({ combatSpeed }),
      setSkillMode: (skillMode) => set({ skillMode }),

      // Slot 1 setters
      setAutoPotionHpEnabled: (autoPotionHpEnabled) => set({ autoPotionHpEnabled }),
      setAutoPotionMpEnabled: (autoPotionMpEnabled) => set({ autoPotionMpEnabled }),
      setAutoPotionHpThreshold: (autoPotionHpThreshold) => set({ autoPotionHpThreshold }),
      setAutoPotionMpThreshold: (autoPotionMpThreshold) => set({ autoPotionMpThreshold }),
      setAutoPotionHpId: (autoPotionHpId) => set({ autoPotionHpId }),
      setAutoPotionMpId: (autoPotionMpId) => set({ autoPotionMpId }),

      // Slot 2 setters
      setAutoPotionPctHpEnabled: (autoPotionPctHpEnabled) => set({ autoPotionPctHpEnabled }),
      setAutoPotionPctMpEnabled: (autoPotionPctMpEnabled) => set({ autoPotionPctMpEnabled }),
      setAutoPotionPctHpThreshold: (autoPotionPctHpThreshold) => set({ autoPotionPctHpThreshold }),
      setAutoPotionPctMpThreshold: (autoPotionPctMpThreshold) => set({ autoPotionPctMpThreshold }),
      setAutoPotionPctHpId: (autoPotionPctHpId) => set({ autoPotionPctHpId }),
      setAutoPotionPctMpId: (autoPotionPctMpId) => set({ autoPotionPctMpId }),

      setAutoSellCommon: (autoSellCommon) => set({ autoSellCommon }),
      setAutoSellRare: (autoSellRare) => set({ autoSellRare }),
      setAutoSellEpic: (autoSellEpic) => set({ autoSellEpic }),
      setAutoSellLegendary: (autoSellLegendary) => set({ autoSellLegendary }),
      setAutoSellMythic: (autoSellMythic) => set({ autoSellMythic }),
    }),
);
