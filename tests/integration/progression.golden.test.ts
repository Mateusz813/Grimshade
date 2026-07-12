import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getMonsterUnlockStatus, type IMonsterLike } from '../../src/systems/progression';
import type { IMasteryData } from '../../src/stores/masteryStore';


const MONSTERS: IMonsterLike[] = [
    { id: 'rat', level: 1, name_pl: 'Szczur' },
    { id: 'wolf', level: 5, name_pl: 'Wilk' },
    { id: 'bear', level: 10, name_pl: 'Niedźwiedź' },
];

type Case = { label: string; monsterId: string; characterLevel: number; masteries: Record<string, IMasteryData> };
const CASES: Case[] = [
    { label: 'first-ok', monsterId: 'rat', characterLevel: 5, masteries: {} },
    { label: 'level-gate', monsterId: 'bear', characterLevel: 5, masteries: {} },
    { label: 'mastery-locked', monsterId: 'wolf', characterLevel: 10, masteries: {} },
    { label: 'mastery-locked-0', monsterId: 'wolf', characterLevel: 10, masteries: { rat: { level: 0 } } },
    { label: 'mastery-unlocked', monsterId: 'wolf', characterLevel: 10, masteries: { rat: { level: 1 } } },
    { label: 'bear-mastery-locked', monsterId: 'bear', characterLevel: 10, masteries: { rat: { level: 5 } } },
    { label: 'bear-unlocked', monsterId: 'bear', characterLevel: 10, masteries: { rat: { level: 5 }, wolf: { level: 3 } } },
];

const project = (monsterId: string, characterLevel: number, masteries: Record<string, IMasteryData>) => {
    const monster = MONSTERS.find((m) => m.id === monsterId)!;
    const r = getMonsterUnlockStatus(monster, MONSTERS, characterLevel, masteries);
    return {
        unlocked: r.unlocked,
        lockKind: r.lockKind ?? null,
        requiredMonsterId: r.requiredMonster?.id ?? null,
    };
};

const buildGolden = (): Record<string, unknown> => ({
    system: 'progression',
    note: 'Generowane z src/systems/progression.ts (podzbiór autorytatywny getMonsterUnlockStatus). NIE edytuj ręcznie.',
    getUnlockState: CASES.map((c) => ({
        label: c.label, monsterId: c.monsterId, characterLevel: c.characterLevel, masteries: c.masteries,
        result: project(c.monsterId, c.characterLevel, c.masteries),
    })),
});

const outPath = resolve(process.cwd(), 'golden/progression.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('progression golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current progression output', () => {
        expect(existsSync(outPath), 'brak golden/progression.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
