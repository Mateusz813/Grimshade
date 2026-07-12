import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ICharacter } from './characterStore';
import type { IShopItem } from './shopStore';


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

vi.mock('../systems/dailyQuestSystem', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../systems/dailyQuestSystem');
    return {
        ...actual,
        getTodayKey: vi.fn(() => '2026-05-21'),
    };
});

import { useShopStore, ELIXIRS, type IElixir, generateShopItems, buyArenaItem, getArenaShopCatalog } from './shopStore';
import { getTodayKey } from '../systems/dailyQuestSystem';


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
    icon: 'crossed-swords',
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

    useShopStore.setState({
        lastNotification: null,
        dayKey: getTodayKey(),
        dailyPurchases: {},
    });
});


describe('shopStore — initial state', () => {
    it('has no last notification', () => {
        expect(useShopStore.getState().lastNotification).toBeNull();
    });

    it('initialises daily-purchase counter to today', () => {
        expect(useShopStore.getState().dayKey).toBe(getTodayKey());
        expect(useShopStore.getState().dailyPurchases).toEqual({});
    });
});


describe('clearNotification', () => {
    it('clears any pending lastNotification', () => {
        useShopStore.setState({ lastNotification: 'hi' });
        useShopStore.getState().clearNotification();
        expect(useShopStore.getState().lastNotification).toBeNull();
    });
});


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
        const s = useShopStore.getState();
        expect(s.dayKey).toBe(getTodayKey());
        expect(s.dailyPurchases).toEqual({});
    });
});


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


describe('buyElixir', () => {
    it('rejects when character level is below the elixir minLevel', () => {
        const elx = findElixir('hp_potion_md');
        const r = useShopStore.getState().buyElixir(elx, makeCharacter({ level: 5 }));
        expect(r).toBe('level_too_low');
        expect(spendGoldMock).not.toHaveBeenCalled();
    });

    it('purchases a basic potion at level 1', () => {
        invState.gold = 100;
        const elx = findElixir('hp_potion_sm');
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
        const elx = findElixir('hp_potion_sm');
        const r = useShopStore.getState().buyElixir(elx, makeCharacter(), 5);
        expect(r).toBe('ok');
        expect(spendGoldMock).toHaveBeenCalledWith(150);
        expect(addConsumableMock).toHaveBeenCalledWith('hp_potion_sm', 5);
    });

    it('honors daily caps for dungeon_reset (5/day)', () => {
        invState.gold = 999_999_999;
        const elx = findElixir('dungeon_reset');
        for (let i = 0; i < 5; i++) {
            expect(useShopStore.getState().buyElixir(elx, makeCharacter())).toBe('ok');
        }
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
        expect(useShopStore.getState().dailyPurchases['hp_potion_sm']).toBeUndefined();

        useShopStore.getState().buyElixir(findElixir('boss_reset'), makeCharacter());
        expect(useShopStore.getState().dailyPurchases['boss_reset']).toBe(1);
    });

    it('skips the level check when no character is passed', () => {
        invState.gold = 1000;
        const elx = findElixir('hp_potion_md');
        const r = useShopStore.getState().buyElixir(elx, undefined);
        expect(r).toBe('ok');
    });

    it('sets a "Kupiono" notification on success', () => {
        invState.gold = 1000;
        useShopStore.getState().buyElixir(findElixir('hp_potion_sm'), makeCharacter());
        expect(useShopStore.getState().lastNotification).toContain('Kupiono');
    });
});


describe('generateShopItems', () => {
    it('returns at least the weapon entry for a known class', () => {
        const items = generateShopItems('Knight', 10);
        expect(items.length).toBeGreaterThan(0);
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
        const items = generateShopItems('NoSuchClass', 5);
        const weapons = items.filter((i) => i.templateType === 'weapon');
        expect(weapons).toEqual([]);
    });
});


describe('buyArenaItem', () => {
    it('rejects when arena points are insufficient', () => {
        invState.arenaPoints = 10;
        const r = buyArenaItem(
            { id: 'arena_stone_common', name_pl: 'X', description_pl: '', icon: 'white-circle', apPrice: 50, kind: 'stone', payloadId: 'common_stone' },
            10,
        );
        expect(r).toBe('no_gold');
        expect(addStonesMock).not.toHaveBeenCalled();
    });

    it('adds a stone after spending arena points', () => {
        invState.arenaPoints = 100;
        const r = buyArenaItem(
            { id: 'arena_stone_common', name_pl: 'X', description_pl: '', icon: 'white-circle', apPrice: 50, kind: 'stone', payloadId: 'common_stone' },
            10,
        );
        expect(r).toBe('ok');
        expect(addStonesMock).toHaveBeenCalledWith('common_stone', 1);
        expect(invState.arenaPoints).toBe(50);
    });

    it('grants a MYTHIC stone from the arena shop (arena_stone_mythic)', () => {
        invState.arenaPoints = 10_000;
        const r = buyArenaItem(
            { id: 'arena_stone_mythic', name_pl: 'Kamień (Mythic)', description_pl: '', icon: 'gem-stone', apPrice: 6000, kind: 'stone', payloadId: 'mythic_stone' },
            50,
        );
        expect(r).toBe('ok');
        expect(addStonesMock).toHaveBeenCalledWith('mythic_stone', 1);
        expect(invState.arenaPoints).toBe(4000);
    });

    it('arena shop catalog lists a mythic stone (kind stone, payload mythic_stone)', () => {
        const mythic = getArenaShopCatalog().find((i) => i.payloadId === 'mythic_stone');
        expect(mythic).toBeDefined();
        expect(mythic?.kind).toBe('stone');
        expect(mythic?.id).toBe('arena_stone_mythic');
    });

    it('adds a consumable for kind=potion / elixir (at/above the payload unlock level)', () => {
        invState.arenaPoints = 1000;
        buyArenaItem(
            { id: 'arena_hp_25', name_pl: 'X', description_pl: '', icon: 'red-heart', apPrice: 300, kind: 'potion', payloadId: 'hp_potion_great' },
            200,
        );
        expect(addConsumableMock).toHaveBeenCalledWith('hp_potion_great', 1);
    });

    it('rejects an arena potion below the payload potion unlock level (no AP spent)', () => {
        invState.arenaPoints = 100_000;
        const r = buyArenaItem(
            { id: 'arena_hp_25', name_pl: 'X', description_pl: '', icon: 'red-heart', apPrice: 300, kind: 'potion', payloadId: 'hp_potion_great' },
            14,
        );
        expect(r).toBe('level_too_low');
        expect(addConsumableMock).not.toHaveBeenCalled();
        expect(spendArenaPointsMock).not.toHaveBeenCalled();
    });

    it('rejects arena_hp_100 (divine, lvl 700) below 700 but allows at 700', () => {
        invState.arenaPoints = 100_000;
        const locked = buyArenaItem(
            { id: 'arena_hp_100', name_pl: 'X', description_pl: '', icon: 'red-heart', apPrice: 2000, kind: 'potion', payloadId: 'hp_potion_divine' },
            699,
        );
        expect(locked).toBe('level_too_low');
        const ok = buyArenaItem(
            { id: 'arena_hp_100', name_pl: 'X', description_pl: '', icon: 'red-heart', apPrice: 2000, kind: 'potion', payloadId: 'hp_potion_divine' },
            700,
        );
        expect(ok).toBe('ok');
        expect(addConsumableMock).toHaveBeenCalledWith('hp_potion_divine', 1);
    });

    it('scales price with level for mythic weapons', () => {
        invState.arenaPoints = 100_000;
        const item = { id: 'arena_mythic_main', name_pl: 'X', description_pl: '', icon: 'crossed-swords', apPrice: 1000, kind: 'mythic_weapon' as const, perLevel: true };
        buyArenaItem(item, 50, 'Knight');
        expect(spendArenaPointsMock).toHaveBeenCalledWith(50_000);
    });

    it('refunds AP when generator returns null on a mythic purchase', () => {
        invState.arenaPoints = 100_000;
        generateWeaponMock.mockReturnValueOnce(null);
        const item = { id: 'arena_mythic_main', name_pl: 'X', description_pl: '', icon: 'crossed-swords', apPrice: 1000, kind: 'mythic_weapon' as const, perLevel: true };
        const r = buyArenaItem(item, 50, 'Knight');
        expect(r).toBe('bag_full');
        expect(addArenaPointsMock).toHaveBeenCalled();
    });

    it('refunds AP when bag is full on a mythic purchase', () => {
        invState.arenaPoints = 100_000;
        addItemMock.mockReturnValueOnce(false);
        const item = { id: 'arena_mythic_main', name_pl: 'X', description_pl: '', icon: 'crossed-swords', apPrice: 1000, kind: 'mythic_weapon' as const, perLevel: true };
        const r = buyArenaItem(item, 50, 'Knight');
        expect(r).toBe('bag_full');
        expect(addArenaPointsMock).toHaveBeenCalled();
    });
});
