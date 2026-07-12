import { describe, it, expect, beforeEach, vi } from 'vitest';
import { markAppReady, markAppRestoring } from './appReady';

describe('appReady — window.__grimshadeReady signal', () => {
    beforeEach(() => {
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

    it('restoring -> ready transition flips the flag false then true', () => {
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
        const desc = Object.getOwnPropertyDescriptor(globalThis, 'window');
        vi.stubGlobal('window', undefined as any);
        expect(() => markAppReady()).not.toThrow();
        expect(() => markAppRestoring()).not.toThrow();
        if (desc) Object.defineProperty(globalThis, 'window', desc);
        vi.unstubAllGlobals();
    });
});
