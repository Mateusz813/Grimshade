import dungeonsRaw from '../data/dungeons.json';
import monstersRaw from '../data/monsters.json';
import { generateRandomItem } from './itemGenerator';
import { SPELL_CHEST_LEVELS } from './skillSystem';
import { getPotionDropInfo } from './lootSystem';
import { formatGoldShort } from './goldFormat';
import { MONSTER_STAT_MULTIPLIERS } from './combat';
import type { IRaid, IRaidBossState, IRaidDropLine, IRaidMemberState } from '../types/raid';
import type { Rarity, IInventoryItem } from './itemSystem';

interface IDungeonRow {
    id: string;
    name_pl: string;
    level: number;
}

interface IMonsterRow {
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
const MONSTERS = monstersRaw as unknown as IMonsterRow[];

const BOSS_TIER_MULT = MONSTER_STAT_MULTIPLIERS.boss;

const RAID_REWARD_MULTIPLIER = 12;

const levelXpBonus = (raidLevel: number): number => raidLevel * raidLevel;
const levelGoldBonus = (raidLevel: number): number => raidLevel * 1_000;

const STONE_DROPS: Array<{ rarity: string; chance: number; id: string }> = [
    { rarity: 'heroic',    chance: 0.01, id: 'heroic_stone' },
    { rarity: 'mythic',    chance: 0.15, id: 'mythic_stone' },
    { rarity: 'legendary', chance: 0.25, id: 'legendary_stone' },
    { rarity: 'epic',      chance: 0.40, id: 'epic_stone' },
    { rarity: 'rare',      chance: 0.10, id: 'rare_stone' },
    { rarity: 'common',    chance: 0.09, id: 'common_stone' },
];

const ITEM_RARITY_CHANCES: Array<{ rarity: Rarity; chance: number }> = [
    { rarity: 'heroic',    chance: 0.005 },
    { rarity: 'mythic',    chance: 0.05  },
    { rarity: 'legendary', chance: 0.10  },
    { rarity: 'epic',      chance: 0.20  },
    { rarity: 'rare',      chance: 0.50  },
    { rarity: 'common',    chance: 0.145 },
];

const SPELL_CHEST_CHANCE_PER_LEVEL = 0.0025;

export const getRaidWaveCount = (raidLevel: number): number => {
    if (raidLevel <= 10) return 1;
    if (raidLevel <= 50) return 2;
    if (raidLevel <= 200) return 3;
    if (raidLevel <= 500) return 4;
    return 5;
};

export const getAllRaids = (): IRaid[] =>
    DUNGEONS.map((d) => ({
        id: `raid_${d.id.replace('dungeon_', '')}`,
        name_pl: d.name_pl,
        level: d.level,
        waves: getRaidWaveCount(d.level),
        dailyAttempts: 5,
        sourceDungeonId: d.id,
    }));

export const getRaidById = (id: string): IRaid | null =>
    getAllRaids().find((r) => r.id === id) ?? null;

export const estimateRaidRewards = (raid: IRaid): {
    goldMin: number;
    goldMax: number;
    xp: number;
} => {
    const base = pickBaseRaidMonster(raid.level);
    const totalBosses = raid.waves * 4;
    const factor = totalBosses * RAID_REWARD_MULTIPLIER;
    const xpPerKill = Math.floor(base.xp * BOSS_TIER_MULT.xp);
    const goldMinPerKill = Math.floor(base.gold[0] * BOSS_TIER_MULT.gold);
    const goldMaxPerKill = Math.floor(base.gold[1] * BOSS_TIER_MULT.gold);
    const xpBonus = levelXpBonus(raid.level);
    const goldBonus = levelGoldBonus(raid.level);
    return {
        goldMin: goldMinPerKill * factor + goldBonus,
        goldMax: goldMaxPerKill * factor + goldBonus,
        xp:      xpPerKill      * factor + xpBonus,
    };
};

function pickBaseRaidMonster(raidLevel: number): IMonsterRow {
    const eligible = MONSTERS.filter((m) => m.level <= raidLevel);
    if (eligible.length === 0) return MONSTERS[0];
    eligible.sort((a, b) => b.level - a.level);
    return eligible[0];
}

export const generateWaveBosses = (
    raid: IRaid,
    waveIdx: number,
): IRaidBossState[] => {
    const base = pickBaseRaidMonster(raid.level);
    const levelGap = Math.max(1, raid.level - base.level);
    const mult = (1 + levelGap * 0.05) * (1 + waveIdx * 0.15);
    return Array.from({ length: 4 }).map((_, slotIdx) => {
        const hp = Math.floor(base.hp * BOSS_TIER_MULT.hp * mult);
        return {
            id: `raid_boss_${waveIdx}_${slotIdx}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            baseId: base.id,
            level: base.level,
            name: `${base.name_pl} #${slotIdx + 1}`,
            sprite: base.sprite,
            maxHp: hp,
            currentHp: hp,
            attack: Math.floor(base.attack * BOSS_TIER_MULT.atk * mult),
            defense: Math.floor(base.defense * BOSS_TIER_MULT.def * mult),
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

export const rollMemberRewards = (ctx: IMemberRewardContext): {
    xp: number;
    gold: number;
    drops: IRaidDropLine[];
    items: IInventoryItem[];
} => {
    const { member, raid, bossesDefeated } = ctx;

    const base = pickBaseRaidMonster(raid.level);
    const xpPerKill = Math.floor(base.xp * BOSS_TIER_MULT.xp);
    const goldMidPerKill = Math.floor(((base.gold[0] + base.gold[1]) / 2) * BOSS_TIER_MULT.gold);
    const totalSlots = Math.max(1, raid.waves * 4);
    const cleared = bossesDefeated >= totalSlots;
    const xpBonus = cleared ? levelXpBonus(raid.level) : 0;
    const goldBonus = cleared ? levelGoldBonus(raid.level) : 0;
    const xp = xpPerKill * bossesDefeated * RAID_REWARD_MULTIPLIER + xpBonus;
    const gold = goldMidPerKill * bossesDefeated * RAID_REWARD_MULTIPLIER + goldBonus;

    const drops: IRaidDropLine[] = [];
    const items: IInventoryItem[] = [];

    drops.push({ kind: 'xp', memberId: member.id, label: `+${xp.toLocaleString('pl-PL')} XP`, amount: xp });
    drops.push({ kind: 'gold', memberId: member.id, label: `+${formatGoldShort(gold)}`, amount: gold });

    const eligibleChests = SPELL_CHEST_LEVELS.filter((lvl) => lvl <= raid.level);

    for (let i = 0; i < bossesDefeated; i++) {
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

        const potionInfo = getPotionDropInfo(raid.level);
        if (Math.random() < potionInfo.hpChance) {
            drops.push({
                kind: 'potion',
                memberId: member.id,
                label: `${potionInfo.hpLabel} (${potionInfo.hpHeal})`,
                itemId: potionInfo.hpPotionId,
            });
        }
        if (Math.random() < potionInfo.mpChance) {
            drops.push({
                kind: 'potion',
                memberId: member.id,
                label: `${potionInfo.mpLabel} (${potionInfo.mpHeal})`,
                itemId: potionInfo.mpPotionId,
            });
        }
        if (potionInfo.mega) {
            if (Math.random() < potionInfo.mega.chance) {
                drops.push({
                    kind: 'potion',
                    memberId: member.id,
                    label: `${potionInfo.mega.hpLabel} (${potionInfo.mega.hpHeal})`,
                    itemId: potionInfo.mega.hpPotionId,
                });
            }
            if (Math.random() < potionInfo.mega.chance) {
                drops.push({
                    kind: 'potion',
                    memberId: member.id,
                    label: `${potionInfo.mega.mpLabel} (${potionInfo.mega.mpHeal})`,
                    itemId: potionInfo.mega.mpPotionId,
                });
            }
        }

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

    const COMPLETION_ROLL: Array<{ rarity: Rarity; chance: number }> = [
        { rarity: 'heroic',    chance: 0.015 },
        { rarity: 'mythic',    chance: 0.08  },
        { rarity: 'legendary', chance: 0.15  },
        { rarity: 'epic',      chance: 0.25  },
        { rarity: 'rare',      chance: 0.40  },
        { rarity: 'common',    chance: 0.105 },
    ];
    const bonusRoll = Math.random();
    let bcum = 0;
    let rolledRarity: Rarity = 'common';
    for (const tier of COMPLETION_ROLL) {
        bcum += tier.chance;
        if (bonusRoll < bcum) {
            rolledRarity = tier.rarity;
            break;
        }
    }
    const FALLBACK_ORDER: Rarity[] = ['heroic', 'mythic', 'legendary', 'epic', 'rare', 'common'];
    const startIdx = FALLBACK_ORDER.indexOf(rolledRarity);
    let generated: ReturnType<typeof generateRandomItem> = null;
    let finalRarity: Rarity = rolledRarity;
    for (let i = Math.max(0, startIdx); i < FALLBACK_ORDER.length; i++) {
        finalRarity = FALLBACK_ORDER[i];
        generated = generateRandomItem(raid.level, finalRarity);
        if (generated) break;
    }
    if (generated) {
        items.push(generated);
        drops.push({
            kind: 'item',
            memberId: member.id,
            label: `:trophy: Bonus za rajd: ${finalRarity}`,
            rarity: finalRarity,
            itemId: generated.itemId,
            isBonus: true,
        });
    }

    return { xp, gold, drops, items };
};

export const todayIso = (): string => new Date().toISOString().slice(0, 10);
