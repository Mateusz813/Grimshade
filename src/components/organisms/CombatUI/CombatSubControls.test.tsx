import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/**
 * CombatSubControls — strip with bag/logs buttons + XP bar. Compact mode
 * (Dungeon/Boss/Raid/Arena) hides the bag and floats logs. The bag + logs
 * open modals which are mocked out here so we only test the trigger.
 */
vi.mock('./CombatBackpackModal', () => ({
    default: ({ onClose }: { onClose: () => void }) => (
        <div data-testid="bag-modal">
            <button data-testid="bag-close" onClick={onClose}>x</button>
        </div>
    ),
}));

vi.mock('./CombatLogsModal', () => ({
    default: ({ onClose }: { onClose: () => void }) => (
        <div data-testid="logs-modal">
            <button data-testid="logs-close" onClick={onClose}>x</button>
        </div>
    ),
}));

import CombatSubControls from './CombatSubControls';
import { useCombatHudStore } from '../../../stores/combatHudStore';

beforeEach(() => {
    useCombatHudStore.setState({ active: true, compact: false });
});

afterEach(() => {
    cleanup();
});

describe('CombatSubControls — non-compact mode', () => {
    it('renders bag + logs buttons', () => {
        render(<CombatSubControls />);
        expect(screen.getByLabelText('Łup tej sesji')).toBeTruthy();
        expect(screen.getByLabelText('Logi walki')).toBeTruthy();
    });

    it('applies the ping modifier to bag when showBackpackPing is true', () => {
        const { container } = render(<CombatSubControls showBackpackPing />);
        expect(container.querySelector('.combat-ui__sub-bag--ping')).toBeTruthy();
    });

    it('opens bag modal on bag-icon click', () => {
        render(<CombatSubControls />);
        fireEvent.click(screen.getByLabelText('Łup tej sesji'));
        expect(screen.getByTestId('bag-modal')).toBeTruthy();
    });

    it('opens logs modal on logs-icon click', () => {
        render(<CombatSubControls />);
        fireEvent.click(screen.getByLabelText('Logi walki'));
        expect(screen.getByTestId('logs-modal')).toBeTruthy();
    });

    it('closes bag modal via onClose callback', () => {
        render(<CombatSubControls />);
        fireEvent.click(screen.getByLabelText('Łup tej sesji'));
        fireEvent.click(screen.getByTestId('bag-close'));
        expect(screen.queryByTestId('bag-modal')).toBeNull();
    });

    it('renders waveControl + tally slots when provided', () => {
        render(
            <CombatSubControls
                waveControl={<div data-testid="wave">+/-</div>}
                tally={<div data-testid="tally">tally</div>}
            />,
        );
        expect(screen.getByTestId('wave')).toBeTruthy();
        expect(screen.getByTestId('tally')).toBeTruthy();
    });
});

describe('CombatSubControls — XP bar', () => {
    it('does not render XP bar when xp prop is null/omitted', () => {
        const { container } = render(<CombatSubControls />);
        expect(container.querySelector('.combat-ui__sub-xp')).toBeNull();
    });

    it('renders XP bar with computed percentage', () => {
        render(<CombatSubControls xp={{ current: 25, max: 100, level: 7 }} />);
        // 25/100 = 25%.
        expect(screen.getByText(/Lv 7 · 25%/)).toBeTruthy();
    });

    it('renders xpPerHour readout when > 0', () => {
        render(
            <CombatSubControls
                xp={{ current: 50, max: 100, level: 3 }}
                xpPerHour={1500}
            />,
        );
        // 1500 → "1.5k" via formatRate.
        expect(screen.getByText(/1\.5k XP\/h/)).toBeTruthy();
    });

    it('renders xpBonusPct chip when > 0', () => {
        render(
            <CombatSubControls
                xp={{ current: 50, max: 100, level: 3 }}
                xpPerHour={500}
                xpBonusPct={0.18}
            />,
        );
        expect(screen.getByText('+18%')).toBeTruthy();
    });
});

describe('CombatSubControls — compact mode', () => {
    beforeEach(() => {
        useCombatHudStore.setState({ active: true, compact: true });
    });

    it('hides bag in compact mode', () => {
        const { container } = render(<CombatSubControls />);
        expect(container.querySelector('.combat-ui__sub-bag')).toBeNull();
    });

    it('renders only the floating logs button in compact mode', () => {
        const { container } = render(<CombatSubControls />);
        expect(container.querySelector('.combat-ui__sub-logs--floating')).toBeTruthy();
    });

    it('never opens bag modal in compact mode even via state (no trigger)', () => {
        render(<CombatSubControls />);
        // No bag button to click.
        expect(screen.queryByLabelText('Łup tej sesji')).toBeNull();
        // Still can open logs modal.
        fireEvent.click(screen.getByLabelText('Logi walki'));
        expect(screen.getByTestId('logs-modal')).toBeTruthy();
    });
});
