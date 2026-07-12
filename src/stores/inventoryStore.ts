import { create } from 'zustand';
import {
  EMPTY_EQUIPMENT,
  STONE_FOR_RARITY,
  STONE_CONVERSION_CHAIN,
  STONE_CONVERSION_COST,
  STONE_CONVERSION_GOLD,
  flattenItemsData,
  getSellPrice,
  getTotalEquipmentStats,
  type IInventoryItem,
  type IEquipment,
  type EquipmentSlot,
  type Rarity,
} from '../systems/itemSystem';
import itemsRaw from '../data/items.json';
import { useSettingsStore } from './settingsStore';
import { isHpMpPotionId, getPotionMinLevel } from '../systems/potionGating';
import { losesItemsOnDeath } from '../systems/levelSystem';

let getCurrentCharacterLevel: () => number = () => 1;
export const registerCharacterLevelGetter = (fn: () => number): void => {
  getCurrentCharacterLevel = fn;
};

const ALL_ITEMS_FOR_STATS = flattenItemsData(
  itemsRaw as Parameters<typeof flattenItemsData>[0],
);

const applyEquipmentHpMpDelta = (
  oldEquipment: Partial<IEquipment>,
  newEquipment: Partial<IEquipment>,
): void => {
  let oldStats;
  let newStats;
  try {
    oldStats = getTotalEquipmentStats(oldEquipment, ALL_ITEMS_FOR_STATS);
    newStats = getTotalEquipmentStats(newEquipment, ALL_ITEMS_FOR_STATS);
  } catch {
    return;
  }
  const deltaHp = (newStats.hp ?? 0) - (oldStats.hp ?? 0);
  const deltaMp = (newStats.mp ?? 0) - (oldStats.mp ?? 0);
  if (deltaHp === 0 && deltaMp === 0) return;
  void import('./characterStore').then(({ useCharacterStore }) => {
    const ch = useCharacterStore.getState().character;
    if (!ch) return;
    const newMaxHp = (ch.max_hp ?? 0) + (newStats.hp ?? 0);
    const newMaxMp = (ch.max_mp ?? 0) + (newStats.mp ?? 0);
    const nextHp = Math.max(0, Math.min(newMaxHp, (ch.hp ?? 0) + deltaHp));
    const nextMp = Math.max(0, Math.min(newMaxMp, (ch.mp ?? 0) + deltaMp));
    if (nextHp === (ch.hp ?? 0) && nextMp === (ch.mp ?? 0)) return;
    useCharacterStore.getState().updateCharacter({
      hp: nextHp,
      mp: nextMp,
    });
  }).catch(() => { });
};

const isAutoSellRarity = (rarity: Rarity): boolean => {
  const s = useSettingsStore.getState();
  switch (rarity) {
    case 'common':    return s.autoSellCommon;
    case 'rare':      return s.autoSellRare;
    case 'epic':      return s.autoSellEpic;
    case 'legendary': return s.autoSellLegendary;
    case 'mythic':    return s.autoSellMythic;
    default:          return false;
  }
};

export const MAX_BAG_SIZE = 1000;
export const MAX_DEPOSIT_SIZE = 10000;

const RARITY_RANK: Record<string, number> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
  mythic: 4,
  heroic: 5,
};

const OVERFLOW_SELL_PRICE: Record<string, number> = {
  common: 5,
  rare: 25,
  epic: 100,
  legendary: 400,
  mythic: 1500,
};

const pickOverflowVictim = (bag: IInventoryItem[]): IInventoryItem | null => {
  let worst: IInventoryItem | null = null;
  let worstRank = Infinity;
  let worstLevel = Infinity;
  for (const item of bag) {
    const rank = RARITY_RANK[item.rarity ?? 'common'] ?? 0;
    if (rank >= 5) continue;
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
  deposit: IInventoryItem[];
  gold: number;
  arenaPoints: number;
  consumables: Record<string, number>;
  stones: Record<string, number>;

  addItem: (item: IInventoryItem) => boolean;
  restoreItem: (item: IInventoryItem) => boolean;
  removeItem: (uuid: string) => void;
  equipItem: (uuid: string, slot: EquipmentSlot) => void;
  unequipItem: (slot: EquipmentSlot) => void;
  sellItem: (uuid: string, goldAmount: number) => void;
  sellMultiple: (uuids: string[], getSellPriceFn: (item: IInventoryItem) => number) => number;
  addGold: (amount: number) => void;
  spendGold: (amount: number) => boolean;
  addArenaPoints: (amount: number) => void;
  spendArenaPoints: (amount: number) => boolean;
  upgradeItem: (uuid: string) => void;
  updateItemBonuses: (uuid: string, newBonuses: Record<string, number>) => void;
  addConsumable: (id: string, amount?: number) => void;
  useConsumable: (id: string) => boolean;
  addStones: (stoneId: string, amount?: number) => void;
  getStoneCount: (stoneId: string) => number;
  useStones: (stoneId: string, amount: number) => boolean;
  disassembleMultiple: (uuids: string[], getRarityFn: (item: IInventoryItem) => string) => Record<string, number>;
  convertStones: (stoneId: string) => boolean;
  addSpellChest: (level: number, count: number) => void;
  useSpellChests: (level: number, count: number) => boolean;
  getSpellChestCount: (level: number) => number;
  depositItem: (uuid: string) => boolean;
  withdrawItem: (uuid: string) => boolean;
  applyDeathItemLoss: (protectedByAol: boolean, deathLevel: number) => number;
}

export const useInventoryStore = create<IInventoryStore>()(
    (set, get) => ({
      bag: [],
      equipment: { ...EMPTY_EQUIPMENT },
      deposit: [],
      gold: 0,
      arenaPoints: 0,
      consumables: {},
      stones: {},

      addItem: (item) => {
        const { bag, gold } = get();
        if (isAutoSellRarity(item.rarity)) {
          const price = getSellPrice(item);
          set({ gold: gold + price });
          return true;
        }
        if (bag.length < MAX_BAG_SIZE) {
          set({ bag: [...bag, item] });
          return true;
        }
        const incomingRank = RARITY_RANK[item.rarity ?? 'common'] ?? 0;
        const incomingLevel = item.itemLevel ?? 1;
        const victim = pickOverflowVictim(bag);
        if (!victim) {
          return false;
        }
        const victimRank = RARITY_RANK[victim.rarity ?? 'common'] ?? 0;
        const victimLevel = victim.itemLevel ?? 1;
        const isBetter = incomingRank > victimRank || (incomingRank === victimRank && incomingLevel > victimLevel);
        if (!isBetter) {
          return false;
        }
        const victimPrice = OVERFLOW_SELL_PRICE[victim.rarity ?? 'common'] ?? 0;
        set({
          bag: [...bag.filter((i) => i.uuid !== victim.uuid), item],
          gold: gold + victimPrice,
        });
        return true;
      },

      restoreItem: (item) => {
        const { bag } = get();
        if (bag.length >= MAX_BAG_SIZE) return false;
        set({ bag: [...bag, item] });
        return true;
      },

      removeItem: (uuid) =>
        set((s) => ({ bag: s.bag.filter((i) => i.uuid !== uuid) })),

      equipItem: (uuid, slot) => {
        const { bag, equipment } = get();
        const item = bag.find((i) => i.uuid === uuid);
        if (!item) return;

        const newBag = bag.filter((i) => i.uuid !== uuid);
        const displaced = equipment[slot];
        if (displaced) newBag.push(displaced);

        const oldEquipment = { ...equipment };
        const newEquipment = { ...equipment, [slot]: item };
        set({ bag: newBag, equipment: newEquipment });
        applyEquipmentHpMpDelta(oldEquipment, newEquipment);
      },

      unequipItem: (slot) => {
        const { bag, equipment } = get();
        const item = equipment[slot];
        if (!item) return;
        if (bag.length >= MAX_BAG_SIZE) return;
        const oldEquipment = { ...equipment };
        const newEquipment = { ...equipment, [slot]: null };
        set({ bag: [...bag, item], equipment: newEquipment });
        applyEquipmentHpMpDelta(oldEquipment, newEquipment);
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

      addArenaPoints: (amount) =>
        set((s) => ({ arenaPoints: Math.max(0, (s.arenaPoints ?? 0) + amount) })),

      spendArenaPoints: (amount) => {
        const cur = get().arenaPoints ?? 0;
        if (cur < amount) return false;
        set({ arenaPoints: cur - amount });
        return true;
      },

      upgradeItem: (uuid) => {
        const { bag, equipment } = get();
        const bagIdx = bag.findIndex((i) => i.uuid === uuid);
        if (bagIdx >= 0) {
          const newBag = [...bag];
          newBag[bagIdx] = { ...newBag[bagIdx], upgradeLevel: (newBag[bagIdx].upgradeLevel ?? 0) + 1 };
          set({ bag: newBag });
          return;
        }
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
        if (isHpMpPotionId(id) && getCurrentCharacterLevel() < getPotionMinLevel(id)) {
          return false;
        }
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

        for (const item of toDisassemble) {
          if (Math.random() >= 0.20) continue;
          const stoneId = STONE_FOR_RARITY[item.rarity as Rarity] ?? 'common_stone';
          stonesEarned[stoneId] = (stonesEarned[stoneId] ?? 0) + 1;
        }

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
        if (!higherStone) return false;
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

      applyDeathItemLoss: (protectedByAol, deathLevel) => {
        if (protectedByAol || !losesItemsOnDeath(deathLevel)) return 0;
        const { bag, equipment } = get();

        type Source = { kind: 'bag'; uuid: string } | { kind: 'equip'; slot: EquipmentSlot };
        const pool: Source[] = [];
        for (const it of bag) pool.push({ kind: 'bag', uuid: it.uuid });
        for (const slot of Object.keys(equipment) as EquipmentSlot[]) {
          if (equipment[slot]) pool.push({ kind: 'equip', slot });
        }

        if (pool.length === 0) return 0;

        const lossCount = Math.max(1, Math.floor(pool.length * 0.05));

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
