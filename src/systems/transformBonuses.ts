
import { useCharacterStore } from '../stores/characterStore';
import { useTransformStore } from '../stores/transformStore';
import { getClassTransformBonuses, getCumulativeTransformBonuses, getTransformById } from './transformSystem';
import type { TCharacterClass } from '../api/v1/characterApi';
import type { ITransformPermanentBonuses } from './transformSystem';

const ZERO_BONUS: ITransformPermanentBonuses = {
    hpPercent: 0, mpPercent: 0, defPercent: 0, dmgPercent: 0, atkPercent: 0,
    flatHp: 0, flatMp: 0, attack: 0, defense: 0,
    hpRegen: 0, mpRegen: 0, hpRegenFlat: 0, mpRegenFlat: 0,
    classSkillBonus: 0,
};

const sumCompletedBonuses = (): ITransformPermanentBonuses => {
    try {
        const char = useCharacterStore.getState().character;
        if (!char) return { ...ZERO_BONUS };
        const store = useTransformStore.getState();
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

export const getTransformFlatHp = (): number => sumCompletedBonuses().flatHp;

export const getTransformFlatMp = (): number => sumCompletedBonuses().flatMp;

export const getTransformFlatAttack = (): number => sumCompletedBonuses().attack;

export const getTransformFlatDefense = (): number => sumCompletedBonuses().defense;

export const getTransformHpRegenFlat = (): number => sumCompletedBonuses().hpRegenFlat;

export const getTransformMpRegenFlat = (): number => sumCompletedBonuses().mpRegenFlat;

export const getTransformHpPctMultiplier = (): number => {
    const pct = sumCompletedBonuses().hpPercent;
    if (pct <= 0) return 1.0;
    return 1 + pct / 100;
};

export const getTransformMpPctMultiplier = (): number => {
    const pct = sumCompletedBonuses().mpPercent;
    if (pct <= 0) return 1.0;
    return 1 + pct / 100;
};

export const getTransformDefPctMultiplier = (): number => {
    const pct = sumCompletedBonuses().defPercent;
    if (pct <= 0) return 1.0;
    return 1 + pct / 100;
};

export const getTransformAtkPctMultiplier = (): number => {
    const pct = sumCompletedBonuses().atkPercent;
    if (pct <= 0) return 1.0;
    return 1 + pct / 100;
};

export interface ILiveTransformBreakdown {
    dmgPercent: number;
    hpPercent: number;
    mpPercent: number;
    defPercent: number;
    atkPercent: number;
    flatHp: number;
    flatMp: number;
    flatAttack: number;
    flatDefense: number;
    hpRegenFlat: number;
    mpRegenFlat: number;
    active: boolean;
    baked: boolean;
}

const zeroBreakdown = (baked: boolean): ILiveTransformBreakdown => ({
    dmgPercent: 0, hpPercent: 0, mpPercent: 0, defPercent: 0, atkPercent: 0,
    flatHp: 0, flatMp: 0, flatAttack: 0, flatDefense: 0,
    hpRegenFlat: 0, mpRegenFlat: 0, active: false, baked,
});

const mapBreakdown = (b: ITransformPermanentBonuses, active: boolean, baked: boolean): ILiveTransformBreakdown => ({
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
    active,
    baked,
});

export const getLiveTransformBreakdown = (): ILiveTransformBreakdown => {
    try {
        const store = useTransformStore.getState();
        const char = useCharacterStore.getState().character;
        if (!char || store.completedTransforms.length === 0) {
            return zeroBreakdown(false);
        }
        return mapBreakdown(sumCompletedBonuses(), true, false);
    } catch {
        return zeroBreakdown(false);
    }
};

export const getDisplayTransformBreakdown = (): ILiveTransformBreakdown => {
    try {
        const store = useTransformStore.getState();
        const char = useCharacterStore.getState().character;
        if (!char || store.completedTransforms.length === 0) {
            return zeroBreakdown(store.bakedBonusesApplied);
        }
        const cls = char.class as TCharacterClass;
        const b = getCumulativeTransformBonuses(store.completedTransforms, cls);
        return mapBreakdown(b as ITransformPermanentBonuses, true, store.bakedBonusesApplied);
    } catch {
        return zeroBreakdown(false);
    }
};
