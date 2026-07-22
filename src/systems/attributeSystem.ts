import classesData from '../data/classes.json';
import type { TCharacterClass as CharacterClass } from '../types/character';

export type TAttributeStat = 'attack' | 'hp' | 'defense';

export const ATTRIBUTE_POINT_PCT = 0.1;

export const ATTRIBUTE_LEVEL_INTERVAL = 10;

export const ATTRIBUTE_DEF_CAP_PCT: Record<CharacterClass, number> = {
    Knight:      10,
    Cleric:      8,
    Archer:      6,
    Rogue:       6,
    Bard:        6,
    Necromancer: 4,
    Mage:        3,
};

export interface IAttributeAllocation {
    attackPoints: number;
    hpPoints: number;
    defensePoints: number;
}

export interface IAttributeMultipliers {
    attack: number;
    hp: number;
    defense: number;
}

export const EMPTY_ATTRIBUTE_ALLOCATION: IAttributeAllocation = {
    attackPoints: 0,
    hpPoints: 0,
    defensePoints: 0,
};

export const getAttributePointsForLevel = (highestLevel: number): number =>
    Math.floor(Math.max(1, Math.floor(highestLevel || 1)) / ATTRIBUTE_LEVEL_INTERVAL);

export const getMaxDefensePoints = (characterClass: CharacterClass): number =>
    Math.round((ATTRIBUTE_DEF_CAP_PCT[characterClass] ?? 5) / ATTRIBUTE_POINT_PCT);

export const getAttributeMultipliers = (
    allocation: IAttributeAllocation,
    characterClass: CharacterClass,
): IAttributeMultipliers => {
    const pct = ATTRIBUTE_POINT_PCT / 100;
    const defPoints = Math.min(
        Math.max(0, allocation.defensePoints ?? 0),
        getMaxDefensePoints(characterClass),
    );
    return {
        attack:  1 + Math.max(0, allocation.attackPoints ?? 0) * pct,
        hp:      1 + Math.max(0, allocation.hpPoints ?? 0) * pct,
        defense: 1 + defPoints * pct,
    };
};

export const getSpentAttributePoints = (allocation: IAttributeAllocation): number =>
    Math.max(0, allocation.attackPoints ?? 0)
    + Math.max(0, allocation.hpPoints ?? 0)
    + Math.max(0, allocation.defensePoints ?? 0);

interface IClassEntry {
    id: string;
    baseStats: { hp: number; mp: number; attack: number; defense: number };
}

export const getClassBaseStats = (characterClass: CharacterClass): { attack: number; defense: number } => {
    const entry = (classesData as IClassEntry[]).find((c) => c.id === characterClass);
    return { attack: entry?.baseStats.attack ?? 0, defense: entry?.baseStats.defense ?? 0 };
};
