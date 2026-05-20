import dungeonsRaw from '../data/dungeons.json';
import monstersRaw from '../data/monsters.json';
import { generateRandomItem } from './itemGenerator';
import { SPELL_CHEST_LEVELS } from './skillSystem';
import { getPotionDropInfo } from './lootSystem';
import { formatGoldShort } from './goldFormat';
import { MONSTER_STAT_MULTIPLIERS } from './combat';
import type { IRaid, IRaidBossState, IRaidDropLine, IRaidMemberState } from '../types/raid';
import type { Rarity } from './itemSystem';
import type { IInventoryItem } from '../types/inventory';

interface IDungeonRow {
    id: string;
    name_pl: string;
    level: number;
}

/** Subset of monster fields used when picking a raid spawn template. */
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
const MONSTERS = monstersRaw as IMonsterRow[];

/**
 * Boss-tier monster multipliers (from `combat.ts`). Raid spawns are
 * regular monsters wearing the "boss" rarity hat, so per-kill rewards
 * follow the same scaling that a boss-tier mob in the wild would pay:
 *   xp_per_kill   = monster.xp   × 10
 *   gold_per_kill = monster.gold × 15
 * Stats (HP / ATK / DEF) likewise inherit the boss-tier multipliers so
 * raid encounters feel like fighting an elite squad of the dungeon's
 * native bestiary.
 */
const BOSS_TIER_MULT = MONSTER_STAT_MULTIPLIERS.boss;

/**
 * End-to-end raid reward multiplier — applied on top of the per-kill
 * boss-tier numbers. A full clear pays:
 *   total_xp   = Σ (monster.xp × 10) × RAID_REWARD_MULTIPLIER + LEVEL_XP_BONUS
 *   total_gold = Σ (avg(monster.gold) × 15) × RAID_REWARD_MULTIPLIER + LEVEL_GOLD_BONUS
 * The `× 12` matches the spec — sum of all defeated boss-tier mobs ×12,
 * paired with the dungeon's existing × 4 multiplier so raids pay
 * meaningfully more than soloing the equivalent dungeon while staying
 * grounded in the actual mob rewards.
 */
const RAID_REWARD_MULTIPLIER = 12;

/**
 * Level-driven completion bonus on top of the per-kill payout. Differentiates
 * raid lvl 960 vs 980 (otherwise identical past the multiplier) and keeps
 * end-game raids paying a meaningful XP delta even when boss-tier mob XP
 * caps out around the bestiary's tail.
 *   bonus_xp   = raid.level²        (so lvl 1 = +1, lvl 900 = +810 000)
 *   bonus_gold = raid.level × 1 000 (so lvl 1 = +1 k, lvl 960 = +9,6 cc)
 */
const levelXpBonus = (raidLevel: number): number => raidLevel * raidLevel;
const levelGoldBonus = (raidLevel: number): number => raidLevel * 1_000;

/**
 * Upgrade stone rarity roll per boss (sums to 100%).
 *
 * 2026-04 rebalance per spec — raid stones favour the high tiers because
 * the per-day attempt cap (5) and party-only requirement already throttle
 * supply. Heroic stays a long-shot reward (1%); the bulk of drops land in
 * Epic/Mythic so a successful raid actually feels rewarding for the four
 * people who showed up.
 */
const STONE_DROPS: Array<{ rarity: string; chance: number; id: string }> = [
    { rarity: 'heroic',    chance: 0.01, id: 'heroic_stone' },
    { rarity: 'mythic',    chance: 0.15, id: 'mythic_stone' },
    { rarity: 'legendary', chance: 0.25, id: 'legendary_stone' },
    { rarity: 'epic',      chance: 0.40, id: 'epic_stone' },
    { rarity: 'rare',      chance: 0.10, id: 'rare_stone' },
    { rarity: 'common',    chance: 0.09, id: 'common_stone' },
];

/**
 * Item rarity roll per boss (sums to 100%).
 *
 * 2026-04 rebalance per spec — Heroic 0.5% / Mythic 5% / Legendary 10% /
 * Epic 20% / Rare 50% / Common 14.5%. The shape matches a "rare-skewed"
 * curve: most loot is Rare-tier, but the long tail still feeds Heroic/
 * Mythic occasionally so end-game raiders can chase top-end items without
 * grinding pure RNG misery.
 */
const ITEM_RARITY_CHANCES: Array<{ rarity: Rarity; chance: number }> = [
    { rarity: 'heroic',    chance: 0.005 },
    { rarity: 'mythic',    chance: 0.05  },
    { rarity: 'legendary', chance: 0.10  },
    { rarity: 'epic',      chance: 0.20  },
    { rarity: 'rare',      chance: 0.50  },
    { rarity: 'common',    chance: 0.145 },
];

// 2026-04 spec adjustment: spell chests dropped from 1.5% → 0.25% per chest
// level so a single raid no longer drowns the player in chests. The modal
// "📦 Spell Chests" section advertises the same number, so displayed odds
// match what the engine rolls. Potions are now driven directly by
// `getPotionDropInfo(raid.level)` (mirrors dungeons): two independent
// rolls (HP + MP) at the level-gated chance — no separate constant.
const SPELL_CHEST_CHANCE_PER_LEVEL = 0.0025;

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
        // 2026-04 spec bump: 3 → 5 daily attempts. Raids are party-only and
        // demand more coordination than dungeons, so the cap is a touch
        // more generous to give groups time to actually field a full team.
        dailyAttempts: 5,
        sourceDungeonId: d.id,
    }));

export const getRaidById = (id: string): IRaid | null =>
    getAllRaids().find((r) => r.id === id) ?? null;

/**
 * Display-side reward estimate for the raid card / drop modal. Mirrors the
 * formula in `rollMemberRewards` so the numbers shown to the player are the
 * same ones the engine will actually roll — no surprise multipliers. The
 * gold range stays as-is (boss row's [min, max] tuple, scaled by stat
 * multiplier × 4 bosses × ×10 batch multiplier × wave count); XP is rolled
 * to a single point estimate the same way the engine does it.
 *
 * Kept here (as opposed to in Raid.tsx) so the raid view can pull it as a
 * one-liner and any future engine tweaks update both sides at once. The
 * dungeon view uses the same shape via `estimateDungeonRewards`, so the two
 * card layouts read identical: "💰 {min}–{max}" + "⭐ ~{xp} XP".
 */
export const estimateRaidRewards = (raid: IRaid): {
    goldMin: number;
    goldMax: number;
    xp: number;
} => {
    // Full-clear projection — every spawn in every wave at boss-tier mob
    // rewards (× 10 XP, × 15 gold), summed and multiplied by the raid
    // multiplier. Mirrors `rollMemberRewards` exactly when
    // `bossesDefeated === waves × 4`.
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

/**
 * Pick a base monster template close to the raid level (≤). Declared with
 * `function` syntax (rather than a const arrow) so it's hoisted — the
 * `estimateRaidRewards` arrow above this needs to reference it, and arrow
 * consts aren't hoisted past the temporal dead zone.
 */
function pickBaseRaidMonster(raidLevel: number): IMonsterRow {
    const eligible = MONSTERS.filter((m) => m.level <= raidLevel);
    if (eligible.length === 0) return MONSTERS[0];
    eligible.sort((a, b) => b.level - a.level);
    return eligible[0];
}

/**
 * Generate the 4 boss-tier mob slots for a given wave. Stats are the picked
 * base monster's numbers wearing the `MONSTER_STAT_MULTIPLIERS.boss` hat,
 * scaled by raid-level gap (+5% per level above the monster's native level)
 * and wave index (+15% per later wave so wave 5 fights harder than wave 1).
 */
export const generateWaveBosses = (
    raid: IRaid,
    waveIdx: number,
): IRaidBossState[] => {
    const base = pickBaseRaidMonster(raid.level);
    const levelGap = Math.max(1, raid.level - base.level);
    // Stat multiplier: +5% per level gap, +15% per wave index (later waves harder).
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

    // Per-kill rewards = boss-tier mob payout (monster.xp × 10, gold × 15).
    // Total = Σ per-kill × RAID_REWARD_MULTIPLIER (×12) + level-driven
    // completion bonus (only awarded on full clear so partial runs stay
    // tied strictly to kills). Item / stone / potion / chest drops are
    // still rolled per defeated boss below; the completion-roll item at
    // the bottom of this function fires once the run is over.
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

        // Potion drops — HP and MP roll independently, tier and rate
        // gated by raid level (1:1 with the dungeon's potion mechanic via
        // `getPotionDropInfo`). Low-tier raids get flat 0.4% per type
        // (≈0.8% combined) while high-tier raids drop the rate but pay
        // out percentage-heal potions — same curve dungeons walk so the
        // two systems read the same in the drop modal.
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
        // Mega-elixir bonus tier (raids of level 100+) — independent
        // rolls on top of the main potion rolls, same as dungeons.
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

    // ── Raid-completion bonus roll ─────────────────────────────────────────
    // Spec item 5: "per-member loot + extra raid-completion roll". On top of
    // the per-boss drops above, every surviving member gets a single high-
    // weighted item roll for clearing the whole raid. The rarity table
    // skews higher than the per-boss one (Heroic 1.5%, Mythic 8%, Legendary
    // 15%, Epic 25%, Rare 40%, Common 10.5% — sums to 100%). This is the
    // "thank you for finishing" reward distinct from grind drops.
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
    // The completion-roll bonus is GUARANTEED — every surviving member
    // gets one item. If `generateRandomItem` returns null for the rolled
    // rarity (e.g. the bestiary template registry has no entry for that
    // class/level/rarity combo), fall back through rarities (heroic →
    // mythic → ... → common) until one generates. The fallback uses the
    // ordered tier list above so a player who rolled a Heroic but the
    // generator failed still ends up with a higher-tier item rather than
    // a missing reward.
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
            label: `🏆 Bonus za rajd: ${finalRarity}`,
            rarity: finalRarity,
            itemId: generated.itemId,
            isBonus: true,
        });
    }

    return { xp, gold, drops, items };
};

/** Today's ISO date (YYYY-MM-DD) for attempt tracking. */
export const todayIso = (): string => new Date().toISOString().slice(0, 10);
