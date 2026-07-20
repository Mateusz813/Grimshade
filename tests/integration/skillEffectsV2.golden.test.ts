import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Mulberry32 } from '../../src/systems/rng/mulberry32';
import {
    parseEffects,
    hasEffect,
    findEffect,
    newStatusState,
    isStunned,
    tickStatus,
    applyEffects,
    resolveBasicHit,
    applyIncomingDamage,
    applyManaShieldRedirect,
    applyIncomingHeal,
    skillTargetsEnemy,
    consumeTargetMarkAmp,
    consumeCasterBasicHitMods,
    type IStatusState,
} from '../../src/systems/skillEffectsV2';


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

const j = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const st = (partial: Partial<IStatusState>): IStatusState => ({ ...newStatusState(), ...partial });

const SEEDS = [1, 2, 3, 7, 13, 42, 99, 777];


const PARSE_CASES: Array<string | null> = [
    null,
    '',
    'aoe',
    'aoe;dot:5000:5',
    ' aoe ; dot:5000:5 ; stun:1000 ',
    'summon:skeleton:3',
    'summon:skeleton',
    'dodge_next:2:non_magic',
    'dodge_next:1',
    'dmg_amp_next:3:1',
    'foo:1:2:3',
    ';aoe;;dot:1000:5',
    'def_pen:-5',
    'crit_next:2.5:3',
    'mark_amp:2:1:5000',
    'death_apocalypse',
    'party_lifesteal_next:100:5',
    'dark_ritual:10000:12',
    'instant_kill_chance:15',
    'execute_below:20',
    'party_as_up:1.5:5000',
];


const HAS_CASES: Array<{ effect: string; key: string }> = [
    { effect: 'aoe;dot:1000:5', key: 'aoe' },
    { effect: 'aoe;dot:1000:5', key: 'stun' },
    { effect: 'stun:3000', key: 'stun' },
];

const FIND_CASES: Array<{ effect: string; key: string }> = [
    { effect: 'aoe;dot:1000:5', key: 'dot' },
    { effect: 'aoe;dot:1000:5', key: 'stun' },
    { effect: 'summon:skeleton:3', key: 'summon' },
];


const IS_STUNNED_CASES = [0, 1, 100, -50];


const TARGETS_ENEMY_CASES: Array<string | null> = [
    null,
    '',
    'stun:1000',
    'crit_buff:50:5000',
    'aoe;dot:1000:5',
    'summon:skeleton:1',
    'mark_amp:2:1000',
    'def_pen:50:5000',
    'paralyze:3000',
    'execute_below:25',
    'multistrike:3',
    'attack_up:20:5000',
    'death_apocalypse',
    'dark_ritual:5000:12',
    'party_immortal:4000',
];


const INCOMING_DMG_CASES: Array<{ immortalMs: number; cannotDieMs: number; targetCurrentHp: number; rawDamage: number }> = [
    { immortalMs: 2000, cannotDieMs: 0, targetCurrentHp: 100, rawDamage: 500 },
    { immortalMs: 0, cannotDieMs: 0, targetCurrentHp: 500, rawDamage: 100 },
    { immortalMs: 0, cannotDieMs: 2000, targetCurrentHp: 30, rawDamage: 100 },
    { immortalMs: 0, cannotDieMs: 2000, targetCurrentHp: 100, rawDamage: 30 },
    { immortalMs: 0, cannotDieMs: 2000, targetCurrentHp: 1, rawDamage: 100 },
    { immortalMs: 0, cannotDieMs: 0, targetCurrentHp: 0, rawDamage: 0 },
];


const MANA_SHIELD_CASES: Array<{ manaShieldMs: number | null; currentMp: number; rawDmg: number }> = [
    { manaShieldMs: null, currentMp: 100, rawDmg: 50 },
    { manaShieldMs: 0, currentMp: 100, rawDmg: 50 },
    { manaShieldMs: 5000, currentMp: 100, rawDmg: 50 },
    { manaShieldMs: 5000, currentMp: 10, rawDmg: 50 },
    { manaShieldMs: 5000, currentMp: 0, rawDmg: 100 },
    { manaShieldMs: 5000, currentMp: 100, rawDmg: 0 },
    { manaShieldMs: 5000, currentMp: -20, rawDmg: 50 },
];


const INCOMING_HEAL_CASES: Array<{ enemyNoHealMs: number; markNoHealMs: number; rawHeal: number }> = [
    { enemyNoHealMs: 5000, markNoHealMs: 0, rawHeal: 100 },
    { enemyNoHealMs: 0, markNoHealMs: 6000, rawHeal: 500 },
    { enemyNoHealMs: 0, markNoHealMs: 6000, rawHeal: 0 },
    { enemyNoHealMs: 0, markNoHealMs: 0, rawHeal: 250 },
    { enemyNoHealMs: 5000, markNoHealMs: 6000, rawHeal: 300 },
];


const tickCase = (state: Partial<IStatusState>, deltaMs: number, targetMaxHp: number) => {
    const s = st(state);
    const before = j(s);
    const result = tickStatus(s, deltaMs, targetMaxHp);
    return { deltaMs, targetMaxHp, before, result, after: j(s) };
};


const consumeTargetCase = (state: Partial<IStatusState> | null) => {
    const s = state === null ? undefined : st(state);
    const before = s === undefined ? null : j(s);
    const result = consumeTargetMarkAmp(s);
    return { before, result, after: s === undefined ? null : j(s) };
};


const consumeCasterCase = (state: Partial<IStatusState> | null, seed: number) => {
    const s = state === null ? undefined : st(state);
    const before = s === undefined ? null : j(s);
    const result = withSeed(seed, () => consumeCasterBasicHitMods(s));
    return { seed, before, result, after: s === undefined ? null : j(s) };
};


const resolveCase = (opts: {
    attacker?: Partial<IStatusState>;
    attackerClass?: string | null;
    baseDmg: number;
    target?: Partial<IStatusState>;
    seed?: number;
}) => {
    const seed = opts.seed ?? 1;
    const attacker = st(opts.attacker ?? {});
    const target = st(opts.target ?? {});
    const attackerBefore = j(attacker);
    const targetBefore = j(target);
    const result = withSeed(seed, () => resolveBasicHit(attacker, opts.attackerClass ?? undefined, opts.baseDmg, target));
    return {
        attackerClass: opts.attackerClass ?? null,
        attackerBaseDmg: opts.baseDmg,
        seed,
        attacker: attackerBefore,
        target: targetBefore,
        result,
        attackerAfter: j(attacker),
        targetAfter: j(target),
    };
};


const applyCase = (opts: {
    effect: string;
    caster?: Partial<IStatusState>;
    target?: Partial<IStatusState> | null;
    targetHpPct?: number;
    party?: Array<Partial<IStatusState>>;
    enemy?: Array<Partial<IStatusState>>;
    seed?: number;
}) => {
    const seed = opts.seed ?? 1;
    const caster = st(opts.caster ?? {});
    const target = opts.target === null ? null : st(opts.target ?? {});
    const party = (opts.party ?? []).map((p) => st(p));
    const enemy = (opts.enemy ?? []).map((e) => st(e));
    const targetHpPct = opts.targetHpPct ?? 100;
    const casterBefore = j(caster);
    const targetBefore = target === null ? null : j(target);
    const partyBefore = j(party);
    const enemyBefore = j(enemy);
    const result = withSeed(seed, () =>
        applyEffects(parseEffects(opts.effect), caster, target, targetHpPct, party, enemy),
    );
    return {
        effect: opts.effect,
        seed,
        targetHpPct,
        caster: casterBefore,
        target: targetBefore,
        party: partyBefore,
        enemy: enemyBefore,
        result,
        casterAfter: j(caster),
        targetAfter: target === null ? null : j(target),
        partyAfter: j(party),
        enemyAfter: j(enemy),
    };
};

const threeEnemies = (): Array<Partial<IStatusState>> => [{}, {}, {}];
const twoAllies = (): Array<Partial<IStatusState>> => [{}, {}];

const buildGolden = (): Record<string, unknown> => ({
    system: 'skillEffectsV2',
    note: 'Generowane z src/systems/skillEffectsV2.ts. Funkcje RNG: seed + mulberry32. NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1.',

    newStatusState: j(newStatusState()),
    parseEffects: PARSE_CASES.map((effect) => ({ effect, result: parseEffects(effect) })),
    hasEffect: HAS_CASES.map(({ effect, key }) => ({
        effect, key, result: hasEffect(parseEffects(effect), key as never),
    })),
    findEffect: FIND_CASES.map(({ effect, key }) => ({
        effect, key, result: findEffect(parseEffects(effect), key as never),
    })),
    isStunned: IS_STUNNED_CASES.map((stunMs) => ({ stunMs, result: isStunned(st({ stunMs })) })),
    skillTargetsEnemy: TARGETS_ENEMY_CASES.map((effect) => ({ effect, result: skillTargetsEnemy(effect) })),
    applyIncomingDamage: INCOMING_DMG_CASES.map((c) => ({
        ...c,
        result: applyIncomingDamage(st({ immortalMs: c.immortalMs, cannotDieMs: c.cannotDieMs }), c.targetCurrentHp, c.rawDamage),
    })),
    applyManaShieldRedirect: MANA_SHIELD_CASES.map((c) => ({
        ...c,
        result: applyManaShieldRedirect(
            c.manaShieldMs === null ? undefined : st({ manaShieldMs: c.manaShieldMs }),
            c.currentMp,
            c.rawDmg,
        ),
    })),
    applyIncomingHeal: INCOMING_HEAL_CASES.map((c) => ({
        ...c,
        result: applyIncomingHeal(st({ enemyNoHealMs: c.enemyNoHealMs, markNoHealMs: c.markNoHealMs }), c.rawHeal),
    })),

    tickStatus: [
        tickCase({ dots: [{ remainingMs: 1000, pctPerSec: 10 }] }, 1000, 100),
        tickCase({ dots: [{ remainingMs: 3000, pctPerSec: 5 }] }, 500, 200),
        tickCase({ dots: [{ remainingMs: 2000, pctPerSec: 8 }, { remainingMs: 500, pctPerSec: 20 }] }, 500, 1000),
        tickCase({ stunMs: 1500, immortalMs: 500, atkBuffPct: 50, atkBuffMs: 600 }, 1000, 100),
        tickCase({ markAmp: [{ mult: 2, count: 1, remainingMs: 500 }, { mult: 3, count: 0, remainingMs: 10000 }] }, 600, 100),
        tickCase({ markAmpAll: { mult: 2, remainingMs: 1000 } }, 1500, 100),
        tickCase({ markAmpAll: { mult: 2, remainingMs: 3000 } }, 1000, 100),
        tickCase({ darkRitualPending: [{ triggerInMs: 1000, pctOfMaxHp: 10 }, { triggerInMs: 5000, pctOfMaxHp: 20 }] }, 1000, 500),
        tickCase({ darkRitualPending: [{ triggerInMs: 500, pctOfMaxHp: 0.01 }] }, 500, 100),
        tickCase({
            critBuffMs: 1000, critBuffPct: 20, dodgeBuffMs: 500, dodgeBuffPct: 30, asMult: 1.5, asMultMs: 800,
            partyCritPct: 10, partyCritMs: 1000, defPenPct: 50, defPenMs: 2000, markNoHealMs: 3000,
            enemyAtkDownPct: 20, enemyAtkDownMs: 1500, enemyNoHealMs: 2000, manaShieldMs: 5000, cannotDieMs: 3000,
        }, 1000, 100),
        tickCase({
            critBuffMs: 1000, critBuffPct: 20, dodgeBuffMs: 500, dodgeBuffPct: 30, asMult: 1.5, asMultMs: 800,
            partyCritPct: 10, partyCritMs: 1000, defPenPct: 50, defPenMs: 2000, enemyAtkDownPct: 20, enemyAtkDownMs: 1500,
        }, 5000, 100),
        tickCase({}, 500, 1000),
    ],

    consumeTargetMarkAmp: [
        consumeTargetCase(null),
        consumeTargetCase({}),
        consumeTargetCase({ markAmp: [{ mult: 5, count: 1, remainingMs: 1000 }] }),
        consumeTargetCase({ markAmp: [{ mult: 5, count: 3, remainingMs: 1000 }] }),
        consumeTargetCase({ markAmpAll: { mult: 2, remainingMs: 5000 } }),
        consumeTargetCase({ markAmp: [{ mult: 3, count: 1, remainingMs: 1000 }], markAmpAll: { mult: 2, remainingMs: 1000 } }),
        consumeTargetCase({ markAmp: [{ mult: 9, count: 0, remainingMs: 1000 }, { mult: 4, count: 2, remainingMs: 2000 }] }),
        consumeTargetCase({ markAmp: [{ mult: 9, count: 2, remainingMs: 0 }] }),
    ],

    consumeCasterBasicHitMods: [
        consumeCasterCase(null, 1),
        consumeCasterCase({ critNext: [{ count: 1, mult: 1 }] }, 1),
        consumeCasterCase({ critNext: [{ count: 2, mult: 2.5 }] }, 1),
        ...SEEDS.map((seed) => consumeCasterCase({ critNext: [{ count: 1, mult: 0.5 }] }, seed)),
        consumeCasterCase({ critBuffNext: 30 }, 1),
        consumeCasterCase({ critBuffMs: 5000, critBuffPct: 20 }, 1),
        consumeCasterCase({ dmgAmpNext: [{ mult: 3, count: 1 }] }, 1),
        consumeCasterCase({ atkBuffMs: 1000, atkBuffPct: 50 }, 1),
        consumeCasterCase({ lifestealNext: [{ pct: 40, count: 2 }] }, 1),
        consumeCasterCase({ nextAllyHeal: [{ pct: 25, count: 1 }] }, 1),
        consumeCasterCase({
            critNext: [{ count: 1, mult: 1 }], dmgAmpNext: [{ mult: 2, count: 1 }], atkBuffMs: 1000, atkBuffPct: 50,
            lifestealNext: [{ pct: 10, count: 1 }], nextAllyHeal: [{ pct: 5, count: 1 }], critBuffNext: 20,
        }, 1),
    ],

    resolveBasicHit: [
        resolveCase({ attackerClass: 'Knight', baseDmg: 100 }),
        resolveCase({ attackerClass: null, baseDmg: 100 }),
        resolveCase({ attackerClass: 'Knight', baseDmg: 100, target: { dodgeNext: [{ count: 1, scope: 'non_magic' }] } }),
        resolveCase({ attackerClass: 'Mage', baseDmg: 100, target: { dodgeNext: [{ count: 1, scope: 'non_magic' }] } }),
        resolveCase({ attackerClass: 'Mage', baseDmg: 100, target: { dodgeNext: [{ count: 1, scope: 'all' }] } }),
        resolveCase({ attackerClass: 'Knight', baseDmg: 100, target: { dodgeNext: [{ count: 2, scope: 'all' }] } }),
        ...SEEDS.map((seed) => resolveCase({ attackerClass: 'Knight', baseDmg: 100, target: { dodgeBuffMs: 5000, dodgeBuffPct: 50 }, seed })),
        resolveCase({ attackerClass: 'Knight', baseDmg: 100, target: { dodgeBuffMs: 5000, dodgeBuffPct: 100 } }),
        resolveCase({ attackerClass: 'Knight', baseDmg: 100, attacker: { critNext: [{ count: 2, mult: 2.5 }] } }),
        ...SEEDS.map((seed) => resolveCase({ attackerClass: 'Knight', baseDmg: 100, attacker: { critBuffNext: 50 }, seed })),
        resolveCase({ attackerClass: 'Knight', baseDmg: 100, attacker: { critBuffNext: 100 } }),
        resolveCase({ attackerClass: 'Knight', baseDmg: 100, attacker: { atkBuffMs: 1000, atkBuffPct: 50 } }),
        resolveCase({ attackerClass: 'Knight', baseDmg: 100, target: { markAmp: [{ mult: 3, count: 1, remainingMs: 5000 }] } }),
        resolveCase({ attackerClass: 'Knight', baseDmg: 100, target: { markAmpAll: { mult: 2, remainingMs: 5000 } } }),
        resolveCase({ attackerClass: 'Knight', baseDmg: 100, attacker: { lifestealNext: [{ pct: 25, count: 1 }] } }),
        resolveCase({ attackerClass: 'Cleric', baseDmg: 100, attacker: { nextAllyHeal: [{ pct: 50, count: 1 }] } }),
        resolveCase({ attackerClass: 'Knight', baseDmg: -50 }),
        resolveCase({ attackerClass: 'Knight', baseDmg: 100, attacker: { dmgAmpNext: [{ mult: 4, count: 1 }] } }),
        resolveCase({
            attackerClass: 'Knight', baseDmg: 100,
            attacker: {
                critNext: [{ count: 1, mult: 2 }], dmgAmpNext: [{ mult: 2, count: 1 }], atkBuffMs: 1000, atkBuffPct: 50,
                lifestealNext: [{ pct: 10, count: 1 }], nextAllyHeal: [{ pct: 5, count: 1 }],
            },
            target: { markAmp: [{ mult: 2, count: 1, remainingMs: 5000 }], markAmpAll: { mult: 2, remainingMs: 5000 } },
        }),
    ],

    applyEffects: [
        applyCase({ effect: 'aoe' }),
        applyCase({ effect: 'def_pen:50' }),
        applyCase({ effect: 'def_pen:-5' }),
        applyCase({ effect: 'dmg_amp_next:3:1' }),
        applyCase({ effect: 'dmg_amp_next:2:8' }),
        applyCase({ effect: 'dmg_amp_next:3:1', caster: { dmgAmpNext: [{ mult: 3, count: 1 }] } }),
        applyCase({ effect: 'crit_buff_next:30' }),
        applyCase({ effect: 'crit_buff:50:5000' }),
        applyCase({ effect: 'crit_next:2:1' }),
        applyCase({ effect: 'crit_next:2:3', caster: { critNext: [{ mult: 2, count: 1 }] } }),
        applyCase({ effect: 'multistrike:3' }),
        applyCase({ effect: 'stun:3000', target: {} }),
        applyCase({ effect: 'stun:3000', target: null }),
        applyCase({ effect: 'aoe;stun:3000', enemy: threeEnemies() }),
        ...SEEDS.map((seed) => applyCase({ effect: 'stun_chance:100:2000', target: {}, seed })),
        ...SEEDS.map((seed) => applyCase({ effect: 'stun_chance:50:2000', target: {}, seed })),
        ...SEEDS.map((seed) => applyCase({ effect: 'aoe;stun_chance:50:2000', enemy: threeEnemies(), seed })),
        applyCase({ effect: 'paralyze:3000', target: {} }),
        applyCase({ effect: 'aoe;paralyze:3000', enemy: threeEnemies() }),
        applyCase({ effect: 'dot:5000:5', target: {} }),
        applyCase({ effect: 'aoe;dot:5000:5', enemy: threeEnemies() }),
        ...SEEDS.map((seed) => applyCase({ effect: 'instant_kill_chance:100', seed })),
        ...SEEDS.map((seed) => applyCase({ effect: 'instant_kill_chance:15', seed })),
        applyCase({ effect: 'instant_kill_chance:0', seed: 1 }),
        ...SEEDS.map((seed) => applyCase({ effect: 'aoe;instant_kill_chance:15', enemy: threeEnemies(), seed })),
        applyCase({ effect: 'execute_below:20', target: {}, targetHpPct: 15 }),
        applyCase({ effect: 'execute_below:20', target: {}, targetHpPct: 50 }),
        applyCase({ effect: 'mark_amp:2:1:5000', target: {} }),
        applyCase({ effect: 'aoe;mark_amp_all:2:5000', enemy: threeEnemies() }),
        applyCase({ effect: 'mark_amp_all:2:5000', target: {} }),
        applyCase({ effect: 'mark_no_heal:6000', target: {} }),
        applyCase({ effect: 'mark_heal_to_dmg:6000', target: {} }),
        applyCase({ effect: 'heal_self_pct_dmg:50' }),
        applyCase({ effect: 'heal_self_max_pct:30' }),
        applyCase({ effect: 'immortal:2000' }),
        applyCase({ effect: 'mana_shield:5000' }),
        applyCase({ effect: 'dodge_next:2:non_magic' }),
        applyCase({ effect: 'dodge_next:1' }),
        applyCase({ effect: 'dodge_buff:30:5000' }),
        applyCase({ effect: 'attack_up:20:5000' }),
        applyCase({ effect: 'defense_up:20:5000' }),
        applyCase({ effect: 'party_attack_up:20:5000', party: twoAllies() }),
        applyCase({ effect: 'party_defense_up:20:5000', party: twoAllies() }),
        applyCase({ effect: 'party_as_up:1.5:5000', party: twoAllies() }),
        applyCase({ effect: 'party_crit_up:10:5000', party: twoAllies() }),
        applyCase({ effect: 'party_def_pen:30:5000', party: twoAllies() }),
        applyCase({ effect: 'party_immortal:4000', party: twoAllies() }),
        applyCase({ effect: 'heal_lowest_ally_pct:20' }),
        applyCase({ effect: 'heal_party_dot:5000:5' }),
        applyCase({ effect: 'heal_party_pct:25' }),
        applyCase({ effect: 'block_next_party:3' }),
        applyCase({ effect: 'revive_party:5000:2000', party: twoAllies() }),
        applyCase({ effect: 'next_ally_heal:7.5:3' }),
        applyCase({ effect: 'next_ally_heal:7.5:3', caster: { nextAllyHeal: [{ pct: 7.5, count: 2 }] } }),
        applyCase({ effect: 'party_lifesteal_next:100:5', party: twoAllies() }),
        applyCase({ effect: 'aggro_steal' }),
        applyCase({ effect: 'enemy_atk_down:20:5000', enemy: threeEnemies() }),
        applyCase({ effect: 'enemy_no_heal:5000', enemy: threeEnemies() }),
        applyCase({ effect: 'summon:skeleton:1' }),
        applyCase({ effect: 'summon:ghost:2' }),
        applyCase({ effect: 'summon:dragon:1' }),
        applyCase({ effect: 'summon:lich' }),
        applyCase({ effect: 'dark_ritual:10000:12', target: {} }),
        applyCase({ effect: 'dark_ritual:0:12', target: {} }),
        applyCase({ effect: 'death_apocalypse' }),
        applyCase({ effect: 'death_apocalypse;summon:skeleton:1' }),
        applyCase({ effect: 'aoe;dot:5000:5;stun:3000', enemy: threeEnemies() }),
        applyCase({ effect: 'immortal:2000;crit_buff:50:5000', target: null }),
        applyCase({ effect: 'aoe;dot:5000:5;stun_chance:50:2000;mark_amp_all:2:5000', enemy: threeEnemies(), seed: 42 }),
    ],
});

const outPath = resolve(process.cwd(), 'golden/skillEffectsV2.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('skillEffectsV2 golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current skillEffectsV2 output', () => {
        expect(existsSync(outPath), 'brak golden/skillEffectsV2.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
