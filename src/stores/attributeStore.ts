import { create } from 'zustand';
import type { TCharacterClass as CharacterClass } from '../types/character';
import {
    EMPTY_ATTRIBUTE_ALLOCATION,
    getAttributeMultipliers,
    getMaxDefensePoints,
    type IAttributeAllocation,
    type IAttributeMultipliers,
    type TAttributeStat,
} from '../systems/attributeSystem';

export const ATTRIBUTE_MIGRATION_VERSION = 1;

interface IAttributeState extends IAttributeAllocation {
    migrationVersion: number;
    allocate: (stat: TAttributeStat, points: number, characterClass: CharacterClass) => number;
    resetAllocation: () => void;
    getAllocation: () => IAttributeAllocation;
    getMultipliers: (characterClass: CharacterClass) => IAttributeMultipliers;
}

export const useAttributeStore = create<IAttributeState>((set, get) => ({
    ...EMPTY_ATTRIBUTE_ALLOCATION,
    migrationVersion: 0,

    allocate: (stat, points, characterClass) => {
        const requested = Math.max(0, Math.floor(points));
        if (requested <= 0) return 0;
        const state = get();

        if (stat === 'defense') {
            const cap = getMaxDefensePoints(characterClass);
            const applied = Math.min(requested, Math.max(0, cap - state.defensePoints));
            if (applied <= 0) return 0;
            set({ defensePoints: state.defensePoints + applied });
            return applied;
        }

        const key = stat === 'attack' ? 'attackPoints' : 'hpPoints';
        set({ [key]: state[key] + requested } as Partial<IAttributeState>);
        return requested;
    },

    resetAllocation: () => set({ ...EMPTY_ATTRIBUTE_ALLOCATION }),

    getAllocation: () => {
        const { attackPoints, hpPoints, defensePoints } = get();
        return { attackPoints, hpPoints, defensePoints };
    },

    getMultipliers: (characterClass) => getAttributeMultipliers(get().getAllocation(), characterClass),
}));
