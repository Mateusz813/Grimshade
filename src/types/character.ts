export type TCharacterClass = 'Knight' | 'Mage' | 'Cleric' | 'Archer' | 'Rogue' | 'Necromancer' | 'Bard';

export interface ICharacter {
    id: string;
    user_id: string;
    name: string;
    class: TCharacterClass;
    level: number;
    xp: number;
    hp: number;
    max_hp: number;
    mp: number;
    max_mp: number;
    attack: number;
    defense: number;
    attack_speed: number;
    crit_chance: number;
    crit_damage: number;
    magic_level: number;
    hp_regen: number;
    mp_regen: number;
    gold: number;
    stat_points: number;
    highest_level: number;
    equipment: Record<string, string | null>;
    created_at: string;
    updated_at: string;
}

export interface ICharacterPayload {
    name: string;
    class: TCharacterClass;
    hp?: number;
    max_hp?: number;
    mp?: number;
    max_mp?: number;
    attack?: number;
    defense?: number;
    attack_speed?: number;
    crit_chance?: number;
    crit_damage?: number;
    magic_level?: number;
    hp_regen?: number;
    mp_regen?: number;
    gold?: number;
    stat_points?: number;
}

export interface IXpGainResult {
    levelsGained: number;
    statPointsGained: number;
    newLevel: number;
}
