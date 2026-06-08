import { describe, it, expect, beforeEach, vi } from 'vitest';
import { markAppReady, markAppRestoring } from './appReady';

/**
 * Unit coverage for the E2E app-ready signal helpers. These flip
 * `window.__grimshadeReady` so Playwright can deterministically wait for
 * the boot restore chain to settle (see appReady.ts header). Pure DOM
 * side-effect functions — happy-dom provides `window`.
 */
describe('appReady — window.__grimshadeReady signal', () => {
    beforeEach(() => {
        // Reset between tests.
        window.__grimshadeReady = undefined;
    });

    it('markAppReady sets window.__grimshadeReady = true', () => {
        markAppReady();
        expect(window.__grimshadeReady).toBe(true);
    });

    it('markAppRestoring sets window.__grimshadeReady = false', () => {
        markAppRestoring();
        expect(window.__grimshadeReady).toBe(false);
    });

    it('restoring → ready transition flips the flag false then true', () => {
        markAppRestoring();
        expect(window.__grimshadeReady).toBe(false);
        markAppReady();
        expect(window.__grimshadeReady).toBe(true);
    });

    it('markAppReady is idempotent (stays true on repeated calls)', () => {
        markAppReady();
        markAppReady();
        expect(window.__grimshadeReady).toBe(true);
    });

    it('does not throw when window is undefined (SSR / non-DOM guard)', () => {
        // Temporarily shadow the global `window` to undefined to exercise the
        // `typeof window !== 'undefined'` guard branch in both helpers.
        const desc = Object.getOwnPropertyDescriptor(globalThis, 'window');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.stubGlobal('window', undefined as any);
        expect(() => markAppReady()).not.toThrow();
        expect(() => markAppRestoring()).not.toThrow();
        // Restore.
        if (desc) Object.defineProperty(globalThis, 'window', desc);
        vi.unstubAllGlobals();
    });
});
