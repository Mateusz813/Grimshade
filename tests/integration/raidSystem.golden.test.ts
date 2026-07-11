import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Mulberry32 } from '../../src/systems/rng/mulberry32';
import {
    getRaidWaveCount,
    getAllRaids,
    getRaidById,
    estimateRaidRewards,
    generateWaveBosses,
    rollMemberRewards,
} from '../../src/systems/raidSystem';
import type { IRaid, IRaidBossState, IRaidMemberState } from '../../src/types/raid';

// ============================================================================
// GOLDEN-VECTOR EXPORT + GUARD dla raidSystem.
//
// Żyje w tests/integration/ (nie w src), bo używa API node (fs) do zapisu
// fixture — tsconfig.app typechecku je tylko `src`, więc tu node jest OK,
// a vitest i tak łapie tests/integration.
//
// Dwie role:
//  1. UPDATE_GOLDEN=1 → GENERUJE golden/raidSystem.json z realnych funkcji.
//  2. Normalnie → GUARD: asertuje, że commitowany fixture == aktualny output TS.
//
// Fixture jest kopiowany do backendu (grimshade-backend/tests/Golden/fixtures/
// raidSystem.json), gdzie Pest odtwarza go w PHP → parytet TS↔PHP.
//
// Regeneracja + kopia do backendu:
//   UPDATE_GOLDEN=1 npx vitest run tests/integration/raidSystem.golden.test.ts
//   cp golden/raidSystem.json ../grimshade-backend/tests/Golden/fixtures/
//
// ZAKRES PARYTETU:
//  - Deterministyczne (bit-exact): getRaidWaveCount / getAllRaids / getRaidById /
//    estimateRaidRewards / generateWaveBosses (skalowanie statów) / xp+gold z
//    rollMemberRewards. Te formuły to sedno raidów (fale, skalowanie, nagrody).
//  - Tabele dropów (rzadkość itemu / kamienia / bonus za rajd): czyste funkcje
//    wyboru rzadkości z wartości losowej — testowane wektorami roll→rzadkość
//    (referencja niżej mirroruje PRYWATNE tablice z raidSystem.ts) oraz seedami
//    mulberry32 (float z seeda → rzadkość, cały łańcuch maszynowo dowiedziony).
//  - ŚWIADOMIE POMINIĘTE (patrz RaidSystem.php docblock): pełne losowanie
//    dropów w rollMemberRewards woła generateRandomItem (itemGenerator), które
//    używa `.sort(() => Math.random() - 0.5)` — zmienna liczba rzutów Math.random
//    w V8 vs PHP → bit-parity NIEMOŻLIWE. Loot itemowy = serwer-autorytatywny
//    (backend rolluje własnym RNG). Pomijamy też: `id` bossa (Date.now +
//    Math.random base36 = token instancji), etykiety UI dropów, todayIso
//    (new Date), typy zdarzeń Realtime.
// ============================================================================

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

// Poziomy: brzegowe progów getRaidWaveCount (10/50/200/500) + realne poziomy
// raidów (100, 900, 960, 980, 1000) + zera/skrajne.
const WAVE_LEVELS = [
    0, 1, 5, 10, 11, 25, 50, 51, 100, 150, 200, 201, 300, 400, 500, 501, 600,
    700, 800, 900, 960, 980, 999, 1000,
];

// Syntetyczne raidy (level, waves) — testują formuły niezależnie od treści
// dungeonów (getAllRaids testowany osobno na realnej treści).
const mkRaid = (level: number, waves: number): IRaid => ({
    id: `raid_test_${level}_${waves}`,
    name_pl: 'Test Raid',
    level,
    waves,
    dailyAttempts: 5,
    sourceDungeonId: `dungeon_${level}`,
});

const RAIDS: IRaid[] = [
    mkRaid(1, 1),
    mkRaid(10, 1),
    mkRaid(11, 2),
    mkRaid(50, 2),
    mkRaid(51, 3),
    mkRaid(100, 3),
    mkRaid(200, 3),
    mkRaid(201, 4),
    mkRaid(500, 4),
    mkRaid(501, 5),
    mkRaid(900, 5),
    mkRaid(1000, 5),
    // Raidy z levelami pomiędzy kotwicami monsterów (pickBaseRaidMonster ≤).
    mkRaid(33, 2),
    mkRaid(275, 3),
    mkRaid(725, 5),
];

// Pary (raid, waveIdx) — waveIdx 0..4 skaluje staty (+15% na falę).
const WAVE_CASES: Array<{ raid: IRaid; waveIdx: number }> = [
    { raid: mkRaid(1, 1), waveIdx: 0 },
    { raid: mkRaid(50, 2), waveIdx: 0 },
    { raid: mkRaid(50, 2), waveIdx: 1 },
    { raid: mkRaid(200, 3), waveIdx: 2 },
    { raid: mkRaid(500, 4), waveIdx: 3 },
    { raid: mkRaid(1000, 5), waveIdx: 4 },
    { raid: mkRaid(275, 3), waveIdx: 1 },
    { raid: mkRaid(960, 5), waveIdx: 0 },
];

// Nagrody członka: zero killi, 1 kill, częściowy, dokładny full-clear (waves×4),
// over-clear (bonus dalej odpala tylko na pełnym).
const MEMBER_CASES: Array<{ raid: IRaid; bossesDefeated: number }> = [
    { raid: mkRaid(1, 1), bossesDefeated: 0 },
    { raid: mkRaid(1, 1), bossesDefeated: 1 },
    { raid: mkRaid(1, 1), bossesDefeated: 4 },
    { raid: mkRaid(50, 2), bossesDefeated: 3 },
    { raid: mkRaid(50, 2), bossesDefeated: 8 },
    { raid: mkRaid(200, 3), bossesDefeated: 12 },
    { raid: mkRaid(500, 4), bossesDefeated: 16 },
    { raid: mkRaid(1000, 5), bossesDefeated: 20 },
    { raid: mkRaid(1000, 5), bossesDefeated: 25 },
    { raid: mkRaid(960, 5), bossesDefeated: 7 },
];

// `id` bossa = niedeterministyczny token instancji (Date.now + Math.random) —
// wykluczony z parytetu. Bierzemy tylko deterministyczne pola statów.
const stripBossId = (b: IRaidBossState): Omit<IRaidBossState, 'id'> => ({
    baseId: b.baseId,
    level: b.level,
    name: b.name,
    sprite: b.sprite,
    maxHp: b.maxHp,
    currentHp: b.currentHp,
    attack: b.attack,
    defense: b.defense,
    isDead: b.isDead,
    waveIdx: b.waveIdx,
    slotIdx: b.slotIdx,
});

// Pełny stub członka — rollMemberRewards czyta tylko member.id do etykiet, ale
// budujemy kompletny obiekt żeby zachować typowanie (bez `as any`).
const stubMember: IRaidMemberState = {
    id: 'm1',
    name: 'Tester',
    class: 'Knight',
    level: 1,
    maxHp: 100,
    hp: 100,
    maxMp: 50,
    mp: 50,
    attack: 10,
    defense: 5,
    isDead: false,
    isBot: false,
    hasEscaped: false,
    color: '#ffffff',
    transformTier: 0,
};

// xp/gold z rollMemberRewards liczone są PRZED jakimkolwiek Math.random — są
// deterministyczne. Owijamy w withSeed dla porządku (drops/items ignorujemy).
const memberXpGold = (raid: IRaid, bossesDefeated: number): { xp: number; gold: number } =>
    withSeed(1, () => {
        const r = rollMemberRewards({ member: stubMember, raid, bossesDefeated });
        return { xp: r.xp, gold: r.gold };
    });

// ---------------------------------------------------------------------------
// Referencyjne tablice dropów — MIRROR prywatnych const z raidSystem.ts
// (nieeksportowane, więc nie da się ich zaimportować). Wektory roll→rzadkość
// dowodzą, że PHP selectItemRarity/selectStoneDrop/selectCompletionRarity liczą
// kumulatywnie identycznie (te same progi, ten sam operator `<`).
// ---------------------------------------------------------------------------
const ITEM_TABLE: Array<[string, number]> = [
    ['heroic', 0.005],
    ['mythic', 0.05],
    ['legendary', 0.1],
    ['epic', 0.2],
    ['rare', 0.5],
    ['common', 0.145],
];
const STONE_TABLE: Array<[string, number, string]> = [
    ['heroic', 0.01, 'heroic_stone'],
    ['mythic', 0.15, 'mythic_stone'],
    ['legendary', 0.25, 'legendary_stone'],
    ['epic', 0.4, 'epic_stone'],
    ['rare', 0.1, 'rare_stone'],
    ['common', 0.09, 'common_stone'],
];
const COMPLETION_TABLE: Array<[string, number]> = [
    ['heroic', 0.015],
    ['mythic', 0.08],
    ['legendary', 0.15],
    ['epic', 0.25],
    ['rare', 0.4],
    ['common', 0.105],
];

const refItemRarity = (roll: number): string | null => {
    let cum = 0;
    for (const [rarity, chance] of ITEM_TABLE) {
        cum += chance;
        if (roll < cum) return rarity;
    }
    return null;
};
const refStoneDrop = (roll: number): { rarity: string; id: string } | null => {
    let cum = 0;
    for (const [rarity, chance, id] of STONE_TABLE) {
        cum += chance;
        if (roll < cum) return { rarity, id };
    }
    return null;
};
const refCompletionRarity = (roll: number): string => {
    let cum = 0;
    for (const [rarity, chance] of COMPLETION_TABLE) {
        cum += chance;
        if (roll < cum) return rarity;
    }
    return 'common';
};

// Wartości losowe: brzegi kumulatywnych progów wszystkich trzech tabel + skrajne.
const ROLLS = [
    0, 0.0049, 0.005, 0.0055, 0.01, 0.015, 0.05, 0.0549, 0.055, 0.08, 0.095,
    0.1, 0.15, 0.155, 0.16, 0.2, 0.245, 0.25, 0.3, 0.355, 0.4, 0.41, 0.495,
    0.5, 0.55, 0.8, 0.81, 0.855, 0.895, 0.9, 0.91, 0.95, 0.999999,
];

const SEEDS = [1, 2, 3, 7, 13, 42, 99, 777];

const buildGolden = (): Record<string, unknown> => ({
    system: 'raidSystem',
    note: 'Generowane z src/systems/raidSystem.ts. NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1.',

    // Deterministyczne formuły
    getRaidWaveCount: WAVE_LEVELS.map((level) => ({ level, value: getRaidWaveCount(level) })),
    getAllRaids: getAllRaids(),
    getRaidById: [
        { id: 'raid_1', value: getRaidById('raid_1') },
        { id: 'raid_1000', value: getRaidById('raid_1000') },
        { id: 'raid_500', value: getRaidById('raid_500') },
        { id: 'raid_nope', value: getRaidById('raid_nope') },
        { id: '', value: getRaidById('') },
    ],
    estimateRaidRewards: RAIDS.map((raid) => ({ raid, value: estimateRaidRewards(raid) })),
    generateWaveBosses: WAVE_CASES.map(({ raid, waveIdx }) => ({
        raid,
        waveIdx,
        value: generateWaveBosses(raid, waveIdx).map(stripBossId),
    })),
    memberRewards: MEMBER_CASES.map(({ raid, bossesDefeated }) => ({
        raid,
        bossesDefeated,
        value: memberXpGold(raid, bossesDefeated),
    })),

    // Tabele dropów — selektory rzadkości (roll → rzadkość)
    selectItemRarity: ROLLS.map((roll) => ({ roll, value: refItemRarity(roll) })),
    selectStoneDrop: ROLLS.map((roll) => ({ roll, value: refStoneDrop(roll) })),
    selectCompletionRarity: ROLLS.map((roll) => ({ roll, value: refCompletionRarity(roll) })),

    // Seedowane selektory: pierwszy float z mulberry32(seed) → rzadkość. Dowodzi
    // parytetu mulberry32 (PHP regeneruje float z seeda) + mapowania rzadkości.
    seededSelectors: SEEDS.map((seed) => {
        const roll = withSeed(seed, () => Math.random());
        return {
            seed,
            item: refItemRarity(roll),
            stone: refStoneDrop(roll),
            completion: refCompletionRarity(roll),
        };
    }),
});

const outPath = resolve(process.cwd(), 'golden/raidSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('raidSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current raidSystem output', () => {
        expect(existsSync(outPath), 'brak golden/raidSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        // Normalizacja przez JSON — usuwa -0 (i tak liczy PHP). Parytet nienaruszony.
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
