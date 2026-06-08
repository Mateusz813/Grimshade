/**
 * Canonical Grimshade E2E test accounts.
 *
 * Source of truth (2026-05-24): właściciel utworzył 2 dedykowane
 * konta w Supabase Auth na env-ie do którego wskazuje `.env.local`.
 * Wszystkie testy — lokalne, CI, smoke na produkcji — używają tych
 * samych kont (nie rejestrujemy / nie kasujemy userów per-test bo to
 * brudzi DB i komplikuje równoległość).
 *
 * Credentiale ładowane są z `.env.test` (gitignored) przez
 * `loadEnvFile()` w `playwright.config.ts` ZANIM Playwright zacznie
 * spawnować workery. Każdy test może po prostu `import { testUsers }`
 * i czytać `.primary.email` / `.secondary.password` bez ceremoniału.
 *
 * Multi-context pattern (party / Realtime / chat / PM):
 *   const ctx1 = await browser.newContext();
 *   const ctx2 = await browser.newContext();
 *   await loginAs(ctx1, testUsers.primary);
 *   await loginAs(ctx2, testUsers.secondary);
 *
 * Jeśli któraś zmienna brakuje — rzucamy clear error w czasie importu
 * (fail-fast > niejasny `undefined` w środku testu).
 */

export interface ITestUser {
    /** Display label used w logach Playwright + komunikatach błędów. */
    label: 'primary' | 'secondary' | 'admin';
    email: string;
    password: string;
}

const requireEnv = (key: string): string => {
    const value = process.env[key];
    if (!value) {
        throw new Error(
            `[testUsers] Missing env var: ${key}. ` +
            'Skopiuj `.env.test.example` → `.env.test` i wpisz credentiale, ' +
            'albo wyeksportuj zmienną przed `npm run test:e2e`.',
        );
    }
    return value;
};

export const testUsers = {
    primary: {
        label: 'primary',
        email: requireEnv('E2E_USER_EMAIL'),
        password: requireEnv('E2E_USER_PASSWORD'),
    },
    secondary: {
        label: 'secondary',
        email: requireEnv('E2E_USER2_EMAIL'),
        password: requireEnv('E2E_USER2_PASSWORD'),
    },
    admin: {
        label: 'admin',
        email: requireEnv('E2E_ADMIN_EMAIL'),
        password: requireEnv('E2E_ADMIN_PASSWORD'),
    },
} as const satisfies Record<string, ITestUser>;
