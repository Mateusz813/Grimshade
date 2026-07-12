
import {
    useOfflineHuntStore,
    OFFLINE_HUNT_BASE_SECONDS_PER_KILL,
    OFFLINE_HUNT_MAX_SECONDS,
    getOfflineHuntSpeedMultiplier,
} from '../stores/offlineHuntStore';
import { useCharacterStore } from '../stores/characterStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useMasteryStore, getMasteryXpMultiplier, getMasteryGoldMultiplier } from '../stores/masteryStore';
import { useSkillStore } from '../stores/skillStore';
import { useTaskStore } from '../stores/taskStore';
import { useQuestStore } from '../stores/questStore';
import { useDailyQuestStore } from '../stores/dailyQuestStore';
import { useBuffStore } from '../stores/buffStore';
import { calculateOfflineSkillXp, skillXpToNextLevel } from './skillSystem';
import { MONSTER_RARITY_TASK_KILLS } from './lootSystem';
import { xpToNextLevel } from './levelSystem';
import {
    rollMonsterRarity,
    rollLoot,
    rollPotionDrop,
    rollSpellChestDrop,
    rollStoneDrop,
} from './lootSystem';
import { generateRandomItem } from './itemGenerator';
import type { IMonster, TMonsterRarity } from '../types/monster';
import type { Rarity, IInventoryItem } from './itemSystem';

const RARITY_XP_MULT: Record<TMonsterRarity, number> = {
    normal:    1,
    strong:    1.5,
    epic:      2.5,
    legendary: 4,
    boss:      8,
};

const RARITY_GOLD_MULT: Record<TMonsterRarity, number> = {
    normal:    1,
    strong:    1.5,
    epic:      2.5,
    legendary: 4,
    boss:      8,
};

export interface IOfflineHuntPreview {
    elapsedSeconds: number;
    cappedSeconds: number;
    kills: number;
    xpGained: number;
    goldGained: number;
    skillXpGained: number;
    skillId: string;
    monster: IMonster;
    speedMultiplier: number;
}

export interface IOfflineHuntClaimResult {
    elapsedSeconds: number;
    cappedSeconds: number;
    kills: number;
    xpGained: number;
    goldGained: number;
    skillXpGained: number;
    skillId: string;
    monster: IMonster;
    speedMultiplier: number;

    levelBefore: number;
    levelAfter: number;
    levelsGained: number;
    xpPctOfLevel: number;
    xpProgressAfter: number;
    xpNeededAfter: number;

    skillLevelBefore: number;
    skillLevelAfter: number;
    skillLevelsGained: number;
    skillXpPctOfLevel: number;

    killsByRarity: Record<TMonsterRarity, number>;

    itemDrops: IOfflineItemDropSummary[];
    potionDrops: Record<string, number>;
    spellChestDrops: Record<number, number>;
    stoneDrops: Record<string, number>;
}

export interface IOfflineItemDropSummary {
    itemId: string;
    rarity: Rarity;
    itemLevel: number;
    slot: string;
    count: number;
}


export const previewOfflineHunt = (): IOfflineHuntPreview | null => {
    const state = useOfflineHuntStore.getState();
    if (!state.isActive || !state.startedAt || !state.targetMonster || !state.trainedSkillId) {
        return null;
    }
    const now = Date.now();
    const startMs = new Date(state.startedAt).getTime();
    const elapsedSeconds = Math.max(0, Math.floor((now - startMs) / 1000));
    const cappedSeconds = Math.min(elapsedSeconds, OFFLINE_HUNT_MAX_SECONDS);

    const monster = state.targetMonster;
    const masteryLevel = useMasteryStore.getState().getMasteryLevel(monster.id);
    const speedMultiplier = getOfflineHuntSpeedMultiplier(masteryLevel);
    const killsPerSecond = speedMultiplier / OFFLINE_HUNT_BASE_SECONDS_PER_KILL;
    const kills = Math.floor(cappedSeconds * killsPerSecond);

    const masteryXpMult = getMasteryXpMultiplier(masteryLevel);
    const masteryGoldMult = getMasteryGoldMultiplier(masteryLevel);

    const bStore = useBuffStore.getState();
    const xpMult = bStore.getBuffMultiplier('xp_boost');
    const premiumMult = bStore.getBuffMultiplier('premium_xp_boost');
    const totalXpMult = xpMult * premiumMult * masteryXpMult;
    const xpPerKill = Math.floor(monster.xp * totalXpMult);
    const xpGained = kills * xpPerKill;

    const [gMin, gMax] = monster.gold;
    const goldPerKill = Math.floor(((gMin + gMax) / 2) * masteryGoldMult);
    const goldGained = kills * goldPerKill;

    const skillLevel = useSkillStore.getState().skillLevels[state.trainedSkillId] ?? 0;
    const skillXpBaseRaw = calculateOfflineSkillXp(cappedSeconds, skillLevel, state.trainedSkillId);
    const skillXpMult =
        bStore.getBuffMultiplier('skill_xp_boost') *
        bStore.getBuffMultiplier('offline_training_boost') *
        bStore.getBuffMultiplier('premium_xp_boost');
    const skillXpGained = Math.floor(skillXpBaseRaw * skillXpMult);

    return {
        elapsedSeconds,
        cappedSeconds,
        kills,
        xpGained,
        goldGained,
        skillXpGained,
        skillId: state.trainedSkillId,
        monster,
        speedMultiplier,
    };
};


const emptyKillsByRarity = (): Record<TMonsterRarity, number> => ({
    normal: 0,
    strong: 0,
    epic: 0,
    legendary: 0,
    boss: 0,
});


export const claimOfflineHunt = (): IOfflineHuntClaimResult | null => {
    const preview = previewOfflineHunt();
    if (!preview) return null;
    if (preview.kills <= 0) {
        useOfflineHuntStore.getState().stopHunt();
        return null;
    }

    const monster = preview.monster;
    const masteryBonuses = useMasteryStore.getState().getMasteryBonuses(monster.id);
    const claimMasteryLevel = useMasteryStore.getState().getMasteryLevel(monster.id);
    const claimMasteryXpMult = getMasteryXpMultiplier(claimMasteryLevel);
    const claimMasteryGoldMult = getMasteryGoldMultiplier(claimMasteryLevel);
    const bStore = useBuffStore.getState();
    const xpMult = bStore.getBuffMultiplier('xp_boost') * bStore.getBuffMultiplier('premium_xp_boost');

    const killsByRarity = emptyKillsByRarity();
    const itemsByKey = new Map<string, IOfflineItemDropSummary>();
    const potionDrops: Record<string, number> = {};
    const spellChestDrops: Record<number, number> = {};
    const stoneDrops: Record<string, number> = {};

    let totalXp = 0;
    let totalGold = 0;
    const generatedItems: IInventoryItem[] = [];

    for (let i = 0; i < preview.kills; i++) {
        const rarity = rollMonsterRarity(false, masteryBonuses);
        killsByRarity[rarity]++;

        const rarityXpMult = RARITY_XP_MULT[rarity] ?? 1;
        totalXp += Math.floor(monster.xp * rarityXpMult * xpMult * claimMasteryXpMult);

        const [gMin, gMax] = monster.gold;
        const goldBase = Math.floor((gMin + gMax) / 2);
        const rarityGoldMult = RARITY_GOLD_MULT[rarity] ?? 1;
        totalGold += Math.floor(goldBase * rarityGoldMult * claimMasteryGoldMult);

        const loot = rollLoot(monster.level, rarity, masteryBonuses.heroic);
        for (const drop of loot) {
            const inventoryItem = generateRandomItem(drop.itemLevel, drop.rarity);
            if (!inventoryItem) continue;
            generatedItems.push(inventoryItem);
            const key = inventoryItem.itemId;
            const existing = itemsByKey.get(key);
            if (existing) {
                existing.count += 1;
            } else {
                itemsByKey.set(key, {
                    itemId: inventoryItem.itemId,
                    rarity: inventoryItem.rarity,
                    itemLevel: inventoryItem.itemLevel,
                    slot: '',
                    count: 1,
                });
            }
        }

        const potions = rollPotionDrop(monster.level);
        for (const p of potions) {
            potionDrops[p.potionId] = (potionDrops[p.potionId] ?? 0) + p.count;
        }

        const hasMaxMastery = useMasteryStore.getState().isMaxMastery(monster.id);
        const chests = rollSpellChestDrop(monster.level, rarity, false, false, hasMaxMastery);
        for (const c of chests) {
            spellChestDrops[c.chestLevel] = (spellChestDrops[c.chestLevel] ?? 0) + c.count;
        }

        const stone = rollStoneDrop(monster.level, rarity);
        if (stone) {
            stoneDrops[stone.type] = (stoneDrops[stone.type] ?? 0) + stone.count;
        }
    }

    const charBefore = useCharacterStore.getState().character;
    const levelBefore = charBefore?.level ?? 1;
    const xpNeededAtStart = xpToNextLevel(levelBefore);
    const xpResult = useCharacterStore.getState().addXp(totalXp);
    const charAfter = useCharacterStore.getState().character;
    const levelAfter = charAfter?.level ?? levelBefore;
    const xpProgressAfter = charAfter?.xp ?? 0;
    const xpNeededAfter = charAfter?.xp_to_next ?? xpToNextLevel(levelAfter);
    const xpPctOfLevel = xpNeededAtStart > 0 ? (totalXp / xpNeededAtStart) * 100 : 0;

    useInventoryStore.getState().addGold(totalGold);

    const invStore = useInventoryStore.getState();
    for (const item of generatedItems) {
        invStore.addItem(item);
    }

    for (const [potionId, count] of Object.entries(potionDrops)) {
        invStore.addConsumable(potionId, count);
    }

    for (const [levelStr, count] of Object.entries(spellChestDrops)) {
        invStore.addConsumable(`spell_chest_${levelStr}`, count);
    }

    for (const [stoneType, count] of Object.entries(stoneDrops)) {
        invStore.addStones(stoneType, count);
    }

    const skillLevelBefore = useSkillStore.getState().skillLevels[preview.skillId] ?? 0;
    const skillXpBeforeNeeded = skillXpToNextLevel(skillLevelBefore);
    useSkillStore.getState().addSkillXp(preview.skillId, preview.skillXpGained);
    const skillLevelAfter = useSkillStore.getState().skillLevels[preview.skillId] ?? 0;
    const skillLevelsGained = Math.max(0, skillLevelAfter - skillLevelBefore);
    const skillXpPctOfLevel = skillXpBeforeNeeded > 0 ? (preview.skillXpGained / skillXpBeforeNeeded) * 100 : 0;

    const weightedTaskKills =
        killsByRarity.normal    * (MONSTER_RARITY_TASK_KILLS.normal    ?? 1) +
        killsByRarity.strong    * (MONSTER_RARITY_TASK_KILLS.strong    ?? 1) +
        killsByRarity.epic      * (MONSTER_RARITY_TASK_KILLS.epic      ?? 1) +
        killsByRarity.legendary * (MONSTER_RARITY_TASK_KILLS.legendary ?? 1) +
        killsByRarity.boss      * (MONSTER_RARITY_TASK_KILLS.boss      ?? 1);

    useMasteryStore.getState().addMasteryKills(monster.id, weightedTaskKills);
    useTaskStore.getState().addKill(monster.id, monster.level, weightedTaskKills);
    useQuestStore.getState().addProgress('kill', monster.id, weightedTaskKills);
    useQuestStore.getState().addProgress('kill_rarity', 'normal', killsByRarity.normal, monster.level);
    useQuestStore.getState().addProgress('kill_rarity', 'strong', killsByRarity.strong, monster.level);
    useQuestStore.getState().addProgress('kill_rarity', 'epic', killsByRarity.epic, monster.level);
    useQuestStore.getState().addProgress('kill_rarity', 'legendary', killsByRarity.legendary, monster.level);
    useQuestStore.getState().addProgress('kill_rarity', 'boss', killsByRarity.boss, monster.level);
    useDailyQuestStore.getState().addProgress('kill_any', weightedTaskKills);
    useDailyQuestStore.getState().addProgress('earn_gold', totalGold);

    useOfflineHuntStore.getState().stopHunt();

    return {
        elapsedSeconds: preview.elapsedSeconds,
        cappedSeconds: preview.cappedSeconds,
        kills: preview.kills,
        xpGained: totalXp,
        goldGained: totalGold,
        skillXpGained: preview.skillXpGained,
        skillId: preview.skillId,
        monster,
        speedMultiplier: preview.speedMultiplier,

        levelBefore,
        levelAfter,
        levelsGained: xpResult.levelsGained,
        xpPctOfLevel,
        xpProgressAfter,
        xpNeededAfter,

        skillLevelBefore,
        skillLevelAfter,
        skillLevelsGained,
        skillXpPctOfLevel,

        killsByRarity,
        itemDrops: Array.from(itemsByKey.values()).sort((a, b) => b.count - a.count),
        potionDrops,
        spellChestDrops,
        stoneDrops,
    };
};
