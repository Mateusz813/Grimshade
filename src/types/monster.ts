export type TMonsterRarity = 'normal' | 'strong' | 'epic' | 'legendary' | 'boss';

export interface IMonster {
    id: string;
    name_pl: string;
    name_en: string;
    level: number;
    hp: number;
    attack: number;
    attack_min?: number;
    attack_max?: number;
    defense: number;
    speed: number;
    xp: number;
    gold: [number, number];
    dropTable: Array<{ itemId: string; chance: number; rarity: string }>;
    sprite: string;
    magical?: boolean;
}
