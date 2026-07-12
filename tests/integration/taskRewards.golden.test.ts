import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { computeTaskRewards, getEffectiveTaskXpPerKill } from '../../src/systems/taskRewards';
import monstersData from '../../src/data/monsters.json';


type Row = { level: number; xp: number; gold: [number, number] };
const rows = monstersData as Row[];
const lt300 = rows.filter((m) => m.level < 300).sort((a, b) => a.level - b.level);
const ge300 = rows.filter((m) => m.level >= 300).sort((a, b) => a.level - b.level);

const picks: Row[] = [
    lt300[0],
    lt300[Math.floor(lt300.length / 2)],
    lt300[lt300.length - 1],
    ge300[0],
    ge300[Math.floor(ge300.length / 2)],
    ge300[ge300.length - 1],
].map((m) => ({ level: m.level, xp: m.xp, gold: m.gold }));

const KILLS = [1, 10, 100, 5000];

const buildGolden = (): Record<string, unknown> => ({
    system: 'taskRewards',
    note: 'Generowane z src/systems/taskRewards.ts + realne monsters.json. NIE edytuj ręcznie.',
    getEffectiveTaskXpPerKill: picks.map((monster) => ({ monster, value: getEffectiveTaskXpPerKill(monster) })),
    computeTaskRewards: picks.flatMap((monster) =>
        KILLS.map((kills) => ({ monster, kills, result: computeTaskRewards(monster, kills) })),
    ),
});

const outPath = resolve(process.cwd(), 'golden/taskRewards.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('taskRewards golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current taskRewards output', () => {
        expect(existsSync(outPath), 'brak golden/taskRewards.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(computed).toEqual(fixture);
    });
});
