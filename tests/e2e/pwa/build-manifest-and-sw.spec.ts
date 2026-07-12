
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

interface IManifest {
    name?: string;
    short_name?: string;
    start_url?: string;
    display?: string;
    icons?: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
}

const PROJECT_ROOT = resolve(process.cwd());
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

const tryBuild = (): { ok: boolean; output: string } => {
    try {
        const output = execSync('npm run build', {
            cwd: PROJECT_ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 120_000,
        }).toString();
        return { ok: true, output };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, output: msg };
    }
};

test.describe('PWA › Build', { tag: '@pwa' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('production build emits manifest.webmanifest + sw.js with PWA contract', async () => {
        if (!isBuildFresh()) {
            const result = tryBuild();
            if (!result.ok) {
                throw new Error(
                    'npm run build failed — PWA smoke test requires fresh dist/. ' +
                    'Last build output (tail):\n' +
                    result.output.split('\n').slice(-10).join('\n'),
                );
            }
        }

        expect(existsSync(MANIFEST_PATH), `Missing ${MANIFEST_PATH}`).toBe(true);
        const raw = readFileSync(MANIFEST_PATH, 'utf-8');
        let manifest: IManifest;
        try {
            manifest = JSON.parse(raw) as IManifest;
        } catch (e) {
            throw new Error(`manifest.webmanifest is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
        }

        expect(manifest.name, 'manifest.name missing').toBeTruthy();
        expect(manifest.short_name, 'manifest.short_name missing').toBeTruthy();
        expect(manifest.start_url, 'manifest.start_url missing').toBeTruthy();
        expect(['standalone', 'fullscreen']).toContain(manifest.display);
        expect(manifest.icons, 'manifest.icons missing').toBeTruthy();
        expect(manifest.icons!.length, 'manifest.icons must have ≥2 entries').toBeGreaterThanOrEqual(2);

        const sizes = manifest.icons!.map((i) => i.sizes);
        expect(sizes, '192x192 icon required').toContain('192x192');
        expect(sizes, '512x512 icon required').toContain('512x512');

        const hasMaskable = manifest.icons!.some(
            (i) => i.purpose && i.purpose.includes('maskable'),
        );
        expect(hasMaskable, 'at least one icon must have purpose=\'any maskable\'').toBe(true);

        expect(existsSync(SW_PATH), `Missing ${SW_PATH}`).toBe(true);
        const sw = readFileSync(SW_PATH, 'utf-8');
        expect(sw.length, 'sw.js is empty').toBeGreaterThan(100);
        expect(sw, 'sw.js must reference workbox').toMatch(/workbox/i);
        expect(sw, 'sw.js must call precacheAndRoute').toMatch(/precacheAndRoute|precache\(/);
    });
});
