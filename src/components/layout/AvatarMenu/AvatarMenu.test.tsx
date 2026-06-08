import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useRef } from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * AvatarMenu tests — the dropdown anchored to the avatar button in
 * TopHeader. It owns: change-character, language toggle, play-mode toggle,
 * manual sync, admin entry (gated by email), logout, and renders the
 * APP_VERSION stripe at the bottom.
 *
 * Mocks:
 *   - useNavigate captured so we can assert character-switch / logout nav.
 *   - useSync's doSync captured to assert manual sync invocations.
 *   - AdminPanel stubbed so we can assert it mounts without dragging in
 *     the heavy real implementation.
 *   - characterScope.saveCurrentCharacterStores stubbed (no-op promise).
 *   - connectivityTransitions stubbed — toggling play mode dispatches a
 *     dynamic import we don't care about resolving in tests.
 */

const navigateMock = vi.fn();
const doSyncMock = vi.fn().mockResolvedValue(undefined);

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

vi.mock('../../../hooks/useSync', () => ({
    useSync: () => ({
        isOnline: true,
        isSyncing: false,
        lastSynced: null,
        doSync: doSyncMock,
    }),
}));

vi.mock('../../../stores/characterScope', () => ({
    saveCurrentCharacterStores: vi.fn().mockResolvedValue(undefined),
}));

// AdminPanel is render-only here — we just need to verify it mounts when
// the admin email is detected. Real AdminPanel imports huge swathes of
// game data and would slow tests significantly.
vi.mock('../../ui/AdminPanel/AdminPanel', () => ({
    __esModule: true,
    default: ({ onClose }: { onClose: () => void }) => (
        <div data-testid="admin-panel-stub">
            <button onClick={onClose}>close-admin</button>
        </div>
    ),
    // 2026-05-26 refactor: AvatarMenu imports `isAdminEmail` helper now,
    // not the old `ADMIN_EMAIL` constant. Keep ADMIN_EMAIL exported for
    // backward compat but the gate logic now uses ADMIN_EMAILS set.
    ADMIN_EMAIL: 'krasek39@gmail.com',
    ADMIN_EMAILS: new Set<string>(['krasek39@gmail.com', 'e2e-admin@grimshade-test.local']),
    isAdminEmail: (email: string | null | undefined): boolean => {
        if (!email) return false;
        return new Set<string>(['krasek39@gmail.com', 'e2e-admin@grimshade-test.local']).has(email.toLowerCase());
    },
}));

vi.mock('../../../systems/connectivityTransitions', () => ({
    transitionToOnline: vi.fn().mockResolvedValue(undefined),
    transitionToOffline: vi.fn(),
}));

import { supabase } from '../../../lib/supabase';
import AvatarMenu from './AvatarMenu';
import { useCharacterStore } from '../../../stores/characterStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useConnectivityStore } from '../../../stores/connectivityStore';
import { usePartyStore } from '../../../stores/partyStore';
import { useSyncStore } from '../../../stores/syncStore';
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

const Harness = ({ onClose = () => undefined }: { onClose?: () => void }) => {
    const ref = useRef<HTMLButtonElement>(null);
    return (
        <MemoryRouter>
            <button ref={ref} data-testid="anchor">anchor</button>
            <AvatarMenu anchorRef={ref} onClose={onClose} />
        </MemoryRouter>
    );
};

beforeEach(() => {
    navigateMock.mockReset();
    doSyncMock.mockClear();
    useCharacterStore.setState({ character: makeChar() });
    useSettingsStore.setState({ language: 'pl' });
    useConnectivityStore.setState({ mode: 'online', userExplicitlyOffline: false });
    useSyncStore.setState({ isOnline: true, isSyncing: false, lastSynced: null });
    usePartyStore.setState({ party: null });
    // Reset session getter to a non-admin email by default.
    (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { session: { user: { email: 'someone@example.com' } } },
        error: null,
    });
});

afterEach(() => {
    cleanup();
});

describe('AvatarMenu — smoke', () => {
    it('renders all core menu items', () => {
        render(<Harness />);
        expect(screen.getByText('Zmień postać')).toBeTruthy();
        expect(screen.getByText('Język')).toBeTruthy();
        expect(screen.getByText('Tryb gry')).toBeTruthy();
        expect(screen.getByText('Wyloguj')).toBeTruthy();
        // Menu role is set on the wrapper.
        expect(screen.getByRole('menu')).toBeTruthy();
    });

    it('renders the APP_VERSION stripe', () => {
        render(<Harness />);
        // vitest.config.ts defines __APP_VERSION__ as "test".
        expect(screen.getByLabelText(/Grimshade v/)).toBeTruthy();
    });
});

describe('AvatarMenu — language toggle', () => {
    it('marks PL active when language is pl', () => {
        useSettingsStore.setState({ language: 'pl' });
        render(<Harness />);
        const pl = screen.getByText('PL');
        const en = screen.getByText('EN');
        expect(pl.className.includes('--active')).toBe(true);
        expect(en.className.includes('--active')).toBe(false);
    });

    it('switches language when EN is clicked', () => {
        const setLanguage = vi.fn();
        useSettingsStore.setState({ language: 'pl', setLanguage });
        render(<Harness />);
        fireEvent.click(screen.getByText('EN'));
        expect(setLanguage).toHaveBeenCalledWith('en');
    });
});

describe('AvatarMenu — sync button', () => {
    it('triggers doSync when clicked', () => {
        render(<Harness />);
        fireEvent.click(screen.getByText('Synchronizuj'));
        expect(doSyncMock).toHaveBeenCalledTimes(1);
    });
});

describe('AvatarMenu — admin gating', () => {
    it('does NOT render admin entry for a non-admin email', async () => {
        render(<Harness />);
        // Let the async getSession effect resolve.
        await Promise.resolve();
        await Promise.resolve();
        expect(screen.queryByText('Panel admina')).toBeNull();
    });

    it('renders admin entry when session email matches ADMIN_EMAIL', async () => {
        (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
            data: { session: { user: { email: 'krasek39@gmail.com' } } },
            error: null,
        });
        render(<Harness />);
        await waitFor(() => {
            expect(screen.queryByText('Panel admina')).toBeTruthy();
        });
    });

    it('mounts AdminPanel stub when admin entry is clicked', async () => {
        (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
            data: { session: { user: { email: 'krasek39@gmail.com' } } },
            error: null,
        });
        render(<Harness />);
        const adminBtn = await screen.findByText('Panel admina');
        fireEvent.click(adminBtn);
        expect(screen.queryByTestId('admin-panel-stub')).toBeTruthy();
    });
});

describe('AvatarMenu — close interactions', () => {
    it('calls onClose on Escape', () => {
        const onClose = vi.fn();
        render(<Harness onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('does NOT close on Escape while admin panel is open', async () => {
        (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
            data: { session: { user: { email: 'krasek39@gmail.com' } } },
            error: null,
        });
        const onClose = vi.fn();
        render(<Harness onClose={onClose} />);
        const adminBtn = await screen.findByText('Panel admina');
        fireEvent.click(adminBtn);
        // Simulate the admin-panel backdrop existing in the DOM.
        const backdrop = document.createElement('div');
        backdrop.className = 'admin-panel__backdrop';
        document.body.appendChild(backdrop);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
        backdrop.remove();
    });
});

describe('AvatarMenu — play mode toggle', () => {
    it('marks Online button active in online mode', () => {
        useConnectivityStore.setState({ mode: 'online' });
        render(<Harness />);
        const onlineBtn = screen.getByText('Online');
        expect(onlineBtn.className.includes('--active')).toBe(true);
    });

    it('marks Offline button active in offline mode', () => {
        useConnectivityStore.setState({ mode: 'offline' });
        render(<Harness />);
        const offlineBtn = screen.getByText('Offline');
        expect(offlineBtn.className.includes('--active')).toBe(true);
    });
});
