import dungeonsRaw from '../data/dungeons.json';
import bossesRaw from '../data/bosses.json';
import { generateRandomItem } from './itemGenerator';
import { SPELL_CHEST_LEVELS } from './skillSystem';
import type { IRaid, IRaidBossState, IRaidDropLine, IRaidMemberState } from '../types/raid';
import type { Rarity } from './itemSystem';
import type { IInventoryItem } from '../types/inventory';

interface IDungeonRow {
    id: string;
    name_pl: string;
    level: number;
}

interface IBossRow {
    id: string;
    name_pl: string;
    level: number;
    hp: number;
    attack: number;
    defense: number;
    xp: number;
    gold: [number, number];
    sprite: string;
}

const DUNGEONS = dungeonsRaw as IDungeonRow[];
const BOSSES = bossesRaw as IBossRow[];

/** Upgrade stone rarity roll per boss (sums to 100%). */
const STONE_DROPS: Array<{ rarity: string; chance: number; id: string }> = [
    { rarity: 'heroic',    chance: 0.005, id: 'heroic_stone' },
    { rarity: 'mythic',    chance: 0.10,  id: 'mythic_stone' },
    { rarity: 'legendary', chance: 0.195, id: 'legendary_stone' },
    { rarity: 'epic',      chance: 0.22,  id: 'epic_stone' },
    { rarity: 'rare',      chance: 0.30,  id: 'rare_stone' },
    { rarity: 'common',    chance: 0.18,  id: 'common_stone' },
];

const ITEM_RARITY_CHANCES: Array<{ rarity: Rarity; chance: number }> = [
    { rarity: 'mythic',    chance: 0.10 },
    { rarity: 'legendary', chance: 0.15 },
    { rarity: 'epic',      chance: 0.20 },
    { rarity: 'rare',      chance: 0.25 },
    { rarity: 'common',    chance: 0.30 },
];

const POTION_DROP_CHANCE = 0.10;
const SPELL_CHEST_CHANCE_PER_LEVEL = 0.015;

/** Total boss XP/Gold multiplier — user's spec: "tyle co za zabicie 4 bossow × 10". */
const RAID_BOSS_BATCH_MULTIPLIER = 10;

/** Scale wave count with raid level — 1 wave at lvl 1, up to 5 waves at 1000. */
export const getRaidWaveCount = (raidLevel: number): number => {
    if (raidLevel <= 10) return 1;
    if (raidLevel <= 50) return 2;
    if (raidLevel <= 200) return 3;
    if (raidLevel <= 500) return 4;
    return 5;
};

/** Derive one raid per dungeon. */
export const getAllRaids = (): IRaid[] =>
    DUNGEONS.map((d) => ({
        id: `raid_${d.id.replace('dungeon_', '')}`,
        name_pl: d.name_pl,
        level: d.level,
        waves: getRaidWaveCount(d.level),
        dailyAttempts: 3,
        sourceDungeonId: d.id,
    }));

export const getRaidById = (id: string): IRaid | null =>
    getAllRaids().find((r) => r.id === id) ?? null;

/** Pick a base boss template close to the raid level (≤). */
const pickBaseBoss = (raidLevel: number): IBossRow => {
    const eligible = BOSSES.filter((b) => b.level <= raidLevel);
    if (eligible.length === 0) return BOSSES[0];
    eligible.sort((a, b) => b.level - a.level);
    return eligible[0];
};

/**
 * Generate the 4 boss slots for a given wave. Bosses scale with raid level by
 * applying a multiplier relative to the picked base boss's native level.
 */
export const generateWaveBosses = (
    raid: IRaid,
    waveIdx: number,
): IRaidBossState[] => {
    const base = pickBaseBoss(raid.level);
    const levelGap = Math.max(1, raid.level - base.level);
    // Stat multiplier: +5% per level gap, +15% per wave index (later waves harder).
    const mult = (1 + levelGap * 0.05) * (1 + waveIdx * 0.15);
    return Array.from({ length: 4 }).map((_, slotIdx) => {
        const hp = Math.floor(base.hp * mult);
        return {
            id: `raid_boss_${waveIdx}_${slotIdx}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            baseId: base.id,
            name: `${base.name_pl} #${slotIdx + 1}`,
            sprite: base.sprite,
            maxHp: hp,
            currentHp: hp,
            attack: Math.floor(base.attack * mult),
            defense: Math.floor(base.defense * mult),
            isDead: false,
            waveIdx,
            slotIdx,
        };
    });
};

interface IMemberRewardContext {
    member: IRaidMemberState;
    raid: IRaid;
    bossesDefeated: number;
}

/**
 * Roll full raid rewards for one party member.
 * User spec:
 *   XP/Gold = 4 bosses × 10 (per wave), scaled by raid level.
 *   Per defeated boss (all waves): item-drop (rarity split), spell-chest 1.5%×chestCount,
 *   potion 10%, stone 100% rolled across 6 tiers.
 */
export const rollMemberRewards = (ctx: IMemberRewardContext): {
    xp: number;
    gold: number;
    drops: IRaidDropLine[];
    items: IInventoryItem[];
} => {
    const { member, raid, bossesDefeated } = ctx;
    const base = pickBaseBoss(raid.level);
    const levelGap = Math.max(1, raid.level - base.level);
    const statMult = 1 + levelGap * 0.05;

    const waveXp = Math.floor(base.xp * statMult * 4 * RAID_BOSS_BATCH_MULTIPLIER / raid.waves);
    const waveGold = Math.floor(((base.gold[0] + base.gold[1]) / 2) * statMult * 4 * RAID_BOSS_BATCH_MULTIPLIER / raid.waves);
    const xp = waveXp * raid.waves;
    const gold = waveGold * raid.waves;

    const drops: IRaidDropLine[] = [];
    const items: IInventoryItem[] = [];

    drops.push({ kind: 'xp', memberId: member.id, label: `+${xp.toLocaleString('pl-PL')} XP`, amount: xp });
    drops.push({ kind: 'gold', memberId: member.id, label: `+${gold.toLocaleString('pl-PL')} Gold`, amount: gold });

    const eligibleChests = SPELL_CHEST_LEVELS.filter((lvl) => lvl <= raid.level);

    for (let i = 0; i < bossesDefeated; i++) {
        // Item drop — rolls against cumulative; if rolled, generate the item.
        const itemRoll = Math.random();
        let cum = 0;
        for (const tier of ITEM_RARITY_CHANCES) {
            cum += tier.chance;
            if (itemRoll < cum) {
                const generated = generateRandomItem(raid.level, tier.rarity);
                if (generated) {
                    items.push(generated);
                    drops.push({
                        kind: 'item',
                        memberId: member.id,
                        label: `Przedmiot ${tier.rarity}`,
                        rarity: tier.rarity,
                        itemId: generated.itemId,
                    });
                }
                break;
            }
        }

        // Spell chests — independent roll per eligible chest level.
        for (const chestLvl of eligibleChests) {
            if (Math.random() < SPELL_CHEST_CHANCE_PER_LEVEL) {
                drops.push({
                    kind: 'spell_chest',
                    memberId: member.id,
                    label: `Skrzynia Zaklęć (lvl ${chestLvl})`,
                    amount: chestLvl,
                });
            }
        }

        // Potion — 10%, tier scales with raid level.
        if (Math.random() < POTION_DROP_CHANCE) {
            const potionTier =
                raid.level >= 500 ? 'heroic' :
                raid.level >= 300 ? 'mythic' :
                raid.level >= 150 ? 'legendary' :
                raid.level >= 50  ? 'epic' :
                raid.level >= 15  ? 'rare' : 'common';
            drops.push({
                kind: 'potion',
                memberId: member.id,
                label: `Potion ${potionTier}`,
                rarity: potionTier,
            });
        }

        // Upgrade stone — always rolls (chances sum to 100%).
        const stoneRoll = Math.random();
        let scum = 0;
        for (const s of STONE_DROPS) {
            scum += s.chance;
            if (stoneRoll < scum) {
                drops.push({
                    kind: 'upgrade_stone',
                    memberId: member.id,
                    label: `Kamień (${s.rarity})`,
                    rarity: s.rarity,
                    itemId: s.id,
                });
                break;
            }
        }
    }

    return { xp, gold, drops, items };
};

/** Today's ISO date (YYYY-MM-DD) for attempt tracking. */
export const todayIso = (): string => new Date().toISOString().slice(0, 10);
