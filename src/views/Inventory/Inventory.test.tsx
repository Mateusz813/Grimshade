import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
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
        expect(container.querySelectorAll('.inventory__paperdoll-bar').length).toBe(2);
    });

    it('omits the paperdoll when character is null (root still mounts)', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderInventory();
        expect(container.querySelector('.inventory')).not.toBeNull();
        expect(container.querySelector('.inventory__paperdoll')).toBeNull();
    });

    it('renders 12 equipment slot frames inside the paperdoll', () => {
        const { container } = renderInventory();
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

    it('renders 5 auto-sell + 5 auto-disassemble rarity buttons', () => {
        const { container } = renderInventory();
        const sellRow = container.querySelector('.inventory__auto-sell:not(.inventory__auto-disassemble)');
        const disRow = container.querySelector('.inventory__auto-disassemble');
        expect(sellRow?.querySelectorAll('.inventory__auto-sell-btn').length).toBe(5);
        expect(disRow?.querySelectorAll('.inventory__auto-sell-btn').length).toBe(5);
    });

    it('toggles autoSellCommon when the first auto-sell button is clicked', () => {
        const { container } = renderInventory();
        const btn = container.querySelector('.inventory__auto-sell:not(.inventory__auto-disassemble) .inventory__auto-sell-btn') as HTMLButtonElement;
        expect(btn.className).not.toContain('inventory__auto-sell-btn--active');
        fireEvent.click(btn);
        expect(useSettingsStore.getState().autoSellCommon).toBe(true);
    });

    it('toggles autoDisassembleCommon when the first auto-disassemble button is clicked', () => {
        const { container } = renderInventory();
        const btn = container.querySelector('.inventory__auto-disassemble .inventory__auto-sell-btn') as HTMLButtonElement;
        fireEvent.click(btn);
        expect(useSettingsStore.getState().autoDisassembleCommon).toBe(true);
    });

    it('updates autoSellMaxLevel from the "do lvl" input', () => {
        const { container } = renderInventory();
        const input = container.querySelector('.inventory__auto-sell:not(.inventory__auto-disassemble) .inventory__auto-sell-maxlvl input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '80' } });
        expect(useSettingsStore.getState().autoSellMaxLevel).toBe(80);
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
        const cancel = container.querySelector('.inventory__multi-sell-toggle--active');
        expect(cancel).not.toBeNull();
        expect(cancel?.textContent).toMatch(/Anuluj/);
    });
});

describe('Inventory — filter rows', () => {
    it('renders rarity filter buttons', () => {
        const { container } = renderInventory();
        const filterBtns = container.querySelectorAll('.inventory__filter-btn');
        expect(filterBtns.length).toBeGreaterThanOrEqual(7);
    });

    it('renders the slot-filter row with slot buttons', () => {
        const { container } = renderInventory();
        const slotFilterRow = container.querySelector('.inventory__filter-row--slots');
        expect(slotFilterRow).not.toBeNull();
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
        expect(container.querySelector('.inventory__stat-alloc')).not.toBeNull();
    });
});

describe('Inventory — backend-authoritative branches', () => {
    const openFirstTileDetail = (container: HTMLElement) => {
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
            vi.advanceTimersByTime(1600);
            expect(removeSpy).toHaveBeenCalledWith('itm-c');
            expect(backendApiMock.disassemble).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('handleStartReroll: backend ON does the atomic reroll + sync, skips client bonus update', async () => {
        backendFlag.on = true;
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
        const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')
            .mockImplementation((cb: FrameRequestCallback) => { cb(performance.now() + 100000); return 0; });
        try {
            useInventoryStore.setState({ bag: [makeItem('m1'), makeItem('m2')] });
            const massSpy = vi.spyOn(useInventoryStore.getState(), 'disassembleMultiple');
            const { container } = renderInventory();
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

    const openFirstStackTile = (container: HTMLElement) => {
        const icon = container.querySelector('.inventory__bag-tile .item-icon') as HTMLElement;
        fireEvent.click(icon);
    };

    it('applyElixirDose: backend ON fires useConsumable + sync, heal visual stays client-side', async () => {
        backendFlag.on = true;
        useCharacterStore.setState({ character: makeChar({ hp: 50 }) });
        useInventoryStore.setState({ consumables: { hp_potion_sm: 5 } });
        const updateSpy = vi.spyOn(useCharacterStore.getState(), 'updateCharacter');
        const { container } = renderInventory();
        openFirstStackTile(container);
        fireEvent.click(container.querySelector('.inventory__use-potion-btn--use') as HTMLButtonElement);
        await vi.waitFor(() => expect(backendApiMock.useConsumable).toHaveBeenCalledWith('char-1', 'hp_potion_sm'));
        expect(syncFromBackendMock).toHaveBeenCalledWith('char-1');
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
        vi.stubGlobal('confirm', () => true);
        try {
            useInventoryStore.setState({ consumables: { stat_reset: 1 } });
            const updateSpy = vi.spyOn(useCharacterStore.getState(), 'updateCharacter');
            const { container } = renderInventory();
            openFirstStackTile(container);
            fireEvent.click(container.querySelector('.inventory__use-potion-btn--reset') as HTMLButtonElement);
            await vi.waitFor(() => expect(backendApiMock.statReset).toHaveBeenCalledWith('char-1', 'stat_reset'));
            expect(syncFromBackendMock).toHaveBeenCalledWith('char-1');
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
        openFirstStackTile(container);
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
        useInventoryStore.setState({ gold: 100000, consumables: { spell_chest_5: 10 } });
        useSkillStore.setState({
            activeSkillSlots: [null, null, null, null],
            skillLevels: {},
            skillUpgradeLevels: {},
            unlockedSkills: { shield_bash: true },
        });
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

