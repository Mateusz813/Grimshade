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
    /** The first available skill for this class (used in combat) */
    skillId: string | null;
    skillDamageMultiplier: number;
    skillMpCost: number;
    skillCooldownMs: number;
    /** Whether the bot is alive during boss combat */
    alive: boolean;
}

export interface IBotAction {
    botId: string;
    botName: string;
    type: 'attack' | 'skill';
    damage: number;
    skillName?: string;
}
