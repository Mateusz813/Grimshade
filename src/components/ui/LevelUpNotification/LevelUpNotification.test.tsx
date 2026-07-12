import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

import LevelUpNotification from './LevelUpNotification';
import { useLevelUpStore } from '../../../stores/levelUpStore';


beforeEach(() => {
    useLevelUpStore.setState({ event: null });
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useLevelUpStore.setState({ event: null });
});

describe('LevelUpNotification — visibility', () => {
    it('renders nothing when there is no event', () => {
        const { container } = render(<LevelUpNotification />);
        expect(container.querySelector('.lvlup')).toBeNull();
    });

    it('renders the epic variant when not in combat', () => {
        useLevelUpStore.setState({
            event: {
                newLevel: 10,
                levelsGained: 1,
                statPointsGained: 5,
                inCombat: false,
            },
        });
        render(<LevelUpNotification />);
        expect(screen.getByText('LEVEL UP!')).toBeTruthy();
        expect(screen.getByText('10')).toBeTruthy();
        expect(screen.getByText(/\+5 punktów statystyk/)).toBeTruthy();
        expect(document.querySelector('.lvlup--epic')).toBeTruthy();
        expect(document.querySelector('.lvlup--subtle')).toBeNull();
    });

    it('renders the subtle variant when in combat', () => {
        useLevelUpStore.setState({
            event: {
                newLevel: 12,
                levelsGained: 1,
                statPointsGained: 5,
                inCombat: true,
            },
        });
        render(<LevelUpNotification />);
        expect(screen.getByText('Poziom 12!')).toBeTruthy();
        expect(document.querySelector('.lvlup--subtle')).toBeTruthy();
        expect(document.querySelector('.lvlup--epic')).toBeNull();
    });

    it('renders gold reward only when goldGained > 0 in epic mode', () => {
        useLevelUpStore.setState({
            event: {
                newLevel: 25,
                levelsGained: 1,
                statPointsGained: 5,
                inCombat: false,
                goldGained: 1000,
                goldMilestoneLevels: [25],
            },
        });
        render(<LevelUpNotification />);
        expect(screen.getByText(/milestone lvl 25/)).toBeTruthy();
    });
});

describe('LevelUpNotification — dismissal', () => {
    it('clears the event on click', () => {
        useLevelUpStore.setState({
            event: {
                newLevel: 7,
                levelsGained: 1,
                statPointsGained: 5,
                inCombat: false,
            },
        });
        render(<LevelUpNotification />);
        fireEvent.click(document.querySelector('.lvlup')!);
        expect(useLevelUpStore.getState().event).toBeNull();
    });

    it('auto-dismisses after the subtle duration (3000ms) when in combat', () => {
        useLevelUpStore.setState({
            event: {
                newLevel: 5,
                levelsGained: 1,
                statPointsGained: 5,
                inCombat: true,
            },
        });
        render(<LevelUpNotification />);
        expect(useLevelUpStore.getState().event).not.toBeNull();
        act(() => {
            vi.advanceTimersByTime(3100);
        });
        expect(useLevelUpStore.getState().event).toBeNull();
    });

    it('auto-dismisses after the epic duration (5000ms) when out of combat', () => {
        useLevelUpStore.setState({
            event: {
                newLevel: 5,
                levelsGained: 1,
                statPointsGained: 5,
                inCombat: false,
            },
        });
        render(<LevelUpNotification />);
        act(() => {
            vi.advanceTimersByTime(3100);
        });
        expect(useLevelUpStore.getState().event).not.toBeNull();
        act(() => {
            vi.advanceTimersByTime(2000);
        });
        expect(useLevelUpStore.getState().event).toBeNull();
    });
});
