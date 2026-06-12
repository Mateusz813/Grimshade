import { describe, it, expect, beforeEach } from 'vitest';
import {
    getTransformDmgMultiplier,
    getTransformFlatHp,
    getTransformFlatMp,
    getTransformFlatAttack,
    getTransformFlatDefense,
    getTransformHpRegenFlat,
    getTransformMpRegenFlat,
    getTransformHpPctMultiplier,
    getTransformMpPctMultiplier,
    getTransformDefPctMultiplier,
    getTransformAtkPctMultiplier,
    getLiveTransformBreakdown,
} from './transformBonuses';
import { useCharacterStore } from '../stores/characterStore';
import { useTransformStore } from '../stores/transformStore';
import { getClassTransformBonuses } from './transformSystem';
import type { ICharacter, TCharacterClass } from '../api/v1/characterApi';

// -- Helpers ------------------------------------------------------------------

const makeChar = (cls: TCharacterClass = 'Knight', overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-tx-test',
    user_id: 'user-1',
    name: 'Test',
    class: cls,
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

const setBaked = (val: boolean): void => {
    useTransformStore.setState({ bakedBonusesApplied: val });
};
const setCompleted = (ids: number[]): void => {
    useTransformStore.setState({ completedTransforms: ids });
};

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar(), isLoading: false });
    useTransformStore.setState({
        completedTransforms: [],
        currentTransformQuest: null,
        bakedBonusesApplied: false,
        pendingClaimTransformId: null,
    });
});

// -- getTransformDmgMultiplier ------------------------------------------------

describe('getTransformDmgMultiplier', () => {
    it('returns 1.0 when there is no character', () => {
        useCharacterStore.setState({ character: null });
        expect(getTransformDmgMultiplier()).toBe(1.0);
    });

    it('returns 1.0 with no completed transforms', () => {
        expect(getTransformDmgMultiplier()).toBe(1.0);
    });

    it('returns 1 + (Σ dmgPercent / 100) for one completed transform', () => {
        // Knight base: dmgPercent: 3. Per spec, dmgPercent is NOT scaled
        // by the tier multiplier (only flat rewards are).
        setCompleted([1]);
        const per = getClassTransformBonuses('Knight', 1);
        expect(getTransformDmgMultiplier()).toBeCloseTo(1 + per.dmgPercent / 100, 5);
    });

    it('stacks additively across completed transforms', () => {
        setCompleted([1, 2, 3]);
        const expected = 1 + (3 + 3 + 3) / 100; // Knight dmgPercent = 3 per transform
        expect(getTransformDmgMultiplier()).toBeCloseTo(expected, 5);
    });

    it('is unaffected by bakedBonusesApplied (always applies)', () => {
        // Even in legacy "baked" mode dmgPercent is read straight from
        // the table per the source comment ("never baked into stats").
        setBaked(true);
        setCompleted([1]);
        const per = getClassTransformBonuses('Knight', 1);
        expect(getTransformDmgMultiplier()).toBeCloseTo(1 + per.dmgPercent / 100, 5);
    });

    it('ignores unknown transform ids gracefully', () => {
        // ID 999 is not in transforms.json — getTransformById returns undefined.
        setCompleted([999]);
        expect(getTransformDmgMultiplier()).toBe(1.0);
    });
});

// -- Flat bonus getters -------------------------------------------------------

describe('getTransformFlatHp', () => {
    it('returns 0 with no completed transforms', () => {
        expect(getTransformFlatHp()).toBe(0);
    });

    it('returns 0 when bonuses are still baked (legacy mode)', () => {
        setBaked(true);
        setCompleted([1, 2, 3]);
        expect(getTransformFlatHp()).toBe(0);
    });

    it('returns 0 when character is null', () => {
        useCharacterStore.setState({ character: null });
        setCompleted([1, 2, 3]);
        expect(getTransformFlatHp()).toBe(0);
    });

    it('sums flatHp from completed transforms (tier-scaled)', () => {
        setCompleted([1]);
        const per = getClassTransformBonuses('Knight', 1);
        expect(getTransformFlatHp()).toBe(per.flatHp);
    });

    it('stacks across multiple transforms', () => {
        setCompleted([1, 2]);
        const t1 = getClassTransformBonuses('Knight', 1).flatHp;
        const t2 = getClassTransformBonuses('Knight', 2).flatHp;
        expect(getTransformFlatHp()).toBe(t1 + t2);
    });
});

describe('getTransformFlatMp', () => {
    it('returns 0 with no transforms', () => {
        expect(getTransformFlatMp()).toBe(0);
    });

    it('sums flatMp across completed transforms', () => {
        setCompleted([1, 2]);
        const t1 = getClassTransformBonuses('Knight', 1).flatMp;
        const t2 = getClassTransformBonuses('Knight', 2).flatMp;
        expect(getTransformFlatMp()).toBe(t1 + t2);
    });
});

describe('getTransformFlatAttack', () => {
    it('returns 0 with no transforms', () => {
        expect(getTransformFlatAttack()).toBe(0);
    });

    it('sums attack across completed transforms', () => {
        setCompleted([1, 2]);
        const t1 = getClassTransformBonuses('Knight', 1).attack;
        const t2 = getClassTransformBonuses('Knight', 2).attack;
        expect(getTransformFlatAttack()).toBe(t1 + t2);
    });

    it('returns 0 for Archer (atkPercent-based class, flat attack=0)', () => {
        useCharacterStore.setState({ character: makeChar('Archer') });
        setCompleted([1, 2, 3]);
        // Archer's `attack` table entry is 0 — confirmed by sourcing the same table.
        expect(getTransformFlatAttack()).toBe(0);
    });
});

describe('getTransformFlatDefense', () => {
    it('returns 0 with no transforms', () => {
        expect(getTransformFlatDefense()).toBe(0);
    });

    it('sums defense across completed transforms', () => {
        setCompleted([1, 2]);
        const t1 = getClassTransformBonuses('Knight', 1).defense;
        const t2 = getClassTransformBonuses('Knight', 2).defense;
        expect(getTransformFlatDefense()).toBe(t1 + t2);
    });
});

describe('getTransformHpRegenFlat', () => {
    it('returns 0 with no transforms', () => {
        expect(getTransformHpRegenFlat()).toBe(0);
    });

    it('sums hpRegenFlat per tier (rounded to 1 decimal in transformSystem)', () => {
        setCompleted([1, 2]);
        const t1 = getClassTransformBonuses('Knight', 1).hpRegenFlat;
        const t2 = getClassTransformBonuses('Knight', 2).hpRegenFlat;
        expect(getTransformHpRegenFlat()).toBeCloseTo(t1 + t2, 5);
    });
});

describe('getTransformMpRegenFlat', () => {
    it('returns 0 with no transforms', () => {
        expect(getTransformMpRegenFlat()).toBe(0);
    });

    it('sums mpRegenFlat across completed transforms', () => {
        setCompleted([1, 2]);
        const t1 = getClassTransformBonuses('Knight', 1).mpRegenFlat;
        const t2 = getClassTransformBonuses('Knight', 2).mpRegenFlat;
        expect(getTransformMpRegenFlat()).toBeCloseTo(t1 + t2, 5);
    });
});

// -- Percent multipliers ------------------------------------------------------

describe('getTransformHpPctMultiplier', () => {
    it('returns 1.0 with no transforms', () => {
        expect(getTransformHpPctMultiplier()).toBe(1.0);
    });

    it('returns 1.0 in legacy baked mode', () => {
        setBaked(true);
        setCompleted([1, 2]);
        expect(getTransformHpPctMultiplier()).toBe(1.0);
    });

    it('returns 1 + Σ hpPercent / 100 for one transform', () => {
        setCompleted([1]);
        // Knight hpPercent = 4 (not scaled by tier multiplier).
        expect(getTransformHpPctMultiplier()).toBeCloseTo(1 + 4 / 100, 5);
    });

    it('stacks additively across transforms', () => {
        setCompleted([1, 2, 3]);
        // 4 + 4 + 4 = 12 -> 1.12
        expect(getTransformHpPctMultiplier()).toBeCloseTo(1 + 12 / 100, 5);
    });
});

describe('getTransformMpPctMultiplier', () => {
    it('returns 1.0 with no transforms', () => {
        expect(getTransformMpPctMultiplier()).toBe(1.0);
    });

    it('returns 1 + Σ mpPercent / 100 for completed transforms', () => {
        setCompleted([1, 2]);
        // Knight mpPercent = 1 per transform -> 2/100
        expect(getTransformMpPctMultiplier()).toBeCloseTo(1 + 2 / 100, 5);
    });
});

describe('getTransformDefPctMultiplier', () => {
    it('returns 1.0 with no transforms', () => {
        expect(getTransformDefPctMultiplier()).toBe(1.0);
    });

    it('returns 1 + Σ defPercent / 100 (Knight = 3/transform)', () => {
        setCompleted([1, 2]);
        expect(getTransformDefPctMultiplier()).toBeCloseTo(1 + 6 / 100, 5);
    });
});

describe('getTransformAtkPctMultiplier', () => {
    it('returns 1.0 for Knight (atkPercent=0)', () => {
        setCompleted([1, 2, 3]);
        expect(getTransformAtkPctMultiplier()).toBe(1.0);
    });

    it('returns 1 + Σ atkPercent / 100 for Archer (atkPercent=7)', () => {
        useCharacterStore.setState({ character: makeChar('Archer') });
        setCompleted([1, 2]);
        // Archer atkPercent = 7 per transform -> 14/100
        expect(getTransformAtkPctMultiplier()).toBeCloseTo(1 + 14 / 100, 5);
    });
});

// -- getLiveTransformBreakdown ------------------------------------------------

describe('getLiveTransformBreakdown', () => {
    it('returns inactive breakdown with no character', () => {
        useCharacterStore.setState({ character: null });
        const b = getLiveTransformBreakdown();
        expect(b.active).toBe(false);
        expect(b.flatHp).toBe(0);
        expect(b.flatMp).toBe(0);
        expect(b.hpPercent).toBe(0);
    });

    it('returns inactive breakdown when bonuses are baked', () => {
        setBaked(true);
        setCompleted([1, 2]);
        const b = getLiveTransformBreakdown();
        expect(b.active).toBe(false);
        expect(b.dmgPercent).toBe(0);
        expect(b.flatHp).toBe(0);
    });

    it('returns inactive breakdown with no completed transforms', () => {
        const b = getLiveTransformBreakdown();
        expect(b.active).toBe(false);
    });

    it('returns active=true and aggregated bonuses when transforms are completed', () => {
        setCompleted([1, 2]);
        const b = getLiveTransformBreakdown();
        expect(b.active).toBe(true);
        // Knight per-transform: dmgPercent=3, hpPercent=4, mpPercent=1,
        // defPercent=3, atkPercent=0.
        expect(b.dmgPercent).toBe(6);
        expect(b.hpPercent).toBe(8);
        expect(b.mpPercent).toBe(2);
        expect(b.defPercent).toBe(6);
        expect(b.atkPercent).toBe(0);
        const t1 = getClassTransformBonuses('Knight', 1);
        const t2 = getClassTransformBonuses('Knight', 2);
        expect(b.flatHp).toBe(t1.flatHp + t2.flatHp);
        expect(b.flatMp).toBe(t1.flatMp + t2.flatMp);
        expect(b.flatAttack).toBe(t1.attack + t2.attack);
        expect(b.flatDefense).toBe(t1.defense + t2.defense);
        expect(b.hpRegenFlat).toBeCloseTo(t1.hpRegenFlat + t2.hpRegenFlat, 5);
        expect(b.mpRegenFlat).toBeCloseTo(t1.mpRegenFlat + t2.mpRegenFlat, 5);
    });

    it('reflects class-specific bonus tables (Archer atkPercent=7)', () => {
        useCharacterStore.setState({ character: makeChar('Archer') });
        setCompleted([1]);
        const b = getLiveTransformBreakdown();
        expect(b.atkPercent).toBe(7);
        // Archer's table sets `attack: 0` so flatAttack should be 0
        // — bonus comes from atkPercent instead.
        expect(b.flatAttack).toBe(0);
    });
});
