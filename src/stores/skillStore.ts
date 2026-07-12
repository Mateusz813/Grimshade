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
    rollSkillUpgrade,
    GENERAL_TRAINABLE_STATS,
    getSpellChestUpgradeCost,
    CLASS_WEAPON_SKILL,
    skillXpToNextLevel,
} from '../systems/skillSystem';
import { useBuffStore } from './buffStore';
import skillsData from '../data/skills.json';
import type { CharacterClass } from '../api/v1/characterApi';

const isOfflineHuntActive = (): boolean => {
    const mod = (globalThis as unknown as {
        __offlineHuntStore?: { getState: () => { isActive: boolean } };
    }).__offlineHuntStore;
    return mod?.getState().isActive === true;
};


export interface ISkillUpgradeResult {
    success: boolean;
    newLevel: number;
    goldSpent: number;
    chestsSpent: number;
}

export interface ISkillState {
    skillLevels: Record<string, number>;
    skillXp: Record<string, number>;
    activeSkillSlots: [string | null, string | null, string | null, string | null];
    skillUpgradeLevels: Record<string, number>;
    unlockedSkills: Record<string, boolean>;
    offlineTrainingSkillId: string | null;
    trainingSegmentStartedAt: string | null;
    trainingAccumulatedEffectiveSeconds: number;
    trainingCurrentSpeedMultiplier: number;
}

interface ISkillStore extends ISkillState {
    initSkills: (cls: CharacterClass) => void;
    addSkillXp: (skillId: string, xp: number) => number;
    applyDeathPenalty: (cls: CharacterClass, lossPct?: number) => void;
    setActiveSkillSlot: (slot: 0 | 1 | 2 | 3, skillId: string | null) => void;
    purgeLockedSkillSlots: (cls: CharacterClass, currentLevel: number) => number;
    startOfflineTraining: (skillId: string, speedMultiplier?: number) => void;
    selectTrainingStat: (skillId: string | null) => void;
    collectOfflineTraining: () => number;
    onActivityChange: (isActive: boolean) => void;
    pauseTraining: () => void;
    resumeTraining: () => void;
    addShieldingXpOnBlock: () => number;
    addMlvlXpFromAttack: (cls: CharacterClass) => number;
    addWeaponSkillXpFromAttack: (cls: CharacterClass) => number;
    addMlvlXpFromSkill: (cls: CharacterClass) => number;
    unlockSkill: (skillId: string, goldCost: number, spendGoldFn: (amount: number) => boolean, chestLevel: number, useChestsFn: (level: number, count: number) => boolean) => boolean;
    unlockAllActiveSkills: (skillIds: string[]) => void;
    isSkillUnlocked: (skillId: string) => boolean;
    upgradeActiveSkill: (skillId: string, playerGold: number, spendGoldFn: (amount: number) => boolean, skillUnlockLevel: number, useChestsFn: (level: number, count: number) => boolean, getChestCountFn: (level: number) => number) => ISkillUpgradeResult;
    getSkillUpgradeLevel: (skillId: string) => number;
    resetSkills: () => void;
}


const INITIAL_STATE: ISkillState = {
    skillLevels: {},
    skillXp: {},
    activeSkillSlots: [null, null, null, null],
    skillUpgradeLevels: {},
    unlockedSkills: {},
    offlineTrainingSkillId: null,
    trainingSegmentStartedAt: null,
    trainingAccumulatedEffectiveSeconds: 0,
    trainingCurrentSpeedMultiplier: 2,
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

            applyDeathPenalty: (cls, lossPct = 25) => {
                const skillIds = getClassWeaponSkills(cls);
                const allIds = [...new Set([...skillIds, 'magic_level', ...GENERAL_TRAINABLE_STATS])];
                const fraction = Math.max(0, Math.min(100, lossPct)) / 100;
                if (fraction <= 0) return;
                set((state) => {
                    const levels = { ...state.skillLevels };
                    const xp = { ...state.skillXp };
                    for (const id of allIds) {
                        const lvl = levels[id] ?? 0;
                        const cur = xp[id] ?? 0;
                        if (lvl <= 0 && cur <= 0) continue;
                        let total = cur;
                        for (let i = 0; i < lvl; i++) total += skillXpToNextLevel(i);
                        total = Math.max(0, Math.floor(total * (1 - fraction)));
                        let newLvl = 0;
                        while (total >= skillXpToNextLevel(newLvl)) {
                            total -= skillXpToNextLevel(newLvl);
                            newLvl += 1;
                        }
                        levels[id] = newLvl;
                        xp[id] = total;
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

            purgeLockedSkillSlots: (cls, currentLevel) => {
                const key = cls.toLowerCase() as keyof typeof skillsData.activeSkills;
                const list = (skillsData.activeSkills[key] ?? []) as Array<{ id: string; unlockLevel: number }>;
                const lookup = new Map(list.map((s) => [s.id, s.unlockLevel]));
                let cleared = 0;
                set((state) => {
                    const slots = [...state.activeSkillSlots] as ISkillState['activeSkillSlots'];
                    for (let i = 0; i < 4; i++) {
                        const id = slots[i];
                        if (!id) continue;
                        const unlock = lookup.get(id);
                        if (typeof unlock === 'number' && unlock > currentLevel) {
                            slots[i] = null;
                            cleared++;
                        }
                    }
                    return cleared > 0 ? { activeSkillSlots: slots } : {};
                });
                return cleared;
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
                if (state.offlineTrainingSkillId && state.trainingSegmentStartedAt) {
                    get().collectOfflineTraining();
                }

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
                if (!offlineTrainingSkillId || !trainingSegmentStartedAt) {
                    set({ trainingCurrentSpeedMultiplier: isActive ? 2 : 1 });
                    return;
                }

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
                if (!trainingSegmentStartedAt) return;
                const now = Date.now();
                const segmentSeconds = Math.max(0, (now - new Date(trainingSegmentStartedAt).getTime()) / 1000);
                const effectiveSeconds = segmentSeconds * trainingCurrentSpeedMultiplier;
                set({
                    trainingAccumulatedEffectiveSeconds: trainingAccumulatedEffectiveSeconds + effectiveSeconds,
                    trainingSegmentStartedAt: null,
                });
            },

            resumeTraining: () => {
                const { offlineTrainingSkillId, trainingSegmentStartedAt } = get();
                if (!offlineTrainingSkillId) return;
                if (trainingSegmentStartedAt) return;
                set({
                    trainingSegmentStartedAt: new Date().toISOString(),
                    trainingCurrentSpeedMultiplier: 2,
                });
            },

            collectOfflineTraining: () => {
                const { offlineTrainingSkillId, trainingSegmentStartedAt, trainingAccumulatedEffectiveSeconds, trainingCurrentSpeedMultiplier } = get();
                if (!offlineTrainingSkillId) return 0;

                let effectiveSeconds = 0;
                if (trainingSegmentStartedAt) {
                    const now = Date.now();
                    const segmentSeconds = Math.max(0, (now - new Date(trainingSegmentStartedAt).getTime()) / 1000);
                    effectiveSeconds = segmentSeconds * trainingCurrentSpeedMultiplier;
                }
                let totalEffective = trainingAccumulatedEffectiveSeconds + effectiveSeconds;

                totalEffective = Math.min(totalEffective, MAX_OFFLINE_TRAINING_SECONDS);

                const currentLevel = get().skillLevels[offlineTrainingSkillId] ?? 0;
                let xpEarned = calculateOfflineSkillXp(totalEffective, currentLevel, offlineTrainingSkillId);

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

                set({
                    trainingSegmentStartedAt: new Date().toISOString(),
                    trainingAccumulatedEffectiveSeconds: 0,
                });

                return xpEarned;
            },

            addShieldingXpOnBlock: () => {
                const state = get();
                const shieldingLevel = state.skillLevels['shielding'] ?? 0;
                const xpGain = shieldingXpPerBlock(shieldingLevel);
                return get().addSkillXp('shielding', xpGain);
            },

            addMlvlXpFromAttack: (cls) => {
                if (!doesClassGainMlvlFromAttacks(cls)) return 0;
                const state = get();
                const mlvl = state.skillLevels['magic_level'] ?? 0;
                const xpGain = mlvlXpPerAttack(mlvl);
                return get().addSkillXp('magic_level', xpGain);
            },

            addWeaponSkillXpFromAttack: (cls) => {
                const skillId = CLASS_WEAPON_SKILL[cls];
                if (!skillId) return 0;
                if (doesClassGainMlvlFromAttacks(cls) && skillId === 'magic_level') return 0;
                return get().addSkillXp(skillId, 1);
            },

            addMlvlXpFromSkill: (cls) => {
                const state = get();
                const mlvl = state.skillLevels['magic_level'] ?? 0;
                const xpGain = mlvlXpPerSkillUse(mlvl, cls);
                return get().addSkillXp('magic_level', xpGain);
            },

            unlockSkill: (skillId, goldCost, spendGoldFn, chestLevel, useChestsFn) => {
                const state = get();
                if (state.unlockedSkills[skillId]) return true;
                const chestsUsed = useChestsFn(chestLevel, 1);
                if (!chestsUsed) return false;
                const spent = spendGoldFn(goldCost);
                if (!spent) {
                    return false;
                }
                set((s) => ({
                    unlockedSkills: { ...s.unlockedSkills, [skillId]: true },
                }));
                return true;
            },

            unlockAllActiveSkills: (skillIds) => {
                set((s) => {
                    const next: Record<string, boolean> = { ...s.unlockedSkills };
                    let changed = false;
                    for (const id of skillIds) {
                        if (next[id] !== true) { next[id] = true; changed = true; }
                    }
                    return changed ? { unlockedSkills: next } : s;
                });
            },

            isSkillUnlocked: (skillId) => {
                return get().unlockedSkills[skillId] === true;
            },

            upgradeActiveSkill: (skillId, playerGold, spendGoldFn, skillUnlockLevel, useChestsFn, getChestCountFn) => {
                const state = get();
                const currentLevel = state.skillUpgradeLevels[skillId] ?? 0;
                const targetLevel = currentLevel + 1;
                const chestCost = getSpellChestUpgradeCost(targetLevel, skillUnlockLevel);

                if (playerGold < chestCost.gold) {
                    return { success: false, newLevel: currentLevel, goldSpent: 0, chestsSpent: 0 };
                }
                if (chestCost.chests > 0 && getChestCountFn(chestCost.chestLevel) < chestCost.chests) {
                    return { success: false, newLevel: currentLevel, goldSpent: 0, chestsSpent: 0 };
                }

                if (chestCost.chests > 0) {
                    const chestsUsed = useChestsFn(chestCost.chestLevel, chestCost.chests);
                    if (!chestsUsed) {
                        return { success: false, newLevel: currentLevel, goldSpent: 0, chestsSpent: 0 };
                    }
                }

                const spent = spendGoldFn(chestCost.gold);
                if (!spent) {
                    return { success: false, newLevel: currentLevel, goldSpent: 0, chestsSpent: chestCost.chests };
                }

                const success = rollSkillUpgrade(targetLevel);

                if (success) {
                    set((s) => ({
                        skillUpgradeLevels: { ...s.skillUpgradeLevels, [skillId]: targetLevel },
                    }));
                    void Promise.all([
                        import('./characterStore'),
                        import('../api/v1/characterApi'),
                    ]).then(([{ useCharacterStore }, { characterApi }]) => {
                        const charId = useCharacterStore.getState().character?.id;
                        if (!charId) return;
                        void characterApi.bumpStat({
                            characterId: charId,
                            column: 'skill_upgrades_done',
                            value: 1,
                            mode: 'add',
                        });
                    }).catch(() => { });
                    return { success: true, newLevel: targetLevel, goldSpent: chestCost.gold, chestsSpent: chestCost.chests };
                }

                return { success: false, newLevel: currentLevel, goldSpent: chestCost.gold, chestsSpent: chestCost.chests };
            },

            getSkillUpgradeLevel: (skillId) => {
                return get().skillUpgradeLevels[skillId] ?? 0;
            },

            resetSkills: () => set(INITIAL_STATE),
        }),
);
