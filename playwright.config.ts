import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';


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

loadEnvFile('.env.test');

const isCI = !!process.env.CI;

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: isCI,
    retries: 2,
    maxFailures: isCI ? 12 : 0,
    workers: 1,
    reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
    globalSetup: './tests/e2e/global-setup.ts',
    globalTeardown: './tests/e2e/global-teardown.ts',

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
        env: {
            VITE_BACKEND_DEFAULT: '',
            VITE_API_BASE_URL: '',
        },
    },
});
