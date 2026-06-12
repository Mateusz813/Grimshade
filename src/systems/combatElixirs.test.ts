import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getAtkDamageMultiplier,
    getSpellDamageMultiplier,
    getElixirHpBonus,
    getElixirMpBonus,
    getElixirHpPctMultiplier,
    getElixirMpPctMultiplier,
    getElixirAtkBonus,
    getElixirDefBonus,
    getElixirAttackSpeedMultiplier,
    tickCombatElixirs,
} from './combatElixirs';
import { useBuffStore } from '../stores/buffStore';
import { useCharacterStore } from '../stores/characterStore';
import type { ICharacter } from '../api/v1/characterApi';

// -- Helpers ------------------------------------------------------------------

const CHAR_ID = 'char-elixir-test';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: CHAR_ID,
    user_id: 'user-1',
    name: 'Test',
    class: 'Knight',
    level: 10,
    xp: 0,
    hp: 100,
    max_hp: 100,
    mp: 50,
    max_mp: 50,
    attack: 20,
    defense: 10,
    attack_speed: 2.0,
    crit_chance: 5,
    crit_damage: 200,
    magic_level: 0,
    hp_regen: 0,
    mp_regen: 0,
    gold: 0,
    stat_points: 0,
    highest_level: 10,
    equipment: {},
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
});

/** Push a pausable buff straight onto buffStore for the active character. */
const seedPausable = (effect: string, remainingMs: number = 60_000): void => {
    useBuffStore.setState((s) => ({
        allBuffs: [
            ...s.allBuffs,
            {
                id: `seed_${effect}`,
                characterId: CHAR_ID,
                name: effect,
                icon: 'sparkles',
                effect,
                expiresAt: Number.POSITIVE_INFINITY,
                timerMode: 'pausable',
                remainingMs,
            },
        ],
    }));
};

beforeEach(() => {
    // Reset stores cleanly so buffs from previous tests don't leak.
    useBuffStore.setState({ allBuffs: [], combatSpeedMult: 1 });
    useCharacterStore.setState({ character: makeChar(), isLoading: false });
});

// -- getAtkDamageMultiplier ---------------------------------------------------

describe('getAtkDamageMultiplier', () => {
    it('returns 1.0 when no ATK damage buff is active', () => {
        expect(getAtkDamageMultiplier()).toBe(1.0);
    });

    it('returns 2.0 for atk_dmg_100', () => {
        seedPausable('atk_dmg_100');
        expect(getAtkDamageMultiplier()).toBe(2.0);
    });

    it('returns 1.5 for atk_dmg_50', () => {
        seedPausable('atk_dmg_50');
        expect(getAtkDamageMultiplier()).toBe(1.5);
    });

    it('returns 1.25 for atk_dmg_25', () => {
        seedPausable('atk_dmg_25');
        expect(getAtkDamageMultiplier()).toBe(1.25);
    });

    it('picks the highest tier when multiple tiers are active', () => {
        // All three tiers active -> +100% must win per the if-else cascade.
        seedPausable('atk_dmg_25');
        seedPausable('atk_dmg_50');
        seedPausable('atk_dmg_100');
        expect(getAtkDamageMultiplier()).toBe(2.0);
    });

    it('falls back to next tier when the strongest one is gone', () => {
        seedPausable('atk_dmg_25');
        seedPausable('atk_dmg_50');
        expect(getAtkDamageMultiplier()).toBe(1.5);
    });
});

// -- getSpellDamageMultiplier -------------------------------------------------

describe('getSpellDamageMultiplier', () => {
    it('returns 1.0 with no buff', () => {
        expect(getSpellDamageMultiplier()).toBe(1.0);
    });

    it('returns 2.0 for spell_dmg_100', () => {
        seedPausable('spell_dmg_100');
        expect(getSpellDamageMultiplier()).toBe(2.0);
    });

    it('returns 1.5 for spell_dmg_50', () => {
        seedPausable('spell_dmg_50');
        expect(getSpellDamageMultiplier()).toBe(1.5);
    });

    it('returns 1.25 for spell_dmg_25', () => {
        seedPausable('spell_dmg_25');
        expect(getSpellDamageMultiplier()).toBe(1.25);
    });

    it('highest tier wins when all three are active', () => {
        seedPausable('spell_dmg_25');
        seedPausable('spell_dmg_50');
        seedPausable('spell_dmg_100');
        expect(getSpellDamageMultiplier()).toBe(2.0);
    });
});

// -- Flat bonuses -------------------------------------------------------------

describe('getElixirHpBonus', () => {
    it('returns 0 when no hp_boost_500 buff', () => {
        expect(getElixirHpBonus()).toBe(0);
    });

    it('returns 500 when hp_boost_500 is active', () => {
        seedPausable('hp_boost_500');
        expect(getElixirHpBonus()).toBe(500);
    });

    it('returns 0 when an unrelated buff is active', () => {
        seedPausable('atk_dmg_100');
        expect(getElixirHpBonus()).toBe(0);
    });
});

describe('getElixirMpBonus', () => {
    it('returns 0 with no buff', () => {
        expect(getElixirMpBonus()).toBe(0);
    });

    it('returns 500 with mp_boost_500', () => {
        seedPausable('mp_boost_500');
        expect(getElixirMpBonus()).toBe(500);
    });
});

describe('getElixirAtkBonus', () => {
    it('returns 0 with no buff', () => {
        expect(getElixirAtkBonus()).toBe(0);
    });

    it('returns 50 with atk_boost_50', () => {
        seedPausable('atk_boost_50');
        expect(getElixirAtkBonus()).toBe(50);
    });
});

describe('getElixirDefBonus', () => {
    it('returns 0 with no buff', () => {
        expect(getElixirDefBonus()).toBe(0);
    });

    it('returns 50 with def_boost_50', () => {
        seedPausable('def_boost_50');
        expect(getElixirDefBonus()).toBe(50);
    });
});

// -- Percent multipliers ------------------------------------------------------

describe('getElixirHpPctMultiplier', () => {
    it('returns 1.0 with no buff', () => {
        expect(getElixirHpPctMultiplier()).toBe(1.0);
    });

    it('returns 1.25 with hp_pct_25', () => {
        seedPausable('hp_pct_25');
        expect(getElixirHpPctMultiplier()).toBe(1.25);
    });
});

describe('getElixirMpPctMultiplier', () => {
    it('returns 1.0 with no buff', () => {
        expect(getElixirMpPctMultiplier()).toBe(1.0);
    });

    it('returns 1.25 with mp_pct_25', () => {
        seedPausable('mp_pct_25');
        expect(getElixirMpPctMultiplier()).toBe(1.25);
    });
});

// -- getElixirAttackSpeedMultiplier -------------------------------------------

describe('getElixirAttackSpeedMultiplier', () => {
    it('returns 1.0 with no buff', () => {
        expect(getElixirAttackSpeedMultiplier()).toBe(1.0);
    });

    it('returns 1.20 with attack_speed buff', () => {
        seedPausable('attack_speed');
        expect(getElixirAttackSpeedMultiplier()).toBe(1.20);
    });
});

// -- tickCombatElixirs --------------------------------------------------------

describe('tickCombatElixirs', () => {
    it('does nothing when no elixir buffs are active', () => {
        // Should be a safe no-op — no buffs in store, no errors thrown.
        expect(() => tickCombatElixirs(1000)).not.toThrow();
        expect(useBuffStore.getState().allBuffs).toHaveLength(0);
    });

    it('drains every ALWAYS_DRAIN buff by the given ms', () => {
        // The full ALWAYS_DRAIN list from the source.
        const always = ['hp_boost_500', 'mp_boost_500', 'atk_boost_50', 'def_boost_50', 'hp_pct_25', 'mp_pct_25', 'attack_speed'];
        for (const e of always) seedPausable(e, 10_000);

        tickCombatElixirs(1000);

        const buffs = useBuffStore.getState().allBuffs;
        for (const e of always) {
            const b = buffs.find((x) => x.effect === e);
            expect(b).toBeDefined();
            expect(b!.remainingMs).toBe(9000);
        }
    });

    it('removes an ALWAYS_DRAIN buff once it fully drains', () => {
        seedPausable('hp_boost_500', 500);
        tickCombatElixirs(1000); // drain more than remaining
        const buffs = useBuffStore.getState().allBuffs;
        expect(buffs.find((b) => b.effect === 'hp_boost_500')).toBeUndefined();
    });

    it('drains ONLY the highest tier from the ATK group', () => {
        // All 3 tiers active. After tick only +100% should have drained;
        // the lower tiers preserve their full duration.
        seedPausable('atk_dmg_25', 10_000);
        seedPausable('atk_dmg_50', 10_000);
        seedPausable('atk_dmg_100', 10_000);

        tickCombatElixirs(1000);

        const buffs = useBuffStore.getState().allBuffs;
        const b100 = buffs.find((b) => b.effect === 'atk_dmg_100')!;
        const b50  = buffs.find((b) => b.effect === 'atk_dmg_50')!;
        const b25  = buffs.find((b) => b.effect === 'atk_dmg_25')!;

        expect(b100.remainingMs).toBe(9000);
        expect(b50.remainingMs).toBe(10_000);
        expect(b25.remainingMs).toBe(10_000);
    });

    it('drains the next tier once +100% expires', () => {
        // No +100% — top remaining tier is +50%.
        seedPausable('atk_dmg_25', 10_000);
        seedPausable('atk_dmg_50', 10_000);

        tickCombatElixirs(1000);

        const buffs = useBuffStore.getState().allBuffs;
        expect(buffs.find((b) => b.effect === 'atk_dmg_50')!.remainingMs).toBe(9000);
        expect(buffs.find((b) => b.effect === 'atk_dmg_25')!.remainingMs).toBe(10_000);
    });

    it('applies the same highest-first rule to SPELL_TIERS', () => {
        seedPausable('spell_dmg_25', 10_000);
        seedPausable('spell_dmg_50', 10_000);
        seedPausable('spell_dmg_100', 10_000);

        tickCombatElixirs(1000);

        const buffs = useBuffStore.getState().allBuffs;
        expect(buffs.find((b) => b.effect === 'spell_dmg_100')!.remainingMs).toBe(9000);
        expect(buffs.find((b) => b.effect === 'spell_dmg_50')!.remainingMs).toBe(10_000);
        expect(buffs.find((b) => b.effect === 'spell_dmg_25')!.remainingMs).toBe(10_000);
    });

    it('handles 0 ms — no drain happens', () => {
        seedPausable('hp_boost_500', 5000);
        tickCombatElixirs(0);
        const buffs = useBuffStore.getState().allBuffs;
        // consumePausableTime is called with 0 -> min(0, remainingMs) = 0
        // so the buff remains at the same remainingMs.
        expect(buffs.find((b) => b.effect === 'hp_boost_500')!.remainingMs).toBe(5000);
    });
});

// -- Mocked-store fallback paths ----------------------------------------------
// All getters read `useBuffStore.getState()` directly. We use the real store
// (not a mock) but call hasBuff against a clean state to verify the default
// branch returns the documented "no change" value.

describe('default-branch fallbacks', () => {
    it('every getter returns its neutral value when buffStore has no buffs', () => {
        const spy = vi.spyOn(useBuffStore.getState(), 'hasBuff');
        spy.mockReturnValue(false);

        try {
            expect(getAtkDamageMultiplier()).toBe(1.0);
            expect(getSpellDamageMultiplier()).toBe(1.0);
            expect(getElixirHpBonus()).toBe(0);
            expect(getElixirMpBonus()).toBe(0);
            expect(getElixirHpPctMultiplier()).toBe(1.0);
            expect(getElixirMpPctMultiplier()).toBe(1.0);
            expect(getElixirAtkBonus()).toBe(0);
            expect(getElixirDefBonus()).toBe(0);
            expect(getElixirAttackSpeedMultiplier()).toBe(1.0);
        } finally {
            spy.mockRestore();
        }
    });
});
