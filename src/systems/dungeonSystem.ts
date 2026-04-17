import type { Rarity, IGeneratedItem } from './lootSystem';
import type { IBaseItem } from './itemSystem';
import { generateRandomItem } from './itemGenerator';

// ── Data interfaces (matching dungeons.json) ──────────────────────────────────

export interface IDungeonDropEntry {
  itemId: string;
  chance: number;
  rarity: Rarity;
}

export interface IDungeon {
  id: string;
  name_pl: string;
  name_en: string;
  /** Minimum character level required */
  level: number;
  /** Alias for level, used by older code */
  minLevel?: number;
  /** Max character level (optional) */
  maxLevel?: number;
  /** Number of waves. Derived from level if not set. */
  waves?: number;
  /** Cooldown in seconds. Derived from dailyAttempts if not set. */
  cooldown?: number;
  /** Daily attempts allowed */
  dailyAttempts?: number;
  /** Monster IDs for regular waves (optional) */
  monsters?: string[];
  /** Monster ID for final boss wave (optional) */
  bossMonster?: string;
  /** Gold reward range */
  rewardGold?: [number, number];
  /** XP reward */
  rewardXp?: number;
  maxRarity: Rarity;
  description_pl: string;
  dropTable?: IDungeonDropEntry[];
}

// ── Minimal monster shape needed for dungeon simulation ───────────────────────

export interface IDungeonMonster {
  id: string;
  name_pl: string;
  hp: number;
  attack: number;
  defense: number;
  level: number;
  xp: number;
  sprite: string;
}

// ── Character stats needed for dungeon simulation ─────────────────────────────

export interface IDungeonCharacter {
  attack: number;
  defense: number;
  max_hp: number;
  level: number;
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface IWaveResult {
  wave: number;
  monsterName: string;
  monsterSprite: string;
  isBossWave: boolean;
  playerHpAfter: number;
  won: boolean;
}

export interface IDungeonResult {
  success: boolean;
  wavesCleared: number;
  playerHpLeft: number;
  gold: number;
  xp: number;
  items: IGeneratedItem[];
}

// ── Rarity helpers ────────────────────────────────────────────────────────────

export const DUNGEON_RARITY_ORDER: Rarity[] = [
  'common', 'rare', 'epic', 'legendary', 'mythic', 'heroic',
];

/** Weighted rarity roll capped at maxRarity. */
const RARITY_WEIGHTS = [50, 25, 15, 7, 2.5, 0.5];

export const rollDungeonRarity = (maxRarity: Rarity): Rarity => {
  const maxIdx = DUNGEON_RARITY_ORDER.indexOf(maxRarity);
  const weights = RARITY_WEIGHTS.slice(0, maxIdx + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return DUNGEON_RARITY_ORDER[i];
  }
  return DUNGEON_RARITY_ORDER[maxIdx];
};

// ── Cooldown helpers ──────────────────────────────────────────────────────────

/** Get the minimum required level for a dungeon */
export const getDungeonMinLevel = (dungeon: IDungeon): number =>
  dungeon.minLevel ?? dungeon.level;

/** Get number of waves for a dungeon (derived from level if not set) */
export const getDungeonWaves = (dungeon: IDungeon): number =>
  dungeon.waves ?? Math.max(3, Math.min(10, Math.floor(dungeon.level / 15) + 3));

/** Get cooldown in seconds for a dungeon */
export const getDungeonCooldown = (dungeon: IDungeon): number =>
  dungeon.cooldown ?? (dungeon.dailyAttempts ? Math.floor(86400 / dungeon.dailyAttempts) : 17280);

/** Get gold reward range for a dungeon */
export const getDungeonRewardGold = (dungeon: IDungeon): [number, number] =>
  dungeon.rewardGold ?? [dungeon.level * 10, dungeon.level * 25];

/** Get XP reward for a dungeon */
export const getDungeonRewardXp = (dungeon: IDungeon): number =>
  dungeon.rewardXp ?? dungeon.level * 50;

export const canEnterDungeon = (
  dungeon: IDungeon,
  characterLevel: number,
  lastCompletedAt: string | null,
): boolean => {
  if (characterLevel < getDungeonMinLevel(dungeon)) return false;
  if (!lastCompletedAt) return true;
  const elapsed = Date.now() - new Date(lastCompletedAt).getTime();
  return elapsed >= getDungeonCooldown(dungeon) * 1000;
};

export const getDungeonRemainingMs = (
  dungeon: IDungeon,
  lastCompletedAt: string | null,
): number => {
  if (!lastCompletedAt) return 0;
  const elapsed = Date.now() - new Date(lastCompletedAt).getTime();
  return Math.max(0, getDungeonCooldown(dungeon) * 1000 - elapsed);
};

export const formatCooldown = (ms: number): string => {
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  if (totalSec < 3600) return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
  return `${Math.floor(totalSec / 3600)}h ${Math.floor((totalSec % 3600) / 60)}m`;
};

// ── Monster helpers ───────────────────────────────────────────────────────────

export const pickWaveMonster = (
  dungeon: IDungeon,
  allMonsters: IDungeonMonster[],
  wave: number,             // 0-indexed
  totalWaves: number,
): IDungeonMonster => {
  const isBossWave = wave === totalWaves - 1;

  // Try to use explicit monster/boss IDs if defined
  if (isBossWave && dungeon.bossMonster) {
    const found = allMonsters.find((m) => m.id === dungeon.bossMonster);
    if (found) return found;
  }
  if (!isBossWave && dungeon.monsters && dungeon.monsters.length > 0) {
    const monsterId = dungeon.monsters[wave % dungeon.monsters.length];
    const found = allMonsters.find((m) => m.id === monsterId);
    if (found) return found;
  }

  // Fallback: pick a monster near dungeon level
  const dungeonLevel = getDungeonMinLevel(dungeon);
  const sorted = [...allMonsters].sort((a, b) =>
    Math.abs(a.level - dungeonLevel) - Math.abs(b.level - dungeonLevel),
  );
  // For boss wave pick a harder monster
  const offset = isBossWave ? Math.min(2, sorted.length - 1) : 0;
  return sorted[offset] ?? allMonsters[0];
};

// ── Final wave monster type per dungeon tier ─────────────────────────────────

export type DungeonMonsterType = 'Normal' | 'Strong' | 'Epic' | 'Legendary' | 'Boss';

/**
 * Monster type multipliers applied to final-wave monsters.
 * These are separate from wave scaling and stack on top.
 */
export const DUNGEON_MONSTER_TYPE_MULTIPLIERS: Record<DungeonMonsterType, { hp: number; atk: number; def: number }> = {
  Normal:    { hp: 1.0, atk: 1.0, def: 1.0 },
  Strong:    { hp: 1.5, atk: 1.3, def: 1.2 },
  Epic:      { hp: 2.0, atk: 1.5, def: 1.3 },
  Legendary: { hp: 3.0, atk: 1.8, def: 1.5 },
  Boss:      { hp: 5.0, atk: 2.5, def: 2.0 },
};

/**
 * Determine the monster type for the final wave of a dungeon.
 *
 * - Lvl 1-8 (first 4 dungeons): final wave = EPIC
 * - Lvl 9-18 (next ~5 dungeons): final wave = LEGENDARY
 * - Lvl 20+: final wave = BOSS
 */
export const getFinalWaveMonsterType = (dungeonLevel: number): DungeonMonsterType => {
  if (dungeonLevel <= 8) return 'Epic';
  if (dungeonLevel <= 18) return 'Legendary';
  return 'Boss';
};

/**
 * Determine the monster type for a mid-wave monster in higher dungeons.
 * In dungeons lvl 20+, some mid-waves get Legendary type for variety.
 */
export const getMidWaveMonsterType = (
  dungeonLevel: number,
  wave: number,
  totalWaves: number,
): DungeonMonsterType => {
  if (dungeonLevel < 20) return 'Normal';
  // In hard dungeons, every other wave (starting from wave 2) gets Strong,
  // and the second-to-last wave gets Legendary
  if (wave === totalWaves - 2 && totalWaves >= 4) return 'Legendary';
  if (wave > 0 && wave % 2 === 0) return 'Strong';
  return 'Normal';
};

/**
 * Get the monster type label and multipliers for a specific wave.
 */
export const getWaveMonsterType = (
  wave: number,
  totalWaves: number,
  dungeonLevel: number,
): DungeonMonsterType => {
  const isBossWave = wave === totalWaves - 1;
  if (isBossWave) return getFinalWaveMonsterType(dungeonLevel);
  return getMidWaveMonsterType(dungeonLevel, wave, totalWaves);
};

/**
 * Scale monster stats for dungeon waves.
 *
 * Restored difficulty tiers (previous rebalance made dungeons too easy):
 * - Lvl 1-8 (first 4 dungeons): HP 0.8x–1.0x, ATK 0.7x–0.9x, final wave EPIC type
 * - Lvl 9-18 (next 5 dungeons): HP 1.0x–1.2x, ATK 0.9x–1.1x, final wave LEGENDARY type
 * - Lvl 20+ (hard): HP 1.2x–2.0x, ATK 1.1x–1.8x, final wave BOSS type
 *
 * Monster type multipliers (Epic/Legendary/Boss) are applied ON TOP of wave scaling.
 */
export const scaleDungeonMonster = (
  monster: IDungeonMonster,
  wave: number,
  totalWaves: number,
  dungeonLevel?: number,
): IDungeonMonster => {
  const dLvl = dungeonLevel ?? monster.level;
  const waveProgress = wave / Math.max(1, totalWaves - 1);

  let hpScale: number;
  let atkScale: number;
  let defScale: number;

  if (dLvl <= 8) {
    // ── First 4 dungeons (lvl 1-8) ───────────────────────────────────────
    // Moderate difficulty – not trivially easy but clearable with decent gear.
    // HP: 0.8x at wave 0 → 1.0x at final wave
    // ATK: 0.7x at wave 0 → 0.9x at final wave
    hpScale  = 0.8 + waveProgress * 0.2;
    atkScale = 0.7 + waveProgress * 0.2;
    defScale = 0.7 + waveProgress * 0.2;
  } else if (dLvl <= 18) {
    // ── Mid dungeons (lvl 9-18) ──────────────────────────────────────────
    // Challenging – requires potions and decent equipment.
    // HP: 1.0x at wave 0 → 1.2x at final wave
    // ATK: 0.9x at wave 0 → 1.1x at final wave
    hpScale  = 1.0 + waveProgress * 0.2;
    atkScale = 0.9 + waveProgress * 0.2;
    defScale = 0.9 + waveProgress * 0.2;
  } else {
    // ── Hard dungeons (lvl 20+) ──────────────────────────────────────────
    // Significant difficulty. Progressive scaling from 1.2x to 2.0x.
    // Higher level dungeons get extra scaling on top.
    const levelBonus = Math.min(1.0, (dLvl - 20) / 200); // 0→1.0 over lvl 20-220
    const baseScale = 1.2 + levelBonus * 0.5; // 1.2x at lvl 20 → 1.7x at lvl 220+
    hpScale  = baseScale + waveProgress * (0.3 + levelBonus * 0.5);
    atkScale = (1.1 + levelBonus * 0.4) + waveProgress * (0.3 + levelBonus * 0.4);
    defScale = baseScale + waveProgress * (0.2 + levelBonus * 0.3);
  }

  // Apply monster type multipliers (Epic/Legendary/Boss for final waves, Strong for mid-waves in hard dungeons)
  const monsterType = getWaveMonsterType(wave, totalWaves, dLvl);
  const typeMult = DUNGEON_MONSTER_TYPE_MULTIPLIERS[monsterType];
  hpScale  *= typeMult.hp;
  atkScale *= typeMult.atk;
  defScale *= typeMult.def;

  return {
    ...monster,
    hp:      Math.max(1, Math.floor(monster.hp      * hpScale)),
    attack:  Math.max(1, Math.floor(monster.attack  * atkScale)),
    defense: Math.max(0, Math.floor(monster.defense * defScale)),
  };
};

// ── Wave resolution (pure, deterministic simulation) ─────────────────────────

export interface IResolveWaveResult {
  playerHpLeft: number;
  won: boolean;
}

export const resolveWave = (
  playerHp: number,
  playerAtk: number,
  playerDef: number,
  monsterHp: number,
  monsterAtk: number,
  monsterDef: number,
): IResolveWaveResult => {
  let pHp = playerHp;
  let mHp = monsterHp;
  const pDmg = Math.max(1, playerAtk - monsterDef);
  const mDmg = Math.max(1, monsterAtk - playerDef);

  // Safety: cap at 10 000 hits to avoid infinite loop
  for (let i = 0; i < 10_000; i++) {
    mHp -= pDmg;
    if (mHp <= 0) break;
    pHp -= mDmg;
    if (pHp <= 0) break;
  }

  return { playerHpLeft: Math.max(0, pHp), won: pHp > 0 };
};

// ── Gold reward roll ──────────────────────────────────────────────────────────

export const rollDungeonGold = (range: [number, number]): number =>
  range[0] + Math.floor(Math.random() * (range[1] - range[0] + 1));

// ── Item drop for a dungeon wave ──────────────────────────────────────────────

/**
 * Roll for an item drop from a dungeon wave.
 * IMPORTANT: Item level = dungeon level (not player level).
 * Uses the new dynamic item generator (not legacy items.json).
 * Heroic items drop ONLY from dungeons/bosses.
 */
export const rollDungeonItemDrop = (
  dungeon: IDungeon,
  _characterLevel: number,
  _allItems: IBaseItem[],
  isBossWave: boolean,
): IGeneratedItem | null => {
  const dropChance = isBossWave ? 0.7 : 0.15;
  if (Math.random() > dropChance) return null;

  const rarity = rollDungeonRarity(dungeon.maxRarity ?? 'common');

  // Dungeon level for item level (drops scale with dungeon, not player)
  const dungeonLevel = getDungeonMinLevel(dungeon);

  // Use the new dynamic item generator instead of old items.json
  const item = generateRandomItem(dungeonLevel, rarity as Rarity);
  if (!item) return null;

  return {
    itemId:    item.itemId,
    rarity:    item.rarity,
    bonuses:   item.bonuses,
    itemLevel: dungeonLevel,  // ← dungeon level, NOT player level
  };
};

// ── Full dungeon simulation (returns per-wave results) ────────────────────────

export const resolveDungeon = (
  dungeon: IDungeon,
  character: IDungeonCharacter,
  allMonsters: IDungeonMonster[],
  allItems: IBaseItem[],
): { waveResults: IWaveResult[]; result: IDungeonResult } => {
  const totalWaves = getDungeonWaves(dungeon);
  let playerHp = character.max_hp;
  let totalXp   = getDungeonRewardXp(dungeon);
  const waveResults: IWaveResult[] = [];
  const items: IGeneratedItem[] = [];

  for (let w = 0; w < totalWaves; w++) {
    const isBossWave = w === totalWaves - 1;
    const raw    = pickWaveMonster(dungeon, allMonsters, w, totalWaves);
    const monster = scaleDungeonMonster(raw, w, totalWaves, getDungeonMinLevel(dungeon));

    const { playerHpLeft, won } = resolveWave(
      playerHp,
      character.attack, character.defense,
      monster.hp, monster.attack, monster.defense,
    );

    playerHp = playerHpLeft;
    totalXp += Math.floor(raw.xp * (1 + w * 0.05));

    const drop = rollDungeonItemDrop(dungeon, character.level, allItems, isBossWave);
    if (drop) items.push(drop);

    waveResults.push({
      wave:          w,
      monsterName:   raw.name_pl,
      monsterSprite: raw.sprite,
      isBossWave,
      playerHpAfter: playerHp,
      won,
    });

    if (!won) {
      return {
        waveResults,
        result: {
          success:      false,
          wavesCleared: w,
          playerHpLeft: 0,
          gold:         0,
          xp:           0,
          items:        [],
        },
      };
    }
  }

  const gold = rollDungeonGold(getDungeonRewardGold(dungeon));
  return {
    waveResults,
    result: {
      success:      true,
      wavesCleared: totalWaves,
      playerHpLeft: playerHp,
      gold,
      xp: totalXp,
      items,
    },
  };
};

// ── Estimate dungeon rewards based on monster spawns × 4 ────────────────────

export interface IDungeonRewardEstimate {
  goldMin: number;
  goldMax: number;
  xp: number;
}

/**
 * Estimates the gold and XP reward for a dungeon based on which monsters
 * will appear across all waves, multiplied by the dungeon reward multiplier (×4).
 */
export const estimateDungeonRewards = (
  dungeon: IDungeon,
  allMonsters: IDungeonMonster[],
  monstersRawData: { id: string; gold: [number, number] }[],
): IDungeonRewardEstimate => {
  const MULTIPLIER = 4;
  const totalWaves = getDungeonWaves(dungeon);
  let totalXpEst = 0;
  let totalGoldMin = 0;
  let totalGoldMax = 0;

  for (let w = 0; w < totalWaves; w++) {
    const monster = pickWaveMonster(dungeon, allMonsters, w, totalWaves);
    totalXpEst += monster.xp;
    const rawGold = monstersRawData.find((m) => m.id === monster.id)?.gold;
    if (rawGold) {
      totalGoldMin += rawGold[0];
      totalGoldMax += rawGold[1];
    }
  }

  return {
    goldMin: totalGoldMin * MULTIPLIER,
    goldMax: totalGoldMax * MULTIPLIER,
    xp: totalXpEst * MULTIPLIER,
  };
};
