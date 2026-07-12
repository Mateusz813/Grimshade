import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';


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

    it('keeps an already-active combat HUD when (re)entering a combat route', () => {
        useCombatHudStore.setState({ active: true, compact: false });
        renderAt('/combat');
        expect(useCombatHudStore.getState().active).toBe(true);
        expect(screen.queryByTestId('bottom-nav-stub')).toBeNull();
    });

    it('STILL resets a stale combat HUD when entering a NON-combat route (Town)', () => {
        useCombatHudStore.setState({ active: true, compact: false });
        renderAt('/');
        expect(useCombatHudStore.getState().active).toBe(false);
        expect(screen.getByTestId('bottom-nav-stub')).toBeTruthy();
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
