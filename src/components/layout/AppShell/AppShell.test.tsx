import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * AppShell tests — wraps every routed page and decides whether the chrome
 * (TopHeader, BottomNav, PartyWidget, ReadyCheckModal) renders. It also
 * registers a forest of cross-store side-effects (party presence, ready
 * check, combat sync, guild hydration, DC watcher) which we don't need to
 * exercise directly — we mock those hooks to no-ops so the smoke tests
 * remain fast and deterministic.
 *
 * The only behaviour we care about here is:
 *   - Children render in every case (the shell never blocks routing).
 *   - Chrome is mounted when a character exists AND we're not on a
 *     characterless route (`/login`, `/character-select`, etc.).
 *   - Chrome is suppressed when no character is loaded.
 *   - `setIsCharacterlessRoute` is called with the correct boolean.
 *   - BottomNav is suppressed when combat HUD is active.
 */

vi.mock('../TopHeader/TopHeader', () => ({
    __esModule: true,
    default: () => <div data-testid="top-header-stub" />,
}));

vi.mock('../BottomNav/BottomNav', () => ({
    __esModule: true,
    default: () => <div data-testid="bottom-nav-stub" />,
}));

vi.mock('../../ui/PartyWidget/PartyWidget', () => ({
    __esModule: true,
    default: () => <div data-testid="party-widget-stub" />,
}));

vi.mock('../../ui/ReadyCheckModal/ReadyCheckModal', () => ({
    __esModule: true,
    default: () => <div data-testid="ready-check-stub" />,
}));

// Party / ready-check / combat sync hooks all register supabase realtime
// channels — we don't want any of that in tests. No-op them.
vi.mock('../../../hooks/usePartyPresence', () => ({
    usePartyPresence: vi.fn(),
}));

vi.mock('../../../hooks/usePartyReadyCheck', () => ({
    usePartyReadyCheck: vi.fn(),
    useReadyCheckGoEffect: vi.fn(),
}));

vi.mock('../../../hooks/usePartyCombatSync', () => ({
    usePartyCombatSync: vi.fn(),
}));

import AppShell from './AppShell';
import { useCharacterStore } from '../../../stores/characterStore';
import { useCombatHudStore } from '../../../stores/combatHudStore';
import { useAppRouteStore } from '../../../stores/appRouteStore';
import { usePartyStore } from '../../../stores/partyStore';
import { useGuildStore } from '../../../stores/guildStore';
import { useSyncStore } from '../../../stores/syncStore';
import { useConnectivityStore } from '../../../stores/connectivityStore';
import type { ICharacter } from '../../../api/v1/characterApi';

const makeChar = (): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 5,
    xp: 0,
    hp: 100, max_hp: 100, mp: 30, max_mp: 30,
    attack: 15, defense: 12, attack_speed: 2.0,
    crit_chance: 3, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 5,
    equipment: {},
    created_at: '', updated_at: '',
} as ICharacter);

const renderAt = (path: string, children: React.ReactNode = <div data-testid="child">page</div>) =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <AppShell>{children}</AppShell>
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useCombatHudStore.setState({ active: false, compact: false });
    useAppRouteStore.setState({ isCharacterless: false });
    usePartyStore.setState({ party: null });
    useGuildStore.setState({ guild: null });
    useSyncStore.setState({ isOnline: true, isSyncing: false, lastSynced: null });
    useConnectivityStore.setState({ mode: 'online', userExplicitlyOffline: false });
});

afterEach(() => {
    cleanup();
});

describe('AppShell — smoke', () => {
    it('always renders children regardless of chrome state', () => {
        useCharacterStore.setState({ character: null });
        renderAt('/login');
        expect(screen.getByTestId('child')).toBeTruthy();
    });

    it('renders the shell wrapper element', () => {
        const { container } = renderAt('/');
        expect(container.querySelector('.app-shell')).not.toBeNull();
    });
});

describe('AppShell — chrome gating', () => {
    it('mounts TopHeader + BottomNav when character is loaded and route is not characterless', () => {
        renderAt('/');
        expect(screen.getByTestId('top-header-stub')).toBeTruthy();
        expect(screen.getByTestId('bottom-nav-stub')).toBeTruthy();
        expect(screen.getByTestId('ready-check-stub')).toBeTruthy();
    });

    it('hides chrome on /login (characterless route)', () => {
        renderAt('/login');
        expect(screen.queryByTestId('top-header-stub')).toBeNull();
        expect(screen.queryByTestId('bottom-nav-stub')).toBeNull();
        expect(screen.queryByTestId('ready-check-stub')).toBeNull();
    });

    it('hides chrome on /character-select', () => {
        renderAt('/character-select');
        expect(screen.queryByTestId('top-header-stub')).toBeNull();
        expect(screen.queryByTestId('bottom-nav-stub')).toBeNull();
    });

    it('hides chrome when no character is loaded even on /', () => {
        useCharacterStore.setState({ character: null });
        renderAt('/');
        expect(screen.queryByTestId('top-header-stub')).toBeNull();
        expect(screen.queryByTestId('bottom-nav-stub')).toBeNull();
    });

    it('applies the --bare modifier when chrome is hidden', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderAt('/login');
        const shell = container.querySelector('.app-shell');
        expect(shell?.className).toContain('app-shell--bare');
    });
});

describe('AppShell — combat HUD interaction', () => {
    // AppShell's route-change effect zeroes the combat-HUD ONLY when navigating
    // to a NON-combat route, so a stale flag can't strand the user without the
    // global BottomNav. On combat-HUD routes (/combat, /boss, …) it deliberately
    // SKIPS the reset so the view's own CombatHudHost owns the flag (2026-06-21
    // fix for the re-entry bug). These first tests set the flag AFTER mount via
    // act() — valid on any route; the re-entry regression tests below set it
    // BEFORE mount to prove the combat-route skip.

    it('hides BottomNav (but keeps TopHeader) when combat HUD is active', async () => {
        renderAt('/combat');
        await act(async () => {
            useCombatHudStore.setState({ active: true, compact: false });
        });
        expect(screen.getByTestId('top-header-stub')).toBeTruthy();
        expect(screen.queryByTestId('bottom-nav-stub')).toBeNull();
    });

    it('hides PartyWidget when combat HUD is active', async () => {
        renderAt('/combat');
        await act(async () => {
            useCombatHudStore.setState({ active: true, compact: false });
        });
        expect(screen.queryByTestId('party-widget-stub')).toBeNull();
    });

    it('applies the --combat-hud modifier when active', async () => {
        const { container } = renderAt('/combat');
        await act(async () => {
            useCombatHudStore.setState({ active: true, compact: false });
        });
        const shell = container.querySelector('.app-shell');
        expect(shell?.className).toContain('app-shell--combat-hud');
    });

    it('applies the --combat-hud-compact modifier when active AND compact', async () => {
        const { container } = renderAt('/combat');
        await act(async () => {
            useCombatHudStore.setState({ active: true, compact: true });
        });
        const shell = container.querySelector('.app-shell');
        expect(shell?.className).toContain('app-shell--combat-hud-compact');
    });

    // 2026-06-21 regression (combat-nav re-entry bug): a fight left running in
    // the background keeps combatHudActive=true. Re-entering the combat route
    // from Town must NOT reset it — otherwise the player sees the normal
    // Walka/Questy/Miasto nav instead of the spells + exit bar.
    it('keeps an already-active combat HUD when (re)entering a combat route', () => {
        // Simulate the background fight's HUD flag set BEFORE the view mounts.
        useCombatHudStore.setState({ active: true, compact: false });
        renderAt('/combat'); // re-enter — route effect must SKIP the reset here
        expect(useCombatHudStore.getState().active).toBe(true);
        expect(screen.queryByTestId('bottom-nav-stub')).toBeNull(); // HUD bar, not nav
    });

    it('STILL resets a stale combat HUD when entering a NON-combat route (Town)', () => {
        useCombatHudStore.setState({ active: true, compact: false });
        renderAt('/'); // Town — non-combat route keeps the defensive reset
        expect(useCombatHudStore.getState().active).toBe(false);
        expect(screen.getByTestId('bottom-nav-stub')).toBeTruthy(); // nav restored
    });
});

describe('AppShell — characterless route sync', () => {
    it('writes isCharacterless=true into appRouteStore on /login', () => {
        useCharacterStore.setState({ character: null });
        renderAt('/login');
        expect(useAppRouteStore.getState().isCharacterless).toBe(true);
    });

    it('writes isCharacterless=false on /', () => {
        renderAt('/');
        expect(useAppRouteStore.getState().isCharacterless).toBe(false);
    });
});
