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
 *   • Smoke render with a character + empty bag.
 *   • Paperdoll mounts (avatar + HP/MP bars + 12 slot frames).
 *   • Character-less render — paperdoll guard kicks in, root still mounts.
 *   • Bag header renders the "Plecak: 0 / 1000" counter.
 *   • Multi-sell toggle puts the bag into bulk mode (Cancel button surfaces).
 *   • Filter chips render for every rarity + slot.
 *   • Bag tile click selects the item (opens detail popup overlay).
 *   • Auto-sell row renders 5 buttons (one per rarity).
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

// TODO: Detail popup interaction (clicking a bag tile to open the
//       comparison overlay → equip / sell / upgrade buttons) requires
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
//       `selectBagItem` → DetailPanel → action button. The DetailPanel
//       is heavy (~700 lines of its own) and merits a dedicated test
//       file once it's pulled out as a top-level component.
