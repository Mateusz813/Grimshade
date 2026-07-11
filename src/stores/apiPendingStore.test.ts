import { describe, it, expect, beforeEach } from 'vitest';
import { useApiPendingStore } from './apiPendingStore';

describe('apiPendingStore', () => {
    beforeEach(() => {
        useApiPendingStore.setState({ pending: 0 });
    });

    it('starts at 0', () => {
        expect(useApiPendingStore.getState().pending).toBe(0);
    });

    it('inc increments and dec decrements', () => {
        const { inc, dec } = useApiPendingStore.getState();
        inc();
        inc();
        expect(useApiPendingStore.getState().pending).toBe(2);
        dec();
        expect(useApiPendingStore.getState().pending).toBe(1);
    });

    it('dec is clamped at 0 (never negative)', () => {
        const { dec } = useApiPendingStore.getState();
        dec();
        dec();
        expect(useApiPendingStore.getState().pending).toBe(0);
    });
});
