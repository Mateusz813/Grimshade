/**
 * Stat aggregation invariants — `getEffectiveChar` + `getTotalEquipmentStats`
 * + `getTrainingBonuses`.
 *
 * Extends BACKLOG.md 8.1 ("Stats popup agreguje: EQ + transform + upgrade +
 * eliksir + skill train + buffs") with the unit-level breakdown of each
 * additive source contributing to the final aggregated max stats.
 *
 * The view-layer aggregator in `CharacterSelect.tsx` (`getEffectiveMaxStats`)
 * mirrors `combatEngine.ts.getEffectiveChar` — both are the single source of
 * truth for "what max HP / max MP / attack / defense does the player actually
 * have right now after every modifier?". If either drifts from the contract
 * tested here, the HUD HP bar disagrees with combat-engine HP calc, which the
 * player perceives as "I have less HP than the bar says" (the historical
 * regression that prompted the 2026-05-21 fix in `inventoryStore.ts`).
 *
 * Contract tested per source:
 *   base char only                       → returns base verbatim (floored)
 *   + equipment hp/mp/attack/defense     → ADDITIVE sum
 *   + training (skillLevels[max_hp]×5)   → ADDITIVE sum
 *   crit_chance capped at 0.5 (50%)      → hard cap regardless of inputs
 *   no equipment / no training           → matches base char stats (identity)
 *
 * Why unit/integration rather than E2E: aggregation is pure math over multiple
 * Zustand slices. E2E in BACKLOG 8.1 already covers the UI rendering of one
 * aggregated value; this file goes per-source so we can isolate which source
 * broke if the aggregated value drifts in the future.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getEffectiveChar } from './combatEngine';
import {
    getTotalEquipmentStats,
    EMPTY_EQUIPMENT,
    flattenItemsData,
    type IInventoryItem,
    type IBaseItem,
    type IEquipment,
} from './itemSystem';
import { getTrainingBonuses } from './skillSystem';
import { useCharacterStore } from '../stores/characterStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useSkillStore } from '../stores/skillStore';
import { useBuffStore } from '../stores/buffStore';
import itemsRaw from '../data/items.json';
import type { ICharacter } from '../api/v1/characterApi';

const ALL_ITEMS: IBaseItem[] = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeCharacter = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
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
    crit_chance: 0.05,
    crit_damage: 2.0,
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

const resetStores = (): void => {
    useCharacterStore.setState({ character: null, isLoading: false });
    useInventoryStore.setState({
        ...useInventoryStore.getState(),
        equipment: { ...EMPTY_EQUIPMENT },
        consumables: {},
        stones: {},
    });
    useSkillStore.setState({
        ...useSkillStore.getState(),
        skillLevels: {},
        skillXp: {},
        skillUpgradeLevels: {},
        unlockedSkills: {},
    });
    useBuffStore.setState({ allBuffs: [] });
};

// ── Base identity: no equipment, no skills, no buffs → returns base char ─────

describe('getEffectiveChar — identity (no modifiers)', () => {
    beforeEach(() => resetStores());

    it('returns null for null character', () => {
        expect(getEffectiveChar(null)).toBeNull();
    });

    it('preserves base max_hp when no equipment / training / elixir / transform', () => {
        const ch = makeCharacter({ max_hp: 100 });
        const eff = getEffectiveChar(ch);
        // No modifiers: raw = 100 + 0 + 0 + 0 + 0; eff = floor(100 * 1 * 1) = 100.
        expect(eff?.max_hp).toBe(100);
    });

    it('preserves base max_mp when no equipment / training / elixir / transform', () => {
        const ch = makeCharacter({ max_mp: 50 });
        const eff = getEffectiveChar(ch);
        expect(eff?.max_mp).toBe(50);
    });

    it('preserves base attack when no modifiers', () => {
        const ch = makeCharacter({ attack: 20 });
        const eff = getEffectiveChar(ch);
        expect(eff?.attack).toBe(20);
    });

    it('preserves base defense when no modifiers', () => {
        const ch = makeCharacter({ defense: 10 });
        const eff = getEffectiveChar(ch);
        expect(eff?.defense).toBe(10);
    });

    it('preserves base attack_speed (×1 elixir mult identity)', () => {
        const ch = makeCharacter({ attack_speed: 2.0 });
        const eff = getEffectiveChar(ch);
        expect(eff?.attack_speed).toBeCloseTo(2.0, 5);
    });
});

// ── Equipment as a stat source — additive contribution ─────────────────────

describe('getEffectiveChar — equipment source (additive)', () => {
    beforeEach(() => resetStores());

    it('+20 HP gear adds exactly +20 to max_hp', () => {
        const ch = makeCharacter({ max_hp: 100 });
        const helmet: IInventoryItem = {
            uuid: 'h-1',
            itemId: 'unknown_helmet_id', // routes to "generated item" path
            rarity: 'common',
            bonuses: { hp: 20 },
            itemLevel: 1,
        };
        useInventoryStore.setState((s) => ({
            ...s,
            equipment: { ...s.equipment, helmet },
        }));
        const eff = getEffectiveChar(ch);
        // 100 + 20 = 120 (no elixir mult, no transform).
        expect(eff?.max_hp).toBe(120);
    });

    it('+15 attack weapon adds exactly +15 to attack', () => {
        const ch = makeCharacter({ attack: 20 });
        const weapon: IInventoryItem = {
            uuid: 'w-1',
            itemId: 'unknown_weapon_id',
            rarity: 'common',
            bonuses: { attack: 15 },
            itemLevel: 1,
        };
        useInventoryStore.setState((s) => ({
            ...s,
            equipment: { ...s.equipment, mainHand: weapon },
        }));
        const eff = getEffectiveChar(ch);
        // 20 + 15 = 35 (× transform mult 1 = 35).
        expect(eff?.attack).toBe(35);
    });

    it('+10 defense gear adds exactly +10 to defense', () => {
        const ch = makeCharacter({ defense: 10 });
        const armor: IInventoryItem = {
            uuid: 'a-1',
            itemId: 'unknown_armor_id',
            rarity: 'common',
            bonuses: { defense: 10 },
            itemLevel: 1,
        };
        useInventoryStore.setState((s) => ({
            ...s,
            equipment: { ...s.equipment, armor },
        }));
        const eff = getEffectiveChar(ch);
        expect(eff?.defense).toBe(20);
    });

    it('multi-slot stacking: helmet +20 HP + armor +30 HP → +50 HP total', () => {
        const ch = makeCharacter({ max_hp: 100 });
        const helmet: IInventoryItem = {
            uuid: 'h-1', itemId: 'unknown_helmet_id', rarity: 'common',
            bonuses: { hp: 20 }, itemLevel: 1,
        };
        const armor: IInventoryItem = {
            uuid: 'a-1', itemId: 'unknown_armor_id', rarity: 'common',
            bonuses: { hp: 30 }, itemLevel: 1,
        };
        useInventoryStore.setState((s) => ({
            ...s,
            equipment: { ...s.equipment, helmet, armor },
        }));
        const eff = getEffectiveChar(ch);
        // 100 + 20 + 30 = 150.
        expect(eff?.max_hp).toBe(150);
    });
});

// ── Training as a stat source — skillLevels[max_hp] × 5 ─────────────────────

describe('getEffectiveChar — training source (additive)', () => {
    beforeEach(() => resetStores());

    it('skillLevels[max_hp]=4 grants +20 HP (4 × 5)', () => {
        const ch = makeCharacter({ max_hp: 100 });
        useSkillStore.setState({
            ...useSkillStore.getState(),
            skillLevels: { max_hp: 4 },
        });
        const eff = getEffectiveChar(ch);
        expect(eff?.max_hp).toBe(120);
    });

    it('skillLevels[max_mp]=4 grants +20 MP (4 × 5)', () => {
        const ch = makeCharacter({ max_mp: 50 });
        useSkillStore.setState({
            ...useSkillStore.getState(),
            skillLevels: { max_mp: 4 },
        });
        const eff = getEffectiveChar(ch);
        expect(eff?.max_mp).toBe(70);
    });

    it('skillLevels[defense]=5 grants +5 defense (5 × 1)', () => {
        const ch = makeCharacter({ defense: 10 });
        useSkillStore.setState({
            ...useSkillStore.getState(),
            skillLevels: { defense: 5 },
        });
        const eff = getEffectiveChar(ch);
        // defense bonus is 1 per level — 10 + 5 = 15.
        expect(eff?.defense).toBe(15);
    });

    it('skillLevels[attack_speed]=3 grants +0.3 attack_speed (3 × 0.1)', () => {
        const ch = makeCharacter({ attack_speed: 2.0 });
        useSkillStore.setState({
            ...useSkillStore.getState(),
            skillLevels: { attack_speed: 3 },
        });
        const eff = getEffectiveChar(ch);
        // baseAttackSpeed = 2.0 + 0 (no eq) + 0.3 (training) = 2.3.
        // attack_speed final = 2.3 × elixirAttackSpeedMultiplier (1) = 2.3.
        expect(eff?.attack_speed).toBeCloseTo(2.3, 5);
    });
});

// ── Combined sources: equipment + training stack additively ─────────────────

describe('getEffectiveChar — equipment + training combined', () => {
    beforeEach(() => resetStores());

    it('base 100 + eq +20 + training +20 = 140 HP', () => {
        const ch = makeCharacter({ max_hp: 100 });
        useInventoryStore.setState((s) => ({
            ...s,
            equipment: {
                ...s.equipment,
                helmet: {
                    uuid: 'h-1', itemId: 'unknown_helmet_id', rarity: 'common',
                    bonuses: { hp: 20 }, itemLevel: 1,
                },
            },
        }));
        useSkillStore.setState({
            ...useSkillStore.getState(),
            skillLevels: { max_hp: 4 }, // +20
        });
        const eff = getEffectiveChar(ch);
        expect(eff?.max_hp).toBe(140);
    });

    it('base attack 20 + eq +15 = 35 attack (training does not add attack — only hp/mp/def/as/crit)', () => {
        const ch = makeCharacter({ attack: 20 });
        useInventoryStore.setState((s) => ({
            ...s,
            equipment: {
                ...s.equipment,
                mainHand: {
                    uuid: 'w-1', itemId: 'unknown_weapon_id', rarity: 'common',
                    bonuses: { attack: 15 }, itemLevel: 1,
                },
            },
        }));
        // No skill level adds attack — only weapon skill applies a bonus
        // separately during damage rolls.
        useSkillStore.setState({
            ...useSkillStore.getState(),
            skillLevels: { max_hp: 100, max_mp: 100, defense: 100 },
        });
        const eff = getEffectiveChar(ch);
        expect(eff?.attack).toBe(35);
    });
});

// ── Crit chance hard cap (CLAUDE.md: max 50%) ───────────────────────────────

describe('getEffectiveChar — crit_chance cap @ 0.5 (50%)', () => {
    beforeEach(() => resetStores());

    it('caps base 10 (1000%) + training 200×0.005 (100%) at 0.5', () => {
        const ch = makeCharacter({ crit_chance: 10 });
        useSkillStore.setState({
            ...useSkillStore.getState(),
            skillLevels: { crit_chance: 200 },
        });
        const eff = getEffectiveChar(ch);
        expect(eff?.crit_chance).toBe(0.5);
    });

    it('returns 0.05 at base 0.05 (no cap triggered, identity)', () => {
        const ch = makeCharacter({ crit_chance: 0.05 });
        const eff = getEffectiveChar(ch);
        expect(eff?.crit_chance).toBe(0.05);
    });

    it('caps 0.49 + training 0.05 (0.005 × 10) = 0.5 (just at cap)', () => {
        const ch = makeCharacter({ crit_chance: 0.49 });
        useSkillStore.setState({
            ...useSkillStore.getState(),
            skillLevels: { crit_chance: 10 },
        });
        const eff = getEffectiveChar(ch);
        // 0.49 + 0 (eq) + 0.05 (10×0.005 training) = 0.54 → capped at 0.5.
        expect(eff?.crit_chance).toBe(0.5);
    });
});

// ── getTotalEquipmentStats — pure helper additivity ─────────────────────────

describe('getTotalEquipmentStats — additivity invariants', () => {
    it('returns all-zeroes for empty equipment', () => {
        const stats = getTotalEquipmentStats(EMPTY_EQUIPMENT, ALL_ITEMS);
        expect(stats.hp).toBe(0);
        expect(stats.mp).toBe(0);
        expect(stats.attack).toBe(0);
        expect(stats.defense).toBe(0);
        expect(stats.speed).toBe(0);
        expect(stats.critChance).toBe(0);
        expect(stats.critDmg).toBe(0);
    });

    it('sums hp across all slots (3 helmets-worth of hp adds linearly)', () => {
        const equipment: Partial<IEquipment> = {
            helmet: { uuid: '1', itemId: 'unknown_helmet_id', rarity: 'common', bonuses: { hp: 10 }, itemLevel: 1 },
            armor:  { uuid: '2', itemId: 'unknown_armor_id',  rarity: 'common', bonuses: { hp: 20 }, itemLevel: 1 },
            pants:  { uuid: '3', itemId: 'unknown_pants_id',  rarity: 'common', bonuses: { hp: 30 }, itemLevel: 1 },
        };
        const stats = getTotalEquipmentStats(equipment, ALL_ITEMS);
        expect(stats.hp).toBe(60);
    });

    it('preserves additive identity (sum of parts = sum-of-all on combined)', () => {
        const a: Partial<IEquipment> = {
            helmet: { uuid: '1', itemId: 'unknown_helmet_id', rarity: 'common', bonuses: { hp: 50 }, itemLevel: 1 },
        };
        const b: Partial<IEquipment> = {
            armor: { uuid: '2', itemId: 'unknown_armor_id', rarity: 'common', bonuses: { hp: 70 }, itemLevel: 1 },
        };
        const ab: Partial<IEquipment> = { ...a, ...b };
        const statsA = getTotalEquipmentStats(a, ALL_ITEMS);
        const statsB = getTotalEquipmentStats(b, ALL_ITEMS);
        const statsAB = getTotalEquipmentStats(ab, ALL_ITEMS);
        expect(statsAB.hp).toBe(statsA.hp + statsB.hp);
    });
});

// ── getTrainingBonuses — pure helper, contracts vs spec ─────────────────────

describe('getTrainingBonuses — bonus formula per stat', () => {
    it('max_hp: skillLevel × 5', () => {
        const tb = getTrainingBonuses({ max_hp: 10 });
        expect(tb.max_hp).toBe(50);
    });

    it('max_mp: skillLevel × 5', () => {
        const tb = getTrainingBonuses({ max_mp: 7 });
        expect(tb.max_mp).toBe(35);
    });

    it('defense: skillLevel × 1', () => {
        const tb = getTrainingBonuses({ defense: 12 });
        expect(tb.defense).toBe(12);
    });

    it('attack_speed: skillLevel × 0.1', () => {
        const tb = getTrainingBonuses({ attack_speed: 5 });
        expect(tb.attack_speed).toBeCloseTo(0.5, 5);
    });

    it('crit_chance: skillLevel × 0.005', () => {
        const tb = getTrainingBonuses({ crit_chance: 10 });
        expect(tb.crit_chance).toBeCloseTo(0.05, 5);
    });

    it('crit_dmg: skillLevel × 0.02', () => {
        const tb = getTrainingBonuses({ crit_dmg: 5 });
        expect(tb.crit_dmg).toBeCloseTo(0.10, 5);
    });

    it('returns 0 for all stats when skillLevels is empty', () => {
        const tb = getTrainingBonuses({});
        expect(tb.max_hp).toBe(0);
        expect(tb.max_mp).toBe(0);
        expect(tb.defense).toBe(0);
        expect(tb.attack_speed).toBe(0);
        expect(tb.crit_chance).toBe(0);
        expect(tb.crit_dmg).toBe(0);
        expect(tb.hp_regen).toBe(0);
        expect(tb.mp_regen).toBe(0);
    });

    it('hp_regen scales by class (Knight 0.20/lvl — highest, tank role)', () => {
        const tb = getTrainingBonuses({ hp_regen: 10 }, 'Knight');
        expect(tb.hp_regen).toBeCloseTo(10 * 0.20, 5);
    });

    it('hp_regen scales by class (Mage 0.05/lvl — lowest, squishy)', () => {
        const tb = getTrainingBonuses({ hp_regen: 10 }, 'Mage');
        expect(tb.hp_regen).toBeCloseTo(10 * 0.05, 5);
    });

    it('hp_regen falls back to 0.1/lvl when class is unknown', () => {
        const tb = getTrainingBonuses({ hp_regen: 10 }, 'UnknownClass');
        expect(tb.hp_regen).toBeCloseTo(10 * 0.1, 5);
    });

    it('hp_regen falls back to 0.1/lvl when class is omitted', () => {
        const tb = getTrainingBonuses({ hp_regen: 10 });
        expect(tb.hp_regen).toBeCloseTo(10 * 0.1, 5);
    });

    it('mp_regen scales by class (Mage 0.20/lvl — highest tier)', () => {
        const tb = getTrainingBonuses({ mp_regen: 10 }, 'Mage');
        expect(tb.mp_regen).toBeCloseTo(10 * 0.20, 5);
    });
});

// ── NaN hardening — undefined inputs default to 0 (CLAUDE.md regression guard) ──

/**
 * 2026-05-25 fix — `getEffectiveChar` previously propagated NaN when any of
 * `attack` / `defense` / `crit_chance` / `attack_speed` / `max_hp` / `max_mp`
 * were undefined. The historical test below documented the bug with a TODO
 * pointing back at this file. The fix added `?? 0` defaults to every numeric
 * base field at the top of `getEffectiveChar`. Per CLAUDE.md:
 *
 *     "NaN w combat = krytyczny bug — waliduj WSZYSTKIE wartości przed
 *      obliczeniami, undefined/null → 0"
 *
 * This block is the regression guard: for EVERY single base numeric field, AND
 * for every combination thereof, the returned effective char must contain only
 * finite numbers — never NaN, never Infinity. If a future refactor reverts the
 * `?? 0` defaults, one of these tests will fail with `expected NaN to be 0`.
 */

describe('getEffectiveChar — NaN hardening (all numeric fields default to 0)', () => {
    beforeEach(() => resetStores());

    it('undefined attack → effective attack = 0 (NOT NaN)', () => {
        const ch = makeCharacter({ attack: undefined as unknown as number });
        const eff = getEffectiveChar(ch);
        expect(eff?.attack).toBe(0);
        expect(Number.isFinite(eff?.attack)).toBe(true);
    });

    it('undefined defense → effective defense = 0', () => {
        const ch = makeCharacter({ defense: undefined as unknown as number });
        const eff = getEffectiveChar(ch);
        expect(eff?.defense).toBe(0);
        expect(Number.isFinite(eff?.defense)).toBe(true);
    });

    it('undefined max_hp → effective max_hp = 0', () => {
        const ch = makeCharacter({ max_hp: undefined as unknown as number });
        const eff = getEffectiveChar(ch);
        expect(eff?.max_hp).toBe(0);
        expect(Number.isFinite(eff?.max_hp)).toBe(true);
    });

    it('undefined max_mp → effective max_mp = 0', () => {
        const ch = makeCharacter({ max_mp: undefined as unknown as number });
        const eff = getEffectiveChar(ch);
        expect(eff?.max_mp).toBe(0);
        expect(Number.isFinite(eff?.max_mp)).toBe(true);
    });

    it('undefined attack_speed → effective attack_speed = 0', () => {
        const ch = makeCharacter({ attack_speed: undefined as unknown as number });
        const eff = getEffectiveChar(ch);
        expect(eff?.attack_speed).toBe(0);
        expect(Number.isFinite(eff?.attack_speed)).toBe(true);
    });

    it('undefined crit_chance → effective crit_chance = 0', () => {
        const ch = makeCharacter({ crit_chance: undefined as unknown as number });
        const eff = getEffectiveChar(ch);
        expect(eff?.crit_chance).toBe(0);
        expect(Number.isFinite(eff?.crit_chance)).toBe(true);
    });

    it('default crit_damage 2.0 when undefined (defensive fallback)', () => {
        const ch = makeCharacter({ crit_damage: undefined as unknown as number });
        const eff = getEffectiveChar(ch);
        // 2.0 (default) + 0 (eq) + 0 (training) = 2.0.
        expect(eff?.crit_damage).toBeCloseTo(2.0, 5);
    });

    it('default hp_regen 0 when undefined (no NaN propagation)', () => {
        const ch = makeCharacter({ hp_regen: undefined as unknown as number });
        const eff = getEffectiveChar(ch);
        expect(eff?.hp_regen).not.toBeNaN();
        expect(eff?.hp_regen).toBeGreaterThanOrEqual(0);
    });

    it('default mp_regen 0 when undefined', () => {
        const ch = makeCharacter({ mp_regen: undefined as unknown as number });
        const eff = getEffectiveChar(ch);
        expect(eff?.mp_regen).not.toBeNaN();
    });

    it('ALL numeric fields undefined → no NaN anywhere in output', () => {
        // Worst-case scenario: a partially-hydrated character right after
        // login or during a save-sync. Every numeric field stripped — the
        // engine must still return all-zeros, never NaN.
        const ch = makeCharacter({
            hp: undefined as unknown as number,
            max_hp: undefined as unknown as number,
            mp: undefined as unknown as number,
            max_mp: undefined as unknown as number,
            attack: undefined as unknown as number,
            defense: undefined as unknown as number,
            attack_speed: undefined as unknown as number,
            crit_chance: undefined as unknown as number,
            crit_damage: undefined as unknown as number,
            hp_regen: undefined as unknown as number,
            mp_regen: undefined as unknown as number,
        });
        const eff = getEffectiveChar(ch);
        expect(eff).not.toBeNull();
        // Every numeric output field MUST be finite.
        for (const key of [
            'attack', 'defense', 'max_hp', 'max_mp',
            'attack_speed', 'crit_chance', 'crit_damage',
            'hp_regen', 'mp_regen',
        ] as const) {
            const v = eff?.[key] as number;
            expect(Number.isFinite(v)).toBe(true);
            expect(Number.isNaN(v)).toBe(false);
        }
    });

    it('cross-permutation: each single undefined field combined with all others present produces no NaN', () => {
        // Iterate every numeric field, leave EVERY OTHER one present, and
        // assert the resulting effective char never has a NaN.
        const allFields: Array<keyof ICharacter> = [
            'attack', 'defense', 'max_hp', 'max_mp',
            'attack_speed', 'crit_chance', 'crit_damage',
            'hp_regen', 'mp_regen',
        ];
        for (const field of allFields) {
            const ch = makeCharacter({ [field]: undefined as unknown as number });
            const eff = getEffectiveChar(ch);
            for (const out of allFields) {
                const v = eff?.[out] as number;
                expect(Number.isNaN(v)).toBe(false);
                expect(Number.isFinite(v)).toBe(true);
            }
        }
    });

    it('null character returns null (no crash)', () => {
        expect(getEffectiveChar(null)).toBeNull();
    });
});

// ── Floor invariant — all returned numeric fields integer-floor ─────────────

describe('getEffectiveChar — floor invariant on derived stats', () => {
    beforeEach(() => resetStores());

    it('max_hp is always an integer (floor of float multiplications)', () => {
        const ch = makeCharacter({ max_hp: 100 });
        const eff = getEffectiveChar(ch);
        expect(Number.isInteger(eff?.max_hp)).toBe(true);
    });

    it('max_mp is always an integer', () => {
        const ch = makeCharacter({ max_mp: 50 });
        const eff = getEffectiveChar(ch);
        expect(Number.isInteger(eff?.max_mp)).toBe(true);
    });

    it('attack is always an integer', () => {
        const ch = makeCharacter({ attack: 20 });
        const eff = getEffectiveChar(ch);
        expect(Number.isInteger(eff?.attack)).toBe(true);
    });

    it('defense is always an integer', () => {
        const ch = makeCharacter({ defense: 10 });
        const eff = getEffectiveChar(ch);
        expect(Number.isInteger(eff?.defense)).toBe(true);
    });
});
