/**
 * Login via UI helper — wypełnia formularz na `/login`, klikuje submit,
 * czeka aż router osiądzie na `/character-select` (świeży user bez
 * postaci) LUB `/` (user z aktywną postacią w storze).
 *
 * Decision (2026-05-25): login leci PRZEZ UI, nie przez bezpośredni
 * `supabase.auth.signInWithPassword`. Powód: wiele testów ASSERTUJE
 * stan po loginie (redirect chain, hydratacja storów, header render),
 * a `storageState` injection by ten flow ominęło. Dla stricte
 * smoke-testów które tylko potrzebują "być zalogowanym" dorzucimy
 * `loginViaStorageState` w przyszłości — na razie wszystkie testy
 * używają realnego flow.
 *
 * Timeout 20s — login na produkcyjnej Supabase czasem wolny (kilka
 * networkowych hopów).
 */

import { type Page } from '@playwright/test';
import type { ITestUser } from './testUsers';

export const loginViaUI = async (page: Page, user: ITestUser): Promise<void> => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    await page.getByRole('button', { name: /zaloguj/i }).tap();

    // Akceptujemy dwa stany pos-login:
    //  - /character-select — świeży user, brak postaci w storze
    //  - / — user z postacią ustawioną w characterStore (Town view)
    // Regex łapie oba.
    await page.waitForURL(/\/(character-select)?$/, { timeout: 20_000 });

    // 2026-05-26 batch-flake fix: czekamy aż Supabase session zapisze się
    // w localStorage (`sb-<projectref>-auth-token`). Bez tego niektóre
    // testy w pełnym suicie widzą "logged in" URL ale następne RLS-gated
    // Supabase calls jeszcze nie mają session -> empty result -> race.
    // Zero-impact na isolation runs (od razu return true), zero modyfikacji
    // żadnego testu.
    await page.waitForFunction(
        () => {
            for (let i = 0; i < window.localStorage.length; i++) {
                const k = window.localStorage.key(i);
                if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) return true;
            }
            return false;
        },
        { timeout: 5_000 },
    ).catch(() => { /* session may be cookie-based, not blocking */ });
};
