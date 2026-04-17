/**
 * Transform Bonuses – LIVE helpers for permanent transform rewards.
 *
 * ── Point 7 rewrite (2026-04) ────────────────────────────────────────────────
 * Previously most bonuses (hpPercent, mpPercent, defPercent, flatHp, flatMp,
 * attack, defense, regen) were baked into character.max_hp / max_mp / attack /
 * defense at the moment the transform quest was completed, using the THEN-
 * current stats. This meant leveling up or upgrading gear afterwards never
 * re-applied the `% of max HP / MP / DEF` reward — the bonus was frozen at
 * claim time.
 *
 * Now every bonus is computed LIVE at each render / combat tick:
 *   - Flat bonuses (flatHp, flatMp, attack, defense, hpRegenFlat, mpRegenFlat)
 *     are simply summed across all completed transforms for the character's
 *     class and added in getEffectiveChar().
 *   - Percent bonuses (hpPercent, mpPercent, defPercent) are applied on top
 *     of the character's (base + equip + training) pool so they always scale
 *     with the player's current power.
 *   - dmgPercent still works the same — it multiplies outgoing damage.
 *
 * Legacy characters whose stats were already baked are migrated in
 * characterScope.ts: on first load we compute the original bake delta by
 * forward-iterating over completedTransforms, subtract it from character
 * stats, and flip `bakedBonusesApplied` to false. Going forward the store
 * starts new characters with the flag already false so the baking never
 * happens again.
 *
 * All helpers read transformStore + characterStore directly so that every
 * combat view (Combat, Dungeon, Boss, Transform) can call them the same way.
 */

import { useCharacterStore } from '../stores/characterStore';
import { useTransformStore } from '../stores/transformStore';
import { getClassTransformBonuses, getTransformById } from './transformSystem';
import type { TCharacterClass } from '../api/v1/characterApi';
import type { ITransformPermanentBonuses } from './transformSystem';

const ZERO_BONUS: ITransformPermanentBonuses = {
    hpPercent: 0, mpPercent: 0, defPercent: 0, dmgPercent: 0, atkPercent: 0,
    flatHp: 0, flatMp: 0, attack: 0, defense: 0,
    hpRegen: 0, mpRegen: 0, hpRegenFlat: 0, mpRegenFlat: 0,
    classSkillBonus: 0,
};

/**
 * Sum every per-tier bonus across the character's completed transforms.
 * Returns a zeroed record if no character, no transforms, or bonuses are
 * still baked (legacy mode) — in that case the stats are already in
 * character.max_hp / attack / etc., so we must NOT apply them again.
 */
const sumCompletedBonuses = (): ITransformPermanentBonuses => {
    try {
        const char = useCharacterStore.getState().character;
        if (!char) return { ...ZERO_BONUS };
        const store = useTransformStore.getState();
        // Legacy save: bonuses still baked into char stats — skip live apply.
        if (store.bakedBonusesApplied) return { ...ZERO_BONUS };
        const completed = store.completedTransforms;
        if (!completed || completed.length === 0) return { ...ZERO_BONUS };
        const cls = char.class as TCharacterClass;

        const sum: ITransformPermanentBonuses = { ...ZERO_BONUS };
        for (const tid of completed) {
            if (!getTransformById(tid)) continue;
            const per = getClassTransformBonuses(cls, tid);
            sum.hpPercent    += per.hpPercent;
            sum.mpPercent    += per.mpPercent;
            sum.defPercent   += per.defPercent;
            sum.dmgPercent   += per.dmgPercent;
            sum.atkPercent   += per.atkPercent;
            sum.flatHp       += per.flatHp;
            sum.flatMp       += per.flatMp;
            sum.attack       += per.attack;
            sum.defense      += per.defense;
            sum.hpRegenFlat  += per.hpRegenFlat;
            sum.mpRegenFlat  += per.mpRegenFlat;
        }
        return sum;
    } catch {
        return { ...ZERO_BONUS };
    }
};

/**
 * Returns the outgoing damage multiplier granted by all completed transforms.
 * Stacks additively: `1 + (Σ dmgPercent) / 100`. Defaults to 1.0 (no bonus).
 *
 * Note: dmgPercent is read straight from the bonus table regardless of
 * `bakedBonusesApplied` — it was never baked into character stats in the old
 * system either, so legacy saves are unaffected.
 */
export const getTransformDmgMultiplier = (): number => {
    try {
        const char = useCharacterStore.getState().character;
        if (!char) return 1.0;
        const cls = char.class as TCharacterClass;
        const completed = useTransformStore.getState().completedTransforms;
        if (!completed || completed.length === 0) return 1.0;

        let totalPct = 0;
        for (const tid of completed) {
            if (getTransformById(tid)) {
                totalPct += getClassTransformBonuses(cls, tid).dmgPercent;
            }
        }
        if (totalPct <= 0) return 1.0;
        return 1 + totalPct / 100;
    } catch {
        return 1.0;
    }
};

/**
 * Flat HP bonus granted by transforms (sum of `flatHp` across all completed
 * transforms). Added directly to max HP in getEffectiveChar.
 */
export const getTransformFlatHp = (): number => sumCompletedBonuses().flatHp;

/** Flat MP bonus from transforms (sum of per-tier `flatMp`). */
export const getTransformFlatMp = (): number => sumCompletedBonuses().flatMp;

/** Flat attack bonus from transforms. */
export const getTransformFlatAttack = (): number => sumCompletedBonuses().attack;

/** Flat defense bonus from transforms (NOT the % defense reward). */
export const getTransformFlatDefense = (): number => sumCompletedBonuses().defense;

/** Flat HP/s regen bonus from transforms (sum of `hpRegenFlat`). */
export const getTransformHpRegenFlat = (): number => sumCompletedBonuses().hpRegenFlat;

/** Flat MP/s regen bonus from transforms. */
export const getTransformMpRegenFlat = (): number => sumCompletedBonuses().mpRegenFlat;

/**
 * Returns the multiplier to apply to a stat pool for the `hpPercent` reward.
 * Stacks additively: `1 + Σ hpPercent / 100`. This mirrors how combat elixirs
 * layer on top of base + equip + training pools.
 */
export const getTransformHpPctMultiplier = (): number => {
    const pct = sumCompletedBonuses().hpPercent;
    if (pct <= 0) return 1.0;
    return 1 + pct / 100;
};

/** Multiplier for max MP (`mpPercent` stacked additively). */
export const getTransformMpPctMultiplier = (): number => {
    const pct = sumCompletedBonuses().mpPercent;
    if (pct <= 0) return 1.0;
    return 1 + pct / 100;
};

/** Multiplier for defense (`defPercent` stacked additively). */
export const getTransformDefPctMultiplier = (): number => {
    const pct = sumCompletedBonuses().defPercent;
    if (pct <= 0) return 1.0;
    return 1 + pct / 100;
};

/**
 * Point N5: Multiplier for attack (`atkPercent` stacked additively). Applied
 * on top of base + equip + training + flat-transform attack, so the bonus
 * scales naturally as the player levels up or upgrades gear (e.g. 7% of 200
 * ATK = 14 extra ATK, 7% of 400 ATK = 28 extra ATK).
 */
export const getTransformAtkPctMultiplier = (): number => {
    const pct = sumCompletedBonuses().atkPercent;
    if (pct <= 0) return 1.0;
    return 1 + pct / 100;
};

/**
 * Full breakdown of live transform bonuses for UI (CharacterStats). Skips
 * everything when the character is still in the legacy baked state so the
 * panel doesn't double-report them.
 */
export interface ILiveTransformBreakdown {
    dmgPercent: number;      // outgoing damage %
    hpPercent: number;       // % added to max HP pool
    mpPercent: number;       // % added to max MP pool
    defPercent: number;      // % added to defense pool
    atkPercent: number;      // % added to attack pool
    flatHp: number;
    flatMp: number;
    flatAttack: number;
    flatDefense: number;
    hpRegenFlat: number;
    mpRegenFlat: number;
    active: boolean;         // false for legacy (baked) saves → hide in UI
}

export const getLiveTransformBreakdown = (): ILiveTransformBreakdown => {
    try {
        const store = useTransformStore.getState();
        const char = useCharacterStore.getState().character;
        if (!char || store.bakedBonusesApplied || store.completedTransforms.length === 0) {
            return {
                dmgPercent: 0, hpPercent: 0, mpPercent: 0, defPercent: 0, atkPercent: 0,
                flatHp: 0, flatMp: 0, flatAttack: 0, flatDefense: 0,
                hpRegenFlat: 0, mpRegenFlat: 0, active: false,
            };
        }
        const b = sumCompletedBonuses();
        return {
            dmgPercent: b.dmgPercent,
            hpPercent: b.hpPercent,
            mpPercent: b.mpPercent,
            defPercent: b.defPercent,
            atkPercent: b.atkPercent,
            flatHp: b.flatHp,
            flatMp: b.flatMp,
            flatAttack: b.attack,
            flatDefense: b.defense,
            hpRegenFlat: b.hpRegenFlat,
            mpRegenFlat: b.mpRegenFlat,
            active: true,
        };
    } catch {
        return {
            dmgPercent: 0, hpPercent: 0, mpPercent: 0, defPercent: 0, atkPercent: 0,
            flatHp: 0, flatMp: 0, flatAttack: 0, flatDefense: 0,
            hpRegenFlat: 0, mpRegenFlat: 0, active: false,
        };
    }
};
