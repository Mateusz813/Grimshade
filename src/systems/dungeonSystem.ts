import type { Rarity, IGeneratedItem } from './lootSystem';
import type { IBaseItem } from './itemSystem';
import { generateRandomItem } from './itemGenerator';

// -- Data interfaces (matching dungeons.json) ----------------------------------

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

// -- Minimal monster shape needed for dungeon simulation -----------------------

export interface IDungeonMonster {
  id: string;
  name_pl: string;
  hp: number;
  attack: number;
  defense: number;
  level: number;
  xp: number;
  sprite: string;
  /** Attack speed (matches monsters.json `speed`). Used by Dungeon to clock
   *  this mob's individual setInterval so 4 escorts with different speeds
   *  swing on independent timers (each with its own hit animation) instead
   *  of one shared aggregate tick. Optional because legacy code paths
   *  scaling/serializing monsters may strip it; combat fallbacks to ~1.5. */
  speed?: number;
}

// -- Character stats needed for dungeon simulation -----------------------------

export interface IDungeonCharacter {
  attack: number;
  defense: number;
  max_hp: number;
  level: number;
}

// -- Result types --------------------------------------------------------------

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

// -- Rarity helpers ------------------------------------------------------------

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

// -- Cooldown helpers ----------------------------------------------------------

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

// -- Monster helpers -----------------------------------------------------------

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

// -- Final wave monster type per dungeon tier ---------------------------------

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

// -- Multi-monster wave composition ------------------------------------------
//
// Dungeon waves used to spawn a single monster. We now spawn 1–4 enemies
// per wave so the fights feel like real raid encounters. The lead monster
// type (computed by `getWaveMonsterType`) sets the wave's "rarity tone";
// the rest of the slots are filled with the same or one tier below so the
// composition reads as "elite + escorts" rather than a random soup.
//
// Example outputs (verified against the player's spec):
//   Lvl 1  wave 0           -> [Normal]                     (1 mob, gentle intro)
//   Lvl 1  wave 1           -> [Strong, Normal]             (2 mobs)
//   Lvl 1  wave 2 (boss)    -> [Epic, Strong, Normal]       (3 mobs, escorts mix)
//   Lvl 30 wave 2 (mid)     -> [Legendary, Epic, Epic]      (3 mobs)
//   Lvl 30 wave 5 (boss)    -> [Boss, Legendary, Legendary, Legendary] (4 mobs)
//   Lvl 1000 final wave     -> [Boss, Boss, Boss, Boss]     (4 bosses)

const TYPE_ORDER: readonly DungeonMonsterType[] = ['Normal', 'Strong', 'Epic', 'Legendary', 'Boss'];

const stepDownType = (t: DungeonMonsterType): DungeonMonsterType => {
  const idx = TYPE_ORDER.indexOf(t);
  return idx <= 0 ? 'Normal' : TYPE_ORDER[idx - 1];
};

/**
 * How many monsters spawn together in a given wave.
 *
 * - Boss waves: always crowded (3 mobs at low level, 4 from lvl 30+).
 * - Regular waves: 1 -> 2 -> 3 progression based on wave index.
 * - Higher dungeons (lvl 30+) bump each wave by +1 so the late waves
 *   reach the 4-mob cap earlier and the run feels heavier.
 *
 * Capped at 4 so the existing CombatArena layout (4 enemy slots) still fits.
 */
export const getWaveMonsterCount = (
  dungeonLevel: number,
  wave: number,
  totalWaves: number,
): number => {
  const isBossWave = wave === totalWaves - 1;
  if (isBossWave) return dungeonLevel >= 30 ? 4 : 3;

  const waveProgress = wave / Math.max(1, totalWaves - 1);
  let count = 1 + Math.floor(waveProgress * 2);          // 0 -> 1, 0.5 -> 2, 1 -> 3
  if (dungeonLevel >= 30 && wave > 0) count += 1;        // hard dungeons bump non-first waves
  return Math.max(1, Math.min(4, count));
};

/**
 * Build the type composition for a wave. The first entry is the "lead"
 * (toughest) monster — picked by `getWaveMonsterType` so existing wave
 * scaling/labels still apply. The remaining slots are filled with the
 * same type (top tier dungeons) or one tier below (mid+high), or a
 * descending one-each ladder (low tier) so early players see variety
 * instead of three identical Normals.
 */
export const getWaveComposition = (
  dungeonLevel: number,
  wave: number,
  totalWaves: number,
): DungeonMonsterType[] => {
  const lead  = getWaveMonsterType(wave, totalWaves, dungeonLevel);
  const count = getWaveMonsterCount(dungeonLevel, wave, totalWaves);
  if (count <= 1) return [lead];

  const out: DungeonMonsterType[] = [lead];

  // Top tier (lvl 800+): everyone matches the lead — pure elite mob squads.
  if (dungeonLevel >= 800) {
    while (out.length < count) out.push(lead);
    return out;
  }

  // Low tier (lvl 1-14): descending one-each ladder so the wave reads as
  // "boss + escorts" instead of a flat block. Stops at Normal.
  if (dungeonLevel <= 14) {
    let current = lead;
    while (out.length < count) {
      current = stepDownType(current);
      out.push(current);
    }
    return out;
  }

  // Mid + high tier (lvl 15-799): 1 lead + (count-1) of one tier below so
  // the comp matches the player's spec ("2 epic + 1 legendary" at lvl 30
  // wave 2 -> lead = Legendary, fillers = Epic).
  const filler = stepDownType(lead);
  while (out.length < count) out.push(filler);
  return out;
};

/**
 * Pick the 1–4 monsters that make up a wave. Reuses `pickWaveMonster` for
 * the lead slot (preserving any explicit `monsters[]` / `bossMonster`
 * mapping the dungeon defines), then picks neighbouring monsters by level
 * for the escort slots so the bestiary stays themed.
 */
export const pickWaveMonsters = (
  dungeon: IDungeon,
  allMonsters: IDungeonMonster[],
  wave: number,
  totalWaves: number,
): IDungeonMonster[] => {
  const dLvl  = getDungeonMinLevel(dungeon);
  const count = getWaveMonsterCount(dLvl, wave, totalWaves);
  const lead  = pickWaveMonster(dungeon, allMonsters, wave, totalWaves);
  if (count <= 1) return [lead];

  // Pool of candidates near the dungeon level, lead excluded so we don't
  // double-up the same id in slot 0 + 1. Falls back to repeating the lead
  // when the bestiary is too thin to fill all the escort slots.
  const pool = [...allMonsters]
    .filter((m) => m.id !== lead.id)
    .sort((a, b) => Math.abs(a.level - dLvl) - Math.abs(b.level - dLvl));

  const result: IDungeonMonster[] = [lead];
  for (let i = 1; i < count; i++) {
    result.push(pool[(i - 1) % Math.max(1, pool.length)] ?? lead);
  }
  return result;
};

/**
 * Apply per-slot type multipliers when a wave spawns multiple monsters.
 * Used by `Dungeon.tsx` to scale escort monsters with their own (typically
 * lower) rarity tier instead of the lead's. Mirrors the per-type multiplier
 * pass inside `scaleDungeonMonster`, but applied as a delta so the wave's
 * baseline scaling is preserved.
 */
export const scaleDungeonMonsterAsType = (
  monster: IDungeonMonster,
  wave: number,
  totalWaves: number,
  dungeonLevel: number,
  asType: DungeonMonsterType,
): IDungeonMonster => {
  // Start from the standard lead-typed scaling so the per-tier difficulty
  // curve (lvl 1-8 vs 9-18 vs 20+) still applies to escort slots.
  const leadScaled = scaleDungeonMonster(monster, wave, totalWaves, dungeonLevel);
  const leadType   = getWaveMonsterType(wave, totalWaves, dungeonLevel);
  if (asType === leadType) return leadScaled;

  // Re-base by dividing out the lead's type multiplier and multiplying in
  // the escort's. Floors guarantee we never serve up 0-stat monsters.
  const leadMult = DUNGEON_MONSTER_TYPE_MULTIPLIERS[leadType];
  const newMult  = DUNGEON_MONSTER_TYPE_MULTIPLIERS[asType];
  return {
    ...leadScaled,
    hp:      Math.max(1, Math.floor(leadScaled.hp      * (newMult.hp  / leadMult.hp))),
    attack:  Math.max(1, Math.floor(leadScaled.attack  * (newMult.atk / leadMult.atk))),
    defense: Math.max(0, Math.floor(leadScaled.defense * (newMult.def / leadMult.def))),
  };
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
    // -- First 4 dungeons (lvl 1-8) ---------------------------------------
    // Moderate difficulty – not trivially easy but clearable with decent gear.
    // HP: 0.8x at wave 0 -> 1.0x at final wave
    // ATK: 0.7x at wave 0 -> 0.9x at final wave
    hpScale  = 0.8 + waveProgress * 0.2;
    atkScale = 0.7 + waveProgress * 0.2;
    defScale = 0.7 + waveProgress * 0.2;
  } else if (dLvl <= 18) {
    // -- Mid dungeons (lvl 9-18) ------------------------------------------
    // Challenging – requires potions and decent equipment.
    // HP: 1.0x at wave 0 -> 1.2x at final wave
    // ATK: 0.9x at wave 0 -> 1.1x at final wave
    hpScale  = 1.0 + waveProgress * 0.2;
    atkScale = 0.9 + waveProgress * 0.2;
    defScale = 0.9 + waveProgress * 0.2;
  } else {
    // -- Hard dungeons (lvl 20+) ------------------------------------------
    // Significant difficulty. Progressive scaling from 1.2x to 2.0x.
    // Higher level dungeons get extra scaling on top.
    const levelBonus = Math.min(1.0, (dLvl - 20) / 200); // 0->1.0 over lvl 20-220
    const baseScale = 1.2 + levelBonus * 0.5; // 1.2x at lvl 20 -> 1.7x at lvl 220+
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

// -- Wave resolution (pure, deterministic simulation) -------------------------

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

// -- Gold reward roll ----------------------------------------------------------

export const rollDungeonGold = (range: [number, number]): number =>
  range[0] + Math.floor(Math.random() * (range[1] - range[0] + 1));

// -- Item drop for a dungeon wave ----------------------------------------------

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
    itemLevel: dungeonLevel,  // <- dungeon level, NOT player level
  };
};

// -- Full dungeon simulation (returns per-wave results) ------------------------

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

// -- Estimate dungeon rewards based on monster spawns × 4 --------------------

export interface IDungeonRewardEstimate {
  goldMin: number;
  goldMax: number;
  xp: number;
}

/**
 * Estimates the gold and XP reward for a dungeon. Mirrors the runtime math
 * in `Dungeon.tsx`: every spawn (lead + escorts) in every wave is counted,
 * then the accumulated kill total is multiplied by the dungeon reward
 * multiplier (×4) and the level-driven completion bonus (`level²` XP +
 * `level × 1 000` gold) is added on top. Monster type multipliers (Strong
 * / Epic / Legendary / Boss) only scale stats — XP/gold per kill are the
 * monster's raw values regardless of slot type, so we don't apply them
 * here either.
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
    const slots = pickWaveMonsters(dungeon, allMonsters, w, totalWaves);
    for (const monster of slots) {
      totalXpEst += monster.xp;
      const rawGold = monstersRawData.find((m) => m.id === monster.id)?.gold;
      if (rawGold) {
        totalGoldMin += rawGold[0];
        totalGoldMax += rawGold[1];
      }
    }
  }

  const lvl = dungeon.level ?? 1;
  const xpBonus = lvl * lvl;
  const goldBonus = lvl * 1_000;

  return {
    goldMin: totalGoldMin * MULTIPLIER + goldBonus,
    goldMax: totalGoldMax * MULTIPLIER + goldBonus,
    xp:      totalXpEst   * MULTIPLIER + xpBonus,
  };
};
