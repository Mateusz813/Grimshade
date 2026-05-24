import { defineConfig, devices } from '@playwright/test';

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
 */

const isCI = !!process.env.CI;

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: isCI,
    retries: isCI ? 2 : 0,
    workers: isCI ? 2 : undefined,
    reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',

    use: {
        baseURL: 'http://localhost:5170',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        actionTimeout: 5_000,
        navigationTimeout: 15_000,
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        // Firefox + WebKit — TODO gdy mamy stabilne core E2E.
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
