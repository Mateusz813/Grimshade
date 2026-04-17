import { useBuffStore } from '../stores/buffStore';

// ── Combat elixir bonus helpers ──────────────────────────────────────────────
// Reads active buffs from buffStore and returns numeric bonuses / multipliers
// to be applied on top of base + equipment + training stats.
//
// All combat elixirs added in Faza 9 are pausable buffs (timer only ticks
// during combat). The effect strings used here MUST match BUFF_CONFIG in
// src/views/Inventory/Inventory.tsx.

/** Returns a multiplier (1.0 = no change) for player physical attack damage. */
export const getAtkDamageMultiplier = (): number => {
    const b = useBuffStore.getState();
    if (b.hasBuff('atk_dmg_100')) return 2.0;
    if (b.hasBuff('atk_dmg_50')) return 1.5;
    if (b.hasBuff('atk_dmg_25')) return 1.25;
    return 1.0;
};

/** Returns a multiplier (1.0 = no change) for spell / skill damage. */
export const getSpellDamageMultiplier = (): number => {
    const b = useBuffStore.getState();
    if (b.hasBuff('spell_dmg_100')) return 2.0;
    if (b.hasBuff('spell_dmg_50')) return 1.5;
    if (b.hasBuff('spell_dmg_25')) return 1.25;
    return 1.0;
};

/** Flat bonus added to effective Max HP while the elixir is active. */
export const getElixirHpBonus = (): number => {
    return useBuffStore.getState().hasBuff('hp_boost_500') ? 500 : 0;
};

/** Flat bonus added to effective Max MP while the elixir is active. */
export const getElixirMpBonus = (): number => {
    return useBuffStore.getState().hasBuff('mp_boost_500') ? 500 : 0;
};

/** Percentage multiplier on effective Max HP (1.0 = no change). */
export const getElixirHpPctMultiplier = (): number => {
    return useBuffStore.getState().hasBuff('hp_pct_25') ? 1.25 : 1.0;
};

/** Percentage multiplier on effective Max MP (1.0 = no change). */
export const getElixirMpPctMultiplier = (): number => {
    return useBuffStore.getState().hasBuff('mp_pct_25') ? 1.25 : 1.0;
};

/** Flat bonus added to effective Attack while the elixir is active. */
export const getElixirAtkBonus = (): number => {
    return useBuffStore.getState().hasBuff('atk_boost_50') ? 50 : 0;
};

/** Flat bonus added to effective Defense while the elixir is active. */
export const getElixirDefBonus = (): number => {
    return useBuffStore.getState().hasBuff('def_boost_50') ? 50 : 0;
};

/**
 * Returns attack_speed multiplier (1.0 = no change). Applied on top of the
 * effective attack_speed value. The classic "AS elixir" (+20%) is pausable
 * and ticks only during combat — see attack_speed buff in buffStore.
 */
export const getElixirAttackSpeedMultiplier = (): number => {
    return useBuffStore.getState().hasBuff('attack_speed') ? 1.20 : 1.0;
};

/** All combat elixir effect IDs (pausable). Used by tickCombatElixirs. */
const COMBAT_ELIXIR_EFFECTS: string[] = [
    'atk_dmg_25',
    'atk_dmg_50',
    'atk_dmg_100',
    'spell_dmg_25',
    'spell_dmg_50',
    'spell_dmg_100',
    'hp_boost_500',
    'mp_boost_500',
    'atk_boost_50',
    'def_boost_50',
    'hp_pct_25',
    'mp_pct_25',
    'attack_speed',
];

/**
 * Consumes `ms` milliseconds of real combat time from every active combat
 * elixir buff. Call this from the places that already tick other pausable
 * buffs (monster death / SKIP resolution / boss hit etc.).
 */
export const tickCombatElixirs = (ms: number): void => {
    const b = useBuffStore.getState();
    for (const effect of COMBAT_ELIXIR_EFFECTS) {
        if (b.hasBuff(effect)) {
            b.consumePausableTime(effect, ms);
        }
    }
};
