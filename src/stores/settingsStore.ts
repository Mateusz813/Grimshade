import { create } from 'zustand';
import i18n from '../i18n/index';

export type Language = 'pl' | 'en';
export type CombatSpeed = 'x1' | 'x2' | 'x4' | 'SKIP';
export type SkillMode = 'auto' | 'manual';
interface ISettingsState {
  language: Language;
  combatSpeed: CombatSpeed;
  skillMode: SkillMode;
  autoPotionHpEnabled: boolean;
  autoPotionMpEnabled: boolean;
  autoPotionHpThreshold: number;
  autoPotionMpThreshold: number;
  autoPotionHpId: string;
  autoPotionMpId: string;
  autoPotionPctHpEnabled: boolean;
  autoPotionPctMpEnabled: boolean;
  autoPotionPctHpThreshold: number;
  autoPotionPctMpThreshold: number;
  autoPotionPctHpId: string;
  autoPotionPctMpId: string;
  showCombatXpBar: boolean;
  keepScreenAwake: boolean;
  autoSellCommon: boolean;
  autoSellRare: boolean;
  autoSellEpic: boolean;
  autoSellLegendary: boolean;
  autoSellMythic: boolean;

  huntFilterAvailableOnly: boolean;
  huntFilterTaskedOnly: boolean;
  huntFilterMinLevel: number;
  huntFilterSortDesc: boolean;
  setHuntFilterAvailableOnly: (val: boolean) => void;
  setHuntFilterTaskedOnly: (val: boolean) => void;
  setHuntFilterMinLevel: (val: number) => void;
  setHuntFilterSortDesc: (val: boolean) => void;

  dungeonFilterAvailableOnly: boolean;
  dungeonFilterMinLevel: number;
  dungeonFilterSortDesc: boolean;
  setDungeonFilterAvailableOnly: (val: boolean) => void;
  setDungeonFilterMinLevel: (val: number) => void;
  setDungeonFilterSortDesc: (val: boolean) => void;

  raidFilterAvailableOnly: boolean;
  raidFilterMinLevel: number;
  raidFilterSortDesc: boolean;
  setRaidFilterAvailableOnly: (val: boolean) => void;
  setRaidFilterMinLevel: (val: number) => void;
  setRaidFilterSortDesc: (val: boolean) => void;

  bossFilterAvailableOnly: boolean;
  bossFilterMinLevel: number;
  bossFilterSortDesc: boolean;
  setBossFilterAvailableOnly: (val: boolean) => void;
  setBossFilterMinLevel: (val: number) => void;
  setBossFilterSortDesc: (val: boolean) => void;

  taskFilterAvailableOnly: boolean;
  taskFilterInactiveOnly: boolean;
  taskFilterSortDesc: boolean;
  taskFilterLvlFrom: string;
  setTaskFilterAvailableOnly: (val: boolean) => void;
  setTaskFilterInactiveOnly: (val: boolean) => void;
  setTaskFilterSortDesc: (val: boolean) => void;
  setTaskFilterLvlFrom: (val: string) => void;

  setShowCombatXpBar: (val: boolean) => void;
  setKeepScreenAwake: (val: boolean) => void;
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

      autoPotionHpEnabled: true,
      autoPotionMpEnabled: true,
      autoPotionHpThreshold: 50,
      autoPotionMpThreshold: 50,
      autoPotionHpId: 'hp_potion_sm',
      autoPotionMpId: 'mp_potion_sm',

      autoPotionPctHpEnabled: false,
      autoPotionPctMpEnabled: false,
      autoPotionPctHpThreshold: 40,
      autoPotionPctMpThreshold: 40,
      autoPotionPctHpId: 'hp_potion_great',
      autoPotionPctMpId: 'mp_potion_great',

      showCombatXpBar: localStorage.getItem('showCombatXpBar') !== 'false',
      keepScreenAwake: localStorage.getItem('keepScreenAwake') !== 'false',
      autoSellCommon: false,
      autoSellRare: false,
      autoSellEpic: false,
      autoSellLegendary: false,
      autoSellMythic: false,

      huntFilterAvailableOnly: false,
      huntFilterTaskedOnly: false,
      huntFilterMinLevel: 0,
      huntFilterSortDesc: false,
      setHuntFilterAvailableOnly: (huntFilterAvailableOnly) => set({ huntFilterAvailableOnly }),
      setHuntFilterTaskedOnly: (huntFilterTaskedOnly) => set({ huntFilterTaskedOnly }),
      setHuntFilterMinLevel: (huntFilterMinLevel) =>
          set({ huntFilterMinLevel: Math.max(0, Math.floor(huntFilterMinLevel || 0)) }),
      setHuntFilterSortDesc: (huntFilterSortDesc) => set({ huntFilterSortDesc }),

      dungeonFilterAvailableOnly: false,
      dungeonFilterMinLevel: 0,
      dungeonFilterSortDesc: false,
      setDungeonFilterAvailableOnly: (dungeonFilterAvailableOnly) => set({ dungeonFilterAvailableOnly }),
      setDungeonFilterMinLevel: (dungeonFilterMinLevel) =>
          set({ dungeonFilterMinLevel: Math.max(0, Math.floor(dungeonFilterMinLevel || 0)) }),
      setDungeonFilterSortDesc: (dungeonFilterSortDesc) => set({ dungeonFilterSortDesc }),

      raidFilterAvailableOnly: false,
      raidFilterMinLevel: 0,
      raidFilterSortDesc: false,
      setRaidFilterAvailableOnly: (raidFilterAvailableOnly) => set({ raidFilterAvailableOnly }),
      setRaidFilterMinLevel: (raidFilterMinLevel) =>
          set({ raidFilterMinLevel: Math.max(0, Math.floor(raidFilterMinLevel || 0)) }),
      setRaidFilterSortDesc: (raidFilterSortDesc) => set({ raidFilterSortDesc }),

      bossFilterAvailableOnly: false,
      bossFilterMinLevel: 0,
      bossFilterSortDesc: false,
      setBossFilterAvailableOnly: (bossFilterAvailableOnly) => set({ bossFilterAvailableOnly }),
      setBossFilterMinLevel: (bossFilterMinLevel) =>
          set({ bossFilterMinLevel: Math.max(0, Math.floor(bossFilterMinLevel || 0)) }),
      setBossFilterSortDesc: (bossFilterSortDesc) => set({ bossFilterSortDesc }),

      taskFilterAvailableOnly: false,
      taskFilterInactiveOnly: false,
      taskFilterSortDesc: false,
      taskFilterLvlFrom: '',
      setTaskFilterAvailableOnly: (taskFilterAvailableOnly) => set({ taskFilterAvailableOnly }),
      setTaskFilterInactiveOnly: (taskFilterInactiveOnly) => set({ taskFilterInactiveOnly }),
      setTaskFilterSortDesc: (taskFilterSortDesc) => set({ taskFilterSortDesc }),
      setTaskFilterLvlFrom: (taskFilterLvlFrom) => set({ taskFilterLvlFrom }),

      setShowCombatXpBar: (showCombatXpBar) => {
        localStorage.setItem('showCombatXpBar', String(showCombatXpBar));
        set({ showCombatXpBar });
      },
      setKeepScreenAwake: (keepScreenAwake) => {
        localStorage.setItem('keepScreenAwake', String(keepScreenAwake));
        set({ keepScreenAwake });
      },
      setLanguage: (language) => { void i18n.changeLanguage(language); set({ language }); },
      setCombatSpeed: (combatSpeed) => set({ combatSpeed }),
      setSkillMode: (skillMode) => set({ skillMode }),

      setAutoPotionHpEnabled: (autoPotionHpEnabled) => set({ autoPotionHpEnabled }),
      setAutoPotionMpEnabled: (autoPotionMpEnabled) => set({ autoPotionMpEnabled }),
      setAutoPotionHpThreshold: (autoPotionHpThreshold) => set({ autoPotionHpThreshold }),
      setAutoPotionMpThreshold: (autoPotionMpThreshold) => set({ autoPotionMpThreshold }),
      setAutoPotionHpId: (autoPotionHpId) => set({ autoPotionHpId }),
      setAutoPotionMpId: (autoPotionMpId) => set({ autoPotionMpId }),

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
