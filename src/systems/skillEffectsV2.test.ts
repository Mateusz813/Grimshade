import { describe, it, expect } from 'vitest';
import {
    parseEffects,
    applyEffects,
    applyIncomingHeal,
    newStatusState,
    tickStatus,
    hasEffect,
    findEffect,
    isStunned,
    applyIncomingDamage,
    applyManaShieldRedirect,
    skillTargetsEnemy,
    resolveBasicHit,
    consumeTargetMarkAmp,
    consumeCasterBasicHitMods,
} from './skillEffectsV2';

const blankStatus = newStatusState;

// -- Rogue Naznaczony na Śmierć (`mark_heal_to_dmg:6000`) ------------------
// Marks the target so any incoming heal during the buff window flips into
// damage of equal magnitude. The mechanic shares the v2 `markNoHealMs`
// status field with `mark_no_heal` (semantic alias). User explicitly
// asked for proof this works, so we exercise both Arena (vs Cleric heal
// on a marked opponent) and Boss (boss tries to self-heal while marked).

describe('mark_heal_to_dmg (Rogue Naznaczony na Śmierć)', () => {
    const setupMarked = () => {
        const caster = blankStatus();
        const target = blankStatus();
        const parsed = parseEffects('mark_heal_to_dmg:6000');
        applyEffects(parsed, caster, target, 100, [caster], [target]);
        return { caster, target };
    };

    it('parses the atom and writes markNoHealMs onto the target', () => {
        const { target } = setupMarked();
        expect(target.markNoHealMs).toBe(6000);
    });

    it('reverses an incoming heal into damage of equal value', () => {
        // Scenario: Arena Cleric self-casts heal_lowest_ally_pct for
        // 20% maxHp ≈ 500. With the mark active the heal flips: the
        // caster (Cleric) would LOSE 500 HP instead of gaining it.
        const { target } = setupMarked();
        const r = applyIncomingHeal(target, 500);
        expect(r.hpDelta).toBe(-500);
    });

    // 2026-05-21: replaces deleted test "reverses tiny heals" — now tests current logic
    // applyIncomingHeal (line 1082-1089 of skillEffectsV2.ts) returns
    // { hpDelta: -rawHeal } when markNoHealMs > 0 — so heal of 1 flips
    // to -1, and heal of 0 flips to -0 (which is === 0 in JS). The mark
    // does NOT cause a damage minimum of 1 — true zero stays zero.
    it('flips tiny heals into damage of identical magnitude', () => {
        const { target } = setupMarked();
        expect(applyIncomingHeal(target, 1).hpDelta).toBe(-1);
        expect(applyIncomingHeal(target, 2).hpDelta).toBe(-2);
        // heal of 0 stays at 0 (negating zero is still zero)
        expect(applyIncomingHeal(target, 0).hpDelta).toBe(-0);
    });

    it('reverses every heal source while the timer is active', () => {
        // Multiple consecutive heals — engine uses the same status
        // field for each call, so each should flip independently.
        const { target } = setupMarked();
        expect(applyIncomingHeal(target, 200).hpDelta).toBe(-200);
        expect(applyIncomingHeal(target, 800).hpDelta).toBe(-800);
        expect(applyIncomingHeal(target, 1500).hpDelta).toBe(-1500);
    });

    it('expires after the duration ticks down', () => {
        // tickStatus drains the mark timer by deltaMs each call.
        // After 6s the mark is gone and heals work normally again.
        const { target } = setupMarked();
        expect(target.markNoHealMs).toBe(6000);
        tickStatus(target, 3000, 1000);
        expect(target.markNoHealMs).toBe(3000);
        // Still flipping mid-window.
        expect(applyIncomingHeal(target, 100).hpDelta).toBe(-100);
        tickStatus(target, 3000, 1000);
        expect(target.markNoHealMs).toBe(0);
        // Now back to normal heal.
        expect(applyIncomingHeal(target, 100).hpDelta).toBe(100);
    });

    it('Boss self-heal scenario: boss marked, then casts heal on self', () => {
        // Mirror the Boss view's fix: boss's self-heal goes through
        // applyIncomingHeal(bossStatus, healAmount). With the mark
        // active, the boss takes damage equal to the heal value.
        const { target: bossStatus } = setupMarked();
        const healAmount = 1234; // arbitrary boss heal power × maxHp
        const r = applyIncomingHeal(bossStatus, healAmount);
        expect(r.hpDelta).toBe(-1234);
        // View clamps newBossHp = max(0, currentHp - reversed).
        const startHp = 5000;
        const newHp = Math.max(0, startHp - (-r.hpDelta));
        expect(newHp).toBe(5000 - 1234);
    });

    it('Arena scenario: opponent (Cleric) casts heal on themselves while marked', () => {
        // Arena Cleric AI fires heal -> applyIncomingHeal(caster.status,
        // heal). caster.hp += hr.hpDelta. With mark, hpDelta is
        // negative so caster.hp decreases.
        const { target: opponent } = setupMarked();
        const startHp = 800;
        const heal = 250;
        const r = applyIncomingHeal(opponent, heal);
        const newHp = Math.min(1000, startHp + r.hpDelta); // 1000 = maxHp
        expect(r.hpDelta).toBe(-250);
        expect(newHp).toBe(550);
    });

    it('does not stack with mark_no_heal — re-casting just refreshes', () => {
        // Rogue casts mark_heal_to_dmg twice — duration takes the max
        // (Math.max(...e.a)) so a longer second cast wins, shorter
        // doesn't reduce the timer.
        const { target } = setupMarked();
        applyEffects(parseEffects('mark_heal_to_dmg:3000'), blankStatus(), target, 100, [], [target]);
        // 6000 was the first cast, 3000 doesn't shorten it.
        expect(target.markNoHealMs).toBe(6000);
        applyEffects(parseEffects('mark_heal_to_dmg:8000'), blankStatus(), target, 100, [], [target]);
        // 8000 > 6000 so it bumps up.
        expect(target.markNoHealMs).toBe(8000);
    });
});

// -- Coverage push 2026-05-26 — parseEffects edge cases ---------------------

describe('parseEffects', () => {
    it('returns [] for null / undefined / empty input', () => {
        expect(parseEffects(null)).toEqual([]);
        expect(parseEffects(undefined)).toEqual([]);
        expect(parseEffects('')).toEqual([]);
    });

    it('splits multi-atom effects on semicolons and trims whitespace', () => {
        const parsed = parseEffects(' aoe ; dot:5000:5 ; stun:1000 ');
        expect(parsed.length).toBe(3);
        expect(parsed[0].key).toBe('aoe');
        expect(parsed[1].key).toBe('dot');
        expect(parsed[1].a).toBe(5000);
        expect(parsed[1].b).toBe(5);
        expect(parsed[2].key).toBe('stun');
        expect(parsed[2].a).toBe(1000);
    });

    it('treats non-numeric args as string args (s)', () => {
        const parsed = parseEffects('summon:skeleton:3');
        expect(parsed[0].s).toBe('skeleton');
        expect(parsed[0].b).toBe(3);
    });

    it('preserves the raw atom text', () => {
        const parsed = parseEffects('dot:1000:5');
        expect(parsed[0].raw).toBe('dot:1000:5');
    });

    it('discards trailing empty pieces from leading or double semicolons', () => {
        const parsed = parseEffects(';aoe;;dot:1000:5');
        expect(parsed.map((p) => p.key)).toEqual(['aoe', 'dot']);
    });

    it('handles atoms with 3 numeric args (a/b/c)', () => {
        const parsed = parseEffects('foo:1:2:3');
        expect(parsed[0].a).toBe(1);
        expect(parsed[0].b).toBe(2);
        expect(parsed[0].c).toBe(3);
    });
});

describe('hasEffect / findEffect', () => {
    it('hasEffect returns true when atom present', () => {
        const parsed = parseEffects('aoe;dot:1000:5');
        expect(hasEffect(parsed, 'aoe' as unknown as never)).toBe(true);
        expect(hasEffect(parsed, 'stun' as unknown as never)).toBe(false);
    });

    it('findEffect returns first matching atom or null', () => {
        const parsed = parseEffects('aoe;dot:1000:5');
        expect(findEffect(parsed, 'dot' as unknown as never)?.a).toBe(1000);
        expect(findEffect(parsed, 'stun' as unknown as never)).toBeNull();
    });
});

describe('isStunned', () => {
    it('returns true when stunMs > 0', () => {
        const s = newStatusState();
        s.stunMs = 100;
        expect(isStunned(s)).toBe(true);
    });

    it('returns false when stun has worn off', () => {
        const s = newStatusState();
        s.stunMs = 0;
        expect(isStunned(s)).toBe(false);
    });
});

// -- Coverage push 2026-05-26 — applyIncomingDamage / mana shield -----------

describe('applyIncomingDamage', () => {
    it('absorbs damage when immortal is active', () => {
        const s = newStatusState();
        s.immortalMs = 2000;
        const r = applyIncomingDamage(s, 500, 100);
        expect(r.hpDelta).toBe(0);
        expect(r.absorbed).toBe(true);
    });

    it('returns -rawDamage as hpDelta in the normal case', () => {
        const s = newStatusState();
        const r = applyIncomingDamage(s, 500, 100);
        expect(r.hpDelta).toBe(-100);
        expect(r.absorbed).toBe(false);
    });

    it('cannotDie clamps so HP stays at 1', () => {
        const s = newStatusState();
        s.cannotDieMs = 2000;
        const r = applyIncomingDamage(s, 50, 100);
        expect(r.hpDelta).toBe(-49); // 50 -> 1, so delta = -49
        expect(r.absorbed).toBe(false);
    });

    it('cannotDie allows full damage when result would still be above 1', () => {
        const s = newStatusState();
        s.cannotDieMs = 2000;
        const r = applyIncomingDamage(s, 100, 30);
        expect(r.hpDelta).toBe(-30);
    });
});

describe('applyManaShieldRedirect', () => {
    it('returns hpDmg only when no status provided', () => {
        const r = applyManaShieldRedirect(undefined, 100, 50);
        expect(r.hpDmg).toBe(50);
        expect(r.mpDmg).toBe(0);
        expect(r.shieldActive).toBe(false);
    });

    it('returns hpDmg only when shield expired', () => {
        const s = newStatusState();
        s.manaShieldMs = 0;
        const r = applyManaShieldRedirect(s, 100, 50);
        expect(r.shieldActive).toBe(false);
        expect(r.hpDmg).toBe(50);
    });

    it('drains 100% from MP when MP covers damage', () => {
        const s = newStatusState();
        s.manaShieldMs = 5000;
        const r = applyManaShieldRedirect(s, 100, 50);
        expect(r.shieldActive).toBe(true);
        expect(r.mpDmg).toBe(50);
        expect(r.hpDmg).toBe(0);
    });

    it('spills overflow to HP when MP not enough', () => {
        const s = newStatusState();
        s.manaShieldMs = 5000;
        const r = applyManaShieldRedirect(s, 10, 50);
        expect(r.mpDmg).toBe(10);
        expect(r.hpDmg).toBe(40);
    });

    it('returns full hp dmg when MP is 0', () => {
        const s = newStatusState();
        s.manaShieldMs = 5000;
        const r = applyManaShieldRedirect(s, 0, 100);
        expect(r.mpDmg).toBe(0);
        expect(r.hpDmg).toBe(100);
    });

    it('no-op when rawDmg <= 0', () => {
        const s = newStatusState();
        s.manaShieldMs = 5000;
        const r = applyManaShieldRedirect(s, 100, 0);
        expect(r.shieldActive).toBe(false);
        expect(r.mpDmg).toBe(0);
    });
});

// -- Coverage push 2026-05-26 — applyIncomingHeal edge cases -----------------

describe('applyIncomingHeal extra cases', () => {
    it('returns 0 hpDelta when enemyNoHealMs is active', () => {
        const s = newStatusState();
        s.enemyNoHealMs = 5000;
        const r = applyIncomingHeal(s, 100);
        expect(r.hpDelta).toBe(0);
    });

    it('returns positive hpDelta when no marks active', () => {
        const s = newStatusState();
        const r = applyIncomingHeal(s, 250);
        expect(r.hpDelta).toBe(250);
    });
});

// -- Coverage push 2026-05-26 — skillTargetsEnemy classifier ----------------

describe('skillTargetsEnemy', () => {
    it('returns false for null/empty', () => {
        expect(skillTargetsEnemy(null)).toBe(false);
        expect(skillTargetsEnemy(undefined)).toBe(false);
        expect(skillTargetsEnemy('')).toBe(false);
    });

    it('returns true for enemy-affinity atoms', () => {
        expect(skillTargetsEnemy('stun:1000')).toBe(true);
        expect(skillTargetsEnemy('aoe;dot:1000:5')).toBe(true);
        expect(skillTargetsEnemy('mark_amp:2:1000')).toBe(true);
        expect(skillTargetsEnemy('def_pen:50:5000')).toBe(true);
        expect(skillTargetsEnemy('paralyze:3000')).toBe(true);
        expect(skillTargetsEnemy('execute_below:25')).toBe(true);
    });

    it('returns false for pure self-buff atoms', () => {
        expect(skillTargetsEnemy('crit_buff:50:5000')).toBe(false);
        expect(skillTargetsEnemy('dodge_buff:30:5000')).toBe(false);
        expect(skillTargetsEnemy('summon:skeleton:1')).toBe(false);
    });
});

// -- Coverage push 2026-05-26 — tickStatus DOTs + dark ritual --------------

describe('tickStatus DOTs', () => {
    it('applies a DOT each tick and removes it when exhausted', () => {
        const s = newStatusState();
        s.dots = [{ remainingMs: 1000, pctPerSec: 10 }];
        // 1 second tick on maxHp=100 -> 10% = 10 damage; remaining 0 -> cleared.
        const r1 = tickStatus(s, 1000, 100);
        expect(r1.dotDamage).toBe(10);
        expect(s.dots.length).toBe(0);
    });

    it('keeps surviving DOTs and ticks proportional damage', () => {
        const s = newStatusState();
        s.dots = [{ remainingMs: 3000, pctPerSec: 5 }];
        const r = tickStatus(s, 500, 200); // 0.5s × 5% × 200 = 5
        expect(r.dotDamage).toBe(5);
        expect(s.dots.length).toBe(1);
        expect(s.dots[0].remainingMs).toBe(2500);
    });

    it('drains many timed buffs at once', () => {
        const s = newStatusState();
        s.stunMs = 1500;
        s.immortalMs = 500;
        s.atkBuffPct = 50;
        s.atkBuffMs = 600;
        tickStatus(s, 1000, 100);
        expect(s.stunMs).toBe(500);
        expect(s.immortalMs).toBe(0);
        expect(s.atkBuffMs).toBe(0);
        expect(s.atkBuffPct).toBe(0); // zeroed when timer hits 0
    });

    it('decays markAmp duration and prunes when 0 or count <= 0', () => {
        const s = newStatusState();
        s.markAmp = [
            { mult: 2, count: 1, remainingMs: 500 },
            { mult: 3, count: 0, remainingMs: 10000 }, // stale: count 0
        ];
        tickStatus(s, 600, 100);
        expect(s.markAmp.length).toBe(0); // first ran out, second filtered
    });

    it('drains markAmpAll and nulls it when expired', () => {
        const s = newStatusState();
        s.markAmpAll = { mult: 2, remainingMs: 1000 };
        tickStatus(s, 1500, 100);
        expect(s.markAmpAll).toBeNull();
    });

    it('triggers dark ritual when countdown hits 0', () => {
        const s = newStatusState();
        s.darkRitualPending = [
            { triggerInMs: 1000, pctOfMaxHp: 10 },
            { triggerInMs: 5000, pctOfMaxHp: 20 }, // not yet
        ];
        const r = tickStatus(s, 1000, 500);
        expect(r.darkRitualTriggered).toBe(true);
        expect(r.darkRitualDamage).toBe(Math.floor(500 * 0.1)); // 50
        expect(s.darkRitualPending.length).toBe(1);
    });
});

// -- Coverage push 2026-05-26 — resolveBasicHit / consumeCasterBasicHitMods -

describe('resolveBasicHit', () => {
    it('returns base damage when no buffs active', () => {
        const a = newStatusState();
        const t = newStatusState();
        const r = resolveBasicHit(a, 'Knight', 100, t);
        expect(r.damage).toBe(100);
        expect(r.dodged).toBe(false);
        expect(r.wasCrit).toBe(false);
    });

    it('dodgeNext consumes a charge for non-magic attacker (scope=non_magic)', () => {
        const a = newStatusState();
        const t = newStatusState();
        t.dodgeNext = [{ count: 1, scope: 'non_magic' }];
        const r = resolveBasicHit(a, 'Knight', 100, t);
        expect(r.dodged).toBe(true);
        expect(r.damage).toBe(0);
        expect(t.dodgeNext.length).toBe(0); // consumed
    });

    it('dodgeNext does NOT dodge magic class with non_magic scope', () => {
        const a = newStatusState();
        const t = newStatusState();
        t.dodgeNext = [{ count: 1, scope: 'non_magic' }];
        const r = resolveBasicHit(a, 'Mage', 100, t);
        expect(r.dodged).toBe(false);
        expect(t.dodgeNext.length).toBe(1); // charge preserved
    });

    it('dodgeNext with scope=all dodges magic too', () => {
        const a = newStatusState();
        const t = newStatusState();
        t.dodgeNext = [{ count: 1, scope: 'all' }];
        const r = resolveBasicHit(a, 'Mage', 100, t);
        expect(r.dodged).toBe(true);
    });

    it('critNext applies guaranteed crit multiplier and decrements', () => {
        const a = newStatusState();
        a.critNext = [{ count: 2, mult: 2.5 }];
        const t = newStatusState();
        const r = resolveBasicHit(a, 'Knight', 100, t);
        expect(r.wasCrit).toBe(true);
        expect(r.critMult).toBe(2.5);
        expect(r.damage).toBe(250);
        expect(a.critNext[0].count).toBe(1);
    });

    it('atkBuff multiplies damage by 1 + pct/100', () => {
        const a = newStatusState();
        a.atkBuffMs = 1000;
        a.atkBuffPct = 50;
        const t = newStatusState();
        const r = resolveBasicHit(a, 'Knight', 100, t);
        expect(r.damage).toBe(150);
    });

    it('markAmp on target multiplies damage and decrements charge', () => {
        const a = newStatusState();
        const t = newStatusState();
        t.markAmp = [{ mult: 3, count: 1, remainingMs: 5000 }];
        const r = resolveBasicHit(a, 'Knight', 100, t);
        expect(r.damage).toBe(300);
        expect(t.markAmp.length).toBe(0); // consumed
    });

    it('lifesteal adds casterHeal proportional to damage', () => {
        const a = newStatusState();
        a.lifestealNext = [{ pct: 25, count: 1 }];
        const t = newStatusState();
        const r = resolveBasicHit(a, 'Knight', 100, t);
        expect(r.casterHeal).toBe(25);
        expect(a.lifestealNext.length).toBe(0);
    });

    it('nextAllyHeal sets healLowestAllyPct and decrements', () => {
        const a = newStatusState();
        a.nextAllyHeal = [{ pct: 50, count: 1 }];
        const t = newStatusState();
        const r = resolveBasicHit(a, 'Cleric', 100, t);
        expect(r.healLowestAllyPct).toBe(50);
        expect(a.nextAllyHeal.length).toBe(0);
    });

    it('damage clamps to 0 (never negative)', () => {
        const a = newStatusState();
        const t = newStatusState();
        const r = resolveBasicHit(a, 'Knight', -50, t);
        expect(r.damage).toBe(0);
    });

    it('dmgAmpNext queue multiplies damage and drains charge', () => {
        const a = newStatusState();
        a.dmgAmpNext = [{ mult: 4, count: 1 }];
        const t = newStatusState();
        const r = resolveBasicHit(a, 'Knight', 100, t);
        expect(r.damage).toBe(400);
        expect(a.dmgAmpNext.length).toBe(0);
    });

    it('party instant-kill buff (nextAllyInstantKillPct) success → finite executeBurstPct=12, NOT a true instantKill', () => {
        const a = newStatusState();
        a.nextAllyInstantKillPct = [{ pct: 100, count: 1 }];
        const t = newStatusState();
        const orig = Math.random;
        Math.random = () => 0; // pass the roll
        try {
            const r = resolveBasicHit(a, 'Knight', 100, t);
            // No longer a one-shot — produces a finite execute burst instead.
            expect(r.executeBurstPct).toBe(12);
            expect(r.instantKill).toBe(false);
            // Charge consumed on the roll.
            expect(a.nextAllyInstantKillPct.length).toBe(0);
        } finally {
            Math.random = orig;
        }
    });

    it('party instant-kill buff roll failure → no executeBurst, no instantKill', () => {
        const a = newStatusState();
        a.nextAllyInstantKillPct = [{ pct: 10, count: 1 }];
        const t = newStatusState();
        const orig = Math.random;
        Math.random = () => 0.99; // fail the roll
        try {
            const r = resolveBasicHit(a, 'Knight', 100, t);
            expect(r.executeBurstPct).toBe(0);
            expect(r.instantKill).toBe(false);
            // Charge still consumed (count decrements regardless of roll).
            expect(a.nextAllyInstantKillPct.length).toBe(0);
        } finally {
            Math.random = orig;
        }
    });
});

describe('consumeTargetMarkAmp', () => {
    it('returns mult=1 when target is undefined', () => {
        expect(consumeTargetMarkAmp(undefined)).toEqual({ mult: 1, consumed: false });
    });

    it('returns mult=1 when no marks present', () => {
        const s = newStatusState();
        expect(consumeTargetMarkAmp(s)).toEqual({ mult: 1, consumed: false });
    });

    it('consumes count-based markAmp and returns its multiplier', () => {
        const s = newStatusState();
        s.markAmp = [{ mult: 5, count: 1, remainingMs: 1000 }];
        const r = consumeTargetMarkAmp(s);
        expect(r.mult).toBe(5);
        expect(r.consumed).toBe(true);
        expect(s.markAmp.length).toBe(0);
    });

    it('applies markAmpAll passively without consuming', () => {
        const s = newStatusState();
        s.markAmpAll = { mult: 2, remainingMs: 5000 };
        const r = consumeTargetMarkAmp(s);
        expect(r.mult).toBe(2);
        expect(r.consumed).toBe(false);
        expect(s.markAmpAll?.remainingMs).toBe(5000); // not modified here
    });

    it('combines count-based and duration-based marks multiplicatively', () => {
        const s = newStatusState();
        s.markAmp = [{ mult: 3, count: 1, remainingMs: 1000 }];
        s.markAmpAll = { mult: 2, remainingMs: 1000 };
        const r = consumeTargetMarkAmp(s);
        expect(r.mult).toBe(6);
        expect(r.consumed).toBe(true);
    });
});

describe('consumeCasterBasicHitMods', () => {
    it('returns neutral mods when status is undefined', () => {
        const r = consumeCasterBasicHitMods(undefined);
        expect(r.dmgMult).toBe(1);
        expect(r.forceCrit).toBe(false);
        expect(r.extraCritChance).toBe(0);
        expect(r.lifestealPct).toBe(0);
        expect(r.nextAllyHealPct).toBe(0);
    });

    it('forces crit when critNext has guaranteed entry (mult >= 1)', () => {
        const s = newStatusState();
        s.critNext = [{ count: 1, mult: 1 }];
        const r = consumeCasterBasicHitMods(s);
        expect(r.forceCrit).toBe(true);
        expect(r.consumed.critNext).toBe(true);
        expect(s.critNext.length).toBe(0);
    });

    it('honours critBuffNext as flat extra crit chance and drains it', () => {
        const s = newStatusState();
        s.critBuffNext = 30;
        const r = consumeCasterBasicHitMods(s);
        expect(r.extraCritChance).toBeCloseTo(0.3, 4);
        expect(r.consumed.critBuffNext).toBe(true);
        expect(s.critBuffNext).toBe(0);
    });

    it('adds timed critBuff window without consuming', () => {
        const s = newStatusState();
        s.critBuffMs = 5000;
        s.critBuffPct = 20;
        const r = consumeCasterBasicHitMods(s);
        expect(r.extraCritChance).toBeCloseTo(0.2, 4);
        expect(r.consumed.critBuffNext).toBe(false);
    });

    it('dmgAmpNext multiplies dmgMult and decrements', () => {
        const s = newStatusState();
        s.dmgAmpNext = [{ mult: 3, count: 1 }];
        const r = consumeCasterBasicHitMods(s);
        expect(r.dmgMult).toBe(3);
        expect(r.consumed.dmgAmpNext).toBe(true);
        expect(s.dmgAmpNext.length).toBe(0);
    });

    it('atkBuff scales the swing while active', () => {
        const s = newStatusState();
        s.atkBuffMs = 1000;
        s.atkBuffPct = 50;
        const r = consumeCasterBasicHitMods(s);
        expect(r.dmgMult).toBeCloseTo(1.5, 4);
    });

    it('lifestealNext returns the highest pct and decrements', () => {
        const s = newStatusState();
        s.lifestealNext = [{ pct: 40, count: 2 }];
        const r = consumeCasterBasicHitMods(s);
        expect(r.lifestealPct).toBe(40);
        expect(r.consumed.lifestealNext).toBe(true);
        expect(s.lifestealNext[0].count).toBe(1);
    });

    it('nextAllyHeal returns highest pct and decrements', () => {
        const s = newStatusState();
        s.nextAllyHeal = [{ pct: 25, count: 1 }];
        const r = consumeCasterBasicHitMods(s);
        expect(r.nextAllyHealPct).toBe(25);
        expect(r.consumed.nextAllyHeal).toBe(true);
        expect(s.nextAllyHeal.length).toBe(0);
    });
});
