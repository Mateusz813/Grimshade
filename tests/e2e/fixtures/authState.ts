/**
 * Pre-authenticated session cache for E2E (2026-06-23, "Step 2").
 *
 * Problem: every test logging in fresh via `loginViaUI` meant ~315 GoTrue
 * password-grant calls per run against ONE shared Supabase project, which
 * rate-limited the auth service ("listUsers failed: {}") and blew the CI time
 * cap. Fix: `global-setup` signs in each test account ONCE and writes the
 * Supabase session blob here; `loginViaUI` then INJECTS that session into
 * localStorage instead of hitting GoTrue — ~315 logins collapse to 3.
 *
 * The injected value is the exact thing supabase-js persists by default:
 *   localStorage["sb-<projectRef>-auth-token"] = JSON.stringify(session)
 * (the app uses `createClient(url, key)` with no custom storageKey/storage,
 * so the default key + plain-JSON value apply).
 *
 * Stale/expired sessions self-heal: if the app rejects the injected token,
 * `loginViaUI` falls back to a real UI login for that test.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type TAuthLabel = 'primary' | 'secondary' | 'admin';

/** A single localStorage entry to inject: the Supabase auth-token key + value. */
export interface ISavedAuth {
    name: string;
    value: string;
}

// Gitignored (see .gitignore) — regenerated every run by global-setup.
const AUTH_DIR = resolve(process.cwd(), 'playwright/.auth');

/** Derive the Supabase localStorage key from the project URL. */
export const supabaseAuthStorageKey = (supabaseUrl: string): string => {
    const ref = new URL(supabaseUrl).hostname.split('.')[0];
    return `sb-${ref}-auth-token`;
};

const authFilePath = (label: TAuthLabel): string => resolve(AUTH_DIR, `${label}.json`);

export const writeSavedAuth = (label: TAuthLabel, saved: ISavedAuth): void => {
    mkdirSync(AUTH_DIR, { recursive: true });
    writeFileSync(authFilePath(label), JSON.stringify(saved), 'utf8');
};

/** Returns the saved session for an account, or null if none was minted. */
export const readSavedAuth = (label: TAuthLabel): ISavedAuth | null => {
    const path = authFilePath(label);
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as ISavedAuth;
    } catch {
        return null;
    }
};
