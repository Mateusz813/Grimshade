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
    getDisplayTransformBreakdown,
} from './transformBonuses';
import { useCharacterStore } from '../stores/characterStore';
import { useTransformStore } from '../stores/transformStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useSkillStore } from '../stores/skillStore';
import { getClassTransformBonuses, getCumulativeTransformBonuses } from './transformSystem';
import { getEffectiveChar } from './combatEngine';
import { EMPTY_EQUIPMENT } from './itemSystem';
import type { ICharacter, TCharacterClass } from '../api/v1/characterApi';


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


describe('getTransformDmgMultiplier', () => {
    it('returns 1.0 when there is no character', () => {
        useCharacterStore.setState({ character: null });
        expect(getTransformDmgMultiplier()).toBe(1.0);
    });

    it('returns 1.0 with no completed transforms', () => {
        expect(getTransformDmgMultiplier()).toBe(1.0);
    });

    it('returns 1 + (Σ dmgPercent / 100) for one completed transform', () => {
        setCompleted([1]);
        const per = getClassTransformBonuses('Knight', 1);
        expect(getTransformDmgMultiplier()).toBeCloseTo(1 + per.dmgPercent / 100, 5);
    });

    it('stacks additively across completed transforms', () => {
        setCompleted([1, 2, 3]);
        const expected = 1 + (3 + 3 + 3) / 100;
        expect(getTransformDmgMultiplier()).toBeCloseTo(expected, 5);
    });

    it('is unaffected by bakedBonusesApplied (always applies)', () => {
        setBaked(true);
        setCompleted([1]);
        const per = getClassTransformBonuses('Knight', 1);
        expect(getTransformDmgMultiplier()).toBeCloseTo(1 + per.dmgPercent / 100, 5);
    });

    it('ignores unknown transform ids gracefully', () => {
        setCompleted([999]);
        expect(getTransformDmgMultiplier()).toBe(1.0);
    });
});


describe('getTransformFlatHp', () => {
    it('returns 0 with no completed transforms', () => {
        expect(getTransformFlatHp()).toBe(0);
    });

    it('2026-06-24: STILL applies flatHp even when bakedBonusesApplied=true (always live)', () => {
        setBaked(true);
        setCompleted([1, 2, 3]);
        expect(getTransformFlatHp()).toBeGreaterThan(0);
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


describe('getTransformHpPctMultiplier', () => {
    it('returns 1.0 with no transforms', () => {
        expect(getTransformHpPctMultiplier()).toBe(1.0);
    });

    it('2026-06-24: STILL returns the multiplier when bakedBonusesApplied=true (always live)', () => {
        setBaked(true);
        setCompleted([1, 2]);
        expect(getTransformHpPctMultiplier()).toBeGreaterThan(1.0);
    });

    it('returns 1 + Σ hpPercent / 100 for one transform', () => {
        setCompleted([1]);
        expect(getTransformHpPctMultiplier()).toBeCloseTo(1 + 4 / 100, 5);
    });

    it('stacks additively across transforms', () => {
        setCompleted([1, 2, 3]);
        expect(getTransformHpPctMultiplier()).toBeCloseTo(1 + 12 / 100, 5);
    });
});

describe('getTransformMpPctMultiplier', () => {
    it('returns 1.0 with no transforms', () => {
        expect(getTransformMpPctMultiplier()).toBe(1.0);
    });

    it('returns 1 + Σ mpPercent / 100 for completed transforms', () => {
        setCompleted([1, 2]);
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
        expect(getTransformAtkPctMultiplier()).toBeCloseTo(1 + 14 / 100, 5);
    });
});


describe('getLiveTransformBreakdown', () => {
    it('returns inactive breakdown with no character', () => {
        useCharacterStore.setState({ character: null });
        const b = getLiveTransformBreakdown();
        expect(b.active).toBe(false);
        expect(b.flatHp).toBe(0);
        expect(b.flatMp).toBe(0);
        expect(b.hpPercent).toBe(0);
    });

    it('2026-06-24: returns ACTIVE breakdown with real values even when baked=true', () => {
        setBaked(true);
        setCompleted([1, 2]);
        const b = getLiveTransformBreakdown();
        expect(b.active).toBe(true);
        expect(b.flatHp).toBeGreaterThan(0);
    });

    it('returns inactive breakdown with no completed transforms', () => {
        const b = getLiveTransformBreakdown();
        expect(b.active).toBe(false);
    });

    it('returns active=true and aggregated bonuses when transforms are completed', () => {
        setCompleted([1, 2]);
        const b = getLiveTransformBreakdown();
        expect(b.active).toBe(true);
        expect(b.baked).toBe(false);
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
        expect(b.flatAttack).toBe(0);
    });
});


describe('getDisplayTransformBreakdown', () => {
    it('returns inactive (all-zero) breakdown with no character', () => {
        useCharacterStore.setState({ character: null });
        setCompleted([1, 2]);
        const b = getDisplayTransformBreakdown();
        expect(b.active).toBe(false);
        expect(b.flatHp).toBe(0);
        expect(b.hpPercent).toBe(0);
    });

    it('returns inactive breakdown with no completed transforms', () => {
        const b = getDisplayTransformBreakdown();
        expect(b.active).toBe(false);
    });

    it('(1) a completed-transform character gets NON-ZERO cumulative bonuses', () => {
        setCompleted([1, 2]);
        const cum = getCumulativeTransformBonuses([1, 2], 'Knight');
        const b = getDisplayTransformBreakdown();
        expect(b.active).toBe(true);
        expect(b.baked).toBe(false);
        expect(b.flatHp).toBe(cum.flatHp);
        expect(b.flatMp).toBe(cum.flatMp);
        expect(b.flatAttack).toBe(cum.attack);
        expect(b.flatDefense).toBe(cum.defense);
        expect(b.hpPercent).toBe(cum.hpPercent);
        expect(b.mpPercent).toBe(cum.mpPercent);
        expect(b.defPercent).toBe(cum.defPercent);
        expect(b.atkPercent).toBe(cum.atkPercent);
        expect(b.dmgPercent).toBe(cum.dmgPercent);
        expect(b.hpRegenFlat).toBeCloseTo(cum.hpRegenFlat, 5);
        expect(b.mpRegenFlat).toBeCloseTo(cum.mpRegenFlat, 5);
        expect(b.flatHp).toBeGreaterThan(0);
        expect(b.hpPercent).toBeGreaterThan(0);
    });

    it('(3) legacy baked save still surfaces the SAME cumulative values, flagged baked', () => {
        setBaked(true);
        setCompleted([1, 2]);
        const cum = getCumulativeTransformBonuses([1, 2], 'Knight');
        const b = getDisplayTransformBreakdown();
        expect(b.active).toBe(true);
        expect(b.baked).toBe(true);
        expect(b.flatHp).toBe(cum.flatHp);
        expect(b.hpPercent).toBe(cum.hpPercent);
        expect(b.flatAttack).toBe(cum.attack);
        expect(b.dmgPercent).toBe(cum.dmgPercent);
        const live = getLiveTransformBreakdown();
        expect(live.active).toBe(true);
        expect(live.flatHp).toBe(cum.flatHp);
    });

    it('reflects class-specific tables (Archer atkPercent stacks, flat attack=0)', () => {
        useCharacterStore.setState({ character: makeChar('Archer') });
        setCompleted([1, 2]);
        const cum = getCumulativeTransformBonuses([1, 2], 'Archer');
        const b = getDisplayTransformBreakdown();
        expect(b.active).toBe(true);
        expect(b.atkPercent).toBe(cum.atkPercent);
        expect(b.atkPercent).toBeGreaterThan(0);
        expect(b.flatAttack).toBe(0);
    });
});


describe('Bug 8 – no double-count regression (net effective stat)', () => {
    const computeLiveMaxHp = (baseMaxHp: number): number => {
        const raw = baseMaxHp + getTransformFlatHp();
        return Math.floor(raw * getTransformHpPctMultiplier());
    };

    it('(2) LIVE: net max HP = base + transform applied exactly once', () => {
        setCompleted([1, 2]);
        const baseMaxHp = 1000;
        useCharacterStore.setState({ character: makeChar('Knight', { max_hp: baseMaxHp }) });

        const cum = getCumulativeTransformBonuses([1, 2], 'Knight');
        const expected = Math.floor((baseMaxHp + cum.flatHp) * (1 + cum.hpPercent / 100));

        expect(computeLiveMaxHp(baseMaxHp)).toBe(expected);
        expect(computeLiveMaxHp(baseMaxHp)).toBeGreaterThan(baseMaxHp);
        expect(computeLiveMaxHp(computeLiveMaxHp(baseMaxHp))).not.toBe(computeLiveMaxHp(baseMaxHp));
    });

    it('(3) 2026-06-24: base is PURE, so transform applies live exactly ONCE even when baked=true', () => {
        setBaked(true);
        setCompleted([1, 2]);
        const baseMaxHp = 1234;
        useCharacterStore.setState({ character: makeChar('Knight', { max_hp: baseMaxHp }) });

        expect(getTransformFlatHp()).toBeGreaterThan(0);
        expect(getTransformHpPctMultiplier()).toBeGreaterThan(1.0);
        const cum = getCumulativeTransformBonuses([1, 2], 'Knight');
        expect(computeLiveMaxHp(baseMaxHp)).toBe(Math.floor((baseMaxHp + cum.flatHp) * (1 + cum.hpPercent / 100)));
    });

    it('LIVE attack: net = floor((base + flatAtk) * atkPctMul) once (Archer)', () => {
        setCompleted([1, 2]);
        const baseAtk = 200;
        useCharacterStore.setState({ character: makeChar('Archer', { attack: baseAtk }) });

        const cum = getCumulativeTransformBonuses([1, 2], 'Archer');
        const raw = baseAtk + getTransformFlatAttack();
        const net = Math.floor(raw * getTransformAtkPctMultiplier());
        const expected = Math.floor((baseAtk + cum.attack) * (1 + cum.atkPercent / 100));

        expect(net).toBe(expected);
        expect(net).toBeGreaterThan(baseAtk);
    });
});


describe('PART D – transform bonuses apply LIVE through getEffectiveChar', () => {
    beforeEach(() => {
        useInventoryStore.setState({
            bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [], gold: 0,
            consumables: {}, stones: {},
        });
        useSkillStore.setState({ skillLevels: {}, skillXp: {} } as never);
    });

    it('max_mp = base + transform flat/pct when completed + bakedBonusesApplied=false', () => {
        const baseMaxMp = 1314;
        useCharacterStore.setState({
            character: makeChar('Mage', { max_mp: baseMaxMp, max_hp: 524 }),
        });
        useTransformStore.setState({ bakedBonusesApplied: false });
        setCompleted([1, 2]);

        const cum = getCumulativeTransformBonuses([1, 2], 'Mage');
        const eff = getEffectiveChar(useCharacterStore.getState().character)!;

        const expectedMaxMp = Math.floor((baseMaxMp + cum.flatMp) * (1 + cum.mpPercent / 100));
        expect(eff.max_mp).toBe(expectedMaxMp);
        expect(eff.max_mp).toBeGreaterThan(baseMaxMp);
    });

    it('2026-06-24: applies the bonus even when bakedBonusesApplied=true (base is pure → no double)', () => {
        const baseMaxMp = 1314;
        useCharacterStore.setState({
            character: makeChar('Mage', { max_mp: baseMaxMp, max_hp: 524 }),
        });
        useTransformStore.setState({ bakedBonusesApplied: true });
        setCompleted([1, 2]);

        const cum = getCumulativeTransformBonuses([1, 2], 'Mage');
        const eff = getEffectiveChar(useCharacterStore.getState().character)!;
        expect(eff.max_mp).toBe(Math.floor((baseMaxMp + cum.flatMp) * (1 + cum.mpPercent / 100)));
        expect(eff.max_mp).toBeGreaterThan(baseMaxMp);
    });

    it('BEFORE vs AFTER transform: ATK/DEF/HP/MP/HPregen/MPregen ALL increase', () => {
        useCharacterStore.setState({
            character: makeChar('Knight', {
                max_hp: 1000, max_mp: 300, attack: 200, defense: 150,
                hp_regen: 5, mp_regen: 2,
            }),
        });
        useTransformStore.setState({ bakedBonusesApplied: false });

        setCompleted([]);
        const before = getEffectiveChar(useCharacterStore.getState().character)!;

        setCompleted([1, 2, 3]);
        const after = getEffectiveChar(useCharacterStore.getState().character)!;

        expect(after.attack).toBeGreaterThan(before.attack);
        expect(after.defense).toBeGreaterThan(before.defense);
        expect(after.max_hp).toBeGreaterThan(before.max_hp);
        expect(after.max_mp).toBeGreaterThan(before.max_mp);
        expect(after.hp_regen).toBeGreaterThan(before.hp_regen);
        expect(after.mp_regen).toBeGreaterThan(before.mp_regen);
    });

    it('2026-06-24: getEffectiveChar.mp_regen includes TRAINING (symmetric with hp_regen)', () => {
        setCompleted([]);
        useTransformStore.setState({ bakedBonusesApplied: false });
        useSkillStore.setState({ skillLevels: { hp_regen: 100, mp_regen: 100 }, skillXp: {} } as never);
        useCharacterStore.setState({
            character: makeChar('Mage', { hp_regen: 1, mp_regen: 1 }),
        });
        const eff = getEffectiveChar(useCharacterStore.getState().character)!;
        expect(eff.hp_regen).toBeGreaterThan(1);
        expect(eff.mp_regen).toBeGreaterThan(1);
    });
});
