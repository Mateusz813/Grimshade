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
