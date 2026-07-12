import { describe, it, expect } from 'vitest';
import { isBackendCombatDelegated } from './backendMode';

describe('backendMode — autorytet walki', () => {
    it('isBackendCombatDelegated() === false (walka client-authoritative)', () => {
        expect(isBackendCombatDelegated()).toBe(false);
    });
});
