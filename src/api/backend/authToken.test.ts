import { describe, it, expect } from 'vitest';
import { setAuthToken, getAuthToken } from './authToken';

describe('authToken cache', () => {
    it('set/get round-trip', () => {
        setAuthToken('jwt-abc');
        expect(getAuthToken()).toBe('jwt-abc');
    });

    it('setAuthToken(null) czyści token', () => {
        setAuthToken('x');
        setAuthToken(null);
        expect(getAuthToken()).toBeNull();
    });
});
