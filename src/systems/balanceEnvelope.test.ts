import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getEffectiveChar } from './combatEngine';
import { calculateDamage, applyMonsterRarity, calculateAttackInterval, mitigateDamage, defMitigation, DEF_CAP, CRIT_MULT_MIN, CRIT_MULT_MAX } from './combat';
import { getAtkDamageMultiplier } from './combatElixirs';
import { getTransformDmgMultiplier } from './transformBonuses';
import { CLASS_MODIFIER } from './combatViewHelpers';
import { skillTierMult, getCombatSkillUpgradeMultiplier } from './skillSystem';
import { EMPTY_EQUIPMENT, getClassSkillBonus, type IEquipment, type IInventoryItem, type Rarity } from './itemSystem';
import { generateWeapon, generateOffhand, generateArmor, generateAccessory } from './itemGenerator';
import { BOSS_HP_MULTIPLIER, BOSS_ATK_MULTIPLIER, BOSS_DEF_MULTIPLIER } from './bossSystem';
import { ATTRIBUTE_LEVEL_INTERVAL } from './attributeSystem';
import { useCharacterStore } from '../stores/characterStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useSkillStore } from '../stores/skillStore';
import { useBuffStore } from '../stores/buffStore';
import { useTransformStore } from '../stores/transformStore';
import { useAttributeStore } from '../stores/attributeStore';
import monstersData from '../data/monsters.json';
import bossesData from '../data/bosses.json';
import classesData from '../data/classes.json';
import type { ICharacter } from '../api/v1/characterApi';
import type { TCharacterClass } from '../types/character';
import type { TMonsterRarity } from './lootSystem';

interface IMonsterRow {
    id: string;
    level: number;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
}

const MONSTERS = monstersData as IMonsterRow[];
const BOSSES = bossesData as Array<{ id: string; level: number; hp: number; attack: number; defense: number }>;

const ALL_CLASSES: TCharacterClass[] = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'];

const ARMOR_PREFIX: Record<TCharacterClass, string> = {
    Knight: 'heavy', Mage: 'magic', Cleric: 'magic', Necromancer: 'magic',
    Archer: 'light', Rogue: 'light', Bard: 'light',
};
const WEAPON_TYPE: Record<TCharacterClass, string> = {
    Knight: 'sword', Mage: 'staff', Cleric: 'holy_wand', Archer: 'bow',
    Rogue: 'dagger', Necromancer: 'dead_staff', Bard: 'harp',
};
const OFFHAND_TYPE: Record<TCharacterClass, string> = {
    Knight: 'shield', Mage: 'spellbook', Cleric: 'holy_cross', Archer: 'quiver',
    Rogue: 'dagger', Necromancer: 'voodoo_doll', Bard: 'talisman',
};

const BASE_HP_PER_LEVEL: Record<TCharacterClass, number> = {
    Knight: 8, Mage: 3, Cleric: 5, Archer: 4, Rogue: 4, Necromancer: 3, Bard: 4,
};
const MILESTONE_HP: Record<TCharacterClass, number> = {
    Knight: 30, Mage: 10, Cleric: 15, Archer: 15, Rogue: 15, Necromancer: 12, Bard: 15,
};

const classBase = (cls: TCharacterClass) => {
    const entry = (classesData as Array<{ id: string; baseStats: { hp: number; mp: number; attack: number; defense: number } }>)
        .find((c) => c.id === cls);
    return entry?.baseStats ?? { hp: 0, mp: 0, attack: 0, defense: 0 };
};

const nearest = <T extends { level: number }>(rows: T[], level: number): T =>
    rows.reduce((best, r) => (Math.abs(r.level - level) < Math.abs(best.level - level) ? r : best), rows[0]);

const nearestMonster = (level: number): IMonsterRow => nearest(MONSTERS, level);
const nearestBoss = (level: number) => nearest(BOSSES, level);

interface ILoadoutOpts {
    transforms?: number;
    elixirs?: boolean;
    attributePointsIntoAttack?: number;
    weaponSkillLevel?: number;
}

const ARMOR_SLOTS = ['helmet', 'armor', 'pants', 'shoulders', 'boots', 'gloves'] as const;

const buildEquipment = (cls: TCharacterClass, level: number, rarity: Rarity, upgrade: number): IEquipment => {
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
        const eq: IEquipment = { ...EMPTY_EQUIPMENT };
        const stamp = (item: IInventoryItem | null): IInventoryItem | null =>
            item ? { ...item, upgradeLevel: upgrade } : null;

        for (const slot of ARMOR_SLOTS) {
            eq[slot] = stamp(generateArmor(ARMOR_PREFIX[cls], slot, level, rarity));
        }
        eq.mainHand = stamp(generateWeapon(WEAPON_TYPE[cls], level, rarity));
        eq.offHand = cls === 'Rogue'
            ? stamp(generateWeapon(WEAPON_TYPE[cls], level, rarity))
            : stamp(generateOffhand(OFFHAND_TYPE[cls], level, rarity));
        eq.ring1 = stamp(generateAccessory('ring', level, rarity));
        eq.ring2 = stamp(generateAccessory('ring', level, rarity));
        eq.necklace = stamp(generateAccessory('necklace', level, rarity));
        eq.earrings = stamp(generateAccessory('earrings', level, rarity));
        return eq;
    } finally {
        rng.mockRestore();
    }
};

const makeCharacter = (cls: TCharacterClass, level: number): ICharacter => {
    const base = classBase(cls);
    const milestones = Math.floor(level / 10);
    return {
        id: 'balance-char', user_id: 'balance-user', name: 'Envelope', class: cls,
        level, xp: 0,
        hp: base.hp + BASE_HP_PER_LEVEL[cls] * (level - 1) + milestones * MILESTONE_HP[cls],
        max_hp: base.hp + BASE_HP_PER_LEVEL[cls] * (level - 1) + milestones * MILESTONE_HP[cls],
        mp: 500, max_mp: 500,
        attack: base.attack + milestones,
        defense: base.defense + milestones,
        attack_speed: 0, crit_chance: 0.05, crit_damage: 2.0, magic_level: 0,
        hp_regen: 0, mp_regen: 0, gold: 0,
        stat_points: 0, highest_level: level,
        equipment: {}, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    } as ICharacter;
};

interface IBuiltChar {
    eff: ICharacter;
    weaponMid: number;
    skillBonus: number;
    maxCrit: number;
    damageMultiplier: number;
}

const build = (
    cls: TCharacterClass,
    level: number,
    rarity: Rarity,
    upgrade: number,
    contentLevel: number,
    opts: ILoadoutOpts = {},
): IBuiltChar => {
    const character = makeCharacter(cls, level);
    const equipment = buildEquipment(cls, level, rarity, upgrade);

    useCharacterStore.setState({ character, isLoading: false });
    useInventoryStore.setState({ ...useInventoryStore.getState(), equipment, consumables: {}, stones: {} });

    const wsLevel = opts.weaponSkillLevel ?? 0;
    useSkillStore.setState({ ...useSkillStore.getState(), skillLevels: wsLevel > 0 ? { sword_fighting: wsLevel, distance_fighting: wsLevel, dagger_fighting: wsLevel, magic_level: wsLevel, bard_level: wsLevel } : {} });

    useTransformStore.setState({
        ...useTransformStore.getState(),
        completedTransforms: Array.from({ length: opts.transforms ?? 0 }, (_, i) => i + 1),
    });

    const attrPoints = opts.attributePointsIntoAttack ?? 0;
    useAttributeStore.setState({ attackPoints: attrPoints, hpPoints: 0, defensePoints: 0, migrationVersion: 1 });

    useBuffStore.setState({ ...useBuffStore.getState(), allBuffs: [] });
    if (opts.elixirs) {
        const b = useBuffStore.getState();
        for (const effect of ['atk_dmg_100', 'spell_dmg_100', 'atk_boost_50', 'hp_boost_500', 'hp_pct_25', 'attack_speed']) {
            b.addBuff({ id: effect, name: effect, icon: '', effect } as never, 60 * 60_000);
        }
    }

    const eff = getEffectiveChar(character, contentLevel);
    if (!eff) throw new Error('getEffectiveChar returned null');

    const weapon = equipment.mainHand;
    const wMin = weapon?.bonuses.dmg_min ?? 0;
    const wMax = weapon?.bonuses.dmg_max ?? wMin;
    const enh = 1 + 0.10 * upgrade;

    const classBonus = getClassSkillBonus(cls, useSkillStore.getState().skillLevels);
    const maxCritEntry = (classesData as Array<{ id: string; maxCrit?: number }>).find((c) => c.id === cls);

    return {
        eff,
        weaponMid: ((wMin + wMax) / 2) * enh,
        skillBonus: classBonus.skillBonus,
        maxCrit: maxCritEntry?.maxCrit ?? 1,
        damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
    };
};

const basicHit = (b: IBuiltChar, enemyDefense: number, level: number): number =>
    calculateDamage({
        baseAtk: b.eff.attack,
        weaponAtk: b.weaponMid,
        skillBonus: b.skillBonus,
        classModifier: CLASS_MODIFIER[b.eff.class] ?? 1,
        enemyDefense,
        attackerLevel: level,
        isCrit: false,
        playerSource: true,
        damageMultiplier: b.damageMultiplier,
    }).finalDamage;

const BEST_SKILL_COEFF = 15;
const skillHit = (b: IBuiltChar, enemyDefense: number, level: number, skillUpgrade: number): number =>
    Math.floor(basicHit(b, enemyDefense, level) * skillTierMult(BEST_SKILL_COEFF) * getCombatSkillUpgradeMultiplier(skillUpgrade));

const incomingHit = (b: IBuiltChar, monsterAttack: number, monsterLevel: number): number =>
    mitigateDamage(monsterAttack, b.eff.defense, monsterLevel, false);

const hitsToDie = (b: IBuiltChar, monsterAttack: number, monsterLevel: number): number =>
    b.eff.max_hp / incomingHit(b, monsterAttack, monsterLevel);

const SKILL_COOLDOWN_S = 20;
const dps = (b: IBuiltChar, enemyDefense: number, level: number, skillUpgrade: number): number => {
    const hit = basicHit(b, enemyDefense, level);
    const interval = calculateAttackInterval(b.eff.attack_speed) / 1000;
    const dual = b.eff.class === 'Rogue' ? 1.2 : 1.0;
    return (hit * dual) / interval + skillHit(b, enemyDefense, level, skillUpgrade) / SKILL_COOLDOWN_S;
};

const ttkSeconds = (b: IBuiltChar, hp: number, def: number, level: number, skillUpgrade: number): number =>
    hp / dps(b, def, level, skillUpgrade);

beforeEach(() => {
    useCharacterStore.setState({ character: null, isLoading: false });
    useInventoryStore.setState({ ...useInventoryStore.getState(), equipment: { ...EMPTY_EQUIPMENT }, consumables: {}, stones: {} });
    useSkillStore.setState({ ...useSkillStore.getState(), skillLevels: {} });
    useBuffStore.setState({ ...useBuffStore.getState(), allBuffs: [] });
    useTransformStore.setState({ ...useTransformStore.getState(), completedTransforms: [] });
    useAttributeStore.setState({ attackPoints: 0, hpPoints: 0, defensePoints: 0, migrationVersion: 1 });
});

afterEach(() => {
    vi.restoreAllMocks();
});


describe('Balance envelope — starting zone (L1-10, no gear progression yet)', () => {
    it.each(ALL_CLASSES)('%s at L1 in common+0 kills a level-1 monster in a sane number of hits', (cls) => {
        const mob = nearestMonster(1);
        const b = build(cls, 1, 'common', 0, 1);
        const hit = basicHit(b, mob.defense, 1);

        expect(hit).toBeGreaterThanOrEqual(4);
        const hitsToKill = mob.hp / hit;
        expect(hitsToKill).toBeGreaterThan(1);
        expect(hitsToKill).toBeLessThanOrEqual(40);
    });

    it.each(ALL_CLASSES)('%s at L1 survives at least 8 hits from a level-1 monster', (cls) => {
        const mob = nearestMonster(1);
        const b = build(cls, 1, 'common', 0, 1);
        expect(hitsToDie(b, mob.attack, mob.level)).toBeGreaterThanOrEqual(8);
    });
});


describe('Balance envelope — no one-shot invariant', () => {
    const LEVELS = [1, 5, 10, 25, 50, 100, 200, 350, 500, 750, 1000];

    it.each(LEVELS)('a level-matched normal monster never one-shots a common+0 character at L%i', (level) => {
        for (const cls of ALL_CLASSES) {
            const mob = nearestMonster(level);
            const b = build(cls, level, 'common', 0, level);
            expect(incomingHit(b, mob.attack, mob.level), `${cls} L${level}`).toBeLessThan(b.eff.max_hp);
        }
    });

    it.each(LEVELS)('every class can kill a level-matched normal monster at L%i (finite, bounded TTK)', (level) => {
        for (const cls of ALL_CLASSES) {
            const mob = nearestMonster(level);
            const b = build(cls, level, 'common', 0, level);
            const ttk = ttkSeconds(b, mob.hp, mob.defense, level, 0);
            expect(Number.isFinite(ttk), `${cls} L${level}`).toBe(true);
            expect(ttk, `${cls} L${level}`).toBeLessThan(180);
        }
    });
});


describe('Balance envelope — damage bands per level and gear', () => {
    interface IBand {
        level: number;
        rarity: Rarity;
        upgrade: number;
        skillUpgrade: number;
        transforms: number;
        basic: [number, number];
        skill: [number, number];
        hp: [number, number];
    }

    const BANDS: IBand[] = [
        { level: 100,  rarity: 'mythic', upgrade: 0, skillUpgrade: 5,  transforms: 2,  basic: [320, 820],    skill: [650, 1700],    hp: [1450, 4900] },
        { level: 350,  rarity: 'mythic', upgrade: 0, skillUpgrade: 5,  transforms: 6,  basic: [700, 1900],   skill: [1400, 3900],   hp: [5300, 20200] },
        { level: 350,  rarity: 'heroic', upgrade: 7, skillUpgrade: 10, transforms: 6,  basic: [1200, 3400],  skill: [2700, 7400],   hp: [8400, 28500] },
        { level: 1000, rarity: 'heroic', upgrade: 7, skillUpgrade: 15, transforms: 11, basic: [2800, 7900],  skill: [6400, 18100],  hp: [25000, 91500] },
    ];

    for (const band of BANDS) {
        describe(`L${band.level} ${band.rarity}+${band.upgrade} skills+${band.skillUpgrade}`, () => {
            it.each(ALL_CLASSES)('%s basic hit stays inside the band', (cls) => {
                const mob = nearestMonster(band.level);
                const b = build(cls, band.level, band.rarity, band.upgrade, band.level, {
                    transforms: band.transforms,
                    attributePointsIntoAttack: Math.floor(band.level / ATTRIBUTE_LEVEL_INTERVAL),
                });
                const hit = basicHit(b, mob.defense, band.level);
                expect(hit).toBeGreaterThanOrEqual(band.basic[0]);
                expect(hit).toBeLessThanOrEqual(band.basic[1]);
            });

            it.each(ALL_CLASSES)('%s skill hit stays inside the band', (cls) => {
                const mob = nearestMonster(band.level);
                const b = build(cls, band.level, band.rarity, band.upgrade, band.level, {
                    transforms: band.transforms,
                    attributePointsIntoAttack: Math.floor(band.level / ATTRIBUTE_LEVEL_INTERVAL),
                });
                const hit = skillHit(b, mob.defense, band.level, band.skillUpgrade);
                expect(hit).toBeGreaterThanOrEqual(band.skill[0]);
                expect(hit).toBeLessThanOrEqual(band.skill[1]);
            });

            it.each(ALL_CLASSES)('%s max HP stays inside the band', (cls) => {
                const b = build(cls, band.level, band.rarity, band.upgrade, band.level, {
                    transforms: band.transforms,
                    attributePointsIntoAttack: Math.floor(band.level / ATTRIBUTE_LEVEL_INTERVAL),
                });
                expect(b.eff.max_hp).toBeGreaterThanOrEqual(band.hp[0]);
                expect(b.eff.max_hp).toBeLessThanOrEqual(band.hp[1]);
            });
        });
    }
});


describe('Balance envelope — incoming damage and survivability', () => {
    const HARD_DEF_MITIGATION_CEILING = 0.75;

    it.each([1, 25, 100, 350, 1000])('even a fully geared tank never mitigates more than 75 percent at L%i', (level) => {
        for (const cls of ALL_CLASSES) {
            const b = build(cls, level, 'heroic', 30, level, { transforms: 11 });
            const mob = nearestMonster(level);
            const mitigation = defMitigation(b.eff.defense, mob.level);
            expect(mitigation, `${cls} L${level}`).toBeLessThanOrEqual(HARD_DEF_MITIGATION_CEILING);
            expect(DEF_CAP).toBeLessThanOrEqual(HARD_DEF_MITIGATION_CEILING);
            expect(incomingHit(b, mob.attack, mob.level), `${cls} L${level}`)
                .toBeGreaterThanOrEqual(Math.floor(mob.attack * (1 - HARD_DEF_MITIGATION_CEILING)));
        }
    });

    it.each([100, 350, 1000])('a level-matched normal monster needs 40-200 hits to kill a mythic+0 character at L%i', (level) => {
        const mob = nearestMonster(level);
        for (const cls of ALL_CLASSES) {
            const b = build(cls, level, 'mythic', 0, level, { transforms: Math.min(11, Math.round(level / 60)) });
            const hits = hitsToDie(b, mob.attack, mob.level);
            expect(hits, `${cls} L${level} -> ${hits.toFixed(1)} hits`).toBeGreaterThanOrEqual(40);
            expect(hits, `${cls} L${level} -> ${hits.toFixed(1)} hits`).toBeLessThanOrEqual(200);
        }
    });

    it('the tank takes meaningfully more hits to kill than the squishiest caster', () => {
        const mob = nearestMonster(350);
        const knight = build('Knight', 350, 'mythic', 0, 350, { transforms: 6 });
        const mage = build('Mage', 350, 'mythic', 0, 350, { transforms: 6 });
        const ratio = hitsToDie(knight, mob.attack, mob.level) / hitsToDie(mage, mob.attack, mob.level);
        expect(ratio).toBeGreaterThan(1.5);
        expect(ratio).toBeLessThan(6);
    });
});


describe('Balance envelope — tuning-knob contracts', () => {
    it('skillTierMult never exceeds 2x a basic hit, however high the skill coefficient', () => {
        for (const coeff of [1, 3, 6, 9, 12, 15, 50, 999]) {
            expect(skillTierMult(coeff), `coeff ${coeff}`).toBeLessThanOrEqual(2.0);
        }
        expect(skillTierMult(0)).toBe(0);
    });

    it('the skill upgrade curve has diminishing returns and an asymptote below 1.5x', () => {
        expect(getCombatSkillUpgradeMultiplier(0)).toBe(1);
        for (const u of [1, 5, 10, 20, 50, 200]) {
            expect(getCombatSkillUpgradeMultiplier(u), `+${u}`).toBeLessThan(1.5);
        }
        const step1 = getCombatSkillUpgradeMultiplier(2) - getCombatSkillUpgradeMultiplier(1);
        const step2 = getCombatSkillUpgradeMultiplier(20) - getCombatSkillUpgradeMultiplier(19);
        expect(step2).toBeLessThan(step1);
    });

    it.each([0, 5, 10, 15, 30])('a skill hit stays between 1.6x and 2.6x a basic hit at +%i', (skillUpgrade) => {
        const mob = nearestMonster(350);
        for (const cls of ALL_CLASSES) {
            const b = build(cls, 350, 'mythic', 0, 350, { transforms: 6 });
            const ratio = skillHit(b, mob.defense, 350, skillUpgrade) / basicHit(b, mob.defense, 350);
            expect(ratio, `${cls} +${skillUpgrade} -> ${ratio.toFixed(2)}x`).toBeGreaterThanOrEqual(1.6);
            expect(ratio, `${cls} +${skillUpgrade} -> ${ratio.toFixed(2)}x`).toBeLessThanOrEqual(2.6);
        }
    });
});


describe('Balance envelope — TTK per monster rarity', () => {
    const RARITIES: TMonsterRarity[] = ['normal', 'strong', 'epic', 'legendary', 'boss'];
    const TTK_BAND: Record<TMonsterRarity, [number, number]> = {
        normal:    [2, 30],
        strong:    [3, 45],
        epic:      [5, 80],
        legendary: [8, 140],
        boss:      [15, 300],
    };

    for (const level of [100, 350, 1000]) {
        it.each(RARITIES)(`L${level} mythic+0 kills a %s monster within the TTK band`, (rarity) => {
            const baseMob = nearestMonster(level);
            const scaled = applyMonsterRarity(
                { hp: baseMob.hp, attack: baseMob.attack, defense: baseMob.defense, xp: 1, gold: [1, 1] } as never,
                rarity,
            ) as unknown as { hp: number; defense: number };

            for (const cls of ALL_CLASSES) {
                const b = build(cls, level, 'mythic', 0, level, {
                    transforms: Math.min(11, Math.round(level / 60)),
                    attributePointsIntoAttack: Math.floor(level / ATTRIBUTE_LEVEL_INTERVAL),
                });
                const ttk = ttkSeconds(b, scaled.hp, scaled.defense, level, 5);
                const [lo, hi] = TTK_BAND[rarity];
                expect(ttk, `${cls} L${level} ${rarity} -> ${ttk.toFixed(1)}s`).toBeGreaterThanOrEqual(lo);
                expect(ttk, `${cls} L${level} ${rarity} -> ${ttk.toFixed(1)}s`).toBeLessThanOrEqual(hi);
            }
        });
    }
});


describe('Balance envelope — boss fights stay in minutes, not seconds or hours', () => {
    for (const level of [100, 350, 1000]) {
        it(`L${level} boss solo TTK is between 1 and 12 minutes for every class at mythic+0`, () => {
            const boss = nearestBoss(level);
            const hp = Math.floor(boss.hp * BOSS_HP_MULTIPLIER);
            const def = Math.floor(boss.defense * BOSS_DEF_MULTIPLIER);

            for (const cls of ALL_CLASSES) {
                const b = build(cls, level, 'mythic', 0, level, {
                    transforms: Math.min(11, Math.round(level / 60)),
                    attributePointsIntoAttack: Math.floor(level / ATTRIBUTE_LEVEL_INTERVAL),
                });
                const minutes = ttkSeconds(b, hp, def, level, 5) / 60;
                expect(minutes, `${cls} L${level} -> ${minutes.toFixed(1)} min`).toBeGreaterThanOrEqual(1);
                expect(minutes, `${cls} L${level} -> ${minutes.toFixed(1)} min`).toBeLessThanOrEqual(12);
            }
        });

        it(`L${level} boss does not one-shot a mythic+0 character`, () => {
            const boss = nearestBoss(level);
            const bossHit = Math.floor(boss.attack * BOSS_ATK_MULTIPLIER);
            for (const cls of ALL_CLASSES) {
                const b = build(cls, level, 'mythic', 0, level, {
                    transforms: Math.min(11, Math.round(level / 60)),
                });
                expect(b.eff.max_hp, `${cls} L${level}`).toBeGreaterThan(bossHit * 2);
            }
        });
    }
});


describe('Balance envelope — progression monotonicity', () => {
    const RARITY_LADDER: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic', 'heroic'];

    it.each(ALL_CLASSES)('%s: higher rarity never lowers the basic hit at L350', (cls) => {
        const mob = nearestMonster(350);
        let previous = 0;
        for (const rarity of RARITY_LADDER) {
            const b = build(cls, 350, rarity, 0, 350);
            const hit = basicHit(b, mob.defense, 350);
            expect(hit, `${cls} ${rarity}`).toBeGreaterThanOrEqual(previous);
            previous = hit;
        }
    });

    it.each(ALL_CLASSES)('%s: higher enhancement never lowers the basic hit at L350 mythic', (cls) => {
        const mob = nearestMonster(350);
        let previous = 0;
        for (const upgrade of [0, 3, 5, 7, 10, 15, 20, 30]) {
            const b = build(cls, 350, 'mythic', upgrade, 350);
            const hit = basicHit(b, mob.defense, 350);
            expect(hit, `${cls} +${upgrade}`).toBeGreaterThanOrEqual(previous);
            previous = hit;
        }
    });

    it.each(ALL_CLASSES)('%s: more transforms never lower the basic hit at L1000', (cls) => {
        const mob = nearestMonster(1000);
        let previous = 0;
        for (const transforms of [0, 3, 6, 9, 11]) {
            const b = build(cls, 1000, 'mythic', 0, 1000, { transforms });
            const hit = basicHit(b, mob.defense, 1000);
            expect(hit, `${cls} tf${transforms}`).toBeGreaterThanOrEqual(previous);
            previous = hit;
        }
    });

    const MONOTONIC_TOLERANCE = 0.01;

    it('monster HP never regresses by more than rounding noise as levels rise', () => {
        const byLevel = [...MONSTERS].sort((a, b) => a.level - b.level);
        for (let i = 1; i < byLevel.length; i++) {
            const label = `${byLevel[i - 1].id}(L${byLevel[i - 1].level}) -> ${byLevel[i].id}(L${byLevel[i].level})`;
            expect(byLevel[i].hp, label).toBeGreaterThanOrEqual(byLevel[i - 1].hp * (1 - MONOTONIC_TOLERANCE));
        }
    });

    it('monster attack never regresses as levels rise', () => {
        const byLevel = [...MONSTERS].sort((a, b) => a.level - b.level);
        for (let i = 1; i < byLevel.length; i++) {
            const label = `${byLevel[i - 1].id}(L${byLevel[i - 1].level}) -> ${byLevel[i].id}(L${byLevel[i].level})`;
            expect(byLevel[i].attack, label).toBeGreaterThanOrEqual(byLevel[i - 1].attack * (1 - MONOTONIC_TOLERANCE));
        }
    });

    it('boss HP and attack never regress as levels rise', () => {
        const byLevel = [...BOSSES].sort((a, b) => a.level - b.level);
        for (let i = 1; i < byLevel.length; i++) {
            const label = `${byLevel[i - 1].id}(L${byLevel[i - 1].level}) -> ${byLevel[i].id}(L${byLevel[i].level})`;
            expect(byLevel[i].hp, label).toBeGreaterThanOrEqual(byLevel[i - 1].hp * (1 - MONOTONIC_TOLERANCE));
            expect(byLevel[i].attack, label).toBeGreaterThanOrEqual(byLevel[i - 1].attack * (1 - MONOTONIC_TOLERANCE));
        }
    });
});


describe('Balance envelope — temporary multipliers stay bounded', () => {
    it.each(ALL_CLASSES)('%s: full elixir stack never more than triples the basic hit at L350', (cls) => {
        const mob = nearestMonster(350);
        const plain = build(cls, 350, 'mythic', 0, 350, { transforms: 6 });
        const plainHit = basicHit(plain, mob.defense, 350);

        const buffed = build(cls, 350, 'mythic', 0, 350, { transforms: 6, elixirs: true });
        const buffedHit = basicHit(buffed, mob.defense, 350);

        expect(buffedHit).toBeGreaterThanOrEqual(plainHit);
        expect(buffedHit / plainHit).toBeLessThanOrEqual(3);
    });

    it('crit multiplier band is exactly 1.5x - 2.5x', () => {
        expect(CRIT_MULT_MIN).toBe(1.5);
        expect(CRIT_MULT_MAX).toBe(2.5);
        expect(CRIT_MULT_MAX / CRIT_MULT_MIN).toBeLessThanOrEqual(2);
    });

    it.each(ALL_CLASSES)('%s: a full transform stack never more than doubles the basic hit at L1000', (cls) => {
        const mob = nearestMonster(1000);
        const none = build(cls, 1000, 'mythic', 0, 1000, { transforms: 0 });
        const full = build(cls, 1000, 'mythic', 0, 1000, { transforms: 11 });
        const ratio = basicHit(full, mob.defense, 1000) / basicHit(none, mob.defense, 1000);
        expect(ratio).toBeGreaterThanOrEqual(1);
        expect(ratio).toBeLessThanOrEqual(2);
    });
});
