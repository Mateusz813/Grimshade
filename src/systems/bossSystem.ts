// ── Data interfaces (matching bosses.json) ────────────────────────────────────

export interface IBossDropEntry {
  itemId: string;
  chance: number;
  rarity: string;
  /** Optional UI metadata – may not be in JSON */
  name_pl?: string;
  name_en?: string;
  slot?: string;
  bonuses?: Record<string, number>;
}

/** Legacy alias used in Boss.tsx result display */
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
  /** Cooldown in seconds. Falls back to dailyAttempts-derived value. */
  cooldown?: number;
  /** Daily attempts (used to derive cooldown when cooldown missing) */
  dailyAttempts?: number;
  sprite: string;
  /** uniqueDrops OR dropTable – both accepted */
  uniqueDrops?: IBossDropEntry[];
  dropTable?: IBossDropEntry[];
  heroicDropChance?: number;
  abilities?: string[];
  description_pl: string;
}

/** Get effective drop list regardless of field name */
export const getBossDrops = (boss: IBoss): IBossDropEntry[] =>
  boss.uniqueDrops ?? boss.dropTable ?? [];

/** Get effective cooldown (seconds) */
export const getBossCooldown = (boss: IBoss): number =>
  boss.cooldown ?? (boss.dailyAttempts ? Math.floor(86400 / boss.dailyAttempts) : 28800);

// ── Party-balance scaling ─────────────────────────────────────────────────────
// Bosses are designed to be near-impossible solo – balanced for a 4-player party.
// Solo players should use bot companions.

/** HP multiplier for party balance (bosses have ~3.5x more HP than before) */
export const BOSS_HP_MULTIPLIER = 3.5;
/** ATK multiplier for party balance (bosses hit ~1.75x harder) */
export const BOSS_ATK_MULTIPLIER = 1.75;
/** DEF multiplier for party balance */
export const BOSS_DEF_MULTIPLIER = 1.3;

/**
 * Returns boss stats scaled for party balance.
 * Call this to get the actual combat HP/ATK/DEF values.
 */
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

// ── Character stats for boss simulation ───────────────────────────────────────

export interface IBossCharacter {
  attack: number;
  defense: number;
  max_hp: number;
  level: number;
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface IBossResult {
  won: boolean;
  playerHpLeft: number;
  turns: number;
  drops: IBossUniqueItem[];
  gold: number;
  xp: number;
}

// ── Cooldown helpers ──────────────────────────────────────────────────────────

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

export const formatBossCooldown = (ms: number): string => {
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  if (totalSec < 3600) return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
  return `${Math.floor(totalSec / 3600)}h ${Math.floor((totalSec % 3600) / 60)}m`;
};

// ── Phase detection ───────────────────────────────────────────────────────────

/** Returns the attack multiplier for the boss at the given HP fraction. */
export const getBossPhaseMultiplier = (bossHpFraction: number): number =>
  bossHpFraction < 0.3 ? 1.5 : 1.0;

/** Whether the boss is in enraged phase. */
export const isBossEnraged = (currentHp: number, maxHp: number): boolean =>
  maxHp > 0 && currentHp / maxHp < 0.3;

// ── Reward multiplier ─────────────────────────────────────────────────────────
// Bosses are harder and rarer than normal monsters, so they should give at least
// 4x more XP and Gold to be worth the effort.

export const BOSS_REWARD_MULTIPLIER = 4;

// ── Gold reward ───────────────────────────────────────────────────────────────

export const rollBossGold = (range: [number, number]): number => {
  const base = range[0] + Math.floor(Math.random() * (range[1] - range[0] + 1));
  return base * BOSS_REWARD_MULTIPLIER;
};

// ── XP reward ────────────────────────────────────────────────────────────────

/** Returns boss XP with the reward multiplier applied. */
export const getBossXp = (boss: IBoss): number =>
  boss.xp * BOSS_REWARD_MULTIPLIER;

// ── Unique drop roll ──────────────────────────────────────────────────────────

export const rollBossLoot = (boss: IBoss): IBossUniqueItem[] =>
  (getBossDrops(boss) as IBossUniqueItem[]).filter((drop) => Math.random() < drop.chance);

// ── Boss fight simulation ─────────────────────────────────────────────────────

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
    // Player attacks boss
    bossHp -= playerDmg;
    if (bossHp <= 0) break;

    // Boss attacks player (enraged below 30% HP)
    const mult   = getBossPhaseMultiplier(bossHp / bossMaxHp);
    const bossDmg = Math.max(1, Math.floor(baseBossDmg * mult));
    playerHp -= bossDmg;
    turns++;
  }

  const won = bossHp <= 0 && playerHp > 0;
  const drops = won ? rollBossLoot(boss) : [];
  const gold  = won ? rollBossGold(boss.gold) : 0;

  return {
    won,
    playerHpLeft: Math.max(0, playerHp),
    turns,
    drops,
    gold,
    xp: won ? getBossXp(boss) : 0,
  };
};

// ── Recommended character level for each boss ─────────────────────────────────

/** Returns minimum suggested character level to have a reasonable chance. */
export const getBossRecommendedLevel = (boss: IBoss): number =>
  boss.level + 5;
