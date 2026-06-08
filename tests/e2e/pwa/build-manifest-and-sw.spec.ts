/**
 * Atomic E2E — production build emits a valid PWA manifest + service worker.
 *
 * Spec (BACKLOG 15.7 + brief 2026-05-25): "PWA install prompt + offline
 * serwowanie cached assets". Pragmatic smoke test — verifies that the
 * production build wiring (vite + vite-plugin-pwa) emits the artifacts a
 * PWA-aware browser needs to surface the install prompt:
 *   • `manifest.webmanifest` with name / short_name / start_url / display
 *     "standalone" / icons (192 + 512 + maskable).
 *   • `sw.js` registered service worker file that workbox generates.
 *   • Pre-cache manifest (in sw.js) includes core HTML/JS/CSS assets.
 *
 * ## Why filesystem-only (not Playwright preview server)
 *
 * Playwright config (`playwright.config.ts`) starts `npm run dev` (Vite
 * dev mode) and Vite dev mode DOES NOT serve `manifest.webmanifest` —
 * it's a build-time artifact. To actually hit the manifest endpoint
 * from the browser we'd need either:
 *   a) Spin up a separate `vite preview` server on a different port +
 *      teach Playwright to use it just for this test (ugly + adds 2+
 *      CI minutes per run).
 *   b) Replace the dev server in playwright.config with preview (breaks
 *      all the other tests that rely on HMR / source maps).
 *
 * The pragmatic alternative: assert against the BUILD ARTIFACTS on
 * disk. If `dist/manifest.webmanifest` exists with the right shape AND
 * `dist/sw.js` exists with a non-empty workbox precache list, the
 * browser-side install prompt will work in production (PWA contract is
 * 99% about these files existing and parsing correctly).
 *
 * This is the same trade-off Lighthouse-CI does in headless mode —
 * static file analysis is the cheapest reliable smoke for PWA wiring.
 *
 * ## Trigger: build must exist
 *
 * Test calls `npm run build` from inside the test if `dist/` doesn't
 * exist OR is older than the package.json (heuristic for "build stale"
 * — package.json bumps version per CLAUDE.md WORKFLOW, so its mtime is
 * a good staleness signal). If the build fails (toolchain issue, env
 * mismatch on CI), test SKIPS with a clear message — we don't want PWA
 * verification to block the whole suite when the underlying issue is
 * unrelated (e.g. node version mismatch on a fresh runner).
 *
 * ## What we verify
 *
 *  1. `dist/manifest.webmanifest` exists + parses as JSON.
 *  2. Manifest has `name`, `short_name`, `start_url`, `display: 'standalone'`.
 *  3. Manifest has ≥2 icons (192 + 512 — minimum for Chrome install prompt).
 *  4. At least one icon has `purpose: 'any maskable'` (required for adaptive
 *     icons on Android home screen).
 *  5. `dist/sw.js` exists + non-empty.
 *  6. `dist/sw.js` references the workbox runtime (proves vite-plugin-pwa
 *     wired the service worker, not just an empty file).
 *
 * ## What we do NOT verify
 *
 *  • `beforeinstallprompt` browser event — that's Chromium-only + requires
 *    HTTPS + user-interaction heuristics + 30-day re-prompt suppression.
 *    Untestable in headless deterministically.
 *  • iOS Add-to-Home-Screen UX — WebKit doesn't fire beforeinstallprompt;
 *    iOS users discover install through Share menu. No programmatic hook.
 *  • Offline caching behavior of the SW at runtime — covered (in part) by
 *    BACKLOG 14.x (offline mode tests). This test is build-time only.
 *  • Lighthouse PWA score — that needs a separate `npx lighthouse` run,
 *    out of scope for atomic E2E.
 *
 * Anything that goes wrong with this test → check
 * `vite.config.ts` `VitePWA({...})` block.
 */

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

/**
 * Returns true if dist/ exists AND is newer than package.json. Returns
 * false if build is missing or stale (package.json mtime is the
 * canonical "something changed" signal because we bump version per
 * commit per CLAUDE.md WORKFLOW).
 */
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

/**
 * Runs `npm run build` from project root. Returns true on success,
 * false on failure (used to skip the test gracefully on toolchain
 * issues — we don't want a node-version mismatch to mask the actual
 * PWA wiring assertion).
 */
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
    // Build can take ~30 s on cold cache + assertions are filesystem-only
    // (no browser actions). 90 s headroom.
    test.describe.configure({ timeout: 90_000 });

    test('production build emits manifest.webmanifest + sw.js with PWA contract', async () => {
        // ── Step 1: ensure a fresh build exists ───────────────────────────
        // 2026-05-27: dist/ is pre-built via `npm run test:e2e` (chains
        // `npm run build && playwright test`). If it's somehow stale here
        // (manual run or interrupted setup), try to build inline. If THAT
        // fails, ASSERT-fail (no `test.skip` fallback — user wants 0 skipped).
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

        // ── Step 2: manifest exists + parses + has PWA contract ───────────
        expect(existsSync(MANIFEST_PATH), `Missing ${MANIFEST_PATH}`).toBe(true);
        const raw = readFileSync(MANIFEST_PATH, 'utf-8');
        let manifest: IManifest;
        try {
            manifest = JSON.parse(raw) as IManifest;
        } catch (e) {
            throw new Error(`manifest.webmanifest is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
        }

        // PWA install prompt requirements (Chrome devtools spec):
        //   • name (full app name shown on install dialog)
        //   • short_name (home screen label, ≤12 chars best practice)
        //   • start_url (entry route after install)
        //   • display 'standalone' or 'fullscreen' (no browser chrome)
        //   • icons including 192px + 512px
        expect(manifest.name, 'manifest.name missing').toBeTruthy();
        expect(manifest.short_name, 'manifest.short_name missing').toBeTruthy();
        expect(manifest.start_url, 'manifest.start_url missing').toBeTruthy();
        expect(['standalone', 'fullscreen']).toContain(manifest.display);
        expect(manifest.icons, 'manifest.icons missing').toBeTruthy();
        expect(manifest.icons!.length, 'manifest.icons must have ≥2 entries').toBeGreaterThanOrEqual(2);

        // Verify 192 + 512 sizes present (Chrome install prompt mandatory).
        const sizes = manifest.icons!.map((i) => i.sizes);
        expect(sizes, '192x192 icon required').toContain('192x192');
        expect(sizes, '512x512 icon required').toContain('512x512');

        // At least one icon must have purpose 'any maskable' for adaptive
        // icon support on Android (otherwise install prompt downgrades).
        const hasMaskable = manifest.icons!.some(
            (i) => i.purpose && i.purpose.includes('maskable'),
        );
        expect(hasMaskable, 'at least one icon must have purpose=\'any maskable\'').toBe(true);

        // ── Step 3: service worker exists + has workbox runtime ───────────
        expect(existsSync(SW_PATH), `Missing ${SW_PATH}`).toBe(true);
        const sw = readFileSync(SW_PATH, 'utf-8');
        expect(sw.length, 'sw.js is empty').toBeGreaterThan(100);
        // Workbox runtime is the only thing vite-plugin-pwa generates in
        // sw.js — its presence proves the plugin wired correctly. If the
        // PWA plugin breaks (or someone swaps out for a custom SW), this
        // assertion catches the regression.
        expect(sw, 'sw.js must reference workbox').toMatch(/workbox/i);
        // Precache list — workbox-generated SW contains `precacheAndRoute`
        // call with the asset list inline. Existence of the call proves
        // we'll actually serve assets offline (vs an empty SW that
        // registers but does nothing).
        expect(sw, 'sw.js must call precacheAndRoute').toMatch(/precacheAndRoute|precache\(/);
    });
});
