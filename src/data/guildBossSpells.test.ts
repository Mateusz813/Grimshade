/**
 * Tests for the guild-boss spell registry + resolvers.
 *
 * The registry holds:
 *   - A `SPELLS` map keyed by id (private — exercised through pick/cast).
 *   - A `TIER_KITS` map for tiers 1..50 (label, pool, cast interval,
 *     damage multiplier).
 *
 * Exposed resolvers:
 *   - getGuildBossKit          — clamp tier into [1..50], return kit.
 *   - pickGuildBossSpell       — random pick from the tier's pool.
 *   - computeBossSpellDamage   — floor(playerMaxHp * spell% * mult), min 1.
 *   - getBossCastIntervalMs    — interval / speed, floor 250.
 *   - getGuildBossLabel        — pass-through to kit.label.
 *
 * For pickGuildBossSpell we stub `Math.random` so the test is
 * deterministic — RNG seams in unit tests should always be mocked.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    getGuildBossKit,
    pickGuildBossSpell,
    computeBossSpellDamage,
    getBossCastIntervalMs,
    getGuildBossLabel,
} from './guildBossSpells';

// -- getGuildBossKit (clamp behaviour) ---------------------------------------

describe('getGuildBossKit', () => {
    it('returns the tier 1 kit for tier=1', () => {
        const kit = getGuildBossKit(1);
        expect(kit.label).toBe('Strażnik Lochu');
        expect(kit.castIntervalMs).toBe(3700);
        expect(kit.damageMult).toBeCloseTo(0.95);
        expect(kit.pool).toContain('cios');
    });

    it('returns the tier 50 kit for tier=50 (terminal)', () => {
        const kit = getGuildBossKit(50);
        expect(kit.label).toBe('Praboga Wszechświata');
        expect(kit.castIntervalMs).toBe(700);
    });

    it('clamps tiers below 1 to tier 1', () => {
        expect(getGuildBossKit(0)).toBe(getGuildBossKit(1));
        expect(getGuildBossKit(-5)).toBe(getGuildBossKit(1));
    });

    it('clamps tiers above 50 to tier 50', () => {
        expect(getGuildBossKit(51)).toBe(getGuildBossKit(50));
        expect(getGuildBossKit(9999)).toBe(getGuildBossKit(50));
    });

    it('floors fractional tiers', () => {
        // 5.9 floors to 5 — different kit than 6.
        expect(getGuildBossKit(5.9)).toBe(getGuildBossKit(5));
    });

    it('coerces NaN to tier 1 (safe fallback)', () => {
        expect(getGuildBossKit(NaN)).toBe(getGuildBossKit(1));
    });

    it('coerces Infinity to tier 1 (safeTier rejects non-finite first)', () => {
        // safeTier() short-circuits non-finite values to tier 1 BEFORE the
        // 1..50 clamp runs — that's intentional, an Infinity tier is a
        // bug upstream and we'd rather fall back than render the terminal
        // boss by accident.
        expect(getGuildBossKit(Infinity)).toBe(getGuildBossKit(1));
        expect(getGuildBossKit(-Infinity)).toBe(getGuildBossKit(1));
    });
});

// -- pickGuildBossSpell (deterministic via mocked RNG) -----------------------

describe('pickGuildBossSpell', () => {
    it('always picks a spell from the tier pool', () => {
        // Pool[0] is "cios" at tier 1; force Math.random=0 to land there.
        const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
        const spell = pickGuildBossSpell(1);
        expect(spell.id).toBe('cios');
        spy.mockRestore();
    });

    it('returns the LAST pool entry when Math.random is at the top edge', () => {
        // Math.random in real life is [0, 1) — we use 0.9999 to hit the
        // tail without going out of bounds.
        const spy = vi.spyOn(Math, 'random').mockReturnValue(0.9999);
        const spell = pickGuildBossSpell(1);
        // Tier 1 pool = ['cios', 'pozoga'] -> tail = 'pozoga'.
        expect(spell.id).toBe('pozoga');
        spy.mockRestore();
    });

    it('returns a fully populated spell object', () => {
        const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
        const spell = pickGuildBossSpell(5);
        expect(spell).toHaveProperty('id');
        expect(spell).toHaveProperty('name');
        expect(spell).toHaveProperty('kind');
        expect(spell).toHaveProperty('dmgPctOfPlayerMaxHp');
        expect(spell).toHaveProperty('color');
        expect(spell).toHaveProperty('icon');
        spy.mockRestore();
    });

    it('respects the clamped tier (tier=999 picks from tier-50 pool)', () => {
        const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
        const spell = pickGuildBossSpell(999);
        // Tier 50 pool starts with 'apokalipsaCienia'.
        expect(spell.id).toBe('apokalipsaCienia');
        spy.mockRestore();
    });
});

// -- computeBossSpellDamage --------------------------------------------------

describe('computeBossSpellDamage', () => {
    const spell = {
        id: 'pozoga',
        name: 'Pożoga',
        kind: 'fire' as const,
        dmgPctOfPlayerMaxHp: 0.045,
        color: '#ff5722',
        icon: 'fire',
    };

    it('computes floor(playerMaxHp * pct * tierMult)', () => {
        // Tier 1 damageMult = 0.95 -> 1000 * 0.045 * 0.95 = 42.75 -> floor = 42.
        expect(computeBossSpellDamage(spell, 1, 1000)).toBe(42);
    });

    it('returns a minimum of 1 even when the math rounds to 0', () => {
        // Tiny HP pool with a small spell — floor would be 0.
        expect(computeBossSpellDamage(spell, 1, 1)).toBe(1);
    });

    it('scales with tier (higher tier -> bigger hit)', () => {
        const lo = computeBossSpellDamage(spell, 1, 10_000);
        const hi = computeBossSpellDamage(spell, 10, 10_000);
        expect(hi).toBeGreaterThan(lo);
    });

    it('clamps unknown / out-of-range tiers via getGuildBossKit', () => {
        // Tier 0 collapses to tier 1.
        const t0 = computeBossSpellDamage(spell, 0, 1000);
        const t1 = computeBossSpellDamage(spell, 1, 1000);
        expect(t0).toBe(t1);
    });
});

// -- getBossCastIntervalMs ---------------------------------------------------

describe('getBossCastIntervalMs', () => {
    it('divides the kit interval by speedMult', () => {
        // Tier 1 baseline = 3700 ms.
        expect(getBossCastIntervalMs(1, 1)).toBe(3700);
        expect(getBossCastIntervalMs(1, 2)).toBe(1850);
        expect(getBossCastIntervalMs(1, 4)).toBe(925);
    });

    it('floors below 1× speed (defensive — never speeds the boss DOWN)', () => {
        // 0.5× speed would normally double the wait — the code clamps via
        // Math.max(1, speedMult) so the interval stays at baseline.
        expect(getBossCastIntervalMs(1, 0.5)).toBe(3700);
        expect(getBossCastIntervalMs(1, 0)).toBe(3700);
    });

    it('never drops below the 250ms floor (readability cap)', () => {
        // Even with extreme speed, the floor catches it.
        expect(getBossCastIntervalMs(50, 1000)).toBe(250);
    });

    it('clamps tier the same way getGuildBossKit does', () => {
        expect(getBossCastIntervalMs(0, 1)).toBe(getBossCastIntervalMs(1, 1));
        expect(getBossCastIntervalMs(9999, 1)).toBe(getBossCastIntervalMs(50, 1));
    });
});

// -- getGuildBossLabel -------------------------------------------------------

describe('getGuildBossLabel', () => {
    it('returns the documented tier-1 label', () => {
        expect(getGuildBossLabel(1)).toBe('Strażnik Lochu');
    });

    it('returns the documented tier-10 label', () => {
        expect(getGuildBossLabel(10)).toBe('Ostateczny Strażnik');
    });

    it('returns the documented tier-50 terminal label', () => {
        expect(getGuildBossLabel(50)).toBe('Praboga Wszechświata');
    });

    it('clamps below/above the supported range', () => {
        expect(getGuildBossLabel(0)).toBe(getGuildBossLabel(1));
        expect(getGuildBossLabel(99)).toBe(getGuildBossLabel(50));
    });
});
