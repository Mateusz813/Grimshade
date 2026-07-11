import { describe, it, expect } from 'vitest';
import { isBackendCombatDelegated } from './backendMode';

// Od 1.10.0 walka jest liczona po stronie klienta (identyczna rozgrywka +
// animacje + realne staty z gearu), a stan utrwala autorytatywny commit do
// backendu. Ten test pilnuje, że przełącznik autorytetu walki jest po stronie
// klienta — regres na `true` przywróciłby serwerową symulację gołymi statami.
describe('backendMode — autorytet walki', () => {
    it('isBackendCombatDelegated() === false (walka client-authoritative)', () => {
        expect(isBackendCombatDelegated()).toBe(false);
    });
});
