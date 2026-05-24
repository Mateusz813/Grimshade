import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ICharacter } from './characterStore';
import type { IShopItem } from './shopStore';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
// shopStore.buyShopItem / buyElixir call into a number of game systems
// (inventoryStore, itemGenerator). Mock each so tests focus on the
// store's own gold / daily-cap / refund logic without depending on real
// item drops, item bag size, etc.

const {
    spendGoldMock,
    addGoldMock,
    addConsumableMock,
    addItemMock,
    restoreItemMock,
    spendArenaPointsMock,
    addArenaPointsMock,
    addStonesMock,
    generateWeaponMock,
    generateOffhandMock,
    generateArmorMock,
    generateAccessoryMock,
    invState,
} = vi.hoisted(() => {
    const invState = {
        gold: 0,
        arenaPoints: 0,
    };
    return {
        invState,
        spendGoldMock: vi.fn((amount: number) => {
            if (invState.gold < amount) return false;
            invState.gold -= amount;
            return true;
        }),
        addGoldMock: vi.fn((amount: number) => {
            invState.gold += amount;
        }),
        addConsumableMock: vi.fn(),
        addItemMock: vi.fn(() => true),
        restoreItemMock: vi.fn(() => true),
        spendArenaPointsMock: vi.fn((amount: number) => {
            if (invState.arenaPoints < amount) return false;
            invState.arenaPoints -= amount;
            return true;
        }),
        addArenaPointsMock: vi.fn((amount: number) => {
            invState.arenaPoints += amount;
        }),
        addStonesMock: vi.fn(),
        generateWeaponMock: vi.fn(),
        generateOffhandMock: vi.fn(),
        generateArmorMock: vi.fn(),
        generateAccessoryMock: vi.fn(),
    };
});

vi.mock('./inventoryStore', () => ({
    useInventoryStore: {
        getState: () => ({
            spendGold: spendGoldMock,
            addGold: addGoldMock,
            addConsumable: addConsumableMock,
            addItem: addItemMock,
            restoreItem: restoreItemMock,
            spendArenaPoints: spendArenaPointsMock,
            addArenaPoints: addArenaPointsMock,
            addStones: addStonesMock,
        }),
    },
}));

vi.mock('../systems/itemGenerator', () => ({
    generateWeapon: generateWeaponMock,
    generateOffhand: generateOffhandMock,
    generateArmor: generateArmorMock,
    generateAccessory: generateAccessoryMock,
}));

// Lock today's date helper so daily-cap tests can predict the dayKey.
vi.mock('../systems/dailyQuestSystem', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../systems/dailyQuestSystem');
    return {
        ...actual,
        getTodayKey: vi.fn(() => '2026-05-21'),
    };
});

import { useShopStore, ELIXIRS, type IElixir, generateShopItems, buyArenaItem } from './shopStore';
import { getTodayKey } from '../systems/dailyQuestSystem';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeCharacter = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Tester',
    class: 'Knight',
    level: 10,
    xp: 0,
    hp: 100,
    max_hp: 100,
    mp: 30,
    max_mp: 30,
    attack: 10,
    defense: 5,
    attack_speed: 2.0,
    crit_chance: 3,
    crit_damage: 150,
    magic_level: 0,
    hp_regen: 0,
    mp_regen: 0,
    gold: 0,
    stat_points: 0,
    highest_level: 10,
    equipment: {},
    created_at: '',
    updated_at: '',
    ...overrides,
} as ICharacter);

const makeShopItem = (overrides: Partial<IShopItem> = {}): IShopItem => ({
    id: 'shop_sword_1_common',
    name_pl: 'Miecz',
    name_en: 'Sword',
    icon: '⚔️',
    slot: 'mainHand',
    type: 'sword',
    rarity: 'common',
    level: 1,
    baseAtk: 5,
    baseDef: 0,
    price: 100,
    templateType: 'weapon',
    previewBonuses: { dmg_min: 4, dmg_max: 6 },
    ...overrides,
});

const findElixir = (id: string): IElixir => {
    const e = ELIXIRS.find((x) => x.id === id);
    if (!e) throw new Error(`Fixture: elixir ${id} not in catalogue`);
    return e;
};

beforeEach(() => {
    // Reset all mocks + their internal state.
    invState.gold = 0;
    invState.arenaPoints = 0;
    spendGoldMock.mockClear();
    addGoldMock.mockClear();
    addConsumableMock.mockClear();
    addItemMock.mockClear().mockReturnValue(true);
    restoreItemMock.mockClear().mockReturnValue(true);
    spendArenaPointsMock.mockClear();
    addArenaPointsMock.mockClear();
    addStonesMock.mockClear();
    generateWeaponMock.mockClear().mockReturnValue({ uuid: 'gen-1', itemId: 'sword', rarity: 'common', bonuses: {}, itemLevel: 1, upgradeLevel: 0 });
    generateOffhandMock.mockClear().mockReturnValue({ uuid: 'gen-2', itemId: 'shield', rarity: 'common', bonuses: {}, itemLevel: 1, upgradeLevel: 0 });
    generateArmorMock.mockClear().mockReturnValue({ uuid: 'gen-3', itemId: 'armor', rarity: 'common', bonuses: {}, itemLevel: 1, upgradeLevel: 0 });
    generateAccessoryMock.mockClear().mockReturnValue({ uuid: 'gen-4', itemId: 'ring', rarity: 'common', bonuses: {}, itemLevel: 1, upgradeLevel: 0 });

    // Reset shop store state.
    useShopStore.setState({
        lastNotification: null,
        dayKey: getTodayKey(),
        dailyPurchases: {},
    });
});

// ── Initial state ───────────────────────────────────────────────────────────

describe('shopStore — initial state', () => {
    it('has no last notification', () => {
        expect(useShopStore.getState().lastNotification).toBeNull();
    });

    it('initialises daily-purchase counter to today', () => {
        expect(useShopStore.getState().dayKey).toBe(getTodayKey());
        expect(useShopStore.getState().dailyPurchases).toEqual({});
    });
});

// ── clearNotification ───────────────────────────────────────────────────────

describe('clearNotification', () => {
    it('clears any pending lastNotification', () => {
        useShopStore.setState({ lastNotification: 'hi' });
        useShopStore.getState().clearNotification();
        expect(useShopStore.getState().lastNotification).toBeNull();
    });
});

// ── getDailyPurchased ───────────────────────────────────────────────────────

describe('getDailyPurchased', () => {
    it('returns 0 for an unused capped id today', () => {
        expect(useShopStore.getState().getDailyPurchased('dungeon_reset')).toBe(0);
    });

    it('returns the recorded count when within today', () => {
        useShopStore.setState({
            dayKey: getTodayKey(),
            dailyPurchases: { dungeon_reset: 2 },
        });
        expect(useShopStore.getState().getDailyPurchased('dungeon_reset')).toBe(2);
    });

    it('rolls the counter when the dayKey is stale (yesterday)', () => {
        useShopStore.setState({
            dayKey: '1999-01-01',
            dailyPurchases: { dungeon_reset: 4 },
        });
        const r = useShopStore.getState().getDailyPurchased('dungeon_reset');
        expect(r).toBe(0);
        // Side-effect: the dayKey rolls forward and dailyPurchases is wiped.
        const s = useShopStore.getState();
        expect(s.dayKey).toBe(getTodayKey());
        expect(s.dailyPurchases).toEqual({});
    });
});

// ── getDailyRemaining ───────────────────────────────────────────────────────

describe('getDailyRemaining', () => {
    it('returns +Infinity for non-capped ids', () => {
        expect(useShopStore.getState().getDailyRemaining('hp_potion_sm')).toBe(Number.POSITIVE_INFINITY);
    });

    it('returns 5 for an unused dungeon_reset slot today', () => {
        expect(useShopStore.getState().getDailyRemaining('dungeon_reset')).toBe(5);
    });

    it('subtracts already-used slots', () => {
        useShopStore.setState({
            dayKey: getTodayKey(),
            dailyPurchases: { boss_reset: 3 },
        });
        expect(useShopStore.getState().getDailyRemaining('boss_reset')).toBe(2);
    });

    it('clamps at 0 (no negative remaining)', () => {
        useShopStore.setState({
            dayKey: getTodayKey(),
            dailyPurchases: { boss_reset: 99 },
        });
        expect(useShopStore.getState().getDailyRemaining('boss_reset')).toBe(0);
    });
});

// ── buyShopItem ─────────────────────────────────────────────────────────────

describe('buyShopItem', () => {
    it('returns no_gold when the player cannot afford it', () => {
        invState.gold = 50;
        const r = useShopStore.getState().buyShopItem(makeShopItem({ price: 100 }), makeCharacter());
        expect(r).toBe('no_gold');
        expect(restoreItemMock).not.toHaveBeenCalled();
    });

    it('deducts gold, generates the item, and stores it via restoreItem', () => {
        invState.gold = 1000;
        const r = useShopStore.getState().buyShopItem(makeShopItem({ price: 100 }), makeCharacter());
        expect(r).toBe('ok');
        expect(spendGoldMock).toHaveBeenCalledWith(100);
        expect(generateWeaponMock).toHaveBeenCalled();
        expect(restoreItemMock).toHaveBeenCalled();
        expect(useShopStore.getState().lastNotification).toContain('Kupiono');
    });

    it('routes armor purchases through generateArmor with the armor prefix and slot', () => {
        invState.gold = 1000;
        const armorItem = makeShopItem({
            templateType: 'armor',
            slot: 'helmet',
            armorPrefix: 'plate',
            type: 'plate_helmet',
        });
        useShopStore.getState().buyShopItem(armorItem, makeCharacter());
        expect(generateArmorMock).toHaveBeenCalledWith('plate', 'helmet', expect.any(Number), 'common');
    });

    it('routes accessory purchases through generateAccessory', () => {
        invState.gold = 1000;
        const acc = makeShopItem({ templateType: 'accessory', slot: 'ring1', type: 'ring' });
        useShopStore.getState().buyShopItem(acc, makeCharacter());
        expect(generateAccessoryMock).toHaveBeenCalled();
    });

    it('refunds gold when the generator returns null', () => {
        invState.gold = 500;
        generateWeaponMock.mockReturnValueOnce(null);
        const r = useShopStore.getState().buyShopItem(makeShopItem({ price: 100 }), makeCharacter());
        expect(r).toBe('bag_full');
        // 100 spent + 100 refunded = 500 net.
        expect(invState.gold).toBe(500);
    });

    it('refunds gold when restoreItem fails (bag full)', () => {
        invState.gold = 500;
        restoreItemMock.mockReturnValueOnce(false);
        const r = useShopStore.getState().buyShopItem(makeShopItem({ price: 100 }), makeCharacter());
        expect(r).toBe('bag_full');
        expect(addGoldMock).toHaveBeenCalledWith(100);
        expect(invState.gold).toBe(500);
    });
});

// ── buyElixir ───────────────────────────────────────────────────────────────

describe('buyElixir', () => {
    it('rejects when character level is below the elixir minLevel', () => {
        const elx = findElixir('hp_potion_md'); // minLevel 20
        const r = useShopStore.getState().buyElixir(elx, makeCharacter({ level: 5 }));
        expect(r).toBe('level_too_low');
        expect(spendGoldMock).not.toHaveBeenCalled();
    });

    it('purchases a basic potion at level 1', () => {
        invState.gold = 100;
        const elx = findElixir('hp_potion_sm'); // 30 gold, minLevel 1
        const r = useShopStore.getState().buyElixir(elx, makeCharacter({ level: 1 }));
        expect(r).toBe('ok');
        expect(addConsumableMock).toHaveBeenCalledWith('hp_potion_sm', 1);
        expect(invState.gold).toBe(70);
    });

    it('returns no_gold when total price exceeds gold', () => {
        invState.gold = 20;
        const elx = findElixir('hp_potion_sm');
        const r = useShopStore.getState().buyElixir(elx, makeCharacter({ level: 1 }));
        expect(r).toBe('no_gold');
        expect(addConsumableMock).not.toHaveBeenCalled();
    });

    it('multiplies price by qty for bulk buys', () => {
        invState.gold = 1000;
        const elx = findElixir('hp_potion_sm'); // 30 gold
        const r = useShopStore.getState().buyElixir(elx, makeCharacter(), 5);
        expect(r).toBe('ok');
        expect(spendGoldMock).toHaveBeenCalledWith(150);
        expect(addConsumableMock).toHaveBeenCalledWith('hp_potion_sm', 5);
    });

    it('honors daily caps for dungeon_reset (5/day)', () => {
        invState.gold = 999_999_999;
        const elx = findElixir('dungeon_reset');
        // 5 successful buys fill the daily cap.
        for (let i = 0; i < 5; i++) {
            expect(useShopStore.getState().buyElixir(elx, makeCharacter())).toBe('ok');
        }
        // 6th hits the cap.
        expect(useShopStore.getState().buyElixir(elx, makeCharacter())).toBe('daily_limit');
    });

    it('rejects bulk buy that would push past the daily cap', () => {
        invState.gold = 999_999_999;
        const elx = findElixir('dungeon_reset');
        useShopStore.setState({
            dayKey: getTodayKey(),
            dailyPurchases: { dungeon_reset: 3 },
        });
        const r = useShopStore.getState().buyElixir(elx, makeCharacter(), 5);
        expect(r).toBe('daily_limit');
    });

    it('increments daily counter only for capped elixirs', () => {
        invState.gold = 999_999_999;
        useShopStore.getState().buyElixir(findElixir('hp_potion_sm'), makeCharacter());
        // hp_potion_sm is NOT capped → counter untouched.
        expect(useShopStore.getState().dailyPurchases['hp_potion_sm']).toBeUndefined();

        useShopStore.getState().buyElixir(findElixir('boss_reset'), makeCharacter());
        expect(useShopStore.getState().dailyPurchases['boss_reset']).toBe(1);
    });

    it('skips the level check when no character is passed', () => {
        invState.gold = 1000;
        const elx = findElixir('hp_potion_md'); // minLevel 20
        const r = useShopStore.getState().buyElixir(elx, undefined);
        expect(r).toBe('ok');
    });

    it('sets a "Kupiono" notification on success', () => {
        invState.gold = 1000;
        useShopStore.getState().buyElixir(findElixir('hp_potion_sm'), makeCharacter());
        expect(useShopStore.getState().lastNotification).toContain('Kupiono');
    });
});

// ── generateShopItems (pure helper) ─────────────────────────────────────────

describe('generateShopItems', () => {
    it('returns at least the weapon entry for a known class', () => {
        const items = generateShopItems('Knight', 10);
        expect(items.length).toBeGreaterThan(0);
        // Each Knight gets a Sword weapon entry.
        const sword = items.find((i) => i.templateType === 'weapon');
        expect(sword).toBeDefined();
    });

    it('caps generated item level at SHOP_ITEM_LEVEL_CAP (100)', () => {
        const items = generateShopItems('Knight', 999);
        for (const it of items) {
            expect(it.level).toBeLessThanOrEqual(100);
        }
    });

    it('returns an empty list when the class is unknown', () => {
        // Unknown class has no CLASS_WEAPON_TYPES entry → still returns
        // array, but with no weapon/offhand/armor entries (might still
        // hit accessories which iterate templates regardless).
        const items = generateShopItems('NoSuchClass', 5);
        const weapons = items.filter((i) => i.templateType === 'weapon');
        expect(weapons).toEqual([]);
    });
});

// ── buyArenaItem ─────────────────────────────────────────────────────────────

describe('buyArenaItem', () => {
    it('rejects when arena points are insufficient', () => {
        invState.arenaPoints = 10;
        const r = buyArenaItem(
            { id: 'arena_stone_common', name_pl: 'X', description_pl: '', icon: '⚪', apPrice: 50, kind: 'stone', payloadId: 'common_stone' },
            10,
        );
        expect(r).toBe('no_gold');
        expect(addStonesMock).not.toHaveBeenCalled();
    });

    it('adds a stone after spending arena points', () => {
        invState.arenaPoints = 100;
        const r = buyArenaItem(
            { id: 'arena_stone_common', name_pl: 'X', description_pl: '', icon: '⚪', apPrice: 50, kind: 'stone', payloadId: 'common_stone' },
            10,
        );
        expect(r).toBe('ok');
        expect(addStonesMock).toHaveBeenCalledWith('common_stone', 1);
        expect(invState.arenaPoints).toBe(50);
    });

    it('adds a consumable for kind=potion / elixir', () => {
        invState.arenaPoints = 1000;
        buyArenaItem(
            { id: 'arena_hp_25', name_pl: 'X', description_pl: '', icon: '❤️', apPrice: 300, kind: 'potion', payloadId: 'hp_potion_great' },
            10,
        );
        expect(addConsumableMock).toHaveBeenCalledWith('hp_potion_great', 1);
    });

    it('scales price with level for mythic weapons', () => {
        invState.arenaPoints = 100_000;
        const item = { id: 'arena_mythic_main', name_pl: 'X', description_pl: '', icon: '⚔️', apPrice: 1000, kind: 'mythic_weapon' as const, perLevel: true };
        buyArenaItem(item, 50, 'Knight');
        // 1000 × 50 = 50 000 AP spent.
        expect(spendArenaPointsMock).toHaveBeenCalledWith(50_000);
    });

    it('refunds AP when generator returns null on a mythic purchase', () => {
        invState.arenaPoints = 100_000;
        generateWeaponMock.mockReturnValueOnce(null);
        const item = { id: 'arena_mythic_main', name_pl: 'X', description_pl: '', icon: '⚔️', apPrice: 1000, kind: 'mythic_weapon' as const, perLevel: true };
        const r = buyArenaItem(item, 50, 'Knight');
        expect(r).toBe('bag_full');
        expect(addArenaPointsMock).toHaveBeenCalled();
    });

    it('refunds AP when bag is full on a mythic purchase', () => {
        invState.arenaPoints = 100_000;
        addItemMock.mockReturnValueOnce(false);
        const item = { id: 'arena_mythic_main', name_pl: 'X', description_pl: '', icon: '⚔️', apPrice: 1000, kind: 'mythic_weapon' as const, perLevel: true };
        const r = buyArenaItem(item, 50, 'Knight');
        expect(r).toBe('bag_full');
        expect(addArenaPointsMock).toHaveBeenCalled();
    });
});
