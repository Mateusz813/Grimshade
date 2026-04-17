import { create } from 'zustand';
import {
    processSkillXp,
    getClassWeaponSkills,
    calculateOfflineSkillXp,
    shieldingXpPerBlock,
    mlvlXpPerAttack,
    mlvlXpPerSkillUse,
    doesClassGainMlvlFromAttacks,
    MAX_OFFLINE_TRAINING_SECONDS,
    getSkillUpgradeCost,
    rollSkillUpgrade,
    GENERAL_TRAINABLE_STATS,
    getSpellChestUpgradeCost,
    CLASS_WEAPON_SKILL,
} from '../systems/skillSystem';
import { useBuffStore } from './buffStore';
import type { CharacterClass } from '../api/v1/characterApi';

/**
 * Probe whether an offline hunt is currently active. Uses a late dynamic
 * lookup against globalThis to avoid a circular import with offlineHuntStore
 * (which itself imports skillStore). The offlineHuntStore registers itself
 * on globalThis at module load time.
 */
const isOfflineHuntActive = (): boolean => {
    const mod = (globalThis as unknown as {
        __offlineHuntStore?: { getState: () => { isActive: boolean } };
    }).__offlineHuntStore;
    return mod?.getState().isActive === true;
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ISkillUpgradeResult {
    success: boolean;
    newLevel: number;
    goldSpent: number;
    chestsSpent: number;
}

export interface ISkillState {
    /** weapon/magic skill id → level (0–∞) */
    skillLevels: Record<string, number>;
    /** weapon/magic skill id → current XP towards next level */
    skillXp: Record<string, number>;
    /** active skill slot ids (max 4) – ordered array of active skill IDs */
    activeSkillSlots: [string | null, string | null, string | null, string | null];
    /** active skill id → upgrade level (0+) */
    skillUpgradeLevels: Record<string, number>;
    /** Set of active skill IDs that have been purchased/unlocked with gold */
    unlockedSkills: Record<string, boolean>;
    /** id of skill chosen for always-on training (trains continuously when set) */
    offlineTrainingSkillId: string | null;
    /** ISO timestamp of when the current speed segment started */
    trainingSegmentStartedAt: string | null;
    /** Accumulated effective training seconds (segments × their speed multiplier) */
    trainingAccumulatedEffectiveSeconds: number;
    /** Current training speed: 2 = active play, 1 = inactive/background */
    trainingCurrentSpeedMultiplier: number;
}

interface ISkillStore extends ISkillState {
    /** Init skill levels for all weapon skills of the given class (sets to 0 if missing) */
    initSkills: (cls: CharacterClass) => void;
    /** Add XP to a weapon/magic skill; returns levelsGained */
    addSkillXp: (skillId: string, xp: number) => number;
    /** Apply death penalty to all active weapon skills */
    applyDeathPenalty: (cls: CharacterClass) => void;
    /** Set active skill in a slot (0-3); pass null to clear the slot */
    setActiveSkillSlot: (slot: 0 | 1 | 2 | 3, skillId: string | null) => void;
    /** Start always-on training for a skill (begins at given speed multiplier) */
    startOfflineTraining: (skillId: string, speedMultiplier?: number) => void;
    /**
     * Select a training stat. Immediately starts training at 2x (active) speed.
     * Training runs ALWAYS — 2x when active, 1x when inactive.
     */
    selectTrainingStat: (skillId: string) => void;
    /** Collect XP accumulated during training, reset counters, restart segment */
    collectOfflineTraining: () => number;
    /** Called when player activity state changes. Flushes current segment and sets new speed. */
    onActivityChange: (isActive: boolean) => void;
    /**
     * Pause the always-on training WITHOUT forgetting the selected skill.
     * Flushes the current segment's XP into accumulated bucket and clears
     * the segment timestamp so no new seconds accrue until resumeTraining()
     * is called. Used by offline hunt for mutual exclusion.
     */
    pauseTraining: () => void;
    /**
     * Resume always-on training after a pause. No-op if no skill is selected
     * or the training is already running. Starts a fresh segment at 2x
     * (assumes the player is now active — the activity tracker will throttle
     * it back to 1x after the inactivity timeout).
     */
    resumeTraining: () => void;
    /** Add Shielding XP when a block occurs (Knight only) */
    addShieldingXpOnBlock: () => number;
    /** Add MLVL XP from an auto-attack (magic classes only) */
    addMlvlXpFromAttack: (cls: CharacterClass) => number;
    /** Add weapon skill XP from an auto-attack (1 XP per hit; skips magic classes to avoid double-dipping MLVL) */
    addWeaponSkillXpFromAttack: (cls: CharacterClass) => number;
    /** Add MLVL XP from using a skill (all classes, slower for non-magic) */
    addMlvlXpFromSkill: (cls: CharacterClass) => number;
    /** Attempt to unlock (purchase) an active skill. Requires spell chest + gold. Returns true if purchased. */
    unlockSkill: (skillId: string, goldCost: number, spendGoldFn: (amount: number) => boolean, chestLevel: number, useChestsFn: (level: number, count: number) => boolean) => boolean;
    /** Check if a skill has been unlocked/purchased */
    isSkillUnlocked: (skillId: string) => boolean;
    /** Attempt to upgrade an active skill. Returns result with success/fail, gold + chests spent. */
    upgradeActiveSkill: (skillId: string, playerGold: number, spendGoldFn: (amount: number) => boolean, skillUnlockLevel: number, useChestsFn: (level: number, count: number) => boolean, getChestCountFn: (level: number) => number) => ISkillUpgradeResult;
    /** Get current upgrade level for a skill */
    getSkillUpgradeLevel: (skillId: string) => number;
    /** Clear all skill data (on character reset) */
    resetSkills: () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

const INITIAL_STATE: ISkillState = {
    skillLevels: {},
    skillXp: {},
    activeSkillSlots: [null, null, null, null],
    skillUpgradeLevels: {},
    unlockedSkills: {},
    offlineTrainingSkillId: null,
    trainingSegmentStartedAt: null,
    trainingAccumulatedEffectiveSeconds: 0,
    trainingCurrentSpeedMultiplier: 2, // Default to active speed; useActivityTracker manages this at runtime
};

export const useSkillStore = create<ISkillStore>()(
        (set, get) => ({
            ...INITIAL_STATE,

            initSkills: (cls) => {
                const skillIds = getClassWeaponSkills(cls);
                set((state) => {
                    const levels = { ...state.skillLevels };
                    const xp = { ...state.skillXp };
                    for (const id of skillIds) {
                        if (levels[id] === undefined) levels[id] = 0;
                        if (xp[id] === undefined) xp[id] = 0;
                    }
                    // Always init magic_level for all classes (MLVL for everyone)
                    if (levels['magic_level'] === undefined) levels['magic_level'] = 0;
                    if (xp['magic_level'] === undefined) xp['magic_level'] = 0;
                    return { skillLevels: levels, skillXp: xp };
                });
            },

            addSkillXp: (skillId, xpGained) => {
                const state = get();
                const currentLevel = state.skillLevels[skillId] ?? 0;
                const currentXp = state.skillXp[skillId] ?? 0;
                const result = processSkillXp(currentLevel, currentXp, xpGained);
                set((s) => ({
                    skillLevels: { ...s.skillLevels, [skillId]: result.newLevel },
                    skillXp: { ...s.skillXp, [skillId]: result.remainingXp },
                }));
                return result.levelsGained;
            },

            applyDeathPenalty: (cls) => {
                const skillIds = getClassWeaponSkills(cls);
                // Apply to weapon skills + magic_level + ALL general trainable stats
                const allIds = [...new Set([...skillIds, 'magic_level', ...GENERAL_TRAINABLE_STATS])];
                set((state) => {
                    const levels = { ...state.skillLevels };
                    const xp = { ...state.skillXp };
                    for (const id of allIds) {
                        const lvl = levels[id] ?? 0;
                        // On death: drop skill level by 1 and reset its XP to 0.
                        // Trained levels cannot go below 0 (base). Bonus skill levels
                        // from equipment/items are applied separately via getEffectiveSkillLevel
                        // and are not affected by death penalty.
                        if (lvl > 0) {
                            levels[id] = lvl - 1;
                            xp[id] = 0;
                        } else if ((xp[id] ?? 0) > 0) {
                            xp[id] = 0;
                        }
                    }
                    return { skillLevels: levels, skillXp: xp };
                });
            },

            setActiveSkillSlot: (slot, skillId) => {
                set((state) => {
                    const slots = [...state.activeSkillSlots] as ISkillState['activeSkillSlots'];
                    if (skillId !== null) {
                        for (let i = 0; i < 4; i++) {
                            if (slots[i] === skillId && i !== slot) slots[i] = null;
                        }
                    }
                    slots[slot] = skillId;
                    return { activeSkillSlots: slots };
                });
            },

            startOfflineTraining: (skillId, speedMultiplier = 1) => {
                set({
                    offlineTrainingSkillId: skillId,
                    trainingSegmentStartedAt: new Date().toISOString(),
                    trainingAccumulatedEffectiveSeconds: 0,
                    trainingCurrentSpeedMultiplier: speedMultiplier,
                });
            },

            selectTrainingStat: (skillId) => {
                const state = get();
                // Collect XP from previous skill if training was active
                if (state.offlineTrainingSkillId && state.trainingSegmentStartedAt) {
                    get().collectOfflineTraining();
                }

                // Offline hunt pauses always-on training. If a hunt is running
                // we still let the player PICK a skill for later, but we keep
                // the segment paused (segmentStartedAt stays null) so no XP
                // accrues until the hunt ends.
                const huntActive = isOfflineHuntActive();

                set({
                    offlineTrainingSkillId: skillId,
                    trainingSegmentStartedAt: huntActive ? null : new Date().toISOString(),
                    trainingAccumulatedEffectiveSeconds: 0,
                    trainingCurrentSpeedMultiplier: huntActive ? 1 : 2,
                });
            },

            onActivityChange: (isActive) => {
                const { trainingSegmentStartedAt, trainingCurrentSpeedMultiplier, trainingAccumulatedEffectiveSeconds, offlineTrainingSkillId } = get();
                // If training paused (segmentStartedAt null) or no skill selected,
                // just remember the speed for when training resumes — do NOT start
                // a new segment here, because offline hunt relies on paused state
                // meaning zero accrual.
                if (!offlineTrainingSkillId || !trainingSegmentStartedAt) {
                    set({ trainingCurrentSpeedMultiplier: isActive ? 2 : 1 });
                    return;
                }

                // Flush current segment: elapsed real seconds × current multiplier
                const now = Date.now();
                const segmentSeconds = Math.max(0, (now - new Date(trainingSegmentStartedAt).getTime()) / 1000);
                const effectiveSeconds = segmentSeconds * trainingCurrentSpeedMultiplier;

                set({
                    trainingAccumulatedEffectiveSeconds: trainingAccumulatedEffectiveSeconds + effectiveSeconds,
                    trainingSegmentStartedAt: new Date().toISOString(),
                    trainingCurrentSpeedMultiplier: isActive ? 2 : 1,
                });
            },

            pauseTraining: () => {
                const { offlineTrainingSkillId, trainingSegmentStartedAt, trainingCurrentSpeedMultiplier, trainingAccumulatedEffectiveSeconds } = get();
                if (!offlineTrainingSkillId) return;
                if (!trainingSegmentStartedAt) return; // already paused
                const now = Date.now();
                const segmentSeconds = Math.max(0, (now - new Date(trainingSegmentStartedAt).getTime()) / 1000);
                const effectiveSeconds = segmentSeconds * trainingCurrentSpeedMultiplier;
                set({
                    trainingAccumulatedEffectiveSeconds: trainingAccumulatedEffectiveSeconds + effectiveSeconds,
                    trainingSegmentStartedAt: null, // pause: no new seconds accrue
                });
            },

            resumeTraining: () => {
                const { offlineTrainingSkillId, trainingSegmentStartedAt } = get();
                if (!offlineTrainingSkillId) return;
                if (trainingSegmentStartedAt) return; // already running
                set({
                    trainingSegmentStartedAt: new Date().toISOString(),
                    trainingCurrentSpeedMultiplier: 2,
                });
            },

            collectOfflineTraining: () => {
                const { offlineTrainingSkillId, trainingSegmentStartedAt, trainingAccumulatedEffectiveSeconds, trainingCurrentSpeedMultiplier } = get();
                if (!offlineTrainingSkillId) return 0;

                // Flush current segment (only if running — segmentStartedAt null means paused)
                let effectiveSeconds = 0;
                if (trainingSegmentStartedAt) {
                    const now = Date.now();
                    const segmentSeconds = Math.max(0, (now - new Date(trainingSegmentStartedAt).getTime()) / 1000);
                    effectiveSeconds = segmentSeconds * trainingCurrentSpeedMultiplier;
                }
                let totalEffective = trainingAccumulatedEffectiveSeconds + effectiveSeconds;

                // Cap at 24 hours of effective time
                totalEffective = Math.min(totalEffective, MAX_OFFLINE_TRAINING_SECONDS);

                const currentLevel = get().skillLevels[offlineTrainingSkillId] ?? 0;
                let xpEarned = calculateOfflineSkillXp(totalEffective, currentLevel, offlineTrainingSkillId);

                // Apply Training Elixir x2 buff (pausable – consume training time from buff)
                const buffStore = useBuffStore.getState();
                if (buffStore.hasBuff('offline_training_boost')) {
                    const trainingMs = totalEffective * 1000;
                    const consumed = buffStore.consumePausableTime('offline_training_boost', trainingMs);
                    if (consumed > 0) {
                        const boostedFraction = consumed / trainingMs;
                        xpEarned = Math.floor(xpEarned * (1 + boostedFraction));
                    }
                }

                if (xpEarned > 0) {
                    get().addSkillXp(offlineTrainingSkillId, xpEarned);
                }

                // Reset counters, restart segment
                set({
                    trainingSegmentStartedAt: new Date().toISOString(),
                    trainingAccumulatedEffectiveSeconds: 0,
                });

                return xpEarned;
            },

            // ── Shielding XP on block (Knight) ───────────────────────────────
            addShieldingXpOnBlock: () => {
                const state = get();
                const shieldingLevel = state.skillLevels['shielding'] ?? 0;
                const xpGain = shieldingXpPerBlock(shieldingLevel);
                return get().addSkillXp('shielding', xpGain);
            },

            // ── MLVL from auto-attack (magic classes only) ───────────────────
            addMlvlXpFromAttack: (cls) => {
                if (!doesClassGainMlvlFromAttacks(cls)) return 0;
                const state = get();
                const mlvl = state.skillLevels['magic_level'] ?? 0;
                const xpGain = mlvlXpPerAttack(mlvl);
                return get().addSkillXp('magic_level', xpGain);
            },

            // ── Weapon skill XP from auto-attack (all classes, 1 XP per hit) ──
            addWeaponSkillXpFromAttack: (cls) => {
                const skillId = CLASS_WEAPON_SKILL[cls];
                if (!skillId) return 0;
                // Magic classes already gain magic_level XP via addMlvlXpFromAttack; skip to avoid double-dipping
                if (doesClassGainMlvlFromAttacks(cls) && skillId === 'magic_level') return 0;
                return get().addSkillXp(skillId, 1);
            },

            // ── MLVL from skill use (all classes, slower for non-magic) ──────
            addMlvlXpFromSkill: (cls) => {
                const state = get();
                const mlvl = state.skillLevels['magic_level'] ?? 0;
                const xpGain = mlvlXpPerSkillUse(mlvl, cls);
                return get().addSkillXp('magic_level', xpGain);
            },

            // ── Active skill unlock (purchase) ───────────────────────────────
            unlockSkill: (skillId, goldCost, spendGoldFn, chestLevel, useChestsFn) => {
                const state = get();
                if (state.unlockedSkills[skillId]) return true; // already unlocked
                // Require 1 spell chest of the skill's unlock level
                const chestsUsed = useChestsFn(chestLevel, 1);
                if (!chestsUsed) return false;
                const spent = spendGoldFn(goldCost);
                if (!spent) {
                    // Refund chest if gold spend failed (should not happen normally)
                    return false;
                }
                set((s) => ({
                    unlockedSkills: { ...s.unlockedSkills, [skillId]: true },
                }));
                return true;
            },

            isSkillUnlocked: (skillId) => {
                return get().unlockedSkills[skillId] === true;
            },

            // ── Active skill upgrade ──────────────────────────────────────────
            upgradeActiveSkill: (skillId, playerGold, spendGoldFn, skillUnlockLevel, useChestsFn, getChestCountFn) => {
                const state = get();
                const currentLevel = state.skillUpgradeLevels[skillId] ?? 0;
                const targetLevel = currentLevel + 1;
                const chestCost = getSpellChestUpgradeCost(targetLevel, skillUnlockLevel);

                // Check resources
                if (playerGold < chestCost.gold) {
                    return { success: false, newLevel: currentLevel, goldSpent: 0, chestsSpent: 0 };
                }
                if (chestCost.chests > 0 && getChestCountFn(chestCost.chestLevel) < chestCost.chests) {
                    return { success: false, newLevel: currentLevel, goldSpent: 0, chestsSpent: 0 };
                }

                // Consume spell chests first
                if (chestCost.chests > 0) {
                    const chestsUsed = useChestsFn(chestCost.chestLevel, chestCost.chests);
                    if (!chestsUsed) {
                        return { success: false, newLevel: currentLevel, goldSpent: 0, chestsSpent: 0 };
                    }
                }

                // Spend gold (fail = chests + gold lost)
                const spent = spendGoldFn(chestCost.gold);
                if (!spent) {
                    return { success: false, newLevel: currentLevel, goldSpent: 0, chestsSpent: chestCost.chests };
                }

                const success = rollSkillUpgrade(targetLevel);

                if (success) {
                    set((s) => ({
                        skillUpgradeLevels: { ...s.skillUpgradeLevels, [skillId]: targetLevel },
                    }));
                    return { success: true, newLevel: targetLevel, goldSpent: chestCost.gold, chestsSpent: chestCost.chests };
                }

                // Fail = chests + gold lost, skill level stays
                return { success: false, newLevel: currentLevel, goldSpent: chestCost.gold, chestsSpent: chestCost.chests };
            },

            getSkillUpgradeLevel: (skillId) => {
                return get().skillUpgradeLevels[skillId] ?? 0;
            },

            resetSkills: () => set(INITIAL_STATE),
        }),
);
