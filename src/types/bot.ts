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
    /** 2026-05-13: when a "bot" slot represents a real human party
     *  member (not AI), this carries their character.id so the UI can
     *  match it against party.leaderId / current viewer's id for
     *  slot-ordering. Undefined for purely synthetic AI companions. */
    representsCharacterId?: string;
    /** 2026-05-13: true when this slot represents the party leader.
     *  Members use it to render the leader's card at slot 0 of their
     *  arena view (so both screens display the same roster order). */
    isLeader?: boolean;
}

export interface IBotAction {
    botId: string;
    botName: string;
    type: 'attack' | 'skill';
    damage: number;
    skillName?: string;
}
