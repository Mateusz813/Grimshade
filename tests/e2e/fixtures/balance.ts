export const GEAR_HP_SCALE = 0.25;

export const scaleGearHp = (gearHp: number): number => Math.floor(gearHp * GEAR_HP_SCALE);

export const effectiveMaxHp = (baseMaxHp: number, gearHp: number): number =>
    baseMaxHp + scaleGearHp(gearHp);

export const TRAIN_HP_PER_LEVEL = 5;

export const DMG_ELIXIR_TIER_MULT = { t100: 1.25, t50: 1.15, t25: 1.08 } as const;

const CLASS_BASE_HP: Record<string, number> = {
    Knight: 150, Mage: 90, Cleric: 115, Archer: 110, Rogue: 100, Necromancer: 88, Bard: 105,
};

const CLASS_HP_PER_LEVEL: Record<string, number> = {
    Knight: 8, Mage: 3, Cleric: 5, Archer: 4, Rogue: 4, Necromancer: 3, Bard: 4,
};

const CLASS_MILESTONE_HP: Record<string, number> = {
    Knight: 30, Mage: 10, Cleric: 15, Archer: 15, Rogue: 15, Necromancer: 12, Bard: 15,
};

export const baseMaxHpFloor = (characterClass: string, highestLevel: number): number => {
    const level = Math.max(1, Math.floor(highestLevel));
    return (CLASS_BASE_HP[characterClass] ?? 0)
        + (CLASS_HP_PER_LEVEL[characterClass] ?? 0) * (level - 1)
        + Math.floor(level / 10) * (CLASS_MILESTONE_HP[characterClass] ?? 0);
};
