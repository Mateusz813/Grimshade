import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/**
 * CombatBackpackModal — popup summarising the cumulative session loot.
 * Reads sessionXp / sessionGold / sessionKills / sessionDrops off combatStore
 * and computes XP / drop bonuses from buffStore + partyStore.
 *
 * ItemIcon is mocked to a flat data-testid so we don't depend on its
 * internal asset resolution. partySystem helpers are kept real (cheap).
 */
vi.mock('../../ui/ItemIcon/ItemIcon', () => ({
    default: ({ icon, quantity, tooltip }: { icon: string; quantity?: number; tooltip?: string }) => (
        <div data-testid="item-icon" data-icon={icon} data-qty={quantity} title={tooltip} />
    ),
}));

import CombatBackpackModal from './CombatBackpackModal';
import { useCombatStore } from '../../../stores/combatStore';
import { useBuffStore } from '../../../stores/buffStore';
import { usePartyStore } from '../../../stores/partyStore';
import type { IDropDisplay } from '../../../systems/combatEngine';

beforeEach(() => {
    useCombatStore.setState({
        sessionXpEarned: 0,
        sessionGoldEarned: 0,
        sessionKills: { normal: 0, strong: 0, epic: 0, legendary: 0, boss: 0 },
        sessionDrops: [],
    });
    useBuffStore.setState({ allBuffs: [] });
    usePartyStore.setState({ party: null });
});

afterEach(() => {
    cleanup();
});

const drop = (overrides: Partial<IDropDisplay> = {}): IDropDisplay => ({
    icon: 'crossed-swords',
    name: 'Sword',
    rarity: 'common',
    ...overrides,
});

describe('CombatBackpackModal — smoke', () => {
    it('renders title + close button', () => {
        render(<CombatBackpackModal onClose={vi.fn()} />);
        expect(screen.getByText(/Łup tej sesji/)).toBeTruthy();
        expect(screen.getByLabelText('Zamknij')).toBeTruthy();
    });

    it('renders zero totals + empty message by default', () => {
        render(<CombatBackpackModal onClose={vi.fn()} />);
        expect(screen.getByText('Jeszcze nic nie wpadło.')).toBeTruthy();
    });

    it('renders session totals from combatStore', () => {
        useCombatStore.setState({
            sessionXpEarned: 1234,
            sessionGoldEarned: 5678,
            sessionKills: { normal: 5, strong: 2, epic: 1, legendary: 0, boss: 0 },
        });
        render(<CombatBackpackModal onClose={vi.fn()} />);
        // 5+2+1+0+0 = 8 kills.
        expect(screen.getByText('8')).toBeTruthy();
        // XP via toLocaleString('pl-PL'). Separator depends on ICU
        // availability — match digits with optional separator char.
        expect(screen.getByText(/\+1.?234/)).toBeTruthy();
    });
});

describe('CombatBackpackModal — drops grouping', () => {
    it('renders one tile per distinct drop key', () => {
        useCombatStore.setState({
            sessionDrops: [drop({ name: 'Sword' }), drop({ name: 'Shield' })],
        });
        render(<CombatBackpackModal onClose={vi.fn()} />);
        expect(screen.getAllByTestId('item-icon').length).toBe(2);
    });

    it('groups duplicate drops into a single tile with quantity', () => {
        useCombatStore.setState({
            sessionDrops: [
                drop({ name: 'Sword' }),
                drop({ name: 'Sword' }),
                drop({ name: 'Sword' }),
            ],
        });
        render(<CombatBackpackModal onClose={vi.fn()} />);
        const tiles = screen.getAllByTestId('item-icon');
        expect(tiles.length).toBe(1);
        expect(tiles[0].getAttribute('data-qty')).toBe('3');
    });

    it('keeps sold vs kept drops as separate stacks', () => {
        useCombatStore.setState({
            sessionDrops: [
                drop({ name: 'Sword', sold: false }),
                drop({ name: 'Sword', sold: true, soldPrice: 100 }),
            ],
        });
        render(<CombatBackpackModal onClose={vi.fn()} />);
        expect(screen.getAllByTestId('item-icon').length).toBe(2);
    });

    it('appends "sprzedano za" to the tooltip for sold stacks', () => {
        useCombatStore.setState({
            sessionDrops: [
                drop({ name: 'Sword', sold: true, soldPrice: 50 }),
                drop({ name: 'Sword', sold: true, soldPrice: 50 }),
            ],
        });
        render(<CombatBackpackModal onClose={vi.fn()} />);
        const tile = screen.getByTestId('item-icon');
        expect(tile.getAttribute('title')).toMatch(/sprzedano za/);
    });
});

describe('CombatBackpackModal — interactions', () => {
    it('fires onClose when × button is clicked', () => {
        const onClose = vi.fn();
        render(<CombatBackpackModal onClose={onClose} />);
        fireEvent.click(screen.getByLabelText('Zamknij'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('fires onClose when backdrop is clicked', () => {
        const onClose = vi.fn();
        const { container } = render(<CombatBackpackModal onClose={onClose} />);
        fireEvent.click(container.querySelector('.combat-ui__modal-bg')!);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire onClose on modal body click (stop propagation)', () => {
        const onClose = vi.fn();
        const { container } = render(<CombatBackpackModal onClose={onClose} />);
        fireEvent.click(container.querySelector('.combat-ui__modal')!);
        expect(onClose).not.toHaveBeenCalled();
    });
});
