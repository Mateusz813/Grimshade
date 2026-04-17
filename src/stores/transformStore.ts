/**
 * Transform Store – per-character state for the transformation progression system.
 *
 * Tracks completed transforms, the active transform quest (which monsters
 * have been defeated), and cumulative permanent bonuses.
 *
 * Registered in characterScope.ts for per-character persistence.
 */

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
import { useCharacterStore } from './characterStore';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ITransformQuestState {
  transformId: number;
  /** Monster IDs already defeated during this quest. */
  monstersDefeated: string[];
  /** Total monsters required for this transform. */
  totalMonsters: number;
  /** Whether the quest is actively in progress. */
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

// ── Store interface ──────────────────────────────────────────────────────────

interface ITransformStore {
  /** Array of completed transform IDs (1-11). */
  completedTransforms: number[];
  /** Currently active transform quest, or null if none. */
  currentTransformQuest: ITransformQuestState | null;
  /**
   * Point 7: when `true`, transform bonuses are still baked into
   * character.max_hp / max_mp / attack / defense / regen (legacy behaviour).
   * When `false`, they are applied LIVE in getEffectiveChar via
   * transformBonuses.ts so they scale with base stat changes.
   *
   * New characters start with `false`. Legacy saves load with `true` and are
   * migrated via `migrateLegacyBakedBonuses()` on first boot.
   */
  bakedBonusesApplied: boolean;

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Start a transform quest. Validates order and level requirement.
   * Returns true if quest was started, false if preconditions not met.
   */
  startTransformQuest: (transformId: number, characterLevel: number) => boolean;

  /**
   * Record a defeated monster during the active transform quest.
   * Returns true if monster was valid and recorded (or already defeated).
   * Returns false if no quest is active or monster is not part of the quest.
   */
  defeatMonster: (monsterId: string) => boolean;

  /**
   * Check if the current transform quest is complete (all monsters defeated).
   */
  isQuestComplete: () => boolean;

  /**
   * Complete the active transform quest. Moves the transform ID to completedTransforms
   * and clears the quest state. Returns the transform ID that was completed, or 0 if
   * no quest was active or quest is not yet complete.
   */
  completeTransform: () => number;

  /**
   * Abandon the current transform quest without completing it.
   * Progress is lost.
   */
  abandonTransformQuest: () => void;

  // ── Getters ──────────────────────────────────────────────────────────────

  /** Get the next available transform for the character, or null. */
  getNextAvailableTransform: (characterLevel: number) => ITransformData | null;

  /** Get the highest completed transform number (0 if none). */
  getHighestCompletedTransform: () => number;

  /** Get the avatar filename for the character, or null if no transform done. */
  getActiveAvatar: (characterClass: TCharacterClass) => string | null;

  /** Check if a specific transform ID is available to start. */
  isTransformAvailable: (transformId: number, characterLevel: number) => boolean;

  /** Get cumulative permanent bonuses from all completed transforms for a class. */
  getPermanentBonuses: (characterClass?: TCharacterClass) => ICumulativeTransformBonuses;

  /** Get the color info for the highest completed transform. */
  getHighestTransformColor: () => ITransformColor | null;

  /** Check if a transform quest is currently in progress. */
  isQuestInProgress: () => boolean;

  /** Get quest progress as a fraction (0-1). Returns 0 if no quest active. */
  getQuestProgress: () => number;

  /** Get the list of monster IDs still remaining in the active quest. */
  getRemainingMonsters: () => string[];

  /**
   * Point 7 migration: if an existing save still has its transform bonuses
   * baked into character stats, compute how much they inflated each stat by
   * forward-iterating over completedTransforms (same formula the old Transform
   * view used), subtract the delta from the character, and flip
   * `bakedBonusesApplied` to false. Idempotent — does nothing when the flag
   * is already false. Returns true if migration ran, false otherwise.
   */
  migrateLegacyBakedBonuses: () => boolean;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useTransformStore = create<ITransformStore>()(
  (set, get) => ({
    completedTransforms: [],
    currentTransformQuest: null,
    // New characters default to live bonuses; characterScope persists this
    // field so loading a legacy save (without the key) falls back to `true`
    // via the migration path below.
    bakedBonusesApplied: false,

    // ── Actions ────────────────────────────────────────────────────────────

    startTransformQuest: (transformId: number, characterLevel: number): boolean => {
      const { completedTransforms, currentTransformQuest } = get();

      // Cannot start if a quest is already in progress
      if (currentTransformQuest?.inProgress) return false;

      const transform = getTransformById(transformId);
      if (!transform) return false;

      // Level check
      if (characterLevel < transform.level) return false;

      // Order check: all previous transforms must be completed
      for (let i = 1; i < transformId; i++) {
        if (!completedTransforms.includes(i)) return false;
      }

      // Cannot redo a completed transform
      if (completedTransforms.includes(transformId)) return false;

      // Get monsters for this transform
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
      const { currentTransformQuest } = get();
      if (!currentTransformQuest || !currentTransformQuest.inProgress) return false;

      // Check if this monster is part of the quest
      const questMonsters = getTransformMonsters(currentTransformQuest.transformId);
      const isValidMonster = questMonsters.some((m) => m.id === monsterId);
      if (!isValidMonster) return false;

      // Already defeated – still return true (idempotent)
      if (currentTransformQuest.monstersDefeated.includes(monsterId)) return true;

      set({
        currentTransformQuest: {
          ...currentTransformQuest,
          monstersDefeated: [...currentTransformQuest.monstersDefeated, monsterId],
        },
      });

      return true;
    },

    isQuestComplete: (): boolean => {
      const { currentTransformQuest } = get();
      if (!currentTransformQuest || !currentTransformQuest.inProgress) return false;
      return currentTransformQuest.monstersDefeated.length >= currentTransformQuest.totalMonsters;
    },

    completeTransform: (): number => {
      const { currentTransformQuest, completedTransforms } = get();
      if (!currentTransformQuest || !currentTransformQuest.inProgress) return 0;

      // Verify all monsters are defeated
      if (currentTransformQuest.monstersDefeated.length < currentTransformQuest.totalMonsters) {
        return 0;
      }

      const completedId = currentTransformQuest.transformId;

      set({
        completedTransforms: [...completedTransforms, completedId],
        currentTransformQuest: null,
      });

      return completedId;
    },

    abandonTransformQuest: (): void => {
      set({ currentTransformQuest: null });
    },

    // ── Getters ────────────────────────────────────────────────────────────

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

      // Already completed
      if (completedTransforms.includes(transformId)) return false;

      // Quest already in progress for a different transform
      if (currentTransformQuest?.inProgress && currentTransformQuest.transformId !== transformId) {
        return false;
      }

      const transform = getTransformById(transformId);
      if (!transform) return false;

      // Level check
      if (characterLevel < transform.level) return false;

      // Order check
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
      // Already migrated (or never baked).
      if (!bakedBonusesApplied) return false;
      if (!completedTransforms || completedTransforms.length === 0) {
        // Nothing baked to undo, just flip the flag so live bonuses kick in.
        set({ bakedBonusesApplied: false });
        return true;
      }

      const character = useCharacterStore.getState().character;
      if (!character) return false;
      const cls = character.class as TCharacterClass;

      // Forward-iterate in completion order, mirroring the old
      // handleCompleteTransform formula exactly, to compute the total delta
      // each completed transform added at claim time. We start from the
      // character's CURRENT stats and walk backwards — since the formula
      // uses floor(curMaxHp * pct / 100) at each step, we solve for the
      // pre-transform value iteratively via geometric inverse.
      //
      // Each step: postMaxHp = preMaxHp + floor(preMaxHp * pct/100) + flatHp
      //         ⇒ preMaxHp ≈ (postMaxHp - flatHp) / (1 + pct/100)
      // That's close enough (floor introduces <1 rounding per step) that
      // after 11 transforms total error is <12 HP — negligible.
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

        curMaxHp   = Math.round((curMaxHp  - per.flatHp) / hpPctMul);
        curMaxMp   = Math.round((curMaxMp  - per.flatMp) / mpPctMul);
        curDefense = Math.round((curDefense - per.defense) / defPctMul);
        curAttack  = curAttack - per.attack;
        curHpRegen = curHpRegen - per.hpRegenFlat;
        curMpRegen = curMpRegen - per.mpRegenFlat;
      }

      // Clamp so we never go below 1 in anything — if the baked values were
      // weird (e.g. old pre-rebalance bonuses) we'd rather lose a bit of
      // power than break the character.
      const newMaxHp   = Math.max(1, curMaxHp);
      const newMaxMp   = Math.max(0, curMaxMp);
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
      // eslint-disable-next-line no-console
      console.info(
        `[transformStore] Migrated legacy baked bonuses for ${cls}: ` +
        `HP ${character.max_hp}→${newMaxHp}, MP ${character.max_mp}→${newMaxMp}, ` +
        `ATK ${character.attack}→${newAttack}, DEF ${character.defense}→${newDefense}. ` +
        `Transform bonuses now apply live.`,
      );
      return true;
    },
  }),
);
