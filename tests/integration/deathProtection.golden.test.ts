import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { useInventoryStore } from '../../src/stores/inventoryStore';
import { hasDeathProtection, consumeDeathProtection } from '../../src/systems/deathProtection';
import { applyDeathPenalty } from '../../src/systems/levelSystem';


type Consumables = Record<string, number>;

const CONSUMABLE_CASES: Consumables[] = [
    {},
    { death_protection: 0, amulet_of_loss: 0 },
    { death_protection: 1 },
    { amulet_of_loss: 1 },
    { death_protection: 1, amulet_of_loss: 1 },
    { death_protection: 0, amulet_of_loss: 3 },
    { death_protection: 2, amulet_of_loss: 5 },
    { death_protection: 1, amulet_of_loss: 0, hp_potion_sm: 7 },
    { amulet_of_loss: 0 },
    { death_protection: 0 },
    { hp_potion_sm: 4, mp_potion_sm: 2 },
];

const runHas = (consumables: Consumables): boolean => {
    useInventoryStore.setState({ consumables: { ...consumables } });
    return hasDeathProtection();
};

const runConsume = (consumables: Consumables): {
    isProtected: boolean;
    consumedId: string | null;
    consumables: Consumables;
} => {
    useInventoryStore.setState({ consumables: { ...consumables } });
    const result = consumeDeathProtection();
    const after = { ...useInventoryStore.getState().consumables };
    return { isProtected: result.isProtected, consumedId: result.consumedId, consumables: after };
};

const LEAVE_CASES: Array<[number, number, number | null]> = [
    [1, 0, null],
    [1, 150, 1],
    [1, 0, 5],
    [30, 0, null],
    [41, 0, 41],
    [50, 3000, 50],
    [51, 0, null],
    [100, 0, 100],
    [100, 150000, 200],
    [100, 150000, 50],
    [200, 0, 200],
    [500, 1000, 500],
    [1000, 0, 1000],
    [1000, 400000000, 999],
    [1100, 12000000000, 1100],
];

const runLeave = (level: number, xp: number, highestLevel: number | null): {
    oldLevel: number;
    newLevel: number;
    newXp: number;
    levelsLost: number;
    xpPercent: number;
    skillXpLossPercent: number;
    preservedHighest: number;
    protectionUsed: boolean;
} => {
    const penalty = applyDeathPenalty(level, xp);
    const currentHighest = highestLevel ?? level;
    const preservedHighest = Math.max(currentHighest, level);
    return {
        oldLevel: level,
        newLevel: penalty.newLevel,
        newXp: penalty.newXp,
        levelsLost: penalty.levelsLost,
        xpPercent: penalty.xpPercent,
        skillXpLossPercent: penalty.skillXpLossPercent,
        preservedHighest,
        protectionUsed: false,
    };
};

const buildGolden = (): Record<string, unknown> => ({
    system: 'deathProtection',
    note: 'Generowane z src/systems/deathProtection.ts (+ rdzeń combatLeavePenalty.ts). NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1.',
    hasDeathProtection: CONSUMABLE_CASES.map((consumables) => ({ consumables, value: runHas(consumables) })),
    consumeDeathProtection: CONSUMABLE_CASES.map((consumables) => ({ consumables, result: runConsume(consumables) })),
    computeLeavePenalty: LEAVE_CASES.map(([level, xp, highestLevel]) => ({
        level, xp, highestLevel, result: runLeave(level, xp, highestLevel),
    })),
});

const outPath = resolve(process.cwd(), 'golden/deathProtection.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('deathProtection golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current deathProtection output', () => {
        expect(existsSync(outPath), 'brak golden/deathProtection.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
