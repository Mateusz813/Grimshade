/**
 * Direct-API death seeder via service_role.
 *
 * Inserts a row into `character_deaths` table — bypasses the in-game
 * combat flow (which would require launching combat + getting killed
 * by a monster, slow + flaky in E2E). Used by `/deaths` feed tests
 * which only care that a row with a given character_name appears in
 * the global feed after navigation.
 *
 * ## Schema (from `src/api/v1/deathsApi.ts` linie 45-72)
 *
 * ```sql
 * CREATE TABLE character_deaths (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     character_id UUID REFERENCES characters(id) ON DELETE CASCADE,
 *     character_name TEXT NOT NULL,
 *     character_class TEXT NOT NULL,
 *     character_level INTEGER NOT NULL,
 *     source TEXT NOT NULL CHECK (source IN ('monster','dungeon','boss','transform','raid')),
 *     source_name TEXT NOT NULL,
 *     source_level INTEGER NOT NULL,
 *     died_at TIMESTAMPTZ DEFAULT NOW(),
 *     result TEXT NOT NULL DEFAULT 'killed' CHECK (result IN ('killed','fled'))
 * );
 * ```
 *
 * ## Cleanup
 *
 * `character_deaths` jest w `CHARACTER_CHILD_TABLES` w
 * `tests/e2e/fixtures/cleanup.ts` (linia 80), więc
 * `cleanupCharacterById(characterId)` zabiera wszystkie deaths tej
 * postaci. Brak osobnego death-cleanup helpera.
 *
 * ## Read-side
 *
 * `deathsApi.listRecentDeaths(1000)` (czytane przez `/deaths` view)
 * pobiera ostatnie 1000 wpisów `ORDER BY died_at DESC LIMIT 1000`.
 * Świeżo zainsertowany row idzie na top listy → widoczny od razu po
 * nawigacji na `/deaths`.
 */

// Shared admin client (cached) — patrz adminClient.ts.
import { getAdminClient, withSupabaseRetry } from './adminClient';

export type TDeathSource = 'monster' | 'dungeon' | 'boss' | 'transform' | 'raid';
export type TDeathResult = 'killed' | 'fled';

export interface ISeedDeathArgs {
    /** Character UUID — FK do `characters.id`. ON DELETE CASCADE zapewnia
     *  że cleanup postaci kasuje też deaths. */
    characterId: string;
    /** Display name postaci (snapshot — nie liveowo joinowany z `characters.name`). */
    characterName: string;
    /** Klasa postaci ('Knight' / 'Mage' / ...). */
    characterClass: string;
    /** Level postaci w momencie śmierci. */
    characterLevel: number;
    /** Typ źródła śmierci. Default 'monster'. */
    source?: TDeathSource;
    /** Display name potwora / dungeon-a (np. 'Szczur', 'Krypta Cesarza'). */
    sourceName: string;
    /** Level potwora / dungeon-a. */
    sourceLevel: number;
    /** Czy gracz został zabity vs uciekł. Default 'killed'. */
    result?: TDeathResult;
    /** Timestamp śmierci. Default = teraz (Supabase default też = NOW()). */
    diedAt?: Date;
}

export interface ISeededDeath {
    /** ID wpisu w `character_deaths` — przyda się gdyby kiedyś trzeba
     *  ręcznie skasować pojedynczy row poza standardowym character-cleanup. */
    id: string;
}

// getAdminClient lives in shared `adminClient.ts`

/**
 * Insert pojedynczego death row-a. Zwraca jego ID. Idempotent w sensie
 * "wywołanie 2× wstawia 2 rowy" (nie deduplikuje) — celowo, bo testy
 * mogą chcieć N deaths jednej postaci dla pagination testów.
 *
 * @example
 * const created = await createCharacterViaApi({ ... });
 * try {
 *   await seedDeath({
 *     characterId: created.id,
 *     characterName: created.name,
 *     characterClass: 'Knight',
 *     characterLevel: 5,
 *     sourceName: 'Szczur',
 *     sourceLevel: 1,
 *   });
 *   // ... navigate to /deaths, assert row visible
 * } finally {
 *   await cleanupCharacterById(created.id);  // killuje też deaths
 * }
 */
export const seedDeath = async (args: ISeedDeathArgs): Promise<ISeededDeath> => {
    const admin = getAdminClient();
    const payload: Record<string, unknown> = {
        character_id: args.characterId,
        character_name: args.characterName,
        character_class: args.characterClass,
        character_level: args.characterLevel,
        source: args.source ?? 'monster',
        source_name: args.sourceName,
        source_level: args.sourceLevel,
    };
    if (args.diedAt) {
        payload.died_at = args.diedAt.toISOString();
    }
    // `result` column dodawany przez `scripts/deaths_migration.sql` —
    // jeśli env Supabase MA tę kolumnę, wpisujemy, inaczej skip żeby
    // nie wybuchnąć z "column not found in schema cache". App-owy
    // `inferResult` w Deaths.tsx (linia 73) i tak fallbackuje do 'killed'
    // gdy column missing. Test może asertować `.deaths__verb--killed`
    // bez polegania na zapisanym `result`.
    if (args.result) {
        payload.result = args.result;
    }

    const { data, error } = await withSupabaseRetry(
        () => admin
            .from('character_deaths')
            .insert(payload)
            .select('id')
            .single(),
    );

    if (error) {
        // Jeśli result column nie istnieje → retry bez result (best-effort
        // dla envów z legacy schema bez deaths_migration.sql).
        if (args.result && (error.message ?? '').includes("'result'")) {
            delete payload.result;
            const retry = await withSupabaseRetry(
                () => admin
                    .from('character_deaths')
                    .insert(payload)
                    .select('id')
                    .single(),
            );
            if (retry.error) {
                throw new Error(`[seedDeath] retry without result failed: ${retry.error.message ?? JSON.stringify(retry.error)}`);
            }
            if (!retry.data) {
                throw new Error('[seedDeath] retry returned no data');
            }
            return { id: retry.data.id as string };
        }
        throw new Error(`[seedDeath] insert failed: ${error.message ?? JSON.stringify(error)}`);
    }
    if (!data) {
        throw new Error('[seedDeath] insert returned no data');
    }

    return { id: data.id as string };
};
