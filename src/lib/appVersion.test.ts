
import { describe, it, expect } from 'vitest';
import { APP_VERSION } from './appVersion';

describe('APP_VERSION', () => {
    it('is a string (typed contract — fallback would coerce too)', () => {
        expect(typeof APP_VERSION).toBe('string');
    });

    it('matches the vitest `define` injection ("test")', () => {
        expect(APP_VERSION).toBe('test');
    });

    it('is never the empty string (would break version displays)', () => {
        expect(APP_VERSION.length).toBeGreaterThan(0);
    });
});
