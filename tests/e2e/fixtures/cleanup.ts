
import { type SupabaseClient } from '@supabase/supabase-js';
import {
    getAdminClient,
    findUserIdByEmail,
    invalidateUserCache,
    withSupabaseRetry,
} from './adminClient';

const TEST_EMAIL_PATTERN = /^e2e-register-\d+-[a-z0-9]+@grimshade-test\.local$/i;

const TEST_EMAIL_DOMAIN = '@grimshade-test.local';

const STABLE_TEST_ACCOUNTS = new Set<string>([
    'test@grimshade.pl',
    'test2@grimshade.pl',
    'e2e-admin@grimshade-test.local',
]);

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
    { table: 'market_listings', key: 'seller_id' },
    { table: 'market_sale_notifications', key: 'seller_id' },
];

export const generateTestEmail = (): string => {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `e2e-register-${ts}-${rand}@grimshade-test.local`;
};

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
    reason: string;
    childCleanup?: Record<string, { ok: boolean; error?: string }>;
}

export const cleanupTestUserByEmail = async (
    email: string,
): Promise<ICleanupResult> => {
    assertSafeTestEmail(email);
    const admin = getAdminClient();

    const userId = await findUserIdByEmail(email);
    if (!userId) {
        return { deleted: false, reason: 'user not found (already deleted)' };
    }

    const childCleanup = await cleanupCharactersForUser(admin, userId);

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

    invalidateUserCache(email);

    return { deleted: true, reason: 'ok', childCleanup };
};

const cleanupCharactersForUser = async (
    admin: SupabaseClient,
    userId: string,
): Promise<Record<string, { ok: boolean; error?: string }>> => {
    const results: Record<string, { ok: boolean; error?: string }> = {};

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
        return results;
    }

    const charIds = chars.map((c: { id: string }) => c.id);

    for (const { table, key } of CHARACTER_CHILD_TABLES) {
        const { error } = await withSupabaseRetry(
            () => admin.from(table).delete().in(key, charIds),
        );
        results[table] = error
            ? { ok: false, error: error.message ?? JSON.stringify(error) }
            : { ok: true };
    }

    const { error: msgErr } = await withSupabaseRetry(
        () => admin.from('messages').delete().eq('user_id', userId),
    );
    results.messages = msgErr
        ? { ok: false, error: msgErr.message ?? JSON.stringify(msgErr) }
        : { ok: true };

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

export const cleanupCharacterById = async (
    characterId: string,
): Promise<ICleanupResult> => {
    const admin = getAdminClient();

    const { data: existing, error: selectErr } = await withSupabaseRetry(
        () => admin
            .from('characters')
            .select('id, name, user_id')
            .eq('id', characterId)
            .maybeSingle(),
    );

    if (selectErr) {
        return { deleted: false, reason: `select check failed: ${selectErr.message ?? JSON.stringify(selectErr)}` };
    }
    if (!existing) {
        return { deleted: false, reason: 'not found (already deleted)' };
    }

    const { name: charName, user_id: charUserId } = existing as { id: string; name?: string; user_id?: string };

    const childCleanup: Record<string, { ok: boolean; error?: string }> = {};
    for (const { table, key } of CHARACTER_CHILD_TABLES) {
        const { error } = await withSupabaseRetry(
            () => admin.from(table).delete().eq(key, characterId),
        );
        childCleanup[table] = error ? { ok: false, error: error.message ?? JSON.stringify(error) } : { ok: true };
    }

    if (charName) {
        const { error: msgErr } = await withSupabaseRetry(
            () => {
                const q = admin.from('messages').delete().eq('character_name', charName);
                return charUserId ? q.eq('user_id', charUserId) : q;
            },
        );
        childCleanup.messages = msgErr ? { ok: false, error: msgErr.message ?? JSON.stringify(msgErr) } : { ok: true };
    }

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

    const userId = await findUserIdByEmail(email);
    if (!userId) {
        return { deleted: false, reason: `stable test account not found: ${email}` };
    }

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

export const cleanupTestChatMessages = async (): Promise<{
    deleted: boolean;
    passes: Record<string, { ok: boolean; error?: string }>;
}> => {
    const admin = getAdminClient();
    const passes: Record<string, { ok: boolean; error?: string }> = {};

    for (const email of STABLE_TEST_ACCOUNTS) {
        const userId = await findUserIdByEmail(email);
        if (!userId) { passes[email] = { ok: false, error: 'account not found' }; continue; }
        const { error } = await withSupabaseRetry(
            () => admin.from('messages').delete().eq('user_id', userId),
        );
        passes[email] = error ? { ok: false, error: error.message ?? JSON.stringify(error) } : { ok: true };
    }

    const { error: e2eErr } = await withSupabaseRetry(
        () => admin.from('messages').delete().like('character_name', 'E2E%'),
    );
    passes['E2E-named'] = e2eErr ? { ok: false, error: e2eErr.message ?? JSON.stringify(e2eErr) } : { ok: true };

    const deleted = Object.values(passes).every((p) => p.ok);
    return { deleted, passes };
};

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

    const userId = await findUserIdByEmail(email);
    if (!userId) {
        return { deleted: false, reason: `stable test account not found in auth.users: ${email}` };
    }

    const childCleanup = await cleanupCharactersForUser(admin, userId);

    const hadCharacters = Object.keys(childCleanup).length > 0;
    if (!hadCharacters) {
        return { deleted: false, reason: 'no characters', childCleanup };
    }

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
    details: Array<{ email: string; result: ICleanupResult }>;
}

export const cleanupAllRegistrationTestUsers = async (): Promise<IBulkCleanupResult> => {
    const admin = getAdminClient();
    const details: Array<{ email: string; result: ICleanupResult }> = [];
    let deleted = 0;
    let failed = 0;
    let skipped = 0;

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

export const cleanupAllCharactersOnStableAccounts = async (): Promise<number> => {
    const admin = getAdminClient();
    const { data: list, error } = await withSupabaseRetry(
        () => admin.auth.admin.listUsers({ perPage: 1000 }),
    );
    if (error) {
        throw new Error(`[cleanup-stable] listUsers failed: ${error.message ?? JSON.stringify(error)}`);
    }

    let wiped = 0;
    for (const user of list.users) {
        if (!user.email || !STABLE_TEST_ACCOUNTS.has(user.email.toLowerCase())) continue;

        const { data: chars } = await withSupabaseRetry(
            () => admin.from('characters').select('id').eq('user_id', user.id),
        );
        const ids = (chars ?? []).map((c: { id: string }) => c.id);
        if (ids.length === 0) continue;

        await withSupabaseRetry(() => admin.from('parties').delete().in('leader_id', ids));
        await withSupabaseRetry(() => admin.from('guilds').delete().in('leader_id', ids));
        for (const { table, key } of CHARACTER_CHILD_TABLES) {
            await withSupabaseRetry(() => admin.from(table).delete().in(key, ids));
        }
        await withSupabaseRetry(() => admin.from('messages').delete().eq('user_id', user.id));
        await withSupabaseRetry(() => admin.from('characters').delete().eq('user_id', user.id));
        wiped += ids.length;
    }

    return wiped;
};
