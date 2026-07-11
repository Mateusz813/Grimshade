import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Inventory view — 4851 lines, the "Postać" tab. Hosts the paperdoll,
 * bag grid, rarity + slot filters, multi-sell / disassemble flow, item
 * detail popup, training popup, skills popup, auto-potion popup, stone
 * conversion, and bonus-reroll. We absolutely don't try to validate the
 * item/equip/upgrade math through the view — that's
 * `itemSystem.test.ts` + `inventoryStore.test.ts`.
 *
 * What we DO cover (smoke / render contract):
 *   - Smoke render with a character + empty bag.
 *   - Paperdoll mounts (avatar + HP/MP bars + 12 slot frames).
 *   - Character-less render — paperdoll guard kicks in, root still mounts.
 *   - Bag header renders the "Plecak: 0 / 1000" counter.
 *   - Multi-sell toggle puts the bag into bulk mode (Cancel button surfaces).
 *   - Filter chips render for every rarity + slot.
 *   - Bag tile click selects the item (opens detail popup overlay).
 *   - Auto-sell row renders 5 buttons (one per rarity).
 *
 * Mocks: framer-motion stubbed so AnimatePresence doesn't pin happy-dom.
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

// Backend-authoritative branch mocks. Default OFF so every existing
// client-path test exercises the untouched store logic; the dedicated
// backend describe flips `backendFlag.on`. Mirrors the pattern used by
// Deposit.test.tsx / Market.test.tsx.
const backendFlag = vi.hoisted(() => ({ on: false }));
const backendApiMock = vi.hoisted(() => ({
    disassemble: vi.fn(),
    disassembleMass: vi.fn(),
    reroll: vi.fn(),
    setSkillSlot: vi.fn(),
    unlockSkill: vi.fn(),
    convertStones: vi.fn(),
    useConsumable: vi.fn(),
    statReset: vi.fn(),
    convertPotions: vi.fn(),
    upgrade: vi.fn(),
    upgradeSkill: vi.fn(),
    chatSystemEvent: vi.fn(),
}));
const syncFromBackendMock = vi.hoisted(() => vi.fn());

vi.mock('../../config/backendMode', () => ({
    isBackendMode: () => backendFlag.on,
    isBackendConfigured: () => backendFlag.on,
    getBackendBaseUrl: () => (backendFlag.on ? 'http://localhost:8088' : ''),
    setBackendMode: (v: boolean) => { backendFlag.on = v; },
}));
vi.mock('../../api/backend/backendApi', () => ({ backendApi: backendApiMock }));
vi.mock('../../api/backend/syncState', () => ({
    syncFromBackend: syncFromBackendMock,
    syncIfBackend: vi.fn().mockResolvedValue(undefined),
}));

import Inventory from './Inventory';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useCharacterStore } from '../../stores/characterStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSkillStore } from '../../stores/skillStore';
import { useTransformStore } from '../../stores/transformStore';
import { useBuffStore } from '../../stores/buffStore';
import { useOfflineHuntStore } from '../../stores/offlineHuntStore';
import { useCombatStore } from '../../stores/combatStore';
import { EMPTY_EQUIPMENT, type IInventoryItem } from '../../systems/itemSystem';
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

const makeItem = (uuid: string, overrides: Partial<IInventoryItem> = {}): IInventoryItem => ({
    uuid,
    itemId: 'sword_iron',
    rarity: 'common',
    bonuses: {},
    upgradeLevel: 0,
    itemLevel: 1,
    ...overrides,
} as IInventoryItem);

const renderInventory = () =>
    render(
        <MemoryRouter>
            <Inventory />
        </MemoryRouter>,
    );

beforeEach(() => {
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
    useSettingsStore.setState({
        autoSellCommon: false,
        autoSellRare: false,
        autoSellEpic: false,
        autoSellLegendary: false,
        autoSellMythic: false,
        autoPotionHpEnabled: false,
        autoPotionMpEnabled: false,
        autoPotionPctHpEnabled: false,
        autoPotionPctMpEnabled: false,
        autoPotionHpThreshold: 50,
        autoPotionMpThreshold: 50,
        autoPotionPctHpThreshold: 50,
        autoPotionPctMpThreshold: 50,
        autoPotionHpId: 'hp_potion_sm',
        autoPotionMpId: 'mp_potion_sm',
        autoPotionPctHpId: 'hp_potion_great',
        autoPotionPctMpId: 'mp_potion_great',
    });
    useSkillStore.setState({ activeSkillSlots: [null, null, null, null], skillLevels: {} });
    useTransformStore.setState({ completedTransforms: [] });
    useBuffStore.setState({ allBuffs: [] });
    useOfflineHuntStore.setState({ isActive: false });
    useCombatStore.setState({ phase: 'idle' });
    backendFlag.on = false;
    backendApiMock.disassemble.mockReset().mockResolvedValue(undefined);
    backendApiMock.disassembleMass.mockReset().mockResolvedValue(undefined);
    backendApiMock.reroll.mockReset().mockResolvedValue(undefined);
    backendApiMock.setSkillSlot.mockReset().mockResolvedValue(undefined);
    backendApiMock.unlockSkill.mockReset().mockResolvedValue(undefined);
    backendApiMock.convertStones.mockReset().mockResolvedValue(undefined);
    backendApiMock.useConsumable.mockReset().mockResolvedValue(undefined);
    backendApiMock.statReset.mockReset().mockResolvedValue(undefined);
    backendApiMock.convertPotions.mockReset().mockResolvedValue(undefined);
    backendApiMock.upgrade.mockReset().mockResolvedValue(undefined);
    backendApiMock.upgradeSkill.mockReset().mockResolvedValue(undefined);
    backendApiMock.chatSystemEvent.mockReset().mockResolvedValue(undefined);
    syncFromBackendMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
    cleanup();
});

describe('Inventory — smoke', () => {
    it('renders the root .inventory container', () => {
        const { container } = renderInventory();
        expect(container.querySelector('.inventory')).not.toBeNull();
    });

    it('mounts the paperdoll when a character is loaded', () => {
        const { container } = renderInventory();
        expect(container.querySelector('.inventory__paperdoll')).not.toBeNull();
        // HP + MP bars
        expect(container.querySelectorAll('.inventory__paperdoll-bar').length).toBe(2);
    });

    it('omits the paperdoll when character is null (root still mounts)', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderInventory();
        expect(container.querySelector('.inventory')).not.toBeNull();
        // The `{character && (...)}` guard short-circuits — no paperdoll.
        expect(container.querySelector('.inventory__paperdoll')).toBeNull();
    });

    it('renders 12 equipment slot frames inside the paperdoll', () => {
        const { container } = renderInventory();
        // Spec: 12 slots (helmet, armor, pants, gloves, shoulders, boots,
        // mainHand, offHand, ring1, ring2, earrings, necklace).
        const slots = container.querySelectorAll('.inventory__doll-slot');
        expect(slots.length).toBe(12);
    });
});

describe('Inventory — bag chrome', () => {
    it('renders the bag header with "Plecak: 0 / 1000" when empty', () => {
        const { container } = renderInventory();
        const counter = container.querySelector('.inventory__bag-count')?.textContent ?? '';
        expect(counter).toMatch(/Plecak:\s*0\s*\/\s*1000/);
    });

    it('updates the bag counter when items are seeded', () => {
        useInventoryStore.setState({
            bag: [makeItem('a'), makeItem('b'), makeItem('c')],
        });
        const { container } = renderInventory();
        const counter = container.querySelector('.inventory__bag-count')?.textContent ?? '';
        expect(counter).toMatch(/3\s*\/\s*1000/);
    });

    it('renders 5 auto-sell rarity buttons (Zwykle/Rzadkie/Epickie/Legendarne/Mityczne)', () => {
        const { container } = renderInventory();
        const autoSellBtns = container.querySelectorAll('.inventory__auto-sell-btn');
        expect(autoSellBtns.length).toBe(5);
    });

    it('toggles autoSellCommon when its button is clicked', () => {
        const { container } = renderInventory();
        const btn = container.querySelector('.inventory__auto-sell-btn') as HTMLButtonElement;
        // Default off.
        expect(btn.className).not.toContain('inventory__auto-sell-btn--active');
        fireEvent.click(btn);
        // Settings store flipped.
        expect(useSettingsStore.getState().autoSellCommon).toBe(true);
    });
});

describe('Inventory — multi-sell / disassemble bulk mode', () => {
    it('shows "Sprzedaj" + "Rozloz" toggles when not in bulk mode', () => {
        const { container } = renderInventory();
        const toggles = Array.from(container.querySelectorAll('.inventory__multi-sell-toggle'))
            .map((b) => b.textContent ?? '');
        expect(toggles.some((t) => t.includes('Sprzedaj'))).toBe(true);
        expect(toggles.some((t) => t.includes('Rozloz'))).toBe(true);
    });

    it('switches to "Anuluj" mode when the Sprzedaj toggle is clicked', () => {
        const { container } = renderInventory();
        const sellBtn = Array.from(container.querySelectorAll('.inventory__multi-sell-toggle'))
            .find((b) => b.textContent?.includes('Sprzedaj')) as HTMLButtonElement;
        fireEvent.click(sellBtn);
        // After click, the Cancel button surfaces and the two toggles disappear.
        const cancel = container.querySelector('.inventory__multi-sell-toggle--active');
        expect(cancel).not.toBeNull();
        expect(cancel?.textContent).toMatch(/Anuluj/);
    });
});

describe('Inventory — filter rows', () => {
    it('renders rarity filter buttons', () => {
        const { container } = renderInventory();
        // Spec: filter row exists with at least the 7 rarity-class chips
        // (all + 6 rarities). Some configurations also add stack-kind
        // filters — we accept >=7.
        const filterBtns = container.querySelectorAll('.inventory__filter-btn');
        expect(filterBtns.length).toBeGreaterThanOrEqual(7);
    });

    it('renders the slot-filter row with slot buttons', () => {
        const { container } = renderInventory();
        const slotFilterRow = container.querySelector('.inventory__filter-row--slots');
        expect(slotFilterRow).not.toBeNull();
        // At least the "all" / weapons / armor / jewelry meta-buttons + slot buttons.
        const slotBtns = slotFilterRow!.querySelectorAll('.inventory__filter-btn--slot');
        expect(slotBtns.length).toBeGreaterThan(3);
    });
});

describe('Inventory — bag tiles render', () => {
    it('renders one bag tile per item in the bag', () => {
        useInventoryStore.setState({
            bag: [
                makeItem('a'),
                makeItem('b', { rarity: 'rare' }),
                makeItem('c', { rarity: 'epic' }),
            ],
        });
        const { container } = renderInventory();
        // Pagination caps at 50 per page but 3 items fit on page 1.
        const tiles = container.querySelectorAll('.inventory__bag-tile');
        expect(tiles.length).toBe(3);
    });

    it('renders nothing in the bag grid when empty (no tiles)', () => {
        const { container } = renderInventory();
        const tiles = container.querySelectorAll('.inventory__bag-tile');
        expect(tiles.length).toBe(0);
    });
});

describe('Inventory — class variants', () => {
    it('mounts for a Mage character', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Mage' }) });
        const { container } = renderInventory();
        expect(container.querySelector('.inventory')).not.toBeNull();
        expect(container.querySelector('.inventory__paperdoll')).not.toBeNull();
    });

    it('mounts for a Rogue character (dual-dagger offhand path)', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Rogue' }) });
        const { container } = renderInventory();
        expect(container.querySelector('.inventory')).not.toBeNull();
    });

    it('mounts for a Necromancer character', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Necromancer' }) });
        const { container } = renderInventory();
        expect(container.querySelector('.inventory')).not.toBeNull();
    });
});

describe('Inventory — edge cases', () => {
    it('renders without crashing when bag has heroic-rarity items', () => {
        useInventoryStore.setState({
            bag: [makeItem('hero-1', { rarity: 'heroic' })],
        });
        const { container } = renderInventory();
        expect(container.querySelector('.inventory__bag-tile')).not.toBeNull();
    });

    it('renders without crashing when character has 0 HP / 0 MP', () => {
        useCharacterStore.setState({ character: makeChar({ hp: 0, mp: 0 }) });
        const { container } = renderInventory();
        expect(container.querySelector('.inventory__paperdoll')).not.toBeNull();
    });

    it('renders without crashing when character has stat_points to spend', () => {
        useCharacterStore.setState({ character: makeChar({ stat_points: 5 }) });
        const { container } = renderInventory();
        // Stat allocation grid surfaces when stat_points > 0.
        expect(container.querySelector('.inventory__stat-alloc')).not.toBeNull();
    });
});

describe('Inventory — backend-authoritative branches', () => {
    // Open the DetailPanel for the first bag tile (bulkMode === 'none' ->
    // selectBagItem sets `selected`, which mounts the detail overlay).
    const openFirstTileDetail = (container: HTMLElement) => {
        // Stackable tiles (potions / chests / stones) reuse `.inventory__bag-tile`
        // and render BEFORE gear, so target a GEAR tile specifically — only gear
        // tiles carry a `.inventory__bag-tile-level` span. The click handler lives
        // on the ItemIcon (`.item-icon`) inside the tile.
        const gearTile = Array.from(container.querySelectorAll('.inventory__bag-tile'))
            .find((t) => t.querySelector('.inventory__bag-tile-level')) as HTMLElement;
        const icon = gearTile.querySelector('.item-icon') as HTMLElement;
        fireEvent.click(icon);
    };

    it('handleDisassemble: backend ON calls backendApi.disassemble + sync, skips removeItem', async () => {
        backendFlag.on = true;
        useInventoryStore.setState({ bag: [makeItem('itm-d')] });
        const removeSpy = vi.spyOn(useInventoryStore.getState(), 'removeItem');
        const { container } = renderInventory();
        openFirstTileDetail(container);
        const btn = container.querySelector('.inventory__action-btn--disassemble') as HTMLButtonElement;
        fireEvent.click(btn);
        await vi.waitFor(() => expect(backendApiMock.disassemble).toHaveBeenCalledWith('char-1', 'itm-d'));
        expect(syncFromBackendMock).toHaveBeenCalledWith('char-1');
        expect(removeSpy).not.toHaveBeenCalled();
    });

    it('handleDisassemble: backend OFF runs the client path (removeItem) and skips backend', () => {
        vi.useFakeTimers();
        try {
            backendFlag.on = false;
            useInventoryStore.setState({ bag: [makeItem('itm-c')] });
            const removeSpy = vi.spyOn(useInventoryStore.getState(), 'removeItem');
            const { container } = renderInventory();
            openFirstTileDetail(container);
            const btn = container.querySelector('.inventory__action-btn--disassemble') as HTMLButtonElement;
            fireEvent.click(btn);
            // Client path resolves the result after a 1.5s progress animation.
            vi.advanceTimersByTime(1600);
            expect(removeSpy).toHaveBeenCalledWith('itm-c');
            expect(backendApiMock.disassemble).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('handleStartReroll: backend ON does the atomic reroll + sync, skips client bonus update', async () => {
        backendFlag.on = true;
        // Reroll needs a slotted, non-common item + >= 2 rarity stones.
        useInventoryStore.setState({
            bag: [makeItem('itm-r', { itemId: 'sword_of_beginnings', rarity: 'rare' })],
            stones: { rare_stone: 5 },
        });
        const updateSpy = vi.spyOn(useInventoryStore.getState(), 'updateItemBonuses');
        const useStonesSpy = vi.spyOn(useInventoryStore.getState(), 'useStones');
        const { container } = renderInventory();
        openFirstTileDetail(container);
        const btn = container.querySelector('.inventory__action-btn--reroll') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
        fireEvent.click(btn);
        await vi.waitFor(() => expect(backendApiMock.reroll).toHaveBeenCalledWith('char-1', 'itm-r'));
        expect(syncFromBackendMock).toHaveBeenCalledWith('char-1');
        // Atomic backend reroll skips the client preview -> no client stone
        // spend and no client bonus mutation.
        expect(useStonesSpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('handleStartReroll: backend OFF runs the client preview flow (spends stones)', () => {
        backendFlag.on = false;
        useInventoryStore.setState({
            bag: [makeItem('itm-r2', { itemId: 'sword_of_beginnings', rarity: 'rare' })],
            stones: { rare_stone: 5 },
        });
        const useStonesSpy = vi.spyOn(useInventoryStore.getState(), 'useStones');
        const { container } = renderInventory();
        openFirstTileDetail(container);
        const btn = container.querySelector('.inventory__action-btn--reroll') as HTMLButtonElement;
        fireEvent.click(btn);
        expect(useStonesSpy).toHaveBeenCalledWith('rare_stone', 2);
        expect(backendApiMock.reroll).not.toHaveBeenCalled();
    });

    it('handleMassDisassemble: backend ON calls backendApi.disassembleMass + sync, skips client disassembleMultiple', async () => {
        backendFlag.on = true;
        // rAF drives the ~1.2s progress bar; stub it to fire one tick with a
        // timestamp far past the animation window so the commit runs at once.
        const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')
            .mockImplementation((cb: FrameRequestCallback) => { cb(performance.now() + 100000); return 0; });
        try {
            useInventoryStore.setState({ bag: [makeItem('m1'), makeItem('m2')] });
            const massSpy = vi.spyOn(useInventoryStore.getState(), 'disassembleMultiple');
            const { container } = renderInventory();
            // Enter bulk-disassemble mode, then select both tiles.
            fireEvent.click(container.querySelector('.inventory__multi-sell-toggle--disassemble') as HTMLButtonElement);
            container.querySelectorAll('.inventory__bag-tile .item-icon').forEach((t) => fireEvent.click(t));
            fireEvent.click(container.querySelector('.inventory__mass-disassemble-btn') as HTMLButtonElement);
            await vi.waitFor(() => expect(backendApiMock.disassembleMass).toHaveBeenCalledTimes(1));
            expect(backendApiMock.disassembleMass).toHaveBeenCalledWith('char-1', expect.arrayContaining(['m1', 'm2']));
            expect(syncFromBackendMock).toHaveBeenCalledWith('char-1');
            expect(massSpy).not.toHaveBeenCalled();
        } finally {
            rafSpy.mockRestore();
        }
    });

    it('handleMassDisassemble: backend OFF runs the client disassembleMultiple path', async () => {
        backendFlag.on = false;
        const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')
            .mockImplementation((cb: FrameRequestCallback) => { cb(performance.now() + 100000); return 0; });
        try {
            useInventoryStore.setState({ bag: [makeItem('n1'), makeItem('n2')] });
            const massSpy = vi.spyOn(useInventoryStore.getState(), 'disassembleMultiple');
            const { container } = renderInventory();
            fireEvent.click(container.querySelector('.inventory__multi-sell-toggle--disassemble') as HTMLButtonElement);
            container.querySelectorAll('.inventory__bag-tile .item-icon').forEach((t) => fireEvent.click(t));
            fireEvent.click(container.querySelector('.inventory__mass-disassemble-btn') as HTMLButtonElement);
            await vi.waitFor(() => expect(massSpy).toHaveBeenCalledTimes(1));
            expect(backendApiMock.disassembleMass).not.toHaveBeenCalled();
        } finally {
            rafSpy.mockRestore();
        }
    });

    // Owned potions / elixirs surface as `.inventory__bag-tile` stack tiles
    // in the bag grid; clicking one opens the per-potion "use" popup.
    const openFirstStackTile = (container: HTMLElement) => {
        const icon = container.querySelector('.inventory__bag-tile .item-icon') as HTMLElement;
        fireEvent.click(icon);
    };

    it('applyElixirDose: backend ON fires useConsumable + sync, heal visual stays client-side', async () => {
        backendFlag.on = true;
        useCharacterStore.setState({ character: makeChar({ hp: 50 }) }); // not full -> heal runs
        useInventoryStore.setState({ consumables: { hp_potion_sm: 5 } });
        const updateSpy = vi.spyOn(useCharacterStore.getState(), 'updateCharacter');
        const { container } = renderInventory();
        openFirstStackTile(container);
        fireEvent.click(container.querySelector('.inventory__use-potion-btn--use') as HTMLButtonElement);
        await vi.waitFor(() => expect(backendApiMock.useConsumable).toHaveBeenCalledWith('char-1', 'hp_potion_sm'));
        expect(syncFromBackendMock).toHaveBeenCalledWith('char-1');
        // Buff/heal visual is intentionally kept client-side.
        expect(updateSpy).toHaveBeenCalled();
    });

    it('applyElixirDose: backend OFF runs the client heal only (no backend call)', () => {
        backendFlag.on = false;
        useCharacterStore.setState({ character: makeChar({ hp: 50 }) });
        useInventoryStore.setState({ consumables: { hp_potion_sm: 5 } });
        const updateSpy = vi.spyOn(useCharacterStore.getState(), 'updateCharacter');
        const { container } = renderInventory();
        openFirstStackTile(container);
        fireEvent.click(container.querySelector('.inventory__use-potion-btn--use') as HTMLButtonElement);
        expect(updateSpy).toHaveBeenCalled();
        expect(backendApiMock.useConsumable).not.toHaveBeenCalled();
    });

    it('applyElixirDose (stat_reset): backend ON fires statReset + sync, skips client stat mutation', async () => {
        backendFlag.on = true;
        vi.stubGlobal('confirm', () => true); // stat_reset tile guards with window.confirm
        try {
            useInventoryStore.setState({ consumables: { stat_reset: 1 } });
            const updateSpy = vi.spyOn(useCharacterStore.getState(), 'updateCharacter');
            const { container } = renderInventory();
            openFirstStackTile(container);
            fireEvent.click(container.querySelector('.inventory__use-potion-btn--reset') as HTMLButtonElement);
            await vi.waitFor(() => expect(backendApiMock.statReset).toHaveBeenCalledWith('char-1', 'stat_reset'));
            expect(syncFromBackendMock).toHaveBeenCalledWith('char-1');
            // stat_reset delegates fully to the server -> no client stat recompute.
            expect(updateSpy).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('handleStoneConvert: backend ON fires convertStones + sync, skips client convertStones', async () => {
        backendFlag.on = true;
        useInventoryStore.setState({ stones: { rare_stone: 100 }, gold: 5000 });
        const convertSpy = vi.spyOn(useInventoryStore.getState(), 'convertStones');
        const { container } = renderInventory();
        openFirstStackTile(container); // stone stack tile -> stone popup
        fireEvent.click(container.querySelector('.inventory__stone-popup-btn') as HTMLButtonElement);
        await vi.waitFor(() => expect(backendApiMock.convertStones).toHaveBeenCalledWith('char-1', 'rare_stone'));
        expect(syncFromBackendMock).toHaveBeenCalledWith('char-1');
        expect(convertSpy).not.toHaveBeenCalled();
    });

    it('handleStoneConvert: backend OFF runs the client convertStones path', () => {
        backendFlag.on = false;
        useInventoryStore.setState({ stones: { rare_stone: 100 }, gold: 5000 });
        const convertSpy = vi.spyOn(useInventoryStore.getState(), 'convertStones');
        const { container } = renderInventory();
        openFirstStackTile(container);
        fireEvent.click(container.querySelector('.inventory__stone-popup-btn') as HTMLButtonElement);
        expect(convertSpy).toHaveBeenCalledWith('rare_stone');
        expect(backendApiMock.convertStones).not.toHaveBeenCalled();
    });

    it('handleEnhance (item upgrade): backend ON success fires backendApi.chatSystemEvent (upgrade payload)', async () => {
        backendFlag.on = true;
        useInventoryStore.setState({
            bag: [makeItem('itm-up', { itemId: 'sword_of_beginnings', rarity: 'common', upgradeLevel: 0 })],
            stones: { common_stone: 10 },
            gold: 100000,
        });
        // Simulate the server bumping the item's level so readItemUpgradeLevel
        // reports success after the (mocked) sync.
        syncFromBackendMock.mockImplementation(async () => {
            useInventoryStore.setState((s) => ({
                bag: s.bag.map((i) => (i.uuid === 'itm-up' ? { ...i, upgradeLevel: 1 } : i)),
            }));
        });
        const { container } = renderInventory();
        openFirstTileDetail(container);
        const btn = container.querySelector('.inventory__action-btn--enhance') as HTMLButtonElement;
        expect(btn).not.toBeNull();
        fireEvent.click(btn);
        await vi.waitFor(() => expect(backendApiMock.upgrade).toHaveBeenCalledWith('char-1', 'itm-up'));
        await vi.waitFor(() => expect(backendApiMock.chatSystemEvent).toHaveBeenCalledWith('char-1', {
            type: 'upgrade',
            itemId: 'sword_of_beginnings',
            rarity: 'common',
            upgradeLevel: 1,
            itemName: expect.any(String),
        }));
        expect(syncFromBackendMock).toHaveBeenCalledWith('char-1');
    });

    it('handleEnhance (item upgrade): backend OFF does NOT call backendApi.chatSystemEvent', async () => {
        vi.useFakeTimers();
        try {
            backendFlag.on = false;
            useInventoryStore.setState({
                bag: [makeItem('itm-up2', { itemId: 'sword_of_beginnings', rarity: 'common', upgradeLevel: 0 })],
                stones: { common_stone: 10 },
                gold: 100000,
            });
            const { container } = renderInventory();
            openFirstTileDetail(container);
            const btn = container.querySelector('.inventory__action-btn--enhance') as HTMLButtonElement;
            fireEvent.click(btn);
            vi.advanceTimersByTime(2000);
            expect(backendApiMock.upgrade).not.toHaveBeenCalled();
            expect(backendApiMock.chatSystemEvent).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('confirmUpgrade (skill upgrade): backend ON success fires backendApi.chatSystemEvent (skillUpgrade payload)', async () => {
        backendFlag.on = true;
        // shield_bash: Knight, unlockLevel 5 (char is level 5) — purchased so the
        // upgrade button surfaces. Give resources so the confirm button enables.
        useInventoryStore.setState({ gold: 100000, consumables: { spell_chest_5: 10 } });
        useSkillStore.setState({
            activeSkillSlots: [null, null, null, null],
            skillLevels: {},
            skillUpgradeLevels: {},
            unlockedSkills: { shield_bash: true },
        });
        // Server bumps the skill level so ok = newLevel > prevLevel.
        syncFromBackendMock.mockImplementation(async () => {
            useSkillStore.setState({ skillUpgradeLevels: { shield_bash: 1 } });
        });
        const { container } = renderInventory();
        fireEvent.click(container.querySelector('[aria-label="Aktywne skille"]') as HTMLButtonElement);
        const upgradeBtn = container.querySelector('.inventory__skills-card-btn--upgrade') as HTMLButtonElement;
        expect(upgradeBtn).not.toBeNull();
        fireEvent.click(upgradeBtn);
        const confirm = container.querySelector('.inventory__skills-swap-confirm') as HTMLButtonElement;
        expect(confirm.disabled).toBe(false);
        fireEvent.click(confirm);
        await vi.waitFor(() => expect(backendApiMock.upgradeSkill).toHaveBeenCalledWith('char-1', 'shield_bash'));
        await vi.waitFor(() => expect(backendApiMock.chatSystemEvent).toHaveBeenCalledWith('char-1', {
            type: 'skillUpgrade',
            skillId: 'shield_bash',
            skillName: 'Uderzenie Tarczą',
            upgradeLevel: 1,
        }));
        expect(syncFromBackendMock).toHaveBeenCalledWith('char-1');
    });

    it('confirmUpgrade (skill upgrade): backend OFF does NOT call backendApi.chatSystemEvent', () => {
        vi.useFakeTimers();
        try {
            backendFlag.on = false;
            useInventoryStore.setState({ gold: 100000, consumables: { spell_chest_5: 10 } });
            useSkillStore.setState({
                activeSkillSlots: [null, null, null, null],
                skillLevels: {},
                skillUpgradeLevels: {},
                unlockedSkills: { shield_bash: true },
            });
            const { container } = renderInventory();
            fireEvent.click(container.querySelector('[aria-label="Aktywne skille"]') as HTMLButtonElement);
            fireEvent.click(container.querySelector('.inventory__skills-card-btn--upgrade') as HTMLButtonElement);
            fireEvent.click(container.querySelector('.inventory__skills-swap-confirm') as HTMLButtonElement);
            vi.advanceTimersByTime(2000);
            expect(backendApiMock.upgradeSkill).not.toHaveBeenCalled();
            expect(backendApiMock.chatSystemEvent).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});

// TODO: Detail popup interaction (clicking a bag tile to open the
//       comparison overlay -> equip / sell / upgrade buttons) requires
//       wiring a known itemId from `data/items.json` so the comparison
//       column can resolve a base item. Skipped here — that depth is
//       carried by Playwright in tests/e2e/inventory/ once authored.
// TODO: Training popup, skills popup, auto-potion popup, stone-convert
//       popup, bonus-reroll preview — all dispatch through
//       `setPopupKey('avatar' | 'stats' | 'training' | 'potion' | 'skills')`.
//       Smoke-mounting them is straightforward but the popup bodies
//       depend on `data/skills.json` + sprite assets that aren't worth
//       seeding for a render check. Add per-popup smoke tests when the
//       popup bodies become refactored components.
// TODO: Sell click + upgrade click flows are routed through
//       `selectBagItem` -> DetailPanel -> action button. The DetailPanel
//       is heavy (~700 lines of its own) and merits a dedicated test
//       file once it's pulled out as a top-level component.
