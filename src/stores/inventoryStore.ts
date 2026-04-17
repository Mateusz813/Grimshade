import { create } from 'zustand';
import {
  EMPTY_EQUIPMENT,
  STONE_FOR_RARITY,
  STONE_CONVERSION_CHAIN,
  STONE_CONVERSION_COST,
  STONE_CONVERSION_GOLD,
  type IInventoryItem,
  type IEquipment,
  type EquipmentSlot,
  type Rarity,
} from '../systems/itemSystem';

/** Max inventory bag slots. */
const MAX_BAG_SIZE = 1000;
const MAX_DEPOSIT_SIZE = 10000;

// Rarity order from lowest (auto-sold first) to highest (never auto-sold).
// When the bag is full and a new item arrives, the lowest-rarity item is
// sold to make room. 'heroic' items are NEVER auto-sold.
const AUTO_SELL_RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic'];

const RARITY_RANK: Record<string, number> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
  mythic: 4,
  heroic: 5,
};

/** Basic fallback sell price used when the bag overflows and we must make
 *  room without access to itemSystem's full price table. Keeps things cheap
 *  but non-zero so the player at least gets something back. */
const OVERFLOW_SELL_PRICE: Record<string, number> = {
  common: 5,
  rare: 25,
  epic: 100,
  legendary: 400,
  mythic: 1500,
};

/** Picks the lowest-value item in the bag that is still eligible for
 *  auto-sell (not heroic). Compares rarity first (lowest sells first),
 *  then item level as tiebreaker (lowest level sells first). */
const pickOverflowVictim = (bag: IInventoryItem[]): IInventoryItem | null => {
  let worst: IInventoryItem | null = null;
  let worstRank = Infinity;
  let worstLevel = Infinity;
  for (const item of bag) {
    const rank = RARITY_RANK[item.rarity ?? 'common'] ?? 0;
    if (rank >= 5) continue; // heroic – never auto-sell
    const lvl = item.itemLevel ?? 1;
    if (rank < worstRank || (rank === worstRank && lvl < worstLevel)) {
      worst = item;
      worstRank = rank;
      worstLevel = lvl;
    }
  }
  return worst;
};

interface IInventoryStore {
  bag: IInventoryItem[];
  equipment: IEquipment;
  /** Per-character bank storage (max 10000 slots). Items here are NEVER lost on death. */
  deposit: IInventoryItem[];
  gold: number;
  /** consumable id → count owned */
  consumables: Record<string, number>;
  /** stone id → count owned (stackable enhancement stones) */
  stones: Record<string, number>;

  /** Returns false when bag is full. */
  addItem: (item: IInventoryItem) => boolean;
  removeItem: (uuid: string) => void;
  /** Moves item from bag into the given equipment slot, swapping if occupied. */
  equipItem: (uuid: string, slot: EquipmentSlot) => void;
  /** Moves equipped item back into bag. No-op when bag is full. */
  unequipItem: (slot: EquipmentSlot) => void;
  /** Removes item from bag and adds `gold` amount to gold pool. */
  sellItem: (uuid: string, goldAmount: number) => void;
  /** Removes multiple items from bag and adds total gold. Returns total gold earned. */
  sellMultiple: (uuids: string[], getSellPriceFn: (item: IInventoryItem) => number) => number;
  addGold: (amount: number) => void;
  spendGold: (amount: number) => boolean;
  /** Increases the upgrade level of an item by 1 (in bag or equipment). */
  upgradeItem: (uuid: string) => void;
  /** Replace an item's bonuses with new ones (used by bonus reroll). */
  updateItemBonuses: (uuid: string, newBonuses: Record<string, number>) => void;
  addConsumable: (id: string, amount?: number) => void;
  useConsumable: (id: string) => boolean;
  /** Add enhancement stones (stackable). */
  addStones: (stoneId: string, amount?: number) => void;
  /** Get how many of a specific stone the player has. */
  getStoneCount: (stoneId: string) => number;
  /** Consume N stones of a specific type. Returns false if not enough. */
  useStones: (stoneId: string, amount: number) => boolean;
  /** Removes multiple items from bag and adds corresponding stones. Returns stones earned map. */
  disassembleMultiple: (uuids: string[], getRarityFn: (item: IInventoryItem) => string) => Record<string, number>;
  /** Convert 100 stones of a type into 1 stone of the next higher rarity. Costs 1000 gold. Returns false if not enough resources or no higher tier. */
  convertStones: (stoneId: string) => boolean;
  /** Add spell chests to consumables inventory. */
  addSpellChest: (level: number, count: number) => void;
  /** Use (consume) spell chests. Returns false if not enough. */
  useSpellChests: (level: number, count: number) => boolean;
  /** Get current count of spell chests at a specific level. */
  getSpellChestCount: (level: number) => number;
  /** Move an item from bag → deposit. Returns false if deposit full. */
  depositItem: (uuid: string) => boolean;
  /** Move an item from deposit → bag. Returns false if bag full. */
  withdrawItem: (uuid: string) => boolean;
  /**
   * Apply 5% random item loss across bag + equipped items (deposit untouched).
   * If `protected` is true, no items are lost (caller already consumed an AOL).
   * Returns the number of items destroyed.
   */
  applyDeathItemLoss: (protectedByAol: boolean) => number;
}

export const useInventoryStore = create<IInventoryStore>()(
    (set, get) => ({
      bag: [],
      equipment: { ...EMPTY_EQUIPMENT },
      deposit: [],
      gold: 0,
      consumables: {},
      stones: {},

      addItem: (item) => {
        const { bag, gold } = get();
        if (bag.length < MAX_BAG_SIZE) {
          set({ bag: [...bag, item] });
          return true;
        }
        // Bag full → auto-sell lowest-rarity (then lowest-level) item to
        // make room. Incoming item must be strictly "better" than the
        // victim (higher rarity, or same rarity with higher level).
        const incomingRank = RARITY_RANK[item.rarity ?? 'common'] ?? 0;
        const incomingLevel = item.itemLevel ?? 1;
        const victim = pickOverflowVictim(bag);
        if (!victim) {
          // Bag is entirely heroic — cannot auto-sell anything, drop the item.
          return false;
        }
        const victimRank = RARITY_RANK[victim.rarity ?? 'common'] ?? 0;
        const victimLevel = victim.itemLevel ?? 1;
        const isBetter = incomingRank > victimRank || (incomingRank === victimRank && incomingLevel > victimLevel);
        if (!isBetter) {
          // Nothing to gain — drop the incoming item.
          return false;
        }
        const victimPrice = OVERFLOW_SELL_PRICE[victim.rarity ?? 'common'] ?? 0;
        set({
          bag: [...bag.filter((i) => i.uuid !== victim.uuid), item],
          gold: gold + victimPrice,
        });
        return true;
      },

      removeItem: (uuid) =>
        set((s) => ({ bag: s.bag.filter((i) => i.uuid !== uuid) })),

      equipItem: (uuid, slot) => {
        const { bag, equipment } = get();
        const item = bag.find((i) => i.uuid === uuid);
        if (!item) return;

        // Remove from bag; put currently-equipped item (if any) back in bag
        const newBag = bag.filter((i) => i.uuid !== uuid);
        const displaced = equipment[slot];
        if (displaced) newBag.push(displaced);

        set({ bag: newBag, equipment: { ...equipment, [slot]: item } });
      },

      unequipItem: (slot) => {
        const { bag, equipment } = get();
        const item = equipment[slot];
        if (!item) return;
        if (bag.length >= MAX_BAG_SIZE) return;
        set({ bag: [...bag, item], equipment: { ...equipment, [slot]: null } });
      },

      sellItem: (uuid, goldAmount) =>
        set((s) => ({
          bag: s.bag.filter((i) => i.uuid !== uuid),
          gold: s.gold + goldAmount,
        })),

      sellMultiple: (uuids, getSellPriceFn) => {
        const { bag } = get();
        const uuidSet = new Set(uuids);
        const toSell = bag.filter((i) => uuidSet.has(i.uuid));
        const totalGold = toSell.reduce((sum, item) => sum + getSellPriceFn(item), 0);
        set((s) => ({
          bag: s.bag.filter((i) => !uuidSet.has(i.uuid)),
          gold: s.gold + totalGold,
        }));
        return totalGold;
      },

      addGold: (amount) =>
        set((s) => ({ gold: s.gold + amount })),

      spendGold: (amount) => {
        const { gold } = get();
        if (gold < amount) return false;
        set({ gold: gold - amount });
        return true;
      },

      upgradeItem: (uuid) => {
        const { bag, equipment } = get();
        // Check bag first
        const bagIdx = bag.findIndex((i) => i.uuid === uuid);
        if (bagIdx >= 0) {
          const newBag = [...bag];
          newBag[bagIdx] = { ...newBag[bagIdx], upgradeLevel: (newBag[bagIdx].upgradeLevel ?? 0) + 1 };
          set({ bag: newBag });
          return;
        }
        // Check equipment
        const newEquipment = { ...equipment };
        for (const slot of Object.keys(newEquipment) as EquipmentSlot[]) {
          const item = newEquipment[slot];
          if (item && item.uuid === uuid) {
            newEquipment[slot] = { ...item, upgradeLevel: (item.upgradeLevel ?? 0) + 1 };
            set({ equipment: newEquipment });
            return;
          }
        }
      },

      updateItemBonuses: (uuid, newBonuses) => {
        const { bag, equipment } = get();
        const bagIdx = bag.findIndex((i) => i.uuid === uuid);
        if (bagIdx >= 0) {
          const newBag = [...bag];
          newBag[bagIdx] = { ...newBag[bagIdx], bonuses: newBonuses };
          set({ bag: newBag });
          return;
        }
        const newEquipment = { ...equipment };
        for (const slot of Object.keys(newEquipment) as EquipmentSlot[]) {
          const item = newEquipment[slot];
          if (item && item.uuid === uuid) {
            newEquipment[slot] = { ...item, bonuses: newBonuses };
            set({ equipment: newEquipment });
            return;
          }
        }
      },

      addConsumable: (id, amount = 1) =>
        set((s) => ({
          consumables: { ...s.consumables, [id]: (s.consumables[id] ?? 0) + amount },
        })),

      useConsumable: (id) => {
        const count = get().consumables[id] ?? 0;
        if (count <= 0) return false;
        set((s) => ({
          consumables: { ...s.consumables, [id]: Math.max(0, (s.consumables[id] ?? 0) - 1) },
        }));
        return true;
      },

      addStones: (stoneId, amount = 1) =>
        set((s) => ({
          stones: { ...s.stones, [stoneId]: (s.stones[stoneId] ?? 0) + amount },
        })),

      getStoneCount: (stoneId) => {
        return get().stones[stoneId] ?? 0;
      },

      useStones: (stoneId, amount) => {
        const current = get().stones[stoneId] ?? 0;
        if (current < amount) return false;
        set((s) => ({
          stones: { ...s.stones, [stoneId]: (s.stones[stoneId] ?? 0) - amount },
        }));
        return true;
      },

      disassembleMultiple: (uuids, _getRarityFn) => {
        const { bag } = get();
        const uuidSet = new Set(uuids);
        const toDisassemble = bag.filter((i) => uuidSet.has(i.uuid));
        const stonesEarned: Record<string, number> = {};

        // 20% chance per item to produce a stone (matches single-item flow).
        for (const item of toDisassemble) {
          if (Math.random() >= 0.20) continue;
          const stoneId = STONE_FOR_RARITY[item.rarity as Rarity] ?? 'common_stone';
          stonesEarned[stoneId] = (stonesEarned[stoneId] ?? 0) + 1;
        }

        // Apply all at once: remove items, add stones
        set((s) => {
          const newStones = { ...s.stones };
          for (const [stoneId, count] of Object.entries(stonesEarned)) {
            newStones[stoneId] = (newStones[stoneId] ?? 0) + count;
          }
          return {
            bag: s.bag.filter((i) => !uuidSet.has(i.uuid)),
            stones: newStones,
          };
        });

        return stonesEarned;
      },

      convertStones: (stoneId) => {
        const { stones, gold } = get();
        const higherStone = STONE_CONVERSION_CHAIN[stoneId];
        if (!higherStone) return false; // heroic_stone has no higher tier
        const currentCount = stones[stoneId] ?? 0;
        if (currentCount < STONE_CONVERSION_COST) return false;
        if (gold < STONE_CONVERSION_GOLD) return false;

        set((s) => ({
          gold: s.gold - STONE_CONVERSION_GOLD,
          stones: {
            ...s.stones,
            [stoneId]: (s.stones[stoneId] ?? 0) - STONE_CONVERSION_COST,
            [higherStone]: (s.stones[higherStone] ?? 0) + 1,
          },
        }));
        return true;
      },

      addSpellChest: (level, count) => {
        const key = `spell_chest_${level}`;
        set((s) => ({
          consumables: { ...s.consumables, [key]: (s.consumables[key] ?? 0) + count },
        }));
      },

      useSpellChests: (level, count) => {
        const key = `spell_chest_${level}`;
        const current = get().consumables[key] ?? 0;
        if (current < count) return false;
        set((s) => ({
          consumables: { ...s.consumables, [key]: (s.consumables[key] ?? 0) - count },
        }));
        return true;
      },

      getSpellChestCount: (level) => {
        const key = `spell_chest_${level}`;
        return get().consumables[key] ?? 0;
      },

      depositItem: (uuid) => {
        const { bag, deposit } = get();
        if (deposit.length >= MAX_DEPOSIT_SIZE) return false;
        const item = bag.find((i) => i.uuid === uuid);
        if (!item) return false;
        set({
          bag: bag.filter((i) => i.uuid !== uuid),
          deposit: [...deposit, item],
        });
        return true;
      },

      withdrawItem: (uuid) => {
        const { bag, deposit } = get();
        if (bag.length >= MAX_BAG_SIZE) return false;
        const item = deposit.find((i) => i.uuid === uuid);
        if (!item) return false;
        set({
          deposit: deposit.filter((i) => i.uuid !== uuid),
          bag: [...bag, item],
        });
        return true;
      },

      applyDeathItemLoss: (protectedByAol) => {
        if (protectedByAol) return 0;
        const { bag, equipment } = get();

        // Build pool of all "at risk" items (bag + equipped). Deposit excluded.
        type Source = { kind: 'bag'; uuid: string } | { kind: 'equip'; slot: EquipmentSlot };
        const pool: Source[] = [];
        for (const it of bag) pool.push({ kind: 'bag', uuid: it.uuid });
        for (const slot of Object.keys(equipment) as EquipmentSlot[]) {
          if (equipment[slot]) pool.push({ kind: 'equip', slot });
        }

        if (pool.length === 0) return 0;

        // Lose 5% of items, minimum 1 if pool is non-empty
        const lossCount = Math.max(1, Math.floor(pool.length * 0.05));

        // Shuffle and pick lossCount
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const victims = pool.slice(0, lossCount);

        const lostBagUuids = new Set<string>();
        const lostEquipSlots = new Set<EquipmentSlot>();
        for (const v of victims) {
          if (v.kind === 'bag') lostBagUuids.add(v.uuid);
          else lostEquipSlots.add(v.slot);
        }

        const newEquipment = { ...equipment };
        for (const slot of lostEquipSlots) newEquipment[slot] = null;

        set({
          bag: bag.filter((i) => !lostBagUuids.has(i.uuid)),
          equipment: newEquipment,
        });

        return lossCount;
      },
    }),
);
