/**
 * Tests for the app-version shim.
 *
 * `APP_VERSION` is sourced from Vite's `define` block at build time —
 * the test config (see `vitest.config.ts`) injects the literal string
 * "test" for `__APP_VERSION__`, so we assert that exact value. The
 * fallback branch (`typeof __APP_VERSION__ !== 'string'`) can't be
 * reached from inside vitest because `define` always supplies a
 * string, so we cover it indirectly by asserting the documented type
 * contract — the exported constant must always be a string.
 */

import { describe, it, expect } from 'vitest';
import { APP_VERSION } from './appVersion';

describe('APP_VERSION', () => {
    it('is a string (typed contract — fallback would coerce too)', () => {
        expect(typeof APP_VERSION).toBe('string');
    });

    it('matches the vitest `define` injection ("test")', () => {
        // vitest.config.ts:   define: { __APP_VERSION__: JSON.stringify('test') }
        expect(APP_VERSION).toBe('test');
    });

    it('is never the empty string (would break version displays)', () => {
        expect(APP_VERSION.length).toBeGreaterThan(0);
    });
});
