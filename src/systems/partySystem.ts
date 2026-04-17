import type { CharacterClass } from '../api/v1/characterApi';

// ── Constants ─────────────────────────────────────────────────────────────────

export const MAX_PARTY_SIZE = 4;

// ── Types ─────────────────────────────────────────────────────────────────────

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
  /** Display name chosen by the leader at creation time. */
  name?: string;
  /** Short free-form description (e.g. "looking for tank"). */
  description?: string;
  /** True if the party is password-gated. Plain-text password is server-side only. */
  hasPassword?: boolean;
  /** True if the party should appear in the public browser feed. */
  isPublic?: boolean;
  /** Capacity — defaults to `MAX_PARTY_SIZE` when not synced from server. */
  maxMembers?: number;
}

// ── Multipliers (CLAUDE.md formula) ──────────────────────────────────────────

/** Drop rate multiplier for a given party size. */
export const calculateDropMultiplier = (partySize: number): number => {
  const size = Math.max(1, Math.min(partySize, MAX_PARTY_SIZE));
  return 1 + (size - 1) * 0.15;
};

/** Monster difficulty multiplier for a given party size. */
export const calculateDifficultyMultiplier = (partySize: number): number => {
  const size = Math.max(1, Math.min(partySize, MAX_PARTY_SIZE));
  return 1 + (size - 1) * 0.2;
};

// ── Capacity helpers ──────────────────────────────────────────────────────────

export const canJoinParty = (currentSize: number): boolean =>
  currentSize < MAX_PARTY_SIZE;

export const isFull = (party: IPartyInfo): boolean =>
  party.members.length >= MAX_PARTY_SIZE;

export const getHumanCount = (members: IPartyMember[]): number =>
  members.filter((m) => !m.isBot).length;

export const getBotCount = (members: IPartyMember[]): number =>
  members.filter((m) => !!m.isBot).length;

/** Suggest adding a bot when fewer than 2 human players are present. */
export const shouldSuggestBot = (members: IPartyMember[]): boolean =>
  getHumanCount(members) < 2;

// ── Bot helper factory ────────────────────────────────────────────────────────

const BOT_NAMES = ['Bot Pancerny', 'Bot Lecznik', 'Bot Łucznik', 'Bot Mag'];

const BOT_SPRITES: Record<string, string> = {
  Knight: '🤖⚔️', Cleric: '🤖✝️', Archer: '🤖🏹', Mage: '🤖🔮',
};

/** Creates a bot helper tuned to fill the party's weakest role. */
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
    name: `${BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]} ${BOT_SPRITES[botClass] ?? '🤖'}`,
    class: botClass,
    level: avgLevel,
    hp,
    maxHp: hp,
    isBot: true,
    isOnline: true,
  };
};

// ── XP / loot sharing ─────────────────────────────────────────────────────────

/** XP each member receives when split equally. */
export const getXpShare = (totalXp: number, partySize: number): number =>
  Math.floor(totalXp / Math.max(1, partySize));

/** Gold each member receives when split equally. */
export const getGoldShare = (totalGold: number, partySize: number): number =>
  Math.floor(totalGold / Math.max(1, partySize));

// ── Party stats summary ───────────────────────────────────────────────────────

export interface IPartySummary {
  totalMembers: number;
  humanMembers: number;
  botMembers: number;
  avgLevel: number;
  dropMultiplier: number;
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
    difficultyMultiplier: calculateDifficultyMultiplier(size),
  };
};

// ── Party ID generator ─────────────────────────────────────────────────────────

export const generatePartyId = (): string =>
  Math.random().toString(36).slice(2, 8).toUpperCase();

// ── Party combat & buffs ─────────────────────────────────────────────────────

import type { IPartyBuff } from '../types/party';

/** Class buffs available in party */
export const CLASS_PARTY_BUFFS: Record<string, IPartyBuff> = {
  Cleric: { id: 'cleric_heal', name: 'Holy Light', sourceClass: 'Cleric', effect: 'heal', value: 0.15, duration: 3 },
  Bard: { id: 'bard_atk', name: 'Inspiring Melody', sourceClass: 'Bard', effect: 'atk_boost', value: 0.10, duration: 5 },
  Knight: { id: 'knight_def', name: 'Battle Cry', sourceClass: 'Knight', effect: 'def_boost', value: 0.10, duration: 5 },
};

/** Calculate party combat efficiency (how much help from finished members) */
export const calculateHelpDamage = (
  finishedMemberAttack: number,
  _remainingMonsterHp: number,
): number => {
  // Helper deals 50% of their attack to assist
  return Math.floor(finishedMemberAttack * 0.5);
};

/** Get active party buffs based on party member classes */
export const getPartyBuffs = (memberClasses: string[]): IPartyBuff[] => {
  const buffs: IPartyBuff[] = [];
  for (const cls of memberClasses) {
    const buff = CLASS_PARTY_BUFFS[cls];
    if (buff) buffs.push(buff);
  }
  return buffs;
};

/** Apply buff effects to stats */
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

/** Check if party has optimal composition for a buff bonus */
export const hasOptimalComposition = (memberClasses: string[]): boolean => {
  const uniqueClasses = new Set(memberClasses);
  // Optimal = at least 3 different classes
  return uniqueClasses.size >= 3;
};

/** Composition bonus multiplier (extra XP/gold for diverse parties) */
export const getCompositionBonus = (memberClasses: string[]): number => {
  const uniqueClasses = new Set(memberClasses);
  if (uniqueClasses.size >= 4) return 1.20; // +20% for 4 unique classes
  if (uniqueClasses.size >= 3) return 1.10; // +10% for 3 unique classes
  return 1.0;
};

// ── Aggro class weights ───────────────────────────────────────────────────────
// Higher weight = more likely to be picked as the monster's target.
// Knights tank most aggro; Cleric/Bard are the "backline" and rarely get hit.

export const AGGRO_CLASS_WEIGHTS: Record<CharacterClass, number> = {
  Knight:      80,
  Rogue:       60,
  Archer:      50,
  Necromancer: 40,
  Mage:        30,
  Cleric:      20,
  Bard:        20,
};

/** Get the aggro weight for a class (defaults to 30 for unknown). */
export const getAggroWeight = (cls: CharacterClass): number =>
  AGGRO_CLASS_WEIGHTS[cls] ?? 30;

/**
 * Pick a target from a weighted list based on class.
 * Accepts entries like `{ id, class }` (id can be 'player', bot id, etc.)
 * Returns the id of the selected target, or null if list is empty.
 */
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
