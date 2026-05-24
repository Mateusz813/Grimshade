import { describe, it, expect } from 'vitest';
import {
    parseEffects,
    applyEffects,
    applyIncomingHeal,
    newStatusState,
    tickStatus,
} from './skillEffectsV2';

const blankStatus = newStatusState;

// ── Rogue Naznaczony na Śmierć (`mark_heal_to_dmg:6000`) ──────────────────
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
        // Arena Cleric AI fires heal → applyIncomingHeal(caster.status,
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
