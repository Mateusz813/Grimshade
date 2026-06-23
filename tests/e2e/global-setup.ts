/**
 * Playwright globalSetup — runs ONCE before the entire test suite.
 *
 * Purpose: ensure `dist/` build artifacts (manifest.webmanifest + sw.js)
 * exist BEFORE PWA tests run. Without this pre-build, the PWA spec
 * (`tests/e2e/pwa/build-manifest-and-sw.spec.ts`) calls `npm run build`
 * itself in-test and falls back to `test.skip(true, ...)` if the build
 * step fails for any reason (memory pressure during full suite,
 * concurrent file lock, etc.). Pre-building once here removes that
 * skip vector entirely — the build runs in a clean environment before
 * any test workers start.
 *
 * Runs `npm run build` only if dist/ is missing or stale relative to
 * package.json mtime — same freshness check the PWA spec uses, so we
 * don't waste 30s on every local run if the build is already current.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { supabaseAuthStorageKey, writeSavedAuth, type TAuthLabel } from './fixtures/authState';

// ESM-safe project root — Playwright invokes globalSetup z working dir
// = project root, więc process.cwd() jest deterministyczny + nie cierpi
// na ESM-vs-CJS __dirname problemy.
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

// -- Pre-authentication (2026-06-23, "Step 2") -------------------------------
// Sign in each test account ONCE here and cache the Supabase session, so
// `loginViaUI` can inject it instead of hitting GoTrue per test (~315 logins
// -> 3). Kills the auth rate-limit that was timing out the E2E job.

/**
 * Fill process.env from a dotenv file WITHOUT overriding values already set
 * (CI passes secrets directly; locally Playwright already loaded `.env.test`
 * but the anon key lives in `.env.local`). Mirrors playwright.config's loader.
 */
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
        // eslint-disable-next-line no-console
        console.warn('[globalSetup] no Supabase URL/anon key — skipping pre-auth; tests fall back to real login');
        return;
    }

    const accounts: Array<[TAuthLabel, string | undefined, string | undefined]> = [
        ['primary', process.env.E2E_USER_EMAIL, process.env.E2E_USER_PASSWORD],
        ['secondary', process.env.E2E_USER2_EMAIL, process.env.E2E_USER2_PASSWORD],
        ['admin', process.env.E2E_ADMIN_EMAIL, process.env.E2E_ADMIN_PASSWORD],
    ];
    const storageKey = supabaseAuthStorageKey(url);

    for (const [label, email, password] of accounts) {
        if (!email || !password) continue;
        try {
            const client = createClient(url, anon, {
                auth: { persistSession: false, autoRefreshToken: false },
            });
            const { data, error } = await client.auth.signInWithPassword({ email, password });
            if (error || !data.session) {
                // eslint-disable-next-line no-console
                console.warn(`[globalSetup] pre-auth ${label} failed (${error?.message ?? 'no session'}) — real login fallback`);
                continue;
            }
            writeSavedAuth(label, { name: storageKey, value: JSON.stringify(data.session) });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`[globalSetup] pre-auth ${label} threw: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
};

const ensureBuild = (): void => {
    if (isBuildFresh()) return;
    // eslint-disable-next-line no-console
    console.log('[globalSetup] dist/ stale — running npm run build before suite');
    try {
        execSync('npm run build', {
            cwd: PROJECT_ROOT,
            stdio: ['ignore', 'ignore', 'pipe'],
            timeout: 180_000,
        });
        // eslint-disable-next-line no-console
        console.log('[globalSetup] build OK — PWA test will not skip');
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
            `[globalSetup] build failed — PWA test will skip with reason: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
};

const globalSetup = async (): Promise<void> => {
    // Pre-auth ALWAYS runs (even when the build is fresh) so the session cache
    // is regenerated every run.
    await preauthenticate();
    ensureBuild();
};

export default globalSetup;
