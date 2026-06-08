/**
 * Shared admin Supabase client + cached user_id lookup.
 *
 * Problem (2026-05-25): pre-refactor każdy `cleanupCharacterByName` /
 * `cleanupCharactersForEmail` / `createCharacterViaApi` wołał
 * `admin.auth.admin.listUsers({ perPage: 1000 })` żeby znaleźć user_id
 * po emailu. Przy ~80 cleanup ops w jednym test runie = 80 razy
 * paginated list 1000 userów = ~80×400 KB JSON over the wire +
 * Postgres-side full table scan. Sumarycznie skoczyliśmy CPU NANO
 * compute z 10-15% do 82% w jednym runie.
 *
 * Fix: cache `user_id` per email w module-level Map. Pierwsza call =
 * jeden listUsers (cache się WSZYSTKICH userów na raz), kolejne =
 * O(1) Map lookup. Per-worker (każdy Playwright worker ma własny
 * proces → własny cache, ale max 2 workers = max 2 listUsers calls
 * per full run zamiast 80+).
 *
 * Bonus: cache jest **append-only** — jak ktoś stworzy nowego usera w
 * trakcie test runa (registration tests), kolejny lookup go znajdzie
 * (bo i tak wyczerpie cache miss + zaktualizuje). Stale entries (user
 * skasowany) nie blokują delete — usuwamy z cache po deleteUser success.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let adminClient: SupabaseClient | null = null;

/**
 * Lazy admin client — bytes, error on missing env at first call.
 * Shared across all fixtures (cleanup, createCharacter, seedInventory, …).
 */
export const getAdminClient = (): SupabaseClient => {
    if (adminClient) return adminClient;

    const url = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url) {
        throw new Error(
            '[fixtures] Brak VITE_SUPABASE_URL w env. ' +
            'Sprawdź .env.test (Playwright config ładuje z `loadEnvFile`).',
        );
    }
    if (!serviceKey) {
        throw new Error(
            '[fixtures] Brak SUPABASE_SERVICE_ROLE_KEY w env. ' +
            'Supabase Dashboard → Settings → API → service_role. Wklej do .env.test.',
        );
    }

    adminClient = createClient(url, serviceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
    return adminClient;
};

// ── Transient-error retry (Supabase under load) ───────────────────────────────
//
// Pod obciążeniem (cały E2E run hammeruje NANO/MICRO compute) Supabase
// zwraca przejściowe błędy które NIE są bugiem testu:
//   • PostgREST: "Could not query the database for the schema cache. Retrying."
//     (PGRST002 — PostgREST przeładowuje schema cache, np. po cold-start /
//     pod presją connection poola)
//   • GoTrue admin API: pusty error `{}` z `listUsers` (network blip)
//   • generyczne: fetch failed / timeout / ECONNRESET / 502-504
//
// Retry-with-backoff zamienia te flaki w sukces. Błędy PERMANENTNE
// (duplicate nick 23505, FK 23503, RLS 42501, …) NIE są retry'owane —
// lecą od razu, bo retry by ich nie naprawił.

interface IPgErrorLike {
    message?: string;
    code?: string;
}

// PostgREST/Postgres kody które są DETERMINISTYCZNIE permanentne — nie ma
// sensu ich retry'ować (wynik się nie zmieni).
const PERMANENT_ERROR_CODES = new Set<string>([
    '23505', // unique_violation (duplicate nick)
    '23503', // foreign_key_violation
    '23502', // not_null_violation
    '23514', // check_violation (np. source enum)
    '42501', // insufficient_privilege (RLS)
    '42P01', // undefined_table
    '42703', // undefined_column
    '22P02', // invalid_text_representation
]);

const TRANSIENT_MESSAGE_PATTERNS = [
    'schema cache',
    'could not query the database',
    'fetch failed',
    'timeout',
    'timed out',
    'econnreset',
    'socket hang up',
    'network',
    'service unavailable',
    'temporarily unavailable',
    'too many',
    'connection',
    'rate limit',
    '502', '503', '504',
];

/**
 * Czy błąd jest przejściowy (warto retry'ować)?
 *  • brak błędu → false (sukces)
 *  • znany permanentny kod → false (leci od razu)
 *  • pusty / brak message ({} error) → true (traktujemy jak network blip)
 *  • message pasuje do transient-patterns → true
 *  • cokolwiek innego → false (nieznany permanentny — nie maskujemy go retry'em)
 */
export const isTransientError = (error: IPgErrorLike | null | undefined): boolean => {
    if (!error) return false;
    if (error.code && PERMANENT_ERROR_CODES.has(error.code)) return false;
    const msg = (error.message ?? '').toLowerCase();
    if (!msg) return true; // pusty {} / brak message → retry
    return TRANSIENT_MESSAGE_PATTERNS.some((p) => msg.includes(p));
};

/**
 * Owijka retry dla Supabase ops zwracających `{ data, error }`. Zachowuje
 * kontrakt — zwraca pełny result (z `data` typing), więc caller robi swoje
 * istniejące `if (error) throw`. Retry tylko gdy `isTransientError`.
 *
 * Backoff: 400ms, 800ms, 1600ms (maxAttempts=4 → 3 retry).
 */
export const withSupabaseRetry = async <R extends { error: IPgErrorLike | null }>(
    op: () => PromiseLike<R>,
    maxAttempts = 4,
): Promise<R> => {
    let result = await op();
    let attempt = 1;
    while (result.error && isTransientError(result.error) && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)));
        result = await op();
        attempt += 1;
    }
    return result;
};

// Module-level cache: email (lowercase) → user_id.
// Per-worker scope — każdy Playwright worker ma swój proces + cache.
const emailToUserIdCache = new Map<string, string>();

let cachePopulated = false;

/**
 * Find user_id by email — first call paginates all users + caches them,
 * subsequent calls O(1) lookup.
 *
 * Returns `null` jeśli user nie istnieje. Nie zwraca błędu — bo dla
 * cleanup helpers "no user" = "already deleted" = OK case.
 */
export const findUserIdByEmail = async (email: string): Promise<string | null> => {
    const lower = email.toLowerCase();

    // Fast path: w cache
    if (emailToUserIdCache.has(lower)) {
        return emailToUserIdCache.get(lower)!;
    }

    // Cache miss → populate cache (pierwsza call w worker procesie).
    // Retry na przejściowe GoTrue blips (pusty `{}` error pod obciążeniem).
    const admin = getAdminClient();
    const { data: list, error } = await withSupabaseRetry(
        () => admin.auth.admin.listUsers({ perPage: 1000 }),
    );
    if (error) {
        throw new Error(`[fixtures] listUsers failed: ${error.message ?? JSON.stringify(error)}`);
    }
    if (!list) return null;

    // Cache wszystkich userów na raz — kolejne lookups O(1).
    for (const u of list.users) {
        if (u.email) {
            emailToUserIdCache.set(u.email.toLowerCase(), u.id);
        }
    }
    cachePopulated = true;

    return emailToUserIdCache.get(lower) ?? null;
};

/**
 * Force-find user that NIE jest w cache (np. świeżo utworzony przez
 * registration test). Robi 1 listUsers call + odświeża cache.
 */
export const refreshUserCache = async (): Promise<void> => {
    const admin = getAdminClient();
    const { data: list, error } = await withSupabaseRetry(
        () => admin.auth.admin.listUsers({ perPage: 1000 }),
    );
    if (error) {
        throw new Error(`[fixtures] refreshUserCache listUsers failed: ${error.message ?? JSON.stringify(error)}`);
    }
    if (!list) return;
    emailToUserIdCache.clear();
    for (const u of list.users) {
        if (u.email) emailToUserIdCache.set(u.email.toLowerCase(), u.id);
    }
    cachePopulated = true;
};

/**
 * Invalidate one entry — po skasowanym userze.
 * NIE czyści całego cache, kolejne lookup-y innych userów wciąż O(1).
 */
export const invalidateUserCache = (email: string): void => {
    emailToUserIdCache.delete(email.toLowerCase());
};

/**
 * Add to cache po świeżo utworzonym userze (registration test).
 */
export const addToUserCache = (email: string, userId: string): void => {
    emailToUserIdCache.set(email.toLowerCase(), userId);
};

/** Test-only: czy cache jest już populated. */
export const __isUserCachePopulated = (): boolean => cachePopulated;
