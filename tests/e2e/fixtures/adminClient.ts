
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readUserIds } from './authState';

let adminClient: SupabaseClient | null = null;

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
            'Supabase Dashboard -> Settings -> API -> service_role. Wklej do .env.test.',
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


interface IPgErrorLike {
    message?: string;
    code?: string;
}

const PERMANENT_ERROR_CODES = new Set<string>([
    '23505',
    '23503',
    '23502',
    '23514',
    '42501',
    '42P01',
    '42703',
    '22P02',
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

export const isTransientError = (error: IPgErrorLike | null | undefined): boolean => {
    if (!error) return false;
    if (error.code && PERMANENT_ERROR_CODES.has(error.code)) return false;
    const status = (error as { status?: number }).status;
    if (status === 429 || (typeof status === 'number' && status >= 500)) return true;
    const msg = (error.message ?? '').toLowerCase();
    if (!msg) return true;
    return TRANSIENT_MESSAGE_PATTERNS.some((p) => msg.includes(p));
};

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

const emailToUserIdCache = new Map<string, string>();

let cachePopulated = false;

let diskCacheLoaded = false;

const hydrateFromDisk = (): void => {
    if (diskCacheLoaded) return;
    diskCacheLoaded = true;
    for (const [email, id] of Object.entries(readUserIds())) {
        if (!emailToUserIdCache.has(email.toLowerCase())) {
            emailToUserIdCache.set(email.toLowerCase(), id);
        }
    }
};

export const findUserIdByEmail = async (email: string): Promise<string | null> => {
    const lower = email.toLowerCase();

    if (emailToUserIdCache.has(lower)) {
        return emailToUserIdCache.get(lower)!;
    }

    hydrateFromDisk();
    if (emailToUserIdCache.has(lower)) {
        return emailToUserIdCache.get(lower)!;
    }

    const admin = getAdminClient();
    const { data: list, error } = await withSupabaseRetry(
        () => admin.auth.admin.listUsers({ perPage: 1000 }),
    );
    if (error) {
        throw new Error(`[fixtures] listUsers failed: ${error.message ?? JSON.stringify(error)}`);
    }
    if (!list) return null;

    for (const u of list.users) {
        if (u.email) {
            emailToUserIdCache.set(u.email.toLowerCase(), u.id);
        }
    }
    cachePopulated = true;

    return emailToUserIdCache.get(lower) ?? null;
};

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

export const invalidateUserCache = (email: string): void => {
    emailToUserIdCache.delete(email.toLowerCase());
};

export const addToUserCache = (email: string, userId: string): void => {
    emailToUserIdCache.set(email.toLowerCase(), userId);
};

export const __isUserCachePopulated = (): boolean => cachePopulated;
