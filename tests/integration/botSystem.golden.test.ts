import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Mulberry32 } from '../../src/systems/rng/mulberry32';
import {
    generateBot,
    generateBotWithClass,
    generateBotParty,
    calculateBotAction,
    pickAggroTarget,
    calculateAoeDamage,
    isBossAoeTurn,
    getAggroSwitchInterval,
    type IAggroCandidate,
} from '../../src/systems/botSystem';
import type { TCharacterClass } from '../../src/types/character';
import type { IBot, IBotAction } from '../../src/types/bot';
import type { IBoss } from '../../src/systems/bossSystem';

// ============================================================================
// GOLDEN-VECTOR EXPORT + GUARD dla botSystem.ts (parytet TS↔PHP).
//
// Funkcje losujące (generateBot / generateBotWithClass / generateBotParty /
// calculateBotAction / pickAggroTarget / getAggroSwitchInterval) konsumują
// Math.random w STAŁEJ kolejności → podmieniamy Math.random na mulberry32(seed)
// i zapisujemy seed; backend z Mulberry32Rng(seed) konsumuje identycznie.
//
// `id` bota = `bot_${botIdCounter}_${Date.now()}` — licznik modułu + zegar. To
// runtime-owe artefakty, więc PARAMETRYZUJEMY je: mockujemy Date.now na stałą
// (FAKE_NOW) i wyciągamy `botSeq` z wygenerowanego id. PHP dostaje botSeq + nowMs
// jawnie i odtwarza id 1:1. Reszta pól (klasa/poziom/nazwa/staty) to realny
// parytet RNG + czyste tabele statów z classes.json.
//
// POMINIĘTE (UI/ikony): BOT_CLASS_ICONS + getBotLogIcon (shortcody ikon do
// combat-logu) — czysta prezentacja, patrz pole skipped w raporcie.
//
// Regeneracja + kopia do backendu:
//   UPDATE_GOLDEN=1 npx vitest run tests/integration/botSystem.golden.test.ts
//   cp golden/botSystem.json ../grimshade-backend/tests/Golden/fixtures/
// ============================================================================

const SEEDS = [1, 2, 3, 7, 13, 42, 99, 777];
const FAKE_NOW = 1_700_000_000_000;
const ALL_CLASSES: TCharacterClass[] = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'];

// Podmienia Math.random (mulberry32 z seedem) ORAZ Date.now (stała) na czas fn.
const withSeed = <T>(seed: number, fn: () => T): T => {
    const rng = new Mulberry32(seed);
    const origRandom = Math.random;
    const origNow = Date.now;
    Math.random = (): number => rng.nextFloat();
    Date.now = (): number => FAKE_NOW;
    try {
        return fn();
    } finally {
        Math.random = origRandom;
        Date.now = origNow;
    }
};

// `bot_${seq}_${now}` → seq (środkowy segment).
const botSeqOf = (id: string): number => Number(id.split('_')[1]);

// Pełny IBoss z atrapami — calculateBotAction czyta tylko boss.defense.
const makeBoss = (defense: number): IBoss => ({
    id: 'boss_test',
    name_pl: 'Test',
    name_en: 'Test',
    level: 50,
    hp: 1000,
    attack: 100,
    defense,
    speed: 1,
    xp: 100,
    gold: [10, 20],
    sprite: 'x',
    description_pl: 'x',
});

// Pełny IBot z sensownymi domyślnymi — nadpisywany przez `overrides`.
const makeBot = (overrides: Partial<IBot>): IBot => ({
    id: 'bot_action',
    name: 'Tester',
    class: 'Knight',
    level: 10,
    hp: 200,
    maxHp: 200,
    mp: 100,
    maxMp: 100,
    attack: 30,
    defense: 12,
    attackSpeed: 1.5,
    critChance: 5,
    magicLevel: 0,
    skillId: null,
    skillDamageMultiplier: 0,
    skillMpCost: 0,
    skillCooldownMs: 5000,
    alive: true,
    ...overrides,
});

interface IGenBotCase {
    seed: number;
    playerLevel: number;
    playerClass: TCharacterClass;
    existingClasses: TCharacterClass[];
    botSeq: number;
    nowMs: number;
    value: IBot;
}

const genBot = (
    seed: number,
    playerLevel: number,
    playerClass: TCharacterClass,
    existingClasses: TCharacterClass[],
): IGenBotCase => {
    const value = withSeed(seed, () => generateBot(playerLevel, playerClass, existingClasses));
    return { seed, playerLevel, playerClass, existingClasses, botSeq: botSeqOf(value.id), nowMs: FAKE_NOW, value };
};

interface IGenWithClassCase {
    seed: number;
    playerLevel: number;
    botClass: TCharacterClass;
    botSeq: number;
    nowMs: number;
    value: IBot;
}

const genWithClass = (seed: number, playerLevel: number, botClass: TCharacterClass): IGenWithClassCase => {
    const value = withSeed(seed, () => generateBotWithClass(playerLevel, botClass));
    return { seed, playerLevel, botClass, botSeq: botSeqOf(value.id), nowMs: FAKE_NOW, value };
};

interface IGenPartyCase {
    seed: number;
    playerLevel: number;
    playerClass: TCharacterClass;
    count: number;
    startSeq: number;
    nowMs: number;
    value: IBot[];
}

const genParty = (
    seed: number,
    playerLevel: number,
    playerClass: TCharacterClass,
    count: number,
): IGenPartyCase => {
    const value = withSeed(seed, () => generateBotParty(playerLevel, playerClass, count));
    const startSeq = value.length > 0 ? botSeqOf(value[0].id) : 0;
    return { seed, playerLevel, playerClass, count, startSeq, nowMs: FAKE_NOW, value };
};

interface IActionCase {
    label: string;
    bot: IBot;
    bossDefense: number;
    canUseSkill: boolean;
    seed: number;
    value: IBotAction;
}

const actionCase = (
    label: string,
    bot: IBot,
    bossDefense: number,
    canUseSkill: boolean,
    seed: number,
): IActionCase => {
    const value = withSeed(seed, () => calculateBotAction(bot, makeBoss(bossDefense), canUseSkill));
    return { label, bot, bossDefense, canUseSkill, seed, value };
};

interface ILegacyAggroCase {
    seed: number;
    arg: string[];
    value: string;
}

const legacyAggro = (seed: number, arg: string[]): ILegacyAggroCase => ({
    seed,
    arg,
    value: withSeed(seed, () => pickAggroTarget(arg)),
});

interface IWeightedAggroCase {
    seed: number;
    arg: IAggroCandidate[];
    value: string;
}

const weightedAggro = (seed: number, arg: IAggroCandidate[]): IWeightedAggroCase => ({
    seed,
    arg,
    value: withSeed(seed, () => pickAggroTarget(arg)),
});

// Bots dla calculateBotAction — jawne, żeby wymusić konkretne gałęzie.
const KNIGHT_SKILL_BOT = makeBot({
    id: 'bot_k',
    name: 'Sir Aldric',
    class: 'Knight',
    attack: 100,
    mp: 100,
    skillId: 'shield_bash',
    skillMpCost: 15,
    skillDamageMultiplier: 5.4,
});
const KNIGHT_LOWMP_BOT = makeBot({ ...KNIGHT_SKILL_BOT, id: 'bot_klow', mp: 10 });
const BARD_BOT = makeBot({
    id: 'bot_bard',
    name: 'Melody Aria',
    class: 'Bard',
    attack: 40,
    mp: 100,
    skillId: 'battle_hymn',
    skillMpCost: 20,
    skillDamageMultiplier: 0,
});
const PLAIN_BOT = makeBot({ id: 'bot_plain', name: 'Sharp Finn', class: 'Archer', attack: 35, skillId: null });
const CLAMP_BOT = makeBot({ id: 'bot_clamp', name: 'Weakling', class: 'Rogue', attack: 5, skillId: null });

const WEIGHTED_TARGETS: IAggroCandidate[] = [
    { id: 'player', class: 'Cleric' },
    { id: 'b1', class: 'Knight' },
    { id: 'b2', class: 'Mage' },
    { id: 'b3', class: 'Rogue' },
];

const buildGolden = (): Record<string, unknown> => ({
    system: 'botSystem',
    note: 'Generowane z src/systems/botSystem.ts. Funkcje RNG: seed + mulberry32; Date.now → FAKE_NOW; botSeq wyciągnięty z id. NIE edytuj ręcznie.',

    // Czyste / deterministyczne
    calculateAoeDamage: [
        [10, 5], [10, 10], [10, 20], [1, 0], [0, 0], [100, 30], [3, 3], [7, 2], [1000, 1], [50, 200],
    ].map(([bossAttack, targetDefense]) => ({ bossAttack, targetDefense, value: calculateAoeDamage(bossAttack, targetDefense) })),

    isBossAoeTurn: [0, 1, 4, 5, 6, 9, 10, 14, 15, 24, 25, 100, -5].map((turnCounter) => ({
        turnCounter,
        value: isBossAoeTurn(turnCounter),
    })),

    // Losujące (RNG w stałej kolejności → seeded)
    getAggroSwitchInterval: SEEDS.map((seed) => ({ seed, value: withSeed(seed, () => getAggroSwitchInterval()) })),

    pickAggroTargetLegacy: [
        ...SEEDS.map((seed) => legacyAggro(seed, ['b1', 'b2', 'b3'])),
        ...SEEDS.map((seed) => legacyAggro(seed, ['b1'])),
        legacyAggro(1, []),
        legacyAggro(42, []),
    ],

    pickAggroTargetWeighted: [
        ...SEEDS.map((seed) => weightedAggro(seed, WEIGHTED_TARGETS)),
        ...SEEDS.map((seed) => weightedAggro(seed, [{ id: 'player', class: 'Bard' }, { id: 'b1', class: 'Knight' }])),
        weightedAggro(7, []),
        weightedAggro(99, []),
    ],

    calculateBotAction: [
        ...SEEDS.map((seed) => actionCase('attack-plain', PLAIN_BOT, 10, false, seed)),
        ...SEEDS.map((seed) => actionCase('attack-clamp', CLAMP_BOT, 20, false, seed)),
        ...SEEDS.map((seed) => actionCase('skill-blocked-lowmp', KNIGHT_LOWMP_BOT, 10, true, seed)),
        actionCase('skill-knight', KNIGHT_SKILL_BOT, 10, true, 1),
        actionCase('skill-knight', KNIGHT_SKILL_BOT, 10, true, 42),
        actionCase('skill-blocked-bard-zero-dmg', BARD_BOT, 10, true, 3),
        actionCase('skill-canuse-false-knight', KNIGHT_SKILL_BOT, 10, false, 13),
    ],

    // Generacja botów (RNG: klasa, offset poziomu, nazwa) + parametryzowane id
    generateBot: [
        ...SEEDS.map((seed) => genBot(seed, 1, 'Knight', [])),
        ...SEEDS.map((seed) => genBot(seed, 100, 'Mage', ['Knight'])),
        ...SEEDS.map((seed) => genBot(seed, 1000, 'Cleric', ['Bard', 'Archer'])),
        ...SEEDS.map((seed) => genBot(seed, 3, 'Necromancer', [])),
        // available puste (wszystkie 7 klas wykluczone) → fallback na ALL_CLASSES
        ...SEEDS.map((seed) => genBot(seed, 50, 'Knight', ['Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'])),
    ],

    // Czysta tabela statów per klasa/poziom (przez generateBotWithClass)
    generateBotWithClass: [1, 50, 100, 1000].flatMap((playerLevel) =>
        ALL_CLASSES.flatMap((botClass) => SEEDS.map((seed) => genWithClass(seed, playerLevel, botClass))),
    ),

    generateBotParty: [0, 1, 3, 4, 7].flatMap((count) =>
        SEEDS.map((seed) => genParty(seed, 20, 'Rogue', count)),
    ),
});

const outPath = resolve(process.cwd(), 'golden/botSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('botSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current botSystem output', () => {
        expect(existsSync(outPath), 'brak golden/botSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        // Normalizacja przez JSON — usuwa -0 (i tak serializuje się jako 0). Parytet nienaruszony.
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
