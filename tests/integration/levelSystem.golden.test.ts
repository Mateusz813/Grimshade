import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
    xpToNextLevel,
    totalXpForLevel,
    statPointsForLevelUp,
    processXpGain,
    getDeathLossLevels,
    getFleeLossLevels,
    losesItemsOnDeath,
    applyDeathPenalty,
    applyFleePenalty,
    applyDeathXpPenalty,
    xpProgress,
} from '../../src/systems/levelSystem';

// ============================================================================
// GOLDEN-VECTOR EXPORT + GUARD dla levelSystem.
//
// Żyje w tests/integration/ (nie w src), bo używa API node (fs) do zapisu
// fixture — tsconfig.app typechecku je tylko `src`, więc tu node jest OK,
// a vitest i tak łapie tests/integration.
//
// Dwie role:
//  1. UPDATE_GOLDEN=1 → GENERUJE golden/levelSystem.json z realnych funkcji.
//  2. Normalnie → GUARD: asertuje, że commitowany fixture == aktualny output TS.
//     Zmiana formuły w TS bez regeneracji → ten test zczerwienieje.
//
// Fixture jest kopiowany do backendu (grimshade-backend/tests/Golden/fixtures/
// levelSystem.json), gdzie Pest odtwarza go w PHP → parytet TS↔PHP.
//
// Regeneracja + kopia do backendu:
//   UPDATE_GOLDEN=1 npx vitest run tests/integration/levelSystem.golden.test.ts
//   cp golden/levelSystem.json ../grimshade-backend/tests/Golden/fixtures/
//
// UWAGA: poziomy ≤1100 — powyżej xpToNextLevel przekracza 2^53 (bezpieczna
// precyzja int JS), co mogłoby dać rozjazd z PHP na ostatnim bicie.
// ============================================================================

const LEVELS = [0, 1, 2, 3, 5, 10, 25, 50, 99, 100, 101, 150, 199, 200, 201, 300, 400, 500, 600, 700, 800, 900, 999, 1000, 1001, 1010, 1050, 1100];
const TOTAL_LEVELS = [1, 2, 10, 100, 101, 200, 500, 1000, 1001];
const DEATH_LEVELS = [1, 20, 41, 50, 51, 100, 200, 500, 1000, 1100];
const CLASSES = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard', 'Unknown', ''];

const XP_GAIN_CASES: Array<[number, number, number]> = [
    [1, 0, 299], [1, 0, 300], [1, 0, 1000], [5, 299, 1], [10, 0, 100000],
    [50, 100, 50000], [99, 0, 300000], [100, 0, 600000], [100, 299999, 1],
    [200, 0, 30000000], [999, 0, 900000000], [1000, 0, 2000000000],
    [1000, 500000000, 897150000], [1, 0, 0],
];

const DEATH_POS_CASES: Array<[number, number]> = [
    [1, 0], [1, 150], [41, 0], [50, 3000], [51, 0], [100, 0], [100, 150000],
    [200, 0], [500, 1000], [1000, 0], [1000, 400000000], [1100, 12000000000],
];

const LEGACY_XP_CASES: Array<[number, number]> = [
    [1000, 1], [300000, 100], [0, 50], [5000, 10], [250, 5],
];

const XP_PROGRESS_CASES: Array<[number, number]> = [
    [0, 1], [150, 1], [300, 1], [150000, 100], [450000000, 1000], [0, 0],
];

const buildGolden = (): Record<string, unknown> => ({
    system: 'levelSystem',
    note: 'Generowane z src/systems/levelSystem.ts. NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1.',
    xpToNextLevel: LEVELS.map((level) => ({ level, value: xpToNextLevel(level) })),
    totalXpForLevel: TOTAL_LEVELS.map((level) => ({ level, value: totalXpForLevel(level) })),
    statPointsForLevelUp: CLASSES.map((cls) => ({ class: cls, value: statPointsForLevelUp(cls) })),
    processXpGain: XP_GAIN_CASES.map(([level, xp, gained]) => ({ level, xp, gained, result: processXpGain(level, xp, gained) })),
    getDeathLossLevels: DEATH_LEVELS.map((level) => ({ level, value: getDeathLossLevels(level) })),
    getFleeLossLevels: DEATH_LEVELS.map((level) => ({ level, value: getFleeLossLevels(level) })),
    losesItemsOnDeath: DEATH_LEVELS.map((level) => ({ level, value: losesItemsOnDeath(level) })),
    applyDeathPenalty: DEATH_POS_CASES.map(([level, xp]) => ({ level, xp, result: applyDeathPenalty(level, xp) })),
    applyFleePenalty: DEATH_POS_CASES.map(([level, xp]) => ({ level, xp, result: applyFleePenalty(level, xp) })),
    applyDeathXpPenalty: LEGACY_XP_CASES.map(([xp, level]) => ({ xp, level, value: applyDeathXpPenalty(xp, level) })),
    xpProgress: XP_PROGRESS_CASES.map(([xp, level]) => ({ xp, level, value: xpProgress(xp, level) })),
});

const outPath = resolve(process.cwd(), 'golden/levelSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('levelSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current levelSystem output', () => {
        expect(existsSync(outPath), 'brak golden/levelSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(computed).toEqual(fixture);
    });
});
