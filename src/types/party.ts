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
    name?: string;
    description?: string;
    hasPassword?: boolean;
    isPublic?: boolean;
    maxMembers?: number;
    minJoinLevel?: number;
}

export interface IPartyBuff {
    id: string;
    name: string;
    sourceClass: string;
    effect: 'atk_boost' | 'def_boost' | 'heal' | 'speed_boost';
    value: number;
    duration: number;
}
