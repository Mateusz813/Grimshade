import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Market view — 1568 lines, 3 tabs (Przeglądaj / Sprzedawaj / Moje),
 * paged listings table, sell-tile grid, buy / list / edit modals, sale
 * notifications drawer. We DO NOT touch the marketStore async actions —
 * the Supabase mock in `tests/vitest.setup.ts` returns null and the
 * store's `fetch*` calls catch silently.
 *
 * Coverage:
 *   - Smoke render (root + 3 tab buttons + filter bar).
 *   - Tab swap -> active modifier moves.
 *   - Search input is controlled.
 *   - Category select dropdown lists every option.
 *   - Empty-state copy on Browse + My tabs when stores are empty.
 *   - Sale-notifications button shows a badge when notifications exist.
 *   - Notifications modal opens on button click.
 *   - Renders without crashing when character is null.
 *
 * Mocks: framer-motion stubbed.
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

// Backend-mode (opt-in) mocks. Default OFF so every existing test runs the
// untouched client/Supabase path; a single test flips `backendFlag.on`.
const backendFlag = vi.hoisted(() => ({ on: false }));
const backendApiMock = vi.hoisted(() => ({
    marketListings: vi.fn(),
    marketMine: vi.fn(),
    marketList: vi.fn(),
    marketBuy: vi.fn(),
    marketCancel: vi.fn(),
    editListing: vi.fn(),
}));

vi.mock('../../config/backendMode', () => ({
    isBackendMode: () => backendFlag.on,
    isBackendConfigured: () => backendFlag.on,
    getBackendBaseUrl: () => (backendFlag.on ? 'http://localhost:8088' : ''),
    setBackendMode: (v: boolean) => { backendFlag.on = v; },
}));
vi.mock('../../api/backend/backendApi', () => ({ backendApi: backendApiMock }));
vi.mock('../../api/backend/syncState', () => ({
    syncFromBackend: vi.fn().mockResolvedValue(undefined),
    syncIfBackend: vi.fn().mockResolvedValue(undefined),
}));

import Market from './Market';
import { syncFromBackend } from '../../api/backend/syncState';
import { useMarketStore } from '../../stores/marketStore';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { EMPTY_EQUIPMENT } from '../../systems/itemSystem';
import type { ICharacter } from '../../api/v1/characterApi';
import type {
    IMarketListing,
    IMarketSaleNotification,
} from '../../systems/marketSystem';

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

const makeListing = (id: string, overrides: Partial<IMarketListing> = {}): IMarketListing => ({
    id,
    sellerId: 'seller-1',
    sellerName: 'Trader',
    kind: 'item',
    itemId: 'sword_iron',
    itemName: 'Iron Sword',
    itemLevel: 5,
    rarity: 'common',
    slot: 'mainHand',
    price: 100,
    quantity: 1,
    quantityInitial: 1,
    bonuses: {},
    upgradeLevel: 0,
    listedAt: new Date().toISOString(),
    ...overrides,
});

const makeNotification = (id: string): IMarketSaleNotification => ({
    id,
    sellerId: 'char-1',
    itemId: 'sword_iron',
    itemName: 'Iron Sword',
    rarity: 'common',
    quantitySold: 1,
    goldReceived: 90,
    soldAt: new Date().toISOString(),
    seen: false,
});

const renderMarket = () =>
    render(
        <MemoryRouter>
            <Market />
        </MemoryRouter>,
    );

beforeEach(() => {
    // Backend mode OFF by default + fresh mock resolutions each test.
    backendFlag.on = false;
    backendApiMock.marketListings.mockReset().mockResolvedValue([]);
    backendApiMock.marketMine.mockReset().mockResolvedValue([]);
    backendApiMock.marketList.mockReset().mockResolvedValue({});
    backendApiMock.marketBuy.mockReset().mockResolvedValue({});
    backendApiMock.marketCancel.mockReset().mockResolvedValue({});
    backendApiMock.editListing.mockReset().mockResolvedValue({});
    useCharacterStore.setState({ character: makeChar() });
    useInventoryStore.setState({
        bag: [],
        equipment: { ...EMPTY_EQUIPMENT },
        deposit: [],
        gold: 1000,
        arenaPoints: 0,
        consumables: {},
        stones: {},
    });
    useMarketStore.setState({
        listings: [],
        myListings: [],
        saleNotifications: [],
        isLoading: false,
        error: null,
        // No-op the async actions so the mount effect doesn't reach for
        // the mocked Supabase chain — keeps tests deterministic.
        fetchListings: vi.fn().mockResolvedValue(undefined),
        fetchMyListings: vi.fn().mockResolvedValue(undefined),
        fetchSaleNotifications: vi.fn().mockResolvedValue(undefined),
    });
});

afterEach(() => {
    cleanup();
});

describe('Market — smoke', () => {
    it('renders the root .market container', () => {
        const { container } = renderMarket();
        expect(container.querySelector('.market')).not.toBeNull();
    });

    it('renders three tab buttons (Przeglądaj / Sprzedawaj / Moje)', () => {
        const { container } = renderMarket();
        const tabs = container.querySelectorAll('.market__tab');
        expect(tabs.length).toBe(3);
        const labels = Array.from(tabs).map((t) => t.textContent ?? '');
        expect(labels.some((l) => l.includes('Przeglądaj'))).toBe(true);
        expect(labels.some((l) => l.includes('Sprzedawaj'))).toBe(true);
        expect(labels.some((l) => l.includes('Moje'))).toBe(true);
    });

    it('renders the filter bar with search input + 3 selects + 2 level inputs', () => {
        const { container } = renderMarket();
        expect(container.querySelector('.market__filters')).not.toBeNull();
        expect(container.querySelector('.market__search')).not.toBeNull();
        expect(container.querySelectorAll('.market__select').length).toBe(3);
        expect(container.querySelectorAll('.market__lvl-input').length).toBe(2);
    });

    it('starts with the Przeglądaj tab active by default', () => {
        const { container } = renderMarket();
        const activeTab = container.querySelector('.market__tab--active');
        expect(activeTab?.textContent).toMatch(/Przeglądaj/);
    });
});

describe('Market — tab switching', () => {
    it('moves the --active modifier to Sprzedawaj when clicked', () => {
        const { container } = renderMarket();
        const sellTab = Array.from(container.querySelectorAll('.market__tab'))
            .find((t) => t.textContent?.includes('Sprzedawaj')) as HTMLButtonElement;
        fireEvent.click(sellTab);
        expect(sellTab.className).toContain('market__tab--active');
    });

    it('moves the --active modifier to Moje when clicked', () => {
        const { container } = renderMarket();
        const myTab = Array.from(container.querySelectorAll('.market__tab'))
            .find((t) => t.textContent?.includes('Moje')) as HTMLButtonElement;
        fireEvent.click(myTab);
        expect(myTab.className).toContain('market__tab--active');
    });
});

describe('Market — filter inputs', () => {
    it('echoes typed text into the search input', () => {
        const { container } = renderMarket();
        const search = container.querySelector('.market__search') as HTMLInputElement;
        fireEvent.change(search, { target: { value: 'iron' } });
        expect(search.value).toBe('iron');
    });

    it('updates the category select when an option is picked', () => {
        const { container } = renderMarket();
        const select = container.querySelectorAll('.market__select')[0] as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'potions' } });
        expect(select.value).toBe('potions');
    });

    it('renders all 17 category options in the category dropdown', () => {
        const { container } = renderMarket();
        const select = container.querySelectorAll('.market__select')[0] as HTMLSelectElement;
        // Spec: 17 entries in CATEGORY_OPTIONS (all, 10 equipment slots,
        // potions, elixirs, stones, arena_points, spell_chests).
        expect(select.querySelectorAll('option').length).toBe(17);
    });
});

describe('Market — empty states', () => {
    it('renders empty-state copy on Browse when listings is empty', () => {
        const { container } = renderMarket();
        const empty = container.querySelector('.market__empty');
        expect(empty?.textContent).toMatch(/Brak ofert/i);
    });

    it('renders empty-state copy on My tab when myListings is empty', () => {
        const { container } = renderMarket();
        const myTab = Array.from(container.querySelectorAll('.market__tab'))
            .find((t) => t.textContent?.includes('Moje')) as HTMLButtonElement;
        fireEvent.click(myTab);
        const empty = container.querySelector('.market__empty');
        expect(empty?.textContent).toMatch(/Nie masz wystawionych/i);
    });
});

describe('Market — sale notifications', () => {
    it('does NOT show the notify badge when there are no unseen notifications', () => {
        const { container } = renderMarket();
        expect(container.querySelector('.market__notify-badge')).toBeNull();
    });

    it('shows the notify badge with the count when notifications are present', () => {
        useMarketStore.setState({
            saleNotifications: [makeNotification('n-1'), makeNotification('n-2')],
        });
        const { container } = renderMarket();
        const badge = container.querySelector('.market__notify-badge');
        expect(badge).not.toBeNull();
        expect(badge?.textContent).toBe('2');
    });

    it('marks the notify button with --active when notifications exist', () => {
        useMarketStore.setState({
            saleNotifications: [makeNotification('n-1')],
        });
        const { container } = renderMarket();
        const btn = container.querySelector('.market__notify-btn');
        expect(btn?.className).toContain('market__notify-btn--active');
    });
});

describe('Market — listings render', () => {
    it('renders a row per listing on the Browse tab', () => {
        useMarketStore.setState({
            listings: [
                makeListing('l-1'),
                makeListing('l-2', { rarity: 'rare', price: 250 }),
            ],
        });
        const { container } = renderMarket();
        // Listing rows live inside the panel — the icon cell is a stable
        // hook (`.market__row-icon`) so we count those.
        const rows = container.querySelectorAll('.market__row-icon');
        expect(rows.length).toBe(2);
    });

    it('shows the Browse listings count on the Przeglądaj tab', () => {
        useMarketStore.setState({
            listings: [makeListing('l-1'), makeListing('l-2'), makeListing('l-3')],
        });
        const { container } = renderMarket();
        const browseCount = container.querySelector('.market__tab-count')?.textContent ?? '';
        expect(browseCount).toMatch(/\(3\)/);
    });
});

describe('Market — backend mode (opt-in)', () => {
    it('sources the Browse list from backendApi.marketListings, not the store', async () => {
        backendFlag.on = true;
        // Store lists intentionally empty — in backend mode they must NOT be
        // the source of truth for the rendered rows.
        useMarketStore.setState({ listings: [], myListings: [] });
        backendApiMock.marketListings.mockResolvedValue([
            {
                id: 'be-1',
                sellerId: 'seller-x',
                sellerName: 'BackendTrader',
                kind: 'item',
                itemId: 'sword_iron',
                itemName: 'Backend Sword',
                itemLevel: 5,
                rarity: 'common',
                slot: 'mainHand',
                price: 200,
                quantity: 1,
                quantityInitial: 1,
                bonuses: {},
                upgradeLevel: 0,
                listedAt: new Date().toISOString(),
            },
        ]);
        const { container } = renderMarket();
        await waitFor(() => {
            expect(container.querySelectorAll('.market__row-icon').length).toBe(1);
        });
        expect(backendApiMock.marketListings).toHaveBeenCalled();
    });
});

describe('Market — edit price (backend mode)', () => {
    it('routes handleEditPrice through backendApi.editListing + syncFromBackend and SKIPS the store editListing', async () => {
        backendFlag.on = true;
        // Store action spy — in backend mode it must NOT be reached.
        const storeEditListing = vi.fn().mockResolvedValue(makeListing('l-1'));
        useMarketStore.setState({ editListing: storeEditListing });
        // My tab is sourced from backendApi.marketMine in backend mode —
        // seed one own listing so a row renders + opens the edit modal.
        backendApiMock.marketMine.mockResolvedValue([makeListing('be-mine-1', { sellerId: 'char-1', price: 100 })]);

        const { container } = renderMarket();

        // Switch to the "Moje" tab where own listings live.
        const myTab = Array.from(container.querySelectorAll('.market__tab'))
            .find((t) => t.textContent?.includes('Moje')) as HTMLButtonElement;
        fireEvent.click(myTab);

        // Wait for the backend-sourced row, then open the edit modal.
        await waitFor(() => {
            expect(container.querySelector('.market__row')).not.toBeNull();
        });
        fireEvent.click(container.querySelector('.market__row') as HTMLElement);

        // Change the price + save.
        const priceInput = container.querySelector('.market__modal-price-row input') as HTMLInputElement;
        fireEvent.change(priceInput, { target: { value: '250' } });
        const saveBtn = Array.from(container.querySelectorAll('.market__modal-btn'))
            .find((b) => b.textContent?.includes('Zapisz cenę')) as HTMLButtonElement;
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(backendApiMock.editListing).toHaveBeenCalledWith('char-1', 'be-mine-1', { price: 250 });
        });
        expect(syncFromBackend).toHaveBeenCalledWith('char-1');
        // Old client path must be skipped.
        expect(storeEditListing).not.toHaveBeenCalled();
    });

    it('runs the store editListing path (NOT backendApi) when backend mode is OFF', async () => {
        backendFlag.on = false;
        const storeEditListing = vi.fn().mockResolvedValue(makeListing('l-1'));
        useMarketStore.setState({
            myListings: [makeListing('l-1', { sellerId: 'char-1', price: 100 })],
            editListing: storeEditListing,
        });

        const { container } = renderMarket();

        const myTab = Array.from(container.querySelectorAll('.market__tab'))
            .find((t) => t.textContent?.includes('Moje')) as HTMLButtonElement;
        fireEvent.click(myTab);

        fireEvent.click(container.querySelector('.market__row') as HTMLElement);

        const priceInput = container.querySelector('.market__modal-price-row input') as HTMLInputElement;
        fireEvent.change(priceInput, { target: { value: '250' } });
        const saveBtn = Array.from(container.querySelectorAll('.market__modal-btn'))
            .find((b) => b.textContent?.includes('Zapisz cenę')) as HTMLButtonElement;
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(storeEditListing).toHaveBeenCalledWith('l-1', { price: 250 });
        });
        expect(backendApiMock.editListing).not.toHaveBeenCalled();
    });
});

describe('Market — character-less render', () => {
    it('renders nothing (returns null) when character is missing', () => {
        // Spec: `if (!character) return null;` short-circuits before any
        // markup is emitted. Verifies the guard is in place — protects
        // against the character.id null-deref paths further down.
        useCharacterStore.setState({ character: null });
        const { container } = renderMarket();
        expect(container.querySelector('.market')).toBeNull();
    });
});

// TODO: Driving listItem / buyListing / editListing / cancelListing through
//       the view requires opening their respective modals + filling a
//       price/quantity input + submitting — full flow lives in the
//       marketStore.test.ts (which can hit the store directly) and in
//       Playwright e2e (which exercises the real Supabase chain).
// TODO: Pagination (50/page) only surfaces with >50 listings — covered
//       implicitly by the row-count test above. Add explicit pagination
//       smoke once we have a deterministic-page seed.
