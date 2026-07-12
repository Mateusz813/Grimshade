import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { TCharacterClass } from '../../src/api/v1/characterApi';
import { Mulberry32 } from '../../src/systems/rng/mulberry32';
import {
    MAX_PARTY_SIZE,
    calculateDropMultiplier,
    calculateXpMultiplier,
    calculateDifficultyMultiplier,
    canJoinParty,
    isFull,
    getHumanCount,
    getBotCount,
    shouldSuggestBot,
    createBotHelper,
    getXpShare,
    getGoldShare,
    getPartySummary,
    calculateHelpDamage,
    getPartyBuffs,
    applyPartyBuffs,
    hasOptimalComposition,
    getCompositionBonus,
    getPartyGateLevel,
    getPartyMaxUnlockedMonsterLevel,
    getAggroWeight,
    pickWeightedAggroTarget,
    type IPartyMember,
    type IPartyInfo,
} from '../../src/systems/partySystem';


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

const UNKNOWN_CLASS = 'Paladin' as unknown as TCharacterClass;

const mkMember = (
    id: string,
    cls: TCharacterClass,
    level: number,
    isBot = false,
): IPartyMember => ({ id, name: id, class: cls, level, hp: 100, maxHp: 100, isBot, isOnline: true });

const mkParty = (members: IPartyMember[]): IPartyInfo => ({
    id: 'party',
    leaderId: members[0]?.id ?? 'none',
    members,
    createdAt: '2026-01-01',
});


const MEMBER_SETS: Array<{ label: string; members: IPartyMember[] }> = [
    { label: 'empty', members: [] },
    { label: 'solo-knight', members: [mkMember('p1', 'Knight', 10)] },
    { label: 'duo', members: [mkMember('p1', 'Knight', 10), mkMember('p2', 'Mage', 20)] },
    {
        label: 'full-4-diff',
        members: [
            mkMember('p1', 'Knight', 10),
            mkMember('p2', 'Mage', 20),
            mkMember('p3', 'Cleric', 30),
            mkMember('p4', 'Archer', 40),
        ],
    },
    { label: 'human-plus-bot', members: [mkMember('p1', 'Knight', 10), mkMember('b1', 'Cleric', 10, true)] },
    { label: 'all-bots', members: [mkMember('b1', 'Knight', 10, true), mkMember('b2', 'Mage', 12, true)] },
    {
        label: 'human-plus-3-bots',
        members: [
            mkMember('p1', 'Rogue', 50),
            mkMember('b1', 'Cleric', 50, true),
            mkMember('b2', 'Knight', 50, true),
            mkMember('b3', 'Mage', 50, true),
        ],
    },
    {
        label: 'levels-avg-floor',
        members: [mkMember('p1', 'Knight', 5), mkMember('p2', 'Mage', 10), mkMember('p3', 'Cleric', 12)],
    },
    { label: 'low-level', members: [mkMember('p1', 'Rogue', 1)] },
    { label: 'high-level', members: [mkMember('p1', 'Bard', 1000)] },
    {
        label: 'cleric-knight-mage',
        members: [mkMember('p1', 'Cleric', 8), mkMember('p2', 'Knight', 8), mkMember('p3', 'Mage', 8)],
    },
];


const SIZES = [-5, 0, 1, 2, 3, 4, 5, 10];
const JOIN_SIZES = [-1, 0, 1, 2, 3, 4, 5];
const FULL_SIZES = [0, 1, 3, 4, 5];


const SHARE_CASES: Array<[number, number]> = [
    [1000, 4], [1000, 3], [1000, 1], [1000, 0], [1000, -2],
    [0, 4], [7, 4], [-100, 3], [999, 4], [2000000000, 4],
];


const CLASS_SETS: Array<{ label: string; classes: string[] }> = [
    { label: 'empty', classes: [] },
    { label: 'single', classes: ['Knight'] },
    { label: 'two-diff', classes: ['Knight', 'Mage'] },
    { label: 'two-same', classes: ['Bard', 'Bard'] },
    { label: 'three-diff', classes: ['Knight', 'Mage', 'Cleric'] },
    { label: 'three-unique-with-dupe', classes: ['Knight', 'Knight', 'Mage', 'Cleric'] },
    { label: 'four-diff', classes: ['Knight', 'Mage', 'Cleric', 'Archer'] },
    { label: 'buff-classes', classes: ['Cleric', 'Bard', 'Knight'] },
    { label: 'all-seven', classes: ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'] },
    { label: 'no-buffs', classes: ['Rogue', 'Mage', 'Archer'] },
];


const APPLY_CASES: Array<{ label: string; baseAttack: number; baseDefense: number; maxHp: number; classes: string[] }> = [
    { label: 'none', baseAttack: 100, baseDefense: 50, maxHp: 1000, classes: ['Rogue'] },
    { label: 'atk-only', baseAttack: 100, baseDefense: 50, maxHp: 1000, classes: ['Bard'] },
    { label: 'def-only', baseAttack: 100, baseDefense: 50, maxHp: 1000, classes: ['Knight'] },
    { label: 'heal-only', baseAttack: 100, baseDefense: 50, maxHp: 1000, classes: ['Cleric'] },
    { label: 'all-three', baseAttack: 100, baseDefense: 50, maxHp: 1000, classes: ['Bard', 'Knight', 'Cleric'] },
    { label: 'double-atk', baseAttack: 100, baseDefense: 50, maxHp: 1000, classes: ['Bard', 'Bard'] },
    { label: 'zero-stats', baseAttack: 0, baseDefense: 0, maxHp: 0, classes: ['Bard', 'Knight', 'Cleric'] },
];


const HELP_CASES: Array<[number, number]> = [
    [100, 500], [0, 100], [1, 1], [999, 0], [7, 3], [-50, 100],
];


const GATE_MEMBERS_FULL = [
    mkMember('p1', 'Knight', 10),
    mkMember('p2', 'Mage', 20),
    mkMember('p3', 'Cleric', 30),
    mkMember('p4', 'Archer', 40),
];
const GATE_CASES: Array<{ label: string; myLevel: number; members: IPartyMember[] | null }> = [
    { label: 'null-members', myLevel: 50, members: null },
    { label: 'empty', myLevel: 50, members: [] },
    { label: 'all-bots', myLevel: 50, members: [mkMember('b1', 'Knight', 10, true)] },
    { label: 'lowest-human-blocks', myLevel: 50, members: GATE_MEMBERS_FULL },
    { label: 'my-level-lower', myLevel: 5, members: GATE_MEMBERS_FULL },
    { label: 'bot-ignored', myLevel: 50, members: [mkMember('p1', 'Knight', 10), mkMember('b1', 'Rogue', 1, true)] },
];


const UNLOCK_MEMBERS = [
    mkMember('p1', 'Knight', 10),
    mkMember('p2', 'Mage', 20),
    mkMember('p3', 'Cleric', 30),
    mkMember('p4', 'Archer', 40),
];
const UNLOCK_CASES: Array<{
    label: string;
    myMax: number;
    members: IPartyMember[] | null;
    presence: Record<string, { maxUnlockedMonsterLevel?: number }>;
    myId: string;
}> = [
    { label: 'null-members', myMax: 100, members: null, presence: {}, myId: 'p1' },
    { label: 'no-snapshots', myMax: 100, members: UNLOCK_MEMBERS, presence: {}, myId: 'p1' },
    {
        label: 'min-of-presence',
        myMax: 100,
        members: UNLOCK_MEMBERS,
        presence: { p2: { maxUnlockedMonsterLevel: 80 }, p3: { maxUnlockedMonsterLevel: 60 }, p4: { maxUnlockedMonsterLevel: 200 } },
        myId: 'p1',
    },
    { label: 'self-skipped', myMax: 100, members: UNLOCK_MEMBERS, presence: { p1: { maxUnlockedMonsterLevel: 5 } }, myId: 'p1' },
    {
        label: 'bot-skipped',
        myMax: 100,
        members: [mkMember('p1', 'Knight', 10), mkMember('b1', 'Cleric', 10, true)],
        presence: { b1: { maxUnlockedMonsterLevel: 5 } },
        myId: 'p1',
    },
    { label: 'snapshot-without-field', myMax: 100, members: UNLOCK_MEMBERS, presence: { p2: {} }, myId: 'p1' },
];


const AGGRO_CLASSES: TCharacterClass[] = ['Knight', 'Rogue', 'Archer', 'Necromancer', 'Mage', 'Cleric', 'Bard'];


const AGGRO_SEEDS = [1, 2, 3, 7, 13, 42, 99, 777];
const TARGET_SETS: Array<{ label: string; targets: Array<{ id: string; class: TCharacterClass }> }> = [
    { label: 'empty', targets: [] },
    { label: 'single', targets: [{ id: 'p1', class: 'Knight' }] },
    { label: 'duo', targets: [{ id: 'p1', class: 'Knight' }, { id: 'p2', class: 'Cleric' }] },
    {
        label: 'full',
        targets: [
            { id: 'p1', class: 'Knight' },
            { id: 'p2', class: 'Mage' },
            { id: 'p3', class: 'Cleric' },
            { id: 'p4', class: 'Archer' },
        ],
    },
    { label: 'with-unknown', targets: [{ id: 'p1', class: UNKNOWN_CLASS }, { id: 'p2', class: 'Knight' }] },
];

const buildGolden = (): Record<string, unknown> => ({
    system: 'partySystem',
    note: 'Generowane z src/systems/partySystem.ts. NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1.',

    maxPartySize: MAX_PARTY_SIZE,

    calculateDropMultiplier: SIZES.map((size) => ({ size, value: calculateDropMultiplier(size) })),
    calculateXpMultiplier: SIZES.map((size) => ({ size, value: calculateXpMultiplier(size) })),
    calculateDifficultyMultiplier: SIZES.map((size) => ({ size, value: calculateDifficultyMultiplier(size) })),
    canJoinParty: JOIN_SIZES.map((size) => ({ size, value: canJoinParty(size) })),
    isFull: FULL_SIZES.map((size) => {
        const members = Array.from({ length: size }, (_v, i) => mkMember(`p${i}`, 'Knight', 1));
        return { size, members, value: isFull(mkParty(members)) };
    }),

    getHumanCount: MEMBER_SETS.map((s) => ({ label: s.label, members: s.members, value: getHumanCount(s.members) })),
    getBotCount: MEMBER_SETS.map((s) => ({ label: s.label, members: s.members, value: getBotCount(s.members) })),
    shouldSuggestBot: MEMBER_SETS.map((s) => ({ label: s.label, members: s.members, value: shouldSuggestBot(s.members) })),

    createBotHelper: MEMBER_SETS.map((s) => {
        const bot = createBotHelper(s.members);
        return {
            label: s.label,
            members: s.members,
            value: {
                name: bot.name,
                class: bot.class,
                level: bot.level,
                hp: bot.hp,
                maxHp: bot.maxHp,
                isBot: bot.isBot,
                isOnline: bot.isOnline,
            },
        };
    }),

    getXpShare: SHARE_CASES.map(([total, size]) => ({ total, size, value: getXpShare(total, size) })),
    getGoldShare: SHARE_CASES.map(([total, size]) => ({ total, size, value: getGoldShare(total, size) })),

    getPartySummary: MEMBER_SETS.map((s) => ({ label: s.label, members: s.members, value: getPartySummary(s.members) })),

    calculateHelpDamage: HELP_CASES.map(([attack, remainingHp]) => ({
        attack,
        remainingHp,
        value: calculateHelpDamage(attack, remainingHp),
    })),

    getPartyBuffs: CLASS_SETS.map((s) => ({ label: s.label, classes: s.classes, value: getPartyBuffs(s.classes) })),
    hasOptimalComposition: CLASS_SETS.map((s) => ({ label: s.label, classes: s.classes, value: hasOptimalComposition(s.classes) })),
    getCompositionBonus: CLASS_SETS.map((s) => ({ label: s.label, classes: s.classes, value: getCompositionBonus(s.classes) })),

    applyPartyBuffs: APPLY_CASES.map((c) => {
        const buffs = getPartyBuffs(c.classes);
        return {
            label: c.label,
            baseAttack: c.baseAttack,
            baseDefense: c.baseDefense,
            maxHp: c.maxHp,
            classes: c.classes,
            buffs,
            value: applyPartyBuffs(c.baseAttack, c.baseDefense, c.maxHp, buffs),
        };
    }),

    getPartyGateLevel: GATE_CASES.map((c) => ({
        label: c.label,
        myLevel: c.myLevel,
        members: c.members,
        value: getPartyGateLevel(c.myLevel, c.members),
    })),

    getPartyMaxUnlockedMonsterLevel: UNLOCK_CASES.map((c) => ({
        label: c.label,
        myMax: c.myMax,
        members: c.members,
        presence: c.presence,
        myId: c.myId,
        value: getPartyMaxUnlockedMonsterLevel(c.myMax, c.members, c.presence, c.myId),
    })),

    getAggroWeight: AGGRO_CLASSES.map((cls) => ({ class: cls, value: getAggroWeight(cls) }))
        .concat([{ class: UNKNOWN_CLASS, value: getAggroWeight(UNKNOWN_CLASS) }]),

    pickWeightedAggroTarget: AGGRO_SEEDS.flatMap((seed) =>
        TARGET_SETS.map((ts) => ({
            seed,
            label: ts.label,
            targets: ts.targets,
            value: withSeed(seed, () => pickWeightedAggroTarget(ts.targets)),
        })),
    ),
});

const outPath = resolve(process.cwd(), 'golden/partySystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('partySystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current partySystem output', () => {
        expect(existsSync(outPath), 'brak golden/partySystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
