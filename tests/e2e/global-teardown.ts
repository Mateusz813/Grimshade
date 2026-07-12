
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STABLE_TEST_ACCOUNTS = new Set<string>([
    'test@grimshade.pl',
    'test2@grimshade.pl',
    'e2e-admin@grimshade-test.local',
]);

const REGISTRATION_PATTERN = /^e2e-register-\d+-[a-z0-9]+@grimshade-test\.local$/i;

const CHARACTER_CHILD_TABLES = [
    'inventory',
    'game_saves',
    'character_skills',
    'character_weapon_skills',
    'character_deaths',
    'character_death_totals',
    'party_members',
    'guild_members',
    'guild_join_requests',
    'guild_boss_attempts',
    'guild_boss_contributions',
    'guild_treasury_logs',
    'market_listings',
    'market_sale_notifications',
] as const;

const loadEnvFile = (path: string): void => {
    const abs = resolve(process.cwd(), path);
    if (!existsSync(abs)) return;
    for (const raw of readFileSync(abs, 'utf-8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (!match) continue;
        const [, key, value] = match;
        if (process.env[key]) continue;
        process.env[key] = value.replace(/^["'](.*)["']$/, '$1');
    }
};

const globalTeardown = async (): Promise<void> => {
    loadEnvFile('.env.test');

    const url = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
        console.warn('[globalTeardown] Missing env — skipping cleanup');
        return;
    }

    const admin = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    try {
        const { data: list, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
        if (error) {
            console.warn(`[globalTeardown] listUsers failed: ${error.message}`);
            return;
        }

        let staleUsers = 0;
        for (const user of list.users) {
            if (!user.email || !REGISTRATION_PATTERN.test(user.email)) continue;
            const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
            if (delErr) {
                console.warn(`[globalTeardown] Failed to delete ${user.email}: ${delErr.message}`);
            } else {
                staleUsers++;
            }
        }
        if (staleUsers > 0) {
            console.log(`[globalTeardown] Deleted ${staleUsers} stale e2e-register-* users`);
        }

        let staleChars = 0;
        for (const user of list.users) {
            if (!user.email || !STABLE_TEST_ACCOUNTS.has(user.email.toLowerCase())) continue;
            const { data: chars } = await admin
                .from('characters')
                .select('id')
                .eq('user_id', user.id);
            const ids = (chars ?? []).map((c: { id: string }) => c.id);
            if (ids.length === 0) continue;
            await admin.from('parties').delete().in('leader_id', ids);
            await admin.from('guilds').delete().in('leader_id', ids);
            for (const table of CHARACTER_CHILD_TABLES) {
                const key = (table === 'market_listings' || table === 'market_sale_notifications')
                    ? 'seller_id'
                    : 'character_id';
                await admin.from(table).delete().in(key, ids);
            }
            await admin.from('characters').delete().eq('user_id', user.id);
            staleChars += ids.length;
        }
        if (staleChars > 0) {
            console.log(`[globalTeardown] Wiped ${staleChars} leftover characters from stable accounts`);
        }
    } catch (err) {
        console.warn(`[globalTeardown] Cleanup error (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
};

export default globalTeardown;
