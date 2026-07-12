
export const GUILD_INITIAL_MEMBER_CAP = 20;

export const GUILD_CREATE_COST_GOLD = 1_000_000;

export const GUILD_MAX_LEVEL = Number.POSITIVE_INFINITY;

export const GUILD_BOSS_MAX_TIER = 50;

export const clampGuildBossTier = (tier: number): number => {
    if (!Number.isFinite(tier) || tier < 1) return 1;
    if (tier > GUILD_BOSS_MAX_TIER) return GUILD_BOSS_MAX_TIER;
    return Math.floor(tier);
};

export const GUILD_TREASURY_SLOTS = 1000;

export const GUILD_BOSS_HEROIC_MAX_CHANCE = 0.01;

export const GUILD_BOSS_BLOCK_PCT = 0.10;

export const guildXpToNextLevel = (level: number): number => {
    if (level <= 0) return 0;
    const tierForLevel = clampGuildBossTier(level);
    return Math.floor(level * getGuildBossMaxHp(tierForLevel));
};

export const guildXpForLevel = (level: number): number => {
    let total = 0;
    for (let l = 1; l < level; l++) {
        total += guildXpToNextLevel(l);
    }
    return total;
};

export const guildMemberCap = (level: number): number => {
    return GUILD_INITIAL_MEMBER_CAP + Math.max(0, level - 1);
};

export const applyGuildXp = (
    currentLevel: number,
    currentXp: number,
    gain: number,
): { level: number; xp: number; leveledUp: boolean } => {
    let level = currentLevel;
    let xp = currentXp + Math.max(0, gain);
    let leveled = false;
    while (xp >= guildXpToNextLevel(level)) {
        xp -= guildXpToNextLevel(level);
        level += 1;
        leveled = true;
    }
    return { level, xp, leveledUp: leveled };
};

export const getGuildBossMaxHp = (tier: number): number => {
    const tBoss = Math.max(1, tier);
    return Math.floor(2_000_000 * Math.pow(1.25, tBoss - 1));
};

export const computeGuildBossDamage = (
    characterAttack: number,
    characterLevel: number,
    tier: number,
): number => {
    const tBoss = Math.max(1, tier);
    const base = Math.max(1, characterAttack) * (1 + characterLevel / 120);
    const scaled = base * (1 + (tBoss - 1) * 0.05);
    const cap = Math.floor(getGuildBossMaxHp(tier) * 0.05);
    return Math.max(1, Math.min(cap, Math.floor(scaled)));
};

export const getCurrentWeekStartIso = (now: Date = new Date()): string => {
    const d = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0, 0, 0, 0,
    ));
    const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - (dow - 1));
    return d.toISOString().slice(0, 10);
};

export const isGuildBossClaimDay = (now: Date = new Date()): boolean => {
    return now.getUTCDay() === 0;
};

export const getTodayIso = (now: Date = new Date()): string => {
    return now.toISOString().slice(0, 10);
};

export const contributionMultiplier = (
    damageDealt: number,
    bossMaxHp: number,
): number => {
    if (bossMaxHp <= 0) return 0;
    const share = Math.min(1, damageDealt / bossMaxHp);
    return Math.max(0.05, 0.1 + share * 1.9);
};
