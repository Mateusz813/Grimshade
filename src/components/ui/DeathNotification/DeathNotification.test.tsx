import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';


const navigateMock = vi.fn();
const stopCombatMock = vi.fn();

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

vi.mock('../../../systems/combatEngine', () => ({
    stopCombat: () => stopCombatMock(),
}));

import DeathNotification from './DeathNotification';
import { useDeathStore } from '../../../stores/deathStore';
import { useCombatStore } from '../../../stores/combatStore';

const renderInRouter = () =>
    render(
        <MemoryRouter>
            <DeathNotification />
        </MemoryRouter>,
    );

beforeEach(() => {
    navigateMock.mockReset();
    stopCombatMock.mockReset();
    useDeathStore.setState({ event: null });
    useCombatStore.setState({ phase: 'idle' });
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useDeathStore.setState({ event: null });
});

describe('DeathNotification — visibility', () => {
    it('renders nothing when there is no event', () => {
        const { container } = renderInRouter();
        expect(container.querySelector('.death')).toBeNull();
    });

    it('renders the death variant with full skull + killer copy', () => {
        useDeathStore.setState({
            event: {
                kind: 'death',
                killedBy: 'Lich King',
                sourceLevel: 50,
                oldLevel: 30,
                newLevel: 28,
                levelsLost: 2,
                xpPercent: 0,
                skillXpLossPercent: 25,
                protectionUsed: false,
                source: 'monster',
            },
        });
        renderInRouter();
        expect(screen.getByText('ZGINĄŁEŚ')).toBeTruthy();
        expect(screen.getByText('Lich King')).toBeTruthy();
        const levelRow = document.querySelector('.death__penalty--level');
        expect(levelRow?.textContent).toMatch(/Poziom\s*30/);
        expect(levelRow?.textContent).toMatch(/28/);
    });

    it('renders the flee variant with UCIEKŁEŚ label and no killer block', () => {
        useDeathStore.setState({
            event: {
                kind: 'flee',
                killedBy: '—',
                sourceLevel: 1,
                oldLevel: 5,
                newLevel: 5,
                levelsLost: 0,
                xpPercent: 0,
                skillXpLossPercent: 2.5,
                protectionUsed: false,
                source: 'flee',
            },
        });
        renderInRouter();
        expect(screen.getByText('UCIEKŁEŚ')).toBeTruthy();
        expect(screen.queryByText(/Zabity przez/)).toBeNull();
        expect(document.querySelector('.death--flee')).toBeTruthy();
    });

    it('shows the protection-used copy when protectionUsed is true', () => {
        useDeathStore.setState({
            event: {
                kind: 'death',
                killedBy: 'X',
                sourceLevel: 1,
                oldLevel: 5,
                newLevel: 5,
                levelsLost: 0,
                xpPercent: 0,
                skillXpLossPercent: 0,
                protectionUsed: true,
                source: 'monster',
            },
        });
        renderInRouter();
        expect(screen.getByText(/Eliksir Ochrony uchronił od utraty poziomu/)).toBeTruthy();
    });
});

describe('DeathNotification — death side effects', () => {
    it('auto-navigates to / on a real death', () => {
        useDeathStore.setState({
            event: {
                kind: 'death',
                killedBy: 'X',
                sourceLevel: 1,
                oldLevel: 5,
                newLevel: 5,
                levelsLost: 0,
                xpPercent: 0,
                skillXpLossPercent: 0,
                protectionUsed: false,
                source: 'monster',
            },
        });
        renderInRouter();
        expect(navigateMock).toHaveBeenCalledWith('/');
    });

    it('calls stopCombat when combat is active and a death lands', () => {
        useCombatStore.setState({ phase: 'fighting' });
        useDeathStore.setState({
            event: {
                kind: 'death',
                killedBy: 'X',
                sourceLevel: 1,
                oldLevel: 5,
                newLevel: 5,
                levelsLost: 0,
                xpPercent: 0,
                skillXpLossPercent: 0,
                protectionUsed: false,
                source: 'monster',
            },
        });
        renderInRouter();
        expect(stopCombatMock).toHaveBeenCalled();
    });

    it('does NOT navigate on a flee event', () => {
        useDeathStore.setState({
            event: {
                kind: 'flee',
                killedBy: '—',
                sourceLevel: 1,
                oldLevel: 5,
                newLevel: 5,
                levelsLost: 0,
                xpPercent: 0,
                skillXpLossPercent: 0,
                protectionUsed: false,
                source: 'flee',
            },
        });
        renderInRouter();
        expect(navigateMock).not.toHaveBeenCalled();
    });

    it('auto-dismisses flee after 3500ms', () => {
        useDeathStore.setState({
            event: {
                kind: 'flee',
                killedBy: '—',
                sourceLevel: 1,
                oldLevel: 5,
                newLevel: 5,
                levelsLost: 0,
                xpPercent: 0,
                skillXpLossPercent: 0,
                protectionUsed: false,
                source: 'flee',
            },
        });
        renderInRouter();
        expect(useDeathStore.getState().event).not.toBeNull();
        act(() => {
            vi.advanceTimersByTime(4000);
        });
        expect(useDeathStore.getState().event).toBeNull();
    });
});

describe('DeathNotification — click dismissal', () => {
    it('clears the event on click', () => {
        useDeathStore.setState({
            event: {
                kind: 'death',
                killedBy: 'X',
                sourceLevel: 1,
                oldLevel: 5,
                newLevel: 5,
                levelsLost: 0,
                xpPercent: 0,
                skillXpLossPercent: 0,
                protectionUsed: false,
                source: 'monster',
            },
        });
        renderInRouter();
        fireEvent.click(document.querySelector('.death')!);
        expect(useDeathStore.getState().event).toBeNull();
    });
});
