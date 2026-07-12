import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';


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

vi.mock('../../config/backendMode', async () => {
    const actual = await vi.importActual<typeof import('../../config/backendMode')>('../../config/backendMode');
    return { ...actual, isBackendMode: vi.fn(() => false) };
});
vi.mock('../../api/backend/syncState', async () => {
    const actual = await vi.importActual<typeof import('../../api/backend/syncState')>('../../api/backend/syncState');
    return { ...actual, syncFromBackend: vi.fn(async () => {}) };
});

import Shop from './Shop';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { EMPTY_EQUIPMENT } from '../../systems/itemSystem';
import type { ICharacter } from '../../api/v1/characterApi';
import { isBackendMode } from '../../config/backendMode';
import { backendApi } from '../../api/backend/backendApi';
import { syncFromBackend } from '../../api/backend/syncState';

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
        expect(container.querySelector('.shop__gold-delta-floating')).toBeNull();
    });
});

describe('Shop — backend mode (opt-in)', () => {
    beforeEach(() => {
        vi.mocked(isBackendMode).mockReturnValue(false);
        vi.mocked(syncFromBackend).mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('routes an elixir purchase through backendApi.buyElixir + syncFromBackend when backend mode is ON', async () => {
        vi.mocked(isBackendMode).mockReturnValue(true);
        const buySpy = vi.spyOn(backendApi, 'buyElixir').mockResolvedValue({});

        const { container } = renderShop();
        const elixirsTab = Array.from(container.querySelectorAll('.shop__tab'))
            .find((t) => t.getAttribute('aria-label') === 'Eliksiry') as HTMLButtonElement;
        fireEvent.click(elixirsTab);

        const buyBtn = container.querySelector('.shop__buy-btn:not([disabled])') as HTMLButtonElement;
        expect(buyBtn).not.toBeNull();
        fireEvent.click(buyBtn);

        await waitFor(() => expect(buySpy).toHaveBeenCalledTimes(1));
        expect(buySpy).toHaveBeenCalledWith('char-1', expect.any(String), 1);
        await waitFor(() => expect(syncFromBackend).toHaveBeenCalledWith('char-1'));
    });

    it('keeps the default client path untouched when backend mode is OFF', () => {
        const buySpy = vi.spyOn(backendApi, 'buyElixir');

        const { container } = renderShop();
        const elixirsTab = Array.from(container.querySelectorAll('.shop__tab'))
            .find((t) => t.getAttribute('aria-label') === 'Eliksiry') as HTMLButtonElement;
        fireEvent.click(elixirsTab);

        const buyBtn = container.querySelector('.shop__buy-btn:not([disabled])') as HTMLButtonElement;
        fireEvent.click(buyBtn);

        expect(buySpy).not.toHaveBeenCalled();
        expect(syncFromBackend).not.toHaveBeenCalled();
    });

    it('routes an items-tab purchase through backendApi.buyShopItem + syncFromBackend when backend mode is ON', async () => {
        vi.mocked(isBackendMode).mockReturnValue(true);
        const buySpy = vi.spyOn(backendApi, 'buyShopItem').mockResolvedValue({});

        const { container } = renderShop();
        const buyBtn = container.querySelector('.shop__buy-btn:not([disabled])') as HTMLButtonElement;
        expect(buyBtn).not.toBeNull();
        fireEvent.click(buyBtn);

        await waitFor(() => expect(buySpy).toHaveBeenCalledTimes(1));
        expect(buySpy).toHaveBeenCalledWith('char-1', expect.any(String));
        await waitFor(() => expect(syncFromBackend).toHaveBeenCalledWith('char-1'));
    });

    it('keeps the default client path for items-tab buys when backend mode is OFF', () => {
        const buySpy = vi.spyOn(backendApi, 'buyShopItem');

        const { container } = renderShop();
        const buyBtn = container.querySelector('.shop__buy-btn:not([disabled])') as HTMLButtonElement;
        fireEvent.click(buyBtn);

        expect(buySpy).not.toHaveBeenCalled();
        expect(syncFromBackend).not.toHaveBeenCalled();
    });

    it('routes an arena-tab purchase through backendApi.buyArenaItem + syncFromBackend when backend mode is ON', async () => {
        vi.mocked(isBackendMode).mockReturnValue(true);
        const buySpy = vi.spyOn(backendApi, 'buyArenaItem').mockResolvedValue({});

        const { container } = renderShop();
        const arenaTab = Array.from(container.querySelectorAll('.shop__tab'))
            .find((t) => t.getAttribute('aria-label') === 'Arena') as HTMLButtonElement;
        fireEvent.click(arenaTab);

        const buyBtn = container.querySelector('.shop__buy-btn:not([disabled])') as HTMLButtonElement;
        expect(buyBtn).not.toBeNull();
        fireEvent.click(buyBtn);

        await waitFor(() => expect(buySpy).toHaveBeenCalledTimes(1));
        expect(buySpy).toHaveBeenCalledWith('char-1', expect.any(String));
        await waitFor(() => expect(syncFromBackend).toHaveBeenCalledWith('char-1'));
    });

    it('keeps the default client path for arena-tab buys when backend mode is OFF', () => {
        const buySpy = vi.spyOn(backendApi, 'buyArenaItem');

        const { container } = renderShop();
        const arenaTab = Array.from(container.querySelectorAll('.shop__tab'))
            .find((t) => t.getAttribute('aria-label') === 'Arena') as HTMLButtonElement;
        fireEvent.click(arenaTab);

        const buyBtn = container.querySelector('.shop__buy-btn:not([disabled])') as HTMLButtonElement;
        fireEvent.click(buyBtn);

        expect(buySpy).not.toHaveBeenCalled();
        expect(syncFromBackend).not.toHaveBeenCalled();
    });
});

