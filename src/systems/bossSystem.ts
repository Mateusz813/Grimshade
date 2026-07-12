import { xpToNextLevel } from './levelSystem';


export interface IBossDropEntry {
  itemId: string;
  chance: number;
  rarity: string;
  name_pl?: string;
  name_en?: string;
  slot?: string;
  bonuses?: Record<string, number>;
}

export type IBossUniqueItem = IBossDropEntry & {
  bonuses: Record<string, number>;
};

export interface IBoss {
  id: string;
  name_pl: string;
  name_en: string;
  level: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  xp: number;
  gold: [number, number];
  cooldown?: number;
  dailyAttempts?: number;
  sprite: string;
  uniqueDrops?: IBossDropEntry[];
  dropTable?: IBossDropEntry[];
  heroicDropChance?: number;
  abilities?: string[];
  description_pl: string;
}

export const getBossDrops = (boss: IBoss): IBossDropEntry[] =>
  boss.uniqueDrops ?? boss.dropTable ?? [];

export const getBossCooldown = (boss: IBoss): number =>
  boss.cooldown ?? (boss.dailyAttempts ? Math.floor(86400 / boss.dailyAttempts) : 28800);


export const BOSS_HP_MULTIPLIER = 3.5;
export const BOSS_ATK_MULTIPLIER = 1.75;
export const BOSS_DEF_MULTIPLIER = 1.3;

export const getScaledBossStats = (
  boss: IBoss,
): { hp: number; attack: number; attack_min: number; attack_max: number; defense: number } => {
  const atk = boss.attack;
  const baseMin = Math.floor(atk * 0.8);
  const baseMax = Math.floor(atk * 1.2);
  return {
    hp:         Math.floor(boss.hp * BOSS_HP_MULTIPLIER),
    attack:     Math.floor(atk * BOSS_ATK_MULTIPLIER),
    attack_min: Math.max(1, Math.floor(baseMin * BOSS_ATK_MULTIPLIER)),
    attack_max: Math.max(1, Math.floor(baseMax * BOSS_ATK_MULTIPLIER)),
    defense:    Math.floor(boss.defense * BOSS_DEF_MULTIPLIER),
  };
};


export interface IBossCharacter {
  attack: number;
  defense: number;
  max_hp: number;
  level: number;
}


export interface IBossResult {
  won: boolean;
  playerHpLeft: number;
  turns: number;
  drops: IBossUniqueItem[];
  gold: number;
  xp: number;
}


export const canChallengeBoss = (
  boss: IBoss,
  characterLevel: number,
  lastDefeatedAt: string | null,
): boolean => {
  if (characterLevel < boss.level) return false;
  if (!lastDefeatedAt) return true;
  const elapsed = Date.now() - new Date(lastDefeatedAt).getTime();
  return elapsed >= getBossCooldown(boss) * 1000;
};

export const getBossRemainingMs = (
  boss: IBoss,
  lastDefeatedAt: string | null,
): number => {
  if (!lastDefeatedAt) return 0;
  const elapsed = Date.now() - new Date(lastDefeatedAt).getTime();
  return Math.max(0, getBossCooldown(boss) * 1000 - elapsed);
};


export const getBossPhaseMultiplier = (bossHpFraction: number): number =>
  bossHpFraction < 0.3 ? 1.5 : 1.0;

export const isBossEnraged = (currentHp: number, maxHp: number): boolean =>
  maxHp > 0 && currentHp / maxHp < 0.3;


export interface IBossRewards {
  goldMin: number;
  goldMax: number;
  xp: number;
}

const bossXpPercent = (level: number): number =>
  0.005 + 0.19 / (1 + Math.max(1, level) / 80);

const bossGoldMid = (level: number): number =>
  Math.floor(38 * Math.pow(Math.max(1, level), 1.8));

export const computeBossRewards = (level: number): IBossRewards => {
  const mid = bossGoldMid(level);
  return {
    goldMin: Math.max(1, Math.floor(mid * 0.6)),
    goldMax: Math.max(1, Math.floor(mid * 1.6)),
    xp:      Math.max(1, Math.floor(xpToNextLevel(level) * bossXpPercent(level))),
  };
};

export const BOSS_REWARD_MULTIPLIER = 1;


export const rollBossGold = (boss: IBoss): number => {
  const r = computeBossRewards(boss.level);
  return r.goldMin + Math.floor(Math.random() * (r.goldMax - r.goldMin + 1));
};

export const getBossGoldRange = (boss: IBoss): [number, number] => {
  const r = computeBossRewards(boss.level);
  return [r.goldMin, r.goldMax];
};


export const getBossXp = (boss: IBoss): number =>
  computeBossRewards(boss.level).xp;


export const rollBossLoot = (boss: IBoss): IBossUniqueItem[] =>
  (getBossDrops(boss) as IBossUniqueItem[]).filter((drop) => Math.random() < drop.chance);


export const resolveBoss = (
  boss: IBoss,
  character: IBossCharacter,
): IBossResult => {
  const scaled = getScaledBossStats(boss);
  let playerHp = character.max_hp;
  let bossHp   = scaled.hp;
  const bossMaxHp    = scaled.hp;
  const playerDmg    = Math.max(1, character.attack - scaled.defense);
  const baseBossDmg  = Math.max(1, scaled.attack - character.defense);
  let turns = 0;

  while (bossHp > 0 && playerHp > 0 && turns < 100_000) {
    bossHp -= playerDmg;
    if (bossHp <= 0) break;

    const mult   = getBossPhaseMultiplier(bossHp / bossMaxHp);
    const bossDmg = Math.max(1, Math.floor(baseBossDmg * mult));
    playerHp -= bossDmg;
    turns++;
  }

  const won = bossHp <= 0 && playerHp > 0;
  const drops = won ? rollBossLoot(boss) : [];
  const gold  = won ? rollBossGold(boss) : 0;

  return {
    won,
    playerHpLeft: Math.max(0, playerHp),
    turns,
    drops,
    gold,
    xp: won ? getBossXp(boss) : 0,
  };
};


export const getBossRecommendedLevel = (boss: IBoss): number =>
  boss.level + 5;
