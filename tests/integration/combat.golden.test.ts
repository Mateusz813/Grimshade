import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
    calculateDamage,
    calculateDualWieldDamage,
    calculateSkillDamageWithMlvl,
    calculateSkillDamage,
    calculateAttackInterval,
    calculateDeathPenalty,
    applyDeathPenalty,
    getSpeedMultiplier,
    getMonsterAttackRange,
    applyMonsterRarity,
    getSpeedScaledCooldownMs,
    type ICombatParams,
    type CombatSpeed,
    type TMonsterRarity,
} from '../../src/systems/combat';


const DAMAGE_CASES: ICombatParams[] = [
    { baseAtk: 50, weaponAtk: 30, skillBonus: 0, classModifier: 1, enemyDefense: 20, attackerLevel: 20, isCrit: false, critRoll: 0.5 },
    { baseAtk: 50, weaponAtk: 30, skillBonus: 10, classModifier: 1, enemyDefense: 20, attackerLevel: 20, isCrit: true, critRoll: 0.5 },
    { baseAtk: 50, weaponAtk: 30, skillBonus: 0, classModifier: 1, enemyDefense: 100, attackerLevel: 100, isCrit: false, critRoll: 0.5 },
    { baseAtk: 50, weaponAtk: 30, skillBonus: 0, classModifier: 1, enemyDefense: 200, attackerLevel: 100, isCrit: false, critRoll: 0.5 },
    { baseAtk: 50, weaponAtk: 30, skillBonus: 0, classModifier: 1, enemyDefense: 300, attackerLevel: 100, isCrit: true, critRoll: 0.75 },
    { baseAtk: 10, weaponAtk: 5, skillBonus: 0, classModifier: 1, enemyDefense: 999, attackerLevel: 1, isCrit: false, critRoll: 0.5 },
    { baseAtk: 100, weaponAtk: 50, skillBonus: 25, classModifier: 1.3, enemyDefense: 40, attackerLevel: 40, isCrit: true, critRoll: 0.5, damageMultiplier: 1.5 },
    { baseAtk: 80, weaponAtk: 40, skillBonus: 0, classModifier: 1, enemyDefense: 10, attackerLevel: 10, isCrit: false, critRoll: 0.5, damageMultiplier: 0.5 },
];

const DUAL_CASES: Array<ICombatParams & { offHandAtk: number }> = [
    { baseAtk: 40, weaponAtk: 60, offHandAtk: 50, skillBonus: 0, classModifier: 1, enemyDefense: 15, attackerLevel: 15, isCrit: false, critRoll: 0.5 },
    { baseAtk: 40, weaponAtk: 60, offHandAtk: 50, skillBonus: 0, classModifier: 1, enemyDefense: 15, attackerLevel: 15, isCrit: true, critRoll: 0.5 },
];

const MLVL_CASES: Array<[number, number, number, number]> = [[100, 50, 20, 1], [100, 0, 20, 1.3], [50, 25, 200, 1]];
const SKILL_DMG_CASES: Array<[number, number, number, number]> = [[80, 2.5, 20, 1], [80, 1, 200, 1.3], [50, 3, 10, 1]];
const INTERVAL_CASES = [0.5, 1, 2, 3, 4, 8];
const DEATH_CASES: Array<[number, number, number, number]> = [
    [1, 1000, 300, 5000], [5, 500, 3354, 2000], [20, 0, 50000, 10000], [50, 100, 106066, 20000],
    [100, 5000, 300000, 50000], [300, 0, 25000000, 100000], [1000, 0, 897150000, 500000],
];
const LEGACY_DEATH_CASES: Array<[number, number, number]> = [[1000, 5000, 20000], [0, 300, 100], [500, 1000, 5000]];
const SPEED_CASES: CombatSpeed[] = ['x1', 'x2', 'x4'];
const RANGE_CASES = [
    { attack: 100 }, { attack: 100, attack_min: 90, attack_max: 130 }, { attack: 5 }, { attack: 0 },
];
const RARITY_BASE = { hp: 200, attack: 50, defense: 20, xp: 100, gold: [10, 40] as [number, number] };
const RARITIES: TMonsterRarity[] = ['normal', 'strong', 'epic', 'legendary', 'boss'];
const CD_CASES: Array<[number, number]> = [[5000, 1], [5000, 2], [5000, 4], [8000, 3], [0, 2], [5000, 0.5]];

const buildGolden = (): Record<string, unknown> => ({
    system: 'combat',
    note: 'Generowane z src/systems/combat.ts (czysty podzbiór). NIE edytuj ręcznie.',
    calculateDamage: DAMAGE_CASES.map((params) => ({ params, result: calculateDamage(params) })),
    calculateDualWieldDamage: DUAL_CASES.map((params) => ({ params, result: calculateDualWieldDamage(params) })),
    calculateSkillDamageWithMlvl: MLVL_CASES.map(([d, m, e, c]) => ({ args: [d, m, e, c], value: calculateSkillDamageWithMlvl(d, m, e, c) })),
    calculateSkillDamage: SKILL_DMG_CASES.map(([a, s, e, c]) => ({ args: [a, s, e, c], value: calculateSkillDamage(a, s, e, c) })),
    calculateAttackInterval: INTERVAL_CASES.map((speed) => ({ speed, value: calculateAttackInterval(speed) })),
    calculateDeathPenalty: DEATH_CASES.map(([l, xp, next, sxp]) => ({ args: [l, xp, next, sxp], result: calculateDeathPenalty(l, xp, next, sxp) })),
    applyDeathPenalty: LEGACY_DEATH_CASES.map(([xp, lxp, sxp]) => ({ args: [xp, lxp, sxp], result: applyDeathPenalty(xp, lxp, sxp) })),
    getSpeedMultiplier: SPEED_CASES.map((speed) => ({ speed, value: getSpeedMultiplier(speed) })),
    getMonsterAttackRange: RANGE_CASES.map((monster) => ({ monster, result: getMonsterAttackRange(monster) })),
    applyMonsterRarity: RARITIES.map((rarity) => ({ rarity, result: applyMonsterRarity(RARITY_BASE, rarity) })),
    getSpeedScaledCooldownMs: CD_CASES.map(([cd, mult]) => ({ cd, mult, value: getSpeedScaledCooldownMs(cd, mult) })),
});

const outPath = resolve(process.cwd(), 'golden/combat.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('combat golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current combat output', () => {
        expect(existsSync(outPath), 'brak golden/combat.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(computed).toEqual(fixture);
    });
});
