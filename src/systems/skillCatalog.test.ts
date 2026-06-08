/**
 * Per-skill effect verification — covers EVERY active skill across all 7
 * classes plus the 5 weapon skills declared in `src/data/skills.json`.
 *
 * The goal (user requirement 2026-05-25): prove that each skill behaves
 * EXACTLY as its declaration in `skills.json` says. The skill engine
 * (`skillEffectsV2.ts`) is the source of truth — these tests treat the
 * skill catalog as data and assert that running each entry's effect
 * string through `parseEffects` + `applyEffects` produces the side
 * effects the description promises.
 *
 * Why one consolidated file instead of `src/systems/skills/<class>/<skill>.test.ts`:
 *   • Every active skill is a JSON row that boils down to (mpCost,
 *     cooldown, damage, effect, unlockLevel, goldCost). They share the
 *     SAME runtime path — there's no per-skill `.ts` to test in isolation.
 *   • Maintaining 105 files of "this skill's effect parses to X" would be
 *     pure boilerplate that obscures the actual verification. A
 *     data-driven loop in ONE file produces 1 test per skill + targeted
 *     atom-level assertions, totaling ~150 tests with full coverage.
 *   • BACKLOG.md item 12.1 ("U×~70") originally proposed per-skill files
 *     to ensure complete coverage; the consolidated approach delivers
 *     equivalent (in fact denser) coverage without N filesystem entries.
 *
 * What we DO verify per skill:
 *   1. The `effect` string parses into at least one atom (or is null
 *      for pure-damage skills with no rider).
 *   2. Applying the effect to a clean status pair produces the EXACT
 *      mutation the atom names (stun timer set, DOT queue grown,
 *      summon spec emitted, buff timer registered, etc.).
 *   3. Numeric values (damage multiplier, durations, percents, charge
 *      counts) match what the JSON declares — no silent fallbacks.
 *   4. MP cost, cooldown, unlockLevel and goldCost are present and
 *      well-typed (catches typos in skills.json on import).
 *
 * What we DON'T verify here (covered elsewhere):
 *   • Combat-store wiring (cooldown enforcement, MP deduction, view
 *     routing) — that's `combatEngine.test.ts` + `combatEffectsHelpers`
 *     integration via `castSkill`.
 *   • BuffBar registration — covered by `skillBuffs.test.ts`.
 *   • Per-class weapon damage formulas — covered by per-system tests
 *     (Boss / Dungeon / Hunt engines).
 */

import { describe, it, expect } from 'vitest';
import skillsData from '../data/skills.json';
import {
    parseEffects,
    applyEffects,
    newStatusState,
    tickStatus,
    type IStatusState,
} from './skillEffectsV2';
import {
    castSkill as effectsCastSkill,
    newCombatEffectsSession,
} from './combatEffectsHelpers';
import { getSkillMpCost } from './combatEngine';
import { getSkillDamageBonus } from './skillSystem';

// ── Type helpers ────────────────────────────────────────────────────────────

interface IActiveSkillRow {
    id: string;
    name_pl: string;
    name_en: string;
    mpCost: number;
    cooldown: number;
    damage: number;
    effect: string | null;
    unlockLevel: number;
    goldCost: number;
}

interface IWeaponSkillRow {
    id: string;
    name_pl: string;
    name_en: string;
    class: string;
    description_pl: string;
    description_en: string;
    damageBonus: number;
    maxLevel: number;
}

type ClassKey = 'knight' | 'mage' | 'cleric' | 'archer' | 'rogue' | 'necromancer' | 'bard';

const ACTIVE = skillsData.activeSkills as Record<ClassKey, IActiveSkillRow[]>;
const WEAPON = skillsData.weaponSkills as IWeaponSkillRow[];

const CLASS_KEYS: ClassKey[] = ['knight', 'mage', 'cleric', 'archer', 'rogue', 'necromancer', 'bard'];

// Used to spin up clean caster/target/party/enemy state objects per test.
const blank = (): IStatusState => newStatusState();

// Apply a skill's effect string to a fresh status set and return the result
// plus the mutated states so individual tests can drill into specifics.
interface IApplyHarness {
    parsed: ReturnType<typeof parseEffects>;
    caster: IStatusState;
    target: IStatusState;
    party: IStatusState[];
    enemies: IStatusState[];
    result: ReturnType<typeof applyEffects>;
}

const applySkill = (
    effect: string | null,
    opts: { enemies?: number; party?: number; targetHpPct?: number } = {},
): IApplyHarness => {
    const parsed = parseEffects(effect);
    const caster = blank();
    const target = blank();
    const enemyCount = opts.enemies ?? 1;
    const partyCount = opts.party ?? 1;
    const enemies = Array.from({ length: enemyCount }, () => blank());
    const party = [caster, ...Array.from({ length: Math.max(0, partyCount - 1), }, () => blank())];
    // Set the primary target as the FIRST enemy so AOE-vs-single-target
    // assertions can verify both behaviors against the same array.
    enemies[0] = target;
    const result = applyEffects(parsed, caster, target, opts.targetHpPct ?? 100, party, enemies);
    return { parsed, caster, target, party, enemies, result };
};

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Catalog sanity (every skill is well-formed in skills.json)
// ════════════════════════════════════════════════════════════════════════════

describe('skill catalog: structural integrity', () => {
    it('declares 7 classes of active skills (knight/mage/cleric/archer/rogue/necromancer/bard)', () => {
        const keys = Object.keys(ACTIVE).sort();
        expect(keys).toEqual([...CLASS_KEYS].sort());
    });

    it('declares 5 weapon skills mapped to 5 classes', () => {
        // sword_fighting/distance_fighting/dagger_fighting/magic_level/bard_level
        // (5 weapon skills; magic_level is shared by Mage / Cleric / Necromancer
        // so 7 classes use 5 weapon skill IDs.)
        expect(WEAPON).toHaveLength(5);
        const ids = WEAPON.map((w) => w.id).sort();
        expect(ids).toEqual([
            'bard_level', 'dagger_fighting', 'distance_fighting', 'magic_level', 'sword_fighting',
        ]);
    });

    for (const cls of CLASS_KEYS) {
        it(`${cls} has exactly 15 active skills`, () => {
            expect(ACTIVE[cls]).toHaveLength(15);
        });
    }

    it('every active skill has the required JSON columns and well-formed types', () => {
        for (const cls of CLASS_KEYS) {
            for (const s of ACTIVE[cls]) {
                expect(s.id, `${cls}/${s.id} missing id`).toBeTypeOf('string');
                expect(s.name_pl, `${cls}/${s.id} missing name_pl`).toBeTypeOf('string');
                expect(s.name_en, `${cls}/${s.id} missing name_en`).toBeTypeOf('string');
                expect(s.mpCost, `${cls}/${s.id} bad mpCost`).toBeTypeOf('number');
                expect(s.cooldown, `${cls}/${s.id} bad cooldown`).toBeTypeOf('number');
                expect(s.damage, `${cls}/${s.id} bad damage`).toBeTypeOf('number');
                // effect may be null for pure-damage skills (fireball, ice_lance).
                if (s.effect !== null) {
                    expect(s.effect, `${cls}/${s.id} bad effect`).toBeTypeOf('string');
                }
                expect(s.unlockLevel, `${cls}/${s.id} bad unlockLevel`).toBeTypeOf('number');
                expect(s.goldCost, `${cls}/${s.id} bad goldCost`).toBeTypeOf('number');
                // Sanity range checks.
                expect(s.mpCost).toBeGreaterThan(0);
                expect(s.cooldown).toBeGreaterThan(0);
                expect(s.damage).toBeGreaterThanOrEqual(0);
                expect(s.unlockLevel).toBeGreaterThan(0);
                expect(s.goldCost).toBeGreaterThan(0);
            }
        }
    });

    it('every skill id is unique across the entire active catalog', () => {
        const ids: string[] = [];
        for (const cls of CLASS_KEYS) for (const s of ACTIVE[cls]) ids.push(s.id);
        const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
        expect(dupes).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Per-skill: effect string parses + applies cleanly
// ════════════════════════════════════════════════════════════════════════════

describe('every active skill: effect string parses and applies without throwing', () => {
    for (const cls of CLASS_KEYS) {
        for (const s of ACTIVE[cls]) {
            it(`${cls}.${s.id} (${s.name_en}): effect "${s.effect ?? '(null)'}" parses to atoms`, () => {
                const parsed = parseEffects(s.effect);
                if (s.effect === null) {
                    expect(parsed).toEqual([]);
                } else {
                    // Multi-atom effects MUST split on ';' and yield ≥1 atom.
                    const expectedCount = s.effect.split(';').map((p) => p.trim()).filter(Boolean).length;
                    expect(parsed).toHaveLength(expectedCount);
                    for (const atom of parsed) {
                        expect(atom.key, `${s.id} unknown effect atom: ${atom.raw}`).toBeTypeOf('string');
                        expect(atom.raw).toBeTruthy();
                    }
                }
            });

            it(`${cls}.${s.id}: applyEffects runs end-to-end without crashing`, () => {
                // Use 3 enemies + 4 party so AOE / party_* atoms have meaningful
                // sample sizes to mutate.
                const harness = applySkill(s.effect, { enemies: 3, party: 4 });
                expect(harness.result).toBeDefined();
                // castDmgMult never starts < 1 (no negative damage).
                expect(harness.result.castDmgMult).toBeGreaterThanOrEqual(1);
            });

            it(`${cls}.${s.id}: getSkillMpCost returns the declared mpCost (${s.mpCost})`, () => {
                expect(getSkillMpCost(s.id)).toBe(s.mpCost);
            });
        }
    }
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Knight: per-skill effect verification
// ════════════════════════════════════════════════════════════════════════════

describe('Knight skills: each skill matches its declared effect', () => {
    const find = (id: string) => ACTIVE.knight.find((s) => s.id === id)!;

    it('shield_bash: stun:3000 stuns the target for 3000 ms (damage = 1.5× weapon)', () => {
        const s = find('shield_bash');
        expect(s.damage).toBe(1.5);
        expect(s.effect).toBe('stun:3000');
        const h = applySkill(s.effect);
        expect(h.target.stunMs).toBe(3000);
        expect(h.result.stunApplied).toBe(true);
    });

    it('battle_cry: party_attack_up:20:5000 buffs ALL party members for 5000 ms at +20% ATK', () => {
        const s = find('battle_cry');
        expect(s.effect).toBe('party_attack_up:20:5000');
        const h = applySkill(s.effect, { party: 3 });
        for (const p of h.party) {
            expect(p.atkBuffPct).toBe(20);
            expect(p.atkBuffMs).toBe(5000);
        }
    });

    it('whirlwind: aoe;aggro_steal — aoe flag + aggro_steal flag both set', () => {
        const s = find('whirlwind');
        expect(s.effect).toBe('aoe;aggro_steal');
        const h = applySkill(s.effect);
        expect(h.result.aoe).toBe(true);
        expect(h.result.aggroSteal).toBe(true);
    });

    it('fortify: party_defense_up:30:8000 buffs party DEF +30% for 8000 ms', () => {
        const s = find('fortify');
        const h = applySkill(s.effect, { party: 4 });
        for (const p of h.party) {
            expect(p.defBuffPct).toBe(30);
            expect(p.defBuffMs).toBe(8000);
        }
    });

    it('berserker_rage: attack_up:50:6000 grants caster +50% ATK for 6000 ms', () => {
        const s = find('berserker_rage');
        const h = applySkill(s.effect);
        expect(h.caster.atkBuffPct).toBe(50);
        expect(h.caster.atkBuffMs).toBe(6000);
    });

    it('iron_defense: party_defense_up:50:10000 — party DEF +50% for 10s', () => {
        const s = find('iron_defense');
        const h = applySkill(s.effect, { party: 4 });
        expect(h.party[0].defBuffPct).toBe(50);
        expect(h.party[0].defBuffMs).toBe(10000);
    });

    it('charge: stun:2000 stuns target for 2 seconds', () => {
        const s = find('charge');
        const h = applySkill(s.effect);
        expect(h.target.stunMs).toBe(2000);
    });

    it('execute: execute_below:25 oneshots when target HP%<=25', () => {
        const s = find('execute');
        // Above threshold → no instant kill.
        const above = applySkill(s.effect, { targetHpPct: 30 });
        expect(above.result.instantKill).toBe(false);
        // At/below threshold → instant kill flag.
        const at = applySkill(s.effect, { targetHpPct: 25 });
        expect(at.result.instantKill).toBe(true);
        const below = applySkill(s.effect, { targetHpPct: 10 });
        expect(below.result.instantKill).toBe(true);
        // executeBelowPct in result preserved for view UI.
        expect(at.result.executeBelowPct).toBe(25);
    });

    it('war_cry: party_attack_up:30:15000 buffs party ATK +30% for 15s', () => {
        const s = find('war_cry');
        const h = applySkill(s.effect, { party: 4 });
        expect(h.party[0].atkBuffPct).toBe(30);
        expect(h.party[0].atkBuffMs).toBe(15000);
    });

    it('ultimate_slash: crit_next:1:1 queues 1 guaranteed crit at ×1', () => {
        // BuffBar stack cap = chargesToAdd × 2 → 1 × 2 = 2 entries in queue post-merge.
        const s = find('ultimate_slash');
        const h = applySkill(s.effect);
        expect(h.caster.critNext).toHaveLength(1);
        expect(h.caster.critNext[0]).toMatchObject({ mult: 1, count: 1 });
    });

    it('sword_mastery: dot:5000:5 applies a 5-second DOT dealing 5% max HP/s', () => {
        const s = find('sword_mastery');
        const h = applySkill(s.effect);
        expect(h.target.dots).toHaveLength(1);
        expect(h.target.dots[0]).toEqual({ remainingMs: 5000, pctPerSec: 5 });
    });

    it('titan_cleave: aoe;def_pen:40 — AOE flag + 40% defence-pen on this cast', () => {
        const s = find('titan_cleave');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
        expect(h.result.defPenPct).toBe(40);
    });

    it('divine_strike: aoe — pure AOE marker, no other side effects', () => {
        const s = find('divine_strike');
        expect(s.effect).toBe('aoe');
        const h = applySkill(s.effect);
        expect(h.result.aoe).toBe(true);
        expect(h.result.castDmgMult).toBe(1);
        expect(h.result.instantKill).toBe(false);
    });

    it('god_slash: aggro_steal;crit_next:1:1;dmg_amp_next:5:1 — combines 3 effects', () => {
        const s = find('god_slash');
        const h = applySkill(s.effect);
        expect(h.result.aggroSteal).toBe(true);
        // crit_next queued.
        expect(h.caster.critNext[0]).toMatchObject({ mult: 1, count: 1 });
        // dmg_amp_next:5:1 → next attack deals ×5 (1 charge, cap 2).
        expect(h.caster.dmgAmpNext[0]).toMatchObject({ mult: 5, count: 1 });
    });

    it('absolute_cleave: immortal:10000 grants caster 10s immortality', () => {
        const s = find('absolute_cleave');
        const h = applySkill(s.effect);
        expect(h.caster.immortalMs).toBe(10000);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4 — Mage: per-skill effect verification
// ════════════════════════════════════════════════════════════════════════════

describe('Mage skills: each skill matches its declared effect', () => {
    const find = (id: string) => ACTIVE.mage.find((s) => s.id === id)!;

    it('fireball: effect null + damage 4.0× weapon (pure damage spell)', () => {
        const s = find('fireball');
        expect(s.effect).toBeNull();
        expect(s.damage).toBe(4.0);
        const h = applySkill(s.effect);
        expect(h.parsed).toEqual([]);
        expect(h.result.aoe).toBe(false);
    });

    it('ice_lance: effect null + damage 5.0× weapon', () => {
        const s = find('ice_lance');
        expect(s.effect).toBeNull();
        expect(s.damage).toBe(5.0);
    });

    it('thunder_strike: aoe + damage 6.5× weapon', () => {
        const s = find('thunder_strike');
        expect(s.effect).toBe('aoe');
        expect(s.damage).toBe(6.5);
        const h = applySkill(s.effect);
        expect(h.result.aoe).toBe(true);
    });

    it('mana_shield: mana_shield:20000 opens 20s window where damage drains MP first', () => {
        const s = find('mana_shield');
        const h = applySkill(s.effect);
        expect(h.caster.manaShieldMs).toBe(20000);
    });

    it('arcane_bolt: dmg_amp_next:3:1 — next attack deals ×3 damage', () => {
        const s = find('arcane_bolt');
        const h = applySkill(s.effect);
        expect(h.caster.dmgAmpNext[0]).toMatchObject({ mult: 3, count: 1 });
    });

    it('blizzard: aoe + damage 11.0× weapon (per row in skills.json)', () => {
        const s = find('blizzard');
        expect(s.effect).toBe('aoe');
        expect(s.damage).toBe(11.0);
    });

    it('meteor: aoe;stun:3000 — AOE flag + every enemy stunned for 3000 ms', () => {
        const s = find('meteor');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
        // All 3 enemies stunned (AOE+stun spreads stun across the wave).
        for (const e of h.enemies) {
            expect(e.stunMs).toBe(3000);
        }
        expect(h.result.aoeStunIdxs.sort()).toEqual([0, 1, 2]);
    });

    it('time_warp: party_as_up:1.5:8000 — party AS ×1.5 for 8s', () => {
        const s = find('time_warp');
        const h = applySkill(s.effect, { party: 4 });
        for (const p of h.party) {
            expect(p.asMult).toBe(1.5);
            expect(p.asMultMs).toBe(8000);
        }
    });

    it('arcane_explosion: aoe + damage 24.0', () => {
        const s = find('arcane_explosion');
        expect(s.effect).toBe('aoe');
        expect(s.damage).toBe(24.0);
    });

    it('apocalypse_spell: aoe;immortal:5000 — AOE + 5s caster immortality', () => {
        const s = find('apocalypse_spell');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
        expect(h.caster.immortalMs).toBe(5000);
    });

    it('void_ray: heal_self_pct_dmg:30 — caster heals 30% of damage dealt', () => {
        const s = find('void_ray');
        const h = applySkill(s.effect);
        expect(h.result.healCasterPctOfDmg).toBe(30);
    });

    it('reality_rend: aoe;def_pen:50 — AOE flag + 50% defence-pen', () => {
        const s = find('reality_rend');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
        expect(h.result.defPenPct).toBe(50);
    });

    it('singularity: paralyze:5000 — target paralyzed for 5s (stunMs field)', () => {
        const s = find('singularity');
        const h = applySkill(s.effect);
        expect(h.target.stunMs).toBe(5000);
        expect(h.result.paralyzeApplied).toBe(true);
    });

    it('god_nova: aoe;heal_self_pct_dmg:50 — AOE + heal 50% of dmg', () => {
        const s = find('god_nova');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
        expect(h.result.healCasterPctOfDmg).toBe(50);
    });

    it('big_bang: aoe;stun:10000;immortal:10000 — AOE + 10s stun on every enemy + 10s caster immortal', () => {
        const s = find('big_bang');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
        for (const e of h.enemies) expect(e.stunMs).toBe(10000);
        expect(h.caster.immortalMs).toBe(10000);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Cleric: per-skill effect verification
// ════════════════════════════════════════════════════════════════════════════

describe('Cleric skills: each skill matches its declared effect', () => {
    const find = (id: string) => ACTIVE.cleric.find((s) => s.id === id)!;

    it('holy_strike: heal_self_pct_dmg:50 — caster heals 50% of dmg dealt', () => {
        const s = find('holy_strike');
        const h = applySkill(s.effect);
        expect(h.result.healCasterPctOfDmg).toBe(50);
    });

    it('heal: heal_lowest_ally_pct:20 — healLowestAllyPct = 20', () => {
        const s = find('heal');
        const h = applySkill(s.effect, { party: 4 });
        expect(h.result.healLowestAllyPct).toBe(20);
    });

    it('divine_shield: block_next_party:1 — addBlockNextPartyHits = 1', () => {
        const s = find('divine_shield');
        const h = applySkill(s.effect);
        expect(h.result.addBlockNextPartyHits).toBe(1);
    });

    it('smite: aoe;stun_chance:30:3000 — AOE + 30% stun chance per enemy (3s)', () => {
        const s = find('smite');
        // Force Math.random to always pass (< 0.3) so every enemy gets stunned.
        const orig = Math.random;
        Math.random = () => 0;
        try {
            const h = applySkill(s.effect, { enemies: 3 });
            expect(h.result.aoe).toBe(true);
            for (const e of h.enemies) expect(e.stunMs).toBe(3000);
            expect(h.result.stunApplied).toBe(true);
        } finally {
            Math.random = orig;
        }
    });

    it('smite: stun_chance:30 with Math.random forced ABOVE 0.3 means no stun', () => {
        const s = find('smite');
        const orig = Math.random;
        Math.random = () => 0.99; // 99 ≥ 30 → fail every roll
        try {
            const h = applySkill(s.effect, { enemies: 3 });
            for (const e of h.enemies) expect(e.stunMs).toBe(0);
            expect(h.result.stunApplied).toBe(false);
        } finally {
            Math.random = orig;
        }
    });

    it('blessing: heal_party_dot:10000:5 — healPartyDotMs=10000 + pct/sec=5', () => {
        const s = find('blessing');
        const h = applySkill(s.effect, { party: 4 });
        expect(h.result.healPartyDotMs).toBe(10000);
        expect(h.result.healPartyDotPctPerSec).toBe(5);
    });

    it('resurrection_aura: revive_party:0:0 — reviveDeadAllies flag set true', () => {
        const s = find('resurrection_aura');
        const h = applySkill(s.effect, { party: 4 });
        expect(h.result.reviveDeadAllies).toBe(true);
        expect(h.result.revivePartyProtectMs).toBe(0);
        expect(h.result.revivePartyGraceMs).toBe(0);
    });

    it('holy_nova: aoe;heal_lowest_ally_pct:20 — AOE + heal-lowest 20%', () => {
        const s = find('holy_nova');
        const h = applySkill(s.effect, { party: 4, enemies: 3 });
        expect(h.result.aoe).toBe(true);
        expect(h.result.healLowestAllyPct).toBe(20);
    });

    it('consecration: pure aoe — only AOE flag', () => {
        const s = find('consecration');
        expect(s.effect).toBe('aoe');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
    });

    it('divine_intervention (Sąd Boży): next_ally_heal:7.5:3 queues 3 charges at 7.5%', () => {
        // Per spec the queue lives on CASTER only (caster heals lowest ally
        // on next 3 basic attacks). Allies don't get the queue.
        const s = find('divine_intervention');
        const h = applySkill(s.effect, { party: 4 });
        expect(h.caster.nextAllyHeal).toHaveLength(1);
        expect(h.caster.nextAllyHeal[0]).toMatchObject({ pct: 7.5, count: 3 });
        // Allies (party[1..3]) MUST stay empty.
        for (let i = 1; i < h.party.length; i++) {
            expect(h.party[i].nextAllyHeal).toEqual([]);
        }
    });

    it('holy_judgment: aoe;def_pen:80 — AOE + 80% defence-pen', () => {
        const s = find('holy_judgment');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
        expect(h.result.defPenPct).toBe(80);
    });

    it('divine_wrath (Boski Filar): party_lifesteal_next:100:5 — every ally gets 5 charges at 100%', () => {
        const s = find('divine_wrath');
        const h = applySkill(s.effect, { party: 4 });
        for (const p of h.party) {
            expect(p.lifestealNext).toHaveLength(1);
            expect(p.lifestealNext[0]).toMatchObject({ pct: 100, count: 5 });
        }
    });

    it('celestial_heal: heal_party_pct:60 — instant heal 60% of max HP to every ally', () => {
        const s = find('celestial_heal');
        const h = applySkill(s.effect, { party: 4 });
        expect(h.result.healPartyPctInstant).toBe(60);
    });

    it('apocalypse_prayer: aoe;def_pen:80;heal_party_pct:30 — three atoms combined', () => {
        const s = find('apocalypse_prayer');
        const h = applySkill(s.effect, { party: 4, enemies: 3 });
        expect(h.result.aoe).toBe(true);
        expect(h.result.defPenPct).toBe(80);
        expect(h.result.healPartyPctInstant).toBe(30);
    });

    it('divine_pillar: aoe;party_immortal:5000 — party true-immortal for 5s (immortalMs)', () => {
        const s = find('divine_pillar');
        const h = applySkill(s.effect, { party: 4, enemies: 3 });
        expect(h.result.aoe).toBe(true);
        for (const p of h.party) {
            expect(p.immortalMs).toBe(5000);
        }
        expect(h.result.partyImmortalMs).toBe(5000);
    });

    it('holy_apocalypse: aoe;party_immortal:5000;revive_party:5000:10000 — all 3 atoms fire', () => {
        const s = find('holy_apocalypse');
        const h = applySkill(s.effect, { party: 4, enemies: 3 });
        expect(h.result.aoe).toBe(true);
        for (const p of h.party) {
            expect(p.immortalMs).toBe(5000);
            // revive_party:5000:10000 → cannotDie window 5000ms.
            expect(p.cannotDieMs).toBe(5000);
        }
        expect(h.result.reviveDeadAllies).toBe(true);
        expect(h.result.revivePartyProtectMs).toBe(5000);
        expect(h.result.revivePartyGraceMs).toBe(10000);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 6 — Archer: per-skill effect verification
// ════════════════════════════════════════════════════════════════════════════

describe('Archer skills: each skill matches its declared effect', () => {
    const find = (id: string) => ACTIVE.archer.find((s) => s.id === id)!;

    it('precise_shot: crit_buff_next:30 — caster.critBuffNext = 30', () => {
        const s = find('precise_shot');
        const h = applySkill(s.effect);
        expect(h.caster.critBuffNext).toBe(30);
    });

    it('poison_arrow: dot:5000:5 — 5-second DOT at 5% max HP/s', () => {
        const s = find('poison_arrow');
        const h = applySkill(s.effect);
        expect(h.target.dots).toHaveLength(1);
        expect(h.target.dots[0]).toEqual({ remainingMs: 5000, pctPerSec: 5 });
    });

    it('eagle_eye: crit_buff:30:10000 — +30% crit chance window for 10s', () => {
        const s = find('eagle_eye');
        const h = applySkill(s.effect);
        expect(h.caster.critBuffPct).toBe(30);
        expect(h.caster.critBuffMs).toBe(10000);
    });

    it('rain_of_arrows: aoe + damage 4.5× weapon', () => {
        const s = find('rain_of_arrows');
        expect(s.damage).toBe(4.5);
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
    });

    it('trap: stun:3000 — target stunned for 3s', () => {
        const s = find('trap');
        const h = applySkill(s.effect);
        expect(h.target.stunMs).toBe(3000);
    });

    it('multishot: multistrike:3 — result.multistrike = 3', () => {
        const s = find('multishot');
        const h = applySkill(s.effect);
        expect(h.result.multistrike).toBe(3);
    });

    it('wind_arrow: stun:3000 — single-target stun for 3s', () => {
        const s = find('wind_arrow');
        const h = applySkill(s.effect);
        expect(h.target.stunMs).toBe(3000);
        expect(h.result.stunApplied).toBe(true);
    });

    it('sniper_shot: def_pen:100 — ignore 100% of target defence', () => {
        const s = find('sniper_shot');
        const h = applySkill(s.effect);
        expect(h.result.defPenPct).toBe(100);
    });

    it('shadow_step: dodge_next:3:non_magic — queues 3 non_magic dodges on caster', () => {
        const s = find('shadow_step');
        const h = applySkill(s.effect);
        expect(h.caster.dodgeNext).toHaveLength(1);
        expect(h.caster.dodgeNext[0]).toMatchObject({ count: 3, scope: 'non_magic' });
    });

    it('death_arrow: instant_kill_chance:5 — instantKillPct = 5', () => {
        const s = find('death_arrow');
        const h = applySkill(s.effect);
        expect(h.result.instantKillPct).toBe(5);
    });

    it('celestial_arrow: aoe + damage 30.0× weapon', () => {
        const s = find('celestial_arrow');
        expect(s.damage).toBe(30.0);
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
    });

    it('void_shot: aoe;def_pen:60 — AOE + 60% def-pen', () => {
        const s = find('void_shot');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
        expect(h.result.defPenPct).toBe(60);
    });

    it('god_arrow: dmg_amp_next:2:8 — next 8 attacks deal ×2 damage', () => {
        const s = find('god_arrow');
        const h = applySkill(s.effect);
        expect(h.caster.dmgAmpNext[0]).toMatchObject({ mult: 2, count: 8 });
    });

    it('destiny_shot: instant_kill_chance:10 — instantKillPct = 10', () => {
        const s = find('destiny_shot');
        const h = applySkill(s.effect);
        expect(h.result.instantKillPct).toBe(10);
    });

    it('universe_arrow: aoe;instant_kill_chance:15 — AOE + 15% IK per target', () => {
        const s = find('universe_arrow');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
        expect(h.result.instantKillPct).toBe(15);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 7 — Rogue: per-skill effect verification
// ════════════════════════════════════════════════════════════════════════════

describe('Rogue skills: each skill matches its declared effect', () => {
    const find = (id: string) => ACTIVE.rogue.find((s) => s.id === id)!;

    it('backstab: crit_next:1:1 — 1 guaranteed crit queued', () => {
        const s = find('backstab');
        const h = applySkill(s.effect);
        expect(h.caster.critNext[0]).toMatchObject({ mult: 1, count: 1 });
    });

    it('poison_blade: dot:5000:5 — 5s DOT at 5% max HP/s', () => {
        const s = find('poison_blade');
        const h = applySkill(s.effect);
        expect(h.target.dots[0]).toEqual({ remainingMs: 5000, pctPerSec: 5 });
    });

    it('evasion: dodge_next:3:non_magic — 3 non_magic dodges queued', () => {
        const s = find('evasion');
        const h = applySkill(s.effect);
        expect(h.caster.dodgeNext[0]).toMatchObject({ count: 3, scope: 'non_magic' });
    });

    it('dual_strike: stun_chance:50:3000 — 50% chance to stun for 3s (single target)', () => {
        const s = find('dual_strike');
        const orig = Math.random;
        // Force success (0 < 0.5).
        Math.random = () => 0;
        try {
            const h = applySkill(s.effect);
            expect(h.target.stunMs).toBe(3000);
            expect(h.result.stunApplied).toBe(true);
        } finally {
            Math.random = orig;
        }
    });

    it('dual_strike: stun_chance roll failure leaves target unstunned', () => {
        const s = find('dual_strike');
        const orig = Math.random;
        Math.random = () => 0.99;
        try {
            const h = applySkill(s.effect);
            expect(h.target.stunMs).toBe(0);
            expect(h.result.stunApplied).toBe(false);
        } finally {
            Math.random = orig;
        }
    });

    it('smoke_bomb: dodge_buff:50:4000 — +50% dodge for 4s', () => {
        const s = find('smoke_bomb');
        const h = applySkill(s.effect);
        expect(h.caster.dodgeBuffPct).toBe(50);
        expect(h.caster.dodgeBuffMs).toBe(4000);
    });

    it('assassinate: execute_below:20 — oneshot when target HP%<=20', () => {
        const s = find('assassinate');
        expect(applySkill(s.effect, { targetHpPct: 25 }).result.instantKill).toBe(false);
        expect(applySkill(s.effect, { targetHpPct: 20 }).result.instantKill).toBe(true);
        expect(applySkill(s.effect, { targetHpPct: 5 }).result.instantKill).toBe(true);
    });

    it('hemorrhage: dot:8000:4 — 8s DOT at 4% max HP/s', () => {
        const s = find('hemorrhage');
        const h = applySkill(s.effect);
        expect(h.target.dots[0]).toEqual({ remainingMs: 8000, pctPerSec: 4 });
    });

    it('shadow_clone: dmg_amp_next:2:1 — next attack deals ×2 dmg', () => {
        const s = find('shadow_clone');
        const h = applySkill(s.effect);
        expect(h.caster.dmgAmpNext[0]).toMatchObject({ mult: 2, count: 1 });
    });

    it('marked_for_death: mark_heal_to_dmg:6000 — target.markNoHealMs = 6000', () => {
        const s = find('marked_for_death');
        const h = applySkill(s.effect);
        expect(h.target.markNoHealMs).toBe(6000);
    });

    it('instant_kill: instant_kill_chance:5 — instantKillPct = 5', () => {
        const s = find('instant_kill');
        const h = applySkill(s.effect);
        expect(h.result.instantKillPct).toBe(5);
    });

    it('shadow_death: pure aoe', () => {
        const s = find('shadow_death');
        expect(s.effect).toBe('aoe');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
    });

    it('void_strike: def_pen:100 — ignore all defence on this cast', () => {
        const s = find('void_strike');
        const h = applySkill(s.effect);
        expect(h.result.defPenPct).toBe(100);
    });

    it('death_touch: instant_kill_chance:10 — instantKillPct = 10', () => {
        const s = find('death_touch');
        const h = applySkill(s.effect);
        expect(h.result.instantKillPct).toBe(10);
    });

    it('god_assassin: aoe;def_pen:100 — AOE + ignore all defence', () => {
        const s = find('god_assassin');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
        expect(h.result.defPenPct).toBe(100);
    });

    it('absolute_death: instant_kill_chance:50;dodge_next:1:non_magic — 50% IK + 1 dodge queued', () => {
        const s = find('absolute_death');
        const orig = Math.random;
        Math.random = () => 0; // pass IK roll
        try {
            const h = applySkill(s.effect);
            expect(h.result.instantKillPct).toBe(50);
            expect(h.caster.dodgeNext[0]).toMatchObject({ count: 1, scope: 'non_magic' });
        } finally {
            Math.random = orig;
        }
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 8 — Necromancer: per-skill effect verification
// ════════════════════════════════════════════════════════════════════════════

describe('Necromancer skills: each skill matches its declared effect', () => {
    const find = (id: string) => ACTIVE.necromancer.find((s) => s.id === id)!;

    it('life_drain: heal_self_pct_dmg:30 — caster heals 30% of damage dealt', () => {
        const s = find('life_drain');
        const h = applySkill(s.effect);
        expect(h.result.healCasterPctOfDmg).toBe(30);
    });

    it('summon_skeleton: summon:skeleton:1 — emits 1 skeleton summon spec', () => {
        const s = find('summon_skeleton');
        const h = applySkill(s.effect);
        expect(h.result.summons).toEqual([{ type: 'skeleton', count: 1 }]);
    });

    it('death_curse: mark_amp:6:1:15000 — target.markAmp gets {mult:6, count:1, remainingMs:15000}', () => {
        const s = find('death_curse');
        const h = applySkill(s.effect);
        expect(h.target.markAmp).toHaveLength(1);
        expect(h.target.markAmp[0]).toEqual({ mult: 6, count: 1, remainingMs: 15000 });
    });

    it('bone_spear: aoe + damage 4.0× weapon', () => {
        const s = find('bone_spear');
        expect(s.damage).toBe(4.0);
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
    });

    it('plague: aoe;dot:5000:5 — AOE + 5s DOT at 5% max HP/s on EVERY enemy', () => {
        const s = find('plague');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
        for (const e of h.enemies) {
            expect(e.dots).toHaveLength(1);
            expect(e.dots[0]).toEqual({ remainingMs: 5000, pctPerSec: 5 });
        }
    });

    it('raise_dead: summon:ghost:1 — 1 ghost summon spec', () => {
        const s = find('raise_dead');
        const h = applySkill(s.effect);
        expect(h.result.summons).toEqual([{ type: 'ghost', count: 1 }]);
    });

    it('soul_harvest: aoe;heal_self_pct_dmg:50 — AOE + 50% of dmg heals caster', () => {
        const s = find('soul_harvest');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
        expect(h.result.healCasterPctOfDmg).toBe(50);
    });

    it('dark_ritual: dark_ritual:10000:25 — pushes pending ritual entry on target (10s/25%)', () => {
        const s = find('dark_ritual');
        const h = applySkill(s.effect);
        expect(h.target.darkRitualPending).toHaveLength(1);
        expect(h.target.darkRitualPending[0]).toEqual({ triggerInMs: 10000, pctOfMaxHp: 25 });
    });

    it('dark_ritual: tickStatus drains the ritual timer + fires damage at trigger', () => {
        const s = find('dark_ritual');
        const h = applySkill(s.effect);
        // Tick 5s: timer drains, no fire yet.
        const mid = tickStatus(h.target, 5000, 10000);
        expect(mid.darkRitualTriggered).toBe(false);
        expect(h.target.darkRitualPending[0].triggerInMs).toBe(5000);
        // Tick another 5s: timer hits 0 → fires 25% of targetMaxHp (10000) = 2500.
        const fire = tickStatus(h.target, 5000, 10000);
        expect(fire.darkRitualTriggered).toBe(true);
        expect(fire.darkRitualDamage).toBe(2500);
        expect(h.target.darkRitualPending).toEqual([]);
    });

    it('army_of_darkness: summon:skeleton:5 — 5 skeleton summon spec', () => {
        const s = find('army_of_darkness');
        const h = applySkill(s.effect);
        expect(h.result.summons).toEqual([{ type: 'skeleton', count: 5 }]);
    });

    it('death_coil: stun:3000 — single-target 3s stun', () => {
        const s = find('death_coil');
        const h = applySkill(s.effect);
        expect(h.target.stunMs).toBe(3000);
    });

    it('apocalypse_rise: summon:demon:1 — 1 demon summon spec', () => {
        const s = find('apocalypse_rise');
        const h = applySkill(s.effect);
        expect(h.result.summons).toEqual([{ type: 'demon', count: 1 }]);
    });

    it('death_realm: aoe;mark_amp_all:2:5000 — every enemy gets ×2 mark for 5s', () => {
        const s = find('death_realm');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
        for (const e of h.enemies) {
            expect(e.markAmpAll).toEqual({ mult: 2, remainingMs: 5000 });
        }
    });

    it('soul_storm: aoe;summon:ghost:3 — AOE + 3 ghosts summoned', () => {
        const s = find('soul_storm');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
        expect(h.result.summons).toEqual([{ type: 'ghost', count: 3 }]);
    });

    it('lich_transformation: summon:lich:1 — 1 lich summon spec', () => {
        const s = find('lich_transformation');
        const h = applySkill(s.effect);
        expect(h.result.summons).toEqual([{ type: 'lich', count: 1 }]);
    });

    it('death_apocalypse: death_apocalypse;summon:skeleton:1 — deathApocalypse flag + skeleton summon', () => {
        const s = find('death_apocalypse');
        const h = applySkill(s.effect);
        expect(h.result.deathApocalypse).toBe(true);
        // Per skillEffectsV2.ts: caster drops to 20% of max HP normally.
        expect(h.result.deathApocalypseSelfHpFloor).toBe(0.20);
        // Target damage = 50% of target max HP.
        expect(h.result.deathApocalypseTargetMaxHpPct).toBe(50);
        // Skeleton summon is part of the same effect string.
        expect(h.result.summons).toEqual([{ type: 'skeleton', count: 1 }]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 9 — Bard: per-skill effect verification
// ════════════════════════════════════════════════════════════════════════════

describe('Bard skills: each skill matches its declared effect', () => {
    const find = (id: string) => ACTIVE.bard.find((s) => s.id === id)!;

    it('battle_hymn: party_attack_up:15:10000 — party ATK +15% for 10s', () => {
        const s = find('battle_hymn');
        const h = applySkill(s.effect, { party: 4 });
        for (const p of h.party) {
            expect(p.atkBuffPct).toBe(15);
            expect(p.atkBuffMs).toBe(10000);
        }
    });

    it('lullaby: enemy_atk_down:25:8000 — every enemy ATK -25% for 8s', () => {
        const s = find('lullaby');
        const h = applySkill(s.effect, { enemies: 3 });
        for (const e of h.enemies) {
            expect(e.enemyAtkDownPct).toBe(25);
            expect(e.enemyAtkDownMs).toBe(8000);
        }
    });

    it('ballad_of_heroes: party_as_up:1.5:12000 — party AS ×1.5 for 12s', () => {
        const s = find('ballad_of_heroes');
        const h = applySkill(s.effect, { party: 4 });
        for (const p of h.party) {
            expect(p.asMult).toBe(1.5);
            expect(p.asMultMs).toBe(12000);
        }
    });

    it('dissonance: stun_chance:35:3000 — 35% chance to stun (single target)', () => {
        const s = find('dissonance');
        const orig = Math.random;
        Math.random = () => 0; // pass
        try {
            const h = applySkill(s.effect);
            expect(h.target.stunMs).toBe(3000);
            expect(h.result.stunApplied).toBe(true);
        } finally {
            Math.random = orig;
        }
    });

    it('war_song: party_crit_up:30:12000 — party +30% crit chance for 12s', () => {
        const s = find('war_song');
        const h = applySkill(s.effect, { party: 4 });
        for (const p of h.party) {
            expect(p.partyCritPct).toBe(30);
            expect(p.partyCritMs).toBe(12000);
        }
    });

    it('heroic_ballad: party_def_pen:40:10000 — party ignores 40% def for 10s', () => {
        const s = find('heroic_ballad');
        const h = applySkill(s.effect, { party: 4 });
        for (const p of h.party) {
            expect(p.defPenPct).toBe(40);
            expect(p.defPenMs).toBe(10000);
        }
    });

    it('requiem: pure aoe + damage 4.5', () => {
        const s = find('requiem');
        expect(s.damage).toBe(4.5);
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
    });

    it('sirens_call: aoe;enemy_no_heal:5000 — every enemy has enemyNoHealMs=5000', () => {
        const s = find('sirens_call');
        const h = applySkill(s.effect, { enemies: 3 });
        expect(h.result.aoe).toBe(true);
        for (const e of h.enemies) {
            expect(e.enemyNoHealMs).toBe(5000);
        }
    });

    it('epic_saga: party_attack_up:40:15000 — party ATK +40% for 15s', () => {
        const s = find('epic_saga');
        const h = applySkill(s.effect, { party: 4 });
        expect(h.party[0].atkBuffPct).toBe(40);
        expect(h.party[0].atkBuffMs).toBe(15000);
    });

    it('legends_anthem: party_immortal:3000 — party.immortalMs = 3000, partyImmortalMs result = 3000', () => {
        const s = find('legends_anthem');
        const h = applySkill(s.effect, { party: 4 });
        for (const p of h.party) {
            expect(p.immortalMs).toBe(3000);
        }
        expect(h.result.partyImmortalMs).toBe(3000);
    });

    it('divine_melody: party_as_up:2:10000;party_attack_up:40:10000 — both buffs land on party', () => {
        const s = find('divine_melody');
        const h = applySkill(s.effect, { party: 4 });
        for (const p of h.party) {
            expect(p.asMult).toBe(2);
            expect(p.asMultMs).toBe(10000);
            expect(p.atkBuffPct).toBe(40);
            expect(p.atkBuffMs).toBe(10000);
        }
    });

    it('song_of_doom: aoe;party_attack_up:20:20000 — AOE + party ATK +20% for 20s', () => {
        const s = find('song_of_doom');
        const h = applySkill(s.effect, { party: 4, enemies: 3 });
        expect(h.result.aoe).toBe(true);
        for (const p of h.party) {
            expect(p.atkBuffPct).toBe(20);
            expect(p.atkBuffMs).toBe(20000);
        }
    });

    it('cosmic_hymn: party_immortal:8000 — 8s party immortality', () => {
        const s = find('cosmic_hymn');
        const h = applySkill(s.effect, { party: 4 });
        for (const p of h.party) {
            expect(p.immortalMs).toBe(8000);
        }
    });

    it('god_ballad: aoe;party_attack_up:50:30000 — AOE + party +50% ATK for 30s', () => {
        const s = find('god_ballad');
        const h = applySkill(s.effect, { party: 4, enemies: 3 });
        expect(h.result.aoe).toBe(true);
        for (const p of h.party) {
            expect(p.atkBuffPct).toBe(50);
            expect(p.atkBuffMs).toBe(30000);
        }
    });

    it('universe_song: 4-atom mega-buff fires every component (IK + immortal + ATK + AS)', () => {
        const s = find('universe_song');
        // party_instant_kill_chance_next:5:5;party_immortal:3000;party_attack_up:100:30000;party_as_up:2.2:10000
        const h = applySkill(s.effect, { party: 4 });
        for (const p of h.party) {
            // IK queue: 5% chance for next 5 attacks.
            expect(p.nextAllyInstantKillPct).toHaveLength(1);
            expect(p.nextAllyInstantKillPct[0]).toMatchObject({ pct: 5, count: 5 });
            // Party immortal: 3000 ms.
            expect(p.immortalMs).toBe(3000);
            // ATK +100% for 30s.
            expect(p.atkBuffPct).toBe(100);
            expect(p.atkBuffMs).toBe(30000);
            // AS ×2.2 for 10s.
            expect(p.asMult).toBe(2.2);
            expect(p.asMultMs).toBe(10000);
        }
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 10 — Weapon skills (per-level damage bonus matches damageBonus × lvl)
// ════════════════════════════════════════════════════════════════════════════

describe('weapon skills: per-level damage bonus matches declared damageBonus', () => {
    for (const w of WEAPON) {
        it(`${w.id} (${w.name_en}): damageBonus=${w.damageBonus}/lvl, maxLevel=${w.maxLevel}`, () => {
            // Linear: getSkillDamageBonus(lvl, dmgBonus) = lvl * dmgBonus.
            expect(getSkillDamageBonus(0, w.damageBonus)).toBe(0);
            expect(getSkillDamageBonus(1, w.damageBonus)).toBeCloseTo(w.damageBonus, 10);
            expect(getSkillDamageBonus(10, w.damageBonus)).toBeCloseTo(10 * w.damageBonus, 10);
            expect(getSkillDamageBonus(w.maxLevel, w.damageBonus))
                .toBeCloseTo(w.maxLevel * w.damageBonus, 10);
        });
    }

    it('sword_fighting maps to knight class', () => {
        expect(WEAPON.find((w) => w.id === 'sword_fighting')!.class).toBe('knight');
    });

    it('distance_fighting maps to archer class', () => {
        expect(WEAPON.find((w) => w.id === 'distance_fighting')!.class).toBe('archer');
    });

    it('dagger_fighting maps to rogue class', () => {
        expect(WEAPON.find((w) => w.id === 'dagger_fighting')!.class).toBe('rogue');
    });

    it('magic_level maps to mage class (shared by cleric + necromancer at runtime)', () => {
        expect(WEAPON.find((w) => w.id === 'magic_level')!.class).toBe('mage');
    });

    it('bard_level maps to bard class', () => {
        expect(WEAPON.find((w) => w.id === 'bard_level')!.class).toBe('bard');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 11 — Integration: castSkill (the high-level entry point used by combat views)
// ════════════════════════════════════════════════════════════════════════════
//
// Each combat view (Hunt / Boss / Dungeon / Raid / Trainer / Transform /
// Arena) wraps spell casts via `effectsCastSkill({...})` in
// combatEffectsHelpers.ts. These tests prove the session-level path
// produces the SAME mutations as the lower-level applyEffects calls
// above — i.e. the indirection doesn't strip side effects.
// ════════════════════════════════════════════════════════════════════════════

describe('castSkill (combatEffectsHelpers): session-level integration', () => {
    it('shield_bash: target stunMs grows via session ensureStatus', () => {
        const session = newCombatEffectsSession();
        const def = ACTIVE.knight.find((s) => s.id === 'shield_bash')!;
        const r = effectsCastSkill({
            session,
            casterId: 'player',
            targetId: 'mob1',
            targetHpPct: 100,
            effect: def.effect,
            allyIds: ['player'],
            enemyIds: ['mob1'],
        });
        expect(r.stunApplied).toBe(true);
        const mobStatus = session.statuses.get('mob1');
        expect(mobStatus?.stunMs).toBe(3000);
    });

    it('battle_cry: ally bots in allyIds get the buff via session', () => {
        const session = newCombatEffectsSession();
        const def = ACTIVE.knight.find((s) => s.id === 'battle_cry')!;
        effectsCastSkill({
            session,
            casterId: 'player',
            targetId: null,
            targetHpPct: 100,
            effect: def.effect,
            allyIds: ['player', 'bot1', 'bot2', 'bot3'],
            enemyIds: [],
        });
        // All 4 ally statuses created + buffed.
        for (const id of ['player', 'bot1', 'bot2', 'bot3']) {
            const st = session.statuses.get(id);
            expect(st?.atkBuffPct, `${id} missing atk buff`).toBe(20);
            expect(st?.atkBuffMs, `${id} missing atk buff duration`).toBe(5000);
        }
    });

    it('plague: AOE+DOT applies the DOT to every enemy id in the wave', () => {
        const session = newCombatEffectsSession();
        const def = ACTIVE.necromancer.find((s) => s.id === 'plague')!;
        effectsCastSkill({
            session,
            casterId: 'player',
            targetId: 'mob0',
            targetHpPct: 100,
            effect: def.effect,
            allyIds: ['player'],
            enemyIds: ['mob0', 'mob1', 'mob2'],
        });
        for (const id of ['mob0', 'mob1', 'mob2']) {
            const st = session.statuses.get(id);
            expect(st?.dots, `${id} missing DOT`).toHaveLength(1);
            expect(st?.dots[0]).toEqual({ remainingMs: 5000, pctPerSec: 5 });
        }
    });

    it('summon_skeleton: result.summons declares the skeleton spec for the view to spawn', () => {
        const session = newCombatEffectsSession();
        const def = ACTIVE.necromancer.find((s) => s.id === 'summon_skeleton')!;
        const r = effectsCastSkill({
            session,
            casterId: 'player',
            targetId: null,
            targetHpPct: 100,
            effect: def.effect,
            allyIds: ['player'],
            enemyIds: [],
        });
        expect(r.summons).toEqual([{ type: 'skeleton', count: 1 }]);
    });

    it('precise_shot: crit_buff_next sets to 30 on the caster status', () => {
        const session = newCombatEffectsSession();
        const def = ACTIVE.archer.find((s) => s.id === 'precise_shot')!;
        effectsCastSkill({
            session,
            casterId: 'player',
            targetId: 'mob',
            targetHpPct: 100,
            effect: def.effect,
            allyIds: ['player'],
            enemyIds: ['mob'],
        });
        expect(session.statuses.get('player')?.critBuffNext).toBe(30);
    });

    it('mana_shield: caster manaShieldMs set without target writes', () => {
        const session = newCombatEffectsSession();
        const def = ACTIVE.mage.find((s) => s.id === 'mana_shield')!;
        effectsCastSkill({
            session,
            casterId: 'player',
            targetId: null,
            targetHpPct: 100,
            effect: def.effect,
            allyIds: ['player'],
            enemyIds: [],
        });
        expect(session.statuses.get('player')?.manaShieldMs).toBe(20000);
    });

    it('divine_intervention: nextAllyHeal lives on caster only (not allies)', () => {
        // Per spec: "tylko moja postać ma kolejne ataki się leczyć,
        // nie sojusznicy" — the queue must NOT propagate to party ids.
        const session = newCombatEffectsSession();
        const def = ACTIVE.cleric.find((s) => s.id === 'divine_intervention')!;
        effectsCastSkill({
            session,
            casterId: 'player',
            targetId: null,
            targetHpPct: 100,
            effect: def.effect,
            allyIds: ['player', 'bot1', 'bot2'],
            enemyIds: [],
        });
        const casterSt = session.statuses.get('player');
        expect(casterSt?.nextAllyHeal).toHaveLength(1);
        expect(casterSt?.nextAllyHeal[0]).toMatchObject({ pct: 7.5, count: 3 });
        // Bots' queues stay empty.
        for (const id of ['bot1', 'bot2']) {
            const st = session.statuses.get(id);
            // ensureStatus initialised — queue must still be empty.
            expect(st?.nextAllyHeal).toEqual([]);
        }
    });

    it('divine_wrath (Boski Filar): every ally gets 5 lifesteal charges', () => {
        const session = newCombatEffectsSession();
        const def = ACTIVE.cleric.find((s) => s.id === 'divine_wrath')!;
        effectsCastSkill({
            session,
            casterId: 'player',
            targetId: null,
            targetHpPct: 100,
            effect: def.effect,
            allyIds: ['player', 'bot1', 'bot2', 'bot3'],
            enemyIds: [],
        });
        for (const id of ['player', 'bot1', 'bot2', 'bot3']) {
            const st = session.statuses.get(id);
            expect(st?.lifestealNext, `${id} missing lifesteal`).toHaveLength(1);
            expect(st?.lifestealNext[0]).toMatchObject({ pct: 100, count: 5 });
        }
    });

    it('death_apocalypse: flags + skeleton summon both emitted', () => {
        const session = newCombatEffectsSession();
        const def = ACTIVE.necromancer.find((s) => s.id === 'death_apocalypse')!;
        const r = effectsCastSkill({
            session,
            casterId: 'player',
            targetId: 'boss',
            targetHpPct: 100,
            effect: def.effect,
            allyIds: ['player'],
            enemyIds: ['boss'],
        });
        expect(r.deathApocalypse).toBe(true);
        expect(r.deathApocalypseTargetMaxHpPct).toBe(50);
        expect(r.deathApocalypseSelfHpFloor).toBe(0.20);
        expect(r.summons).toEqual([{ type: 'skeleton', count: 1 }]);
    });

    it('universe_song: 4-atom mega-buff propagates every component to every ally', () => {
        const session = newCombatEffectsSession();
        const def = ACTIVE.bard.find((s) => s.id === 'universe_song')!;
        effectsCastSkill({
            session,
            casterId: 'player',
            targetId: null,
            targetHpPct: 100,
            effect: def.effect,
            allyIds: ['player', 'bot1', 'bot2', 'bot3'],
            enemyIds: [],
        });
        for (const id of ['player', 'bot1', 'bot2', 'bot3']) {
            const st = session.statuses.get(id);
            expect(st?.immortalMs).toBe(3000);
            expect(st?.atkBuffPct).toBe(100);
            expect(st?.atkBuffMs).toBe(30000);
            expect(st?.asMult).toBe(2.2);
            expect(st?.asMultMs).toBe(10000);
            expect(st?.nextAllyInstantKillPct).toHaveLength(1);
            expect(st?.nextAllyInstantKillPct[0]).toMatchObject({ pct: 5, count: 5 });
        }
    });
});
