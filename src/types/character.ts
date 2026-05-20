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
    // 2026-05-19 v15 spec ("Dodać do rankingu arenę"): cross-player
    // arena stats live on the character row so the leaderboard can
    // rank all players by lifetime arena kills / deaths / current
    // league standing. Populated by the leaderboard_migration.sql
    // (DEFAULT 0 / 'bronze'), refreshed by the arena store after
    // every match.
    arena_kills?: number;
    arena_deaths?: number;
    arena_league?: string;
    arena_league_points?: number;
    // 2026-05-19 v16 spec ("Dodaj jeszcze zakladke z punktami
    // masteri, wykonanymi questami ..."): activity counters that
    // back the new ranking tabs. Each subsystem bumps its own
    // column via `characterApi.bumpStat` after a successful action.
    mastery_points?: number;
    quests_oneshot_done?: number;
    quests_daily_done?: number;
    market_items_sold?: number;
    market_items_bought?: number;
    item_upgrades_done?: number;
    skill_upgrades_done?: number;
    best_dps5_solo?: number;
    best_dps5_party?: number;
    // 2026-05-19 v18: market money flows.
    market_gold_earned?: number;
    market_gold_spent?: number;
    // 2026-05-19 v20: party composition snapshot (JSON-encoded array
    // of `{ name, class }`) captured when the player hit their
    // current `best_dps5_party` high-water mark.
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
