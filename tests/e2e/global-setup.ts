
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { supabaseAuthStorageKey, writeSavedAuth, writeUserIds, type TAuthLabel } from './fixtures/authState';
import { cleanupAllCharactersOnStableAccounts } from './fixtures/cleanup';

const PROJECT_ROOT = process.cwd();
const DIST = resolve(PROJECT_ROOT, 'dist');
const MANIFEST_PATH = resolve(DIST, 'manifest.webmanifest');
const SW_PATH = resolve(DIST, 'sw.js');
const PKG_PATH = resolve(PROJECT_ROOT, 'package.json');

const isBuildFresh = (): boolean => {
    if (!existsSync(DIST) || !existsSync(MANIFEST_PATH) || !existsSync(SW_PATH)) {
        return false;
    }
    try {
        const distMtime = statSync(MANIFEST_PATH).mtimeMs;
        const pkgMtime = statSync(PKG_PATH).mtimeMs;
        return distMtime >= pkgMtime;
    } catch {
        return false;
    }
};


const loadEnvInto = (path: string): void => {
    const full = resolve(PROJECT_ROOT, path);
    if (!existsSync(full)) return;
    for (const raw of readFileSync(full, 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        if (process.env[key]) continue;
        process.env[key] = line.slice(eq + 1).trim().replace(/^["'](.*)["']$/, '$1');
    }
};

const preauthenticate = async (): Promise<void> => {
    loadEnvInto('.env.test');
    loadEnvInto('.env.local');
    loadEnvInto('.env');

    const url = process.env.VITE_SUPABASE_URL;
    const anon = process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anon) {
        console.warn('[globalSetup] no Supabase URL/anon key — skipping pre-auth; tests fall back to real login');
        return;
    }

    const accounts: Array<[TAuthLabel, string | undefined, string | undefined]> = [
        ['primary', process.env.E2E_USER_EMAIL, process.env.E2E_USER_PASSWORD],
        ['secondary', process.env.E2E_USER2_EMAIL, process.env.E2E_USER2_PASSWORD],
        ['admin', process.env.E2E_ADMIN_EMAIL, process.env.E2E_ADMIN_PASSWORD],
    ];
    const storageKey = supabaseAuthStorageKey(url);
    const userIds: Record<string, string> = {};

    for (const [label, email, password] of accounts) {
        if (!email || !password) continue;
        try {
            const client = createClient(url, anon, {
                auth: { persistSession: false, autoRefreshToken: false },
            });
            const { data, error } = await client.auth.signInWithPassword({ email, password });
            if (error || !data.session) {
                console.warn(`[globalSetup] pre-auth ${label} failed (${error?.message ?? 'no session'}) — real login fallback`);
                continue;
            }
            writeSavedAuth(label, { name: storageKey, value: JSON.stringify(data.session) });
            if (data.user?.id) userIds[email.toLowerCase()] = data.user.id;
        } catch (err) {
            console.warn(`[globalSetup] pre-auth ${label} threw: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    if (Object.keys(userIds).length > 0) writeUserIds(userIds);
};

const wipeStaleCharacters = async (): Promise<void> => {
    try {
        const wiped = await cleanupAllCharactersOnStableAccounts();
        if (wiped > 0) {
            console.log(`[globalSetup] pre-run wipe removed ${wiped} leftover character(s) from stable accounts`);
        }
    } catch (err) {
        console.warn(`[globalSetup] pre-run wipe skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
};

const ensureBuild = (): void => {
    if (isBuildFresh()) return;
    console.log('[globalSetup] dist/ stale — running npm run build before suite');
    try {
        execSync('npm run build', {
            cwd: PROJECT_ROOT,
            stdio: ['ignore', 'ignore', 'pipe'],
            timeout: 180_000,
        });
        console.log('[globalSetup] build OK — PWA test will not skip');
    } catch (err) {
        console.warn(
            `[globalSetup] build failed — PWA test will skip with reason: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
};

const globalSetup = async (): Promise<void> => {
    await preauthenticate();
    await wipeStaleCharacters();
    ensureBuild();
};

export default globalSetup;
