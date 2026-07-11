import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { useInventoryStore } from '../../src/stores/inventoryStore';
import { hasDeathProtection, consumeDeathProtection } from '../../src/systems/deathProtection';
import { applyDeathPenalty } from '../../src/systems/levelSystem';

// ============================================================================
// GOLDEN-VECTOR EXPORT + GUARD dla deathProtection.ts (+ portowalny rdzeń
// combatLeavePenalty.ts).
//
// deathProtection.ts czyta/mutuje Zustand `inventoryStore` (getter + consumer).
// Zgodnie z regułą getterów: generator USTAWIA stan store (setState) przed
// wywołaniem, a PHP odtwarza to czystą funkcją biorącą mapę `consumables`
// jawnie. `consumeDeathProtection` zapisujemy wraz z mapą PO zużyciu, żeby
// backend zwrócił NOWĄ mapę (bez side effectów) i dało się porównać 1:1.
//
// combatLeavePenalty.ts to niemal same side effecty (deathsApi / Supabase
// keepalive / stores / death overlay) — POMINIĘTE. Portujemy tylko jego rdzeń
// numeryczny: opuszczenie walki = PEŁNA kara śmierci (applyDeathPenalty),
// z pominięciem ochrony (protectionUsed=false) i zachowaniem highest_level.
//
// Regeneracja + kopia do backendu:
//   UPDATE_GOLDEN=1 npx vitest run tests/integration/deathProtection.golden.test.ts
//   cp golden/deathProtection.json ../grimshade-backend/tests/Golden/fixtures/
// ============================================================================

type Consumables = Record<string, number>;

// Reprezentatywne + brzegowe mapy consumables (zera, brak klucza, priorytet,
// wielokrotne sztuki, inne pozycje które muszą zostać nietknięte).
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

// Opuszczenie walki: (level, xp, highest_level|null). Brzegowe: zera, grace
// item-loss (≤50 vs 51), highest > level, highest < level (anomalia →
// preservedHighest = level), poziomy 1/100/1000/1100.
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

// Rdzeń applyCombatLeaveDeath (linie 113-122 + 177-187 combatLeavePenalty.ts):
// pełna kara śmierci + zachowany highest + ochrona zawsze pominięta.
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
        // Normalizacja przez JSON (usuwa -0) — wzór lootSystem. Parytet nienaruszony.
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
