import { describe, it, expect, beforeEach } from 'vitest';
import { useInventoryStore, MAX_BAG_SIZE, MAX_DEPOSIT_SIZE } from './inventoryStore';
import { useCharacterStore, type ICharacter } from './characterStore';
import { GEAR_HP_SCALE } from '../systems/combat';
import { useSettingsStore } from './settingsStore';
import {
    EMPTY_EQUIPMENT,
    STONE_CONVERSION_COST,
    STONE_CONVERSION_GOLD,
    type IInventoryItem,
    type Rarity,
} from '../systems/itemSystem';


let uuidCounter = 0;
const makeItem = (overrides: Partial<IInventoryItem> = {}): IInventoryItem => {
    uuidCounter += 1;
    return {
        uuid: `item-${uuidCounter}`,
        itemId: 'sword_of_beginnings',
        rarity: 'common' as Rarity,
        bonuses: {},
        itemLevel: 1,
        upgradeLevel: 0,
        ...overrides,
    };
};

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Tester',
    class: 'Knight',
    level: 1,
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
    highest_level: 1,
    equipment: {},
    created_at: '',
    updated_at: '',
    ...overrides,
} as ICharacter);

const resetInventory = (): void => {
    useInventoryStore.setState({
        bag: [],
        equipment: { ...EMPTY_EQUIPMENT },
        deposit: [],
        gold: 0,
        arenaPoints: 0,
        consumables: {},
        stones: {},
    });
};

const resetSettings = (): void => {
    useSettingsStore.setState({
        autoSellCommon: false,
        autoSellRare: false,
        autoSellEpic: false,
        autoSellLegendary: false,
        autoSellMythic: false,
        autoSellMaxLevel: 0,
    });
};

beforeEach(() => {
    uuidCounter = 0;
    resetInventory();
    resetSettings();
    useCharacterStore.setState({ character: null, isLoading: false });
});


describe('addItem', () => {
    it('appends item to the bag and returns true', () => {
        const item = makeItem();
        const ok = useInventoryStore.getState().addItem(item);
        expect(ok).toBe(true);
        expect(useInventoryStore.getState().bag).toHaveLength(1);
        expect(useInventoryStore.getState().bag[0].uuid).toBe(item.uuid);
    });

    it('auto-sells when matching rarity flag is on', () => {
        useSettingsStore.setState({ autoSellCommon: true });
        const initial = useInventoryStore.getState().gold;
        const ok = useInventoryStore.getState().addItem(makeItem({ rarity: 'common' }));
        expect(ok).toBe(true);
        expect(useInventoryStore.getState().bag).toHaveLength(0);
        expect(useInventoryStore.getState().gold).toBeGreaterThan(initial);
    });

    it('does not auto-sell rarities whose flag is off', () => {
        useSettingsStore.setState({ autoSellCommon: false, autoSellRare: true });
        const ok = useInventoryStore.getState().addItem(makeItem({ rarity: 'common' }));
        expect(ok).toBe(true);
        expect(useInventoryStore.getState().bag).toHaveLength(1);
    });

    it('does not auto-sell items above autoSellMaxLevel', () => {
        useSettingsStore.setState({ autoSellCommon: true, autoSellMaxLevel: 50 });
        const ok = useInventoryStore.getState().addItem(makeItem({ rarity: 'common', itemLevel: 80 }));
        expect(ok).toBe(true);
        expect(useInventoryStore.getState().bag).toHaveLength(1);
    });

    it('auto-sells items at or below autoSellMaxLevel', () => {
        useSettingsStore.setState({ autoSellCommon: true, autoSellMaxLevel: 50 });
        const initial = useInventoryStore.getState().gold;
        const ok = useInventoryStore.getState().addItem(makeItem({ rarity: 'common', itemLevel: 50 }));
        expect(ok).toBe(true);
        expect(useInventoryStore.getState().bag).toHaveLength(0);
        expect(useInventoryStore.getState().gold).toBeGreaterThan(initial);
    });

    it('autoSellMaxLevel 0 means no level cap', () => {
        useSettingsStore.setState({ autoSellCommon: true, autoSellMaxLevel: 0 });
        const ok = useInventoryStore.getState().addItem(makeItem({ rarity: 'common', itemLevel: 999 }));
        expect(ok).toBe(true);
        expect(useInventoryStore.getState().bag).toHaveLength(0);
    });
});

describe('restoreItem', () => {
    it('bypasses auto-sell — keeps item in bag even when flag is on', () => {
        useSettingsStore.setState({ autoSellRare: true });
        const item = makeItem({ rarity: 'rare' });
        const ok = useInventoryStore.getState().restoreItem(item);
        expect(ok).toBe(true);
        expect(useInventoryStore.getState().bag).toHaveLength(1);
    });

    it('returns false when bag is full', () => {
        useInventoryStore.setState({
            bag: Array.from({ length: MAX_BAG_SIZE }, () => makeItem()),
        });
        const ok = useInventoryStore.getState().restoreItem(makeItem());
        expect(ok).toBe(false);
    });
});


describe('removeItem', () => {
    it('removes the item with the given uuid', () => {
        const a = makeItem();
        const b = makeItem();
        useInventoryStore.getState().addItem(a);
        useInventoryStore.getState().addItem(b);
        useInventoryStore.getState().removeItem(a.uuid);
        expect(useInventoryStore.getState().bag).toHaveLength(1);
        expect(useInventoryStore.getState().bag[0].uuid).toBe(b.uuid);
    });

    it('is a no-op for unknown uuid', () => {
        useInventoryStore.getState().addItem(makeItem());
        useInventoryStore.getState().removeItem('nope');
        expect(useInventoryStore.getState().bag).toHaveLength(1);
    });
});


describe('equipItem', () => {
    it('moves item from bag into the named slot', () => {
        const sword = makeItem({ itemId: 'sword_of_beginnings' });
        useInventoryStore.getState().addItem(sword);
        useInventoryStore.getState().equipItem(sword.uuid, 'mainHand');
        const { bag, equipment } = useInventoryStore.getState();
        expect(bag).toHaveLength(0);
        expect(equipment.mainHand?.uuid).toBe(sword.uuid);
    });

    it('swaps out the previously-equipped item back to the bag', () => {
        const old = makeItem();
        const fresh = makeItem();
        useInventoryStore.setState({
            equipment: { ...EMPTY_EQUIPMENT, mainHand: old },
            bag: [fresh],
        });
        useInventoryStore.getState().equipItem(fresh.uuid, 'mainHand');
        const { bag, equipment } = useInventoryStore.getState();
        expect(equipment.mainHand?.uuid).toBe(fresh.uuid);
        expect(bag.map((i) => i.uuid)).toContain(old.uuid);
        expect(bag).toHaveLength(1);
    });

    it('is a no-op when uuid is not in the bag', () => {
        useInventoryStore.getState().equipItem('missing-uuid', 'mainHand');
        expect(useInventoryStore.getState().equipment.mainHand).toBeNull();
    });

    it('applies the equipment HP delta to character.hp (deferred microtask)', async () => {
        useCharacterStore.setState({
            character: makeChar({ hp: 50, max_hp: 100, mp: 30, max_mp: 30 }),
        });
        const weapon = makeItem({
            itemId: 'sword_of_beginnings',
            bonuses: { hp: 25 },
            rarity: 'rare',
        });
        useInventoryStore.setState({ bag: [weapon] });
        useInventoryStore.getState().equipItem(weapon.uuid, 'mainHand');
        await new Promise((resolve) => setTimeout(resolve, 0));
        const c = useCharacterStore.getState().character!;
        expect(c.hp).toBe(50 + Math.floor(25 * GEAR_HP_SCALE));
    });
});

describe('unequipItem', () => {
    it('moves the equipped item back into the bag', () => {
        const item = makeItem();
        useInventoryStore.setState({
            equipment: { ...EMPTY_EQUIPMENT, mainHand: item },
            bag: [],
        });
        useInventoryStore.getState().unequipItem('mainHand');
        const { bag, equipment } = useInventoryStore.getState();
        expect(equipment.mainHand).toBeNull();
        expect(bag).toHaveLength(1);
        expect(bag[0].uuid).toBe(item.uuid);
    });

    it('is a no-op when the slot is empty', () => {
        useInventoryStore.getState().unequipItem('mainHand');
        expect(useInventoryStore.getState().bag).toHaveLength(0);
        expect(useInventoryStore.getState().equipment.mainHand).toBeNull();
    });

    it('refuses to unequip when bag is full (item stays equipped)', () => {
        const equipped = makeItem();
        useInventoryStore.setState({
            equipment: { ...EMPTY_EQUIPMENT, mainHand: equipped },
            bag: Array.from({ length: MAX_BAG_SIZE }, () => makeItem()),
        });
        useInventoryStore.getState().unequipItem('mainHand');
        expect(useInventoryStore.getState().equipment.mainHand?.uuid).toBe(equipped.uuid);
        expect(useInventoryStore.getState().bag).toHaveLength(MAX_BAG_SIZE);
    });
});


describe('sellItem', () => {
    it('removes item from bag and adds gold', () => {
        const item = makeItem();
        useInventoryStore.getState().addItem(item);
        useInventoryStore.getState().sellItem(item.uuid, 50);
        expect(useInventoryStore.getState().bag).toHaveLength(0);
        expect(useInventoryStore.getState().gold).toBe(50);
    });
});

describe('sellMultiple', () => {
    it('removes every listed item and returns total gold', () => {
        const a = makeItem();
        const b = makeItem();
        const c = makeItem();
        useInventoryStore.setState({ bag: [a, b, c], gold: 0 });
        const total = useInventoryStore.getState().sellMultiple(
            [a.uuid, c.uuid],
            () => 10,
        );
        expect(total).toBe(20);
        expect(useInventoryStore.getState().bag).toHaveLength(1);
        expect(useInventoryStore.getState().bag[0].uuid).toBe(b.uuid);
        expect(useInventoryStore.getState().gold).toBe(20);
    });

    it('returns 0 when no items match', () => {
        useInventoryStore.setState({ bag: [makeItem()] });
        const total = useInventoryStore.getState().sellMultiple([], () => 50);
        expect(total).toBe(0);
    });
});


describe('addGold', () => {
    it('adds the given amount', () => {
        useInventoryStore.getState().addGold(100);
        useInventoryStore.getState().addGold(50);
        expect(useInventoryStore.getState().gold).toBe(150);
    });
});

describe('spendGold', () => {
    it('subtracts and returns true on success', () => {
        useInventoryStore.setState({ gold: 100 });
        const ok = useInventoryStore.getState().spendGold(30);
        expect(ok).toBe(true);
        expect(useInventoryStore.getState().gold).toBe(70);
    });

    it('returns false and leaves gold unchanged when balance too low', () => {
        useInventoryStore.setState({ gold: 10 });
        const ok = useInventoryStore.getState().spendGold(100);
        expect(ok).toBe(false);
        expect(useInventoryStore.getState().gold).toBe(10);
    });
});


describe('addStones / getStoneCount / useStones', () => {
    it('adds + reads stone count', () => {
        useInventoryStore.getState().addStones('common_stone', 5);
        expect(useInventoryStore.getState().getStoneCount('common_stone')).toBe(5);
        useInventoryStore.getState().addStones('common_stone', 3);
        expect(useInventoryStore.getState().getStoneCount('common_stone')).toBe(8);
    });

    it('defaults to amount=1 when called without arg', () => {
        useInventoryStore.getState().addStones('rare_stone');
        expect(useInventoryStore.getState().getStoneCount('rare_stone')).toBe(1);
    });

    it('returns 0 for stones never added', () => {
        expect(useInventoryStore.getState().getStoneCount('legendary_stone')).toBe(0);
    });

    it('useStones consumes and returns true', () => {
        useInventoryStore.getState().addStones('common_stone', 10);
        const ok = useInventoryStore.getState().useStones('common_stone', 4);
        expect(ok).toBe(true);
        expect(useInventoryStore.getState().getStoneCount('common_stone')).toBe(6);
    });

    it('useStones returns false and leaves balance untouched when not enough', () => {
        useInventoryStore.getState().addStones('common_stone', 2);
        const ok = useInventoryStore.getState().useStones('common_stone', 5);
        expect(ok).toBe(false);
        expect(useInventoryStore.getState().getStoneCount('common_stone')).toBe(2);
    });
});

describe('convertStones', () => {
    it('converts STONE_CONVERSION_COST low-tier stones into 1 higher-tier stone for gold', () => {
        useInventoryStore.setState({
            stones: { common_stone: STONE_CONVERSION_COST },
            gold: STONE_CONVERSION_GOLD,
        });
        const ok = useInventoryStore.getState().convertStones('common_stone');
        expect(ok).toBe(true);
        const s = useInventoryStore.getState();
        expect(s.getStoneCount('common_stone')).toBe(0);
        expect(s.getStoneCount('rare_stone')).toBe(1);
        expect(s.gold).toBe(0);
    });

    it('returns false when not enough stones', () => {
        useInventoryStore.setState({
            stones: { common_stone: 10 },
            gold: STONE_CONVERSION_GOLD,
        });
        expect(useInventoryStore.getState().convertStones('common_stone')).toBe(false);
    });

    it('returns false when not enough gold', () => {
        useInventoryStore.setState({
            stones: { common_stone: STONE_CONVERSION_COST },
            gold: 0,
        });
        expect(useInventoryStore.getState().convertStones('common_stone')).toBe(false);
    });

    it('returns false for top-tier stones (no higher tier)', () => {
        useInventoryStore.setState({
            stones: { heroic_stone: STONE_CONVERSION_COST },
            gold: STONE_CONVERSION_GOLD,
        });
        expect(useInventoryStore.getState().convertStones('heroic_stone')).toBe(false);
    });
});


describe('addConsumable / useConsumable', () => {
    it('adds a consumable and uses one at a time', () => {
        useInventoryStore.getState().addConsumable('health_potion', 3);
        expect(useInventoryStore.getState().consumables['health_potion']).toBe(3);
        const used = useInventoryStore.getState().useConsumable('health_potion');
        expect(used).toBe(true);
        expect(useInventoryStore.getState().consumables['health_potion']).toBe(2);
    });

    it('useConsumable returns false when count is 0', () => {
        const used = useInventoryStore.getState().useConsumable('rare_elixir');
        expect(used).toBe(false);
    });

    it('addConsumable defaults to amount=1', () => {
        useInventoryStore.getState().addConsumable('mana_potion');
        expect(useInventoryStore.getState().consumables['mana_potion']).toBe(1);
    });

    const setLevel = (level: number) =>
        useCharacterStore.setState({ character: { level } as ICharacter });

    it('blocks drinking an above-level potion (no consume, returns false)', () => {
        setLevel(14);
        useInventoryStore.getState().addConsumable('hp_potion_md', 3);
        const used = useInventoryStore.getState().useConsumable('hp_potion_md');
        expect(used).toBe(false);
        expect(useInventoryStore.getState().consumables['hp_potion_md']).toBe(3);
    });

    it('allows drinking once the character reaches the unlock level', () => {
        setLevel(20);
        useInventoryStore.getState().addConsumable('hp_potion_md', 3);
        const used = useInventoryStore.getState().useConsumable('hp_potion_md');
        expect(used).toBe(true);
        expect(useInventoryStore.getState().consumables['hp_potion_md']).toBe(2);
    });

    it('always allows the tier-1 (50 HP/MP) potion from level 1', () => {
        setLevel(1);
        useInventoryStore.getState().addConsumable('hp_potion_sm', 2);
        useInventoryStore.getState().addConsumable('mp_potion_sm', 2);
        expect(useInventoryStore.getState().useConsumable('hp_potion_sm')).toBe(true);
        expect(useInventoryStore.getState().useConsumable('mp_potion_sm')).toBe(true);
    });

    it('does NOT level-gate non-potion consumables (death_protection etc.)', () => {
        setLevel(1);
        useInventoryStore.getState().addConsumable('death_protection', 2);
        const used = useInventoryStore.getState().useConsumable('death_protection');
        expect(used).toBe(true);
        expect(useInventoryStore.getState().consumables['death_protection']).toBe(1);
    });
});

describe('addSpellChest / useSpellChests / getSpellChestCount', () => {
    it('stacks chests under spell_chest_<level> key', () => {
        useInventoryStore.getState().addSpellChest(5, 3);
        expect(useInventoryStore.getState().getSpellChestCount(5)).toBe(3);
        useInventoryStore.getState().addSpellChest(5, 2);
        expect(useInventoryStore.getState().getSpellChestCount(5)).toBe(5);
    });

    it('useSpellChests returns false when not enough are owned', () => {
        useInventoryStore.getState().addSpellChest(10, 1);
        expect(useInventoryStore.getState().useSpellChests(10, 5)).toBe(false);
        expect(useInventoryStore.getState().getSpellChestCount(10)).toBe(1);
    });

    it('useSpellChests deducts and returns true on success', () => {
        useInventoryStore.getState().addSpellChest(20, 4);
        const ok = useInventoryStore.getState().useSpellChests(20, 3);
        expect(ok).toBe(true);
        expect(useInventoryStore.getState().getSpellChestCount(20)).toBe(1);
    });
});


describe('depositItem / withdrawItem', () => {
    it('moves an item bag -> deposit', () => {
        const item = makeItem();
        useInventoryStore.setState({ bag: [item] });
        const ok = useInventoryStore.getState().depositItem(item.uuid);
        expect(ok).toBe(true);
        const s = useInventoryStore.getState();
        expect(s.bag).toHaveLength(0);
        expect(s.deposit).toHaveLength(1);
        expect(s.deposit[0].uuid).toBe(item.uuid);
    });

    it('moves an item deposit -> bag', () => {
        const item = makeItem();
        useInventoryStore.setState({ deposit: [item] });
        const ok = useInventoryStore.getState().withdrawItem(item.uuid);
        expect(ok).toBe(true);
        const s = useInventoryStore.getState();
        expect(s.bag).toHaveLength(1);
        expect(s.deposit).toHaveLength(0);
    });

    it('depositItem returns false when deposit is at MAX_DEPOSIT_SIZE', () => {
        const item = makeItem();
        useInventoryStore.setState({
            bag: [item],
            deposit: Array.from({ length: MAX_DEPOSIT_SIZE }, () => makeItem()),
        });
        const ok = useInventoryStore.getState().depositItem(item.uuid);
        expect(ok).toBe(false);
    });

    it('withdrawItem returns false when bag is full', () => {
        const item = makeItem();
        useInventoryStore.setState({
            deposit: [item],
            bag: Array.from({ length: MAX_BAG_SIZE }, () => makeItem()),
        });
        expect(useInventoryStore.getState().withdrawItem(item.uuid)).toBe(false);
    });
});


describe('addArenaPoints / spendArenaPoints', () => {
    it('adds arena points', () => {
        useInventoryStore.getState().addArenaPoints(150);
        expect(useInventoryStore.getState().arenaPoints).toBe(150);
    });

    it('clamps to 0 instead of going negative', () => {
        useInventoryStore.getState().addArenaPoints(-1000);
        expect(useInventoryStore.getState().arenaPoints).toBe(0);
    });

    it('spendArenaPoints returns false when balance too low', () => {
        useInventoryStore.setState({ arenaPoints: 50 });
        expect(useInventoryStore.getState().spendArenaPoints(100)).toBe(false);
        expect(useInventoryStore.getState().arenaPoints).toBe(50);
    });

    it('spendArenaPoints succeeds when balance is enough', () => {
        useInventoryStore.setState({ arenaPoints: 200 });
        expect(useInventoryStore.getState().spendArenaPoints(50)).toBe(true);
        expect(useInventoryStore.getState().arenaPoints).toBe(150);
    });
});


describe('upgradeItem', () => {
    it('bumps upgradeLevel on a bag item', () => {
        const item = makeItem({ upgradeLevel: 0 });
        useInventoryStore.setState({ bag: [item] });
        useInventoryStore.getState().upgradeItem(item.uuid);
        expect(useInventoryStore.getState().bag[0].upgradeLevel).toBe(1);
    });

    it('bumps upgradeLevel on an equipped item', () => {
        const item = makeItem({ upgradeLevel: 2 });
        useInventoryStore.setState({
            equipment: { ...EMPTY_EQUIPMENT, mainHand: item },
        });
        useInventoryStore.getState().upgradeItem(item.uuid);
        expect(useInventoryStore.getState().equipment.mainHand?.upgradeLevel).toBe(3);
    });

    it('is a no-op for unknown uuid', () => {
        useInventoryStore.getState().upgradeItem('missing');
        expect(useInventoryStore.getState().bag).toHaveLength(0);
    });
});

describe('updateItemBonuses', () => {
    it('replaces bonuses on a bag item', () => {
        const item = makeItem({ bonuses: { attack: 5 } });
        useInventoryStore.setState({ bag: [item] });
        useInventoryStore.getState().updateItemBonuses(item.uuid, { hp: 50 });
        expect(useInventoryStore.getState().bag[0].bonuses).toEqual({ hp: 50 });
    });

    it('replaces bonuses on an equipped item', () => {
        const item = makeItem({ bonuses: { defense: 3 } });
        useInventoryStore.setState({
            equipment: { ...EMPTY_EQUIPMENT, mainHand: item },
        });
        useInventoryStore.getState().updateItemBonuses(item.uuid, { attack: 8 });
        expect(useInventoryStore.getState().equipment.mainHand?.bonuses).toEqual({ attack: 8 });
    });
});


describe('applyDeathItemLoss', () => {
    it('returns 0 and changes nothing when protected by AOL', () => {
        useInventoryStore.setState({ bag: [makeItem(), makeItem()] });
        const lost = useInventoryStore.getState().applyDeathItemLoss(true, 100);
        expect(lost).toBe(0);
        expect(useInventoryStore.getState().bag).toHaveLength(2);
    });

    it('returns 0 when nothing is in the bag or equipped', () => {
        const lost = useInventoryStore.getState().applyDeathItemLoss(false, 100);
        expect(lost).toBe(0);
    });

    it('removes at least 1 item when the pool is non-empty (5%, min 1) at lvl 51+', () => {
        useInventoryStore.setState({ bag: [makeItem(), makeItem()] });
        const lost = useInventoryStore.getState().applyDeathItemLoss(false, 100);
        expect(lost).toBeGreaterThanOrEqual(1);
        expect(useInventoryStore.getState().bag.length).toBeLessThanOrEqual(1);
    });

    it('loses NOTHING at level <= 50 (beginner grace), even with a full bag', () => {
        useInventoryStore.setState({ bag: [makeItem(), makeItem(), makeItem()] });
        for (const lvl of [1, 25, 50]) {
            const lost = useInventoryStore.getState().applyDeathItemLoss(false, lvl);
            expect(lost).toBe(0);
        }
        expect(useInventoryStore.getState().bag).toHaveLength(3);
    });

    it('boundary: level 50 is protected, level 51 loses items', () => {
        useInventoryStore.setState({ bag: [makeItem(), makeItem()] });
        expect(useInventoryStore.getState().applyDeathItemLoss(false, 50)).toBe(0);
        expect(useInventoryStore.getState().bag).toHaveLength(2);
        expect(useInventoryStore.getState().applyDeathItemLoss(false, 51)).toBeGreaterThanOrEqual(1);
    });
});


describe('disassembleMultiple', () => {
    it('removes the listed bag items from the bag', () => {
        const a = makeItem({ rarity: 'common' });
        const b = makeItem({ rarity: 'rare' });
        useInventoryStore.setState({ bag: [a, b] });
        useInventoryStore.getState().disassembleMultiple(
            [a.uuid, b.uuid],
            () => 'common',
        );
        expect(useInventoryStore.getState().bag).toHaveLength(0);
    });
});
