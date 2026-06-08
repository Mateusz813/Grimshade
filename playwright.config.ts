import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Playwright config — E2E test runner.
 *
 * Decision log (2026-05-21):
 * - testDir './tests/e2e' — vitest siedzi w src/**, Playwright tylko w
 *   dedykowanym folderze. Klarowna separacja runner-ów.
 * - fullyParallel true — Playwright odpala testy równolegle w osobnych
 *   worker-ach. Każdy test musi być self-contained (no shared state) —
 *   atomic E2E pattern pasuje.
 * - webServer — automatycznie odpala vite dev server przed testami;
 *   reuseExistingServer (poza CI) — lokalnie nie restartuje serwera
 *   między run-ami (szybciej).
 * - projects chromium na start. Firefox / WebKit dodać gdy stabilne.
 * - retries 2 na CI, 0 lokalnie — flaki w lokalnym debug-u nie pomagają,
 *   na CI warto bo Realtime / network bywa kapryśny.
 * - trace retain-on-failure — full debug trace gdy test wybucha
 *   (timeline, screenshots, network, console).
 *
 * Multi-context dla testów party (Supabase Realtime):
 *   const ctx1 = await browser.newContext();
 *   const ctx2 = await browser.newContext();
 *   // każdy ctx ma własne cookies / localStorage → osobny gracz
 *
 * Decision log (2026-05-24):
 * - .env.test loading — zerowy dep, parsujemy inline z fs/path. Plik
 *   jest gitignored (sekrety NIGDY do repo per CLAUDE.md), template
 *   `.env.test.example` siedzi w repo. Existing `process.env` wartości
 *   wygrywają — żeby CI mógł nadpisać przez GitHub Secrets bez ruszania
 *   pliku.
 */

/**
 * Loads KEY=VALUE pairs from a dotenv-style file into process.env.
 * Existing env vars are preserved (env > file) — to żeby CI override
 * przez Secrets / shell export działał bez konfliktu z lokalnym
 * `.env.test`.
 */
const loadEnvFile = (path: string): void => {
    // Playwright loads ten config zawsze z project root → process.cwd()
    // jest stabilny i nie cierpi na ESM-vs-CJS __dirname quirki.
    const abs = resolve(process.cwd(), path);
    if (!existsSync(abs)) return;
    for (const raw of readFileSync(abs, 'utf-8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (!match) continue;
        const [, key, value] = match;
        if (process.env[key]) continue;
        // Strip surrounding quotes if present
        process.env[key] = value.replace(/^["'](.*)["']$/, '$1');
    }
};

loadEnvFile('.env.test');

const isCI = !!process.env.CI;

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: isCI,
    // 2026-05-26: retries=1 lokalnie (było 0). Powód: ~1-2% testów w
    // pełnym suicie (147+ spec files × 2 mobile profile) flakuje przez
    // server-side timing — character cleanup async DELETE → kolejny test
    // CREATE → game_save row hydration race. Każdy taki test PASS-uje
    // w isolation, ale w batch może upaść raz na ~50 runów. Retries=1
    // łapie wszystkie te flake-y bez zmiany assertion. CI nadal ma
    // retries=2 (na CI również Realtime/websocket bywa kapryśny).
    // 2026-05-26: retries=2 wszędzie (lokalnie + CI). Powód: 1-2% testów
    // w pełnym suicie flakuje przez DB/network timing w batch. Retry=1
    // wystarczył dla ~50% flake-ów, retry=2 catches ~99%. Tylko reproductible
    // failure-y zostają jako prawdziwy fail.
    retries: 2,
    // 2026-05-25 (incident): workers: 1 globalnie. Wcześniej 2 (1 per profile)
    // ale w połączeniu z agresywnym spawnowaniem agentów + listUsers per cleanup
    // wybiło DB Supabase NANO compute z 10% do 82% CPU → unhealthy state.
    // Workers=1 = mobile-safari i mobile-chrome biegną SEQUENTIAL (nie
    // concurrent). Wolniej (1.5×-2× czas) ale max 1 char create/cleanup
    // jednocześnie na primary account → DB-friendly. Po:
    //   1. Refactor cleanup → shared `adminClient.ts` z cached findUserIdByEmail
    //      (1 listUsers per worker zamiast 80+)
    //   2. Supabase Pro free-upgrade (Nano → Micro, 2× pamięć)
    // można wrócić do workers=2 + zweryfikować CPU graph w dashboard.
    workers: 1,
    reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
    // 2026-05-26: globalSetup — pre-builduje `dist/` jeśli stale, żeby PWA
    // test nie próbował budować in-test (źródło `test.skip` gdy build
    // failuje pod load). Patrz `tests/e2e/global-setup.ts`.
    globalSetup: './tests/e2e/global-setup.ts',
    // 2026-05-26: globalTeardown — auto-wipes stale `e2e-register-*` users
    // + leftover characters on stable test accounts po KAŻDYM runie suite-a.
    // Safety-net za try/finally per-test (fail mid-flow → afterEach nie leci
    // → zostaje syf w `auth.users`). Patrz `tests/e2e/global-teardown.ts`.
    globalTeardown: './tests/e2e/global-teardown.ts',

    use: {
        baseURL: 'http://localhost:5170',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        actionTimeout: 5_000,
        navigationTimeout: 15_000,
    },

    // 2026-05-24: Grimshade jest aplikacją mobilną PWA — testy odpalają
    // się WYŁĄCZNIE na profilach mobilnych (touch events, viewport
    // ~390x844, isMobile, hasTouch, devicePixelRatio). `.tap()` na
    // mobilnym profilu robi prawdziwy touchstart/touchend, nie mouse
    // click — to KLUCZOWA różnica dla komponentów z hover-state,
    // scroll-snap, swipe gestures.
    //
    // Mobile-Safari (iPhone 13 / WebKit engine) — odsłania bugi typu
    //   `100vh`, date input, scroll inertia które Chromium ukrywa.
    //   Najczęstszy engine dla mobile gamingu na iOS.
    // Mobile-Chrome (Pixel 7 / Chromium engine) — Android viewport,
    //   user-agent + media queries. Pokrycie Android user-baseu.
    //
    // Desktop-chromium ŚWIADOMIE pominięty — właściciel jasno powiedział
    // "głównie aplikacja mobilna, klik myszką a tap to różnica". Dodanie
    // desktop-profile wymuszałoby albo `hasTouch: true` override (nierealne
    // kombo) albo `.click()` zamiast `.tap()` (gubimy test touch flow).
    // Jeśli kiedyś będziemy chcieli desktop coverage, dorzucimy osobny
    // suite z `.click()`-only testami.
    projects: [
        {
            name: 'mobile-safari',
            use: { ...devices['iPhone 13'] },
        },
        {
            name: 'mobile-chrome',
            use: { ...devices['Pixel 7'] },
        },
    ],

    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:5170',
        reuseExistingServer: !isCI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
