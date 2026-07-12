import type { TCharacterClass } from './character';

export interface IBot {
    id: string;
    name: string;
    class: TCharacterClass;
    level: number;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    attack: number;
    defense: number;
    attackSpeed: number;
    critChance: number;
    magicLevel: number;
    skillId: string | null;
    skillDamageMultiplier: number;
    skillMpCost: number;
    skillCooldownMs: number;
    alive: boolean;
    representsCharacterId?: string;
    isLeader?: boolean;
}

export interface IBotAction {
    botId: string;
    botName: string;
    type: 'attack' | 'skill';
    damage: number;
    skillName?: string;
}
