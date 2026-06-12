/**
 * Tests for the potion categorisation / cooldown / label / resolver helpers.
 *
 * Pure functions over hard-coded ID sets — no mocks. The cooldown constants
 * are also tested for value AND for the relationship between flat (5s/1s
 * range) and pct (sub-second range) cooldowns so future bumps don't
 * accidentally invert the ordering and break the dual auto-potion UX.
 */

import { describe, it, expect } from 'vitest';
import {
    PCT_HP_POTION_IDS,
    PCT_MP_POTION_IDS,
    FLAT_HP_POTION_IDS,
    FLAT_MP_POTION_IDS,
    isPctPotion,
    isPctPotionId,
    isFlatPotionId,
    FLAT_POTION_COOLDOWN_MS,
    PCT_POTION_COOLDOWN_MS,
    getPotionCooldownMs,
    ALL_HP_POTIONS,
    ALL_MP_POTIONS,
    FLAT_HP_POTIONS,
    FLAT_MP_POTIONS,
    PCT_HP_POTIONS,
    PCT_MP_POTIONS,
    getPotionLabel,
    getBestPotion,
    resolveAutoPotionElixir,
    PCT_POTION_MIN_LEVEL,
} from './potionSystem';

// -- ID sets -----------------------------------------------------------------

describe('potion ID sets', () => {
    it('lists Great/Super/Ultimate/Divine for both HP and MP pct sets', () => {
        for (const id of ['hp_potion_great', 'hp_potion_super', 'hp_potion_ultimate', 'hp_potion_divine']) {
            expect(PCT_HP_POTION_IDS.has(id)).toBe(true);
        }
        for (const id of ['mp_potion_great', 'mp_potion_super', 'mp_potion_ultimate', 'mp_potion_divine']) {
            expect(PCT_MP_POTION_IDS.has(id)).toBe(true);
        }
    });

    it('lists Small/normal/Strong for both HP and MP flat sets', () => {
        for (const id of ['hp_potion_sm', 'hp_potion_md', 'hp_potion_lg']) {
            expect(FLAT_HP_POTION_IDS.has(id)).toBe(true);
        }
        for (const id of ['mp_potion_sm', 'mp_potion_md', 'mp_potion_lg']) {
            expect(FLAT_MP_POTION_IDS.has(id)).toBe(true);
        }
    });

    it('flat and pct sets are disjoint per family', () => {
        for (const id of PCT_HP_POTION_IDS) {
            expect(FLAT_HP_POTION_IDS.has(id)).toBe(false);
        }
        for (const id of PCT_MP_POTION_IDS) {
            expect(FLAT_MP_POTION_IDS.has(id)).toBe(false);
        }
    });
});

// -- isPctPotion -------------------------------------------------------------

describe('isPctPotion (effect string)', () => {
    it('returns true for percentage effects', () => {
        expect(isPctPotion('heal_hp_pct_20')).toBe(true);
        expect(isPctPotion('heal_mp_pct_50')).toBe(true);
        expect(isPctPotion('heal_hp_pct_100')).toBe(true);
    });

    it('returns false for flat heal effects', () => {
        expect(isPctPotion('heal_hp_50')).toBe(false);
        expect(isPctPotion('heal_mp_150')).toBe(false);
        expect(isPctPotion('heal_hp_400')).toBe(false);
    });

    it('returns false for the empty string', () => {
        expect(isPctPotion('')).toBe(false);
    });
});

// -- isPctPotionId / isFlatPotionId ------------------------------------------

describe('isPctPotionId / isFlatPotionId', () => {
    it('classifies each canonical HP potion correctly', () => {
        expect(isFlatPotionId('hp_potion_sm')).toBe(true);
        expect(isFlatPotionId('hp_potion_md')).toBe(true);
        expect(isFlatPotionId('hp_potion_lg')).toBe(true);
        expect(isPctPotionId('hp_potion_great')).toBe(true);
        expect(isPctPotionId('hp_potion_super')).toBe(true);
        expect(isPctPotionId('hp_potion_ultimate')).toBe(true);
        expect(isPctPotionId('hp_potion_divine')).toBe(true);
    });

    it('classifies each canonical MP potion correctly', () => {
        expect(isFlatPotionId('mp_potion_sm')).toBe(true);
        expect(isPctPotionId('mp_potion_divine')).toBe(true);
    });

    it('returns false for unknown IDs and the empty string', () => {
        expect(isPctPotionId('foo')).toBe(false);
        expect(isFlatPotionId('foo')).toBe(false);
        expect(isPctPotionId('')).toBe(false);
        expect(isFlatPotionId('')).toBe(false);
    });

    it('returns false for a flat ID asked as pct, and vice versa', () => {
        expect(isPctPotionId('hp_potion_sm')).toBe(false);
        expect(isFlatPotionId('hp_potion_great')).toBe(false);
    });
});

// -- Cooldown constants ------------------------------------------------------

describe('potion cooldown constants', () => {
    it('uses 1s for flat potions, 0.5s for pct potions', () => {
        expect(FLAT_POTION_COOLDOWN_MS).toBe(1000);
        expect(PCT_POTION_COOLDOWN_MS).toBe(500);
    });

    it('pct cooldown is shorter than flat cooldown', () => {
        expect(PCT_POTION_COOLDOWN_MS).toBeLessThan(FLAT_POTION_COOLDOWN_MS);
    });
});

// -- getPotionCooldownMs -----------------------------------------------------

describe('getPotionCooldownMs', () => {
    it('returns the pct cooldown for percentage potions', () => {
        expect(getPotionCooldownMs('hp_potion_great')).toBe(PCT_POTION_COOLDOWN_MS);
        expect(getPotionCooldownMs('mp_potion_divine')).toBe(PCT_POTION_COOLDOWN_MS);
    });

    it('returns the flat cooldown for flat potions', () => {
        expect(getPotionCooldownMs('hp_potion_sm')).toBe(FLAT_POTION_COOLDOWN_MS);
        expect(getPotionCooldownMs('mp_potion_lg')).toBe(FLAT_POTION_COOLDOWN_MS);
    });

    it('falls back to the flat cooldown for unknown IDs', () => {
        expect(getPotionCooldownMs('unknown_potion')).toBe(FLAT_POTION_COOLDOWN_MS);
        expect(getPotionCooldownMs('')).toBe(FLAT_POTION_COOLDOWN_MS);
    });
});

// -- Pool integrity ----------------------------------------------------------

describe('potion pools derived from ELIXIRS', () => {
    it('ALL_HP_POTIONS only contains heal_hp_* elixirs', () => {
        expect(ALL_HP_POTIONS.length).toBeGreaterThan(0);
        for (const e of ALL_HP_POTIONS) expect(e.effect.startsWith('heal_hp')).toBe(true);
    });

    it('ALL_MP_POTIONS only contains heal_mp_* elixirs', () => {
        expect(ALL_MP_POTIONS.length).toBeGreaterThan(0);
        for (const e of ALL_MP_POTIONS) expect(e.effect.startsWith('heal_mp')).toBe(true);
    });

    it('FLAT_HP_POTIONS and PCT_HP_POTIONS partition ALL_HP_POTIONS', () => {
        expect(FLAT_HP_POTIONS.length + PCT_HP_POTIONS.length).toBe(ALL_HP_POTIONS.length);
        for (const e of FLAT_HP_POTIONS) expect(isPctPotion(e.effect)).toBe(false);
        for (const e of PCT_HP_POTIONS) expect(isPctPotion(e.effect)).toBe(true);
    });

    it('FLAT_MP_POTIONS and PCT_MP_POTIONS partition ALL_MP_POTIONS', () => {
        expect(FLAT_MP_POTIONS.length + PCT_MP_POTIONS.length).toBe(ALL_MP_POTIONS.length);
        for (const e of FLAT_MP_POTIONS) expect(isPctPotion(e.effect)).toBe(false);
        for (const e of PCT_MP_POTIONS) expect(isPctPotion(e.effect)).toBe(true);
    });
});

// -- getPotionLabel ----------------------------------------------------------

describe('getPotionLabel', () => {
    it('formats flat HP/MP heal effects', () => {
        expect(getPotionLabel('heal_hp_50')).toBe('+50 HP');
        expect(getPotionLabel('heal_mp_150')).toBe('+150 MP');
        expect(getPotionLabel('heal_hp_400')).toBe('+400 HP');
    });

    it('formats percentage HP/MP heal effects', () => {
        expect(getPotionLabel('heal_hp_pct_20')).toBe('+20% HP');
        expect(getPotionLabel('heal_mp_pct_50')).toBe('+50% MP');
        expect(getPotionLabel('heal_hp_pct_100')).toBe('+100% HP');
    });

    it('returns the raw effect string when no known pattern matches', () => {
        expect(getPotionLabel('xp_boost')).toBe('xp_boost');
        expect(getPotionLabel('')).toBe('');
        expect(getPotionLabel('heal_hp_')).toBe('heal_hp_');
    });
});

// -- getBestPotion -----------------------------------------------------------

describe('getBestPotion', () => {
    it('returns the strongest potion the player owns', () => {
        // FLAT_HP_POTIONS ordered low->high (sm, md, lg)
        const consumables = { hp_potion_sm: 5, hp_potion_md: 2 };
        const best = getBestPotion(FLAT_HP_POTIONS, consumables);
        expect(best?.id).toBe('hp_potion_md');
    });

    it('skips zero-count potions even if listed in the pool', () => {
        const consumables = { hp_potion_lg: 0, hp_potion_sm: 3 };
        const best = getBestPotion(FLAT_HP_POTIONS, consumables);
        expect(best?.id).toBe('hp_potion_sm');
    });

    it('falls back to the strongest pool entry when the player owns none', () => {
        const best = getBestPotion(FLAT_HP_POTIONS, {});
        // The reversed list's first entry = highest tier in the pool.
        expect(best?.id).toBe(FLAT_HP_POTIONS[FLAT_HP_POTIONS.length - 1].id);
    });

    it('returns null when the pool is empty', () => {
        expect(getBestPotion([], {})).toBeNull();
    });
});

// -- resolveAutoPotionElixir -------------------------------------------------

describe('resolveAutoPotionElixir', () => {
    it('returns the preferred elixir when the player owns it', () => {
        const consumables = { hp_potion_md: 3 };
        const e = resolveAutoPotionElixir('hp_potion_md', 'hp', 'flat', consumables);
        expect(e?.id).toBe('hp_potion_md');
    });

    it('ignores the preferred elixir when count is 0 and falls back to the strongest owned', () => {
        const consumables = { hp_potion_md: 0, hp_potion_sm: 4 };
        const e = resolveAutoPotionElixir('hp_potion_md', 'hp', 'flat', consumables);
        expect(e?.id).toBe('hp_potion_sm');
    });

    it('routes through the matching family/kind pool when preferred is missing', () => {
        const consumables = { mp_potion_lg: 2 };
        const e = resolveAutoPotionElixir(undefined, 'mp', 'flat', consumables);
        expect(e?.id).toBe('mp_potion_lg');
    });

    it('uses the pct pool when slotKind is "pct"', () => {
        const consumables = { hp_potion_great: 1 };
        const e = resolveAutoPotionElixir(undefined, 'hp', 'pct', consumables);
        expect(e?.id).toBe('hp_potion_great');
    });

    it('returns null when the player owns nothing in the matching pool', () => {
        const e = resolveAutoPotionElixir(undefined, 'hp', 'flat', {});
        expect(e).toBeNull();
    });

    it('returns null when preferredId is unknown AND nothing is owned', () => {
        const e = resolveAutoPotionElixir('does_not_exist', 'mp', 'pct', {});
        expect(e).toBeNull();
    });
});

// -- PCT_POTION_MIN_LEVEL ----------------------------------------------------

describe('PCT_POTION_MIN_LEVEL', () => {
    it('is 100 (matches Great HP/MP unlock level)', () => {
        expect(PCT_POTION_MIN_LEVEL).toBe(100);
    });
});
