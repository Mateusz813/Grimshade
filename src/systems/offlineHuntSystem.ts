/**
 * Offline Hunt – claim / simulate logic.
 *
 * `claimOfflineHunt()` rolls per-kill rarity + drops (loot, potions, spell
 * chests, stones) using the SAME systems live combat uses, then applies the
 * full reward bundle (XP, gold, items, consumables, mastery kills,
 * task/quest progress, skill XP). The result includes a detailed breakdown
 * for the reward popup: kills per rarity, aggregated drops, levels gained,
 * XP before/after.
 *
 * `previewOfflineHunt()` is a deterministic read-only snapshot used for the
 * live "active hunt" panel — it returns flat kill/xp/gold/skillXp estimates
 * without rolling any randomness.
 */

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

// Rarity-based XP/gold/loot multipliers mirror the live combat engine so
// offline kills feel consistent with online kills.
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

/** Aggregated detailed reward result (claim only). */
export interface IOfflineHuntClaimResult {
    // ─── Basic numbers ────────────────────────────────────────────────
    elapsedSeconds: number;
    cappedSeconds: number;
    kills: number;
    xpGained: number;
    goldGained: number;
    skillXpGained: number;
    skillId: string;
    monster: IMonster;
    speedMultiplier: number;

    // ─── Level progression (player) ───────────────────────────────────
    levelBefore: number;
    levelAfter: number;
    levelsGained: number;
    /** % of "next level" XP gained this hunt (can exceed 100 if multi-level). */
    xpPctOfLevel: number;
    /** Overflow XP into the current level after hunt completes. */
    xpProgressAfter: number;
    xpNeededAfter: number;

    // ─── Skill progression ────────────────────────────────────────────
    skillLevelBefore: number;
    skillLevelAfter: number;
    skillLevelsGained: number;
    skillXpPctOfLevel: number;

    // ─── Kills by rarity ──────────────────────────────────────────────
    killsByRarity: Record<TMonsterRarity, number>;

    // ─── Drops (aggregated) ───────────────────────────────────────────
    /** Equipment drops: one entry per rarity+level+slot group with count. */
    itemDrops: IOfflineItemDropSummary[];
    /** Potion drops: potionId → count. */
    potionDrops: Record<string, number>;
    /** Spell chest drops: chestLevel → count. */
    spellChestDrops: Record<number, number>;
    /** Stone drops: stoneType → count (includes base stones + gained stones). */
    stoneDrops: Record<string, number>;
}

export interface IOfflineItemDropSummary {
    itemId: string;
    rarity: Rarity;
    itemLevel: number;
    slot: string;
    count: number;
}

// ── Preview (read-only, no randomness) ───────────────────────────────────────

/**
 * Preview how many kills / rewards would be earned right now.
 * Does NOT mutate any store and does NOT roll randomness. Used for the
 * live "active hunt" panel. Actual claim rewards are rolled in
 * `claimOfflineHunt()` and may differ from the preview estimate.
 */
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

    // Mastery N7: +2% XP and +2% Gold per mastery level (max +50% at lvl 25)
    const masteryXpMult = getMasteryXpMultiplier(masteryLevel);
    const masteryGoldMult = getMasteryGoldMultiplier(masteryLevel);

    // XP per kill – apply active XP buffs (same as live combat)
    const bStore = useBuffStore.getState();
    const xpMult = bStore.getBuffMultiplier('xp_boost');
    const premiumMult = bStore.getBuffMultiplier('premium_xp_boost');
    const totalXpMult = xpMult * premiumMult * masteryXpMult;
    const xpPerKill = Math.floor(monster.xp * totalXpMult);
    const xpGained = kills * xpPerKill;

    // Gold per kill – midpoint of monster gold range (deterministic preview)
    const [gMin, gMax] = monster.gold;
    const goldPerKill = Math.floor(((gMin + gMax) / 2) * masteryGoldMult);
    const goldGained = kills * goldPerKill;

    // Skill XP for the trained skill – uses offline skill XP curve.
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

// ── Helper: bulk-roll rarity distribution for N kills ────────────────────────
// Rolling rollMonsterRarity() N times for N up to ~43k (12h @ 1 kill/s) is
// perfectly fine performance-wise, but we want per-kill variance so stronger
// monsters can produce their own rarity-scaled loot rolls.

const emptyKillsByRarity = (): Record<TMonsterRarity, number> => ({
    normal: 0,
    strong: 0,
    epic: 0,
    legendary: 0,
    boss: 0,
});

// ── Claim (randomized, mutates stores) ───────────────────────────────────────

/**
 * Claim the current offline hunt: roll per-kill drops + rarity, apply all
 * rewards, and return the detailed breakdown. Returns null when there is
 * nothing to claim.
 */
export const claimOfflineHunt = (): IOfflineHuntClaimResult | null => {
    const preview = previewOfflineHunt();
    if (!preview) return null;
    if (preview.kills <= 0) {
        // Nothing gained – still stop the hunt so user can restart
        useOfflineHuntStore.getState().stopHunt();
        return null;
    }

    const monster = preview.monster;
    const masteryBonuses = useMasteryStore.getState().getMasteryBonuses(monster.id);
    // Mastery N7: snapshot mastery level at claim start — kills within the same
    // claim all share the same bonus (mastery levelling during claim shouldn't
    // retroactively buff kills that were rolled first).
    const claimMasteryLevel = useMasteryStore.getState().getMasteryLevel(monster.id);
    const claimMasteryXpMult = getMasteryXpMultiplier(claimMasteryLevel);
    const claimMasteryGoldMult = getMasteryGoldMultiplier(claimMasteryLevel);
    const bStore = useBuffStore.getState();
    const xpMult = bStore.getBuffMultiplier('xp_boost') * bStore.getBuffMultiplier('premium_xp_boost');

    // ── Roll per-kill rarity + drops ─────────────────────────────────────────
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

        // XP per this kill — base monster XP × rarity mult × buff mult × mastery mult
        const rarityXpMult = RARITY_XP_MULT[rarity] ?? 1;
        totalXp += Math.floor(monster.xp * rarityXpMult * xpMult * claimMasteryXpMult);

        // Gold per this kill — midpoint × rarity mult × mastery mult
        const [gMin, gMax] = monster.gold;
        const goldBase = Math.floor((gMin + gMax) / 2);
        const rarityGoldMult = RARITY_GOLD_MULT[rarity] ?? 1;
        totalGold += Math.floor(goldBase * rarityGoldMult * claimMasteryGoldMult);

        // Equipment drops — convert the raw rollLoot output into REAL inventory
        // items (bow_lvl8_rare, plate_armor_lvl12_epic, etc). Using the same
        // generateRandomItem() helper that live combat uses keeps drops
        // consistent between live and offline hunt.
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

        // Potion drops
        const potions = rollPotionDrop(monster.level);
        for (const p of potions) {
            potionDrops[p.potionId] = (potionDrops[p.potionId] ?? 0) + p.count;
        }

        // Spell chest drops
        const chests = rollSpellChestDrop(monster.level, rarity, false, false);
        for (const c of chests) {
            spellChestDrops[c.chestLevel] = (spellChestDrops[c.chestLevel] ?? 0) + c.count;
        }

        // Stone drops
        const stone = rollStoneDrop(monster.level, rarity);
        if (stone) {
            stoneDrops[stone.type] = (stoneDrops[stone.type] ?? 0) + stone.count;
        }
    }

    // ── Grant player XP (captures level-ups + fires epic LevelUpNotification) ─
    const charBefore = useCharacterStore.getState().character;
    const levelBefore = charBefore?.level ?? 1;
    const xpNeededAtStart = xpToNextLevel(levelBefore);
    const xpResult = useCharacterStore.getState().addXp(totalXp);
    const charAfter = useCharacterStore.getState().character;
    const levelAfter = charAfter?.level ?? levelBefore;
    const xpProgressAfter = charAfter?.xp ?? 0;
    const xpNeededAfter = charAfter?.xp_to_next ?? xpToNextLevel(levelAfter);
    const xpPctOfLevel = xpNeededAtStart > 0 ? (totalXp / xpNeededAtStart) * 100 : 0;

    // ── Grant gold ───────────────────────────────────────────────────────────
    useInventoryStore.getState().addGold(totalGold);

    // ── Grant items to inventory ─────────────────────────────────────────────
    // generatedItems are already full IInventoryItem objects from
    // generateRandomItem() — pass them straight to addItem.
    const invStore = useInventoryStore.getState();
    for (const item of generatedItems) {
        invStore.addItem(item);
    }

    // ── Grant potions (consumables) ──────────────────────────────────────────
    for (const [potionId, count] of Object.entries(potionDrops)) {
        invStore.addConsumable(potionId, count);
    }

    // ── Grant spell chests (consumables keyed by level) ──────────────────────
    for (const [levelStr, count] of Object.entries(spellChestDrops)) {
        invStore.addConsumable(`spell_chest_${levelStr}`, count);
    }

    // ── Grant stones ─────────────────────────────────────────────────────────
    for (const [stoneType, count] of Object.entries(stoneDrops)) {
        invStore.addStones(stoneType, count);
    }

    // ── Skill XP ─────────────────────────────────────────────────────────────
    const skillLevelBefore = useSkillStore.getState().skillLevels[preview.skillId] ?? 0;
    const skillXpBeforeNeeded = skillXpToNextLevel(skillLevelBefore);
    useSkillStore.getState().addSkillXp(preview.skillId, preview.skillXpGained);
    const skillLevelAfter = useSkillStore.getState().skillLevels[preview.skillId] ?? 0;
    const skillLevelsGained = Math.max(0, skillLevelAfter - skillLevelBefore);
    const skillXpPctOfLevel = skillXpBeforeNeeded > 0 ? (preview.skillXpGained / skillXpBeforeNeeded) * 100 : 0;

    // ── Mastery kills (weighted by rarity, matching live combat) ─────────────
    const weightedKills =
        killsByRarity.normal * 1 +
        killsByRarity.strong * 2 +
        killsByRarity.epic * 5 +
        killsByRarity.legendary * 10 +
        killsByRarity.boss * 20;
    useMasteryStore.getState().addMasteryKills(monster.id, weightedKills);

    // ── Task / quest / daily progress ───────────────────────────────────────
    // Weighted by rarity — matches live combat handleMonsterDeath() which
    // applies MONSTER_RARITY_TASK_KILLS[rarity] per kill. Raw kills would
    // drastically undercount tasks for high-rarity hunts.
    const weightedTaskKills =
        killsByRarity.normal    * (MONSTER_RARITY_TASK_KILLS.normal    ?? 1) +
        killsByRarity.strong    * (MONSTER_RARITY_TASK_KILLS.strong    ?? 1) +
        killsByRarity.epic      * (MONSTER_RARITY_TASK_KILLS.epic      ?? 1) +
        killsByRarity.legendary * (MONSTER_RARITY_TASK_KILLS.legendary ?? 1) +
        killsByRarity.boss      * (MONSTER_RARITY_TASK_KILLS.boss      ?? 1);
    useTaskStore.getState().addKill(monster.id, monster.level, weightedTaskKills);
    useQuestStore.getState().addProgress('kill', monster.id, weightedTaskKills);
    useQuestStore.getState().addProgress('kill_rarity', 'normal', killsByRarity.normal, monster.level);
    useQuestStore.getState().addProgress('kill_rarity', 'strong', killsByRarity.strong, monster.level);
    useQuestStore.getState().addProgress('kill_rarity', 'epic', killsByRarity.epic, monster.level);
    useQuestStore.getState().addProgress('kill_rarity', 'legendary', killsByRarity.legendary, monster.level);
    useQuestStore.getState().addProgress('kill_rarity', 'boss', killsByRarity.boss, monster.level);
    useDailyQuestStore.getState().addProgress('kill_any', weightedTaskKills);
    useDailyQuestStore.getState().addProgress('earn_gold', totalGold);

    // ── Stop the hunt ────────────────────────────────────────────────────────
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
