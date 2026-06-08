/**
 * Playwright globalSetup — runs ONCE before the entire test suite.
 *
 * Purpose: ensure `dist/` build artifacts (manifest.webmanifest + sw.js)
 * exist BEFORE PWA tests run. Without this pre-build, the PWA spec
 * (`tests/e2e/pwa/build-manifest-and-sw.spec.ts`) calls `npm run build`
 * itself in-test and falls back to `test.skip(true, ...)` if the build
 * step fails for any reason (memory pressure during full suite,
 * concurrent file lock, etc.). Pre-building once here removes that
 * skip vector entirely — the build runs in a clean environment before
 * any test workers start.
 *
 * Runs `npm run build` only if dist/ is missing or stale relative to
 * package.json mtime — same freshness check the PWA spec uses, so we
 * don't waste 30s on every local run if the build is already current.
 */

import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// ESM-safe project root — Playwright invokes globalSetup z working dir
// = project root, więc process.cwd() jest deterministyczny + nie cierpi
// na ESM-vs-CJS __dirname problemy.
const PROJECT_ROOT = process.cwd();
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

const globalSetup = async (): Promise<void> => {
    if (isBuildFresh()) {
        return;
    }
    // eslint-disable-next-line no-console
    console.log('[globalSetup] dist/ stale — running npm run build before suite');
    try {
        execSync('npm run build', {
            cwd: PROJECT_ROOT,
            stdio: ['ignore', 'ignore', 'pipe'],
            timeout: 180_000,
        });
        // eslint-disable-next-line no-console
        console.log('[globalSetup] build OK — PWA test will not skip');
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
            `[globalSetup] build failed — PWA test will skip with reason: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
};

export default globalSetup;
