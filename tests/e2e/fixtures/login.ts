/**
 * Login helpers for E2E.
 *
 * 2026-06-23 ("Step 2" — kill the auth rate-limit): `loginViaUI` now REUSES a
 * session pre-minted once in `global-setup` (see `authState.ts`) instead of
 * doing a real GoTrue password grant on every call. ~315 logins/run collapse
 * to 3, which removes the "listUsers failed: {}" rate-limiting that was timing
 * out the E2E job. All 157 spec files keep calling `loginViaUI(page, user)`
 * unchanged — only the mechanism changed.
 *
 * `loginViaUIReal` keeps the original real-form-login flow as an escape hatch +
 * self-healing fallback (used automatically when no cached session exists or
 * the cached one is rejected as stale).
 */

import { type Page } from '@playwright/test';
import type { ITestUser } from './testUsers';
import { readSavedAuth } from './authState';

/** Wait until the Supabase session is persisted in localStorage. */
const waitForAuthToken = async (page: Page): Promise<boolean> => {
    return page
        .waitForFunction(
            () => {
                for (let i = 0; i < window.localStorage.length; i++) {
                    const k = window.localStorage.key(i);
                    if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) return true;
                }
                return false;
            },
            { timeout: 5_000 },
        )
        .then(() => true)
        .catch(() => false);
};

/**
 * REAL login via the UI form — fills `/login`, submits, waits for the
 * post-login redirect (`/character-select` for a char-less user, or `/` when a
 * character is active) + the Supabase session landing in localStorage.
 *
 * Timeout 20s — a cold GoTrue login can be slow (several network hops).
 */
export const loginViaUIReal = async (page: Page, user: ITestUser): Promise<void> => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    await page.getByRole('button', { name: /zaloguj/i }).tap();

    await page.waitForURL(/\/(character-select)?$/, { timeout: 20_000 });
    await waitForAuthToken(page);
};

/**
 * FAST login by injecting the session pre-minted in global-setup. Injects ONCE
 * (goto `/login` while logged out -> write the token -> goto `/character-select`
 * so the app restores it). We deliberately do NOT use `addInitScript`, which
 * would re-inject on every navigation and fight tests that intentionally clear
 * the session (logout / expiry).
 *
 * Falls back to the real login when no cached session exists or the cached one
 * is rejected (e.g. an expired refresh token) — the test still passes.
 */
export const loginViaUI = async (page: Page, user: ITestUser): Promise<void> => {
    const saved = readSavedAuth(user.label);
    if (!saved) {
        await loginViaUIReal(page, user);
        return;
    }

    // Land on the app origin (logged out) so localStorage is writable, seed the
    // session, then navigate so the app picks it up on a fresh document load.
    await page.goto('/login');
    await page.evaluate(
        (s) => {
            try {
                window.localStorage.setItem(s.name, s.value);
            } catch {
                /* storage quota / disabled — fallback handles it below */
            }
        },
        saved,
    );
    await page.goto('/character-select');

    // App bounces back to /login if it rejected the injected session.
    await page.waitForURL(/\/(login|character-select)?$/, { timeout: 20_000 }).catch(() => {});
    if (page.url().includes('/login')) {
        await loginViaUIReal(page, user);
        return;
    }

    await page.waitForURL(/\/(character-select)?$/, { timeout: 20_000 });
    await waitForAuthToken(page);
};

/** Explicit alias for readability where a test wants to signal session reuse. */
export const loginViaSession = loginViaUI;
