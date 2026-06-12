import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    newCombatEffectsSession,
    ensureStatus,
    isCombatantStunned,
    tickAll,
    castSkill,
    resolveBasicAttack,
    routeDamage,
    routeHeal,
} from './combatEffectsHelpers';

// -- newCombatEffectsSession --------------------------------------------------

describe('newCombatEffectsSession', () => {
    it('returns a session with an empty status map', () => {
        const s = newCombatEffectsSession();
        expect(s.statuses).toBeInstanceOf(Map);
        expect(s.statuses.size).toBe(0);
    });

    it('returns a NEW map per call (isolated sessions)', () => {
        const a = newCombatEffectsSession();
        const b = newCombatEffectsSession();
        a.statuses.set('foo', { stunMs: 99 } as never);
        expect(b.statuses.size).toBe(0);
    });
});

// -- ensureStatus -------------------------------------------------------------

describe('ensureStatus', () => {
    let session: ReturnType<typeof newCombatEffectsSession>;

    beforeEach(() => {
        session = newCombatEffectsSession();
    });

    it('creates a fresh status state on first lookup', () => {
        const st = ensureStatus(session, 'mob-1');
        expect(st).toBeDefined();
        expect(st.stunMs).toBe(0);
        expect(st.immortalMs).toBe(0);
        expect(st.dots).toEqual([]);
        expect(session.statuses.size).toBe(1);
    });

    it('returns the same status object on subsequent lookups (no re-init)', () => {
        const first = ensureStatus(session, 'mob-1');
        first.stunMs = 1500;
        const second = ensureStatus(session, 'mob-1');
        expect(second).toBe(first);
        expect(second.stunMs).toBe(1500);
    });

    it('isolates state per combatant id', () => {
        const a = ensureStatus(session, 'mob-a');
        const b = ensureStatus(session, 'mob-b');
        a.stunMs = 999;
        expect(b.stunMs).toBe(0);
    });
});

// -- isCombatantStunned -------------------------------------------------------

describe('isCombatantStunned', () => {
    let session: ReturnType<typeof newCombatEffectsSession>;

    beforeEach(() => {
        session = newCombatEffectsSession();
    });

    it('returns false when the combatant has no status entry', () => {
        expect(isCombatantStunned(session, 'unknown')).toBe(false);
    });

    it('returns false when stunMs is 0', () => {
        ensureStatus(session, 'mob-1');
        expect(isCombatantStunned(session, 'mob-1')).toBe(false);
    });

    it('returns true when stunMs > 0', () => {
        const st = ensureStatus(session, 'mob-1');
        st.stunMs = 500;
        expect(isCombatantStunned(session, 'mob-1')).toBe(true);
    });

    it('does NOT lazily create a status (read-only check)', () => {
        isCombatantStunned(session, 'mob-x');
        expect(session.statuses.has('mob-x')).toBe(false);
    });
});

// -- tickAll ------------------------------------------------------------------

describe('tickAll', () => {
    let session: ReturnType<typeof newCombatEffectsSession>;

    beforeEach(() => {
        session = newCombatEffectsSession();
    });

    it('returns an empty list when no combatants have statuses', () => {
        const out = tickAll(session, [{ id: 'a', maxHp: 100 }], 1000);
        expect(out).toEqual([]);
    });

    it('skips combatants that have no registered status', () => {
        // Only combatant-a has a status entry; combatant-b is unknown.
        const stA = ensureStatus(session, 'a');
        stA.dots.push({ remainingMs: 5000, pctPerSec: 10 });
        const out = tickAll(
            session,
            [{ id: 'a', maxHp: 100 }, { id: 'b', maxHp: 100 }],
            1000,
        );
        expect(out.length).toBe(1);
        expect(out[0].id).toBe('a');
    });

    it('drains stun timers but does not emit a row when no DOT damage', () => {
        const st = ensureStatus(session, 'a');
        st.stunMs = 1000;
        const out = tickAll(session, [{ id: 'a', maxHp: 100 }], 500);
        expect(out).toEqual([]); // no DOT, no ritual -> no row
        expect(st.stunMs).toBe(500);
    });

    it('reports DOT damage when a DOT ticks', () => {
        const st = ensureStatus(session, 'a');
        // DOT spec: 10%/sec of max HP, run for 1 full second.
        st.dots.push({ remainingMs: 5000, pctPerSec: 10 });
        const out = tickAll(session, [{ id: 'a', maxHp: 100 }], 1000);
        expect(out).toHaveLength(1);
        expect(out[0].id).toBe('a');
        expect(out[0].dotDamage).toBeGreaterThan(0);
        expect(out[0].darkRitualTriggered).toBe(false);
    });

    it('reports dark ritual when its countdown expires this tick', () => {
        const st = ensureStatus(session, 'a');
        // 50% of max HP as flat damage when triggered.
        st.darkRitualPending.push({ triggerInMs: 1000, pctOfMaxHp: 50 });
        const out = tickAll(session, [{ id: 'a', maxHp: 200 }], 1000);
        expect(out).toHaveLength(1);
        expect(out[0].darkRitualTriggered).toBe(true);
        expect(out[0].darkRitualDamage).toBe(Math.floor(200 * 50 / 100));
    });

    it('handles multiple combatants in one tick', () => {
        const sa = ensureStatus(session, 'a');
        sa.dots.push({ remainingMs: 5000, pctPerSec: 10 });
        const sb = ensureStatus(session, 'b');
        sb.dots.push({ remainingMs: 5000, pctPerSec: 5 });
        const out = tickAll(
            session,
            [{ id: 'a', maxHp: 100 }, { id: 'b', maxHp: 100 }],
            1000,
        );
        expect(out.map((r) => r.id).sort()).toEqual(['a', 'b']);
    });
});

// -- castSkill ----------------------------------------------------------------

describe('castSkill', () => {
    let session: ReturnType<typeof newCombatEffectsSession>;

    beforeEach(() => {
        session = newCombatEffectsSession();
    });

    it('returns a blank result for null/undefined effect string', () => {
        const out = castSkill({
            session,
            casterId: 'p',
            targetId: 'm',
            targetHpPct: 100,
            effect: null,
            allyIds: ['p'],
            enemyIds: ['m'],
        });
        // No atoms -> blank() returns aoe=false / castDmgMult=1 / no special flags.
        expect(out.aoe).toBe(false);
        expect(out.castDmgMult).toBe(1);
        expect(out.instantKill).toBe(false);
        expect(out.multistrike).toBe(0);
    });

    it('returns a blank result for undefined effect', () => {
        const out = castSkill({
            session,
            casterId: 'p',
            targetId: 'm',
            targetHpPct: 100,
            effect: undefined,
            allyIds: ['p'],
            enemyIds: ['m'],
        });
        expect(out.aoe).toBe(false);
        expect(out.multistrike).toBe(0);
    });

    it('flags AOE casts', () => {
        const out = castSkill({
            session,
            casterId: 'p',
            targetId: 'm',
            targetHpPct: 100,
            effect: 'aoe',
            allyIds: ['p'],
            enemyIds: ['m'],
        });
        expect(out.aoe).toBe(true);
    });

    it('lazily creates caster + target statuses', () => {
        castSkill({
            session,
            casterId: 'p',
            targetId: 'm',
            targetHpPct: 100,
            effect: 'stun:3000',
            allyIds: ['p'],
            enemyIds: ['m'],
        });
        expect(session.statuses.has('p')).toBe(true);
        expect(session.statuses.has('m')).toBe(true);
    });

    it('handles null target for self-buff casts', () => {
        const out = castSkill({
            session,
            casterId: 'p',
            targetId: null,
            targetHpPct: 100,
            effect: 'attack_up:50:6000',
            allyIds: ['p'],
            enemyIds: [],
        });
        // Cast resolves without crashing on null target.
        expect(out).toBeDefined();
        const casterStatus = session.statuses.get('p')!;
        // attack_up writes atkBuffPct + atkBuffMs to the caster.
        expect(casterStatus.atkBuffPct).toBeGreaterThan(0);
    });

    it('initialises statuses for every ally and enemy id', () => {
        castSkill({
            session,
            casterId: 'p',
            targetId: null,
            targetHpPct: 100,
            effect: 'party_attack_up:50:5000',
            allyIds: ['p', 'bot1', 'bot2'],
            enemyIds: ['e1', 'e2'],
        });
        expect(session.statuses.has('p')).toBe(true);
        expect(session.statuses.has('bot1')).toBe(true);
        expect(session.statuses.has('bot2')).toBe(true);
        expect(session.statuses.has('e1')).toBe(true);
        expect(session.statuses.has('e2')).toBe(true);
    });

    it('propagates multistrike from the effect string', () => {
        const out = castSkill({
            session,
            casterId: 'p',
            targetId: 'm',
            targetHpPct: 100,
            effect: 'multistrike:3',
            allyIds: ['p'],
            enemyIds: ['m'],
        });
        expect(out.multistrike).toBe(3);
    });
});

// -- resolveBasicAttack -------------------------------------------------------

describe('resolveBasicAttack', () => {
    let session: ReturnType<typeof newCombatEffectsSession>;

    beforeEach(() => {
        session = newCombatEffectsSession();
    });

    it('returns base damage with no statuses (creates them lazily)', () => {
        const r = resolveBasicAttack({
            session,
            attackerId: 'p',
            attackerClass: 'Knight',
            targetId: 'm',
            baseDmg: 50,
        });
        // No buffs, no crits -> damage is just floor(50).
        expect(r.damage).toBe(50);
        expect(r.dodged).toBe(false);
        expect(r.wasCrit).toBe(false);
    });

    it('returns 0 damage and dodged=true when target has a non-magic dodge_next charge and attacker is non-magic', () => {
        // Force a dodge_next charge with scope=non_magic against a Knight.
        const targetStatus = ensureStatus(session, 'm');
        targetStatus.dodgeNext.push({ count: 1, scope: 'non_magic' });

        const r = resolveBasicAttack({
            session,
            attackerId: 'p',
            attackerClass: 'Knight',
            targetId: 'm',
            baseDmg: 100,
        });
        expect(r.dodged).toBe(true);
        expect(r.damage).toBe(0);
    });

    it('does NOT dodge magic attackers when scope=non_magic', () => {
        const targetStatus = ensureStatus(session, 'm');
        targetStatus.dodgeNext.push({ count: 1, scope: 'non_magic' });

        const r = resolveBasicAttack({
            session,
            attackerId: 'p',
            attackerClass: 'Mage',
            targetId: 'm',
            baseDmg: 100,
        });
        // Mage / Cleric / Necromancer skip the non_magic dodge.
        expect(r.dodged).toBe(false);
        expect(r.damage).toBe(100);
    });

    it('forces a crit when attacker has crit_next queue entry', () => {
        const attacker = ensureStatus(session, 'p');
        attacker.critNext.push({ mult: 3, count: 1 });

        const r = resolveBasicAttack({
            session,
            attackerId: 'p',
            attackerClass: 'Knight',
            targetId: 'm',
            baseDmg: 50,
        });
        expect(r.wasCrit).toBe(true);
        expect(r.critMult).toBe(3);
        expect(r.damage).toBe(150); // floor(50 * 3)
    });

    it('uses crit_buff_next with Math.random < threshold', () => {
        const attacker = ensureStatus(session, 'p');
        attacker.critBuffNext = 100; // 100% crit chance for next swing
        const rng = vi.spyOn(Math, 'random').mockReturnValue(0.5);
        try {
            const r = resolveBasicAttack({
                session,
                attackerId: 'p',
                attackerClass: 'Knight',
                targetId: 'm',
                baseDmg: 50,
            });
            expect(r.wasCrit).toBe(true);
            expect(r.damage).toBe(100); // floor(50 * 2)
        } finally {
            rng.mockRestore();
        }
        // critBuffNext consumed.
        expect(attacker.critBuffNext).toBe(0);
    });
});

// -- routeDamage --------------------------------------------------------------

describe('routeDamage', () => {
    let session: ReturnType<typeof newCombatEffectsSession>;

    beforeEach(() => {
        session = newCombatEffectsSession();
    });

    it('passes through raw damage when target is mortal and not immortal', () => {
        const r = routeDamage(session, 'm', 100, 30);
        expect(r.appliedDmg).toBe(30);
        expect(r.absorbed).toBe(false);
    });

    it('absorbs damage when immortal is active', () => {
        const st = ensureStatus(session, 'm');
        st.immortalMs = 5000;
        const r = routeDamage(session, 'm', 100, 999);
        // Note: routeDamage returns -hpDelta, and hpDelta is 0 when absorbed,
        // so appliedDmg is -0 in JS — use loose numeric comparison.
        expect(r.appliedDmg).toBe(-0);
        expect(Math.abs(r.appliedDmg)).toBe(0);
        expect(r.absorbed).toBe(true);
    });

    it('clamps to HP-1 when cannotDie is active and damage would kill', () => {
        const st = ensureStatus(session, 'm');
        st.cannotDieMs = 5000;
        const r = routeDamage(session, 'm', 50, 500);
        // applyIncomingDamage clamps so HP cannot drop below 1.
        // appliedDmg = -hpDelta = currentHp - 1 = 49.
        expect(r.appliedDmg).toBe(49);
        expect(r.absorbed).toBe(false);
    });

    it('does NOT clamp when cannotDie is active but HP stays > 1 after hit', () => {
        const st = ensureStatus(session, 'm');
        st.cannotDieMs = 5000;
        const r = routeDamage(session, 'm', 100, 30);
        expect(r.appliedDmg).toBe(30);
        expect(r.absorbed).toBe(false);
    });

    it('handles 0 damage cleanly', () => {
        const r = routeDamage(session, 'm', 100, 0);
        expect(r.appliedDmg).toBe(0);
        expect(r.absorbed).toBe(false);
    });
});

// -- routeHeal ----------------------------------------------------------------

describe('routeHeal', () => {
    let session: ReturnType<typeof newCombatEffectsSession>;

    beforeEach(() => {
        session = newCombatEffectsSession();
    });

    it('passes through positive heals on a clean target', () => {
        const r = routeHeal(session, 'm', 250);
        expect(r.delta).toBe(250);
    });

    it('returns 0 when target has enemy_no_heal active', () => {
        const st = ensureStatus(session, 'm');
        st.enemyNoHealMs = 5000;
        const r = routeHeal(session, 'm', 250);
        expect(r.delta).toBe(0);
    });

    it('flips heal into damage when mark_no_heal is active', () => {
        const st = ensureStatus(session, 'm');
        st.markNoHealMs = 5000;
        const r = routeHeal(session, 'm', 250);
        expect(r.delta).toBe(-250);
    });

    it('handles 0 heal cleanly', () => {
        const r = routeHeal(session, 'm', 0);
        expect(r.delta).toBe(0);
    });

    it('lazily initialises the target status', () => {
        routeHeal(session, 'mob-new', 100);
        expect(session.statuses.has('mob-new')).toBe(true);
    });
});
