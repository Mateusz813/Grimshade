/**
 * Direct-API character seeder via service_role.
 *
 * Tworzy postać bezpośrednio w `auth.users` + `characters` przez
 * Supabase Admin SDK — bez przechodzenia przez UI. Używany przez
 * testy które NIE testują samego flow tworzenia postaci, ale
 * potrzebują postaci do testowanego scenariusza (shop, combat,
 * inventory, etc.).
 *
 * Kiedy używać UI vs API seed:
 *  - UI flow (`tests/e2e/character/create/*`) -> testujemy samo
 *    tworzenie, więc klikamy przez `/create-character`.
 *  - Wszystko inne (shop test, combat test, inventory test) ->
 *    `createCharacterViaApi` żeby setup state był szybki + atomowy.
 *
 * Architectural notes:
 *
 * 1. **CLASS_BASE_STATS duplikat** — wartości skopiowane z
 *    `src/views/CharacterCreate/CharacterCreate.tsx` (linie 47-53).
 *    TODO: jeśli te wartości się zmieniają — extract do
 *    `src/data/classBaseStats.ts` żeby UI + fixture czytały z jednego
 *    źródła. Na razie duplikat z hard-code i komentarz „source of truth"
 *    bo refactor wymaga osobnego commitu.
 *
 * 2. **Pomija starter weapon + inventory bootstrap** — UI flow tworząc
 *    postać dodaje broń startową do `inventory`. API seed tylko tworzy
 *    row w `characters`. Jeśli test potrzebuje broni w plecaku, dorzucamy
 *    osobnym INSERT do `inventory` (lub zbudujemy `seedInventory` helper).
 *
 * 3. **Cleanup**: stworzona postać MUSI być skasowana po teście przez
 *    `cleanupCharactersForEmail(email)` (CLAUDE.md TESTING rule).
 *    `createCharacterViaApi` zwraca `{ id, name }` — test je trzyma w
 *    `try` i kasuje w `finally`.
 */

import { getAdminClient, findUserIdByEmail, withSupabaseRetry } from './adminClient';

export type CharacterClass =
    | 'Knight'
    | 'Mage'
    | 'Cleric'
    | 'Archer'
    | 'Rogue'
    | 'Necromancer'
    | 'Bard';

/**
 * Source of truth (jak na 2026-05-25):
 * `src/views/CharacterCreate/CharacterCreate.tsx` linie 47-53.
 * Jeśli wartości w app się zmienią a tu nie — testy poleca z innymi
 * HP/MP niż UI; alert w PR-rev jeśli ktoś tknie tamten plik.
 */
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

// Admin client + user lookup są w shared `adminClient.ts` (cached lookup
// — pierwsza call w worker procesie = 1 listUsers, kolejne O(1) Map).
// Stary lokalny findUserIdByEmail wołał listUsers ZA KAŻDYM RAZEM ->
// skoczyliśmy CPU NANO compute z 10-15% do 82% w jednym test runie.

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
    /** Email konta na którym tworzymy postać. */
    userEmail: string;
    /** Nick postaci — 3-18 znaków, [a-zA-Z0-9] + max jedna spacja. */
    name: string;
    /** Klasa postaci. */
    class: CharacterClass;
    /**
     * Optional overrides — default = CLASS_BASE_STATS + level 1, gold 0,
     * hp_regen 1, mp_regen 1.
     *
     * **Dla testów konsystencji HP/MP across views**: ustaw `hp_regen: 0`
     * + `mp_regen: 0` żeby wartości nie zmieniały się w trakcie testu
     * (default regen tickuje co sekundę -> race condition na asercjach
     * "view A === view B").
     */
    overrides?: Partial<{
        level: number;
        gold: number;
        hp: number;
        mp: number;
        /**
         * Maksymalne HP. Domyślnie = CLASS_BASE_STATS[class].max_hp.
         *
         * Use case: testy które weryfikują efekt rozdanego `stat_points` w
         * HP. Każdy spent stat-point na `max_hp` w app dodaje +5 (patrz
         * `STAT_POINT_BONUSES` w `src/stores/characterStore.ts` linia 84).
         * Zamiast seedować `stat_points: N` + symulować klikanie w `+HP`
         * tile w Postać tab, override `max_hp` bezpośrednio o oczekiwaną
         * wartość post-spend (np. base 120 + 10 punktów × 5 = 170).
         *
         * UWAGA: gdy `max_hp > 120` (lub inny class base) trzymaj `hp`
         * pod-max żeby UI musiał czytać konkretne wartości, nie domyślne
         * "max/max" które ukrywałoby błędy renderowania.
         */
        max_hp: number;
        /** Maksymalne MP — analogicznie jak `max_hp` (każdy stat-point +5 MP). */
        max_mp: number;
        highest_level: number;
        stat_points: number;
        hp_regen: number;
        mp_regen: number;
        /**
         * Mastery points zdobyte za max-out mastery różnych potworów (każdy
         * monster osiągający 25/25 daje 1 punkt). Stored w `characters.mastery_points`
         * (leaderboard_migration.sql linia 25). Default 0.
         *
         * Use case: BACKLOG 5.11 — rankingi expansion. Seed wysoką wartość
         * (np. 999) żeby GWARANTOWANIE wpaść w top-100 Mastery ranking
         * niezależnie od stanu prod DB. Po teście cleanup usuwa postać ->
         * ranking row znika automatycznie.
         */
        mastery_points: number;
        /**
         * Arena league points. Stored w `characters.arena_league_points`
         * (leaderboard_migration.sql linia 23). Default 0.
         *
         * Use case: BACKLOG 5.11 — rankingi expansion. Seed wysoką wartość
         * żeby wpaść w arena_league ranking top spot.
         */
        arena_league_points: number;
        /**
         * Arena league name — 'bronze' | 'silver' | 'gold' | 'platinum'
         * etc. Stored w `characters.arena_league` (leaderboard_migration.sql
         * linia 22). Default 'bronze'.
         *
         * Sort precedence w arena_league tab: league rank (LEAGUE_ORDER
         * map w Leaderboard.tsx) potem LP. Wysoka league (np. 'platinum')
         * + LP=999 = top spot.
         */
        arena_league: string;
        /**
         * Lifetime arena wins (attacker). Stored w `characters.arena_kills`
         * (leaderboard_migration.sql linia 20). Default 0.
         *
         * Use case: BACKLOG 5.11 — Arena Killers ranking (":dagger: Zabójcy" tab).
         * Sortowanie `arena_kills DESC, limit 100`. Seed wysoką wartość
         * (np. 999) żeby GWARANTOWANIE wpaść w top-100.
         *
         * Synced from arenaStore only after arena combat (`bumpArenaStats`);
         * NIE jest resetowany przez `useLeaderboardStatSync` hook -> bezpiecznie
         * pre-seedować przez column override.
         */
        arena_kills: number;
        /**
         * Lifetime arena losses (attacker). Stored w `characters.arena_deaths`
         * (leaderboard_migration.sql linia 21). Default 0.
         *
         * Use case: BACKLOG 5.11 — Arena Victims ranking (":skull: Ofiary" tab).
         */
        arena_deaths: number;
        /**
         * Crit damage multiplier (e.g. 2.5 = 250%). Stored w `characters.crit_damage`.
         * Base klasowy patrz `CLASS_BASE_STATS` (Knight 2.0 / Rogue 2.5 / etc.).
         *
         * Use case: BACKLOG 5.11 — Crit DMG ranking (":collision: Crit DMG" tab,
         * Leaderboard.tsx linia 149, sort `crit_damage DESC`). Seed wysoką
         * wartość (np. 9.99) żeby wpaść w top-100.
         */
        crit_damage: number;
        /**
         * Quests one-shot (jednorazowe) completion count. Stored w
         * `characters.quests_oneshot_done` (leaderboard_migration.sql linia 27).
         * Default 0.
         *
         * **Sync hook gotcha**: `useLeaderboardStatSync` (src/hooks/useLeaderboardStatSync.ts
         * linia 73-78) resets this to `useQuestStore.completedQuestIds.length`
         * on character switch (`mode: 'set'`). Żeby override przetrwał, ALBO
         * (a) skip character switch (pre-leaderboard nav z direct character-select),
         * ALBO (b) seed completedQuestIds w `seedQuestState` matching same count.
         */
        quests_oneshot_done: number;
        /**
         * Daily quests claimed today. Stored w `characters.quests_daily_done`.
         * Default 0.
         *
         * **Sync hook SAFE**: hook uses `mode: 'max'` (linia 86) — overrides
         * higher value NIE są resetowane. Bezpiecznie pre-seedować.
         */
        quests_daily_done: number;
        /**
         * Market items sold (lifetime count). Stored w `characters.market_items_sold`.
         * Default 0.
         *
         * Use case: BACKLOG 5.11 — Sprzedaż ranking. Sort uses `market_gold_earned DESC`
         * primary (Leaderboard.tsx linia 230), so seed BOTH `market_items_sold`
         * + `market_gold_earned` for deterministic top placement.
         */
        market_items_sold: number;
        /**
         * Market lifetime gold earned from sales. Stored w `characters.market_gold_earned`
         * (BIGINT). Default 0. Primary sort key for "Sprzedaż" tab.
         */
        market_gold_earned: number;
        /**
         * Market items bought (lifetime count). Stored w `characters.market_items_bought`.
         * Default 0. Primary sort uses `market_gold_spent DESC`.
         */
        market_items_bought: number;
        /**
         * Market lifetime gold spent on purchases. Stored w `characters.market_gold_spent`
         * (BIGINT). Default 0. Primary sort key for "Zakupy" tab.
         */
        market_gold_spent: number;
        /**
         * Item upgrades completed (count). Stored w `characters.item_upgrades_done`.
         * Default 0. Sort `item_upgrades_done DESC`.
         */
        item_upgrades_done: number;
        /**
         * 5-second DPS solo high-water mark. Stored w `characters.best_dps5_solo`.
         * Default 0. Sort `best_dps5_solo DESC`.
         *
         * Display formatting: `formatDpsCompact` (Leaderboard.tsx linia 38-42) —
         * `>=1M`: "X.XXM", `>=1K`: "X.XXK", else `N.toLocaleString('pl-PL')`.
         * Final string: `DPS <formatted>`.
         */
        best_dps5_solo: number;
    }>;
}

/**
 * Tworzy postać przez service_role API i zwraca jej id + nick.
 *
 * @example
 * const char = await createCharacterViaApi({
 *   userEmail: testUsers.primary.email,
 *   name: 'TestKnight',
 *   class: 'Knight',
 * });
 * // ... test logic
 * await cleanupCharactersForEmail(testUsers.primary.email);
 */
export const createCharacterViaApi = async (
    args: ICreateCharacterArgs,
): Promise<ICreatedCharacter> => {
    const admin = getAdminClient();
    const userId = await findUserIdByEmailStrict(args.userEmail);
    const baseStats = CLASS_BASE_STATS[args.class];

    const payload = {
        user_id: userId,
        name: args.name,
        class: args.class,
        ...baseStats,
        // Domyślny start: level 1, no gold, no stat points, no highest_level
        level: args.overrides?.level ?? 1,
        gold: args.overrides?.gold ?? 0,
        stat_points: args.overrides?.stat_points ?? 0,
        highest_level: args.overrides?.highest_level ?? 1,
        // Overrides na hp/mp pozwalają stworzyć postać "pre-uszkodzoną" do testów
        // np. testy potion-restores-hp potrzebują postaci z hp < max_hp
        hp: args.overrides?.hp ?? baseStats.hp,
        mp: args.overrides?.mp ?? baseStats.mp,
        // Max HP/MP overrides — pozwalają symulować rozdane stat_points
        // (każdy spent point = +5 max_hp / +5 max_mp). Reszta CLASS_BASE_STATS
        // (attack/defense/etc.) zostaje na class defaults.
        max_hp: args.overrides?.max_hp ?? baseStats.max_hp,
        max_mp: args.overrides?.max_mp ?? baseStats.max_mp,
        // Regen: domyślnie 1, ale testy konsystencji HP/MP MUSZĄ override do 0
        // żeby uniknąć tickowania w trakcie testu.
        hp_regen: args.overrides?.hp_regen ?? 1,
        mp_regen: args.overrides?.mp_regen ?? 1,
        // Ranking columns — DEFAULT 0 / 'bronze' z leaderboard_migration.sql.
        // Tylko nadpisujemy gdy test wyraźnie poda override.
        ...(args.overrides?.mastery_points !== undefined ? { mastery_points: args.overrides.mastery_points } : {}),
        ...(args.overrides?.arena_league_points !== undefined ? { arena_league_points: args.overrides.arena_league_points } : {}),
        ...(args.overrides?.arena_league !== undefined ? { arena_league: args.overrides.arena_league } : {}),
        // Arena counters + crit DMG override (5.11 expansion 2026-05-25).
        ...(args.overrides?.arena_kills !== undefined ? { arena_kills: args.overrides.arena_kills } : {}),
        ...(args.overrides?.arena_deaths !== undefined ? { arena_deaths: args.overrides.arena_deaths } : {}),
        ...(args.overrides?.crit_damage !== undefined ? { crit_damage: args.overrides.crit_damage } : {}),
        // Activity counters — quests / market / upgrades / DPS rankings (5.11 expansion).
        ...(args.overrides?.quests_oneshot_done !== undefined ? { quests_oneshot_done: args.overrides.quests_oneshot_done } : {}),
        ...(args.overrides?.quests_daily_done !== undefined ? { quests_daily_done: args.overrides.quests_daily_done } : {}),
        ...(args.overrides?.market_items_sold !== undefined ? { market_items_sold: args.overrides.market_items_sold } : {}),
        ...(args.overrides?.market_gold_earned !== undefined ? { market_gold_earned: args.overrides.market_gold_earned } : {}),
        ...(args.overrides?.market_items_bought !== undefined ? { market_items_bought: args.overrides.market_items_bought } : {}),
        ...(args.overrides?.market_gold_spent !== undefined ? { market_gold_spent: args.overrides.market_gold_spent } : {}),
        ...(args.overrides?.item_upgrades_done !== undefined ? { item_upgrades_done: args.overrides.item_upgrades_done } : {}),
        ...(args.overrides?.best_dps5_solo !== undefined ? { best_dps5_solo: args.overrides.best_dps5_solo } : {}),
    };

    // Retry na przejściowy PGRST002 ("Could not query the database for the
    // schema cache. Retrying.") + inne network blips pod obciążeniem. Duplicate
    // nick (23505) i inne permanentne kody lecą od razu (isTransientError=false).
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

/**
 * Generuje unikalny nick do testów (max 18 znaków, regex-safe).
 * Format: `E2E{rand6}` (8 znaków, łatwo wyszukiwalny w bazie).
 */
export const generateTestCharacterName = (): string => {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `E2E${rand}`;
};
