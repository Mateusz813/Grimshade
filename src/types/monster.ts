export type TMonsterRarity = 'normal' | 'strong' | 'epic' | 'legendary' | 'boss';

export interface IMonster {
    id: string;
    name_pl: string;
    name_en: string;
    level: number;
    hp: number;
    attack: number;
    /** Minimum attack damage (falls back to floor(attack*0.8) if missing). */
    attack_min?: number;
    /** Maximum attack damage (falls back to floor(attack*1.2) if missing). */
    attack_max?: number;
    defense: number;
    speed: number;
    xp: number;
    gold: [number, number];
    dropTable: Array<{ itemId: string; chance: number; rarity: string }>; // legacy, always empty – drops are generated dynamically
    sprite: string;
    /** Magical attack – bypasses physical block and dodge. */
    magical?: boolean;
}
