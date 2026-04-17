import type { TCharacterClass } from './character';

export interface IPartyMember {
    id: string;
    name: string;
    class: TCharacterClass;
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
}

export interface IPartyCombatResult {
    memberId: string;
    memberName: string;
    memberClass: string;
    monsterId: string;
    won: boolean;
    damageDealt: number;
    damageTaken: number;
    /** If member killed their monster early, they helped another member */
    helpedMember?: string;
}

export interface IPartyBuff {
    id: string;
    name: string;
    sourceClass: string;
    effect: 'atk_boost' | 'def_boost' | 'heal' | 'speed_boost';
    value: number;
    /** Duration in combat rounds */
    duration: number;
}
