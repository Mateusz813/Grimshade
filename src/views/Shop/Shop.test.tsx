import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Shop view — town vendor (~640 lines). 4 tabs (Items / Potions /
 * Elixirs / Arena), backpack-style item cards with stat comparisons.
 *
 * Coverage:
 *   • Smoke render + spinner fallback when character is null.
 *   • 4 tab buttons render with aria-label aria-labels.
 *   • Default tab is "items".
 *   • Tab switching moves the --active modifier.
 *   • Items tab renders generated cards (per-class catalog).
 *   • Potions / Elixirs tabs render cards from the ELIXIRS registry.
 *   • Arena tab renders the arena shop catalog.
 *   • Class variants (Mage, Archer, Rogue) all render generated items.
 *
 * Mocks: framer-motion (animations); no need to mock Supabase as
 * shopStore is purely local.
 */

vi.mock('framer-motion', async () => {
    const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
    return {
        ...actual,
        AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        motion: new Proxy({}, {
            get: () => (props: Record<string, unknown>) => {
                const { children, ...rest } = props as { children?: React.ReactNode };
                return <div {...(rest as Record<string, unknown>)}>{children}</div>;
            },
        }),
    };
});

import Shop from './Shop';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { EMPTY_EQUIPMENT } from '../../systems/itemSystem';
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

const renderShop = () =>
    render(
        <MemoryRouter>
            <Shop />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useInventoryStore.setState({
        bag: [],
        equipment: { ...EMPTY_EQUIPMENT },
        deposit: [],
        gold: 100_000,
        arenaPoints: 5000,
        consumables: {},
        stones: {},
    });
});

afterEach(() => {
    cleanup();
});

describe('Shop — smoke', () => {
    it('renders the root .shop container', () => {
        const { container } = renderShop();
        expect(container.querySelector('.shop')).not.toBeNull();
    });

    it('shows a spinner-only .shop layout when character is null', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderShop();
        // Spec: `if (!character) return <div className="shop"><Spinner /></div>`.
        // The .shop root mounts but the tabs row does not.
        expect(container.querySelector('.shop')).not.toBeNull();
        expect(container.querySelector('.shop__tabs')).toBeNull();
    });

    it('renders the header strip + tabs nav when a character is loaded', () => {
        const { container } = renderShop();
        expect(container.querySelector('.shop__header-strip')).not.toBeNull();
        expect(container.querySelector('.shop__tabs')).not.toBeNull();
    });

    it('renders 4 tab buttons (Items / Potions / Elixirs / Arena)', () => {
        const { container } = renderShop();
        const tabs = container.querySelectorAll('.shop__tab');
        expect(tabs.length).toBe(4);
        const labels = Array.from(tabs).map((t) => t.getAttribute('aria-label') ?? '');
        expect(labels).toContain('Itemy');
        expect(labels).toContain('Potiony');
        expect(labels).toContain('Eliksiry');
        expect(labels).toContain('Arena');
    });

    it('marks the Items tab as the default --active tab', () => {
        const { container } = renderShop();
        const activeTab = container.querySelector('.shop__tab--active');
        expect(activeTab?.getAttribute('aria-label')).toBe('Itemy');
    });
});

describe('Shop — tab switching', () => {
    it('moves the --active modifier to Potions when clicked', () => {
        const { container } = renderShop();
        const potionsTab = Array.from(container.querySelectorAll('.shop__tab'))
            .find((t) => t.getAttribute('aria-label') === 'Potiony') as HTMLButtonElement;
        fireEvent.click(potionsTab);
        expect(potionsTab.className).toContain('shop__tab--active');
    });

    it('moves the --active modifier to Elixirs when clicked', () => {
        const { container } = renderShop();
        const elixirsTab = Array.from(container.querySelectorAll('.shop__tab'))
            .find((t) => t.getAttribute('aria-label') === 'Eliksiry') as HTMLButtonElement;
        fireEvent.click(elixirsTab);
        expect(elixirsTab.className).toContain('shop__tab--active');
    });

    it('moves the --active modifier to Arena when clicked', () => {
        const { container } = renderShop();
        const arenaTab = Array.from(container.querySelectorAll('.shop__tab'))
            .find((t) => t.getAttribute('aria-label') === 'Arena') as HTMLButtonElement;
        fireEvent.click(arenaTab);
        expect(arenaTab.className).toContain('shop__tab--active');
    });
});

describe('Shop — items tab cards', () => {
    it('renders at least one shop card on the Items tab for a Knight', () => {
        const { container } = renderShop();
        // `generateShopItems(class, level)` produces a per-class catalog.
        // For Knight level 5 the catalog is non-empty.
        const cards = container.querySelectorAll('.shop__card-icon');
        expect(cards.length).toBeGreaterThan(0);
    });

    it('shows the buy button on each items-tab card', () => {
        const { container } = renderShop();
        const buyBtns = container.querySelectorAll('.shop__buy-btn');
        expect(buyBtns.length).toBeGreaterThan(0);
    });
});

describe('Shop — potions tab', () => {
    it('renders potion cards after switching to Potions tab', () => {
        const { container } = renderShop();
        const potionsTab = Array.from(container.querySelectorAll('.shop__tab'))
            .find((t) => t.getAttribute('aria-label') === 'Potiony') as HTMLButtonElement;
        fireEvent.click(potionsTab);
        // Potion cards reuse `.shop__card-icon` shell.
        const cards = container.querySelectorAll('.shop__card-icon');
        expect(cards.length).toBeGreaterThan(0);
    });
});

describe('Shop — elixirs tab', () => {
    it('renders elixir cards after switching to Elixirs tab', () => {
        const { container } = renderShop();
        const elixirsTab = Array.from(container.querySelectorAll('.shop__tab'))
            .find((t) => t.getAttribute('aria-label') === 'Eliksiry') as HTMLButtonElement;
        fireEvent.click(elixirsTab);
        const cards = container.querySelectorAll('.shop__card-icon');
        expect(cards.length).toBeGreaterThan(0);
    });
});

describe('Shop — arena tab', () => {
    it('renders the Arena shop catalog cards after switching tab', () => {
        const { container } = renderShop();
        const arenaTab = Array.from(container.querySelectorAll('.shop__tab'))
            .find((t) => t.getAttribute('aria-label') === 'Arena') as HTMLButtonElement;
        fireEvent.click(arenaTab);
        // Arena shop reuses the same card class.
        const cards = container.querySelectorAll('.shop__card-icon');
        expect(cards.length).toBeGreaterThan(0);
    });
});

describe('Shop — class variants', () => {
    it('renders for a Mage character (staff + magic-book catalog)', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Mage' }) });
        const { container } = renderShop();
        expect(container.querySelector('.shop')).not.toBeNull();
        expect(container.querySelectorAll('.shop__card-icon').length).toBeGreaterThan(0);
    });

    it('renders for an Archer character (bow + quiver catalog)', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Archer' }) });
        const { container } = renderShop();
        expect(container.querySelectorAll('.shop__card-icon').length).toBeGreaterThan(0);
    });

    it('renders for a Rogue character (dual-dagger catalog)', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Rogue' }) });
        const { container } = renderShop();
        expect(container.querySelectorAll('.shop__card-icon').length).toBeGreaterThan(0);
    });
});

describe('Shop — gold delta floating overlay', () => {
    it('does NOT render the gold-delta overlay on first mount', () => {
        const { container } = renderShop();
        // Overlay only appears AFTER a buy (sets goldDelta state). Mount
        // state has goldDelta === null so no floating chip.
        expect(container.querySelector('.shop__gold-delta-floating')).toBeNull();
    });
});

// TODO: Buying flow — clicking a card's buy button calls `buyShopItem`
//       which routes through shopStore + inventoryStore. The
//       success/error toast appears via setState ladder; the toast text
//       lives inside an AnimatePresence stub. Smoke-testing the toast is
//       feasible but the heavier buy contract (generated item lands in
//       bag, gold drops, daily-cap counter increments) is covered by
//       shopStore tests + Playwright.
// TODO: Stat-comparison arrows (compareStat green/red ▲▼) require the
//       player to equip something + the catalog to contain the same slot
//       — out of scope for the smoke pass.
