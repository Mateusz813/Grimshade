/**
 * Integration: HP / MP delta on equip / unequip / replace.
 *
 * 2026-05-21 spec ("Jezeli zaloze eq ktore dodaje HP lub MP ... to tam
 * mam mniej HP niz powinienem miec"): equipping HP / MP gear has to
 * bump the player's CURRENT hp / mp by the same delta as the cap, not
 * just the cap. The fix lives in `inventoryStore.applyEquipmentHpMpDelta`
 * and is wired into `equipItem` + `unequipItem`. This file is the
 * cross-store integration test for that wiring — we let the real
 * inventory + character stores collaborate and verify the player's HP
 * actually moves when gear is swapped.
 *
 * IMPORTANT: the delta apply uses a deferred microtask + lazy dynamic
 * `import('./characterStore')` to break the inventory<->character import
 * cycle. We `await` a microtask between mutating + asserting so the
 * deferred work lands before our expectations run.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useInventoryStore } from '../../src/stores/inventoryStore';
import { useCharacterStore, type ICharacter } from '../../src/stores/characterStore';
import {
    EMPTY_EQUIPMENT,
    buildItem,
    type IInventoryItem,
} from '../../src/systems/itemSystem';

// -- Fixtures -----------------------------------------------------------------

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-equip-1',
    user_id: 'user-1',
    name: 'Tank',
    class: 'Knight',
    level: 50,
    xp: 0,
    hp: 1000,
    max_hp: 1000,
    mp: 200,
    max_mp: 200,
    attack: 50,
    defense: 30,
    attack_speed: 2.0,
    crit_chance: 5,
    crit_damage: 200,
    magic_level: 0,
    hp_regen: 0,
    mp_regen: 0,
    gold: 0,
    stat_points: 0,
    highest_level: 50,
    equipment: {},
    created_at: '',
    updated_at: '',
    ...overrides,
} as ICharacter);

/**
 * Generated armor itemId — `heavy_armor_lvlN_rarity` resolves through
 * `getGeneratedItemInfo` to `{ type: 'heavy_armor', slot: 'armor' }`,
 * so the equip path knows where this item lives and the
 * getTotalEquipmentStats branch picks up `bonuses.hp` as a hp delta.
 */
const makeArmor = (hpBonus: number, name = 'armor-test'): IInventoryItem =>
    buildItem({
        itemId: `heavy_armor_lvl10_rare_${name}`,
        rarity: 'rare',
        bonuses: { hp: hpBonus },
        itemLevel: 10,
    });

const resetStores = (): void => {
    useCharacterStore.setState({ character: null, isLoading: false });
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

/**
 * `applyEquipmentHpMpDelta` defers its work through
 * `void import('./characterStore').then(...)`. In happy-dom / vitest
 * 4.x the dynamic `import()` lands on the next MACRO-task, not the
 * microtask queue, so awaiting `Promise.resolve()` is NOT enough. A
 * single `setTimeout(0)` reliably flushes it. We keep the helper
 * simple so the timing dependency is explicit to readers.
 */
const flushDeltaMicrotask = async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
    resetStores();
});

// -- Equip / unequip / replace -------------------------------------------------

describe('equip flow: HP delta tracks the cap', () => {
    it('equipping +500 HP gear raises current HP by 500', async () => {
        useCharacterStore.getState().setCharacter(makeChar({ hp: 1000, max_hp: 1000 }));
        const armor = makeArmor(500);
        useInventoryStore.setState({
            bag: [armor],
            equipment: { ...EMPTY_EQUIPMENT },
            deposit: [], gold: 0, arenaPoints: 0, consumables: {}, stones: {},
        });

        useInventoryStore.getState().equipItem(armor.uuid, 'armor');
        await flushDeltaMicrotask();

        const ch = useCharacterStore.getState().character!;
        expect(ch.hp).toBe(1500);
    });

    it('unequipping the same gear drops current HP by 500', async () => {
        const armor = makeArmor(500);
        useCharacterStore.getState().setCharacter(makeChar({ hp: 1500, max_hp: 1000 }));
        useInventoryStore.setState({
            bag: [],
            equipment: { ...EMPTY_EQUIPMENT, armor },
            deposit: [], gold: 0, arenaPoints: 0, consumables: {}, stones: {},
        });

        useInventoryStore.getState().unequipItem('armor');
        await flushDeltaMicrotask();

        const ch = useCharacterStore.getState().character!;
        expect(ch.hp).toBe(1000);
    });

    it('replacing +500 with +1000 raises current HP by the delta (+500)', async () => {
        const armor500 = makeArmor(500, 'a');
        const armor1000 = makeArmor(1000, 'b');
        useCharacterStore.getState().setCharacter(makeChar({ hp: 1500, max_hp: 1000 }));
        useInventoryStore.setState({
            bag: [armor1000],
            equipment: { ...EMPTY_EQUIPMENT, armor: armor500 },
            deposit: [], gold: 0, arenaPoints: 0, consumables: {}, stones: {},
        });

        useInventoryStore.getState().equipItem(armor1000.uuid, 'armor');
        await flushDeltaMicrotask();

        const ch = useCharacterStore.getState().character!;
        // delta = 1000 - 500 = +500
        expect(ch.hp).toBe(2000);
        // The displaced +500 armor lands back in the bag.
        expect(useInventoryStore.getState().bag.some(i => i.uuid === armor500.uuid)).toBe(true);
    });

    it('replacing +1000 with +500 drops current HP by the delta (-500)', async () => {
        const armor500 = makeArmor(500, 'a');
        const armor1000 = makeArmor(1000, 'b');
        useCharacterStore.getState().setCharacter(makeChar({ hp: 2000, max_hp: 1000 }));
        useInventoryStore.setState({
            bag: [armor500],
            equipment: { ...EMPTY_EQUIPMENT, armor: armor1000 },
            deposit: [], gold: 0, arenaPoints: 0, consumables: {}, stones: {},
        });

        useInventoryStore.getState().equipItem(armor500.uuid, 'armor');
        await flushDeltaMicrotask();

        const ch = useCharacterStore.getState().character!;
        expect(ch.hp).toBe(1500);
    });

    it('replacing equal-HP gear leaves HP untouched (delta=0 short-circuits)', async () => {
        const oldA = makeArmor(500, 'a');
        const newA = makeArmor(500, 'b');
        useCharacterStore.getState().setCharacter(makeChar({ hp: 1500, max_hp: 1000 }));
        useInventoryStore.setState({
            bag: [newA],
            equipment: { ...EMPTY_EQUIPMENT, armor: oldA },
            deposit: [], gold: 0, arenaPoints: 0, consumables: {}, stones: {},
        });

        useInventoryStore.getState().equipItem(newA.uuid, 'armor');
        await flushDeltaMicrotask();

        const ch = useCharacterStore.getState().character!;
        expect(ch.hp).toBe(1500);
    });

    it('current HP is clamped at (base + new equip) ceiling after a downgrade', async () => {
        // Player has +1000 gear and is sitting at exactly 2000/2000. After
        // swapping to +500 gear, the new cap is 1500 — they cannot stay
        // above the new ceiling.
        const big = makeArmor(1000, 'big');
        const small = makeArmor(500, 'small');
        useCharacterStore.getState().setCharacter(makeChar({ hp: 2000, max_hp: 1000 }));
        useInventoryStore.setState({
            bag: [small],
            equipment: { ...EMPTY_EQUIPMENT, armor: big },
            deposit: [], gold: 0, arenaPoints: 0, consumables: {}, stones: {},
        });

        useInventoryStore.getState().equipItem(small.uuid, 'armor');
        await flushDeltaMicrotask();

        const ch = useCharacterStore.getState().character!;
        // 2000 - 500 (delta) = 1500 — exactly the new cap, no overflow.
        expect(ch.hp).toBe(1500);
        expect(ch.hp).toBeLessThanOrEqual((ch.max_hp ?? 0) + 500);
    });

    it('hp cannot go negative when unequipping more HP than the player has', async () => {
        // Pathological: gear says +500 HP but current HP is only 100.
        // Unequip should clamp to 0, not produce a negative value.
        const armor = makeArmor(500);
        useCharacterStore.getState().setCharacter(makeChar({ hp: 100, max_hp: 1000 }));
        useInventoryStore.setState({
            bag: [],
            equipment: { ...EMPTY_EQUIPMENT, armor },
            deposit: [], gold: 0, arenaPoints: 0, consumables: {}, stones: {},
        });

        useInventoryStore.getState().unequipItem('armor');
        await flushDeltaMicrotask();

        const ch = useCharacterStore.getState().character!;
        expect(ch.hp).toBe(0);
    });

    it('no-ops cleanly when there is no character to update', async () => {
        // 2026-05-21: if the player is mid character-switch the deferred
        // import resolves into a null `character` and we must NOT throw.
        useCharacterStore.setState({ character: null });
        const armor = makeArmor(500);
        useInventoryStore.setState({
            bag: [armor],
            equipment: { ...EMPTY_EQUIPMENT },
            deposit: [], gold: 0, arenaPoints: 0, consumables: {}, stones: {},
        });

        expect(() => {
            useInventoryStore.getState().equipItem(armor.uuid, 'armor');
        }).not.toThrow();
        await flushDeltaMicrotask();
        expect(useCharacterStore.getState().character).toBeNull();
    });
});

// -- MP delta sanity check (same mechanism, different stat key) ---------------

describe('equip flow: MP delta tracks the cap', () => {
    /**
     * Generated mage staff — slot=mainHand, but bonuses.mp is NOT a base
     * stat for mainHand (base stats for mainHand are dmg_min/dmg_max/atk).
     * That's fine — the delta logic in `getTotalEquipmentStats` adds non-
     * base bonus values verbatim, so mp:300 still produces a +300 cap
     * delta.
     */
    const makeStaff = (mpBonus: number, name = 'staff'): IInventoryItem =>
        buildItem({
            itemId: `staff_lvl10_rare_${name}`,
            rarity: 'rare',
            bonuses: { mp: mpBonus },
            itemLevel: 10,
        });

    it('equipping +300 MP staff raises current MP by 300', async () => {
        useCharacterStore.getState().setCharacter(makeChar({
            class: 'Mage', mp: 200, max_mp: 200,
        }));
        const staff = makeStaff(300);
        useInventoryStore.setState({
            bag: [staff],
            equipment: { ...EMPTY_EQUIPMENT },
            deposit: [], gold: 0, arenaPoints: 0, consumables: {}, stones: {},
        });

        useInventoryStore.getState().equipItem(staff.uuid, 'mainHand');
        await flushDeltaMicrotask();

        expect(useCharacterStore.getState().character!.mp).toBe(500);
    });
});
