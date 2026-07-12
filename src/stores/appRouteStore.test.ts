import { describe, it, expect, beforeEach } from 'vitest';
import { useAppRouteStore } from './appRouteStore';

beforeEach(() => {
    useAppRouteStore.setState({ isCharacterless: false });
});

describe('initial state', () => {
    it('defaults `isCharacterless` to false', () => {
        expect(useAppRouteStore.getState().isCharacterless).toBe(false);
    });

    it('exposes `setIsCharacterless` as a function', () => {
        expect(typeof useAppRouteStore.getState().setIsCharacterless).toBe('function');
    });
});

describe('setIsCharacterless', () => {
    it('flips the flag from false to true', () => {
        useAppRouteStore.getState().setIsCharacterless(true);
        expect(useAppRouteStore.getState().isCharacterless).toBe(true);
    });

    it('flips the flag from true back to false', () => {
        useAppRouteStore.setState({ isCharacterless: true });
        useAppRouteStore.getState().setIsCharacterless(false);
        expect(useAppRouteStore.getState().isCharacterless).toBe(false);
    });

    it('is idempotent — setting the same value twice keeps the same final state', () => {
        useAppRouteStore.getState().setIsCharacterless(true);
        useAppRouteStore.getState().setIsCharacterless(true);
        expect(useAppRouteStore.getState().isCharacterless).toBe(true);
    });

    it('only mutates the targeted slice (no other keys exist, but verify shape)', () => {
        useAppRouteStore.setState({ isCharacterless: false } as never);
        useAppRouteStore.getState().setIsCharacterless(true);
        const state = useAppRouteStore.getState();
        expect(state.isCharacterless).toBe(true);
        expect(typeof state.setIsCharacterless).toBe('function');
    });
});

