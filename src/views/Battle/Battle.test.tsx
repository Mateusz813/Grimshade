import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Battle hub tests — the simple view from BottomNav -> Walka.
 *
 * Battle.tsx renders 7 banner tiles (one per battle mode) and decides
 * which are locked (party-member-locked = leader-only routes; offline-
 * locked = raid + arena unavailable offline). It also intercepts the
 * Trainer tile click to fire the party ready-check.
 *
 * What we cover:
 *   - Smoke render with a character loaded.
 *   - All 7 tiles appear.
 *   - Clicking a normal tile navigates to its path.
 *   - Trainer click fires `requestPartyCombatStart` instead of direct nav.
 *   - Offline lock: raid + arena tiles become non-clickable when the
 *     connectivity store reports offline.
 *   - Party-member lock: leader-only routes (boss/raid/trainer/combat)
 *     are silent no-ops for non-leader members.
 *   - Null character: still renders without crashing.
 */

// -- Mock the dynamic transform color hook so we don't have to drive
//    transformStore from outside. Battle just calls `getHighestTransformColor`
//    once for its accent — return null = fall back to class color.
vi.mock('../../hooks/usePartyMemberRouteGate', () => ({
    useIsPartyMemberLocked: vi.fn(() => false),
}));

const requestPartyCombatStartMock = vi.fn();
vi.mock('../../hooks/usePartyReadyCheck', () => ({
    requestPartyCombatStart: (...args: unknown[]) => requestPartyCombatStartMock(...args),
}));

// Battle.tsx imports a handful of background images via Vite. happy-dom
// can't resolve those — vitest typically transforms them to a stub URL,
// but we explicitly mock here in case the alias plugin doesn't kick in.
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

import Battle from './Battle';
import { useCharacterStore } from '../../stores/characterStore';
import { useTransformStore } from '../../stores/transformStore';
import { useConnectivityStore } from '../../stores/connectivityStore';
import { useIsPartyMemberLocked } from '../../hooks/usePartyMemberRouteGate';
import type { ICharacter } from '../../api/v1/characterApi';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
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
    ...overrides,
} as ICharacter);

const renderBattle = () =>
    render(
        <MemoryRouter>
            <Battle />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useTransformStore.setState({ completedTransforms: [] });
    useConnectivityStore.setState({ mode: 'online', userExplicitlyOffline: false });
    vi.mocked(useIsPartyMemberLocked).mockReturnValue(false);
    requestPartyCombatStartMock.mockReset();
    navigateMock.mockReset();
});

afterEach(() => {
    cleanup();
});

describe('Battle — smoke', () => {
    it('renders without crashing when a character is loaded', () => {
        const { container } = renderBattle();
        expect(container.querySelector('.battle')).not.toBeNull();
    });

    it('renders all 7 battle-mode tiles', () => {
        renderBattle();
        // Each tile has the Polish label as visible text + as aria-label.
        expect(screen.getByLabelText('Polowanie')).toBeTruthy();
        expect(screen.getByLabelText('Dungeon')).toBeTruthy();
        expect(screen.getByLabelText('Boss')).toBeTruthy();
        expect(screen.getByLabelText('Transformacja')).toBeTruthy();
        expect(screen.getByLabelText('Raid')).toBeTruthy();
        expect(screen.getByLabelText('Arena')).toBeTruthy();
        expect(screen.getByLabelText('Trainer')).toBeTruthy();
    });

    it('still renders even when character is null', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderBattle();
        expect(container.querySelector('.battle')).not.toBeNull();
        // All 7 tiles still mount — they just use the fallback accent.
        expect(screen.getByLabelText('Polowanie')).toBeTruthy();
    });
});

describe('Battle — navigation', () => {
    it('navigates to /combat when Polowanie is clicked', () => {
        renderBattle();
        fireEvent.click(screen.getByLabelText('Polowanie'));
        expect(navigateMock).toHaveBeenCalledWith('/combat');
    });

    it('navigates to /boss when Boss is clicked', () => {
        renderBattle();
        fireEvent.click(screen.getByLabelText('Boss'));
        expect(navigateMock).toHaveBeenCalledWith('/boss');
    });

    it('navigates to /dungeon when Dungeon is clicked', () => {
        renderBattle();
        fireEvent.click(screen.getByLabelText('Dungeon'));
        expect(navigateMock).toHaveBeenCalledWith('/dungeon');
    });

    it('routes the Trainer click through requestPartyCombatStart, not a direct navigate', () => {
        // Simulate the helper returning true (leader / solo path -> fires
        // onConfirmed which would navigate). Battle's own onClick should NOT
        // call navigate directly for /trainer — only via the helper.
        requestPartyCombatStartMock.mockReturnValue(true);
        renderBattle();
        fireEvent.click(screen.getByLabelText('Trainer'));
        expect(requestPartyCombatStartMock).toHaveBeenCalledTimes(1);
        // The helper was called with destination='/trainer' + a callback.
        const call = requestPartyCombatStartMock.mock.calls[0][0] as {
            destination: string;
            label: string;
            onConfirmed: () => void;
        };
        expect(call.destination).toBe('/trainer');
        expect(call.label).toBe('Trainer');
        expect(typeof call.onConfirmed).toBe('function');
        // The direct navigate path is NOT taken — Battle's own click handler
        // returns after invoking the helper.
        expect(navigateMock).not.toHaveBeenCalled();
    });
});

describe('Battle — offline lock', () => {
    it('renders /raid + /arena tiles in the locked state when offline', () => {
        useConnectivityStore.setState({ mode: 'offline', userExplicitlyOffline: true });
        renderBattle();
        const raidTile = screen.getByLabelText('Raid');
        const arenaTile = screen.getByLabelText('Arena');
        expect(raidTile.className).toContain('battle__tile--offline-locked');
        expect(arenaTile.className).toContain('battle__tile--offline-locked');
    });

    it('blocks navigation when an offline-locked tile is clicked', () => {
        useConnectivityStore.setState({ mode: 'offline', userExplicitlyOffline: true });
        renderBattle();
        fireEvent.click(screen.getByLabelText('Raid'));
        fireEvent.click(screen.getByLabelText('Arena'));
        expect(navigateMock).not.toHaveBeenCalled();
    });

    it('does NOT mark /boss or /trainer as offline-locked (those are leader-gated, not offline-gated)', () => {
        useConnectivityStore.setState({ mode: 'offline', userExplicitlyOffline: true });
        renderBattle();
        const boss = screen.getByLabelText('Boss');
        const trainer = screen.getByLabelText('Trainer');
        expect(boss.className).not.toContain('battle__tile--offline-locked');
        expect(trainer.className).not.toContain('battle__tile--offline-locked');
    });
});

describe('Battle — party-member lock', () => {
    it('marks leader-only routes as locked when isMemberLocked is true', () => {
        vi.mocked(useIsPartyMemberLocked).mockReturnValue(true);
        renderBattle();
        // /boss /raid /trainer /combat -> all locked for non-leader members.
        expect(screen.getByLabelText('Polowanie').className).toContain('battle__tile--locked');
        expect(screen.getByLabelText('Boss').className).toContain('battle__tile--locked');
        expect(screen.getByLabelText('Raid').className).toContain('battle__tile--locked');
        expect(screen.getByLabelText('Trainer').className).toContain('battle__tile--locked');
    });

    it('does NOT lock arena/dungeon/transform for party members (those routes are member-allowed)', () => {
        vi.mocked(useIsPartyMemberLocked).mockReturnValue(true);
        // Force online so arena isn't offline-locked
        useConnectivityStore.setState({ mode: 'online', userExplicitlyOffline: false });
        renderBattle();
        expect(screen.getByLabelText('Arena').className).not.toContain('battle__tile--locked');
        expect(screen.getByLabelText('Dungeon').className).not.toContain('battle__tile--locked');
        expect(screen.getByLabelText('Transformacja').className).not.toContain('battle__tile--locked');
    });

    it('silently no-ops on click for a locked member tile (no navigation, no ready-check)', () => {
        vi.mocked(useIsPartyMemberLocked).mockReturnValue(true);
        renderBattle();
        fireEvent.click(screen.getByLabelText('Boss'));
        fireEvent.click(screen.getByLabelText('Trainer'));
        expect(navigateMock).not.toHaveBeenCalled();
        expect(requestPartyCombatStartMock).not.toHaveBeenCalled();
    });
});
