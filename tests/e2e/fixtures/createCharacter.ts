
import { getAdminClient, findUserIdByEmail, withSupabaseRetry } from './adminClient';

export type CharacterClass =
    | 'Knight'
    | 'Mage'
    | 'Cleric'
    | 'Archer'
    | 'Rogue'
    | 'Necromancer'
    | 'Bard';

const CLASS_BASE_STATS: Record<CharacterClass, {
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
}> = {
    Knight:      { hp: 120, max_hp: 120, mp: 30,  max_mp: 30,  attack: 10, defense: 5, attack_speed: 1.5, crit_chance: 0.03, crit_damage: 2.0, magic_level: 0 },
    Mage:        { hp: 80,  max_hp: 80,  mp: 200, max_mp: 200, attack: 6,  defense: 2, attack_speed: 2.0, crit_chance: 0.05, crit_damage: 2.0, magic_level: 5 },
    Cleric:      { hp: 100, max_hp: 100, mp: 150, max_mp: 150, attack: 7,  defense: 4, attack_speed: 2.0, crit_chance: 0.03, crit_damage: 2.0, magic_level: 5 },
    Archer:      { hp: 100, max_hp: 100, mp: 80,  max_mp: 80,  attack: 10, defense: 3, attack_speed: 2.5, crit_chance: 0.10, crit_damage: 2.0, magic_level: 0 },
    Rogue:       { hp: 90,  max_hp: 90,  mp: 60,  max_mp: 60,  attack: 9,  defense: 3, attack_speed: 2.5, crit_chance: 0.15, crit_damage: 2.5, magic_level: 0 },
    Necromancer: { hp: 85,  max_hp: 85,  mp: 180, max_mp: 180, attack: 6,  defense: 2, attack_speed: 1.8, crit_chance: 0.05, crit_damage: 2.0, magic_level: 5 },
    Bard:        { hp: 95,  max_hp: 95,  mp: 120, max_mp: 120, attack: 8,  defense: 3, attack_speed: 2.0, crit_chance: 0.07, crit_damage: 2.0, magic_level: 3 },
};

const FLOOR_BASE: Record<CharacterClass, { hp: number; mp: number }> = {
    Knight: { hp: 200, mp: 50 }, Mage: { hp: 100, mp: 200 }, Cleric: { hp: 130, mp: 160 },
    Archer: { hp: 120, mp: 80 }, Rogue: { hp: 110, mp: 90 }, Necromancer: { hp: 90, mp: 220 },
    Bard: { hp: 115, mp: 130 },
};
const FLOOR_HP_PER_LEVEL: Record<CharacterClass, number> = { Knight: 8, Mage: 3, Cleric: 5, Archer: 4, Rogue: 4, Necromancer: 3, Bard: 4 };
const FLOOR_MP_PER_LEVEL: Record<CharacterClass, number> = { Knight: 2, Mage: 8, Cleric: 6, Archer: 3, Rogue: 3, Necromancer: 9, Bard: 5 };
const FLOOR_MILESTONE_HP: Record<CharacterClass, number> = { Knight: 30, Mage: 10, Cleric: 15, Archer: 15, Rogue: 15, Necromancer: 12, Bard: 15 };
const FLOOR_MILESTONE_MP: Record<CharacterClass, number> = { Knight: 5, Mage: 25, Cleric: 20, Archer: 10, Rogue: 8, Necromancer: 22, Bard: 15 };

const computeStatFloor = (cls: CharacterClass, level: number): { max_hp: number; max_mp: number } => {
    const L = Math.max(1, Math.floor(level));
    const ms = Math.floor(L / 10);
    return {
        max_hp: FLOOR_BASE[cls].hp + FLOOR_HP_PER_LEVEL[cls] * (L - 1) + ms * FLOOR_MILESTONE_HP[cls],
        max_mp: FLOOR_BASE[cls].mp + FLOOR_MP_PER_LEVEL[cls] * (L - 1) + ms * FLOOR_MILESTONE_MP[cls],
    };
};


const findUserIdByEmailStrict = async (email: string): Promise<string> => {
    const userId = await findUserIdByEmail(email);
    if (!userId) {
        throw new Error(`[createCharacter] User not found for email: ${email}`);
    }
    return userId;
};

export interface ICreatedCharacter {
    id: string;
    name: string;
    class: CharacterClass;
}

export interface ICreateCharacterArgs {
    userEmail: string;
    name: string;
    class: CharacterClass;
    overrides?: Partial<{
        level: number;
        gold: number;
        hp: number;
        mp: number;
        max_hp: number;
        max_mp: number;
        highest_level: number;
        stat_points: number;
        hp_regen: number;
        mp_regen: number;
        mastery_points: number;
        arena_league_points: number;
        arena_league: string;
        arena_kills: number;
        arena_deaths: number;
        crit_damage: number;
        quests_oneshot_done: number;
        quests_daily_done: number;
        market_items_sold: number;
        market_gold_earned: number;
        market_items_bought: number;
        market_gold_spent: number;
        item_upgrades_done: number;
        best_dps5_solo: number;
    }>;
}

export const createCharacterViaApi = async (
    args: ICreateCharacterArgs,
): Promise<ICreatedCharacter> => {
    const admin = getAdminClient();
    const userId = await findUserIdByEmailStrict(args.userEmail);
    const baseStats = CLASS_BASE_STATS[args.class];
    const floorLevel = args.overrides?.highest_level ?? args.overrides?.level ?? 1;
    const floor = computeStatFloor(args.class, floorLevel);

    const payload = {
        user_id: userId,
        name: args.name,
        class: args.class,
        ...baseStats,
        level: args.overrides?.level ?? 1,
        gold: args.overrides?.gold ?? 0,
        stat_points: args.overrides?.stat_points ?? 0,
        highest_level: args.overrides?.highest_level ?? 1,
        hp: args.overrides?.hp ?? floor.max_hp,
        mp: args.overrides?.mp ?? floor.max_mp,
        max_hp: args.overrides?.max_hp ?? floor.max_hp,
        max_mp: args.overrides?.max_mp ?? floor.max_mp,
        hp_regen: args.overrides?.hp_regen ?? 1,
        mp_regen: args.overrides?.mp_regen ?? 1,
        ...(args.overrides?.mastery_points !== undefined ? { mastery_points: args.overrides.mastery_points } : {}),
        ...(args.overrides?.arena_league_points !== undefined ? { arena_league_points: args.overrides.arena_league_points } : {}),
        ...(args.overrides?.arena_league !== undefined ? { arena_league: args.overrides.arena_league } : {}),
        ...(args.overrides?.arena_kills !== undefined ? { arena_kills: args.overrides.arena_kills } : {}),
        ...(args.overrides?.arena_deaths !== undefined ? { arena_deaths: args.overrides.arena_deaths } : {}),
        ...(args.overrides?.crit_damage !== undefined ? { crit_damage: args.overrides.crit_damage } : {}),
        ...(args.overrides?.quests_oneshot_done !== undefined ? { quests_oneshot_done: args.overrides.quests_oneshot_done } : {}),
        ...(args.overrides?.quests_daily_done !== undefined ? { quests_daily_done: args.overrides.quests_daily_done } : {}),
        ...(args.overrides?.market_items_sold !== undefined ? { market_items_sold: args.overrides.market_items_sold } : {}),
        ...(args.overrides?.market_gold_earned !== undefined ? { market_gold_earned: args.overrides.market_gold_earned } : {}),
        ...(args.overrides?.market_items_bought !== undefined ? { market_items_bought: args.overrides.market_items_bought } : {}),
        ...(args.overrides?.market_gold_spent !== undefined ? { market_gold_spent: args.overrides.market_gold_spent } : {}),
        ...(args.overrides?.item_upgrades_done !== undefined ? { item_upgrades_done: args.overrides.item_upgrades_done } : {}),
        ...(args.overrides?.best_dps5_solo !== undefined ? { best_dps5_solo: args.overrides.best_dps5_solo } : {}),
    };

    const { data, error } = await withSupabaseRetry(
        () => admin
            .from('characters')
            .insert(payload)
            .select('id, name, class')
            .single(),
    );

    if (error) {
        throw new Error(`[createCharacter] insert failed: ${error.message ?? JSON.stringify(error)}`);
    }
    if (!data) {
        throw new Error('[createCharacter] insert returned no data');
    }

    return {
        id: data.id as string,
        name: data.name as string,
        class: data.class as CharacterClass,
    };
};

export const generateTestCharacterName = (): string => {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `E2E${rand}`;
};
