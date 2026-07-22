import skillsData from '../data/skills.json';


const safeN = (v: number | null | undefined, fallback = 0): number => {
    const n = Number(v ?? fallback);
    return isFinite(n) ? n : fallback;
};


export const DEF_K = 1.0;
export const DEF_CAP = 0.75;
export const DEF_BASE = 25;
export const DMG_COMPRESS_K = 2.3;
export const DMG_COMPRESS_P = 0.80;
export const KILL_XP_TTK_MULT = 1.75;
export const GEAR_HP_SCALE = 0.25;

export const scaleGearHp = (gearHp: number): number => Math.floor(safeN(gearHp) * GEAR_HP_SCALE);

export const compressPlayerDamage = (mitigatedDamage: number): number =>
    DMG_COMPRESS_K * Math.pow(Math.max(0, safeN(mitigatedDamage)), DMG_COMPRESS_P);

export const defMitigation = (enemyDef: number, attackerLevel: number): number => {
    const def = Math.max(0, safeN(enemyDef));
    const lvl = Math.max(1, safeN(attackerLevel, 1));
    if (def <= 0) return 0;
    return Math.min(DEF_CAP, def / (def + DEF_K * lvl + DEF_BASE));
};

export const mitigateDamage = (rawDamage: number, enemyDef: number, attackerLevel: number, playerSource = false): number => {
    const m = safeN(rawDamage) * (1 - defMitigation(enemyDef, attackerLevel));
    return Math.max(1, Math.floor(playerSource ? compressPlayerDamage(m) : m));
};


export interface ICombatParams {
    baseAtk: number;
    weaponAtk: number;
    skillBonus: number;
    classModifier: number;
    enemyDefense: number;
    attackerLevel?: number;
    isCrit?: boolean;
    critChance?: number;
    critRoll?: number;
    maxCritChance?: number;
    damageMultiplier?: number;
    playerSource?: boolean;
}

export interface ICombatResult {
    damage: number;
    isCrit: boolean;
    finalDamage: number;
}


export interface IDualWieldResult {
    hit1: ICombatResult;
    hit2: ICombatResult;
    totalDamage: number;
}


export const CRIT_MULT_MIN = 1.5;

export const CRIT_MULT_MAX = 2.5;

export const rollCritMultiplier = (roll: number = Math.random()): number =>
    CRIT_MULT_MIN + Math.min(1, Math.max(0, safeN(roll))) * (CRIT_MULT_MAX - CRIT_MULT_MIN);


export const calculateDamage = (params: ICombatParams): ICombatResult => {
    const baseAtk      = safeN(params.baseAtk);
    const weaponAtk    = safeN(params.weaponAtk);
    const skillBonus   = safeN(params.skillBonus);
    const classMod     = safeN(params.classModifier, 1);
    const enemyDef     = safeN(params.enemyDefense);
    const critChance   = safeN(params.critChance, 0.05);
    const maxCrit      = safeN(params.maxCritChance, 1.0);

    const effectiveCritChance = Math.min(critChance, maxCrit);

    const baseDamage = (baseAtk + weaponAtk + skillBonus) * classMod;
    const mitigated  = baseDamage * (1 - defMitigation(enemyDef, params.attackerLevel ?? 1));
    let finalDamage  = params.playerSource ? compressPlayerDamage(mitigated) : Math.max(1, mitigated);

    const isCrit = params.isCrit ?? Math.random() < effectiveCritChance;
    if (isCrit) finalDamage *= rollCritMultiplier(params.critRoll ?? Math.random());

    const dmgMult = safeN(params.damageMultiplier, 1);
    if (dmgMult !== 1) finalDamage *= dmgMult;

    return {
        damage:      Math.max(1, Math.floor(mitigated)),
        isCrit,
        finalDamage: Math.max(1, Math.floor(finalDamage)),
    };
};


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

export const calculateAttackInterval = (attackSpeed: number): number => {
    const BASE_INTERVAL = 2000;
    return Math.max(500, Math.floor(BASE_INTERVAL / Math.max(1, safeN(attackSpeed, 1))));
};


export interface IDeathPenaltyResult {
    newLevel: number;
    newXp: number;
    xpPercent: number;
    levelsLost: number;
    skillXpLoss: number;
}

export const calculateDeathPenalty = (
    currentLevel: number,
    currentXp: number,
    xpToNext: number,
    skillXp: number,
): IDeathPenaltyResult => {
    const level = safeN(currentLevel, 1);

    if (level <= 1) {
        return {
            newLevel: 1,
            newXp: Math.max(0, Math.floor(safeN(currentXp) * 0.5)),
            xpPercent: 50,
            levelsLost: 0,
            skillXpLoss: Math.floor(safeN(skillXp) * 0.01),
        };
    }

    let levelsLost: number;
    if (level <= 10) {
        levelsLost = 1;
    } else {
        const pct = 0.03 + level * 0.00002;
        levelsLost = Math.max(1, Math.floor(level * pct));
    }
    const newLevel = Math.max(1, level - levelsLost);

    let xpPercent: number;
    if (level <= 5)        xpPercent = 75;
    else if (level <= 20)  xpPercent = 50;
    else if (level <= 50)  xpPercent = 30;
    else if (level <= 100) xpPercent = 15;
    else if (level <= 300) xpPercent = 10;
    else                   xpPercent = 5;

    const newXp = Math.floor(safeN(xpToNext) * (xpPercent / 100));

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

export const rollMonsterDamage = (monster: {
    attack: number;
    attack_min?: number;
    attack_max?: number;
}): number => {
    const { min, max } = getMonsterAttackRange(monster);
    if (max <= min) return min;
    return min + Math.floor(Math.random() * (max - min + 1));
};


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
    strong:    { hp: 1.5,  atk: 1.4, def: 1.3,  xp: 1.8,  gold: 2.0 },
    epic:      { hp: 2.5,  atk: 2.2, def: 1.5,  xp: 3.0,  gold: 4.0 },
    legendary: { hp: 4.0,  atk: 3.2, def: 1.8,  xp: 5.0,  gold: 8.0 },
    boss:      { hp: 8.0,  atk: 5.0, def: 2.0,  xp: 10.0, gold: 15.0 },
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


export const getSpeedScaledCooldownMs = (cooldownMs: number, speedMult: number): number =>
    Math.floor(Math.max(0, cooldownMs) / Math.max(1, speedMult));


const SKILL_REAL_COOLDOWN_MS: Record<string, number> = (() => {
    const map: Record<string, number> = {};
    const active = (skillsData as {
        activeSkills?: Record<string, Array<{ id?: string; cooldown?: number }>>;
    }).activeSkills ?? {};
    for (const list of Object.values(active)) {
        for (const s of list) {
            if (typeof s?.id === 'string' && typeof s.cooldown === 'number') {
                map[s.id] = s.cooldown;
            }
        }
    }
    return map;
})();

export const REAL_COOLDOWN_SKILL_IDS = new Set<string>(['shadow_step']);

export const resolveSkillRecastMs = (skillId: string, flatMs: number): number =>
    REAL_COOLDOWN_SKILL_IDS.has(skillId)
        ? Math.max(flatMs, SKILL_REAL_COOLDOWN_MS[skillId] ?? flatMs)
        : flatMs;
