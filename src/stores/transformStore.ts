
import { create } from 'zustand';
import type { TCharacterClass } from '../api/v1/characterApi';
import {
  getTransformMonsters,
  getTransformById,
  getNextAvailableTransform,
  getHighestCompletedTransform as getHighestCompleted,
  getActiveAvatar as computeActiveAvatar,
  getCumulativeTransformBonuses,
  getClassTransformBonuses,
  type ITransformData,
  type ICumulativeTransformBonuses,
  type ITransformColor,
} from '../systems/transformSystem';
import { getTransformColor } from '../systems/transformSystem';
import { useCharacterStore, computeBaseStatFloor } from './characterStore';


export interface ITransformQuestState {
  transformId: number;
  monstersDefeated: string[];
  totalMonsters: number;
  inProgress: boolean;
}

export interface ITransformPermanentBonuses {
  hpPercent: number;
  mpPercent: number;
  defPercent: number;
  dmgPercent: number;
  atkPercent: number;
  flatHp: number;
  flatMp: number;
  attack: number;
  defense: number;
  hpRegen: number;
  mpRegen: number;
  hpRegenFlat: number;
  mpRegenFlat: number;
  classSkillBonus: number;
}


interface ITransformStore {
  completedTransforms: number[];
  currentTransformQuest: ITransformQuestState | null;
  bakedBonusesApplied: boolean;
  transformMigrationVersion: number;
  pendingClaimTransformId: number | null;


  startTransformQuest: (transformId: number, characterLevel: number) => boolean;

  defeatMonster: (monsterId: string) => boolean;

  isQuestComplete: () => boolean;

  completeTransform: () => number;

  abandonTransformQuest: () => void;

  claimPendingReward: () => number | null;


  getNextAvailableTransform: (characterLevel: number) => ITransformData | null;

  getHighestCompletedTransform: () => number;

  getActiveAvatar: (characterClass: TCharacterClass) => string | null;

  isTransformAvailable: (transformId: number, characterLevel: number) => boolean;

  getPermanentBonuses: (characterClass?: TCharacterClass) => ICumulativeTransformBonuses;

  getHighestTransformColor: () => ITransformColor | null;

  isQuestInProgress: () => boolean;

  getQuestProgress: () => number;

  getRemainingMonsters: () => string[];

  migrateLegacyBakedBonuses: () => boolean;
}


export const useTransformStore = create<ITransformStore>()(
  (set, get) => ({
    completedTransforms: [],
    currentTransformQuest: null,
    bakedBonusesApplied: false,
    transformMigrationVersion: 0,
    pendingClaimTransformId: null,


    startTransformQuest: (transformId: number, characterLevel: number): boolean => {
      const { completedTransforms, currentTransformQuest } = get();

      if (currentTransformQuest?.inProgress) return false;

      const transform = getTransformById(transformId);
      if (!transform) return false;

      if (characterLevel < transform.level) return false;

      for (let i = 1; i < transformId; i++) {
        if (!completedTransforms.includes(i)) return false;
      }

      if (completedTransforms.includes(transformId)) return false;

      const monsters = getTransformMonsters(transformId);

      set({
        currentTransformQuest: {
          transformId,
          monstersDefeated: [],
          totalMonsters: monsters.length,
          inProgress: true,
        },
      });

      return true;
    },

    defeatMonster: (monsterId: string): boolean => {
      const { currentTransformQuest, pendingClaimTransformId } = get();
      if (!currentTransformQuest || !currentTransformQuest.inProgress) return false;

      const questMonsters = getTransformMonsters(currentTransformQuest.transformId);
      const isValidMonster = questMonsters.some((m) => m.id === monsterId);
      if (!isValidMonster) return false;

      if (currentTransformQuest.monstersDefeated.includes(monsterId)) return true;

      const newDefeated = [...currentTransformQuest.monstersDefeated, monsterId];
      const isFullyComplete = newDefeated.length >= currentTransformQuest.totalMonsters;

      const lockClaim = isFullyComplete && pendingClaimTransformId == null;

      set({
        currentTransformQuest: {
          ...currentTransformQuest,
          monstersDefeated: newDefeated,
        },
        ...(lockClaim ? { pendingClaimTransformId: currentTransformQuest.transformId } : {}),
      });

      return true;
    },

    isQuestComplete: (): boolean => {
      const { currentTransformQuest } = get();
      if (!currentTransformQuest || !currentTransformQuest.inProgress) return false;
      return currentTransformQuest.monstersDefeated.length >= currentTransformQuest.totalMonsters;
    },

    completeTransform: (): number => {
      const { currentTransformQuest, completedTransforms, pendingClaimTransformId } = get();

      if (
        currentTransformQuest?.inProgress &&
        currentTransformQuest.monstersDefeated.length >= currentTransformQuest.totalMonsters
      ) {
        const completedId = currentTransformQuest.transformId;
        const alreadyCompleted = completedTransforms.includes(completedId);

        set({
          completedTransforms: alreadyCompleted
            ? completedTransforms
            : [...completedTransforms, completedId],
          currentTransformQuest: null,
          pendingClaimTransformId: pendingClaimTransformId ?? completedId,
        });

        return completedId;
      }

      if (pendingClaimTransformId != null) {
        if (!completedTransforms.includes(pendingClaimTransformId)) {
          set({
            completedTransforms: [...completedTransforms, pendingClaimTransformId],
          });
        }
        return pendingClaimTransformId;
      }

      return 0;
    },

    abandonTransformQuest: (): void => {
      set({ currentTransformQuest: null });
    },

    claimPendingReward: (): number | null => {
      const { pendingClaimTransformId } = get();
      if (pendingClaimTransformId == null) return null;
      set({ pendingClaimTransformId: null });
      return pendingClaimTransformId;
    },


    getNextAvailableTransform: (characterLevel: number): ITransformData | null => {
      return getNextAvailableTransform(get().completedTransforms, characterLevel);
    },

    getHighestCompletedTransform: (): number => {
      return getHighestCompleted(get().completedTransforms);
    },

    getActiveAvatar: (characterClass: TCharacterClass): string | null => {
      return computeActiveAvatar(characterClass, get().completedTransforms);
    },

    isTransformAvailable: (transformId: number, characterLevel: number): boolean => {
      const { completedTransforms, currentTransformQuest } = get();

      if (completedTransforms.includes(transformId)) return false;

      if (currentTransformQuest?.inProgress && currentTransformQuest.transformId !== transformId) {
        return false;
      }

      const transform = getTransformById(transformId);
      if (!transform) return false;

      if (characterLevel < transform.level) return false;

      for (let i = 1; i < transformId; i++) {
        if (!completedTransforms.includes(i)) return false;
      }

      return true;
    },

    getPermanentBonuses: (characterClass?: TCharacterClass): ICumulativeTransformBonuses => {
      return getCumulativeTransformBonuses(get().completedTransforms, characterClass);
    },

    getHighestTransformColor: (): ITransformColor | null => {
      const highest = get().getHighestCompletedTransform();
      if (highest === 0) return null;
      return getTransformColor(highest);
    },

    isQuestInProgress: (): boolean => {
      return get().currentTransformQuest?.inProgress ?? false;
    },

    getQuestProgress: (): number => {
      const quest = get().currentTransformQuest;
      if (!quest || !quest.inProgress || quest.totalMonsters === 0) return 0;
      return quest.monstersDefeated.length / quest.totalMonsters;
    },

    getRemainingMonsters: (): string[] => {
      const quest = get().currentTransformQuest;
      if (!quest || !quest.inProgress) return [];

      const allMonsters = getTransformMonsters(quest.transformId);
      const defeatedSet = new Set(quest.monstersDefeated);
      return allMonsters
        .filter((m) => !defeatedSet.has(m.id))
        .map((m) => m.id);
    },

    migrateLegacyBakedBonuses: (): boolean => {
      const { bakedBonusesApplied, completedTransforms } = get();
      if (!bakedBonusesApplied) return false;
      if (!completedTransforms || completedTransforms.length === 0) {
        set({ bakedBonusesApplied: false });
        return true;
      }

      const character = useCharacterStore.getState().character;
      if (!character) return false;
      const cls = character.class as TCharacterClass;

      const floor = computeBaseStatFloor(cls, character.highest_level ?? character.level);
      if (character.max_mp < floor.max_mp || character.max_hp < floor.max_hp) {
        set({ bakedBonusesApplied: false });
        console.warn(
          `[transformStore] Skipped legacy unbake for ${cls} — base already below ` +
          `floor (HP ${character.max_hp}/${floor.max_hp}, MP ${character.max_mp}/${floor.max_mp}). ` +
          `Bonuses now apply live; healCorruptedBaseStats will repair the base.`,
        );
        return true;
      }

      const sortedIds = [...completedTransforms].sort((a, b) => b - a);

      let curMaxHp    = character.max_hp;
      let curMaxMp    = character.max_mp;
      let curDefense  = character.defense;
      let curAttack   = character.attack;
      let curHpRegen  = character.hp_regen ?? 0;
      let curMpRegen  = character.mp_regen ?? 0;

      for (const tid of sortedIds) {
        if (!getTransformById(tid)) continue;
        const per = getClassTransformBonuses(cls, tid);
        const hpPctMul  = 1 + per.hpPercent / 100;
        const mpPctMul  = 1 + per.mpPercent / 100;
        const defPctMul = 1 + per.defPercent / 100;

        curMaxHp   = Math.max(floor.max_hp, Math.round((curMaxHp  - per.flatHp) / hpPctMul));
        curMaxMp   = Math.max(floor.max_mp, Math.round((curMaxMp  - per.flatMp) / mpPctMul));
        curDefense = Math.round((curDefense - per.defense) / defPctMul);
        curAttack  = curAttack - per.attack;
        curHpRegen = curHpRegen - per.hpRegenFlat;
        curMpRegen = curMpRegen - per.mpRegenFlat;
      }

      const newMaxHp   = Math.max(floor.max_hp, curMaxHp);
      const newMaxMp   = Math.max(floor.max_mp, curMaxMp);
      const newAttack  = Math.max(1, curAttack);
      const newDefense = Math.max(0, curDefense);
      const newHpRegen = Math.max(0, curHpRegen);
      const newMpRegen = Math.max(0, curMpRegen);

      useCharacterStore.getState().updateCharacter({
        max_hp: newMaxHp,
        max_mp: newMaxMp,
        hp: Math.min(character.hp, newMaxHp),
        mp: Math.min(character.mp, newMaxMp),
        attack: newAttack,
        defense: newDefense,
        hp_regen: newHpRegen,
        mp_regen: newMpRegen,
      });

      set({ bakedBonusesApplied: false });
      console.info(
        `[transformStore] Migrated legacy baked bonuses for ${cls}: ` +
        `HP ${character.max_hp}->${newMaxHp}, MP ${character.max_mp}->${newMaxMp}, ` +
        `ATK ${character.attack}->${newAttack}, DEF ${character.defense}->${newDefense}. ` +
        `Transform bonuses now apply live.`,
      );
      return true;
    },
  }),
);
