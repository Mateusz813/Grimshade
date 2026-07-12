import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Mulberry32 } from '../../src/systems/rng/mulberry32';
import {
    BOSS_HP_MULTIPLIER,
    BOSS_ATK_MULTIPLIER,
    BOSS_DEF_MULTIPLIER,
    BOSS_REWARD_MULTIPLIER,
    getBossDrops,
    getBossCooldown,
    getScaledBossStats,
    getBossPhaseMultiplier,
    isBossEnraged,
    computeBossRewards,
    getBossGoldRange,
    getBossXp,
    getBossRecommendedLevel,
    canChallengeBoss,
    getBossRemainingMs,
    rollBossGold,
    rollBossLoot,
    resolveBoss,
    type IBoss,
    type IBossCharacter,
} from '../../src/systems/bossSystem';
import bossesData from '../../src/data/bosses.json';


const withSeed = <T>(seed: number, fn: () => T): T => {
    const rng = new Mulberry32(seed);
    const orig = Math.random;
    Math.random = () => rng.nextFloat();
    try {
        return fn();
    } finally {
        Math.random = orig;
    }
};

const withNow = <T>(nowMs: number, fn: () => T): T => {
    const orig = Date.now;
    Date.now = () => nowMs;
    try {
        return fn();
    } finally {
        Date.now = orig;
    }
};

const BOSSES = bossesData as unknown as IBoss[];

const boss = (id: string): IBoss => {
    const found = BOSSES.find((b) => b.id === id);
    if (!found) throw new Error(`Nieznany boss w golden: ${id}`);
    return found;
};

const mkBoss = (over: Partial<IBoss> & { id: string }): IBoss => ({
    id: over.id,
    name_pl: 'X',
    name_en: 'X',
    level: 1,
    hp: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    xp: 0,
    gold: [0, 0],
    sprite: 'x',
    description_pl: 'x',
    ...over,
});

const SEEDS = [1, 2, 3, 7, 13, 42, 99, 777];

const REWARD_LEVELS = [-5, 0, 1, 2, 5, 10, 50, 99, 100, 101, 150, 200, 400, 500, 600, 800, 999, 1000, 1001, 1010, 1100];

const REAL_IDS = [
    'sewer_king', 'shadow_lord', 'ancient_dragon', 'demon_king', 'lich_king',
    'chaos_emperor', 'abyssal_titan', 'infernal_overlord', 'celestial_destroyer',
    'world_eater', 'world_destroyer', 'end_of_all',
];

const PHASE_FRACTIONS = [-0.1, 0, 0.1, 0.2, 0.2999, 0.3, 0.3001, 0.5, 1, 2];

const ENRAGE_CASES: Array<[number, number]> = [
    [0, 100], [29, 100], [30, 100], [100, 100], [0, 0], [50, 0],
    [15, 50], [14, 50], [1, 1000], [300, 1000],
];

const SCALED_SYNTH = [
    mkBoss({ id: 'syn_zero', level: 1, hp: 0, attack: 0, defense: 0 }),
    mkBoss({ id: 'syn_one', level: 1, hp: 1, attack: 1, defense: 1 }),
    mkBoss({ id: 'syn_small_atk', level: 5, hp: 100, attack: 2, defense: 0 }),
    mkBoss({ id: 'syn_big', level: 1000, hp: 1_000_000, attack: 9999, defense: 500 }),
];

const DROPS_SYNTH = [
    mkBoss({
        id: 'syn_unique',
        uniqueDrops: [{ itemId: 'a', chance: 0.5, rarity: 'rare' }],
        dropTable: [{ itemId: 'b', chance: 0.1, rarity: 'epic' }],
    }),
    mkBoss({
        id: 'syn_unique_empty',
        uniqueDrops: [],
        dropTable: [{ itemId: 'b', chance: 0.1, rarity: 'epic' }],
    }),
    mkBoss({ id: 'syn_droptable', dropTable: [{ itemId: 'c', chance: 0.2, rarity: 'common' }] }),
    mkBoss({ id: 'syn_no_drops' }),
];

const COOLDOWN_SYNTH = [
    mkBoss({ id: 'syn_cd', cooldown: 3600, dailyAttempts: 3 }),
    mkBoss({ id: 'syn_cd0', cooldown: 0, dailyAttempts: 3 }),
    mkBoss({ id: 'syn_da7', dailyAttempts: 7 }),
    mkBoss({ id: 'syn_da0', dailyAttempts: 0 }),
    mkBoss({ id: 'syn_da_neg', dailyAttempts: -5 }),
    mkBoss({ id: 'syn_cd_none' }),
];

const CD_MS = 28_800_000;
const T0 = 1_700_000_000_000;

const CHALLENGE_CASES: Array<{ bossId: string; characterLevel: number; nowMs: number; lastMs: number | null }> = [
    { bossId: 'demon_king', characterLevel: 99, nowMs: T0 + 5, lastMs: T0 },
    { bossId: 'demon_king', characterLevel: 100, nowMs: T0 + 5, lastMs: null },
    { bossId: 'demon_king', characterLevel: 150, nowMs: T0 + 10_000_000, lastMs: T0 },
    { bossId: 'demon_king', characterLevel: 150, nowMs: T0 + CD_MS, lastMs: T0 },
    { bossId: 'demon_king', characterLevel: 150, nowMs: T0 + CD_MS + 1, lastMs: T0 },
    { bossId: 'demon_king', characterLevel: 150, nowMs: T0 + CD_MS - 1, lastMs: T0 },
    { bossId: 'end_of_all', characterLevel: 1000, nowMs: T0 + 50_000_000, lastMs: T0 },
    { bossId: 'end_of_all', characterLevel: 500, nowMs: T0 + 50_000_000, lastMs: T0 },
    { bossId: 'sewer_king', characterLevel: 10, nowMs: T0, lastMs: T0 },
    { bossId: 'sewer_king', characterLevel: 9, nowMs: T0, lastMs: null },
];

const REMAINING_CASES: Array<{ bossId: string; nowMs: number; lastMs: number | null }> = [
    { bossId: 'demon_king', nowMs: T0 + 10_000_000, lastMs: T0 },
    { bossId: 'demon_king', nowMs: T0 + CD_MS, lastMs: T0 },
    { bossId: 'demon_king', nowMs: T0 + CD_MS + 5_000_000, lastMs: T0 },
    { bossId: 'demon_king', nowMs: T0 + 999, lastMs: null },
    { bossId: 'end_of_all', nowMs: T0 + 1_000_000, lastMs: T0 },
    { bossId: 'sewer_king', nowMs: T0, lastMs: T0 },
];

const RESOLVE_CASES: Array<{ bossId: string; character: IBossCharacter }> = [
    { bossId: 'sewer_king', character: { attack: 5000, defense: 1000, max_hp: 100_000, level: 50 } },
    { bossId: 'demon_king', character: { attack: 2000, defense: 200, max_hp: 50_000, level: 120 } },
    { bossId: 'ancient_dragon', character: { attack: 1000, defense: 200, max_hp: 200_000, level: 55 } },
    { bossId: 'end_of_all', character: { attack: 100, defense: 10, max_hp: 500, level: 10 } },
];

const iso = (ms: number): string => new Date(ms).toISOString();

const buildGolden = (): Record<string, unknown> => ({
    system: 'bossSystem',
    note: 'Generowane z src/systems/bossSystem.ts + realne bosses.json. Funkcje RNG: seed + mulberry32; cooldown: now/last w ms. NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1.',

    constants: {
        hpMultiplier: BOSS_HP_MULTIPLIER,
        atkMultiplier: BOSS_ATK_MULTIPLIER,
        defMultiplier: BOSS_DEF_MULTIPLIER,
        rewardMultiplier: BOSS_REWARD_MULTIPLIER,
    },

    getScaledBossStats: REAL_IDS.map((id) => ({ bossId: id, value: getScaledBossStats(boss(id)) })),
    getScaledBossStatsSynthetic: SCALED_SYNTH.map((b) => ({ boss: b, value: getScaledBossStats(b) })),

    getBossDrops: REAL_IDS.map((id) => ({ bossId: id, value: getBossDrops(boss(id)) })),
    getBossDropsSynthetic: DROPS_SYNTH.map((b) => ({ boss: b, value: getBossDrops(b) })),

    getBossCooldown: REAL_IDS.map((id) => ({ bossId: id, value: getBossCooldown(boss(id)) })),
    getBossCooldownSynthetic: COOLDOWN_SYNTH.map((b) => ({ boss: b, value: getBossCooldown(b) })),

    getBossPhaseMultiplier: PHASE_FRACTIONS.map((fraction) => ({ fraction, value: getBossPhaseMultiplier(fraction) })),
    isBossEnraged: ENRAGE_CASES.map(([currentHp, maxHp]) => ({ currentHp, maxHp, value: isBossEnraged(currentHp, maxHp) })),

    computeBossRewards: REWARD_LEVELS.map((level) => ({ level, value: computeBossRewards(level) })),
    getBossGoldRange: REAL_IDS.map((id) => ({ bossId: id, value: getBossGoldRange(boss(id)) })),
    getBossXp: REAL_IDS.map((id) => ({ bossId: id, value: getBossXp(boss(id)) })),
    getBossRecommendedLevel: REAL_IDS.map((id) => ({ bossId: id, value: getBossRecommendedLevel(boss(id)) })),

    canChallengeBoss: CHALLENGE_CASES.map((c) => ({
        bossId: c.bossId,
        characterLevel: c.characterLevel,
        nowMs: c.nowMs,
        lastMs: c.lastMs,
        value: withNow(c.nowMs, () => canChallengeBoss(
            boss(c.bossId),
            c.characterLevel,
            c.lastMs === null ? null : iso(c.lastMs),
        )),
    })),
    getBossRemainingMs: REMAINING_CASES.map((c) => ({
        bossId: c.bossId,
        nowMs: c.nowMs,
        lastMs: c.lastMs,
        value: withNow(c.nowMs, () => getBossRemainingMs(
            boss(c.bossId),
            c.lastMs === null ? null : iso(c.lastMs),
        )),
    })),

    rollBossGold: ['sewer_king', 'demon_king', 'end_of_all'].flatMap((id) =>
        SEEDS.map((seed) => ({ bossId: id, seed, value: withSeed(seed, () => rollBossGold(boss(id))) })),
    ),
    rollBossLoot: ['sewer_king', 'shadow_lord', 'ancient_dragon'].flatMap((id) =>
        SEEDS.map((seed) => ({ bossId: id, seed, value: withSeed(seed, () => rollBossLoot(boss(id))) })),
    ),
    resolveBoss: RESOLVE_CASES.flatMap((c) =>
        SEEDS.map((seed) => ({
            bossId: c.bossId,
            character: c.character,
            seed,
            result: withSeed(seed, () => resolveBoss(boss(c.bossId), c.character)),
        })),
    ),
});

const outPath = resolve(process.cwd(), 'golden/bossSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('bossSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current bossSystem output', () => {
        expect(existsSync(outPath), 'brak golden/bossSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
