import { describe, it, expect, beforeEach } from 'vitest';
import { useCombatHudStore } from './combatHudStore';

beforeEach(() => {
    // Mirror the documented defaults — every test starts with the nav visible
    // and the layout NOT in compact mode (the hunting Combat view's baseline).
    useCombatHudStore.setState({ active: false, compact: false });
});

describe('initial state', () => {
    it('defaults `active` to false (global BottomNav visible)', () => {
        expect(useCombatHudStore.getState().active).toBe(false);
    });

    it('defaults `compact` to false (normal layout padding for hunting Combat)', () => {
        expect(useCombatHudStore.getState().compact).toBe(false);
    });

    it('exposes both setters as functions', () => {
        const s = useCombatHudStore.getState();
        expect(typeof s.setActive).toBe('function');
        expect(typeof s.setCompact).toBe('function');
    });
});

describe('setActive', () => {
    it('flips `active` to true so AppShell hides the BottomNav', () => {
        useCombatHudStore.getState().setActive(true);
        expect(useCombatHudStore.getState().active).toBe(true);
    });

    it('flips back to false on cleanup (view unmounting / fight ending)', () => {
        useCombatHudStore.setState({ active: true, compact: false });
        useCombatHudStore.getState().setActive(false);
        expect(useCombatHudStore.getState().active).toBe(false);
    });

    it('does not touch `compact`', () => {
        useCombatHudStore.setState({ active: false, compact: true });
        useCombatHudStore.getState().setActive(true);
        const state = useCombatHudStore.getState();
        expect(state.active).toBe(true);
        // `compact` must survive — Dungeon/Boss views set it before they set
        // active, and we don't want one to clobber the other.
        expect(state.compact).toBe(true);
    });

    it('is idempotent on repeated true calls', () => {
        useCombatHudStore.getState().setActive(true);
        useCombatHudStore.getState().setActive(true);
        expect(useCombatHudStore.getState().active).toBe(true);
    });
});

describe('setCompact', () => {
    it('flips `compact` to true (Dungeon/Boss/Raid/Arena style)', () => {
        useCombatHudStore.getState().setCompact(true);
        expect(useCombatHudStore.getState().compact).toBe(true);
    });

    it('flips back to false on view teardown', () => {
        useCombatHudStore.setState({ active: false, compact: true });
        useCombatHudStore.getState().setCompact(false);
        expect(useCombatHudStore.getState().compact).toBe(false);
    });

    it('does not touch `active`', () => {
        useCombatHudStore.setState({ active: true, compact: false });
        useCombatHudStore.getState().setCompact(true);
        const state = useCombatHudStore.getState();
        expect(state.compact).toBe(true);
        expect(state.active).toBe(true);
    });
});

describe('combined transitions (Dungeon-like lifecycle)', () => {
    it('view enter: set active+compact true, then leave: both false', () => {
        // Simulates AppShell + Dungeon view lifecycle: mount sets both, unmount
        // (or route change) flips both back to false.
        useCombatHudStore.getState().setActive(true);
        useCombatHudStore.getState().setCompact(true);
        expect(useCombatHudStore.getState()).toMatchObject({ active: true, compact: true });

        useCombatHudStore.getState().setActive(false);
        useCombatHudStore.getState().setCompact(false);
        expect(useCombatHudStore.getState()).toMatchObject({ active: false, compact: false });
    });

    it('hunting Combat view: active true, compact stays false', () => {
        useCombatHudStore.getState().setActive(true);
        expect(useCombatHudStore.getState()).toMatchObject({ active: true, compact: false });
    });
});

// TODO: AppShell defensively resets the store on every route change. A higher
// level test (component / integration) would assert that contract — out of
// scope for this unit test which only verifies the setter atoms.
