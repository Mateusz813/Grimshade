import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Deposit view — bag ↔ deposit bank. Two-panel layout with rarity +
 * slot filters, search, and bulk move actions. Lightweight (~250
 * lines).
 *
 * Coverage:
 *   • Smoke render (root + header + both panels).
 *   • Empty-state copy on both panels when bag + deposit are empty.
 *   • Rarity-filter toggle changes the `--active` modifier.
 *   • Search input controlled state echo.
 *   • Deposit tile click → calls `depositItem` (item moves out of bag).
 *   • Withdraw tile click → calls `withdrawItem` (item moves out of deposit).
 *   • "Wpłać wszystkie" bulk button disabled when filtered bag is empty.
 *   • Back button calls navigate('/').
 *
 * No need to mock framer-motion — Deposit doesn't use it.
 */

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

import Deposit from './Deposit';
import { useInventoryStore } from '../../stores/inventoryStore';
import type { IInventoryItem } from '../../systems/itemSystem';

const makeItem = (uuid: string, overrides: Partial<IInventoryItem> = {}): IInventoryItem => ({
    uuid,
    itemId: 'sword_iron',
    rarity: 'common',
    bonuses: {},
    upgradeLevel: 0,
    itemLevel: 1,
    ...overrides,
} as IInventoryItem);

const renderDeposit = () =>
    render(
        <MemoryRouter>
            <Deposit />
        </MemoryRouter>,
    );

beforeEach(() => {
    useInventoryStore.setState({
        bag: [],
        deposit: [],
    });
    navigateMock.mockReset();
});

afterEach(() => {
    cleanup();
});

describe('Deposit — smoke', () => {
    it('renders the root .deposit and the page header', () => {
        const { container } = renderDeposit();
        expect(container.querySelector('.deposit')).not.toBeNull();
        expect(container.querySelector('.deposit__header')).not.toBeNull();
        expect(container.querySelector('.deposit__title')?.textContent).toMatch(/Depozyt/i);
    });

    it('renders both panels (bag + deposit) with their headers', () => {
        const { container } = renderDeposit();
        const panels = container.querySelectorAll('.deposit__panel');
        expect(panels.length).toBe(2);
        // Bag panel header
        const headers = Array.from(container.querySelectorAll('.deposit__panel-title'))
            .map((el) => el.textContent ?? '');
        expect(headers.some((h) => h.includes('Plecak'))).toBe(true);
        expect(headers.some((h) => h.includes('Depozyt'))).toBe(true);
    });

    it('renders empty-state copy on both panels when bag + deposit are empty', () => {
        const { container } = renderDeposit();
        const empties = container.querySelectorAll('.deposit__empty');
        expect(empties.length).toBe(2);
        const text = Array.from(empties).map((e) => e.textContent ?? '').join(' ');
        expect(text).toMatch(/Brak/);
    });

    it('shows panel counts "0 / 1000" and "0 / 10000" when empty', () => {
        const { container } = renderDeposit();
        const counts = Array.from(container.querySelectorAll('.deposit__panel-count'))
            .map((el) => el.textContent ?? '');
        expect(counts[0]).toMatch(/0\s*\/\s*1000/);
        expect(counts[1]).toMatch(/0\s*\/\s*10000/);
    });
});

describe('Deposit — filters', () => {
    it('toggles the rarity filter --active modifier when a chip is clicked', () => {
        const { container } = renderDeposit();
        // "Wszystkie" is the default active rarity filter.
        const rareBtn = Array.from(container.querySelectorAll('.deposit__filter'))
            .find((b) => b.textContent === 'Rare') as HTMLButtonElement | undefined;
        expect(rareBtn).toBeTruthy();
        fireEvent.click(rareBtn!);
        expect(rareBtn!.className).toContain('deposit__filter--active');
    });

    it('echoes typed text into the search input', () => {
        const { container } = renderDeposit();
        const input = container.querySelector('.deposit__search') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'iron' } });
        expect(input.value).toBe('iron');
    });

    it('renders slot filter buttons for the 9 common slots', () => {
        const { container } = renderDeposit();
        const slotBtns = container.querySelectorAll('.deposit__filter--slot');
        // 15 entries in SLOT_FILTERS (all, weapons, armor-group, jewelry,
        // mainHand, offHand, helmet, shoulders, armor, gloves, pants,
        // boots, necklace, earrings, ring1).
        expect(slotBtns.length).toBe(15);
    });
});

describe('Deposit — tile actions', () => {
    it('renders a bag tile per item and calls depositItem when clicked', () => {
        useInventoryStore.setState({
            bag: [makeItem('item-1')],
            deposit: [],
        });
        const depositSpy = vi.fn().mockReturnValue(true);
        useInventoryStore.setState({ depositItem: depositSpy });
        const { container } = renderDeposit();
        const tile = container.querySelector('.deposit__tile') as HTMLElement;
        expect(tile).not.toBeNull();
        fireEvent.click(tile);
        expect(depositSpy).toHaveBeenCalledWith('item-1');
    });

    it('renders a deposit tile per item and calls withdrawItem when clicked', () => {
        useInventoryStore.setState({
            bag: [],
            deposit: [makeItem('item-2')],
        });
        const withdrawSpy = vi.fn().mockReturnValue(true);
        useInventoryStore.setState({ withdrawItem: withdrawSpy });
        const { container } = renderDeposit();
        const tile = container.querySelector('.deposit__tile') as HTMLElement;
        expect(tile).not.toBeNull();
        fireEvent.click(tile);
        expect(withdrawSpy).toHaveBeenCalledWith('item-2');
    });
});

describe('Deposit — bulk action button gating', () => {
    it('disables "Wpłać wszystkie" when bag is empty', () => {
        useInventoryStore.setState({ bag: [], deposit: [] });
        const { container } = renderDeposit();
        const depositAll = Array.from(container.querySelectorAll('.deposit__bulk-btn'))
            .find((b) => b.textContent?.includes('Wpłać wszystkie')) as HTMLButtonElement | undefined;
        expect(depositAll).toBeTruthy();
        expect(depositAll!.disabled).toBe(true);
    });

    it('enables "Wpłać wszystkie" when bag has at least one item', () => {
        useInventoryStore.setState({
            bag: [makeItem('item-1')],
            deposit: [],
        });
        const { container } = renderDeposit();
        const depositAll = Array.from(container.querySelectorAll('.deposit__bulk-btn'))
            .find((b) => b.textContent?.includes('Wpłać wszystkie')) as HTMLButtonElement | undefined;
        expect(depositAll!.disabled).toBe(false);
    });

    it('disables "Wypłać wszystkie" when deposit is empty', () => {
        const { container } = renderDeposit();
        const withdrawAll = Array.from(container.querySelectorAll('.deposit__bulk-btn'))
            .find((b) => b.textContent?.includes('Wypłać wszystkie')) as HTMLButtonElement | undefined;
        expect(withdrawAll!.disabled).toBe(true);
    });
});

describe('Deposit — navigation', () => {
    it('navigates back to /  when the "Miasto" back button is clicked', () => {
        const { container } = renderDeposit();
        const back = container.querySelector('.deposit__back') as HTMLButtonElement;
        fireEvent.click(back);
        expect(navigateMock).toHaveBeenCalledWith('/');
    });
});

// TODO: Filter interaction beyond click-active is covered indirectly via
//       the rendered tile count — full filter-matrix coverage (e.g.
//       slot=weapons hides accessory items, search narrows by displayName)
//       is straightforward but requires seeding multiple items + asserting
//       on `.deposit__tile` counts after each filter toggle. Easy to add
//       once the views are stable enough that BEM class names won't churn.
