import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * HuntedTally — "Upolowano" strip that reads sessionKills off the combat
 * store and shows one cell per rarity tier. Pure display.
 */
import HuntedTally from './HuntedTally';
import { useCombatStore } from '../../../stores/combatStore';

beforeEach(() => {
    useCombatStore.setState({
        sessionKills: { normal: 0, strong: 0, epic: 0, legendary: 0, boss: 0 },
    });
});

afterEach(() => {
    cleanup();
});

describe('HuntedTally — smoke', () => {
    it('renders all 5 rarity cells with zero counts by default', () => {
        const { container } = render(<HuntedTally />);
        const cells = container.querySelectorAll('.combat-ui__hunted-cell');
        expect(cells.length).toBe(5);
        // 5 zero counts shown.
        const counts = container.querySelectorAll('.combat-ui__hunted-count');
        counts.forEach((c) => expect(c.textContent).toBe('0'));
    });

    it('renders the correct emoji per rarity tier', () => {
        const { container } = render(<HuntedTally />);
        expect(container.querySelector('.combat-ui__hunted-cell--normal')).toBeTruthy();
        expect(container.querySelector('.combat-ui__hunted-cell--strong')).toBeTruthy();
        expect(container.querySelector('.combat-ui__hunted-cell--epic')).toBeTruthy();
        expect(container.querySelector('.combat-ui__hunted-cell--legendary')).toBeTruthy();
        expect(container.querySelector('.combat-ui__hunted-cell--boss')).toBeTruthy();
    });

    it('reflects sessionKills from the store', () => {
        useCombatStore.setState({
            sessionKills: { normal: 12, strong: 3, epic: 1, legendary: 0, boss: 0 },
        });
        render(<HuntedTally />);
        expect(screen.getByText('12')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
        expect(screen.getByText('1')).toBeTruthy();
    });

    it('shows 0 for missing rarity keys (defensive default)', () => {
        // Empty record: every tier should fall back to 0.
        useCombatStore.setState({ sessionKills: {} });
        const { container } = render(<HuntedTally />);
        const counts = container.querySelectorAll('.combat-ui__hunted-count');
        counts.forEach((c) => expect(c.textContent).toBe('0'));
    });
});
