import type { Rarity, IGeneratedItem } from './lootSystem';
import type { IBaseItem } from './itemSystem';
import { generateRandomItem } from './itemGenerator';


export interface IDungeonDropEntry {
  itemId: string;
  chance: number;
  rarity: Rarity;
}

export interface IDungeon {
  id: string;
  name_pl: string;
  name_en: string;
  level: number;
  minLevel?: number;
  maxLevel?: number;
  waves?: number;
  cooldown?: number;
  dailyAttempts?: number;
  monsters?: string[];
  bossMonster?: string;
  rewardGold?: [number, number];
  rewardXp?: number;
  maxRarity: Rarity;
  description_pl: string;
  dropTable?: IDungeonDropEntry[];
}


export interface IDungeonMonster {
  id: string;
  name_pl: string;
  hp: number;
  attack: number;
  defense: number;
  level: number;
  xp: number;
  sprite: string;
  speed?: number;
}


export interface IDungeonCharacter {
  attack: number;
  defense: number;
  max_hp: number;
  level: number;
}


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


export const DUNGEON_RARITY_ORDER: Rarity[] = [
  'common', 'rare', 'epic', 'legendary', 'mythic', 'heroic',
];

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


export const getDungeonMinLevel = (dungeon: IDungeon): number =>
  dungeon.minLevel ?? dungeon.level;

export const getDungeonWaves = (dungeon: IDungeon): number =>
  dungeon.waves ?? Math.max(3, Math.min(10, Math.floor(dungeon.level / 15) + 3));

export const getDungeonCooldown = (dungeon: IDungeon): number =>
  dungeon.cooldown ?? (dungeon.dailyAttempts ? Math.floor(86400 / dungeon.dailyAttempts) : 17280);

export const getDungeonRewardGold = (dungeon: IDungeon): [number, number] =>
  dungeon.rewardGold ?? [dungeon.level * 10, dungeon.level * 25];

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


export const pickWaveMonster = (
  dungeon: IDungeon,
  allMonsters: IDungeonMonster[],
  wave: number,
  totalWaves: number,
): IDungeonMonster => {
  const isBossWave = wave === totalWaves - 1;

  if (isBossWave && dungeon.bossMonster) {
    const found = allMonsters.find((m) => m.id === dungeon.bossMonster);
    if (found) return found;
  }
  if (!isBossWave && dungeon.monsters && dungeon.monsters.length > 0) {
    const monsterId = dungeon.monsters[wave % dungeon.monsters.length];
    const found = allMonsters.find((m) => m.id === monsterId);
    if (found) return found;
  }

  const dungeonLevel = getDungeonMinLevel(dungeon);
  const sorted = [...allMonsters].sort((a, b) =>
    Math.abs(a.level - dungeonLevel) - Math.abs(b.level - dungeonLevel),
  );
  const offset = isBossWave ? Math.min(2, sorted.length - 1) : 0;
  return sorted[offset] ?? allMonsters[0];
};


export type DungeonMonsterType = 'Normal' | 'Strong' | 'Epic' | 'Legendary' | 'Boss';

export const DUNGEON_MONSTER_TYPE_MULTIPLIERS: Record<DungeonMonsterType, { hp: number; atk: number; def: number }> = {
  Normal:    { hp: 1.0, atk: 1.0, def: 1.0 },
  Strong:    { hp: 1.5, atk: 1.3, def: 1.2 },
  Epic:      { hp: 2.0, atk: 1.5, def: 1.3 },
  Legendary: { hp: 3.0, atk: 1.8, def: 1.5 },
  Boss:      { hp: 5.0, atk: 2.5, def: 2.0 },
};

export const getFinalWaveMonsterType = (dungeonLevel: number): DungeonMonsterType => {
  if (dungeonLevel <= 8) return 'Epic';
  if (dungeonLevel <= 18) return 'Legendary';
  return 'Boss';
};

export const getMidWaveMonsterType = (
  dungeonLevel: number,
  wave: number,
  totalWaves: number,
): DungeonMonsterType => {
  if (dungeonLevel < 20) return 'Normal';
  if (wave === totalWaves - 2 && totalWaves >= 4) return 'Legendary';
  if (wave > 0 && wave % 2 === 0) return 'Strong';
  return 'Normal';
};

export const getWaveMonsterType = (
  wave: number,
  totalWaves: number,
  dungeonLevel: number,
): DungeonMonsterType => {
  const isBossWave = wave === totalWaves - 1;
  if (isBossWave) return getFinalWaveMonsterType(dungeonLevel);
  return getMidWaveMonsterType(dungeonLevel, wave, totalWaves);
};


const TYPE_ORDER: readonly DungeonMonsterType[] = ['Normal', 'Strong', 'Epic', 'Legendary', 'Boss'];

const stepDownType = (t: DungeonMonsterType): DungeonMonsterType => {
  const idx = TYPE_ORDER.indexOf(t);
  return idx <= 0 ? 'Normal' : TYPE_ORDER[idx - 1];
};

export const getWaveMonsterCount = (
  dungeonLevel: number,
  wave: number,
  totalWaves: number,
): number => {
  const isBossWave = wave === totalWaves - 1;
  if (isBossWave) return dungeonLevel >= 30 ? 4 : 3;

  const waveProgress = wave / Math.max(1, totalWaves - 1);
  let count = 1 + Math.floor(waveProgress * 2);
  if (dungeonLevel >= 30 && wave > 0) count += 1;
  return Math.max(1, Math.min(4, count));
};

export const getWaveComposition = (
  dungeonLevel: number,
  wave: number,
  totalWaves: number,
): DungeonMonsterType[] => {
  const lead  = getWaveMonsterType(wave, totalWaves, dungeonLevel);
  const count = getWaveMonsterCount(dungeonLevel, wave, totalWaves);
  if (count <= 1) return [lead];

  const out: DungeonMonsterType[] = [lead];

  if (dungeonLevel >= 800) {
    while (out.length < count) out.push(lead);
    return out;
  }

  if (dungeonLevel <= 14) {
    let current = lead;
    while (out.length < count) {
      current = stepDownType(current);
      out.push(current);
    }
    return out;
  }

  const filler = stepDownType(lead);
  while (out.length < count) out.push(filler);
  return out;
};

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

  const pool = [...allMonsters]
    .filter((m) => m.id !== lead.id)
    .sort((a, b) => Math.abs(a.level - dLvl) - Math.abs(b.level - dLvl));

  const result: IDungeonMonster[] = [lead];
  for (let i = 1; i < count; i++) {
    result.push(pool[(i - 1) % Math.max(1, pool.length)] ?? lead);
  }
  return result;
};

export const scaleDungeonMonsterAsType = (
  monster: IDungeonMonster,
  wave: number,
  totalWaves: number,
  dungeonLevel: number,
  asType: DungeonMonsterType,
): IDungeonMonster => {
  const leadScaled = scaleDungeonMonster(monster, wave, totalWaves, dungeonLevel);
  const leadType   = getWaveMonsterType(wave, totalWaves, dungeonLevel);
  if (asType === leadType) return leadScaled;

  const leadMult = DUNGEON_MONSTER_TYPE_MULTIPLIERS[leadType];
  const newMult  = DUNGEON_MONSTER_TYPE_MULTIPLIERS[asType];
  return {
    ...leadScaled,
    hp:      Math.max(1, Math.floor(leadScaled.hp      * (newMult.hp  / leadMult.hp))),
    attack:  Math.max(1, Math.floor(leadScaled.attack  * (newMult.atk / leadMult.atk))),
    defense: Math.max(0, Math.floor(leadScaled.defense * (newMult.def / leadMult.def))),
  };
};

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
    hpScale  = 0.8 + waveProgress * 0.2;
    atkScale = 0.7 + waveProgress * 0.2;
    defScale = 0.7 + waveProgress * 0.2;
  } else if (dLvl <= 18) {
    hpScale  = 1.0 + waveProgress * 0.2;
    atkScale = 0.9 + waveProgress * 0.2;
    defScale = 0.9 + waveProgress * 0.2;
  } else {
    const levelBonus = Math.min(1.0, (dLvl - 20) / 200);
    const baseScale = 1.2 + levelBonus * 0.5;
    hpScale  = baseScale + waveProgress * (0.3 + levelBonus * 0.5);
    atkScale = (1.1 + levelBonus * 0.4) + waveProgress * (0.3 + levelBonus * 0.4);
    defScale = baseScale + waveProgress * (0.2 + levelBonus * 0.3);
  }

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

  for (let i = 0; i < 10_000; i++) {
    mHp -= pDmg;
    if (mHp <= 0) break;
    pHp -= mDmg;
    if (pHp <= 0) break;
  }

  return { playerHpLeft: Math.max(0, pHp), won: pHp > 0 };
};


export const rollDungeonGold = (range: [number, number]): number =>
  range[0] + Math.floor(Math.random() * (range[1] - range[0] + 1));


export const rollDungeonItemDrop = (
  dungeon: IDungeon,
  _characterLevel: number,
  _allItems: IBaseItem[],
  isBossWave: boolean,
): IGeneratedItem | null => {
  const dropChance = isBossWave ? 0.7 : 0.15;
  if (Math.random() > dropChance) return null;

  const rarity = rollDungeonRarity(dungeon.maxRarity ?? 'common');

  const dungeonLevel = getDungeonMinLevel(dungeon);

  const item = generateRandomItem(dungeonLevel, rarity as Rarity);
  if (!item) return null;

  return {
    itemId:    item.itemId,
    rarity:    item.rarity,
    bonuses:   item.bonuses,
    itemLevel: dungeonLevel,
  };
};


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


export interface IDungeonRewardEstimate {
  goldMin: number;
  goldMax: number;
  xp: number;
}

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
