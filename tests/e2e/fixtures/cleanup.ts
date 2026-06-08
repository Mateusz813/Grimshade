/**
 * Test-account & character cleanup helpers.
 *
 * Dwa typy cleanup:
 *
 *  A. **`cleanupTestUserByEmail(email)`** — hard-delete user-a
 *     z `auth.users` + jego character-ów + child rows. Tylko dla
 *     ULOTNYCH kont rejestrowanych w testach (whitelist domeny
 *     `@grimshade-test.local`).
 *
 *  B. **`cleanupCharactersForEmail(email)`** — kasuje TYLKO charactery
 *     usera + ich child rows. **User zostaje.** Dla STAŁYCH kont
 *     (`test@grimshade.pl`, `test2@grimshade.pl`) — żaden test nie
 *     zostawia po sobie postaci. To jest hard rule per CLAUDE.md
 *     TESTING ("masz zawsze kasowac postac na testowych kontach po
 *     kazdym tescie").
 *
 * Architectural decisions (2026-05-24):
 *
 * 1. **Service role key, not RPC.** We use `auth.admin.deleteUser()`
 *    + admin client dla `from(table).delete()` (bypass RLS).
 *    Alternative — custom `SECURITY DEFINER` Postgres function called
 *    with anon key — odrzucone: więcej SQL do utrzymania + bug w
 *    whitelist function = security hole.
 *
 * 2. **Whitelist pattern dla user-delete.** Helper ABSOLUTNIE odmawia
 *    kasowania emaila który nie matchuje
 *    `/^e2e-register-\d+-[a-z0-9]+@grimshade-test\.local$/i`. Stałe
 *    konta są CHRONIONE przed accidental hard-delete.
 *
 * 3. **Whitelist pattern dla character-delete.** `cleanupCharactersForEmail`
 *    akceptuje TYLKO emaile z listy `STABLE_TEST_ACCOUNTS` (primary +
 *    secondary). Każdy inny → Error. Tak żeby nie skasować postaci
 *    realnemu graczowi nawet jak ktoś przekaże losowy email.
 *
 * 4. **Defensive cleanup of child tables.** Nie ufamy że cascade FK
 *    od `characters` etc. są wszędzie skonfigurowane (zweryfikowano:
 *    scripts/*.sql nie zawiera bazowych tabel — schemat tworzony
 *    przez Supabase Dashboard UI). Helper leci po liście tabel
 *    bottom-up; best-effort na każdej z osobna.
 *
 * 5. **Lazy admin client.** Buduje się dopiero przy pierwszym wywołaniu —
 *    import helpera w pliku który go nie używa nie odpala walidacji env.
 *
 * 6. **`generateTestEmail()` jest unikalny** — timestamp + 6-char rand.
 *    Kolizja przy `fullyParallel` Playwright praktycznie niemożliwa.
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import {
    getAdminClient,
    findUserIdByEmail,
    invalidateUserCache,
    withSupabaseRetry,
} from './adminClient';

/** Whitelist user-delete — TYLKO emaile w tym kształcie. */
const TEST_EMAIL_PATTERN = /^e2e-register-\d+-[a-z0-9]+@grimshade-test\.local$/i;

/** Domena testowa — używana też w bulk-cleanup. */
const TEST_EMAIL_DOMAIN = '@grimshade-test.local';

/**
 * Whitelist character-delete: STAŁE konta na których wolno kasować
 * charactery (ale NIE samego usera). Hard-coded żeby helper był
 * idiot-proof — pomyłkowy `cleanupCharactersForEmail('jakis-real-gracz@gmail.com')`
 * rzuca Error zamiast skasować dane graczowi.
 */
const STABLE_TEST_ACCOUNTS = new Set<string>([
    'test@grimshade.pl',
    'test2@grimshade.pl',
    // 2026-05-26: dedykowane admin test account dla BACKLOG 15.6 (full 9-tab
    // admin panel smoke). Whitelistowane w `ADMIN_EMAILS` w
    // `src/components/ui/AdminPanel/AdminPanel.tsx`. Fake TLD = Supabase nie
    // wyśle realnego maila.
    'e2e-admin@grimshade-test.local',
]);

/**
 * Tabele które trzymają dane character-a. Bottom-up cleanup leci po
 * tej liście ZANIM dotknie `characters`. Lista skompilowana z
 * `grep -rE "rest/v1/[a-z_]+" src/`. Każdy wpis = `{ table, key }`
 * gdzie `key` to nazwa kolumny FK do character-a (zazwyczaj
 * `character_id`, ale market używa `seller_id`).
 */
const CHARACTER_CHILD_TABLES: ReadonlyArray<{ table: string; key: string }> = [
    { table: 'inventory', key: 'character_id' },
    { table: 'game_saves', key: 'character_id' },
    { table: 'character_skills', key: 'character_id' },
    { table: 'character_weapon_skills', key: 'character_id' },
    { table: 'character_deaths', key: 'character_id' },
    { table: 'character_death_totals', key: 'character_id' },
    { table: 'party_members', key: 'character_id' },
    { table: 'guild_members', key: 'character_id' },
    { table: 'guild_join_requests', key: 'character_id' },
    { table: 'guild_boss_attempts', key: 'character_id' },
    { table: 'guild_boss_contributions', key: 'character_id' },
    { table: 'guild_treasury_logs', key: 'character_id' },
    // Market — kolumna nazwa `seller_id` ale referencuje `characters.id`
    // (sprawdzone w src/views/Market/Market.tsx — `sellerId: character.id`).
    { table: 'market_listings', key: 'seller_id' },
    { table: 'market_sale_notifications', key: 'seller_id' },
];

/**
 * Generuje unikalny email do testów rejestracji. Format:
 * `e2e-register-{timestamp_ms}-{rand6}@grimshade-test.local`
 */
export const generateTestEmail = (): string => {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `e2e-register-${ts}-${rand}@grimshade-test.local`;
};

/**
 * Rzuca `Error` jeśli email nie pasuje do whitelist patternu.
 * Wywoływane przed każdym delete jako safety net.
 */
export const assertSafeTestEmail = (email: string): void => {
    if (!TEST_EMAIL_PATTERN.test(email)) {
        throw new Error(
            `[cleanup] Refusing to delete email outside test pattern: ${email}\n` +
            `Allowed pattern: /^e2e-register-\\d+-[a-z0-9]+@grimshade-test\\.local$/i`,
        );
    }
};

export interface ICleanupResult {
    deleted: boolean;
    /** Krótki opis co się stało — dla debug-u w razie failu. */
    reason: string;
    /** Statusy per-tabela child-table cleanup (best-effort). */
    childCleanup?: Record<string, { ok: boolean; error?: string }>;
}

/**
 * Hard-delete usera + jego character-ów + wszystkich child rows.
 * Idempotent: drugi call dla tego samego emaila zwraca
 * `{ deleted: false, reason: 'user not found (already deleted)' }`.
 */
export const cleanupTestUserByEmail = async (
    email: string,
): Promise<ICleanupResult> => {
    assertSafeTestEmail(email);
    const admin = getAdminClient();

    // 1. Find user by email — używamy CACHED lookup (adminClient.ts).
    //    Pierwsza call w worker procesie = 1 listUsers, kolejne = O(1) Map.
    //    Przed refactorem każdy cleanup robił własny listUsers → CPU NANO 82%.
    const userId = await findUserIdByEmail(email);
    if (!userId) {
        return { deleted: false, reason: 'user not found (already deleted)' };
    }

    // 2. Defensive child cleanup (best-effort, errors don't block delete-user)
    const childCleanup = await cleanupCharactersForUser(admin, userId);

    // 3. Hard delete the auth user
    const { error: delErr } = await withSupabaseRetry(
        () => admin.auth.admin.deleteUser(userId),
    );
    if (delErr) {
        return {
            deleted: false,
            reason: `deleteUser failed: ${delErr.message ?? JSON.stringify(delErr)}`,
            childCleanup,
        };
    }

    // 4. Invalidate cache entry (user już nie istnieje)
    invalidateUserCache(email);

    return { deleted: true, reason: 'ok', childCleanup };
};

const cleanupCharactersForUser = async (
    admin: SupabaseClient,
    userId: string,
): Promise<Record<string, { ok: boolean; error?: string }>> => {
    const results: Record<string, { ok: boolean; error?: string }> = {};

    // Find all characters owned by this user
    const { data: chars, error: charsErr } = await withSupabaseRetry(
        () => admin
            .from('characters')
            .select('id')
            .eq('user_id', userId),
    );

    if (charsErr) {
        results.characters_select = { ok: false, error: charsErr.message ?? JSON.stringify(charsErr) };
        return results;
    }
    if (!chars || chars.length === 0) {
        // No characters → nothing to clean up
        return results;
    }

    const charIds = chars.map((c: { id: string }) => c.id);

    // Delete from each child table — best effort. Każda tabela ma
    // własną kolumnę FK (`character_id` zazwyczaj, `seller_id` w market).
    for (const { table, key } of CHARACTER_CHILD_TABLES) {
        const { error } = await withSupabaseRetry(
            () => admin.from(table).delete().in(key, charIds),
        );
        results[table] = error
            ? { ok: false, error: error.message ?? JSON.stringify(error) }
            : { ok: true };
    }

    // Delete characters themselves
    const { error: charDelErr } = await withSupabaseRetry(
        () => admin
            .from('characters')
            .delete()
            .eq('user_id', userId),
    );
    results.characters = charDelErr
        ? { ok: false, error: charDelErr.message ?? JSON.stringify(charDelErr) }
        : { ok: true };

    return results;
};

/**
 * Per-character cleanup po ID. Najbezpieczniejszy wariant dla testów
 * z `fullyParallel: true` — kasuje TYLKO jedną postać + jej child rows,
 * nie ruszając innych postaci tego samego usera (np. tworzonych przez
 * inny test równolegle).
 *
 * Use case: tests które używają `createCharacterViaApi` mają zwrócony
 * `id` postaci — przekazują go tutaj w `finally`. Idempotent — jeśli
 * postać już nie istnieje, zwraca `{ deleted: false, reason: 'not found' }`.
 *
 * Safety: SUPABASE service_role bypassuje RLS, więc nie ma whitelist
 * po email — ale ID jest UUID-em zwróconym przez `createCharacterViaApi`
 * tylko dla świeżo stworzonej postaci, więc skala blast-radius =
 * 1 row (ta konkretna postać + jej children).
 */
export const cleanupCharacterById = async (
    characterId: string,
): Promise<ICleanupResult> => {
    const admin = getAdminClient();

    // Sprawdź czy postać istnieje (idempotent guard)
    const { data: existing, error: selectErr } = await withSupabaseRetry(
        () => admin
            .from('characters')
            .select('id')
            .eq('id', characterId)
            .maybeSingle(),
    );

    if (selectErr) {
        return { deleted: false, reason: `select check failed: ${selectErr.message ?? JSON.stringify(selectErr)}` };
    }
    if (!existing) {
        return { deleted: false, reason: 'not found (already deleted)' };
    }

    // Bottom-up child cleanup, scoped do tej jednej postaci
    const childCleanup: Record<string, { ok: boolean; error?: string }> = {};
    for (const { table, key } of CHARACTER_CHILD_TABLES) {
        const { error } = await withSupabaseRetry(
            () => admin.from(table).delete().eq(key, characterId),
        );
        childCleanup[table] = error ? { ok: false, error: error.message ?? JSON.stringify(error) } : { ok: true };
    }

    // Delete the character itself
    const { error: charDelErr } = await withSupabaseRetry(
        () => admin
            .from('characters')
            .delete()
            .eq('id', characterId),
    );
    childCleanup.characters = charDelErr
        ? { ok: false, error: charDelErr.message ?? JSON.stringify(charDelErr) }
        : { ok: true };

    if (charDelErr) {
        return {
            deleted: false,
            reason: `characters delete failed: ${charDelErr.message ?? JSON.stringify(charDelErr)}`,
            childCleanup,
        };
    }

    return { deleted: true, reason: 'ok', childCleanup };
};

/**
 * Per-character cleanup po NICKU (gdy test stworzył postać przez UI
 * i nie ma `id`). Whitelistuje email do stałych kont, żeby pomyłkowo
 * nie skasować postaci realnemu graczowi.
 *
 * UWAGA: jeśli na koncie istnieją 2 postacie o tym samym nicku
 * (DB pozwala — brak unique constraint), kasuje OBYDWIE. To dobre dla
 * testów (zachowanie defensive), ale jeśli kiedyś wprowadzimy unique
 * constraint, ten helper będzie operował tylko na 1 row-ie.
 */
export const cleanupCharacterByName = async (
    email: string,
    characterName: string,
): Promise<ICleanupResult> => {
    const lower = email.toLowerCase();
    if (!STABLE_TEST_ACCOUNTS.has(lower)) {
        throw new Error(
            `[cleanup] Refusing to wipe character "${characterName}" for email outside STABLE_TEST_ACCOUNTS: ${email}`,
        );
    }

    const admin = getAdminClient();

    // Find user id — CACHED lookup
    const userId = await findUserIdByEmail(email);
    if (!userId) {
        return { deleted: false, reason: `stable test account not found: ${email}` };
    }

    // Find character(s) by name + user_id
    const { data: chars, error: charsErr } = await withSupabaseRetry(
        () => admin
            .from('characters')
            .select('id')
            .eq('user_id', userId)
            .eq('name', characterName),
    );

    if (charsErr) {
        return { deleted: false, reason: `select chars failed: ${charsErr.message ?? JSON.stringify(charsErr)}` };
    }
    if (!chars || chars.length === 0) {
        return { deleted: false, reason: `character "${characterName}" not found (already deleted or never created)` };
    }

    // Loop in case of duplicates (DB doesn't enforce unique nick yet)
    const results: ICleanupResult[] = [];
    for (const c of chars) {
        results.push(await cleanupCharacterById(c.id as string));
    }

    const allDeleted = results.every((r) => r.deleted);
    return {
        deleted: allDeleted,
        reason: allDeleted ? 'ok' : `partial: ${results.map((r) => r.reason).join('; ')}`,
        childCleanup: results[0]?.childCleanup,
    };
};

/**
 * Bulk version: kasuje WSZYSTKIE charactery + child rows usera
 * o danym emailu, ALE samego user-a (`auth.users` row) zostawia w spokoju.
 *
 * **Tylko jako safety-net** — w testach równoległych użyj
 * `cleanupCharacterById` lub `cleanupCharacterByName` żeby nie wymieść
 * postaci tworzonej przez inny test running concurrently.
 *
 * Use case:
 *  - CI cron raz dziennie (catch-up sieroty)
 *  - lokalnie przed dużym test runem żeby start od zera
 *  - test który celowo testuje "user with multiple chars" + jest jedyny
 *    używający tego konta (serial mode dla pliku)
 */
export const cleanupCharactersForEmail = async (
    email: string,
): Promise<ICleanupResult> => {
    const lower = email.toLowerCase();
    if (!STABLE_TEST_ACCOUNTS.has(lower)) {
        throw new Error(
            `[cleanup] Refusing to wipe characters for email outside STABLE_TEST_ACCOUNTS: ${email}\n` +
            `Allowed: ${[...STABLE_TEST_ACCOUNTS].join(', ')}\n` +
            `Jeśli to nowe konto testowe — dodaj je do STABLE_TEST_ACCOUNTS w cleanup.ts.`,
        );
    }

    const admin = getAdminClient();

    // Find user id by email — CACHED lookup
    const userId = await findUserIdByEmail(email);
    if (!userId) {
        return { deleted: false, reason: `stable test account not found in auth.users: ${email}` };
    }

    const childCleanup = await cleanupCharactersForUser(admin, userId);

    // `cleanupCharactersForUser` zwraca empty obj gdy postaci nie ma
    const hadCharacters = Object.keys(childCleanup).length > 0;
    if (!hadCharacters) {
        return { deleted: false, reason: 'no characters', childCleanup };
    }

    // Sprawdź czy `characters` delete się udał
    const charactersResult = childCleanup.characters;
    if (charactersResult && !charactersResult.ok) {
        return {
            deleted: false,
            reason: `characters delete failed: ${charactersResult.error}`,
            childCleanup,
        };
    }

    return { deleted: true, reason: 'ok', childCleanup };
};

export interface IBulkCleanupResult {
    deleted: number;
    failed: number;
    skipped: number;
    /** Wszystkie napotkane test-emaile + ich status — dla debug-u. */
    details: Array<{ email: string; result: ICleanupResult }>;
}

/**
 * Safety-net cleanup: znajduje WSZYSTKIE konta z domeną
 * `@grimshade-test.local` i hard-deletuje każde matchujące
 * whitelist pattern. Użyteczne:
 *  - jako CI cron (raz na dobę — łapie sieroty po failed afterEach)
 *  - manual: `npx tsx -e "import('./tests/e2e/fixtures/cleanup').then(c => c.cleanupAllRegistrationTestUsers().then(console.log))"`
 *  - lokalnie przed dużym test run-em żeby zacząć od czystego stanu
 */
export const cleanupAllRegistrationTestUsers = async (): Promise<IBulkCleanupResult> => {
    const admin = getAdminClient();
    const details: Array<{ email: string; result: ICleanupResult }> = [];
    let deleted = 0;
    let failed = 0;
    let skipped = 0;

    // Bulk leci celowo NIE cache-d listUsers — chcemy świeżą listę
    // żeby złapać też userów stworzonych przez inne worker-y między
    // cache populate a teraz. Retry tylko na przejściowe GoTrue blips
    // (pusty `{}` error) — wciąż świeża lista, nie cache.
    const { data: list, error } = await withSupabaseRetry(
        () => admin.auth.admin.listUsers({ perPage: 1000 }),
    );
    if (error) {
        throw new Error(`[cleanup-all] listUsers failed: ${error.message ?? JSON.stringify(error)}`);
    }

    for (const user of list.users) {
        const email = user.email;
        if (!email || !email.toLowerCase().endsWith(TEST_EMAIL_DOMAIN)) {
            continue;
        }
        if (!TEST_EMAIL_PATTERN.test(email)) {
            // Email jest w domenie testowej ALE nie matchuje pełnego patternu
            // (np. ręcznie utworzony przez kogoś `foo@grimshade-test.local`).
            // Nie ruszamy — safety pierwsza.
            skipped++;
            details.push({
                email,
                result: { deleted: false, reason: 'matches domain but not full pattern (skipped for safety)' },
            });
            continue;
        }

        const result = await cleanupTestUserByEmail(email);
        details.push({ email, result });
        if (result.deleted) deleted++;
        else failed++;
    }

    return { deleted, failed, skipped, details };
};
