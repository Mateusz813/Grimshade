// ── Helpers ───────────────────────────────────────────────────────────────────

/** Coerces any value to a finite number, returning `fallback` for NaN/Infinity/null/undefined. */
const safeN = (v: number | null | undefined, fallback = 0): number => {
    const n = Number(v ?? fallback);
    return isFinite(n) ? n : fallback;
};

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface ICombatParams {
    baseAtk: number;
    weaponAtk: number;
    skillBonus: number;
    classModifier: number;
    enemyDefense: number;
    isCrit?: boolean;
    isBlocked?: boolean;
    isDodged?: boolean;
    critChance?: number;
    critDmg?: number;
    blockChance?: number;
    dodgeChance?: number;
    maxCritChance?: number;
    /**
     * Final damage multiplier applied after base / crit / block calculations.
     * Used by combat elixirs (attack damage, spell damage). Defaults to 1.0.
     */
    damageMultiplier?: number;
}

export interface ICombatResult {
    damage: number;
    isCrit: boolean;
    isBlocked: boolean;
    isDodged: boolean;
    finalDamage: number;
}

export interface ISkillEffect {
    skillId: string;
    damage: number;
    mpCost: number;
    cooldown: number;
    effect: string | null;
    mlvlBonus?: number;
}

export interface IAutoAttackParams {
    attackSpeed: number;
    baseInterval: number;
}

// ── Dual Wield result (Rogue) ─────────────────────────────────────────────────

export interface IDualWieldResult {
    hit1: ICombatResult;
    hit2: ICombatResult;
    totalDamage: number;
}

// ── Core calculations ─────────────────────────────────────────────────────────

export const calculateDamage = (params: ICombatParams): ICombatResult => {
    const baseAtk      = safeN(params.baseAtk);
    const weaponAtk    = safeN(params.weaponAtk);
    const skillBonus   = safeN(params.skillBonus);
    const classMod     = safeN(params.classModifier, 1);
    const enemyDef     = safeN(params.enemyDefense);
    const critChance   = safeN(params.critChance, 0.05);
    const critDmgMult  = safeN(params.critDmg, 2.0);
    const blockChance  = safeN(params.blockChance, 0);
    const dodgeChance  = safeN(params.dodgeChance, 0);
    const maxCrit      = safeN(params.maxCritChance, 1.0);

    // Cap crit chance at class maximum
    const effectiveCritChance = Math.min(critChance, maxCrit);

    const baseDamage = (baseAtk + weaponAtk + skillBonus) * classMod;
    let finalDamage  = Math.max(1, baseDamage - enemyDef);

    // Roll dodge first (complete miss)
    const isDodged = params.isDodged ?? Math.random() < dodgeChance;
    if (isDodged) {
        return {
            damage: Math.max(1, Math.floor(baseDamage - enemyDef)),
            isCrit: false,
            isBlocked: false,
            isDodged: true,
            finalDamage: 0,
        };
    }

    const isCrit    = params.isCrit ?? Math.random() < effectiveCritChance;
    const isBlocked = params.isBlocked ?? Math.random() < blockChance;

    if (isCrit)    finalDamage *= critDmgMult;
    if (isBlocked) finalDamage  = Math.floor(finalDamage * 0.5);

    // Elixir / buff damage multiplier (attack damage, spell damage, etc.)
    const dmgMult = safeN(params.damageMultiplier, 1);
    if (dmgMult !== 1) finalDamage *= dmgMult;

    return {
        damage:      Math.max(1, Math.floor(baseDamage - enemyDef)),
        isCrit,
        isBlocked,
        isDodged: false,
        finalDamage: Math.max(1, Math.floor(finalDamage)),
    };
};

// ── Dual Wield calculation (Rogue) ────────────────────────────────────────────
// Each dagger does 60% of normal DMG, 2 separate attacks per turn

/**
 * Dual wield: two fully independent hits.
 * Each hand rolls its own weapon damage and has its own crit chance.
 * `weaponAtk` = mainHand roll, `offHandAtk` = offHand roll.
 * Each hit does 60% of its respective weapon damage.
 */
export const calculateDualWieldDamage = (
    params: ICombatParams & { offHandAtk: number },
): IDualWieldResult => {
    const hit1Params: ICombatParams = { ...params, weaponAtk: Math.floor(safeN(params.weaponAtk) * 0.6) };
    const hit2Params: ICombatParams = { ...params, weaponAtk: Math.floor(safeN(params.offHandAtk) * 0.6) };

    const hit1 = calculateDamage(hit1Params);
    const hit2 = calculateDamage(hit2Params);

    return {
        hit1,
        hit2,
        totalDamage: hit1.finalDamage + hit2.finalDamage,
    };
};

// ── Block chance calculation (Knight) ─────────────────────────────────────────
// Base 5%, scales with Shielding skill up to max 25%

export const calculateBlockChance = (
    shieldingLevel: number,
    isPhysicalAttack: boolean = true,
): number => {
    // Block only works against physical attacks (not from Mage/Cleric spells)
    if (!isPhysicalAttack) return 0;

    const base = 0.05;
    const perLevel = 0.005; // +0.5% per shielding level
    const max = 0.25;

    return Math.min(max, base + safeN(shieldingLevel) * perLevel);
};

// ── Dodge chance calculation (Archer/Rogue/Bard) ──────────────────────────────
// Base 5%, scales with agility-related stats up to max 20-25%

export const calculateDodgeChance = (
    characterClass: string,
    agilityLevel: number = 0,
    isPhysicalAttack: boolean = true,
): number => {
    // Dodge doesn't work against Mage/Cleric attacks
    if (!isPhysicalAttack) return 0;

    const classConfig: Record<string, { base: number; perLevel: number; max: number }> = {
        Archer: { base: 0.05, perLevel: 0.004, max: 0.20 },
        Rogue:  { base: 0.05, perLevel: 0.005, max: 0.20 },
        Bard:   { base: 0.05, perLevel: 0.003, max: 0.15 },
    };

    const config = classConfig[characterClass];
    if (!config) return 0;

    return Math.min(config.max, config.base + safeN(agilityLevel) * config.perLevel);
};

// ── MLVL bonus to skill damage ────────────────────────────────────────────────
// Skill damage = baseSkillDmg * (1 + MLVL * 0.02)

export const calculateSkillDamageWithMlvl = (
    baseSkillDmg: number,
    mlvl: number,
    enemyDefense: number,
    classModifier: number,
): number => {
    const mlvlMultiplier = 1 + safeN(mlvl) * 0.02;
    const raw = safeN(baseSkillDmg) * safeN(classModifier, 1) * mlvlMultiplier;
    return Math.max(1, Math.floor(raw - safeN(enemyDefense)));
};

export const calculateSkillDamage = (
    baseAtk: number,
    skillMultiplier: number,
    enemyDefense: number,
    classModifier: number,
): number => {
    const raw = safeN(baseAtk) * safeN(classModifier, 1) * safeN(skillMultiplier, 1);
    return Math.max(1, Math.floor(raw - safeN(enemyDefense)));
};

/**
 * Returns the base auto-attack interval in ms.
 * speed 1 → 2000 ms  |  speed 4+ → 500 ms minimum.
 */
export const calculateAttackInterval = (attackSpeed: number): number => {
    const BASE_INTERVAL = 2000;
    return Math.max(500, Math.floor(BASE_INTERVAL / Math.max(1, safeN(attackSpeed, 1))));
};

// ── Death penalty (NEW - can lose levels!) ────────────────────────────────────

export interface IDeathPenaltyResult {
    newLevel: number;
    newXp: number;
    xpPercent: number;
    levelsLost: number;
    skillXpLoss: number;
}

/**
 * Calculates death penalty – scales heavily with level.
 * Low levels: lose 1 level. High levels: lose ~5% of levels.
 * Skill XP loss is proportionally much smaller (1-3%).
 *
 * Level loss formula: max(1, floor(level * (0.03 + level * 0.00002)))
 *   lvl 50:  1-2 levels  |  lvl 100: 3 levels  |  lvl 500: 20  |  lvl 1000: 50
 */
export const calculateDeathPenalty = (
    currentLevel: number,
    currentXp: number,
    xpToNext: number,
    skillXp: number,
): IDeathPenaltyResult => {
    const level = safeN(currentLevel, 1);

    // Can't lose level at level 1
    if (level <= 1) {
        return {
            newLevel: 1,
            newXp: Math.max(0, Math.floor(safeN(currentXp) * 0.5)),
            xpPercent: 50,
            levelsLost: 0,
            skillXpLoss: Math.floor(safeN(skillXp) * 0.01),
        };
    }

    // Calculate levels lost (scales with level)
    let levelsLost: number;
    if (level <= 10) {
        levelsLost = 1;
    } else {
        const pct = 0.03 + level * 0.00002;
        levelsLost = Math.max(1, Math.floor(level * pct));
    }
    const newLevel = Math.max(1, level - levelsLost);

    // XP percent to keep on the new level
    let xpPercent: number;
    if (level <= 5)        xpPercent = 75;
    else if (level <= 20)  xpPercent = 50;
    else if (level <= 50)  xpPercent = 30;
    else if (level <= 100) xpPercent = 15;
    else if (level <= 300) xpPercent = 10;
    else                   xpPercent = 5;

    const newXp = Math.floor(safeN(xpToNext) * (xpPercent / 100));

    // Skill XP loss: 1-3% (much smaller than level loss)
    const skillLossPct = Math.min(0.03, 0.01 + level * 0.00002);
    const skillLoss = Math.floor(safeN(skillXp) * skillLossPct);

    return {
        newLevel,
        newXp,
        xpPercent,
        levelsLost,
        skillXpLoss: skillLoss,
    };
};

// ── Legacy death penalty (kept for backwards compat) ──────────────────────────

export const applyDeathPenalty = (
    currentXp: number,
    levelXp: number,
    skillXp: number,
): { newXp: number; newSkillXp: number } => {
    const xpLoss      = Math.floor(safeN(levelXp) * 0.1);
    const skillXpLoss = Math.floor(safeN(skillXp) * 0.05);
    return {
        newXp:      Math.max(0, safeN(currentXp) - xpLoss),
        newSkillXp: Math.max(0, safeN(skillXp) - skillXpLoss),
    };
};

export type CombatSpeed = 'x1' | 'x2' | 'x4' | 'SKIP';

export const getSpeedMultiplier = (speed: CombatSpeed): number => {
    const multipliers: Record<CombatSpeed, number> = { x1: 1, x2: 2, x4: 4, SKIP: Infinity };
    return multipliers[speed];
};

// ── Monster damage helpers ────────────────────────────────────────────────────

/**
 * Returns min/max attack range for a monster.
 * Falls back to floor(attack * 0.8) / floor(attack * 1.2) when not defined.
 */
export const getMonsterAttackRange = (monster: {
    attack: number;
    attack_min?: number;
    attack_max?: number;
}): { min: number; max: number } => {
    const atk = safeN(monster.attack);
    const min = Math.max(1, Math.floor(safeN(monster.attack_min, Math.floor(atk * 0.8))));
    const max = Math.max(min, Math.floor(safeN(monster.attack_max, Math.floor(atk * 1.2))));
    return { min, max };
};

/**
 * Rolls a random attack damage in the monster's min..max range.
 */
export const rollMonsterDamage = (monster: {
    attack: number;
    attack_min?: number;
    attack_max?: number;
}): number => {
    const { min, max } = getMonsterAttackRange(monster);
    if (max <= min) return min;
    return min + Math.floor(Math.random() * (max - min + 1));
};

// ── Monster rarity stat scaling ───────────────────────────────────────────────

export interface IMonsterCombatStats {
    hp: number;
    attack: number;
    attack_min: number;
    attack_max: number;
    defense: number;
    xp: number;
    goldMin: number;
    goldMax: number;
}

export type TMonsterRarity = 'normal' | 'strong' | 'epic' | 'legendary' | 'boss';

export const MONSTER_STAT_MULTIPLIERS: Record<TMonsterRarity, { hp: number; atk: number; def: number; xp: number; gold: number }> = {
    normal:    { hp: 1.0,  atk: 1.0,  def: 1.0,  xp: 1.0,  gold: 1.0 },
    strong:    { hp: 1.5,  atk: 1.2, def: 1.3,  xp: 1.8,  gold: 2.0 },
    epic:      { hp: 2.5,  atk: 1.6, def: 1.5,  xp: 3.0,  gold: 4.0 },
    legendary: { hp: 5.0,  atk: 1.8, def: 1.8,  xp: 5.0,  gold: 8.0 },
    boss:      { hp: 10.0, atk: 2.5, def: 2.0,  xp: 10.0, gold: 15.0 },
};

export const applyMonsterRarity = (
    baseStats: {
        hp: number;
        attack: number;
        attack_min?: number;
        attack_max?: number;
        defense: number;
        xp: number;
        gold: [number, number];
    },
    rarity: TMonsterRarity,
): IMonsterCombatStats => {
    const mult = MONSTER_STAT_MULTIPLIERS[rarity];
    const atk = safeN(baseStats.attack);
    const baseMin = safeN(baseStats.attack_min, Math.floor(atk * 0.8));
    const baseMax = safeN(baseStats.attack_max, Math.floor(atk * 1.2));
    return {
        hp:         Math.floor(safeN(baseStats.hp) * mult.hp),
        attack:     Math.floor(atk * mult.atk),
        attack_min: Math.max(1, Math.floor(baseMin * mult.atk)),
        attack_max: Math.max(1, Math.floor(baseMax * mult.atk)),
        defense:    Math.floor(safeN(baseStats.defense) * mult.def),
        xp:         Math.floor(safeN(baseStats.xp) * mult.xp),
        goldMin:    Math.floor(safeN(baseStats.gold[0]) * mult.gold),
        goldMax:    Math.floor(safeN(baseStats.gold[1]) * mult.gold),
    };
};
