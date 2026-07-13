
import { type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { ITestUser } from './testUsers';
import { readSavedAuth, writeSavedAuth, supabaseAuthStorageKey, type ISavedAuth } from './authState';

const REMINT_BUFFER_MS = 15 * 60 * 1000;

const isExpiredSoon = (saved: ISavedAuth): boolean => {
    try {
        const session = JSON.parse(saved.value) as { expires_at?: number };
        if (!session.expires_at) return true;
        return session.expires_at * 1000 <= Date.now() + REMINT_BUFFER_MS;
    } catch {
        return true;
    }
};

const remintSession = async (user: ITestUser): Promise<ISavedAuth | null> => {
    const url = process.env.VITE_SUPABASE_URL;
    const anon = process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anon) return null;
    try {
        const client = createClient(url, anon, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await client.auth.signInWithPassword({
            email: user.email,
            password: user.password,
        });
        if (error || !data.session) return null;
        const saved: ISavedAuth = {
            name: supabaseAuthStorageKey(url),
            value: JSON.stringify(data.session),
        };
        writeSavedAuth(user.label, saved);
        return saved;
    } catch {
        return null;
    }
};

const ensureFreshAuth = async (user: ITestUser): Promise<ISavedAuth | null> => {
    const saved = readSavedAuth(user.label);
    if (saved && !isExpiredSoon(saved)) return saved;
    return (await remintSession(user)) ?? saved;
};

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

export const loginViaUIReal = async (page: Page, user: ITestUser): Promise<void> => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    await page.getByRole('button', { name: /zaloguj/i }).tap();

    await page.waitForURL(/\/(character-select)?$/, { timeout: 20_000 });
    await waitForAuthToken(page);
};

const injectSession = async (page: Page, saved: ISavedAuth): Promise<void> => {
    await page.goto('/login');
    await page.evaluate(
        (s) => {
            try {
                window.localStorage.setItem(s.name, s.value);
            } catch {
            }
        },
        saved,
    );
    await page.goto('/character-select');
    await page.waitForURL(/\/(login|character-select)?$/, { timeout: 20_000 }).catch(() => {});
};

export const loginViaUI = async (page: Page, user: ITestUser): Promise<void> => {
    await page.addInitScript(() => {
        try {
            window.localStorage.setItem('grimshade_backend_mode', '0');
        } catch {
        }
    });

    let saved = await ensureFreshAuth(user);
    if (!saved) {
        await loginViaUIReal(page, user);
        return;
    }

    await injectSession(page, saved);

    if (page.url().includes('/login')) {
        saved = await remintSession(user);
        if (saved) {
            await injectSession(page, saved);
        }
    }

    if (page.url().includes('/login')) {
        await loginViaUIReal(page, user);
        return;
    }

    await page.waitForURL(/\/(character-select)?$/, { timeout: 20_000 });
    await waitForAuthToken(page);
};

export const loginViaSession = loginViaUI;
