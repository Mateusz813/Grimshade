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
    xp_to_next?: number;
    arena_kills?: number;
    arena_deaths?: number;
    arena_league?: string;
    arena_league_points?: number;
    mastery_points?: number;
    quests_oneshot_done?: number;
    quests_daily_done?: number;
    market_items_sold?: number;
    market_items_bought?: number;
    item_upgrades_done?: number;
    skill_upgrades_done?: number;
    best_dps5_solo?: number;
    best_dps5_party?: number;
    market_gold_earned?: number;
    market_gold_spent?: number;
    best_dps5_party_composition?: string | null;
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
