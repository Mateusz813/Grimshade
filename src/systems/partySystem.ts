import type { CharacterClass } from '../api/v1/characterApi';


export const MAX_PARTY_SIZE = 4;


export interface IPartyMember {
  id: string;
  name: string;
  class: CharacterClass;
  level: number;
  hp: number;
  maxHp: number;
  isBot?: boolean;
  isOnline?: boolean;
}

export interface IPartyInfo {
  id: string;
  leaderId: string;
  members: IPartyMember[];
  createdAt: string;
  name?: string;
  description?: string;
  hasPassword?: boolean;
  isPublic?: boolean;
  maxMembers?: number;
  minJoinLevel?: number;
}


export const calculateDropMultiplier = (partySize: number): number => {
  const size = Math.max(1, Math.min(partySize, MAX_PARTY_SIZE));
  return 1 + (size - 1) * 0.005;
};

export const calculateXpMultiplier = (partySize: number): number => {
  const size = Math.max(1, Math.min(partySize, MAX_PARTY_SIZE));
  return 1 + (size - 1) * 0.065;
};

export const calculateDifficultyMultiplier = (partySize: number): number => {
  const size = Math.max(1, Math.min(partySize, MAX_PARTY_SIZE));
  return 1 + (size - 1) * 0.2;
};


export const canJoinParty = (currentSize: number): boolean =>
  currentSize < MAX_PARTY_SIZE;

export const isFull = (party: IPartyInfo): boolean =>
  party.members.length >= MAX_PARTY_SIZE;

export const getHumanCount = (members: IPartyMember[]): number =>
  members.filter((m) => !m.isBot).length;

export const getBotCount = (members: IPartyMember[]): number =>
  members.filter((m) => !!m.isBot).length;

export const shouldSuggestBot = (members: IPartyMember[]): boolean =>
  getHumanCount(members) < 2;


const BOT_NAMES: Partial<Record<CharacterClass, string>> = {
  Knight: 'Bot Pancerny',
  Cleric: 'Bot Lecznik',
  Archer: 'Bot Łucznik',
  Mage: 'Bot Mag',
};

export const createBotHelper = (partyMembers: IPartyMember[]): IPartyMember => {
  const classes = partyMembers.map((m) => m.class);
  let botClass: CharacterClass = 'Knight';

  if (!classes.includes('Cleric')) {
    botClass = 'Cleric';
  } else if (!classes.includes('Knight')) {
    botClass = 'Knight';
  } else if (!classes.includes('Mage')) {
    botClass = 'Mage';
  } else {
    botClass = 'Archer';
  }

  const avgLevel =
    partyMembers.length > 0
      ? Math.floor(partyMembers.reduce((s, m) => s + m.level, 0) / partyMembers.length)
      : 10;
  const hp = Math.max(100, avgLevel * 20);

  return {
    id: `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: BOT_NAMES[botClass] ?? `Bot ${botClass}`,
    class: botClass,
    level: avgLevel,
    hp,
    maxHp: hp,
    isBot: true,
    isOnline: true,
  };
};


export const getXpShare = (totalXp: number, partySize: number): number =>
  Math.floor(totalXp / Math.max(1, partySize));

export const getGoldShare = (totalGold: number, partySize: number): number =>
  Math.floor(totalGold / Math.max(1, partySize));


export interface IPartySummary {
  totalMembers: number;
  humanMembers: number;
  botMembers: number;
  avgLevel: number;
  dropMultiplier: number;
  xpMultiplier: number;
  difficultyMultiplier: number;
}

export const getPartySummary = (members: IPartyMember[]): IPartySummary => {
  const size = members.length;
  const avgLevel =
    size > 0 ? Math.floor(members.reduce((s, m) => s + m.level, 0) / size) : 0;
  return {
    totalMembers:         size,
    humanMembers:         getHumanCount(members),
    botMembers:           getBotCount(members),
    avgLevel,
    dropMultiplier:       calculateDropMultiplier(size),
    xpMultiplier:         calculateXpMultiplier(size),
    difficultyMultiplier: calculateDifficultyMultiplier(size),
  };
};


export const generatePartyId = (): string =>
  Math.random().toString(36).slice(2, 8).toUpperCase();


import type { IPartyBuff } from '../types/party';

export const CLASS_PARTY_BUFFS: Record<string, IPartyBuff> = {
  Cleric: { id: 'cleric_heal', name: 'Holy Light', sourceClass: 'Cleric', effect: 'heal', value: 0.15, duration: 3 },
  Bard: { id: 'bard_atk', name: 'Inspiring Melody', sourceClass: 'Bard', effect: 'atk_boost', value: 0.10, duration: 5 },
  Knight: { id: 'knight_def', name: 'Battle Cry', sourceClass: 'Knight', effect: 'def_boost', value: 0.10, duration: 5 },
};

export const calculateHelpDamage = (
  finishedMemberAttack: number,
  _remainingMonsterHp: number,
): number => {
  return Math.floor(finishedMemberAttack * 0.5);
};

export const getPartyBuffs = (memberClasses: string[]): IPartyBuff[] => {
  const buffs: IPartyBuff[] = [];
  for (const cls of memberClasses) {
    const buff = CLASS_PARTY_BUFFS[cls];
    if (buff) buffs.push(buff);
  }
  return buffs;
};

export const applyPartyBuffs = (
  baseAttack: number,
  baseDefense: number,
  maxHp: number,
  buffs: IPartyBuff[],
): { attack: number; defense: number; healPerRound: number } => {
  let attack = baseAttack;
  let defense = baseDefense;
  let healPerRound = 0;

  for (const buff of buffs) {
    switch (buff.effect) {
      case 'atk_boost':
        attack = Math.floor(attack * (1 + buff.value));
        break;
      case 'def_boost':
        defense = Math.floor(defense * (1 + buff.value));
        break;
      case 'heal':
        healPerRound = Math.floor(maxHp * buff.value);
        break;
    }
  }

  return { attack, defense, healPerRound };
};

export const hasOptimalComposition = (memberClasses: string[]): boolean => {
  const uniqueClasses = new Set(memberClasses);
  return uniqueClasses.size >= 3;
};

export const getCompositionBonus = (memberClasses: string[]): number => {
  const uniqueClasses = new Set(memberClasses);
  if (uniqueClasses.size >= 4) return 1.20;
  if (uniqueClasses.size >= 3) return 1.10;
  return 1.0;
};


export const getPartyGateLevel = (
  myLevel: number,
  members: IPartyMember[] | null | undefined,
): number => {
  if (!members || members.length === 0) return myLevel;
  const humans = members.filter((m) => !m.isBot);
  if (humans.length === 0) return myLevel;
  const lowest = humans.reduce((min, m) => (m.level < min ? m.level : min), Infinity);
  if (!Number.isFinite(lowest)) return myLevel;
  return Math.min(myLevel, lowest);
};

export const getPartyMaxUnlockedMonsterLevel = (
  myMaxUnlockedLevel: number,
  members: IPartyMember[] | null | undefined,
  presenceByMember: Record<string, { maxUnlockedMonsterLevel?: number }>,
  myCharacterId: string,
): number => {
  let cap = myMaxUnlockedLevel;
  if (!members || members.length === 0) return cap;
  for (const m of members) {
    if (m.isBot) continue;
    if (m.id === myCharacterId) continue;
    const snap = presenceByMember[m.id];
    if (snap?.maxUnlockedMonsterLevel === undefined) continue;
    if (snap.maxUnlockedMonsterLevel < cap) cap = snap.maxUnlockedMonsterLevel;
  }
  return cap;
};


export const AGGRO_CLASS_WEIGHTS: Record<CharacterClass, number> = {
  Knight:      80,
  Rogue:       60,
  Archer:      50,
  Necromancer: 40,
  Mage:        30,
  Cleric:      20,
  Bard:        20,
};

export const getAggroWeight = (cls: CharacterClass): number =>
  AGGRO_CLASS_WEIGHTS[cls] ?? 30;

export const pickWeightedAggroTarget = (
  targets: Array<{ id: string; class: CharacterClass }>,
): string | null => {
  if (targets.length === 0) return null;
  const weights = targets.map((t) => getAggroWeight(t.class));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return targets[0]?.id ?? null;
  let roll = Math.random() * total;
  for (let i = 0; i < targets.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return targets[i].id;
  }
  return targets[targets.length - 1].id;
};
